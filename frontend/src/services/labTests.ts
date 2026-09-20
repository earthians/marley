export interface LabTestLine {
  sr_num?: string
  lab_group_num?: string
  group_name?: string
  lab_sub_num?: string
  lab_sub_template_name?: string
  lab_result_value?: string
  /** Reference / normal range from the child Lab Test Template */
  normal_range?: string
  lab_amt_book?: number
  lab_amt_add?: number
  lab_amt_disc?: number
  lab_amt_net?: number
  sta_flg?: number | boolean
  cr_id?: string
  cr_date?: string
  up_id?: string
  up_date?: string
  lab_04_remarks?: string
}

export interface LabTestSampleInstance {
  sample?: string
  sample_qty?: number
  sample_details?: string
  sample_collection?: string
}

export interface LabTest {
  name: string
  docstatus?: number
  patient: string
  patient_name?: string
  file_no?: string
  patient_age?: string
  patient_sex?: string
  gender?: string
  practitioner?: string
  practitioner_name?: string
  /** Legacy Oracle DOC_NUM (doctor id) — used as practitioner fallback when practitioner is missing */
  doc_no?: string
  lab_test_name?: string
  template?: string
  status?: string
  date?: string
  creation?: string
  result_date?: string
  submitted_date?: string
  /** Sample Collection link on Lab Test */
  sample?: string
  /** Legacy / imported sampling date */
  sample_collected_date?: string
  /** Earliest Sample Collection.creation when a sample is linked */
  sample_creation?: string
  /** sample_collected_date or Sample Collection.collected_time */
  sampling_date?: string
  /** Preferred display date: sample creation → sampling date → lab date */
  report_date?: string
  female_min_range?: number | null
  female_max_range?: number | null
  male_min_range?: number | null
  male_max_range?: number | null
  approved_date?: string
  expected_result_date?: string
  printed_on?: string
  invoiced?: number
  email_sent?: number | boolean
  sms_sent?: number | boolean
  printed?: number | boolean
  amended_from?: string
  department?: string
  is_outsourced?: number
  email?: string
  mobile?: string
  report_preference?: string
  inpatient_record?: string
  /** Same admission as inpatient_record (Lab Test alias). */
  inpatient_admission?: string
  service_unit?: string
  company?: string
  requesting_department?: string
  service_request?: string
  service_request_status?: string
  lab_test_group?: string
  /** Display name of the group (Lab Test Template.lab_test_name for lab_test_group). */
  lab_test_group_name?: string
  is_group_lab_test?: number
  reference_document?: string
  employee_name?: string
  employee?: string
  employee_designation?: string
  reviewed_by?: string
  reviewed_by_name?: string
  results_entered_datetime?: string
  doctor_reviewed_datetime?: string
  review_turnaround_hours?: number
  review_report_type?: string
  review_result_indicator?: string
  review_follow_up_actions?: string[] | string
  review_follow_up_other?: string
  review_comments?: string
  review_prescription_message?: string
  patient_informed_of_report?: number | boolean
  archive_report_on_review?: number | boolean
  create_task_on_review?: number | boolean
  /** Healthcare Practitioner (Lab Technologist / Lab Technician) who entered results */
  lab_technician?: string
  lab_technician_name?: string
  material_request?: string
  amount?: number
  grand_total?: number
  min_range?: number | null
  max_range?: number | null
  results?: string | null
  descriptive_result?: string
  custom_result?: string
  lab_test_comment?: string
  result_flag?: string
  /** Remarks table (Remark child): list of { rrmark } */
  remarks?: Array<{ rrmark?: string }>
  worksheet_instructions?: string
  normal_test_items?: any[]
  sensitivity_test_items?: any[]
  /** Patient Upload Document child table (same as Admission/Discharge) */
  documents?: Array<{ file_name?: string; document_type?: string; transaction_no?: string; upload_remarks?: string; document?: string }>
  /** Sample instances child table – one row per required/actual sample */
  sample_instances?: LabTestSampleInstance[]
  /** Populated after save when lab result rules run */
  rule_warnings?: Array<{
    message?: string
    short_message?: string
    title?: string
    type?: string
    ok?: boolean
  }>
  rule_errors?: Array<{
    message?: string
    short_message?: string
    title?: string
    type?: string
    block_save?: boolean
  }>
  calculated_updates?: Array<{
    name: string
    lab_test_name?: string
    custom_result: string
    status?: string
  }>
  by_nurse?: number | boolean
  /** Oracle LAB 00-03 legacy header import */
  is_legacy_import?: number | boolean
  /** Oracle LAB 00-04 child rows (attached on list + detail APIs) */
  lab_test_lines?: LabTestLine[]
  /** UI-only: flattened child row from a legacy import */
  is_legacy_line_row?: boolean
  legacy_parent_name?: string
  legacy_line_key?: string
  /** Child Lab Test Template id on a flattened legacy line row */
  legacy_sub_template?: string
}

