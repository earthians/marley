import { messageFromExc } from './appointments'

export type InjectionSide = 'LT' | 'RT'

export interface LongActingMedicineGiveOutRow {
  name?: string
  date?: string
  time?: string
  user?: string
  scheduled_run_date?: string
  notes?: string
  trans_no?: string
  dose?: string
  dose_term?: string
  medication?: string
  written_frequency?: string
  is_cancelled?: number | boolean
  cancelled_notes?: string
  nurse_flag?: string
  next_dose?: string
  lt_flag?: string
  rt_flag?: string
}

export { cutGiveOutGiverName, resolveGiveOutGivenBy } from './giveOutGivenBy'

export function formatInjectionSide(value?: string | null): string {
  if (value === 'LT') return 'Left (L)'
  if (value === 'RT') return 'Right (R)'
  return '—'
}

export function formatInjectionSideShort(value?: string | null): string {
  if (value === 'LT') return 'L'
  if (value === 'RT') return 'R'
  return '—'
}

export function injectionSideFromGiveOut(
  row: LongActingMedicineGiveOutRow,
): InjectionSide | undefined {
  const lt = (row.lt_flag || '').trim()
  const rt = (row.rt_flag || '').trim()
  if (lt && lt !== '0' && lt.toLowerCase() !== 'n') return 'LT'
  if (rt && rt !== '0' && rt.toLowerCase() !== 'n') return 'RT'
  return undefined
}

export function suggestedNextInjectionSide(last?: string | null): InjectionSide {
  if (last === 'LT') return 'RT'
  if (last === 'RT') return 'LT'
  return 'LT'
}

export interface LongActingMedicineRow {
  name: string
  patient?: string
  patient_name?: string
  frequency?: string
  start_date?: string
  end_date?: string
  next_run_date?: string
  status?: string
  remarks?: string
  drug_name?: string
  medication_label?: string
  default_dosage?: string
  default_uom?: string
  default_dosage_form?: string
  practitioner?: string
  practitioner_name?: string
  doctors_remark?: string
  medications?: LongActingMedicineItem[]
  give_outs?: LongActingMedicineGiveOutRow[]
  last_give_out_date?: string
  last_give_out_time?: string
  last_give_out_by?: string
  is_given_out_for_current_run?: boolean
  can_give_out?: boolean
  /** Due for next cycle after first give-out — doctor must Duplicate a new order. */
  can_duplicate_for_next_run?: boolean
  can_stop?: boolean
  injection_given_on?: InjectionSide | string
}

export interface LongActingMedicineItem {
  name?: string
  drug?: string
  drug_name?: string
  dosage?: number | string
  dosage_form?: string
  uom?: string
  instructions?: string
  patient_frequency?: string
  qty_per_cycle?: number | string
  is_active?: number | boolean
  old_med_no?: string
  old_medication_name?: string
}

/** Display dose with Unit of Measure, e.g. "5 Nos" / "1 UNIT". */
export function formatLongActingDose(
  dosage?: number | string | null,
  uom?: string | null,
): string {
  const dose =
    dosage == null || dosage === '' || Number(dosage) === 0
      ? ''
      : String(dosage).replace(/\.0$/, '').trim()
  const unit = (uom || '').trim()
  if (dose && unit) return `${dose} ${unit}`
  if (dose) return dose
  if (unit) return unit
  return ''
}

export async function fetchLongActingMedicine(name: string): Promise<LongActingMedicineRow> {
  const params = new URLSearchParams({ name })
  const res = await fetch(
    `/api/method/healthcare.api.common.get_long_acting_medicine?${params.toString()}`
  )
  const data = await res.json()
  if (data?.exc || data?.exc_type) throw new Error(data?.message || 'Failed to load long acting medicine')
  return (data?.message || {}) as LongActingMedicineRow
}

