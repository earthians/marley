/**
 * Dosage Form select helpers.
 *
 * Dosage Form and Pharmaceutical Form are the same concept; the options now come
 * from the Pharmaceutical Form master. Legacy prescription lines store the old
 * Dosage Form spelling (e.g. "Tablet" when the master has "TABLET"), and a
 * <select> compares option values case-sensitively — so any stored value that has
 * no exact option is kept selectable instead of rendering blank.
 */

export type DosageFormOption = { name: string; label?: string }

/** Options plus any stored value missing from them, so a select never renders blank. */
export function withDosageFormValues(
  options: DosageFormOption[],
  values: Array<string | null | undefined> = [],
): DosageFormOption[] {
  const missing: DosageFormOption[] = []
  for (const raw of values) {
    const value = (raw || '').trim()
    if (!value) continue
    if (options.some((o) => o.name === value)) continue
    if (missing.some((o) => o.name === value)) continue
    missing.push({ name: value, label: value })
  }
  return missing.length ? [...options, ...missing] : options
}