export interface LabConsumableRow {
  item_code: string
  item_name?: string
  qty: number
  uom?: string
  warehouse?: string
}

export interface PaginatedLabTests {
  data: LabTest[]
  total_count: number
}

export async function fetchLabTests(
  limit: number = 20,
  offset: number = 0,
  patient?: string,
  status?: string,
  pending_review: boolean = false,
  is_outsourced?: boolean,
  from_date?: string,
  to_date?: string,
  template?: string,
  practitioner?: string,
  by_nurse?: boolean,
  pipeline_pending?: boolean
): Promise<PaginatedLabTests> {
  const params = new URLSearchParams()
  params.append('limit', limit.toString())
  params.append('offset', offset.toString())
  if (patient) params.append('patient', patient)
  if (status) params.append('status', status)
  if (pending_review) params.append('pending_review', '1')
  if (pipeline_pending) params.append('pipeline_pending', '1')
  if (is_outsourced !== undefined) params.append('is_outsourced', is_outsourced ? '1' : '0')
  if (from_date) params.append('from_date', from_date)
  if (to_date) params.append('to_date', to_date)
  if (template) params.append('template', template)
  if (practitioner) params.append('practitioner', practitioner)
  if (by_nurse !== undefined) params.append('by_nurse', by_nurse ? '1' : '0')

  const response = await fetch(
    `/api/method/healthcare.api.lab_test.get_lab_tests?${params.toString()}`
  )
  const resData = await response.json()
  if (resData?.message && typeof resData.message === 'object' && !Array.isArray(resData.message)) {
    return resData.message as PaginatedLabTests
  }
  if (resData?.message && Array.isArray(resData.message)) {
    return { data: resData.message as LabTest[], total_count: resData.message.length }
  }
  return { data: [], total_count: 0 }
}

export async function fetchLabTestTemplateFilterOptions(
  search?: string,
  patient?: string,
  byNurse?: boolean,
): Promise<Array<{ name: string; label: string }>> {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (patient) params.append('patient', patient)
  if (byNurse) params.append('by_nurse', '1')

  const response = await fetch(
    `/api/method/healthcare.api.lab_test.get_lab_test_template_filter_options${params.toString() ? `?${params.toString()}` : ''}`,
    { credentials: 'include' },
  )
  const resData = await response.json()
  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as Array<{ name: string; label: string }>
  }
  return []
}

export async function fetchLabTest(name: string): Promise<LabTest> {
  const response = await fetch(
    `/api/method/healthcare.api.lab_test.get_lab_test?name=${encodeURIComponent(name)}`
  )
  const resData = await response.json()

  if (resData?.message) {
    return resData.message as LabTest
  } else {
    throw new Error('Invalid response format')
  }
}

export async function getLabTestConsumables(name: string): Promise<LabConsumableRow[]> {
  const response = await fetch(
    `/api/method/healthcare.healthcare.doctype.lab_test.lab_test.get_consumables_for_lab_test?lab_test_name=${encodeURIComponent(
      name
    )}`
  )
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    // Backend returns objects with item_code, item_name, qty, uom, warehouse
    return resData.message as LabConsumableRow[]
  } else {
    return []
  }
}

