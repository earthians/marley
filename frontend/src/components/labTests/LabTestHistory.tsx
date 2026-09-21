import { useState, useEffect, useCallback } from 'react'
import {
  fetchLabTestHistoryMatrix,
  type LabHistoryMatrixCell,
  type LabHistoryMatrixColumn,
  type LabHistoryMatrixRow,
} from '../../services/labTests'
import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'
import { Search, User } from 'lucide-react'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { DateFilterInput } from '../ui/DateFilterInput'

interface LabTestHistoryProps {
  patientId?: string
  patientName?: string
  onPatientChange?: (patientId: string) => void
  className?: string
  /** Prefill the Test Name filter (e.g. when opening trends from a listing row). */
  initialTestName?: string
  /**
   * When true and a group/test filter has multiple analyte rows, collapse to one
   * row per date for the group panel (CBC) instead of listing every child.
   */
  unconsolidated?: boolean
  onUnconsolidatedChange?: (value: boolean) => void
  /** Hide the in-panel Unconsolidate control when the parent puts it in a header. */
  hideUnconsolidateControl?: boolean
}

interface Filters {
  fromDate: string
  toDate: string
  testName: string
}

function localDateISO(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultDateRange(): { fromDate: string; toDate: string } {
  const toDate = localDateISO()
  const from = new Date()
  from.setFullYear(from.getFullYear() - 1)
  return { fromDate: localDateISO(from), toDate }
}

const makeDefaultFilters = (): Filters => ({
  ...defaultDateRange(),
  testName: '',
})

function formatColumnHeader(col: LabHistoryMatrixColumn): string {
  try {
    if (col.date) {
      return new Date(col.date + 'T00:00:00').toLocaleDateString('en-GB')
    }
  } catch {
    /* fall through */
  }
  return col.date || '—'
}

type VerticalHistoryEvent = {
  key: string
  date: string
  time: string
  dateLine: string
  testLabel: string
  cell: LabHistoryMatrixCell
  /** Row-level reference range fallback (cells without bounds). */
  rowMin?: number | string | null
  rowMax?: number | string | null
}

/** Dates with an actual result for the filtered test(s) — newest first. */
function buildVerticalHistoryEvents(
  columns: LabHistoryMatrixColumn[],
  rows: LabHistoryMatrixRow[],
): VerticalHistoryEvent[] {
  const events: VerticalHistoryEvent[] = []
  for (const row of rows) {
    for (const col of columns) {
      if (!col.key || col.key.startsWith('__pad_')) continue
      const cell = row.cells[col.key]
      const value = (cell?.value ?? '').toString().trim()
      if (!value) continue
      events.push({
        key: `${row.key}::${col.key}`,
        date: col.date || '',
        time: col.time || '',
        dateLine: formatColumnHeader(col),
        testLabel: row.label,
        cell,
        rowMin: row.min,
        rowMax: row.max,
      })
    }
  }
  events.sort((a, b) => {
    const byDate = (b.date || '').localeCompare(a.date || '')
    if (byDate !== 0) return byDate
    return (b.time || '').localeCompare(a.time || '')
  })
  return events
}

/** One timeline entry per date for a group panel (hide individual analytes). */
function collapseVerticalEventsToGroup(
  events: VerticalHistoryEvent[],
  groupLabel: string,
): VerticalHistoryEvent[] {
  const byDate = new Map<string, VerticalHistoryEvent[]>()
  for (const e of events) {
    const key = e.date || e.dateLine || e.key
    const arr = byDate.get(key) || []
    arr.push(e)
    byDate.set(key, arr)
  }
  const out: VerticalHistoryEvent[] = []
  for (const [, list] of byDate) {
    const first = list[0]
    const directions = list.map((e) => e.cell?.direction)
    const direction = directions.includes('high')
      ? 'high'
      : directions.includes('low')
        ? 'low'
        : first.cell?.direction ?? null
    const anyAbnormal = list.some(
      (e) => e.cell?.flag === 'abnormal' || e.cell?.direction === 'high' || e.cell?.direction === 'low',
    )
    out.push({
      key: `group::${first.date}::${groupLabel}`,
      date: first.date,
      time: first.time,
      dateLine: first.dateLine,
      testLabel: groupLabel,
      cell: {
        value: `${list.length} result${list.length !== 1 ? 's' : ''}`,
        flag: anyAbnormal ? 'abnormal' : first.cell?.flag || 'neutral',
        direction,
        lab_test: first.cell?.lab_test,
      },
    })
  }
  out.sort((a, b) => {
    const byDate = (b.date || '').localeCompare(a.date || '')
    if (byDate !== 0) return byDate
    return (b.time || '').localeCompare(a.time || '')
  })
  return out
}

const MIN_DATE_COLUMNS = 20
const TEST_COLUMN_WIDTH_PX = 260
const DATE_COLUMN_WIDTH_PX = 88
const DATE_COLUMN_MAX_WIDTH_PX = 110

function padHistoryColumns(columns: LabHistoryMatrixColumn[]): LabHistoryMatrixColumn[] {
  if (columns.length >= MIN_DATE_COLUMNS) return columns
  const padded = [...columns]
  while (padded.length < MIN_DATE_COLUMNS) {
    const i = padded.length
    padded.push({
      key: `__pad_${i}`,
      date: '',
      time: '',
      lab_test: '',
    })
  }
  return padded
}

type MatrixDisplayRow =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'test'; row: LabHistoryMatrixRow; indented: boolean }

