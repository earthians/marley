import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Building2,
  Calendar,
  ClipboardList,
  Copy,
  FileText,
  Lock,
  NotebookPen,
  Pill,
  Stethoscope,
  User,
} from 'lucide-react'
import { fetchClinicalNote, type ClinicalNote } from '../../services/clinicalNotes'
import { fetchActiveCareEpisodeStatus } from '../../services/careEpisode'
import {
  fetchMedicationsForClinicalNoteDay,
  fetchPrescription,
  fetchPrescriptions,
  mapOrderToDuplicateMedication,
  type ClinicalNoteDayMedication,
  type MedicationOrderRow,
} from '../../services/prescriptions'
import {
  displayMedicationDosageWithUom,
  displayMedicationDrugName,
  displayMedicationEndDate,
  displayMedicationFrequency,
  displayMedicationInstructions,
  displayMedicationStartDate,
} from '../../utils/medicationOrderDisplayUtils'
import {
  getMedicationTypeColor,
  isHexColor,
  MEDICATION_TYPES,
  medicationRowStyle,
} from '../../utils/medicationTypeColors'
import { normalizePrescriptionType } from '../../utils/prescriptionType'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { CareModeBadges } from '../ui/CareModeBadges'
import type { CareMode } from '../../providers/CareContextProvider'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { RichTextContent } from '../ui/RichTextContent'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'
import { CreatePrescriptionModal } from '../prescriptions/CreatePrescriptionModal'
import { toast } from '../../hooks/useToast'
import { formatDateTime, formatLinkedVisitClinicalNoteDate } from '../../utils/formatDate'

type ClinicalNoteDoc = ClinicalNote & Record<string, unknown>

const NOTE_MED_TYPE_FILTERS = [
  { key: 'All', label: 'All', color: '#64748b' },
  ...MEDICATION_TYPES.map((t) => ({ key: t.key, label: t.label, color: t.color })),
] as const