export interface CreateLabTestData {
  patient: string
  cost_center: string
  template?: string
  practitioner?: string
  date?: string
  time?: string
  department?: string
  service_unit?: string
  status?: string
  /** Doctor orders once; a scheduler creates the test daily until repeat_until. */
  repeat_daily?: 0 | 1
  repeat_until?: string
  documents?: Array<{ file_name?: string; document_type?: string; transaction_no?: string; upload_remarks?: string; document?: string }>
}

export async function createLabTest(data: CreateLabTestData): Promise<LabTest> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const response = await fetch('/api/method/healthcare.api.lab_test.create_lab_test', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
    },
    body: JSON.stringify({ data })
  })

  const resData = await response.json()

  if (!response.ok) {
    const errorMessage = resData?.message?.message || resData?.message || 'Failed to create lab test'
    throw new Error(errorMessage)
  }

  if (resData?.message) {
    return resData.message as LabTest
  } else {
    throw new Error('Invalid response format')
  }
}

export async function requestLabConsumables(
  labTestName: string,
  items: LabConsumableRow[],
  company?: string,
  isMedical?: 0 | 1
): Promise<string> {
  const { apiRequest } = await import('./apiClient')

  const payload: any = {
    lab_test: labTestName,
    items,
    is_medical: isMedical,
  }

  if (company) {
    payload.company = company
  }

  const mrName = await apiRequest<string>(
    '/api/method/healthcare.api.lab_test.request_lab_consumables',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )

  return mrName
}

/** One editable row of Normal Test Result (compound / is_multiple lab test). */
export interface NormalTestResultRow {
  lab_test_name?: string
  lab_test_event?: string
  result_value?: string
  /** Vitamin D-style band: Deficiency / Insufficiency / Sufficiency / Toxicity */
  result_status?: string
  lab_test_uom?: string
  normal_range?: string
  lab_test_comment?: string
  template?: string
  secondary_uom?: string
  conversion_factor?: number
  secondary_uom_result?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  require_result_value?: boolean
  allow_blank?: boolean
  /** Frontend-only: show status select for this unit (from template multiple_result_type). */
  uses_status_bands?: boolean
  male_min_range?: number | string | null
  male_max_range?: number | string | null
  female_min_range?: number | string | null
  female_max_range?: number | string | null
}

/** Details fetched from a Lab Test Template for the result-entry UI. */
export interface LabTestTemplateDetails {
  lab_test_template_type?: string
  is_multiple?: number | boolean
  min_range?: number | null
  max_range?: number | null
  female_min_range?: number | null
  female_max_range?: number | null
  male_min_range?: number | null
  male_max_range?: number | null
  worksheet_instructions?: string
  sample_details?: string
  lab_test_uom?: string
  normal_range?: string
  /** Compound test rows from normal_test_templates child table on the template */
  normal_test_templates?: Array<{
    lab_test_event?: string
    lab_test_uom?: string
    normal_range?: string,
    female_min_range?: number | null
    male_min_range?: number | null
    female_max_range?: number | null
    male_max_range?: number | null
    result_type?: string
    result_mul_value?: string
  }>
  /** is_multiple: one result row per unit / reference set */
  multiple_result_type?: Array<{
    test_unit?: string
    uom?: string
    male_min_range?: number | string | null
    male_max_range?: number | string | null
    female_min_range?: number | string | null
    female_max_range?: number | string | null
    status?: string
    /** When set, use Deficiency/Insufficiency bands; else High/Low from ranges */
    use_status?: number | boolean
    uses_status_bands?: boolean
    normal_range?: string
  }>
  status_options?: string[]
  /**
   * Healthcare Settings.have_multiresults_on_lab_test as of this fetch.
   * Preferred over the app-load-time context value so toggling the setting takes
   * effect without reloading the whole portal.
   */
  have_multiresults_on_lab_test?: boolean
}

