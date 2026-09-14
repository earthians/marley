// import { useState, useEffect } from 'react'
// import { createSickLeave, type CreateSickLeaveInput } from '../../services/sickLeave'
// import {
//   fetchHealthcarePractitioners,
//   fetchInpatientAdmissions,
//   fetchLeadSources,
//   type LinkFieldOption,
// } from '../../services/common'
// import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'

// interface CreateSickLeaveModalProps {
//   onClose: () => void
//   onSuccess: () => void
//   patient?: string
// }

// export const CreateSickLeaveModal = ({ onClose, onSuccess, patient }: CreateSickLeaveModalProps) => {
//   const [saving, setSaving] = useState(false)
//   const [error, setError] = useState<string | null>(null)

//   // Form values
//   const [patientId, setPatientId] = useState(patient || '')
//   const [patientName, setPatientName] = useState('')
//   const [admissionNo, setAdmissionNo] = useState('')
//   const [fromDate, setFromDate] = useState(new Date().toISOString().split('T')[0])
//   const [toDate, setToDate] = useState('')
//   const [days, setDays] = useState('')
//   const [diagnosis, setDiagnosis] = useState('')
//   const [doctorId, setDoctorId] = useState('')
//   const [sourceId, setSourceId] = useState('')

//   // Patient dropdown
//   const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
//   const [patientOpen, setPatientOpen] = useState(false)
//   const [patientQuery, setPatientQuery] = useState('')
//   const [patientLoading, setPatientLoading] = useState(false)

//   // Admission dropdown
//   const [admissionOptions, setAdmissionOptions] = useState<LinkFieldOption[]>([])
//   const [admissionOpen, setAdmissionOpen] = useState(false)
//   const [admissionQuery, setAdmissionQuery] = useState('')
//   const [selectedAdmission, setSelectedAdmission] = useState<LinkFieldOption | null>(null)

//   // Doctor dropdown
//   const [doctorOptions, setDoctorOptions] = useState<LinkFieldOption[]>([])
//   const [doctorOpen, setDoctorOpen] = useState(false)
//   const [doctorQuery, setDoctorQuery] = useState('')
//   const [selectedDoctor, setSelectedDoctor] = useState<LinkFieldOption | null>(null)

//   // Source dropdown
//   const [sourceOptions, setSourceOptions] = useState<LinkFieldOption[]>([])
//   const [sourceOpen, setSourceOpen] = useState(false)
//   const [sourceQuery, setSourceQuery] = useState('')
//   const [selectedSource, setSelectedSource] = useState<LinkFieldOption | null>(null)

//   // Load initial patient label
//   useEffect(() => {
//     if (patient) {
//       fetchPatients(1, 0, patient).then((res) => {
//         if (res.length > 0) setPatientQuery(res[0].patient_name)
//       }).catch(() => {})
//     }
//   }, [patient])

//   // Auto-calculate days when both dates are set
//   useEffect(() => {
//     if (fromDate && toDate) {
//       try {
//         const from = new Date(fromDate)
//         const to = new Date(toDate)
//         const diff = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1
//         if (diff > 0) setDays(String(diff))
//       } catch { /* ignore */ }
//     }
//   }, [fromDate, toDate])

//   useEffect(() => {
//     if (!patientOpen) return
//     let cancelled = false
//     const run = async () => {
//       setPatientLoading(true)
//       try {
//         const res = patientQuery.trim() ? await searchPatients(patientQuery, 20) : await fetchPatients(20, 0)
//         if (!cancelled) setPatientOptions(res)
//       } catch { if (!cancelled) setPatientOptions([]) }
//       finally { if (!cancelled) setPatientLoading(false) }
//     }
//     const t = setTimeout(run, patientQuery.trim() ? 300 : 0)
//     return () => { cancelled = true; clearTimeout(t) }
//   }, [patientQuery, patientOpen])

//   useEffect(() => {
//     if (!admissionOpen) return
//     let cancelled = false
//     const run = async () => {
//       try {
//         const res = await fetchInpatientAdmissions(patientId || undefined, admissionQuery || undefined)
//         if (!cancelled) setAdmissionOptions(res)
//       } catch { if (!cancelled) setAdmissionOptions([]) }
//     }
//     const t = setTimeout(run, admissionQuery.trim() ? 300 : 0)
//     return () => { cancelled = true; clearTimeout(t) }
//   }, [admissionQuery, admissionOpen, patientId])

//   useEffect(() => {
//     if (!doctorOpen) return
//     let cancelled = false
//     const run = async () => {
//       try {
//         const res = await fetchHealthcarePractitioners(doctorQuery || undefined)
//         if (!cancelled) setDoctorOptions(res)
//       } catch { if (!cancelled) setDoctorOptions([]) }
//     }
//     const t = setTimeout(run, doctorQuery.trim() ? 300 : 0)
//     return () => { cancelled = true; clearTimeout(t) }
//   }, [doctorQuery, doctorOpen])

