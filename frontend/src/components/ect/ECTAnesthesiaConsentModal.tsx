// import { useState, useRef, useCallback, useEffect } from 'react'
// import { apiRequest } from '../../services/apiClient'
// import { uploadPatientFile } from '../../services/patients'
// import { fetchPatientVisits, fetchPatientOptions, fetchInpatientAdmissionOptions, type LinkFieldOption } from '../../services/common'
// import { toast } from '../../hooks/useToast'
// import { ChevronDown, PenLine, Check , FileText } from 'lucide-react'

import { CM_BTN_CANCEL, CM_BTN_PRIMARY, CREATE_MODAL_BODY_GRADIENT, CREATE_MODAL_FOOTER_STICKY, CREATE_MODAL_OVERLAY, CreateModalHeader, createModalShellClass, createModalTabButtonClass } from '../ui/CreateModalChrome'
// // ─── Signature Pad ────────────────────────────────────────────────────────────

// interface SignaturePadProps {
//   label: string
//   onSave: (file: File) => void
//   onClear?: () => void
//   existingUrl?: string
//   uploading?: boolean
// }

// const SignaturePad = ({ label, onSave, onClear, existingUrl, uploading }: SignaturePadProps) => {
//   const canvasRef = useRef<HTMLCanvasElement>(null)
//   const isDrawing = useRef(false)
//   const [hasStrokes, setHasStrokes] = useState(false)
//   const [mode, setMode] = useState<'idle' | 'drawing' | 'done'>(existingUrl ? 'done' : 'idle')

//   const initCtx = useCallback(() => {
//     const canvas = canvasRef.current
//     if (!canvas) return null
//     const ctx = canvas.getContext('2d')
//     if (!ctx) return null
//     ctx.strokeStyle = '#1e293b'
//     ctx.lineWidth = 2.2
//     ctx.lineCap = 'round'
//     ctx.lineJoin = 'round'
//     return ctx
//   }, [])

//   const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
//     const rect = canvas.getBoundingClientRect()
//     const scaleX = canvas.width / rect.width
//     const scaleY = canvas.height / rect.height
//     if ('touches' in e) {
//       const t = e.touches[0]
//       return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
//     }
//     return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
//   }

//   const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
//     e.preventDefault()
//     const canvas = canvasRef.current
//     if (!canvas) return
//     const ctx = initCtx()
//     if (!ctx) return
//     isDrawing.current = true
//     const pos = getPos(e, canvas)
//     ctx.beginPath()
//     ctx.moveTo(pos.x, pos.y)
//   }

//   const draw = (e: React.MouseEvent | React.TouchEvent) => {
//     e.preventDefault()
//     if (!isDrawing.current) return
//     const canvas = canvasRef.current
//     if (!canvas) return
//     const ctx = initCtx()
//     if (!ctx) return
//     const pos = getPos(e, canvas)
//     ctx.lineTo(pos.x, pos.y)
//     ctx.stroke()
//     setHasStrokes(true)
//   }

//   const stopDraw = () => { isDrawing.current = false }

//   const clearCanvas = () => {
//     const canvas = canvasRef.current
//     if (!canvas) return
//     const ctx = canvas.getContext('2d')
//     if (!ctx) return
//     ctx.clearRect(0, 0, canvas.width, canvas.height)
//     setHasStrokes(false)
//     setMode('idle')
//     onClear?.()
//   }

//   const saveSignature = () => {
//     const canvas = canvasRef.current
//     if (!canvas || !hasStrokes) return
//     canvas.toBlob(blob => {
//       if (!blob) return
//       const file = new File([blob], 'signature.png', { type: 'image/png' })
//       onSave(file)
//       setMode('done')
//     }, 'image/png')
//   }

//   return (
//     <div className="space-y-2">
//       <p className="text-xs font-semibold text-slate-600">{label}</p>
//       {mode === 'done' && existingUrl ? (
//         <div className="relative rounded-lg border-2 border-green-300 bg-green-50 p-3">
//           <div className="flex items-center gap-2 mb-2">
//             <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
//               <Check className="w-3 h-3 text-white" />
//             </span>
//             <span className="text-xs font-semibold text-green-700">Signature captured</span>
//           </div>
//           <img src={existingUrl} alt="Signature" className="max-h-16 rounded border border-green-200" />
//           <button type="button" onClick={() => { setMode('idle'); setHasStrokes(false); onClear?.() }}
//             className="mt-2 text-xs text-slate-500 underline hover:text-slate-700">
//             Re-draw
//           </button>
//         </div>
//       ) : (
//         <div className="space-y-2">
//           <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden"
//             style={{ height: '120px' }}>
//             <canvas
//               ref={canvasRef}
//               width={600}
//               height={180}
//               className="w-full h-full cursor-crosshair touch-none"
//               onMouseDown={startDraw}
//               onMouseMove={draw}
//               onMouseUp={stopDraw}
//               onMouseLeave={stopDraw}
//               onTouchStart={startDraw}
//               onTouchMove={draw}
//               onTouchEnd={stopDraw}
//             />
//             {!hasStrokes && (
//               <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
//                 <PenLine className="w-6 h-6 text-slate-300 mb-1" />
//                 <p className="text-xs text-slate-400">Sign here</p>
//               </div>
//             )}
//           </div>
//           <div className="flex gap-2">
//             {hasStrokes && (
//               <button type="button" onClick={saveSignature}
//                 disabled={uploading}
//                 className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60">
//                 {uploading
//                   ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
//                   : <><Check className="w-3.5 h-3.5" />Save Signature</>
//                 }
//               </button>
//             )}
//             {hasStrokes && (
//               <button type="button" onClick={clearCanvas}
//                 className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50">
//                 Clear
//               </button>
//             )}
//           </div>
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
//   fetchOptions: (search: string) => Promise<LinkFieldOption[]>
//   placeholder?: string
//   required?: boolean
// }

// const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder, required }: LinkComboboxProps) => {
//   const [query, setQuery] = useState(value)
//   const [options, setOptions] = useState<LinkFieldOption[]>([])
//   const [open, setOpen] = useState(false)
//   const [loading, setLoading] = useState(false)
//   const containerRef = useRef<HTMLDivElement>(null)

//   useEffect(() => { setQuery(value) }, [value])

