import { useMemo, type ReactNode } from 'react'
import { Calendar, CalendarDays, FileText, Link2, Pencil, Stethoscope, User } from 'lucide-react'
import { type SickLeaveRow } from '../../services/sickLeave'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'

interface SickLeaveDetailPanelProps {
  row: SickLeaveRow
  onClose: () => void
  onPatientClick?: (patient: string) => void
  onEdit?: () => void
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—'
  return String(value)
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-GB')
  } catch {
    return value
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('en-GB')
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
        onClick ? 'cursor-pointer text-primary hover:underline' : 'text-emerald-950'
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
          <button type="button" onClick={onClick} className="w-full text-left">
            {valueEl}
          </button>
        ) : (
          valueEl
        )}
      </div>
    </div>
  )
}

export function SickLeaveDetailPanel({ row, onClose, onPatientClick, onEdit }: SickLeaveDetailPanelProps) {
  const headerSubtitle = useMemo(() => {
    const parts = [
      row.patient_name || row.patient,
      row.from_date ? formatDate(row.from_date) : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : row.name
  }, [row])

  return (
    <DetailSlideOver
      title="Sick Leave"
      subtitle={headerSubtitle}
      icon={<CalendarDays className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      headerActions={
        <div className="flex items-center gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-50"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              Edit
            </button>
          ) : null}
          <a
            href={`/app/patient-sick-leave/${encodeURIComponent(row.name)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-emerald-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-50"
          >
            Open in Frappe ↗
          </a>
          <PrintFormatDropdown
            doctype="Patient Sick Leave"
            docName={row.name}
            noLetterhead={0}
            triggerPrint={1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200/80 bg-white/80 text-emerald-700 shadow-sm transition hover:bg-emerald-50"
          />
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <section className="rounded-xl border border-emerald-200/80 bg-white px-4 py-4 shadow-sm ring-1 ring-emerald-100/80 sm:px-5 sm:py-5">
          <div className="mb-3 flex items-center gap-2 border-b border-emerald-100 pb-3">
            <Calendar className="h-5 w-5 text-emerald-600" strokeWidth={2} />
            <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-900">Leave Period</h3>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">From Date</div>
              <div className="text-sm font-semibold text-slate-800">{row.from_date || '—'}</div>
            </div>
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">To Date</div>
              <div className="text-sm font-semibold text-slate-800">{row.to_date || '—'}</div>
            </div>
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Days</div>
              <div className="text-sm font-semibold text-slate-800">
                {row.days ? `${row.days} day(s)` : '—'}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-emerald-200/80 bg-white px-4 py-4 shadow-sm ring-1 ring-emerald-100/80 sm:px-5 sm:py-5">
          <div className="mb-3 flex items-center gap-2 border-b border-emerald-100 pb-3">
            <Stethoscope className="h-5 w-5 text-emerald-600" strokeWidth={2} />
            <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-900">Clinical Details</h3>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Doctor</div>
              <div className="text-sm font-semibold text-slate-800">{row.doctor_name || row.doctor || '—'}</div>
            </div>
          </div>
          {row.diagnosis ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Diagnosis</div>
              <div className="rounded-lg border border-emerald-100/80 bg-emerald-50/40 p-3 text-sm leading-relaxed text-slate-800">
                {row.diagnosis}
              </div>
            </div>
          ) : null}
        </section>

        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>
            <FileText className="h-4 w-4 text-emerald-600" strokeWidth={2} />
            Details
          </h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <InfoTile
              icon={<User className="h-4 w-4" strokeWidth={2} />}
              label="Patient"
              value={displayValue(row.patient_name || row.patient)}
              onClick={row.patient && onPatientClick ? () => onPatientClick(row.patient!) : undefined}
            />
            <InfoTile
              icon={<Link2 className="h-4 w-4" strokeWidth={2} />}
              label="Admission"
              value={displayValue(row.admission_no)}
            />
            <InfoTile
              icon={<CalendarDays className="h-4 w-4" strokeWidth={2} />}
              label="Days"
              value={row.days ? `${row.days} day(s)` : '—'}
            />
            <InfoTile
              icon={<Stethoscope className="h-4 w-4" strokeWidth={2} />}
              label="Doctor Name"
              value={displayValue(row.doctor_name || row.doctor)}
            />
            <InfoTile
              icon={<FileText className="h-4 w-4" strokeWidth={2} />}
              label="Record ID"
              value={displayValue(row.name)}
            />
          </div>
        </section>

        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>
            <FileText className="h-4 w-4 text-emerald-600" strokeWidth={2} />
            Flags
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(row.sick_flag)}
                readOnly
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Sick Flag
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(row.fit_flag)}
                readOnly
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Fit Flag
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(row.unfit_flag)}
                readOnly
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Unfit Flag
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(row.light_duty)}
                readOnly
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Light Duty
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(row.needs_flag)}
                readOnly
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Needs Flag
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(row.acc_patient)}
                readOnly
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Accompanying Patient
            </label>
          </div>
        </section>

        {row.creation ? (
          <p className="text-center text-xs text-slate-400">Recorded {formatDateTime(row.creation)}</p>
        ) : null}
      </div>
    </DetailSlideOver>
  )
}
