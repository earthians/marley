import { apiRequest } from './apiClient'
import { ensureCSRF } from './apiClient'

export interface LinkFieldOption {
  name: string
  label: string
  /** Healthcare Practitioner display helpers */
  practitioner_name?: string
  practitioner_id?: string
  /** Diagnosis master (get_diagnosis): ICD-style no / group for display */
  disease_no?: string
  diagnosis_name?: string
  diagnosis_group_name?: string
  department?: string
  /** Lab Test Template: 1 = group template, 0 = single test */
  is_group?: number | boolean
  medical_role?: string
  item_code?: string
  /** Prescription drug (get_prescription_items): scientific / generic name of the drug */
  scientific_name?: string
  /** Patient Visit (get_patient_visits): visit status (Open/Ordered/Completed/Cancelled) */
  status?: string
  /** Appointment Type: default slot length in minutes */
  default_duration?: number
  /** Appointment Type: 1 when marked Default in master */
  default?: number | boolean
  item_group?: string
  stock_uom?: string
  /** Inpatient Admission / Patient Visit branch when returned by care-episode list APIs */
  cost_center?: string
  /** From Item.custom_route_of_administration when present — prefills prescription route */
  default_route_of_administration?: string
  /** From Item.custom_pharmaceutical_form when present — prefills prescription dosage form */
  pharmaceutical_form?: string
  /** Prescription drug: item group (or ancestor) has Item Group.custom_is_pink */
  is_pink?: boolean
  code_value?: string
  country?: string
  /** Healthcare Service Unit Type: room price multiplier */
  room_multiplier?: number
  /** Prescription Frequency: "How Many Times a Day?" (BD = 2) */
  frequency_in_a_day?: number
  /** Dose Frequency: number of days the period covers (Per Week → 7) */
  days?: number
}

export interface ChecklistItem {
  name: string
  action_required: string
  department: string
  department_label?: string
  department_2?: string
  department_2_label?: string
  department_3?: string
  department_3_label?: string
  user: string
  name1: string
  date_time: string
  click: boolean
  description?: string
  sr_num?: string
}

export async function fetchPrintFormats(doctype: string): Promise<string[]> {
  if (!doctype) return ['Standard']
  const response = await fetch(
    `/api/method/healthcare.api.common.get_print_formats?doctype=${encodeURIComponent(doctype)}`
  )
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    const formats = resData.message as string[]
    // Notes: never offer Frappe's built-in Standard print format in the UI.
    if (doctype === 'Clinical Note' || doctype === 'Main Nursing Note') {
      return formats.filter((f) => (f || '').trim().toLowerCase() !== 'standard')
    }
    return formats
  }
  if (doctype === 'Clinical Note' || doctype === 'Main Nursing Note') return []
  return ['Standard']
}

export async function fetchUoms(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_uoms${params.toString() ? `?${params.toString()}` : ''}`
  try {
    const response = await fetch(url, { credentials: 'include' })
    const resData = await response.json()
    return Array.isArray(resData?.message) ? resData.message : []
  } catch { return [] }
}

export async function fetchStandardUoms(
  search?: string,
  options?: { medicalOnly?: boolean }
): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (options?.medicalOnly) params.append('medical_only', '1')
  const url = `/api/method/healthcare.api.common.get_standard_uoms${params.toString() ? `?${params.toString()}` : ''}`
  try {
    const response = await fetch(url, { credentials: 'include' })
    const resData = await response.json()
    return Array.isArray(resData?.message) ? resData.message : []
  } catch { return [] }
}

export async function fetchColors(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_colors${params.toString() ? `?${params.toString()}` : ''}`
  try {
    const response = await fetch(url, { credentials: 'include' })
    const resData = await response.json()
    return Array.isArray(resData?.message) ? resData.message : []
  } catch { return [] }
}

export async function fetchMedicalDepartments(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_medical_departments${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}


export async function fetchAnaesthesiaTypes(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_anaesthesia_types${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }
  return []
}

export async function fetchHealthcarePractitioners(
  search?: string,
  department?: string,
  opts?: { appointmentOnly?: boolean; consultantsOnly?: boolean },
): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (department) params.append('department', department)
  if (opts?.appointmentOnly) params.append('appointment_only', '1')
  if (opts?.consultantsOnly) params.append('consultants_only', '1')

  const url = `/api/method/healthcare.api.common.get_healthcare_practitioners${params.toString() ? `?${params.toString()}` : ''}`

  const response = await fetch(url)
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

/** Active practitioners with Appointment checked — for appointment doctor filters/forms. */
export async function fetchAppointmentPractitioners(
  search?: string,
  department?: string,
): Promise<LinkFieldOption[]> {
  return fetchHealthcarePractitioners(search, department, { appointmentOnly: true })
}

export async function fetchPractitionerLabReviewFlags(practitioner: string): Promise<{
  gp_doctor: boolean
  consultants: boolean
  medical_role?: string | null
}> {
  const params = new URLSearchParams({ practitioner })
  const response = await fetch(
    `/api/method/healthcare.api.common.get_practitioner_lab_review_flags?${params.toString()}`,
  )
  const resData = await response.json()
  const msg = resData?.message
  if (msg && typeof msg === 'object') {
    return {
      gp_doctor: Boolean(msg.gp_doctor),
      consultants: Boolean(msg.consultants),
      medical_role: msg.medical_role,
    }
  }
  return { gp_doctor: false, consultants: false }
}

/** Discharge form: practitioners with Medical Role Nurse or parent Medical Role Nurse. */
export async function fetchDischargeNursePractitioners(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_discharge_nurse_practitioners${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }
  return []
}

/** Discharge form: practitioners who are not nurses. */
export async function fetchDischargeDoctorPractitioners(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_discharge_doctor_practitioners${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }
  return []
}

/**
 * Doctors only: active Healthcare Practitioners whose Medical Role is under the
 * "Doctor" parent group (Doctor / CEO / Consultant / Doctors GP, etc.).
 * Use for the "Doctor" filter dropdowns and doctor auto-fill on create forms.
 */
export async function fetchDoctorPractitioners(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_doctor_practitioners${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url, { credentials: 'include' })
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }
  return []
}

/**
 * If the logged-in user is a doctor (their linked Healthcare Practitioner's Medical Role
 * is under the "Doctor" group), returns that practitioner name for auto-fill; else null.
 */
export async function getCurrentUserDoctor(): Promise<string | null> {
  try {
    const response = await fetch('/api/method/healthcare.api.common.get_current_user_doctor', {
      credentials: 'include',
    })
    const resData = await response.json()
    if (resData?.message && typeof resData.message === 'string') {
      return resData.message as string
    }
    return null
  } catch (err) {
    console.error('Failed to fetch current user doctor:', err)
    return null
  }
}

/** Practitioners with Medical Role Lab Technologist or Lab Technician (active only). */
export async function fetchLabTechnicianPractitioners(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_lab_technician_practitioners${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url, { credentials: 'include' })
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }
  return []
}

/**
 * Current user's linked Healthcare Practitioner when Medical Role is Lab Technician
 * or Lab Technologist. Used to auto-pick lab technician on result entry.
 */
export async function getCurrentUserLabTechnicianOption(): Promise<LinkFieldOption | null> {
  try {
    const response = await fetch('/api/method/healthcare.api.common.get_current_user_lab_technician_option', {
      credentials: 'include',
    })
    const resData = await response.json()
    const msg = resData?.message
    if (msg && typeof msg === 'object' && typeof msg.name === 'string') {
      return {
        name: msg.name,
        label: msg.label || msg.name,
        medical_role: typeof msg.medical_role === 'string' ? msg.medical_role : undefined,
      }
    }
    return null
  } catch (err) {
    console.error('Failed to fetch current user lab technician:', err)
    return null
  }
}

/**
 * Fetch the current logged-in user's linked Healthcare Practitioner.
 * Returns the practitioner name (string) if found, null otherwise.
 * 
 * Use this to auto-populate practitioner/doctor/nurse fields on form modals.
 * If the user doesn't have a healthcare practitioner linked, the field will remain empty
 * and the user can select manually.
 */