//   useEffect(() => {
//     if (!open) return
//     const t = setTimeout(async () => {
//       setLoading(true)
//       try { setOptions(await fetchOptions(query)) }
//       catch { setOptions([]) }
//       finally { setLoading(false) }
//     }, query.trim() === '' ? 0 : 300)
//     return () => clearTimeout(t)
//   }, [query, open, fetchOptions])

//   useEffect(() => {
//     const handler = (e: MouseEvent) => {
//       if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
//     }
//     document.addEventListener('mousedown', handler)
//     return () => document.removeEventListener('mousedown', handler)
//   }, [])

//   const lc = 'block text-xs font-semibold text-slate-600 mb-1'
//   const ic = 'w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

//   return (
//     <div ref={containerRef} className="relative">
//       <label className={lc}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
//       <div className="relative">
//         <input type="text" value={query}
//           onChange={e => { setQuery(e.target.value); onClear(); setOpen(true) }}
//           onFocus={() => setOpen(true)}
//           placeholder={placeholder ?? 'Search...'}
//           className={ic} autoComplete="off" />
//         <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
//           {loading
//             ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
//             : <ChevronDown className="w-3.5 h-3.5" />}
//         </span>
//       </div>
//       {open && (
//         <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
//           {options.length === 0
//             ? <div className="px-3 py-2 text-xs text-slate-400">{loading ? 'Searching…' : 'NO RESULTS FOUND'}</div>
//             : options.map(opt => (
//               <button key={opt.name} type="button"
//                 className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 focus:outline-none"
//                 onClick={() => { onSelect(opt); setQuery(opt.label); setOpen(false) }}>
//                 <span className="font-medium text-slate-800">{opt.label}</span>
//                 {opt.label !== opt.name && <span className="ml-1.5 text-xs text-slate-400">{opt.name}</span>}
//               </button>
//             ))
//           }
//         </div>
//       )}
//     </div>
//   )
// }

// // ─── Helpers ──────────────────────────────────────────────────────────────────

// function nowDate() {
//   return new Date().toISOString().slice(0, 10)
// }
// function nowTime() {
//   return new Date().toTimeString().slice(0, 5)
// }

// async function fetchAnesthesiaTerms(search: string): Promise<LinkFieldOption[]> {
//   try {
//     const params = new URLSearchParams({ doctype: 'Anesthesia Terms', txt: search || '', page_length: '20' })
//     const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
//     const data = await res.json()
//     const list = Array.isArray(data?.message) ? data.message : []
//     return list.map((r: any) => ({ name: r.name, label: r.name }))
//   } catch { return [] }
// }

// async function fetchTermsContent(termName: string): Promise<string> {
//   try {
//     const res = await fetch(`/api/resource/Anesthesia%20Terms/${encodeURIComponent(termName)}`)
//     const data = await res.json()
//     return data?.data?.terms ?? data?.message?.terms ?? ''
//   } catch { return '' }
// }

// // ─── Types ────────────────────────────────────────────────────────────────────

// interface ECTAnesthesiaConsentModalProps {
//   admissionNo?: string
//   patient?: string
//   patientName?: string
//   onClose: () => void
//   onSuccess?: () => void
// }

// type TabId = 'general' | 'consent' | 'anesthesiologist' | 'patient' | 'guardian' | 'witness'

// const TABS: { id: TabId; label: string }[] = [
//   { id: 'general', label: 'General' },
//   { id: 'consent', label: 'Consent Form' },
//   { id: 'anesthesiologist', label: 'Anesthesiologist' },
//   { id: 'patient', label: 'Patient' },
//   { id: 'guardian', label: 'Guardian' },
//   { id: 'witness', label: 'Witness' },
// ]

// const lc = 'block text-xs font-semibold text-slate-600 mb-1'
// const ic = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
// const secTitle = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

// // ─── Modal ────────────────────────────────────────────────────────────────────

// export const ECTAnesthesiaConsentModal = ({
//   admissionNo = '',
//   patient = '',
//   patientName = '',
//   onClose,
//   onSuccess,
// }: ECTAnesthesiaConsentModalProps) => {
//   const [activeTab, setActiveTab] = useState<TabId>('general')
//   const [submitting, setSubmitting] = useState(false)

//   // ── General
//   const [admissionField, setAdmissionField] = useState(admissionNo)
//   const [patientVisit, setPatientVisit] = useState('')
//   const [patientVisitLabel, setPatientVisitLabel] = useState('')
//   const [patientField, setPatientField] = useState(patient)
//   const [patientNameField, setPatientNameField] = useState(patientName || '')
//   const isLockedContext = Boolean(admissionNo)

//   // ── Consent Terms
//   const [termsEnglishName, setTermsEnglishName] = useState('')
//   const [termsEnglishContent, setTermsEnglishContent] = useState('')
//   const [termsEnglishLoading, setTermsEnglishLoading] = useState(false)
//   const [termsArabicName, setTermsArabicName] = useState('')
//   const [termsArabicContent, setTermsArabicContent] = useState('')
//   const [termsArabicLoading, setTermsArabicLoading] = useState(false)

//   // ── Anesthesiologist
//   const [anesthesiologist, setAnesthesiologist] = useState('')
//   const [anesthesiologistName, setAnesthesiologistName] = useState('')
//   const [anesthesiaDate, setAnesthesiaDate] = useState(nowDate())
//   const [anesthesiaTime, setAnesthesiaTime] = useState(nowTime())
//   const [anesthesiaSignatureUrl, setAnesthesiaSignatureUrl] = useState('')
//   const [anesthesiaSignatureUploading, setAnesthesiaSignatureUploading] = useState(false)

//   // ── Patient
//   const [cprNo, setCprNo] = useState('')
//   const [patientSignatureUrl, setPatientSignatureUrl] = useState('')
//   const [patientSignatureUploading, setPatientSignatureUploading] = useState(false)

//   // ── Guardian
//   const [guardianName, setGuardianName] = useState('')
//   const [relationToPatient, setRelationToPatient] = useState('')
//   const [guardianCprNo, setGuardianCprNo] = useState('')
//   const [guardianSignDate, setGuardianSignDate] = useState(nowDate())
//   const [guardianSignTime, setGuardianSignTime] = useState(nowTime())
//   const [guardianSignatureUrl, setGuardianSignatureUrl] = useState('')
//   const [guardianSignatureUploading, setGuardianSignatureUploading] = useState(false)