export async function fetchLongActingMedicineGiveOuts(
  name: string,
): Promise<LongActingMedicineGiveOutRow[]> {
  const params = new URLSearchParams({ name })
  const res = await fetch(
    `/api/method/healthcare.healthcare.doctype.long_acting_medicine.long_acting_medicine.get_long_acting_medicine_give_outs?${params.toString()}`,
  )
  const data = await res.json()
  if (data?.exc || data?.exc_type) {
    throw new Error(data?.message || 'Failed to load give-outs')
  }
  return Array.isArray(data?.message) ? (data.message as LongActingMedicineGiveOutRow[]) : []
}

/** Merged give-out history across long-acting medicines (latest first). */
export interface LongActingGiveOutHistoryRow extends LongActingMedicineGiveOutRow {
  medicine?: string
  medicine_label?: string
  patient?: string
  patient_name?: string
}

export async function fetchLongActingGiveOutsForPatient(
  patient?: string,
): Promise<LongActingGiveOutHistoryRow[]> {
  const params = new URLSearchParams()
  if (patient) params.append('patient', patient)
  const res = await fetch(
    `/api/method/healthcare.healthcare.doctype.long_acting_medicine.long_acting_medicine.get_long_acting_give_outs_for_patient?${params.toString()}`,
  )
  const data = await res.json()
  if (data?.exc || data?.exc_type) {
    throw new Error(data?.message || 'Failed to load give-out history')
  }
  return Array.isArray(data?.message) ? (data.message as LongActingGiveOutHistoryRow[]) : []
}

export type ReminderChannel = 'email' | 'whatsapp' | 'sms'

export interface LongActingWhatsAppTemplateOption {
  name: string
  template_name: string
  actual_name?: string
  purpose?: string
  header_type?: string
  header_text?: string
  body_text?: string
  footer_text?: string
  field_names?: string
  language_code?: string
  variable_count?: number
}

export interface LongActingWhatsAppPreview {
  name?: string
  patient?: string
  patient_name?: string
  phone_number: string
  country?: string
  country_isd?: string
  templates: LongActingWhatsAppTemplateOption[]
  selected_template: string | null
  parameters: string[]
  preview: {
    header: string
    body: string
    footer: string
    template_name?: string
    actual_name?: string
  } | null
  selected?: LongActingWhatsAppTemplateOption | null
}

export async function getLongActingMedicineWhatsAppPreview(
  name: string,
  templateName?: string,
): Promise<LongActingWhatsAppPreview> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const res = await fetch(
    '/api/method/healthcare.api.common.get_long_acting_medicine_whatsapp_preview',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({
        name,
        ...(templateName ? { template_name: templateName } : {}),
      }),
    },
  )
  const data = await res.json()
  if (data?.exc) throw new Error(messageFromExc(data.exc, data.exc_type))
  return data?.message as LongActingWhatsAppPreview
}

export async function sendLongActingMedicineReminder(
  name: string,
  channel: ReminderChannel = 'email',
  options?: {
    phone_number?: string
    template_name?: string
    template_parameters?: string | string[]
  },
): Promise<{ sent: boolean; channel: string }> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const res = await fetch(
    '/api/method/healthcare.api.common.send_long_acting_medicine_reminder',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({
        name,
        channel,
        ...(options?.phone_number ? { phone_number: options.phone_number } : {}),
        ...(options?.template_name ? { template_name: options.template_name } : {}),
        ...(options?.template_parameters != null
          ? { template_parameters: options.template_parameters }
          : {}),
      }),
    },
  )
  const data = await res.json()
  if (data?.exc) throw new Error(messageFromExc(data.exc, data.exc_type) || data?.message || 'Failed to send reminder')
  return (data?.message as { sent: boolean; channel: string }) || { sent: true, channel }
}

export async function updateLongActingMedicineRemarks(
  name: string,
  remarks: string
): Promise<{ name: string; remarks: string }> {
  const { ensureCSRF, parseFrappeErrorPayload } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const res = await fetch(
    '/api/method/healthcare.api.common.update_long_acting_medicine_remarks',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ name, remarks }),
    }
  )
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok || data?.exc) {
    throw new Error(
      parseFrappeErrorPayload(data) ||
        messageFromExc(data?.exc, data?.exc_type) ||
        (typeof data?.message === 'string' ? data.message : '') ||
        'Failed to update remarks',
    )
  }
  return (data?.message as { name: string; remarks: string }) || { name, remarks }
}

