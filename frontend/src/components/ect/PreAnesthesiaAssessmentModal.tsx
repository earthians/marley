// import { useState, useRef, useCallback, useEffect } from 'react'
// import { apiRequest } from '../../services/apiClient'
// import { uploadPatientFile } from '../../services/patients'
// import { fetchHealthcarePractitioners, fetchPatientVisits, fetchPatientOptions, fetchInpatientAdmissionOptions, type LinkFieldOption } from '../../services/common'
// import { toast } from '../../hooks/useToast'
// import { ChevronDown, PenLine, Check , FileText } from 'lucide-react'

import { CM_BTN_CANCEL, CM_BTN_PRIMARY, CREATE_MODAL_BODY_GRADIENT, CREATE_MODAL_FOOTER_STICKY, CREATE_MODAL_OVERLAY, CreateModalHeader, createModalShellClass, createModalTabButtonClass } from '../ui/CreateModalChrome'
// // ─── Signature Pad ────────────────────────────────────────────────────────────

// interface SignaturePadProps {
//   onSave: (file: File) => void
//   onClear?: () => void
//   existingUrl?: string
//   uploading?: boolean
// }

// const SignaturePad = ({ onSave, onClear, existingUrl, uploading }: SignaturePadProps) => {
//   const canvasRef = useRef<HTMLCanvasElement>(null)
//   const isDrawing = useRef(false)
//   const [hasStrokes, setHasStrokes] = useState(false)
//   const [mode, setMode] = useState<'idle' | 'done'>(existingUrl ? 'done' : 'idle')

//   const initCtx = useCallback(() => {
//     const canvas = canvasRef.current
//     if (!canvas) return null
//     const ctx = canvas.getContext('2d')
//     if (!ctx) return null
//     ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
//     return ctx
//   }, [])

//   const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
//     const rect = canvas.getBoundingClientRect()
//     if ('touches' in e) {
//       const t = e.touches[0]
//       return { x: (t.clientX - rect.left) * canvas.width / rect.width, y: (t.clientY - rect.top) * canvas.height / rect.height }
//     }
//     return { x: (e.clientX - rect.left) * canvas.width / rect.width, y: (e.clientY - rect.top) * canvas.height / rect.height }
//   }

//   const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
//     e.preventDefault()
//     const canvas = canvasRef.current; if (!canvas) return
//     const ctx = initCtx(); if (!ctx) return
//     isDrawing.current = true
//     const pos = getPos(e, canvas)
//     ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
//   }

//   const draw = (e: React.MouseEvent | React.TouchEvent) => {
//     e.preventDefault()
//     if (!isDrawing.current) return
//     const canvas = canvasRef.current; if (!canvas) return
//     const ctx = initCtx(); if (!ctx) return
//     const pos = getPos(e, canvas)
//     ctx.lineTo(pos.x, pos.y); ctx.stroke()
//     setHasStrokes(true)
//   }

//   const stopDraw = () => { isDrawing.current = false }

//   const clearCanvas = () => {
//     const canvas = canvasRef.current; if (!canvas) return
//     canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
//     setHasStrokes(false); setMode('idle'); onClear?.()
//   }

//   const saveSignature = () => {
//     canvasRef.current?.toBlob(blob => {
//       if (!blob) return
//       const file = new File([blob], 'signature.png', { type: 'image/png' })
//       onSave(file); setMode('done')
//     }, 'image/png')
//   }

//   if (mode === 'done' && existingUrl) {
//     return (
//       <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3">
//         <div className="flex items-center gap-2 mb-2">
//           <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
//             <Check className="w-3 h-3 text-white" />
//           </span>
//           <span className="text-xs font-semibold text-green-700">Signature captured</span>
//         </div>
//         <img src={existingUrl} alt="Signature" className="max-h-16 rounded border border-green-200" />
//         <button type="button" onClick={() => { setMode('idle'); setHasStrokes(false); onClear?.() }}
//           className="mt-2 text-xs text-slate-500 underline hover:text-slate-700">Re-draw</button>
//       </div>
//     )
//   }

//   return (
//     <div className="space-y-2">
//       <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden" style={{ height: '120px' }}>
//         <canvas ref={canvasRef} width={600} height={180}
//           className="w-full h-full cursor-crosshair touch-none"
//           onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
//           onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
//         {!hasStrokes && (
//           <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
//             <PenLine className="w-6 h-6 text-slate-300 mb-1" />
//             <p className="text-xs text-slate-400">Sign here</p>
//           </div>
//         )}
//       </div>
//       {hasStrokes && (
//         <div className="flex gap-2">
//           <button type="button" onClick={saveSignature} disabled={uploading}
//             className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60">
//             {uploading ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : <><Check className="w-3.5 h-3.5" />Save</>}
//           </button>
//           <button type="button" onClick={clearCanvas}
//             className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50">
//             Clear
//           </button>
//         </div>
//       )}
//     </div>
//   )
// }

// // ─── Link Combobox ────────────────────────────────────────────────────────────

// interface LinkComboboxProps {
//   label: string
//   value: string
//   onSelect: (opt: LinkFieldOption) => void
//   onClear: () => void
//   fetchOptions: (s: string) => Promise<LinkFieldOption[]>
//   placeholder?: string
//   required?: boolean
// }

// const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder, required }: LinkComboboxProps) => {
//   const [query, setQuery] = useState(value)
//   const [options, setOptions] = useState<LinkFieldOption[]>([])
//   const [open, setOpen] = useState(false)
//   const [loading, setLoading] = useState(false)
//   const ref = useRef<HTMLDivElement>(null)

//   useEffect(() => { setQuery(value) }, [value])
//   useEffect(() => {
//     if (!open) return
//     const t = setTimeout(async () => {
//       setLoading(true)
//       try { setOptions(await fetchOptions(query)) } catch { setOptions([]) } finally { setLoading(false) }
//     }, query.trim() === '' ? 0 : 300)
//     return () => clearTimeout(t)
//   }, [query, open, fetchOptions])
//   useEffect(() => {
//     const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
//     document.addEventListener('mousedown', handler)
//     return () => document.removeEventListener('mousedown', handler)
//   }, [])

//   return (
//     <div ref={ref} className="relative">
//       <label className="block text-xs font-semibold text-slate-600 mb-1">
//         {label}{required && <span className="text-red-500 ml-0.5">*</span>}
//       </label>
//       <div className="relative">
//         <input type="text" value={query} onChange={e => { setQuery(e.target.value); onClear(); setOpen(true) }}
//           onFocus={() => setOpen(true)} placeholder={placeholder ?? 'Search...'} autoComplete="off"
//           className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white" />
//         <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
//           {loading ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
//         </span>
//       </div>
//       {open && (
//         <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
//           {options.length === 0
//             ? <div className="px-3 py-2 text-xs text-slate-400">{loading ? 'Searching…' : 'NO RESULTS FOUND'}</div>
//             : options.map(opt => (
//               <button key={opt.name} type="button" onClick={() => { onSelect(opt); setQuery(opt.label); setOpen(false) }}
//                 className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5">
//                 <span className="font-medium text-slate-800">{opt.label}</span>
//                 {opt.label !== opt.name && <span className="ml-1.5 text-xs text-slate-400">{opt.name}</span>}
//               </button>
//             ))}
//         </div>
//       )}
//     </div>
//   )
// }

// // ─── Shared ───────────────────────────────────────────────────────────────────

// const ic = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
// const lc = 'block text-xs font-semibold text-slate-600 mb-1'
// const secH = 'text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-4 first:mt-0'

// interface ChkProps { label: string; checked: boolean; onChange: (v: boolean) => void }
// const Chk = ({ label, checked, onChange }: ChkProps) => (
//   <label className="flex items-center gap-2 cursor-pointer group select-none py-0.5">
//     <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-primary border-primary' : 'border-slate-300 bg-white group-hover:border-primary/60'}`}>
//       {checked && <Check className="w-2.5 h-2.5 text-white" />}
//     </span>
//     <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
//     <span className="text-sm text-slate-700">{label}</span>
//   </label>
// )

// interface NotesProps { label?: string; value: string; onChange: (v: string) => void }
// const Notes = ({ label = 'Notes', value, onChange }: NotesProps) => (
//   <div className="mt-2">
//     <label className={lc}>{label}</label>
//     <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
//       className={`${ic} resize-none`} placeholder="Additional notes…" />
//   </div>
// )

// function nowDate() { return new Date().toISOString().slice(0, 10) }
// function nowTime() { return new Date().toTimeString().slice(0, 5) }
// function nowDatetime() {
//   const d = new Date()
//   return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`
// }

// // ─── Types ────────────────────────────────────────────────────────────────────

// interface PreAnesthesiaAssessmentModalProps {
//   admissionNo?: string
//   patient?: string
//   patientName?: string
//   onClose: () => void
//   onSuccess?: () => void
// }

// type TabId = 'general' | 'cardio_pulm' | 'hepatic_renal_endo' | 'hemat_neuro_gi' | 'history_final' | 'signature'

// const TABS: { id: TabId; label: string }[] = [
//   { id: 'general',           label: 'General' },
//   { id: 'cardio_pulm',       label: 'Cardio & Pulmonary' },
//   { id: 'hepatic_renal_endo',label: 'Hepatic / Renal / Endocrine' },
//   { id: 'hemat_neuro_gi',    label: 'Hemat / Neuro / GI' },
//   { id: 'history_final',     label: 'History & Assessment' },
//   { id: 'signature',         label: 'Signature' },
// ]

// // ─── Modal ────────────────────────────────────────────────────────────────────

// export const PreAnesthesiaAssessmentModal = ({
//   admissionNo = '',
//   patient = '',
//   patientName = '',
//   onClose,
//   onSuccess,
// }: PreAnesthesiaAssessmentModalProps) => {
//   const [activeTab, setActiveTab] = useState<TabId>('general')
//   const [submitting, setSubmitting] = useState(false)

//   // ── General
//   const [admissionField, setAdmissionField] = useState(admissionNo)
//   const [patientVisit, setPatientVisit] = useState('')
//   const [patientVisitLabel, setPatientVisitLabel] = useState('')
//   const [patientField, setPatientField] = useState(patient)
//   const [patientNameField, setPatientNameField] = useState(patientName || '')
//   const isLockedContext = Boolean(admissionNo)
//   const [assessmentDate, setAssessmentDate] = useState(nowDatetime())
//   const [asaClass, setAsaClass] = useState('')

