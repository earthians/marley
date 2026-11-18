import { useState, useEffect, useLayoutEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useCareContext } from '../providers/CareContextProvider'
import { AdmissionList } from '../components/admissions/AdmissionList'
import { PatientList } from '../components/patients/PatientList'
import { toast } from '../hooks/useToast'
import { PatientCareHeader } from '../components/patients/PatientCareHeader'
import { AppointmentList } from '../components/appointments/AppointmentList'
import { ReceptionReports } from '../components/reception/ReceptionReports'
import { AppointmentsCard, OutpatientVisitsCard, InpatientAdmissionsCard } from '../components/dashboard/StandardDashboardCards'
import { CreateAppointmentModal } from '../components/appointments/CreateAppointmentModal'
import { PatientVisitList } from '../components/patientVisits/PatientVisitList'
import { CreatePatientVisitModal } from '../components/patientVisits/CreatePatientVisitModal'
import { CreateAdmissionModal } from '../components/admissions/CreateAdmissionModal'
import { CreatePatientModal } from '../components/patients/CreatePatientModal'
import { ServiceRequestList } from '../components/serviceRequests/ServiceRequestList'
import { CreateServiceRequestModal } from '../components/serviceRequests/CreateServiceRequestModal'
import { FollowUpList } from '../components/followUp/FollowUpList'
import { IOPDayListWithHeader } from '../components/iop/IOPDayList'
import { IOPEnrollmentListWithHeader } from '../components/iop/IOPEnrollmentList'
import { DischargeList } from '../components/discharges/DischargeList'
import { DischargeAdmissionView } from '../components/admissions/DischargeAdmissionView'
import { inpatientDischargeAllowed } from '../utils/inpatientDischargeRoute'
import { stripDischargeFlowParams } from '../utils/dischargeNavigation'
import { MedicalHistoryView } from '../components/medicalHistory/MedicalHistoryView'
import { ReceptionLongActingMedicineList } from '../components/medication/ReceptionLongActingMedicineList'
import { BulkScheduleIOPModal } from '../components/iop/BulkScheduleIOPModal'
import { CreateLongActingMedicineModal } from '../components/medication/CreateLongActingMedicineModal'
import { InsurancePatientRegisterList } from '../components/insurance/InsurancePatientRegisterList'
import { CreateInsurancePatientRegisterModal } from '../components/insurance/CreateInsurancePatientRegisterModal'
import { PatientReferralList } from '../components/referrals/PatientReferralList'
import { CreatePatientReferralModal } from '../components/referrals/CreatePatientReferralModal'
import { ReportRequestsCard } from '../components/reportRequests/ReportRequestList'
import { ObservationList } from '../components/observations/ObservationList'
import { CreateObservationModal } from '../components/observations/CreateObservationModal'
import { InternalTransferList } from '../components/transfers/InternalTransferList'
import { TransferCostCenterModal } from '../components/admissions/TransferCostCenterModal'
import { fetchInpatientRecord, type InpatientRecord } from '../services/inpatientRecords'
import { BillingDashboard } from '../components/billing/BillingDashboard'
import { DailyAutoVisitView } from '../components/patientVisits/DailyAutoVisitView'
import { AdditionalCollectionBillingPage } from './billing/AdditionalCollectionBillingPage'
import { DoctypeListPanel } from '../components/generic/DoctypeListPanel'
import { PromotionAnalysis } from '../components/reception/PromotionAnalysis'
import Packages from '../components/reception/Packages'
import { AdmissionSignatures } from '../components/admissions/AdmissionSignatures'
import { CreatePatientMedicalConsentModal } from '../components/reception/CreatePatientMedicalConsentModal'
import { InternalEmployeeBillingPage } from './billing/InternalEmployeeBillingPage'
import { isReceptionScreenBlocked, observationsAllowedForMode } from '../config/costCenterCareScope'
import { canManageInpatientPackages, isDataOfficer } from '../config/permissions'
import { DashboardCard } from '../components/ui/DashboardCard'
import { PractitionerUnavailabilityList } from '../components/practitionerUnavailability/PractitionerUnavailabilityList'
import { WarningMessagesList } from '../components/warnings/WarningMessagesList'
import { CreateWarningMessageModal } from '../components/warnings/CreateWarningMessageModal'
import { PriceReport } from '../components/reception/PriceReport'

type View =
  | 'default'
  | 'reports'
  | 'price-report'
  | 'patient'
  | 'admission'
  | 'visit'
  | 'patient-medical-history'
  | 'followup'
  | 'iop'
  | 'appointments-freeze'
  | 'service-requests'
  | 'receipt-voucher'
  | 'op-dashboard'
  | 'ip-dashboard'
  | 'discharge'
  | 'long-acting-medicine'
  | 'insurance'
  | 'referral'
  | 'report-requests'
  | 'observation'
  | 'internal-transfer'
  | 'medical-consent'
  | 'financial-consent'
  | 'signatures'
  | 'promotions'
  | 'handover-notes'
  | 'patients'
  | 'billing'
  | 'billing-additional-collection'
  | 'billing-internal-employee'
  | 'daily-auto-visit'
  | 'practitioner-unavailability'
  | 'sticky-notes'
  | 'packages'

