export interface SickLeaveRow {
  name: string
  admission_no: string | null
  patient: string | null
  patient_name: string | null
  from_date: string | null
  to_date: string | null
  days: string | null
  diagnosis: string | null
  /** Healthcare Practitioner id */
  doctor: string | null
  /** Display name for doctor */
  doctor_name?: string | null
  source: string | null
  cost_center?: string | null
  patient_visit?: string | null
  /** Flag fields — Check (0/1) on Patient Sick Leave */
  sick_flag?: number
  fit_flag?: number
  unfit_flag?: number
  light_duty?: number
  needs_flag?: number
  acc_patient?: number
  patient_needs?: number
  employees_care?: number
  creation: string
}

export interface CreateSickLeaveInput {
  admission_no?: string
  patient?: string
  patient_name?: string
  from_date: string
  to_date?: string
  days?: string
  diagnosis?: string
  doctor?: string
  doctor_name?: string
  source?: string
  sr_no?: string
  branch?: string
  /** Cost Center (UI label is Branch) */
  cost_center?: string
  patient_visit?: string
  /** Flag fields — Patient Sick Leave stores as Check (1/0) */
  sick_flag?: number
  fit_flag?: number
  unfit_flag?: number
  light_duty?: number
  needs_flag?: number
  acc_patient?: number
}

export interface UpdateSickLeaveInput extends CreateSickLeaveInput {
  name: string
}

export interface SickLeaveFilters {
  search?: string
  dateFrom?: string
  dateTo?: string
  doctor?: string
}

export async function fetchSickLeaves(
  patient?: string,
  page = 1,
  pageSize = 50,
  filters: SickLeaveFilters = {}
): Promise<SickLeaveRow[]> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (patient) params.set('patient', patient)
  if (filters.search) params.set('search', filters.search)
  if (filters.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters.dateTo) params.set('date_to', filters.dateTo)
  if (filters.doctor) params.set('doctor', filters.doctor)

  const res = await fetch(`/api/method/healthcare.api.common.get_sick_leaves?${params}`)
  const data = await res.json()
  const msg = data?.message
  if (msg?.success) return msg.data as SickLeaveRow[]
  if (Array.isArray(msg)) return msg as SickLeaveRow[]
  throw new Error(msg?.message || data?.exc || 'Failed to load sick leave records')
}

export async function createSickLeave(
  input: CreateSickLeaveInput
): Promise<{ success: boolean; name?: string; message?: string }> {
  const csrfToken = (window as unknown as Record<string, string>).csrf_token || ''
  const res = await fetch('/api/method/healthcare.api.common.create_sick_leave', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ data: JSON.stringify(input) }),
  })
  const data = await res.json()
  return data?.message ?? { success: false, message: 'Unknown error' }
}

export async function updateSickLeave(
  input: UpdateSickLeaveInput
): Promise<{ success: boolean; name?: string; message?: string }> {
  const csrfToken = (window as unknown as Record<string, string>).csrf_token || ''
  const res = await fetch('/api/method/healthcare.api.common.update_sick_leave', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ data: JSON.stringify(input) }),
  })
  const data = await res.json()
  return data?.message ?? { success: false, message: 'Unknown error' }
}