/** One row in the Observation Sample Collection child table. */
export interface ObservationSampleCollectionRow {
  sample?: string
  sample_type?: string
  uom?: string
  status?: string
  observation_template?: string
  collection_date_time?: string
  sample_qty?: number
  collection_point?: string
  collected_by?: string
  medical_department?: string
  specimen?: string
}

export async function fetchLabTestTemplateDetails(template: string): Promise<LabTestTemplateDetails> {
  const res = await fetch(
    `/api/method/healthcare.api.lab_test.get_lab_test_template_details?template=${encodeURIComponent(template)}`
  )
  const data = await res.json()
  return (data?.message || {}) as LabTestTemplateDetails
}

export interface SaveAndSubmitLabTestInput {
  custom_result?: string
  lab_test_comment?: string
  worksheet_instructions?: string
  documents?: Array<{ file_name?: string; document_type?: string; transaction_no?: string; upload_remarks?: string; document?: string }>
  normal_test_items?: NormalTestResultRow[]
  /** Link to Healthcare Practitioner (Lab Technologist or Lab Technician); optional when saving draft results */
  lab_technician?: string
  /** @deprecated Submit occurs on doctor review only; ignored if sent */
  submit?: boolean
  amount?: number
  discount_margin?: string
  discount?: number
  discount_amount?: number
  /** On-screen sibling results so panel sum/formula checks match the UI, not stale DB values. */
  sibling_results?: Array<{ name?: string; template?: string; lab_test_name?: string; custom_result?: string }>
}

export async function recalculatePanelForServiceRequest(
  serviceRequest: string
): Promise<Pick<LabTest, 'rule_warnings' | 'rule_errors' | 'calculated_updates'>> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<Pick<LabTest, 'rule_warnings' | 'rule_errors' | 'calculated_updates'>>(
    `/api/method/healthcare.api.lab_test_result_rules.recalculate_panel_for_service_request?service_request=${encodeURIComponent(serviceRequest)}`
  )
}

export async function saveAndSubmitLabTest(
  labTestName: string,
  payload: SaveAndSubmitLabTestInput
): Promise<LabTest> {
  const { apiRequest } = await import('./apiClient')

  const data = await apiRequest<LabTest>(
    '/api/method/healthcare.api.lab_test.save_and_submit_lab_test',
    {
      method: 'POST',
      body: JSON.stringify({
        name: labTestName,
        ...payload,
      }),
    }
  )

  return data
}

export interface UpdateLabTestBasicInput {
  template?: string
  practitioner?: string
  department?: string
  service_unit?: string
  date?: string
  time?: string
  status?: string
  priority?: string
  is_outsourced?: number
  outsource_lab_name?: string
  outsource_ref_no?: string
}

export async function updateLabTestBasic(
  labTestName: string,
  payload: UpdateLabTestBasicInput
): Promise<LabTest> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<LabTest>(
    '/api/method/healthcare.api.lab_test.update_lab_test_basic',
    {
      method: 'POST',
      body: JSON.stringify({ name: labTestName, data: payload }),
    }
  )
}

/** One row in the Lab Test remarks table (Remark child with field rrmark). */
export interface LabTestRemarkRow {
  rrmark?: string
}

export async function updateLabTestRemarks(labTestName: string, remarks: LabTestRemarkRow[]): Promise<{ name: string; remarks: LabTestRemarkRow[] }> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<{ name: string; remarks: LabTestRemarkRow[] }>(
    '/api/method/healthcare.api.lab_test.update_lab_test_remarks',
    {
      method: 'POST',
      body: JSON.stringify({ name: labTestName, remarks }),
    }
  )
}

import { apiRequest } from './apiClient'

export interface DoctorReviewFormOptions {
  report_types: string[]
  result_indicators: string[]
  follow_up_actions: string[]
}