//   useEffect(() => {
//     if (!sourceOpen) return
//     let cancelled = false
//     const run = async () => {
//       try {
//         const res = await fetchLeadSources(sourceQuery || undefined)
//         if (!cancelled) setSourceOptions(res)
//       } catch { if (!cancelled) setSourceOptions([]) }
//     }
//     const t = setTimeout(run, sourceQuery.trim() ? 300 : 0)
//     return () => { cancelled = true; clearTimeout(t) }
//   }, [sourceQuery, sourceOpen])

//   const closeAllDropdowns = () => {
//     setPatientOpen(false)
//     setAdmissionOpen(false)
//     setDoctorOpen(false)
//     setSourceOpen(false)
//   }

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault()
//     if (!fromDate) { setError('From Date is required'); return }
//     setSaving(true)
//     setError(null)
//     try {
//       const payload: CreateSickLeaveInput = {
//         from_date: fromDate,
//         to_date: toDate || undefined,
//         days: days || undefined,
//         diagnosis: diagnosis || undefined,
//         doctor: doctorId || undefined,
//         source: sourceId || undefined,
//         admission_no: admissionNo || undefined,
//         patient: patientId || undefined,
//         patient_name: patientName || undefined,
//       }
//       const result = await createSickLeave(payload)
//       if (result.success) {
//         onSuccess()
//       } else {
//         setError(result.message || 'Failed to create sick leave')
//       }
//     } catch (e) {
//       setError(e instanceof Error ? e.message : 'Failed to create sick leave')
//     } finally {
//       setSaving(false)
//     }
//   }

//   // Reusable link-field dropdown block
//   const LinkField = ({
//     label,
//     required,
//     isOpen,
//     query,
//     selectedLabel,
//     options,
//     loading: fieldLoading,
//     onFocus,
//     onChange,
//     onSelect,
//     placeholder,
//   }: {
//     label: string
//     required?: boolean
//     isOpen: boolean
//     query: string
//     selectedLabel: string | null | undefined
//     options: LinkFieldOption[]
//     loading?: boolean
//     onFocus: () => void
//     onChange: (v: string) => void
//     onSelect: (o: LinkFieldOption) => void
//     placeholder: string
//   }) => (
//     <div>
//       <label className="block text-sm font-medium text-slate-700 mb-1">
//         {label} {required && <span className="text-red-500">*</span>}
//       </label>
//       <div className="relative">
//         <input
//           type="text"
//           value={isOpen ? query : (selectedLabel ?? query)}
//           onChange={(e) => { onChange(e.target.value); onFocus() }}
//           onFocus={onFocus}
//           placeholder={placeholder}
//           className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
//         />
//         {fieldLoading && <span className="absolute right-3 top-2.5 text-xs text-slate-400">Loading…</span>}
//         {isOpen && options.length > 0 && (
//           <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
//             {options.map((o) => (
//               <button
//                 key={o.name}
//                 type="button"
//                 onClick={() => onSelect(o)}
//                 className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
//               >
//                 {o.label}
//               </button>
//             ))}
//           </div>
//         )}
//       </div>
//     </div>
//   )

//   return (
//     <div className={CREATE_MODAL_OVERLAY}>
//       <div className={createModalShellClass('max-w-2xl w-full max-h-[90vh] overflow-hidden')}>
//         {/* Header */}
//         <div className="relative shrink-0 border-b border-emerald-100/60 bg-gradient-to-r from-emerald-100 via-teal-50 to-sky-100 p-4 sm:px-5 flex-shrink-0">
//           <div className="flex items-center justify-between">
//             <h2 className="text-lg font-semibold tracking-tight text-emerald-950">New Sick Leave</h2>
//             <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 text-emerald-800/70 transition hover:bg-emerald-200/50 hover:text-emerald-950">
//               <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
//               </svg>
//             </button>
//           </div>
//         </div>

//         {/* Body — min-height 500px so the form never feels cramped */}
//         <form
//           onSubmit={handleSubmit}
//           className="p-6 space-y-5 overflow-y-auto flex-1"
//           style={{ minHeight: '500px' }}
//           onClick={(e) => {
//             const target = e.target as HTMLElement
//             if (target.tagName !== 'INPUT' && !target.closest('.absolute')) closeAllDropdowns()
//           }}
//         >
//           {/* Patient & Admission */}
//           <div>
//             <h3 className="text-sm font-semibold text-slate-700 mb-3">Patient & Admission</h3>
//             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//               {/* Patient */}
//               <div className="md:col-span-2">
//                 <label className="block text-sm font-medium text-slate-700 mb-1">Patient</label>
//                 <div className="relative">
//                   <input
//                     type="text"
//                     value={patientQuery}
//                     onChange={(e) => { setPatientQuery(e.target.value); setPatientOpen(true) }}
//                     onFocus={() => setPatientOpen(true)}
//                     placeholder="Search patient…"
//                     className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
//                   />
//                   {patientLoading && <span className="absolute right-3 top-2.5 text-xs text-slate-400">Loading…</span>}
//                   {patientOpen && patientOptions.length > 0 && (
//                     <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
//                       {patientOptions.map((p) => (
//                         <button key={p.name} type="button"
//                           onClick={() => { setPatientId(p.name); setPatientQuery(p.patient_name); setPatientName(p.patient_name); setPatientOpen(false) }}
//                           className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100">
//                           <div className="font-medium">{p.patient_name}</div>
//                           {p.mobile && <div className="text-xs text-slate-500">{p.mobile}</div>}
//                         </button>
//                       ))}
//                     </div>
//                   )}
//                 </div>
//               </div>

