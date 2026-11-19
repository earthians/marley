import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  NotebookPen,
  Pill,
} from 'lucide-react'
import { LabTestList } from '../labTests/LabTestList'
import { AppointmentList } from '../appointments/AppointmentList'
import { DashboardCard } from '../ui/DashboardCard'
import { RichTextContent } from '../ui/RichTextContent'
import { usePatientHistoryListingOpener } from '../../utils/patientHistoryListingNavigation'
import {
  fetchOpClinicalTimeline,
  type OpClinicalEpisode,
  type OpClinicalTimeline,
} from '../../services/opClinicalTimeline'
import {
  buildOpClinicalSummaryHtmlFromTimeline,
  openClinicalSummaryDocument,
  type ClinicalSummaryExportMode,
} from '../../utils/clinicalSummaryExport'
import { toast } from '../../hooks/useToast'
import { htmlToPlainText } from '../../utils/htmlToPlainText'
import { formatDoseAndUom } from '../../utils/medicationOrderDisplayUtils'

interface OpClinicalSummaryTabProps {
  patient: string
  onPatientSelect?: (patient: string | undefined) => void
}

function formatDate(val?: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return String(val)
  }
}

function episodeKey(ep: OpClinicalEpisode, index: number): string {
  if (ep.visit) return ep.visit
  if (ep.is_legacy || ep.legacy) {
    return `legacy-${ep.visit_history || ep.visit_num || ep.encounter_date || 'unknown'}-${index}`
  }
  return `orphan-${ep.encounter_date || 'unknown'}-${index}`
}

function isLegacyEpisode(ep: OpClinicalEpisode): boolean {
  return Boolean(ep.is_legacy || ep.legacy)
}

