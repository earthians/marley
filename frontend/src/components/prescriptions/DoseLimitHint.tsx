import type { MedicineDoseLimitInfo } from '../../services/prescriptions'

interface DoseLimitHintProps {
  info: MedicineDoseLimitInfo | null
  loading?: boolean
  /** Server-side validation warning (only set when Healthcare Settings toggles allow it). */
  hasWarning?: boolean
  warningMessage?: string | null
  /** Kept for API compatibility; not used for local exceedance (settings-gated on server). */
  enteredDose?: string | null
}

/**
 * Amber warning only when the server reports a dose-limit breach.
 * Long-acting warnings require the Long-Acting Dose Period settings checkbox.
 */
export function DoseLimitHint({
  info,
  loading,
  hasWarning = false,
  warningMessage,
}: DoseLimitHintProps) {
  if (loading || !hasWarning || !warningMessage) return null

  const single = (info?.display_single_dose || '').trim()
  const periodOrDay = (info?.display_period_or_day || '').trim()
  const periodLabel = (info?.display_period_label || '').trim()
  const remarks = (info?.display_remarks || '').trim()
  const isLongActing = Boolean(info?.is_long_acting)

  return (
    <div className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900">
      <div className="mb-1.5 text-xs font-medium whitespace-pre-line">{warningMessage}</div>
      {isLongActing ? (
        <>
          {(single || periodOrDay) && (
            <div className="font-semibold text-amber-950">Long-acting dose limits</div>
          )}
          {single ? <div>Max single dose: {single}</div> : null}
          {periodOrDay ? (
            <div>
              Max within period{periodLabel ? ` (${periodLabel})` : ''}: {periodOrDay}
            </div>
          ) : null}
          {remarks ? <div className="mt-0.5 text-amber-800/80">{remarks}</div> : null}
        </>
      ) : (
        <>
          {(single || periodOrDay) && (
            <div className="font-semibold text-amber-950">Dose limits</div>
          )}
          {single ? <div>Max single dose: {single}</div> : null}
          {periodOrDay ? <div>Max per day: {periodOrDay}</div> : null}
        </>
      )}
    </div>
  )
}
