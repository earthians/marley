

// import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
// import { apiRequest } from '../../services/apiClient'
// import { fetchPatientVisits, fetchPatientOptions, fetchInpatientAdmissionOptions, type LinkFieldOption } from '../../services/common'
// import { toast } from '../../hooks/useToast'
// import { ChevronDown, Plus, Trash2, AlertCircle , ClipboardList } from 'lucide-react'
// import { useCareContext } from '../../providers/CareContextProvider'

import { CM_BTN_CANCEL, CM_BTN_PRIMARY, CREATE_MODAL_BODY_GRADIENT, CREATE_MODAL_FOOTER_STICKY, CREATE_MODAL_OVERLAY, CreateModalHeader, createModalShellClass, createModalTabButtonClass } from '../ui/CreateModalChrome'
// // ─── Link Combobox ────────────────────────────────────────────────────────────

// interface LinkComboboxProps {
//   label: string
//   value: string
//   onSelect: (opt: LinkFieldOption) => void
//   onClear: () => void
//   fetchOptions: (search: string) => Promise<LinkFieldOption[]>
//   placeholder?: string
//   disabled?: boolean
// }

// const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder, disabled = false }: LinkComboboxProps) => {
//   const [query, setQuery] = useState(value)
//   const [options, setOptions] = useState<LinkFieldOption[]>([])
//   const [open, setOpen] = useState(false)
//   const [loading, setLoading] = useState(false)
//   const containerRef = useRef<HTMLDivElement>(null)

//   useEffect(() => { setQuery(value) }, [value])

//   useEffect(() => {
//     if (!open || disabled) return
//     const t = setTimeout(async () => {
//       setLoading(true)
//       try { setOptions(await fetchOptions(query)) }
//       catch { setOptions([]) }
//       finally { setLoading(false) }
//     }, query.trim() === '' ? 0 : 300)
//     return () => clearTimeout(t)
//   }, [query, open, fetchOptions, disabled])

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
//       <label className={lc}>{label}</label>
//       <div className="relative">
//         <input type="text" value={query}
//           onChange={e => { if (!disabled) { setQuery(e.target.value); onClear(); setOpen(true) } }}
//           onFocus={() => !disabled && setOpen(true)}
//           placeholder={placeholder ?? 'Search...'}
//           className={`${ic} ${disabled ? 'bg-slate-100 cursor-not-allowed' : ''}`}
//           disabled={disabled}
//           autoComplete="off" />
//         <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
//           {loading
//             ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
//             : <ChevronDown className="w-3.5 h-3.5" />}
//         </span>
//       </div>
//       {open && !disabled && (
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

// // ─── Types ────────────────────────────────────────────────────────────────────

// interface ModifiedAldereteScoreModalProps {
//   admissionNo: string
//   patient: string
//   patientName?: string
//   onClose: () => void
//   onSuccess?: () => void
// }

// interface ScoreRow {
//   _key: string
//   attribute: string
//   score: number | ''
//   pass: boolean
// }

// type TabId = 'general' | 'score'

// const TABS: { id: TabId; label: string }[] = [
//   { id: 'general', label: 'General' },
//   { id: 'score', label: 'Alderete Score' },
// ]

// const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
// const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
// const sectionTitleClass = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

// // Score colour helper
// function scoreColor(total: number) {
//   if (total >= 9) return { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', badge: 'Discharge Ready' }
//   if (total >= 7) return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'Borderline' }
//   return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'Not Ready' }
// }

// // ─── Main Modal ───────────────────────────────────────────────────────────────

// export const ModifiedAldereteScoreModal = ({ admissionNo, patient, patientName, onClose, onSuccess }: ModifiedAldereteScoreModalProps) => {
//   // Get context from CareContextProvider
//   const { mode, activeVisit, activeAdmission, selectedPatient: contextPatient } = useCareContext()
  
//   // Determine if we're in IP or OP mode based on context
//   const isIPMode = mode === 'IP'
//   const isOPMode = mode === 'OP'
  
//   const [activeTab, setActiveTab] = useState<TabId>('general')
//   const [patientVisit, setPatientVisit] = useState(() => {
//     if (isOPMode && activeVisit) return activeVisit
//     return ''
//   })
//   const [patientVisitLabel, setPatientVisitLabel] = useState('')
//   const [templateName, setTemplateName] = useState('')
//   const [templateLabel, setTemplateLabel] = useState('')
//   const [templateLoading, setTemplateLoading] = useState(false)
//   const [rows, setRows] = useState<ScoreRow[]>([])
//   const [submitting, setSubmitting] = useState(false)

//   // Use context values if available, otherwise use props
//   const [currentAdmission, setCurrentAdmission] = useState(() => {
//     if (isIPMode && activeAdmission) return activeAdmission
//     return admissionNo || ''
//   })
//   const [currentPatient, setCurrentPatient] = useState(patient || contextPatient || '')
//   const [currentPatientName, setCurrentPatientName] = useState(patientName || '')

