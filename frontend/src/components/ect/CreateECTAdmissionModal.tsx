import { useEffect, useState } from 'react'
import {
  CREATE_MODAL_OVERLAY,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { createECTAdmission } from '../../services/ectAdmission'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { fetchDoc } from '../../services/common'
import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'
import { fetchHealthcarePractitioners, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { useCareContext } from '../../providers/CareContextProvider'
import {
  LOCKED_PRACTITIONER_INPUT_CLASS,
  useLockedLinkedPractitioner,
} from '../../hooks/useLockedLinkedPractitioner'
import { DateFilterInput } from '../ui/DateFilterInput'

interface CreateECTAdmissionModalProps {
  onClose: () => void
  onSuccess?: () => void
  /** When set, modal loads and updates this record instead of creating. */
  editName?: string
  initialPatient?: string
}

export const CreateECTAdmissionModal = ({
  onClose,
  onSuccess,
  editName,
  initialPatient,
}: CreateECTAdmissionModalProps) => {
  const isEdit = Boolean(editName?.trim())
  const now = new Date()
  const { mode, activeAdmission, activeVisit } = useCareContext()
  const [formData, setFormData] = useState({
    patient: initialPatient || '',
    patient_name: '',
    inpatient_admission: mode === 'IP' ? (activeAdmission || '') : '',
    patient_visit: mode === 'OP' ? (activeVisit || '') : '',
    date: now.toISOString().slice(0, 10),
    bp: '',
    hr: '',
    resp_rate: '',
    spo2: '',
    psychiatric_diagnosis: '',
    medical_history: '',
    patient_allergy_history: '',
    other_complications: '',
    instructions: '',
    doctor: '',
    doctors_name: '',
  })
  const [loading, setLoading] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)
  const [error, setError] = useState<string | null>(null)

  const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientQuery, setPatientQuery] = useState(initialPatient || '')
  const [patientLoading, setPatientLoading] = useState(false)

  const [doctorOptions, setDoctorOptions] = useState<LinkFieldOption[]>([])
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [doctorQuery, setDoctorQuery] = useState('')
  const {
    locked: practitionerLocked,
    practitionerId: linkedPractitionerId,
    practitionerLabel: linkedPractitionerLabel,
  } = useLockedLinkedPractitioner()

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('ECT Admission', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setFormData({
          patient: String(doc.patient || ''),
          patient_name: String(doc.patient_name || ''),
          inpatient_admission: String(doc.inpatient_admission || ''),
          patient_visit: String(doc.patient_visit || ''),
          date: doc.date ? String(doc.date).slice(0, 10) : now.toISOString().slice(0, 10),
          bp: String(doc.bp || ''),
          hr: String(doc.hr || ''),
          resp_rate: String(doc.resp_rate || ''),
          spo2: String(doc.spo2 || ''),
          psychiatric_diagnosis: String(doc.psychiatric_diagnosis || ''),
          medical_history: String(doc.medical_history || ''),
          patient_allergy_history: String(doc.patient_allergy_history || ''),
          other_complications: String(doc.other_complications || ''),
          instructions: String(doc.instructions || ''),
          doctor: String(doc.doctor || ''),
          doctors_name: String(doc.doctors_name || ''),
        })
        setPatientQuery(String(doc.patient_name || doc.patient || ''))
        setDoctorQuery(String(doc.doctors_name || doc.doctor || ''))
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ECT admission')
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
        inpatient_admission: formData.inpatient_admission || undefined,
        patient_visit: formData.patient_visit || undefined,
        date: formData.date || undefined,
        bp: formData.bp || undefined,
        hr: formData.hr || undefined,
        resp_rate: formData.resp_rate || undefined,
        spo2: formData.spo2 || undefined,
        psychiatric_diagnosis: formData.psychiatric_diagnosis || undefined,
        medical_history: formData.medical_history || undefined,
        patient_allergy_history: formData.patient_allergy_history || undefined,
        other_complications: formData.other_complications || undefined,
        instructions: formData.instructions || undefined,
        doctor: formData.doctor || undefined,
        doctors_name: formData.doctors_name || undefined,
      }

      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('ECT Admission', editName.trim(), payload)
        toast.success('ECT Admission updated successfully')
      } else {
        await createECTAdmission(payload)
        toast.success('ECT Admission created successfully')
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create ECT Admission'
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
          console.error('Failed to load initial patient for ECT Admission:', err)
        }
      }
      load()
    }
  }, [initialPatient])

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      inpatient_admission: mode === 'IP' ? (activeAdmission || prev.inpatient_admission) : prev.inpatient_admission,
      patient_visit: mode === 'OP' ? (activeVisit || prev.patient_visit) : prev.patient_visit,
    }))
  }, [mode, activeAdmission, activeVisit])

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
        console.error('Failed to search patients for ECT Admission:', err)
        setPatientOptions([])
      } finally {
        setPatientLoading(false)
      }
    }, patientQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [patientQuery, patientOpen])

  useEffect(() => {
    if (!doctorOpen) return
    const t = setTimeout(async () => {
      try {
        const results = await fetchHealthcarePractitioners(doctorQuery || undefined)
        setDoctorOptions(results)
      } catch {
        setDoctorOptions([])
      }
    }, doctorQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [doctorQuery, doctorOpen])

  // Auto-fill current user's linked practitioner
  useEffect(() => {
    if (isEdit || !linkedPractitionerId) return
    setFormData((prev) =>
      prev.doctor ? prev : { ...prev, doctor: linkedPractitionerId, doctors_name: linkedPractitionerLabel || linkedPractitionerId },
    )
    setDoctorQuery((q) => q.trim() || linkedPractitionerLabel || linkedPractitionerId)
  }, [linkedPractitionerId, linkedPractitionerLabel])

  const handlePatientSelect = (p: PatientListItem) => {
    setFormData(prev => ({
      ...prev,
      patient: p.name,
      patient_name: p.patient_name,
    }))
    setPatientQuery(p.patient_name)
    setPatientOpen(false)
  }

  const handleDoctorSelect = (d: LinkFieldOption) => {
    setFormData(prev => ({
      ...prev,
      doctor: d.name,
      doctors_name: d.label,
    }))
    setDoctorQuery(d.label)
    setDoctorOpen(false)
  }

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-2xl w-full max-h-[90vh] overflow-hidden')}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold tracking-tight text-emerald-950">
            {isEdit ? 'Edit ECT Admission' : 'Create ECT Admission'}
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

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">
          {error && (
            <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 flex-shrink-0">
              {error}
            </div>
          )}

          <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-4">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading admission…</div>
            ) : (
            <>
            {(formData.inpatient_admission || formData.patient_visit) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Inpatient Admission</label>
                  <input
                    type="text"
                    value={formData.inpatient_admission}
                    readOnly
                    className="w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Patient Visit</label>
                  <input
                    type="text"
                    value={formData.patient_visit}
                    readOnly
                    className="w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700"
                  />
                </div>
              </div>
            )}

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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <DateFilterInput
                  value={formData.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">BP</label>
                <input
                  type="text"
                  value={formData.bp}
                  onChange={(e) => handleChange('bp', e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">HR</label>
                <input
                  type="text"
                  value={formData.hr}
                  onChange={(e) => handleChange('hr', e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Resp Rate</label>
                <input
                  type="text"
                  value={formData.resp_rate}
                  onChange={(e) => handleChange('resp_rate', e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">SPO2</label>
                <input
                  type="text"
                  value={formData.spo2}
                  onChange={(e) => handleChange('spo2', e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Psychiatric Diagnosis</label>
              <textarea
                value={formData.psychiatric_diagnosis}
                onChange={(e) => handleChange('psychiatric_diagnosis', e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[70px]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Medical History</label>
              <textarea
                value={formData.medical_history}
                onChange={(e) => handleChange('medical_history', e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[70px]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Patient Allergy History</label>
              <textarea
                value={formData.patient_allergy_history}
                onChange={(e) => handleChange('patient_allergy_history', e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[70px]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Other Complications / Contraindications
              </label>
              <textarea
                value={formData.other_complications}
                onChange={(e) => handleChange('other_complications', e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[70px]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Instructions</label>
              <textarea
                value={formData.instructions}
                onChange={(e) => handleChange('instructions', e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[60px]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Doctor Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={doctorQuery}
                  readOnly={practitionerLocked}
                  onChange={(e) => {
                    if (practitionerLocked) return
                    setDoctorQuery(e.target.value)
                    setDoctorOpen(true)
                  }}
                  onFocus={() => {
                    if (!practitionerLocked) setDoctorOpen(true)
                  }}
                  placeholder="Search doctor..."
                  title={practitionerLocked ? 'Locked to your linked practitioner' : undefined}
                  className={
                    practitionerLocked
                      ? LOCKED_PRACTITIONER_INPUT_CLASS
                      : 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
                  }
                />
                {doctorOpen && !practitionerLocked && doctorOptions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {doctorOptions.map((d) => (
                      <button
                        key={d.name}
                        type="button"
                        onClick={() => handleDoctorSelect(d)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
                      >
                        <div className="font-medium">{d.label}</div>
                        {d.department && (
                          <div className="text-xs text-slate-500">{d.department}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || loadingEdit}
              className="px-4 py-2 text-sm rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Save ECT Admission'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

