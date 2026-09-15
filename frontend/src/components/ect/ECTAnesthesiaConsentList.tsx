import { useEffect, useState } from 'react'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ECTAnesthesiaConsentDetailPanel } from './ECTAnesthesiaConsentDetailPanel'

interface ConsentRecord {
  name: string
  patient: string
  patient_name?: string
  inpatient_admission?: string
  creation: string
}

interface ECTAnesthesiaConsentListProps {
  patient?: string
  refreshKey?: number
  onPatientClick?: (patient: string) => void
}

export const ECTAnesthesiaConsentList = ({ patient, refreshKey, onPatientClick }: ECTAnesthesiaConsentListProps) => {
  const [items, setItems] = useState<ConsentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const filters: [string, string, string][] = []
        if (patient) filters.push(['patient', '=', patient])
        const params = new URLSearchParams({
          doctype: 'ECT Anesthesia Consent',
          fields: JSON.stringify(['name', 'patient', 'patient_name', 'inpatient_admission', 'creation']),
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
    return (
      <div className="flex items-center justify-center p-4 text-sm text-slate-500">
        Loading ECT Anesthesia Consent records...
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
        NO ECT ANESTHESIA CONSENT RECORDS FOUND
      </div>
    )
  }

  return (
    <>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Consent #</th>
              {!patient && (
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Patient</th>
              )}
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Admission</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Date</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(row => (
              <tr key={row.name} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setDetailName(row.name)}
                    className="text-primary hover:underline font-medium text-xs"
                  >
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
                <td className="px-3 py-2 text-slate-500 text-xs">
                  {row.inpatient_admission || '—'}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">
                  {row.creation ? new Date(row.creation).toLocaleDateString('en-GB') : '—'}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">
                   <div className="flex items-center">
                                      <PrintFormatDropdown
                                        doctype="ECT Admission"
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
        <ECTAnesthesiaConsentDetailPanel
          name={detailName}
          onClose={() => setDetailName(null)}
          onChanged={() => setListRefreshKey((k) => k + 1)}
        />
      ) : null}
    </>
  )
}