//   // ── Cardiovascular
//   const [exerciseTolerance, setExerciseTolerance] = useState(false)
//   const [cvNormal, setCvNormal] = useState(false)
//   const [hypertension, setHypertension] = useState(false)
//   const [anginaMi, setAnginaMi] = useState(false)
//   const [ccf, setCcf] = useState(false)
//   const [vascularValvular, setVascularValvular] = useState(false)
//   const [pacemaker, setPacemaker] = useState(false)
//   const [cvNotes, setCvNotes] = useState('')

//   // ── Pulmonary
//   const [respNormal, setRespNormal] = useState(false)
//   const [smoker, setSmoker] = useState(false)
//   const [smokingYears, setSmokingYears] = useState('')
//   const [chronicCough, setChronicCough] = useState(false)
//   const [sob, setSob] = useState(false)
//   const [copdEmphysema, setCopdEmphysema] = useState(false)
//   const [asthmaBronchitis, setAsthmaBronchitis] = useState(false)
//   const [urtiTb, setUrtiTb] = useState(false)
//   const [respNotes, setRespNotes] = useState('')

//   // ── Hepatic
//   const [jaundiceHepatitis, setJaundiceHepatitis] = useState(false)
//   const [cirrhosis, setCirrhosis] = useState(false)
//   const [gallBladder, setGallBladder] = useState(false)
//   const [etoh, setEtoh] = useState(false)
//   const [chemical, setChemical] = useState(false)
//   const [hepaticNotes, setHepaticNotes] = useState('')

//   // ── Renal
//   const [renalFailure, setRenalFailure] = useState(false)
//   const [dialysis, setDialysis] = useState(false)
//   const [renalCalculi, setRenalCalculi] = useState(false)
//   const [recentUti, setRecentUti] = useState(false)
//   const [renalNotes, setRenalNotes] = useState('')

//   // ── Endocrine
//   const [diabetes, setDiabetes] = useState(false)
//   const [dietControl, setDietControl] = useState(false)
//   const [oralAgent, setOralAgent] = useState(false)
//   const [insulin, setInsulin] = useState(false)
//   const [dmComplications, setDmComplications] = useState(false)
//   const [thyroid, setThyroid] = useState(false)
//   const [endocrineNotes, setEndocrineNotes] = useState('')

//   // ── Hematology
//   const [coagulopathy, setCoagulopathy] = useState(false)
//   const [anemia, setAnemia] = useState(false)
//   const [sickleCell, setSickleCell] = useState(false)
//   const [g6pd, setG6pd] = useState(false)
//   const [anticoagulation, setAnticoagulation] = useState(false)
//   const [bloodTransfusion, setBloodTransfusion] = useState(false)
//   const [hematologyNotes, setHematologyNotes] = useState('')

//   // ── Neurology
//   const [seizure, setSeizure] = useState(false)
//   const [strokeTia, setStrokeTia] = useState(false)
//   const [headInjury, setHeadInjury] = useState(false)
//   const [paraesthesia, setParaesthesia] = useState(false)
//   const [mentalStatus, setMentalStatus] = useState(false)
//   const [neurologyNotes, setNeurologyNotes] = useState('')

//   // ── Miscellaneous
//   const [pregnancyLmp, setPregnancyLmp] = useState(false)
//   const [illnessPregnancy, setIllnessPregnancy] = useState(false)
//   const [congenital, setCongenital] = useState(false)
//   const [hivHbsag, setHivHbsag] = useState(false)
//   const [drugAllergy, setDrugAllergy] = useState(false)
//   const [miscNotes, setMiscNotes] = useState('')

//   // ── Gastrointestinal
//   const [reflux, setReflux] = useState(false)
//   const [nauseaVomiting, setNauseaVomiting] = useState(false)
//   const [ulcer, setUlcer] = useState(false)
//   const [giNotes, setGiNotes] = useState('')

//   // ── History
//   const [surgicalHistory, setSurgicalHistory] = useState('')
//   const [anesthesiaHistory, setAnesthesiaHistory] = useState('')
//   const [anesthesiaComplications, setAnesthesiaComplications] = useState('')

//   // ── Final Assessment
//   const [fitForAnesthesia, setFitForAnesthesia] = useState('')
//   const [riskLevel, setRiskLevel] = useState('')
//   const [allergies, setAllergies] = useState('')
//   const [currentMedications, setCurrentMedications] = useState('')
//   const [prevAnesthesiaComplications, setPrevAnesthesiaComplications] = useState('')
//   const [remarks, setRemarks] = useState('')

//   // ── Signature
//   const [anesthesiologistId, setAnesthesiologistId] = useState('')
//   const [anesthesiologistLabel, setAnesthesiologistLabel] = useState('')
//   const [anesthesiologistName, setAnesthesiologistName] = useState('')
//   const [signDate, setSignDate] = useState(nowDate())
//   const [signTime, setSignTime] = useState(nowTime())
//   const [signUrl, setSignUrl] = useState('')
//   const [signUploading, setSignUploading] = useState(false)

//   const fetchVisits = useCallback(
//     (search: string) => fetchPatientVisits(patientField, search || undefined),
//     [patientField]
//   )

//   const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
//   const fetchAdmissionOpts = useCallback(
//     (s: string) => fetchInpatientAdmissionOptions(s || undefined, patientField || undefined),
//     [patientField]
//   )

//   const fetchPractitioners = useCallback(
//     (search: string) => fetchHealthcarePractitioners(search || undefined),
//     []
//   )

//   const handlePractitionerSelect = async (opt: LinkFieldOption) => {
//     setAnesthesiologistId(opt.name)
//     setAnesthesiologistLabel(opt.label)
//     // Auto-fill name from label
//     setAnesthesiologistName(opt.label !== opt.name ? opt.label : '')
//   }

//   const handleSignSave = async (file: File) => {
//     setSignUploading(true)
//     try {
//       const url = await uploadPatientFile(file)
//       setSignUrl(url)
//     } catch {
//       toast.error('Failed to upload signature.')
//     } finally {
//       setSignUploading(false)
//     }
//   }

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault(); e.stopPropagation()
//     if (!asaClass) { toast.error('ASA Classification is required.'); setActiveTab('general'); return }
//     setSubmitting(true)
//     try {
//       const payload = {
//         inpatient_admission: admissionField || undefined,
//         patient_visit: patientVisit || undefined,
//         patient: patientField || undefined,
//         patient_name: patientNameField || undefined,
//         assessment_date: assessmentDate || undefined,
//         asa_class: asaClass || undefined,
//         // Cardiovascular
//         exercise_tolerance: exerciseTolerance ? 1 : 0,
//         cv_normal: cvNormal ? 1 : 0,
//         hypertension_dysrhythmia: hypertension ? 1 : 0,
//         angina_mi: anginaMi ? 1 : 0,
//         ccf: ccf ? 1 : 0,
//         vascular_valvular: vascularValvular ? 1 : 0,
//         pacemaker: pacemaker ? 1 : 0,
//         cv_notes: cvNotes || undefined,
//         // Pulmonary
//         resp_normal: respNormal ? 1 : 0,
//         smoker: smoker ? 1 : 0,
//         smoking_years: smokingYears || undefined,
//         chronic_cough: chronicCough ? 1 : 0,
//         sob: sob ? 1 : 0,
//         copd_emphysema: copdEmphysema ? 1 : 0,
//         asthma_bronchitis: asthmaBronchitis ? 1 : 0,
//         urti_tb: urtiTb ? 1 : 0,
//         resp_notes: respNotes || undefined,
//         // Hepatic
//         jaundice_hepatitis: jaundiceHepatitis ? 1 : 0,
//         cirrhosis: cirrhosis ? 1 : 0,
//         gall_bladder: gallBladder ? 1 : 0,
//         etoh_consumption: etoh ? 1 : 0,
//         chemical_substances: chemical ? 1 : 0,
//         hepatic_notes: hepaticNotes || undefined,
//         // Renal
//         renal_failure: renalFailure ? 1 : 0,
//         dialysis: dialysis ? 1 : 0,
//         renal_calculi: renalCalculi ? 1 : 0,
//         recent_uti: recentUti ? 1 : 0,
//         renal_notes: renalNotes || undefined,
//         // Endocrine
//         diabetes: diabetes ? 1 : 0,
//         diet_control: dietControl ? 1 : 0,
//         oral_agent: oralAgent ? 1 : 0,
//         insulin: insulin ? 1 : 0,
//         dm_complications: dmComplications ? 1 : 0,
//         thyroid: thyroid ? 1 : 0,
//         endocrine_notes: endocrineNotes || undefined,
//         // Hematology
//         coagulopathy: coagulopathy ? 1 : 0,
//         anemia: anemia ? 1 : 0,
//         sickle_cell: sickleCell ? 1 : 0,
//         g6pd: g6pd ? 1 : 0,
//         anticoagulation: anticoagulation ? 1 : 0,
//         blood_transfusion: bloodTransfusion ? 1 : 0,
//         hematology_notes: hematologyNotes || undefined,
//         // Neurology
//         seizure: seizure ? 1 : 0,
//         stroke_tia: strokeTia ? 1 : 0,
//         head_injury: headInjury ? 1 : 0,
//         paraesthesia: paraesthesia ? 1 : 0,
//         mental_status: mentalStatus ? 1 : 0,
//         neurology_notes: neurologyNotes || undefined,
//         // Miscellaneous
//         pregnancy_lmp: pregnancyLmp ? 1 : 0,
//         illness_and_pregnancy: illnessPregnancy ? 1 : 0,
//         congenital: congenital ? 1 : 0,
//         hiv_hbsag: hivHbsag ? 1 : 0,
//         drug_allergy: drugAllergy ? 1 : 0,
//         miscellaneous_notes: miscNotes || undefined,
//         // GI
//         reflux: reflux ? 1 : 0,
//         nausea_vomiting: nauseaVomiting ? 1 : 0,
//         ulcer: ulcer ? 1 : 0,
//         gi_notes: giNotes || undefined,
//         // History
//         surgical_history: surgicalHistory || undefined,
//         anesthesia_history: anesthesiaHistory || undefined,
//         anesthesia_complications: anesthesiaComplications || undefined,
//         // Final
//         fit_for_anesthesia: fitForAnesthesia || undefined,
//         risk_level: riskLevel || undefined,
//         allergies: allergies || undefined,
//         current_medications: currentMedications || undefined,
//         previous_anesthesia_complications: prevAnesthesiaComplications || undefined,
//         remarks: remarks || undefined,
//         // Signature
//         anesthesiologist: anesthesiologistId || undefined,
//         anesthesiologist_name: anesthesiologistName || undefined,
//         sign: signUrl || undefined,
//         date: signDate || undefined,
//         time: signTime || undefined,
//       }
//       await apiRequest('/api/resource/Pre%20Anesthesia%20Assessment', {
//         method: 'POST',
//         body: JSON.stringify({ data: payload }),
//       })
//       toast.success('Pre Anesthesia Assessment saved successfully.')
//       onSuccess?.()
//       onClose()
//     } catch (err) {
//       toast.error(err instanceof Error ? err.message : 'Failed to save record.')
//     } finally {
//       setSubmitting(false)
//     }
//   }