export async function getCurrentUserPractitioner(): Promise<string | null> {
  try {
    const response = await fetch('/api/method/healthcare.api.common.get_current_user_healthcare_practitioner')
    const resData = await response.json()

    if (resData?.message && typeof resData.message === 'string') {
      return resData.message as string
    }
    return null
  } catch (err) {
    console.error('Failed to fetch current user practitioner:', err)
    return null
  }
}

/**
 * Current logged-in user's linked Healthcare Practitioner as a {name, label} option
 * (any specialty, not just doctors). Returns null if the user has no practitioner.
 * Use to default the "Doctor" filter to the practitioner viewing the list.
 */
export async function getCurrentUserPractitionerOption(): Promise<LinkFieldOption | null> {
  try {
    const response = await fetch('/api/method/healthcare.api.common.get_current_user_practitioner_option', {
      credentials: 'include',
    })
    const resData = await response.json()
    const msg = resData?.message
    if (msg && typeof msg === 'object' && typeof msg.name === 'string') {
      return { name: msg.name, label: msg.label || msg.name }
    }
    return null
  } catch (err) {
    console.error('Failed to fetch current user practitioner option:', err)
    return null
  }
}

export async function fetchServiceUnitTypes(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_service_unit_types${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchNursingChecklistTemplates(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_nursing_checklist_templates${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchLeadSources(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_lead_sources${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

/** Link options for Patient.category → DocType Patient Category.
 * Uses a whitelisted endpoint (not /api/resource) so portal roles without
 * doctype read permission (Doctor, Nurse) still get the option list. */
export async function fetchPatientCategories(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  const q = (search || '').trim()
  if (q) params.append('search', q)
  const response = await fetch(
    `/api/method/healthcare.api.common.get_patient_categories${params.toString() ? `?${params.toString()}` : ''}`
  )
  const resData = await response.json()
  const rows = Array.isArray(resData?.message) ? resData.message : []
  return (rows as { name: string; label?: string }[]).map((r) => ({
    name: r.name,
    label: (r.label || r.name || '').trim() || r.name,
  }))
}

export async function fetchNationalities(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url = `/api/method/healthcare.api.common.get_nationalities${
    params.toString() ? `?${params.toString()}` : ''
  }`

  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message.map((n: any) => ({
      name: n.name,
      label: n.nationality || n.name,
      country: n.country,
    }))
  }

  return []
}

/** Fetch Country list for link field (e.g. Patient address). */
export async function fetchCountries(): Promise<{ name: string }[]> {
  const res = await fetch('/api/resource/Country?fields=["name"]&limit_page_length=300')
  const data = await res.json()
  return Array.isArray(data?.data) ? data.data : []
}

export type DocumentTypeOption = { name: string; document_name?: string }

/** Fetch Document Type list for portal document upload dropdowns. */
export async function fetchDocumentTypes(search?: string): Promise<DocumentTypeOption[]> {
  const params = new URLSearchParams()
  if (search?.trim()) params.set('search', search.trim())
  const res = await fetch(
    `/api/method/healthcare.api.common.get_document_types${params.toString() ? `?${params.toString()}` : ''}`,
    { credentials: 'include' },
  )
  const data = await res.json().catch(() => ({}))
  if (data?.exc) {
    throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load document types')
  }
  return Array.isArray(data?.message) ? (data.message as DocumentTypeOption[]) : []
}

/** Create a new Document Type from the portal. */
export async function createDocumentType(documentName: string): Promise<DocumentTypeOption> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<DocumentTypeOption>(
    '/api/method/healthcare.api.common.create_document_type',
    {
      method: 'POST',
      body: JSON.stringify({ document_name: documentName.trim() }),
    },
  )
}

/** Fetch a single document by doctype and name (Frappe resource API). */
export async function fetchDoc(doctype: string, name: string): Promise<Record<string, unknown>> {
  if (doctype === 'Clinical Note') {
    const { fetchClinicalNote } = await import('./clinicalNotes')
    return fetchClinicalNote(name)
  }

  if (doctype === 'Warning Message') {
    const { fetchWarningMessage } = await import('./warningMessages')
    return fetchWarningMessage(name)
  }

  if (doctype === 'Patient Assessment') {
    const { fetchPatientAssessment } = await import('./patientAssessment')
    return (await fetchPatientAssessment(name)) as unknown as Record<string, unknown>
  }

  if (doctype === 'Environmental Checklist') {
    const { fetchEnvironmentalChecklist } = await import('./environmentalChecklist')
    return (await fetchEnvironmentalChecklist(name)) as unknown as Record<string, unknown>
  }

  if (doctype === 'Mental State') {
    const { fetchMentalState } = await import('./mentalState')
    return (await fetchMentalState(name)) as unknown as Record<string, unknown>
  }

  if (doctype === 'IP Grooming Chart') {
    const { fetchGroomingChart } = await import('./groomingCharts')
    return (await fetchGroomingChart(name)) as unknown as Record<string, unknown>
  }

  if (doctype === 'Sleeping Pattern Detail') {
    const { fetchSleepingPattern } = await import('./sleepingPattern')
    return (await fetchSleepingPattern(name)) as unknown as Record<string, unknown>
  }

  if (doctype === 'Discharge') {
    const { fetchDischarge } = await import('./discharges')
    return (await fetchDischarge(name)) as unknown as Record<string, unknown>
  }

  const res = await fetch(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
  )
  const data = await res.json()
  if (data?.exception) throw new Error(data.message || 'Failed to fetch document')
  if (!data?.data) throw new Error('Invalid response format')
  return data.data as Record<string, unknown>
}

/** Login username (or full name) for a User document name / owner. */
export async function resolveOwnerUsername(owner?: string | null): Promise<string> {
  const id = (owner || '').trim()
  if (!id) return ''
  try {
    const params = new URLSearchParams({
      doctype: 'User',
      fields: JSON.stringify(['name', 'full_name', 'username']),
      filters: JSON.stringify([['name', '=', id]]),
      limit_page_length: '1',
    })
    const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
    const payload = await res.json()
    const user = Array.isArray(payload?.message) ? payload.message[0] : null
    if (user) {
      const fullName = String(user.full_name || '').trim()
      if (fullName) return fullName
      const username = String(user.username || '').trim()
      if (username && !username.includes('@')) return username
    }
  } catch {
    /* leave blank rather than showing an email / user id */
  }
  return ''
}

/** Creator user + linked Healthcare Practitioner for detail panels. */
export async function resolveOwnerCreatorInfo(owner?: string | null): Promise<{
  username: string
  fullName: string
  practitionerLabel: string
}> {
  const id = (owner || '').trim()
  const empty = { username: '', fullName: '', practitionerLabel: '' }
  if (!id) return empty

  let username = ''
  let fullName = ''
  let practitionerLabel = ''

  try {
    const userParams = new URLSearchParams({
      doctype: 'User',
      fields: JSON.stringify(['name', 'full_name', 'username']),
      filters: JSON.stringify([['name', '=', id]]),
      limit_page_length: '1',
    })
    const userRes = await fetch(`/api/method/frappe.client.get_list?${userParams}`, {
      credentials: 'include',
    })
    const userPayload = await userRes.json()
    const user = Array.isArray(userPayload?.message) ? userPayload.message[0] : null
    if (user) {
      fullName = String(user.full_name || '').trim()
      const rawUsername = String(user.username || '').trim()
      username = rawUsername && !rawUsername.includes('@') ? rawUsername : ''
    }
  } catch {
    /* ignore */
  }

  try {
    const practParams = new URLSearchParams({
      doctype: 'Healthcare Practitioner',
      fields: JSON.stringify(['name', 'practitioner_name']),
      filters: JSON.stringify([
        ['user_id', '=', id],
        ['status', '=', 'Active'],
      ]),
      limit_page_length: '1',
    })
    const practRes = await fetch(`/api/method/frappe.client.get_list?${practParams}`, {
      credentials: 'include',
    })
    const practPayload = await practRes.json()
    const pract = Array.isArray(practPayload?.message) ? practPayload.message[0] : null
    if (pract) {
      practitionerLabel = String(pract.practitioner_name || pract.name || '').trim()
    }
  } catch {
    /* ignore */
  }

  return { username, fullName, practitionerLabel }
}

export interface CreateLeadSourceData {
  source: string
}

export async function createLeadSource(
  data: CreateLeadSourceData
): Promise<{ name: string; source: string }> {
  const { apiRequest } = await import('./apiClient')

  const created = await apiRequest<{ name: string; source: string }>(
    '/api/resource/Patient%20Source',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  )

  return created
}

export async function fetchUsers(search?: string, role?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (role) params.append('role', role)
  
  const url = `/api/method/healthcare.api.common.get_users${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchDischargeTemplates(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_discharge_templates${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchHealthcareInsurance(
  search?: string
): Promise<LinkFieldOption[]> {
  console.log('fetchHealthcareInsurance called with search:', search)
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url =
    `/api/method/healthcare.api.common.get_healthcare_insurance` +
    `${params.toString() ? `?${params.toString()}` : ''}`

  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export interface LabTestTemplateOption extends LinkFieldOption {
  outpatient_rate?: number
  inpatient_rate?: number
  is_group?: number | boolean
}

export async function fetchLabTestTemplates(
  search?: string,
  department?: string,
  byNurse?: boolean
): Promise<LabTestTemplateOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (department) params.append('department', department)
  if (byNurse) params.append('by_nurse', '1')

  const url = `/api/method/healthcare.api.common.get_lab_test_templates${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url, { credentials: 'include' })
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LabTestTemplateOption[]
  }
  if (resData?.exc || resData?.exception) {
    throw new Error(resData?.message || 'Failed to load lab test templates')
  }
  return []
}

export async function fetchClinicalNoteTypes(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_clinical_note_types${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export function pickDefaultLinkOption<T extends LinkFieldOption>(
  options: T[]
): T | undefined {
  return options.find((t) => t.default === 1 || t.default === true)
}

export function pickDefaultAppointmentType(types: LinkFieldOption[]): LinkFieldOption | undefined {
  return pickDefaultLinkOption(types)
}

export async function fetchAppointmentTypes(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_appointment_types${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchMedicalRoles(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  
  const url = `/api/method/healthcare.api.common.get_medical_roles${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchObservationTemplates(search?: string, department?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (department) params.append('department', department)
  
  const url = `/api/method/healthcare.api.common.get_observation_templates${params.toString() ? `?${params.toString()}` : ''}`
  
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function getPractitionerMedicalRole(practitioner: string): Promise<string | null> {
  const response = await fetch(
    `/api/method/healthcare.api.common.get_practitioner_medical_role?practitioner=${encodeURIComponent(practitioner)}`,
    { credentials: 'include' }
  )
  const resData = await response.json()

  if (resData?.message) {
    return resData.message as string
  } else {
    return null
  }
}

/** Resolve Medical Role link (document name) to label for dropdowns. */
export async function fetchMedicalRoleByName(name: string): Promise<LinkFieldOption | null> {
  const key = (name || '').trim()
  if (!key) return null
  try {
    const res = await fetch(`/api/resource/Medical Role/${encodeURIComponent(key)}`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => null)
    const d = body?.data
    if (!d?.name) return null
    return { name: d.name, label: (d.medical_role as string) || d.name }
  } catch {
    return null
  }
}

/** Default company on create forms: preferred (e.g. branch) if valid, else first in list. */
export function resolveDefaultCompany(
  companies: LinkFieldOption[],
  preferredCompany?: string | null
): string {
  if (!companies.length) return ''
  if (preferredCompany && companies.some((c) => c.name === preferredCompany)) {
    return preferredCompany
  }
  return companies[0].name
}

export async function fetchCompanies(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url =
    `/api/method/healthcare.api.common.get_companies` +
    (params.toString() ? `?${params.toString()}` : '')

  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }

  return []
}

export interface DefaultCompanyCurrency {
  currency: string
  company: string | null
}

/** ERPNext ``Company.default_currency`` for ``company`` or the user's default company. */
export async function fetchDefaultCompanyCurrency(company?: string): Promise<DefaultCompanyCurrency> {
  const params = new URLSearchParams()
  if (company?.trim()) params.set('company', company.trim())
  const qs = params.toString()
  const url = `/api/method/healthcare.api.common.get_default_company_currency${qs ? `?${qs}` : ''}`
  const response = await fetch(url, { credentials: 'include' })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(
      typeof data?.message === 'string' ? data.message : data?.exc || 'Failed to load currency'
    )
  }
  const msg = data?.message
  return {
    currency: (msg?.currency as string) || '',
    company: (msg?.company as string) || null,
  }
}

export async function fetchCostCenters(
  company?: string,
  search?: string,
  opts?: { isHospital?: boolean }
): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (company) params.append('company', company)
  if (search) params.append('search', search)
  if (opts?.isHospital) params.append('is_hospital', '1')

  const url =
    `/api/method/healthcare.api.common.get_cost_centers` +
    (params.toString() ? `?${params.toString()}` : '')

  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }

  return []
}

/**
 * Branches shown in the portal branch/cost-center filter (BranchSelector).
 * Backend restricts this to the clinical branches (Jau + Serene Hospital) only,
 * unlike fetchCostCenters which returns the full cost-center list for pickers.
 */
export async function fetchBranchOptions(): Promise<LinkFieldOption[]> {
  const response = await fetch('/api/method/healthcare.api.common.get_branch_options')
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }

  return []
}

export async function fetchBranches(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url =
    `/api/method/healthcare.api.common.get_branches` +
    (params.toString() ? `?${params.toString()}` : '')
  const response = await fetch(url)
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }
  return []
}

export interface EmployeeOption {
  name: string
  label: string
  designation?: string
  department?: string
}

export async function fetchEmployees(search?: string): Promise<EmployeeOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url =
    `/api/method/healthcare.api.common.get_employees` +
    (params.toString() ? `?${params.toString()}` : '')
  const response = await fetch(url)
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as EmployeeOption[]
  }
  return []
}


export async function fetchItems(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url = `/api/method/healthcare.api.common.get_items${params.toString() ? `?${params.toString()}` : ''}`

  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchItemRouteOfAdministration(item: string): Promise<string | null> {
  const itemName = (item || '').trim()
  if (!itemName) return null
  const params = new URLSearchParams({ item: itemName })
  const res = await fetch(
    `/api/method/healthcare.api.common.get_item_route_of_administration?${params.toString()}`
  )
  const data = await res.json()
  const route = typeof data?.message === 'string' ? data.message.trim() : ''
  return route || null
}

/** Item master pharmaceutical form (dosage form), e.g. TABLET / CAPSULE. */
export async function fetchItemPharmaceuticalForm(item: string): Promise<string | null> {
  const itemName = (item || '').trim()
  if (!itemName) return null
  const params = new URLSearchParams({ item: itemName })
  const res = await fetch(
    `/api/method/healthcare.api.common.get_item_pharmaceutical_form?${params.toString()}`
  )
  const data = await res.json()
  const form = typeof data?.message === 'string' ? data.message.trim() : ''
  return form || null
}

/** Pharmaceutical form from the drug search option, or fetched from Item master when missing. */
export async function resolvePrescriptionDrugPharmaceuticalForm(opt: LinkFieldOption): Promise<string> {
  const direct = opt.pharmaceutical_form?.trim()
  if (direct) return direct
  return (await fetchItemPharmaceuticalForm(opt.name)) || ''
}

/** Route from prescription item search, or fetched from Item master when missing. */
export async function resolvePrescriptionDrugRoute(opt: LinkFieldOption): Promise<string> {
  const direct = opt.default_route_of_administration?.trim()
  if (direct) return direct
  return (await fetchItemRouteOfAdministration(opt.name)) || ''
}

export async function fetchPrescriptionItems(
  search?: string,
  opts?: { warehouse?: string; costCenter?: string; inStockOnly?: boolean }
): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (opts?.warehouse) params.append('warehouse', opts.warehouse)
  if (opts?.costCenter) params.append('cost_center', opts.costCenter)
  if (opts?.inStockOnly) params.append('in_stock_only', '1')

  const url =
    `/api/method/healthcare.api.common.get_prescription_items` +
    (params.toString() ? `?${params.toString()}` : '')

  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }
  return []
}

export async function filterItemsInStock(
  itemCodes: string[],
  opts?: { warehouse?: string; costCenter?: string }
): Promise<{ warehouse?: string; in_stock: string[]; out_of_stock: string[] }> {
  if (!itemCodes.length) {
    return { warehouse: opts?.warehouse, in_stock: [], out_of_stock: [] }
  }
  const { apiRequest } = await import('./apiClient')
  return apiRequest<{ warehouse?: string; in_stock: string[]; out_of_stock: string[] }>(
    '/api/method/healthcare.api.common.filter_items_in_stock',
    {
      method: 'POST',
      body: JSON.stringify({
        item_codes: itemCodes,
        warehouse: opts?.warehouse || undefined,
        cost_center: opts?.costCenter || undefined,
      }),
    }
  )
}

/**
 * Subset of the given Item codes that are pink medicines — the Item's Item Group
 * (or any ancestor) has `custom_is_pink` ticked. The prescription UI keeps the
 * Is Pink checkbox ticked and read-only for these lines.
 */
export async function filterPinkItems(itemCodes: string[]): Promise<string[]> {
  const codes = itemCodes.map((code) => (code || '').trim()).filter(Boolean)
  if (!codes.length) return []
  const { apiRequest } = await import('./apiClient')
  return apiRequest<string[]>('/api/method/healthcare.api.common.filter_pink_items', {
    method: 'POST',
    body: JSON.stringify({ item_codes: codes }),
  })
}

export async function fetchDosageForms(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_dosage_forms?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

export async function fetchMedicationTypes(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_medication_types?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}


export async function fetchPrescriptionFrequencies(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_prescription_frequencies?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

export async function fetchLongActingFrequencies(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_long_acting_frequencies?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

/**
 * "Total Dose Per" options (Dose Frequency) shown when the prescription frequency
 * is "Other" — e.g. Per Week (7), Per Month (30). `days` is used to convert the
 * total dose per period into a daily dose for the max-dose check.
 */
export async function fetchDoseFrequencies(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_dose_frequencies?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

export async function createPrescriptionFrequency(
  dosage: string,
  frequencyInADay = 1
): Promise<LinkFieldOption> {
  const params = new URLSearchParams({
    dosage,
    frequency_in_a_day: String(frequencyInADay),
  })
  const res = await fetch(`/api/method/healthcare.api.common.create_prescription_frequency?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok || data?.exc) {
    throw new Error(data?.message || 'Failed to create prescription frequency')
  }
  return data.message as LinkFieldOption
}

export async function createLongActingFrequency(
  frequency: string,
  intervalDays: number
): Promise<LinkFieldOption> {
  const params = new URLSearchParams({
    frequency,
    interval_days: String(intervalDays),
  })
  const res = await fetch(`/api/method/healthcare.api.common.create_long_acting_frequency?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await res.json()
  if (!res.ok || data?.exc) {
    throw new Error(data?.message || 'Failed to create long acting frequency')
  }
  return data.message as LinkFieldOption
}

export async function fetchRouteOfAdministrationList(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_route_of_administration_list?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

export async function fetchDiagnosis(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_diagnosis?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

export async function fetchComplaints(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_complaints?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

export async function fetchDiagnosisGroups(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const res = await fetch(`/api/method/healthcare.api.common.get_diagnosis_groups?${params.toString()}`)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as LinkFieldOption[]) : []
}

export type CreateDiagnosisPayload = {
  diagnosis: string
  disease_no?: string
  diagnosis_group?: string
}

export async function createDiagnosis(payload: CreateDiagnosisPayload | string): Promise<LinkFieldOption> {
  const body =
    typeof payload === 'string'
      ? { diagnosis: payload.trim() }
      : {
          diagnosis: payload.diagnosis.trim(),
          disease_no: payload.disease_no?.trim() || undefined,
          diagnosis_group: payload.diagnosis_group?.trim() || undefined,
        }
  const csrf = await ensureCSRF()
  const res = await fetch('/api/method/healthcare.api.common.create_diagnosis', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data?.exc_type) throw new Error(data?.message || 'Failed to create diagnosis')
  const msg = data?.message
  if (msg && typeof msg === 'object' && msg.name) {
    return msg as LinkFieldOption
  }
  const name = typeof msg === 'string' ? msg : body.diagnosis
  return { name, label: body.diagnosis }
}

export async function createComplaint(complaints: string): Promise<string> {
  const res = await fetch('/api/method/healthcare.api.common.create_complaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ complaints: complaints.trim() }),
  })
  const data = await res.json()
  if (data?.exc_type) throw new Error(data?.message || 'Failed to create complaint')
  return (data?.message as string) || complaints.trim()
}

export interface EncounterDiagnosisSymptoms {
  diagnosis: { name: string; label?: string }[]
  symptoms: { name: string; label?: string }[]
}

export async function getEncounterDiagnosisSymptoms(
  parentDoctype: string,
  parentName: string
): Promise<EncounterDiagnosisSymptoms> {
  const params = new URLSearchParams()
  params.append('parent_doctype', parentDoctype)
  params.append('parent_name', parentName)
  const res = await fetch(`/api/method/healthcare.api.encounter_diagnosis.get_encounter_diagnosis_symptoms?${params.toString()}`)
  const data = await res.json()
  if (data?.exc_type) throw new Error(data?.message || 'Failed to load')
  return (data?.message || { diagnosis: [], symptoms: [] }) as EncounterDiagnosisSymptoms
}

export async function updateEncounterDiagnosisSymptoms(
  parentDoctype: string,
  parentName: string,
  diagnosis: { name: string }[],
  symptoms: { name: string }[]
): Promise<void> {
  const res = await fetch('/api/method/healthcare.api.encounter_diagnosis.update_encounter_diagnosis_symptoms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent_doctype: parentDoctype,
      parent_name: parentName,
      diagnosis,
      symptoms,
    }),
  })
  const data = await res.json()
  if (data?.exc_type) throw new Error(data?.message || 'Failed to save')
}

/** @deprecated Use MedicalDiagnosisEntryRow from medicalDiagnosisEntry.ts */
export type PatientDiagnosisRow = import('./medicalDiagnosisEntry').MedicalDiagnosisEntryRow

/** @deprecated Use MedicalDiagnosisEntryAggRow from medicalDiagnosisEntry.ts */
export type PatientDiagnosisAggRow = import('./medicalDiagnosisEntry').MedicalDiagnosisEntryAggRow

export {
  getMedicalDiagnosisForContext as getPatientDiagnosis,
  getMedicalDiagnosisForPatient as getAllPatientDiagnoses,
  getAllMedicalDiagnosisEntries,
  saveMedicalDiagnosisForContext as savePatientDiagnosis,
  appendMedicalDiagnosisForContext as appendPatientDiagnosis,
} from './medicalDiagnosisEntry'

/** Fetch ERPNext Departments (Link to `Department`). */
export async function fetchDepartments(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  params.append('fields', JSON.stringify(['name', 'department_name']))
  if (search) {
    params.append(
      'filters',
      JSON.stringify([
        ['Department', 'name', 'like', `%${search}%`],
        ['Department', 'department_name', 'like', `%${search}%`],
      ])
    )
  }
  params.append('limit_page_length', '50')

  const url = `/api/resource/Department?${params.toString()}`
  const res = await fetch(url)
  const data = await res.json()

  const rows = (data?.data || data?.message) as any
  if (Array.isArray(rows)) {
    return rows.map((d: any) => ({
      name: d.name,
      label: d.department_name || d.name,
    })) as LinkFieldOption[]
  }
  return []
}

export async function fetchWarehouses(company?: string, search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  params.append('fields', JSON.stringify(['name', 'warehouse_name']))
  const filters: any[] = []
  // Only non-group warehouses
  filters.push(['Warehouse', 'is_group', '=', 0])
  if (company) {
    filters.push(['Warehouse', 'company', '=', company])
  }
  if (search) {
    filters.push(['Warehouse', 'warehouse_name', 'like', `%${search}%`])
  }
  if (filters.length) {
    params.append('filters', JSON.stringify(filters))
  }
  params.append('limit_page_length', '50')

  const url = `/api/resource/Warehouse?${params.toString()}`

  const response = await fetch(url)
  const resData = await response.json()

  const data = (resData?.data || resData?.message) as any

  if (Array.isArray(data)) {
    return data.map((w: any) => ({
      name: w.name,
      label: w.warehouse_name || w.name
    })) as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchServiceRequestTemplateTypes(): Promise<LinkFieldOption[]> {
  const response = await fetch('/api/method/healthcare.api.common.get_service_request_template_types')
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchServiceRequestTemplates(
  templateDt: string,
  search?: string,
  department?: string,
  /** Lab Test Template only: filter by `is_group` on Lab Test Template (0 or 1). Omit for all. */
  isGroup?: 0 | 1,
  /** Lab Test Template only: limit to By Nurse templates. */
  byNurse?: boolean,
): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  params.append('template_dt', templateDt)
  if (search) params.append('search', search)
  if (department) params.append('department', department)
  if (isGroup === 0 || isGroup === 1) params.append('is_group', String(isGroup))
  if (byNurse) params.append('by_nurse', '1')
  const url = `/api/method/healthcare.api.common.get_service_request_templates?${params.toString()}`

  const response = await fetch(url, { credentials: 'include' })
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}

export async function fetchServiceRequestStatuses(search?: string): Promise<LinkFieldOption[]> {
  try {
    console.log('fetchServiceRequestStatuses: Starting fetch...', search)
    const params = new URLSearchParams()
    if (search) params.append('search', search)
    
    const url = `/api/method/healthcare.api.common.get_service_request_statuses${params.toString() ? `?${params.toString()}` : ''}`
    console.log('fetchServiceRequestStatuses: URL:', url)
    
    const response = await fetch(url)
    console.log('fetchServiceRequestStatuses: Response status:', response.status, response.statusText)
    
    if (!response.ok) {
      console.error('fetchServiceRequestStatuses: Response not OK:', response.status, response.statusText)
      const text = await response.text()
      console.error('fetchServiceRequestStatuses: Response text:', text)
      return []
    }
    
    const resData = await response.json()
    console.log('fetchServiceRequestStatuses: Response data:', resData)

    if (resData?.message && Array.isArray(resData.message)) {
      console.log('Service Request Statuses loaded:', resData.message.length, 'items')
      return resData.message as LinkFieldOption[]
    } else {
      console.warn('Unexpected response format for service request statuses:', resData)
      return []
    }
  } catch (error) {
    console.error('Error fetching service request statuses:', error)
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack)
    }
    return []
  }
}

export interface CreatePractitionerData {
  full_name: string
  gender?: string
  status?: string
  mobile_phone?: string
  office_phone?: string
  department?: string
  medical_role?: string
  practitioner_schedules?: { schedule: string; service_unit?: string }[]
}

export async function createPractitioner(data: CreatePractitionerData): Promise<{ name: string; practitioner_name: string }> {
  const { apiRequest } = await import('./apiClient')
  
  const response = await apiRequest('/api/method/healthcare.api.common.create_healthcare_practitioner', {
    method: 'POST',
    body: JSON.stringify({ data }),
  })

  if (response?.name) {
    return response as { name: string; practitioner_name: string }
  }
  throw new Error('Invalid response format')
}

export const fetchDischargeChecklist = async (templateName: string): Promise<ChecklistItem[]> => {
  const result = await apiRequest<ChecklistItem[]>(
    '/api/method/healthcare.api.common.get_discharge_checklist_from_template',
    {
      method: 'POST',
      body: JSON.stringify({ template_name: templateName }),
    }
  )
  return Array.isArray(result) ? result : []
}

export async function fetchCurrentUserDepartments(): Promise<string[]> {
  const result = await apiRequest<string[]>(
    '/api/method/healthcare.api.common.get_current_user_departments',
    {
      method: 'GET',
    }
  )
  return Array.isArray(result) ? result : []
}

export type NursingDischargeTemplateSource = 'discharge_nursing' | 'nursing_checklist'

export interface NursingDischargeTemplateOption extends LinkFieldOption {
  template_source?: NursingDischargeTemplateSource
}

export const fetchNursingDischargeChecklist = async (
  templateName: string,
  templateSource?: NursingDischargeTemplateSource
): Promise<ChecklistItem[]> => {
  const result = await apiRequest<ChecklistItem[]>(
    '/api/method/healthcare.api.common.get_nursing_discharge_checklist_from_template',
    {
      method: 'POST',
      body: JSON.stringify({
        template_name: templateName,
        template_source: templateSource || '',
      }),
    }
  )
  return Array.isArray(result) ? result : []
}

export async function fetchPatientVisits(
  patient?: string,
  search?: string
): Promise<LinkFieldOption[]> {
console.log("fetchPatientVisits called with patient:", patient, "search:", search)
  const params = new URLSearchParams()
  if (patient) params.append('patient', patient)
  if (search) params.append('search', search)
    
  const res = await fetch(
    `/api/method/healthcare.api.common.get_patient_visits?${params}`
  )
  console.log("response", res)
  const data = await res.json()
  return Array.isArray(data?.message) ? data.message : []
}


export async function fetchInpatientAdmissions(
  patient?: string,
  search?: string
): Promise<LinkFieldOption[]> {

  const params = new URLSearchParams()
  if (patient) params.append('patient', patient)
  if (search) params.append('search', search)

  const res = await fetch(
    `/api/method/healthcare.api.common.get_inpatient_admissions?${params}`
  )

  const data = await res.json()
  return Array.isArray(data?.message) ? data.message : []
}

export function resolveCostCenterFromCareOptions(
  mode: string,
  patientVisit: string | undefined,
  inpatientRecord: string | undefined,
  visits: LinkFieldOption[],
  admissions: LinkFieldOption[],
): string | null {
  if (mode === 'IP' && inpatientRecord) {
    const row = admissions.find((a) => a.name === inpatientRecord)
    const cc = row?.cost_center?.trim()
    return cc || null
  }
  if (mode === 'OP' && patientVisit) {
    const row = visits.find((v) => v.name === patientVisit)
    const cc = row?.cost_center?.trim()
    return cc || null
  }
  return null
}

export async function fetchCostCenterForCareEpisode(
  mode: string,
  options: { patientVisit?: string; inpatientRecord?: string },
): Promise<string | null> {
  const refDoctype =
    mode === 'IP' ? 'Inpatient Admission' : mode === 'OP' ? 'Patient Visit' : null
  const refName =
    mode === 'IP' ? options.inpatientRecord?.trim() : mode === 'OP' ? options.patientVisit?.trim() : ''
  if (!refDoctype || !refName) return null
  try {
    const response = await fetch(
      `/api/resource/${encodeURIComponent(refDoctype)}/${encodeURIComponent(refName)}?fields=${encodeURIComponent(JSON.stringify(['cost_center']))}`,
    )
    const resData = await response.json()
    const cc = resData?.data?.cost_center
    return typeof cc === 'string' && cc.trim() ? cc.trim() : null
  } catch {
    return null
  }
}

export async function syncCostCenterFromCareEpisode(
  mode: string,
  options: {
    patientVisit?: string
    inpatientRecord?: string
    visits?: LinkFieldOption[]
    admissions?: LinkFieldOption[]
  },
): Promise<string | null> {
  const fromList = resolveCostCenterFromCareOptions(
    mode,
    options.patientVisit,
    options.inpatientRecord,
    options.visits || [],
    options.admissions || [],
  )
  if (fromList) return fromList
  return fetchCostCenterForCareEpisode(mode, options)
}


export async function fetchSalutations(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url =
    `/api/method/healthcare.api.common.get_salutations${
      params.toString() ? `?${params.toString()}` : ''
    }`

  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  }

  return []
}
export async function fetchPatientOptions(search?: string): Promise<LinkFieldOption[]> {
  const filters: [string, string, string][] = []
  if (search?.trim()) filters.push(['patient_name', 'like', `%${search.trim()}%`])
  const params = new URLSearchParams({
    doctype: 'Patient',
    fields: JSON.stringify(['name', 'patient_name', 'id_number']),
    filters: JSON.stringify(filters),
    limit: '30',
    order_by: 'patient_name asc',
  })
  const res = await fetch(`/api/method/frappe.client.get_list?${params}`, {
    credentials: 'include',
  })
  const data = await res.json()
  if (data?.exc) return []
  return (data?.message || []).map(
    (p: { name: string; patient_name?: string; id_number?: string }) => ({
      name: p.name,
      label: p.patient_name ? `${p.patient_name} (${p.name})` : p.name,
      id_number: p.id_number,
    })
  )
}

export interface InsuranceClaimRow {
  name: string
  patient: string
  patient_name: string
  patient_category?: string
  health_insurance: string
  insurance_payor: string
  claim_date: string
  status: string
  docstatus?: number
  total_claimed: number
  total_approved: number
  total_rejected: number
  total_patient_liability: number
  sales_invoice: string
  authorization_no?: string
  remark?: string
  vch_status?: string
}

export interface InsuranceClaimFilters {
  search?: string
  patient?: string
  status?: string
  health_insurance?: string
  insurance_payor?: string
  patient_category?: string
}

export async function fetchInsuranceClaims(filters: InsuranceClaimFilters = {}): Promise<InsuranceClaimRow[]> {
  const params = new URLSearchParams()
  if (filters.search) params.append('search', filters.search)
  if (filters.patient) params.append('patient', filters.patient)
  if (filters.status) params.append('status', filters.status)
  if (filters.health_insurance) params.append('health_insurance', filters.health_insurance)
  if (filters.insurance_payor) params.append('insurance_payor', filters.insurance_payor)
  if (filters.patient_category) params.append('patient_category', filters.patient_category)

  const url = `/api/method/healthcare.api.common.get_insurance_claims${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as InsuranceClaimRow[]
  }
  return []
}

export interface InsuranceClaimsDashboard {
  totals: {
    claims: number
    pending: number
    submitted: number
    partially_paid: number
    paid: number
    rejected: number
    total_claimed: number
    total_approved: number
    total_unpaid: number
  }
  by_insurance: Array<{
    health_insurance: string
    total: number
    legacy?: number
    pending: number
    submitted: number
    paid: number
    rejected: number
    total_claimed: number
    total_approved: number
    unpaid_amount: number
  }>
  by_category: Array<{ category: string; count: number; total_claimed: number }>
  by_status: Record<string, number>
  invoices_needing_claim: number
}

export async function fetchInsuranceClaimsDashboard(
  patient?: string,
  health_insurance?: string
): Promise<InsuranceClaimsDashboard | null> {
  const params = new URLSearchParams()
  if (patient) params.append('patient', patient)
  if (health_insurance) params.append('health_insurance', health_insurance)
  const url = `/api/method/healthcare.api.common.get_insurance_claims_dashboard${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()
  return resData?.message ?? null
}

export interface InvoiceNeedingClaimRow {
  name: string
  patient: string
  patient_name: string
  posting_date: string
  grand_total: number
  discount_amount: number
  outstanding_amount: number
  status: string
  docstatus?: number
  custom_base_reference: string | null
  custom_base_reference_name: string | null
  custom_health_insurance: string | null
  insurance_register?: string | null
  insurance_register_status?: string | null
  insurance_provider?: string | null
  patient_category?: string | null
  health_insurance?: string | null
  claimed_amount?: number
  remaining_claimable?: number
}

export interface InvoicesNeedingClaimFilters {
  patient?: string
  patient_category?: string
  date_from?: string
  date_to?: string
  health_insurance?: string
  limit?: number
}

export async function fetchInvoicesNeedingInsuranceClaim(
  filters: InvoicesNeedingClaimFilters = {}
): Promise<InvoiceNeedingClaimRow[]> {
  const limit = filters.limit ?? 50
  const params = new URLSearchParams({ limit: String(limit) })
  if (filters.patient) params.append('patient', filters.patient)
  if (filters.patient_category) params.append('patient_category', filters.patient_category)
  if (filters.date_from) params.append('date_from', filters.date_from)
  if (filters.date_to) params.append('date_to', filters.date_to)
  if (filters.health_insurance) params.append('health_insurance', filters.health_insurance)
  const url = `/api/method/healthcare.api.common.get_invoices_needing_insurance_claim?${params.toString()}`
  const response = await fetch(url, { credentials: 'include' })
  const resData = await response.json()
  if (resData?.exc || resData?.exception) {
    const msg =
      (typeof resData.message === 'string' && resData.message) ||
      (typeof resData.exception === 'string' && resData.exception) ||
      'Failed to load invoices needing claim'
    throw new Error(String(msg).split('\n')[0])
  }
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as InvoiceNeedingClaimRow[]
  }
  return []
}

export interface InsuranceClaimDetail {
  name: string
  docstatus: number
  patient: string
  patient_name: string
  patient_category: string
  health_insurance: string
  patient_insurance_coverage?: string | null
  insurance_payor: string
  claim_date: string | null
  status: string
  sales_invoice: string | null
  reference_doctype: string | null
  reference_name: string | null
  authorization_no: string | null
  remark: string | null
  total_claimed: number
  total_approved: number
  total_rejected: number
  claim_items: Array<{
    service_type: string
    item_name: string
    description: string
    sales_invoice_item?: string
    gross_amount: number
    covered_amount: number
    co_pay_amount: number
    non_covered_amount: number
    patient_liability: number
    paid_amount: number
  }>
}

export async function fetchInsuranceClaimDetail(claimName: string): Promise<InsuranceClaimDetail | null> {
  const params = new URLSearchParams({ claim_name: claimName })
  const url = `/api/method/healthcare.api.common.get_insurance_claim_detail?${params.toString()}`
  const response = await fetch(url)
  const resData = await response.json()
  return resData?.message ?? null
}

export interface SaveInsuranceClaimPayload {
  name?: string
  patient: string
  claim_date?: string | null
  status?: string
  health_insurance?: string | null
  patient_insurance_coverage?: string | null
  insurance_payor?: string | null
  sales_invoice?: string | null
  reference_doctype?: string | null
  reference_name?: string | null
  authorization_no?: string | null
  remark?: string | null
  submit?: boolean
  claim_items: Array<{
    service_type: string
    item_name: string
    description: string
    gross_amount: number
    covered_amount: number
    co_pay_amount: number
    non_covered_amount: number
    patient_liability: number
    paid_amount: number
    sales_invoice_item?: string
  }>
}

export async function saveInsuranceClaim(payload: SaveInsuranceClaimPayload): Promise<{ name: string; docstatus: number; status: string }> {
  return apiRequest('/api/method/healthcare.api.common.save_insurance_claim', {
    method: 'POST',
    body: JSON.stringify({ data: JSON.stringify(payload) }),
  })
}

export async function rejectInsuranceClaim(claimName: string, remark?: string): Promise<void> {
  const params = new URLSearchParams({ claim_name: claimName })
  if (remark) params.append('remark', remark)
  await apiRequest(`/api/method/healthcare.api.common.reject_insurance_claim?${params.toString()}`, {
    method: 'POST',
  })
}

/** Preview the next auto-generated Insurance Claim trans_no (INS/YYYY/#####). */
export async function getNextInsuranceClaimNumber(): Promise<string> {
  const res = await fetch(
    '/api/method/healthcare.healthcare.api.insurance_claim.get_next_insurance_claim_number'
  )
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  const message = (data as { message?: { trans_no?: string } })?.message
  return message?.trans_no || ''
}

/** Upload an Excel file for the insurance claim importer; returns the stored file_url. */
export async function uploadInsuranceImportFile(file: File): Promise<string> {
  const csrf = (window as any).csrf_token || (await ensureCSRF())
  const form = new FormData()
  form.append('file', file)
  form.append('is_private', '1')
  form.append('folder', 'Home/Attachments')
  if (csrf) form.append('csrf_token', csrf)

  const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
  const res = await fetch(`${base}/api/method/upload_file`, {
    method: 'POST',
    headers: csrf ? { 'X-Frappe-CSRF-Token': csrf } : {},
    body: form,
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({} as any))
  if (data?.exc) {
    let reason = 'Upload failed'
    try {
      const msgs = JSON.parse(data._server_messages || '[]')
      const first = JSON.parse(msgs[0] || '{}')
      reason = first?.message || data?.message || reason
    } catch {
      reason = data?.message || reason
    }
    throw new Error(reason)
  }
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
  const doc = data?.message
  if (doc && typeof doc === 'object' && doc.file_url) return doc.file_url as string
  if (typeof doc === 'string' && doc.startsWith('/')) return doc
  throw new Error('Upload failed: no file URL in response')
}

export interface ImportInsuranceClaimsResult {
  total_master_rows: number
  created: number
  updated: number
  submitted: number
  skipped: number
  patients_created: number
  patients_insured: number
  registers_created: number
  error_count: number
  errors: { trans_no: string; error: string }[]
}

/** Import legacy TRICARE insurance claims from the master + services Excel files. */
export async function importInsuranceClaims(
  masterFileUrl: string,
  childFileUrl?: string
): Promise<ImportInsuranceClaimsResult> {
  const csrf = (window as any).csrf_token || (await ensureCSRF())
  const res = await fetch(
    '/api/method/healthcare.healthcare.api.insurance_claim.import_insurance_claims',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ master_file_url: masterFileUrl, child_file_url: childFileUrl || null }),
    }
  )
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok || (data as { exc?: string })?.exc) {
    const msg = (data as { message?: unknown; exc_type?: string })?.message
    throw new Error(typeof msg === 'string' ? msg : (data as { exc_type?: string })?.exc_type || 'Import failed')
  }
  return (data as { message: ImportInsuranceClaimsResult }).message
}

export interface InsurancePatientRegisterRow {
  name: string
  full_name: string
  national_id_cpr_no: string
  posting_date: string
  status: string
  insurance_provider: string
  approval_id: string
  approval_validitydays: number
  no_of_visits: string
  patient: string
  patient_name?: string
  patient_file_no?: string
  no_of_patient_visit?: number
}

export interface CreateInsurancePatientRegisterPayload {
  full_name: string
  national_id_cpr_no?: string | null
  posting_date?: string | null
  status?: string
  insurance_provider: string
  approval_id?: string | null
  approval_validitydays?: number | null
  no_of_visits?: string | null
  patient?: string | null
}

export async function createInsurancePatientRegister(
  payload: CreateInsurancePatientRegisterPayload
): Promise<{
  name: string
  full_name: string
  insurance_provider: string
  national_id_cpr_no: string
  patient?: string
  status?: string
  linked_patient?: boolean
}> {
  return apiRequest('/api/method/healthcare.api.common.create_insurance_patient_register', {
    method: 'POST',
    body: JSON.stringify({ data: payload }),
  })
}

export type UpdateInsurancePatientRegisterPayload = CreateInsurancePatientRegisterPayload & {
  name: string
}

export async function updateInsurancePatientRegister(
  payload: UpdateInsurancePatientRegisterPayload
): Promise<InsurancePatientRegisterRow> {
  const { name, ...data } = payload
  return apiRequest('/api/method/healthcare.api.common.update_insurance_patient_register', {
    method: 'POST',
    body: JSON.stringify({ name, data }),
  })
}

export async function fetchInsurancePatientRegisters(search?: string): Promise<InsurancePatientRegisterRow[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url = `/api/method/healthcare.api.common.get_insurance_patient_registers${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as InsurancePatientRegisterRow[]
  }
  return []
}

export async function linkPatientToInsuranceRegister(registerName: string, patient: string): Promise<void> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = (window as any).csrf_token || (await ensureCSRF())
  const res = await fetch(`/api/method/healthcare.api.common.link_patient_to_insurance_register`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ register_name: registerName, patient }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.exc) {
    throw new Error(
      typeof data?.message === 'string' ? data.message : 'Failed to link patient to register'
    )
  }
}

export interface LabTestTemplateListRow {
  name: string
  lab_test_name: string
  lab_test_code?: string
  department: string
  lab_test_template_type: string
  is_group: number
  /** Parent group template name when this row is a child. */
  lab_group?: string | null
  is_billable: number
  disabled: number
  female_min_range: string
  female_max_range: string
  male_min_range: string
  male_max_range: string
  min_range: string
  max_range: string
  lab_test_uom:string
  lab_test_rate: number
  op_rate?: number
  outpatient_rate?: number
  inpatient_rate?: number
  result_type?: string
  /** Shown when result type is Multiple (Result Mul Val). */
  result_mul_val?: string
  is_multiple?: number | boolean
}

export async function fetchLabTestTemplateList(search?: string): Promise<LabTestTemplateListRow[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url = `/api/method/healthcare.api.common.get_lab_test_templates_admin_list${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url, { credentials: 'include' })
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LabTestTemplateListRow[]
  }
  return []
}

/** Partial update for Lab Test Template (single row). Prefer bulk for Lab Setup. */
export async function updateLabTestTemplateQuickFields(
  name: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await apiRequest(`/api/resource/Lab%20Test%20Template/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
}

/** One-request batch save for Lab Setup inline edits. */
export async function bulkUpdateLabTestTemplatesQuick(
  updates: Array<{ name: string; fields: Record<string, unknown> }>,
): Promise<{ updated: string[]; failed: Array<{ name?: string; error?: string }> }> {
  const result = await apiRequest<{
    updated?: string[]
    failed?: Array<{ name?: string; error?: string }>
  }>('/api/method/healthcare.api.common.bulk_update_lab_test_templates_quick', {
    method: 'POST',
    body: JSON.stringify({ updates }),
  })
  return {
    updated: Array.isArray(result?.updated) ? result.updated : [],
    failed: Array.isArray(result?.failed) ? result.failed : [],
  }
}

export interface LabTestSampleOption {
  name: string
  sample: string
  sample_type: string
  sample_uom: string
}

export async function fetchLabTestSamples(search?: string): Promise<LabTestSampleOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url = `/api/method/healthcare.api.common.get_lab_test_samples${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LabTestSampleOption[]
  }
  return []
}

export async function fetchSampleTypes(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)

  const url = `/api/method/healthcare.api.common.get_sample_types${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return (resData.message as { name: string; sample_type: string }[]).map(t => ({
      name: t.name,
      label: t.sample_type || t.name,
    }))
  }
  return []
}

export async function fetchIpRiskAnalysisOptions(
  search?: string,
  patient?: string,
  admission?: string
): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (patient) params.append('patient', patient)
  if (admission) params.append('admission', admission)
  const url = `/api/method/healthcare.api.common.get_ip_risk_analyses${
    params.toString() ? `?${params.toString()}` : ''
  }`
  try {
    const response = await fetch(url, { credentials: 'include' })
    const resData = await response.json()
    return Array.isArray(resData?.message) ? resData.message : []
  } catch {
    return []
  }
}

export async function fetchInpatientAdmissionOptions(search?: string, patient?: string): Promise<LinkFieldOption[]> {
  // Use the whitelisted, cost-center-scoped endpoint (not frappe.client.get_list, which
  // 403s for portal roles like Nurse that lack direct Inpatient Admission read permission).
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (patient) params.append('patient', patient)
  const res = await fetch(`/api/method/healthcare.api.common.get_inpatient_admissions?${params}`)
  const data = await res.json()
  return (data?.message || []).map((r: { name: string; patient?: string; patient_name?: string }) => ({
    name: r.name,
    label: `${r.name}${r.patient_name || r.patient ? ` – ${r.patient_name || r.patient}` : ''}`,
  }))
}

// ─── Health Insurance ─────────────────────────────────────────────────────────

export interface HealthInsuranceRow {
  name: string
  insurance_company: string
  insurance_type: string
  policy_no: string
  outpatient_discount: number
  inpatient_discount: number
  insurance_coverage_: number
  mode_of_payment: string
  insurance_no: string
}

export interface HealthInsuranceDetail {
  doc: Record<string, any>
  patient_count: number
  active_register_count: number
  unused_register_count: number
}

export async function fetchHealthInsurances(search?: string, insurance_company?: string): Promise<HealthInsuranceRow[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (insurance_company) params.append('insurance_company', insurance_company)
  const url = `/api/method/healthcare.api.common.get_health_insurances${params.toString() ? `?${params.toString()}` : ''}`
  const res = await fetch(url)
  const data = await res.json()
  return Array.isArray(data?.message) ? (data.message as HealthInsuranceRow[]) : []
}

export async function fetchHealthInsuranceDetail(name: string): Promise<HealthInsuranceDetail | null> {
  const params = new URLSearchParams({ name })
  const url = `/api/method/healthcare.api.common.get_health_insurance_detail?${params}`
  const res = await fetch(url)
  const data = await res.json()
  return data?.message ?? null
}

export async function fetchInsuranceCompanies(search?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  const url = `/api/method/healthcare.api.common.get_insurance_companies${params.toString() ? `?${params.toString()}` : ''}`
  const res = await fetch(url)
  const data = await res.json()
  return Array.isArray(data?.message)
    ? (data.message as { name: string }[]).map(r => ({ name: r.name, label: r.name }))
    : []
}

export async function createHealthInsurance(payload: Record<string, any>): Promise<{ name: string }> {
  const url = `/api/method/healthcare.api.common.create_health_insurance`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': (window as any).csrf_token || '' },
    body: JSON.stringify({ data: JSON.stringify(payload) }),
  })
  const data = await res.json()
  if (!res.ok || data.exc) throw new Error(data.exc_type || data.message || 'Failed to create')
  return data.message as { name: string }
}

export async function createInsuranceCompany(company_name: string): Promise<{ name: string }> {
  const url = `/api/method/healthcare.api.common.create_insurance_company`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': (window as any).csrf_token || '' },
    body: JSON.stringify({ company_name }),
  })
  const data = await res.json()
  if (!res.ok || data.exc) throw new Error(data.exc_type || data.message || 'Failed to create')
  return data.message as { name: string }
}