export interface SubmitDoctorLabReviewPayload {
  lab_test_name: string
  new_status: 'Reviewed' | 'Rejected'
  review_report_type?: string
  review_result_indicator: string
  review_follow_up_actions?: string[]
  review_follow_up_other?: string
  review_comments?: string
  review_prescription_message?: string
  patient_informed_of_report?: number
  archive_report_on_review?: number
  create_task_on_review?: number
}

export interface LabReviewTurnaroundMetrics {
  reviewed_count: number
  pending_review_count: number
  avg_turnaround_hours: number
  min_turnaround_hours: number
  max_turnaround_hours: number
}

export async function fetchDoctorReviewFormOptions(): Promise<DoctorReviewFormOptions> {
  return apiRequest<DoctorReviewFormOptions>(
    '/api/method/healthcare.api.lab_test_doctor_review.get_doctor_review_form_options'
  )
}

export async function submitDoctorLabTestReview(
  payload: SubmitDoctorLabReviewPayload
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(
    '/api/method/healthcare.api.lab_test_doctor_review.submit_doctor_lab_test_review',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
}

export async function fetchLabReviewTurnaroundMetrics(params?: {
  from_date?: string
  to_date?: string
  company?: string
  cost_center?: string
}): Promise<LabReviewTurnaroundMetrics> {
  const qs = new URLSearchParams()
  if (params?.from_date) qs.append('from_date', params.from_date)
  if (params?.to_date) qs.append('to_date', params.to_date)
  if (params?.company) qs.append('company', params.company)
  if (params?.cost_center) qs.append('cost_center', params.cost_center)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiRequest<LabReviewTurnaroundMetrics>(
    `/api/method/healthcare.api.lab_test_doctor_review.get_lab_review_turnaround_metrics${suffix}`
  )
}

/** @deprecated Use submitDoctorLabTestReview — requires structured review fields */
export async function updateLabTestStatus(
  lab_test_name: string,
  new_status: 'Reviewed' | 'Rejected'
): Promise<void> {
  await apiRequest<void>(
    '/api/method/healthcare.api.lab_test.update_lab_test_status',
    {
      method: 'POST',
      body: JSON.stringify({
        lab_test_name,
        new_status,
      }),
    }
  )
}

export async function finishGroupLabTests(
  serviceRequestName: string,
  labTestGroup?: string
): Promise<{
  ok: boolean
  service_request: string
  finished: boolean
  lab_test_group?: string
  request_finished?: boolean
  already_finished?: boolean
}> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<{
    ok: boolean
    service_request: string
    finished: boolean
    lab_test_group?: string
    request_finished?: boolean
    already_finished?: boolean
  }>('/api/method/healthcare.api.lab_test.finish_group_lab_tests', {
    method: 'POST',
    body: JSON.stringify({
      service_request_name: serviceRequestName,
      ...(labTestGroup ? { lab_test_group: labTestGroup } : {}),
    }),
  })
}

export const SAMPLE_COLLECTION_EDITABLE_LAB_TEST_STATUSES = new Set([
  'Awaiting sample collection',
  'Sample Collection in Progress',
  'Sample Collected',
  'Sample collection in progress',
])

/** Statuses where sample collection is not finished yet — results stay locked. */
export const LAB_TEST_PRE_SAMPLE_COLLECTION_STATUSES = new Set([
  'Draft',
  'Requested',
  'Awaiting sample collection',
  'Sample Collection in Progress',
  'Sample collection in progress',
])

export const AD_HOC_SAMPLE_COLLECTION_LAB_TEST_STATUSES = new Set(['Requested', 'Draft'])

export function canRecordAdHocSampleCollection(labTest: {
  status?: string | null
  docstatus?: number
}): boolean {
  if ((labTest.docstatus ?? 0) >= 1) return false
  const status = (labTest.status || '').trim()
  if (canEditLabTestSampleCollection(status)) return true
  return AD_HOC_SAMPLE_COLLECTION_LAB_TEST_STATUSES.has(status)
}

export function canEditLabTestSampleCollection(status?: string | null): boolean {
  if (!status) return false
  return SAMPLE_COLLECTION_EDITABLE_LAB_TEST_STATUSES.has(status.trim())
}