//   const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
//   const fetchAdmissionOpts = useCallback(
//     (s: string) => fetchInpatientAdmissionOptions(s || undefined, currentPatient || undefined),
//     [currentPatient]
//   )

//   // Auto-calculated total
//   const totalScore = useMemo(
//     () => rows.reduce((sum, r) => sum + (typeof r.score === 'number' ? r.score : 0), 0),
//     [rows]
//   )

//   const fetchVisits = useCallback(
//     (search: string) => fetchPatientVisits(currentPatient, search || undefined),
//     [currentPatient]
//   )

//   const fetchTemplates = useCallback(async (search: string): Promise<LinkFieldOption[]> => {
//     try {
//       const params = new URLSearchParams({
//         doctype: 'Modified Alderete Score Template',
//         txt: search || '',
//         page_length: '20',
//       })
//       const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
//       const data = await res.json()
//       const list = Array.isArray(data?.message) ? data.message : []
//       return list.map((r: any) => ({ name: r.name, label: r.template_name || r.name }))
//     } catch {
//       return []
//     }
//   }, [])

//   const handleTemplateSelect = async (opt: LinkFieldOption) => {
//     setTemplateName(opt.name)
//     setTemplateLabel(opt.label)
//     setTemplateLoading(true)
//     try {
//       const res = await fetch(
//         `/api/resource/Modified%20Alderete%20Score%20Template/${encodeURIComponent(opt.name)}`
//       )
//       const data = await res.json()
//       const doc = data?.data ?? data?.message
//       const items: any[] = Array.isArray(doc?.alderete_score) ? doc.alderete_score : []
//       setRows(items.map(r => ({
//         _key: Math.random().toString(36).slice(2),
//         attribute: r.attribute ?? '',
//         score: typeof r.score === 'number' ? r.score : (parseFloat(r.score) || 0),
//         pass: r.pass === 1 || r.pass === true,
//       })))
//       toast.success(`Loaded ${items.length} attribute${items.length !== 1 ? 's' : ''} from template.`)
//       setActiveTab('score')
//     } catch {
//       toast.error('Failed to load template.')
//     } finally {
//       setTemplateLoading(false)
//     }
//   }

//   const addRow = () =>
//     setRows(prev => [...prev, { _key: Math.random().toString(36).slice(2), attribute: '', score: 0, pass: false }])

//   const removeRow = (key: string) => setRows(prev => prev.filter(r => r._key !== key))

//   const updateRow = (key: string, field: keyof Omit<ScoreRow, '_key'>, value: string | number | boolean) =>
//     setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))

//   // Get mode-specific help text
//   const getModeHelpText = () => {
//     if (isIPMode) {
//       return `Creating Alderete score for IP admission: ${currentAdmission || 'not selected yet'}`
//     }
//     if (isOPMode) {
//       return `Creating Alderete score for OP visit: ${patientVisit || 'not selected yet'}`
//     }
//     return 'Select either IP or OP mode from the context switcher above'
//   }

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault()
//     e.stopPropagation()
    
//     // Validate based on mode
//     if (isIPMode && !currentAdmission) {
//       toast.error('Please select an inpatient admission (IP mode active)')
//       return
//     }
//     if (isOPMode && !patientVisit) {
//       toast.error('Please select a patient visit (OP mode active)')
//       return
//     }
    
//     setSubmitting(true)
//     try {
//       const payload = {
//         inpatient_admission: currentAdmission || undefined,
//         patient: currentPatient,
//         patient_name: currentPatientName,
//         patient_visit: patientVisit || undefined,
//         template: templateName || undefined,
//         total_score: totalScore,
//         alderete_score: rows.map(({ _key: _unused, ...rest }) => ({
//           ...rest,
//           score: rest.score === '' ? 0 : rest.score,
//           pass: rest.pass ? 1 : 0,
//         })),
//       }
//       await apiRequest('/api/resource/Modified%20Alderete%20Score', {
//         method: 'POST',
//         body: JSON.stringify({ data: payload }),
//       })
//       toast.success('Modified Alderete Score saved successfully.')
//       onSuccess?.()
//       onClose()
//     } catch (err) {
//       toast.error(err instanceof Error ? err.message : 'Failed to save record.')
//     } finally {
//       setSubmitting(false)
//     }
//   }

//   const currentTabIdx = TABS.findIndex(t => t.id === activeTab)
//   const colors = scoreColor(totalScore)

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
//             <h2 className="text-lg font-bold text-slate-900">Modified Alderete Score</h2>
//             <p className="text-xs text-slate-500 mt-0.5">
//               {currentPatientName ? `${currentPatientName} · ` : ''}
//               {isIPMode && currentAdmission && (
//                 <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
//                   IP: {currentAdmission}
//                 </span>
//               )}
//               {isOPMode && patientVisit && (
//                 <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
//                   OP Visit
//                 </span>
//               )}
//               {!currentAdmission && !patientVisit && 'New Record'}
//             </p>
//           </div>
//           <button type="button" onClick={onClose}
//             className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors ml-4 shrink-0"
//             aria-label="Close">
//             <X className="w-5 h-5" />
//           </button>
//         </div>

