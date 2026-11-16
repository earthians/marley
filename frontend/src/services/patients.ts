import { frappeErrorMessage as parseFrappeError } from '../utils/frappeErrorMessage'

export interface PatientListItem {
  name: string
  patient_name: string
  file_number?: string
  mobile?: string
  email?: string
  sex?: string
  id_number?: string
  category?: string
  blood_group?: string
  nationality?: string
  has_insurance?: number | boolean
  is_black_list?: number | boolean
  blacklist_reason?: string | null
}

export interface PatientMedicalHistoryRow {
  attributes?: string
  yesno?: string
  description?: string
}

export type PatientLegacyHistoryEntry = {
  key: string
  label: string
  text: string
}

export type PatientLegacyMedicalHistory = {
  patient: string
  patient_name?: string
  has_data: boolean
  family_history?: string
  allergies?: string
  previous_disease_history?: string
  medical_history?: string
  medication?: string
  entries: PatientLegacyHistoryEntry[]
}

export interface PatientMedicalHistory {
  name?: string | null
  patient?: string
  patient_name?: string
  template?: string | null
  inpatient_admission?: string | null
  patient_visit?: string | null
  /** Active (default) | Inactive */
  status?: string
  creation?: string
  summary?: string
  heart_disease?: string
  diabetes?: string
  asthma?: string
  strokes?: string
  other_ongoing_illness?: string
  previous_surgical_history?: string
  current_and_past_medications?: string
  no_known_allergies?: number
  allergies?: string
  family_history?: string
  social_history?: string
  addiction?: number
  smoking?: number
  patient_history_details?: PatientMedicalHistoryRow[]
  legacy_from_patient?: PatientLegacyMedicalHistory | null
}

export interface PatientSummary {
  name: string
  patient_name: string
  file_no: string
  /** CPR / Passport / ID (falls back to National ID on patient record) */
  id_number?: string
  dob?: string
  sex?: string
  marital_status?: string
  mobile?: string
  category?: string
  is_blacklist?: number
  is_black_list?: number
  blacklist_reason?: string | null
  remarks?: string
  /** Patient Upload Document child table on Patient */
  documents?: (PatientDocumentRow & { name?: string; document_name?: string })[]
}

export async function searchPatients(query: string, limit?: number): Promise<PatientListItem[]> {
  const params = new URLSearchParams()
  params.append('search', query)
  if (limit) params.append('limit', limit.toString())
  
  const response = await fetch(
    `/api/method/healthcare.api.patient.search_patients?${params.toString()}`
  )
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as PatientListItem[]
  } else {
    return []
  }
}

/** Display label for navbar patient search after selection: "file no - patient name". */
export function formatPatientSearchLabel(
  patientName: string,
  fileNumber?: string | null,
  fallbackId?: string
): string {
  const name = (patientName || fallbackId || '').trim()
  const file = (fileNumber || '').trim()
  if (file && name) return `${file} - ${name}`
  return name || file
}

/** Resolve patient display name for search bar (works for Nurse and other portal roles). */
export async function fetchPatientDisplayName(
  patient: string
): Promise<{ name: string; patient_name: string; file_number?: string }> {
  const response = await fetch(
    `/api/method/healthcare.api.patient.get_patient_display_name?patient=${encodeURIComponent(patient)}`
  )
  const resData = await response.json()
  if (resData?.exc) {
    throw new Error(
      typeof resData.message === 'string' ? resData.message : 'Failed to load patient name'
    )
  }
  const msg = resData?.message as { name?: string; patient_name?: string; file_number?: string } | undefined
  return {
    name: msg?.name ?? patient,
    patient_name: msg?.patient_name ?? patient,
    file_number: msg?.file_number,
  }
}

export interface PaginatedPatients {
  data: PatientListItem[]
  total_count: number
  /** True when browse-all without search is denied (requires Data Officer role). */
  full_directory_restricted?: boolean
}

export async function fetchPatients(
  limit: number = 20,
  offset: number = 0,
  search?: string
): Promise<PatientListItem[]> {
  const result = await fetchPatientsPaginated(limit, offset, search)
  return result.data
}

