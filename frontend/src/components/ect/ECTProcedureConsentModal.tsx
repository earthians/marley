import { useState, useEffect, useRef } from 'react'
import { apiRequest } from '../../services/apiClient'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { uploadPatientFile } from '../../services/patients'
import { fetchDoc, fetchHealthcarePractitioners, getCurrentUserPractitionerOption, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { ChevronDown } from 'lucide-react'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_OVERLAY_STACK,
  CreateModalHeader,
  createModalShellClass,
  MODAL_SECTION_CLASS,
  MODAL_SECTION_TITLE_CLASS,
} from '../ui/CreateModalChrome'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import { useCareContext } from '../../providers/CareContextProvider'
import { SignaturePad } from '../ui/SignaturePad'

interface ECTProcedureConsentModalProps {
  /** When set, modal loads and updates this record instead of creating. */
  editName?: string
  admissionNo?: string
  patient?: string
  patientName?: string
  onClose: () => void
  onSuccess?: () => void
}

function docCheck(value: unknown): boolean {
  return value === 1 || value === true
}

const lc = 'block text-xs font-semibold text-slate-600 mb-1'
const ic = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

function nowDate() {
  return new Date().toISOString().slice(0, 10)
}
function nowTime() {
  return new Date().toTimeString().slice(0, 5)
}

async function fetchECTTermsOptions(search: string): Promise<LinkFieldOption[]> {
  try {
    const params = new URLSearchParams({
      doctype: 'ECT Procedure Consent Terms',
      txt: search || '',
      fields: JSON.stringify(['name', 'default']),
      page_length: '20',
    })
    const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
    const data = await res.json()
    const list = Array.isArray(data?.message) ? data.message : []
    return list.map((r: { name?: string; default?: number }) => ({ name: r.name ?? '', label: r.name ?? '', default: r.default }))
  } catch { return [] }
}

async function fetchECTTermsContent(termName: string): Promise<{ english: string; arabic: string }> {
  try {
    const res = await fetch(`/api/resource/ECT%20Procedure%20Consent%20Terms/${encodeURIComponent(termName)}`)
    const data = await res.json()
    return {
      english: data?.data?.terms_and_conditions ?? '',
      arabic: data?.data?.terms_and_conditions_arabic ?? '',
    }
  } catch { return { english: '', arabic: '' } }
}

