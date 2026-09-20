import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from '../hooks/useToast'
import { careScopeFromCostCenterField, type CostCenterCareScope } from '../config/costCenterCareScope'
import { fetchActiveCareEpisodeStatus, type ActiveCareEpisodeStatus } from '../services/careEpisode'
import { fetchDefaultCompanyCurrency } from '../services/common'
import { fetchHealthcarePortalSettings } from '../services/healthcareSettings'
import {
  applyBranchFromIpMapper,
  getPortalBranch,
  isAllBranchesSelected,
  setPortalBranch,
} from '../services/costCenterPermission'
import { setEditingLockState } from '../services/editingLockStore'
import { useAuth } from './AuthProvider'
import {
  getActiveCareBlockReason,
  isActiveCareEpisodeClosedForCreate,
} from '../utils/careEpisode'

export type CareMode = 'OP' | 'IP' | null

const CARE_MODE_STORAGE_KEY = 'care_mode'
const CARE_MODE_LEGACY_KEY = 'patientSearch_activeMode'

function readStoredCareMode(): CareMode {
  if (typeof window === 'undefined') return null
  try {
    const stored =
      window.localStorage.getItem(CARE_MODE_STORAGE_KEY) ||
      window.localStorage.getItem(CARE_MODE_LEGACY_KEY)
    if (stored === 'IP') return 'IP'
    if (stored === 'OP') return 'OP'
    return null
  } catch {
    return null
  }
}

function persistCareMode(mode: CareMode) {
  if (typeof window === 'undefined') return
  try {
    if (mode) {
      window.localStorage.setItem(CARE_MODE_STORAGE_KEY, mode)
      window.localStorage.setItem(CARE_MODE_LEGACY_KEY, mode)
    } else {
      window.localStorage.removeItem(CARE_MODE_STORAGE_KEY)
      window.localStorage.removeItem(CARE_MODE_LEGACY_KEY)
    }
  } catch {
    /* ignore */
  }
}

// Re-use the same localStorage keys that PatientSearch already writes so they
// stay in sync without double-writing.
const PATIENT_STORAGE_KEY = 'patientSearch_selectedPatient'
const VISIT_STORAGE_KEY = 'patientSearch_activeVisit'
const VISIT_LABEL_STORAGE_KEY = 'patientSearch_activeVisitLabel'
const ADMISSION_STORAGE_KEY = 'patientSearch_activeAdmission'
const ADMISSION_LABEL_STORAGE_KEY = 'patientSearch_activeAdmissionLabel'

