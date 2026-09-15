import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchSuicidalAssessments, type SuicidalAssessment } from '../../services/suicidalAssessment'
import { SuicidalPatientAssessmentDetailPanel } from '../suicidal/SuicidalPatientAssessmentDetailPanel'
import { EctClinicalFormDetailPanel } from '../ect/EctClinicalFormDetailPanel'

interface AssessmentRecord {
  name: string
  patient: string
  patient_name?: string
  inpatient_admission?: string
  admission?: string
  admission_no?: string
  date?: string
  assessment_date?: string
  creation: string
}

interface AdmissionAssessmentListProps {
  doctype: string
  doctypeLabel: string
  patient?: string
  refreshKey?: number
  onPatientClick?: (patient: string) => void
}

const SUICIDAL_DOCTYPE = 'Suicidal Patient Assessment'
const ADMISSION_FIELD_BY_DOCTYPE: Record<string, 'admission_no' | 'inpatient_admission' | 'admission'> = {
  'Recovery Room Record': 'admission',
}
const DATE_FIELD_BY_DOCTYPE: Record<string, 'assessment_date' | 'date' | 'creation'> = {
  'Recovery Room Record': 'date',
}

export const AdmissionAssessmentList = ({
  doctype,
  doctypeLabel,
  patient,
  refreshKey,
  onPatientClick,
}: AdmissionAssessmentListProps) => {
  const [items, setItems] = useState<AssessmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<SuicidalAssessment | undefined>(undefined)
  const [listVersion, setListVersion] = useState(0)

  const isSuicidal = doctype === SUICIDAL_DOCTYPE

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        if (isSuicidal) {
          const rows = await fetchSuicidalAssessments(patient)
          setItems(
            rows.map((row) => ({
              name: row.name,
              patient: row.patient,
              patient_name: row.patient_name,
              admission_no: row.admission_no,
              assessment_date: row.assessment_date,
              creation: row.assessment_date || row.modified || '',
            }))
          )
          return
        }

        const filters: [string, string, string][] = []
        if (patient) filters.push(['patient', '=', patient])
        const admissionField = ADMISSION_FIELD_BY_DOCTYPE[doctype] || 'inpatient_admission'
        const dateField = DATE_FIELD_BY_DOCTYPE[doctype] || 'creation'
        const fields = ['name', 'patient', 'patient_name', 'creation', admissionField]
        if (dateField !== 'creation') fields.push(dateField)
        const params = new URLSearchParams({
          doctype,
          fields: JSON.stringify(fields),
          filters: JSON.stringify(filters),
          order_by: 'creation desc',
          limit: '50',
        })
        const res = await fetch(`/api/method/frappe.client.get_list?${params}`, { credentials: 'include' })
        const data = await res.json()
        setItems(Array.isArray(data?.message) ? data.message : [])
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load records'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [doctype, patient, refreshKey, isSuicidal, listVersion])

  const handleView = (row: AssessmentRecord) => {
    setDetailName(row.name)
    if (isSuicidal) {
      setDetailRow({
        name: row.name,
        patient: row.patient,
        patient_name: row.patient_name,
        admission_no: row.admission_no || '',
        assessment_date: row.assessment_date || row.creation,
      })
    }
  }

  const formatDate = (row: AssessmentRecord) => {
    const value = isSuicidal ? row.assessment_date : (row.date || row.assessment_date || row.creation)
    if (!value) return '—'
    return new Date(value).toLocaleDateString('en-GB')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-sm text-slate-500">
        Loading {doctypeLabel} records...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
        {error.message}
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="flex items-center justify-center p-4 text-sm text-slate-400">
        No {doctypeLabel} records found
      </div>
    )
  }

  return (
    <>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Record #</th>
              {!patient && (
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Patient</th>
              )}
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Admission</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((row) => (
              <tr
                key={row.name}
                className="hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => handleView(row)}
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleView(row)
                    }}
                    className="text-primary hover:underline font-medium text-xs"
                  >
                    {row.name}
                  </button>
                </td>
                {!patient && (
                  <td
                    className="px-3 py-2 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      row.patient && onPatientClick?.(row.patient)
                    }}
                  >
                    <span className="font-medium text-primary hover:underline">
                      {row.patient_name || row.patient || '—'}
                    </span>
                  </td>
                )}
                <td className="px-3 py-2 text-slate-500 text-xs">
                  {row.admission_no || row.inpatient_admission || row.admission || '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleView(row)
                    }}
                    className="font-medium text-primary hover:underline"
                    title="View assessment details"
                  >
                    {formatDate(row)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailName && isSuicidal &&
        typeof document !== 'undefined' &&
        createPortal(
          <SuicidalPatientAssessmentDetailPanel
            name={detailName}
            preview={detailRow}
            onClose={() => {
              setDetailName(null)
              setDetailRow(undefined)
            }}
            onPatientClick={onPatientClick}
          />,
          document.body
        )}

      {detailName && !isSuicidal ? (
        <EctClinicalFormDetailPanel
          doctype={doctype}
          doctypeLabel={doctypeLabel}
          name={detailName}
          onClose={() => setDetailName(null)}
          onChanged={() => setListVersion((v) => v + 1)}
        />
      ) : null}
    </>
  )
}
