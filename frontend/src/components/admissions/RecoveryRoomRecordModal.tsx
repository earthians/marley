// import { useState, useRef, useCallback, useEffect } from 'react'
// import { apiRequest } from '../../services/apiClient'
// import { fetchPatientOptions, fetchInpatientAdmissionOptions, type LinkFieldOption } from '../../services/common'
// import { toast } from '../../hooks/useToast'
// import { Plus, Trash2, ChevronDown , FileText } from 'lucide-react'

import { CM_BTN_CANCEL, CM_BTN_PRIMARY, CREATE_MODAL_BODY_GRADIENT, CREATE_MODAL_FOOTER_STICKY, CREATE_MODAL_OVERLAY, CreateModalHeader, createModalShellClass, createModalTabButtonClass } from '../ui/CreateModalChrome'
// interface RecoveryRoomRecordModalProps {
//   admissionNo: string
//   patient: string
//   patientName?: string
//   onClose: () => void
//   onSuccess?: () => void
// }

// type TabId = 'general' | 'events'

// const TABS: { id: TabId; label: string }[] = [
//   { id: 'general', label: 'General' },
//   { id: 'events', label: 'Recovery Room Events' },
// ]

// interface EventRow {
//   _key: string
//   time: string
//   bp: string
//   pulse: string
//   rr: string
//   temp: string
//   spo2: string
// }

// interface FormState {
//   date: string
//   time: string
//   level_of_conciousness: string
//   respiration: string
//   oxygen_support: string
//   oxygen: string
//   special_notes_remarks: string
//   pos_anesthesia_visit: string
//   nurse_notes: string
// }

// const nowDate = () => new Date().toISOString().split('T')[0]
// const nowTime = () => {
//   const d = new Date()
//   return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
// }

// const emptyForm = (): FormState => ({
//   date: nowDate(),
//   time: nowTime(),
//   level_of_conciousness: '',
//   respiration: '',
//   oxygen_support: '',
//   oxygen: '',
//   special_notes_remarks: '',
//   pos_anesthesia_visit: '',
//   nurse_notes: '',
// })

// const emptyEvent = (): EventRow => ({
//   _key: Math.random().toString(36).slice(2),
//   time: nowTime(),
//   bp: '',
//   pulse: '',
//   rr: '',
//   temp: '',
//   spo2: '',
// })

// // ─── Shared styles ────────────────────────────────────────────────────────────
// const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
// const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
// const textareaClass = `${inputClass} resize-none`
// const sectionTitleClass = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

// function SelectField({
//   label, value, onChange, options
// }: {
//   label: string
//   value: string
//   onChange: (v: string) => void
//   options: { value: string; label: string }[]
// }) {
//   return (
//     <div>
//       <label className={labelClass}>{label}</label>
//       <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
//         <option value="">— Select —</option>
//         {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
//       </select>
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
// }

// const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder }: LinkComboboxProps) => {
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
//       <label className={lc}>{label}</label>
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

