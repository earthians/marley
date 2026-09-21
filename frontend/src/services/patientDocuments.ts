/** One document / signature stored anywhere for a patient. */
export interface PatientDocumentEntry {
  /** Stable unique key (doctype::doc::field::url). */
  name: string
  /** Where it is stored, e.g. "Admission e-Signature", "Legacy Scan", "Patient Visit Document". */
  source: string
  source_doctype: string
  source_name: string
  /** Owning record (visit / admission / lab test / form) name. */
  reference: string
  fieldname: string
  /** Human label of the field that holds the file. */
  field_label: string
  document: string
  date?: string
  is_signature?: number | boolean
  document_type?: string
  file_name?: string
  document_name?: string
  transaction_no?: string
  upload_remarks?: string
  patient_relation?: string
  signee_name?: string
}

/**
 * Every document recorded for a patient — patient visits, admissions, discharges,
 * lab tests, consents/signatures, legacy scans and direct file attachments.
 */
export async function fetchPatientDocuments(
  patient?: string,
  limit: number = 300
): Promise<PatientDocumentEntry[]> {
  if (!patient) return []

  const params = new URLSearchParams({ patient, limit: String(limit) })
  const response = await fetch(
    `/api/method/healthcare.api.patient_documents.get_patient_documents?${params.toString()}`,
    { credentials: 'include', headers: { Accept: 'application/json' } }
  )
  const resData = await response.json()

  if (resData?.exc || !response.ok) {
    throw new Error(
      (typeof resData?.message === 'string' && resData.message) ||
        'Failed to load patient documents'
    )
  }

  return Array.isArray(resData?.message) ? (resData.message as PatientDocumentEntry[]) : []
}