//   // ── Witness
//   const [witnessName, setWitnessName] = useState('')
//   const [witnessCprNo, setWitnessCprNo] = useState('')
//   const [witnessSignDate, setWitnessSignDate] = useState(nowDate())
//   const [witnessSignTime, setWitnessSignTime] = useState(nowTime())
//   const [witnessSignatureUrl, setWitnessSignatureUrl] = useState('')
//   const [witnessSignatureUploading, setWitnessSignatureUploading] = useState(false)

//   const fetchVisits = useCallback(
//     (search: string) => fetchPatientVisits(patientField, search || undefined),
//     [patientField]
//   )

//   const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
//   const fetchAdmissionOpts = useCallback(
//     (s: string) => fetchInpatientAdmissionOptions(s || undefined, patientField || undefined),
//     [patientField]
//   )

//   // Upload helpers
//   const makeUploadHandler = (
//     fieldSetter: (url: string) => void,
//     uploadingSetter: (v: boolean) => void,
//   ) => async (file: File) => {
//     uploadingSetter(true)
//     try {
//       const url = await uploadPatientFile(file)
//       fieldSetter(url)
//     } catch {
//       toast.error('Failed to upload signature.')
//     } finally {
//       uploadingSetter(false)
//     }
//   }

//   const handleTermsEnglishSelect = async (opt: LinkFieldOption) => {
//     setTermsEnglishName(opt.name)
//     setTermsEnglishLoading(true)
//     try {
//       const content = await fetchTermsContent(opt.name)
//       setTermsEnglishContent(content)
//     } finally { setTermsEnglishLoading(false) }
//   }

//   const handleTermsArabicSelect = async (opt: LinkFieldOption) => {
//     setTermsArabicName(opt.name)
//     setTermsArabicLoading(true)
//     try {
//       const content = await fetchTermsContent(opt.name)
//       setTermsArabicContent(content)
//     } finally { setTermsArabicLoading(false) }
//   }

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault()
//     e.stopPropagation()
//     setSubmitting(true)
//     try {
//       const payload = {
//         inpatient_admission: admissionField || undefined,
//         patient_visit: patientVisit || undefined,
//         patient: patientField || undefined,
//         patient_name: patientNameField || undefined,
//         termsenglish: termsEnglishName || undefined,
//         conscious_sedation_consent_form: termsEnglishContent || undefined,
//         termsarabic: termsArabicName || undefined,
//         conscious: termsArabicContent || undefined,
//         anesthesiologist: anesthesiologist || undefined,
//         anesthesiologit_name: anesthesiologistName || undefined,
//         signature: anesthesiaSignatureUrl || undefined,
//         date: anesthesiaDate || undefined,
//         time: anesthesiaTime || undefined,
//         signature_of_the_patient: patientSignatureUrl || undefined,
//         cpr_no: cprNo || undefined,
//         patients_legal_guardian: guardianName || undefined,
//         relation_to_patient: relationToPatient || undefined,
//         guardian_cpr_no: guardianCprNo || undefined,
//         guardian_signature: guardianSignatureUrl || undefined,
//         guardian_sign_date: guardianSignDate || undefined,
//         guardian_sign_time: guardianSignTime || undefined,
//         witness_name: witnessName || undefined,
//         witness_signature: witnessSignatureUrl || undefined,
//         witness_cpr_no: witnessCprNo || undefined,
//         witness_sign_date: witnessSignDate || undefined,
//         witness_sign_time: witnessSignTime || undefined,
//       }
//       await apiRequest('/api/resource/ECT%20Anesthesia%20Consent', {
//         method: 'POST',
//         body: JSON.stringify({ data: payload }),
//       })
//       toast.success('ECT Anesthesia Consent saved successfully.')
//       onSuccess?.()
//       onClose()
//     } catch (err) {
//       toast.error(err instanceof Error ? err.message : 'Failed to save record.')
//     } finally {
//       setSubmitting(false)
//     }
//   }

//   const currentTabIdx = TABS.findIndex(t => t.id === activeTab)

//   // Badge helpers for tabs
//   const signedTabs: Record<string, boolean> = {
//     anesthesiologist: !!anesthesiaSignatureUrl,
//     patient: !!patientSignatureUrl,
//     guardian: !!guardianSignatureUrl,
//     witness: !!witnessSignatureUrl,
//   }

//   return (
//     <div
//       className="fixed inset-0 z-[60] flex items-center justify-center p-4"
//       onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
//     >
//       <div className="absolute inset-0 bg-black/50" />
//       <div
//         className="relative z-10 w-full max-w-3xl max-h-[92vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
//         onMouseDown={e => e.stopPropagation()}
//       >
//         {/* Header */}
//         <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
//           <div>
//             <h2 className="text-lg font-bold text-slate-900">ECT Anesthesia Consent</h2>
//             <p className="text-xs text-slate-500 mt-0.5">
//               {patientName ? `${patientName} · ` : ''}{admissionNo || 'New Record'}
//             </p>
//           </div>
//           <button type="button" onClick={onClose}
//             className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors ml-4 shrink-0"
//             aria-label="Close">
//             <X className="w-5 h-5" />
//           </button>
//         </div>

//         {/* Tabs */}
//         <div className="flex border-b border-slate-200 bg-white overflow-x-auto shrink-0">
//           {TABS.map(tab => (
//             <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
//               className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
//                 activeTab === tab.id
//                   ? 'border-primary text-primary'
//                   : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
//               }`}>
//               {tab.label}
//               {signedTabs[tab.id] && (
//                 <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center shrink-0">
//                   <Check className="w-2.5 h-2.5 text-white" />
//                 </span>
//               )}
//             </button>
//           ))}
//         </div>

//         {/* Body */}
//         <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto">
//           <div className="px-6 py-5 space-y-6">