function EpisodePanel({ episode }: { episode: OpClinicalEpisode }) {
  const notes = episode.progress_notes || []
  const rxs = episode.prescriptions || []

  return (
    <div className="grid gap-3 border-t border-sky-100 bg-white p-3 md:grid-cols-2 md:gap-4 md:p-4">
      <div className="flex min-h-[180px] flex-col rounded-lg border border-slate-200 bg-slate-50/40">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          <NotebookPen className="h-4 w-4 text-sky-700" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700">Progress note</h4>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>
          {!notes.length ? (
            <p className="text-sm italic text-slate-400">No progress note for this visit.</p>
          ) : (
            notes.map((note) => (
              <div key={note.name} className="rounded-md border border-slate-100 bg-white px-3 py-2">
                <p className="mb-1 text-[10px] font-medium text-slate-500">
                  {[
                    note.practitioner_name || note.practitioner || note.username || note.user,
                    note.posting_date ? formatDate(note.posting_date) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {note.note?.trim() ? (
                  <RichTextContent value={note.note} className="text-sm leading-relaxed text-slate-800" />
                ) : (
                  <p className="text-sm italic text-slate-400">Empty note</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex min-h-[180px] flex-col rounded-lg border border-slate-200 bg-slate-50/40">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          <Pill className="h-4 w-4 text-sky-700" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700">Prescription</h4>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>
          {!rxs.length ? (
            <p className="text-sm italic text-slate-400">No prescription for this visit.</p>
          ) : (
            rxs.map((rx) => (
              <div key={rx.name} className="rounded-md border border-slate-100 bg-white px-3 py-2">
                <p className="mb-1 text-[10px] font-medium text-slate-500">
                  {[
                    rx.healthcare_practitioner_name || rx.practitioner,
                    rx.name,
                    rx.status,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {(rx.medications || []).length ? (
                  <ul className="mt-2 space-y-1.5">
                    {(rx.medications || []).map((med, idx) => (
                      <li key={idx} className="text-sm text-slate-800">
                        <span className="font-medium">{med.drug_name || med.drug || 'Medication'}</span>
                        {[formatDoseAndUom(med.dosage, med.uom), med.frequency].filter((v) => v && v !== '-').length ? (
                          <span className="text-slate-600">
                            {' '}
                            — {[formatDoseAndUom(med.dosage, med.uom), med.frequency]
                              .filter((v) => v && v !== '-')
                              .join(' · ')}
                          </span>
                        ) : null}
                        {med.instructions ? (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {htmlToPlainText(med.instructions)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm italic text-slate-400">No medication lines</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/** Outpatient clinical history: date → progress note + prescription, visit by visit. */
export function OpClinicalSummaryTab({ patient, onPatientSelect }: OpClinicalSummaryTabProps) {
  const { listingProps } = usePatientHistoryListingOpener(patient)
  const handlePatient = onPatientSelect ?? (() => {})
  const [timeline, setTimeline] = useState<OpClinicalTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openIndex, setOpenIndex] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [extrasOpen, setExtrasOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setOpenIndex(0)
    fetchOpClinicalTimeline(patient)
      .then((data) => {
        if (cancelled) return
        setTimeline(data)
        const firstClinical = data.episodes.findIndex((e) => e.has_clinical)
        setOpenIndex(firstClinical >= 0 ? firstClinical : 0)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load OP clinical summary')
          setTimeline(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [patient])

  const episodes = timeline?.episodes || []
  const openEpisode = episodes[openIndex] || null

  const navLabel = useMemo(() => {
    if (!episodes.length) return ''
    return `${openIndex + 1} of ${episodes.length}`
  }, [episodes.length, openIndex])

  const goNext = () => {
    if (openIndex < episodes.length - 1) setOpenIndex((i) => i + 1)
  }
  const goPrev = () => {
    if (openIndex > 0) setOpenIndex((i) => i - 1)
  }

  const handleExport = async (mode: ClinicalSummaryExportMode) => {
    if (!timeline) {
      toast.error('Load the summary first')
      return
    }
    setExporting(true)
    try {
      const html = buildOpClinicalSummaryHtmlFromTimeline(timeline)
      openClinicalSummaryDocument(html, mode, `clinical-summary-op-${patient}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export clinical summary')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-500">
        <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
        Loading OP clinical summary…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
    )
  }

  if (!episodes.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <CalendarDays className="mx-auto mb-3 h-10 w-10 text-slate-300" strokeWidth={1.5} />
        <p className="font-medium text-slate-700">NO OUTPATIENT VISITS ON RECORD</p>
        <p className="mt-1 text-sm text-slate-500">
          This tab shows progress notes and prescriptions paired by visit date.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-sky-200/70 bg-sky-50/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800/70">
            Outpatient episodes
          </p>
          <p className="text-sm font-medium text-sky-950">
            Date → progress note and prescription side by side. Use the arrows to move between visits.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <div className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-white p-0.5">
            <button
              type="button"
              onClick={goPrev}
              disabled={openIndex <= 0}
              className="rounded px-2 py-1.5 text-sky-900 hover:bg-sky-50 disabled:opacity-40"
              title="Previous visit (newer)"
              aria-label="Previous visit"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <span className="min-w-[4.5rem] px-1 text-center text-xs font-medium text-slate-600">
              {navLabel}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={openIndex >= episodes.length - 1}
              className="rounded px-2 py-1.5 text-sky-900 hover:bg-sky-50 disabled:opacity-40"
              title="Next visit (older)"
              aria-label="Next visit"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExport('pdf')}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-50 disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            {exporting ? '…' : 'PDF'}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExport('excel')}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {exporting ? '…' : 'Excel'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-sky-200/80 bg-white shadow-sm ring-1 ring-sky-100/80">
        <ul className="divide-y divide-sky-100">
          {episodes.map((ep, index) => {
            const open = index === openIndex
            const key = episodeKey(ep, index)
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                    open ? 'bg-sky-50/80' : 'hover:bg-slate-50'
                  }`}
                  aria-expanded={open}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                      open ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-slate-900">
                        {formatDate(ep.encounter_date)}
                      </span>
                      {ep.visit ? (
                        <span className="text-xs font-medium text-sky-800">{ep.visit}</span>
                      ) : isLegacyEpisode(ep) ? (
                        <span className="text-xs font-medium text-amber-800">
                          {ep.visit_num || ep.visit_history || 'Visit History'}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700">Unlinked clinical items</span>
                      )}
                      {isLegacyEpisode(ep) ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                          Legacy
                        </span>
                      ) : null}
                      {ep.visit_type && !isLegacyEpisode(ep) ? (
                        <span className="text-xs text-slate-500">{ep.visit_type}</span>
                      ) : isLegacyEpisode(ep) ? (
                        <span className="text-xs text-slate-500">Visit History</span>
                      ) : null}
                      {ep.status && !isLegacyEpisode(ep) ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                          {ep.status}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {[
                        ep.practitioner_name || ep.practitioner,
                        ep.has_clinical
                          ? `${ep.progress_notes?.length || 0} note(s) · ${ep.prescriptions?.length || 0} Rx`
                          : 'No note or prescription',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
                      open ? 'rotate-180 text-sky-700' : ''
                    }`}
                  />
                </button>
                {open && openEpisode ? <EpisodePanel episode={ep} /> : null}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setExtrasOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
          aria-expanded={extrasOpen}
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">Appointments & lab tests</p>
            <p className="text-xs text-slate-500">Additional OP history (not paired by visit)</p>
          </div>
          <ChevronDown
            className={`h-5 w-5 text-slate-400 transition-transform ${extrasOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {extrasOpen ? (
          <div className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-2">
            <DashboardCard fixedHeight title="Appointments" {...listingProps('appointments')}>
              <AppointmentList patient={patient} showAll onPatientClick={handlePatient} />
            </DashboardCard>
            <DashboardCard fixedHeight title="Lab Tests" {...listingProps('lab')}>
              <LabTestList patient={patient} onPatientClick={handlePatient} />
            </DashboardCard>
          </div>
        ) : null}
      </div>
    </div>
  )
}
