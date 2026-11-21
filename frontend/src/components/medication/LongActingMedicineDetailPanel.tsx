import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Calendar,
  ClipboardList,
  Pill,
  Stethoscope,
  User,
} from 'lucide-react'
import {
  fetchLongActingMedicine,
  formatInjectionSide,
  formatInjectionSideShort,
  formatLongActingDose,
  injectionSideFromGiveOut,
  resolveGiveOutGivenBy,
  type LongActingMedicineRow,
} from '../../services/longActingMedicine'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'

interface LongActingMedicineDetailPanelProps {
  name: string
  onClose: () => void
  preview?: LongActingMedicineRow
  onPatientClick?: (patient: string) => void
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—'
  return String(value)
}

function formatDate(value?: string): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-GB')
  } catch {
    return value
  }
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

export function LongActingMedicineDetailPanel({
  name,
  onClose,
  preview,
  onPatientClick,
}: LongActingMedicineDetailPanelProps) {
  const [doc, setDoc] = useState<LongActingMedicineRow | null>(
    preview ? { ...preview, name } : null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchLongActingMedicine(name)
      .then((data) => {
        if (!cancelled) setDoc(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load long acting medicine')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [name])

  const headerSubtitle = useMemo(() => {
    const source = doc ?? preview
    if (!source) return name
    const parts = [
      source.patient_name || source.patient,
      source.frequency,
      source.next_run_date ? `Next: ${formatDate(source.next_run_date)}` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : name
  }, [doc, preview, name])

  const medications = doc?.medications ?? preview?.medications ?? []
  const status = doc?.status ?? preview?.status ?? 'Draft'
  const dosageDisplay =
    formatLongActingDose(
      doc?.default_dosage ?? preview?.default_dosage,
      doc?.default_uom ?? preview?.default_uom,
    ) ||
    formatLongActingDose(medications[0]?.dosage, medications[0]?.uom) ||
    '—'

  return (
    <DetailSlideOver
      title="Long Acting Medicine"
      subtitle={headerSubtitle}
      icon={<Pill className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      headerActions={
        <PrintFormatDropdown
          doctype="Long Acting Medicine"
          docName={name}
          noLetterhead={0}
          triggerPrint={1}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200/80 bg-white/80 text-emerald-700 shadow-sm transition hover:bg-emerald-50"
        />
      }
    >
      {loading && !doc && !preview ? (
        <div className="flex items-center justify-center py-12">
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
          <span className="text-sm text-slate-500">Loading…</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {(doc || preview) && !error ? (
        <div className="flex flex-col gap-5 pb-2">
          <section className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 to-white px-4 py-4 shadow-sm ring-1 ring-emerald-100/80 sm:px-5 sm:py-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/70">Schedule</p>
            <h3 className="mt-1 text-lg font-semibold text-emerald-950">
              {displayValue(doc?.frequency ?? preview?.frequency)}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Status: <span className="font-medium text-slate-800">{status}</span>
            </p>
          </section>

          {medications.length > 0 ? (
            <section className="rounded-xl border border-emerald-200/80 bg-white px-4 py-4 shadow-sm ring-1 ring-emerald-100/80 sm:px-5 sm:py-5">
              <div className="mb-3 flex items-center gap-2 border-b border-emerald-100 pb-3">
                <Pill className="h-5 w-5 text-emerald-600" strokeWidth={2} />
                <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-900">Medications</h3>
              </div>
              <ul className="space-y-2.5">
                {medications.map((item, idx) => {
                  // Only this line's own instructions — never fall back to record-wide
                  // doctors_remark (that can belong to another drug on multi-med LAMs).
                  const lineInstructions = (item.instructions || '').trim()
                  return (
                    <li
                      key={item.name || `${item.drug}-${idx}`}
                      className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800"
                    >
                      <p className="font-medium">{item.drug_name || item.drug || '—'}</p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Dosage:{' '}
                        <span className="font-medium text-slate-800">
                          {formatLongActingDose(item.dosage, item.uom) || '—'}
                        </span>
                        {item.patient_frequency ? (
                          <span className="text-slate-500"> · {item.patient_frequency}</span>
                        ) : null}
                      </p>
                      {lineInstructions ? (
                        <div className="mt-2 rounded-md border border-amber-200/80 bg-amber-50/90 px-2.5 py-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800/80">
                            Instructions
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-amber-950/90 whitespace-pre-wrap">
                            {lineInstructions}
                          </p>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {(doc?.remarks || preview?.remarks || doc?.doctors_remark || preview?.doctors_remark) ? (
            <section className="rounded-xl border border-emerald-200/80 bg-white px-4 py-4 shadow-sm ring-1 ring-emerald-100/80 sm:px-5 sm:py-5">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-emerald-900">Remarks</h3>
              {(doc?.remarks || preview?.remarks) ? (
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  <span className="font-medium">Reception: </span>
                  {doc?.remarks || preview?.remarks}
                </p>
              ) : null}
              {(doc?.doctors_remark || preview?.doctors_remark) ? (
                <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap">
                  <span className="font-medium">Doctor: </span>
                  {doc?.doctors_remark || preview?.doctors_remark}
                </p>
              ) : null}
            </section>
          ) : null}

          {(doc?.give_outs?.length ?? 0) > 0 ? (
            <section className="rounded-xl border border-emerald-200/80 bg-white px-4 py-4 shadow-sm ring-1 ring-emerald-100/80 sm:px-5 sm:py-5">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-emerald-900">Give Outs</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Time</th>
                      <th className="py-2 pr-3">Scheduled Run</th>
                      <th className="py-2 pr-3 text-center">Side</th>
                      <th className="py-2 pr-3">Given By</th>
                      <th className="py-2 pr-3">Notes</th>
                      <th className="py-2">Cancelled Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc!.give_outs!.map((row, idx) => (
                      <tr key={row.name || `give-out-${idx}`} className="border-b border-slate-100">
                        <td className="py-2 pr-3 text-slate-700">{formatDate(row.date)}</td>
                        <td className="py-2 pr-3 text-slate-700">{row.time || '—'}</td>
                        <td className="py-2 pr-3 text-slate-700">{formatDate(row.scheduled_run_date)}</td>
                        <td className="py-2 pr-3 text-center text-slate-700 font-semibold">
                          {formatInjectionSideShort(injectionSideFromGiveOut(row))}
                        </td>
                        <td className="py-2 pr-3 text-slate-700">
                          {resolveGiveOutGivenBy(row.user, row.notes) || '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{row.notes || '—'}</td>
                        <td className="py-2 text-slate-600">{row.cancelled_notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

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
                    preview?.practitioner,
                )}
              />
              <InfoTile
                icon={<Calendar className="h-4 w-4" strokeWidth={2} />}
                label="Start date"
                value={formatDate(doc?.start_date || preview?.start_date)}
              />
              <InfoTile
                icon={<Calendar className="h-4 w-4" strokeWidth={2} />}
                label="Next run"
                value={formatDate(doc?.next_run_date || preview?.next_run_date)}
              />
              <InfoTile
                icon={<Pill className="h-4 w-4" strokeWidth={2} />}
                label="Dosage"
                value={dosageDisplay}
              />
              <InfoTile
                icon={<Pill className="h-4 w-4" strokeWidth={2} />}
                label="Last injection side"
                value={formatInjectionSide(doc?.injection_given_on || preview?.injection_given_on)}
              />
              <InfoTile
                icon={<Calendar className="h-4 w-4" strokeWidth={2} />}
                label="End date"
                value={formatDate(doc?.end_date || preview?.end_date)}
              />
              <InfoTile
                icon={<Pill className="h-4 w-4" strokeWidth={2} />}
                label="Record ID"
                value={displayValue(doc?.name || preview?.name || name)}
              />
            </div>
          </section>
        </div>
      ) : null}
    </DetailSlideOver>
  )
}