//             {/* ── Tab 1: General ── */}
//             {activeTab === 'general' && (
//               <div className="space-y-5">
//                 <div>
//                   <h3 className={secTitle}>Basic Information</h3>
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
//                     <LinkCombobox
//                       label="Patient Visit"
//                       value={patientVisitLabel}
//                       onSelect={opt => { setPatientVisit(opt.name); setPatientVisitLabel(opt.label) }}
//                       onClear={() => { setPatientVisit(''); setPatientVisitLabel('') }}
//                       fetchOptions={fetchVisits}
//                       placeholder="Search patient visits..."
//                     />
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
//                       <input type="text" value={patientNameField} readOnly
//                         className={`${ic} bg-slate-100 cursor-not-allowed`} />
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 2: Consent Form ── */}
//             {activeTab === 'consent' && (
//               <div className="space-y-6">
//                 {/* English */}
//                 <div>
//                   <h3 className={secTitle}>Consent Form — English</h3>
//                   <div className="mb-3">
//                     <LinkCombobox
//                       label="Terms (English)"
//                       value={termsEnglishName}
//                       onSelect={handleTermsEnglishSelect}
//                       onClear={() => { setTermsEnglishName(''); setTermsEnglishContent('') }}
//                       fetchOptions={fetchAnesthesiaTerms}
//                       placeholder="Select English terms..."
//                     />
//                     {termsEnglishLoading && (
//                       <p className="mt-1.5 text-xs text-primary flex items-center gap-1.5">
//                         <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
//                         Loading terms content…
//                       </p>
//                     )}
//                   </div>
//                   {termsEnglishContent ? (
//                     <div className="rounded-lg border border-slate-200 bg-white">
//                       <p className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100">
//                         Conscious Sedation Consent Form
//                       </p>
//                       <div
//                         className="px-4 py-3 text-sm text-slate-700 prose prose-sm max-w-none max-h-64 overflow-y-auto"
//                         dangerouslySetInnerHTML={{ __html: termsEnglishContent }}
//                       />
//                     </div>
//                   ) : (
//                     <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center h-28">
//                       <p className="text-xs text-slate-400">Select a terms document above to preview</p>
//                     </div>
//                   )}
//                 </div>

