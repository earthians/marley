export interface ServiceRequest {
  name: string
  patient: string
  patient_name?: string
  practitioner?: string
  practitioner_name?: string
  assigned_healthcare_practioner?: string
  assigned_practitioner_name?: string
  template_dt?: string
  template_dn?: string
  template_name?: string
  status?: string
  /** UI-only virtual status for Lab Requests (booked / sample-collected / partial-sample-collected / partial-results / completed-tests / completed-request) */
  virtual_status?: string
  order_date?: string
  order_time?: string
  occurrence_date?: string
  occurrence_time?: string
  medical_department?: string
  billing_status?: string
  priority?: string
  intent?: string
  patient_accepted_cost?: boolean | number
  booked?: boolean | number
  order_group?: string
  cost_center?: string
  cost?: number
  amount?: number
  grand_total?: number
  discount?: number
  /** 1 when any template on this Lab Request is a By Nurse template. */
  by_nurse?: number
  /** Raw JSON / parsed basket; may include per-line ``finished`` from Complete. */
  lab_request_items?: string | Array<Record<string, unknown>>
  lab_request_groups?: Array<{
    template: string
    label: string
    children: Array<{ template: string; label: string }>
  }>
  /** Set when IP auto-book ran on create (Healthcare Settings). */
  auto_booked?: boolean
  auto_book_error?: string
  lab_tests_count?: number
  lab_tests?: string[]
  sales_order?: string
}

const GROUP_FINISHED_SR_STATUS = 'completed-Request Status'

function parseLabRequestItemsRaw(raw: unknown): Array<Record<string, unknown>> {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        : []
    } catch {
      return []
    }
  }
  return []
}

function labRequestItemKey(item: Record<string, unknown>): string {
  const kind = String(item.kind || '')
    .trim()
    .toLowerCase()
  if (kind === 'group') return String(item.parent || '').trim()
  return String(item.template || '').trim()
}

/**
 * UI-only: all lines on a booked Lab Request were marked Complete (or SR already finished).
 * Does not change backend status — list still treats the request as Booked.
 */
export function isLabRequestTestsCompletedUi(sr: {
  status?: string
  lab_request_items?: unknown
}): boolean {
  if ((sr.status || '').trim() === GROUP_FINISHED_SR_STATUS) return true
  const items = parseLabRequestItemsRaw(sr.lab_request_items)
  const lines = items.filter((item) => labRequestItemKey(item))
  if (!lines.length) return false
  return lines.every((item) => Number(item.finished) === 1)
}

export interface PaginatedServiceRequests {
  data: ServiceRequest[]
  total_count: number
}

export async function fetchServiceRequests(
  limit: number = 20,
  offset: number = 0,
  patient?: string,
  template_dt?: string,
  status?: string,
  search?: string,
  practitioner?: string,
  patientSearch?: string,
  patientVisit?: string,
  inpatientRecord?: string,
  booked?: boolean | number,
  patientCareType?: string,
  virtualStatus?: string,
  costCenter?: string,
): Promise<PaginatedServiceRequests> {
  const params = new URLSearchParams()
  params.append('limit', limit.toString())
  params.append('offset', offset.toString())
  if (patient) params.append('patient', patient)
  if (template_dt) params.append('template_dt', template_dt)
  if (status) params.append('status', status)
  if (search) params.append('search', search)
  if (practitioner) params.append('practitioner', practitioner)
  if (patientSearch?.trim()) params.append('patient_search', patientSearch.trim())
  if (patientVisit) params.append('patient_visit', patientVisit)
  if (inpatientRecord) params.append('inpatient_record', inpatientRecord)
  if (booked !== undefined && booked !== null) {
    params.append('booked', Number(booked) ? '1' : '0')
  }
  if (patientCareType?.trim()) params.append('patient_care_type', patientCareType.trim().toUpperCase())
  if (virtualStatus?.trim()) params.append('virtual_status', virtualStatus.trim())
  if (costCenter?.trim()) params.append('cost_center', costCenter.trim())

  const response = await fetch(
    `/api/method/healthcare.api.service_request.get_service_requests?${params.toString()}`
  )
  const resData = await response.json()

  if (resData?.message && typeof resData.message === 'object' && !Array.isArray(resData.message)) {
    return resData.message as PaginatedServiceRequests
  }
  if (resData?.message && Array.isArray(resData.message)) {
    return { data: resData.message as ServiceRequest[], total_count: resData.message.length }
  }
  return { data: [], total_count: 0 }
}