/** True once sample collection is done (Sample Collected or any later workflow status). */
export function isLabTestSampleCollectionDone(labTest: {
  status?: string | null
}): boolean {
  const status = (labTest.status || '').trim()
  if (!status) return false
  if (LAB_TEST_PRE_SAMPLE_COLLECTION_STATUSES.has(status)) return false
  if (status === 'Cancelled') return false
  return true
}

export interface LabSampleCollectionFormData {
  sample_collection: string
  sample?: string
  sample_qty?: number
  sample_details?: string
  collection_point?: string
  collected_by?: string
  collected_by_name?: string
  referring_practitioner?: string
  referring_practitioner_name?: string
  observation_rows?: ObservationSampleCollectionRow[]
  lab_test_status?: string
}

export async function getSampleCollectionForLabSample(
  labTestName: string,
  rowIndex: number
): Promise<LabSampleCollectionFormData> {
  const params = new URLSearchParams({
    lab_test_name: labTestName,
    row_index: String(rowIndex),
  })
  const { apiRequest } = await import('./apiClient')
  return apiRequest<LabSampleCollectionFormData>(
    `/api/method/healthcare.api.lab_test.get_sample_collection_for_lab_sample?${params.toString()}`
  )
}

export async function createSampleCollectionForLabSample(
  labTestName: string,
  rowIndex: number,
  sampleDetails?: string,
  collectionPoint?: string,
  referringPractitioner?: string,
  observationRows?: ObservationSampleCollectionRow[],
  sampleQty?: number,
  collectedBy?: string
): Promise<{ sample_collection: string }> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<{ sample_collection: string }>(
    '/api/method/healthcare.api.lab_test.create_sample_collection_for_lab_sample',
    {
      method: 'POST',
      body: JSON.stringify({
        lab_test_name: labTestName,
        row_index: rowIndex,
        sample_details: sampleDetails,
        collection_point: collectionPoint,
        referring_practitioner: referringPractitioner,
        observation_rows: observationRows?.length ? observationRows : undefined,
        sample_qty: sampleQty,
        collected_by: collectedBy,
      }),
    }
  )
}

/** Apply sample collection to eligible child Lab Tests in one lab-request group. */
export async function createSampleCollectionForLabGroup(
  serviceRequestName: string,
  sampleDetails?: string,
  collectionPoint?: string,
  referringPractitioner?: string,
  sampleQty?: number,
  collectedBy?: string,
  labTestGroup?: string
): Promise<{
  updated: string[]
  skipped: string[]
  count: number
  sample_collections: string[]
  lab_test_group?: string | null
}> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest(
    '/api/method/healthcare.api.lab_test.create_sample_collection_for_lab_group',
    {
      method: 'POST',
      body: JSON.stringify({
        service_request_name: serviceRequestName,
        sample_details: sampleDetails,
        collection_point: collectionPoint,
        referring_practitioner: referringPractitioner,
        sample_qty: sampleQty,
        collected_by: collectedBy,
        ...(labTestGroup ? { lab_test_group: labTestGroup } : {}),
      }),
    }
  )
}

/** Apply sample collection to every eligible Lab Test on the selected Lab Requests. */
export async function createSampleCollectionForLabRequests(
  serviceRequestNames: string[],
  sampleDetails?: string
): Promise<{
  updated: string[]
  skipped: string[]
  count: number
  sample_collections: string[]
  requests: Array<{ name: string; updated: number; skipped: number; error?: string | null }>
  request_count: number
}> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest(
    '/api/method/healthcare.api.lab_test.create_sample_collection_for_lab_requests',
    {
      method: 'POST',
      body: JSON.stringify({
        service_request_names: serviceRequestNames,
        sample_details: sampleDetails,
      }),
    }
  )
}