export const ReceptionistPage = () => {

  const {
    selectedPatient: globalPatient,
    setSelectedPatient: setGlobalPatient,
    activeAdmission,
    activeVisit,
    setActiveAdmission,
    setActiveVisit,
    mode,
    costCenterCareScope,
    userRole,
    guardClinicalCreate,
  } = useCareContext()

  const canBrowsePatientList = isDataOfficer(userRole)
  const canManagePackages = canManageInpatientPackages(userRole)

  // const { selectedPatient: globalPatient, setSelectedPatient: setGlobalPatient } = useCareContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const patientFromUrl = searchParams.get('patient')
  const rawScreen = searchParams.get('screen')
  const dischargeAdmission = searchParams.get('discharge')
  const screen =
    rawScreen && !isReceptionScreenBlocked(rawScreen, costCenterCareScope, mode) ? rawScreen : null
  const [selectedPatient, setSelectedPatient] = useState<string>(() => patientFromUrl || globalPatient || '')
  const [currentView, setCurrentView] = useState<View>('default')
  const [showAppointmentModal, setShowAppointmentModal] = useState(false)
  const [initialAppointmentDate, setInitialAppointmentDate] = useState('')
  const [initialPractitioner, setInitialPractitioner] = useState('')
  const [appointmentRefreshKey, setAppointmentRefreshKey] = useState(0)
  const [showStickyNoteModal, setShowStickyNoteModal] = useState(false)
  const [stickyNoteRefreshKey, setStickyNoteRefreshKey] = useState(0)
  const [showMedicalConsentModal, setShowMedicalConsentModal] = useState(false)
  const [medicalConsentRefreshKey, setMedicalConsentRefreshKey] = useState(0)
  const [showPatientVisitModal, setShowPatientVisitModal] = useState(false)
  const [patientVisitRefreshKey, setPatientVisitRefreshKey] = useState(0)
  const [showCreateServiceRequest, setShowCreateServiceRequest] = useState(false)
  const [serviceRequestRefreshKey, setServiceRequestRefreshKey] = useState(0)
  const [showAdmissionModal, setShowAdmissionModal] = useState(false)
  const [admissionRefreshKey, setAdmissionRefreshKey] = useState(0)
  const [showPatientModal, setShowPatientModal] = useState(false)
  const [patientRefreshKey, setPatientRefreshKey] = useState(0)
  const [showBulkScheduleModal, setShowBulkScheduleModal] = useState(false)
  const [showCreateLongActing, setShowCreateLongActing] = useState(false)
  const [longActingRefreshKey, setLongActingRefreshKey] = useState(0)
  const [showCreateInsuranceRegister, setShowCreateInsuranceRegister] = useState(false)
  const [insuranceRegisterRefreshKey, setInsuranceRegisterRefreshKey] = useState(0)
  const [showCreateReferral, setShowCreateReferral] = useState(false)
  const [referralRefreshKey, setReferralRefreshKey] = useState(0)
  const [showObservationModal, setShowObservationModal] = useState(false)
  const [observationRefreshKey, setObservationRefreshKey] = useState(0)
  const [showCreateInternalTransfer, setShowCreateInternalTransfer] = useState(false)
  const [transferAdmission, setTransferAdmission] = useState<InpatientRecord | null>(null)
  const [internalTransferRefreshKey, setInternalTransferRefreshKey] = useState(0)
    const [showCreatePatientModal , setShowCreatePatientModal] = useState(false)

  const openInternalTransferModal = async () => {
    if (!activeAdmission) {
      toast.error('Select an inpatient admission at the top first')
      return
    }
    try {
      const rec = await fetchInpatientRecord(activeAdmission)
      setTransferAdmission(rec)
      setShowCreateInternalTransfer(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load admission for transfer')
    }
  }


  const handlePatientSelect = (patient: string | undefined) => {
    const nextPatient = patient || ''
    setSelectedPatient(nextPatient)
    setGlobalPatient(patient)
    if (!patient) {
      setActiveVisit(undefined)
      setActiveAdmission(undefined)
    }
    const newSearchParams = new URLSearchParams(searchParams)
    if (patient) {
      newSearchParams.set('patient', patient)
    } else {
      newSearchParams.delete('patient')
    }
    setSearchParams(newSearchParams, { replace: true })
  }

  // Sync local + global patient from URL on navigation only (never depend on selectedPatient —
  // that caused a restore loop when clearing the navbar patient while billing was open).
  useEffect(() => {
    const patientFromUrlNow = searchParams.get('patient') || ''
    setSelectedPatient((current) => (current === patientFromUrlNow ? current : patientFromUrlNow))
    setGlobalPatient(patientFromUrlNow || undefined)
  }, [searchParams, setGlobalPatient])

  useLayoutEffect(() => {
    if (dischargeAdmission) return
    if (!rawScreen || !isReceptionScreenBlocked(rawScreen, costCenterCareScope, mode)) return
    const np = new URLSearchParams(searchParams)
    np.delete('screen')
    setSearchParams(np, { replace: true })
  }, [dischargeAdmission, rawScreen, costCenterCareScope, searchParams, setSearchParams])

  const closeDischarge = () => {
    const state = location.state as { returnTo?: string } | null
    if (state?.returnTo) {
      navigate(state.returnTo, { replace: true })
      return
    }
    const np = new URLSearchParams(searchParams)
    stripDischargeFlowParams(np)
    setSearchParams(np, { replace: true })
  }

  const handleDischargeSuccess = () => {
    toast.success('Discharge completed successfully')
    const state = location.state as { returnTo?: string } | null
    if (state?.returnTo) {
      navigate(state.returnTo, { replace: true, state: { dischargeCompleted: true } })
      return
    }
    const np = new URLSearchParams(searchParams)
    stripDischargeFlowParams(np)
    setSearchParams(np, { replace: true, state: { dischargeCompleted: true } })
  }

  useEffect(() => {
    if (costCenterCareScope === 'op_only') {
      if (currentView === 'admission' || currentView === 'discharge' || currentView === 'ip-dashboard') {
        setCurrentView('default')
      }
    }
    if (costCenterCareScope === 'ip_only') {
      if (
        currentView === 'visit' ||
        currentView === 'daily-auto-visit' ||
        currentView === 'op-dashboard'
      ) {
        setCurrentView('default')
      }
    }
  }, [costCenterCareScope, currentView])

  // Sync view with URL: when screen param is missing or unknown, show reception homepage
  useEffect(() => {
    if (dischargeAdmission) return
    if (screen && isReceptionScreenBlocked(screen, costCenterCareScope, mode)) {
      return
    }
    if (screen === 'r-reg') {
      setCurrentView('admission')
    } else if (screen === 'r-visit') {
      setCurrentView('visit')
    } else if (screen === 'r-appointment') {
      setCurrentView('appointments-freeze')
      setShowAppointmentModal(true)
      const newParams = new URLSearchParams(searchParams)
      newParams.set('screen', 'r-appointments-freeze')
      setSearchParams(newParams, { replace: true })
    } else if (screen === 'r-ip-adm') {
      setCurrentView('admission')
      setShowAdmissionModal(true)
      const newParams = new URLSearchParams(searchParams)
      newParams.set('screen', 'r-reg')
      setSearchParams(newParams, { replace: true })
    } else if (screen === 'r-new-op') {
      setShowPatientModal(true)
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('screen')
      setSearchParams(newParams, { replace: true })
    } else if (screen === 'r-new-visit') {
      setCurrentView('visit')
      setShowPatientVisitModal(true)
      const newParams = new URLSearchParams(searchParams)
      newParams.set('screen', 'r-visit')
      setSearchParams(newParams, { replace: true })
    } else if (screen === 'r-daily-auto-visit') {
      setCurrentView('daily-auto-visit')
    } else if (screen === 'r-followup') {
      setCurrentView('followup')
    } else if (screen === 'r-medical-history') {
      setCurrentView('patient-medical-history')
    } else if (screen === 'r-iop') {
      setCurrentView('iop')
    } else if (screen === 'r-appointments-freeze') {
      setCurrentView('appointments-freeze')
    } else if (screen === 'r-sticky-notes') {
      setCurrentView('sticky-notes')
    } else if (screen === 'r-practitioner-unavailability') {
      setCurrentView('practitioner-unavailability')
    } else if (screen === 'r-service-requests') {
      setCurrentView('service-requests')
    } else if (screen === 'r-receipt-voucher') {
      setCurrentView('receipt-voucher')
    } else if (screen === 'r-op-dashboard') {
      setCurrentView('op-dashboard')
    } else if (screen === 'r-ip-dashboard') {
      setCurrentView('ip-dashboard')
    } else if (screen === 'r-discharge') {
      setCurrentView('discharge')
    } else if (screen === 'r-long-acting-meds') {
      setCurrentView('long-acting-medicine')
    } else if (screen === 'r-insurance') {
      setCurrentView('insurance')
    } else if (screen === 'r-reports') {
      setCurrentView('reports')
    } else if (screen === 'r-price-report') {
      setCurrentView('price-report')
    } else if (screen === 'r-referral') {
      setCurrentView('referral')
    } else if (screen === 'r-report-requests') {
      setCurrentView('report-requests')
    } else if (screen === 'r-observation') {
      setCurrentView('observation')
    } else if (screen === 'r-internal-transfer') {
      setCurrentView('internal-transfer')
    } else if (screen === 'r-medical-consent') {
      setCurrentView('medical-consent')
    } else if (screen === 'r-financial-consent') {
      setCurrentView('financial-consent')
    } else if (screen === 'r-signatures') {
      setCurrentView('signatures')
    } else if (screen === 'r-promotions') {
      setCurrentView('promotions')
    } else if (screen === 'r-handover-notes') {
      setCurrentView('handover-notes')
    } else if (screen === 'r-packages') {
      if (canManagePackages) {
        setCurrentView('packages')
      } else if (userRole !== undefined) {
        setCurrentView('default')
        const newParams = new URLSearchParams(searchParams)
        newParams.delete('screen')
        setSearchParams(newParams, { replace: true })
      }
      // While roles are still loading, keep the screen param and re-evaluate below.
    } else if (screen === 'billing') {
      setCurrentView('billing')
    } else if (screen === 'billing-additional-collection') {
      setCurrentView('billing-additional-collection')
    } else if (screen === 'billing-internal-employee') {
      setCurrentView('billing-internal-employee')
    } else if (screen === 'patients') {
      if (canBrowsePatientList) {
        setCurrentView('patients')
      } else {
        setCurrentView('default')
        const newParams = new URLSearchParams(searchParams)
        newParams.delete('screen')
        setSearchParams(newParams, { replace: true })
      }
    } else {
      // No screen param or unknown: show reception homepage (e.g. after "Back to Reception" or sidebar Home)
      setCurrentView('default')
    }
  }, [dischargeAdmission, screen, searchParams, setSearchParams, canBrowsePatientList, canManagePackages, userRole])

  if (dischargeAdmission && !inpatientDischargeAllowed(costCenterCareScope)) {
    return (
      <div className="flex flex-col p-6">
        <p className="text-sm text-slate-700">
          Inpatient discharge is not available for OP-only branches. Switch to a site that supports IP care or
          use the desk Discharge form.
        </p>
        <button type="button" onClick={closeDischarge} className="mt-4 text-sm text-primary hover:underline w-fit">
          Back
        </button>
      </div>
    )
  }

  if (dischargeAdmission && inpatientDischargeAllowed(costCenterCareScope)) {
    const navState = location.state as { patient?: string; patient_name?: string } | null
    const patientForBar =
      selectedPatient || navState?.patient || searchParams.get('patient') || ''
    return (
      <div className="flex flex-col h-full max-h-[calc(100vh-2.25rem)] overflow-hidden">
        <PatientCareHeader
          selectedPatient={patientForBar}
          onPatientSelect={handlePatientSelect}
        />
        <div className="flex-1 min-h-0 overflow-hidden bg-white">
          <DischargeAdmissionView
            admissionName={dischargeAdmission}
            patientHint={navState?.patient}
            patientNameHint={navState?.patient_name}
            onClose={closeDischarge}
            onSuccess={handleDischargeSuccess}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PatientCareHeader selectedPatient={selectedPatient} onPatientSelect={handlePatientSelect} />

      <div className="flex-1 overflow-y-auto">
        {canBrowsePatientList && currentView === 'patient' && (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Patient Management</h2>
                <p className="text-sm text-slate-600 mt-1">
                  View and manage patient records. Use the search box to find specific patients.
                </p>
              </div>
              <button
                onClick={() => setShowPatientModal(true)}
                className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold"
                title="Add Patient"
              >
                +
              </button>
            </div>
            <PatientList refreshKey={patientRefreshKey} />
          </div>
        )}

        {currentView === 'patient-medical-history' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">Patient Medical History</h2>
              <p className="text-sm text-slate-600 mt-1">
                View or update long-term medical history for the selected patient.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg">
              <MedicalHistoryView patient={selectedPatient || undefined} />
            </div>
          </div>
        )}

        {costCenterCareScope !== 'op_only' && currentView === 'admission' && (
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              Manage patient admissions. Click &quot;Admit&quot; on scheduled admissions to proceed.
            </p>
            <DashboardCard
              title="Admission Management"
              onAdd={() => setShowAdmissionModal(true)}
              addButtonTitle="Add Admission"
              allowCreateOnClosedEpisode
              noHeightLimit
            >
              <AdmissionList
                refreshKey={admissionRefreshKey}
                defaultStatus="Admission Scheduled"
                onAdmissionSelect={() => {}}
                onPatientFromAdmission={handlePatientSelect}
              />
            </DashboardCard>
          </div>
        )}

        {costCenterCareScope !== 'op_only' && currentView === 'discharge' && (
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              View and manage inpatient discharges. Click a row to see full details.
            </p>
            <DashboardCard title="Discharge Management" noHeightLimit>
              <DischargeList
                patient={selectedPatient || undefined}
                admission={undefined}
                onPatientClick={handlePatientSelect}
              />
            </DashboardCard>
          </div>
        )}

        {costCenterCareScope !== 'ip_only' && currentView === 'visit' && (
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              View and manage patient visits. Use the search box to find specific visits.
            </p>
            <DashboardCard
              title="Patient Visits"
              onAdd={() => setShowPatientVisitModal(true)}
              addButtonTitle="Add Patient Visit"
              allowCreateOnClosedEpisode
              noHeightLimit
            >
              <PatientVisitList
                patient={selectedPatient || undefined}
                refreshKey={patientVisitRefreshKey}
                onPatientFromVisit={handlePatientSelect}
                showAppointmentAmount
              />
            </DashboardCard>
          </div>
        )}

        {costCenterCareScope !== 'ip_only' && currentView === 'daily-auto-visit' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">Daily Auto Visit</h2>
              <p className="text-sm text-slate-600 mt-1">
                Manage Daily Patient Visit Setup and review all visits created with Daily Auto Visit type.
              </p>
            </div>
            <DailyAutoVisitView patient={selectedPatient || undefined} />
          </div>
        )}

         {canBrowsePatientList && currentView === 'patients' && (
             
                <div className="flex flex-col">
                 
           
                  <div className="p-4">
                    <section className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                      <div className="font-semibold mb-1 flex items-center justify-between">
                        <span>SEARCH FOR PATIENT TO EDIT DETAILS</span>
                        <button
                          onClick={() => setShowCreatePatientModal(true)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-white text-xs font-medium bg-primary hover:bg-primary/90 transition-colors"
                          title="Create new patient"
                        >
                          + New Patient
                        </button>
                      </div>
           
                                  <PatientList refreshKey={patientRefreshKey} />
          
                    </section>
                  </div>
           
                  {showCreatePatientModal && (
                    <CreatePatientModal
                      onClose={() => setShowCreatePatientModal(false)}
                      onSuccess={(patientName) => {
                        setShowCreatePatientModal(false)
                        setPatientRefreshKey((prev) => prev + 1)
                        toast.success(`Patient ${patientName} created successfully`)
                      }}
                    />
                  )}
                </div>
              )
            }

        {currentView === 'followup' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">Follow-up Dashboard</h2>
              <p className="text-sm text-slate-600 mt-1">
                OP &amp; IP discharged follow-up list. Filter by status (default: Open) and branch. Send reminder per row or send all reminders.
              </p>
            </div>
            <FollowUpList refreshKey={patientVisitRefreshKey} onPatientClick={handlePatientSelect} />
          </div>
        )}

        {currentView === 'iop' && (
          <div className="p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">IOP Dashboard</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Intensive Outpatient: schedule IOP days (slots) and enroll patients. Create a Patient Visit from an enrollment to link the visit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkScheduleModal(true)}
                className="flex-shrink-0 px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
              >
                Bulk Schedule
              </button>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <IOPDayListWithHeader refreshKey={patientVisitRefreshKey} />
              <IOPEnrollmentListWithHeader
                refreshKey={patientVisitRefreshKey}
                patientFilter={selectedPatient || undefined}
              />
            </div>
          </div>
        )}

        {currentView === 'long-acting-medicine' && (
          <div className="p-4">
            <DashboardCard
              title="Long Acting Medicine"
              onAdd={() => setShowCreateLongActing(true)}
              addButtonTitle="Create Long Acting Medicine"
              noHeightLimit
            >
              <ReceptionLongActingMedicineList
                patient={selectedPatient || undefined}
                refreshKey={longActingRefreshKey}
                onPatientClick={handlePatientSelect}
              />
            </DashboardCard>

            {showCreateLongActing && (
              <CreateLongActingMedicineModal
                initialPatient={selectedPatient || undefined}
                onClose={() => setShowCreateLongActing(false)}
                onSuccess={() => {
                  setShowCreateLongActing(false)
                  setLongActingRefreshKey((k) => k + 1)
                }}
              />
            )}
          </div>
        )}

        {currentView === 'billing' && (
          <div className="flex flex-col">
            <div className="p-4">
              <div className="bg-white border border-slate-200 rounded-lg p-6">
                <BillingDashboard
                  patient={selectedPatient || undefined}
                  admission={activeAdmission}
                  visit={activeVisit}
                />
              </div>
            </div>
          </div>
        )}

        {currentView === 'billing-additional-collection' && (
          <AdditionalCollectionBillingPage patient={selectedPatient || undefined} />
        )}

        {currentView === 'billing-internal-employee' && (
          <InternalEmployeeBillingPage patient={selectedPatient || undefined} />
        )}

        {currentView === 'insurance' && (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Insurance Patient Register</h2>
                <p className="text-sm text-slate-600 mt-1">
                  View and manage insurance patient registrations. Create patients directly from here.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateInsuranceRegister(true)}
                className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold"
                title="New Insurance Patient Register"
              >
                +
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <InsurancePatientRegisterList
                refreshKey={insuranceRegisterRefreshKey}
                onPatientClick={handlePatientSelect}
              />
            </div>
          </div>
        )}


        {currentView === 'reports' && (
          <div className="p-4">
            <ReceptionReports />
          </div>
        )}

        {currentView === 'price-report' && <PriceReport />}

        {currentView === 'referral' && (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Patient Referral</h2>
                <p className="text-sm text-slate-600 mt-1">
                  External referrals — create and track referrals to other hospitals or specialists.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateReferral(true)}
                className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold"
                title="New Referral"
              >
                +
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <PatientReferralList
                patient={selectedPatient || undefined}
                refreshKey={referralRefreshKey}
                onPatientClick={handlePatientSelect}
              />
            </div>
            {showCreateReferral && (
              <CreatePatientReferralModal
                initialPatient={selectedPatient || undefined}
                onClose={() => setShowCreateReferral(false)}
                onSuccess={() => {
                  setShowCreateReferral(false)
                  setReferralRefreshKey(k => k + 1)
                }}
              />
            )}
          </div>
        )}

        {currentView === 'report-requests' && (
          <div className="p-4">
            <ReportRequestsCard
              fullScreen
              patient={selectedPatient || undefined}
              onPatientSelect={handlePatientSelect}
            />
          </div>
        )}

        {currentView === 'observation' && (
          <div className="p-4">
            <DashboardCard
              title="Observation"
              onAdd={() => guardClinicalCreate(() => setShowObservationModal(true))}
              addButtonTitle="Add Observation"
              listingScreen="r-observation"
            >
              <ObservationList
                patient={selectedPatient || undefined}
                key={observationRefreshKey}
                onPatientClick={handlePatientSelect}
              />
            </DashboardCard>
          </div>
        )}

        {currentView === 'internal-transfer' && (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Branch Transfer</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Transfer admitted patients internally between branches.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void openInternalTransferModal()}
                className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold"
                title="New Internal Transfer"
              >
                +
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <InternalTransferList
                patient={selectedPatient || undefined}
                refreshKey={internalTransferRefreshKey}
                onPatientClick={handlePatientSelect}
              />
            </div>
          </div>
        )}

        {/* REC-063 / REC-064 - admission consent forms */}
        {(currentView === 'medical-consent' || currentView === 'financial-consent') && (
          <div className="p-4">
            {currentView === 'medical-consent' ? (
              <DashboardCard
                title="Patient Medical Consent"
                onAdd={() => guardClinicalCreate(() => setShowMedicalConsentModal(true))}
                addButtonTitle="New Patient Medical Consent"
                noHeightLimit
              >
                <DoctypeListPanel
                  doctype="Patient Medical Consent"
                  refreshKey={medicalConsentRefreshKey}
                  columns={[
                    { fieldname: 'name', label: 'Consent' },
                    { fieldname: 'patient_name', label: 'Patient' },
                    { fieldname: 'case_no', label: 'Case No' },
                    { fieldname: 'procedure_or_treatment', label: 'Procedure' },
                    { fieldname: 'consent_date', label: 'Consent Date' },
                    { fieldname: 'status', label: 'Status' },
                  ]}
                  emptyMessage="No medical consent recorded yet."
                />
              </DashboardCard>
            ) : (
              <DashboardCard title="Informed Financial Consent">
                <DoctypeListPanel
                  doctype="Informed Financial Consent"
                  columns={[
                    { fieldname: 'name', label: 'Consent' },
                    { fieldname: 'patient_name', label: 'Patient' },
                    { fieldname: 'case_no', label: 'Case No' },
                    { fieldname: 'estimated_cost', label: 'Estimated Cost' },
                    { fieldname: 'estimated_patient_share', label: 'Patient Share' },
                    { fieldname: 'consent_date', label: 'Consent Date' },
                    { fieldname: 'status', label: 'Status' },
                  ]}
                  createFields={[
                    { fieldname: 'patient', label: 'Patient', fieldtype: 'Link', options: 'Patient', reqd: true },
                    { fieldname: 'inpatient_admission', label: 'Admission', fieldtype: 'Link', options: 'Inpatient Admission' },
                    { fieldname: 'estimated_cost', label: 'Estimated Total Cost', fieldtype: 'Currency', reqd: true },
                    { fieldname: 'expected_length_of_stay', label: 'Expected Stay (Days)', fieldtype: 'Int' },
                    { fieldname: 'insurance', label: 'Insurance', fieldtype: 'Link', options: 'Health Insurance' },
                    { fieldname: 'insurance_coverage', label: 'Coverage (%)', fieldtype: 'Float' },
                    { fieldname: 'estimated_patient_share', label: 'Estimated Patient Share', fieldtype: 'Currency' },
                    { fieldname: 'advance_collected', label: 'Advance Collected', fieldtype: 'Currency' },
                    { fieldname: 'guardian_name', label: 'Legal Guardian Name', fieldtype: 'Data' },
                    { fieldname: 'witness_name', label: 'Witness Name', fieldtype: 'Data' },
                    { fieldname: 'status', label: 'Status', fieldtype: 'Select', options: 'Draft\nSigned\nDeclined', default: 'Draft' },
                  ]}
                  emptyMessage="No financial consent recorded yet."
                />
              </DashboardCard>
            )}
          </div>
        )}

        {/* REC-061 / REC-062 - e-signature capture with auto-upload */}
        {currentView === 'signatures' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">Admission e-Signatures</h2>
              <p className="mt-1 text-sm text-slate-600">
                Capture guardian and consent signatures directly; each is uploaded and attached
                to the document automatically.
              </p>
            </div>
            <AdmissionSignatures patient={selectedPatient} admission={activeAdmission || undefined} />
          </div>
        )}

        {/* Inpatient package catalogue — Head of Operation only */}
        {canManagePackages && currentView === 'packages' && (
          <div className="p-4">
            <Packages />
          </div>
        )}

        {/* REC-086 - promotion analysis */}
        {currentView === 'promotions' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">Promotion Analysis</h2>
              <p className="mt-1 text-sm text-slate-600">
                Track promotion uptake and value across OP and IP.
              </p>
            </div>
            <PromotionAnalysis />
          </div>
        )}

        {/* Receptionist Daily Handover & Shift Notes */}
        {currentView === 'handover-notes' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">
                Daily Handover &amp; Shift Notes
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Record shift handover notes for the next receptionist — subject, date, and notes.
              </p>
            </div>
            <DashboardCard title="Receptionist Daily Handover" noHeightLimit>
              <DoctypeListPanel
                doctype="Receptionist Daily Handover"
                columns={[
                  { fieldname: 'name', label: 'ID' },
                  { fieldname: 'subject', label: 'Subject' },
                  { fieldname: 'date', label: 'Date' },
                  { fieldname: 'notes', label: 'Notes' },
                  { fieldname: 'owner', label: 'Created By' },
                ]}
                createFields={[
                  { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', reqd: true },
                  {
                    fieldname: 'date',
                    label: 'Date',
                    fieldtype: 'Date',
                    reqd: true,
                    default: new Date().toISOString().slice(0, 10),
                  },
                  { fieldname: 'notes', label: 'Notes', fieldtype: 'Small Text', reqd: true },
                ]}
                orderBy="date desc"
                emptyMessage="No handover notes recorded yet."
              />
            </DashboardCard>
          </div>
        )}

        {currentView === 'appointments-freeze' && (
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              When doctors are not available or on leave, freeze or cancel slots. Release when they return.
            </p>
            <DashboardCard
              title="Appointments"
              onAdd={() => guardClinicalCreate(() => setShowAppointmentModal(true))}
              addButtonTitle="New Appointment"
              noHeightLimit
            >
              <AppointmentList
                showAll={true}
                defaultTodayDates
                receptionWalkInActions
                patient={selectedPatient || undefined}
                refreshKey={appointmentRefreshKey}
                onAddAppointment={(filters) => {
                  setInitialAppointmentDate(filters.date)
                  setInitialPractitioner(filters.practitioner)
                }}
                onPatientClick={handlePatientSelect}
              />
            </DashboardCard>
            {/* <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              To freeze or release practitioner schedules, use the backend: Healthcare → Practitioner Schedule, or open Appointments in the backend.
              <a href="/app/Patient%20Appointment" target="_blank" rel="noopener noreferrer" className="ml-2 underline font-medium">Open Appointments</a>
            </div> */}
          </div>
        )}

        {currentView === 'practitioner-unavailability' && (
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              Record when practitioners are unavailable or on leave. Reception can create holds and cancel them when the doctor returns.
            </p>
            <DashboardCard title="Practitioner Unavailability" noHeightLimit>
              <PractitionerUnavailabilityList />
            </DashboardCard>
          </div>
        )}

        {currentView === 'sticky-notes' && (
          <div className="p-4">
            <DashboardCard
              title="Sticky Notes"
              onAdd={() => guardClinicalCreate(() => setShowStickyNoteModal(true))}
              addButtonTitle="Add Sticky Note"
              noHeightLimit
            >
              <WarningMessagesList
                patient={selectedPatient || undefined}
                specialPhoneScope="special_only"
                key={`reception-sticky-${stickyNoteRefreshKey}`}
                title="Sticky Notes"
                onPatientClick={handlePatientSelect}
              />
            </DashboardCard>
          </div>
        )}

        {currentView === 'service-requests' && (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Service Requests / Booked Lab</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Lab and procedure requests. Create with +, then Confirm Payment and Book Lab to forward to laboratory.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateServiceRequest(true)}
                className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 text-lg font-bold shrink-0"
                title="Create Service Request"
              >
                +
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col max-h-[500px]">
              <ServiceRequestList
                patient={selectedPatient || undefined}
                refreshKey={serviceRequestRefreshKey}
                onPatientClick={handlePatientSelect}
              />
            </div>
            {showCreateServiceRequest && (
              <CreateServiceRequestModal
                onClose={() => setShowCreateServiceRequest(false)}
                onSuccess={() => {
                  setServiceRequestRefreshKey((k) => k + 1)
                  setShowCreateServiceRequest(false)
                }}
                initialPatient={selectedPatient || undefined}
              />
            )}
          </div>
        )}

        {currentView === 'receipt-voucher' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">Receipt Voucher</h2>
              <p className="text-sm text-slate-600 mt-1">
                For employee (pharmacy) and OP other branches.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
              <p className="text-slate-600 mb-4">Receipt vouchers are managed in the backend (Accounts / Journal Entry).</p>
              <a
                href="/app/Journal%20Entry"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
              >
                Open Journal Entry
              </a>
            </div>
          </div>
        )}

        {((costCenterCareScope !== 'ip_only' && currentView === 'op-dashboard') ||
          (costCenterCareScope !== 'op_only' && currentView === 'ip-dashboard')) && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">
                {currentView === 'op-dashboard' ? 'OP Dashboard' : 'IP Dashboard'}
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                {currentView === 'op-dashboard'
                  ? 'Outpatient: patients, appointments, visits. Change user for entry and receipt voucher as needed.'
                  : 'Inpatient: admissions, transfers, discharge. Branch per hospital.'}
              </p>
            </div>
            {currentView === 'op-dashboard' && (
              <div className={`grid gap-4 ${canBrowsePatientList ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                {canBrowsePatientList && (
                  <DashboardCard
                    fixedHeight
                    title="Patient List"
                    onAdd={() => setShowPatientModal(true)}
                    addButtonTitle="Add Patient"
                    listingScreen="patients"
                    filterable={false}
                    allowCreateOnClosedEpisode
                  >
                    <PatientList refreshKey={patientRefreshKey} />
                  </DashboardCard>
                )}
                <AppointmentsCard
                  receptionWalkInActions
                  defaultTodayDates
                  listingScreen="r-appointments-freeze"
                  patient={selectedPatient || undefined}
                  onPatientSelect={handlePatientSelect}
                />
              </div>
            )}
            {currentView === 'ip-dashboard' && (
              <InpatientAdmissionsCard
                listingScreen="r-reg"
                patient={selectedPatient || undefined}
                onPatientSelect={handlePatientSelect}
              />
            )}
          </div>
        )}

        {currentView === 'default' && (
          <>
            {/* Standardised single full-width column — same card stack style as the
                doctor and nurse dashboards. */}
            <div className="flex flex-col gap-4 p-4">
              {canBrowsePatientList && (
                <DashboardCard
                  fixedHeight
                  title="Patient List"
                  onAdd={() => setShowPatientModal(true)}
                  addButtonTitle="Add Patient"
                  listingScreen="patients"
                  filterable={false}
                  allowCreateOnClosedEpisode
                >
                  <PatientList refreshKey={patientRefreshKey} />
                </DashboardCard>
              )}

              <AppointmentsCard
                receptionWalkInActions
                defaultTodayDates
                listingScreen="r-appointments-freeze"
                patient={selectedPatient || undefined}
                onPatientSelect={handlePatientSelect}
              />

              {costCenterCareScope !== 'ip_only' && (
                <OutpatientVisitsCard
                  showAppointmentAmount
                  listingScreen="r-visit"
                  patient={selectedPatient || undefined}
                  onPatientSelect={handlePatientSelect}
                />
              )}

              {costCenterCareScope !== 'op_only' && (
                <InpatientAdmissionsCard
                  listingScreen="r-reg"
                  patient={selectedPatient || undefined}
                  onPatientSelect={handlePatientSelect}
                />
              )}

              <DashboardCard
                fixedHeight
                title="Insurance Patient Register"
                onAdd={() => guardClinicalCreate(() => setShowCreateInsuranceRegister(true))}
                addButtonTitle="New Insurance Patient Register"
                listingScreen="r-insurance"
              >
                <InsurancePatientRegisterList
                  refreshKey={insuranceRegisterRefreshKey}
                  onPatientClick={handlePatientSelect}
                />
              </DashboardCard>

              {costCenterCareScope !== 'op_only' && (
                <DashboardCard
                  fixedHeight
                  title="Discharge List"
                  onAdd={() => window.open('/app/discharge/new-discharge', '_blank')}
                  addButtonTitle="Add Discharge"
                  listingScreen="r-discharge"
                >
                  <DischargeList
                    patient={selectedPatient || undefined}
                    admission={undefined}
                    onPatientClick={handlePatientSelect}
                  />
                </DashboardCard>
              )}

              <DashboardCard
                fixedHeight
                title="Patient Referral"
                onAdd={() => guardClinicalCreate(() => setShowCreateReferral(true))}
                addButtonTitle="New Referral"
                listingScreen="r-referral"
              >
                <PatientReferralList
                  patient={selectedPatient || undefined}
                  refreshKey={referralRefreshKey}
                  onPatientClick={handlePatientSelect}
                />
              </DashboardCard>

              <ReportRequestsCard
                listingScreen="r-report-requests"
                patient={selectedPatient || undefined}
                onPatientSelect={handlePatientSelect}
              />

              {observationsAllowedForMode(mode) && (
                <DashboardCard
                  fixedHeight
                  title="Observation"
                  onAdd={() => guardClinicalCreate(() => setShowObservationModal(true))}
                  addButtonTitle="Add Observation"
                  listingScreen="r-observation"
                >
                  <ObservationList
                    patient={selectedPatient || undefined}
                    key={observationRefreshKey}
                    onPatientClick={handlePatientSelect}
                  />
                </DashboardCard>
              )}

              <DashboardCard
                fixedHeight
                title="Internal Transfer"
                onAdd={() => guardClinicalCreate(() => void openInternalTransferModal())}
                addButtonTitle="New Internal Transfer"
                listingScreen="r-internal-transfer"
              >
                <InternalTransferList
                  patient={selectedPatient || undefined}
                  refreshKey={internalTransferRefreshKey}
                  onPatientClick={handlePatientSelect}
                />
              </DashboardCard>
            </div>
          </>
        )}
      </div>

      {showAppointmentModal && (
        <CreateAppointmentModal
          onClose={() => setShowAppointmentModal(false)}
          onSuccess={() => {
            setAppointmentRefreshKey(prev => prev + 1)
            setShowAppointmentModal(false)
          }}
          initialPatient={selectedPatient || undefined}
          initialAppointmentDate={initialAppointmentDate || undefined}
          initialPractitioner={initialPractitioner || undefined}
        />
      )}

      {showPatientVisitModal && (
        <CreatePatientVisitModal
          onClose={() => setShowPatientVisitModal(false)}
          onSuccess={(_visitName) => {
            setPatientVisitRefreshKey(prev => prev + 1)
            setShowPatientVisitModal(false)
          }}
          initialPatient={selectedPatient || undefined}
        />
      )}

      {showAdmissionModal && (
        <CreateAdmissionModal
          onClose={() => setShowAdmissionModal(false)}
          onSuccess={(_admissionName) => {
            setAdmissionRefreshKey(prev => prev + 1)
            setShowAdmissionModal(false)
          }}
          patientName={selectedPatient || undefined}
        />
      )}

      {showPatientModal && (
        <CreatePatientModal
          onClose={() => setShowPatientModal(false)}
          onSuccess={(patientName) => {
            setPatientRefreshKey(prev => prev + 1)
            setShowPatientModal(false)
            if (patientName) {
              setSelectedPatient(patientName)
              setGlobalPatient(patientName)
            }
          }}
        />
      )}

      {showCreateInsuranceRegister && (
        <CreateInsurancePatientRegisterModal
          onClose={() => setShowCreateInsuranceRegister(false)}
          onSuccess={() => {
            setShowCreateInsuranceRegister(false)
            setInsuranceRegisterRefreshKey(k => k + 1)
          }}
        />
      )}

      {showCreateReferral && (
        <CreatePatientReferralModal
          initialPatient={selectedPatient || undefined}
          onClose={() => setShowCreateReferral(false)}
          onSuccess={() => {
            setShowCreateReferral(false)
            setReferralRefreshKey(k => k + 1)
          }}
        />
      )}

      {showObservationModal && (
        <CreateObservationModal
          initialPatient={selectedPatient || undefined}
          onClose={() => setShowObservationModal(false)}
          onSuccess={() => {
            setShowObservationModal(false)
            setObservationRefreshKey((k) => k + 1)
          }}
        />
      )}

      {showCreateInternalTransfer && transferAdmission && (
        <TransferCostCenterModal
          admission={{
            name: transferAdmission.name,
            patient: transferAdmission.patient,
            patient_name: transferAdmission.patient_name,
            company: transferAdmission.company,
            cost_center: transferAdmission.cost_center,
          }}
          onClose={() => {
            setShowCreateInternalTransfer(false)
            setTransferAdmission(null)
          }}
          onSuccess={() => {
            setShowCreateInternalTransfer(false)
            setTransferAdmission(null)
            setInternalTransferRefreshKey((k) => k + 1)
          }}
        />
      )}

      {showBulkScheduleModal && (
        <BulkScheduleIOPModal
          onClose={() => setShowBulkScheduleModal(false)}
          onSuccess={() => {
            setShowBulkScheduleModal(false)
            setPatientVisitRefreshKey(prev => prev + 1)
          }}
        />
      )}
      {showStickyNoteModal && (
        <CreateWarningMessageModal
          onClose={() => setShowStickyNoteModal(false)}
          onSuccess={() => {
            setStickyNoteRefreshKey((k) => k + 1)
            setShowStickyNoteModal(false)
          }}
          initialPatient={selectedPatient || undefined}
          defaultSpecialPhoneWarning
          title="Create Sticky Note"
          submitLabel="Create Sticky Note"
        />
      )}

      {showMedicalConsentModal && (
        <CreatePatientMedicalConsentModal
          initialPatient={selectedPatient || undefined}
          initialAdmission={activeAdmission || undefined}
          onClose={() => setShowMedicalConsentModal(false)}
          onSuccess={() => {
            setShowMedicalConsentModal(false)
            setMedicalConsentRefreshKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