// // ─── Tab: General ─────────────────────────────────────────────────────────────
// function GeneralTab({
//   form, setField,
//   currentAdmission, currentPatient, currentPatientName,
//   isLockedContext,
//   fetchPatientOpts, fetchAdmissionOpts,
//   setCurrentAdmission, setCurrentPatient, setCurrentPatientName,
// }: {
//   form: FormState
//   setField: (k: keyof FormState, v: string) => void
//   currentAdmission: string
//   currentPatient: string
//   currentPatientName: string
//   isLockedContext: boolean
//   fetchPatientOpts: (s: string) => Promise<LinkFieldOption[]>
//   fetchAdmissionOpts: (s: string) => Promise<LinkFieldOption[]>
//   setCurrentAdmission: (v: string) => void
//   setCurrentPatient: (v: string) => void
//   setCurrentPatientName: (v: string) => void
// }) {
//   return (
//     <div className="space-y-6">
//       {/* Basic Info */}
//       <div>
//         <h3 className={sectionTitleClass}>Basic Information</h3>
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             {isLockedContext ? (
//               <>
//                 <label className={labelClass}>Admission</label>
//                 <input type="text" value={currentAdmission} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
//               </>
//             ) : (
//               <LinkCombobox
//                 label="Admission"
//                 value={currentAdmission}
//                 onSelect={opt => setCurrentAdmission(opt.name)}
//                 onClear={() => setCurrentAdmission('')}
//                 fetchOptions={fetchAdmissionOpts}
//                 placeholder="Search admissions..."
//               />
//             )}
//           </div>
//           <div>
//             {isLockedContext ? (
//               <>
//                 <label className={labelClass}>Patient</label>
//                 <input type="text" value={currentPatient} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
//               </>
//             ) : (
//               <LinkCombobox
//                 label="Patient"
//                 value={currentPatient}
//                 onSelect={opt => {
//                   setCurrentPatient(opt.name)
//                   const namePart = opt.label.replace(/\s*\([^)]*\)\s*$/, '').trim()
//                   setCurrentPatientName(namePart)
//                 }}
//                 onClear={() => { setCurrentPatient(''); setCurrentPatientName('') }}
//                 fetchOptions={fetchPatientOpts}
//                 placeholder="Search patients..."
//               />
//             )}
//           </div>
//           <div className="col-span-2">
//             <label className={labelClass}>Patient Name</label>
//             <input type="text" value={currentPatientName} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
//           </div>
//           <div>
//             <label className={labelClass}>Date</label>
//             <DateFilterInput
//
//               value={form.date}
//               onChange={e => setField('date', e.target.value)}
//               className={inputClass}
//             />
//           </div>
//           <div>
//             <label className={labelClass}>Time</label>
//             <input
//               type="time"
//               step="1"
//               value={form.time}
//               onChange={e => setField('time', e.target.value)}
//               className={inputClass}
//             />
//           </div>
//         </div>
//       </div>

//       {/* Clinical Status */}
//       <div>
//         <h3 className={sectionTitleClass}>Clinical Status</h3>
//         <div className="grid grid-cols-2 gap-4">
//           <SelectField
//             label="Level of Consciousness"
//             value={form.level_of_conciousness}
//             onChange={v => setField('level_of_conciousness', v)}
//             options={[
//               { value: 'Awake', label: 'Awake' },
//               { value: 'Semi-conscious', label: 'Semi-conscious' },
//               { value: 'Arousable to pain', label: 'Arousable to pain' },
//               { value: 'Not Arousable', label: 'Not Arousable' },
//             ]}
//           />
//           <SelectField
//             label="Respiration"
//             value={form.respiration}
//             onChange={v => setField('respiration', v)}
//             options={[
//               { value: 'Spontaneous', label: 'Spontaneous' },
//               { value: 'Controlled/Assisted', label: 'Controlled/Assisted' },
//               { value: 'No Spontaneous Breathing', label: 'No Spontaneous Breathing' },
//             ]}
//           />
//           <SelectField
//             label="Oxygen Support"
//             value={form.oxygen_support}
//             onChange={v => setField('oxygen_support', v)}
//             options={[
//               { value: 'Spontaneous', label: 'Spontaneous' },
//               { value: 'Nasal Cannula', label: 'Nasal Cannula' },
//               { value: 'O2 Mask', label: 'O2 Mask' },
//               { value: 'ETT', label: 'ETT' },
//             ]}
//           />
//           <div>
//             <label className={labelClass}>Oxygen (Liters/min)</label>
//             <input
//               type="text"
//               value={form.oxygen}
//               onChange={e => setField('oxygen', e.target.value)}
//               placeholder="e.g. 2"
//               className={inputClass}
//             />
//           </div>
//         </div>
//       </div>

//       {/* Notes */}
//       <div>
//         <h3 className={sectionTitleClass}>Notes</h3>
//         <div className="space-y-4">
//           <div>
//             <label className={labelClass}>Special Notes &amp; Remarks</label>
//             <textarea
//               rows={3}
//               value={form.special_notes_remarks}
//               onChange={e => setField('special_notes_remarks', e.target.value)}
//               className={textareaClass}
//               placeholder="Any special notes or remarks..."
//             />
//           </div>
//           <div>
//             <label className={labelClass}>Pos Anesthesia Visit</label>
//             <textarea
//               rows={3}
//               value={form.pos_anesthesia_visit}
//               onChange={e => setField('pos_anesthesia_visit', e.target.value)}
//               className={textareaClass}
//               placeholder="Post-anesthesia visit notes..."
//             />
//           </div>
//         </div>
//       </div>

//       {/* Nurse Notes */}
//       <div>
//         <h3 className={sectionTitleClass}>Nurse Notes on Discharge From Recovery Room</h3>
//         <div>
//           <label className={labelClass}>Nurse Notes</label>
//           <textarea
//             rows={4}
//             value={form.nurse_notes}
//             onChange={e => setField('nurse_notes', e.target.value)}
//             className={textareaClass}
//             placeholder="Nurse discharge notes..."
//           />
//         </div>
//       </div>
//     </div>
//   )
// }

// // ─── Tab: Events ──────────────────────────────────────────────────────────────
// function EventsTab({
//   events, setEvents
// }: {
//   events: EventRow[]
//   setEvents: React.Dispatch<React.SetStateAction<EventRow[]>>
// }) {
//   const updateEvent = (key: string, field: keyof Omit<EventRow, '_key'>, value: string) => {
//     setEvents(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))
//   }

//   const removeEvent = (key: string) => {
//     setEvents(prev => prev.filter(r => r._key !== key))
//   }

//   const addEvent = () => {
//     setEvents(prev => [...prev, emptyEvent()])
//   }

//   const inputSm = 'w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-white'

//   return (
//     <div>
//       <div className="flex items-center justify-between mb-3">
//         <div>
//           <h3 className={sectionTitleClass}>Recovery Room Events</h3>
//           <p className="text-xs text-slate-500 -mt-2">Record vitals at each time point during recovery.</p>
//         </div>
//         <button
//           type="button"
//           onClick={addEvent}
//           className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-md hover:bg-primary/90 transition-colors shrink-0"
//         >
//           <Plus className="w-3.5 h-3.5" />
//           Add Event
//         </button>
//       </div>

//       {events.length === 0 ? (
//         <div className="flex flex-col items-center justify-center py-12 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
//           <p className="text-sm text-slate-500 mb-3">NO EVENTS RECORDED YET.</p>
//           <button
//             type="button"
//             onClick={addEvent}
//             className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/5 transition-colors"
//           >
//             <Plus className="w-4 h-4" />
//             Add First Event
//           </button>
//         </div>
//       ) : (
//         <div className="overflow-x-auto rounded-lg border border-slate-200">
//           <table className="w-full text-xs">
//             <thead>
//               <tr className="bg-slate-50 border-b border-slate-200">
//                 <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">#</th>
//                 <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">Time</th>
//                 <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">BP</th>
//                 <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">Pulse</th>
//                 <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">RR</th>
//                 <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">Temp</th>
//                 <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">SPO2 (%)</th>
//                 <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap"></th>
//               </tr>
//             </thead>
//             <tbody className="divide-y divide-slate-100">
//               {events.map((row, idx) => (
//                 <tr key={row._key} className="hover:bg-slate-50 group">
//                   <td className="px-3 py-2 text-slate-400 font-medium">{idx + 1}</td>
//                   <td className="px-3 py-2 min-w-[110px]">
//                     <input
//                       type="time"
//                       step="1"
//                       value={row.time}
//                       onChange={e => updateEvent(row._key, 'time', e.target.value)}
//                       className={inputSm}
//                     />
//                   </td>
//                   <td className="px-3 py-2 min-w-[90px]">
//                     <input
//                       type="text"
//                       value={row.bp}
//                       onChange={e => updateEvent(row._key, 'bp', e.target.value)}
//                       placeholder="120/80"
//                       className={inputSm}
//                     />
//                   </td>
//                   <td className="px-3 py-2 min-w-[80px]">
//                     <input
//                       type="text"
//                       value={row.pulse}
//                       onChange={e => updateEvent(row._key, 'pulse', e.target.value)}
//                       placeholder="72"
//                       className={inputSm}
//                     />
//                   </td>
//                   <td className="px-3 py-2 min-w-[70px]">
//                     <input
//                       type="text"
//                       value={row.rr}
//                       onChange={e => updateEvent(row._key, 'rr', e.target.value)}
//                       placeholder="16"
//                       className={inputSm}
//                     />
//                   </td>
//                   <td className="px-3 py-2 min-w-[80px]">
//                     <input
//                       type="text"
//                       value={row.temp}
//                       onChange={e => updateEvent(row._key, 'temp', e.target.value)}
//                       placeholder="37.0"
//                       className={inputSm}
//                     />
//                   </td>
//                   <td className="px-3 py-2 min-w-[80px]">
//                     <input
//                       type="text"
//                       value={row.spo2}
//                       onChange={e => updateEvent(row._key, 'spo2', e.target.value)}
//                       placeholder="98"
//                       className={inputSm}
//                     />
//                   </td>
//                   <td className="px-3 py-2 text-right">
//                     <button
//                       type="button"
//                       onClick={() => removeEvent(row._key)}
//                       className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
//                       title="Remove row"
//                     >
//                       <Trash2 className="w-3.5 h-3.5" />
//                     </button>
//                   </td>
//                 </tr>
//               ))}
//             </tbody>
//           </table>
//         </div>
//       )}

//       {events.length > 0 && (
//         <p className="text-xs text-slate-400 mt-2">{events.length} event{events.length !== 1 ? 's' : ''} recorded</p>
//       )}
//     </div>
//   )
// }

// // ─── Main Modal ───────────────────────────────────────────────────────────────
// export const RecoveryRoomRecordModal = ({
//   admissionNo, patient, patientName, onClose, onSuccess
// }: RecoveryRoomRecordModalProps) => {
//   const [activeTab, setActiveTab] = useState<TabId>('general')
//   const [form, setForm] = useState<FormState>(emptyForm())
//   const [events, setEvents] = useState<EventRow[]>([])
//   const [submitting, setSubmitting] = useState(false)

//   const setField = (k: keyof FormState, v: string) => setForm(prev => ({ ...prev, [k]: v }))

//   const [currentAdmission, setCurrentAdmission] = useState(admissionNo)
//   const [currentPatient, setCurrentPatient] = useState(patient)
//   const [currentPatientName, setCurrentPatientName] = useState(patientName || '')
//   const isLockedContext = Boolean(admissionNo)

//   const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
//   const fetchAdmissionOpts = useCallback(
//     (s: string) => fetchInpatientAdmissionOptions(s || undefined, currentPatient || undefined),
//     [currentPatient]
//   )

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault()
//     e.stopPropagation()

//     setSubmitting(true)
//     try {
//       const payload = {
//         admission: currentAdmission,
//         patient: currentPatient,
//         patient_name: currentPatientName,
//         date: form.date || undefined,
//         time: form.time || undefined,
//         level_of_conciousness: form.level_of_conciousness || undefined,
//         respiration: form.respiration || undefined,
//         oxygen_support: form.oxygen_support || undefined,
//         oxygen: form.oxygen || undefined,
//         special_notes_remarks: form.special_notes_remarks || undefined,
//         pos_anesthesia_visit: form.pos_anesthesia_visit || undefined,
//         nurse_notes: form.nurse_notes || undefined,
//         events: events.map(({ _key: _unused, ...rest }) => rest),
//       }

//       await apiRequest('/api/resource/Recovery%20Room%20Record', {
//         method: 'POST',
//         body: JSON.stringify({ data: payload }),
//       })

//       toast.success('Recovery Room Record saved successfully.')
//       onSuccess?.()
//       onClose()
//     } catch (err) {
//       const msg = err instanceof Error ? err.message : 'Failed to save record.'
//       toast.error(msg)
//     } finally {
//       setSubmitting(false)
//     }
//   }

//   const currentTabIdx = TABS.findIndex(t => t.id === activeTab)

//   return (
//     <div
//       className="fixed inset-0 z-[60] flex items-center justify-center p-4"
//       onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
//     >
//       <div className="absolute inset-0 bg-black/50" />

//       <div
//         className="relative z-10 w-full max-w-4xl max-h-[92vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
//         onMouseDown={e => e.stopPropagation()}
//       >
//         {/* Header */}
//         <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
//           <div>
//             <h2 className="text-lg font-bold text-slate-900">Recovery Room Record</h2>
//             <p className="text-xs text-slate-500 mt-0.5">
//               {patientName ? `${patientName} · ` : ''}{admissionNo}
//             </p>
//           </div>
//           <button
//             type="button"
//             onClick={onClose}
//             className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors ml-4 shrink-0"
//             aria-label="Close"
//           >
//             <X className="w-5 h-5" />
//           </button>
//         </div>

//         {/* Tabs */}
//         <div className="flex border-b border-slate-200 bg-white shrink-0">
//           {TABS.map(tab => (
//             <button
//               key={tab.id}
//               type="button"
//               onClick={() => setActiveTab(tab.id)}
//               className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
//                 activeTab === tab.id
//                   ? 'border-primary text-primary'
//                   : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
//               }`}
//             >
//               {tab.label}
//               {tab.id === 'events' && events.length > 0 && (
//                 <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold">
//                   {events.length}
//                 </span>
//               )}
//             </button>
//           ))}
//         </div>

//         {/* Form body */}
//         <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto">
//           <div className="px-6 py-5">
//             {activeTab === 'general' && (
//               <GeneralTab
//                 form={form}
//                 setField={setField}
//                 currentAdmission={currentAdmission}
//                 currentPatient={currentPatient}
//                 currentPatientName={currentPatientName}
//                 isLockedContext={isLockedContext}
//                 fetchPatientOpts={fetchPatientOpts}
//                 fetchAdmissionOpts={fetchAdmissionOpts}
//                 setCurrentAdmission={setCurrentAdmission}
//                 setCurrentPatient={setCurrentPatient}
//                 setCurrentPatientName={setCurrentPatientName}
//               />
//             )}
//             {activeTab === 'events' && (
//               <EventsTab events={events} setEvents={setEvents} />
//             )}
//           </div>

//           {/* Footer */}
//           <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-3 shrink-0">
//             <div className="flex gap-1">
//               {TABS.map((tab, i) => (
//                 <button
//                   key={tab.id}
//                   type="button"
//                   onClick={() => setActiveTab(tab.id)}
//                   className={`w-2 h-2 rounded-full transition-colors ${activeTab === tab.id ? 'bg-primary' : 'bg-slate-300 hover:bg-slate-400'}`}
//                   aria-label={`${i + 1}. ${tab.label}`}
//                 />
//               ))}
//             </div>
//             <div className="flex gap-3">
//               {currentTabIdx > 0 && (
//                 <button
//                   type="button"
//                   onClick={() => setActiveTab(TABS[currentTabIdx - 1].id)}
//                   className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
//                 >
//                   ← Previous
//                 </button>
//               )}
//               {currentTabIdx < TABS.length - 1 && (
//                 <button
//                   type="button"
//                   onClick={() => setActiveTab(TABS[currentTabIdx + 1].id)}
//                   className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90"
//                 >
//                   Next →
//                 </button>
//               )}
//               <button
//                 type="button"
//                 onClick={onClose}
//                 className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
//               >
//                 Cancel
//               </button>
//               <button
//                 type="submit"
//                 disabled={submitting}
//                 className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
//               >
//                 {submitting ? 'Saving...' : 'Save Record'}
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
import { fetchDoc, fetchInpatientAdmissionOptions, fetchPatientVisits, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { Plus, Trash2, ChevronDown , FileText } from 'lucide-react'
import { useCareContext } from '../../providers/CareContextProvider'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import { DateFilterInput } from '../ui/DateFilterInput'

interface RecoveryRoomRecordModalProps {
  /** When set, modal loads and updates this record instead of creating. */
  editName?: string
  admissionNo?: string
  patient?: string
  patientName?: string
  onClose: () => void
  onSuccess?: () => void
}

function toDateInput(value?: string | null): string {
  if (!value) return ''
  return String(value).trim().slice(0, 10)
}

function toTimeInput(value?: string | null): string {
  if (!value) return ''
  const s = String(value).trim()
  if (s.includes('T')) {
    const part = s.split('T')[1] || ''
    return part.slice(0, 8)
  }
  if (s.length === 5) return `${s}:00`
  return s.slice(0, 8)
}

type TabId = 'general' | 'events'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'events', label: 'Recovery Room Events' },
]

interface EventRow {
  _key: string
  time: string
  bp: string
  pulse: string
  rr: string
  temp: string
  spo2: string
}

interface FormState {
  date: string
  time: string
  level_of_conciousness: string
  respiration: string
  oxygen_support: string
  oxygen: string
  special_notes_remarks: string
  pos_anesthesia_visit: string
  nurse_notes: string
}

const nowDate = () => new Date().toISOString().split('T')[0]
const nowTime = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const emptyForm = (): FormState => ({
  date: nowDate(),
  time: nowTime(),
  level_of_conciousness: '',
  respiration: '',
  oxygen_support: '',
  oxygen: '',
  special_notes_remarks: '',
  pos_anesthesia_visit: '',
  nurse_notes: '',
})

const emptyEvent = (): EventRow => ({
  _key: Math.random().toString(36).slice(2),
  time: nowTime(),
  bp: '',
  pulse: '',
  rr: '',
  temp: '',
  spo2: '',
})

// ─── Shared styles ────────────────────────────────────────────────────────────
const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
const textareaClass = `${inputClass} resize-none`
const sectionTitleClass = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

function SelectField({
  label, value, onChange, options
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
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

// ─── Tab: General ─────────────────────────────────────────────────────────────
function GeneralTab({
  form, setField,
  currentAdmission, currentPatient, currentPatientName,
  fetchAdmissionOpts,
  setCurrentAdmission,
}: {
  form: FormState
  setField: (k: keyof FormState, v: string) => void
  currentAdmission: string
  currentPatient: string
  currentPatientName: string
  fetchAdmissionOpts: (s: string) => Promise<LinkFieldOption[]>
  setCurrentAdmission: (v: string) => void
}) {
  // Get context for mode detection
  const { mode, activeVisit } = useCareContext()
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'
  
  const [patientVisitLabel, setPatientVisitLabel] = useState('')
  const [patientVisit, setPatientVisit] = useState(() => {
    if (isOPMode && activeVisit) return activeVisit
    return ''
  })

  const fetchVisits = useCallback(
    (search: string) => fetchPatientVisits(currentPatient, search || undefined),
    [currentPatient]
  )

  return (
    <div className="space-y-6">
      {/* Mode indicator */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
        <p className="text-xs font-semibold text-primary mb-1">
          {isIPMode ? '🏥 Creating Record for Inpatient' : isOPMode ? '👤 Creating Record for Outpatient' : '📋 Select Context'}
        </p>
        <p className="text-xs text-slate-600">
          {isIPMode 
            ? `The recovery room record will be linked to the selected inpatient admission.`
            : isOPMode
            ? `The recovery room record will be linked to the selected outpatient visit.`
            : 'Please select either IP or OP mode from the top navbar.'
          }
        </p>
      </div>

      {/* Basic Info */}
      <div>
        <h3 className={sectionTitleClass}>
          Basic Information
          {isIPMode && <span className="ml-2 text-xs font-normal text-blue-600">(IP Mode Active)</span>}
          {isOPMode && <span className="ml-2 text-xs font-normal text-green-600">(OP Mode Active)</span>}
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {/* Admission - disabled in OP mode, auto-filled in IP mode */}
          {isIPMode ? (
            <div>
              <label className={labelClass}>Inpatient Admission *</label>
              <input type="text" value={currentAdmission} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
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
              <input type="text" value={patientVisitLabel || patientVisit} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
              <p className="text-xs text-slate-400 mt-1">Auto-selected from OP context</p>
            </div>
          ) : (
            <LinkCombobox
              label="Patient Visit"
              value={patientVisitLabel}
              onSelect={opt => {
                setPatientVisit(opt.name)
                setPatientVisitLabel(opt.label)
              }}
              onClear={() => {
                setPatientVisit('')
                setPatientVisitLabel('')
              }}
              fetchOptions={fetchVisits}
              placeholder="Search patient visits..."
              disabled={isIPMode}
            />
          )}

          {/* Patient */}
          <div>
            <label className={labelClass}>Patient *</label>
            <input type="text" value={currentPatient} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
          </div>
          <div>
            <label className={labelClass}>Patient Name</label>
            <input type="text" value={currentPatientName} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
          </div>
          <div>
            <label className={labelClass}>Date</label>
            <DateFilterInput
              value={form.date}
              onChange={e => setField('date', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Time</label>
            <input
              type="time"
              step="1"
              value={form.time}
              onChange={e => setField('time', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Clinical Status */}
      <div>
        <h3 className={sectionTitleClass}>Clinical Status</h3>
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Level of Consciousness"
            value={form.level_of_conciousness}
            onChange={v => setField('level_of_conciousness', v)}
            options={[
              { value: 'Awake', label: 'Awake' },
              { value: 'Semi-conscious', label: 'Semi-conscious' },
              { value: 'Arousable to pain', label: 'Arousable to pain' },
              { value: 'Not Arousable', label: 'Not Arousable' },
            ]}
          />
          <SelectField
            label="Respiration"
            value={form.respiration}
            onChange={v => setField('respiration', v)}
            options={[
              { value: 'Spontaneous', label: 'Spontaneous' },
              { value: 'Controlled/Assisted', label: 'Controlled/Assisted' },
              { value: 'No Spontaneous Breathing', label: 'No Spontaneous Breathing' },
            ]}
          />
          <SelectField
            label="Oxygen Support"
            value={form.oxygen_support}
            onChange={v => setField('oxygen_support', v)}
            options={[
              { value: 'Spontaneous', label: 'Spontaneous' },
              { value: 'Nasal Cannula', label: 'Nasal Cannula' },
              { value: 'O2 Mask', label: 'O2 Mask' },
              { value: 'ETT', label: 'ETT' },
            ]}
          />
          <div>
            <label className={labelClass}>Oxygen (Liters/min)</label>
            <input
              type="text"
              value={form.oxygen}
              onChange={e => setField('oxygen', e.target.value)}
              placeholder="e.g. 2"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <h3 className={sectionTitleClass}>Notes</h3>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Special Notes &amp; Remarks</label>
            <textarea
              rows={3}
              value={form.special_notes_remarks}
              onChange={e => setField('special_notes_remarks', e.target.value)}
              className={textareaClass}
              placeholder="Any special notes or remarks..."
            />
          </div>
          <div>
            <label className={labelClass}>Pos Anesthesia Visit</label>
            <textarea
              rows={3}
              value={form.pos_anesthesia_visit}
              onChange={e => setField('pos_anesthesia_visit', e.target.value)}
              className={textareaClass}
              placeholder="Post-anesthesia visit notes..."
            />
          </div>
        </div>
      </div>

      {/* Nurse Notes */}
      <div>
        <h3 className={sectionTitleClass}>Nurse Notes on Discharge From Recovery Room</h3>
        <div>
          <label className={labelClass}>Nurse Notes</label>
          <textarea
            rows={4}
            value={form.nurse_notes}
            onChange={e => setField('nurse_notes', e.target.value)}
            className={textareaClass}
            placeholder="Nurse discharge notes..."
          />
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Events ──────────────────────────────────────────────────────────────
function EventsTab({
  events, setEvents
}: {
  events: EventRow[]
  setEvents: React.Dispatch<React.SetStateAction<EventRow[]>>
}) {
  const updateEvent = (key: string, field: keyof Omit<EventRow, '_key'>, value: string) => {
    setEvents(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))
  }

  const removeEvent = (key: string) => {
    setEvents(prev => prev.filter(r => r._key !== key))
  }

  const addEvent = () => {
    setEvents(prev => [...prev, emptyEvent()])
  }

  const inputSm = 'w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-white'

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className={sectionTitleClass}>Recovery Room Events</h3>
          <p className="text-xs text-slate-500 -mt-2">Record vitals at each time point during recovery.</p>
        </div>
        <button
          type="button"
          onClick={addEvent}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-md hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Event
        </button>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-500 mb-3">NO EVENTS RECORDED YET.</p>
          <button
            type="button"
            onClick={addEvent}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add First Event
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">#</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">Time</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">BP</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">Pulse</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">RR</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">Temp</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">SPO2 (%)</th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((row, idx) => (
                <tr key={row._key} className="hover:bg-slate-50 group">
                  <td className="px-3 py-2 text-slate-400 font-medium">{idx + 1}</td>
                  <td className="px-3 py-2 min-w-[110px]">
                    <input
                      type="time"
                      step="1"
                      value={row.time}
                      onChange={e => updateEvent(row._key, 'time', e.target.value)}
                      className={inputSm}
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[90px]">
                    <input
                      type="text"
                      value={row.bp}
                      onChange={e => updateEvent(row._key, 'bp', e.target.value)}
                      placeholder="120/80"
                      className={inputSm}
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[80px]">
                    <input
                      type="text"
                      value={row.pulse}
                      onChange={e => updateEvent(row._key, 'pulse', e.target.value)}
                      placeholder="72"
                      className={inputSm}
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[70px]">
                    <input
                      type="text"
                      value={row.rr}
                      onChange={e => updateEvent(row._key, 'rr', e.target.value)}
                      placeholder="16"
                      className={inputSm}
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[80px]">
                    <input
                      type="text"
                      value={row.temp}
                      onChange={e => updateEvent(row._key, 'temp', e.target.value)}
                      placeholder="37.0"
                      className={inputSm}
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[80px]">
                    <input
                      type="text"
                      value={row.spo2}
                      onChange={e => updateEvent(row._key, 'spo2', e.target.value)}
                      placeholder="98"
                      className={inputSm}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeEvent(row._key)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {events.length > 0 && (
        <p className="text-xs text-slate-400 mt-2">{events.length} event{events.length !== 1 ? 's' : ''} recorded</p>
      )}
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export const RecoveryRoomRecordModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName,
  onClose,
  onSuccess,
}: RecoveryRoomRecordModalProps) => {
  const isEdit = Boolean(editName?.trim())
  // Get context from CareContextProvider
  const { mode, activeAdmission, selectedPatient: contextPatient } = useCareContext()
  
  // Determine if we're in IP or OP mode based on context
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'
  
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [form, setForm] = useState<FormState>(emptyForm())
  const [events, setEvents] = useState<EventRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)

  const setField = (k: keyof FormState, v: string) => setForm(prev => ({ ...prev, [k]: v }))

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
    fetchDoc('Recovery Room Record', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setCurrentAdmission(String(doc.admission || doc.inpatient_admission || ''))
        setCurrentPatient(String(doc.patient || ''))
        setCurrentPatientName(String(doc.patient_name || ''))
        setForm({
          date: toDateInput(doc.date as string) || nowDate(),
          time: toTimeInput(doc.time as string) || nowTime(),
          level_of_conciousness: String(doc.level_of_conciousness || ''),
          respiration: String(doc.respiration || ''),
          oxygen_support: String(doc.oxygen_support || ''),
          oxygen: String(doc.oxygen || ''),
          special_notes_remarks: String(doc.special_notes_remarks || ''),
          pos_anesthesia_visit: String(doc.pos_anesthesia_visit || ''),
          nurse_notes: String(doc.nurse_notes || ''),
        })
        const rawEvents = Array.isArray(doc.events) ? doc.events : []
        setEvents(
          rawEvents.map((row: Record<string, unknown>) => ({
            _key: Math.random().toString(36).slice(2),
            time: toTimeInput(row.time as string) || nowTime(),
            bp: String(row.bp ?? ''),
            pulse: String(row.pulse ?? ''),
            rr: String(row.rr ?? ''),
            temp: String(row.temp ?? ''),
            spo2: String(row.spo2 ?? ''),
          }))
        )
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load record')
        }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!isEdit) {
      if (isIPMode && !currentAdmission) {
        toast.error('Please select an inpatient admission (IP mode active)')
        return
      }
    }

    setSubmitting(true)
    try {
      const payload = {
        admission: currentAdmission || undefined,
        patient: currentPatient,
        patient_name: currentPatientName,
        date: form.date || undefined,
        time: form.time || undefined,
        level_of_conciousness: form.level_of_conciousness || undefined,
        respiration: form.respiration || undefined,
        oxygen_support: form.oxygen_support || undefined,
        oxygen: form.oxygen || undefined,
        special_notes_remarks: form.special_notes_remarks || undefined,
        pos_anesthesia_visit: form.pos_anesthesia_visit || undefined,
        nurse_notes: form.nurse_notes || undefined,
        events: events.map(({ _key: _unused, ...rest }) => rest),
      }

      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('Recovery Room Record', editName.trim(), payload)
        toast.success('Recovery Room Record updated.')
      } else {
        await apiRequest('/api/resource/Recovery%20Room%20Record', {
          method: 'POST',
          body: JSON.stringify({ data: payload }),
        })
        toast.success('Recovery Room Record saved successfully.')
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save record.'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const currentTabIdx = TABS.findIndex(t => t.id === activeTab)

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('w-full max-w-4xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isEdit ? 'Edit Recovery Room Record' : 'Recovery Room Record'}
          icon={<FileText className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          subtitle={
            <>
              {currentPatientName ? `${currentPatientName} · ` : ''}
              {isIPMode && currentAdmission ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">IP: {currentAdmission}</span> : null}
              {isOPMode ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OP Visit</span> : null}
              {!currentAdmission && !isOPMode ? 'New Record' : null}
            </>
          }
          onClose={onClose}
        >
          <div className="-mb-px mt-3 flex border-b border-emerald-100/80">
            {TABS.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={createModalTabButtonClass(activeTab === tab.id)}>
                {tab.label}
                {tab.id === 'events' && events.length > 0 ? (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                    {events.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </CreateModalHeader>

        {/* Form body */}
        <form onSubmit={handleSubmit} noValidate className={`${CREATE_MODAL_BODY_GRADIENT} flex-1 overflow-y-auto`}>
          <div className="px-6 py-5">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading record…</div>
            ) : null}
            {!loadingEdit && activeTab === 'general' && (
              <GeneralTab
                form={form}
                setField={setField}
                currentAdmission={currentAdmission}
                currentPatient={currentPatient}
                currentPatientName={currentPatientName}
                fetchAdmissionOpts={fetchAdmissionOpts}
                setCurrentAdmission={setCurrentAdmission}
              />
            )}
            {!loadingEdit && activeTab === 'events' && (
              <EventsTab events={events} setEvents={setEvents} />
            )}
          </div>

          <div className={`${CREATE_MODAL_FOOTER_STICKY} items-center justify-between`}>
            <div className="flex gap-1">
              {TABS.map((tab, i) => (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                  className={`h-2 w-2 rounded-full transition-colors ${activeTab === tab.id ? 'bg-emerald-600' : 'bg-slate-300 hover:bg-slate-400'}`}
                  aria-label={`${i + 1}. ${tab.label}`}
                />
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
                  (!isEdit && ((!isIPMode && !isOPMode) || (isIPMode && !currentAdmission)))
                }
                className={CM_BTN_PRIMARY}>
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Record'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}