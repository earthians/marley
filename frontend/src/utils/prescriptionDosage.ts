/**
 * Dosage helpers for the prescription forms.
 *
 * Doctors enter the dose as a number — the measuring unit belongs in
 * "Unit of Measure". Legacy rows (Oracle import) stored the unit inside the
 * dosage text ("5mg", "18MG", "0.5 MG") and usually left UOM blank, so when
 * such a row is loaded into a form the numeric part stays in Dosage and the
 * unit token is moved to Unit of Measure.
 *
 * The split happens in form state only — existing saved rows are never
 * rewritten in the database by a patch; they are normalised the next time a
 * doctor opens the row and saves it.
 */

/** Common dosage unit spellings mapped to the UOM names shipped with the app. */
const DOSAGE_UNIT_ALIASES: Record<string, string> = {
  mg: 'Milligram',
  mgs: 'Milligram',
  milligram: 'Milligram',
  milligrams: 'Milligram',
  mcg: 'Microgram',
  ug: 'Microgram',
  microgram: 'Microgram',
  micrograms: 'Microgram',
  g: 'Gram',
  gm: 'Gram',
  gms: 'Gram',
  gram: 'Gram',
  grams: 'Gram',
  ml: 'Millilitre',
  mls: 'Millilitre',
  millilitre: 'Millilitre',
  millilitres: 'Millilitre',
  milliliter: 'Millilitre',
  milliliters: 'Millilitre',
  l: 'Litre',
  litre: 'Litre',
  litres: 'Litre',
  liter: 'Litre',
  liters: 'Litre',
  iu: 'International Unit',
  unit: 'UNIT',
  units: 'UNIT',
  u: 'UNIT',
  '%': '%',
  percent: '%',
  tab: 'Tablet',
  tabs: 'Tablet',
  tablet: 'Tablet',
  tablets: 'Tablet',
  cap: 'Capsule',
  caps: 'Capsule',
  capsule: 'Capsule',
  capsules: 'Capsule',
}

function asText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

/** Keep only digits and a single decimal point — Dosage is a number on the UI. */
export function sanitizeDosageInput(value: string): string {
  const digitsAndDots = (value || '').replace(/[^0-9.]/g, '')
  const firstDot = digitsAndDots.indexOf('.')
  if (firstDot === -1) return digitsAndDots
  return (
    digitsAndDots.slice(0, firstDot + 1) +
    digitsAndDots.slice(firstDot + 1).replace(/\./g, '')
  )
}

export interface DosageParts {
  /** Numeric dose, e.g. "18" (empty when the text has no plain leading number). */
  dosage: string
  /** Unit token found after the number, e.g. "MG" (empty when there is none). */
  unit: string
}

/**
 * Split legacy dosage text into a numeric dose and a unit token.
 *
 * "18MG" → { dosage: "18", unit: "MG" }
 * "0,5 mg" → { dosage: "0.5", unit: "mg" }
 * "18" → { dosage: "18", unit: "" }
 * "1-2 tabs" / "BD" → { dosage: "", unit: "" } (not a plain dose + unit pair)
 * "10 mg daily" → { dosage: "10", unit: "mg daily" } — the unit text is not a
 * plain UOM, so normalizeDosageUom leaves the whole value untouched.
 */
export function splitDosageParts(raw?: string | number | null): DosageParts {
  const value = asText(raw)
  if (!value) return { dosage: '', unit: '' }

  const match = value.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/)
  if (!match) return { dosage: '', unit: '' }

  const dosage = match[1].replace(',', '.')
  const rest = (match[2] || '').trim()
  if (!rest) return { dosage, unit: '' }
  // Compound text ("10 mg daily", "1-2 tab") is left untouched — only a plain
  // dose + unit pair is split so no clinical text is ever dropped.
  if (/\d/.test(rest)) return { dosage: '', unit: '' }
  return { dosage, unit: rest }
}