/** Fetch a single Service Request by name (for edit modal). */
export async function fetchServiceRequest(name: string): Promise<Record<string, unknown>> {
  const response = await fetch(
    `/api/method/healthcare.api.service_request.get_service_request?name=${encodeURIComponent(name)}`
  )
  const resData = await response.json()
  if (resData?.message && typeof resData.message === 'object') {
    return resData.message as Record<string, unknown>
  }
  if (resData?.exc) {
    throw new Error(resData?.message || resData?.exc || 'Failed to fetch service request')
  }
  throw new Error('Failed to fetch service request')
}

export interface LabRequestReviewTest {
  template: string
  test_code: string
  test_name: string
  price: number
  result_type: string
  uom: string
  min_value?: string | null
  max_value?: string | null
  normal_range?: string
  price_included_in_group?: number
  lab_test?: string | null
  lab_test_status?: string | null
  lab_test_docstatus?: number | null
  sample_collection?: string | null
  custom_result?: string | null
  /** High/Low/Normal or Use Status marks (Deficiency, Toxicity, …). */
  result_flag?: string | null
}

export interface LabRequestReviewGroup {
  kind: 'group' | 'single' | string
  template: string
  group_code: string
  group_name: string
  is_group?: number
  /** Set when this group was marked Complete (per-group; request may still be Booked). */
  finished?: number
  tests: LabRequestReviewTest[]
  test_count: number
  total_price: number
}

export interface LabRequestReview {
  name: string
  patient: string
  patient_name?: string
  file_no?: string
  sex?: string
  age?: string
  id_number?: string
  nationality?: string
  practitioner?: string
  practitioner_name?: string
  status?: string
  /** Raw Service Request.status (for Finish Group / finished tracking). */
  service_request_status?: string
  booked?: number
  order_date?: string
  order_time?: string
  template_name?: string
  cost_center?: string
  groups: LabRequestReviewGroup[]
  group_count: number
  test_count: number
  total_price: number
  /** When true, hide Collect Sample on child tests; keep it on group rows. */
  remove_collect_sample_button_from_child_test?: boolean
  lab_tests?: Array<{
    name: string
    template?: string
    lab_test_name?: string
    status?: string
    docstatus?: number
    sample_collection?: string
    is_group_lab_test?: number
    lab_test_group?: string
    patient?: string
    patient_name?: string
    practitioner?: string
    practitioner_name?: string
  }>
}

/** Lab page only: booked Lab Request review (groups + child tests). */
export async function fetchLabRequestReview(name: string): Promise<LabRequestReview> {
  const response = await fetch(
    `/api/method/healthcare.api.service_request.get_lab_request_review?name=${encodeURIComponent(name)}`
  )
  const resData = await response.json()
  if (resData?.message && typeof resData.message === 'object') {
    return resData.message as LabRequestReview
  }
  const msg =
    (typeof resData?.message === 'string' && resData.message) ||
    resData?._server_messages ||
    'Failed to load Lab Request'
  throw new Error(typeof msg === 'string' ? msg : 'Failed to load Lab Request')
}

