import { useState, useEffect, useRef } from 'react'
import { fetchPrescriptions, fetchPrescription, type Prescription, type PrescriptionFilters, type MedicationOrderEntry, mapOrderToDuplicateMedication, createPrescriptionSalesOrder } from '../../services/prescriptions'
import { toast } from '../../hooks/useToast'
import { fetchHealthcarePractitioners, getCurrentUserPractitioner, type LinkFieldOption } from '../../services/common'
import { StatusPill } from '../ui/StatusPill'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { PrescriptionSlideOver } from './PrescriptionSlideOver'
import { SignPrescriptionModal } from './SignPrescriptionModal'
import { CreatePrescriptionModal } from './CreatePrescriptionModal'
import { AddMedicationEntryModal, EditMedicationEntryModal } from './SinglePrescription'
import { prescriptionNeedsSignature, prescriptionIsSigned } from '../../utils/prescriptionSigning'
import { isFuturePlanByStartDate, isMedicationEndDatePassed, isMedicationStopped, normalizePrescriptionType } from '../../utils/prescriptionType'
import { useCareContext } from '../../providers/CareContextProvider'
import { useCardFilters } from '../../contexts/CardFilterContext'
import {
  CardRowMetaHint,
  dashboardCardRowHoverClass,
} from '../ui/dashboardCardListing'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { DateFilterInput } from '../ui/DateFilterInput'
import {
  getMedicationTypeColor,
  getMedicationTypeLabel,
  medicationRowStyle,
  medicationTypeBadgeStyle,
  resolveMedicationTypeForDisplay,
} from '../../utils/medicationTypeColors'


const statusColors: Record<string, string> = {
  Active: 'success',
  Inactive: 'default',
  Discontinued: 'danger',
  Future: 'info',
  // Pale type-chip yellow is unreadable on StatusPill (white text) — use warning amber.
  PRN: 'warning',
  STAT: getMedicationTypeColor('STAT'),
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
  { value: 'Discontinued', label: 'Discontinued' },
  { value: 'Future', label: 'Future' },
  { value: 'PRN', label: 'PRN' },
  { value: 'STAT', label: 'STAT' },
] as const

type LineListingStatus = 'Active' | 'Inactive' | 'Discontinued' | 'Future' | 'PRN' | 'STAT'

function prescriptionLineListingStatus(
  m: MedicationOrderEntry | null,
  row: Prescription,
): LineListingStatus {
  const discontinued = isMedicationStopped(m)
  if (discontinued) return 'Discontinued'

  // UI statuses from prescription type (same idea as Active / Future — display only).
  const typeKey = normalizePrescriptionType(
    resolveMedicationTypeForDisplay(m?.medication_type, m?.is_prn),
  )
  if (typeKey === 'STAT') return 'STAT'
  if (typeKey === 'PRN') return 'PRN'

  if (isFuturePlanByStartDate({ date: m?.date || row.start_date })) return 'Future'
  if (
    isMedicationEndDatePassed({
      end_date: m?.end_date,
      _rx_end: row.end_date,
    })
  ) {
    return 'Inactive'
  }
  return 'Active'
}

function fmtDate(value?: string | null): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleDateString('en-GB')
  } catch {
    return value
  }
}

/**
 * Practitioner who prescribed / added this medication line. Lines that predate the
 * per-line doctor field (or legacy Oracle rows) fall back to the prescription's doctor.
 */
function linePractitionerName(m: MedicationOrderEntry | null, row: Prescription): string {
  return (
    (m?.healthcare_practitioner_name || m?.healthcare_practitioner || '').trim() ||
    (row.healthcare_practitioner_name || row.healthcare_practitioner || row.practitioner || '').trim() ||
    (row.user_name || '').trim()
  )
}

/** Friendly branch label from a Cost Center name (drops the company abbr suffix). */
function branchLabel(cc?: string): string {
  if (!cc) return '-'
  return cc.replace(/\s*-\s*[^-]+$/, '') || cc
}