/**
 * Resolve a unit token to a UOM name that actually exists.
 *
 * Prefers the exact spelling found in the data (so "mg" stays "mg" when that
 * UOM exists) and falls back to the canonical name (e.g. "mg" → "Milligram").
 * Returns '' when nothing matches — the caller then leaves the legacy value
 * untouched instead of saving a UOM that would fail link validation.
 */
export function resolveDosageUnitName(
  unit: string,
  availableUomNames: readonly string[] = [],
): string {
  const cleaned = unit.trim().replace(/[.,;]+$/, '').trim()
  if (!cleaned) return ''

  const alias = DOSAGE_UNIT_ALIASES[cleaned.toLowerCase().replace(/\s+/g, ' ')]
  const candidates = alias ? [cleaned, alias] : [cleaned]

  for (const candidate of candidates) {
    const match = availableUomNames.find(
      (name) => name.toLowerCase() === candidate.toLowerCase(),
    )
    if (match) return match
  }
  return ''
}

/**
 * True for the "Other" Prescription Frequency (also matches the legacy "-OTHER-"
 * record). When the frequency is "Other" the doctor does not enter a per-session
 * dose; they enter the total dose per period instead.
 */
export function isOtherFrequency(frequency?: string | null): boolean {
  return (frequency || '').toLowerCase().replace(/[^a-z]/g, '') === 'other'
}

/** Numeric part of a dose string (``"700mg"`` → ``700``); ``null`` when there is no number. */
export function parseDoseNumber(value: unknown): number | null {
  if (value == null) return null
  const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Total dose taken in one day for a prescription line.
 *
 * Normal frequency → single-session dose × "How Many Times a Day?".
 * "Other" frequency → total dose ÷ Dose Frequency days (e.g. total per week ÷ 7).
 * The server applies the same maths for the daily max-dose check.
 */
export function resolveDailyDose(row: {
  dosage?: string | number | null
  frequency_in_a_day?: number | string | null
  total_dose?: string | number | null
  total_dose_days?: number | string | null
}): { dailyDose: number | null; dosesPerDay: number; fromTotalDose: boolean } {
  const totalDose = parseDoseNumber(row.total_dose)
  const totalDays = parseDoseNumber(row.total_dose_days)
  if (totalDose != null && totalDays != null && totalDays > 0) {
    return { dailyDose: totalDose / totalDays, dosesPerDay: 1, fromTotalDose: true }
  }

  const dose = parseDoseNumber(row.dosage)
  const count = Number(row.frequency_in_a_day)
  const dosesPerDay = Number.isFinite(count) && count > 0 ? count : 1
  if (dose == null) return { dailyDose: null, dosesPerDay, fromTotalDose: false }
  return { dailyDose: dose * dosesPerDay, dosesPerDay, fromTotalDose: false }
}

/**
 * Normalise one medication row so Dosage holds only the number and the unit
 * lives in Unit of Measure. Rows that cannot be split safely are returned
 * unchanged (legacy text is preserved rather than truncated).
 */
export function normalizeDosageUom<
  T extends { dosage?: string | number | null; uom?: string | null },
>(row: T, availableUomNames: readonly string[] = []): T {
  const { dosage, unit } = splitDosageParts(row.dosage)
  if (!dosage) return row

  const rawDosage = asText(row.dosage)
  if (!unit) {
    // Already a plain number — only drop stray whitespace/separators.
    return dosage === rawDosage ? row : ({ ...row, dosage } as T)
  }

  const resolved = resolveDosageUnitName(unit, availableUomNames)
  if (!resolved) return row

  const currentUom = asText(row.uom)
  // Keep a unit the doctor already chose; only fill '' / the generic "UNIT" default.
  const keepCurrentUom = currentUom !== '' && currentUom.toLowerCase() !== 'unit'
  return { ...row, dosage, uom: keepCurrentUom ? currentUom : resolved } as T
}
