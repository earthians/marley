import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  fetchServiceRequests,
  confirmPayment,
  bookLabAndForward,
  confirmSessionPayment,
  bookSession,
  type ServiceRequest
} from '../../services/serviceRequests'
import {
  fetchLabRequestActions,
  deleteDraftLabRequest,
  cancelBookedLabRequest,
  cancelLabSampleHandling,
  type LabRequestActions,
} from '../../services/labRequestActions'
import {
  fetchServiceRequestTemplateTypes,
  fetchHealthcarePractitioners,
  type LinkFieldOption,
} from '../../services/common'
import { toast } from '../../hooks/useToast'
import { StatusPill } from '../ui/StatusPill'
import { EditServiceRequestModal } from './EditServiceRequestModal'
import { ServiceRequestDetailPanel } from './ServiceRequestDetailPanel'
import { BookConsultationSessionModal } from './BookConsultationSessionModal'
import { LabRequestActionModal, type LabRequestModalAction } from './LabRequestActionModal'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { PaginationControls, LoadMoreControls, DEFAULT_PAGE_SIZE, type PageSize } from '../ui/PaginationControls'
import { X } from 'lucide-react'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import { useCareContext } from '../../providers/CareContextProvider'
import { useCardFilters, useDashboardCompactClinical, usePreferCardLoadMore } from '../../contexts/CardFilterContext'
import {
  CardRowMetaHint,
  dashboardCardRowHoverClass,
  formatDashboardDate,
} from '../ui/dashboardCardListing'
import {
  HEALTHCARE_SERVICE_TEMPLATE,
  serviceRequestPractitionerLabel,
} from '../../utils/serviceRequestLabels'

interface ServiceRequestListProps {
  patient?: string
  onLabTestCreated?: () => void
  refreshKey?: string | number
  template_dt?: string // Optional template type filter
  onCreateIPService?: (sr: ServiceRequest) => void
  /** Flag to indicate if we're in nurse/IP context */
  isNurseContext?: boolean
  onPatientClick?: (patient: string) => void
  title?: string
  subtitle?: string
  onAdd?: () => void
  addButtonTitle?: string
  /** Column / meta label for practitioner (Other Services uses Nurse). */
  practitionerFieldLabel?: string
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

const statusColors: Record<string, string> = {
  'Completed': 'success',
  'Pending': 'warning',
  'Cancelled': 'danger',
  'Revoked': 'danger',
  'Active': 'info',
  'Draft': 'warning'
}

const SR_STATUSES = [
  'draft-Request Status',
  'active-Request Status',
  'on-hold-Request Status',
  'revoked-Request Status',
  'completed-Request Status',
  'entered-in-error-Request Status',
]

const refetch = (
  setLoading: (v: boolean) => void,
  setServiceRequests: Dispatch<SetStateAction<ServiceRequest[]>>,
  setTotalCount: (v: number) => void,
  setError: (v: Error | null) => void,
  patient?: string,
  template_dt?: string,
  statusFilter?: string,
  search?: string,
  limit: number = 20,
  offset: number = 0,
  practitioner?: string,
  patientSearch?: string,
  preferLoadMore: boolean = false,
  page: number = 1,
  costCenter?: string,
) => {
  setLoading(true)
  fetchServiceRequests(
    limit,
    offset,
    patient,
    template_dt || undefined,
    statusFilter || undefined,
    search || undefined,
    practitioner || undefined,
    !patient ? patientSearch?.trim() || undefined : undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    costCenter,
  )
    .then((result) => {
      setServiceRequests((prev) =>
        preferLoadMore && page > 1 ? [...prev, ...result.data] : result.data
      )
      setTotalCount(result.total_count)
    })
    .catch((err) => setError(err instanceof Error ? err : new Error('Failed to fetch service requests')))
    .finally(() => setLoading(false))
}

export const ServiceRequestList = ({
  patient,
  onLabTestCreated,
  refreshKey,
  template_dt,
  onCreateIPService,
  isNurseContext = false,
  onPatientClick,
  title,
  subtitle,
  onAdd,
  addButtonTitle,
  practitionerFieldLabel,
}: ServiceRequestListProps) => {
  const { userCostCenter } = useCareContext()
  const isLabRequestList = template_dt === 'Lab Test Template'
  const isOtherServicesList = template_dt === HEALTHCARE_SERVICE_TEMPLATE || practitionerFieldLabel === 'Nurse'
  const practitionerColumnLabel = serviceRequestPractitionerLabel(
    isOtherServicesList ? HEALTHCARE_SERVICE_TEMPLATE : template_dt,
    practitionerFieldLabel
  )
  const listTitle = title ?? (isLabRequestList ? 'Lab Requests' : 'Service Requests')
  const listAddTitle = addButtonTitle ?? (isLabRequestList ? 'New Lab Request' : 'New Service Request')
  const formatMoney = useFormatMoney()
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [openActionRow, setOpenActionRow] = useState<string | null>(null)
  const [editServiceRequestName, setEditServiceRequestName] = useState<string | null>(null)
  const [detailCanEdit, setDetailCanEdit] = useState(true)
  const [bookingSessionSR, setBookingSessionSR] = useState<ServiceRequest | null>(null)
  const [labActionsBySr, setLabActionsBySr] = useState<Record<string, LabRequestActions>>({})
  const [labRequestModal, setLabRequestModal] = useState<{
    action: LabRequestModalAction
    sr: ServiceRequest
  } | null>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)

  // Pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [totalCount, setTotalCount] = useState(0)

  // Filter state
  const cardFilters = useCardFilters()
  const preferLoadMore = usePreferCardLoadMore()
  const [showFiltersInternal, setShowFiltersInternal] = useState(false)
  const showFilters = cardFilters !== undefined ? cardFilters : showFiltersInternal
  const inDashboardCard = cardFilters !== undefined
  const compactClinical = useDashboardCompactClinical()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [templateDtFilter, setTemplateDtFilter] = useState(template_dt || '')
  const [templateTypes, setTemplateTypes] = useState<LinkFieldOption[]>([])
  const [practitionerFilter, setPractitionerFilter] = useState('')
  const [practitionerQuery, setPractitionerQuery] = useState('')
  const [practitionerOpen, setPractitionerOpen] = useState(false)
  const [practitionerOptions, setPractitionerOptions] = useState<LinkFieldOption[]>([])
  const [practitionerInitDone, setPractitionerInitDone] = useState(false)
  const [patientSearchInput, setPatientSearchInput] = useState('')
  const [debouncedPatientSearch, setDebouncedPatientSearch] = useState('')

  useEffect(() => {
    fetchServiceRequestTemplateTypes().then(setTemplateTypes).catch(() => {})
  }, [])

  // All lists start unfiltered — no default practitioner filter (nurse-dept request).
  useEffect(() => {
    setPractitionerInitDone(true)
  }, [])