/** Group panel header (CBC) then child analytes; standalone tests after. */
function buildGroupedMatrixRows(rows: LabHistoryMatrixRow[]): MatrixDisplayRow[] {
  const groups = new Map<string, { label: string; children: LabHistoryMatrixRow[] }>()
  const standalone: LabHistoryMatrixRow[] = []

  for (const row of rows) {
    const gk = (row.group_key || '').trim()
    if (!gk) {
      standalone.push(row)
      continue
    }
    const existing = groups.get(gk)
    if (existing) {
      existing.children.push(row)
      if (!existing.label && row.group_label) existing.label = row.group_label
    } else {
      groups.set(gk, {
        label: (row.group_label || gk).trim() || gk,
        children: [row],
      })
    }
  }

  const out: MatrixDisplayRow[] = []
  const groupEntries = [...groups.entries()].sort((a, b) =>
    a[1].label.localeCompare(b[1].label, undefined, { sensitivity: 'base' }),
  )
  for (const [gk, g] of groupEntries) {
    out.push({ kind: 'group', key: `group::${gk}`, label: g.label })
    const children = [...g.children].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    )
    for (const child of children) {
      out.push({ kind: 'test', row: child, indented: true })
    }
  }
  const alone = [...standalone].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  )
  for (const row of alone) {
    out.push({ kind: 'test', row, indented: false })
  }
  return out
}

function cellClass(flag?: string, direction?: 'high' | 'low' | null) {
  switch (flag) {
    case 'normal':
      return 'bg-green-100 text-green-900'
    case 'abnormal':
      return direction === 'low'
        ? 'bg-yellow-100 text-yellow-900 font-medium'
        : 'bg-red-100 text-red-900 font-medium'
    default:
      return 'bg-white text-slate-800'
  }
}

function cellDirectionArrow(direction?: 'high' | 'low' | null) {
  if (direction === 'high') {
    return <span className="shrink-0 text-[10px] font-bold leading-none text-red-800" aria-label="High">↑</span>
  }
  if (direction === 'low') {
    return <span className="shrink-0 text-[10px] font-bold leading-none text-yellow-700" aria-label="Low">↓</span>
  }
  return null
}

/** Trim trailing zeros from a numeric bound (8.60 → 8.6). */
function formatRangeBound(value?: number | string | null): string {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  if (!text) return ''
  const num = Number(text)
  return Number.isFinite(num) ? String(num) : text
}

/** Reference min/max for a result — cell bounds first, then the row-level range. */
function resultRange(
  cellMin?: number | string | null,
  cellMax?: number | string | null,
  rowMin?: number | string | null,
  rowMax?: number | string | null,
): { min: string; max: string; available: boolean } {
  const min = formatRangeBound(cellMin !== null && cellMin !== undefined ? cellMin : rowMin)
  const max = formatRangeBound(cellMax !== null && cellMax !== undefined ? cellMax : rowMax)
  return { min, max, available: Boolean(min || max) }
}

/**
 * Result value with its reference range always shown
 * (Healthcare Settings → Show Ranges on History Lab Tests):
 * small font, minimum on the left and maximum (high) on the right.
 * The range text enlarges on hover.
 */