/**
 * Fetch exactly one patient by ID.
 *
 * Never resolve a *selected* patient through `fetchPatients(…, search)`: `search` is a
 * fuzzy LIKE match over patient name / file no / ID number / mobile, so a patient ID
 * such as file no `862383` also matches an unrelated patient whose national ID contains
 * those digits — and the alphabetically-first hit (`ORDER BY patient_name`) is returned
 * instead of the selected patient. This helper uses the exact `patient` filter.
 */
export async function fetchPatientById(patient?: string): Promise<PatientListItem | undefined> {
  const id = (patient || '').trim()
  if (!id) return undefined
  const result = await fetchPatientsPaginated(1, 0, undefined, id)
  return result.data.find((row) => row.name === id)
}

export async function fetchPatientsPaginated(
  limit: number = 20,
  offset: number = 0,
  search?: string,
  /** Exact patient ID — returns only that record, bypassing fuzzy search. */
  patient?: string
): Promise<PaginatedPatients> {
  const params = new URLSearchParams()
  params.append('limit', limit.toString())
  params.append('offset', offset.toString())
  if (search) params.append('search', search)
  if (patient) params.append('patient', patient)

  const response = await fetch(
    `/api/method/healthcare.api.patient.get_patients?${params.toString()}`
  )
  const resData = await response.json()
  const msg = resData?.message

  if (msg && typeof msg === 'object' && 'data' in msg) {
    return {
      data: msg.data as PatientListItem[],
      total_count: msg.total_count ?? 0,
      full_directory_restricted: Boolean((msg as { full_directory_restricted?: unknown }).full_directory_restricted),
    }
  }
  if (msg && Array.isArray(msg)) {
    return { data: msg as PatientListItem[], total_count: msg.length }
  }
  return { data: [], total_count: 0 }
}


export interface PatientDocumentRow {
  file_name?: string
  document_type?: string
  transaction_no?: string
  upload_remarks?: string
  document?: string
  patient_relation?: string
  signee_name?: string
}

export interface CreatePatientData {
  // We primarily use patient_name (full name) but keep first/middle/last
  // for compatibility with existing server logic.
  first_name?: string
  middle_name?: string
  last_name?: string
  patient_name?: string
  sex: string
  dob?: string
  blood_group?: string
  mobile?: string
  mobile_no_owner?: string
  phone?: string
  email?: string
  id_number?: string
  nationality?: string
  category?: string
  source?: string
  marital_status?: string
  is_black_list?: boolean
  blacklist_reason?: string
  remarks?: string
  address_line1?: string
  address_line2?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  file_no?: string
  /** When true (default), create a Sales Order for the file number charge from Healthcare Settings. */
  charge_file_no?: boolean
  /** CPR ID front image (maps to Patient.cprigama_front_photo). */
  cpr_photo?: string
  /** CPR ID back image (maps to Patient.cprigama_back_photo). */
  cpr_photo_back?: string
  patient_document?: PatientDocumentRow[]
}

/** Ensure we have a CSRF token (e.g. when page was cached or token missing on /health). */
async function ensureUploadCSRFToken(): Promise<string | null> {
  let token = (window as any).csrf_token
  if (token) return token
  const base = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : ''
  try {
    const resp = await fetch(`${base}/api/method/frappe.sessions.get_csrf_token`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) return null
    const data = await resp.json().catch(() => ({} as any))
    token = data?.message ?? data?.data ?? null
    if (token) (window as any).csrf_token = token
    return token
  } catch {
    return null
  }
}