//         {/* Mode indicator box */}
//         <div className="mx-6 mt-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
//           <p className="text-xs font-semibold text-primary mb-1">
//             {isIPMode ? '🏥 Creating Score for Inpatient' : isOPMode ? '👤 Creating Score for Outpatient' : '📋 Select Context'}
//           </p>
//           <p className="text-xs text-slate-600">
//             {isIPMode 
//               ? `The Alderete score will be linked to the selected inpatient admission. Make sure you have an admission selected below.`
//               : isOPMode
//               ? `The Alderete score will be linked to the selected outpatient visit. Make sure you have a visit selected below.`
//               : 'Please select either IP or OP mode from the top navbar before creating a score.'
//             }
//           </p>
//         </div>

//         {/* Tabs */}
//         <div className="flex border-b border-slate-200 bg-white shrink-0 mt-3">
//           {TABS.map(tab => (
//             <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
//               className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
//                 activeTab === tab.id
//                   ? 'border-primary text-primary'
//                   : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
//               }`}>
//               {tab.label}
//               {tab.id === 'score' && rows.length > 0 && (
//                 <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
//                   {totalScore.toFixed(1).replace(/\.0$/, '')}
//                 </span>
//               )}
//             </button>
//           ))}
//         </div>

//         {/* Form */}
//         <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto">
//           <div className="px-6 py-5">

//             {/* ── Tab 1: General ── */}
//             {activeTab === 'general' && (
//               <div className="space-y-6">
//                 <div>
//                   <h3 className={sectionTitleClass}>
//                     Basic Information
//                     {isIPMode && <span className="ml-2 text-xs font-normal text-blue-600">(IP Mode Active)</span>}
//                     {isOPMode && <span className="ml-2 text-xs font-normal text-green-600">(OP Mode Active)</span>}
//                   </h3>
//                   <div className="grid grid-cols-2 gap-4">
//                     {/* Inpatient Admission - disabled in OP mode, auto-filled in IP mode */}
//                     {isIPMode ? (
//                       <div>
//                         <label className={labelClass}>Inpatient Admission *</label>
//                         <input type="text" value={currentAdmission} readOnly
//                           className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
//                         <p className="text-xs text-slate-400 mt-1">Auto-selected from IP context</p>
//                       </div>
//                     ) : (
//                       <LinkCombobox
//                         label="Inpatient Admission"
//                         value={currentAdmission}
//                         onSelect={opt => setCurrentAdmission(opt.name)}
//                         onClear={() => setCurrentAdmission('')}
//                         fetchOptions={fetchAdmissionOpts}
//                         placeholder="Search admissions..."
//                         disabled={isOPMode}
//                       />
//                     )}

//                     {/* Patient Visit - disabled in IP mode, auto-filled in OP mode */}
//                     {isOPMode ? (
//                       <div>
//                         <label className={labelClass}>Patient Visit *</label>
//                         <input type="text" value={patientVisitLabel || patientVisit} readOnly
//                           className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
//                         <p className="text-xs text-slate-400 mt-1">Auto-selected from OP context</p>
//                       </div>
//                     ) : (
//                       <LinkCombobox
//                         label="Patient Visit"
//                         value={patientVisitLabel}
//                         onSelect={opt => { setPatientVisit(opt.name); setPatientVisitLabel(opt.label) }}
//                         onClear={() => { setPatientVisit(''); setPatientVisitLabel('') }}
//                         fetchOptions={fetchVisits}
//                         placeholder="Search patient visits..."
//                         disabled={isIPMode}
//                       />
//                     )}

//                     {/* Patient field */}
//                     <div>
//                       <label className={labelClass}>Patient *</label>
//                       <input type="text" value={currentPatient} readOnly
//                         className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
//                     </div>
//                     <div>
//                       <label className={labelClass}>Patient Name</label>
//                       <input type="text" value={currentPatientName} readOnly
//                         className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
//                     </div>
//                   </div>
//                 </div>

//                 <div>
//                   <h3 className={sectionTitleClass}>Template</h3>
//                   <p className="text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
//                     Select a template to auto-populate the score attributes. You can then tick <strong>Pass</strong> and adjust each score manually.
//                   </p>
//                   <LinkCombobox
//                     label="Score Template"
//                     value={templateLabel}
//                     onSelect={handleTemplateSelect}
//                     onClear={() => { setTemplateName(''); setTemplateLabel('') }}
//                     fetchOptions={fetchTemplates}
//                     placeholder="Search templates..."
//                   />
//                   {templateLoading && (
//                     <div className="mt-2 flex items-center gap-2 text-xs text-primary">
//                       <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
//                       Loading template attributes…
//                     </div>
//                   )}
//                   {templateName && !templateLoading && rows.length > 0 && (
//                     <p className="mt-2 text-xs text-green-600 flex items-center gap-1.5">
//                       <span className="w-4 h-4 rounded-full bg-green-500 text-white inline-flex items-center justify-center text-[10px]">✓</span>
//                       {rows.length} attribute{rows.length !== 1 ? 's' : ''} loaded — switching to Score tab.
//                     </p>
//                   )}
//                 </div>
//               </div>
//             )}