  useEffect(() => {
    if (!practitionerOpen) return
    const t = setTimeout(() => {
      fetchHealthcarePractitioners(practitionerQuery || undefined)
        .then(setPractitionerOptions)
        .catch(() => setPractitionerOptions([]))
    }, practitionerQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [practitionerOpen, practitionerQuery])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-portal-actions-menu]')) return
      if (el.closest('button[aria-label="Actions"]')) return
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setOpenActionRow(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!openActionRow) return
    const sr = serviceRequests.find((row) => row.name === openActionRow)
    if (!sr || sr.template_dt !== 'Lab Test Template') return
    fetchLabRequestActions(sr.name)
      .then((actions) => {
        setLabActionsBySr((prev) => ({ ...prev, [sr.name]: actions }))
      })
      .catch(() => {
        setLabActionsBySr((prev) => ({
          ...prev,
          [sr.name]: {
            service_request: sr.name,
            phase: 'post_sample',
            can_delete: false,
            can_cancel_with_settlement: false,
            can_cancel_sample_handling: false,
            can_delete_lab_tests: false,
            can_delete_lab_request: false,
            can_edit_lab_request: false,
            lab_tests: [],
          },
        }))
      })
  }, [openActionRow, serviceRequests])

  useEffect(() => {
    if (!detailName) {
      setDetailCanEdit(true)
      return
    }
    const sr = serviceRequests.find((row) => row.name === detailName)
    if (!sr || sr.template_dt !== 'Lab Test Template') {
      setDetailCanEdit(true)
      return
    }
    let cancelled = false
    fetchLabRequestActions(sr.name)
      .then((actions) => {
        if (cancelled) return
        setLabActionsBySr((prev) => ({ ...prev, [sr.name]: actions }))
        setDetailCanEdit(Boolean(actions.can_edit_lab_request))
      })
      .catch(() => {
        if (!cancelled) setDetailCanEdit(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailName, serviceRequests])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [patient, refreshKey, templateDtFilter, statusFilter, practitionerFilter, debouncedPatientSearch, userCostCenter])

  // Debounced search - reset page
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 400)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [search])

  const patientSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (patientSearchTimerRef.current) clearTimeout(patientSearchTimerRef.current)
    patientSearchTimerRef.current = setTimeout(() => {
      setDebouncedPatientSearch(patientSearchInput)
      setPage(1)
    }, 400)
    return () => { if (patientSearchTimerRef.current) clearTimeout(patientSearchTimerRef.current) }
  }, [patientSearchInput])

  // Single fetch effect (wait until default practitioner is resolved)
  useEffect(() => {
    if (!practitionerInitDone) return
    setError(null)
    refetch(
      setLoading,
      setServiceRequests,
      setTotalCount,
      setError,
      patient,
      templateDtFilter,
      statusFilter,
      debouncedSearch,
      pageSize,
      (page - 1) * pageSize,
      practitionerFilter || undefined,
      debouncedPatientSearch,
      preferLoadMore,
      page,
      userCostCenter || undefined,
    )
  }, [
    patient,
    refreshKey,
    templateDtFilter,
    statusFilter,
    debouncedSearch,
    debouncedPatientSearch,
    practitionerFilter,
    page,
    pageSize,
    practitionerInitDone,
    preferLoadMore,
    userCostCenter,
  ])

  const doRefetch = () =>
    refetch(
      setLoading,
      setServiceRequests,
      setTotalCount,
      setError,
      patient,
      templateDtFilter,
      statusFilter,
      debouncedSearch,
      pageSize,
      (page - 1) * pageSize,
      practitionerFilter || undefined,
      debouncedPatientSearch,
      preferLoadMore,
      page,
      userCostCenter || undefined,
    )

  const handleConfirmPayment = async (sr: ServiceRequest) => {
    setOpenActionRow(null)
    setActionLoading(sr.name)
    try {
      await confirmPayment(sr.name)
      toast.success('Payment confirmed')
      doRefetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm payment')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteDraftLabRequest = async (sr: ServiceRequest) => {
    setOpenActionRow(null)
    setActionLoading(sr.name)
    try {
      await deleteDraftLabRequest(sr.name)
      toast.success('Lab request deleted')
      setLabRequestModal(null)
      setLabActionsBySr((prev) => {
        const next = { ...prev }
        delete next[sr.name]
        return next
      })
      doRefetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete lab request')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancelBookedLabRequest = async (
    sr: ServiceRequest,
    settlementMode: 'refund' | 'patient_credit'
  ) => {
    setOpenActionRow(null)
    setActionLoading(sr.name)
    try {
      const result = await cancelBookedLabRequest(sr.name, settlementMode)
      toast.success(
        settlementMode === 'patient_credit'
          ? `Lab request cancelled. Patient credit recorded${result.payment_entry ? ` (${result.payment_entry})` : ''}.`
          : 'Lab request cancelled. Refund the patient at reception if cash was collected.'
      )
      setLabRequestModal(null)
      setLabActionsBySr((prev) => {
        const next = { ...prev }
        delete next[sr.name]
        return next
      })
      doRefetch()
      onLabTestCreated?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel lab request')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancelLabSampleHandling = async (sr: ServiceRequest) => {
    setOpenActionRow(null)
    setActionLoading(sr.name)
    try {
      await cancelLabSampleHandling({ serviceRequestName: sr.name })
      toast.success('Sample handling cancelled')
      setLabRequestModal(null)
      setLabActionsBySr((prev) => {
        const next = { ...prev }
        delete next[sr.name]
        return next
      })
      doRefetch()
      onLabTestCreated?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel sample handling')
    } finally {
      setActionLoading(null)
    }
  }

  const handleBookLab = async (sr: ServiceRequest) => {
    setOpenActionRow(null)
    setActionLoading(sr.name)
    try {
      const result = await bookLabAndForward(sr.name)
      if (result?.lab_tests && result.count) {
        toast.success(`${result.count} Lab Test${result.count !== 1 ? 's' : ''} created and forwarded to laboratory`)
      } else {
        toast.success(result?.lab_test ? `Lab Test ${result.lab_test} created and forwarded` : 'Forwarded to laboratory')
      }
      onLabTestCreated?.()
      doRefetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to book lab')
    } finally {
      setActionLoading(null)
    }
  }

  const handleEdit = (sr: ServiceRequest) => {
    setOpenActionRow(null)
    if (sr.template_dt === 'Lab Test Template') {
      const actions = labActionsBySr[sr.name]
      if (actions && actions.can_edit_lab_request === false) {
        toast.error('This lab request cannot be edited after sample collection.')
        return
      }
    }
    setEditServiceRequestName(sr.name)
  }

  const handleConfirmSessionPayment = async (sr: ServiceRequest) => {
    setOpenActionRow(null)
    setActionLoading(sr.name)
    try {
      await confirmSessionPayment(sr.name)
      toast.success('Payment confirmed')
      doRefetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm payment')
    } finally {
      setActionLoading(null)
    }
  }

  const displayedPrice = (sr: ServiceRequest) => {
    const g = sr.grand_total != null ? Number(sr.grand_total) : NaN
    if (Number.isFinite(g)) return g
    const c = sr.cost != null ? Number(sr.cost) : NaN
    if (Number.isFinite(c)) return c
    const a = sr.amount != null ? Number(sr.amount) : NaN
    return Number.isFinite(a) ? a : null
  }

  const handleBookSession = async (sr: ServiceRequest) => {
    setOpenActionRow(null)
    // Consultation Service Template → open slot-picker modal
    if (sr.template_dt === 'Consultation Service Template') {
      setBookingSessionSR(sr)
      return
    }
    // All other non-lab types → book directly
    setActionLoading(sr.name)
    try {
      const result = await bookSession(sr.name)
      if (result.created) {
        toast.success(`${result.created.doctype} ${result.created.name} created and session booked`)
      } else {
        toast.success('Session booked successfully')
      }
      doRefetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to book session')
    } finally {
      setActionLoading(null)
    }
  }

  const getStatusColor = (status?: string): string => {
    if (!status) return 'default'
    
    const statusLower = status.toLowerCase()
    if (statusLower.includes('completed')) return 'success'
    if (statusLower.includes('pending')) return 'warning'
    if (statusLower.includes('cancelled') || statusLower.includes('revoked')) return 'danger'
    if (statusLower.includes('active')) return 'info'
    return statusColors[status] || 'default'
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl w-full">
          <h3 className="text-red-800 font-semibold mb-2">
            {isLabRequestList ? 'Error Loading Lab Requests' : 'Error Loading Service Requests'}
          </h3>
          <p className="text-red-700 text-sm mb-2">{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-full flex flex-col flex-1 min-h-0 h-full">
      {!inDashboardCard && (
        <div className="mb-3 flex flex-shrink-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-slate-900">{listTitle}</h2>
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
                  title={listAddTitle}
                >
                  +
                </button>
              ) : null}
            </div>
          </div>
          {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
        </div>
      )}

      {showFilters && (
      <div className="card-filter-bar mb-4 flex flex-shrink-0 flex-wrap items-center gap-3 rounded-md border-b border-slate-100 bg-slate-50/80 px-1 py-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SR ID..."
            className="w-full pr-8 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Template Type filter (only if not fixed by prop) */}
        {!template_dt && (
          <select
            value={templateDtFilter}
            onChange={(e) => setTemplateDtFilter(e.target.value)}
            className="py-2 px-3 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white text-slate-700 min-w-[170px]"
          >
            <option value="">Select All</option>
            {templateTypes.map((t) => (
              <option key={t.name} value={t.name}>{t.label || t.name}</option>
            ))}
          </select>
        )}

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="py-2 px-3 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white text-slate-700 min-w-[140px]"
        >
          <option value="">Select All</option>
          {SR_STATUSES.map((s) => (
            <option key={s} value={s}>{s.split('-')[0].replace(/-/g, ' ')
              .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</option>
          ))}
        </select>

        {!patient && (
          <div className="relative flex-1 min-w-[160px]">
            <label className="sr-only">Patient search</label>
            <input
              type="text"
              value={patientSearchInput}
              onChange={(e) => setPatientSearchInput(e.target.value)}
              placeholder="Patient name or ID…"
              className="w-full py-2 px-3 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        <div data-filter-dropdown className="relative min-w-[180px]">
          <label className="sr-only">Doctor</label>
          <input
            type="text"
            value={
              practitionerFilter
                ? practitionerOptions.find((p) => p.name === practitionerFilter)?.label || practitionerQuery
                : practitionerQuery
            }
            onChange={(e) => {
              setPractitionerQuery(e.target.value)
              setPractitionerFilter('')
              setPractitionerOpen(true)
            }}
            onFocus={() => setPractitionerOpen(true)}
            placeholder="Doctor…"
            className={`w-full py-2 px-3 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${practitionerFilter ? 'pr-8' : ''}`}
          />
          {practitionerFilter && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Clear practitioner filter"
              onClick={() => {
                setPractitionerFilter('')
                setPractitionerQuery('')
                setPractitionerOpen(false)
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {practitionerOpen && practitionerOptions.length > 0 && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
              {practitionerOptions.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={() => {
                    setPractitionerFilter(p.name)
                    setPractitionerQuery(p.label || p.name)
                    setPractitionerOpen(false)
                  }}
                >
                  {p.label || p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {(search || statusFilter || (templateDtFilter && !template_dt) || practitionerFilter || patientSearchInput) ? (
          <ClearFiltersButton
            onClick={() => {
              setSearch('')
              setStatusFilter('')
              if (!template_dt) setTemplateDtFilter('')
              setPractitionerFilter('')
              setPractitionerQuery('')
              setPatientSearchInput('')
              setDebouncedPatientSearch('')
            }}
          />
        ) : null}
      </div>
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
      {loading && serviceRequests.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-slate-500 text-sm">Loading...</div>
      ) : serviceRequests.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-slate-500 text-sm">
          {isLabRequestList ? 'NO LAB REQUESTS FOUND' : 'NO SERVICE REQUESTS FOUND'}
        </div>
      ) : compactClinical ? (
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Test / service</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Status</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Ordered</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {serviceRequests.map((sr) => {
            const metaPractitionerLabel = serviceRequestPractitionerLabel(sr.template_dt)
            const metaFields = [
              [isLabRequestList ? 'Lab Request' : 'Service Request', sr.name],
              [metaPractitionerLabel, sr.practitioner_name],
              ['Template type', sr.template_dt],
              ['Price', displayedPrice(sr) != null ? formatMoney(displayedPrice(sr)!) : ''],
            ] as const
            return (
              <tr
                key={sr.name}
                className={dashboardCardRowHoverClass}
                onClick={() => setDetailName(sr.name)}
              >
                <td className="px-3 py-2.5 text-slate-800 font-medium align-top">
                  <span className="line-clamp-2">{sr.template_name || sr.template_dn || '—'}</span>
                  <CardRowMetaHint fields={metaFields} />
                </td>
                <td className="px-3 py-2.5 align-top">
                  {sr.status ? (
                    <StatusPill status={sr.status} color={getStatusColor(sr.status)} />
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap align-top">
                  {formatDashboardDate(sr.order_date)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      ) : (
      <table className="w-full min-w-[1000px]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
              {isLabRequestList ? 'Lab Request ID' : 'Service Request ID'}
            </th>
            {!patient && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                Patient
              </th>
            )}
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
              Test Name
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
              {practitionerColumnLabel}
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
              Order Date
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
              Price
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase w-[220px]">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {serviceRequests.map((sr) => {
            const isLab = sr.template_dt === 'Lab Test Template'
            const isIPService = sr.template_dt === 'Healthcare Service Template'
            const accepted = !!sr.patient_accepted_cost
            const booked = !!sr.booked
            const loadingThis = actionLoading === sr.name
            const labActions = isLab ? labActionsBySr[sr.name] : undefined
            
            // Determine what action button to show after payment confirmation
            const shouldShowBookingAction = accepted && !booked
            
            return (
              <tr key={sr.name} className="hover:bg-slate-50">
                <td
                  className="px-4 py-3 text-sm font-medium text-primary cursor-pointer hover:underline"
                  onClick={() => setDetailName(sr.name)}
                >
                  {sr.name}
                </td>
                {!patient && (
                  <td
                    className="px-4 py-3 text-sm text-slate-700 cursor-pointer"
                    onClick={() => sr.patient && onPatientClick?.(sr.patient)}
                  >
                    <span className="font-medium text-primary hover:underline">{sr.patient_name || sr.patient || '-'}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-sm text-slate-700">
                  {sr.template_name || sr.template_dn || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {sr.practitioner_name || '-'}
                </td>
                <td className="px-4 py-3">
                  {sr.status ? (
                    <StatusPill
                      status={sr.status}
                      color={getStatusColor(sr.status)}
                    />
                  ) : (
                    <span className="text-sm text-slate-500">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {sr.order_date
                    ? new Date(sr.order_date).toLocaleDateString('en-GB')
                    : '-'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700 tabular-nums">
                  {(() => {
                    const p = displayedPrice(sr)
                    return p != null ? formatMoney(p) : '—'
                  })()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    
                    <div className="relative inline-block" ref={openActionRow === sr.name ? actionMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setOpenActionRow((prev) => (prev === sr.name ? null : sr.name))}
                        disabled={!!actionLoading}
                        className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        aria-label="Actions"
                      >
                        {loadingThis ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        )}
                      </button>
                      <PortalActionsMenu
                        open={openActionRow === sr.name}
                        onClose={() => setOpenActionRow(null)}
                        triggerRef={actionMenuRef}
                        minWidth={180}
                      >
                        {/* ── CONFIRM PAYMENT (for all types) ── */}
                        {!accepted && (
                          <>
                            {isLab ? (
                              <button
                                type="button"
                                onClick={() => handleConfirmPayment(sr)}
                                disabled={loadingThis}
                                className="block w-full text-left px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                              >
                                Confirm Payment
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleConfirmSessionPayment(sr)}
                                disabled={loadingThis}
                                className="block w-full text-left px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                              >
                                Confirm Payment
                              </button>
                            )}
                          </>
                        )}

                        {/* ── BOOK ACTION (after payment confirmed) ── */}
                        {shouldShowBookingAction && (
                          <>
                            {/* Lab Test Template → Book Lab */}
                            {isLab && (
                              <button
                                type="button"
                                onClick={() => handleBookLab(sr)}
                                disabled={loadingThis}
                                className="block w-full text-left px-3 py-2 text-sm text-primary hover:bg-primary/5 font-medium"
                              >
                                {loadingThis ? '…' : 'Book Lab'}
                              </button>
                            )}
                            
                            {isIPService && isNurseContext && (
                              <button
                                type="button"
                                onClick={() => handleBookSession(sr)}
                                disabled={loadingThis}
                                className="block w-full text-left px-3 py-2 text-sm text-primary hover:bg-primary/5 font-medium"
                              >
                                {loadingThis ? '…' : 'Book the Service'}
                              </button>
                            )}
                            
                            {/* Other templates (non-lab, non-IP) → Book Session */}
                            {!isLab && !isIPService && (
                              <button
                                type="button"
                                onClick={() => handleBookSession(sr)}
                                disabled={loadingThis}
                                className="block w-full text-left px-3 py-2 text-sm text-primary hover:bg-primary/5 font-medium"
                              >
                                {loadingThis ? '…' : 'Book Session'}
                              </button>
                            )}
                          </>
                        )}

                        {isIPService && onCreateIPService && !shouldShowBookingAction && (
                          <button
                            type="button"
                            onClick={() => { setOpenActionRow(null); onCreateIPService(sr) }}
                            className="block w-full text-left px-3 py-2 text-sm text-primary hover:bg-primary/5"
                          >
                            Create IP Service
                          </button>
                        )}

                        {isLab && labActions?.can_delete && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenActionRow(null)
                              setLabRequestModal({ action: 'delete', sr })
                            }}
                            disabled={loadingThis}
                            className="block w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete Lab Request
                          </button>
                        )}

                        {isLab && labActions?.can_cancel_with_settlement && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenActionRow(null)
                              setLabRequestModal({ action: 'settlement', sr })
                            }}
                            disabled={loadingThis}
                            className="block w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Cancel Lab Request…
                          </button>
                        )}

                        {isLab && labActions?.can_cancel_sample_handling && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenActionRow(null)
                              setLabRequestModal({ action: 'sample_handling', sr })
                            }}
                            disabled={loadingThis}
                            className="block w-full text-left px-3 py-2 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                          >
                            Cancel Sample Handling
                          </button>
                        )}

                        {(!isLab || labActions?.can_edit_lab_request) && (
                        <button
                          type="button"
                          onClick={() => handleEdit(sr)}
                          className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                        >
                          Edit
                        </button>
                        )}
                      </PortalActionsMenu>
                    </div>

                    {booked && (
                      <span className="text-xs text-slate-500">Booked</span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      )}
        </div>

      {preferLoadMore ? (
        <LoadMoreControls
          loadedCount={serviceRequests.length}
          totalCount={totalCount}
          pageSize={pageSize}
          loading={loading}
          onLoadMore={() => setPage((p) => p + 1)}
        />
      ) : (
        <PaginationControls
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
        />
      )}
      </div>

      {detailName && (
        <ServiceRequestDetailPanel
          name={detailName}
          onClose={() => setDetailName(null)}
          practitionerFieldLabel={isOtherServicesList ? 'Nurse' : practitionerFieldLabel}
          onEdit={
            detailCanEdit
              ? () => {
                  setDetailName(null)
                  setEditServiceRequestName(detailName)
                }
              : undefined
          }
        />
      )}

      {editServiceRequestName && (
        <EditServiceRequestModal
          serviceRequestName={editServiceRequestName}
          onClose={() => setEditServiceRequestName(null)}
          onSuccess={doRefetch}
        />
      )}

      {bookingSessionSR && (
        <BookConsultationSessionModal
          serviceRequest={bookingSessionSR}
          onClose={() => setBookingSessionSR(null)}
          onSuccess={() => { setBookingSessionSR(null); doRefetch() }}
        />
      )}

      {labRequestModal && (
        <LabRequestActionModal
          action={labRequestModal.action}
          serviceRequest={labRequestModal.sr}
          loading={actionLoading === labRequestModal.sr.name}
          onClose={() => {
            if (actionLoading === labRequestModal.sr.name) return
            setLabRequestModal(null)
          }}
          onDeleteConfirm={() => handleDeleteDraftLabRequest(labRequestModal.sr)}
          onSampleHandlingConfirm={() => handleCancelLabSampleHandling(labRequestModal.sr)}
          onSettlementChoice={(mode) => handleCancelBookedLabRequest(labRequestModal.sr, mode)}
        />
      )}
    </div>
  )
}