/** Upload a file as a public attachment so other users can view it. Returns file_url. */
export async function uploadPatientFile(file: File): Promise<string> {
  const csrf = await ensureUploadCSRFToken()
  const form = new FormData()
  form.append('file', file)
  if (csrf) form.append('csrf_token', csrf)

  // Use current origin so upload works on 127.0.0.1 and live (not only localhost)
  const base = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : ''
  const uploadUrl = `${base}/api/method/healthcare.api.common.upload_public_file`

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: csrf ? { 'X-Frappe-CSRF-Token': csrf } : {},
    body: form,
    credentials: 'include',
  })

  let data: any = {}
  try {
    data = await res.json()
  } catch {
    throw new Error(`Upload failed: server returned non-JSON (status ${res.status})`)
  }

  // Frappe surfaces exceptions as data.exc (stringified traceback).
  // data._server_messages or data.message may hold the user-facing reason.
  if (data?.exc) {
    let reason = 'Upload failed'
    try {
      // _server_messages is a JSON-encoded array of JSON-encoded objects
      const msgs = JSON.parse(data._server_messages || '[]')
      const first = JSON.parse(msgs[0] || '{}')
      reason = first?.message || data?.message || reason
    } catch {
      reason = data?.message || reason
    }
    throw new Error(reason)
  }

  if (!res.ok) {
    throw new Error(`Upload failed: HTTP ${res.status}`)
  }

  const doc = data?.message
  if (doc && typeof doc === 'object' && doc.file_url) return doc.file_url
  if (typeof doc === 'string' && doc.startsWith('/')) return doc

  throw new Error('Upload failed: no file URL in response')
}

export type CreatePatientResult = {
  name: string
  patient_name: string
  file_no: string
  /** Insurance Patient Register created (or linked) for an insured patient. */
  insurance_register?: string
  server_message?: string
  sales_order?: string
  file_no_charge_rate?: number
  file_no_charge_error?: string
}

export interface FileNoChargePreview {
  configured: boolean
  template?: string | null
  service_name?: string | null
  item_code?: string | null
  item_name?: string | null
  rate?: number
}

export async function fetchFileNoChargePreview(): Promise<FileNoChargePreview> {
  try {
    const response = await fetch(
      '/api/method/healthcare.api.patient_file_no_charge.get_file_no_charge_preview',
      { credentials: 'include' },
    )
    const resData = await response.json()
    if (resData?.message && typeof resData.message === 'object') {
      return resData.message as FileNoChargePreview
    }
  } catch {
    /* ignore */
  }
  return { configured: false, rate: 0 }
}

export interface PatientDuplicateCheck {
  duplicate: boolean
  patient?: { name: string; patient_name?: string; file_no?: string }
}

/** Check full name + mobile before creating a patient (category is not used). */
export async function checkPatientDuplicate(
  patient_name: string,
  mobile?: string,
  phone?: string,
  dob?: string,
): Promise<PatientDuplicateCheck> {
  const params = new URLSearchParams()
  params.append('patient_name', patient_name.trim())
  if (mobile?.trim()) params.append('mobile', mobile.trim())
  if (phone?.trim()) params.append('phone', phone.trim())
  if (dob?.trim()) params.append('dob', dob.trim())

  const response = await fetch(
    `/api/method/healthcare.api.patient.check_patient_duplicate?${params}`,
    { credentials: 'include' },
  )
  const resData = await response.json().catch(() => ({}))
  if (!response.ok || resData?.exc) {
    const msg = messageFromFrappeResponse(resData as Record<string, unknown>)
    throw new Error(msg || `Duplicate check failed (${response.status})`)
  }
  const msg = resData?.message
  if (msg && typeof msg === 'object') {
    return msg as PatientDuplicateCheck
  }
  return { duplicate: false }
}

export async function fetchNextPatientFileNo(): Promise<string | null> {
  try {
    const response = await fetch('/api/method/healthcare.api.patient.get_next_patient_file_no')
    const resData = await response.json()
    if (resData?.message && typeof resData.message === 'string') {
      return resData.message
    }
    return null
  } catch {
    return null
  }
}

export async function createPatient(data: CreatePatientData): Promise<CreatePatientResult> {
  const csrf = (window as any).csrf_token

  const csrfForCreate = csrf || (await (await import('./apiClient')).ensureCSRF())
  const response = await fetch('/api/method/healthcare.api.patient.create_patient', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(csrfForCreate ? { 'X-Frappe-CSRF-Token': csrfForCreate } : {})
    },
    body: JSON.stringify({ data }),
  })
  const resData = await response.json().catch(() => ({}))

  if (!response.ok || resData?.exc) {
    const msg = messageFromFrappeResponse(resData as Record<string, unknown>)
    throw new Error(msg || `Failed to create patient (${response.status})`)
  }

  const msg = resData?.message
  if (msg && typeof msg === 'object' && (msg as { name?: string }).name) {
    return msg as CreatePatientResult
  }
  if (msg && typeof msg === 'string' && msg.trim()) {
    return { name: '', patient_name: '', file_no: '', server_message: msg.trim() }
  }
  throw new Error(messageFromFrappeResponse(resData as Record<string, unknown>) || 'Invalid response format')
}