export interface UpdateServiceRequestData {
  patient?: string
  template_dt?: string
  template_dn?: string
  practitioner?: string
  patient_visit?: string
  inpatient_record?: string
  order_date?: string
  order_time?: string
  department?: string
  medical_department?: string
  status?: string
  priority?: string
  intent?: string
  quantity?: number
  occurrence_date?: string
  occurrence_time?: string
  order_group?: string
  order_description?: string
  patient_instructions?: string
  expected_date?: string
  amount?: number
  cost?: number | null
  source?: string
  referring_practitioner?: string
  referred_to_practitioner?: string
  staff_role?: string
  patient_care_type?: string
  healthcare_service_unit_type?: string
  as_needed?: boolean
  dosage_form?: string
  dosage?: string
  period?: string
  cost_center?: string
  patient_category?: string
  discount?: number
  discount_margin?: string
  discount_value?: string
  discount_amount?: number
  /** One request-level fixed discount, applied after any per-test discounts. */
  general_discount_amount?: number
  grand_total?: number
  lab_request_items?: LabRequestItem[]
}

/** Update an existing Service Request. */
export async function updateServiceRequest(
  name: string,
  data: UpdateServiceRequestData
): Promise<{
  name: string
  status?: string
  sales_order_recreated?: boolean
  sales_order?: string
  previous_sales_order?: string | null
  cancelled_sales_invoices?: string[]
}> {
  const { ensureCSRF } = await import('./apiClient')
  const { frappeErrorMessage } = await import('../utils/frappeErrorMessage')
  const csrf = await ensureCSRF()
  const response = await fetch(
    '/api/method/healthcare.api.service_request.update_service_request',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ name, data }),
    }
  )
  const resData = await response.json()
  if (resData?.message && typeof resData.message === 'object' && !resData?.exc) {
    return resData.message
  }
  if (resData?.exc || !response.ok) {
    throw new Error(
      frappeErrorMessage(resData ?? {}, 'Could not update the lab request. Please try again.')
    )
  }
  throw new Error('Could not update the lab request. Please try again.')
}

export type CreateLabTestResult =
  | { is_group: false; name: string; patient: string; patient_name?: string; template?: string; lab_test_name?: string; status?: string }
  | { is_group: true; lab_tests: { name: string; patient: string; patient_name?: string; template?: string; lab_test_name?: string; status?: string }[]; count: number }

