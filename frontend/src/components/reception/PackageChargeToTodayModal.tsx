import { CalendarClock, Info, ReceiptText } from 'lucide-react'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import { ConfirmActionModal } from '../ui/ConfirmActionModal'

export interface PackageChargePreview {
  admission?: string
  patient?: string
  patient_name?: string
  package?: string
  package_name?: string
  quotation?: string | null
  quotation_status?: string | null
  quotation_days?: number | null
  quotation_ordered_days?: number | null
  quotation_remaining_days?: number | null
  program_days?: number | null
  is_daily_package?: boolean
  days_elapsed?: number
  days_already_billed?: number
  days_to_charge?: number
  remaining_days_before?: number | null
  remaining_days_after?: number | null
  amount_per_day?: number
  amount?: number
  from_date?: string | null
  to_date?: string | null
  service_unit?: string | null
  can_charge?: boolean
}

interface PackageChargeToTodayModalProps {
  open: boolean
  preview: PackageChargePreview | null
  loading?: boolean
  onClose: () => void
  onConfirm: () => void
}

const DASH = '—'

function formatDate(value?: string | null): string {
  if (!value) return DASH
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCount(value?: number | null): string {
  if (value === null || value === undefined) return DASH
  return String(value)
}

function SummaryTile({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div
      className={
        accent
          ? 'rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5'
          : 'rounded-lg border border-slate-200 bg-white px-3 py-2.5'
      }
    >
      <p
        className={
          accent
            ? 'text-[11px] font-medium uppercase tracking-wide text-emerald-700'
            : 'text-[11px] font-medium uppercase tracking-wide text-slate-500'
        }
      >
        {label}
      </p>
      <p
        className={
          accent
            ? 'mt-1 text-xl font-semibold leading-none text-emerald-800 tabular-nums'
            : 'mt-1 text-xl font-semibold leading-none text-slate-800 tabular-nums'
        }
      >
        {value}
      </p>
    </div>
  )
}

export function PackageChargeToTodayModal({
  open,
  preview,
  loading = false,
  onClose,
  onConfirm,
}: PackageChargeToTodayModalProps) {
  const formatMoney = useFormatMoney()
  const days = Math.max(0, Number(preview?.days_to_charge || 0))
  const packageTitle = preview?.package_name || preview?.package || DASH
  const showPackageCode = Boolean(
    preview?.package_name && preview?.package && preview.package_name !== preview.package,
  )
  const subtitle =
    [preview?.patient_name || preview?.patient, preview?.admission].filter(Boolean).join(' · ') ||
    'Review the package days and amount before posting the charge.'
  const period =
    preview?.from_date || preview?.to_date
      ? `${formatDate(preview?.from_date)} → ${formatDate(preview?.to_date)}`
      : `${formatCount(preview?.days_elapsed)} day(s) elapsed`

  return (
    <ConfirmActionModal
      open={open && Boolean(preview)}
      title="Charge package to today"
      subtitle={subtitle}
      icon={<ReceiptText className="h-5 w-5" aria-hidden />}
      tone="primary"
      loading={loading}
      confirmLabel={`Charge ${days} day${days === 1 ? '' : 's'}`}
      cancelLabel="Not now"
      onClose={onClose}
      onConfirm={onConfirm}
    >
      {preview ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Package
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{packageTitle}</p>
                {showPackageCode ? (
                  <p className="mt-0.5 text-xs text-slate-500">{preview.package}</p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <span className="text-xs font-medium text-slate-700">
                  {preview.quotation || (preview.can_charge ? 'Standalone Sales Order' : 'No quotation')}
                </span>
                {preview.quotation_status ? (
                  <span className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                    {preview.quotation_status}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-200/80 pt-3 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {period}
              </span>
              {preview.is_daily_package ? (
                <span>
                  Package duration:{' '}
                  <span className="font-medium text-slate-700">Daily / open (room rate)</span>
                </span>
              ) : Number(preview.program_days || 0) > 0 ? (
                <span>
                  Package duration:{' '}
                  <span className="font-medium text-slate-700">{preview.program_days} days</span>
                </span>
              ) : null}
              {preview.service_unit ? (
                <span>
                  Service unit:{' '}
                  <span className="font-medium text-slate-700">{preview.service_unit}</span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryTile label="Days to charge" value={formatCount(days)} accent />
            <SummaryTile label="Days elapsed" value={formatCount(preview.days_elapsed)} />
            <SummaryTile label="Already billed" value={formatCount(preview.days_already_billed)} />
            <SummaryTile label="Remaining after" value={formatCount(preview.remaining_days_after)} />
          </div>

          <div className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/70">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="text-emerald-900/80">Amount per day</span>
              <span className="font-semibold text-emerald-950 tabular-nums">
                {formatMoney(Number(preview.amount_per_day || 0))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-emerald-200/80 bg-white/60 px-4 py-3">
              <span className="text-sm font-medium text-emerald-950">
                Charge now · {days} day{days === 1 ? '' : 's'}
              </span>
              <span className="text-lg font-semibold text-emerald-700 tabular-nums">
                {formatMoney(Number(preview.amount || 0))}
              </span>
            </div>
          </div>

          <div className="flex gap-2.5 rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2.5 text-sm text-sky-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden />
            <p className="leading-relaxed">
              {preview.is_daily_package
                ? preview.quotation
                  ? 'Daily room package: charges unbilled stay days at the room rate. Uses remaining Quotation qty first, then a standalone Sales Order for any days beyond the Quotation.'
                  : 'Daily room package: posts a standalone Sales Order at the admission room rate for unbilled stay days.'
                : preview.quotation
                  ? 'Creates a partial Sales Order from the existing Quotation for the unbilled stay days. No new Quotation is created and the package assignment stays the same.'
                  : "No Quotation exists for the current package (for example after a package change). The charge is posted as a standalone Sales Order at the admission's current package rate."}
            </p>
          </div>
        </>
      ) : null}
    </ConfirmActionModal>
  )
}

