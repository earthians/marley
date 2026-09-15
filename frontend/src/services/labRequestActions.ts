import { apiRequest } from './apiClient'

export type LabRequestPhase =
  | 'draft_unpaid'
  | 'paid_not_booked'
  | 'booked_pre_sample'
  | 'sample_collected'
  | 'post_sample'
  | 'cancelled'

export interface LabRequestActions {
  service_request: string
  phase: LabRequestPhase
  can_delete: boolean
  can_cancel_with_settlement: boolean
  can_cancel_simple?: boolean
  requires_settlement?: boolean
  can_cancel_sample_handling: boolean
  can_delete_lab_tests: boolean
  can_delete_lab_request: boolean
  /** False once any linked lab test has sample collection. */
  can_edit_lab_request?: boolean
  lab_tests: Array<{
    name: string
    status?: string
    has_sample_collected?: boolean
    past_sample_collection?: boolean
    can_cancel_sample_handling?: boolean
    can_delete?: boolean
  }>
}

export async function fetchLabRequestActions(serviceRequestName: string): Promise<LabRequestActions> {
  const params = new URLSearchParams()
  params.append('service_request_name', serviceRequestName)
  const res = await fetch(
    `/api/method/healthcare.api.lab_request_actions.get_lab_request_actions?${params.toString()}`
  )
  const data = await res.json()
  if (data?.exc || !res.ok) {
    throw new Error(data?.message || data?.exc || 'Failed to load lab request actions')
  }
  return data.message as LabRequestActions
}

export async function deleteDraftLabRequest(serviceRequestName: string): Promise<{ deleted: boolean }> {
  return apiRequest('/api/method/healthcare.api.lab_request_actions.delete_draft_lab_request', {
    method: 'POST',
    body: JSON.stringify({ service_request_name: serviceRequestName }),
  })
}

export async function cancelBookedLabRequest(
  serviceRequestName: string,
  settlementMode?: 'refund' | 'patient_credit' | null
): Promise<{
  ok: boolean
  settlement_mode?: string | null
  requires_settlement?: boolean
  payment_entry?: string | null
}> {
  return apiRequest('/api/method/healthcare.api.lab_request_actions.cancel_booked_lab_request', {
    method: 'POST',
    body: JSON.stringify({
      service_request_name: serviceRequestName,
      settlement_mode: settlementMode || undefined,
    }),
  })
}

export async function cancelLabSampleHandling(args: {
  serviceRequestName?: string
  labTestName?: string
}): Promise<{ ok: boolean; sample_collections_cancelled?: string[] }> {
  return apiRequest('/api/method/healthcare.api.lab_request_actions.cancel_lab_sample_handling', {
    method: 'POST',
    body: JSON.stringify({
      service_request_name: args.serviceRequestName,
      lab_test_name: args.labTestName,
    }),
  })
}

export async function deleteRequestedLabTest(labTestName: string): Promise<{
  deleted: boolean
  lab_test: string
  deleted_service_request?: boolean
  service_request?: string
  payment_entry?: string | null
}> {
  return apiRequest('/api/method/healthcare.api.lab_request_actions.delete_requested_lab_test', {
    method: 'POST',
    body: JSON.stringify({ lab_test_name: labTestName }),
  })
}