function RangeResult({
  value,
  direction,
  min,
  max,
}: {
  value: string
  direction?: 'high' | 'low' | null
  min: string
  max: string
}) {
  const body = (
    <span className="inline-flex max-w-full items-center justify-center gap-0.5">
      <span className="truncate">{value}</span>
      {cellDirectionArrow(direction)}
    </span>
  )
  if (!min && !max) return body
  return (
    <div
      className="group block w-full"
      title={`Reference range${min ? ` · min ${min}` : ''}${max ? ` · max ${max}` : ''}`}
    >
      {body}
      <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px] font-normal leading-tight tabular-nums opacity-80 transition-all duration-150 group-hover:text-[13px] group-hover:font-semibold group-hover:opacity-100">
        <span title="Minimum">{min || '—'}</span>
        <span title="Maximum">{max || '—'}</span>
      </span>
    </div>
  )
}

const FilterBar = ({
  filters,
  onChange,
  onClear,
  activeCount,
  patientId,
  patientName,
  patientQuery,
  onPatientQueryChange,
  onPatientSelect,
  patientOptions,
  patientOpen,
  setPatientOpen,
  patientLoading,
  showPatientPicker,
}: {
  filters: Filters
  onChange: (f: Filters) => void
  onClear: () => void
  activeCount: number
  patientId?: string
  patientName?: string
  patientQuery: string
  onPatientQueryChange: (q: string) => void
  onPatientSelect: (p: PatientListItem) => void
  patientOptions: PatientListItem[]
  patientOpen: boolean
  setPatientOpen: (v: boolean) => void
  patientLoading: boolean
  showPatientPicker: boolean
}) => {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value })

  return (
    <div className="card-filter-bar flex flex-wrap items-end gap-3 px-4 py-3 bg-white border-b border-slate-200">
      {showPatientPicker ? (
        <div className="flex flex-col gap-1 min-w-[220px] relative">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Patient</label>
          <div className="relative">
            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={patientQuery}
              onChange={(e) => {
                onPatientQueryChange(e.target.value)
                setPatientOpen(true)
              }}
              onFocus={() => setPatientOpen(true)}
              placeholder="Search patient…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {patientOpen && (patientOptions.length > 0 || patientLoading) && (
              <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {patientLoading ? (
                  <p className="px-3 py-2 text-xs text-slate-500">Searching…</p>
                ) : (
                  patientOptions.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => {
                        onPatientSelect(p)
                        setPatientOpen(false)
                      }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-800">{p.patient_name || p.name}</span>
                      <span className="text-xs text-slate-400 ml-2">{p.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : patientId ? (
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Patient</label>
          <div className="px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-slate-50 text-slate-800 font-medium truncate">
            {patientName || patientId}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1 min-w-[150px]">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">From Date</label>
        <DateFilterInput
          value={filters.fromDate}
          onChange={(e) => set('fromDate', e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[150px]">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">To Date</label>
        <DateFilterInput
          value={filters.toDate}
          onChange={(e) => set('toDate', e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[200px]">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Test Name</label>
        <input
          type="text"
          value={filters.testName}
          onChange={(e) => set('testName', e.target.value)}
          placeholder="Filter test rows…"
          className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide invisible">Quick</label>
        <div className="flex gap-1">
          {[
            { label: '3M', months: 3 },
            { label: '6M', months: 6 },
            { label: '1Y', months: 12 },
          ].map(({ label, months }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                const toDate = localDateISO()
                const from = new Date()
                from.setMonth(from.getMonth() - months)
                onChange({ ...filters, fromDate: localDateISO(from), toDate })
              }}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-600"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeCount > 0 ? (
        <ClearFiltersButton onClick={onClear} activeCount={activeCount} />
      ) : null}
    </div>
  )
}

export const LabTestHistory = ({
  patientId,
  patientName,
  onPatientChange,
  className = '',
  initialTestName = '',
  unconsolidated: unconsolidatedProp,
  onUnconsolidatedChange,
  hideUnconsolidateControl = false,
}: LabTestHistoryProps) => {
  const defaults = defaultDateRange()
  const [filters, setFilters] = useState<Filters>({
    ...defaults,
    testName: initialTestName.trim(),
  })
  const [columns, setColumns] = useState<LabHistoryMatrixColumn[]>([])
  const [rows, setRows] = useState<LabHistoryMatrixRow[]>([])
  const [displayPatientName, setDisplayPatientName] = useState(patientName || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unconsolidatedInternal, setUnconsolidatedInternal] = useState(false)
  /** Healthcare Settings → Show Ranges on History Lab Tests (from the matrix payload). */
  const [showRanges, setShowRanges] = useState(false)

  const unconsolidated = unconsolidatedProp ?? unconsolidatedInternal
  const setUnconsolidated = (value: boolean) => {
    onUnconsolidatedChange?.(value)
    if (unconsolidatedProp === undefined) setUnconsolidatedInternal(value)
  }

  const [patientQuery, setPatientQuery] = useState(patientName || patientId || '')
  const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientLoading, setPatientLoading] = useState(false)

  useEffect(() => {
    setFilters((prev) => ({ ...prev, testName: initialTestName.trim() }))
    // Parent controls unconsolidated when opening from a group; only reset local toggle.
    if (unconsolidatedProp === undefined) {
      setUnconsolidatedInternal(false)
    }
  }, [initialTestName]) // eslint-disable-line react-hooks/exhaustive-deps -- unconsolidatedProp is mode, not a trigger

  useEffect(() => {
    setPatientQuery(patientName || patientId || '')
    setDisplayPatientName(patientName || '')
  }, [patientId, patientName])

  useEffect(() => {
    if (!patientOpen) return
    const timer = setTimeout(async () => {
      setPatientLoading(true)
      try {
        const results = patientQuery.trim()
          ? await searchPatients(patientQuery, 20)
          : await fetchPatients(20, 0)
        setPatientOptions(results)
      } catch {
        setPatientOptions([])
      } finally {
        setPatientLoading(false)
      }
    }, patientQuery.trim() ? 300 : 0)
    return () => clearTimeout(timer)
  }, [patientQuery, patientOpen])

  const loadMatrix = useCallback(async () => {
    if (!patientId) {
      setColumns([])
      setRows([])
      return
    }
    try {
      setLoading(true)
      setError(null)
      const data = await fetchLabTestHistoryMatrix({
        patient: patientId,
        from_date: filters.fromDate || undefined,
        to_date: filters.toDate || undefined,
        test_search: filters.testName.trim() || undefined,
      })
      setColumns(data.columns || [])
      setRows(data.rows || [])
      setShowRanges(Boolean(data.show_ranges_on_history_lab_tests))
      if (data.patient_name) setDisplayPatientName(data.patient_name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lab history')
      setColumns([])
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [patientId, filters.fromDate, filters.toDate, filters.testName])

  useEffect(() => {
    loadMatrix()
  }, [loadMatrix])

  const defaultFilters = makeDefaultFilters()
  const activeCount = [
    filters.fromDate !== defaultFilters.fromDate ? filters.fromDate : '',
    filters.toDate !== defaultFilters.toDate ? filters.toDate : '',
    filters.testName,
  ].filter(Boolean).length

  const handleClearFilters = () => setFilters(makeDefaultFilters())

  if (!patientId) {
    return (
      <div className={`flex flex-col min-w-full ${className}`}>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onClear={handleClearFilters}
          activeCount={0}
          patientQuery={patientQuery}
          onPatientQueryChange={setPatientQuery}
          onPatientSelect={(p) => onPatientChange?.(p.name)}
          patientOptions={patientOptions}
          patientOpen={patientOpen}
          setPatientOpen={setPatientOpen}
          patientLoading={patientLoading}
          showPatientPicker={!!onPatientChange}
        />
        <div className="text-center py-12 text-slate-400">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Select a patient to view lab test history</p>
          <p className="text-xs mt-1 text-slate-400">Results appear in a date matrix — one column per test date</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col min-w-full ${className}`}>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        onClear={handleClearFilters}
        activeCount={activeCount}
        patientId={patientId}
        patientName={displayPatientName}
        patientQuery={patientQuery}
        onPatientQueryChange={setPatientQuery}
        onPatientSelect={(p) => onPatientChange?.(p.name)}
        patientOptions={patientOptions}
        patientOpen={patientOpen}
        setPatientOpen={setPatientOpen}
        patientLoading={patientLoading}
        showPatientPicker={!!onPatientChange}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-slate-500">Loading lab history…</span>
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 m-4">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            type="button"
            onClick={loadMatrix}
            className="mt-3 text-xs text-red-600 hover:text-red-800 font-medium"
          >
            Retry
          </button>
        </div>
      ) : columns.length === 0 && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <Search className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">
            {activeCount > 0
              ? 'NO LAB RESULTS MATCH THE CURRENT FILTERS.'
              : 'No lab results found for this patient in the selected date range.'}
          </p>
          {activeCount > 0 ? (
            <ClearFiltersButton className="mt-3 self-center" onClick={handleClearFilters} />
          ) : null}
        </div>
      ) : (
        <>
          {(() => {
            const focusedTest = filters.testName.trim()
            // Single analyte → vertical timeline. Group / multi-row (e.g. CBC) → matrix with group headers.
            const isGroupMatrixFilter =
              Boolean(focusedTest) &&
              (rows.length > 1 || rows.some((r) => (r.group_key || r.group_label || '').trim()))
            const verticalMode = Boolean(focusedTest) && !isGroupMatrixFilter && rows.length === 1
            const rawVerticalEvents = verticalMode ? buildVerticalHistoryEvents(columns, rows) : []
            const canUnconsolidate =
              Boolean(focusedTest) &&
              rows.length > 1 &&
              (verticalMode || isGroupMatrixFilter)
            const verticalEvents =
              verticalMode && canUnconsolidate && unconsolidated
                ? collapseVerticalEventsToGroup(rawVerticalEvents, focusedTest)
                : rawVerticalEvents
            const displayColumns = verticalMode ? columns : padHistoryColumns(columns)
            const matrixRows =
              !verticalMode && unconsolidated && isGroupMatrixFilter
                ? // Collapse children to one summary row per group when Unconsolidate is on.
                  (() => {
                    const byGroup = new Map<string, LabHistoryMatrixRow[]>()
                    for (const r of rows) {
                      const gk = (r.group_key || r.key).trim() || r.key
                      const list = byGroup.get(gk) || []
                      list.push(r)
                      byGroup.set(gk, list)
                    }
                    const collapsed: LabHistoryMatrixRow[] = []
                    for (const [, list] of byGroup) {
                      const first = list[0]
                      const label = (first.group_label || first.group_key || first.label || '').trim()
                      const cells: LabHistoryMatrixRow['cells'] = {}
                      for (const col of columns) {
                        if (!col.key || col.key.startsWith('__pad_')) continue
                        const withVal = list.filter((r) => (r.cells[col.key]?.value || '').trim())
                        if (!withVal.length) continue
                        const directions = withVal.map((r) => r.cells[col.key]?.direction)
                        const direction = directions.includes('high')
                          ? 'high'
                          : directions.includes('low')
                            ? 'low'
                            : withVal[0].cells[col.key]?.direction ?? null
                        const anyAbnormal = withVal.some(
                          (r) =>
                            r.cells[col.key]?.flag === 'abnormal' ||
                            r.cells[col.key]?.direction === 'high' ||
                            r.cells[col.key]?.direction === 'low',
                        )
                        cells[col.key] = {
                          value: `${withVal.length} result${withVal.length !== 1 ? 's' : ''}`,
                          flag: anyAbnormal ? 'abnormal' : withVal[0].cells[col.key]?.flag || 'neutral',
                          direction,
                          lab_test: withVal[0].cells[col.key]?.lab_test,
                        }
                      }
                      collapsed.push({
                        key: `group-summary::${first.group_key || first.key}`,
                        label,
                        group_key: first.group_key,
                        group_label: first.group_label,
                        cells,
                      })
                    }
                    return collapsed
                  })()
                : rows
            const groupedMatrixRows = verticalMode
              ? []
              : unconsolidated && isGroupMatrixFilter
                ? matrixRows.map((row) => ({ kind: 'test' as const, row, indented: false }))
                : buildGroupedMatrixRows(matrixRows)
            const showTestCol = verticalMode && verticalEvents.some((e) => e.testLabel !== focusedTest)
              ? verticalEvents.length > 1
              : verticalMode && rows.length > 1 && !unconsolidated

            return (
              <>
          <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <span>
              {verticalMode ? (
                <>
                  {focusedTest}
                  {unconsolidated && canUnconsolidate ? ' · group view' : ''}
                  {' · '}
                  {verticalEvents.length} result{verticalEvents.length !== 1 ? 's' : ''}
                  {filters.fromDate && filters.toDate ? ` (${filters.fromDate} → ${filters.toDate})` : ''}
                </>
              ) : (
                <>
                  {matrixRows.length} test{matrixRows.length !== 1 ? 's' : ''} × {columns.length} date
                  {columns.length !== 1 ? 's' : ''}
                  {filters.fromDate && filters.toDate ? ` (${filters.fromDate} → ${filters.toDate})` : ''}
                </>
              )}
            </span>
            <span className="flex items-center gap-3 flex-wrap">
              {canUnconsolidate && !hideUnconsolidateControl ? (
                <button
                  type="button"
                  onClick={() => setUnconsolidated(!unconsolidated)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title={
                    unconsolidated
                      ? 'Show all child tests in this group'
                      : 'Show only this group as one timeline'
                  }
                >
                  {unconsolidated ? 'Consolidate' : 'Unconsolidate'}
                </button>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-green-100 border border-green-200" /> Normal
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-100 border border-red-200" /> High
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200" /> Low
              </span>
              <span className="inline-flex items-center gap-1 text-slate-500">
                <span className="text-red-800 font-bold">↑</span> High
                <span className="text-yellow-700 font-bold ml-2">↓</span> Low
              </span>
            </span>
          </div>

          <div className="overflow-auto max-h-[min(80vh,880px)] min-h-[480px]" style={{ scrollbarWidth: 'thin' }}>
            {verticalMode ? (
              verticalEvents.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">
                  NO RESULTS FOR THIS TEST IN THE SELECTED DATE RANGE.
                </div>
              ) : (
                <table className="w-full min-w-[360px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                        Date
                      </th>
                      {showTestCol ? (
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                          Test
                        </th>
                      ) : null}
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                        Result
                      </th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                        Flag
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {verticalEvents.map((ev) => (
                      <tr key={ev.key} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 text-sm font-medium text-slate-800 whitespace-nowrap">
                          {ev.dateLine}
                        </td>
                        {showTestCol ? (
                          <td className="px-3 py-2 text-sm text-slate-700">{ev.testLabel}</td>
                        ) : null}
                        <td className={`px-3 py-2 text-sm ${cellClass(ev.cell.flag, ev.cell.direction)}`}>
                          {(() => {
                            const { min, max, available } = resultRange(
                              ev.cell.min,
                              ev.cell.max,
                              ev.rowMin,
                              ev.rowMax,
                            )
                            if (!showRanges || !available) {
                              return (
                                <span className="inline-flex items-center gap-1 font-medium">
                                  {ev.cell.value}
                                  {cellDirectionArrow(ev.cell.direction)}
                                </span>
                              )
                            }
                            return (
                              <div className="font-medium">
                                <RangeResult
                                  value={ev.cell.value}
                                  direction={ev.cell.direction}
                                  min={min}
                                  max={max}
                                />
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize text-slate-600">
                          {ev.cell.flag || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : (
            <table className="border-collapse w-auto table-fixed">
              <colgroup>
                <col style={{ width: `${TEST_COLUMN_WIDTH_PX}px` }} />
                {displayColumns.map((col) => (
                  <col key={col.key} style={{ width: `${DATE_COLUMN_WIDTH_PX}px` }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th
                    className="sticky left-0 z-20 bg-slate-50 border-b border-r border-slate-200 px-3 py-2.5 text-left text-sm font-semibold text-slate-600 uppercase truncate"
                    style={{ width: `${TEST_COLUMN_WIDTH_PX}px`, maxWidth: `${TEST_COLUMN_WIDTH_PX}px` }}
                  >
                    Test
                  </th>
                  {displayColumns.map((col) => {
                    const dateLine = formatColumnHeader(col)
                    const isPad = col.key.startsWith('__pad_')
                    return (
                      <th
                        key={col.key}
                        className={`border-b border-slate-200 px-2 py-2.5 text-center text-xs font-semibold ${
                          isPad ? 'text-slate-300 border-slate-100' : 'text-slate-600'
                        }`}
                        style={{
                          width: `${DATE_COLUMN_WIDTH_PX}px`,
                          minWidth: `${DATE_COLUMN_WIDTH_PX}px`,
                          maxWidth: `${DATE_COLUMN_MAX_WIDTH_PX}px`,
                        }}
                        title={isPad ? undefined : col.lab_test_name || col.lab_test}
                      >
                        <div className="leading-tight">{isPad ? '—' : dateLine}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupedMatrixRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={displayColumns.length + 1}
                      className="px-4 py-8 text-center text-sm text-slate-400"
                    >
                      NO TEST ROWS MATCH THE CURRENT FILTERS.
                    </td>
                  </tr>
                ) : (
                  groupedMatrixRows.map((entry) => {
                    if (entry.kind === 'group') {
                      return (
                        <tr key={entry.key} className="bg-slate-100/90">
                          <td
                            className="sticky left-0 z-[5] bg-slate-100 border-r border-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 truncate"
                            style={{
                              width: `${TEST_COLUMN_WIDTH_PX}px`,
                              maxWidth: `${TEST_COLUMN_WIDTH_PX}px`,
                            }}
                            title={entry.label}
                          >
                            {entry.label}
                          </td>
                          {displayColumns.map((col) => (
                            <td
                              key={col.key}
                              className={`border-l ${
                                col.key.startsWith('__pad_')
                                  ? 'border-slate-50 bg-slate-50/30'
                                  : 'border-slate-100 bg-slate-100/90'
                              }`}
                              style={{
                                width: `${DATE_COLUMN_WIDTH_PX}px`,
                                minWidth: `${DATE_COLUMN_WIDTH_PX}px`,
                                maxWidth: `${DATE_COLUMN_MAX_WIDTH_PX}px`,
                              }}
                            />
                          ))}
                        </tr>
                      )
                    }
                    const { row, indented } = entry
                    return (
                  <tr key={row.key} className="hover:bg-slate-50/50">
                    <td
                      className="sticky left-0 z-[5] bg-white border-r border-slate-200 px-3 py-2.5 text-sm text-slate-800 font-medium truncate"
                      style={{ width: `${TEST_COLUMN_WIDTH_PX}px`, maxWidth: `${TEST_COLUMN_WIDTH_PX}px` }}
                      title={row.label}
                    >
                      <span className={indented ? 'pl-3 inline-block' : undefined}>
                        {indented ? (
                          <span className="text-slate-400 mr-1.5 font-normal">└</span>
                        ) : null}
                        {row.label}
                      </span>
                    </td>
                    {displayColumns.map((col) => {
                      const cell = row.cells[col.key]
                      const isPad = col.key.startsWith('__pad_')
                      return (
                        <td
                          key={col.key}
                          className={`px-2 py-2 text-center text-sm border-l ${
                            isPad
                              ? 'border-slate-50 bg-slate-50/30'
                              : `border-slate-100 ${cellClass(cell?.flag, cell?.direction)}`
                          }`}
                          style={{
                            width: `${DATE_COLUMN_WIDTH_PX}px`,
                            minWidth: `${DATE_COLUMN_WIDTH_PX}px`,
                            maxWidth: `${DATE_COLUMN_MAX_WIDTH_PX}px`,
                          }}
                          title={
                            cell?.value
                              ? `${cell.value}${cell.direction === 'high' ? ' (High)' : cell.direction === 'low' ? ' (Low)' : ''}`
                              : cell?.lab_test
                                ? `Lab Test: ${cell.lab_test}`
                                : undefined
                          }
                        >
                          {(() => {
                            const { min, max, available } = resultRange(
                              cell?.min,
                              cell?.max,
                              row.min,
                              row.max,
                            )
                            if (!showRanges || !available || !cell?.value) {
                              return (
                                <span className="inline-flex items-center justify-center gap-0.5 max-w-full">
                                  <span className="truncate">{cell?.value ?? ''}</span>
                                  {cellDirectionArrow(cell?.direction)}
                                </span>
                              )
                            }
                            return (
                              <RangeResult
                                value={String(cell.value)}
                                direction={cell.direction}
                                min={min}
                                max={max}
                              />
                            )
                          })()}
                        </td>
                      )
                    })}
                  </tr>
                    )
                  })
                )}
              </tbody>
            </table>
            )}
          </div>
              </>
            )
          })()}
        </>
      )}
    </div>
  )
}