export async function fetchModeOfPayments(search?: string): Promise<LinkFieldOption[]> {
  const filters: [string, string, string][] = []
  if (search) filters.push(['name', 'like', `%${search}%`])
  const params = new URLSearchParams({
    doctype: 'Mode of Payment',
    fields: JSON.stringify(['name']),
    filters: JSON.stringify(filters),
    limit: '30',
    order_by: 'name asc',
  })
  const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
  const data = await res.json()
  return (data?.message || []).map((r: { name: string }) => ({ name: r.name, label: r.name }))
}

export async function fetchItemCodes(search?: string): Promise<LinkFieldOption[]> {
  const filters: [string, string, string][] = [['disabled', '=', '0']]
  if (search) filters.push(['name', 'like', `%${search}%`])
  const params = new URLSearchParams({
    doctype: 'Item',
    fields: JSON.stringify(['name', 'item_name']),
    filters: JSON.stringify(filters),
    limit: '30',
    order_by: 'name asc',
  })
  const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
  const data = await res.json()
  return (data?.message || []).map((r: { name: string; item_name?: string }) => ({
    name: r.name,
    label: r.item_name ? `${r.name} — ${r.item_name}` : r.name,
  }))
}

export interface InpatientPackageOption {
  name: string
  package_name: string
  package_rate: number
  no_of_days: number | null
  package_category: string
}