//             {/* ── Tab 2: Alderete Score ── */}
//             {activeTab === 'score' && (
//               <div>
//                 {/* Score summary banner */}
//                 {rows.length > 0 && (
//                   <div className={`flex items-center justify-between rounded-lg border ${colors.border} ${colors.bg} px-4 py-3 mb-4`}>
//                     <div>
//                       <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Total Score</p>
//                       <p className={`text-3xl font-bold ${colors.text}`}>
//                         {totalScore % 1 === 0 ? totalScore : totalScore.toFixed(1)}
//                         <span className="text-base font-normal ml-1">/ {rows.reduce((s, r) => s + (typeof r.score === 'number' ? r.score : 0), 0) > 0 ? rows.length * 2 : '—'}</span>
//                       </p>
//                     </div>
//                     <div className={`px-3 py-1 rounded-full text-xs font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
//                       {colors.badge}
//                     </div>
//                   </div>
//                 )}

//                 <div className="flex items-center justify-between mb-3">
//                   <div>
//                     <h3 className={sectionTitleClass}>Score Attributes</h3>
//                     {rows.length > 0 && rows.some(r => !r.attribute) && (
//                       <p className="text-xs text-amber-600 flex items-center gap-1 -mt-2 mb-2">
//                         <AlertCircle className="w-3.5 h-3.5" />
//                         Some rows have no attribute description
//                       </p>
//                     )}
//                   </div>
//                   <button type="button" onClick={addRow}
//                     className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-md hover:bg-primary/90 transition-colors shrink-0">
//                     <Plus className="w-3.5 h-3.5" /> Add Row
//                   </button>
//                 </div>

//                 {rows.length === 0 ? (
//                   <div className="flex flex-col items-center justify-center py-12 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
//                     <p className="text-sm text-slate-500 mb-1">NO SCORE ATTRIBUTES YET.</p>
//                     <p className="text-xs text-slate-400 mb-4">Select a template on the General tab, or add rows manually.</p>
//                     <button type="button" onClick={addRow}
//                       className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/5 transition-colors">
//                       <Plus className="w-4 h-4" /> Add First Row
//                     </button>
//                   </div>
//                 ) : (
//                   <div className="rounded-lg border border-slate-200 overflow-hidden">
//                     {/* Header */}
//                     <div className="grid grid-cols-[auto_1fr_auto_auto_auto] bg-slate-50 border-b border-slate-200 px-3 py-2.5 gap-3 items-center">
//                       <span className="text-xs font-semibold text-slate-500 w-6">#</span>
//                       <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Attribute</span>
//                       <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide w-16 text-center">Pass</span>
//                       <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide w-20 text-center">Score</span>
//                       <span className="w-7" />
//                     </div>

//                     {/* Rows */}
//                     <div className="divide-y divide-slate-100">
//                       {rows.map((row, idx) => (
//                         <div key={row._key}
//                           className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center px-3 py-2.5 gap-3 group transition-colors ${row.pass ? 'bg-green-50/40' : 'hover:bg-slate-50'}`}>
//                           {/* Index */}
//                           <span className="text-xs text-slate-400 font-mono w-6">{idx + 1}</span>

//                           {/* Attribute text */}
//                           <input
//                             type="text"
//                             value={row.attribute}
//                             onChange={e => updateRow(row._key, 'attribute', e.target.value)}
//                             placeholder="Describe the attribute..."
//                             className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-white"
//                           />

//                           {/* Pass checkbox */}
//                           <div className="w-16 flex justify-center">
//                             <label className="relative inline-flex items-center cursor-pointer">
//                               <input
//                                 type="checkbox"
//                                 checked={row.pass}
//                                 onChange={e => updateRow(row._key, 'pass', e.target.checked)}
//                                 className="sr-only peer"
//                               />
//                               <div className={`w-9 h-5 rounded-full transition-colors ${row.pass ? 'bg-green-500' : 'bg-slate-300'} peer-focus:ring-2 peer-focus:ring-green-300`} />
//                               <div className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${row.pass ? 'translate-x-4' : ''}`} />
//                             </label>
//                           </div>

//                           {/* Score input */}
//                           <div className="w-20">
//                             <input
//                               type="number"
//                               step="0.5"
//                               min="0"
//                               value={row.score}
//                               onChange={e => {
//                                 const v = e.target.value
//                                 updateRow(row._key, 'score', v === '' ? '' : parseFloat(v))
//                               }}
//                               className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm text-center font-mono focus:outline-none focus:ring-1 focus:ring-primary bg-white"
//                             />
//                           </div>

//                           {/* Remove */}
//                           <button type="button" onClick={() => removeRow(row._key)}
//                             className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
//                             <Trash2 className="w-3.5 h-3.5" />
//                           </button>
//                         </div>
//                       ))}
//                     </div>

