import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Droplet, Printer } from 'lucide-react'
import {
  fetchServiceRequests,
  type ServiceRequest,
} from '../../services/serviceRequests'
import { fetchHealthcarePortalSettings } from '../../services/healthcareSettings'
import { useCareContext } from '../../providers/CareContextProvider'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import { toast } from '../../hooks/useToast'
import { StatusPill } from '../ui/StatusPill'
import { PaginationControls, DEFAULT_PAGE_SIZE, type PageSize } from '../ui/PaginationControls'
import {
  CardRowMetaHint,
  dashboardCardRowHoverClass,
  formatDashboardDate,
} from '../ui/dashboardCardListing'
import {
  useCardFilters,
  useCardLeadingSlot,
  useInDashboardCard,
} from '../../contexts/CardFilterContext'
import { LabRequestReviewModal } from './LabRequestReviewModal'
import { LabListingBulkSampleModal } from './LabListingBulkSampleModal'
import { openLabRequestResultReportPrint } from '../../utils/printLabTestResultReport'

interface LabBookedRequestListProps {
  patient?: string
  refreshKey?: string | number
  onPatientClick?: (patient: string) => void
  hideAmount?: boolean
}

const VIRTUAL_STATUS_TABS = [
  { key: 'booked', label: 'New Request' },
  { key: 'partial-sample-collected', label: 'Partial Sample' },
  { key: 'sample-collected', label: 'Sample Collected' },
  { key: 'partial-results', label: 'Partial Results' },
  { key: 'pending-review', label: 'Pending Review' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
] as const

type VirtualStatusKey = (typeof VIRTUAL_STATUS_TABS)[number]['key']

/** Persist the selected status tab so a page refresh keeps the user on the same tab. */
const LAB_REQUEST_STATUS_STORAGE_KEY = 'healthcare:lab_request:active_status'

function readSavedVirtualStatus(): VirtualStatusKey {
  try {
    const saved = localStorage.getItem(LAB_REQUEST_STATUS_STORAGE_KEY)
    if (saved && VIRTUAL_STATUS_TABS.some((tab) => tab.key === saved)) {
      return saved as VirtualStatusKey
    }
  } catch {
    // localStorage unavailable (privacy mode / blocked storage) — fall through to default.
  }
  return 'booked'
}

const VIRTUAL_STATUS_COLORS: Record<string, string> = {
  booked: 'info',
  'sample-collected': 'info',
  'partial-sample-collected': 'warning',
  'partial-results': 'warning',
  'pending-review': 'warning',
  reviewed: 'success',
  rejected: 'danger',
}

const VIRTUAL_STATUS_LABELS: Record<string, string> = {
  booked: 'New Request',
  'sample-collected': 'Sample Collected',
  'partial-sample-collected': 'Partial Sample Collected',
  'partial-results': 'Partial Results',
  'pending-review': 'Pending Review',
  reviewed: 'Reviewed',
  rejected: 'Rejected',
}

const isNewRequestRow = (sr: ServiceRequest) => (sr.virtual_status || 'booked') === 'booked'

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

/**
 * Lab page → Lab Request tab only.
 * Lists Lab Test Template Service Requests (one row per request).
 * Virtual statuses: New Request (booked), sample progress, Pending Review, Reviewed, Rejected.
 * Click opens a read-only review modal (no edit).
 * Scoped by header OP/IP and the top-navbar branch (userCostCenter).
 * OP hides inpatient requests; active visit/admission narrows further.
 */
export function LabBookedRequestList({
  patient,
  refreshKey,
  onPatientClick,
  hideAmount = false,
}: LabBookedRequestListProps) {
  const { mode, activeVisit, activeAdmission, userCostCenter } = useCareContext()
  const formatMoney = useFormatMoney()
  const [rows, setRows] = useState<ServiceRequest[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [listTick, setListTick] = useState(0)
  const [showFiltersInternal, setShowFiltersInternal] = useState(false)
  const [collectFromListing, setCollectFromListing] = useState(false)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set())
  const [showBulkCollect, setShowBulkCollect] = useState(false)
  /** Service Request name currently resolving its Lab Test before printing. */
  const [printingName, setPrintingName] = useState<string | null>(null)

  // Virtual status filter (UI-only) — backend computes from linked Lab Tests.
  // Restored from localStorage so a page refresh stays on the same status tab
  // (New Request / Partial Sample / Sample Collected / Partial Results / Pending Review…).
  const [virtualStatus, setVirtualStatus] = useState<VirtualStatusKey>(readSavedVirtualStatus)

  const inDashboardCard = useInDashboardCard()
  const cardFilters = useCardFilters()
  const leadingSlot = useCardLeadingSlot()

  const showFilters = cardFilters !== undefined ? cardFilters : showFiltersInternal
  const showFilterBar = showFilters && virtualStatus !== 'all'

  const careType = mode === 'OP' || mode === 'IP' ? mode : undefined
  const patientVisit = mode === 'OP' ? activeVisit || undefined : undefined
  const inpatientRecord = mode === 'IP' ? activeAdmission || undefined : undefined

  useEffect(() => {
    let cancelled = false
    fetchHealthcarePortalSettings()
      .then((s) => {
        if (!cancelled) setCollectFromListing(Boolean(s.collect_sample_from_request_listing))
      })
      .catch(() => {
        if (!cancelled) setCollectFromListing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSelectedNames(new Set())
  }, [page, virtualStatus, patient, careType, patientVisit, inpatientRecord, userCostCenter])

  useEffect(() => {
    setPage(1)
  }, [userCostCenter, patient, careType, patientVisit, inpatientRecord])

  // Persist the active status tab so a page refresh keeps the user on the same tab.
  useEffect(() => {
    try {
      localStorage.setItem(LAB_REQUEST_STATUS_STORAGE_KEY, virtualStatus)
    } catch {
      // Ignore write failures (privacy mode / storage full).
    }
  }, [virtualStatus])

  useEffect(() => {
    let cancelled = false
    fetchServiceRequests(
      pageSize,
      (page - 1) * pageSize,
      patient,
      'Lab Test Template',
      undefined,
      undefined,
      undefined,
      undefined,
      patientVisit,
      inpatientRecord,
      1, // booked only
      careType,
      virtualStatus === 'all' ? undefined : virtualStatus,
      userCostCenter || undefined,
    )
      .then((res) => {
        if (cancelled) return
        setRows(res.data || [])
        setTotalCount(res.total_count || 0)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load Lab Requests')
        setRows([])
        setTotalCount(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [patient, page, pageSize, refreshKey, listTick, careType, patientVisit, inpatientRecord, virtualStatus, userCostCenter])

  const virtualStatusLabel = (sr: ServiceRequest): string => {
    return VIRTUAL_STATUS_LABELS[sr.virtual_status || 'booked'] || 'New Request'
  }

  const virtualStatusColor = (sr: ServiceRequest): string => {
    return VIRTUAL_STATUS_COLORS[sr.virtual_status || 'booked'] || 'default'
  }

  const selectableRows = useMemo(() => rows.filter(isNewRequestRow), [rows])
  const selectableNames = useMemo(() => selectableRows.map((r) => r.name), [selectableRows])
  const allVisibleSelected =
    collectFromListing &&
    selectableNames.length > 0 &&
    selectableNames.every((n) => selectedNames.has(n))
  const selectedRequests = useMemo(
    () => rows.filter((r) => selectedNames.has(r.name) && isNewRequestRow(r)),
    [rows, selectedNames]
  )

  const toggleSelected = (name: string, checked: boolean) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (checked) {
        for (const n of selectableNames) next.add(n)
      } else {
        for (const n of selectableNames) next.delete(n)
      }
      return next
    })
  }

  /**
   * Print every lab test on a request from the listing row (outside the review modal).
   * The "Lab Test Print" format expands to the full request, matching the modal's Print.
   */
  const handlePrintRequest = async (sr: ServiceRequest) => {
    if (printingName) return
    setPrintingName(sr.name)
    try {
      const printed = await openLabRequestResultReportPrint(sr.name)
      if (!printed) {
        toast.error('No Lab Test available to print for this request.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to print Lab Request')
    } finally {
      setPrintingName(null)
    }
  }

  const collectButton = collectFromListing ? (
    <button
      type="button"
      disabled={selectedNames.size === 0}
      title={
        selectedNames.size
          ? `Collect sample for ${selectedNames.size} selected request${selectedNames.size === 1 ? '' : 's'}`
          : 'Select Lab Requests first'
      }
      onClick={() => setShowBulkCollect(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Droplet className="h-3.5 w-3.5" />
      Collect{selectedNames.size ? ` (${selectedNames.size})` : ''}
    </button>
  ) : null

  // Status tabs + filter toggle — portal into the DashboardCard header (next to the ↗ arrow)
  const statusTabsMarkup = (
    <div className="flex flex-wrap items-center gap-1.5">
      {VIRTUAL_STATUS_TABS.map((tab) => {
        const active = virtualStatus === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setVirtualStatus(tab.key)
              setPage(1)
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'bg-primary text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
      <FilterToggleButton
        active={Boolean(showFilters)}
        onClick={() => setShowFiltersInternal((prev) => !prev)}
      />
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {inDashboardCard && leadingSlot
        ? createPortal(statusTabsMarkup, leadingSlot)
        : (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1 pb-2 border-b border-slate-100 mb-2">
              {statusTabsMarkup}
            </div>
          )}

      {/* Optional active-status summary bar shown when a specific virtual status is selected */}
      {showFilterBar && (
        <div className="flex shrink-0 items-center gap-2 px-1 pb-2 border-b border-slate-100 mb-2">
          <span className="text-xs font-medium text-slate-600">
            Showing: <span className="font-semibold text-slate-800">{VIRTUAL_STATUS_TABS.find(t => t.key === virtualStatus)?.label}</span>
          </span>
          <span className="text-xs text-slate-400">
            ({totalCount} request{totalCount === 1 ? '' : 's'})
          </span>
        </div>
      )}

      {collectFromListing && !loading && selectableRows.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-1 pb-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) => toggleSelectAllVisible(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            Select all on this page
          </label>
          {collectButton}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {loading && (
          <div className="px-3 py-8 text-center text-sm text-slate-500">Loading Lab Requests…</div>
        )}
        {error && !loading && (
          <div className="mx-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-slate-500">
            No Lab Requests
            {patient ? ' for this patient' : ''}
            {careType === 'OP' && patientVisit
              ? ' for this OP visit'
              : careType === 'OP'
                ? ' (OP only)'
                : careType === 'IP' && inpatientRecord
                  ? ' for this admission'
                  : careType === 'IP'
                    ? ' (IP only)'
                    : ''}
            .
          </div>
        )}
        <ul className="space-y-2">
          {rows.map((sr) => {
            const groupCount = sr.lab_request_groups?.length || 0
            const childCount =
              sr.lab_request_groups?.reduce((n, g) => n + (g.children?.length || 0), 0) || 0
            const amount = Number(sr.grand_total ?? sr.amount ?? sr.cost ?? 0)
            const vs = sr.virtual_status || 'booked'
            const vLabel = virtualStatusLabel(sr)
            const vColor = virtualStatusColor(sr)
            const doctorName = (
              sr.assigned_practitioner_name ||
              sr.practitioner_name ||
              ''
            ).trim()
            const showReviewDoctor = vs === 'pending-review' || vs === 'reviewed'
            const metaFields = [
              ['Request', sr.name],
              ['Patient', sr.patient_name || sr.patient],
              ['Doctor', doctorName],
              Number(sr.by_nurse) === 1 ? (['Nursing', 'Yes'] as const) : null,
              ['Ordered', formatDashboardDate(sr.order_date)],
              ['Status', vLabel],
              ['Tests', childCount || groupCount || '—'],
              !hideAmount ? (['Total', formatMoney(amount)] as const) : null,
            ].filter(Boolean) as Array<readonly [string, string | number | null | undefined]>

            return (
              <li key={sr.name} className="flex items-stretch gap-2">
                {collectFromListing && isNewRequestRow(sr) ? (
                  <label
                    className="flex shrink-0 items-center px-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedNames.has(sr.name)}
                      onChange={(e) => toggleSelected(sr.name, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      aria-label={`Select ${sr.name}`}
                    />
                  </label>
                ) : collectFromListing ? (
                  <span className="w-4 shrink-0" aria-hidden />
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedName(sr.name)}
                  className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm ${dashboardCardRowHoverClass}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {sr.template_name || sr.template_dn || 'Lab Request'}
                        </span>
                        {vs !== 'booked' ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            New Request
                          </span>
                        ) : null}
                        {vs === 'booked' && Number(sr.by_nurse) === 1 ? (
                          <span
                            className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800"
                            title="This Lab Request uses a By Nurse template"
                          >
                            Nursing
                          </span>
                        ) : null}
                        <StatusPill status={vLabel} color={vColor} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                        <span className="font-mono text-slate-600">{sr.name}</span>
                        <span>·</span>
                        {onPatientClick && sr.patient ? (
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation()
                              onPatientClick(sr.patient)
                            }}
                          >
                            {sr.patient_name || sr.patient}
                          </button>
                        ) : (
                          <span>{sr.patient_name || sr.patient}</span>
                        )}
                        {sr.order_date ? (
                          <>
                            <span>·</span>
                            <span>{formatDashboardDate(sr.order_date)}</span>
                          </>
                        ) : null}
                        {(childCount > 0 || groupCount > 0) && (
                          <>
                            <span>·</span>
                            <span>
                              {groupCount > 0 ? `${groupCount} group${groupCount === 1 ? '' : 's'}` : ''}
                              {groupCount > 0 && childCount > 0 ? ', ' : ''}
                              {childCount > 0 ? `${childCount} test${childCount === 1 ? '' : 's'}` : ''}
                            </span>
                          </>
                        )}
                        {showReviewDoctor && doctorName ? (
                          <>
                            <span>·</span>
                            <span title="Doctor (requested / assigned)">
                              {doctorName}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!hideAmount && (
                        <span className="text-sm font-semibold tabular-nums text-emerald-700">
                          {formatMoney(amount)}
                        </span>
                      )}
                      <CardRowMetaHint fields={metaFields} />
                    </div>
                  </div>
                </button>
                {vs !== 'booked' ? (
                  <button
                    type="button"
                    title="Print lab results"
                    aria-label={`Print lab results for ${sr.name}`}
                    disabled={printingName !== null}
                    onClick={() => void handlePrintRequest(sr)}
                    className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-teal-300 bg-white text-teal-700 shadow-sm transition-colors hover:bg-teal-50 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>

      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
      />

      {selectedName && (
        <LabRequestReviewModal
          serviceRequestName={selectedName}
          onClose={() => {
            setSelectedName(null)
            setListTick((n) => n + 1)
          }}
        />
      )}
      {showBulkCollect && collectFromListing ? (
        <LabListingBulkSampleModal
          requests={selectedRequests}
          onClose={() => setShowBulkCollect(false)}
          onSaved={() => {
            setSelectedNames(new Set())
            setListTick((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}