export async function fetchInpatientPackages(search?: string): Promise<InpatientPackageOption[]> {
  const params = new URLSearchParams()
  params.set('cmd', 'healthcare.healthcare.api.common.get_inpatient_packages')
  if (search) params.set('search', search)
  const res = await fetch(`/api/method/healthcare.healthcare.api.common.get_inpatient_packages?${params.toString()}`, { credentials: 'include' })
  if (!res.ok) return []
  const data = await res.json()
  return data.message ?? []
}

export async function fetchItemGroups(search?: string): Promise<LinkFieldOption[]> {
  const filters: [string, string, string][] = []
  if (search) filters.push(['name', 'like', `%${search}%`])
  const params = new URLSearchParams({
    doctype: 'Item Group',
    fields: JSON.stringify(['name']),
    filters: JSON.stringify(filters),
    limit: '30',
    order_by: 'name asc',
  })
  const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
  const data = await res.json()
  return (data?.message || []).map((r: { name: string }) => ({ name: r.name, label: r.name }))
}

export interface SampleCollectionLabTest {
  name: string
  lab_test_name: string
  patient_name: string
}

export interface SampleCollectionRow {
  name: string
  patient: string
  patient_name: string | null
  patient_age: string | null
  sample: string
  sample_type: string | null
  sample_uom: string | null
  collected_by: string | null
  collector_name: string | null
  collected_time: string | null
  status: string
  lab_tests: SampleCollectionLabTest[]
}