export const ECTProcedureConsentModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName = '',
  onClose,
  onSuccess,
}: ECTProcedureConsentModalProps) => {
  const isEdit = Boolean(editName?.trim())
  const { mode, activeVisit, activeAdmission, selectedPatient: contextPatient } = useCareContext()
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'

  // ── General
  const [admissionField, setAdmissionField] = useState(() => (isIPMode && activeAdmission) ? activeAdmission : admissionNo || '')
  const [patientVisit, setPatientVisit] = useState(() => (isOPMode && activeVisit) ? activeVisit : '')
  const [patientVisitLabel, setPatientVisitLabel] = useState('')
  const [patientField, setPatientField] = useState(patient || contextPatient || '')
  const [patientNameField, setPatientNameField] = useState(patientName || '')

  // ── Terms (bilingual)
  const [termsName, setTermsName] = useState('ECT Procedure Consent')
  const [termsEnglish, setTermsEnglish] = useState('')
  const [termsArabic, setTermsArabic] = useState('')
  const [termsLoading, setTermsLoading] = useState(false)
  const [termsOptions, setTermsOptions] = useState<LinkFieldOption[]>([])
  const [termsOpen, setTermsOpen] = useState(false)
  const [termsQuery, setTermsQuery] = useState('ECT Procedure Consent')
  const [termsAccepted, setTermsAccepted] = useState(true)
  const termsRef = useRef<HTMLDivElement>(null)

  // ── Psychiatrist combobox
  const [psychiatristOptions, setPsychiatristOptions] = useState<LinkFieldOption[]>([])
  const [psychiatristOpen, setPsychiatristOpen] = useState(false)
  const [psychiatristQuery, setPsychiatristQuery] = useState('')
  const psychiatristRef = useRef<HTMLDivElement>(null)

  // ── Signatures
  const [patientSignatureUrl, setPatientSignatureUrl] = useState('')
  const [patientSignatureUploading, setPatientSignatureUploading] = useState(false)
  const [witnessName, setWitnessName] = useState('')
  const [witnessCpr, setWitnessCpr] = useState('')
  const [witnessSignatureUrl, setWitnessSignatureUrl] = useState('')
  const [witnessSignatureUploading, setWitnessSignatureUploading] = useState(false)
  const [psychiatrist, setPsychiatrist] = useState('')
  const [psychiatristName, setPsychiatristName] = useState('')
  const [psychiatristSignatureUrl, setPsychiatristSignatureUrl] = useState('')
  const [psychiatristSignatureUploading, setPsychiatristSignatureUploading] = useState(false)

  // ── Guardian
  const [guardianName, setGuardianName] = useState('')
  const [relationToPatient, setRelationToPatient] = useState('')
  const [guardianCpr, setGuardianCpr] = useState('')
  const [guardianSignatureUrl, setGuardianSignatureUrl] = useState('')
  const [guardianSignatureUploading, setGuardianSignatureUploading] = useState(false)
  const [guardianSignDate] = useState(nowDate())
  const [guardianSignTime] = useState(nowTime())

  const [submitting, setSubmitting] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('ECT Procedure Consent', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setAdmissionField(String(doc.inpatient_admission || ''))
        const visit = String(doc.patient_visit || '')
        setPatientVisit(visit)
        setPatientVisitLabel(visit)
        setPatientField(String(doc.patient || ''))
        setPatientNameField(String(doc.patient_name || ''))
        const terms = String(doc.terms || '')
        setTermsName(terms)
        setTermsQuery(terms)
        setTermsEnglish(String(doc.terms_and_conditions || ''))
        setTermsArabic(String(doc.terms_and_conditionsarabic || doc.terms_and_conditions_arabic || ''))
        setTermsAccepted(docCheck(doc.terms_accepted))
        setPatientSignatureUrl(String(doc.signature_of_patient || ''))
        setWitnessName(String(doc.witness_name || ''))
        setWitnessCpr(String(doc.witness_cpr || ''))
        setWitnessSignatureUrl(String(doc.witness_signature || ''))
        setPsychiatrist(String(doc.psychiatrist || ''))
        setPsychiatristName(String(doc.psychiatrist_name || ''))
        setPsychiatristSignatureUrl(String(doc.psychiatrist_signature || ''))
        setPsychiatristQuery(String(doc.psychiatrist_name || doc.psychiatrist || ''))
        setGuardianName(String(doc.patients_legal_guardian || ''))
        setRelationToPatient(String(doc.relation_to_patient || ''))
        setGuardianCpr(String(doc.guardian_cpr || ''))
        setGuardianSignatureUrl(String(doc.guardian_signature || ''))
        const sigRows = Array.isArray(doc.signature) ? doc.signature : []
        const sigRow = sigRows[0] as Record<string, unknown> | undefined
        if (sigRow) {
          if (!doc.patients_legal_guardian && sigRow.relative_name) {
            setGuardianName(String(sigRow.relative_name))
          }
          if (sigRow.relationship_with_patient) setRelationToPatient(String(sigRow.relationship_with_patient))
          if (sigRow.cpr__id_no) setGuardianCpr(String(sigRow.cpr__id_no))
          if (sigRow.signature && !doc.guardian_signature) setGuardianSignatureUrl(String(sigRow.signature))
        }
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load consent')
      })
      .finally(() => {
        if (!cancelled) setLoadingEdit(false)
      })
    return () => {
      cancelled = true
    }
  }, [editName])

  // Auto-load default terms on mount
  useEffect(() => {
    if (isEdit) return
    let cancelled = false
    const loadDefault = async () => {
      setTermsLoading(true)
      try {
        const options = await fetchECTTermsOptions('')
        if (cancelled) return
        const def = options.find((o) => Boolean(o.default)) || options[0]
        if (def) {
          const content = await fetchECTTermsContent(def.name)
          if (cancelled) return
          setTermsName(def.name)
          setTermsQuery(def.label)
          setTermsEnglish(content.english)
          setTermsArabic(content.arabic)
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setTermsLoading(false)
      }
    }
    void loadDefault()
    return () => { cancelled = true }
  }, [isEdit])

  // Terms options
  useEffect(() => {
    if (!termsOpen) return
    const id = setTimeout(async () => {
      try {
        setTermsOptions(await fetchECTTermsOptions(termsQuery))
      } catch { setTermsOptions([]) }
    }, termsQuery.trim() ? 300 : 0)
    return () => clearTimeout(id)
  }, [termsOpen, termsQuery])

  // Close dropdowns
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (termsRef.current && !termsRef.current.contains(e.target as Node)) setTermsOpen(false)
      if (psychiatristRef.current && !psychiatristRef.current.contains(e.target as Node)) setPsychiatristOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Psychiatrist options
  useEffect(() => {
    if (!psychiatristOpen) return
    const id = setTimeout(async () => {
      try {
        setPsychiatristOptions(await fetchHealthcarePractitioners(psychiatristQuery || undefined))
      } catch { setPsychiatristOptions([]) }
    }, psychiatristQuery.trim() ? 300 : 0)
    return () => clearTimeout(id)
  }, [psychiatristOpen, psychiatristQuery])

  const handlePsychiatristSelect = async (opt: LinkFieldOption) => {
    setPsychiatrist(opt.name)
    setPsychiatristName(opt.label)
    setPsychiatristQuery(opt.label)
    setPsychiatristOpen(false)
    // Auto-fill signature from practitioner record
    try {
      const doc = await fetchDoc('Healthcare Practitioner', opt.name)
      const sig = typeof doc.signature === 'string' ? doc.signature.trim() : ''
      if (sig) setPsychiatristSignatureUrl(sig)
    } catch {
      /* ignore */
    }
  }

  // Auto-select current user's practitioner as psychiatrist on mount and auto-fill their signature
  useEffect(() => {
    if (isEdit) return
    let cancelled = false
    const load = async () => {
      try {
        const pract = await getCurrentUserPractitionerOption()
        if (cancelled || !pract) return
        setPsychiatrist(pract.name)
        setPsychiatristName(pract.label)
        setPsychiatristQuery(pract.label)
        const doc = await fetchDoc('Healthcare Practitioner', pract.name)
        const sig = typeof doc.signature === 'string' ? doc.signature.trim() : ''
        if (!cancelled && sig) setPsychiatristSignatureUrl(sig)
      } catch {
        /* ignore */
      }
    }
    void load()
    return () => { cancelled = true }
  }, [isEdit])

  // Upload helpers
  const makeUploadHandler = (
    fieldSetter: (url: string) => void,
    uploadingSetter: (v: boolean) => void,
  ) => async (file: File) => {
    uploadingSetter(true)
    try {
      const url = await uploadPatientFile(file)
      fieldSetter(url)
    } catch {
      toast.error('Failed to upload signature.')
    } finally {
      uploadingSetter(false)
    }
  }

  const handleTermsSelect = async (opt: LinkFieldOption) => {
    setTermsName(opt.name)
    setTermsQuery(opt.label)
    setTermsOpen(false)
    setTermsLoading(true)
    try {
      const content = await fetchECTTermsContent(opt.name)
      setTermsEnglish(content.english)
      setTermsArabic(content.arabic)
    } catch {
      toast.error('Failed to load terms.')
    } finally {
      setTermsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isEdit) {
      if (isIPMode && !admissionField) {
        toast.error('Please select an inpatient admission (IP mode active)')
        return
      }
      if (isOPMode && !patientVisit) {
        toast.error('Please select a patient visit (OP mode active)')
        return
      }
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        patient: patientField,
        patient_name: patientNameField || undefined,
        patient_visit: patientVisit || undefined,
        inpatient_admission: admissionField || undefined,
        signature: (guardianName || guardianSignatureUrl) ? [
          {
            relative_name: guardianName || undefined,
            relationship_with_patient: relationToPatient || undefined,
            cpr__id_no: guardianCpr || undefined,
            signature: guardianSignatureUrl || undefined,
            entered_date: guardianSignDate || undefined,
          },
        ] : undefined,
        terms: termsName || undefined,
        terms_and_conditions: termsEnglish || undefined,
        terms_and_conditionsarabic: termsArabic || undefined,
        signature_of_patient: patientSignatureUrl || undefined,
        witness_name: witnessName || undefined,
        witness_signature: witnessSignatureUrl || undefined,
        witness_cpr: witnessCpr || undefined,
        psychiatrist: psychiatrist || undefined,
        psychiatrist_name: psychiatristName || undefined,
        psychiatrist_signature: psychiatristSignatureUrl || undefined,
        patients_legal_guardian: guardianName || undefined,
        relation_to_patient: relationToPatient || undefined,
        guardian_cpr: guardianCpr || undefined,
        guardian_signature: guardianSignatureUrl || undefined,
        guardian_sign_date: guardianSignDate || undefined,
        guardian_sign_time: guardianSignTime || undefined,
        terms_accepted: termsAccepted ? 1 : 0,
      }
      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('ECT Procedure Consent', editName.trim(), payload)
        toast.success('ECT Procedure Consent updated.')
      } else {
        await apiRequest<{ name: string }>('/api/resource/ECT%20Procedure%20Consent', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        toast.success('ECT Procedure Consent saved successfully.')
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save ECT Procedure Consent.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={CREATE_MODAL_OVERLAY_STACK} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={createModalShellClass('max-w-4xl max-h-[92vh] overflow-hidden')} onMouseDown={(e) => e.stopPropagation()}>
        <CreateModalHeader title={isEdit ? 'Edit ECT Procedure Consent' : 'ECT Procedure Consent'} onClose={onClose} />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading consent…</div>
            ) : null}
            {!loadingEdit && (
            <>
            {/* Patient + Admission */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={lc}>Patient *</label>
                <input type="text" value={patientNameField || patientField} readOnly className={`${ic} bg-slate-100 cursor-not-allowed`} />
              </div>
              {!isOPMode && (
                <div>
                  <label className={lc}>Inpatient Admission {isIPMode ? '*' : ''}</label>
                  <input type="text" value={admissionField} onChange={(e) => setAdmissionField(e.target.value)} readOnly={(isIPMode && !!activeAdmission) || !!admissionNo} className={`${ic} ${(isIPMode && !!activeAdmission) || !!admissionNo ? 'bg-slate-100' : ''}`} placeholder="Admission / search" />
                </div>
              )}
              {!isIPMode && (
                <div>
                  <label className={lc}>Patient Visit {isOPMode ? '*' : ''}</label>
                  <input type="text" value={patientVisitLabel || patientVisit} onChange={(e) => { setPatientVisit(e.target.value); setPatientVisitLabel(e.target.value) }} className={ic} placeholder="Visit / search" />
                </div>
              )}
            </div>

            {/* Bilingual Terms — English + Arabic side by side */}
            <div className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>Terms & Conditions</h3>
              <div ref={termsRef} className="mb-3">
                <label className={lc}>Terms Document</label>
                <div className="relative">
                  <input type="text" value={termsQuery} onChange={(e) => { setTermsQuery(e.target.value); setTermsOpen(true) }} onFocus={() => setTermsOpen(true)} placeholder="Search terms…" className={`${linkComboboxInputWithClearClass} pr-9`} autoComplete="off" />
                  <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </span>
                  {termsOpen && termsOptions.length > 0 && (
                    <div className={linkComboboxDropdownClass}>
                      {termsOptions.map((opt) => (
                        <button key={opt.name} type="button" onClick={() => handleTermsSelect(opt)} className={linkComboboxOptionClassCompact}>
                          <span className="font-medium text-slate-800">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {termsLoading && <p className="mt-1.5 text-xs text-slate-500">Loading terms content…</p>}
              </div>
              {/* English */}
              <div className="mb-3">
                <p className="mb-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wide">English</p>
                <div className={`rounded-lg border border-slate-200 bg-white p-3 text-sm ${termsEnglish ? 'max-h-56 overflow-y-auto' : ''}`}>
                  {termsEnglish ? (
                    <div dangerouslySetInnerHTML={{ __html: termsEnglish }} />
                  ) : (
                    <p className="text-xs text-slate-400">Select a terms document above to preview the English text.</p>
                  )}
                </div>
              </div>
              {/* Arabic */}
              <div>
                <p className="mb-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wide">العربية (Arabic)</p>
                <div dir="rtl" className={`rounded-lg border border-slate-200 bg-white p-3 text-sm text-right ${termsArabic ? 'max-h-56 overflow-y-auto' : ''}`}>
                  {termsArabic ? (
                    <div dangerouslySetInnerHTML={{ __html: termsArabic }} />
                  ) : (
                    <p className="text-xs text-slate-400">حدد مستند الشروط أعلاه لمعاينة النص العربي.</p>
                  )}
                </div>
              </div>
              {/* Terms acceptance — default checked */}
              <label className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="h-4 w-4"
                />
                I acknowledge that I have read and understood the above Terms & Conditions (English & Arabic).
              </label>
            </div>

            {/* Signatures */}
            <div className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>Signatures</h3>
              <div className="space-y-5">
                {/* Patient Signature */}
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-700">Patient Signature</p>
                  <SignaturePad onSave={makeUploadHandler(setPatientSignatureUrl, setPatientSignatureUploading)} onClear={() => setPatientSignatureUrl('')} existingUrl={patientSignatureUrl} uploading={patientSignatureUploading} />
                </div>
                {/* Guardian */}
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-700">Guardian</p>
                  <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input type="text" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="Legal guardian name" className={ic} />
                    <select value={relationToPatient} onChange={(e) => setRelationToPatient(e.target.value)} className={ic}>
                      <option value="">— Relation —</option>
                      {['Father','Mother','Brother','Sister','Husband','Wife','Son','Daughter'].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input type="text" value={guardianCpr} onChange={(e) => setGuardianCpr(e.target.value)} placeholder="Guardian CPR" className={ic} />
                  </div>
                  <SignaturePad onSave={makeUploadHandler(setGuardianSignatureUrl, setGuardianSignatureUploading)} onClear={() => setGuardianSignatureUrl('')} existingUrl={guardianSignatureUrl} uploading={guardianSignatureUploading} />
                </div>
                {/* Witness */}
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-700">Witness</p>
                  <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input type="text" value={witnessName} onChange={(e) => setWitnessName(e.target.value)} placeholder="Witness name" className={ic} />
                    <input type="text" value={witnessCpr} onChange={(e) => setWitnessCpr(e.target.value)} placeholder="Witness CPR" className={ic} />
                  </div>
                  <SignaturePad onSave={makeUploadHandler(setWitnessSignatureUrl, setWitnessSignatureUploading)} onClear={() => setWitnessSignatureUrl('')} existingUrl={witnessSignatureUrl} uploading={witnessSignatureUploading} />
                </div>
                {/* Psychiatrist */}
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-700">Psychiatrist</p>
                  <div ref={psychiatristRef} className="mb-2">
                    <div className="relative">
                      <input
                        type="text"
                        value={psychiatristQuery}
                        onChange={(e) => { setPsychiatristQuery(e.target.value); setPsychiatristOpen(true); setPsychiatrist(''); setPsychiatristName('') }}
                        onFocus={() => setPsychiatristOpen(true)}
                        placeholder="Search psychiatrist..."
                        autoComplete="off"
                        className={`${linkComboboxInputWithClearClass} pr-9`}
                      />
                      <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </span>
                      {psychiatristOpen && psychiatristOptions.length > 0 && (
                        <div className={linkComboboxDropdownClass}>
                          {psychiatristOptions.map((opt) => (
                            <button key={opt.name} type="button" onClick={() => handlePsychiatristSelect(opt)} className={linkComboboxOptionClassCompact}>
                              <span className="font-medium text-slate-800">{opt.label}</span>
                              {opt.department ? (
                                <span className="text-xs text-slate-500">{opt.department}</span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <SignaturePad onSave={makeUploadHandler(setPsychiatristSignatureUrl, setPsychiatristSignatureUploading)} onClear={() => setPsychiatristSignatureUrl('')} existingUrl={psychiatristSignatureUrl} uploading={psychiatristSignatureUploading} />
                </div>
              </div>
            </div>
            </>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-3 bg-white">
            <button type="button" onClick={onClose} className={CM_BTN_CANCEL}>Cancel</button>
            <button type="submit" disabled={submitting || loadingEdit} className={CM_BTN_PRIMARY}>
              {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Consent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}