//                     {/* Total row */}
//                     <div className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center px-3 py-3 gap-3 border-t-2 border-slate-300 ${colors.bg}`}>
//                       <span className="w-6" />
//                       <span className={`text-sm font-bold ${colors.text}`}>Total Score</span>
//                       <span className="w-16" />
//                       <span className={`w-20 text-center text-lg font-bold font-mono ${colors.text}`}>
//                         {totalScore % 1 === 0 ? totalScore : totalScore.toFixed(1)}
//                       </span>
//                       <span className="w-7" />
//                     </div>
//                   </div>
//                 )}

//                 {/* Legend */}
//                 {rows.length > 0 && (
//                   <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
//                     <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-md px-3 py-2">
//                       <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block shrink-0" />
//                       <span className="text-green-700">≥ 9 — Discharge Ready</span>
//                     </div>
//                     <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
//                       <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shrink-0" />
//                       <span className="text-amber-700">7–8 — Borderline</span>
//                     </div>
//                     <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-md px-3 py-2">
//                       <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shrink-0" />
//                       <span className="text-red-700">&lt; 7 — Not Ready</span>
//                     </div>
//                   </div>
//                 )}
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
//               <button type="submit" disabled={submitting || (!isIPMode && !isOPMode) || (isIPMode && !currentAdmission) || (isOPMode && !patientVisit)}
//                 className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed">
//                 {submitting ? 'Saving...' : 'Save Score'}
//               </button>
//             </div>
//           </div>
//         </form>
//       </div>
//     </div>
//   )
// }

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { apiRequest } from '../../services/apiClient'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { fetchDoc, fetchPatientVisits, fetchInpatientAdmissionOptions, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { ChevronDown, Plus, Trash2, AlertCircle, FileText, ClipboardList } from 'lucide-react'
import { useCareContext } from '../../providers/CareContextProvider'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'

// ─── Link Combobox ────────────────────────────────────────────────────────────

interface LinkComboboxProps {
  label: string
  value: string
  onSelect: (opt: LinkFieldOption) => void
  onClear: () => void
  fetchOptions: (search: string) => Promise<LinkFieldOption[]>
  placeholder?: string
  disabled?: boolean
}

const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder, disabled = false }: LinkComboboxProps) => {
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
      <label className={lc}>{label}</label>
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModifiedAldereteScoreModalProps {
  /** When set, modal loads and updates this record instead of creating. */
  editName?: string
  admissionNo?: string
  patient?: string
  patientName?: string
  onClose: () => void
  onSuccess?: () => void
}

interface ScoreRow {
  _key: string
  attribute: string
  option_0: string
  option_1: string
  option_2: string
  selected_score: '' | '0' | '1' | '2'
  score: number
}

type TabId = 'general' | 'score' | 'header' | 'footer'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: null },
  { id: 'header', label: 'Description', icon: <FileText className="w-3.5 h-3.5" /> },
  { id: 'score', label: 'Alderete Score', icon: <ClipboardList className="w-3.5 h-3.5" /> },
  { id: 'footer', label: 'Footer', icon: <FileText className="w-3.5 h-3.5" /> },
]

const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
const sectionTitleClass = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