export async function fetchSampleCollections(
  search?: string,
  patient?: string,
  page = 1,
  pageSize = 20,
): Promise<SampleCollectionRow[]> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (patient) params.set('patient', patient)
  params.set('page', String(page))
  params.set('page_size', String(pageSize))
  try {
    const res = await fetch(
      `/api/method/healthcare.api.common.get_sample_collections?${params.toString()}`,
      { credentials: 'include' },
    )
    const data = await res.json()
    const msg = data?.message
    if (Array.isArray(msg)) return msg
    if (msg?.data && Array.isArray(msg.data)) return msg.data as SampleCollectionRow[]
    return []
  } catch { return [] }
}


export async function fetchNursingTemplateDisplayLabel(
  templateName: string,
  templateSource?: NursingDischargeTemplateSource
): Promise<string> {
  try {
    const result = await apiRequest<string>(
      '/api/method/healthcare.api.common.get_nursing_template_display_label',
      {
        method: 'POST',
        body: JSON.stringify({
          template_name: templateName,
          template_source: templateSource || '',
        }),
      }
    )
    return typeof result === 'string' && result.trim() ? result : templateName
  } catch {
    return templateName
  }
}

// Fetch nursing discharge templates (Discharge Nursing + Nursing Checklist Template)
export async function fetchNursingDischargeTemplates(query?: string): Promise<NursingDischargeTemplateOption[]> {
  try {
    const result = await apiRequest<NursingDischargeTemplateOption[]>(
      '/api/method/healthcare.api.common.fetch_nursing_discharge_template_options',
      {
        method: 'POST',
        body: JSON.stringify({ template_name: query || '' }),
      }
    )

    return result || []
  } catch (err) {
    console.error('Failed to fetch nursing discharge templates:', err)
    return []
  }
}

// Add this function to your common.ts service file

export async function fetchObservationLevels(query?: string): Promise<LinkFieldOption[]> {
  const params = new URLSearchParams()
  if (query) params.append('query', query)
  
  const response = await fetch(
    `/api/method/healthcare.api.common.get_observation_levels?${params.toString()}`
  )
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as LinkFieldOption[]
  } else {
    return []
  }
}
