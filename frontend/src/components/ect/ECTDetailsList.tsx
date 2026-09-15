import { useState, useEffect } from 'react'
import { fetchECTDetails, type ECTDetail } from '../../services/ectDetails'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ECTDetailsDetailPanel } from './ECTDetailsDetailPanel'

interface ECTDetailsListProps {
  patient?: string
  refreshKey?: number | string
  onPatientClick?: (patient: string) => void
}

export const ECTDetailsList = ({ patient, refreshKey, onPatientClick }: ECTDetailsListProps) => {
  const [ectDetails, setEctDetails] = useState<ECTDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [detailEct, setDetailEct] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)

  useEffect(() => {
    const loadECTDetails = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await fetchECTDetails(50, 0, patient)
        setEctDetails(response)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch ECT details'))
      } finally {
        setLoading(false)
      }
    }

    loadECTDetails()
  }, [patient, refreshKey, listRefreshKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-600">Loading ECT details...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl w-full">
          <h3 className="text-red-800 font-semibold mb-2">Error Loading ECT Details</h3>
          <p className="text-red-700 text-sm mb-2">{error.message}</p>
        </div>
      </div>
    )
  }

  if (ectDetails.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-500">NO ECT DETAILS FOUND</div>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="min-w-full whitespace-nowrap">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                ECT No
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Date
              </th>
              {!patient && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                  Patient
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Branch
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Energy
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Success
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Doctor
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Nurse
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase w-[100px]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {ectDetails.map((ect) => (
              <tr key={ect.name} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium">
                  <button
                    type="button"
                    onClick={() => setDetailEct(ect.name)}
                    className="text-primary hover:underline text-left focus:outline-none"
                    title="View ECT detail"
                  >
                    {ect.name}
                  </button>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {ect.date ? new Date(ect.date).toLocaleDateString('en-GB') : '-'}
                  {ect.time && ` ${String(ect.time).slice(0, 5)}`}
                </td>
                {!patient && (
                  <td
                    className="px-4 py-3 text-sm cursor-pointer"
                    onClick={() => ect.patient && onPatientClick?.(ect.patient)}
                  >
                    <span className="font-medium text-primary hover:underline">{ect.patient_name || ect.patient || '-'}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-sm text-slate-700">
                  {ect.cost_center || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {ect.energy || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {ect.duration != null ? `${ect.duration}` : '-'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {ect.success || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {ect.doctors_name || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {ect.nurse_name || '-'}
                </td>
                <td className="px-4 py-2 align-middle">
                  <div className="flex items-center gap-1.5">
                    <PrintFormatDropdown
                      doctype="ECT Details"
                      docName={ect.name}
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

      {detailEct ? (
        <ECTDetailsDetailPanel
          name={detailEct}
          onClose={() => setDetailEct(null)}
          onChanged={() => setListRefreshKey((k) => k + 1)}
        />
      ) : null}
    </>
  )
}