export interface LongActingMedicineDoseUpdate {
  /** Child row name (Subscription Medication Plan Item). */
  name: string
  dosage?: number | string
  /** Unit of Measure for the dose. Blank falls back to the linked prescription / Item UOM. */
  uom?: string
}

export interface LongActingMedicineUpdateValues {
  frequency?: string
  start_date?: string
  end_date?: string
  next_run_date?: string
  status?: string
  injection_given_on?: string
  remarks?: string
  doctors_remark?: string
  /** Plan-item dose and unit overrides. */
  medications?: LongActingMedicineDoseUpdate[]
}

/** Update editable header fields (schedule, status, side, notes, dose) from the edit modal. */
export async function updateLongActingMedicine(
  name: string,
  values: LongActingMedicineUpdateValues,
): Promise<LongActingMedicineRow> {
  const { ensureCSRF, parseFrappeErrorPayload } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const res = await fetch(
    '/api/method/healthcare.api.common.update_long_acting_medicine',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ name, values }),
    }
  )
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok || data?.exc) {
    throw new Error(
      parseFrappeErrorPayload(data) ||
        messageFromExc(data?.exc, data?.exc_type) ||
        (typeof data?.message === 'string' ? data.message : '') ||
        'Failed to update long acting medicine',
    )
  }
  return (data?.message || {}) as LongActingMedicineRow
}

export async function fetchLongActingMedicineList(
  patient: string,
  limit: number = 50,
  offset: number = 0
): Promise<LongActingMedicineRow[]> {
  const params = new URLSearchParams()
  params.set('patient', patient)
  params.set('limit', limit.toString())
  params.set('offset', offset.toString())
  const res = await fetch(
    `/api/method/healthcare.api.common.get_long_acting_medicine_list?${params.toString()}`
  )
  const data = await res.json()
  if (data?.exc) {
    throw new Error(data?.message || 'Failed to fetch long acting medicine list')
  }
  const rows = Array.isArray(data?.message) ? (data.message as LongActingMedicineRow[]) : []
  // Show latest first — sort by start date (then next-due) descending.
  const ts = (d?: string) => (d ? new Date(d).getTime() || 0 : 0)
  return rows
    .slice()
    .sort((a, b) => (ts(b.start_date) - ts(a.start_date)) || (ts(b.next_run_date) - ts(a.next_run_date)))
}

export async function recordLongActingMedicineGiveOut(
  name: string,
  notes?: string,
  dose?: string,
  doseTerm?: string,
  injectionGivenOn?: InjectionSide,
): Promise<LongActingMedicineRow> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const res = await fetch(
    '/api/method/healthcare.healthcare.doctype.long_acting_medicine.long_acting_medicine.record_long_acting_medicine_give_out',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({
        name,
        notes: notes || undefined,
        dose: dose !== undefined ? dose : undefined,
        dose_term: doseTerm !== undefined ? doseTerm : undefined,
        injection_given_on: injectionGivenOn || undefined,
      }),
      credentials: 'include',
    },
  )
  const data = await res.json()
  if (data?.exc) throw new Error(data?.message || 'Failed to record give-out')
  return (data?.message || {}) as LongActingMedicineRow
}

export async function stopLongActingMedicine(
  name: string,
  reason?: string,
): Promise<LongActingMedicineRow> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const res = await fetch(
    '/api/method/healthcare.healthcare.doctype.long_acting_medicine.long_acting_medicine.stop_long_acting_medicine',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ name, reason: reason || undefined }),
      credentials: 'include',
    },
  )
  const data = await res.json()
  if (data?.exc) throw new Error(data?.message || 'Failed to stop long acting medicine')
  return (data?.message || {}) as LongActingMedicineRow
}
