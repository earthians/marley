import { apiRequest } from './apiClient'

export type OpTimelineProgressNote = {
  name: string
  posting_date?: string
  practitioner?: string
  practitioner_name?: string
  username?: string
  user?: string
  clinical_note_type?: string
  note?: string
  reference_document?: string
}

export type OpTimelineMedication = {
  drug?: string
  drug_name?: string
  dosage?: string
  uom?: string
  frequency?: string
  instructions?: string
  status?: string
}

export type OpTimelinePrescription = {
  name: string
  posting_date?: string
  status?: string
  practitioner?: string
  healthcare_practitioner_name?: string
  patient_encounter?: string
  care_context?: string
  medications?: OpTimelineMedication[]
}

export type OpClinicalEpisode = {
  visit: string | null
  /** Oracle visit num / history id when this episode comes from Visit History only. */
  visit_history?: string | null
  visit_num?: string | null
  encounter_date?: string | null
  status?: string | null
  visit_type?: string | null
  practitioner?: string | null
  practitioner_name?: string | null
  patient_name?: string | null
  cost_center?: string | null
  progress_notes: OpTimelineProgressNote[]
  prescriptions: OpTimelinePrescription[]
  has_clinical: boolean
  orphan?: boolean
  /** True when episode is from VISIT_00_01_HISTORY on a date with no Patient Visit. */
  is_legacy?: boolean
  legacy?: boolean
}

export type OpClinicalTimeline = {
  patient: string
  patient_name?: string
  episodes: OpClinicalEpisode[]
  episode_count: number
  has_data: boolean
}

export async function fetchOpClinicalTimeline(patient: string): Promise<OpClinicalTimeline> {
  const data = await apiRequest<OpClinicalTimeline>(
    `/api/method/healthcare.api.op_clinical_timeline.get_op_clinical_timeline?patient=${encodeURIComponent(patient)}&limit=100`,
  )
  if (!data || typeof data !== 'object') {
    throw new Error('Failed to load OP clinical timeline')
  }
  return {
    patient: data.patient || patient,
    patient_name: data.patient_name,
    episodes: Array.isArray(data.episodes) ? data.episodes : [],
    episode_count: Number(data.episode_count || 0),
    has_data: Boolean(data.has_data),
  }
}