//               {/* Admission No */}
//               <div className="md:col-span-2">
//                 <LinkField
//                   label="Admission No"
//                   isOpen={admissionOpen}
//                   query={admissionQuery}
//                   selectedLabel={selectedAdmission?.label}
//                   options={admissionOptions}
//                   onFocus={() => setAdmissionOpen(true)}
//                   onChange={(v) => { setAdmissionQuery(v); if (!v) { setAdmissionNo(''); setSelectedAdmission(null) } }}
//                   onSelect={(a) => { setAdmissionNo(a.name); setSelectedAdmission(a); setAdmissionQuery(a.label); setAdmissionOpen(false) }}
//                   placeholder="Search admission…"
//                 />
//               </div>
//             </div>
//           </div>

//           {/* Leave Period */}
//           <div>
//             <h3 className="text-sm font-semibold text-slate-700 mb-3">Leave Period</h3>
//             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
//               <div>
//                 <label className="block text-sm font-medium text-slate-700 mb-1">
//                   From Date <span className="text-red-500">*</span>
//                 </label>
//                 <DateFilterInput
//
//                   value={fromDate}
//                   onChange={(e) => setFromDate(e.target.value)}
//                   className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
//                 />
//               </div>
//               <div>
//                 <label className="block text-sm font-medium text-slate-700 mb-1">To Date</label>
//                 <DateFilterInput
//
//                   value={toDate}
//                   onChange={(e) => setToDate(e.target.value)}
//                   className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
//                 />
//               </div>
//               <div>
//                 <label className="block text-sm font-medium text-slate-700 mb-1">Days</label>
//                 <input
//                   type="text"
//                   value={days}
//                   onChange={(e) => setDays(e.target.value)}
//                   placeholder="Auto-calculated"
//                   className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
//                 />
//               </div>
//             </div>
//           </div>

//           {/* Clinical Details */}
//           <div>
//             <h3 className="text-sm font-semibold text-slate-700 mb-3">Clinical Details</h3>
//             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//               {/* Doctor */}
//               <LinkField
//                 label="Doctor Name"
//                 isOpen={doctorOpen}
//                 query={doctorQuery}
//                 selectedLabel={selectedDoctor?.label}
//                 options={doctorOptions}
//                 onFocus={() => setDoctorOpen(true)}
//                 onChange={(v) => { setDoctorQuery(v); if (!v) { setDoctorId(''); setSelectedDoctor(null) } }}
//                 onSelect={(d) => { setDoctorId(d.name); setSelectedDoctor(d); setDoctorQuery(d.label); setDoctorOpen(false) }}
//                 placeholder="Search doctor…"
//               />

//               {/* Source */}
//               <LinkField
//                 label="Source"
//                 isOpen={sourceOpen}
//                 query={sourceQuery}
//                 selectedLabel={selectedSource?.label}
//                 options={sourceOptions}
//                 onFocus={() => setSourceOpen(true)}
//                 onChange={(v) => { setSourceQuery(v); if (!v) { setSourceId(''); setSelectedSource(null) } }}
//                 onSelect={(s) => { setSourceId(s.name); setSelectedSource(s); setSourceQuery(s.label); setSourceOpen(false) }}
//                 placeholder="Search source…"
//               />

//               {/* Diagnosis */}
//               <div className="md:col-span-2">
//                 <label className="block text-sm font-medium text-slate-700 mb-1">Diagnosis</label>
//                 <textarea
//                   value={diagnosis}
//                   onChange={(e) => setDiagnosis(e.target.value)}
//                   rows={4}
//                   placeholder="Enter diagnosis details…"
//                   className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
//                 />
//               </div>
//             </div>
//           </div>

//           {error && (
//             <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>
//           )}

//           <div className="flex justify-end gap-3 pt-2">
//             <button
//               type="button"
//               onClick={onClose}
//               className={CM_BTN_CANCEL}
//             >
//               Cancel
//             </button>
//             <button
//               type="submit"
//               disabled={saving}
//               className={CM_BTN_PRIMARY}
//             >
//               {saving ? 'Saving…' : 'Save Sick Leave'}
//             </button>
//           </div>
//         </form>
//       </div>
//     </div>
//   )
// }

import { useState, useEffect } from 'react'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_OVERLAY,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { createSickLeave, updateSickLeave, type CreateSickLeaveInput, type SickLeaveRow } from '../../services/sickLeave'
import {
  fetchHealthcarePractitioners,
  fetchInpatientAdmissions,
  fetchPatientVisits,
  fetchCostCenters,
  syncCostCenterFromCareEpisode,
  type LinkFieldOption,
} from '../../services/common'
import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'
import { useCareContext } from '../../providers/CareContextProvider'
import {
  LOCKED_PRACTITIONER_INPUT_CLASS,
  useLockedLinkedPractitioner,
} from '../../hooks/useLockedLinkedPractitioner'
import { useRejectEditModeWhenLocked } from '../../hooks/useRejectEditModeWhenLocked'
import { DateFilterInput } from '../ui/DateFilterInput'