//   const currentTabIdx = TABS.findIndex(t => t.id === activeTab)

//   // Count ticked items per clinical tab for badge
//   const cardioCount = [exerciseTolerance, cvNormal, hypertension, anginaMi, ccf, vascularValvular, pacemaker].filter(Boolean).length
//   const pulmCount = [respNormal, smoker, chronicCough, sob, copdEmphysema, asthmaBronchitis, urtiTb].filter(Boolean).length
//   const hepaticCount = [jaundiceHepatitis, cirrhosis, gallBladder, etoh, chemical].filter(Boolean).length
//   const renalCount = [renalFailure, dialysis, renalCalculi, recentUti].filter(Boolean).length
//   const endoCount = [diabetes, dietControl, oralAgent, insulin, dmComplications, thyroid].filter(Boolean).length
//   const hematCount = [coagulopathy, anemia, sickleCell, g6pd, anticoagulation, bloodTransfusion].filter(Boolean).length
//   const neuroCount = [seizure, strokeTia, headInjury, paraesthesia, mentalStatus].filter(Boolean).length
//   const miscCount = [pregnancyLmp, illnessPregnancy, congenital, hivHbsag, drugAllergy].filter(Boolean).length
//   const giCount = [reflux, nauseaVomiting, ulcer].filter(Boolean).length

//   const tabBadges: Partial<Record<TabId, number>> = {
//     cardio_pulm: cardioCount + pulmCount,
//     hepatic_renal_endo: hepaticCount + renalCount + endoCount,
//     hemat_neuro_gi: hematCount + neuroCount + miscCount + giCount,
//   }

//   return (
//     <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
//       onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
//       <div className="absolute inset-0 bg-black/50" />
//       <div className="relative z-10 w-full max-w-3xl max-h-[92vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
//         onMouseDown={e => e.stopPropagation()}>

//         {/* Header */}
//         <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
//           <div>
//             <h2 className="text-lg font-bold text-slate-900">Pre Anesthesia Assessment</h2>
//             <p className="text-xs text-slate-500 mt-0.5">
//               {patientName ? `${patientName} · ` : ''}{admissionNo || 'New Record'}
//             </p>
//           </div>
//           <button type="button" onClick={onClose}
//             className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 ml-4 shrink-0"
//             aria-label="Close"><X className="w-5 h-5" /></button>
//         </div>

//         {/* Tabs */}
//         <div className="flex border-b border-slate-200 bg-white overflow-x-auto shrink-0">
//           {TABS.map(tab => {
//             const badge = tabBadges[tab.id]
//             return (
//               <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
//                 className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
//                   activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
//                 }`}>
//                 {tab.label}
//                 {badge !== undefined && badge > 0 && (
//                   <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
//                     {badge}
//                   </span>
//                 )}
//                 {tab.id === 'signature' && signUrl && (
//                   <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center shrink-0">
//                     <Check className="w-2.5 h-2.5 text-white" />
//                   </span>
//                 )}
//               </button>
//             )
//           })}
//         </div>

//         {/* Body */}
//         <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto">
//           <div className="px-6 py-5">

//             {/* ── Tab 1: General ── */}
//             {activeTab === 'general' && (
//               <div className="space-y-5">
//                 <div>
//                   <p className={`${lc.replace('mb-1','mb-3')} text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5`}>Basic Information</p>
//                   <div className="grid grid-cols-2 gap-4">
//                     {isLockedContext ? (
//                       <div>
//                         <label className={lc}>Inpatient Admission</label>
//                         <input type="text" value={admissionField} readOnly className={`${ic} bg-slate-100 cursor-not-allowed`} />
//                       </div>
//                     ) : (
//                       <LinkCombobox
//                         label="Inpatient Admission"
//                         value={admissionField}
//                         onSelect={opt => setAdmissionField(opt.name)}
//                         onClear={() => setAdmissionField('')}
//                         fetchOptions={fetchAdmissionOpts}
//                         placeholder="Search admissions..."
//                       />
//                     )}
//                     <LinkCombobox label="Patient Visit" value={patientVisitLabel}
//                       onSelect={opt => { setPatientVisit(opt.name); setPatientVisitLabel(opt.label) }}
//                       onClear={() => { setPatientVisit(''); setPatientVisitLabel('') }}
//                       fetchOptions={fetchVisits} placeholder="Search patient visits..." />
//                     {isLockedContext ? (
//                       <div>
//                         <label className={lc}>Patient</label>
//                         <input type="text" value={patientField} readOnly className={`${ic} bg-slate-100 cursor-not-allowed`} />
//                       </div>
//                     ) : (
//                       <LinkCombobox
//                         label="Patient"
//                         value={patientNameField || patientField}
//                         onSelect={opt => { setPatientField(opt.name); setPatientNameField(opt.label) }}
//                         onClear={() => { setPatientField(''); setPatientNameField('') }}
//                         fetchOptions={fetchPatientOpts}
//                         placeholder="Search patients..."
//                       />
//                     )}
//                     <div>
//                       <label className={lc}>Patient Name</label>
//                       <input type="text" value={patientNameField} readOnly className={`${ic} bg-slate-100 cursor-not-allowed`} />
//                     </div>
//                     <div>
//                       <label className={lc}>Assessment Date / Time <span className="text-red-500">*</span></label>
//                       <input type="datetime-local" value={assessmentDate.replace(' ', 'T')}
//                         onChange={e => setAssessmentDate(e.target.value.replace('T', ' '))}
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>ASA Classification <span className="text-red-500">*</span></label>
//                       <select value={asaClass} onChange={e => setAsaClass(e.target.value)} className={ic}>
//                         <option value="">— Select —</option>
//                         {['ASA I','ASA II','ASA III','ASA IV','ASA V','ASA VI'].map(o => (
//                           <option key={o} value={o}>{o}</option>
//                         ))}
//                       </select>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 2: Cardiovascular & Pulmonary ── */}
//             {activeTab === 'cardio_pulm' && (
//               <div className="space-y-6">
//                 {/* Cardiovascular */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>❤️ Cardiovascular System</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Exercise Tolerance" checked={exerciseTolerance} onChange={setExerciseTolerance} />
//                     <Chk label="No Cardiovascular Disease" checked={cvNormal} onChange={setCvNormal} />
//                     <Chk label="Hypertension / Dysrhythmia" checked={hypertension} onChange={setHypertension} />
//                     <Chk label="Angina / MI" checked={anginaMi} onChange={setAnginaMi} />
//                     <Chk label="Congestive Cardiac Failure" checked={ccf} onChange={setCcf} />
//                     <Chk label="Vascular / Valvular Disease" checked={vascularValvular} onChange={setVascularValvular} />
//                     <Chk label="Pacemaker" checked={pacemaker} onChange={setPacemaker} />
//                   </div>
//                   <Notes label="Cardiovascular Notes" value={cvNotes} onChange={setCvNotes} />
//                 </div>

//                 {/* Pulmonary */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>🫁 Pulmonary System</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="No Respiratory Disease" checked={respNormal} onChange={setRespNormal} />
//                     <Chk label="Smoker" checked={smoker} onChange={setSmoker} />
//                     <Chk label="Chronic Cough" checked={chronicCough} onChange={setChronicCough} />
//                     <Chk label="Shortness of Breath" checked={sob} onChange={setSob} />
//                     <Chk label="COPD / Emphysema" checked={copdEmphysema} onChange={setCopdEmphysema} />
//                     <Chk label="Asthma / Bronchitis" checked={asthmaBronchitis} onChange={setAsthmaBronchitis} />
//                     <Chk label="URTI / Pneumonia / TB" checked={urtiTb} onChange={setUrtiTb} />
//                   </div>
//                   {smoker && (
//                     <div className="mb-3 max-w-xs">
//                       <label className={lc}>Years (Quit)</label>
//                       <input type="text" value={smokingYears} onChange={e => setSmokingYears(e.target.value)}
//                         placeholder="e.g. 5 years ago" className={ic} />
//                     </div>
//                   )}
//                   <Notes label="Respiratory Notes" value={respNotes} onChange={setRespNotes} />
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 3: Hepatic / Renal / Endocrine ── */}
//             {activeTab === 'hepatic_renal_endo' && (
//               <div className="space-y-6">
//                 {/* Hepatic */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>🫀 Hepatic System</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Jaundice / Hepatitis / HBsAg" checked={jaundiceHepatitis} onChange={setJaundiceHepatitis} />
//                     <Chk label="Cirrhosis" checked={cirrhosis} onChange={setCirrhosis} />
//                     <Chk label="Gall Bladder Disease" checked={gallBladder} onChange={setGallBladder} />
//                     <Chk label="ETOH Consumption" checked={etoh} onChange={setEtoh} />
//                     <Chk label="Chemical Substances" checked={chemical} onChange={setChemical} />
//                   </div>
//                   <Notes label="Hepatic Notes" value={hepaticNotes} onChange={setHepaticNotes} />
//                 </div>

//                 {/* Renal */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>🫘 Renal System</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Insufficiency / Failure" checked={renalFailure} onChange={setRenalFailure} />
//                     <Chk label="Dialysis (Hemo/CAPD)" checked={dialysis} onChange={setDialysis} />
//                     <Chk label="Calculi" checked={renalCalculi} onChange={setRenalCalculi} />
//                     <Chk label="Recent UTI" checked={recentUti} onChange={setRecentUti} />
//                   </div>
//                   <Notes label="Renal Notes" value={renalNotes} onChange={setRenalNotes} />
//                 </div>