//                 {/* Arabic */}
//                 <div>
//                   <h3 className={secTitle}>Consent Form — Arabic</h3>
//                   <div className="mb-3">
//                     <LinkCombobox
//                       label="Terms (Arabic)"
//                       value={termsArabicName}
//                       onSelect={handleTermsArabicSelect}
//                       onClear={() => { setTermsArabicName(''); setTermsArabicContent('') }}
//                       fetchOptions={fetchAnesthesiaTerms}
//                       placeholder="Select Arabic terms..."
//                     />
//                     {termsArabicLoading && (
//                       <p className="mt-1.5 text-xs text-primary flex items-center gap-1.5">
//                         <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
//                         Loading terms content…
//                       </p>
//                     )}
//                   </div>
//                   {termsArabicContent ? (
//                     <div className="rounded-lg border border-slate-200 bg-white">
//                       <p className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100">
//                         Conscious Sedation Consent Form (Arabic)
//                       </p>
//                       <div
//                         dir="rtl"
//                         className="px-4 py-3 text-sm text-slate-700 prose prose-sm max-w-none max-h-64 overflow-y-auto text-right"
//                         dangerouslySetInnerHTML={{ __html: termsArabicContent }}
//                       />
//                     </div>
//                   ) : (
//                     <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center h-28">
//                       <p className="text-xs text-slate-400">Select a terms document above to preview</p>
//                     </div>
//                   )}
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 3: Anesthesiologist ── */}
//             {activeTab === 'anesthesiologist' && (
//               <div className="space-y-5">
//                 <div>
//                   <h3 className={secTitle}>Anesthesiologist Details</h3>
//                   <div className="grid grid-cols-2 gap-4 mb-4">
//                     <div>
//                       <label className={lc}>Anesthesiologist</label>
//                       <input type="text" value={anesthesiologist}
//                         onChange={e => setAnesthesiologist(e.target.value)}
//                         placeholder="Anesthesiologist ID / Name"
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Anesthesiologist Full Name</label>
//                       <input type="text" value={anesthesiologistName}
//                         onChange={e => setAnesthesiologistName(e.target.value)}
//                         placeholder="Full name"
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Date</label>
//                       <DateFilterInput value={anesthesiaDate}
//                         onChange={e => setAnesthesiaDate(e.target.value)}
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Time</label>
//                       <input type="time" value={anesthesiaTime}
//                         onChange={e => setAnesthesiaTime(e.target.value)}
//                         className={ic} />
//                     </div>
//                   </div>
//                   <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                     <SignaturePad
//                       label="Anesthesiologist Signature"
//                       onSave={makeUploadHandler(setAnesthesiaSignatureUrl, setAnesthesiaSignatureUploading)}
//                       onClear={() => setAnesthesiaSignatureUrl('')}
//                       existingUrl={anesthesiaSignatureUrl}
//                       uploading={anesthesiaSignatureUploading}
//                     />
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 4: Patient ── */}
//             {activeTab === 'patient' && (
//               <div className="space-y-5">
//                 <div>
//                   <h3 className={secTitle}>Patient Signature</h3>
//                   <p className="text-xs text-slate-500 mb-4">
//                     By signing below, the patient acknowledges and consents to the anesthesia procedure as described in the consent form.
//                   </p>
//                   <div className="grid grid-cols-2 gap-4 mb-4">
//                     <div>
//                       <label className={lc}>Patient Name</label>
//                       <input type="text" value={patientNameField} readOnly
//                         className={`${ic} bg-slate-100 cursor-not-allowed`} />
//                     </div>
//                     <div>
//                       <label className={lc}>CPR No</label>
//                       <input type="text" value={cprNo}
//                         onChange={e => setCprNo(e.target.value)}
//                         placeholder="Patient CPR / ID number"
//                         className={ic} />
//                     </div>
//                   </div>
//                   <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                     <SignaturePad
//                       label="Patient Signature"
//                       onSave={makeUploadHandler(setPatientSignatureUrl, setPatientSignatureUploading)}
//                       onClear={() => setPatientSignatureUrl('')}
//                       existingUrl={patientSignatureUrl}
//                       uploading={patientSignatureUploading}
//                     />
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 5: Guardian ── */}
//             {activeTab === 'guardian' && (
//               <div className="space-y-5">
//                 <div>
//                   <h3 className={secTitle}>Legal Guardian</h3>
//                   <p className="text-xs text-slate-500 mb-4">
//                     Complete this section if the patient's legal guardian is signing on their behalf.
//                   </p>
//                   <div className="grid grid-cols-2 gap-4 mb-4">
//                     <div>
//                       <label className={lc}>Guardian Name</label>
//                       <input type="text" value={guardianName}
//                         onChange={e => setGuardianName(e.target.value)}
//                         placeholder="Legal guardian full name"
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Relation to Patient</label>
//                       <select value={relationToPatient}
//                         onChange={e => setRelationToPatient(e.target.value)}
//                         className={ic}>
//                         <option value="">— Select relation —</option>
//                         {['Father','Mother','Brother','Sister','Husband','Wife','Son','Daughter'].map(r => (
//                           <option key={r} value={r}>{r}</option>
//                         ))}
//                       </select>
//                     </div>
//                     <div>
//                       <label className={lc}>Guardian CPR No</label>
//                       <input type="text" value={guardianCprNo}
//                         onChange={e => setGuardianCprNo(e.target.value)}
//                         placeholder="Guardian CPR / ID number"
//                         className={ic} />
//                     </div>
//                     <div />
//                     <div>
//                       <label className={lc}>Sign Date</label>
//                       <DateFilterInput value={guardianSignDate}
//                         onChange={e => setGuardianSignDate(e.target.value)}
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Sign Time</label>
//                       <input type="time" value={guardianSignTime}
//                         onChange={e => setGuardianSignTime(e.target.value)}
//                         className={ic} />
//                     </div>
//                   </div>
//                   <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                     <SignaturePad
//                       label="Guardian Signature"
//                       onSave={makeUploadHandler(setGuardianSignatureUrl, setGuardianSignatureUploading)}
//                       onClear={() => setGuardianSignatureUrl('')}
//                       existingUrl={guardianSignatureUrl}
//                       uploading={guardianSignatureUploading}
//                     />
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 6: Witness ── */}
//             {activeTab === 'witness' && (
//               <div className="space-y-5">
//                 <div>
//                   <h3 className={secTitle}>Witness</h3>
//                   <p className="text-xs text-slate-500 mb-4">
//                     A witness must sign to confirm they were present during the consent process.
//                   </p>
//                   <div className="grid grid-cols-2 gap-4 mb-4">
//                     <div>
//                       <label className={lc}>Witness Name</label>
//                       <input type="text" value={witnessName}
//                         onChange={e => setWitnessName(e.target.value)}
//                         placeholder="Witness full name"
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Witness CPR No</label>
//                       <input type="text" value={witnessCprNo}
//                         onChange={e => setWitnessCprNo(e.target.value)}
//                         placeholder="Witness CPR / ID number"
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Sign Date</label>
//                       <DateFilterInput value={witnessSignDate}
//                         onChange={e => setWitnessSignDate(e.target.value)}
//                         className={ic} />
//                     </div>
//                     <div>
//                       <label className={lc}>Sign Time</label>
//                       <input type="time" value={witnessSignTime}
//                         onChange={e => setWitnessSignTime(e.target.value)}
//                         className={ic} />
//                     </div>
//                   </div>
//                   <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
//                     <SignaturePad
//                       label="Witness Signature"
//                       onSave={makeUploadHandler(setWitnessSignatureUrl, setWitnessSignatureUploading)}
//                       onClear={() => setWitnessSignatureUrl('')}
//                       existingUrl={witnessSignatureUrl}
//                       uploading={witnessSignatureUploading}
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
//                 {submitting ? 'Saving...' : 'Save Consent'}
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
import { fetchDoc, fetchPatientVisits, fetchPatientOptions, fetchInpatientAdmissionOptions, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { ChevronDown, PenLine, Check , FileText } from 'lucide-react'
import { useCareContext } from '../../providers/CareContextProvider'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import { DateFilterInput } from '../ui/DateFilterInput'

// ─── Signature Pad ────────────────────────────────────────────────────────────

interface SignaturePadProps {
  label: string
  onSave: (file: File) => void
  onClear?: () => void
  existingUrl?: string
  uploading?: boolean
}

const SignaturePad = ({ label, onSave, onClear, existingUrl, uploading }: SignaturePadProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [mode, setMode] = useState<'idle' | 'drawing' | 'done'>(existingUrl ? 'done' : 'idle')

  const initCtx = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    return ctx
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = initCtx()
    if (!ctx) return
    isDrawing.current = true
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = initCtx()
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasStrokes(true)
  }

  const stopDraw = () => { isDrawing.current = false }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    setMode('idle')
    onClear?.()
  }

  const saveSignature = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasStrokes) return
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], 'signature.png', { type: 'image/png' })
      onSave(file)
      setMode('done')
    }, 'image/png')
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      {mode === 'done' && existingUrl ? (
        <div className="relative rounded-lg border-2 border-green-300 bg-green-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-white" />
            </span>
            <span className="text-xs font-semibold text-green-700">Signature captured</span>
          </div>
          <img src={existingUrl} alt="Signature" className="max-h-16 rounded border border-green-200" />
          <button type="button" onClick={() => { setMode('idle'); setHasStrokes(false); onClear?.() }}
            className="mt-2 text-xs text-slate-500 underline hover:text-slate-700">
            Re-draw
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden"
            style={{ height: '120px' }}>
            <canvas
              ref={canvasRef}
              width={600}
              height={180}
              className="w-full h-full cursor-crosshair touch-none"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
            {!hasStrokes && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <PenLine className="w-6 h-6 text-slate-300 mb-1" />
                <p className="text-xs text-slate-400">Sign here</p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {hasStrokes && (
              <button type="button" onClick={saveSignature}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60">
                {uploading
                  ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                  : <><Check className="w-3.5 h-3.5" />Save Signature</>
                }
              </button>
            )}
            {hasStrokes && (
              <button type="button" onClick={clearCanvas}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50">
                Clear
              </button>
            )}
          </div>
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
  fetchOptions: (search: string) => Promise<LinkFieldOption[]>
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder, required, disabled = false }: LinkComboboxProps) => {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<LinkFieldOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    if (!open || disabled) return
    const t = setTimeout(async () => {
      setLoading(true)
      try { setOptions(await fetchOptions(query)) }
      catch { setOptions([]) }
      finally { setLoading(false) }
    }, query.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [query, open, fetchOptions, disabled])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const lc = 'block text-xs font-semibold text-slate-600 mb-1'

  return (
    <div ref={containerRef} className="relative">
      <label className={lc}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="relative">
        <input type="text" value={query}
          onChange={e => { if (!disabled) { setQuery(e.target.value); onClear(); setOpen(true) } }}
          onFocus={() => !disabled && setOpen(true)}
          placeholder={placeholder ?? 'Search...'}
          className={`${linkComboboxInputWithClearClass} ${disabled ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          disabled={disabled}
          autoComplete="off" />
        <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
          {loading
            ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </div>
      {open && !disabled && (
        <div className={linkComboboxDropdownClass}>
          {options.length === 0
            ? <div className="px-3 py-2 text-xs text-slate-400">{loading ? 'Searching…' : 'NO RESULTS FOUND'}</div>
            : options.map(opt => (
              <button key={opt.name} type="button"
                className={linkComboboxOptionClassCompact}
                onClick={() => { onSelect(opt); setQuery(opt.label); setOpen(false) }}>
                <span className="font-medium text-slate-800">{opt.label}</span>
                {opt.label !== opt.name && <span className="ml-1.5 text-xs text-slate-400">{opt.name}</span>}
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowDate() {
  return new Date().toISOString().slice(0, 10)
}
function nowTime() {
  return new Date().toTimeString().slice(0, 5)
}

async function fetchAnesthesiaTerms(search: string): Promise<LinkFieldOption[]> {
  try {
    const params = new URLSearchParams({ doctype: 'Anesthesia Terms', txt: search || '', page_length: '20' })
    const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
    const data = await res.json()
    const list = Array.isArray(data?.message) ? data.message : []
    return list.map((r: any) => ({ name: r.name, label: r.name }))
  } catch { return [] }
}

async function fetchTermsContent(termName: string): Promise<string> {
  try {
    const res = await fetch(`/api/resource/Anesthesia%20Terms/${encodeURIComponent(termName)}`)
    const data = await res.json()
    return data?.data?.terms ?? data?.message?.terms ?? ''
  } catch { return '' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ECTAnesthesiaConsentModalProps {
  /** When set, modal loads and updates this record instead of creating. */
  editName?: string
  admissionNo?: string
  patient?: string
  patientName?: string
  onClose: () => void
  onSuccess?: () => void
}

type TabId = 'general' | 'consent' | 'anesthesiologist' | 'patient' | 'guardian' | 'witness'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'consent', label: 'Consent Form' },
  { id: 'anesthesiologist', label: 'Anesthesiologist' },
  { id: 'patient', label: 'Patient' },
  { id: 'guardian', label: 'Guardian' },
  { id: 'witness', label: 'Witness' },
]

const lc = 'block text-xs font-semibold text-slate-600 mb-1'
const ic = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
const secTitle = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

// ─── Modal ────────────────────────────────────────────────────────────────────

export const ECTAnesthesiaConsentModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName = '',
  onClose,
  onSuccess,
}: ECTAnesthesiaConsentModalProps) => {
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

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('ECT Anesthesia Consent', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setAdmissionField(String(doc.inpatient_admission || ''))
        const visit = String(doc.patient_visit || '')
        setPatientVisit(visit)
        setPatientVisitLabel(visit)
        setPatientField(String(doc.patient || ''))
        setPatientNameField(String(doc.patient_name || ''))
        setTermsEnglishName(String(doc.termsenglish || ''))
        setTermsEnglishContent(String(doc.conscious_sedation_consent_form || ''))
        setTermsArabicName(String(doc.termsarabic || ''))
        setTermsArabicContent(String(doc.conscious || ''))
        setAnesthesiologist(String(doc.anesthesiologist || ''))
        setAnesthesiologistName(String(doc.anesthesiologit_name || doc.anesthesiologist_name || ''))
        if (doc.date) setAnesthesiaDate(String(doc.date).slice(0, 10))
        if (doc.time) setAnesthesiaTime(String(doc.time).slice(0, 8))
        if (doc.signature) setAnesthesiaSignatureUrl(String(doc.signature))
        if (doc.signature_of_the_patient) setPatientSignatureUrl(String(doc.signature_of_the_patient))
        setCprNo(String(doc.cpr_no || ''))
        setGuardianName(String(doc.patients_legal_guardian || ''))
        setRelationToPatient(String(doc.relation_to_patient || ''))
        setGuardianCprNo(String(doc.guardian_cpr_no || ''))
        if (doc.guardian_signature) setGuardianSignatureUrl(String(doc.guardian_signature))
        if (doc.guardian_sign_date) setGuardianSignDate(String(doc.guardian_sign_date).slice(0, 10))
        if (doc.guardian_sign_time) setGuardianSignTime(String(doc.guardian_sign_time).slice(0, 8))
        setWitnessName(String(doc.witness_name || ''))
        if (doc.witness_signature) setWitnessSignatureUrl(String(doc.witness_signature))
        setWitnessCprNo(String(doc.witness_cpr_no || ''))
        if (doc.witness_sign_date) setWitnessSignDate(String(doc.witness_sign_date).slice(0, 10))
        if (doc.witness_sign_time) setWitnessSignTime(String(doc.witness_sign_time).slice(0, 8))
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

  // ── Consent Terms
  const [termsEnglishName, setTermsEnglishName] = useState('')
  const [termsEnglishContent, setTermsEnglishContent] = useState('')
  const [termsEnglishLoading, setTermsEnglishLoading] = useState(false)
  const [termsArabicName, setTermsArabicName] = useState('')
  const [termsArabicContent, setTermsArabicContent] = useState('')
  const [termsArabicLoading, setTermsArabicLoading] = useState(false)

  // ── Anesthesiologist
  const [anesthesiologist, setAnesthesiologist] = useState('')
  const [anesthesiologistName, setAnesthesiologistName] = useState('')
  const [anesthesiaDate, setAnesthesiaDate] = useState(nowDate())
  const [anesthesiaTime, setAnesthesiaTime] = useState(nowTime())
  const [anesthesiaSignatureUrl, setAnesthesiaSignatureUrl] = useState('')
  const [anesthesiaSignatureUploading, setAnesthesiaSignatureUploading] = useState(false)

  // ── Patient
  const [cprNo, setCprNo] = useState('')
  const [patientSignatureUrl, setPatientSignatureUrl] = useState('')
  const [patientSignatureUploading, setPatientSignatureUploading] = useState(false)

  // ── Guardian
  const [guardianName, setGuardianName] = useState('')
  const [relationToPatient, setRelationToPatient] = useState('')
  const [guardianCprNo, setGuardianCprNo] = useState('')
  const [guardianSignDate, setGuardianSignDate] = useState(nowDate())
  const [guardianSignTime, setGuardianSignTime] = useState(nowTime())
  const [guardianSignatureUrl, setGuardianSignatureUrl] = useState('')
  const [guardianSignatureUploading, setGuardianSignatureUploading] = useState(false)

  // ── Witness
  const [witnessName, setWitnessName] = useState('')
  const [witnessCprNo, setWitnessCprNo] = useState('')
  const [witnessSignDate, setWitnessSignDate] = useState(nowDate())
  const [witnessSignTime, setWitnessSignTime] = useState(nowTime())
  const [witnessSignatureUrl, setWitnessSignatureUrl] = useState('')
  const [witnessSignatureUploading, setWitnessSignatureUploading] = useState(false)

  // Auto-load patient name if context exists
  useEffect(() => {
    if (contextPatient && !patientNameField) {
      // Patient name should be loaded from context
      setPatientField(contextPatient)
    }
  }, [contextPatient, patientNameField])

  const fetchVisits = useCallback(
    (search: string) => fetchPatientVisits(patientField, search || undefined),
    [patientField]
  )

  const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
  const fetchAdmissionOpts = useCallback(
    (s: string) => fetchInpatientAdmissionOptions(s || undefined, patientField || undefined),
    [patientField]
  )

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

  const handleTermsEnglishSelect = async (opt: LinkFieldOption) => {
    setTermsEnglishName(opt.name)
    setTermsEnglishLoading(true)
    try {
      const content = await fetchTermsContent(opt.name)
      setTermsEnglishContent(content)
    } finally { setTermsEnglishLoading(false) }
  }

  const handleTermsArabicSelect = async (opt: LinkFieldOption) => {
    setTermsArabicName(opt.name)
    setTermsArabicLoading(true)
    try {
      const content = await fetchTermsContent(opt.name)
      setTermsArabicContent(content)
    } finally { setTermsArabicLoading(false) }
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
      const payload = {
        inpatient_admission: admissionField || undefined,
        patient_visit: patientVisit || undefined,
        patient: patientField || undefined,
        patient_name: patientNameField || undefined,
        termsenglish: termsEnglishName || undefined,
        conscious_sedation_consent_form: termsEnglishContent || undefined,
        termsarabic: termsArabicName || undefined,
        conscious: termsArabicContent || undefined,
        anesthesiologist: anesthesiologist || undefined,
        anesthesiologit_name: anesthesiologistName || undefined,
        signature: anesthesiaSignatureUrl || undefined,
        date: anesthesiaDate || undefined,
        time: anesthesiaTime || undefined,
        signature_of_the_patient: patientSignatureUrl || undefined,
        cpr_no: cprNo || undefined,
        patients_legal_guardian: guardianName || undefined,
        relation_to_patient: relationToPatient || undefined,
        guardian_cpr_no: guardianCprNo || undefined,
        guardian_signature: guardianSignatureUrl || undefined,
        guardian_sign_date: guardianSignDate || undefined,
        guardian_sign_time: guardianSignTime || undefined,
        witness_name: witnessName || undefined,
        witness_signature: witnessSignatureUrl || undefined,
        witness_cpr_no: witnessCprNo || undefined,
        witness_sign_date: witnessSignDate || undefined,
        witness_sign_time: witnessSignTime || undefined,
      }
      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('ECT Anesthesia Consent', editName.trim(), payload)
      } else {
        await apiRequest('/api/resource/ECT%20Anesthesia%20Consent', {
          method: 'POST',
          body: JSON.stringify({ data: payload }),
        })
      }
      toast.success(isEdit ? 'ECT Anesthesia Consent updated.' : 'ECT Anesthesia Consent saved successfully.')
      onSuccess?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save record.')
    } finally {
      setSubmitting(false)
    }
  }

  const currentTabIdx = TABS.findIndex(t => t.id === activeTab)

  // Badge helpers for tabs
  const signedTabs: Record<string, boolean> = {
    anesthesiologist: !!anesthesiaSignatureUrl,
    patient: !!patientSignatureUrl,
    guardian: !!guardianSignatureUrl,
    witness: !!witnessSignatureUrl,
  }

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('w-full max-w-3xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isEdit ? 'Edit ECT Anesthesia Consent' : 'ECT Anesthesia Consent'}
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
            {TABS.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`${createModalTabButtonClass(activeTab === tab.id)} flex items-center gap-1.5 shrink-0`}>
                {tab.label}
                {signedTabs[tab.id] ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 shrink-0">
                    <Check className="h-2.5 w-2.5 text-white" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </CreateModalHeader>

        {/* Body */}
        <form onSubmit={handleSubmit} noValidate className={`${CREATE_MODAL_BODY_GRADIENT} flex-1 overflow-y-auto`}>
          <div className="px-6 py-5 space-y-6">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading consent…</div>
            ) : (
            <>
            {/* ── Tab 1: General ── */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                <div>
                  <h3 className={secTitle}>
                    Basic Information
                    {isIPMode && <span className="ml-2 text-xs font-normal text-blue-600">(IP Mode Active)</span>}
                    {isOPMode && <span className="ml-2 text-xs font-normal text-green-600">(OP Mode Active)</span>}
                  </h3>
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
                      <input type="text" value={patientNameField} readOnly
                        className={`${ic} bg-slate-100 cursor-not-allowed`} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab 2: Consent Form ── */}
            {activeTab === 'consent' && (
              <div className="space-y-6">
                {/* English */}
                <div>
                  <h3 className={secTitle}>Consent Form — English</h3>
                  <div className="mb-3">
                    <LinkCombobox
                      label="Terms (English)"
                      value={termsEnglishName}
                      onSelect={handleTermsEnglishSelect}
                      onClear={() => { setTermsEnglishName(''); setTermsEnglishContent('') }}
                      fetchOptions={fetchAnesthesiaTerms}
                      placeholder="Select English terms..."
                    />
                    {termsEnglishLoading && (
                      <p className="mt-1.5 text-xs text-primary flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        Loading terms content…
                      </p>
                    )}
                  </div>
                  {termsEnglishContent ? (
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <p className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100">
                        Conscious Sedation Consent Form
                      </p>
                      <div
                        className="px-4 py-3 text-sm text-slate-700 prose prose-sm max-w-none max-h-64 overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: termsEnglishContent }}
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center h-28">
                      <p className="text-xs text-slate-400">Select a terms document above to preview</p>
                    </div>
                  )}
                </div>

                {/* Arabic */}
                <div>
                  <h3 className={secTitle}>Consent Form — Arabic</h3>
                  <div className="mb-3">
                    <LinkCombobox
                      label="Terms (Arabic)"
                      value={termsArabicName}
                      onSelect={handleTermsArabicSelect}
                      onClear={() => { setTermsArabicName(''); setTermsArabicContent('') }}
                      fetchOptions={fetchAnesthesiaTerms}
                      placeholder="Select Arabic terms..."
                    />
                    {termsArabicLoading && (
                      <p className="mt-1.5 text-xs text-primary flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        Loading terms content…
                      </p>
                    )}
                  </div>
                  {termsArabicContent ? (
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <p className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100">
                        Conscious Sedation Consent Form (Arabic)
                      </p>
                      <div
                        dir="rtl"
                        className="px-4 py-3 text-sm text-slate-700 prose prose-sm max-w-none max-h-64 overflow-y-auto text-right"
                        dangerouslySetInnerHTML={{ __html: termsArabicContent }}
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center h-28">
                      <p className="text-xs text-slate-400">Select a terms document above to preview</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab 3: Anesthesiologist ── */}
            {activeTab === 'anesthesiologist' && (
              <div className="space-y-5">
                <div>
                  <h3 className={secTitle}>Anesthesiologist Details</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className={lc}>Anesthesiologist</label>
                      <input type="text" value={anesthesiologist}
                        onChange={e => setAnesthesiologist(e.target.value)}
                        placeholder="Anesthesiologist ID / Name"
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Anesthesiologist Full Name</label>
                      <input type="text" value={anesthesiologistName}
                        onChange={e => setAnesthesiologistName(e.target.value)}
                        placeholder="Full name"
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Date</label>
                      <DateFilterInput value={anesthesiaDate}
                        onChange={e => setAnesthesiaDate(e.target.value)}
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Time</label>
                      <input type="time" value={anesthesiaTime}
                        onChange={e => setAnesthesiaTime(e.target.value)}
                        className={ic} />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                    <SignaturePad
                      label="Anesthesiologist Signature"
                      onSave={makeUploadHandler(setAnesthesiaSignatureUrl, setAnesthesiaSignatureUploading)}
                      onClear={() => setAnesthesiaSignatureUrl('')}
                      existingUrl={anesthesiaSignatureUrl}
                      uploading={anesthesiaSignatureUploading}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab 4: Patient ── */}
            {activeTab === 'patient' && (
              <div className="space-y-5">
                <div>
                  <h3 className={secTitle}>Patient Signature</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    By signing below, the patient acknowledges and consents to the anesthesia procedure as described in the consent form.
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className={lc}>Patient Name</label>
                      <input type="text" value={patientNameField} readOnly
                        className={`${ic} bg-slate-100 cursor-not-allowed`} />
                    </div>
                    <div>
                      <label className={lc}>CPR No</label>
                      <input type="text" value={cprNo}
                        onChange={e => setCprNo(e.target.value)}
                        placeholder="Patient CPR / ID number"
                        className={ic} />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                    <SignaturePad
                      label="Patient Signature"
                      onSave={makeUploadHandler(setPatientSignatureUrl, setPatientSignatureUploading)}
                      onClear={() => setPatientSignatureUrl('')}
                      existingUrl={patientSignatureUrl}
                      uploading={patientSignatureUploading}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab 5: Guardian ── */}
            {activeTab === 'guardian' && (
              <div className="space-y-5">
                <div>
                  <h3 className={secTitle}>Legal Guardian</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Complete this section if the patient's legal guardian is signing on their behalf.
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className={lc}>Guardian Name</label>
                      <input type="text" value={guardianName}
                        onChange={e => setGuardianName(e.target.value)}
                        placeholder="Legal guardian full name"
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Relation to Patient</label>
                      <select value={relationToPatient}
                        onChange={e => setRelationToPatient(e.target.value)}
                        className={ic}>
                        <option value="">— Select relation —</option>
                        {['Father','Mother','Brother','Sister','Husband','Wife','Son','Daughter'].map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={lc}>Guardian CPR No</label>
                      <input type="text" value={guardianCprNo}
                        onChange={e => setGuardianCprNo(e.target.value)}
                        placeholder="Guardian CPR / ID number"
                        className={ic} />
                    </div>
                    <div />
                    <div>
                      <label className={lc}>Sign Date</label>
                      <DateFilterInput value={guardianSignDate}
                        onChange={e => setGuardianSignDate(e.target.value)}
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Sign Time</label>
                      <input type="time" value={guardianSignTime}
                        onChange={e => setGuardianSignTime(e.target.value)}
                        className={ic} />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                    <SignaturePad
                      label="Guardian Signature"
                      onSave={makeUploadHandler(setGuardianSignatureUrl, setGuardianSignatureUploading)}
                      onClear={() => setGuardianSignatureUrl('')}
                      existingUrl={guardianSignatureUrl}
                      uploading={guardianSignatureUploading}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab 6: Witness ── */}
            {activeTab === 'witness' && (
              <div className="space-y-5">
                <div>
                  <h3 className={secTitle}>Witness</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    A witness must sign to confirm they were present during the consent process.
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className={lc}>Witness Name</label>
                      <input type="text" value={witnessName}
                        onChange={e => setWitnessName(e.target.value)}
                        placeholder="Witness full name"
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Witness CPR No</label>
                      <input type="text" value={witnessCprNo}
                        onChange={e => setWitnessCprNo(e.target.value)}
                        placeholder="Witness CPR / ID number"
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Sign Date</label>
                      <DateFilterInput value={witnessSignDate}
                        onChange={e => setWitnessSignDate(e.target.value)}
                        className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Sign Time</label>
                      <input type="time" value={witnessSignTime}
                        onChange={e => setWitnessSignTime(e.target.value)}
                        className={ic} />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                    <SignaturePad
                      label="Witness Signature"
                      onSave={makeUploadHandler(setWitnessSignatureUrl, setWitnessSignatureUploading)}
                      onClear={() => setWitnessSignatureUrl('')}
                      existingUrl={witnessSignatureUrl}
                      uploading={witnessSignatureUploading}
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
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Consent'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}