export interface PatientHealthHistoryTemplateOption {
  name: string
  label: string
  default?: number | boolean
}

export interface PatientHealthHistoryTemplateDetails {
  name: string
  template_name?: string
  patient_history_details: PatientMedicalHistoryRow[]
}

export interface PatientHealthHistoryTemplate2Row {
  history: string
  yes: number | boolean
  remarks: string
  no_format: number
  is_diabetic: number | boolean
  type: string
  specify?: number | boolean
  speficication?: string
}

export interface PatientHealthHistoryTemplate2Details {
  name: string
  templates: PatientHealthHistoryTemplate2Row[]
}

export async function fetchPatientHealthHistoryTemplates(
  search?: string
): Promise<PatientHealthHistoryTemplateOption[]> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  const url = `/api/method/healthcare.api.patient.get_patient_health_history_templates${params.toString() ? `?${params.toString()}` : ''}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data?.message && Array.isArray(data.message)) {
    return data.message as PatientHealthHistoryTemplateOption[]
  }
  return []
}

export async function fetchPatientHealthHistoryTemplateDetails(
  templateName: string
): Promise<PatientHealthHistoryTemplateDetails> {
  const params = new URLSearchParams({ template_name: templateName })
  const res = await fetch(
    `/api/method/healthcare.api.patient.get_patient_health_history_template_details?${params.toString()}`
  )
  const data = await res.json().catch(() => ({}))
  if (data?.message && typeof data.message === 'object') {
    return data.message as PatientHealthHistoryTemplateDetails
  }
  throw new Error(data?.exc || 'Failed to load template details')
}

export async function fetchPatientHealthHistoryTemplate2Options(
  search?: string
): Promise<PatientHealthHistoryTemplateOption[]> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  const url = `/api/method/healthcare.api.patient.get_patient_health_history_template_2_options${params.toString() ? `?${params.toString()}` : ''}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data?.message && Array.isArray(data.message)) {
    return data.message as PatientHealthHistoryTemplateOption[]
  }
  return []
}

export async function fetchPatientHealthHistoryTemplate2Details(
  templateName: string
): Promise<PatientHealthHistoryTemplate2Details> {
  const params = new URLSearchParams({ template_name: templateName })
  const res = await fetch(
    `/api/method/healthcare.api.patient.get_patient_health_history_template_2_details?${params.toString()}`
  )
  const data = await res.json().catch(() => ({}))
  if (data?.message && typeof data.message === 'object') {
    return data.message as PatientHealthHistoryTemplate2Details
  }
  throw new Error(data?.exc || 'Failed to load template details')
}

export async function fetchPatientMedicalHistory(patient: string): Promise<PatientMedicalHistory> {
  const response = await fetch(
    `/api/method/healthcare.api.patient.get_patient_medical_history?patient=${encodeURIComponent(patient)}`
  )
 
  const resData = await response.json()
  if (resData?.message) {
    return resData.message as PatientMedicalHistory
  } else {
    throw new Error('Invalid response format')
  }
}

export async function fetchPatientMedicalHistories(patient: string): Promise<{
  records: PatientMedicalHistory[]
  legacy_from_patient: PatientLegacyMedicalHistory | null
}> {
  const res = await fetch(
    `/api/method/healthcare.api.patient.get_patient_medical_histories?patient=${encodeURIComponent(patient)}`
  )
  const data = await res.json()
  const message = data?.message
  if (Array.isArray(message)) {
    return { records: message as PatientMedicalHistory[], legacy_from_patient: null }
  }
  if (message && typeof message === 'object') {
    return {
      records: Array.isArray(message.records) ? (message.records as PatientMedicalHistory[]) : [],
      legacy_from_patient: (message.legacy_from_patient as PatientLegacyMedicalHistory | null) || null,
    }
  }
  return { records: [], legacy_from_patient: null }
}

