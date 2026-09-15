import { useEffect, useState, useCallback, memo } from 'react'
import {
  CREATE_MODAL_OVERLAY,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { createECTProcedure } from '../../services/ectProcedure'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { fetchDoc } from '../../services/common'
import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'
import { fetchHealthcarePractitioners, fetchAnaesthesiaTypes, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import {
  LOCKED_PRACTITIONER_INPUT_CLASS,
  useLockedLinkedPractitioner,
} from '../../hooks/useLockedLinkedPractitioner'
import { DateFilterInput } from '../ui/DateFilterInput'

interface CreateECTProcedureModalProps {
  onClose: () => void
  onSuccess?: () => void
  /** When set, modal loads and updates this record instead of creating. */
  editName?: string
  initialPatient?: string
}

// Memoized FormField to prevent unnecessary re-renders
const FormField = memo(({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm font-semibold text-slate-700 mb-2">
      {label}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
    {children}
  </div>
))
FormField.displayName = 'FormField'

// Memoized InputField - pure component
const INPUT_FIELD_CLASS =
  'w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed'

const InputField = memo(({ value, onChange, type = "text", placeholder = "", disabled = false }: { value: string; onChange: (e: { target: { value: string } }) => void; type?: string; placeholder?: string; disabled?: boolean }) => (
  type === 'date' ? (
    <DateFilterInput
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder || 'DD/MM/YYYY'}
      className={INPUT_FIELD_CLASS}
    />
  ) : (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={INPUT_FIELD_CLASS}
    />
  )
))
InputField.displayName = 'InputField'

// Memoized ComboboxField
const ComboboxField = memo(({ query, onQueryChange, onFocus, isOpen, isLoading, options, onSelect, placeholder = "", locked = false }: any) => (
  <div className="relative">
    <input
      type="text"
      value={query}
      readOnly={locked}
      onChange={(e) => {
        if (locked) return
        onQueryChange(e.target.value)
        onFocus()
      }}
      onFocus={() => {
        if (!locked) onFocus()
      }}
      placeholder={placeholder}
      title={locked ? 'Locked to your linked practitioner' : undefined}
      className={
        locked
          ? LOCKED_PRACTITIONER_INPUT_CLASS
          : 'w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all'
      }
    />
    {isLoading && !locked && (
      <div className="absolute right-3 top-2.5 text-slate-400 text-xs">Loading...</div>
    )}
    {isOpen && !locked && options.length > 0 && (
      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
        {options.map((option: any) => (
          <button
            key={option.name}
            type="button"
            onClick={() => onSelect(option)}
            className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none transition-colors border-b border-slate-100 last:border-b-0"
          >
            <div className="font-medium text-slate-900">{option.label || option.patient_name}</div>
            {(option.department || option.mobile) && (
              <div className="text-xs text-slate-500">{option.department || option.mobile}</div>
            )}
          </button>
        ))}
      </div>
    )}
  </div>
))
ComboboxField.displayName = 'ComboboxField'

export const CreateECTProcedureModal = ({
  onClose,
  onSuccess,
  editName,
  initialPatient,
}: CreateECTProcedureModalProps) => {
  const isEdit = Boolean(editName?.trim())
  const now = new Date()
  const [formData, setFormData] = useState({
    patient: initialPatient || '',
    patient_name: '',
    date: now.toISOString().slice(0, 10),
    npo_since: '',
    consultant_doctor: '',
    assistant_doctor: '',
    anaesthetist: '',
    type_of_anaesthesia: '',
    date_of_session: '',
    no_of_session: '',
    bp: '',
    hr: '',
    temp: '',
    resp_rate: '',
    spo2: '',
    energy: '',
    gtcs_for: '',
    bp_after: '',
    hr_after: '',
    resp_rate_after: '',
    spo2_after: '',
    progress_plan: '',
    other_complications: '',
    sign_date: '',
    consultant_sign_date: '',
  })
  const [loading, setLoading] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)
  const [error, setError] = useState<string | null>(null)

  const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientQuery, setPatientQuery] = useState(initialPatient || '')
  const [patientLoading, setPatientLoading] = useState(false)

  const [consultantOptions, setConsultantOptions] = useState<LinkFieldOption[]>([])
  const [assistantOptions, setAssistantOptions] = useState<LinkFieldOption[]>([])
  const [anaesthetistOptions, setAnaesthetistOptions] = useState<LinkFieldOption[]>([])
  const [anaesthesiaOptions, setAnaesthesiaOptions] = useState<LinkFieldOption[]>([])

  const [consultantOpen, setConsultantOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [anaesthetistOpen, setAnaesthetistOpen] = useState(false)
  const [anaesthesiaOpen, setAnaesthesiaOpen] = useState(false)

  const [consultantQuery, setConsultantQuery] = useState('')
  const [assistantQuery, setAssistantQuery] = useState('')
  const [anaesthetistQuery, setAnaesthetistQuery] = useState('')
  const [anaesthesiaQuery, setAnaesthesiaQuery] = useState('')
  const {
    locked: practitionerLocked,
    practitionerId: linkedPractitionerId,
    practitionerLabel: linkedPractitionerLabel,
  } = useLockedLinkedPractitioner()

  // Memoized change handler
  const handleChange = useCallback((field: string, value: string) => {
    setFormData(prev => {
      // Only update if value actually changed
      if (prev[field as keyof typeof prev] === value) {
        return prev
      }
      return { ...prev, [field]: value }
    })
  }, [])

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('ECT Procedure', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setFormData({
          patient: String(doc.patient || ''),
          patient_name: String(doc.patient_name || ''),
          date: doc.date ? String(doc.date).slice(0, 10) : now.toISOString().slice(0, 10),
          npo_since: doc.npo_since ? String(doc.npo_since).slice(0, 10) : '',
          consultant_doctor: String(doc.consultant_doctor || ''),
          assistant_doctor: String(doc.assistant_doctor || ''),
          anaesthetist: String(doc.anaesthetist || ''),
          type_of_anaesthesia: String(doc.type_of_anaesthesia || ''),
          date_of_session: doc.date_of_session ? String(doc.date_of_session).slice(0, 10) : '',
          no_of_session: doc.no_of_session != null ? String(doc.no_of_session) : '',
          bp: String(doc.bp || ''),
          hr: String(doc.hr || ''),
          temp: String(doc.temp || ''),
          resp_rate: String(doc.resp_rate || ''),
          spo2: String(doc.spo2 || ''),
          energy: String(doc.energy || ''),
          gtcs_for: String(doc.gtcs_for || ''),
          bp_after: String(doc.bp_after || ''),
          hr_after: String(doc.hr_after || ''),
          resp_rate_after: String(doc.resp_rate_after || ''),
          spo2_after: String(doc.spo2_after || ''),
          progress_plan: String(doc.progress_plan || ''),
          other_complications: String(doc.other_complications || ''),
          sign_date: doc.sign_date ? String(doc.sign_date).slice(0, 10) : '',
          consultant_sign_date: doc.consultant_sign_date ? String(doc.consultant_sign_date).slice(0, 10) : '',
        })
        setPatientQuery(String(doc.patient_name || doc.patient || ''))
        setConsultantQuery(String(doc.consultant_doctor || ''))
        setAssistantQuery(String(doc.assistant_doctor || ''))
        setAnaesthetistQuery(String(doc.anaesthetist || ''))
        setAnaesthesiaQuery(String(doc.type_of_anaesthesia || ''))
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ECT procedure')
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
      return
    }

    try {
      setLoading(true)
      setError(null)

      const payload = {
        patient: formData.patient,
        patient_name: formData.patient_name || undefined,
        date: formData.date || undefined,
        npo_since: formData.npo_since || undefined,
        consultant_doctor: formData.consultant_doctor || undefined,
        assistant_doctor: formData.assistant_doctor || undefined,
        anaesthetist: formData.anaesthetist || undefined,
        type_of_anaesthesia: formData.type_of_anaesthesia || undefined,
        date_of_session: formData.date_of_session || undefined,
        no_of_session: formData.no_of_session ? Number(formData.no_of_session) : undefined,
        bp: formData.bp || undefined,
        hr: formData.hr || undefined,
        temp: formData.temp || undefined,
        resp_rate: formData.resp_rate || undefined,
        spo2: formData.spo2 || undefined,
        energy: formData.energy || undefined,
        gtcs_for: formData.gtcs_for || undefined,
        bp_after: formData.bp_after || undefined,
        hr_after: formData.hr_after || undefined,
        resp_rate_after: formData.resp_rate_after || undefined,
        spo2_after: formData.spo2_after || undefined,
        progress_plan: formData.progress_plan || undefined,
        other_complications: formData.other_complications || undefined,
        sign_date: formData.sign_date || undefined,
        consultant_sign_date: formData.consultant_sign_date || undefined,
      }

      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('ECT Procedure', editName.trim(), payload)
        toast.success('ECT Procedure updated successfully')
      } else {
        await createECTProcedure(payload)
        toast.success('ECT Procedure created successfully')
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create ECT Procedure'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialPatient) {
      const load = async () => {
        try {
          const patients = await fetchPatients(1, 0, initialPatient)
          if (patients.length > 0) {
            setPatientQuery(patients[0].patient_name)
            setFormData(prev => ({
              ...prev,
              patient: patients[0].name,
              patient_name: patients[0].patient_name,
            }))
          }
        } catch (err) {
          console.error('Failed to load initial patient for ECT Procedure:', err)
        }
      }
      load()
    }
  }, [initialPatient])

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
        console.error('Failed to search patients for ECT Procedure:', err)
        setPatientOptions([])
      } finally {
        setPatientLoading(false)
      }
    }, patientQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [patientQuery, patientOpen])

  useEffect(() => {
    if (!consultantOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(consultantQuery || undefined)
        setConsultantOptions(results)
      } catch {
        setConsultantOptions([])
      }
    }, consultantQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [consultantQuery, consultantOpen])

  useEffect(() => {
    if (!assistantOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(assistantQuery || undefined)
        setAssistantOptions(results)
      } catch {
        setAssistantOptions([])
      }
    }, assistantQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [assistantQuery, assistantOpen])

  useEffect(() => {
    if (!anaesthetistOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(anaesthetistQuery || undefined)
        setAnaesthetistOptions(results)
      } catch {
        setAnaesthetistOptions([])
      }
    }, anaesthetistQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [anaesthetistQuery, anaesthetistOpen])

  // Auto-fill current user's linked practitioner as consultant doctor
  useEffect(() => {
    if (!linkedPractitionerId) return
    setFormData((prev) =>
      prev.consultant_doctor
        ? prev
        : { ...prev, consultant_doctor: linkedPractitionerId },
    )
    setConsultantQuery((q) => q.trim() || linkedPractitionerLabel || linkedPractitionerId)
  }, [linkedPractitionerId, linkedPractitionerLabel])

  useEffect(() => {
    if (!anaesthesiaOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchAnaesthesiaTypes(anaesthesiaQuery || undefined)
        setAnaesthesiaOptions(results)
      } catch {
        setAnaesthesiaOptions([])
      }
    }, anaesthesiaQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [anaesthesiaQuery, anaesthesiaOpen])

  const handlePatientSelect = useCallback((p: PatientListItem) => {
    setFormData(prev => ({
      ...prev,
      patient: p.name,
      patient_name: p.patient_name,
    }))
    setPatientQuery(p.patient_name)
    setPatientOpen(false)
  }, [])

  const handleConsultantSelect = useCallback((d: LinkFieldOption) => {
    setFormData(prev => ({
      ...prev,
      consultant_doctor: d.name,
    }))
    setConsultantQuery(d.label)
    setConsultantOpen(false)
  }, [])

  const handleAssistantSelect = useCallback((d: LinkFieldOption) => {
    setFormData(prev => ({
      ...prev,
      assistant_doctor: d.name,
    }))
    setAssistantQuery(d.label)
    setAssistantOpen(false)
  }, [])

  const handleAnaesthetistSelect = useCallback((d: LinkFieldOption) => {
    setFormData(prev => ({
      ...prev,
      anaesthetist: d.name,
    }))
    setAnaesthetistQuery(d.label)
    setAnaesthetistOpen(false)
  }, [])

  const handleAnaesthesiaSelect = useCallback((d: LinkFieldOption) => {
    setFormData(prev => ({
      ...prev,
      type_of_anaesthesia: d.name,
    }))
    setAnaesthesiaQuery(d.label)
    setAnaesthesiaOpen(false)
  }, [])

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-4xl w-full max-h-[95vh] overflow-hidden')}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-slate-50 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {isEdit ? 'Edit ECT Procedure' : 'Create ECT Procedure'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Fill in the procedure details and vital signs</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg p-1 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          {error && (
            <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex-shrink-0 flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading procedure…</div>
            ) : (
            <>
            {/* Patient & Session Info */}
            <section>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Patient" required>
                  <ComboboxField
                    query={patientQuery}
                    onQueryChange={setPatientQuery}
                    onFocus={() => setPatientOpen(true)}
                    isOpen={patientOpen}
                    isLoading={patientLoading}
                    options={patientOptions}
                    onSelect={handlePatientSelect}
                    placeholder="Search patient..."
                  />
                </FormField>
                <FormField label="Date of Procedure">
                  <InputField 
                    value={formData.date} 
                    onChange={(e) => handleChange('date', e.target.value)} 
                    type="date" 
                  />
                </FormField>
              </div>
            </section>

            {/* Preparation Info */}
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="inline-block w-1 h-5 bg-slate-400 rounded-full"></span>
                Pre-Procedure Preparation
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="NPO Since">
                  <InputField 
                    value={formData.npo_since} 
                    onChange={(e) => handleChange('npo_since', e.target.value)} 
                    type="date" 
                  />
                </FormField>
                <FormField label="Type of Anaesthesia">
                  <ComboboxField
                    query={anaesthesiaQuery}
                    onQueryChange={(value: string) => {
                      setAnaesthesiaQuery(value)
                      setFormData(prev => ({ ...prev, type_of_anaesthesia: '' }))
                      setAnaesthesiaOpen(true)
                    }}
                    onFocus={() => setAnaesthesiaOpen(true)}
                    isOpen={anaesthesiaOpen}
                    options={anaesthesiaOptions}
                    onSelect={handleAnaesthesiaSelect}
                    placeholder="Search type of anaesthesia..."
                  />
                </FormField>
                <FormField label="Date of Session">
                  <InputField 
                    value={formData.date_of_session} 
                    onChange={(e) => handleChange('date_of_session', e.target.value)} 
                    type="date" 
                  />
                </FormField>
                <FormField label="Number of Session">
                  <InputField 
                    value={formData.no_of_session} 
                    onChange={(e) => handleChange('no_of_session', e.target.value)} 
                    type="number" 
                    placeholder="0" 
                  />
                </FormField>
              </div>
            </section>

            {/* Medical Team */}
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="inline-block w-1 h-5 bg-slate-400 rounded-full"></span>
                Medical Team
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Consultant Doctor">
                  <ComboboxField
                    query={consultantQuery}
                    onQueryChange={setConsultantQuery}
                    onFocus={() => setConsultantOpen(true)}
                    isOpen={consultantOpen}
                    options={consultantOptions}
                    onSelect={handleConsultantSelect}
                    placeholder="Search consultant..."
                    locked={practitionerLocked}
                  />
                </FormField>
                <FormField label="Assistant Doctor">
                  <ComboboxField
                    query={assistantQuery}
                    onQueryChange={setAssistantQuery}
                    onFocus={() => setAssistantOpen(true)}
                    isOpen={assistantOpen}
                    options={assistantOptions}
                    onSelect={handleAssistantSelect}
                    placeholder="Search assistant..."
                  />
                </FormField>
                <FormField label="Anaesthetist">
                  <ComboboxField
                    query={anaesthetistQuery}
                    onQueryChange={setAnaesthetistQuery}
                    onFocus={() => setAnaesthetistOpen(true)}
                    isOpen={anaesthetistOpen}
                    options={anaesthetistOptions}
                    onSelect={handleAnaesthetistSelect}
                    placeholder="Search anaesthetist..."
                  />
                </FormField>
              </div>
            </section>

            {/* Stats - Before */}
            <section className="border-t border-slate-200 pt-4 bg-blue-50/40 p-4 rounded-lg">
              <h3 className="text-sm font-bold text-blue-900 mb-4 flex items-center gap-2 uppercase tracking-wide">
                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
                Stats (Before)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Blood Pressure (BP)">
                  <InputField 
                    value={formData.bp} 
                    onChange={(e) => handleChange('bp', e.target.value)} 
                    placeholder="e.g., 120/80" 
                  />
                </FormField>
                <FormField label="Heart Rate (HR)">
                  <InputField 
                    value={formData.hr} 
                    onChange={(e) => handleChange('hr', e.target.value)} 
                    placeholder="e.g., 72 bpm" 
                  />
                </FormField>
                <FormField label="Temperature">
                  <InputField 
                    value={formData.temp} 
                    onChange={(e) => handleChange('temp', e.target.value)} 
                    placeholder="e.g., 37°C" 
                  />
                </FormField>
                <FormField label="Respiratory Rate">
                  <InputField 
                    value={formData.resp_rate} 
                    onChange={(e) => handleChange('resp_rate', e.target.value)} 
                    placeholder="e.g., 16/min" 
                  />
                </FormField>
                <FormField label="SpO₂ (Oxygen Saturation)">
                  <InputField 
                    value={formData.spo2} 
                    onChange={(e) => handleChange('spo2', e.target.value)} 
                    placeholder="e.g., 98%" 
                  />
                </FormField>
              </div>
            </section>

            {/* Procedure Details */}
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="inline-block w-1 h-5 bg-slate-400 rounded-full"></span>
                Procedure Details
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Energy (Joules)">
                  <InputField 
                    value={formData.energy} 
                    onChange={(e) => handleChange('energy', e.target.value)} 
                    placeholder="e.g., 200 J" 
                  />
                </FormField>
                <FormField label="GTCs For (seconds)">
                  <InputField 
                    value={formData.gtcs_for} 
                    onChange={(e) => handleChange('gtcs_for', e.target.value)} 
                    placeholder="e.g., 45 sec" 
                  />
                </FormField>
              </div>
            </section>

            {/* Stats - After */}
            <section className="border-t border-slate-200 pt-4 bg-amber-50/40 p-4 rounded-lg">
              <h3 className="text-sm font-bold text-amber-900 mb-4 flex items-center gap-2 uppercase tracking-wide">
                <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
                Stats (After)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Blood Pressure (BP After)">
                  <InputField 
                    value={formData.bp_after} 
                    onChange={(e) => handleChange('bp_after', e.target.value)} 
                    placeholder="e.g., 120/80" 
                  />
                </FormField>
                <FormField label="Heart Rate (HR After)">
                  <InputField 
                    value={formData.hr_after} 
                    onChange={(e) => handleChange('hr_after', e.target.value)} 
                    placeholder="e.g., 72 bpm" 
                  />
                </FormField>
                <FormField label="Respiratory Rate (After)">
                  <InputField 
                    value={formData.resp_rate_after} 
                    onChange={(e) => handleChange('resp_rate_after', e.target.value)} 
                    placeholder="e.g., 16/min" 
                  />
                </FormField>
                <FormField label="SpO₂ (After)">
                  <InputField 
                    value={formData.spo2_after} 
                    onChange={(e) => handleChange('spo2_after', e.target.value)} 
                    placeholder="e.g., 98%" 
                  />
                </FormField>
              </div>
            </section>

            {/* Notes */}
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="inline-block w-1 h-5 bg-slate-400 rounded-full"></span>
                Notes
              </h3>
              <div className="space-y-4">
                <FormField label="Notes">
                  <textarea
                    value={formData.progress_plan}
                    onChange={(e) => handleChange('progress_plan', e.target.value)}
                    placeholder="Enter notes..."
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                    rows={3}
                  />
                </FormField>
                <FormField label="Complications / Contraindications">
                  <textarea
                    value={formData.other_complications}
                    onChange={(e) => handleChange('other_complications', e.target.value)}
                    placeholder="Document any complications or contraindications..."
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                    rows={3}
                  />
                </FormField>
              </div>
            </section>

            {/* Sign Off */}
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="inline-block w-1 h-5 bg-green-400 rounded-full"></span>
                Sign Off
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Procedure Sign Date">
                  <InputField 
                    value={formData.sign_date} 
                    onChange={(e) => handleChange('sign_date', e.target.value)} 
                    type="date" 
                  />
                </FormField>
                <FormField label="Consultant Sign Date">
                  <InputField 
                    value={formData.consultant_sign_date} 
                    onChange={(e) => handleChange('consultant_sign_date', e.target.value)} 
                    type="date" 
                  />
                </FormField>
              </div>
            </section>
            </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || loadingEdit}
              className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Save ECT Procedure'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