function ThinMedTypeChip({
  label,
  color,
  count,
  active,
  onClick,
}: {
  label: string
  color: string
  count: number
  active: boolean
  onClick: () => void
}) {
  const style: CSSProperties = isHexColor(color)
    ? active
      ? { backgroundColor: color, borderColor: color, color: '#1e293b' }
      : { backgroundColor: `${color}22`, borderColor: `${color}66`, color: '#334155' }
    : {}

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-tight transition-colors ${
        count === 0 && !active ? 'opacity-50' : ''
      }`}
      style={style}
      title={label}
    >
      <span className="max-w-[5.5rem] truncate">{label}</span>
      <span
        className="rounded-full px-1 text-[9px] font-bold"
        style={
          isHexColor(color)
            ? active
              ? { backgroundColor: 'rgba(0,0,0,0.12)' }
              : { backgroundColor: `${color}40` }
            : undefined
        }
      >
        {count}
      </span>
    </button>
  )
}

function medicationMatchesTypeFilter(
  med: ClinicalNoteDayMedication,
  typeKey: string,
): boolean {
  if (typeKey === 'All') return true
  const normalized = normalizePrescriptionType(med.medication_type)
  if (typeKey === 'PRN') {
    return normalized === 'PRN' || Boolean(med.is_prn)
  }
  return normalized === typeKey
}

function resolveMedicationTypeLabel(med: ClinicalNoteDayMedication): string {
  const normalized = normalizePrescriptionType(med.medication_type)
  if (normalized) {
    return MEDICATION_TYPES.find((t) => t.key === normalized)?.label || normalized
  }
  if (med.is_prn) return 'PRN'
  return ''
}

function NoteMedicationListItem({
  med,
  ongoing,
}: {
  med: ClinicalNoteDayMedication
  ongoing?: boolean
}) {
  const drugName = displayMedicationDrugName(med) || med.display_drug_name || 'Medication'
  const dosage = displayMedicationDosageWithUom(med) || med.display_dosage
  const frequency = displayMedicationFrequency(med) || med.frequency
  const instructions = displayMedicationInstructions(med)
  const startDate = displayMedicationStartDate(med) || med.start_date || med.date
  const endDateRaw = displayMedicationEndDate(med)
  const endDate = endDateRaw && endDateRaw !== '-' ? endDateRaw : ''
  const typeLabel = resolveMedicationTypeLabel(med)
  const typeColor = getMedicationTypeColor(med.medication_type || (med.is_prn ? 'PRN' : ''))
  const isPink = med.is_pink === 1 || med.is_pink === true

  return (
    <li
      className="rounded-md border px-2.5 py-2"
      style={medicationRowStyle(med.medication_type || (med.is_prn ? 'PRN' : ''), isPink)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-slate-900">{drugName}</p>
            {ongoing ? (
              <span className="inline-flex rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide bg-slate-200 text-slate-700">
                Ongoing
              </span>
            ) : null}
            {typeLabel ? (
              <span
                className="inline-flex rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide"
                style={
                  isHexColor(typeColor)
                    ? {
                        backgroundColor: typeColor,
                        color: '#1e293b',
                      }
                    : undefined
                }
              >
                {typeLabel}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-slate-600">
            {dosage && dosage !== '-' ? <span>{dosage}</span> : null}
            {frequency && frequency !== '-' ? <span>{frequency}</span> : null}
            {med.dosage_form ? <span>{med.dosage_form}</span> : null}
          </div>
          {instructions ? (
            <p className="mt-1 text-[11px] text-slate-500 whitespace-pre-wrap line-clamp-3">
              {instructions}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right text-[10px] leading-snug text-slate-500">
          {startDate && startDate !== '-' ? <div>Start {formatShortDate(startDate)}</div> : null}
          <div>End {endDate ? formatShortDate(endDate) : '—'}</div>
          {med.order_name ? (
            <div className="mt-0.5 font-mono text-[10px] text-slate-400">{med.order_name}</div>
          ) : null}
          {med.practitioner_name ? (
            <div className="mt-0.5">Dr {med.practitioner_name}</div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

interface ClinicalNoteDetailPanelProps {
  name: string
  onClose: () => void
  /** Slide-over title, e.g. "Patient Progress Note" */
  title?: string
  /** List row for instant header context while the full note loads */
  preview?: ClinicalNote
  onPatientClick?: (patient: string) => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  navLabel?: string
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—'
  return String(value)
}

function notePostedLabel(source?: ClinicalNote | ClinicalNoteDoc | null): string {
  if (!source) return '—'
  return (
    formatLinkedVisitClinicalNoteDate(source.posting_date, source.visit_encounter_date) || '—'
  )
}

/** Calendar day (YYYY-MM-DD) from Clinical Note posting_date datetime. */
function noteCalendarDay(value?: string | null): string | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  // Prefer date portion before time (avoids timezone shifting server dates).
  const datePart = raw.includes('T') ? raw.slice(0, 10) : raw.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return null
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return null
  }
}

function formatShortDate(value?: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-GB')
  } catch {
    return String(value).slice(0, 10)
  }
}

function careContextLabel(doc: ClinicalNoteDoc, visitIsIOP = false): string {
  if (doc.inpatient_admission) {
    return `Inpatient · ${doc.inpatient_admission}`
  }
  if (doc.reference_doctype === 'Patient Visit' && doc.reference_document) {
    return `${visitIsIOP ? 'IOP visit' : 'Outpatient visit'} · ${doc.reference_document}`
  }
  if (doc.reference_doctype && doc.reference_document) {
    return `${doc.reference_doctype} · ${doc.reference_document}`
  }
  return '—'
}

function InfoTile({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode
  label: string
  value: string
  onClick?: () => void
}) {
  const valueEl = (
    <p
      className={`mt-0.5 text-sm font-medium leading-snug break-words ${
        onClick ? 'text-primary hover:underline cursor-pointer' : 'text-emerald-950'
      }`}
    >
      {value}
    </p>
  )

  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-emerald-100/70 bg-white/80 px-3 py-2.5 shadow-sm ring-1 ring-emerald-50/80">
      <div className="mt-0.5 shrink-0 text-emerald-600/80">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/65">{label}</p>
        {onClick ? (
          <button type="button" onClick={onClick} className="text-left w-full">
            {valueEl}
          </button>
        ) : (
          valueEl
        )}
      </div>
    </div>
  )
}

function mapClinicalNoteDoc(data: Record<string, unknown>): ClinicalNoteDoc {
  return {
    name: String(data.name ?? ''),
    patient: String(data.patient ?? ''),
    patient_name: data.patient_name ? String(data.patient_name) : undefined,
    posting_date: data.posting_date ? String(data.posting_date) : undefined,
    practitioner: data.practitioner ? String(data.practitioner) : undefined,
    practitioner_name: data.practitioner_name ? String(data.practitioner_name) : undefined,
    clinical_note_type: data.clinical_note_type ? String(data.clinical_note_type) : undefined,
    clinical_note_type_name: data.clinical_note_type_name
      ? String(data.clinical_note_type_name)
      : undefined,
    medical_role: data.medical_role ? String(data.medical_role) : undefined,
    medical_role_name: data.medical_role_name ? String(data.medical_role_name) : undefined,
    note: data.note ? String(data.note) : undefined,
    reference_doctype: data.reference_doctype ? String(data.reference_doctype) : undefined,
    reference_document: data.reference_document ? String(data.reference_document) : undefined,
    inpatient_admission: data.inpatient_admission ? String(data.inpatient_admission) : undefined,
    branch: data.branch ? String(data.branch) : undefined,
    trans_no: data.trans_no ? String(data.trans_no) : undefined,
    note_locked:
      data.note_locked === 1 || data.note_locked === true
        ? true
        : data.note_locked === 0 || data.note_locked === false
          ? false
          : undefined,
    locked_by: data.locked_by ? String(data.locked_by) : undefined,
    locked_on: data.locked_on ? String(data.locked_on) : undefined,
    creation: data.creation ? String(data.creation) : undefined,
    modified: data.modified ? String(data.modified) : undefined,
  }
}

export function ClinicalNoteDetailPanel({
  name,
  onClose,
  title = 'Clinical Note',
  preview,
  onPatientClick,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  navLabel,
}: ClinicalNoteDetailPanelProps) {
  const [doc, setDoc] = useState<ClinicalNoteDoc | null>(preview ? { ...preview, name } : null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visitIsIOP, setVisitIsIOP] = useState(false)
  const [dayMedications, setDayMedications] = useState<ClinicalNoteDayMedication[]>([])
  const [loadingMedications, setLoadingMedications] = useState(false)
  const [medTypeFilter, setMedTypeFilter] = useState<string>('All')
  const [showDuplicatePrescription, setShowDuplicatePrescription] = useState(false)
  const [duplicateMedications, setDuplicateMedications] = useState<MedicationOrderRow[]>([])
  const [loadingDuplicate, setLoadingDuplicate] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClinicalNote(name)
      .then((data) => {
        if (!cancelled) setDoc(mapClinicalNoteDoc(data))
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load clinical note')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [name])

  useEffect(() => {
    const source = doc ?? preview
    const patient = source?.patient
    const noteDay = noteCalendarDay(source?.posting_date)
    if (!patient || !noteDay) {
      setDayMedications([])
      setMedTypeFilter('All')
      return
    }

    const inpatientAdmission =
      (source as ClinicalNoteDoc)?.inpatient_admission ||
      ((source as ClinicalNoteDoc)?.reference_doctype === 'Inpatient Admission'
        ? (source as ClinicalNoteDoc)?.reference_document
        : undefined)
    const patientVisit =
      (source as ClinicalNoteDoc)?.reference_doctype === 'Patient Visit'
        ? (source as ClinicalNoteDoc)?.reference_document
        : undefined

    let cancelled = false
    setLoadingMedications(true)
    fetchMedicationsForClinicalNoteDay({
      patient,
      noteDate: noteDay,
      inpatientAdmission: inpatientAdmission || undefined,
      patientVisit: patientVisit || undefined,
    })
      .then((result) => {
        if (!cancelled) setDayMedications(result.medications || [])
      })
      .catch(() => {
        if (!cancelled) setDayMedications([])
      })
      .finally(() => {
        if (!cancelled) setLoadingMedications(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    doc?.patient,
    doc?.posting_date,
    doc?.inpatient_admission,
    doc?.reference_doctype,
    doc?.reference_document,
    preview?.patient,
    preview?.posting_date,
    preview?.inpatient_admission,
    preview?.reference_doctype,
    preview?.reference_document,
  ])

  useEffect(() => {
    const source = doc ?? preview
    const visitName =
      source?.reference_doctype === 'Patient Visit' ? source.reference_document : undefined
    if (!visitName) {
      setVisitIsIOP(false)
      return
    }
    let cancelled = false
    fetchActiveCareEpisodeStatus(visitName)
      .then((status) => {
        if (!cancelled) setVisitIsIOP(Boolean(status.is_iop_visit))
      })
      .catch(() => {
        if (!cancelled) setVisitIsIOP(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    doc?.reference_doctype,
    doc?.reference_document,
    preview?.reference_doctype,
    preview?.reference_document,
  ])

  const headerSubtitle = useMemo(() => {
    const source = doc ?? preview
    if (!source) return name
    const parts = [
      source.patient_name || source.patient,
      notePostedLabel(source) !== '—' ? notePostedLabel(source) : null,
      (source as ClinicalNoteDoc).trans_no || source.name,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : name
  }, [doc, preview, name])

  const noteLabel =
    title === 'Patient Progress Note' ||
    title === 'Doctor Progress Note' ||
    doc?.clinical_note_type === 'Doctor Progress Note' ||
    doc?.clinical_note_type === 'Patient Progress Note'
      ? 'Progress note'
      : 'Clinical note'

  const medTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { All: dayMedications.length }
    for (const typeDef of MEDICATION_TYPES) {
      counts[typeDef.key] = dayMedications.filter((m) =>
        medicationMatchesTypeFilter(m, typeDef.key),
      ).length
    }
    return counts
  }, [dayMedications])

  // Show only the prescription types that actually have a medication on this note's day
  // (plus All). A type with nothing on the day — a STAT that ended yesterday, or any
  // other empty category — is hidden rather than showing an empty "no medications" result.
  const visibleMedTypeFilters = useMemo(
    () =>
      NOTE_MED_TYPE_FILTERS.filter(
        (typeDef) => typeDef.key === 'All' || (medTypeCounts[typeDef.key] || 0) > 0,
      ),
    [medTypeCounts],
  )

  // Keep the selected filter valid when the visible chips change (e.g. after reload).
  useEffect(() => {
    if (medTypeFilter !== 'All' && !visibleMedTypeFilters.some((t) => t.key === medTypeFilter)) {
      setMedTypeFilter('All')
    }
  }, [medTypeFilter, visibleMedTypeFilters])

  const filteredDayMedications = useMemo(
    () => dayMedications.filter((m) => medicationMatchesTypeFilter(m, medTypeFilter)),
    [dayMedications, medTypeFilter],
  )

  const startedOnNoteDayMeds = useMemo(
    () => filteredDayMedications.filter((m) => Boolean(m.started_on_note_day)),
    [filteredDayMedications],
  )

  const ongoingActiveMeds = useMemo(
    () =>
      filteredDayMedications.filter(
        // Legacy (Oracle-imported) lines are treated as completed — never ongoing.
        (m) => !m.is_legacy && (Boolean(m.is_ongoing) || !m.started_on_note_day),
      ),
    [filteredDayMedications],
  )

  const isLocked = doc?.note_locked === 1 || doc?.note_locked === true

  const noteBody = doc?.note ?? preview?.note

  const careMode: CareMode | null = useMemo(() => {
    const source = doc ?? preview
    if (!source) return null
    if ((source as ClinicalNoteDoc).inpatient_admission) return 'IP'
    if (
      (source as ClinicalNoteDoc).reference_doctype === 'Patient Visit' &&
      (source as ClinicalNoteDoc).reference_document
    ) {
      return 'OP'
    }
    return null
  }, [doc, preview])

  const noteSource = doc ?? preview
  const duplicatePatient = noteSource?.patient || ''
  const duplicateInpatientAdmission =
    (noteSource as ClinicalNoteDoc | undefined)?.inpatient_admission ||
    ((noteSource as ClinicalNoteDoc | undefined)?.reference_doctype === 'Inpatient Admission'
      ? (noteSource as ClinicalNoteDoc | undefined)?.reference_document
      : undefined) ||
    undefined
  const duplicatePatientVisit =
    (noteSource as ClinicalNoteDoc | undefined)?.reference_doctype === 'Patient Visit'
      ? (noteSource as ClinicalNoteDoc | undefined)?.reference_document || undefined
      : undefined
  const duplicateCareContext: 'Patient Visit' | 'Inpatient Admission' | undefined =
    duplicateInpatientAdmission
      ? 'Inpatient Admission'
      : duplicatePatientVisit
        ? 'Patient Visit'
        : careMode === 'IP'
          ? 'Inpatient Admission'
          : careMode === 'OP'
            ? 'Patient Visit'
            : undefined
  const duplicatePractitioner =
    (noteSource as ClinicalNoteDoc | undefined)?.practitioner ||
    dayMedications.find((m) => m.practitioner)?.practitioner ||
    undefined

  const openDuplicatePrescription = async () => {
    if (!duplicatePatient) return
    setLoadingDuplicate(true)
    try {
      const list = await fetchPrescriptions(200, 0, {
        patient: duplicatePatient,
        careContext: duplicateCareContext,
        patientEncounter: duplicatePatientVisit,
        inpatientRecord: duplicateInpatientAdmission,
      })

      // Prefer active/open prescriptions; fall back to full list if nothing matches.
      const preferred = list.filter(
        (rx) => !['Cancelled', 'Stopped', 'Discontinued'].includes(String(rx.status || '')),
      )
      const sourceList = preferred.length > 0 ? preferred : list

      const allOrders: MedicationOrderRow[] = []
      for (const row of sourceList) {
        let orders = row.medication_orders || []
        if (!orders.length) {
          try {
            const full = await fetchPrescription(row.name)
            orders = full?.medication_orders || []
          } catch {
            orders = []
          }
        }
        for (const order of orders) {
          allOrders.push(mapOrderToDuplicateMedication(order))
        }
      }

      setDuplicateMedications(allOrders)
      setShowDuplicatePrescription(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load patient prescriptions')
    } finally {
      setLoadingDuplicate(false)
    }
  }

  return (
    <DetailSlideOver
      title={title}
      subtitle={
        <>
          {careMode ? (
            <CareModeBadges
              mode={careMode}
              isIOPVisit={careMode === 'OP' && visitIsIOP}
              className="mr-2"
            />
          ) : null}
          {headerSubtitle}
        </>
      }
      icon={<NotebookPen className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      onPrev={onPrev}
      onNext={onNext}
      hasPrev={hasPrev}
      hasNext={hasNext}
      navLabel={navLabel}
      headerActions={
        <PrintFormatDropdown
          doctype="Clinical Note"
          docName={name}
          noLetterhead={0}
          triggerPrint={1}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200/80 bg-white/80 text-emerald-700 shadow-sm transition hover:bg-emerald-50"
        />
      }
    >
      {loading && !noteBody ? (
        <div className="flex items-center justify-center py-12">
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
          <span className="text-sm text-slate-500">Loading note…</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {(doc || preview) && !error ? (
        <div className="flex flex-col gap-5 pb-2">
          {isLocked ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Lock className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span>
                This note is locked
                {doc?.locked_on ? ` · ${formatDateTime(doc.locked_on)}` : ''}
              </span>
            </div>
          ) : null}

          <section className="rounded-xl border border-emerald-200/80 bg-white px-4 py-4 shadow-sm ring-1 ring-emerald-100/80 sm:px-5 sm:py-5">
            <div className="mb-3 flex items-center gap-2 border-b border-emerald-100 pb-3">
              <FileText className="h-5 w-5 text-emerald-600" strokeWidth={2} />
              <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-900">{noteLabel}</h3>
            </div>
            <div className="min-h-[8rem] rounded-lg bg-slate-50/80 px-4 py-4 ring-1 ring-slate-100">
              {loading && noteBody ? (
                <p className="mb-3 text-xs text-slate-400">Refreshing full note…</p>
              ) : null}
              <RichTextContent
                value={noteBody || ''}
                className="text-[15px] leading-relaxed text-slate-800"
              />
            </div>
          </section>

          <section className={MODAL_SECTION_CLASS}>
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
              <h3 className={`${MODAL_SECTION_TITLE_CLASS} mb-0 border-0 pb-0`}>
                <Pill className="h-4 w-4 text-emerald-600" strokeWidth={2} />
                Medications
              </h3>
              <button
                type="button"
                onClick={() => void openDuplicatePrescription()}
                disabled={!duplicatePatient || loadingDuplicate}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary bg-white px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                title="Duplicate all prescriptions for this patient into a new prescription"
              >
                {loadingDuplicate ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {loadingDuplicate ? 'Loading…' : 'Duplicate Prescription'}
              </button>
            </div>

            {!loadingMedications && dayMedications.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1">
                {visibleMedTypeFilters.map((typeDef) => (
                  <ThinMedTypeChip
                    key={typeDef.key}
                    label={typeDef.label}
                    color={typeDef.color}
                    count={medTypeCounts[typeDef.key] || 0}
                    active={medTypeFilter === typeDef.key}
                    onClick={() => setMedTypeFilter(typeDef.key)}
                  />
                ))}
              </div>
            ) : null}

            {loadingMedications ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
                Loading medications…
              </div>
            ) : dayMedications.length === 0 ? (
              <p className="text-sm italic text-slate-400">
                No medications started on this day, and no ongoing active medications.
              </p>
            ) : filteredDayMedications.length === 0 ? (
              <p className="text-sm italic text-slate-400">
                No medications in this category for this note.
              </p>
            ) : (
              <div className="space-y-3">
                {startedOnNoteDayMeds.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      Started on this day
                    </p>
                    <ul className="space-y-1.5">
                      {startedOnNoteDayMeds.map((med, idx) => (
                        <NoteMedicationListItem
                          key={med.name || `started-${med.order_name}-${idx}`}
                          med={med}
                          ongoing={false}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {ongoingActiveMeds.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      Ongoing (active only)
                    </p>
                    <ul className="space-y-1.5">
                      {ongoingActiveMeds.map((med, idx) => (
                        <NoteMedicationListItem
                          key={med.name || `ongoing-${med.order_name}-${idx}`}
                          med={med}
                          ongoing
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_SECTION_TITLE_CLASS}>
              <ClipboardList className="h-4 w-4 text-emerald-600" strokeWidth={2} />
              Details
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <InfoTile
                icon={<User className="h-4 w-4" strokeWidth={2} />}
                label="Patient"
                value={displayValue(doc?.patient_name || doc?.patient || preview?.patient_name || preview?.patient)}
                onClick={
                  (doc?.patient || preview?.patient) && onPatientClick
                    ? () => onPatientClick((doc?.patient || preview?.patient)!)
                    : undefined
                }
              />
              <InfoTile
                icon={<Stethoscope className="h-4 w-4" strokeWidth={2} />}
                label="Doctor Name"
                value={displayValue(
                  doc?.practitioner_name ||
                    doc?.practitioner ||
                    preview?.practitioner_name ||
                    preview?.practitioner ||
                    doc?.user ||
                    preview?.user,
                )}
              />
              <InfoTile
                icon={<Calendar className="h-4 w-4" strokeWidth={2} />}
                label="Posted"
                value={notePostedLabel(doc || preview)}
              />
              <InfoTile
                icon={<Building2 className="h-4 w-4" strokeWidth={2} />}
                label="Care context"
                value={doc ? careContextLabel(doc, visitIsIOP) : careContextLabel((preview ?? {}) as ClinicalNoteDoc, visitIsIOP)}
              />
              {doc?.clinical_note_type || preview?.clinical_note_type ? (
                <InfoTile
                  icon={<NotebookPen className="h-4 w-4" strokeWidth={2} />}
                  label="Note type"
                  value={displayValue(
                    (() => {
                      const typeName =
                        doc?.clinical_note_type_name ||
                        doc?.clinical_note_type ||
                        preview?.clinical_note_type_name ||
                        preview?.clinical_note_type
                      return typeName === 'Doctor Progress Note' ? 'Patient Progress Note' : typeName
                    })(),
                  )}
                />
              ) : null}
              <InfoTile
                icon={<FileText className="h-4 w-4" strokeWidth={2} />}
                label="Note ID"
                value={displayValue((doc as ClinicalNoteDoc)?.trans_no || doc?.name || preview?.name || name)}
              />
            </div>
          </section>

          {doc?.creation ? (
            <p className="text-center text-xs text-slate-400">
              Recorded {formatDateTime(doc.creation)}
              {doc.modified && doc.modified !== doc.creation
                ? ` · Updated ${formatDateTime(doc.modified)}`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {showDuplicatePrescription && duplicatePatient ? (
        <CreatePrescriptionModal
          onClose={() => {
            setShowDuplicatePrescription(false)
            setDuplicateMedications([])
          }}
          onSuccess={() => {
            setShowDuplicatePrescription(false)
            setDuplicateMedications([])
            toast.success(
              duplicateMedications.length > 0
                ? 'Prescription duplicated successfully'
                : 'Prescription created successfully',
            )
          }}
          initialPatient={duplicatePatient}
          initialCareContext={duplicateCareContext}
          initialPatientEncounter={duplicatePatientVisit}
          initialInpatientRecord={duplicateInpatientAdmission}
          initialPractitioner={duplicatePractitioner}
          initialMedications={duplicateMedications}
        />
      ) : null}
    </DetailSlideOver>
  )
}
