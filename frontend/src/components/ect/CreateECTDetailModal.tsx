import { useEffect, useState } from 'react'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_OVERLAY,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { createECTDetail, fetchECTDetail, getNextECTDetailsTransNum } from '../../services/ectDetails'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'
import { fetchCostCenters, fetchHealthcarePractitioners, fetchLeadSources, getCurrentUserPractitioner, type LinkFieldOption } from '../../services/common'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { localDateInputValue } from '../../utils/formatDate'
import { parseToDatetimeLocalValue } from '../../utils/datetimeLocal'
import { DateFilterInput } from '../ui/DateFilterInput'

interface CreateECTDetailModalProps {
  onClose: () => void
  onSuccess?: () => void
  /** When set, modal loads and updates this record instead of creating. */
  editName?: string
  initialPatient?: string
}

type ECTTab = 'procedure' | 'staff' | 'other'

function toFrappeDateTime(value: string): string {
  if (!value || !value.trim()) return ''
  let s = value.trim()
  if (s.includes('T')) {
    if (s.endsWith('Z')) s = s.slice(0, -1)
    s = s.replace('T', ' ')
  }
  if (s.length > 19) s = s.slice(0, 19)
  if (s.length === 16) s += ':00'
  return s
}

export const CreateECTDetailModal = ({
  onClose,
  onSuccess,
  editName,
  initialPatient,
}: CreateECTDetailModalProps) => {
  const isEdit = Boolean(editName?.trim())
  const { mode, activeAdmission, activeVisit, userCostCenter } = useCareContext()
  const [activeTab, setActiveTab] = useState<ECTTab>('procedure')
  const [formData, setFormData] = useState({
    patient: initialPatient || '',
    cost_center: userCostCenter || '',
    date: localDateInputValue(),
    time: new Date().toTimeString().slice(0, 5),
    source: '',
    duration: '',
    energy: '',
    propofol_detail: '',
    succinycholine_detail: '',
    _age: '',
    success: '',
    reference_doctype: '',
    reference_name: '',
    repeated: '',
    vitals: '',
    ecg: '',
    anathesiologist: '',
    assist_doctor: '',
    psychiatrist: '',
    nurse: '',
    doctors_name: '',
    ect_doctors_notes: '',
    date_and_time: '',
    nurse_name: '',
    ect_nurse_notes: '',
    n_date_and_time: '',
    bp_1: '',
    bp_2: '',
    max_bp_1: '',
    max_bp2: '',
    psychology_doctor: '',
    anaesthetic_doctor: '',
  })
  const [loading, setLoading] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)
  const [error, setError] = useState<string | null>(null)
  const [sourceOptions, setSourceOptions] = useState<LinkFieldOption[]>([])
  const [costCenterOptions, setCostCenterOptions] = useState<LinkFieldOption[]>([])
  const [costCenterLoading, setCostCenterLoading] = useState(false)

  const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientQuery, setPatientQuery] = useState(initialPatient || '')
  const [patientLoading, setPatientLoading] = useState(false)

  // Link-field dropdowns for staff on "Doctor & Nurse" tab
  const [anaesthesiologistOptions, setAnaesthesiologistOptions] = useState<LinkFieldOption[]>([])
  const [anaesthesiologistOpen, setAnaesthesiologistOpen] = useState(false)
  const [anaesthesiologistQuery, setAnaesthesiologistQuery] = useState('')

  const [assistDoctorOptions, setAssistDoctorOptions] = useState<LinkFieldOption[]>([])
  const [assistDoctorOpen, setAssistDoctorOpen] = useState(false)
  const [assistDoctorQuery, setAssistDoctorQuery] = useState('')

  const [psychiatristOptions, setPsychiatristOptions] = useState<LinkFieldOption[]>([])
  const [psychiatristOpen, setPsychiatristOpen] = useState(false)
  const [psychiatristQuery, setPsychiatristQuery] = useState('')

  const [nurseOptions, setNurseOptions] = useState<LinkFieldOption[]>([])
  const [nurseOpen, setNurseOpen] = useState(false)
  const [nurseQuery, setNurseQuery] = useState('')

  const [psychologyPractitioners, setPsychologyPractitioners] = useState<LinkFieldOption[]>([])
  const [psychologyOpen, setPsychologyOpen] = useState(false)
  const [psychologyQuery, setPsychologyQuery] = useState('')
  const [anaestheticPractitioners, setAnaestheticPractitioners] = useState<LinkFieldOption[]>([])
  const [anaestheticOpen, setAnaestheticOpen] = useState(false)
  const [anaestheticQuery, setAnaestheticQuery] = useState('')

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // Nurse name defaults to the logged-in user's linked practitioner.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const practId = await getCurrentUserPractitioner()
      if (cancelled || !practId) return
      let label = practId
      try {
        const opts = await fetchHealthcarePractitioners(practId)
        label = opts.find((o) => o.name === practId)?.label || practId
      } catch { /* keep id as label */ }
      setFormData(prev => (prev.nurse_name ? prev : { ...prev, nurse_name: label }))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchECTDetail(editName.trim())
      .then((doc) => {
        if (cancelled) return
        setFormData((prev) => ({
          ...prev,
          patient: doc.patient || '',
          cost_center: doc.cost_center || prev.cost_center,
          date: doc.date ? String(doc.date).slice(0, 10) : prev.date,
          time: doc.time ? String(doc.time).slice(0, 5) : prev.time,
          source: doc.source || '',
          duration: doc.duration != null ? String(doc.duration) : '',
          energy: doc.energy || '',
          propofol_detail: doc.propofol_detail || '',
          succinycholine_detail: doc.succinycholine_detail || '',
          _age: doc._age != null ? String(doc._age) : '',
          success: doc.success || '',
          reference_doctype: doc.reference_doctype || '',
          reference_name: doc.reference_name || '',
          repeated: doc.repeated || '',
          vitals: doc.vitals || '',
          ecg: doc.ecg || '',
          anathesiologist: doc.anathesiologist || '',
          assist_doctor: doc.assist_doctor || '',
          psychiatrist: doc.psychiatrist || '',
          nurse: doc.nurse || '',
          doctors_name: doc.doctors_name || '',
          ect_doctors_notes: doc.ect_doctors_notes || '',
          date_and_time: doc.date_and_time ? parseToDatetimeLocalValue(String(doc.date_and_time)) : '',
          nurse_name: doc.nurse_name || '',
          ect_nurse_notes: doc.ect_nurse_notes || '',
          n_date_and_time: doc.n_date_and_time ? parseToDatetimeLocalValue(String(doc.n_date_and_time)) : '',
          bp_1: doc.bp_1 || '',
          bp_2: doc.bp_2 || '',
          max_bp_1: doc.max_bp_1 || '',
          max_bp2: doc.max_bp2 || '',
          psychology_doctor: doc.psychology_doctor || '',
          anaesthetic_doctor: doc.anaesthetic_doctor || '',
        }))
        setPatientQuery(doc.patient || '')
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ECT detail')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEdit(false)
      })
    return () => {
      cancelled = true
    }
  }, [editName])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.patient) {
      setError('Patient is required')
      setActiveTab('procedure')
      return
    }

    if (!formData.cost_center) {
      setError('Branch is required')
      setActiveTab('procedure')
      return
    }

    try {
      setLoading(true)
      setError(null)

      const timePart = formData.time ? `${formData.time}:00`.slice(0, 8) : undefined
      const detailPayload = {
        patient: formData.patient,
        cost_center: formData.cost_center || undefined,
        date: formData.date || undefined,
        time: timePart,
        source: formData.source || undefined,
        duration: formData.duration ? Number(formData.duration) : undefined,
        energy: formData.energy || undefined,
        _age: formData._age ? Number(formData._age) : undefined,
        success: formData.success || undefined,
        reference_doctype: formData.reference_doctype || undefined,
        reference_name: formData.reference_name || undefined,
        repeated: formData.repeated || undefined,
        vitals: formData.vitals || undefined,
        ecg: formData.ecg || undefined,
        anathesiologist: formData.anathesiologist || undefined,
        assist_doctor: formData.assist_doctor || undefined,
        psychiatrist: formData.psychiatrist || undefined,
        nurse: formData.nurse || undefined,
        doctors_name: formData.doctors_name || undefined,
        ect_doctors_notes: formData.ect_doctors_notes || undefined,
        date_and_time: toFrappeDateTime(formData.date_and_time) || undefined,
        nurse_name: formData.nurse_name || undefined,
        ect_nurse_notes: formData.ect_nurse_notes || undefined,
        n_date_and_time: toFrappeDateTime(formData.n_date_and_time) || undefined,
        bp_1: formData.bp_1 || undefined,
        bp_2: formData.bp_2 || undefined,
        max_bp_1: formData.max_bp_1 || undefined,
        max_bp2: formData.max_bp2 || undefined,
        propofol_detail: formData.propofol_detail || undefined,
        succinycholine_detail: formData.succinycholine_detail || undefined,
        psychology_doctor: formData.psychology_doctor || undefined,
        anaesthetic_doctor: formData.anaesthetic_doctor || undefined,
      }

      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('ECT Details', editName.trim(), detailPayload)
        toast.success('ECT Detail updated successfully')
      } else {
        const transNum = await getNextECTDetailsTransNum()
        await createECTDetail({ trans_num: transNum, ...detailPayload })
        toast.success('ECT Detail created successfully')
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create ECT detail'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLeadSources()
      .then(setSourceOptions)
      .catch(() => setSourceOptions([]))
  }, [])

  useEffect(() => {
    const loadCostCenters = async () => {
      try {
        setCostCenterLoading(true)
        const options = await fetchCostCenters()
        setCostCenterOptions(options)
      } catch {
        setCostCenterOptions([])
      } finally {
        setCostCenterLoading(false)
      }
    }
    void loadCostCenters()
  }, [])

  useEffect(() => {
    if (userCostCenter && !formData.cost_center) {
      setFormData((prev) => ({ ...prev, cost_center: userCostCenter }))
    }
  }, [userCostCenter, formData.cost_center])

  useEffect(() => {
    if (initialPatient) {
      const load = async () => {
        try {
          const patients = await fetchPatients(1, 0, initialPatient)
          if (patients.length > 0) {
            setPatientQuery(patients[0].patient_name)
          }
        } catch (err) {
          console.error('Failed to load initial patient for ECT:', err)
        }
      }
      load()
    }
  }, [initialPatient])

  // Auto-link admission or visit from care context (avoids invalid dynamic-link errors).
  useEffect(() => {
    if (isEdit) return
    if (mode === 'IP' && activeAdmission) {
      setFormData((prev) => ({
        ...prev,
        reference_doctype: 'Inpatient Admission',
        reference_name: activeAdmission,
      }))
      void (async () => {
        try {
          const response = await fetch(
            `/api/resource/Inpatient%20Admission/${encodeURIComponent(activeAdmission)}?fields=${encodeURIComponent(JSON.stringify(['cost_center']))}`,
          )
          const resData = await response.json()
          const cc = resData?.data?.cost_center
          if (cc) {
            setFormData((prev) => ({ ...prev, cost_center: cc }))
          }
        } catch {
          // keep user/default branch
        }
      })()
    } else if (mode === 'OP' && activeVisit) {
      setFormData((prev) => ({
        ...prev,
        reference_doctype: 'Patient Visit',
        reference_name: activeVisit,
      }))
      void (async () => {
        try {
          const response = await fetch(
            `/api/resource/Patient%20Visit/${encodeURIComponent(activeVisit)}?fields=${encodeURIComponent(JSON.stringify(['cost_center']))}`,
          )
          const resData = await response.json()
          const cc = resData?.data?.cost_center
          if (cc) {
            setFormData((prev) => ({ ...prev, cost_center: cc }))
          }
        } catch {
          // keep user/default branch
        }
      })()
    }
  }, [mode, activeAdmission, activeVisit, isEdit])

  // Auto-populate practitioner fields if current user is a healthcare practitioner
  useEffect(() => {
    const autoPopulatePractitioners = async () => {
      try {
        const practitioner = await getCurrentUserPractitioner()
        if (!practitioner) return

        const matches = await fetchHealthcarePractitioners(practitioner)
        const label = matches.find((row) => row.name === practitioner)?.label || practitioner

        setFormData((prev) => ({
          ...prev,
          anathesiologist: label,
          assist_doctor: label,
          psychiatrist: label,
          nurse: label,
          psychology_doctor: practitioner,
          anaesthetic_doctor: practitioner,
        }))
      } catch (err) {
        console.error('Failed to auto-populate ECT practitioners:', err)
      }
    }

    void autoPopulatePractitioners()
  }, [])

  useEffect(() => {
    if (!patientOpen) return
    const t = setTimeout(async () => {
      try {
        setPatientLoading(true)
        let results: PatientListItem[] = []
        if (patientQuery.trim() === '') {
          results = await fetchPatients(20, 0)
        } else {
          results = await searchPatients(patientQuery, 20)
        }
        setPatientOptions(results)
      } catch (err) {
        console.error('Failed to search patients for ECT:', err)
        setPatientOptions([])
      } finally {
        setPatientLoading(false)
      }
    }, patientQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [patientQuery, patientOpen])

  // Anaesthesiologist (link to Healthcare Practitioner)
  useEffect(() => {
    if (!anaesthesiologistOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(anaesthesiologistQuery || undefined)
        setAnaesthesiologistOptions(results)
      } catch {
        setAnaesthesiologistOptions([])
      }
    }, anaesthesiologistQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [anaesthesiologistQuery, anaesthesiologistOpen])

  // Assist Doctor
  useEffect(() => {
    if (!assistDoctorOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(assistDoctorQuery || undefined)
        setAssistDoctorOptions(results)
      } catch {
        setAssistDoctorOptions([])
      }
    }, assistDoctorQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [assistDoctorQuery, assistDoctorOpen])

  // Psychiatrist
  useEffect(() => {
    if (!psychiatristOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(psychiatristQuery || undefined)
        setPsychiatristOptions(results)
      } catch {
        setPsychiatristOptions([])
      }
    }, psychiatristQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [psychiatristQuery, psychiatristOpen])

  // Nurse
  useEffect(() => {
    if (!nurseOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(nurseQuery || undefined)
        setNurseOptions(results)
      } catch {
        setNurseOptions([])
      }
    }, nurseQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [nurseQuery, nurseOpen])

  useEffect(() => {
    if (!psychologyOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(psychologyQuery || undefined)
        setPsychologyPractitioners(results)
      } catch (err) {
        setPsychologyPractitioners([])
      }
    }, psychologyQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [psychologyQuery, psychologyOpen])

  useEffect(() => {
    if (!anaestheticOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(anaestheticQuery || undefined)
        setAnaestheticPractitioners(results)
      } catch (err) {
        setAnaestheticPractitioners([])
      }
    }, anaestheticQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [anaestheticQuery, anaestheticOpen])

  useEffect(() => {
    fetchHealthcarePractitioners().then(setPsychologyPractitioners).catch(() => {})
    fetchHealthcarePractitioners().then(setAnaestheticPractitioners).catch(() => {})
  }, [])

  const handlePatientSelect = (p: PatientListItem) => {
    setFormData(prev => ({ ...prev, patient: p.name }))
    setPatientQuery(p.patient_name)
    setPatientOpen(false)
  }

  const tabs: { id: ECTTab; label: string }[] = [
    { id: 'procedure', label: 'Procedure' },
    { id: 'staff', label: 'Doctor & Nurse' },
    { id: 'other', label: 'Other' },
  ]

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-2xl w-full max-h-[90vh] overflow-hidden')}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold tracking-tight text-emerald-950">
            {isEdit ? 'Edit ECT Detail' : 'Create ECT Detail'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-emerald-800/70 transition hover:bg-emerald-200/50 hover:text-emerald-950"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-4 flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-primary text-primary bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">
          {error && (
            <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 flex-shrink-0">
              {error}
            </div>
          )}

          <div className="p-4 overflow-y-auto flex-1 min-h-0">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading ECT detail…</div>
            ) : (
            <>
            {/* Tab 1: Procedure */}
            {activeTab === 'procedure' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Patient <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={patientQuery}
                      onChange={(e) => {
                        setPatientQuery(e.target.value)
                        setPatientOpen(true)
                      }}
                      onFocus={() => setPatientOpen(true)}
                      placeholder="Search patient..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {patientLoading && (
                      <div className="absolute right-3 top-2.5 text-slate-400 text-xs">Loading...</div>
                    )}
                    {patientOpen && patientOptions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {patientOptions.map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => handlePatientSelect(p)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
                          >
                            <div className="font-medium">{p.patient_name}</div>
                            {p.mobile && <div className="text-xs text-slate-500">{p.mobile}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.cost_center}
                    onChange={(e) => handleChange('cost_center', e.target.value)}
                    disabled={costCenterLoading}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:opacity-50"
                  >
                    <option value="">Select branch</option>
                    {costCenterOptions.map((cc) => (
                      <option key={cc.name} value={cc.name}>
                        {cc.label || cc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                    <DateFilterInput
                      value={formData.date}
                      onChange={(e) => handleChange('date', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Time</label>
                    <input
                      type="time"
                      value={formData.time}
                      onChange={(e) => handleChange('time', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Source</label>
                  <select
                    value={formData.source}
                    onChange={(e) => handleChange('source', e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  >
                    <option value="">Select source</option>
                    {sourceOptions.map((opt) => (
                      <option key={opt.name} value={opt.name}>
                        {opt.label || opt.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Duration</label>
                    <input
                      type="text"
                      value={formData.duration}
                      onChange={(e) => handleChange('duration', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="e.g. minutes"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Energy</label>
                    <input
                      type="text"
                      value={formData.energy}
                      onChange={(e) => handleChange('energy', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="e.g. 50%"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Propofol Detail</label>
                    <input
                      type="text"
                      value={formData.propofol_detail}
                      onChange={(e) => handleChange('propofol_detail', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Propofol details"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Succinylcholine Detail</label>
                    <input
                      type="text"
                      value={formData.succinycholine_detail}
                      onChange={(e) => handleChange('succinycholine_detail', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Succinylcholine details"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">% Age</label>
                    <input
                      type="text"
                      value={formData._age}
                      onChange={(e) => handleChange('_age', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Percent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Success</label>
                    <input
                      type="text"
                      value={formData.success}
                      onChange={(e) => handleChange('success', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="e.g. Yes / No"
                    />
                  </div>
                </div>

                {(formData.reference_doctype && formData.reference_name) ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="text-xs font-medium text-slate-500">Linked to </span>
                    <span className="font-medium">{formData.reference_doctype}</span>
                    <span className="text-slate-500"> · </span>
                    <span>{formData.reference_name}</span>
                  </div>
                ) : null}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Repeated</label>
                  <input
                    type="text"
                    value={formData.repeated}
                    onChange={(e) => handleChange('repeated', e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Vitals</label>
                    <input
                      type="text"
                      value={formData.vitals}
                      onChange={(e) => handleChange('vitals', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">ECG</label>
                    <input
                      type="text"
                      value={formData.ecg}
                      onChange={(e) => handleChange('ecg', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Doctor & Nurse */}
            {activeTab === 'staff' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Anathesiologist</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={
                          anaesthesiologistOpen
                            ? anaesthesiologistQuery
                            : (anaesthesiologistOptions.find(p => p.name === formData.anathesiologist)?.label ||
                              formData.anathesiologist ||
                              '')
                        }
                        onChange={(e) => {
                          setAnaesthesiologistQuery(e.target.value)
                          if (!e.target.value) handleChange('anathesiologist', '')
                          setAnaesthesiologistOpen(true)
                        }}
                        onFocus={() => {
                          setAnaesthesiologistOpen(true)
                          if (!anaesthesiologistQuery && formData.anathesiologist) {
                            const label = anaesthesiologistOptions.find(p => p.name === formData.anathesiologist)?.label
                            if (label) setAnaesthesiologistQuery(label)
                          }
                        }}
                        placeholder="Search doctor..."
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {anaesthesiologistOpen && anaesthesiologistOptions.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {anaesthesiologistOptions.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              onClick={() => {
                                handleChange('anathesiologist', p.name)
                                setAnaesthesiologistQuery(p.label)
                                setAnaesthesiologistOpen(false)
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                            >
                              <div>
                                <div className="font-medium">{p.label}</div>
                                <div className="text-xs text-slate-500">{p.name}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Assist Doctor</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={
                          assistDoctorOpen
                            ? assistDoctorQuery
                            : (assistDoctorOptions.find(p => p.name === formData.assist_doctor)?.label ||
                              formData.assist_doctor ||
                              '')
                        }
                        onChange={(e) => {
                          setAssistDoctorQuery(e.target.value)
                          if (!e.target.value) handleChange('assist_doctor', '')
                          setAssistDoctorOpen(true)
                        }}
                        onFocus={() => {
                          setAssistDoctorOpen(true)
                          if (!assistDoctorQuery && formData.assist_doctor) {
                            const label = assistDoctorOptions.find(p => p.name === formData.assist_doctor)?.label
                            if (label) setAssistDoctorQuery(label)
                          }
                        }}
                        placeholder="Search doctor..."
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {assistDoctorOpen && assistDoctorOptions.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {assistDoctorOptions.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              onClick={() => {
                                handleChange('assist_doctor', p.name)
                                setAssistDoctorQuery(p.label)
                                setAssistDoctorOpen(false)
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                            >
                              <div>
                                <div className="font-medium">{p.label}</div>
                                <div className="text-xs text-slate-500">{p.name}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Psychiatrist</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={
                          psychiatristOpen
                            ? psychiatristQuery
                            : (psychiatristOptions.find(p => p.name === formData.psychiatrist)?.label ||
                              formData.psychiatrist ||
                              '')
                        }
                        onChange={(e) => {
                          setPsychiatristQuery(e.target.value)
                          if (!e.target.value) handleChange('psychiatrist', '')
                          setPsychiatristOpen(true)
                        }}
                        onFocus={() => {
                          setPsychiatristOpen(true)
                          if (!psychiatristQuery && formData.psychiatrist) {
                            const label = psychiatristOptions.find(p => p.name === formData.psychiatrist)?.label
                            if (label) setPsychiatristQuery(label)
                          }
                        }}
                        placeholder="Search doctor..."
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {psychiatristOpen && psychiatristOptions.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {psychiatristOptions.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              onClick={() => {
                                handleChange('psychiatrist', p.name)
                                setPsychiatristQuery(p.label)
                                setPsychiatristOpen(false)
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                            >
                              <div>
                                <div className="font-medium">{p.label}</div>
                                <div className="text-xs text-slate-500">{p.name}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nurse</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={
                          nurseOpen
                            ? nurseQuery
                            : (nurseOptions.find(p => p.name === formData.nurse)?.label ||
                              formData.nurse ||
                              '')
                        }
                        onChange={(e) => {
                          setNurseQuery(e.target.value)
                          if (!e.target.value) handleChange('nurse', '')
                          setNurseOpen(true)
                        }}
                        onFocus={() => {
                          setNurseOpen(true)
                          if (!nurseQuery && formData.nurse) {
                            const label = nurseOptions.find(p => p.name === formData.nurse)?.label
                            if (label) setNurseQuery(label)
                          }
                        }}
                        placeholder="Search doctor..."
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {nurseOpen && nurseOptions.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {nurseOptions.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              onClick={() => {
                                handleChange('nurse', p.name)
                                setNurseQuery(p.label)
                                setNurseOpen(false)
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                            >
                              <div>
                                <div className="font-medium">{p.label}</div>
                                <div className="text-xs text-slate-500">{p.name}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Doctor&apos;s Name</label>
                  <input
                    type="text"
                    value={formData.doctors_name}
                    onChange={(e) => handleChange('doctors_name', e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ECT Doctor&apos;s Notes</label>
                  <textarea
                    value={formData.ect_doctors_notes}
                    onChange={(e) => handleChange('ect_doctors_notes', e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date and Time (Doctor)</label>
                  <input
                    type="datetime-local"
                    value={formData.date_and_time ? (formData.date_and_time.replace(' ', 'T').slice(0, 16)) : ''}
                    onChange={(e) => handleChange('date_and_time', e.target.value || '')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nurse Name</label>
                  <input
                    type="text"
                    value={formData.nurse_name}
                    onChange={(e) => handleChange('nurse_name', e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ECT Nurse Notes</label>
                  <textarea
                    value={formData.ect_nurse_notes}
                    onChange={(e) => handleChange('ect_nurse_notes', e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date and Time (Nurse)</label>
                  <input
                    type="datetime-local"
                    value={formData.n_date_and_time ? (formData.n_date_and_time.replace(' ', 'T').slice(0, 16)) : ''}
                    onChange={(e) => handleChange('n_date_and_time', e.target.value || '')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Tab 3: Other */}
            {activeTab === 'other' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">BP 1</label>
                    <input
                      type="text"
                      value={formData.bp_1}
                      onChange={(e) => handleChange('bp_1', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="e.g. systolic"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">BP 2</label>
                    <input
                      type="text"
                      value={formData.bp_2}
                      onChange={(e) => handleChange('bp_2', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="e.g. diastolic"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Max BP 1</label>
                    <input
                      type="text"
                      value={formData.max_bp_1}
                      onChange={(e) => handleChange('max_bp_1', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Max systolic before"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Max BP 2</label>
                    <input
                      type="text"
                      value={formData.max_bp2}
                      onChange={(e) => handleChange('max_bp_2', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Max diastolic after"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Psychology Doctor</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={psychologyOpen ? psychologyQuery : (psychologyPractitioners.find(p => p.name === formData.psychology_doctor)?.label || formData.psychology_doctor || '')}
                      onChange={(e) => {
                        setPsychologyQuery(e.target.value)
                        if (!e.target.value) handleChange('psychology_doctor', '')
                        setPsychologyOpen(true)
                      }}
                      onFocus={() => {
                        setPsychologyOpen(true)
                        if (!psychologyQuery && formData.psychology_doctor) {
                          const label = psychologyPractitioners.find(p => p.name === formData.psychology_doctor)?.label
                          if (label) setPsychologyQuery(label)
                        }
                      }}
                      placeholder="Search doctor..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {psychologyOpen && psychologyPractitioners.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {psychologyPractitioners.map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => {
                              handleChange('psychology_doctor', p.name)
                              setPsychologyQuery(p.label)
                              setPsychologyOpen(false)
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                          >
                            <div>
                              <div className="font-medium">{p.label}</div>
                              <div className="text-xs text-slate-500">{p.name}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Anaesthetic Doctor</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={anaestheticOpen ? anaestheticQuery : (anaestheticPractitioners.find(p => p.name === formData.anaesthetic_doctor)?.label || formData.anaesthetic_doctor || '')}
                      onChange={(e) => {
                        setAnaestheticQuery(e.target.value)
                        if (!e.target.value) handleChange('anaesthetic_doctor', '')
                        setAnaestheticOpen(true)
                      }}
                      onFocus={() => {
                        setAnaestheticOpen(true)
                        if (!anaestheticQuery && formData.anaesthetic_doctor) {
                          const label = anaestheticPractitioners.find(p => p.name === formData.anaesthetic_doctor)?.label
                          if (label) setAnaestheticQuery(label)
                        }
                      }}
                      placeholder="Search doctor..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {anaestheticOpen && anaestheticPractitioners.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {anaestheticPractitioners.map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => {
                              handleChange('anaesthetic_doctor', p.name)
                              setAnaestheticQuery(p.label)
                              setAnaestheticOpen(false)
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                          >
                            <div>
                              <div className="font-medium">{p.label}</div>
                              <div className="text-xs text-slate-500">{p.name}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            </>
            )}
          </div>

          <div className="p-4 border-t border-slate-200 flex justify-end gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className={CM_BTN_CANCEL}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || loadingEdit}
              className={CM_BTN_PRIMARY}
            >
              {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
