import { useEffect, useState } from 'react'
import { fetchECTProcedures, type ECTProcedure } from '../../services/ectProcedure'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ECTProcedureDetailPanel } from './ECTProcedureDetailPanel'

interface ECTProcedureListProps {
  patient?: string
  onPatientClick?: (patient: string) => void
}

export const ECTProcedureList = ({ patient, onPatientClick }: ECTProcedureListProps) => {
  const [items, setItems] = useState<ECTProcedure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await fetchECTProcedures(50, 0, patient)
        setItems(data)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load ECT Procedure'))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [patient, listRefreshKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-sm text-slate-600">
        Loading ECT Procedure...
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
      <div className="flex items-center justify-center p-4 text-sm text-slate-500">
        NO ECT PROCEDURE RECORDS FOUND
      </div>
    )
  }

  return (
    <>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">
                Name
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">
                Session Date
              </th>
              {!patient && (
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">
                  Patient
                </th>
              )}
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">
                Energy
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">
                Sessions
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase w-[70px]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {items.map((row) => (
              <tr key={row.name} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setDetailName(row.name)}
                    className="text-primary hover:underline"
                    title="View ECT Procedure details"
                  >
                    {row.name}
                  </button>
                </td>
                <td className="px-3 py-2">
                  {row.date_of_session
                    ? new Date(row.date_of_session).toLocaleDateString('en-GB')
                    : row.date
                    ? new Date(row.date).toLocaleDateString('en-GB')
                    : '-'}
                </td>
                {!patient && (
                  <td
                    className="px-3 py-2 cursor-pointer"
                    onClick={() => row.patient && onPatientClick?.(row.patient)}
                  >
                    <span className="font-medium text-primary hover:underline">{row.patient_name || row.patient || '-'}</span>
                  </td>
                )}
                <td className="px-3 py-2">{row.energy || '-'}</td>
                <td className="px-3 py-2">
                  {typeof row.no_of_session === 'number' ? row.no_of_session : '-'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end">
                    <PrintFormatDropdown
                      doctype="ECT Procedure"
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
        <ECTProcedureDetailPanel
          name={detailName}
          onClose={() => setDetailName(null)}
          onChanged={() => setListRefreshKey((k) => k + 1)}
        />
      ) : null}
    </>
  )
}

