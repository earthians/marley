
import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCardFilters, useDashboardCompactClinical, usePreferCardLoadMore } from '../../contexts/CardFilterContext'
import { useInpatientRecords } from '../../hooks/useInpatientRecords'
import { fetchHealthcarePractitioners, fetchBranchOptions, getCurrentUserPractitionerOption, type LinkFieldOption } from '../../services/common'
import { useCareContext } from '../../providers/CareContextProvider'
import { PaginationControls, LoadMoreControls, DEFAULT_PAGE_SIZE, type PageSize } from '../ui/PaginationControls'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { StatusPill } from '../ui/StatusPill'
import { PackageSelectionModal } from './PackageSelectionModal'
import { AdmissionFormModal } from './AdmissionFormModal'
import { ScheduleDischargeModal } from './ScheduleDischargeModal'
import { TransferCostCenterModal } from './TransferCostCenterModal'
import { ModifyMedicalSupervisionModal } from './ModifyMedicalSupervisionModal'
import { InpatientAdmissionDetails } from './InpatientAdmissionDetails'
import { AddVisitorModal } from './AddVisitorModal'
import { SuicidalPatientAssessmentModal } from './SuicidalPatientAssessmentModal'
import { navigateToDischarge } from '../../utils/dischargeNavigation'
import { fetchDischargeDraftForAdmission } from '../../services/inpatientRecords'
import { RecoveryRoomRecordModal } from './RecoveryRoomRecordModal'
import { AnesthesiaRecordModal } from './AnesthesiaRecordModal'
import { TimeOutProcedureModal } from './TimeOutProcedureModal'
import { PreEctChecklistModal } from './PreEctChecklistModal'
import { ModifiedAldereteScoreModal } from './ModifiedAldereteScoreModal'
import { ECTAnesthesiaConsentModal } from '../ect/ECTAnesthesiaConsentModal'
import { PreAnesthesiaAssessmentModal } from '../ect/PreAnesthesiaAssessmentModal'
import { PhysicalExaminationModal } from '../physicalExam/PhysicalExaminationModal'
import { PatientHistoryModal } from '../patientHistory/PatientHistoryModal'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import {
  ADMISSION_UI_STATUS_DISCHARGE_IN_PROGRESS,
  getAdmissionDisplayStatus,
  type InpatientRecord,
  type InpatientPackage,
  NO_PACKAGE,
} from '../../services/inpatientRecords'
import { CreatePatientReferralModal } from '../referrals/CreatePatientReferralModal'
import { PatientDiagnosisModal } from '../diagnosis/PatientDiagnosisModal'
import { createInvoiceForInpatientAdmission } from '../../services/inpatientRecords' // Add this import
import { toast } from '../../hooks/useToast' // Add this import if not already present
import { Stethoscope, Eye } from 'lucide-react'
import { InpatientDiagnosisModal } from './InpatientDiagnosisModal'
import { CreateAdmissionModal } from './CreateAdmissionModal'
import { UploadPatientDocumentsModal } from '../documents/UploadPatientDocumentsModal'
import { formatAdmissionDate, formatDateOnlyDisplay, resolveAdmissionStayDays } from '../../utils/admissionDateTime'
import { TruncatedName } from '../ui/dashboardCardListing'
import { isDoctorRole, isNurseRole } from '../../config/permissions'
import { openPatientAdmissionBarcodePrint } from '../../utils/printPatientAdmissionBarcode'
import { stripDischargeFlowParams } from '../../utils/dischargeNavigation'
import { DateFilterInput } from '../ui/DateFilterInput'
import { useSlideOverListNav } from '../../hooks/useSlideOverListNav'
import {
  admissionListFilterStorageKey,
  clearPersistedListFilters,
  readPersistedListFilters,
  writePersistedListFilters,
} from '../../utils/persistedListFilters'

const statusColors: Record<string, string> = {
  'Admission Scheduled': 'warning',
  'Admitted': 'success',
  [ADMISSION_UI_STATUS_DISCHARGE_IN_PROGRESS]: 'warning',
  'Discharge Scheduled': 'info',
  'Discharged': 'default',
  'Cancelled': 'danger',
}

/** Default status on every inpatient admission list. */
const DEFAULT_ADMISSION_STATUS = 'Admitted'

type PersistedAdmissionFilters = {
  status?: string
  dateFrom?: string
  dateTo?: string
  practitionerFilter?: string
  practitionerLabel?: string
}

function formatAdmissionPatientLabel(record: { patient_name?: string; patient?: string; file_no?: string | null }): string {
  // Patient column shows the name only — no file no / patient id prefix.
  return (record.patient_name || '').trim() || '-'
}

interface AdmissionListProps {
  onAdmissionSelect?: (admissionName: string) => void
  /** Select admission in navbar (IP mode) and go to doctor/nurse home — used from clinical portals */
  onAdmissionActivate?: (record: InpatientRecord) => void
  onPatientFromAdmission?: (patient: string) => void
  searchQuery?: string
  patient?: string
  refreshKey?: string | number
  onCreateNew?: () => void
  /** Initial Status filter. Defaults to 'Admitted'; reception passes 'Admission Scheduled'
   *  so the admit queue is visible on load. */
  defaultStatus?: string
}