//                 {/* Endocrine */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>⚡ Endocrine System</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Diabetes" checked={diabetes} onChange={setDiabetes} />
//                     <Chk label="Diet Control" checked={dietControl} onChange={setDietControl} />
//                     <Chk label="Oral Agent" checked={oralAgent} onChange={setOralAgent} />
//                     <Chk label="Insulin" checked={insulin} onChange={setInsulin} />
//                     <Chk label="DM Complications" checked={dmComplications} onChange={setDmComplications} />
//                     <Chk label="Thyroid Disease" checked={thyroid} onChange={setThyroid} />
//                   </div>
//                   <Notes label="Endocrine Notes" value={endocrineNotes} onChange={setEndocrineNotes} />
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 4: Hematology / Neurology / GI / Misc ── */}
//             {activeTab === 'hemat_neuro_gi' && (
//               <div className="space-y-6">
//                 {/* Hematology */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>🩸 Hematology</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Coagulopathy / Family History" checked={coagulopathy} onChange={setCoagulopathy} />
//                     <Chk label="Anemia" checked={anemia} onChange={setAnemia} />
//                     <Chk label="Sickle Cell Disease" checked={sickleCell} onChange={setSickleCell} />
//                     <Chk label="G6PD Deficiency" checked={g6pd} onChange={setG6pd} />
//                     <Chk label="On Anticoagulation" checked={anticoagulation} onChange={setAnticoagulation} />
//                     <Chk label="Previous Blood Transfusion" checked={bloodTransfusion} onChange={setBloodTransfusion} />
//                   </div>
//                   <Notes label="Hematology Notes" value={hematologyNotes} onChange={setHematologyNotes} />
//                 </div>

//                 {/* Neurology */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>🧠 Neurology</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Seizure Disorder" checked={seizure} onChange={setSeizure} />
//                     <Chk label="Stroke / TIA" checked={strokeTia} onChange={setStrokeTia} />
//                     <Chk label="Head Injury" checked={headInjury} onChange={setHeadInjury} />
//                     <Chk label="Paraesthesia / Paralysis" checked={paraesthesia} onChange={setParaesthesia} />
//                     <Chk label="Psychiatric / Mental Status" checked={mentalStatus} onChange={setMentalStatus} />
//                   </div>
//                   <Notes label="Neurology Notes" value={neurologyNotes} onChange={setNeurologyNotes} />
//                 </div>

//                 {/* Miscellaneous */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>📋 Miscellaneous</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Pregnancy LMP" checked={pregnancyLmp} onChange={setPregnancyLmp} />
//                     <Chk label="Illness and Pregnancy" checked={illnessPregnancy} onChange={setIllnessPregnancy} />
//                     <Chk label="Congenital Abnormality" checked={congenital} onChange={setCongenital} />
//                     <Chk label="HIV / HBsAg Positive" checked={hivHbsag} onChange={setHivHbsag} />
//                     <Chk label="Drug Intake / Allergies" checked={drugAllergy} onChange={setDrugAllergy} />
//                   </div>
//                   <Notes label="Miscellaneous Notes" value={miscNotes} onChange={setMiscNotes} />
//                 </div>

//                 {/* Gastrointestinal */}
//                 <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                   <p className={secH}>🫃 Gastrointestinal</p>
//                   <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
//                     <Chk label="Hiatal Hernia / Reflux" checked={reflux} onChange={setReflux} />
//                     <Chk label="Nausea / Vomiting" checked={nauseaVomiting} onChange={setNauseaVomiting} />
//                     <Chk label="Ulcer Disease" checked={ulcer} onChange={setUlcer} />
//                   </div>
//                   <Notes label="Gastrointestinal Notes" value={giNotes} onChange={setGiNotes} />
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 5: History & Final Assessment ── */}
//             {activeTab === 'history_final' && (
//               <div className="space-y-6">
//                 {/* History */}
//                 <div>
//                   <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-4">History</p>
//                   <div className="space-y-4">
//                     <div>
//                       <label className={lc}>Surgical History</label>
//                       <textarea value={surgicalHistory} onChange={e => setSurgicalHistory(e.target.value)}
//                         rows={3} className={`${ic} resize-none`} placeholder="Previous surgical procedures…" />
//                     </div>
//                     <div>
//                       <label className={lc}>Anesthesia History</label>
//                       <textarea value={anesthesiaHistory} onChange={e => setAnesthesiaHistory(e.target.value)}
//                         rows={3} className={`${ic} resize-none`} placeholder="Prior anesthesia experience…" />
//                     </div>
//                     <div>
//                       <label className={lc}>Previous Anesthesia Complications</label>
//                       <textarea value={anesthesiaComplications} onChange={e => setAnesthesiaComplications(e.target.value)}
//                         rows={3} className={`${ic} resize-none`} placeholder="Any complications from previous anesthesia…" />
//                     </div>
//                   </div>
//                 </div>

//                 {/* Final Assessment */}
//                 <div>
//                   <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-4">Final Assessment</p>
//                   <div className="grid grid-cols-2 gap-4 mb-4">
//                     <div>
//                       <label className={lc}>Fit for Anesthesia</label>
//                       <select value={fitForAnesthesia} onChange={e => setFitForAnesthesia(e.target.value)} className={ic}>
//                         <option value="">— Select —</option>
//                         {['Yes','No','Conditional'].map(o => <option key={o} value={o}>{o}</option>)}
//                       </select>
//                     </div>
//                     <div>
//                       <label className={lc}>Risk Level</label>
//                       <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={ic}>
//                         <option value="">— Select —</option>
//                         {['Low','Moderate','High','Very High'].map(o => <option key={o} value={o}>{o}</option>)}
//                       </select>
//                     </div>
//                   </div>
//                   <div className="space-y-3">
//                     <div>
//                       <label className={lc}>Known Allergies</label>
//                       <textarea value={allergies} onChange={e => setAllergies(e.target.value)}
//                         rows={2} className={`${ic} resize-none`} placeholder="List all known allergies…" />
//                     </div>
//                     <div>
//                       <label className={lc}>Current Medications</label>
//                       <textarea value={currentMedications} onChange={e => setCurrentMedications(e.target.value)}
//                         rows={2} className={`${ic} resize-none`} placeholder="List all current medications…" />
//                     </div>
//                     <div>
//                       <label className={lc}>Previous Anesthesia Complications</label>
//                       <textarea value={prevAnesthesiaComplications} onChange={e => setPrevAnesthesiaComplications(e.target.value)}
//                         rows={2} className={`${ic} resize-none`} placeholder="Detail any past complications…" />
//                     </div>
//                     <div>
//                       <label className={lc}>Remarks / Recommendations</label>
//                       <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
//                         rows={3} className={`${ic} resize-none`} placeholder="Clinical remarks and recommendations…" />
//                     </div>
//                   </div>
//                 </div>

//                 {/* Visual summary */}
//                 {fitForAnesthesia && (
//                   <div className={`rounded-lg border p-3 flex items-center gap-3 ${
//                     fitForAnesthesia === 'Yes' ? 'bg-green-50 border-green-300' :
//                     fitForAnesthesia === 'Conditional' ? 'bg-amber-50 border-amber-300' :
//                     'bg-red-50 border-red-300'
//                   }`}>
//                     <span className={`text-2xl font-black ${
//                       fitForAnesthesia === 'Yes' ? 'text-green-600' :
//                       fitForAnesthesia === 'Conditional' ? 'text-amber-600' : 'text-red-600'
//                     }`}>{fitForAnesthesia === 'Yes' ? '✓' : fitForAnesthesia === 'Conditional' ? '⚠' : '✕'}</span>
//                     <div>
//                       <p className="text-sm font-bold text-slate-800">Fit for Anesthesia: {fitForAnesthesia}</p>
//                       {riskLevel && <p className="text-xs text-slate-600">Risk Level: {riskLevel}</p>}
//                     </div>
//                   </div>
//                 )}
//               </div>
//             )}

//             {/* ── Tab 6: Signature ── */}
//             {activeTab === 'signature' && (
//               <div className="space-y-5">
//                 <div>
//                   <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-4">Anesthesiologist</p>
//                   <div className="grid grid-cols-2 gap-4 mb-4">
//                     <LinkCombobox label="Anesthesiologist" value={anesthesiologistLabel}
//                       onSelect={handlePractitionerSelect}
//                       onClear={() => { setAnesthesiologistId(''); setAnesthesiologistLabel(''); setAnesthesiologistName('') }}
//                       fetchOptions={fetchPractitioners} placeholder="Search practitioners..." />
//                     <div>
//                       <label className={lc}>Anesthesiologist Name</label>
//                       <input type="text" value={anesthesiologistName}
//                         onChange={e => setAnesthesiologistName(e.target.value)}
//                         placeholder="Full name"
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Sign Date</label>
//                       <DateFilterInput value={signDate} onChange={e => setSignDate(e.target.value)} className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Sign Time</label>
//                       <input type="time" value={signTime} onChange={e => setSignTime(e.target.value)} className={ic} />
//                     </div>
//                   </div>
//                   <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                     <p className="text-xs font-semibold text-slate-600 mb-2">Signature</p>
//                     <SignaturePad
//                       onSave={handleSignSave}
//                       onClear={() => setSignUrl('')}
//                       existingUrl={signUrl}
//                       uploading={signUploading}
//                     />
//                   </div>
//                 </div>
//               </div>
//             )}
//           </div>

//           {/* Footer */}
//           <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-3 shrink-0">
//             <div className="flex gap-1">
//               {TABS.map((tab, i) => (
//                 <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
//                   className={`w-2 h-2 rounded-full transition-colors ${activeTab === tab.id ? 'bg-primary' : 'bg-slate-300 hover:bg-slate-400'}`}
//                   aria-label={`${i + 1}. ${tab.label}`} />
//               ))}
//             </div>
//             <div className="flex gap-3">
//               {currentTabIdx > 0 && (
//                 <button type="button" onClick={() => setActiveTab(TABS[currentTabIdx - 1].id)}
//                   className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50">
//                   ← Previous
//                 </button>
//               )}
//               {currentTabIdx < TABS.length - 1 && (
//                 <button type="button" onClick={() => setActiveTab(TABS[currentTabIdx + 1].id)}
//                   className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90">
//                   Next →
//                 </button>
//               )}
//               <button type="button" onClick={onClose}
//                 className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50">
//                 Cancel
//               </button>
//               <button type="submit" disabled={submitting}
//                 className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed">
//                 {submitting ? 'Saving...' : 'Save Assessment'}
//               </button>
//             </div>
//           </div>
//         </form>
//       </div>
//     </div>
//   )
// }


