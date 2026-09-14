/** Display helpers for Patient Medication Order lines (including legacy Oracle imports). */

export type MedicationOrderLike = {
  drug?: string | null
  drug_name?: string | null
  medication?: string | null
  old_medicine_code?: string | null
  old_medicine_name?: string | null
  medicine_no?: string | null
  trans_num?: string | null
  reference_no?: string | null
  dosage?: string | number | null
  uom?: string | null
  strength?: string | null
  instructions?: string | null
  dose_notes?: string | null
  dc?: string | null
  patient_frequency?: string | null
  written_frequency?: string | null
  date?: string | null
  start_date?: string | null
  end_date?: string | null
  stopped_date?: string | null
  /** Recovered discontinue day (status log / modified) when end_date & stopped_date blank */
  discontinued_on?: string | null
  modified?: string | null
  reason_stopped?: string | null
  stopped?: boolean | 0 | 1 | null
  medication_status?: string | null
  effective_status?: string | null
  status?: string | null
  route_of_administration?: string | null
  old_route?: string | null
  username?: string | null
  frequency?: string | null
  /** Doctor who prescribed / added this line */
  healthcare_practitioner?: string | null
  healthcare_practitioner_name?: string | null
}

export type PrescriptionPractitionerLike = {
  /** Resolved name of Patient Medication Order.healthcare_practitioner / practitioner */
  healthcare_practitioner_name?: string | null
  /** Healthcare Practitioner link on Patient Medication Order (alternate field) */
  healthcare_practitioner?: string | null
  /** Main prescribing doctor Link on Patient Medication Order */
  practitioner?: string | null
  user_name?: string | null
}

function text(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return String(value)
  }
  return String(value).trim()
}

export function isLegacyMedicationOrderRow(order: MedicationOrderLike): boolean {
  return (
    !text(order.drug) &&
    Boolean(
      text(order.old_medicine_code) ||
        text(order.old_medicine_name) ||
        text(order.medication) ||
        text(order.medicine_no) ||
        text(order.trans_num) ||
        text(order.reference_no) ||
        text(order.written_frequency)
    )
  )
}

export function displayMedicationDrugName(order: MedicationOrderLike): string {
  return text(order.drug_name) || text(order.medication) || text(order.old_medicine_name) || '-'
}

function normalizeLegacyMedicineCode(value: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d+$/.test(trimmed)) {
    if (/^0+$/.test(trimmed)) return ''
    return trimmed.replace(/^0+/, '') || '0'
  }
  return trimmed
}

/** Best legacy item code for display: linked ITEM_00_01 name, without Oracle zero padding. */
function resolveLegacyMedicineDisplayCode(order: MedicationOrderLike): string {
  const linked = normalizeLegacyMedicineCode(text(order.old_medicine_code))
  if (linked) return linked
  return normalizeLegacyMedicineCode(text(order.medicine_no))
}

export function displayMedicationDrugCode(order: MedicationOrderLike): string {
  if (isLegacyMedicationOrderRow(order)) {
    return resolveLegacyMedicineDisplayCode(order) || '-'
  }
  const code = text(order.drug) || text(order.old_medicine_code) || text(order.medicine_no)
  return code || '-'
}

export function displayMedicationDosage(order: MedicationOrderLike): string {
  const instructions = text(order.instructions) || text(order.dose_notes)
  if (isLegacyMedicationOrderRow(order)) {
    return instructions || text(order.dosage) || text(order.strength) || '-'
  }
  return text(order.dosage) || instructions || text(order.strength) || '-'
}

/** Dosage with chosen UOM, e.g. ``3 mg``. Does not duplicate a unit already in the dosage text. */
export function formatDoseAndUom(dosage?: string | number | null, uom?: string | null): string {
  const dose = text(dosage)
  const unit = text(uom)
  if (!dose || dose === '-') return dose || '-'
  if (!unit) return dose
  if (dose.toLowerCase().includes(unit.toLowerCase())) return dose
  return `${dose} ${unit}`
}

export function displayMedicationDosageWithUom(order: MedicationOrderLike): string {
  return formatDoseAndUom(displayMedicationDosage(order), order.uom)
}

export function displayMedicationFrequency(order: MedicationOrderLike): string {
  return (
    text(order.patient_frequency) ||
    text(order.written_frequency) ||
    text(order.frequency) ||
    '-'
  )
}

export function displayMedicationStartDate(
  order: MedicationOrderLike,
  parentStartDate?: string | null
): string {
  return text(order.date) || text(order.start_date) || text(parentStartDate) || '-'
}

function orderLooksStopped(order: MedicationOrderLike): boolean {
  if (text(order.reason_stopped)) return true
  if (order.stopped === true || order.stopped === 1) return true
  if (text(order.medication_status) === 'Discontinued') return true
  if (text(order.stopped_date)) return true
  const effective = text(order.effective_status).toLowerCase()
  if (effective === 'stopped' || effective === 'discontinued') return true
  const status = text(order.status).toLowerCase()
  if (status === 'stopped' || status === 'discontinued') return true
  return false
}

/**
 * End date for listing: line end_date, else discontinue sources when stopped.
 * Do not parse comments/instructions — use real timestamps only:
 * stopped_date → discontinued_on (status log) → modified (approx).
 */
export function displayMedicationEndDate(
  order: MedicationOrderLike & { is_legacy?: boolean | null },
  parentEndDate?: string | null
): string {
  const lineEnd = text(order.end_date)
  if (lineEnd) return lineEnd
  if (orderLooksStopped(order)) {
    const stopped =
      text(order.stopped_date).slice(0, 10) ||
      text(order.discontinued_on).slice(0, 10) ||
      text(order.modified).slice(0, 10)
    if (stopped) return stopped
  }
  // Parent/header end date is only a fallback for legacy lines without a line end date.
  if (order.is_legacy || isLegacyMedicationOrderRow(order)) {
    return text(parentEndDate) || '-'
  }
  return '-'
}

export function displayMedicationRoute(order: MedicationOrderLike): string {
  return text(order.route_of_administration) || text(order.old_route) || '-'
}

/**
 * Practitioner column: prefer the doctor on the medication line, then parent Rx doctor, else user_name.
 *
 * Parent PMOs store the doctor on `practitioner` (and sometimes `healthcare_practitioner`).
 * Older lines may have neither set — fall back to the header doctor name/link.
 */
export function displayPrescriptionPractitioner(
  prescription: PrescriptionPractitionerLike,
  order?: MedicationOrderLike | null
): string {
  const lineHp = text(order?.healthcare_practitioner)
  if (lineHp) {
    return text(order?.healthcare_practitioner_name) || lineHp
  }
  const lineName = text(order?.healthcare_practitioner_name)
  if (lineName) return lineName

  const parentHp =
    text(prescription.healthcare_practitioner) || text(prescription.practitioner)
  if (parentHp) {
    return text(prescription.healthcare_practitioner_name) || parentHp
  }
  return (
    text(prescription.healthcare_practitioner_name) ||
    text(prescription.user_name) ||
    text(order?.username) ||
    '-'
  )
}

export function displayMedicationInstructions(order: MedicationOrderLike): string {
  return text(order.instructions)
}

function isMeaninglessInstructionDc(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v === '000' || v === '0'
}

/** Hover tooltip on medicine name: child-table instructions, then dc; otherwise none. */
export function displayMedicationInstructionTooltip(order: MedicationOrderLike): string {
  const instructions = text(order.instructions)
  if (instructions) return instructions

  const dc = text(order.dc)
  if (dc && !isMeaninglessInstructionDc(dc)) return dc
  return ''
}