export const AdmissionList = ({
  onAdmissionActivate,
  onPatientFromAdmission,
  searchQuery: externalSearchQuery = '',
  patient,
  refreshKey,
  onCreateNew,
  defaultStatus = DEFAULT_ADMISSION_STATUS,
}: AdmissionListProps = {}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    mode,
    activeAdmission,
    selectedPatient: contextPatient,
    userRole,
    applyIpCareContext,
    setSelectedPatient,
    userCostCenter,
  } = useCareContext()
  const compactCard = useDashboardCompactClinical()
  const isDoctorList = isDoctorRole(userRole)
  const tableColSpan = (patient ? 11 : 12)
  const thClass = compactCard
    ? 'px-1.5 py-1.5 text-left text-[10px] font-semibold text-slate-600 uppercase tracking-tight whitespace-nowrap'
    : 'px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap'
  const tdClass = compactCard
    ? 'px-1.5 py-1.5 text-xs text-slate-700 overflow-hidden'
    : 'px-4 py-3 text-sm text-slate-700'
  const actionStickyClass = compactCard
    ? 'sticky right-0 z-10 bg-white group-hover:bg-slate-50 shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.18)]'
    : ''
  const actionHeadStickyClass = compactCard
    ? 'sticky right-0 z-20 bg-slate-50 shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.18)]'
    : ''

  const effectivePatient = patient !== undefined ? (patient || undefined) : (contextPatient || undefined)
  // When IP mode has a specific admission selected globally, lock the list to that admission
  // unless a patient is in scope (dashboard patient view shows all admissions for that patient).
  const effectiveNameFilter = (mode === 'IP' && activeAdmission && !effectivePatient) ? activeAdmission : undefined

  const filterStorageKey = admissionListFilterStorageKey(location.pathname)
  const restoredFiltersRef = useRef(
    readPersistedListFilters<PersistedAdmissionFilters>(filterStorageKey),
  )
  const restoredFilters = restoredFiltersRef.current

  const [selectedStatus, setSelectedStatus] = useState<string>(
    () => (restoredFilters && typeof restoredFilters.status === 'string'
      ? restoredFilters.status
      : defaultStatus),
  )
  const cardFilters = useCardFilters()
  const preferLoadMore = usePreferCardLoadMore()
  const [showFiltersInternal, setShowFiltersInternal] = useState(() => {
    if (!restoredFilters) return false
    return (
      (typeof restoredFilters.status === 'string' && restoredFilters.status !== defaultStatus) ||
      Boolean(restoredFilters.dateFrom || restoredFilters.dateTo)
    )
  })
  const showFilters = cardFilters !== undefined ? cardFilters : showFiltersInternal
  const isInsideCard = cardFilters !== undefined
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null)
  const [showPackages, setShowPackages] = useState(false)
  const [showAdmissionForm, setShowAdmissionForm] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<InpatientPackage | null>(null)
  const [showScheduleDischarge, setShowScheduleDischarge] = useState(false)
  const [medicalSupervisionAdmission, setMedicalSupervisionAdmission] = useState<InpatientRecord | null>(null)
  const [selectedAdmissionForDischarge, setSelectedAdmissionForDischarge] = useState<InpatientRecord | null>(null)
  const [showTransferCostCenter, setShowTransferCostCenter] = useState(false)
  const [selectedAdmissionForTransfer, setSelectedAdmissionForTransfer] = useState<InpatientRecord | null>(null)
  const [showVisitorModal, setShowVisitorModal] = useState(false)
  const [visitorAdmission, setVisitorAdmission] = useState<InpatientRecord | null>(null)
  const [showSuicideAssessment, setShowSuicideAssessment] = useState(false)
  const [suicideAssessmentAdmission, setSuicideAssessmentAdmission] = useState<InpatientRecord | null>(null)
  const [showRecoveryRoom, setShowRecoveryRoom] = useState(false)
  const [recoveryRoomAdmission, setRecoveryRoomAdmission] = useState<InpatientRecord | null>(null)
  const [showAnesthesia, setShowAnesthesia] = useState(false)
  const [anesthesiaAdmission, setAnesthesiaAdmission] = useState<InpatientRecord | null>(null)
  const [showTimeOut, setShowTimeOut] = useState(false)
  const [timeOutAdmission, setTimeOutAdmission] = useState<InpatientRecord | null>(null)
  const [showPreEct, setShowPreEct] = useState(false)
  const [preEctAdmission, setPreEctAdmission] = useState<InpatientRecord | null>(null)
  const [showAldereteScore, setShowAldereteScore] = useState(false)
  const [aldereteScoreAdmission, setAldereteScoreAdmission] = useState<InpatientRecord | null>(null)
  const [showECTAnesthesiaConsent, setShowECTAnesthesiaConsent] = useState(false)
  const [ectAnesthesiaConsentAdmission, setEctAnesthesiaConsentAdmission] = useState<InpatientRecord | null>(null)
  const [showPreAnesthesia, setShowPreAnesthesia] = useState(false)
  const [preAnesthesiaAdmission, setPreAnesthesiaAdmission] = useState<InpatientRecord | null>(null)
  const [showPhysicalExam, setShowPhysicalExam] = useState(false)
  const [physicalExamAdmission, setPhysicalExamAdmission] = useState<InpatientRecord | null>(null)
  const [showPatientHistory, setShowPatientHistory] = useState(false)
  const [patientHistoryAdmission, setPatientHistoryAdmission] = useState<InpatientRecord | null>(null)
  const [referralAdmission, setReferralAdmission] = useState<InpatientRecord | null>(null)
  const [diagnosisAdmission, setDiagnosisAdmission] = useState<InpatientRecord | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [diagnosisModalAdmission, setDiagnosisModalAdmission] = useState<InpatientRecord | null>(null)
  const [editAdmissionName, setEditAdmissionName] = useState<string | null>(null)
  const [uploadDocumentsAdmission, setUploadDocumentsAdmission] = useState<InpatientRecord | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  // --- Filter: Admission No (searchable dropdown) ---

  // --- Filter: Practitioner (searchable dropdown) ---
  const [practitionerQuery, setPractitionerQuery] = useState('')
  const [practitionerOptions, setPractitionerOptions] = useState<LinkFieldOption[]>([])
  const [practitionerOpen, setPractitionerOpen] = useState(false)
  const [selectedPractitioner, setSelectedPractitioner] = useState<LinkFieldOption | null>(() => {
    const name = restoredFilters?.practitionerFilter
    if (!name) return null
    return {
      name,
      label: restoredFilters?.practitionerLabel || name,
    }
  })
  const [practitionerFilter, setPractitionerFilter] = useState(
    () => restoredFilters?.practitionerFilter || '',
  )

  // Default the Admission By Doctor filter to the logged-in practitioner — ONLY for doctors.
  // Other roles (nurse, etc.) must not get a self-filter that hides admissions.
  // Skip when a doctor filter was already restored from session (refresh keeps the choice).
  useEffect(() => {
    if (restoredFilters?.practitionerFilter) return
    if (effectivePatient || effectiveNameFilter) return
    if (!isDoctorRole(userRole)) return
    let cancelled = false
    getCurrentUserPractitionerOption().then((opt) => {
      if (cancelled || !opt) return
      setSelectedPractitioner(opt)
      setPractitionerFilter(opt.name)
    })
    return () => { cancelled = true }
    // Resolve once on mount; user edits afterwards must not re-trigger the default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [dateFrom, setDateFrom] = useState(() => restoredFilters?.dateFrom || '')
  const [dateTo, setDateTo] = useState(() => restoredFilters?.dateTo || '')

  const excludeCancelled = Boolean(effectivePatient && !selectedStatus && !effectiveNameFilter)

  // Branch options — used to show a friendly label in the Branch column of the table.
  // The list itself always follows the global (navbar) branch via userCostCenter.
  const [branchOptions, setBranchOptions] = useState<LinkFieldOption[]>([])
  useEffect(() => {
    let cancelled = false
    fetchBranchOptions().then((opts) => { if (!cancelled) setBranchOptions(opts) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Keep chosen filters across page refresh (status, dates, doctor).
  useEffect(() => {
    writePersistedListFilters(filterStorageKey, {
      status: selectedStatus,
      dateFrom,
      dateTo,
      practitionerFilter,
      practitionerLabel: selectedPractitioner?.label || '',
    } satisfies PersistedAdmissionFilters)
  }, [
    filterStorageKey,
    selectedStatus,
    dateFrom,
    dateTo,
    practitionerFilter,
    selectedPractitioner,
  ])
  const branchLabel = (cc?: string) => {
    if (!cc) return '-'
    return branchOptions.find((o) => o.name === cc)?.label || cc.replace(/\s*-\s*[^-]+$/, '') || cc
  }

  // Actions dropdown (three-dot menu) — one row open at a time
  const [openActionRow, setOpenActionRow] = useState<string | null>(null)
  const [openActionRowHasDraft, setOpenActionRowHasDraft] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Slide-over detail panel — opens when clicking the row (not the case number)
  const [detailAdmission, setDetailAdmission] = useState<string | null>(null)

  const openAdmissionDetail = (record: InpatientRecord) => {
    setDetailAdmission(record.name)
  }

  const handleAdmissionIdClick = (e: React.MouseEvent, record: InpatientRecord) => {
    e.stopPropagation()
    if (onAdmissionActivate) {
      onAdmissionActivate(record)
      return
    }

    applyIpCareContext({
      patient: record.patient,
      admission: record.name,
      admissionLabel: record.name,
    })
    if (record.patient) {
      setSelectedPatient(record.patient)
      onPatientFromAdmission?.(record.patient)
    }

    const portal = location.pathname.startsWith('/doctor')
      ? '/doctor'
      : location.pathname.startsWith('/nurse')
        ? '/nurse'
        : isDoctorRole(userRole)
          ? '/doctor'
          : isNurseRole(userRole)
            ? '/nurse'
            : null

    if (!portal) return

    const onPortal = location.pathname.startsWith(portal)
    const params = new URLSearchParams(onPortal ? location.search : undefined)
    if (record.patient) params.set('patient', record.patient)
    params.delete('screen')
    stripDischargeFlowParams(params)
    navigate(`${portal}?${params.toString()}`, { replace: onPortal })
  }

  const { records, totalCount, loading, refreshing, error, refetch } = useInpatientRecords(
    effectiveNameFilter ? undefined : (selectedStatus || undefined),
    effectiveNameFilter ?? (externalSearchQuery || undefined),
    effectiveNameFilter ? undefined : effectivePatient,
    effectiveNameFilter ? undefined : (practitionerFilter || undefined),
    effectiveNameFilter ? undefined : (dateFrom || undefined),
    effectiveNameFilter ? undefined : (dateTo || undefined),
    refreshKey,
    pageSize,
    (page - 1) * pageSize,
    excludeCancelled,
    userCostCenter || undefined,
    Boolean(effectivePatient),
    preferLoadMore,
  )

  const { hasPrev, hasNext, navLabel, goPrev, goNext } = useSlideOverListNav({
    items: records,
    loading,
    refreshing,
    getKey: (record) => record.name,
    selectedKey: detailAdmission,
    onSelect: (record) => setDetailAdmission(record.name),
    page,
    setPage,
    pageSize,
    totalCount,
  })

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [selectedStatus, externalSearchQuery, effectivePatient, practitionerFilter, dateFrom, dateTo, effectiveNameFilter, excludeCancelled])

  // --- Practitioner: debounced search when dropdown is open ---
  useEffect(() => {
    if (!practitionerOpen) return
    const t = setTimeout(async () => {
      try {
        const options = await fetchHealthcarePractitioners(practitionerQuery || undefined)
        setPractitionerOptions(options)
      } catch (err) {
        console.error('Failed to load practitioners', err)
        setPractitionerOptions([])
      }
    }, practitionerQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [practitionerQuery, practitionerOpen])

  const handleAdmit = (recordName: string) => {
    setSelectedRecord(recordName)
    setShowPackages(true)
  }

  const handleAdmitWithoutPackage = (recordName: string) => {
    setSelectedRecord(recordName)
    setSelectedPackage(NO_PACKAGE)
    setShowPackages(false)
    setShowAdmissionForm(true)
  }

  const handlePackageSelect = (pkg: InpatientPackage) => {
    setSelectedPackage(pkg)
    setShowPackages(false)
    setShowAdmissionForm(true)
  }

  const handleAdmissionComplete = () => {
    setShowAdmissionForm(false)
    setSelectedRecord(null)
    setSelectedPackage(null)
    refetch()
  }

  const handleScheduleDischarge = (record: InpatientRecord) => {
    setSelectedAdmissionForDischarge(record)
    setShowScheduleDischarge(true)
  }

  const handleDischargeScheduled = () => {
    setShowScheduleDischarge(false)
    setSelectedAdmissionForDischarge(null)
    refetch()
  }

  const handleDischarge = (record: InpatientRecord) => {
    navigateToDischarge(
      {
        name: record.name,
        patient: record.patient,
        patient_name: record.patient_name,
      },
      navigate,
      `${location.pathname}${location.search}`
    )
    setOpenActionRow(null)
  }

  const handleContinueDischarge = (record: InpatientRecord) => {
    handleDischarge(record)
  }

  useEffect(() => {
    if (!openActionRow) {
      setOpenActionRowHasDraft(false)
      return
    }
    let cancelled = false
    fetchDischargeDraftForAdmission(openActionRow)
      .then((d) => {
        if (!cancelled) setOpenActionRowHasDraft(Boolean(d?.name))
      })
      .catch(() => {
        if (!cancelled) setOpenActionRowHasDraft(false)
      })
    return () => {
      cancelled = true
    }
  }, [openActionRow])

  const handleTransferCostCenter = (record: InpatientRecord) => {
    setSelectedAdmissionForTransfer(record)
    setShowTransferCostCenter(true)
    setOpenActionRow(null)
  }

  const handleTransferComplete = () => {
    setShowTransferCostCenter(false)
    setSelectedAdmissionForTransfer(null)
    refetch()
  }

  // Add this function to handle invoice creation
  const handleCreateInvoice = async (admissionName: string) => {
    setActionLoading(admissionName + '_invoice')
    try {
      const invoice = await createInvoiceForInpatientAdmission(admissionName)
      toast.success(`Invoice created: ${invoice.sales_invoice}`)
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally {
      setActionLoading(null)
      setOpenActionRow(null)
    }
  }

  // Close actions dropdown when clicking outside (ignore portaled menu and the three-dot trigger)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-portal-actions-menu]')) return
      if (el.closest('button[aria-label="Actions"]')) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenActionRow(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close filter dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-filter-dropdown]')) {
        setPractitionerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handlePractitionerSelect = (opt: LinkFieldOption) => {
    setSelectedPractitioner(opt)
    setPractitionerFilter(opt.name)
    setPractitionerQuery('')
    setPractitionerOpen(false)
  }

  const handleClearFilters = () => {
    setPractitionerFilter('')
    setPractitionerQuery('')
    setSelectedPractitioner(null)
    setDateFrom('')
    setDateTo('')
    setSelectedStatus(defaultStatus)
    clearPersistedListFilters(filterStorageKey)
  }

  const statuses = [
    'Admission Scheduled',
    'Admitted',
    ADMISSION_UI_STATUS_DISCHARGE_IN_PROGRESS,
    'Discharge Scheduled',
    'Discharged',
    'Cancelled',
  ]
  const hasActiveFilters =
    Boolean(practitionerFilter || dateFrom || dateTo) ||
    selectedStatus !== defaultStatus
  const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

  const exportFilteredCsv = () => {
    const headers = ['Case No', 'Patient', 'Admission Date', 'Status']
    const rows = records.map((r) => [
      r.name,
      formatAdmissionPatientLabel(r),
      formatAdmissionDate(r, { fallback: '' }),
      getAdmissionDisplayStatus(r) || '',
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inpatient-admissions-${dateFrom || 'all'}-${dateTo || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printFilteredList = () => {
    const win = window.open('', '_blank', 'width=1200,height=800')
    if (!win) return
    const rows = records.map((r) => `<tr><td>${r.name}</td><td>${formatAdmissionPatientLabel(r)}</td><td>${formatAdmissionDate(r, { fallback: '' })}</td><td>${getAdmissionDisplayStatus(r) || ''}</td></tr>`).join('')
    win.document.write(`<html><head><title>Inpatient Admission Listing</title></head><body><h3>Inpatient Admission Listing</h3><table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>Case No</th><th>Patient</th><th>Admission Date</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`)
    win.document.close()
    win.print()
  }

  if (loading && records.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-600">Loading admissions...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl w-full">
          <h3 className="text-red-800 font-semibold mb-2">Error Loading Admissions</h3>
          <p className="text-red-700 text-sm mb-2">{error.message}</p>
          <p className="text-red-600 text-xs mb-4">
            This might be due to authentication issues. Please ensure you're logged in to Frappe.
          </p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col flex-1 min-h-0 h-full transition-opacity ${refreshing ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex flex-col flex-1 min-h-0 gap-4">
        {!isInsideCard && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-slate-900">Admission Management</h2>
          <div className="flex items-center gap-2">
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
          <button type="button" onClick={printFilteredList} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md hover:bg-slate-50">PDF</button>
          <button type="button" onClick={exportFilteredCsv} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md hover:bg-slate-50">Excel</button>
          {onCreateNew && (
            <button
              type="button"
              onClick={onCreateNew}
              className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold flex-shrink-0"
              title="Add Admission"
            >
              +
            </button>
          )}
          </div>
        </div>
        )}
        {/* Global-context active admission banner */}
        {effectiveNameFilter && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs mb-2">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            Filtered by active admission: <span className="font-semibold ml-1">{effectiveNameFilter}</span>
          </div>
        )}

        {/* Filters — same layout as Patient Visit List */}
        {!effectiveNameFilter && showFilters && (
        <div className="card-filter-bar flex flex-wrap gap-3 mb-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From Date</label>
            <DateFilterInput
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To Date</label>
            <DateFilterInput
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={inputClass}
            />
          </div>
          {/* Practitioner — searchable dropdown */}
          <div data-filter-dropdown className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1">ADMISSION BY DOCTOR</label>
            <input
              type="text"
              value={selectedPractitioner ? selectedPractitioner.label : practitionerQuery}
              onChange={e => {
                setPractitionerQuery(e.target.value)
                setSelectedPractitioner(null)
                setPractitionerFilter('')
                setPractitionerOpen(true)
              }}
              onFocus={() => setPractitionerOpen(true)}
              placeholder="Search doctor..."
              className={inputClass}
            />
            {practitionerOpen && practitionerOptions.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                {practitionerOptions.map(opt => (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => handlePractitionerSelect(opt)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status — dropdown */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className={inputClass}
            >
              <option value="">Select All</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex items-end">
            <ClearFiltersButton onClick={handleClearFilters} disabled={!hasActiveFilters} />
          </div>
        </div>
        )}

        {/* Records Table */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden min-w-0">
          <div className="flex-1 min-h-0 overflow-auto">
          <table className={compactCard ? 'w-full table-fixed' : 'w-full min-w-[1400px]'}>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={thClass}>Case No.</th>
                <th className={thClass}>File No.</th>
                {!patient && (
                  <th className={thClass}>{compactCard ? 'Patient' : 'Patient Name'}</th>
                )}
                <th className={thClass}>{compactCard ? 'Adm. Date' : 'Admission Date'}</th>
                {isDoctorList ? (
                  <th className={`${thClass} ${compactCard ? 'w-[7rem] min-w-[7rem]' : 'min-w-[7.5rem]'}`}>
                    {compactCard ? 'Disc. Date' : 'Discharge Date'}
                  </th>
                ) : null}
                <th className={thClass}>Branch</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>{compactCard ? 'Adm. Doctor' : 'Admission by Doctor'}</th>
                <th className={thClass}>{compactCard ? 'Res. Doctor' : 'Resident Doctor'}</th>
                <th className={thClass}>{compactCard ? 'Psych.' : 'Psychologist'}</th>
                {!isDoctorList ? (
                  <th className={thClass}>{compactCard ? 'Room' : 'Room No.'}</th>
                ) : null}
                <th className={`${thClass} ${compactCard ? 'w-10 text-center' : ''}`}>Days</th>
                <th className={`${thClass} ${compactCard ? 'w-11' : ''} ${actionHeadStickyClass}`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-4 py-8 text-center text-slate-500">
                    {hasActiveFilters ? 'NO ADMISSIONS MATCH YOUR FILTERS.' : 'NO ADMISSIONS FOUND'}
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr
                    key={record.name}
                    className="hover:bg-slate-50 cursor-pointer group"
                    onClick={() => openAdmissionDetail(record)}
                  >
                    {/* Case No — select patient + IP in header (doctor/nurse home) */}
                    <td className={`${tdClass} font-medium`} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={(e) => handleAdmissionIdClick(e, record)}
                        className="text-primary hover:underline text-left focus:outline-none block w-full truncate"
                        title="Select this admission in header"
                      >
                        {record.case_no || record.name}
                      </button>
                    </td>
                    <td className={`${tdClass} truncate`} title={record.file_no || undefined}>{record.file_no || '-'}</td>

                    {!patient && (
                      <td
                        className={`${tdClass} cursor-pointer`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (record.patient) onPatientFromAdmission?.(record.patient)
                        }}
                      >
                        <TruncatedName
                          fill={compactCard}
                          value={formatAdmissionPatientLabel(record)}
                          className="font-medium text-primary hover:underline"
                        />
                      </td>
                    )}
                    <td
                      className={`${tdClass} ${isDoctorList && compactCard ? 'text-[10px] tabular-nums whitespace-nowrap' : compactCard ? 'truncate' : 'whitespace-nowrap tabular-nums'}`}
                    >
                      {formatAdmissionDate(record, { includeTime: false, fallback: '-' })}
                    </td>
                    {isDoctorList ? (
                      <td
                        className={`${tdClass} ${compactCard ? 'text-[10px] tabular-nums whitespace-nowrap' : 'whitespace-nowrap tabular-nums'}`}
                      >
                        {formatDateOnlyDisplay(
                          record.discharge_datetime || record.draft_discharge_date,
                          '-',
                        )}
                      </td>
                    ) : null}
                    <td className={`${tdClass} truncate`} title={record.cost_center || undefined}>{branchLabel(record.cost_center)}</td>
                    <td className={`${tdClass} ${compactCard ? '' : 'whitespace-nowrap'}`}>
                      {(() => {
                        const displayStatus = getAdmissionDisplayStatus(record)
                        return (
                          <StatusPill
                            status={displayStatus}
                            compact={compactCard}
                            color={statusColors[displayStatus] || statusColors[record.status] || 'default'}
                          />
                        )
                      })()}
                    </td>
                    <td className={tdClass}>
                      <TruncatedName fill={compactCard} value={record.admission_doctor_name || record.admission_by_doctor} />
                    </td>
                    <td className={tdClass}>
                      <TruncatedName fill={compactCard} value={record.resident_doctor_name || record.residents_doctor_no} />
                    </td>
                    <td className={tdClass}>
                      <TruncatedName fill={compactCard} value={record.psychologist_doctor_name || record.psychologist_doctor} />
                    </td>
                    {!isDoctorList ? (
                      <td className={`${tdClass} truncate`}>{record.room_service_no || record.bed_no || '-'}</td>
                    ) : null}
                    <td className={`${tdClass} ${compactCard ? 'text-center' : 'whitespace-nowrap text-center'}`}>
                      {resolveAdmissionStayDays(record) ?? '-'}
                    </td>

                    <td className={`${compactCard ? 'px-1 py-1.5' : 'px-4 py-3'} ${actionStickyClass}`} onClick={(e) => e.stopPropagation()}>
                        <div className={`flex items-center ${compactCard ? 'gap-0 justify-center' : 'gap-1.5'}`}>
                          <div className="relative inline-block" ref={openActionRow === record.name ? menuRef : undefined}>
                            <button
                              type="button"
                              onClick={() => setOpenActionRow((prev) => (prev === record.name ? null : record.name))}
                              className={`inline-flex items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 ${compactCard ? 'w-7 h-7' : 'w-8 h-8'}`}
                              aria-label="Actions"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>
                            <PortalActionsMenu
                              open={openActionRow === record.name}
                              onClose={() => setOpenActionRow(null)}
                              triggerRef={menuRef}
                              minWidth={200}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  openAdmissionDetail(record)
                                  setOpenActionRow(null)
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                              >
                                <Eye className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                                View
                              </button>
                              {/* Add Create Invoice button - visible for most statuses */}
                              {record.status !== 'Cancelled' && record.status !== 'Discharged' && (
                                <button
                                  type="button"
                                  onClick={() => handleCreateInvoice(record.name)}
                                  disabled={actionLoading === record.name + '_invoice'}
                                  className="block w-full text-left px-3 py-2 text-sm text-green-600 hover:bg-green-50 disabled:opacity-50"
                                >
                                  {actionLoading === record.name + '_invoice' ? 'Creating...' : 'Create Invoice'}
                                </button>
                              )}

                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditAdmissionName(record.name)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                >
                                  Edit
                                </button>
                              )}

                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setUploadDocumentsAdmission(record)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50"
                                >
                                  Upload Document
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  openPatientAdmissionBarcodePrint(record.name)
                                  setOpenActionRow(null)
                                }}
                                className="block w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-100 font-semibold"
                                title="Print patient barcode label"
                              >
                                PB
                              </button>
                              
                              {record.status === 'Admission Scheduled' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => { handleAdmit(record.name); setOpenActionRow(null) }}
                                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                  >
                                    Admit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { handleAdmitWithoutPackage(record.name); setOpenActionRow(null) }}
                                    className="block w-full text-left px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50"
                                    title="Skip package and quotation — choose room and admit"
                                  >
                                    Admit without package
                                  </button>
                                </>
                              )}
                              {record.status === 'Admitted' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => { handleScheduleDischarge(record); setOpenActionRow(null) }}
                                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                  >
                                    Schedule Discharge
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMedicalSupervisionAdmission(record)
                                      setOpenActionRow(null)
                                    }}
                                    className="block w-full text-left px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
                                  >
                                    Modify Medical Supervision
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleTransferCostCenter(record)}
                                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                  >
                                    Transfer to Another Branch
                                  </button>
                                </>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted' || record.status === 'Discharge Scheduled') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVisitorAdmission(record)
                                    setShowVisitorModal(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                >
                                  Add Visitor
                                </button>
                              )}

                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted' || record.status === 'Discharge Scheduled') && (
                                <button
                                  type="button"
                                  onClick={() => { 
                                    setDiagnosisModalAdmission(record)
                                    setOpenActionRow(null)
                                  }}
                                  className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                                >
                                  <Stethoscope className="w-3.5 h-3.5 shrink-0" />
                                  Add Diagnosis
                                </button>
                              )}

                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSuicideAssessmentAdmission(record)
                                    setShowSuicideAssessment(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-purple-700 hover:bg-purple-50"
                                >
                                  Suicide Patient Assessment
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRecoveryRoomAdmission(record)
                                    setShowRecoveryRoom(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-teal-700 hover:bg-teal-50"
                                >
                                  Recovery Room Record
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAnesthesiaAdmission(record)
                                    setShowAnesthesia(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50"
                                >
                                  Anesthesia Record
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTimeOutAdmission(record)
                                    setShowTimeOut(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-orange-700 hover:bg-orange-50"
                                >
                                  Time Out Procedure
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPreEctAdmission(record)
                                    setShowPreEct(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-cyan-700 hover:bg-cyan-50"
                                >
                                  Pre-ECT Checklist
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAldereteScoreAdmission(record)
                                    setShowAldereteScore(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-violet-700 hover:bg-violet-50"
                                >
                                  Modified Alderete Score
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEctAnesthesiaConsentAdmission(record)
                                    setShowECTAnesthesiaConsent(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                                >
                                  ECT Anesthesia Consent
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPreAnesthesiaAdmission(record)
                                    setShowPreAnesthesia(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50"
                                >
                                  Pre Anesthesia Assessment
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPhysicalExamAdmission(record)
                                    setShowPhysicalExam(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-teal-700 hover:bg-teal-50"
                                >
                                  Physical Examination
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPatientHistoryAdmission(record)
                                    setShowPatientHistory(true)
                                    setOpenActionRow(null)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm text-teal-700 hover:bg-teal-50"
                                >
                                  Patient History
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted' || record.status === 'Discharge Scheduled') && (
                                <button
                                  type="button"
                                  onClick={() => { setDiagnosisAdmission(record); setOpenActionRow(null) }}
                                  className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                                >
                                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  Diagnosis
                                </button>
                              )}
                              {(record.status === 'Admission Scheduled' || record.status === 'Admitted' || record.status === 'Discharge Scheduled') && (
                                <button
                                  type="button"
                                  onClick={() => { setReferralAdmission(record); setOpenActionRow(null) }}
                                  className="block w-full text-left px-3 py-2 text-sm text-orange-700 hover:bg-orange-50"
                                >
                                  Create Referral
                                </button>
                              )}
                              {openActionRowHasDraft &&
                                record.status !== 'Cancelled' &&
                                record.status !== 'Discharged' && (
                                  <button
                                    type="button"
                                    onClick={() => handleContinueDischarge(record)}
                                    className="block w-full text-left px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
                                  >
                                    Continue discharge
                                  </button>
                                )}
                              {record.status === 'Discharge Scheduled' && !openActionRowHasDraft && (
                                <button
                                  type="button"
                                  onClick={() => handleContinueDischarge(record)}
                                  className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                >
                                  Discharge patient
                                </button>
                              )}
                            </PortalActionsMenu>
                          </div>
                          {!compactCard && (
                          <PrintFormatDropdown
                            doctype="Inpatient Admission"
                            docName={record.name}
                            noLetterhead={0}
                            triggerPrint={1}
                          />
                          )}
                        </div>
                      </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          {preferLoadMore ? (
            <LoadMoreControls
              loadedCount={records.length}
              totalCount={totalCount}
              pageSize={pageSize}
              loading={loading || refreshing}
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
      </div>

      {/* ── Admission Detail Slide-over ── */}
      {detailAdmission && (
        <DetailSlideOver
          title="Inpatient Admission"
          subtitle={detailAdmission}
          onClose={() => setDetailAdmission(null)}
          onPrev={goPrev}
          onNext={goNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
          navLabel={navLabel}
          headerActions={
            <PrintFormatDropdown
              doctype="Inpatient Admission"
              docName={detailAdmission}
              noLetterhead={0}
              triggerPrint={1}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-emerald-200/80 bg-white text-emerald-700 shadow-sm hover:bg-emerald-50"
            />
          }
        >
          <div className="p-2">
            <InpatientAdmissionDetails
              key={detailAdmission}
              admissionName={detailAdmission}
              onUpdate={() => refetch()}
            />
          </div>
        </DetailSlideOver>
      )}

      {showVisitorModal && visitorAdmission && (
        <AddVisitorModal
          admission={visitorAdmission}
          onClose={() => {
            setShowVisitorModal(false)
            setVisitorAdmission(null)
          }}
          onSuccess={() => {
            refetch()
          }}
        />
      )}

      {/* ── Existing modals ── */}
      {showPackages && selectedRecord && (
        <PackageSelectionModal
          admissionNo={selectedRecord}
          onSelect={handlePackageSelect}
          onClose={() => { setShowPackages(false); setSelectedRecord(null) }}
        />
      )}

      {showAdmissionForm && selectedRecord && selectedPackage && (
        <AdmissionFormModal
          admissionNo={selectedRecord}
          selectedPackage={selectedPackage}
          onComplete={handleAdmissionComplete}
          onClose={() => { setShowAdmissionForm(false); setSelectedRecord(null); setSelectedPackage(null) }}
        />
      )}

      {showScheduleDischarge && selectedAdmissionForDischarge && (
        <ScheduleDischargeModal
          admission={{
            name: selectedAdmissionForDischarge.name,
            patient: selectedAdmissionForDischarge.patient,
            patient_name: selectedAdmissionForDischarge.patient_name
          }}
          onClose={() => { setShowScheduleDischarge(false); setSelectedAdmissionForDischarge(null) }}
          onSuccess={handleDischargeScheduled}
        />
      )}

      {medicalSupervisionAdmission && (
        <ModifyMedicalSupervisionModal
          admission={medicalSupervisionAdmission.name}
          patientName={medicalSupervisionAdmission.patient_name || medicalSupervisionAdmission.patient}
          onClose={() => setMedicalSupervisionAdmission(null)}
          onSaved={() => refetch()}
        />
      )}

      {showTransferCostCenter && selectedAdmissionForTransfer && (
        <TransferCostCenterModal
          admission={{
            name: selectedAdmissionForTransfer.name,
            patient: selectedAdmissionForTransfer.patient,
            patient_name: selectedAdmissionForTransfer.patient_name,
            company: selectedAdmissionForTransfer.company,
            cost_center: selectedAdmissionForTransfer.cost_center
          }}
          onClose={() => { setShowTransferCostCenter(false); setSelectedAdmissionForTransfer(null) }}
          onSuccess={handleTransferComplete}
        />
      )}

      {showSuicideAssessment && suicideAssessmentAdmission && (
        <SuicidalPatientAssessmentModal
          admissionNo={suicideAssessmentAdmission.name}
          patient={suicideAssessmentAdmission.patient}
          patientName={suicideAssessmentAdmission.patient_name}
          onClose={() => { setShowSuicideAssessment(false); setSuicideAssessmentAdmission(null) }}
          onSuccess={() => { setShowSuicideAssessment(false); setSuicideAssessmentAdmission(null) }}
        />
      )}

      {showRecoveryRoom && recoveryRoomAdmission && (
        <RecoveryRoomRecordModal
          admissionNo={recoveryRoomAdmission.name}
          patient={recoveryRoomAdmission.patient}
          patientName={recoveryRoomAdmission.patient_name}
          onClose={() => { setShowRecoveryRoom(false); setRecoveryRoomAdmission(null) }}
          onSuccess={() => { setShowRecoveryRoom(false); setRecoveryRoomAdmission(null) }}
        />
      )}

      {showAnesthesia && anesthesiaAdmission && (
        <AnesthesiaRecordModal
          admissionNo={anesthesiaAdmission.name}
          patient={anesthesiaAdmission.patient}
          patientName={anesthesiaAdmission.patient_name}
          onClose={() => { setShowAnesthesia(false); setAnesthesiaAdmission(null) }}
          onSuccess={() => { setShowAnesthesia(false); setAnesthesiaAdmission(null) }}
        />
      )}

      {showTimeOut && timeOutAdmission && (
        <TimeOutProcedureModal
          admissionNo={timeOutAdmission.name}
          patient={timeOutAdmission.patient}
          patientName={timeOutAdmission.patient_name}
          onClose={() => { setShowTimeOut(false); setTimeOutAdmission(null) }}
          onSuccess={() => { setShowTimeOut(false); setTimeOutAdmission(null) }}
        />
      )}

      {showPreEct && preEctAdmission && (
        <PreEctChecklistModal
          admissionNo={preEctAdmission.name}
          patient={preEctAdmission.patient}
          patientName={preEctAdmission.patient_name}
          onClose={() => { setShowPreEct(false); setPreEctAdmission(null) }}
          onSuccess={() => { setShowPreEct(false); setPreEctAdmission(null) }}
        />
      )}

      {showAldereteScore && aldereteScoreAdmission && (
        <ModifiedAldereteScoreModal
          admissionNo={aldereteScoreAdmission.name}
          patient={aldereteScoreAdmission.patient}
          patientName={aldereteScoreAdmission.patient_name}
          onClose={() => { setShowAldereteScore(false); setAldereteScoreAdmission(null) }}
          onSuccess={() => { setShowAldereteScore(false); setAldereteScoreAdmission(null) }}
        />
      )}

      {diagnosisModalAdmission && (
  <InpatientDiagnosisModal
    parentDoctype="Inpatient Admission"
    parentName={diagnosisModalAdmission.name}
    patient={diagnosisModalAdmission.patient}
    patientName={diagnosisModalAdmission.patient_name}
    onClose={() => setDiagnosisModalAdmission(null)}
    onSuccess={() => {
      setDiagnosisModalAdmission(null)
      refetch() // Refresh the list
    }}
  />
)}

      {showECTAnesthesiaConsent && ectAnesthesiaConsentAdmission && (
        <ECTAnesthesiaConsentModal
          admissionNo={ectAnesthesiaConsentAdmission.name}
          patient={ectAnesthesiaConsentAdmission.patient}
          patientName={ectAnesthesiaConsentAdmission.patient_name}
          onClose={() => { setShowECTAnesthesiaConsent(false); setEctAnesthesiaConsentAdmission(null) }}
          onSuccess={() => { setShowECTAnesthesiaConsent(false); setEctAnesthesiaConsentAdmission(null) }}
        />
      )}

      {showPreAnesthesia && preAnesthesiaAdmission && (
        <PreAnesthesiaAssessmentModal
          admissionNo={preAnesthesiaAdmission.name}
          patient={preAnesthesiaAdmission.patient}
          patientName={preAnesthesiaAdmission.patient_name}
          onClose={() => { setShowPreAnesthesia(false); setPreAnesthesiaAdmission(null) }}
          onSuccess={() => { setShowPreAnesthesia(false); setPreAnesthesiaAdmission(null) }}
        />
      )}

      {showPhysicalExam && physicalExamAdmission && (
        <PhysicalExaminationModal
          admissionNo={physicalExamAdmission.name}
          patient={physicalExamAdmission.patient}
          patientName={physicalExamAdmission.patient_name}
          onClose={() => { setShowPhysicalExam(false); setPhysicalExamAdmission(null) }}
          onSuccess={() => { setShowPhysicalExam(false); setPhysicalExamAdmission(null) }}
        />
      )}

      {showPatientHistory && patientHistoryAdmission && (
        <PatientHistoryModal
          admissionNo={patientHistoryAdmission.name}
          patient={patientHistoryAdmission.patient}
          patientName={patientHistoryAdmission.patient_name}
          onClose={() => { setShowPatientHistory(false); setPatientHistoryAdmission(null) }}
          onSuccess={() => { setShowPatientHistory(false); setPatientHistoryAdmission(null) }}
        />
      )}

      {diagnosisAdmission && (
        <PatientDiagnosisModal
          parentDoctype="Inpatient Admission"
          parentName={diagnosisAdmission.name}
          patient={diagnosisAdmission.patient}
          patientName={diagnosisAdmission.patient_name}
          onClose={() => setDiagnosisAdmission(null)}
          onSuccess={() => setDiagnosisAdmission(null)}
        />
      )}

      {referralAdmission && (
        <CreatePatientReferralModal
          initialPatient={referralAdmission.patient}
          initialPatientName={referralAdmission.patient_name}
          referredFromDoctype="Inpatient Admission"
          referredFromDocname={referralAdmission.name}
          onClose={() => setReferralAdmission(null)}
          onSuccess={() => setReferralAdmission(null)}
        />
      )}

      {editAdmissionName && (
        <CreateAdmissionModal
          editAdmissionName={editAdmissionName}
          onClose={() => setEditAdmissionName(null)}
          onSuccess={() => {
            setEditAdmissionName(null)
            refetch()
            if (detailAdmission === editAdmissionName) {
              setDetailAdmission(editAdmissionName)
            }
          }}
        />
      )}

      {uploadDocumentsAdmission && (
        <UploadPatientDocumentsModal
          target={{
            doctype: 'Inpatient Admission',
            name: uploadDocumentsAdmission.name,
            label: `Upload Documents — ${uploadDocumentsAdmission.patient_name || uploadDocumentsAdmission.name}`,
          }}
          onClose={() => setUploadDocumentsAdmission(null)}
          onSuccess={() => {
            setUploadDocumentsAdmission(null)
            refetch()
          }}
        />
      )}
    </div>
  )
}