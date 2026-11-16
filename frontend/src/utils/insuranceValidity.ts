/**
 * Helpers for the insurance approval validity window (Valid From → Valid To).
 *
 * Dates are ISO "YYYY-MM-DD" strings — the same shape Frappe returns for Date
 * fields and the portal date pickers emit. Parsing is done with Date.UTC so the
 * day maths never shifts because of the browser timezone.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

function isoToUtcMs(value?: string | null): number | null {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(ms) ? null : ms
}

/** True when both dates are present and Valid To falls before Valid From. */
export function isValidityRangeInverted(
  validFrom?: string | null,
  validTo?: string | null,
): boolean {
  const from = isoToUtcMs(validFrom)
  const to = isoToUtcMs(validTo)
  return from !== null && to !== null && to < from
}

/**
 * Approval validity in days, counted inclusively (1 Nov → 30 Nov = 30 days).
 * Returns null when either date is missing or the range is inverted, so the
 * caller can fall back to the stored/manual day count.
 */
export function validityDaysInclusive(
  validFrom?: string | null,
  validTo?: string | null,
): number | null {
  const from = isoToUtcMs(validFrom)
  const to = isoToUtcMs(validTo)
  if (from === null || to === null || to < from) return null
  return Math.round((to - from) / MS_PER_DAY) + 1
}