export async function updateSampleCollectionForLabSample(
  labTestName: string,
  rowIndex: number,
  sampleDetails?: string,
  collectionPoint?: string,
  referringPractitioner?: string,
  observationRows?: ObservationSampleCollectionRow[],
  sampleQty?: number,
  collectedBy?: string
): Promise<{ sample_collection: string }> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<{ sample_collection: string }>(
    '/api/method/healthcare.api.lab_test.update_sample_collection_for_lab_sample',
    {
      method: 'POST',
      body: JSON.stringify({
        lab_test_name: labTestName,
        row_index: rowIndex,
        sample_details: sampleDetails,
        collection_point: collectionPoint,
        referring_practitioner: referringPractitioner,
        observation_rows: observationRows?.length ? observationRows : undefined,
        sample_qty: sampleQty,
        collected_by: collectedBy,
      }),
    }
  )
}


export function getLabTestUrl(name: string): string {
  return `/healthcare/lab-test/${name}`
}


export async function fetchLabTestsByInpatientRecord(
  inpatientRecord: string
): Promise<LabTest[]> {
  if (!inpatientRecord) {
    console.error('Inpatient record ID is required')
    return []
  }

  try {
    const response = await fetch(
      `/api/method/healthcare.api.lab_test.get_lab_tests_by_inpatient_record?inpatient_record=${encodeURIComponent(inpatientRecord)}`
    )
    const resData = await response.json()
    console.log('Fetch lab tests by inpatient record response:', resData)
    if (resData?.message && Array.isArray(resData.message)) {
      return resData.message as LabTest[]
    }
    
    return []
  } catch (error) {
    console.error('Failed to fetch lab tests by inpatient record:', error)
    return []
  }
}

export async function fetchLabTestsByPatientVisit(patientVisit: string): Promise<LabTest[]> {
  if (!patientVisit) return []
  try {
    const response = await fetch(
      `/api/method/healthcare.api.lab_test.get_lab_tests_by_patient_visit?patient_visit=${encodeURIComponent(patientVisit)}`,
      { credentials: 'include', headers: { Accept: 'application/json' } },
    )
    const resData = await response.json()
    if (resData?.message && Array.isArray(resData.message)) {
      return resData.message as LabTest[]
    }
    return []
  } catch (error) {
    console.error('Failed to fetch lab tests by patient visit:', error)
    return []
  }
}

// NEW: Fetch lab test by ID
export async function fetchLabTestById(name: string): Promise<LabTest | null> {
  if (!name) {
    throw new Error('Lab test ID is required')
  }

  try {
    const response = await fetch(
      `/api/method/healthcare.api.lab_test.get_lab_test_by_id?name=${encodeURIComponent(name)}`
    )
    const resData = await response.json()
    
    if (resData?.message) {
      return resData.message as LabTest
    }
    
    return null
  } catch (error) {
    console.error('Failed to fetch lab test:', error)
    throw error
  }
}

export interface LabHistoryMatrixColumn {
  key: string
  date: string
  time?: string
  lab_test: string
  lab_test_name?: string
  status?: string
}

export interface LabHistoryMatrixCell {
  value: string
  flag: 'normal' | 'abnormal' | 'neutral'
  direction?: 'high' | 'low' | null
  lab_test?: string
}

export interface LabHistoryMatrixRow {
  key: string
  label: string
  uom?: string
  /** Parent panel/group template code when this row is a child analyte. */
  group_key?: string
  /** Display name for the parent group (e.g. CBC). */
  group_label?: string
  cells: Record<string, LabHistoryMatrixCell>
}

export interface LabHistoryMatrixResponse {
  columns: LabHistoryMatrixColumn[]
  rows: LabHistoryMatrixRow[]
  patient: string
  patient_name?: string
}

