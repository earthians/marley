export interface ECTDetail {
  name: string
  trans_num?: string
  patient: string
  patient_name?: string
  cost_center?: string
  date?: string
  time?: string
  source?: string
  duration?: number
  energy?: string
  _age?: number
  success?: string
  repeated?: string
  vitals?: string
  ecg?: string
  anathesiologist?: string
  assist_doctor?: string
  psychiatrist?: string
  nurse?: string
  doctors_name?: string
  ect_doctors_notes?: string
  date_and_time?: string
  nurse_name?: string
  ect_nurse_notes?: string
  n_date_and_time?: string
  bp_1?: string
  max_bp_1?: string
  bp_2?: string
  max_bp2?: string
  propofol_detail?: string
  succinycholine_detail?: string
  psychology_doctor?: string
  anaesthetic_doctor?: string
  reference_doctype?: string
  reference_name?: string
  creation?: string
}

export async function fetchECTDetails(
  limit: number = 50,
  offset: number = 0,
  patient?: string
): Promise<ECTDetail[]> {
  const params = new URLSearchParams()
  params.append('limit', limit.toString())
  params.append('offset', offset.toString())
  if (patient) params.append('patient', patient)

  const response = await fetch(
    `/api/method/healthcare.api.ect_details.get_ect_details?${params.toString()}`
  )
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as ECTDetail[]
  } else {
    return []
  }
}

export interface ConsolidatedECTDetail {
  patient: string
  patient_name?: string
  ect_count: number
  first_ect_date?: string
  last_ect_date?: string
}

export async function fetchConsolidatedECTDetails(
  limit: number = 100,
  offset: number = 0,
  patient?: string,
  search?: string
): Promise<ConsolidatedECTDetail[]> {
  const params = new URLSearchParams()
  params.append('limit', limit.toString())
  params.append('offset', offset.toString())
  if (patient) params.append('patient', patient)
  if (search) params.append('search', search)

  const response = await fetch(
    `/api/method/healthcare.api.ect_details.get_consolidated_ect_details?${params.toString()}`
  )
  const resData = await response.json()

  if (resData?.message && Array.isArray(resData.message)) {
    return resData.message as ConsolidatedECTDetail[]
  }
  return []
}

export async function fetchECTDetail(name: string): Promise<ECTDetail> {
  const response = await fetch(
    `/api/resource/ECT%20Details/${encodeURIComponent(name)}`
  )
  const resData = await response.json()
  if (resData?.data) {
    return resData.data as ECTDetail
  }
  if (resData?.exc) {
    throw new Error(resData.exc_type ? `${resData.exc_type}: ${resData.exc}` : resData.exc)
  }
  throw new Error('ECT Detail not found')
}

export interface CreateECTDetailData {
  trans_num?: string
  patient: string
  cost_center?: string
  date?: string
  time?: string
  source?: string
  duration?: number
  energy?: string
  _age?: number
  success?: string
  reference_doctype?: string
  reference_name?: string
  repeated?: string
  vitals?: string
  ecg?: string
  anathesiologist?: string
  assist_doctor?: string
  psychiatrist?: string
  nurse?: string
  doctors_name?: string
  ect_doctors_notes?: string
  date_and_time?: string
  nurse_name?: string
  ect_nurse_notes?: string
  n_date_and_time?: string
  bp_1?: string
  max_bp_1?: string
  bp_2?: string
  max_bp2?: string
  propofol_detail?: string
  succinycholine_detail?: string
  psychology_doctor?: string
  anaesthetic_doctor?: string
}

export async function createECTDetail(data: CreateECTDetailData): Promise<ECTDetail> {
  const { apiRequest } = await import('./apiClient')
  return apiRequest<ECTDetail>('/api/method/healthcare.api.ect_details.create_ect_detail', {
    method: 'POST',
    body: JSON.stringify({ data }),
  })
}

export async function getNextECTDetailsTransNum(): Promise<string> {
  const { apiRequest } = await import('./apiClient')
  const result = await apiRequest<string>(
    '/api/method/healthcare.api.ect_details.get_next_ect_details_trans_num',
    { method: 'POST' },
  )
  if (typeof result === 'string' && result.trim()) {
    return result.trim()
  }
  throw new Error('Failed to generate ECT trans number')
}