interface CreateSickLeaveModalProps {
  onClose: () => void
  onSuccess: () => void
  patient?: string
  /** When set, modal edits this existing Patient Sick Leave. */
  editRow?: SickLeaveRow | null
}

export const CreateSickLeaveModal = ({ onClose, onSuccess, patient, editRow }: CreateSickLeaveModalProps) => {
  const isEdit = Boolean(editRow?.name)
  useRejectEditModeWhenLocked(isEdit, onClose)

  // Get context from CareContextProvider
  const { mode, activeVisit, activeAdmission, selectedPatient: contextPatient, userCostCenter } = useCareContext()
  
  // Determine if we're in IP or OP mode based on context
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'
  
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form values
  const [patientId, setPatientId] = useState(editRow?.patient || patient || contextPatient || '')
  const [patientName, setPatientName] = useState(editRow?.patient_name || '')
  const [admissionNo, setAdmissionNo] = useState(() => {
    if (editRow?.admission_no) return editRow.admission_no
    if (isIPMode && activeAdmission) return activeAdmission
    return ''
  })
  const [patientVisitNo, setPatientVisitNo] = useState(() => {
    if (editRow?.patient_visit) return editRow.patient_visit
    if (isOPMode && activeVisit) return activeVisit
    return ''
  })
  const [fromDate, setFromDate] = useState(
    editRow?.from_date || new Date().toISOString().split('T')[0]
  )
  const [toDate, setToDate] = useState(editRow?.to_date || '')
  const [days, setDays] = useState(editRow?.days || '')
  const [diagnosis, setDiagnosis] = useState(editRow?.diagnosis || '')
  const [doctorId, setDoctorId] = useState(editRow?.doctor || '')
  const [doctorName, setDoctorName] = useState(editRow?.doctor_name || '')
  const [branch, setBranch] = useState(editRow?.cost_center || '')
  const [srNo, setSrNo] = useState('')

  // Flag fields — Patient Sick Leave doctype uses Check (boolean 0/1)
  const [sickFlag, setSickFlag] = useState(Boolean(editRow?.sick_flag))
  const [fitFlag, setFitFlag] = useState(Boolean(editRow?.fit_flag))
  const [unfitFlag, setUnfitFlag] = useState(Boolean(editRow?.unfit_flag))
  const [lightDuty, setLightDuty] = useState(Boolean(editRow?.light_duty))
  const [needsFlag, setNeedsFlag] = useState(Boolean(editRow?.needs_flag))
  const [accPatient, setAccPatient] = useState(Boolean(editRow?.acc_patient))

  const addDaysToDate = (dateStr: string, dayCount: number) => {
    const d = new Date(`${dateStr}T00:00:00`)
    if (Number.isNaN(d.getTime())) return ''
    d.setDate(d.getDate() + dayCount)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const daysBetweenInclusive = (fromStr: string, toStr: string) => {
    const from = new Date(`${fromStr}T00:00:00`)
    const to = new Date(`${toStr}T00:00:00`)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
    return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1
  }

  const handleFromDateChange = (value: string) => {
    setFromDate(value)
    const n = parseInt(days, 10)
    if (value && n > 0) {
      setToDate(addDaysToDate(value, n - 1))
    } else if (value && toDate) {
      const diff = daysBetweenInclusive(value, toDate)
      if (diff > 0) setDays(String(diff))
    }
  }

  const handleToDateChange = (value: string) => {
    setToDate(value)
    if (!value) {
      setDays('')
      return
    }
    if (fromDate) {
      const diff = daysBetweenInclusive(fromDate, value)
      if (diff > 0) setDays(String(diff))
      else setDays('')
    }
  }

  const handleDaysChange = (value: string) => {
    // Allow digits only
    const cleaned = value.replace(/[^\d]/g, '')
    setDays(cleaned)
    const n = parseInt(cleaned, 10)
    if (!cleaned || !(n > 0)) {
      setToDate('')
      return
    }
    if (fromDate) {
      setToDate(addDaysToDate(fromDate, n - 1))
    }
  }

  // Patient dropdown
  const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientQuery, setPatientQuery] = useState('')
  const [patientLoading, setPatientLoading] = useState(false)

  // Admission dropdown (IP mode)
  const [admissionOptions, setAdmissionOptions] = useState<LinkFieldOption[]>([])
  const [admissionOpen, setAdmissionOpen] = useState(false)
  const [admissionQuery, setAdmissionQuery] = useState('')
  const [selectedAdmission, setSelectedAdmission] = useState<LinkFieldOption | null>(null)

  // Visit dropdown (OP mode)
  const [visitOptions, setVisitOptions] = useState<LinkFieldOption[]>([])
  const [visitOpen, setVisitOpen] = useState(false)
  const [visitQuery, setVisitQuery] = useState('')
  const [selectedVisit, setSelectedVisit] = useState<LinkFieldOption | null>(null)

  // Doctor dropdown
  const [doctorOptions, setDoctorOptions] = useState<LinkFieldOption[]>([])
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [doctorQuery, setDoctorQuery] = useState(editRow?.doctor_name || editRow?.doctor || '')
  const {
    locked: practitionerLocked,
    practitionerId: linkedPractitionerId,
    practitionerLabel: linkedPractitionerLabel,
  } = useLockedLinkedPractitioner()
  const [selectedDoctor, setSelectedDoctor] = useState<LinkFieldOption | null>(() =>
    editRow?.doctor
      ? { name: editRow.doctor, label: editRow.doctor_name || editRow.doctor }
      : null
  )

  // Branch — Cost Center dropdown
  const [branchOptions, setBranchOptions] = useState<LinkFieldOption[]>([])
  const [branchOpen, setBranchOpen] = useState(false)
  const [branchQuery, setBranchQuery] = useState(editRow?.cost_center || '')
  const [selectedBranch, setSelectedBranch] = useState<LinkFieldOption | null>(() =>
    editRow?.cost_center ? { name: editRow.cost_center, label: editRow.cost_center } : null
  )

  // Global branch is the default; care-episode sync overrides it when set.
  useEffect(() => {
    if (isEdit || !userCostCenter) return
    setBranch((prev) => {
      if (prev) return prev
      setBranchQuery((q) => q || userCostCenter)
      setSelectedBranch((s) => s || { name: userCostCenter, label: userCostCenter })
      return userCostCenter
    })
  }, [userCostCenter, isEdit])

  // Load initial patient label
  useEffect(() => {
    if (editRow?.patient_name) {
      setPatientQuery(editRow.patient_name)
      return
    }
    const patientToLoad = editRow?.patient || patient || contextPatient
    if (patientToLoad) {
      fetchPatients(1, 0, patientToLoad).then((res) => {
        if (res.length > 0) setPatientQuery(res[0].patient_name)
      }).catch(() => {})
    }
  }, [patient, contextPatient, editRow])

  // Prefill admission/visit labels when editing
  useEffect(() => {
    if (!isEdit || !editRow) return
    if (editRow.admission_no) {
      setSelectedAdmission({ name: editRow.admission_no, label: editRow.admission_no })
      setAdmissionQuery(editRow.admission_no)
    }
    if (editRow.patient_visit) {
      setSelectedVisit({ name: editRow.patient_visit, label: editRow.patient_visit })
      setVisitQuery(editRow.patient_visit)
    }
  }, [isEdit, editRow])

  // Auto-load admission/visit label if context exists
  useEffect(() => {
    if (isEdit) return
    if (isIPMode && activeAdmission && patientId) {
      const loadAdmissionLabel = async () => {
        try {
          const admissions = await fetchInpatientAdmissions(patientId, activeAdmission)
          const matched = admissions.find(a => a.name === activeAdmission)
          if (matched) {
            setSelectedAdmission(matched)
            setAdmissionQuery(matched.label)
          }
        } catch (err) {
          console.error('Failed to load admission label:', err)
        }
      }
      loadAdmissionLabel()
    } else if (isOPMode && activeVisit && patientId) {
      const loadVisitLabel = async () => {
        try {
          const visits = await fetchPatientVisits(patientId, activeVisit)
          const matched = visits.find(v => v.name === activeVisit)
          if (matched) {
            setSelectedVisit(matched)
            setVisitQuery(matched.label)
          }
        } catch (err) {
          console.error('Failed to load visit label:', err)
        }
      }
      loadVisitLabel()
    }
  }, [isEdit, isIPMode, isOPMode, activeAdmission, activeVisit, patientId])

  useEffect(() => {
    if (!patientOpen) return
    let cancelled = false
    const run = async () => {
      setPatientLoading(true)
      try {
        const res = patientQuery.trim() ? await searchPatients(patientQuery, 20) : await fetchPatients(20, 0)
        if (!cancelled) setPatientOptions(res)
      } catch { if (!cancelled) setPatientOptions([]) }
      finally { if (!cancelled) setPatientLoading(false) }
    }
    const t = setTimeout(run, patientQuery.trim() ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [patientQuery, patientOpen])

  // Fetch admissions on open / query change (IP mode or edit with admission)
  useEffect(() => {
    if (!isIPMode && !(isEdit && Boolean(admissionNo))) return
    if (!admissionOpen) return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetchInpatientAdmissions(patientId || undefined, admissionQuery || undefined)
        if (!cancelled) setAdmissionOptions(res)
      } catch { if (!cancelled) setAdmissionOptions([]) }
    }
    const t = setTimeout(run, admissionQuery.trim() ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [admissionQuery, admissionOpen, patientId, isIPMode, isEdit, admissionNo])

  // Fetch visits on open / query change (OP mode or edit with visit)
  useEffect(() => {
    if (!isOPMode && !(isEdit && Boolean(patientVisitNo))) return
    if (!visitOpen) return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetchPatientVisits(patientId || undefined, visitQuery || undefined)
        if (!cancelled) setVisitOptions(res)
      } catch { if (!cancelled) setVisitOptions([]) }
    }
    const t = setTimeout(run, visitQuery.trim() ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [visitQuery, visitOpen, patientId, isOPMode, isEdit, patientVisitNo])

  useEffect(() => {
    if (isEdit) return
    const patientVisit = isOPMode ? patientVisitNo : undefined
    const inpatientRecord = isIPMode ? admissionNo : undefined
    if (!patientVisit && !inpatientRecord) return

    let cancelled = false
    void syncCostCenterFromCareEpisode(isIPMode ? 'IP' : 'OP', {
      patientVisit,
      inpatientRecord,
      visits: visitOptions,
      admissions: admissionOptions,
    }).then((cc) => {
      if (cancelled || !cc) return
      setBranch(cc)
      setBranchQuery(cc)
      setSelectedBranch({ name: cc, label: cc })
    })
    return () => {
      cancelled = true
    }
  }, [isEdit, isIPMode, isOPMode, patientVisitNo, admissionNo, visitOptions, admissionOptions])

  useEffect(() => {
    if (!branchOpen) return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetchCostCenters(undefined, branchQuery || undefined)
        if (!cancelled) setBranchOptions(res)
      } catch {
        if (!cancelled) setBranchOptions([])
      }
    }
    const t = setTimeout(run, branchQuery.trim() ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [branchQuery, branchOpen])

  useEffect(() => {
    if (!doctorOpen) return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetchHealthcarePractitioners(doctorQuery || undefined)
        if (!cancelled) setDoctorOptions(res)
      } catch { if (!cancelled) setDoctorOptions([]) }
    }
    const t = setTimeout(run, doctorQuery.trim() ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [doctorQuery, doctorOpen])

  // Auto-fill current user's linked practitioner
  useEffect(() => {
    if (!linkedPractitionerId) return
    setDoctorId((prev) => prev || linkedPractitionerId)
    setDoctorQuery((q) => q.trim() || linkedPractitionerLabel || linkedPractitionerId)
    setDoctorName((prev) => prev || linkedPractitionerLabel || linkedPractitionerId)
    setSelectedDoctor((prev) =>
      prev || {
        name: linkedPractitionerId,
        label: linkedPractitionerLabel || linkedPractitionerId,
      },
    )
  }, [linkedPractitionerId, linkedPractitionerLabel])

  const closeAllDropdowns = () => {
    setPatientOpen(false)
    setAdmissionOpen(false)
    setVisitOpen(false)
    setDoctorOpen(false)
    setBranchOpen(false)
  }

  // Get mode-specific help text
  const getModeHelpText = () => {
    if (isEdit) {
      return `Editing sick leave${editRow?.name ? `: ${editRow.name}` : ''}`
    }
    if (isIPMode) {
      return `Creating sick leave for IP${admissionNo ? `: ${admissionNo}` : ' (admission optional)'}`
    }
    if (isOPMode) {
      return `Creating sick leave for OP${patientVisitNo ? `: ${patientVisitNo}` : ' (visit optional)'}`
    }
    return 'Select a patient to create sick leave'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fromDate) { setError('From Date is required'); return }
    if (!patientId) { setError('Patient is required'); return }

    setSaving(true)
    setError(null)
    try {
      const payload: CreateSickLeaveInput = {
        from_date: fromDate,
        to_date: toDate || undefined,
        days: days || undefined,
        diagnosis: diagnosis || undefined,
        doctor: doctorId || undefined,
        doctor_name: doctorName || selectedDoctor?.label || undefined,
        cost_center: branch || undefined,
        admission_no: admissionNo || undefined,
        patient: patientId || undefined,
        patient_name: patientName || patientQuery || undefined,
        patient_visit: patientVisitNo || undefined,
        sr_no: srNo || undefined,
        // Flag fields stored as Check (0/1) on Patient Sick Leave
        sick_flag: sickFlag ? 1 : 0,
        fit_flag: fitFlag ? 1 : 0,
        unfit_flag: unfitFlag ? 1 : 0,
        light_duty: lightDuty ? 1 : 0,
        needs_flag: needsFlag ? 1 : 0,
        acc_patient: accPatient ? 1 : 0,
      }
      const result = isEdit && editRow?.name
        ? await updateSickLeave({ ...payload, name: editRow.name })
        : await createSickLeave(payload)
      if (result.success) {
        onSuccess()
      } else {
        setError(result.message || (isEdit ? 'Failed to update sick leave' : 'Failed to create sick leave'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : (isEdit ? 'Failed to update sick leave' : 'Failed to create sick leave'))
    } finally {
      setSaving(false)
    }
  }

  // Reusable link-field dropdown block
  const LinkField = ({
    label,
    required,
    isOpen,
    query,
    selectedLabel,
    options,
    loading: fieldLoading,
    onFocus,
    onChange,
    onSelect,
    onClear,
    placeholder,
    disabled,
    locked,
  }: {
    label: string
    required?: boolean
    isOpen: boolean
    query: string
    selectedLabel: string | null | undefined
    options: LinkFieldOption[]
    loading?: boolean
    onFocus: () => void
    onChange: (v: string) => void
    onSelect: (o: LinkFieldOption) => void
    onClear?: () => void
    placeholder: string
    disabled?: boolean
    locked?: boolean
  }) => {
    const showClear = Boolean(!disabled && !locked && onClear && (selectedLabel || query))
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        <div className="relative">
          <input
            type="text"
            value={isOpen ? query : (selectedLabel ?? query)}
            readOnly={locked}
            onChange={(e) => {
              if (locked) return
              onChange(e.target.value)
              if (e.target.value) onFocus()
            }}
            onFocus={() => {
              if (!locked) onFocus()
            }}
            placeholder={placeholder}
            disabled={disabled}
            title={locked ? 'Locked to your linked practitioner' : undefined}
            className={
              locked
                ? LOCKED_PRACTITIONER_INPUT_CLASS
                : `w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${showClear ? 'pr-8' : ''} ${disabled ? 'bg-slate-100 cursor-not-allowed' : ''}`
            }
          />
          {showClear ? (
            <button
              type="button"
              onClick={() => { onClear?.(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
              title={`Clear ${label}`}
              aria-label={`Clear ${label}`}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : fieldLoading && !locked ? (
            <span className="absolute right-3 top-2.5 text-xs text-slate-400">Loading…</span>
          ) : null}
          {isOpen && !disabled && !locked && options.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
              {options.map((o) => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => onSelect(o)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-2xl w-full max-h-[90vh] overflow-hidden')}>
        {/* Header */}
        <div className="relative shrink-0 border-b border-emerald-100/60 bg-gradient-to-r from-emerald-100 via-teal-50 to-sky-100 p-4 sm:px-5 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-emerald-950">
                {isEdit ? 'Edit Sick Leave' : 'New Sick Leave'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {!isEdit && isIPMode && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium mr-2">IP Mode Active</span>}
                {!isEdit && isOPMode && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium mr-2">OP Mode Active</span>}
                {getModeHelpText()}
              </p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 text-emerald-800/70 transition hover:bg-emerald-200/50 hover:text-emerald-950">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — min-height 500px so the form never feels cramped */}
        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-5 overflow-y-auto flex-1"
          style={{ minHeight: '500px' }}
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.tagName !== 'INPUT' && !target.closest('.absolute')) closeAllDropdowns()
          }}
        >
          {/* Mode indicator box */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-xs font-semibold text-primary mb-1">
              {isEdit
                ? '✏️ Editing Sick Leave'
                : isIPMode
                  ? '🏥 Creating Sick Leave for Inpatient'
                  : isOPMode
                    ? '👤 Creating Sick Leave for Outpatient'
                    : '📋 Select Context'}
            </p>
            <p className="text-xs text-slate-600">
              {isEdit
                ? 'Update the leave period, doctor, diagnosis, or flags, then save.'
                : isIPMode 
                ? `Admission can be linked if available; it is optional.`
                : isOPMode
                ? `Patient visit is optional — you can save without selecting a visit.`
                : 'Select a patient (and optionally set IP/OP context) to create a sick leave.'
              }
            </p>
          </div>

          {/* Patient & Admission */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Patient & Admission</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Patient */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Patient <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={patientQuery}
                    onChange={(e) => { setPatientQuery(e.target.value); setPatientOpen(true) }}
                    onFocus={() => setPatientOpen(true)}
                    placeholder="Search patient…"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={Boolean(contextPatient) || isEdit}
                  />
                  {(contextPatient || isEdit) && (
                    <p className="text-xs text-slate-400 mt-1 absolute -bottom-5 left-0">
                      {isEdit ? 'Patient cannot be changed when editing' : 'Patient auto-selected from context'}
                    </p>
                  )}
                  {patientLoading && <span className="absolute right-3 top-2.5 text-xs text-slate-400">Loading…</span>}
                  {patientOpen && !contextPatient && !isEdit && patientOptions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
                      {patientOptions.map((p) => (
                        <button key={p.name} type="button"
                          onClick={() => { setPatientId(p.name); setPatientQuery(p.patient_name); setPatientName(p.patient_name); setPatientOpen(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100">
                          <div className="font-medium">{p.patient_name}</div>
                          {p.mobile && <div className="text-xs text-slate-500">{p.mobile}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Admission No (IP mode) — side-by-side with Patient */}
              {(isIPMode || (isEdit && Boolean(admissionNo))) && (
                <div>
                  <LinkField
                    label="Admission No"
                    isOpen={admissionOpen}
                    query={admissionQuery}
                    selectedLabel={selectedAdmission?.label}
                    options={admissionOptions}
                    onFocus={() => setAdmissionOpen(true)}
                    onChange={(v) => { setAdmissionQuery(v); if (!v) { setAdmissionNo(''); setSelectedAdmission(null) } }}
                    onSelect={(a) => { setAdmissionNo(a.name); setSelectedAdmission(a); setAdmissionQuery(a.label); setAdmissionOpen(false) }}
                    onClear={() => { setAdmissionNo(''); setSelectedAdmission(null); setAdmissionQuery(''); setAdmissionOpen(false) }}
                    placeholder="Search admission (optional)…"
                    disabled={!isEdit && !!activeAdmission}
                  />
                  {!isEdit && activeAdmission && (
                    <p className="text-xs text-slate-400 mt-1">Auto-selected from IP context</p>
                  )}
                </div>
              )}

              {/* Patient Visit (OP mode) — side-by-side with Patient */}
              {(isOPMode || (isEdit && Boolean(patientVisitNo))) && (
                <div>
                  <LinkField
                    label="Patient Visit"
                    isOpen={visitOpen}
                    query={visitQuery}
                    selectedLabel={selectedVisit?.label}
                    options={visitOptions}
                    onFocus={() => setVisitOpen(true)}
                    onChange={(v) => { setVisitQuery(v); if (!v) { setPatientVisitNo(''); setSelectedVisit(null) } }}
                    onSelect={(v) => { setPatientVisitNo(v.name); setSelectedVisit(v); setVisitQuery(v.label); setVisitOpen(false) }}
                    onClear={() => { setPatientVisitNo(''); setSelectedVisit(null); setVisitQuery(''); setVisitOpen(false) }}
                    placeholder="Search visit (optional)…"
                  />
                  <p className="text-xs text-slate-400 mt-1">Optional — visit is not required to create sick leave</p>
                </div>
              )}
            </div>
          </div>

          {/* Leave Period */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Leave Period</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  From Date <span className="text-red-500">*</span>
                </label>
                <DateFilterInput
                  value={fromDate}
                  onChange={(e) => handleFromDateChange(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">To Date</label>
                <DateFilterInput
                  value={toDate}
                  onChange={(e) => handleToDateChange(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Days</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => handleDaysChange(e.target.value)}
                  placeholder="Enter days or set To Date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Clinical Details */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Clinical Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Doctor */}
              <LinkField
                label="Doctor"
                isOpen={doctorOpen}
                query={doctorQuery}
                selectedLabel={selectedDoctor?.label}
                options={doctorOptions}
                locked={practitionerLocked}
                onFocus={() => setDoctorOpen(true)}
                onChange={(v) => {
                  setDoctorQuery(v)
                  if (!v) {
                    setDoctorId('')
                    setDoctorName('')
                    setSelectedDoctor(null)
                  }
                }}
                onSelect={(d) => {
                  setDoctorId(d.name)
                  setSelectedDoctor(d)
                  setDoctorQuery(d.label)
                  setDoctorName(d.label)
                  setDoctorOpen(false)
                }}
                onClear={() => { setDoctorId(''); setDoctorName(''); setSelectedDoctor(null); setDoctorQuery(''); setDoctorOpen(false) }}
                placeholder="Search doctor…"
              />

              {/* Branch — Cost Center dropdown */}
              <LinkField
                label="Branch"
                isOpen={branchOpen}
                query={branchQuery}
                selectedLabel={selectedBranch?.label}
                options={branchOptions}
                onFocus={() => setBranchOpen(true)}
                onChange={(v) => {
                  setBranchQuery(v)
                  if (!v) {
                    setBranch('')
                    setSelectedBranch(null)
                  }
                }}
                onSelect={(cc) => {
                  setBranch(cc.name)
                  setSelectedBranch(cc)
                  setBranchQuery(cc.label)
                  setBranchOpen(false)
                }}
                onClear={() => {
                  setBranch('')
                  setSelectedBranch(null)
                  setBranchQuery('')
                  setBranchOpen(false)
                }}
                placeholder="Search cost center…"
              />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sr No</label>
                <input
                  type="text"
                  value={srNo}
                  onChange={(e) => setSrNo(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Diagnosis */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Diagnosis</label>
                <textarea
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  rows={4}
                  placeholder="Enter diagnosis details…"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>
          </div>

          {/* Flags */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Flags</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <label className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={sickFlag}
                  onChange={(e) => setSickFlag(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Sick Flag
              </label>
              <label className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={fitFlag}
                  onChange={(e) => setFitFlag(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Fit Flag
              </label>
              <label className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={unfitFlag}
                  onChange={(e) => setUnfitFlag(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Unfit Flag
              </label>
              <label className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={lightDuty}
                  onChange={(e) => setLightDuty(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Light Duty
              </label>
              <label className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={needsFlag}
                  onChange={(e) => setNeedsFlag(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Needs Flag
              </label>
              <label className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={accPatient}
                  onChange={(e) => setAccPatient(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Accompanying Patient
              </label>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={CM_BTN_CANCEL}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !patientId || !fromDate}
              className={CM_BTN_PRIMARY}
            >
              {saving ? 'Saving…' : isEdit ? 'Update Sick Leave' : 'Save Sick Leave'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}