// Score colour helper
function scoreColor(total: number) {
  if (total >= 9) return { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', badge: 'Discharge Ready' }
  if (total >= 7) return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'Borderline' }
  return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'Not Ready' }
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export const ModifiedAldereteScoreModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName,
  onClose,
  onSuccess,
}: ModifiedAldereteScoreModalProps) => {
  const isEdit = Boolean(editName?.trim())
  // Get context from CareContextProvider
  const { mode, activeVisit, activeAdmission, selectedPatient: contextPatient } = useCareContext()
  
  // Determine if we're in IP or OP mode based on context
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'
  
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [patientVisit, setPatientVisit] = useState(() => {
    if (isOPMode && activeVisit) return activeVisit
    return ''
  })
  const [patientVisitLabel, setPatientVisitLabel] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateLabel, setTemplateLabel] = useState('')
  const [templateLoading, setTemplateLoading] = useState(false)
  const [rows, setRows] = useState<ScoreRow[]>([])
  const [description, setDescription] = useState('')
  const [footerDescription, setFooterDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)

  // Use context values if available, otherwise use props
  const [currentAdmission, setCurrentAdmission] = useState(() => {
    if (isIPMode && activeAdmission) return activeAdmission
    return admissionNo || ''
  })
  const [currentPatient, setCurrentPatient] = useState(patient || contextPatient || '')
  const [currentPatientName, setCurrentPatientName] = useState(patientName || '')

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('Modified Alderete Score', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setCurrentAdmission(String(doc.inpatient_admission || doc.admission || ''))
        setCurrentPatient(String(doc.patient || ''))
        setCurrentPatientName(String(doc.patient_name || ''))
        setPatientVisit(String(doc.patient_visit || ''))
        setPatientVisitLabel(String(doc.patient_visit || ''))
        const tpl = String(doc.template || '')
        setTemplateName(tpl)
        setTemplateLabel(tpl)
        if (doc.description) setDescription(String(doc.description))
        if (doc.footer_description) setFooterDescription(String(doc.footer_description))
        const items: Record<string, unknown>[] = Array.isArray(doc.alderete_score) ? doc.alderete_score : []
        setRows(
          items.map((r) => ({
            _key: Math.random().toString(36).slice(2),
            attribute: String(r.attribute ?? ''),
            option_0: String(r.option_0 ?? ''),
            option_1: String(r.option_1 ?? ''),
            option_2: String(r.option_2 ?? ''),
            selected_score: (String(r.selected_score ?? '') as '' | '0' | '1' | '2'),
            score: typeof r.score === 'number' ? r.score : Number(r.score) || 0,
          }))
        )
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load record')
      })
      .finally(() => {
        if (!cancelled) setLoadingEdit(false)
      })
    return () => {
      cancelled = true
    }
  }, [editName])

  const fetchAdmissionOpts = useCallback(
    (s: string) => fetchInpatientAdmissionOptions(s || undefined, currentPatient || undefined),
    [currentPatient]
  )

  // Auto-calculated total
  const totalScore = useMemo(
    () => rows.reduce((sum, r) => sum + (typeof r.score === 'number' ? r.score : 0), 0),
    [rows]
  )

  const fetchVisits = useCallback(
    (search: string) => fetchPatientVisits(currentPatient, search || undefined),
    [currentPatient]
  )

  const fetchTemplates = useCallback(async (search: string): Promise<LinkFieldOption[]> => {
    try {
      const params = new URLSearchParams({
        doctype: 'Modified Alderete Score Template',
        txt: search || '',
        page_length: '20',
      })
      const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
      const data = await res.json()
      const list = Array.isArray(data?.message) ? data.message : []
      return list.map((r: any) => ({ name: r.name, label: r.template_name || r.name }))
    } catch {
      return []
    }
  }, [])

  const handleTemplateSelect = async (opt: LinkFieldOption) => {
    setTemplateName(opt.name)
    setTemplateLabel(opt.label)
    setTemplateLoading(true)
    try {
      const res = await fetch(
        `/api/resource/Modified%20Alderete%20Score%20Template/${encodeURIComponent(opt.name)}`
      )
      const data = await res.json()
      const doc = data?.data ?? data?.message
      
      // Load description
      if (doc?.description) {
        setDescription(doc.description)
      }
      
      // Load footer description
      if (doc?.footer_description) {
        setFooterDescription(doc.footer_description)
      }
      
      // Load score items
      const items: any[] = Array.isArray(doc?.alderete_score) ? doc.alderete_score : []
      setRows(items.map(r => ({
        _key: Math.random().toString(36).slice(2),
        attribute: r.attribute ?? '',
        option_0: r.option_0 ?? '',
        option_1: r.option_1 ?? '',
        option_2: r.option_2 ?? '',
        selected_score: '',
        score: 0,
      })))
      
      toast.success(`Loaded ${items.length} attribute${items.length !== 1 ? 's' : ''} from template.`)
      // After loading template, switch to score tab
      setActiveTab('score')
    } catch {
      toast.error('Failed to load template.')
    } finally {
      setTemplateLoading(false)
    }
  }

  const addRow = () =>
    setRows(prev => [...prev, { 
      _key: Math.random().toString(36).slice(2), 
      attribute: '', 
      option_0: '', 
      option_1: '', 
      option_2: '', 
      selected_score: '', 
      score: 0 
    }])

  const removeRow = (key: string) => setRows(prev => prev.filter(r => r._key !== key))

  const updateRow = (key: string, field: keyof Omit<ScoreRow, '_key'>, value: string | number) =>
    setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))

  const handleScoreSelect = (key: string, selectedValue: string) => {
    const scoreMap: Record<string, number> = { '0': 0, '1': 1, '2': 2 }
    const scoreValue = scoreMap[selectedValue] || 0
    updateRow(key, 'selected_score', selectedValue as '' | '0' | '1' | '2')
    updateRow(key, 'score', scoreValue)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!isEdit) {
      if (isIPMode && !currentAdmission) {
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
        inpatient_admission: currentAdmission || undefined,
        patient: currentPatient,
        patient_name: currentPatientName,
        patient_visit: patientVisit || undefined,
        template: templateName || undefined,
        total_score: totalScore,
        alderete_score: rows.map(({ _key: _unused, ...rest }) => ({
          attribute: rest.attribute,
          option_0: rest.option_0,
          option_1: rest.option_1,
          option_2: rest.option_2,
          selected_score: rest.selected_score,
          score: rest.score,
        })),
      }
      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('Modified Alderete Score', editName.trim(), payload)
        toast.success('Modified Alderete Score updated.')
      } else {
        await apiRequest('/api/resource/Modified%20Alderete%20Score', {
          method: 'POST',
          body: JSON.stringify({ data: payload }),
        })
        toast.success('Modified Alderete Score saved successfully.')
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
  const colors = scoreColor(totalScore)

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('w-full max-w-4xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isEdit ? 'Edit Modified Alderete Score' : 'Modified Alderete Score'}
          icon={<ClipboardList className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          subtitle={
            <>
              {currentPatientName ? `${currentPatientName} · ` : ''}
              {isIPMode && currentAdmission ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">IP: {currentAdmission}</span> : null}
              {isOPMode && patientVisit ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OP Visit</span> : null}
              {!currentAdmission && !patientVisit ? 'New Record' : null}
            </>
          }
          onClose={onClose}
        >
          <div className="-mb-px mt-3 flex overflow-x-auto border-b border-emerald-100/80">
            {TABS.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap ${createModalTabButtonClass(activeTab === tab.id)}`}>
                {tab.icon && tab.icon}
                {tab.label}
                {tab.id === 'score' && rows.length > 0 ? (
                  <span className={`inline-flex items-center justify-center min-w-[18px] rounded-full px-1 py-0.5 text-[10px] font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
                    {totalScore.toFixed(1).replace(/\.0$/, '')}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </CreateModalHeader>

        {/* Mode indicator box */}
        <div className="mx-6 mt-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-xs font-semibold text-primary mb-1">
            {isIPMode ? '🏥 Creating Score for Inpatient' : isOPMode ? '👤 Creating Score for Outpatient' : '📋 Select Context'}
          </p>
          <p className="text-xs text-slate-600">
            {isIPMode 
              ? `The Alderete score will be linked to the selected inpatient admission. Make sure you have an admission selected below.`
              : isOPMode
              ? `The Alderete score will be linked to the selected outpatient visit. Make sure you have a visit selected below.`
              : 'Please select either IP or OP mode from the top navbar before creating a score.'
            }
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className={`${CREATE_MODAL_BODY_GRADIENT} flex-1 overflow-y-auto`}>
          <div className="px-6 py-5">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading record…</div>
            ) : (
            <>
            {/* ── Tab 1: General ── */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className={sectionTitleClass}>
                    Basic Information
                    {isIPMode && <span className="ml-2 text-xs font-normal text-blue-600">(IP Mode Active)</span>}
                    {isOPMode && <span className="ml-2 text-xs font-normal text-green-600">(OP Mode Active)</span>}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Inpatient Admission - disabled in OP mode, auto-filled in IP mode */}
                    {isIPMode ? (
                      <div>
                        <label className={labelClass}>Inpatient Admission *</label>
                        <input type="text" value={currentAdmission} readOnly
                          className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
                        <p className="text-xs text-slate-400 mt-1">Auto-selected from IP context</p>
                      </div>
                    ) : (
                      <LinkCombobox
                        label="Inpatient Admission"
                        value={currentAdmission}
                        onSelect={opt => setCurrentAdmission(opt.name)}
                        onClear={() => setCurrentAdmission('')}
                        fetchOptions={fetchAdmissionOpts}
                        placeholder="Search admissions..."
                        disabled={isOPMode}
                      />
                    )}

                    {/* Patient Visit - disabled in IP mode, auto-filled in OP mode */}
                    {isOPMode ? (
                      <div>
                        <label className={labelClass}>Patient Visit *</label>
                        <input type="text" value={patientVisitLabel || patientVisit} readOnly
                          className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
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
                    <div>
                      <label className={labelClass}>Patient *</label>
                      <input type="text" value={currentPatient} readOnly
                        className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
                    </div>
                    <div>
                      <label className={labelClass}>Patient Name</label>
                      <input type="text" value={currentPatientName} readOnly
                        className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className={sectionTitleClass}>Template</h3>
                  <p className="text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    Select a template to auto-populate the score attributes, description, and footer. 
                    The score tab will open automatically after selection.
                  </p>
                  <LinkCombobox
                    label="Score Template"
                    value={templateLabel}
                    onSelect={handleTemplateSelect}
                    onClear={() => { setTemplateName(''); setTemplateLabel(''); setRows([]); setDescription(''); setFooterDescription('') }}
                    fetchOptions={fetchTemplates}
                    placeholder="Search templates..."
                  />
                  {templateLoading && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-primary">
                      <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      Loading template attributes…
                    </div>
                  )}
                  {templateName && !templateLoading && rows.length > 0 && (
                    <p className="mt-2 text-xs text-green-600 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-green-500 text-white inline-flex items-center justify-center text-[10px]">✓</span>
                      {rows.length} attribute{rows.length !== 1 ? 's' : ''} loaded
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab 2: Header Description ── */}
            {activeTab === 'header' && (
              <div>
                <h3 className={sectionTitleClass}>Description</h3>
                <p className="text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                  This description appears at the top of the Alderete score form.
                </p>
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div
                    className="prose prose-sm max-w-none p-4 min-h-[200px]"
                    dangerouslySetInnerHTML={{ __html: description || '<p class="text-slate-400 italic">No description loaded. Select a template to see description content.</p>' }}
                  />
                </div>
              </div>
            )}

            {/* ── Tab 3: Alderete Score ── */}
            {activeTab === 'score' && (
              <div>
                {/* Score summary banner */}
                {rows.length > 0 && (
                  <div className={`flex items-center justify-between rounded-lg border ${colors.border} ${colors.bg} px-4 py-3 mb-4`}>
                    <div>
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Total Score</p>
                      <p className={`text-3xl font-bold ${colors.text}`}>
                        {totalScore % 1 === 0 ? totalScore : totalScore.toFixed(1)}
                      </p>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
                      {colors.badge}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className={sectionTitleClass}>Score Attributes</h3>
                    {rows.length > 0 && rows.some(r => !r.attribute) && (
                      <p className="text-xs text-amber-600 flex items-center gap-1 -mt-2 mb-2">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Some rows have no attribute description
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={addRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-md hover:bg-primary/90 transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" /> Add Row
                  </button>
                </div>

                {rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                    <p className="text-sm text-slate-500 mb-1">NO SCORE ATTRIBUTES YET.</p>
                    <p className="text-xs text-slate-400 mb-4">Select a template on the General tab, or add rows manually.</p>
                    <button type="button" onClick={addRow}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/5 transition-colors">
                      <Plus className="w-4 h-4" /> Add First Row
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rows.map((row, idx) => (
                      <div key={row._key} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                        {/* Attribute header */}
                        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                                {idx + 1}
                              </span>
                              <span className="text-sm font-medium text-slate-700">
                                {row.attribute || 'Untitled Attribute'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeRow(row._key)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Options */}
                        <div className="p-4">
                          <label className="block text-xs font-semibold text-slate-600 mb-2">Select Score:</label>
                          <div className="grid grid-cols-3 gap-3">
                            {/* Score 0 option */}
                            <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                              row.selected_score === '0' 
                                ? 'border-primary bg-primary/5 ring-1 ring-primary' 
                                : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'
                            }`}>
                              <input
                                type="radio"
                                name={`score_${row._key}`}
                                value="0"
                                checked={row.selected_score === '0'}
                                onChange={() => handleScoreSelect(row._key, '0')}
                                className="w-3.5 h-3.5 text-primary focus:ring-primary"
                              />
                              <div className="flex-1">
                                <div className="text-xs font-semibold text-slate-500">Score 0</div>
                                <div className="text-sm text-slate-700">{row.option_0 || '—'}</div>
                              </div>
                            </label>

                            {/* Score 1 option */}
                            <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                              row.selected_score === '1' 
                                ? 'border-primary bg-primary/5 ring-1 ring-primary' 
                                : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'
                            }`}>
                              <input
                                type="radio"
                                name={`score_${row._key}`}
                                value="1"
                                checked={row.selected_score === '1'}
                                onChange={() => handleScoreSelect(row._key, '1')}
                                className="w-3.5 h-3.5 text-primary focus:ring-primary"
                              />
                              <div className="flex-1">
                                <div className="text-xs font-semibold text-slate-500">Score 1</div>
                                <div className="text-sm text-slate-700">{row.option_1 || '—'}</div>
                              </div>
                            </label>

                            {/* Score 2 option */}
                            <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                              row.selected_score === '2' 
                                ? 'border-primary bg-primary/5 ring-1 ring-primary' 
                                : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'
                            }`}>
                              <input
                                type="radio"
                                name={`score_${row._key}`}
                                value="2"
                                checked={row.selected_score === '2'}
                                onChange={() => handleScoreSelect(row._key, '2')}
                                className="w-3.5 h-3.5 text-primary focus:ring-primary"
                              />
                              <div className="flex-1">
                                <div className="text-xs font-semibold text-slate-500">Score 2</div>
                                <div className="text-sm text-slate-700">{row.option_2 || '—'}</div>
                              </div>
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Legend */}
                {rows.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block shrink-0" />
                      <span className="text-green-700">≥ 9 — Discharge Ready</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shrink-0" />
                      <span className="text-amber-700">7–8 — Borderline</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shrink-0" />
                      <span className="text-red-700">&lt; 7 — Not Ready</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 4: Footer Description ── */}
            {activeTab === 'footer' && (
              <div>
                <h3 className={sectionTitleClass}>Footer Description</h3>
                <p className="text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                  This footer appears at the bottom of the Alderete score form.
                </p>
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div
                    className="prose prose-sm max-w-none p-4 min-h-[150px]"
                    dangerouslySetInnerHTML={{ __html: footerDescription || '<p class="text-slate-400 italic">No footer content loaded. Select a template to see footer content.</p>' }}
                  />
                </div>
              </div>
            )}
            </>
            )}
          </div>

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
                      (isIPMode && !currentAdmission) ||
                      (isOPMode && !patientVisit)))
                }
                className={CM_BTN_PRIMARY}>
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Score'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}