interface PrescriptionListProps {
  patient?: string
  refreshKey?: string | number
  onPrescriptionSelect?: (name: string) => void
  onPatientClick?: (patient: string) => void
  careContext?: 'Patient Visit' | 'Inpatient Admission'
  /** Default From/To to today and practitioner filter to the logged-in user's practitioner. */
  doctorPrescriptionDefaults?: boolean
  /** Start in history mode: all prescriptions for the patient (no visit/admission scope). */
  defaultAllPatientPrescriptions?: boolean
}

export const PrescriptionList = ({
  patient,
  refreshKey,
  onPrescriptionSelect,
  careContext: careContextProp,
  doctorPrescriptionDefaults = false,
  defaultAllPatientPrescriptions = false,
}: PrescriptionListProps) => {
  const { mode, activeVisit, activeAdmission, selectedPatient: contextPatient, guardClinicalEdit } = useCareContext()

  // Derive care context from global mode when no explicit prop provided.
  const careContext = careContextProp ?? (mode === 'IP' ? 'Inpatient Admission' : 'Patient Visit')
  // Use context patient when no patient prop is passed.
  const effectivePatient = patient ?? (contextPatient || undefined)
  /** Show all prescriptions for the patient (ignore active visit/admission scope). */
  const [showAllPatientPrescriptions, setShowAllPatientPrescriptions] = useState(
    defaultAllPatientPrescriptions,
  )

  // Precise filter: the specific chosen visit or admission (unless history view is active).
  const effectiveVisitFilter =
    showAllPatientPrescriptions ? undefined : mode === 'OP' && activeVisit ? activeVisit : undefined
  const effectiveAdmissionFilter =
    showAllPatientPrescriptions ? undefined : mode === 'IP' && activeAdmission ? activeAdmission : undefined
  const effectiveCareContext = showAllPatientPrescriptions ? undefined : careContext
  /** Active visit/admission scopes the list; user filters still apply on top. */
  const hasContextScope = !showAllPatientPrescriptions && !!(effectiveVisitFilter || effectiveAdmissionFilter)
  const hasCareModeScope =
    !showAllPatientPrescriptions &&
    Boolean(effectivePatient && mode && !hasContextScope)

  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [openActionRow, setOpenActionRow] = useState<string | null>(null)
  const [signTarget, setSignTarget] = useState<Prescription | null>(null)
  const [editLine, setEditLine] = useState<{ prescription: Prescription; order: MedicationOrderEntry } | null>(null)
  const [addMedicationTarget, setAddMedicationTarget] = useState<Prescription | null>(null)
  const [duplicateTarget, setDuplicateTarget] = useState<Prescription | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Filters
  const cardFilters = useCardFilters()
  const [showFiltersInternal, setShowFiltersInternal] = useState(false)
  const showFilters = cardFilters !== undefined ? cardFilters : showFiltersInternal
  const inDashboardCard = cardFilters !== undefined
  const [statusFilter, setStatusFilter] = useState('')
  const [practitionerFilter, setPractitionerFilter] = useState('')
  const [practitionerOptions, setPractitionerOptions] = useState<LinkFieldOption[]>([])
  const [practitionerOpen, setPractitionerOpen] = useState(false)
  const [practitionerQuery, setPractitionerQuery] = useState('')
  // No default date range — doctors found the auto "today" filter annoying.
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [defaultsReady, setDefaultsReady] = useState(!doctorPrescriptionDefaults)

  // All lists start unfiltered — no default practitioner filter (nurse-dept request).
  useEffect(() => {
    if (true) {
      setDefaultsReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const practId = await getCurrentUserPractitioner()
        if (cancelled) return
        if (practId) {
          setPractitionerFilter(practId)
          try {
            const options = await fetchHealthcarePractitioners()
            const match = options.find((p) => p.name === practId)
            setPractitionerQuery(match?.label || practId)
          } catch {
            setPractitionerQuery(practId)
          }
        }
      } finally {
        if (!cancelled) setDefaultsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doctorPrescriptionDefaults])

  const filters: PrescriptionFilters = {
    patient: effectivePatient,
    practitioner: practitionerFilter || undefined,
    fromDate: dateFrom || undefined,
    toDate: dateTo || undefined,
    search: searchQuery.trim() || undefined,
    careContext: effectiveCareContext,
    patientEncounter: effectiveVisitFilter,
    inpatientRecord: effectiveAdmissionFilter,
  }

  const hasActiveFilters = Boolean(
    showAllPatientPrescriptions ||
    statusFilter ||
    searchQuery.trim() ||
    practitionerFilter ||
    dateFrom ||
    dateTo,
  )
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = () => {
    if (!effectivePatient) {
      setPrescriptions([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fetchPrescriptions(50, 0, filters)
      .then(setPrescriptions)
      .catch((err) => setError(err instanceof Error ? err : new Error('Failed to fetch prescriptions')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!defaultsReady) return
    load()
  }, [
    defaultsReady,
    effectivePatient,
    refreshKey,
    practitionerFilter,
    dateFrom,
    dateTo,
    searchQuery,
    effectiveCareContext,
    effectiveVisitFilter,
    effectiveAdmissionFilter,
    showAllPatientPrescriptions,
  ])

  useEffect(() => {
    if (!practitionerOpen) return
    const t = setTimeout(async () => {
      try {
        const opts = await fetchHealthcarePractitioners(practitionerQuery || undefined)
        setPractitionerOptions(opts)
      } catch {
        setPractitionerOptions([])
      }
    }, practitionerQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [practitionerQuery, practitionerOpen])

  const historyStorageKey = effectivePatient ? `prescriptionHistory:${effectivePatient}` : null

  const clearUserFilters = () => {
    setStatusFilter('')
    setSearchQuery('')
    setPractitionerFilter('')
    setPractitionerQuery('')
    setDateFrom('')
    setDateTo('')
  }

  /** All prescriptions for patient — drop visit/admission/OP-IP scope and every list filter. */
  const enterHistoryView = (persist = true) => {
    clearUserFilters()
    setShowAllPatientPrescriptions(true)
    if (persist && historyStorageKey) {
      try {
        sessionStorage.setItem(historyStorageKey, '1')
      } catch {
        /* ignore */
      }
    }
  }

  const handleClearFilters = () => {
    if (!defaultAllPatientPrescriptions) {
      setShowAllPatientPrescriptions(false)
    }
    clearUserFilters()
    if (!defaultAllPatientPrescriptions && historyStorageKey) {
      try {
        sessionStorage.removeItem(historyStorageKey)
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    if (!defaultsReady || !historyStorageKey) return
    if (defaultAllPatientPrescriptions) return
    try {
      if (sessionStorage.getItem(historyStorageKey) === '1') {
        enterHistoryView(false)
      }
    } catch {
      /* ignore */
    }
  }, [defaultsReady, historyStorageKey, defaultAllPatientPrescriptions])

  // Close actions / filter dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-portal-actions-menu]')) return
      if (el.closest('button[aria-label="Actions"]')) return
      if (!el.closest('[data-filter-dropdown]')) {
        setPractitionerOpen(false)
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenActionRow(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleOpenInForm = (name: string) => {
    window.open(`/app/patient-medication-order/${encodeURIComponent(name)}`, '_blank')
    setOpenActionRow(null)
  }

  const openEditLine = (row: Prescription, m: MedicationOrderEntry | null) => {
    if (!m?.name) {
      toast.error('This prescription has no medicine line to edit')
      return
    }
    setOpenActionRow(null)
    guardClinicalEdit(() => {
      void (async () => {
        try {
          const full = await fetchPrescription(row.name)
          const order =
            full?.medication_orders?.find((line) => line.name === m.name) || m
          setEditLine({ prescription: full || row, order })
        } catch {
          setEditLine({ prescription: row, order: m })
        }
      })()
    })
  }

  const handleCreateSalesOrder = async (row: Prescription) => {
    try {
      setActionLoading(row.name)
      const res = await createPrescriptionSalesOrder(row.name)
      // Reload list so reference_doctype/reference_document_name are updated
      load()
      // Inform user and keep SO in draft for pharmacy to edit
      toast.success(`Sales Order ${res.sales_order} created as Draft`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create Service Bill'
      toast.error(msg)
    } finally {
      setActionLoading(null)
      setOpenActionRow(null)
    }
  }

  const handleEditSalesOrder = (row: Prescription) => {
    if (!row.reference_document_name) return
    window.open(`/app/sales-order/${encodeURIComponent(row.reference_document_name)}`, '_blank')
    setOpenActionRow(null)
  }

  if (!defaultsReady || loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-600">Loading prescriptions...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl w-full">
          <h3 className="text-red-800 font-semibold mb-2">Error Loading Prescriptions</h3>
          <p className="text-red-700 text-sm">{error.message}</p>
        </div>
      </div>
    )
  }

  // No list until a patient is in scope — prompt to use the global patient search.
  if (!effectivePatient) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Search for patient to view the list
        </p>
      </div>
    )
  }

  // One row per medicine line; prescriptions without lines still get a single row.
  const medicineRows: { p: Prescription; m: MedicationOrderEntry | null }[] = prescriptions
    .flatMap(
      (p): { p: Prescription; m: MedicationOrderEntry | null }[] =>
        p.medication_orders && p.medication_orders.length > 0
          ? p.medication_orders.map((m) => ({ p, m }))
          : [{ p, m: null }],
    )
    .filter(({ p, m }) => {
      if (!statusFilter) return true
      return prescriptionLineListingStatus(m, p) === statusFilter
    })

  return (
    <div className="min-w-full flex flex-col flex-1 min-h-0 h-full">
      {/* Active-context banner — shown when filtering by a specific visit or admission */}
      {hasContextScope && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            {effectiveVisitFilter
              ? <>Filtered by active visit: <span className="font-semibold ml-1">{effectiveVisitFilter}</span></>
              : <>Filtered by active admission: <span className="font-semibold ml-1">{effectiveAdmissionFilter}</span></>
            }
          </div>
          <button
            type="button"
            onClick={() => enterHistoryView()}
            className="shrink-0 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 transition-colors"
          >
            History
          </button>
        </div>
      )}

      {hasCareModeScope && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-xs mb-2">
          <span>
            Showing {mode === 'IP' ? 'inpatient' : 'outpatient'} prescriptions for this patient
          </span>
          <button
            type="button"
            onClick={() => enterHistoryView()}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
          >
            History
          </button>
        </div>
      )}

      {showAllPatientPrescriptions && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs mb-2">
          <span>Showing all prescriptions for this patient (all visits and admissions)</span>
          {!defaultAllPatientPrescriptions ? (
            <ClearFiltersButton
              onClick={handleClearFilters}
              title="Clear history view and filters"
            />
          ) : hasActiveFilters && (statusFilter || searchQuery.trim() || practitionerFilter || dateFrom || dateTo) ? (
            <ClearFiltersButton
              onClick={handleClearFilters}
              title="Clear filters"
            />
          ) : null}
        </div>
      )}

      {/* Header row — hidden when inside a DashboardCard */}
      {!inDashboardCard && (
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-xl font-semibold text-slate-900">Prescriptions</h2>
          <div className="flex items-center gap-2">
            {effectivePatient && !showAllPatientPrescriptions && (
              <button
                type="button"
                onClick={() => enterHistoryView()}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
              >
                History
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowFiltersInternal(prev => !prev)}
              className={`p-1.5 rounded-md border transition-colors ${showFilters ? 'bg-primary/10 border-primary text-primary' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}
              title={showFilters ? 'Hide filters' : 'Show filters'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Filter bar — toggled from DashboardCard header or standalone list header */}
      {showFilters && (
      <div className="card-filter-bar flex flex-wrap items-end gap-3 mb-3 flex-shrink-0">
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">From Date</label>
          <DateFilterInput
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">To Date</label>
          <DateFilterInput
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div data-filter-dropdown className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Doctor</label>
          <div className="relative">
            <input
              type="text"
              value={practitionerFilter ? (practitionerOptions.find((p) => p.name === practitionerFilter)?.label || practitionerFilter) : practitionerQuery}
              onChange={(e) => {
                setPractitionerQuery(e.target.value)
                setPractitionerFilter('')
                setPractitionerOpen(true)
              }}
              onFocus={() => setPractitionerOpen(true)}
              placeholder="Search doctor..."
              className={`w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${practitionerFilter ? 'pr-8' : ''}`}
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
                ×
              </button>
            )}
            {practitionerOpen && practitionerOptions.length > 0 && (
              <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto">
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
        </div>
        <ClearFiltersButton onClick={handleClearFilters} disabled={!hasActiveFilters} />
      </div>
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
      {prescriptions.length === 0 ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-slate-500">
            {hasActiveFilters ? 'NO PRESCRIPTIONS MATCH YOUR FILTERS.' : 'NO PRESCRIPTIONS FOUND'}
          </div>
        </div>
      ) : (
      /* Medicine-level listing — same columns on the dashboard card and the full screen. */
      <table className="w-full text-sm min-w-[1250px]">
        <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
          <tr>
            <th className="hidden px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Medicine Code
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Medicine Name
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Dose
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Route
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Frequency
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Start Date
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              End Date
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
              Remarks
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Branch
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Status
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Practitioner
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Date of Creation
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
              Prescription
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase w-[110px]">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {medicineRows.map(({ p: row, m }) => {
            const rowKey = m ? `${row.name}:${m.name}` : row.name
            const lineStatus = prescriptionLineListingStatus(m, row)
            const metaFields = [
              ['Prescription', row.name],
              ['Doctor', linePractitionerName(m, row)],
              ['Care context', row.care_context],
              ['Visit', row.patient_encounter],
              ['Admission', row.inpatient_record],
            ] as const
            const openDetail = () => {
              setDetailName(row.name)
              onPrescriptionSelect?.(row.name)
            }
            const typeForDisplay = resolveMedicationTypeForDisplay(m?.medication_type, m?.is_prn)
            const typeLabel = getMedicationTypeLabel(typeForDisplay, m?.is_prn)
            const isPink = Boolean(row.is_pink || m?.is_pink)
            return (
            <tr
              key={rowKey}
              className={`${dashboardCardRowHoverClass} cursor-pointer`}
              style={typeForDisplay || isPink ? medicationRowStyle(typeForDisplay, isPink) : undefined}
              onClick={openDetail}
            >
              <td className="hidden px-3 py-2 text-slate-800 font-medium whitespace-nowrap">
                {m?.drug || '-'}
              </td>
              <td className="px-3 py-2 text-slate-800">
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{m?.drug_name || '-'}</span>
                  {isPink ? (
                    <span className="text-[10px] font-semibold text-pink-600">Pink</span>
                  ) : null}
                  {typeLabel ? (
                    <span
                      className="inline-flex rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide"
                      style={medicationTypeBadgeStyle(typeForDisplay)}
                    >
                      {typeLabel}
                    </span>
                  ) : null}
                </span>
                <CardRowMetaHint fields={metaFields} />
              </td>
              <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                {m?.dosage ? `${m.dosage}${m.uom ? ` ${m.uom}` : ''}` : '-'}
              </td>
              <td className="px-3 py-2 text-slate-700">{m?.route_of_administration || '-'}</td>
              <td className="px-3 py-2 text-slate-700">{m?.patient_frequency || '-'}</td>
              <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                {fmtDate(m?.date || row.start_date)}
              </td>
              <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                {fmtDate(m?.end_date || row.end_date)}
              </td>
              <td className="px-3 py-2 text-slate-600 max-w-[220px]">
                <span className="line-clamp-2">{m?.instructions || '-'}</span>
              </td>
              <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{branchLabel(row.cost_center)}</td>
              <td className="px-3 py-2">
                <StatusPill
                  status={lineStatus}
                  color={statusColors[lineStatus] || 'default'}
                />
              </td>
              <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                {linePractitionerName(m, row) || '-'}
              </td>
              <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(row.creation)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-medium text-primary hover:underline">{row.name}</span>
              </td>
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1.5">
                  <div
                    className="relative inline-block"
                    ref={openActionRow === rowKey ? menuRef : undefined}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenActionRow((prev) => (prev === rowKey ? null : rowKey))
                      }
                      className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      aria-label="Actions"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                    <PortalActionsMenu
                      open={openActionRow === rowKey}
                      onClose={() => setOpenActionRow(null)}
                      triggerRef={menuRef}
                      minWidth={200}
                    >
                      <button
                        type="button"
                        onClick={() => openEditLine(row, m)}
                        className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        Edit Prescription
                      </button>
                      {prescriptionNeedsSignature(row) && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenActionRow(null)
                              guardClinicalEdit(() => setSignTarget(row))
                            }}
                            className="block w-full text-left px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
                          >
                            Sign Prescription
                          </button>
                        </>
                      )}
                      {prescriptionIsSigned(row) &&
                        (Boolean(row.inpatient_record) || row.care_context === 'Inpatient Admission') &&
                        row.status !== 'Completed' &&
                        row.status !== 'Stopped' && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenActionRow(null)
                              guardClinicalEdit(() => setAddMedicationTarget(row))
                            }}
                            className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                          >
                            Add Medication
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() => {
                          setOpenActionRow(null)
                          void (async () => {
                            try {
                              // List rows can be thin — load full order so dosage/frequency copy across.
                              const full = await fetchPrescription(row.name)
                              setDuplicateTarget(full || row)
                            } catch {
                              setDuplicateTarget(row)
                            }
                          })()
                        }}
                        className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenInForm(row.name)}
                        className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        Open in Form
                      </button>
                      {row.reference_doctype === 'Sales Order' && row.reference_document_name ? (
                        <button
                          type="button"
                          onClick={() => handleEditSalesOrder(row)}
                          className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                        >
                          Edit Sales Order
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={actionLoading === row.name}
                          onClick={() => handleCreateSalesOrder(row)}
                          className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          {actionLoading === row.name ? 'Creating Service Bill…' : 'Create Service Bill'}
                        </button>
                      )}
                    </PortalActionsMenu>
                  </div>
                  <PrintFormatDropdown
                    doctype="Patient Medication Order"
                    docName={row.name}
                    noLetterhead={0}
                    triggerPrint={1}
                  />
                </div>
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
      )}
        </div>
      </div>

      {detailName && (
  <PrescriptionSlideOver
  prescriptionName={detailName}
  onClose={() => setDetailName(null)}
  onUpdate={load}
/>
)}

      {signTarget && (
        <SignPrescriptionModal
          prescriptionName={signTarget.name}
          currentSignature={signTarget.doctors_signature}
          status={signTarget.status}
          newSystem={signTarget.new_system}
          onClose={() => setSignTarget(null)}
          onSigned={() => {
            setSignTarget(null)
            load()
          }}
        />
      )}

      {editLine && (
        <EditMedicationEntryModal
          order={editLine.order}
          prescriptionName={editLine.prescription.name}
          patient={editLine.prescription.patient}
          patientEncounter={editLine.prescription.patient_encounter}
          inpatientRecord={editLine.prescription.inpatient_record}
          onClose={() => setEditLine(null)}
          onSaved={() => {
            setEditLine(null)
            load()
          }}
        />
      )}

      {addMedicationTarget && (
        <AddMedicationEntryModal
          prescriptionName={addMedicationTarget.name}
          patient={addMedicationTarget.patient}
          patientEncounter={addMedicationTarget.patient_encounter}
          inpatientRecord={addMedicationTarget.inpatient_record}
          onClose={() => setAddMedicationTarget(null)}
          onSaved={() => {
            setAddMedicationTarget(null)
            toast.success('Medication added')
            load()
          }}
        />
      )}

      {duplicateTarget && (
        <CreatePrescriptionModal
          onClose={() => setDuplicateTarget(null)}
          onSuccess={() => {
            setDuplicateTarget(null)
            toast.success('Prescription duplicated successfully')
            load()
          }}
          initialPatient={effectivePatient}
          initialCareContext={careContext}
          initialPatientEncounter={activeVisit}
          initialInpatientRecord={activeAdmission}
          initialMedications={(duplicateTarget.medication_orders || []).map(mapOrderToDuplicateMedication)}
          initialPractitioner={duplicateTarget.practitioner}
        />
      )}
    </div>
  )
}