/** Mark a past medical history record Active / Inactive (allowed even on closed visits). */
export async function setPatientMedicalHistoryStatus(
  name: string,
  status: 'Active' | 'Inactive',
): Promise<void> {
  const csrf = (window as any).csrf_token || (await (await import('./apiClient')).ensureCSRF())
  const res = await fetch(`/api/resource/Patient%20Medical%20History/${encodeURIComponent(name)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ status }),
  })
  const out = await res.json().catch(() => ({} as any))
  if (!res.ok || out?.exc) {
    const { messageFromFrappeResponse } = await import('./patients')
    throw new Error(messageFromFrappeResponse(out as any) || 'Failed to update status')
  }
}

export async function fetchPatientMedicalHistoryDetail(name: string): Promise<PatientMedicalHistory> {
  const res = await fetch(
    `/api/method/healthcare.api.patient.get_patient_medical_history_detail?name=${encodeURIComponent(name)}`
  )
  const data = await res.json()
  if (data?.exc_type) throw new Error(data?.message || 'Failed to load')
  return data.message as PatientMedicalHistory
}

export async function savePatientMedicalHistory(
  history: PatientMedicalHistory
): Promise<PatientMedicalHistory> {
  const payload: any = {
    patient: history.patient,
    patient_name: history.patient_name,
    template: history.template || null,
    inpatient_admission: history.inpatient_admission || null,
    patient_visit: history.patient_visit || null,
    status: history.status || 'Active',
    heart_disease: history.heart_disease || '',
    diabetes: history.diabetes || '',
    asthma: history.asthma || '',
    strokes: history.strokes || '',
    other_ongoing_illness: history.other_ongoing_illness || '',
    previous_surgical_history: history.previous_surgical_history || '',
    current_and_past_medications: history.current_and_past_medications || '',
    no_known_allergies: history.no_known_allergies ? 1 : 0,
    allergies: history.allergies || '',
    social_history: history.social_history || '',
    addiction: history.addiction ? 1 : 0,
    smoking: history.smoking ? 1 : 0,
    patient_history_details: (history.patient_history_details || []).map(row => ({
      attributes: row.attributes,
      yesno: row.yesno,
      description: row.description,
    })),
  }

  const csrf = (window as any).csrf_token || (await (await import('./apiClient')).ensureCSRF())
  const isUpdate = history.name && typeof history.name === 'string' && history.name.trim().length > 0
  const url = isUpdate
    ? `/api/resource/Patient%20Medical%20History/${encodeURIComponent(history.name!)}`
    : '/api/resource/Patient%20Medical%20History'

  const method = isUpdate ? 'PUT' : 'POST'

  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(payload),
  })

  const out = await res.json().catch(() => ({} as any))

  if (!res.ok || out?.exc) {
    const { messageFromFrappeResponse } = await import('./patients')
    const msg = messageFromFrappeResponse(out as any) || 'Failed to save patient medical history'
    throw new Error(msg)
  }

  const data = out.data || out.message || out
  return {
    name: data.name ?? history.name ?? null,
    patient: data.patient ?? history.patient,
    patient_name: data.patient_name ?? history.patient_name,
    template: data.template ?? history.template,
    inpatient_admission: data.inpatient_admission ?? history.inpatient_admission,
    creation: data.creation ?? history.creation,
    heart_disease: data.heart_disease ?? history.heart_disease,
    diabetes: data.diabetes ?? history.diabetes,
    asthma: data.asthma ?? history.asthma,
    strokes: data.strokes ?? history.strokes,
    other_ongoing_illness: data.other_ongoing_illness ?? history.other_ongoing_illness,
    previous_surgical_history: data.previous_surgical_history ?? history.previous_surgical_history,
    current_and_past_medications:
      data.current_and_past_medications ?? history.current_and_past_medications,
    no_known_allergies: data.no_known_allergies ?? history.no_known_allergies,
    allergies: data.allergies ?? history.allergies,
    patient_visit: data.patient_visit ?? history.patient_visit,
    social_history: data.social_history ?? history.social_history,
    addiction: data.addiction ?? history.addiction,
    smoking: data.smoking ?? history.smoking,
    patient_history_details:
      data.patient_history_details?.map((row: any) => ({
        attributes: row.attributes,
        yesno: row.yesno,
        description: row.description,
      })) || history.patient_history_details || [],
  }
}

export async function fetchPatientSummary(patient: string): Promise<PatientSummary> {
  const response = await fetch(
    `/api/method/healthcare.api.patient.get_patient_summary?patient=${encodeURIComponent(patient)}`
  )
  const resData = await response.json()

  if (resData?.message) {
    return resData.message as PatientSummary
  } else {
    throw new Error('Invalid response format')
  }
}

/** Summary stats for Patient History page: visits, admissions, invoices, unbilled, amount to pay */
export interface PatientHistorySummary {
  visit_count: number
  admission_count: number
  /** When false, billing figures are omitted (user lacks billing roles). */
  billing_summary_allowed?: boolean
  paid_invoice_count?: number
  paid_invoice_total?: number
  unbilled_count?: number
  amount_to_pay?: number
}

export async function fetchPatientHistorySummary(patient: string): Promise<PatientHistorySummary> {
  const response = await fetch(
    `/api/method/healthcare.api.patient.get_patient_history_summary?patient=${encodeURIComponent(patient)}`
  )
  const resData = await response.json()

  if (resData?.message) {
    return resData.message as PatientHistorySummary
  }
  throw new Error(resData?.exc || 'Invalid response format')
}

/** Full Patient doc for edit form (from Frappe REST). */
interface PatientDocument {
  document_type?: string
  document_name?: string
  attachment?: string
}

export interface PatientInsuranceCoverageRow {
  name?: string
  health_insurance?: string
  insurance_register?: string
  insurance_type?: string
  insurance_company_no?: string
  insurance_policy_no?: string
  ref_no?: string
  insurance_valid_till?: string | null
  insurance_expiry_date?: string | null
  insurance_work_place?: string
  insurance_isdn_no?: string
  insurance_deduction_amount?: string | number | null
  insurance_special_note?: string
  employee_code?: string
  is_active?: number
}

export interface PatientDoc {
  name: string
  patient_name?: string
  file_no?: string
  first_name?: string
  middle_name?: string
  last_name?: string
  sex?: string
  dob?: string
  blood_group?: string
  mobile?: string
  mobile_no_owner?: string
  phone?: string
  email?: string
  id_number?: string
  nationality?: string
  category?: string
  source?: string
  marital_status?: string
  is_black_list?: number
  blacklist_reason?: string | null
  remarks?: string
  patient_primary_address?: string
  address?: string
  city?: string
  country?: string
  insurance_policy?: string
  ref_no?: string
  insurance_register?: string
  has_insurance?: number
  title?: string
  insurance?:string
  insurance_company_no?: string
  job_title?: string
  job_company?: string
  company?: string
  alternative_mobile_no_1?: string
  alternative_mobile_no_2?: string
  alternative_email?: string
  patient_relation?: string
  patient_relation_name?: string
  insurance_type?: string
  patient_document?: PatientDocument[]
  cpr_photo?: string | null
  cpr_photo_back?: string | null
  patient_insurance_coverages?: PatientInsuranceCoverageRow[]
}

/** Address doc (for edit form). */
export interface AddressDoc {
  name: string
  address_line1?: string
  address_line2?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
}

export async function fetchPatientDoc(name: string): Promise<PatientDoc> {
  const res = await fetch(
    `/api/method/healthcare.api.patient.get_patient_doc?patient=${encodeURIComponent(name)}`,
    { credentials: 'include' },
  )
  const data = await res.json().catch(() => ({}))
  if (data?.exc) {
    throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load patient')
  }
  if (data?.message && typeof data.message === 'object') {
    return data.message as PatientDoc
  }
  throw new Error(messageFromFrappeResponse(data as Record<string, unknown>) || 'Failed to load patient')
}

export async function fetchAddressDoc(name: string): Promise<AddressDoc | null> {
  const res = await fetch(`/api/resource/Address/${encodeURIComponent(name)}`)
  const data = await res.json()
  if (data?.data) return data.data as AddressDoc
  return null
}

export type PatientAddressForEdit = Omit<AddressDoc, 'name'> & {
  name?: string | null
}

export async function fetchPatientAddress(patientName: string): Promise<PatientAddressForEdit> {
  const res = await fetch(
    `/api/method/healthcare.api.patient.get_patient_address?patient=${encodeURIComponent(patientName)}`,
    { credentials: 'include' },
  )
  const data = await res.json()
  if (data?.exc) {
    throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load patient address')
  }
  return (data?.message ?? {}) as PatientAddressForEdit
}

export async function savePatientAddress(
  patientName: string,
  address: Partial<AddressDoc>,
): Promise<{ name?: string | null }> {
  const csrf = (window as any).csrf_token
  const res = await fetch('/api/method/healthcare.api.patient.save_patient_address', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ patient: patientName, data: address }),
    credentials: 'include',
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.exc) {
    const msg = messageFromFrappeResponse(out as Record<string, unknown>)
    throw new Error(msg || `Failed to save patient address (${res.status})`)
  }
  return (out?.message ?? {}) as { name?: string | null }
}

interface PatientRelation{
  full_name?:string 
  email?:string
  description?:string
  is_next_of_kin?:number 
  mobile_no?:string 

}
export interface UpdatePatientData {
  patient_name?: string
  first_name?: string
  file_no?:string
  middle_name?: string
  last_name?: string
  sex?: string
  dob?: string
  blood_group?: string
  mobile?: string
  mobile_no_owner?: string
  phone?: string
  email?: string
  id_number?: string
  nationality?: string
  category?: string
  source?: string
  marital_status?: string
  is_black_list?: number
  blacklist_reason?: string | null
  remarks?: string
  title?: string
    insurance_policy?: string
  ref_no?: string
  insurance_register?: string
  has_insurance?: number
  insurance?:string
  insurance_company_no?: string
  job_title?: string
  job_company?: string
  company?: string
  alternative_mobile_no_1?: string
  alternative_mobile_no_2?: string
  alternative_email?: string
  patient_relation?: PatientRelation[]
  patient_relation_name?: string
  insurance_type?: string
  patient_document?: PatientDocument[]
  cpr_photo?: string | null
  cpr_photo_back?: string | null
  patient_insurance_coverages?: PatientInsuranceCoverageRow[]
}

/** Extract user-facing message from Frappe error response (REST / method). */
export function messageFromFrappeResponse(out: Record<string, unknown>): string {
  return parseFrappeError(out, '')
}

/** On success, may return the server message (e.g. "Customer X updated"). */
export async function updatePatientDoc(patientName: string, data: UpdatePatientData): Promise<{ message?: string }> {
  const csrf = (window as any).csrf_token || (await (await import('./apiClient')).ensureCSRF())
  const res = await fetch('/api/method/healthcare.api.patient.update_patient', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ patient: patientName, data }),
    credentials: 'include',
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.exc) {
    const msg = messageFromFrappeResponse(out as Record<string, unknown>)
    throw new Error(msg || `Failed to update patient (${res.status})`)
  }
  const message = typeof (out as { message?: string }).message === 'string' ? (out as { message: string }).message : undefined
  return { message }
}

export async function setPatientBlacklist(
  patientName: string,
  isBlackList: boolean,
  reason?: string,
): Promise<{ is_black_list: number; blacklist_reason?: string | null }> {
  const csrf = (window as any).csrf_token || (await (await import('./apiClient')).ensureCSRF())
  const res = await fetch('/api/method/healthcare.api.patient.set_patient_blacklist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({
      patient: patientName,
      is_black_list: isBlackList ? 1 : 0,
      blacklist_reason: reason || '',
    }),
    credentials: 'include',
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.exc) {
    const msg = messageFromFrappeResponse(out as Record<string, unknown>)
    throw new Error(msg || `Failed to update blacklist (${res.status})`)
  }
  const message = (out as { message?: { is_black_list?: number; blacklist_reason?: string | null } }).message
  return {
    is_black_list: message?.is_black_list ? 1 : 0,
    blacklist_reason: message?.blacklist_reason ?? null,
  }
}

export async function updateAddressDoc(addressName: string, data: Partial<AddressDoc>): Promise<void> {
  const csrf = (window as any).csrf_token
  const res = await fetch(`/api/resource/Address/${encodeURIComponent(addressName)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
    },
    body: JSON.stringify(data),
    credentials: 'include'
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.exc) {
    const msg = messageFromFrappeResponse(out as Record<string, unknown>)
    throw new Error(msg || `Failed to update address (${res.status})`)
  }
}
