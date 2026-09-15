import { useEffect, useState } from 'react'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { PreAnesthesiaAssessmentDetailPanel } from './PreAnesthesiaAssessmentDetailPanel'

interface AssessmentRecord {
  name: string
  patient: string
  patient_name?: string
  inpatient_admission?: string
  assessment_date?: string
  asa_class?: string
  fit_for_anesthesia?: string
}

interface PreAnesthesiaAssessmentListProps {
  patient?: string
  refreshKey?: number
  onPatientClick?: (patient: string) => void
}

const fitColors: Record<string, string> = {
  'Yes':         'bg-green-100 text-green-700 border-green-200',
  'No':          'bg-red-100 text-red-700 border-red-200',
  'Conditional': 'bg-amber-100 text-amber-700 border-amber-200',
}

export const PreAnesthesiaAssessmentList = ({ patient, refreshKey, onPatientClick }: PreAnesthesiaAssessmentListProps) => {
  const [items, setItems] = useState<AssessmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)

  useEffect(() => {
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const filters: [string, string, string][] = []
        if (patient) filters.push(['patient', '=', patient])
        const params = new URLSearchParams({
          doctype: 'Pre Anesthesia Assessment',
          fields: JSON.stringify(['name', 'patient', 'patient_name', 'inpatient_admission', 'assessment_date', 'asa_class', 'fit_for_anesthesia']),
          filters: JSON.stringify(filters),
          order_by: 'creation desc',
          limit: '50',
        })
        const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
        const data = await res.json()
        setItems(Array.isArray(data?.message) ? data.message : [])
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load records'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [patient, refreshKey, listRefreshKey])

  if (loading) {
    return <div className="flex items-center justify-center p-4 text-sm text-slate-500">Loading Pre Anesthesia Assessments...</div>
  }
  if (error) {
    return <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">{error.message}</div>
  }
  if (!items.length) {
    return <div className="flex items-center justify-center p-4 text-sm text-slate-400">NO PRE ANESTHESIA ASSESSMENT RECORDS FOUND</div>
  }

  return (
    <>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Record</th>
              {!patient && (
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Patient</th>
              )}
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">ASA</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Fit</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(row => (
              <tr key={row.name} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setDetailName(row.name)}
                    className="text-primary hover:underline font-medium text-xs">
                    {row.name}
                  </button>
                </td>
                {!patient && (
                  <td
                    className="px-3 py-2 cursor-pointer"
                    onClick={() => row.patient && onPatientClick?.(row.patient)}
                  >
                    <span className="font-medium text-primary hover:underline">{row.patient_name || row.patient || '—'}</span>
                  </td>
                )}
                <td className="px-3 py-2">
                  {row.asa_class
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">{row.asa_class}</span>
                    : <span className="text-slate-400 text-xs">—</span>}
                </td>
                <td className="px-3 py-2">
                  {row.fit_for_anesthesia
                    ? <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${fitColors[row.fit_for_anesthesia] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {row.fit_for_anesthesia}
                      </span>
                    : <span className="text-slate-400 text-xs">—</span>}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">
                  {row.assessment_date ? new Date(row.assessment_date).toLocaleDateString('en-GB') : '—'}
                </td>

                <td className="px-3 py-2 text-slate-500 text-xs">
                   <div className="flex items-center">
                                                        <PrintFormatDropdown
                                                          doctype="Pre Anesthesia Assessment"
                                                          docName={row.name}
                                                          noLetterhead={0}
                                                          triggerPrint={1}
                                                        />
                                                      </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailName ? (
        <PreAnesthesiaAssessmentDetailPanel
          name={detailName}
          onClose={() => setDetailName(null)}
          onChanged={() => setListRefreshKey((k) => k + 1)}
        />
      ) : null}
    </>
  )
}