export async function fetchLabTestHistoryMatrix(params: {
  patient: string
  from_date?: string
  to_date?: string
  test_search?: string
  template?: string
}): Promise<LabHistoryMatrixResponse> {
  const qs = new URLSearchParams()
  qs.set('patient', params.patient)
  if (params.from_date) qs.set('from_date', params.from_date)
  if (params.to_date) qs.set('to_date', params.to_date)
  if (params.test_search) qs.set('test_search', params.test_search)
  if (params.template) qs.set('template', params.template)

  const response = await fetch(
    `/api/method/healthcare.api.lab_test.get_lab_test_history_matrix?${qs.toString()}`
  )
  const resData = await response.json()
  if (resData?.exc) {
    throw new Error(typeof resData.message === 'string' ? resData.message : 'Failed to load lab history')
  }
  return (resData?.message || { columns: [], rows: [], patient: params.patient }) as LabHistoryMatrixResponse
}

export async function fetchLabTestSummaryHtml(opts: {
  dateFrom?: string
  dateTo?: string
  costCenter?: string
}): Promise<string> {
  const params = new URLSearchParams()
  if (opts.dateFrom) params.set('date_from', opts.dateFrom)
  if (opts.dateTo) params.set('date_to', opts.dateTo)
  if (opts.costCenter) params.set('cost_center', opts.costCenter)
  const res = await fetch(
    `/api/method/healthcare.api.lab_test_summary_print.get_lab_test_summary_html?${params}`,
    { credentials: 'include' }
  )
  const data = await res.json()
  if (data?.exception) {
    let message = 'Failed to build lab test summary report'
    try {
      const raw = data._server_messages
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      const first = Array.isArray(parsed) ? parsed[0] : parsed
      const obj = typeof first === 'string' ? JSON.parse(first) : first
      if (obj?.message) message = String(obj.message)
    } catch {
      if (typeof data.message === 'string' && data.message.trim()) message = data.message
    }
    throw new Error(message)
  }
  const msg = data?.message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg && typeof msg === 'object' && typeof (msg as { html?: string }).html === 'string') {
    return (msg as { html: string }).html
  }
  throw new Error('Invalid lab test summary report response')
}

export async function fetchLabResultAssessmentHtml(opts: {
  dateFrom?: string
  dateTo?: string
  costCenter?: string
}): Promise<string> {
  const params = new URLSearchParams()
  if (opts.dateFrom) params.set('date_from', opts.dateFrom)
  if (opts.dateTo) params.set('date_to', opts.dateTo)
  if (opts.costCenter) params.set('cost_center', opts.costCenter)
  const res = await fetch(
    `/api/method/healthcare.api.lab_result_assessment_print.get_lab_result_assessment_html?${params}`,
    { credentials: 'include' }
  )
  const data = await res.json()
  if (data?.exception) {
    let message = 'Failed to build lab result report'
    try {
      const raw = data._server_messages
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      const first = Array.isArray(parsed) ? parsed[0] : parsed
      const obj = typeof first === 'string' ? JSON.parse(first) : first
      if (obj?.message) message = String(obj.message)
    } catch {
      if (typeof data.message === 'string' && data.message.trim()) message = data.message
    }
    throw new Error(message)
  }
  const msg = data?.message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg && typeof msg === 'object' && typeof (msg as { html?: string }).html === 'string') {
    return (msg as { html: string }).html
  }
  throw new Error('Invalid lab result report response')
}

export async function fetchLabMasterListHtml(opts?: { costCenter?: string }): Promise<string> {
  const params = new URLSearchParams()
  if (opts?.costCenter) params.set('cost_center', opts.costCenter)
  const qs = params.toString()
  const res = await fetch(
    `/api/method/healthcare.api.lab_master_list_print.get_lab_master_list_html${qs ? `?${qs}` : ''}`,
    { credentials: 'include' },
  )
  const data = await res.json()
  if (data?.exception) {
    let message = 'Failed to build lab master list'
    try {
      const raw = data._server_messages
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      const first = Array.isArray(parsed) ? parsed[0] : parsed
      const obj = typeof first === 'string' ? JSON.parse(first) : first
      if (obj?.message) message = String(obj.message)
    } catch {
      if (typeof data.message === 'string' && data.message.trim()) message = data.message
    }
    throw new Error(message)
  }
  const msg = data?.message
  if (typeof msg === 'string' && msg.trim()) return msg
  throw new Error('Invalid lab master list response')
}

