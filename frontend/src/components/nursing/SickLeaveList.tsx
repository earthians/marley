import { useCallback, useEffect, useState } from 'react'
import { fetchSickLeaves, type SickLeaveRow } from '../../services/sickLeave'
import { fetchHealthcarePractitioners, type LinkFieldOption } from '../../services/common'
import { useCardFilters } from '../../contexts/CardFilterContext'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { SickLeaveDetailPanel } from './SickLeaveDetailPanel'
import { CreateSickLeaveModal } from './CreateSickLeaveModal'
import { DateFilterInput } from '../ui/DateFilterInput'
import { Pencil } from 'lucide-react'

interface SickLeaveListProps {
  patient?: string
  refreshKey?: number
  onPatientClick?: (patient: string) => void
  title?: string
  onAdd?: () => void
  addButtonTitle?: string
}

const FilterToggleButton = ({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-md border p-1.5 transition-colors ${
      active ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
    }`}
    title={active ? 'Hide filters' : 'Show filters'}
    aria-label={active ? 'Hide filters' : 'Show filters'}
  >
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
      />
    </svg>
  </button>
)

export const SickLeaveList = ({
  patient,
  refreshKey,
  onPatientClick,
  title = 'Sick Leave',
  onAdd,
  addButtonTitle = 'New Sick Leave',
}: SickLeaveListProps) => {
  const cardFilters = useCardFilters()
  const inDashboardCard = cardFilters !== undefined
  const [showFiltersInternal, setShowFiltersInternal] = useState(false)
  const showFilters = inDashboardCard ? cardFilters : showFiltersInternal

  const [records, setRecords] = useState<SickLeaveRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SickLeaveRow | null>(null)
  const [editRow, setEditRow] = useState<SickLeaveRow | null>(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [doctorFilter, setDoctorFilter] = useState('')
  const [doctorQuery, setDoctorQuery] = useState('')
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [doctorOptions, setDoctorOptions] = useState<LinkFieldOption[]>([])

  const hasActiveFilters = Boolean(dateFrom || dateTo || doctorFilter)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSickLeaves(patient, 1, 50, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        doctor: doctorFilter || undefined,
      })
      setRecords(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sick leave records')
    } finally {
      setLoading(false)
    }
  }, [patient, dateFrom, dateTo, doctorFilter])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  useEffect(() => {
    if (!doctorOpen) return
    const t = setTimeout(async () => {
      try {
        const opts = await fetchHealthcarePractitioners(doctorQuery || undefined)
        setDoctorOptions(opts)
      } catch {
        setDoctorOptions([])
      }
    }, doctorQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [doctorQuery, doctorOpen])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-sl-doctor-filter]')) return
      setDoctorOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const clearFilters = () => {
    setDateFrom('')
    setDateTo('')
    setDoctorFilter('')
    setDoctorQuery('')
    setDoctorOpen(false)
  }

  const selectedDoctorLabel =
    doctorOptions.find((o) => o.name === doctorFilter)?.label || doctorFilter || ''

  return (
    <div className="flex flex-col gap-4">
      {!inDashboardCard && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            <FilterToggleButton
              active={Boolean(showFilters)}
              onClick={() => setShowFiltersInternal((prev) => !prev)}
            />
            {onAdd ? (
              <button
                type="button"
                onClick={onAdd}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-white transition-colors hover:bg-primary/90"
                title={addButtonTitle}
              >
                +
              </button>
            ) : null}
          </div>
        </div>
      )}

      {showFilters ? (
        <div className="card-filter-bar flex flex-shrink-0 flex-wrap items-end gap-3 rounded-md border-b border-slate-100 bg-slate-50/80 px-1 py-2">
          <div className="flex min-w-[130px] flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">From Date</label>
            <DateFilterInput
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex min-w-[130px] flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">To Date</label>
            <DateFilterInput
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
          </div>
          <div data-sl-doctor-filter className="relative flex min-w-[200px] flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Doctor</label>
            <div className="relative">
              <input
                type="text"
                value={doctorOpen ? doctorQuery : selectedDoctorLabel}
                onChange={(e) => {
                  setDoctorQuery(e.target.value)
                  setDoctorOpen(true)
                  if (!e.target.value) setDoctorFilter('')
                }}
                onFocus={() => setDoctorOpen(true)}
                placeholder="Search doctor…"
                className={`w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm ${doctorFilter ? 'pr-7' : ''}`}
              />
              {doctorFilter ? (
                <button
                  type="button"
                  onClick={() => {
                    setDoctorFilter('')
                    setDoctorQuery('')
                    setDoctorOpen(false)
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                  title="Clear doctor filter"
                  aria-label="Clear doctor filter"
                >
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </div>
            {doctorOpen && doctorOptions.length > 0 ? (
              <ul className="absolute top-full left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-lg">
                {doctorOptions.map((opt) => (
                  <li key={opt.name}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-slate-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setDoctorFilter(opt.name)
                        setDoctorQuery(opt.label || opt.name)
                        setDoctorOpen(false)
                      }}
                    >
                      {opt.label || opt.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {hasActiveFilters ? <ClearFiltersButton onClick={clearFilters} /> : null}
        </div>
      ) : null}

      {loading ? <div className="py-4 text-center text-sm text-slate-500">Loading…</div> : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      ) : null}

      {!loading && !error && records.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-600">
          NO SICK LEAVE RECORDS FOUND.
        </div>
      ) : null}

      {!loading && records.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                {!patient ? (
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Patient</th>
                ) : null}
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Admission No</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">From Date</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">To Date</th>
                <th className="px-3 py-2 text-center font-semibold text-slate-600">Days</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Doctor</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Diagnosis</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((r) => (
                <tr key={r.name} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(r)}>
                  {!patient ? (
                    <td
                      className="cursor-pointer px-3 py-2 text-slate-900"
                      onClick={(e) => {
                        e.stopPropagation()
                        r.patient && onPatientClick?.(r.patient)
                      }}
                    >
                      <span className="font-medium text-primary hover:underline">
                        {r.patient_name || r.patient || '—'}
                      </span>
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-slate-700">{r.admission_no || '—'}</td>
                  <td className="px-3 py-2 text-slate-800">{r.from_date || '—'}</td>
                  <td className="px-3 py-2 text-slate-800">{r.to_date || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {r.days ? (
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                        {r.days}d
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{r.doctor_name || r.doctor || '—'}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-slate-600" title={r.diagnosis || ''}>
                    {r.diagnosis || '—'}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditRow(r)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-primary"
                        title="Edit sick leave"
                        aria-label="Edit sick leave"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      <PrintFormatDropdown
                        doctype="Patient Sick Leave"
                        docName={r.name}
                        noLetterhead={0}
                        triggerPrint={1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-primary hover:bg-slate-50"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? (
        <SickLeaveDetailPanel
          row={selected}
          onClose={() => setSelected(null)}
          onPatientClick={onPatientClick}
          onEdit={() => {
            setEditRow(selected)
            setSelected(null)
          }}
        />
      ) : null}

      {editRow ? (
        <CreateSickLeaveModal
          editRow={editRow}
          patient={editRow.patient || patient}
          onClose={() => setEditRow(null)}
          onSuccess={() => {
            setEditRow(null)
            load()
          }}
        />
      ) : null}
    </div>
  )
}