interface CareContextValue {
  mode: CareMode
  setMode: (mode: CareMode | null) => void
  /** Currently focused patient visit (OP), if any. */
  activeVisit?: string
  setActiveVisit: (visitName: string | undefined) => void
  /** Currently focused inpatient admission (IP), if any. */
  activeAdmission?: string
  setActiveAdmission: (admissionName: string | undefined) => void
  /**
   * Globally selected patient — persists across page/screen navigation.
   * Initialised synchronously from localStorage so every page gets the
   * correct patient on the very first render (no flash, no waiting).
   */
  selectedPatient: string | undefined
  setSelectedPatient: (patient: string | undefined) => void
  /** Current user's portal branch (UI filter only — localStorage, not User Permission). */
  userCostCenter?: string
  /** Set portal branch filter (UI only). Pass empty string to clear. */
  setUserCostCenter: (costCenter: string | undefined) => void
  /** ERPNext Company from the user's working cost centre (Cost Center.company) */
  costCenterCompany?: string
  /**
   * Cost Center.custom_patient_care_type — "IP Only" | "OP Only" | "Both IP & OP" or empty when unset / N/A.
   * Drives OP vs IP UI (sidebar, header toggles). Exempt users with no mapped branch get "" (both).
   */
  costCenterPatientCareType?: string
  /** Normalized scope derived from {@link costCenterPatientCareType} */
  costCenterCareScope: CostCenterCareScope
  /** Current user's roles */
  userRole?: string[]
  /** Current user object */
  user?: any
  /** Default company currency (ISO), from ERPNext Company.default_currency */
  companyCurrency?: string
  /** Status of the focused OP visit, when {@link activeVisit} is set. */
  activeVisitStatus?: string
  /** Patient Visit Type link on the focused visit, when loaded. */
  activeVisitType?: string
  /** Display label for {@link activeVisitType}. */
  activeVisitTypeLabel?: string
  /** True when the focused OP visit is an IOP visit (visit type or IOP enrollment). */
  isIOPVisit: boolean
  /** Status of the focused IP admission, when {@link activeAdmission} is set. */
  activeAdmissionStatus?: string
  /** True when the selected OP visit or IP admission is closed for new records. */
  isActiveCareEpisodeClosed: boolean
  /** User-facing message when {@link isActiveCareEpisodeClosed} is true. */
  activeCareBlockReason?: string
  /** Healthcare Settings: Block Clinical Records on Completed OP Visits. */
  blockClinicalRecordsOnCompletedVisit: boolean
  /** Healthcare Settings: Block Clinical Records on Discharged IP. */
  blockClinicalRecordsOnDischargedIp: boolean
  /**
   * Wrap clinical create handlers (labs, Rx, notes, etc.).
   * Shows a toast when the active visit/admission is closed.
   * Pass `{ allowOnClosed: true }` only for starting a new OP visit or IP admission.
   */
  guardClinicalCreate: (open: () => void, options?: { allowOnClosed?: boolean }) => void
  /** Select OP mode with patient + visit in the header (shared by visit/appointment links). */
  applyOpCareContext: (opts: { patient?: string; visit: string; visitLabel?: string }) => void
  /** Select IP mode with patient + admission in the header (shared by admission/discharge links). */
  applyIpCareContext: (opts: { patient?: string; admission: string; admissionLabel?: string }) => void
  /** Clear patient / visit / admission (portal double-click blank workspace). */
  clearCareWorkspace: () => void
  /** Reload branch / company context after navbar branch switch. */
  refreshUserCostCenter: () => Promise<void>
  /** True when Healthcare Settings.lock_editing_data is enabled. */
  lockEditingData: boolean
  editingLockMessage?: string
  /** True when Healthcare Settings.therapy_note_uneditable_in_24_hour is enabled. */
  therapyNoteUneditableIn24Hour: boolean
  /** True when Healthcare Settings.vital_sign_uneditable_in_24_hour is enabled. */
  vitalSignUneditableIn24Hour: boolean
  /** True when Healthcare Settings.unedit_within_24hour is enabled (daily routine care). */
  uneditWithin24Hour: boolean
  /** True when Healthcare Settings.allow_doctors_to_create_patient_visit is enabled. */
  allowDoctorsToCreatePatientVisit: boolean
  /** True when Healthcare Settings.lock_doctors_name_choosing is enabled. */
  lockDoctorsNameChoosing: boolean
  /**
   * True when Healthcare Settings.have_multiresults_on_lab_test is enabled.
   * When true, Multiple Results lab tests enter per-unit results; when false,
   * every lab test uses the normal single result entry.
   */
  haveMultiresultsOnLabTest: boolean
  /**
   * Wrap handlers that modify existing records (edit modals, append note, etc.).
   * Creating new records is still allowed via {@link guardClinicalCreate}.
   */
  guardClinicalEdit: (open: () => void) => void
}

const CareContext = createContext<CareContextValue | undefined>(undefined)

const readStorage = (key: string): string | undefined => {
  if (typeof window === 'undefined') return undefined
  try { return localStorage.getItem(key) || undefined } catch { return undefined }
}

const writeStorage = (key: string, value: string | undefined) => {
  if (typeof window === 'undefined') return
  try {
    if (value) { localStorage.setItem(key, value) } else { localStorage.removeItem(key) }
  } catch { /* ignore */ }
}