import { useState, useRef, useCallback, useEffect } from 'react'
import { apiRequest } from '../../services/apiClient'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { uploadPatientFile } from '../../services/patients'
import { fetchDoc, fetchHealthcarePractitioners, fetchPatientVisits, fetchPatientOptions, fetchInpatientAdmissionOptions, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { ChevronDown, PenLine, Check , FileText } from 'lucide-react'
import { useCareContext } from '../../providers/CareContextProvider'
import { parseToDatetimeLocalValue, toDatetimeLocalValue } from '../../utils/datetimeLocal'
import { localDateInputValue } from '../../utils/formatDate'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import { DateFilterInput } from '../ui/DateFilterInput'

// ─── Signature Pad ────────────────────────────────────────────────────────────

interface SignaturePadProps {
  onSave: (file: File) => void
  onClear?: () => void
  existingUrl?: string
  uploading?: boolean
}

const SignaturePad = ({ onSave, onClear, existingUrl, uploading }: SignaturePadProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [mode, setMode] = useState<'idle' | 'done'>(existingUrl ? 'done' : 'idle')

  const initCtx = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    return ctx
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * canvas.width / rect.width, y: (t.clientY - rect.top) * canvas.height / rect.height }
    }
    return { x: (e.clientX - rect.left) * canvas.width / rect.width, y: (e.clientY - rect.top) * canvas.height / rect.height }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = initCtx(); if (!ctx) return
    isDrawing.current = true
    const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = initCtx(); if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.lineTo(pos.x, pos.y); ctx.stroke()
    setHasStrokes(true)
  }

  const stopDraw = () => { isDrawing.current = false }

  const clearCanvas = () => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false); setMode('idle'); onClear?.()
  }

  const saveSignature = () => {
    canvasRef.current?.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], 'signature.png', { type: 'image/png' })
      onSave(file); setMode('done')
    }, 'image/png')
  }

  if (mode === 'done' && existingUrl) {
    return (
      <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <Check className="w-3 h-3 text-white" />
          </span>
          <span className="text-xs font-semibold text-green-700">Signature captured</span>
        </div>
        <img src={existingUrl} alt="Signature" className="max-h-16 rounded border border-green-200" />
        <button type="button" onClick={() => { setMode('idle'); setHasStrokes(false); onClear?.() }}
          className="mt-2 text-xs text-slate-500 underline hover:text-slate-700">Re-draw</button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden" style={{ height: '120px' }}>
        <canvas ref={canvasRef} width={600} height={180}
          className="w-full h-full cursor-crosshair touch-none"
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
        {!hasStrokes && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <PenLine className="w-6 h-6 text-slate-300 mb-1" />
            <p className="text-xs text-slate-400">Sign here</p>
          </div>
        )}
      </div>
      {hasStrokes && (
        <div className="flex gap-2">
          <button type="button" onClick={saveSignature} disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60">
            {uploading ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : <><Check className="w-3.5 h-3.5" />Save</>}
          </button>
          <button type="button" onClick={clearCanvas}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50">
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Link Combobox ────────────────────────────────────────────────────────────

interface LinkComboboxProps {
  label: string
  value: string
  onSelect: (opt: LinkFieldOption) => void
  onClear: () => void
  fetchOptions: (s: string) => Promise<LinkFieldOption[]>
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder, required, disabled = false }: LinkComboboxProps) => {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<LinkFieldOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])
  useEffect(() => {
    if (!open || disabled) return
    const t = setTimeout(async () => {
      setLoading(true)
      try { setOptions(await fetchOptions(query)) } catch { setOptions([]) } finally { setLoading(false) }
    }, query.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [query, open, fetchOptions, disabled])
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <input type="text" value={query} 
          onChange={e => { if (!disabled) { setQuery(e.target.value); onClear(); setOpen(true) } }}
          onFocus={() => !disabled && setOpen(true)} 
          placeholder={placeholder ?? 'Search...'} autoComplete="off"
          className={`${linkComboboxInputWithClearClass} ${disabled ? 'bg-slate-100 cursor-not-allowed' : ''}`} />
        <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
          {loading ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </div>
      {open && !disabled && (
        <div className={linkComboboxDropdownClass}>
          {options.length === 0
            ? <div className="px-3 py-2 text-xs text-slate-400">{loading ? 'Searching…' : 'NO RESULTS FOUND'}</div>
            : options.map(opt => (
              <button key={opt.name} type="button" onClick={() => { onSelect(opt); setQuery(opt.label); setOpen(false) }}
                className={linkComboboxOptionClassCompact}>
                <span className="font-medium text-slate-800">{opt.label}</span>
                {opt.label !== opt.name && <span className="ml-1.5 text-xs text-slate-400">{opt.name}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────

const ic = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
const lc = 'block text-xs font-semibold text-slate-600 mb-1'
const secH = 'text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-4 first:mt-0'

interface ChkProps { label: string; checked: boolean; onChange: (v: boolean) => void }
const Chk = ({ label, checked, onChange }: ChkProps) => (
  <label className="flex items-center gap-2 cursor-pointer group select-none py-0.5">
    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-primary border-primary' : 'border-slate-300 bg-white group-hover:border-primary/60'}`}>
      {checked && <Check className="w-2.5 h-2.5 text-white" />}
    </span>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
    <span className="text-sm text-slate-700">{label}</span>
  </label>
)

interface NotesProps { label?: string; value: string; onChange: (v: string) => void }
const Notes = ({ label = 'Notes', value, onChange }: NotesProps) => (
  <div className="mt-2">
    <label className={lc}>{label}</label>
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
      className={`${ic} resize-none`} placeholder="Additional notes…" />
  </div>
)

function nowDate() { return localDateInputValue() }
function nowTime() { return new Date().toTimeString().slice(0, 5) }
function nowDatetime() {
  return toDatetimeLocalValue().replace('T', ' ')
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreAnesthesiaAssessmentModalProps {
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

type TabId = 'general' | 'cardio_pulm' | 'hepatic_renal_endo' | 'hemat_neuro_gi' | 'history_final' | 'signature'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general',           label: 'General' },
  { id: 'cardio_pulm',       label: 'Cardio & Pulmonary' },
  { id: 'hepatic_renal_endo',label: 'Hepatic / Renal / Endocrine' },
  { id: 'hemat_neuro_gi',    label: 'Hemat / Neuro / GI' },
  { id: 'history_final',     label: 'History & Assessment' },
  { id: 'signature',         label: 'Signature' },
]

// ─── Modal ────────────────────────────────────────────────────────────────────

export const PreAnesthesiaAssessmentModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName = '',
  onClose,
  onSuccess,
}: PreAnesthesiaAssessmentModalProps) => {
  const isEdit = Boolean(editName?.trim())
  // Get context from CareContextProvider
  const { mode, activeVisit, activeAdmission, selectedPatient: contextPatient } = useCareContext()
  
  // Determine if we're in IP or OP mode based on context
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'
  
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [submitting, setSubmitting] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)

  // ── General
  const [admissionField, setAdmissionField] = useState(() => {
    if (isIPMode && activeAdmission) return activeAdmission
    return admissionNo || ''
  })
  const [patientVisit, setPatientVisit] = useState(() => {
    if (isOPMode && activeVisit) return activeVisit
    return ''
  })
  const [patientVisitLabel, setPatientVisitLabel] = useState('')
  const [patientField, setPatientField] = useState(patient || contextPatient || '')
  const [patientNameField, setPatientNameField] = useState(patientName || '')
  const isPatientLocked = Boolean(patient) || Boolean(contextPatient) || isEdit
  
  const [assessmentDate, setAssessmentDate] = useState(nowDatetime())
  const [asaClass, setAsaClass] = useState('')

  // ── Cardiovascular
  const [exerciseTolerance, setExerciseTolerance] = useState(false)
  const [cvNormal, setCvNormal] = useState(false)
  const [hypertension, setHypertension] = useState(false)
  const [anginaMi, setAnginaMi] = useState(false)
  const [ccf, setCcf] = useState(false)
  const [vascularValvular, setVascularValvular] = useState(false)
  const [pacemaker, setPacemaker] = useState(false)
  const [cvNotes, setCvNotes] = useState('')

  // ── Pulmonary
  const [respNormal, setRespNormal] = useState(false)
  const [smoker, setSmoker] = useState(false)
  const [smokingYears, setSmokingYears] = useState('')
  const [chronicCough, setChronicCough] = useState(false)
  const [sob, setSob] = useState(false)
  const [copdEmphysema, setCopdEmphysema] = useState(false)
  const [asthmaBronchitis, setAsthmaBronchitis] = useState(false)
  const [urtiTb, setUrtiTb] = useState(false)
  const [respNotes, setRespNotes] = useState('')

  // ── Hepatic
  const [jaundiceHepatitis, setJaundiceHepatitis] = useState(false)
  const [cirrhosis, setCirrhosis] = useState(false)
  const [gallBladder, setGallBladder] = useState(false)
  const [etoh, setEtoh] = useState(false)
  const [chemical, setChemical] = useState(false)
  const [hepaticNotes, setHepaticNotes] = useState('')

  // ── Renal
  const [renalFailure, setRenalFailure] = useState(false)
  const [dialysis, setDialysis] = useState(false)
  const [renalCalculi, setRenalCalculi] = useState(false)
  const [recentUti, setRecentUti] = useState(false)
  const [renalNotes, setRenalNotes] = useState('')

  // ── Endocrine
  const [diabetes, setDiabetes] = useState(false)
  const [dietControl, setDietControl] = useState(false)
  const [oralAgent, setOralAgent] = useState(false)
  const [insulin, setInsulin] = useState(false)
  const [dmComplications, setDmComplications] = useState(false)
  const [thyroid, setThyroid] = useState(false)
  const [endocrineNotes, setEndocrineNotes] = useState('')

  // ── Hematology
  const [coagulopathy, setCoagulopathy] = useState(false)
  const [anemia, setAnemia] = useState(false)
  const [sickleCell, setSickleCell] = useState(false)
  const [g6pd, setG6pd] = useState(false)
  const [anticoagulation, setAnticoagulation] = useState(false)
  const [bloodTransfusion, setBloodTransfusion] = useState(false)
  const [hematologyNotes, setHematologyNotes] = useState('')

  // ── Neurology
  const [seizure, setSeizure] = useState(false)
  const [strokeTia, setStrokeTia] = useState(false)
  const [headInjury, setHeadInjury] = useState(false)
  const [paraesthesia, setParaesthesia] = useState(false)
  const [mentalStatus, setMentalStatus] = useState(false)
  const [neurologyNotes, setNeurologyNotes] = useState('')

  // ── Miscellaneous
  const [pregnancyLmp, setPregnancyLmp] = useState(false)
  const [illnessPregnancy, setIllnessPregnancy] = useState(false)
  const [congenital, setCongenital] = useState(false)
  const [hivHbsag, setHivHbsag] = useState(false)
  const [drugAllergy, setDrugAllergy] = useState(false)
  const [miscNotes, setMiscNotes] = useState('')

  // ── Gastrointestinal
  const [reflux, setReflux] = useState(false)
  const [nauseaVomiting, setNauseaVomiting] = useState(false)
  const [ulcer, setUlcer] = useState(false)
  const [giNotes, setGiNotes] = useState('')

  // ── History
  const [surgicalHistory, setSurgicalHistory] = useState('')
  const [anesthesiaHistory, setAnesthesiaHistory] = useState('')
  const [anesthesiaComplications, setAnesthesiaComplications] = useState('')

  // ── Final Assessment
  const [fitForAnesthesia, setFitForAnesthesia] = useState('')
  const [riskLevel, setRiskLevel] = useState('')
  const [allergies, setAllergies] = useState('')
  const [currentMedications, setCurrentMedications] = useState('')
  const [prevAnesthesiaComplications, setPrevAnesthesiaComplications] = useState('')
  const [remarks, setRemarks] = useState('')

  // ── Signature
  const [anesthesiologistId, setAnesthesiologistId] = useState('')
  const [anesthesiologistLabel, setAnesthesiologistLabel] = useState('')
  const [anesthesiologistName, setAnesthesiologistName] = useState('')
  const [signDate, setSignDate] = useState(nowDate())
  const [signTime, setSignTime] = useState(nowTime())
  const [signUrl, setSignUrl] = useState('')
  const [signUploading, setSignUploading] = useState(false)

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('Pre Anesthesia Assessment', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setAdmissionField(String(doc.inpatient_admission || ''))
        const visit = String(doc.patient_visit || '')
        setPatientVisit(visit)
        setPatientVisitLabel(visit)
        setPatientField(String(doc.patient || ''))
        setPatientNameField(String(doc.patient_name || ''))
        if (doc.assessment_date) {
          setAssessmentDate(parseToDatetimeLocalValue(String(doc.assessment_date)))
        }
        setAsaClass(String(doc.asa_class || ''))
        setExerciseTolerance(docCheck(doc.exercise_tolerance))
        setCvNormal(docCheck(doc.cv_normal))
        setHypertension(docCheck(doc.hypertension_dysrhythmia))
        setAnginaMi(docCheck(doc.angina_mi))
        setCcf(docCheck(doc.ccf))
        setVascularValvular(docCheck(doc.vascular_valvular))
        setPacemaker(docCheck(doc.pacemaker))
        setCvNotes(String(doc.cv_notes || ''))
        setRespNormal(docCheck(doc.resp_normal))
        setSmoker(docCheck(doc.smoker))
        setSmokingYears(String(doc.smoking_years || ''))
        setChronicCough(docCheck(doc.chronic_cough))
        setSob(docCheck(doc.sob))
        setCopdEmphysema(docCheck(doc.copd_emphysema))
        setAsthmaBronchitis(docCheck(doc.asthma_bronchitis))
        setUrtiTb(docCheck(doc.urti_tb))
        setRespNotes(String(doc.resp_notes || ''))
        setJaundiceHepatitis(docCheck(doc.jaundice_hepatitis))
        setCirrhosis(docCheck(doc.cirrhosis))
        setGallBladder(docCheck(doc.gall_bladder))
        setEtoh(docCheck(doc.etoh_consumption))
        setChemical(docCheck(doc.chemical_substances))
        setHepaticNotes(String(doc.hepatic_notes || ''))
        setRenalFailure(docCheck(doc.renal_failure))
        setDialysis(docCheck(doc.dialysis))
        setRenalCalculi(docCheck(doc.renal_calculi))
        setRecentUti(docCheck(doc.recent_uti))
        setRenalNotes(String(doc.renal_notes || ''))
        setDiabetes(docCheck(doc.diabetes))
        setDietControl(docCheck(doc.diet_control))
        setOralAgent(docCheck(doc.oral_agent))
        setInsulin(docCheck(doc.insulin))
        setDmComplications(docCheck(doc.dm_complications))
        setThyroid(docCheck(doc.thyroid))
        setEndocrineNotes(String(doc.endocrine_notes || ''))
        setCoagulopathy(docCheck(doc.coagulopathy))
        setAnemia(docCheck(doc.anemia))
        setSickleCell(docCheck(doc.sickle_cell))
        setG6pd(docCheck(doc.g6pd))
        setAnticoagulation(docCheck(doc.anticoagulation))
        setBloodTransfusion(docCheck(doc.blood_transfusion))
        setHematologyNotes(String(doc.hematology_notes || ''))
        setSeizure(docCheck(doc.seizure))
        setStrokeTia(docCheck(doc.stroke_tia))
        setHeadInjury(docCheck(doc.head_injury))
        setParaesthesia(docCheck(doc.paraesthesia))
        setMentalStatus(docCheck(doc.mental_status))
        setNeurologyNotes(String(doc.neurology_notes || ''))
        setPregnancyLmp(docCheck(doc.pregnancy_lmp))
        setIllnessPregnancy(docCheck(doc.illness_and_pregnancy))
        setCongenital(docCheck(doc.congenital))
        setHivHbsag(docCheck(doc.hiv_hbsag))
        setDrugAllergy(docCheck(doc.drug_allergy))
        setMiscNotes(String(doc.miscellaneous_notes || ''))
        setReflux(docCheck(doc.reflux))
        setNauseaVomiting(docCheck(doc.nausea_vomiting))
        setUlcer(docCheck(doc.ulcer))
        setGiNotes(String(doc.gi_notes || ''))
        setSurgicalHistory(String(doc.surgical_history || ''))
        setAnesthesiaHistory(String(doc.anesthesia_history || ''))
        setAnesthesiaComplications(String(doc.anesthesia_complications || ''))
        setFitForAnesthesia(String(doc.fit_for_anesthesia || ''))
        setRiskLevel(String(doc.risk_level || ''))
        setAllergies(String(doc.allergies || ''))
        setCurrentMedications(String(doc.current_medications || ''))
        setPrevAnesthesiaComplications(String(doc.previous_anesthesia_complications || ''))
        setRemarks(String(doc.remarks || ''))
        setAnesthesiologistId(String(doc.anesthesiologist || ''))
        setAnesthesiologistName(String(doc.anesthesiologist_name || ''))
        setAnesthesiologistLabel(String(doc.anesthesiologist_name || doc.anesthesiologist || ''))
        if (doc.date) setSignDate(String(doc.date).slice(0, 10))
        if (doc.time) setSignTime(String(doc.time).slice(0, 8))
        if (doc.sign) setSignUrl(String(doc.sign))
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load assessment')
      })
      .finally(() => {
        if (!cancelled) setLoadingEdit(false)
      })
    return () => {
      cancelled = true
    }
  }, [editName])

  const fetchVisits = useCallback(
    (search: string) => fetchPatientVisits(patientField, search || undefined),
    [patientField]
  )

  const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
  const fetchAdmissionOpts = useCallback(
    (s: string) => fetchInpatientAdmissionOptions(s || undefined, patientField || undefined),
    [patientField]
  )

  const fetchPractitioners = useCallback(
    (search: string) => fetchHealthcarePractitioners(search || undefined),
    []
  )

  const handlePractitionerSelect = async (opt: LinkFieldOption) => {
    setAnesthesiologistId(opt.name)
    setAnesthesiologistLabel(opt.label)
    // Auto-fill name from label
    setAnesthesiologistName(opt.label !== opt.name ? opt.label : '')
  }

  const handleSignSave = async (file: File) => {
    setSignUploading(true)
    try {
      const url = await uploadPatientFile(file)
      setSignUrl(url)
    } catch {
      toast.error('Failed to upload signature.')
    } finally {
      setSignUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); e.stopPropagation()
    
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

    if (!asaClass) { toast.error('ASA Classification is required.'); setActiveTab('general'); return }
    setSubmitting(true)
    try {
      const payload = {
        inpatient_admission: admissionField || undefined,
        patient_visit: patientVisit || undefined,
        patient: patientField || undefined,
        patient_name: patientNameField || undefined,
        assessment_date: assessmentDate || undefined,
        asa_class: asaClass || undefined,
        // Cardiovascular
        exercise_tolerance: exerciseTolerance ? 1 : 0,
        cv_normal: cvNormal ? 1 : 0,
        hypertension_dysrhythmia: hypertension ? 1 : 0,
        angina_mi: anginaMi ? 1 : 0,
        ccf: ccf ? 1 : 0,
        vascular_valvular: vascularValvular ? 1 : 0,
        pacemaker: pacemaker ? 1 : 0,
        cv_notes: cvNotes || undefined,
        // Pulmonary
        resp_normal: respNormal ? 1 : 0,
        smoker: smoker ? 1 : 0,
        smoking_years: smokingYears || undefined,
        chronic_cough: chronicCough ? 1 : 0,
        sob: sob ? 1 : 0,
        copd_emphysema: copdEmphysema ? 1 : 0,
        asthma_bronchitis: asthmaBronchitis ? 1 : 0,
        urti_tb: urtiTb ? 1 : 0,
        resp_notes: respNotes || undefined,
        // Hepatic
        jaundice_hepatitis: jaundiceHepatitis ? 1 : 0,
        cirrhosis: cirrhosis ? 1 : 0,
        gall_bladder: gallBladder ? 1 : 0,
        etoh_consumption: etoh ? 1 : 0,
        chemical_substances: chemical ? 1 : 0,
        hepatic_notes: hepaticNotes || undefined,
        // Renal
        renal_failure: renalFailure ? 1 : 0,
        dialysis: dialysis ? 1 : 0,
        renal_calculi: renalCalculi ? 1 : 0,
        recent_uti: recentUti ? 1 : 0,
        renal_notes: renalNotes || undefined,
        // Endocrine
        diabetes: diabetes ? 1 : 0,
        diet_control: dietControl ? 1 : 0,
        oral_agent: oralAgent ? 1 : 0,
        insulin: insulin ? 1 : 0,
        dm_complications: dmComplications ? 1 : 0,
        thyroid: thyroid ? 1 : 0,
        endocrine_notes: endocrineNotes || undefined,
        // Hematology
        coagulopathy: coagulopathy ? 1 : 0,
        anemia: anemia ? 1 : 0,
        sickle_cell: sickleCell ? 1 : 0,
        g6pd: g6pd ? 1 : 0,
        anticoagulation: anticoagulation ? 1 : 0,
        blood_transfusion: bloodTransfusion ? 1 : 0,
        hematology_notes: hematologyNotes || undefined,
        // Neurology
        seizure: seizure ? 1 : 0,
        stroke_tia: strokeTia ? 1 : 0,
        head_injury: headInjury ? 1 : 0,
        paraesthesia: paraesthesia ? 1 : 0,
        mental_status: mentalStatus ? 1 : 0,
        neurology_notes: neurologyNotes || undefined,
        // Miscellaneous
        pregnancy_lmp: pregnancyLmp ? 1 : 0,
        illness_and_pregnancy: illnessPregnancy ? 1 : 0,
        congenital: congenital ? 1 : 0,
        hiv_hbsag: hivHbsag ? 1 : 0,
        drug_allergy: drugAllergy ? 1 : 0,
        miscellaneous_notes: miscNotes || undefined,
        // GI
        reflux: reflux ? 1 : 0,
        nausea_vomiting: nauseaVomiting ? 1 : 0,
        ulcer: ulcer ? 1 : 0,
        gi_notes: giNotes || undefined,
        // History
        surgical_history: surgicalHistory || undefined,
        anesthesia_history: anesthesiaHistory || undefined,
        anesthesia_complications: anesthesiaComplications || undefined,
        // Final
        fit_for_anesthesia: fitForAnesthesia || undefined,
        risk_level: riskLevel || undefined,
        allergies: allergies || undefined,
        current_medications: currentMedications || undefined,
        previous_anesthesia_complications: prevAnesthesiaComplications || undefined,
        remarks: remarks || undefined,
        // Signature
        anesthesiologist: anesthesiologistId || undefined,
        anesthesiologist_name: anesthesiologistName || undefined,
        sign: signUrl || undefined,
        date: signDate || undefined,
        time: signTime || undefined,
      }
      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('Pre Anesthesia Assessment', editName.trim(), payload)
        toast.success('Pre Anesthesia Assessment updated.')
      } else {
        await apiRequest('/api/resource/Pre%20Anesthesia%20Assessment', {
          method: 'POST',
          body: JSON.stringify({ data: payload }),
        })
        toast.success('Pre Anesthesia Assessment saved successfully.')
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save record.')
    } finally {
      setSubmitting(false)
    }
  }

  const currentTabIdx = TABS.findIndex(t => t.id === activeTab)

  // Count ticked items per clinical tab for badge
  const cardioCount = [exerciseTolerance, cvNormal, hypertension, anginaMi, ccf, vascularValvular, pacemaker].filter(Boolean).length
  const pulmCount = [respNormal, smoker, chronicCough, sob, copdEmphysema, asthmaBronchitis, urtiTb].filter(Boolean).length
  const hepaticCount = [jaundiceHepatitis, cirrhosis, gallBladder, etoh, chemical].filter(Boolean).length
  const renalCount = [renalFailure, dialysis, renalCalculi, recentUti].filter(Boolean).length
  const endoCount = [diabetes, dietControl, oralAgent, insulin, dmComplications, thyroid].filter(Boolean).length
  const hematCount = [coagulopathy, anemia, sickleCell, g6pd, anticoagulation, bloodTransfusion].filter(Boolean).length
  const neuroCount = [seizure, strokeTia, headInjury, paraesthesia, mentalStatus].filter(Boolean).length
  const miscCount = [pregnancyLmp, illnessPregnancy, congenital, hivHbsag, drugAllergy].filter(Boolean).length
  const giCount = [reflux, nauseaVomiting, ulcer].filter(Boolean).length

  const tabBadges: Partial<Record<TabId, number>> = {
    cardio_pulm: cardioCount + pulmCount,
    hepatic_renal_endo: hepaticCount + renalCount + endoCount,
    hemat_neuro_gi: hematCount + neuroCount + miscCount + giCount,
  }

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('w-full max-w-3xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isEdit ? 'Edit Pre-Anesthesia Assessment' : 'Pre-Anesthesia Assessment'}
          icon={<FileText className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          subtitle={
            <>
              {patientName ? `${patientName} · ` : ''}
              {isIPMode && admissionField ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">IP: {admissionField}</span> : null}
              {isOPMode && patientVisit ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OP Visit</span> : null}
              {!admissionField && !patientVisit ? 'New Record' : null}
            </>
          }
          onClose={onClose}
        >
          <div className="-mb-px mt-3 flex overflow-x-auto border-b border-emerald-100/80">
            {TABS.map(tab => {
              const badge = tabBadges[tab.id]
              return (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                  className={`${createModalTabButtonClass(activeTab === tab.id)} flex items-center gap-1.5 shrink-0`}>
                  {tab.label}
                  {badge !== undefined && badge > 0 ? (
                    <span className="inline-flex items-center justify-center min-w-[18px] rounded-full bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-700">
                      {badge}
                    </span>
                  ) : null}
                  {tab.id === 'signature' && signUrl ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 shrink-0">
                      <Check className="h-2.5 w-2.5 text-white" />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </CreateModalHeader>

        {/* Body */}
        <form onSubmit={handleSubmit} noValidate className={`${CREATE_MODAL_BODY_GRADIENT} flex-1 overflow-y-auto`}>
          <div className="px-6 py-5">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading assessment…</div>
            ) : (
            <>
            {/* ── Tab 1: General ── */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                <div>
                  <p className={`${lc.replace('mb-1','mb-3')} text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5`}>
                    Basic Information
                    {isIPMode && <span className="ml-2 text-xs font-normal text-blue-600">(IP Mode Active)</span>}
                    {isOPMode && <span className="ml-2 text-xs font-normal text-green-600">(OP Mode Active)</span>}
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Inpatient Admission - disabled in OP mode, auto-filled in IP mode */}
                    {isIPMode ? (
                      <div>
                        <label className={lc}>Inpatient Admission *</label>
                        <input 
                          type="text" 
                          value={admissionField} 
                          readOnly 
                          className={`${ic} bg-slate-100 cursor-not-allowed`} 
                        />
                        <p className="text-xs text-slate-400 mt-1">Auto-selected from IP context</p>
                      </div>
                    ) : (
                      <LinkCombobox
                        label="Inpatient Admission"
                        value={admissionField}
                        onSelect={opt => setAdmissionField(opt.name)}
                        onClear={() => setAdmissionField('')}
                        fetchOptions={fetchAdmissionOpts}
                        placeholder="Search admissions..."
                        disabled={isOPMode}
                      />
                    )}
                    
                    {/* Patient Visit - disabled in IP mode, auto-filled in OP mode */}
                    {isOPMode ? (
                      <div>
                        <label className={lc}>Patient Visit *</label>
                        <input 
                          type="text" 
                          value={patientVisitLabel || patientVisit} 
                          readOnly 
                          className={`${ic} bg-slate-100 cursor-not-allowed`} 
                        />
                        <p className="text-xs text-slate-400 mt-1">Auto-selected from OP context</p>
                      </div>
                    ) : (
                      <LinkCombobox 
                        label="Patient Visit" 
                        value={patientVisitLabel}
                        onSelect={opt => { setPatientVisit(opt.name); setPatientVisitLabel(opt.label) }}
                        onClear={() => { setPatientVisit(''); setPatientVisitLabel('') }}
                        fetchOptions={fetchVisits} 
                        placeholder="Search patient visits..." 
                        disabled={isIPMode}
                      />
                    )}
                    
                    {/* Patient field */}
                    {isPatientLocked ? (
                      <div>
                        <label className={lc}>Patient *</label>
                        <input type="text" value={patientField} readOnly className={`${ic} bg-slate-100 cursor-not-allowed`} />
                      </div>
                    ) : (
                      <LinkCombobox
                        label="Patient"
                        value={patientNameField || patientField}
                        onSelect={opt => { setPatientField(opt.name); setPatientNameField(opt.label) }}
                        onClear={() => { setPatientField(''); setPatientNameField('') }}
                        fetchOptions={fetchPatientOpts}
                        placeholder="Search patients..."
                      />
                    )}
                    
                    <div>
                      <label className={lc}>Patient Name</label>
                      <input type="text" value={patientNameField} readOnly className={`${ic} bg-slate-100 cursor-not-allowed`} />
                    </div>
                    <div>
                      <label className={lc}>Assessment Date / Time <span className="text-red-500">*</span></label>
                      <input type="datetime-local" value={assessmentDate.replace(' ', 'T')}
                        onChange={e => setAssessmentDate(e.target.value.replace('T', ' '))}
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>ASA Classification <span className="text-red-500">*</span></label>
                      <select value={asaClass} onChange={e => setAsaClass(e.target.value)} className={ic}>
                        <option value="">— Select —</option>
                        {['ASA I','ASA II','ASA III','ASA IV','ASA V','ASA VI'].map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab 2: Cardiovascular & Pulmonary ── */}
            {activeTab === 'cardio_pulm' && (
              <div className="space-y-6">
                {/* Cardiovascular */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>❤️ Cardiovascular System</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Exercise Tolerance" checked={exerciseTolerance} onChange={setExerciseTolerance} />
                    <Chk label="No Cardiovascular Disease" checked={cvNormal} onChange={setCvNormal} />
                    <Chk label="Hypertension / Dysrhythmia" checked={hypertension} onChange={setHypertension} />
                    <Chk label="Angina / MI" checked={anginaMi} onChange={setAnginaMi} />
                    <Chk label="Congestive Cardiac Failure" checked={ccf} onChange={setCcf} />
                    <Chk label="Vascular / Valvular Disease" checked={vascularValvular} onChange={setVascularValvular} />
                    <Chk label="Pacemaker" checked={pacemaker} onChange={setPacemaker} />
                  </div>
                  <Notes label="Cardiovascular Notes" value={cvNotes} onChange={setCvNotes} />
                </div>

                {/* Pulmonary */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>🫁 Pulmonary System</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="No Respiratory Disease" checked={respNormal} onChange={setRespNormal} />
                    <Chk label="Smoker" checked={smoker} onChange={setSmoker} />
                    <Chk label="Chronic Cough" checked={chronicCough} onChange={setChronicCough} />
                    <Chk label="Shortness of Breath" checked={sob} onChange={setSob} />
                    <Chk label="COPD / Emphysema" checked={copdEmphysema} onChange={setCopdEmphysema} />
                    <Chk label="Asthma / Bronchitis" checked={asthmaBronchitis} onChange={setAsthmaBronchitis} />
                    <Chk label="URTI / Pneumonia / TB" checked={urtiTb} onChange={setUrtiTb} />
                  </div>
                  {smoker && (
                    <div className="mb-3 max-w-xs">
                      <label className={lc}>Years (Quit)</label>
                      <input type="text" value={smokingYears} onChange={e => setSmokingYears(e.target.value)}
                        placeholder="e.g. 5 years ago" className={ic} />
                    </div>
                  )}
                  <Notes label="Respiratory Notes" value={respNotes} onChange={setRespNotes} />
                </div>
              </div>
            )}

            {/* ── Tab 3: Hepatic / Renal / Endocrine ── */}
            {activeTab === 'hepatic_renal_endo' && (
              <div className="space-y-6">
                {/* Hepatic */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>🫀 Hepatic System</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Jaundice / Hepatitis / HBsAg" checked={jaundiceHepatitis} onChange={setJaundiceHepatitis} />
                    <Chk label="Cirrhosis" checked={cirrhosis} onChange={setCirrhosis} />
                    <Chk label="Gall Bladder Disease" checked={gallBladder} onChange={setGallBladder} />
                    <Chk label="ETOH Consumption" checked={etoh} onChange={setEtoh} />
                    <Chk label="Chemical Substances" checked={chemical} onChange={setChemical} />
                  </div>
                  <Notes label="Hepatic Notes" value={hepaticNotes} onChange={setHepaticNotes} />
                </div>

                {/* Renal */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>🫘 Renal System</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Insufficiency / Failure" checked={renalFailure} onChange={setRenalFailure} />
                    <Chk label="Dialysis (Hemo/CAPD)" checked={dialysis} onChange={setDialysis} />
                    <Chk label="Calculi" checked={renalCalculi} onChange={setRenalCalculi} />
                    <Chk label="Recent UTI" checked={recentUti} onChange={setRecentUti} />
                  </div>
                  <Notes label="Renal Notes" value={renalNotes} onChange={setRenalNotes} />
                </div>

                {/* Endocrine */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>⚡ Endocrine System</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Diabetes" checked={diabetes} onChange={setDiabetes} />
                    <Chk label="Diet Control" checked={dietControl} onChange={setDietControl} />
                    <Chk label="Oral Agent" checked={oralAgent} onChange={setOralAgent} />
                    <Chk label="Insulin" checked={insulin} onChange={setInsulin} />
                    <Chk label="DM Complications" checked={dmComplications} onChange={setDmComplications} />
                    <Chk label="Thyroid Disease" checked={thyroid} onChange={setThyroid} />
                  </div>
                  <Notes label="Endocrine Notes" value={endocrineNotes} onChange={setEndocrineNotes} />
                </div>
              </div>
            )}

            {/* ── Tab 4: Hematology / Neurology / GI / Misc ── */}
            {activeTab === 'hemat_neuro_gi' && (
              <div className="space-y-6">
                {/* Hematology */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>🩸 Hematology</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Coagulopathy / Family History" checked={coagulopathy} onChange={setCoagulopathy} />
                    <Chk label="Anemia" checked={anemia} onChange={setAnemia} />
                    <Chk label="Sickle Cell Disease" checked={sickleCell} onChange={setSickleCell} />
                    <Chk label="G6PD Deficiency" checked={g6pd} onChange={setG6pd} />
                    <Chk label="On Anticoagulation" checked={anticoagulation} onChange={setAnticoagulation} />
                    <Chk label="Previous Blood Transfusion" checked={bloodTransfusion} onChange={setBloodTransfusion} />
                  </div>
                  <Notes label="Hematology Notes" value={hematologyNotes} onChange={setHematologyNotes} />
                </div>

                {/* Neurology */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>🧠 Neurology</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Seizure Disorder" checked={seizure} onChange={setSeizure} />
                    <Chk label="Stroke / TIA" checked={strokeTia} onChange={setStrokeTia} />
                    <Chk label="Head Injury" checked={headInjury} onChange={setHeadInjury} />
                    <Chk label="Paraesthesia / Paralysis" checked={paraesthesia} onChange={setParaesthesia} />
                    <Chk label="Psychiatric / Mental Status" checked={mentalStatus} onChange={setMentalStatus} />
                  </div>
                  <Notes label="Neurology Notes" value={neurologyNotes} onChange={setNeurologyNotes} />
                </div>

                {/* Miscellaneous */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>📋 Miscellaneous</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Pregnancy LMP" checked={pregnancyLmp} onChange={setPregnancyLmp} />
                    <Chk label="Illness and Pregnancy" checked={illnessPregnancy} onChange={setIllnessPregnancy} />
                    <Chk label="Congenital Abnormality" checked={congenital} onChange={setCongenital} />
                    <Chk label="HIV / HBsAg Positive" checked={hivHbsag} onChange={setHivHbsag} />
                    <Chk label="Drug Intake / Allergies" checked={drugAllergy} onChange={setDrugAllergy} />
                  </div>
                  <Notes label="Miscellaneous Notes" value={miscNotes} onChange={setMiscNotes} />
                </div>

                {/* Gastrointestinal */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                  <p className={secH}>🫃 Gastrointestinal</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <Chk label="Hiatal Hernia / Reflux" checked={reflux} onChange={setReflux} />
                    <Chk label="Nausea / Vomiting" checked={nauseaVomiting} onChange={setNauseaVomiting} />
                    <Chk label="Ulcer Disease" checked={ulcer} onChange={setUlcer} />
                  </div>
                  <Notes label="Gastrointestinal Notes" value={giNotes} onChange={setGiNotes} />
                </div>
              </div>
            )}

            {/* ── Tab 5: History & Final Assessment ── */}
            {activeTab === 'history_final' && (
              <div className="space-y-6">
                {/* History */}
                <div>
                  <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-4">History</p>
                  <div className="space-y-4">
                    <div>
                      <label className={lc}>Surgical History</label>
                      <textarea value={surgicalHistory} onChange={e => setSurgicalHistory(e.target.value)}
                        rows={3} className={`${ic} resize-none`} placeholder="Previous surgical procedures…" />
                    </div>
                    <div>
                      <label className={lc}>Anesthesia History</label>
                      <textarea value={anesthesiaHistory} onChange={e => setAnesthesiaHistory(e.target.value)}
                        rows={3} className={`${ic} resize-none`} placeholder="Prior anesthesia experience…" />
                    </div>
                    <div>
                      <label className={lc}>Previous Anesthesia Complications</label>
                      <textarea value={anesthesiaComplications} onChange={e => setAnesthesiaComplications(e.target.value)}
                        rows={3} className={`${ic} resize-none`} placeholder="Any complications from previous anesthesia…" />
                    </div>
                  </div>
                </div>

                {/* Final Assessment */}
                <div>
                  <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-4">Final Assessment</p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className={lc}>Fit for Anesthesia</label>
                      <select value={fitForAnesthesia} onChange={e => setFitForAnesthesia(e.target.value)} className={ic}>
                        <option value="">— Select —</option>
                        {['Yes','No','Conditional'].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lc}>Risk Level</label>
                      <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={ic}>
                        <option value="">— Select —</option>
                        {['Low','Moderate','High','Very High'].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={lc}>Known Allergies</label>
                      <textarea value={allergies} onChange={e => setAllergies(e.target.value)}
                        rows={2} className={`${ic} resize-none`} placeholder="List all known allergies…" />
                    </div>
                    <div>
                      <label className={lc}>Current Medications</label>
                      <textarea value={currentMedications} onChange={e => setCurrentMedications(e.target.value)}
                        rows={2} className={`${ic} resize-none`} placeholder="List all current medications…" />
                    </div>
                    <div>
                      <label className={lc}>Previous Anesthesia Complications</label>
                      <textarea value={prevAnesthesiaComplications} onChange={e => setPrevAnesthesiaComplications(e.target.value)}
                        rows={2} className={`${ic} resize-none`} placeholder="Detail any past complications…" />
                    </div>
                    <div>
                      <label className={lc}>Remarks / Recommendations</label>
                      <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
                        rows={3} className={`${ic} resize-none`} placeholder="Clinical remarks and recommendations…" />
                    </div>
                  </div>
                </div>

                {/* Visual summary */}
                {fitForAnesthesia && (
                  <div className={`rounded-lg border p-3 flex items-center gap-3 ${
                    fitForAnesthesia === 'Yes' ? 'bg-green-50 border-green-300' :
                    fitForAnesthesia === 'Conditional' ? 'bg-amber-50 border-amber-300' :
                    'bg-red-50 border-red-300'
                  }`}>
                    <span className={`text-2xl font-black ${
                      fitForAnesthesia === 'Yes' ? 'text-green-600' :
                      fitForAnesthesia === 'Conditional' ? 'text-amber-600' : 'text-red-600'
                    }`}>{fitForAnesthesia === 'Yes' ? '✓' : fitForAnesthesia === 'Conditional' ? '⚠' : '✕'}</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">Fit for Anesthesia: {fitForAnesthesia}</p>
                      {riskLevel && <p className="text-xs text-slate-600">Risk Level: {riskLevel}</p>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 6: Signature ── */}
            {activeTab === 'signature' && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-1.5 mb-4">Anesthesiologist</p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <LinkCombobox label="Anesthesiologist" value={anesthesiologistLabel}
                      onSelect={handlePractitionerSelect}
                      onClear={() => { setAnesthesiologistId(''); setAnesthesiologistLabel(''); setAnesthesiologistName('') }}
                      fetchOptions={fetchPractitioners} placeholder="Search doctors..." />
                    <div>
                      <label className={lc}>Anesthesiologist Name</label>
                      <input type="text" value={anesthesiologistName}
                        onChange={e => setAnesthesiologistName(e.target.value)}
                        placeholder="Full name"
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Sign Date</label>
                      <DateFilterInput value={signDate} onChange={e => setSignDate(e.target.value)} className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Sign Time</label>
                      <input type="time" value={signTime} onChange={e => setSignTime(e.target.value)} className={ic} />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                    <p className="text-xs font-semibold text-slate-600 mb-2">Signature</p>
                    <SignaturePad
                      onSave={handleSignSave}
                      onClear={() => setSignUrl('')}
                      existingUrl={signUrl}
                      uploading={signUploading}
                    />
                  </div>
                </div>
              </div>
            )}
            </>
            )}
          </div>

          {/* Footer */}
          <div className={`${CREATE_MODAL_FOOTER_STICKY} items-center justify-between`}>
            <div className="flex gap-1">
              {TABS.map((tab, i) => (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                  className={`h-2 w-2 rounded-full transition-colors ${activeTab === tab.id ? 'bg-emerald-600' : 'bg-slate-300 hover:bg-slate-400'}`}
                  aria-label={`${i + 1}. ${tab.label}`} />
              ))}
            </div>
            <div className="flex gap-3">
              {currentTabIdx > 0 && (
                <button type="button" onClick={() => setActiveTab(TABS[currentTabIdx - 1].id)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  ← Previous
                </button>
              )}
              {currentTabIdx < TABS.length - 1 && (
                <button type="button" onClick={() => setActiveTab(TABS[currentTabIdx + 1].id)} className={CM_BTN_PRIMARY}>
                  Next →
                </button>
              )}
              <button type="button" onClick={onClose} className={CM_BTN_CANCEL}>Cancel</button>
              <button type="submit"
                disabled={
                  submitting ||
                  loadingEdit ||
                  (!isEdit &&
                    ((!isIPMode && !isOPMode) ||
                      (isIPMode && !admissionField) ||
                      (isOPMode && !patientVisit)))
                }
                className={CM_BTN_PRIMARY}>
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Assessment'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}