export async function createLabTestFromServiceRequest(serviceRequestName: string): Promise<CreateLabTestResult> {
  const { ensureCSRF } = await import('./apiClient')
  const { frappeErrorMessage } = await import('../utils/frappeErrorMessage')
  const csrf = await ensureCSRF()
  const response = await fetch(
    `/api/method/healthcare.api.service_request.create_lab_test_from_service_request?service_request=${encodeURIComponent(serviceRequestName)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
      }
    }
  )
  const resData = await response.json()

  if (resData?.message) {
    return resData.message
  }
  throw new Error(
    frappeErrorMessage(resData ?? {}, 'Failed to create lab test from service request.')
  )
}

/** Per-test discount fields stored on lab basket JSON */
export interface LabLineDiscountFields {
  discount_type?: 'Percentage' | 'Amount'
  discount_rate?: number
  discount?: number
}

/** One line in a multi-test lab service request basket */
export type LabRequestItem =
  | ({ kind: 'single'; template: string } & LabLineDiscountFields)
  | ({
      kind: 'group'
      parent: string
      children: string[]
      child_discounts?: Record<string, LabLineDiscountFields>
    } & LabLineDiscountFields)

export interface CreateServiceRequestData {
  patient: string
  template_dt: string
  template_dn: string
  practitioner?: string
  assigned_healthcare_practioner?: string
  patient_visit?: string
  inpatient_record?: string
  /** OP or IP — selects Lab Test Template op_rate vs lab_test_rate (IP Rate). */
  patient_care_type?: string
  order_date?: string
  order_time?: string
  department?: string
  status?: string
  priority?: string
  intent?: string
  quantity?: number
  occurrence_date?: string
  occurrence_time?: string
  cost_center?: string
  cost?: number | null
  discount?: number
  discount_margin?: string
  discount_value?: string
  discount_amount?: number
  /** One request-level fixed discount, applied after any per-test discounts. */
  general_discount_amount?: number
  grand_total?: number
  selected_group_templates?: string[]
  lab_request_items?: LabRequestItem[]
}

export interface MultiLabPricingLine {
  template: string
  lab_test_name?: string
  parent_group?: string | null
  parent_group_name?: string | null
  amount: number
  discount_type?: string
  discount_rate?: number
  discount?: number
  discount_applied?: number
  net_amount?: number
  billed_from_parent_group?: number
  billing_only?: number
  price_included_in_group?: number
}

export interface MultiLabRequestPricing {
  lines: MultiLabPricingLine[]
  subtotal: number
  grand_total?: number
  discount_amount?: number
  summary?: string
}

export async function getMultiLabRequestPricing(
  items: LabRequestItem[],
  patient: string,
  patientCareType?: 'OP' | 'IP'
): Promise<MultiLabRequestPricing> {
  const params = new URLSearchParams()
  params.append('items', JSON.stringify(items))
  params.append('patient', patient)
  if (patientCareType) params.append('patient_care_type', patientCareType)
  const response = await fetch(
    `/api/method/healthcare.api.service_request.get_multi_lab_request_pricing?${params.toString()}`
  )
  const resData = await response.json()
  if (resData?.message && typeof resData.message === 'object') {
    return resData.message as MultiLabRequestPricing
  }
  return { lines: [], subtotal: 0 }
}

export async function createServiceRequest(data: CreateServiceRequestData): Promise<ServiceRequest> {
  const { ensureCSRF } = await import('./apiClient')
  const { frappeErrorMessage } = await import('../utils/frappeErrorMessage')
  const csrf = await ensureCSRF()
  const response = await fetch(
    '/api/method/healthcare.api.service_request.create_service_request',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
      },
      body: JSON.stringify({ data })
    }
  )
  const resData = await response.json()

  if (resData?.message) {
    return resData.message as ServiceRequest
  }
  throw new Error(frappeErrorMessage(resData ?? {}, 'Failed to create service request. Please check required fields.'))
}

/** Confirm payment (patient accepted cost). Required before Book Lab for Lab Test Template. */
export async function confirmPayment(serviceRequestName: string): Promise<{ ok: boolean; patient_accepted_cost: number }> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const response = await fetch(
    `/api/method/healthcare.api.service_request.confirm_payment?service_request_name=${encodeURIComponent(serviceRequestName)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
      },
      credentials: 'include'
    }
  )
  const resData = await response.json()
  if (resData?.message) return resData.message
  throw new Error(resData?.exc || 'Failed to confirm payment')
}

/** Book Lab: forward to laboratory and reflect approved amount on Patient Visit. Only for Lab Test Template when payment confirmed. */
export async function bookLabAndForward(serviceRequestName: string): Promise<{ lab_test?: string; lab_tests?: string[]; count?: number; patient_visit?: string }> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const response = await fetch(
    '/api/method/healthcare.healthcare.doctype.service_request.service_request.book_lab_and_forward',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
      },
      body: JSON.stringify({ service_request_name: serviceRequestName }),
      credentials: 'include'
    }
  )
  const resData = await response.json()
  if (resData?.message) return resData.message
  throw new Error(resData?.exc || 'Failed to book lab')
}

export async function confirmSessionPayment(serviceRequestName: string): Promise<{ ok: boolean }> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const response = await fetch(
    `/api/method/healthcare.api.service_request.confirm_session_payment?service_request_name=${encodeURIComponent(serviceRequestName)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      credentials: 'include',
    }
  )
  const resData = await response.json()
  if (resData?.message?.ok) return resData.message
  throw new Error(resData?.exc || 'Failed to confirm payment')
}

export async function bookSession(serviceRequestName: string, appointment?: string): Promise<{ ok: boolean; created?: { doctype: string; name: string } }> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const params = new URLSearchParams({ service_request_name: serviceRequestName })
  if (appointment) params.append('appointment', appointment)
  const response = await fetch(
    `/api/method/healthcare.api.service_request.book_session?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      credentials: 'include',
    }
  )
  const resData = await response.json()
  if (resData?.message?.ok) return resData.message
  throw new Error(resData?.exc || 'Failed to book session')
}