export const CareContextProvider = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth()
  const [mode, setModeState] = useState<CareMode>(() => readStoredCareMode())

  const setMode = (next: CareMode | null) => {
    setModeState(next)
    persistCareMode(next)
  }

  // Initialise synchronously from localStorage so all pages get correct values immediately.
  const [activeVisit, setActiveVisitState] = useState<string | undefined>(
    () => readStorage(VISIT_STORAGE_KEY)
  )
  const [activeAdmission, setActiveAdmissionState] = useState<string | undefined>(
    () => readStorage(ADMISSION_STORAGE_KEY)
  )
  const [selectedPatient, setSelectedPatientState] = useState<string | undefined>(
    () => readStorage(PATIENT_STORAGE_KEY)
  )

  // User context state
  const [userCostCenter, setUserCostCenterState] = useState<string | undefined>(() => {
    const stored = getPortalBranch()
    return stored || undefined
  })

  const setUserCostCenter = useCallback((costCenter: string | undefined) => {
    const value = (costCenter || '').trim()
    setPortalBranch(value)
    setUserCostCenterState(value || undefined)
  }, [])
  const [costCenterCompany, setCostCenterCompany] = useState<string | undefined>(undefined)
  const [costCenterPatientCareType, setCostCenterPatientCareType] = useState<string | undefined>(undefined)

  const costCenterCareScope = careScopeFromCostCenterField(costCenterPatientCareType)
  const [userRole, setUserRole] = useState<string[] | undefined>(undefined)
  const [user, setUser] = useState<any>(undefined)
  const [companyCurrency, setCompanyCurrency] = useState<string | undefined>(undefined)
  const [activeVisitStatus, setActiveVisitStatus] = useState<string | undefined>(undefined)
  const [activeAdmissionStatus, setActiveAdmissionStatus] = useState<string | undefined>(undefined)
  const [careEpisodeStatus, setCareEpisodeStatus] = useState<ActiveCareEpisodeStatus | null>(null)
  const [lockEditingData, setLockEditingData] = useState(false)
  const [therapyNoteUneditableIn24Hour, setTherapyNoteUneditableIn24Hour] = useState(false)
  const [vitalSignUneditableIn24Hour, setVitalSignUneditableIn24Hour] = useState(false)
  const [uneditWithin24Hour, setUneditWithin24Hour] = useState(false)
  const [allowDoctorsToCreatePatientVisit, setAllowDoctorsToCreatePatientVisit] = useState(false)
  const [lockDoctorsNameChoosing, setLockDoctorsNameChoosing] = useState(false)
  const [haveMultiresultsOnLabTest, setHaveMultiresultsOnLabTest] = useState(false)

  const editingLockMessage =
    'Editing is locked in Healthcare Settings. You can create new records but cannot modify existing data.'

  useEffect(() => {
    let cancelled = false
    fetchActiveCareEpisodeStatus(activeVisit, activeAdmission)
      .then((msg) => {
        if (cancelled) return
        setActiveVisitStatus(msg.patient_visit_status ?? undefined)
        setActiveAdmissionStatus(msg.inpatient_admission_status ?? undefined)
        setCareEpisodeStatus(msg)
      })
      .catch(() => {
        if (cancelled) return
        if (!activeVisit && !activeAdmission) {
          setActiveVisitStatus(undefined)
          setActiveAdmissionStatus(undefined)
          // Keep last-known settings flags if a prior fetch succeeded; otherwise leave null
          // so defaults stay conservative until a successful load.
          return
        }
        setActiveVisitStatus(undefined)
        setActiveAdmissionStatus(undefined)
        setCareEpisodeStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeVisit, activeAdmission])

  const blockDischargedIp =
    careEpisodeStatus?.block_clinical_records_on_discharged_ip ?? true
  const blockCompletedVisit =
    careEpisodeStatus?.block_clinical_records_on_completed_visit ?? true

  const isActiveCareEpisodeClosed = careEpisodeStatus
    ? careEpisodeStatus.blocks_create
    : isActiveCareEpisodeClosedForCreate(
        mode,
        activeVisit,
        activeAdmission,
        activeVisitStatus,
        activeAdmissionStatus,
        { blockDischargedIp, blockCompletedVisit },
      )

  const activeCareBlockReason = careEpisodeStatus?.block_reason
    ?? getActiveCareBlockReason(mode, activeVisitStatus, activeAdmissionStatus, {
      blockDischargedIp,
      blockCompletedVisit,
    })

  const guardClinicalCreate = useCallback(
    (open: () => void, options?: { allowOnClosed?: boolean }) => {
      if (!options?.allowOnClosed && isActiveCareEpisodeClosed) {
        toast.error(
          activeCareBlockReason ??
            'This visit or admission is closed. Select or create an open OP visit or active IP admission.',
        )
        return
      }
      open()
    },
    [isActiveCareEpisodeClosed, activeCareBlockReason],
  )

  const guardClinicalEdit = useCallback(
    (open: () => void) => {
      if (lockEditingData) {
        toast.error(editingLockMessage)
        return
      }
      open()
    },
    [lockEditingData, editingLockMessage],
  )

  // Load portal branch metadata (company / care type). Branch itself is UI localStorage only.
  const refreshUserCostCenter = useCallback(async () => {
    try {
      const portal = getPortalBranch()
      setUserCostCenterState(portal || undefined)
      const qs = portal ? `?cost_center=${encodeURIComponent(portal)}` : ''
      const response = await fetch(
        `/api/method/healthcare.api.nursing_inventory.get_default_warehouse_and_cost_center${qs}`,
      )
      if (response.ok) {
        const data = await response.json()
        const msg = data.message || {}
        // Keep portal branch as source of truth. Do not fill employee default when
        // the user chose All Branches (empty is an explicit filter).
        if (!portal && msg.cost_center && !isAllBranchesSelected()) {
          setUserCostCenterState(msg.cost_center)
        }
        setCostCenterCompany(
          typeof msg.company === 'string' && msg.company.trim()
            ? msg.company.trim()
            : undefined,
        )
        setCostCenterPatientCareType(
          typeof msg.cost_center_patient_care_type === 'string'
            ? msg.cost_center_patient_care_type
            : ''
        )
      }
    } catch (error) {
      console.warn('Failed to refresh user cost center:', error)
    }
  }, [])

  useEffect(() => {
    // All of these APIs 403 for guests — wait for login (rerun on auth change).
    if (!isAuthenticated) return
    const loadUserContext = async () => {
      try {
        // Resolve IP → portal branch (localStorage only; no User Permission).
        const ipResult = await applyBranchFromIpMapper().catch((err) => {
          console.warn('IP Mapper branch resolve skipped:', err)
          return null
        })
        if (isAllBranchesSelected() || (ipResult?.overridden && !getPortalBranch())) {
          setUserCostCenterState(undefined)
        } else if (ipResult?.matched && ipResult.cost_center && !ipResult.overridden) {
          setUserCostCenterState(ipResult.cost_center)
        } else {
          setUserCostCenterState(getPortalBranch() || undefined)
        }
        await refreshUserCostCenter()
        const userResponse = await fetch('/api/method/frappe.auth.get_logged_user', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (userResponse.ok) {
          const userData = await userResponse.json()
          if (userData.message) {
            setUser({ name: userData.message })
            const rolesResponse = await fetch('/api/method/healthcare.api.common.get_current_user_roles', {
              method: 'GET',
              credentials: 'include',
              headers: { Accept: 'application/json' },
            })
            if (rolesResponse.ok) {
              const rolesData = await rolesResponse.json()
              setUserRole(Array.isArray(rolesData.message) ? rolesData.message : [])
            }
          }
        }

        const portalSettings = await fetchHealthcarePortalSettings().catch(() => ({
          lock_editing_data: false,
          therapy_note_uneditable_in_24_hour: false,
          vital_sign_uneditable_in_24_hour: false,
          unedit_within_24hour: false,
          allow_doctors_to_create_patient_visit: false,
          lock_doctors_name_choosing: false,
          remove_collect_sample_button_from_child_test: false,
          collect_sample_from_request_listing: false,
          hide_test_and_result_from_lab: false,
          have_multiresults_on_lab_test: false,
        }))
        setLockEditingData(Boolean(portalSettings.lock_editing_data))
        setTherapyNoteUneditableIn24Hour(Boolean(portalSettings.therapy_note_uneditable_in_24_hour))
        setVitalSignUneditableIn24Hour(Boolean(portalSettings.vital_sign_uneditable_in_24_hour))
        setUneditWithin24Hour(Boolean(portalSettings.unedit_within_24hour))
        setAllowDoctorsToCreatePatientVisit(Boolean(portalSettings.allow_doctors_to_create_patient_visit))
        setLockDoctorsNameChoosing(Boolean(portalSettings.lock_doctors_name_choosing))
        setHaveMultiresultsOnLabTest(Boolean(portalSettings.have_multiresults_on_lab_test))
      } catch (error) {
        console.warn('Failed to load user context:', error)
      }
    }

    loadUserContext()

    const refreshEditingLock = () => {
      fetchHealthcarePortalSettings()
        .then((portalSettings) => {
          setLockEditingData(Boolean(portalSettings.lock_editing_data))
          setTherapyNoteUneditableIn24Hour(Boolean(portalSettings.therapy_note_uneditable_in_24_hour))
          setVitalSignUneditableIn24Hour(Boolean(portalSettings.vital_sign_uneditable_in_24_hour))
          setUneditWithin24Hour(Boolean(portalSettings.unedit_within_24hour))
          setAllowDoctorsToCreatePatientVisit(Boolean(portalSettings.allow_doctors_to_create_patient_visit))
          setLockDoctorsNameChoosing(Boolean(portalSettings.lock_doctors_name_choosing))
          setHaveMultiresultsOnLabTest(Boolean(portalSettings.have_multiresults_on_lab_test))
        })
        .catch(() => {
          setLockEditingData(false)
          setTherapyNoteUneditableIn24Hour(false)
          setVitalSignUneditableIn24Hour(false)
          setUneditWithin24Hour(false)
          setAllowDoctorsToCreatePatientVisit(false)
          setLockDoctorsNameChoosing(false)
          setHaveMultiresultsOnLabTest(false)
        })
    }

    window.addEventListener('focus', refreshEditingLock)
    return () => {
      window.removeEventListener('focus', refreshEditingLock)
    }
  }, [refreshUserCostCenter, isAuthenticated])

  useEffect(() => {
    setEditingLockState(lockEditingData, editingLockMessage)
  }, [lockEditingData, editingLockMessage])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    fetchDefaultCompanyCurrency()
      .then((msg) => {
        if (!cancelled && msg.currency) setCompanyCurrency(msg.currency.toUpperCase())
      })
      .catch(() => {
        if (!cancelled) setCompanyCurrency(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const setActiveVisit = (v: string | undefined) => {
    const val = v || undefined
    setActiveVisitState(val)
    writeStorage(VISIT_STORAGE_KEY, val)
  }

  const setActiveAdmission = (a: string | undefined) => {
    const val = a || undefined
    setActiveAdmissionState(val)
    writeStorage(ADMISSION_STORAGE_KEY, val)
  }

  const setSelectedPatient = (patient: string | undefined) => {
    setSelectedPatientState(patient)
    writeStorage(PATIENT_STORAGE_KEY, patient)
  }

  useEffect(() => {
    if (costCenterCareScope === 'op_only') {
      setMode('OP')
      setActiveAdmission(undefined)
      try {
        localStorage.removeItem('patientSearch_activeAdmissionLabel')
      } catch {
        /* ignore */
      }
    } else if (costCenterCareScope === 'ip_only') {
      setMode('IP')
      setActiveVisit(undefined)
      try {
        localStorage.removeItem('patientSearch_activeVisitLabel')
      } catch {
        /* ignore */
      }
    }
  }, [costCenterCareScope])

  const applyOpCareContext = useCallback(
    ({ patient, visit, visitLabel }: { patient?: string; visit: string; visitLabel?: string }) => {
      const visitId = visit.trim()
      if (!visitId) return

      if (patient) {
        setSelectedPatient(patient)
      }

      setMode('OP')
      setActiveAdmission(undefined)
      writeStorage(ADMISSION_STORAGE_KEY, undefined)
      writeStorage(ADMISSION_LABEL_STORAGE_KEY, undefined)

      setActiveVisit(visitId)
      const label = (visitLabel || visitId).trim()
      writeStorage(VISIT_LABEL_STORAGE_KEY, label)

      toast.success(`OP visit ${visitId} selected in header`)
    },
    [setMode, setActiveAdmission, setActiveVisit, setSelectedPatient],
  )

  const applyIpCareContext = useCallback(
    ({ patient, admission, admissionLabel }: { patient?: string; admission: string; admissionLabel?: string }) => {
      const admissionId = admission.trim()
      if (!admissionId) return

      if (patient) {
        setSelectedPatient(patient)
      }

      setMode('IP')
      setActiveVisit(undefined)
      writeStorage(VISIT_STORAGE_KEY, undefined)
      writeStorage(VISIT_LABEL_STORAGE_KEY, undefined)

      setActiveAdmission(admissionId)
      const label = (admissionLabel || admissionId).trim()
      writeStorage(ADMISSION_LABEL_STORAGE_KEY, label)

      toast.success(`IP admission ${admissionId} selected in header`)
    },
    [setMode, setActiveAdmission, setActiveVisit, setSelectedPatient],
  )

  const clearCareWorkspace = useCallback(() => {
    setSelectedPatient(undefined)
    setActiveVisit(undefined)
    setActiveAdmission(undefined)
    try {
      localStorage.removeItem(PATIENT_STORAGE_KEY)
      localStorage.removeItem(VISIT_STORAGE_KEY)
      localStorage.removeItem(VISIT_LABEL_STORAGE_KEY)
      localStorage.removeItem(ADMISSION_STORAGE_KEY)
      localStorage.removeItem(ADMISSION_LABEL_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [setSelectedPatient, setActiveVisit, setActiveAdmission])

  const contextValue = useMemo(
    () => ({
      mode,
      setMode,
      activeVisit,
      setActiveVisit,
      activeAdmission,
      setActiveAdmission,
      selectedPatient,
      setSelectedPatient,
      userCostCenter,
      setUserCostCenter,
      costCenterCompany,
      costCenterPatientCareType,
      costCenterCareScope,
      userRole,
      user,
      companyCurrency,
      activeVisitStatus,
      activeVisitType: careEpisodeStatus?.patient_visit_type ?? undefined,
      activeVisitTypeLabel: careEpisodeStatus?.patient_visit_type_label ?? undefined,
      isIOPVisit: Boolean(careEpisodeStatus?.is_iop_visit),
      activeAdmissionStatus,
      isActiveCareEpisodeClosed,
      activeCareBlockReason,
      blockClinicalRecordsOnCompletedVisit: blockCompletedVisit,
      blockClinicalRecordsOnDischargedIp: blockDischargedIp,
      guardClinicalCreate,
      guardClinicalEdit,
      lockEditingData,
      editingLockMessage,
      therapyNoteUneditableIn24Hour,
      vitalSignUneditableIn24Hour,
      uneditWithin24Hour,
      allowDoctorsToCreatePatientVisit,
      lockDoctorsNameChoosing,
      haveMultiresultsOnLabTest,
      applyOpCareContext,
      applyIpCareContext,
      clearCareWorkspace,
      refreshUserCostCenter,
    }),
    [
      mode,
      activeVisit,
      activeAdmission,
      selectedPatient,
      userCostCenter,
      setUserCostCenter,
      costCenterCompany,
      costCenterPatientCareType,
      costCenterCareScope,
      userRole,
      user,
      companyCurrency,
      activeVisitStatus,
      careEpisodeStatus,
      activeAdmissionStatus,
      isActiveCareEpisodeClosed,
      activeCareBlockReason,
      blockCompletedVisit,
      blockDischargedIp,
      guardClinicalCreate,
      guardClinicalEdit,
      lockEditingData,
      editingLockMessage,
      therapyNoteUneditableIn24Hour,
      vitalSignUneditableIn24Hour,
      uneditWithin24Hour,
      allowDoctorsToCreatePatientVisit,
      lockDoctorsNameChoosing,
      haveMultiresultsOnLabTest,
      applyOpCareContext,
      applyIpCareContext,
      clearCareWorkspace,
      refreshUserCostCenter,
    ],
  )

  return (
    <CareContext.Provider value={contextValue}>
      {children}
    </CareContext.Provider>
  )
}

export const useCareContext = (): CareContextValue => {
  const ctx = useContext(CareContext)
  if (!ctx) throw new Error('useCareContext must be used within CareContextProvider')
  return ctx
}
