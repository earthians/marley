// import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
// import { useLabTests } from '../../hooks/useLabTests'
// import { useCareContext } from '../../providers/CareContextProvider'
// import { StatusPill } from '../ui/StatusPill'
// import {
//   getLabTestConsumables,
//   requestLabConsumables,
//   fetchLabTest,
//   saveAndSubmitLabTest,
//   updateLabTestStatus,
//   finishGroupLabTests,
//   updateLabTestRemarks,
//   createSampleCollectionForLabSample,
//   fetchLabTestTemplateDetails,
//   type LabConsumableRow,
//   type LabTest,
//   type NormalTestResultRow,
//   type ObservationSampleCollectionRow,
//   type LabTestTemplateDetails,
// } from '../../services/labTests'
// import {
//   fetchItems,
//   fetchWarehouses,
//   fetchDocumentTypes,
//   fetchHealthcarePractitioners,
//   fetchLabTechnicianPractitioners,
//   fetchLabTestTemplates,
//   type LinkFieldOption,
// } from '../../services/common'
// import { uploadPatientFile, type PatientDocumentRow } from '../../services/patients'
// import { LabTestDetails } from './LabTestDetails'
// import { EditLabTestModal } from './EditLabTestModal'
// import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
// import { PortalActionsMenu } from '../ui/PortalActionsMenu'
// import { toast } from '../../hooks/useToast'
// import { canEditLabTestResults } from '../../config/permissions'
// import { Search, X, ChevronDown, ChevronRight } from 'lucide-react'

// // ─── Constants ─────────────────────────────────────────────────────────────

// const STATUS_OPTIONS = [
//   'Draft', 'Requested', 'Awaiting sample collection', 'Sample Collection in Progress',
//   'Sample Collected', 'Testing in progress', 'Completed', 'Pending Review',
//   'Reviewed', 'Rejected', 'Cancelled',
// ] as const

// const statusColors: Record<string, string> = {
//   'Reviewed': 'success', 'Rejected': 'danger', 'Completed': 'success',
//   'Pending Review': 'warning', 'Submitted': 'info', 'Cancelled': 'default',
//   'Draft': 'warning', 'Pending': 'warning', 'Requested': 'info',
//   'Awaiting sample collection': 'warning', 'Sample Collection in Progress': 'info',
//   'Sample Collected': 'info', 'Testing in progress': 'info',
// }

// const escapeHtml = (value: unknown): string =>
//   String(value ?? '')
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#39;')

// const fetchCostCenterLetterHead = async (costCenter?: string): Promise<{ content: string; footer: string }> => {
//   if (!costCenter) return { content: '', footer: '' }
//   try {
//     const ccRes = await fetch(
//       `/api/method/frappe.client.get_value?doctype=Cost+Center&fieldname=custom_letter_head&filters=${encodeURIComponent(JSON.stringify({ name: costCenter }))}`,
//       { credentials: 'include' }
//     )
//     const ccData = await ccRes.json().catch(() => ({}))
//     const letterHeadName = ccData?.message?.custom_letter_head as string | undefined
//     if (!letterHeadName) return { content: '', footer: '' }

//     const lhRes = await fetch(
//       `/api/method/frappe.client.get?doctype=Letter+Head&name=${encodeURIComponent(letterHeadName)}`,
//       { credentials: 'include' }
//     )
//     const lhData = await lhRes.json().catch(() => ({}))
//     const doc = lhData?.message || {}
//     return {
//       content: String(doc.content || ''),
//       footer: String(doc.footer || ''),
//     }
//   } catch {
//     return { content: '', footer: '' }
//   }
// }

// interface Filters {
//   status: string; fromDate: string; toDate: string
//   isOutsourced: string; opIp: string; template: string; templateLabel: string
// }

// const makeEmptyFilters = (): Filters => ({
//   status: '', fromDate: '', toDate: '', isOutsourced: '', opIp: '', template: '', templateLabel: '',
// })

// // ─── Filter Bar ─────────────────────────────────────────────────────────────

// const FilterBar = ({ filters, onChange, onClear, activeCount, byNurse }: {
//   filters: Filters; onChange: (f: Filters) => void; onClear: () => void; activeCount: number
//   /** When true, template search only lists Lab Test Templates with by_nurse set */
//   byNurse?: boolean
// }) => {
//   const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value })
//   const [templateQuery, setTemplateQuery] = useState('')
//   const [templateOptions, setTemplateOptions] = useState<LinkFieldOption[]>([])
//   const [templateOpen, setTemplateOpen] = useState(false)

//   useEffect(() => {
//     if (!templateOpen) return
//     const t = setTimeout(async () => {
//       try {
//         setTemplateOptions(await fetchLabTestTemplates(templateQuery || undefined, undefined, byNurse))
//       } catch { setTemplateOptions([]) }
//     }, templateQuery.trim() === '' ? 0 : 300)
//     return () => clearTimeout(t)
//   }, [templateOpen, templateQuery, byNurse])

//   return (
//     <div className="flex flex-wrap items-end gap-3 px-3 py-1.5 bg-white border-b border-slate-200">
//       <div className="flex flex-col gap-1 min-w-[160px]">
//         <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
//         <div className="relative">
//           <select value={filters.status} onChange={(e) => set('status', e.target.value)}
//             className="w-full appearance-none pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary">
//             <option value="">Select All</option>
//             {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
//           </select>
//           <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
//         </div>
//       </div>
//       <div className="flex flex-col gap-1 min-w-[150px]">
//         <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">From Date</label>
//         <DateFilterInput value={filters.fromDate} onChange={(e) => set('fromDate', e.target.value)}
//           className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary" />
//       </div>
//       <div className="flex flex-col gap-1 min-w-[150px]">
//         <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">To Date</label>
//         <DateFilterInput value={filters.toDate} onChange={(e) => set('toDate', e.target.value)}
//           className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary" />
//       </div>
//       <div className="flex flex-col gap-1 min-w-[140px]">
//         <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">OP / IP</label>
//         <div className="relative">
//           <select value={filters.opIp} onChange={(e) => set('opIp', e.target.value)}
//             className="w-full appearance-none pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary">
//             <option value="">Select All</option><option value="OP">OP</option><option value="IP">IP</option>
//           </select>
//           <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
//         </div>
//       </div>
//       <div className="flex flex-col gap-1 min-w-[160px]">
//         <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Is Outsourced</label>
//         <div className="relative">
//           <select value={filters.isOutsourced} onChange={(e) => set('isOutsourced', e.target.value)}
//             className="w-full appearance-none pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary">
//             <option value="">Select All</option><option value="yes">Yes</option><option value="no">No</option>
//           </select>
//           <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
//         </div>
//       </div>
//       <div className="flex flex-col gap-1 min-w-[200px] relative">
//         <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lab Test Template</label>
//         <div className="relative">
//           <input type="text" value={filters.template ? filters.templateLabel : templateQuery}
//             onChange={(e) => { setTemplateQuery(e.target.value); onChange({ ...filters, template: '', templateLabel: '' }); setTemplateOpen(true) }}
//             onFocus={() => setTemplateOpen(true)} placeholder="Search lab test template..."
//             className="w-full pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary" />
//           {filters.template && (
//             <button type="button" onClick={() => { setTemplateQuery(''); onChange({ ...filters, template: '', templateLabel: '' }) }}
//               className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
//               <X className="w-3.5 h-3.5" />
//             </button>
//           )}
//           <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
//         </div>
//         {templateOpen && templateOptions.length > 0 && (
//           <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
//             {templateOptions.map((opt) => (
//               <button key={opt.name} type="button"
//                 onClick={() => { onChange({ ...filters, template: opt.name, templateLabel: opt.label || opt.name }); setTemplateQuery(''); setTemplateOpen(false) }}
//                 className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none">
//                 <div className="font-medium text-slate-800">{opt.label || opt.name}</div>
//                 {opt.label && opt.label !== opt.name && <div className="text-xs text-slate-500">{opt.name}</div>}
//               </button>
//             ))}
//           </div>
//         )}
//       </div>
//       {activeCount > 0 && (
//         <button type="button" onClick={onClear}
//           className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors self-end">
//           <X className="w-3.5 h-3.5" />Clear
//           <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold">{activeCount}</span>
//         </button>
//       )}
//     </div>
//   )
// }

// // Helper function to calculate group completion status based on docstatus (submitted)
// const getGroupCompletionStatus = (children: LabTest[]) => {
//   const total = children.length
//   // Count tests that are submitted (docstatus === 1)
//   const completedCount = children.filter(child => child.docstatus === 1).length
  
//   if (completedCount === 0) return { status: 'Not Started', color: 'warning', icon: '○' }
//   if (completedCount === total) return { status: 'Complete', color: 'success', icon: '✓' }
//   return { status: 'Partially Complete', color: 'info', icon: '◐' }
// }

// // ─── Main Component ──────────────────────────────────────────────────────────

// export const LabTestList = ({
//   patient, isOutsourced, defaultStatus, byNurse,
// }: { patient?: string; isOutsourced?: boolean; defaultStatus?: string; byNurse?: boolean }) => {
//   const { mode, selectedPatient: contextPatient, userRole } = useCareContext()
//   const effectivePatient = patient ?? (contextPatient || undefined)
//   const canEditResults = canEditLabTestResults(userRole)

//   const [filters, setFilters] = useState<Filters>(() => ({
//     ...makeEmptyFilters(),
//     status: defaultStatus ?? '',
//     opIp: mode === 'IP' ? 'IP' : mode === 'OP' ? 'OP' : '',
//   }))

//   useEffect(() => {
//     setFilters(prev => ({ ...prev, opIp: mode === 'IP' ? 'IP' : mode === 'OP' ? 'OP' : '' }))
//   }, [mode])

//   const activeCount = [filters.status, filters.fromDate, filters.toDate, filters.isOutsourced, filters.opIp, filters.template].filter(Boolean).length

//   const { labTests, loading, error, refetch } = useLabTests(
//     effectivePatient, filters.status || undefined, filters.status === 'Pending Review',
//     isOutsourced !== undefined ? isOutsourced : (filters.isOutsourced ? filters.isOutsourced === 'yes' : undefined),
//     filters.fromDate || undefined, filters.toDate || undefined,
//     filters.template || undefined, filters.opIp || undefined, byNurse
//   )

//   // ── Inline Result Editing ──
//   const [editingResult, setEditingResult] = useState<string | null>(null)
//   const [editingValue, setEditingValue] = useState<string>('')
//   const [updatingResult, setUpdatingResult] = useState<string | null>(null)

//   /** Inline lab technician picker (table column after Results). */
//   const [inlineLabTechLabTestName, setInlineLabTechLabTestName] = useState<string | null>(null)
//   const [inlineLabTechQuery, setInlineLabTechQuery] = useState('')
//   const [inlineLabTechOptions, setInlineLabTechOptions] = useState<LinkFieldOption[]>([])
//   const [updatingInlineLabTech, setUpdatingInlineLabTech] = useState<string | null>(null)

//   const handleInlineResultUpdate = async (labTestName: string, newResult: string) => {
//     setUpdatingResult(labTestName)
//     try {
//       const current = await fetchLabTest(labTestName)
//       if (!current.lab_technician?.trim()) {
//         toast.error('Select a lab technician in the Lab technician column before saving the result.')
//         return
//       }
//       await saveAndSubmitLabTest(labTestName, { custom_result: newResult, submit: true })
//       await refetch()
//       toast.success('Result updated')
//     } catch (e) {
//       toast.error(e instanceof Error ? e.message : 'Failed to update result')
//     } finally {
//       setUpdatingResult(null); setEditingResult(null); setEditingValue('')
//     }
//   }

//   const handleInlineLabTechSave = async (labTestName: string, practitionerId: string) => {
//     const id = practitionerId.trim()
//     if (!id) return
//     setUpdatingInlineLabTech(labTestName)
//     try {
//       await saveAndSubmitLabTest(labTestName, { lab_technician: id, submit: false })
//       await refetch()
//       toast.success('Lab technician saved')
//     } catch (e) {
//       toast.error(e instanceof Error ? e.message : 'Failed to save lab technician')
//     } finally {
//       setUpdatingInlineLabTech(null)
//       setInlineLabTechLabTestName(null)
//       setInlineLabTechQuery('')
//       setInlineLabTechOptions([])
//     }
//   }

//   // ── Consumables dialog ───────────────────────────────────────────────────
//   const [requestingFor, setRequestingFor] = useState<string | null>(null)
//   const [dialogItems, setDialogItems] = useState<LabConsumableRow[]>([])
//   const [dialogLoading, setDialogLoading] = useState(false)
//   const [dialogError, setDialogError] = useState<string | null>(null)
//   const [itemOptions, setItemOptions] = useState<LinkFieldOption[]>([])
//   const [warehouseOptions, setWarehouseOptions] = useState<LinkFieldOption[]>([])
//   const [openItemIndex, setOpenItemIndex] = useState<number | null>(null)
//   const [openWarehouseIndex, setOpenWarehouseIndex] = useState<number | null>(null)

//   // ── Results dialog ───────────────────────────────────────────────────────
//   const [resultDialogOpen, setResultDialogOpen] = useState(false)
//   const [resultDialogLoading, setResultDialogLoading] = useState(false)
//   const [resultDialogError, setResultDialogError] = useState<string | null>(null)
//   const [activeLabTest, setActiveLabTest] = useState<LabTest | null>(null)
//   const [customResult, setCustomResult] = useState('')
//   const [labComment, setLabComment] = useState('')
//   const [worksheetText, setWorksheetText] = useState('')
//   const [resultDialogTab, setResultDialogTab] = useState<'results' | 'documents'>('results')
//   const [resultDocuments, setResultDocuments] = useState<PatientDocumentRow[]>([])
//   const [resultDocumentTypes, setResultDocumentTypes] = useState<{ name: string; document_name?: string }[]>([])
//   const [resultDocumentUploading, setResultDocumentUploading] = useState<number | null>(null)
//   const [normalTestItems, setNormalTestItems] = useState<NormalTestResultRow[]>([])
//   const [templateDetails, setTemplateDetails] = useState<LabTestTemplateDetails>({})
//   const [worksheetExpanded, setWorksheetExpanded] = useState(false)
//   const [labTechnician, setLabTechnician] = useState('')
//   const [labTechnicianQuery, setLabTechnicianQuery] = useState('')
//   const [labTechnicianOptions, setLabTechnicianOptions] = useState<LinkFieldOption[]>([])
//   const [labTechnicianOpen, setLabTechnicianOpen] = useState(false)

//   // ── Review / actions ───────────────────────────────────────────────────────
//   const [openActionRow, setOpenActionRow] = useState<string | null>(null)
//   const [actionLoading, setActionLoading] = useState<string | null>(null)
//   const [selectedLabTestForDetails, setSelectedLabTestForDetails] = useState<string | null>(null)
//   const [editLabTestName, setEditLabTestName] = useState<string | null>(null)
//   const actionMenuRef = useRef<HTMLDivElement>(null)
//   const [sampleModalLabTest, setSampleModalLabTest] = useState<LabTest | null>(null)
//   const [sampleModalLoading, setSampleModalLoading] = useState(false)
//   const [sampleModalError, setSampleModalError] = useState<string | null>(null)
//   const [sampleFormRowIndex, setSampleFormRowIndex] = useState<number | null>(null)
//   const [sampleFormLoading, setSampleFormLoading] = useState(false)
//   const [sampleFormError, setSampleFormError] = useState<string | null>(null)
//   const [sampleFormCollectionPoint, setSampleFormCollectionPoint] = useState<string>('')
//   const [sampleFormRefPractitioner, setSampleFormRefPractitioner] = useState<string>('')
//   const [refPractitionerOptions, setRefPractitionerOptions] = useState<LinkFieldOption[]>([])
//   const [refPractitionerQuery, setRefPractitionerQuery] = useState('')
//   const [refPractitionerOpen, setRefPractitionerOpen] = useState(false)
//   const [sampleObsRows, setSampleObsRows] = useState<ObservationSampleCollectionRow[]>([])
//   const [templateSampleDetails, setTemplateSampleDetails] = useState('')
//   const [expandedSampleDetailIdx, setExpandedSampleDetailIdx] = useState<number | null>(null)
//   const [expandedGroupKeys, setExpandedGroupKeys] = useState<Record<string, boolean>>({})
//   const [finishingGroupKey, setFinishingGroupKey] = useState<string | null>(null)
//   // Track if create sample modal is open to close the parent modal
//   const [isCreatingSample, setIsCreatingSample] = useState(false)

//   useEffect(() => {
//     const loadPractitioners = async () => {
//       if (!refPractitionerQuery.trim()) { setRefPractitionerOptions([]); return }
//       try { setRefPractitionerOptions(await fetchHealthcarePractitioners(refPractitionerQuery.trim())) }
//       catch { setRefPractitionerOptions([]) }
//     }
//     loadPractitioners()
//   }, [refPractitionerQuery])

//   useEffect(() => {
//     if (!resultDialogOpen) return
//     const t = setTimeout(async () => {
//       try {
//         setLabTechnicianOptions(await fetchLabTechnicianPractitioners(labTechnicianQuery.trim() || undefined))
//       } catch {
//         setLabTechnicianOptions([])
//       }
//     }, labTechnicianQuery.trim() === '' ? 0 : 300)
//     return () => clearTimeout(t)
//   }, [resultDialogOpen, labTechnicianQuery])

//   useEffect(() => {
//     if (!inlineLabTechLabTestName) return
//     const t = setTimeout(async () => {
//       try {
//         setInlineLabTechOptions(await fetchLabTechnicianPractitioners(inlineLabTechQuery.trim() || undefined))
//       } catch {
//         setInlineLabTechOptions([])
//       }
//     }, inlineLabTechQuery.trim() === '' ? 0 : 300)
//     return () => clearTimeout(t)
//   }, [inlineLabTechLabTestName, inlineLabTechQuery])

//   useEffect(() => {
//     if (!inlineLabTechLabTestName) return
//     const close = (e: MouseEvent) => {
//       const el = e.target as HTMLElement
//       if (el.closest('[data-inline-lab-tech-cell]')) return
//       setInlineLabTechLabTestName(null)
//       setInlineLabTechQuery('')
//       setInlineLabTechOptions([])
//     }
//     document.addEventListener('mousedown', close)
//     return () => document.removeEventListener('mousedown', close)
//   }, [inlineLabTechLabTestName])

//   useEffect(() => {
//     const handler = (e: MouseEvent) => {
//       const el = e.target as HTMLElement
//       if (el.closest('[data-portal-actions-menu]')) return
//       if (el.closest('button[aria-label="Actions"]')) return
//       if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) setOpenActionRow(null)
//     }
//     document.addEventListener('mousedown', handler)
//     return () => document.removeEventListener('mousedown', handler)
//   }, [])

//   const handleStatusChange = async (name: string, newStatus: 'Reviewed' | 'Rejected') => {
//     setOpenActionRow(null); setActionLoading(name)
//     try {
//       await updateLabTestStatus(name, newStatus)
//       toast.success(newStatus === 'Reviewed' ? 'Lab test reviewed' : 'Lab test rejected')
//       refetch()
//     } catch (e) {
//       toast.error(e instanceof Error ? e.message : `Failed to ${newStatus === 'Reviewed' ? 'review' : 'reject'} lab test`)
//     } finally { setActionLoading(null) }
//   }

//   const handleFinishGroup = async (serviceRequest: string, groupKey: string) => {
//     try {
//       setFinishingGroupKey(groupKey)
//       await finishGroupLabTests(serviceRequest)
//       toast.success('Grouped lab request finished')
//       await refetch()
//     } catch (e) {
//       toast.error(e instanceof Error ? e.message : 'Failed to finish grouped lab request')
//     } finally { setFinishingGroupKey(null) }
//   }

//   const handleOpenSampleCollection = (labTest: LabTest) => {
//     setOpenActionRow(null); setSampleModalError(null); setSampleModalLoading(true); setSampleModalLabTest(null)
//     fetchLabTest(labTest.name)
//       .then(setSampleModalLabTest)
//       .catch((e) => { const msg = e instanceof Error ? e.message : 'Failed to load lab test'; setSampleModalError(msg); toast.error(msg) })
//       .finally(() => setSampleModalLoading(false))
//   }

//   // ── Remarks modal ──────────────────────────────────────────────────────────
//   const [remarksModalOpen, setRemarksModalOpen] = useState(false)
//   const [remarksLabTestName, setRemarksLabTestName] = useState<string | null>(null)
//   const [remarksList, setRemarksList] = useState<Array<{ rrmark: string }>>([{ rrmark: '' }])
//   const [remarksLoading, setRemarksLoading] = useState(false)
//   const [remarksError, setRemarksError] = useState<string | null>(null)

//   const openRemarksModal = async (labTestName: string) => {
//     setOpenActionRow(null); setRemarksLabTestName(labTestName); setRemarksError(null)
//     setRemarksList([{ rrmark: '' }]); setRemarksLoading(true); setRemarksModalOpen(true)
//     try {
//       const doc = await fetchLabTest(labTestName)
//       const existing = (doc as LabTest).remarks
//       setRemarksList(existing?.length ? existing.map((r) => ({ rrmark: r.rrmark || '' })) : [{ rrmark: '' }])
//     } catch (e) { setRemarksError(e instanceof Error ? e.message : 'Failed to load lab test') }
//     finally { setRemarksLoading(false) }
//   }
//   const closeRemarksModal = () => { setRemarksModalOpen(false); setRemarksLabTestName(null); setRemarksList([{ rrmark: '' }]); setRemarksError(null) }
//   const addRemarksRow = () => setRemarksList((prev) => [...prev, { rrmark: '' }])
//   const updateRemarksRow = (idx: number, value: string) => setRemarksList((prev) => { const next = [...prev]; next[idx] = { rrmark: value }; return next })
//   const removeRemarksRow = (idx: number) => setRemarksList((prev) => prev.length <= 1 ? [{ rrmark: '' }] : prev.filter((_, i) => i !== idx))
//   const handleSubmitRemarks = async () => {
//     if (!remarksLabTestName) return
//     const payload = remarksList.map((r) => ({ rrmark: (r.rrmark || '').trim() })).filter((r) => r.rrmark)
//     setRemarksLoading(true); setRemarksError(null)
//     try {
//       await updateLabTestRemarks(remarksLabTestName, payload.length ? payload : [])
//       toast.success('Remarks saved'); refetch(); closeRemarksModal()
//     } catch (e) { setRemarksError(e instanceof Error ? e.message : 'Failed to save remarks'); toast.error('Failed to save remarks') }
//     finally { setRemarksLoading(false) }
//   }

//   const openRequestDialog = async (labTest: LabTest) => {
//     try {
//       setDialogError(null); setDialogLoading(true); setRequestingFor(labTest.name)
//       if (!itemOptions.length) fetchItems().then(setItemOptions).catch(() => setItemOptions([]))
//       if (!warehouseOptions.length) fetchWarehouses(labTest.company || undefined).then(setWarehouseOptions).catch(() => setWarehouseOptions([]))
//       const items = await getLabTestConsumables(labTest.name)
//       setDialogItems(items.length ? items : [{ item_code: '', item_name: '', qty: 1 }])
//     } catch (e) { setDialogError(e instanceof Error ? e.message : 'Failed to load consumables') }
//     finally { setDialogLoading(false) }
//   }
//   const closeRequestDialog = () => { setRequestingFor(null); setDialogItems([]); setDialogError(null); setDialogLoading(false) }
//   const updateItem = (index: number, field: keyof LabConsumableRow, value: string) => {
//     setDialogItems((prev) => prev.map((row, i) => i === index ? { ...row, [field]: field === 'qty' ? Number(value) || 0 : value } : row))
//   }
//   const addRow = () => setDialogItems((prev) => [...prev, { item_code: '', item_name: '', qty: 1 }])
//   const removeRow = (index: number) => setDialogItems((prev) => prev.filter((_, i) => i !== index))
//   const submitRequest = async () => {
//     if (!requestingFor) return
//     const validItems = dialogItems.filter((row) => row.item_code && row.qty > 0)
//     if (!validItems.length) { setDialogError('Please add at least one item with quantity.'); return }
//     try {
//       setDialogLoading(true); setDialogError(null)
//       const mrName = await requestLabConsumables(requestingFor, validItems)
//       await refetch(); closeRequestDialog(); alert(`Material Request ${mrName} created`)
//     } catch (e) { setDialogError(e instanceof Error ? e.message : 'Failed to create Material Request') }
//     finally { setDialogLoading(false) }
//   }

//   const openResultDialog = async (labTestName: string) => {
//     try {
//       setResultDialogError(null); setResultDialogLoading(true); setResultDialogOpen(true)
//       setResultDialogTab('results'); setWorksheetExpanded(false)
//       setActiveLabTest({ name: labTestName, patient: '' })
//       const [doc, docTypes] = await Promise.all([fetchLabTest(labTestName), fetchDocumentTypes()])
//       setActiveLabTest(doc); setCustomResult(doc.custom_result || ''); setLabComment(doc.lab_test_comment || '')
//       setWorksheetText(doc.worksheet_instructions || ''); setResultDocumentTypes(docTypes)
//       const existingItems: NormalTestResultRow[] = (doc.normal_test_items || []).map((r: any) => ({ ...r }))
//       setNormalTestItems(existingItems)
//       if (doc.template) {
//         fetchLabTestTemplateDetails(doc.template).then((d) => {
//           setTemplateDetails(d)
//           if (!doc.worksheet_instructions && d.worksheet_instructions) setWorksheetText(d.worksheet_instructions)
//           if (existingItems.length === 0 && (d.normal_test_templates || []).length > 0) {
//             setNormalTestItems((d.normal_test_templates || []).map((t) => ({
//               lab_test_event: t.lab_test_event || '', lab_test_name: t.lab_test_event || '',
//               lab_test_uom: t.lab_test_uom || '', normal_range: t.normal_range || '',
//               result_value: '', lab_test_comment: '', template: doc.template || '',
//             })))
//           }
//         }).catch(() => setTemplateDetails({}))
//       } else { setTemplateDetails({}) }
//       const docs = (doc as LabTest).documents?.length
//         ? (doc as LabTest).documents!.map((d) => ({ file_name: d.file_name || '', document_type: d.document_type || '', transaction_no: d.transaction_no || '', upload_remarks: d.upload_remarks || '', document: d.document || '' }))
//         : [{ file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }]
//       setResultDocuments(docs)
//       setLabTechnician(doc.lab_technician || '')
//       setLabTechnicianQuery((doc.lab_technician_name || '').trim() || '')
//       setLabTechnicianOpen(false)
//     } catch (e) { setResultDialogError(e instanceof Error ? e.message : 'Failed to load lab test') }
//     finally { setResultDialogLoading(false) }
//   }
//   const closeResultDialog = () => {
//     setResultDialogOpen(false); setActiveLabTest(null); setCustomResult(''); setLabComment('')
//     setWorksheetText(''); setResultDialogTab('results'); setResultDocuments([])
//     setResultDialogError(null); setResultDialogLoading(false); setNormalTestItems([]); setTemplateDetails({}); setWorksheetExpanded(false)
//     setLabTechnician(''); setLabTechnicianQuery(''); setLabTechnicianOptions([]); setLabTechnicianOpen(false)
//   }
//   const addResultDocumentRow = () => setResultDocuments(prev => [...prev, { file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }])
//   const updateResultDocumentRow = (idx: number, field: keyof PatientDocumentRow, value: string) => {
//     setResultDocuments(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next })
//   }
//   const handleResultDocumentFile = async (idx: number, file: File | null) => {
//     if (!file) return
//     setResultDocumentUploading(idx)
//     try {
//       const file_url = await uploadPatientFile(file)
//       if (!file_url) throw new Error('No URL returned from upload')
//       setResultDocuments(prev => { const next = [...prev]; next[idx] = { ...next[idx], document: file_url, file_name: (next[idx].file_name || '').trim() || file.name }; return next })
//       toast.success('File uploaded')
//     } catch (err) { toast.error(err instanceof Error ? err.message : 'File upload failed') }
//     finally { setResultDocumentUploading(null) }
//   }
//   const handleSubmitLabTestWithResults = async () => {
//     if (!activeLabTest) return
//     if (!labTechnician.trim()) {
//       setResultDialogError('Lab technician is required. Choose an active practitioner with Medical Role Lab Technologist or Lab Technician.')
//       return
//     }
//     try {
//       setResultDialogLoading(true); setResultDialogError(null)
//       const docPayload = resultDocuments.filter((r) => (r.file_name || '').trim() || (r.document || '').trim())
//         .map((r) => ({ file_name: (r.file_name || '').trim() || undefined, document_type: (r.document_type || '').trim() || undefined, transaction_no: (r.transaction_no || '').trim() || undefined, upload_remarks: (r.upload_remarks || '').trim() || undefined, document: (r.document || '').trim() || undefined }))
//       await saveAndSubmitLabTest(activeLabTest.name, {
//         custom_result: customResult, lab_test_comment: labComment, worksheet_instructions: worksheetText,
//         documents: docPayload.length ? docPayload : undefined,
//         normal_test_items: normalTestItems.length ? normalTestItems : undefined,
//         lab_technician: labTechnician.trim(),
//         submit: true,
//       })
//       await refetch(); closeResultDialog()
//     } catch (e) { setResultDialogError(e instanceof Error ? e.message : 'Failed to submit lab test with results') }
//     finally { setResultDialogLoading(false) }
//   }

//   const getRangeHeaders = (list: LabTest[]) => {
//     if (!list.length) return { showFemale: false, showMale: false, showGeneric: true }
//     const gender = list[0].gender
//     if (gender === 'Female') return { showFemale: true, showMale: false, showGeneric: false }
//     if (gender === 'Male') return { showFemale: false, showMale: true, showGeneric: false }
//     return { showFemale: false, showMale: false, showGeneric: true }
//   }

//   // ── Group metadata ──────────────────────────────────────────────────────────
//   const { groupedData, standaloneTests } = useMemo(() => {
//     const groups = new Map<string, LabTest[]>()
//     const standalone: LabTest[] = []

//     for (const lt of labTests) {
//       if (lt.is_group_lab_test && lt.service_request) {
//         const arr = groups.get(lt.service_request) || []
//         arr.push(lt)
//         groups.set(lt.service_request, arr)
//       } else {
//         standalone.push(lt)
//       }
//     }

//     const sortedGroups = new Map<string, LabTest[]>()
//     for (const [key, children] of groups.entries()) {
//       sortedGroups.set(key, [...children].sort((a, b) => a.name.localeCompare(b.name)))
//     }

//     return { groupedData: sortedGroups, standaloneTests: standalone }
//   }, [labTests])

//   const rangeHeaders = getRangeHeaders(labTests)

//   // Helper: render the result edit cell for a child/standalone test
//   const renderResultCell = (labTest: LabTest) => (
//     <td className="px-3 py-1.5 text-sm max-w-[200px]">
//       {updatingResult === labTest.name ? (
//         <div className="flex items-center gap-1">
//           <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
//             <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//             <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
//           </svg>
//           <span className="text-xs text-slate-400">Updating...</span>
//         </div>
//       ) : editingResult === labTest.name ? (
//         <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
//           <input type="text" value={editingValue} onChange={(e) => setEditingValue(e.target.value)}
//             onKeyDown={(e) => { if (e.key === 'Enter') handleInlineResultUpdate(labTest.name, editingValue); else if (e.key === 'Escape') { setEditingResult(null); setEditingValue('') } }}
//             onBlur={() => handleInlineResultUpdate(labTest.name, editingValue)}
//             className="w-full px-2 py-1 text-sm border border-primary rounded-md focus:outline-none focus:ring-2 focus:ring-primary" autoFocus />
//         </div>
//       ) : (
//         <div onClick={(e) => {
//           e.stopPropagation()
//           if (!canEditResults) return
//           setEditingResult(labTest.name)
//           setEditingValue(labTest.custom_result || '')
//         }}
//           className={`${canEditResults ? 'cursor-pointer hover:bg-slate-100' : 'cursor-not-allowed bg-slate-50'} rounded-md px-2 py-1 transition-colors ${labTest.custom_result ? 'text-slate-800 font-medium' : 'text-slate-300 italic'}`}
//           title={canEditResults ? 'Click to edit result' : 'Only LabTest Approver, System Manager, or Healthcare Administrator can edit results'}>
//           {labTest.custom_result || 'Click to add result'}
//         </div>
//       )}
//     </td>
//   )

//   const renderTechnicianCell = (labTest: LabTest) => {
//     const displayName = (labTest.lab_technician_name || '').trim() || labTest.lab_technician || ''
//     const isDraft = labTest.docstatus === 0
//     if (!isDraft) {
//       return (
//         <td className="px-3 py-1.5 text-sm text-slate-700 max-w-[200px]">
//           <span className="truncate block" title={displayName || undefined}>{displayName || '—'}</span>
//         </td>
//       )
//     }
//     if (!canEditResults) {
//       return (
//         <td className="px-3 py-1.5 text-sm text-slate-600 max-w-[200px]">
//           <span className="truncate block text-slate-500" title={displayName || undefined}>{displayName || '—'}</span>
//         </td>
//       )
//     }
//     return (
//       <td className="px-3 py-1.5 text-sm max-w-[220px] align-top" data-inline-lab-tech-cell onClick={(e) => e.stopPropagation()}>
//         {updatingInlineLabTech === labTest.name ? (
//           <div className="flex items-center gap-1 text-xs text-slate-500">
//             <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
//               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
//             </svg>
//             Saving…
//           </div>
//         ) : inlineLabTechLabTestName === labTest.name ? (
//           <div className="relative z-20" data-inline-lab-tech-popover>
//             <input
//               type="text"
//               value={inlineLabTechQuery}
//               onChange={(e) => setInlineLabTechQuery(e.target.value)}
//               className="w-full rounded border border-primary px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
//               placeholder="Search by name…"
//               autoFocus
//             />
//             <div className="absolute left-0 right-0 mt-1 max-h-40 overflow-auto rounded border border-slate-200 bg-white shadow-lg">
//               {inlineLabTechOptions.length === 0 ? (
//                 <div className="px-2 py-1.5 text-[11px] text-slate-500">No matches. Try another name.</div>
//               ) : (
//                 inlineLabTechOptions.map((opt) => (
//                   <button
//                     key={opt.name}
//                     type="button"
//                     className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 border-b border-slate-50 last:border-0"
//                     onMouseDown={(e) => e.preventDefault()}
//                     onClick={() => void handleInlineLabTechSave(labTest.name, opt.name)}
//                   >
//                     <span className="font-medium text-slate-800">{opt.label || opt.name}</span>
//                     {opt.medical_role ? <span className="block text-[10px] text-slate-500">{opt.medical_role}</span> : null}
//                   </button>
//                 ))
//               )}
//             </div>
//           </div>
//         ) : (
//           <button
//             type="button"
//             className={`w-full text-left rounded-md px-2 py-1 text-xs transition-colors truncate ${
//               displayName
//                 ? 'text-slate-800 font-medium hover:bg-slate-100 border border-transparent'
//                 : 'text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100'
//             }`}
//             title={displayName ? 'Change lab technician' : 'Choose lab technician'}
//             onClick={() => {
//               setInlineLabTechLabTestName(labTest.name)
//               setInlineLabTechQuery(displayName)
//             }}
//           >
//             {displayName || 'Choose technician…'}
//           </button>
//         )}
//       </td>
//     )
//   }

//   // Helper: render range cells
//   const renderRangeCells = (labTest: LabTest) => (
//     <>
//       {rangeHeaders.showFemale && (
//         <>
//           <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.female_min_range != null ? <span className="font-medium">{labTest.female_min_range}</span> : <span className="text-slate-300">—</span>}</td>
//           <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.female_max_range != null ? <span className="font-medium">{labTest.female_max_range}</span> : <span className="text-slate-300">—</span>}</td>
//         </>
//       )}
//       {rangeHeaders.showMale && (
//         <>
//           <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.male_min_range != null ? <span className="font-medium">{labTest.male_min_range}</span> : <span className="text-slate-300">—</span>}</td>
//           <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.male_max_range != null ? <span className="font-medium">{labTest.male_max_range}</span> : <span className="text-slate-300">—</span>}</td>
//         </>
//       )}
//       {rangeHeaders.showGeneric && (
//         <>
//           <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.min_range != null ? <span className="font-medium">{labTest.min_range}</span> : <span className="text-slate-300">—</span>}</td>
//           <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.max_range != null ? <span className="font-medium">{labTest.max_range}</span> : <span className="text-slate-300">—</span>}</td>
//         </>
//       )}
//     </>
//   )

//   // Helper: actions menu for any lab test row
//   const renderActionsCell = (labTest: LabTest, isGroupRow = false) => (
//     <td className="px-3 py-1.5 text-sm text-slate-700">
//       <div className="flex items-center gap-2 flex-wrap">
//         {isGroupRow && labTest.service_request && (
//           <button type="button" data-no-row-click
//             disabled={finishingGroupKey === labTest.service_request}
//             onClick={(e) => { e.stopPropagation(); handleFinishGroup(labTest.service_request!, labTest.service_request!) }}
//             className="px-2 py-1 text-xs rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
//             {finishingGroupKey === labTest.service_request ? 'Finishing…' : 'Finish Group'}
//           </button>
//         )}
//         <div className="relative inline-block" ref={openActionRow === labTest.name ? actionMenuRef : undefined}>
//           <button type="button"
//             onClick={() => setOpenActionRow((prev) => prev === labTest.name ? null : labTest.name)}
//             disabled={!!actionLoading}
//             className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
//             aria-label="Actions">
//             {actionLoading === labTest.name ? (
//               <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
//                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
//               </svg>
//             ) : (
//               <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
//                 <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
//               </svg>
//             )}
//           </button>
//           <PortalActionsMenu open={openActionRow === labTest.name} onClose={() => setOpenActionRow(null)} triggerRef={actionMenuRef} minWidth={160}>
//             <button type="button" onClick={() => { setOpenActionRow(null); setSelectedLabTestForDetails(labTest.name) }}
//               className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">View Details</button>
//             <button type="button" onClick={() => handleOpenSampleCollection(labTest)}
//               className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Sample Collection</button>
//             {labTest.docstatus === 0 && canEditResults && (
//               <button type="button" onClick={() => { setOpenActionRow(null); openResultDialog(labTest.name) }}
//                 className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Enter Results &amp; Submit</button>
//             )}
//             {labTest.docstatus === 0 && (
//               <button type="button" onClick={() => { setOpenActionRow(null); setEditLabTestName(labTest.name) }}
//                 className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Edit</button>
//             )}
//             <button type="button" onClick={() => openRemarksModal(labTest.name)}
//               className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Add Remarks</button>
//             {labTest.status === 'Pending Review' && (
//               <>
//                 <div className="border-t border-slate-100 my-1" />
//                 <button type="button" onClick={() => handleStatusChange(labTest.name, 'Reviewed')}
//                   className="block w-full text-left px-3 py-2 text-sm text-green-700 font-medium hover:bg-green-50">✓ Reviewed</button>
//                 <button type="button" onClick={() => handleStatusChange(labTest.name, 'Rejected')}
//                   className="block w-full text-left px-3 py-2 text-sm text-red-600 font-medium hover:bg-red-50">✗ Reject</button>
//               </>
//             )}
//           </PortalActionsMenu>
//         </div>
//         <PrintFormatDropdown doctype="Lab Test" docName={labTest.name} noLetterhead={0} triggerPrint={1} />
//       </div>
//     </td>
//   )

//   const handlePrintGroup = async (serviceRequest: string, groupLabel: string, children: LabTest[]) => {
    
//     try {
//       const fullTests = await Promise.all(children.map((c) => fetchLabTest(c.name)))
//       const issuedOn = new Date().toLocaleString('en-GB')
//       const first = fullTests[0]
//       const { content: letterHeadContent, footer: letterHeadFooter } = await fetchCostCenterLetterHead((first as any)?.cost_center)
//       const rowsHtml = fullTests.map((test) => {
//         const normalItems = ((test as any).normal_test_items || []) as any[]
//         const descriptiveItems = ((test as any).descriptive_test_items || []) as any[]

//         const resultBits: string[] = []
//         normalItems.forEach((item) => {
//           const main = `${item.result_value ?? ''}${item.lab_test_uom ? ` ${item.lab_test_uom}` : ''}`.trim()
//           const range = item.normal_range ? ` (Range: ${item.normal_range})` : ''
//           const flag = item.result_status ? ` [${item.result_status}]` : ''
//           if (main) resultBits.push(`${main}${range}${flag}`)
//         })
//         descriptiveItems.forEach((item) => {
//           if (item.lab_test_comment) resultBits.push(String(item.lab_test_comment))
//         })
//         if (!resultBits.length && (test as any).custom_result) {
//           resultBits.push(String((test as any).custom_result))
//         }
//         const combinedResult = resultBits.length ? resultBits.join(' | ') : 'No result entered'

//         return `
//           <tr>
//             <td>${escapeHtml(test.lab_test_name || test.name)}</td>
//             <td>${escapeHtml(combinedResult)}</td>
//             <td>${escapeHtml(test.status || 'Draft')}</td>
//             <td>${escapeHtml(test.result_date || '')}</td>
//           </tr>
//         `
//       }).join('')

//       const html = `
//         <html>
//           <head>
//             <title>Group Lab Test Print</title>
//             <style>
//               body { font-family: Arial, sans-serif; padding: 20px 20px 120px; color: #1f2937; }
//               h1 { margin: 0; font-size: 20px; color: #1e3a8a; }
//               .top { margin-bottom: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
//               .meta { font-size: 12px; color: #475569; margin-top: 4px; }
//               .letter-head-top { margin-bottom: 10px; }
//               .letter-head-footer { margin-top: 20px; }
//               .patient-table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; }
//               .patient-table td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 12px; }
//               .lbl { font-weight: bold; color: #1e3a8a; width: 16%; }
//               table { width: 100%; border-collapse: collapse; font-size: 12px; }
//               th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
//               th { background: #f1f5f9; }
//               @media print {
//                 @page { margin: 16mm 12mm 18mm; }
//                 body { padding: 0 0 95px 0; }
//                 .letter-head-footer {
//                   position: fixed;
//                   left: 0;
//                   right: 0;
//                   bottom: 0;
//                   margin: 0;
//                   padding: 6px 12px 0;
//                   background: #fff;
//                 }
//               }
//             </style>
//           </head>
//           <body>
//             ${letterHeadContent ? `<div class="letter-head-top">${letterHeadContent}</div>` : ''}
//             <div class="top">
//               <h1>${escapeHtml(groupLabel)} - Group Test Report</h1>
//               <div class="meta">Group Reference: ${escapeHtml(serviceRequest)} | Patient: ${escapeHtml(first?.patient_name || '')}</div>
//               <div class="meta">Printed On: ${escapeHtml(issuedOn)} | Total Tests: ${fullTests.length}</div>
//             </div>

//             <table class="patient-table">
//               <tr>
//                 <td class="lbl">Patient Name</td><td>${escapeHtml(first?.patient_name || '')}</td>
//                 <td class="lbl">Request No.</td><td>${escapeHtml(serviceRequest)}</td>
//               </tr>
//               <tr>
//                 <td class="lbl">Patient File No.</td><td>${escapeHtml(first?.patient || '')}</td>
//                 <td class="lbl">Date</td><td>${escapeHtml(first?.result_date || '')}</td>
//               </tr>
//               <tr>
//                 <td class="lbl">Referred Doctor</td><td>${escapeHtml(first?.practitioner_name || first?.practitioner || '')}</td>
//                 <td class="lbl">Visit No.</td><td>${escapeHtml(first?.service_request || '')}</td>
//               </tr>
//               <tr>
//                 <td class="lbl">IP Admission</td><td>${escapeHtml(first?.inpatient_record || '')}</td>
//                 <td class="lbl">User</td><td>${escapeHtml((first as any)?.custom_user || '')}</td>
//               </tr>
//             </table>

//             <table>
//               <thead>
//                 <tr><th>Test Item</th><th>Result / Observation</th><th>Status</th><th>Result Date</th></tr>
//               </thead>
//               <tbody>
//                 ${rowsHtml || '<tr><td colspan="4">No tests found in this group.</td></tr>'}
//               </tbody>
//             </table>
//             ${letterHeadFooter ? `<div class="letter-head-footer">${letterHeadFooter}</div>` : ''}
//           </body>
//         </html>
//       `

//       const win = window.open('', '_blank', 'width=1200,height=900')
//       if (!win) return
//       win.document.open()
//       win.document.write(html)
//       win.document.close()
//       win.focus()
//       win.print()
//     } catch (error) {
//       toast.error(error instanceof Error ? error.message : 'Failed to print group tests')
//     }
//   }

//   // ── Render ───────────────────────────────────────────────────────────────
//   return (
//     <div className="flex flex-col min-w-full">
//       <FilterBar
//         filters={filters}
//         onChange={setFilters}
//         onClear={() => setFilters(makeEmptyFilters())}
//         activeCount={activeCount}
//         byNurse={byNurse}
//       />

//       {loading ? (
//         <div className="flex items-center justify-center p-8"><div className="text-slate-600">Loading lab tests...</div></div>
//       ) : error ? (
//         <div className="flex flex-col items-center justify-center p-8">
//           <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl w-full">
//             <h3 className="text-red-800 font-semibold mb-2">Error Loading Lab Tests</h3>
//             <p className="text-red-700 text-sm mb-2">{error.message}</p>
//             <button onClick={() => refetch()} className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700">Retry</button>
//           </div>
//         </div>
//       ) : labTests.length === 0 ? (
//         <div className="flex flex-col items-center justify-center p-12 text-slate-400">
//           <Search className="w-10 h-10 mb-3 opacity-30" />
//           <p className="text-sm">{activeCount > 0 ? 'NO LAB TESTS MATCH THE CURRENT FILTERS.' : 'NO LAB TESTS FOUND.'}</p>
//           {activeCount > 0 && <button onClick={() => setFilters(makeEmptyFilters())} className="mt-3 text-sm text-primary hover:underline">Clear filters</button>}
//         </div>
//       ) : (
//         <div className="overflow-x-auto">
//           <table className="w-full min-w-[1180px]">
//             <thead className="bg-slate-50 border-b border-slate-200">
//               <tr>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Lab Test ID</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Patient</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Test Name</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Practitioner</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Status</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Outsourced</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Date</th>
//                 <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Amount</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Actions</th>
//                 {rangeHeaders.showFemale && <><th className="px-3 py-1.5 text-center text-xs font-semibold text-slate-600 uppercase">F-Min</th><th className="px-3 py-1.5 text-center text-xs font-semibold text-slate-600 uppercase">F-Max</th></>}
//                 {rangeHeaders.showMale && <><th className="px-3 py-1.5 text-center text-xs font-semibold text-slate-600 uppercase">M-Min</th><th className="px-3 py-1.5 text-center text-xs font-semibold text-slate-600 uppercase">M-Max</th></>}
//                 {rangeHeaders.showGeneric && <><th className="px-3 py-1.5 text-center text-xs font-semibold text-slate-600 uppercase">Min</th><th className="px-3 py-1.5 text-center text-xs font-semibold text-slate-600 uppercase">Max</th></>}
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Results</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Lab technician</th>
//                 <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Inventory</th>
//               </tr>
//             </thead>
//             <tbody className="divide-y divide-slate-200">

//               {/* ── GROUP ROWS ── */}
//               {Array.from(groupedData.entries()).map(([serviceRequest, children]) => {
//                 const isExpanded = !!expandedGroupKeys[serviceRequest]
//                 const representativeChild = children[0]
//                 const groupLabel = representativeChild.lab_test_group || representativeChild.lab_test_name || representativeChild.template || 'Group'
//                 const practitioner = representativeChild.practitioner_name || representativeChild.practitioner || '-'
//                 const combinedAmount = children.reduce((sum, c) => sum + (typeof c.grand_total === 'number' ? c.grand_total : typeof c.amount === 'number' ? c.amount : 0), 0)
//                 const latestDate = children.reduce((latest, c) => {
//                   const d = c.result_date || c.submitted_date || ''
//                   return d > latest ? d : latest
//                 }, '')
                
//                 const groupStatus = getGroupCompletionStatus(children)

//                 return (
//                   <Fragment key={`group-${serviceRequest}`}>
//                     <tr className="bg-indigo-50 hover:bg-indigo-100 border-l-4 border-indigo-400">
//                       {/* Lab Test ID - clickable to open group details? For now, keep non-clickable for group row */}
//                       <td className="px-3 py-1.5 text-sm font-medium text-indigo-800">
//                         <div className="flex items-center gap-1.5">
//                           <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-200 text-indigo-700">GROUP</span>
//                           <span className="text-xs text-indigo-600 truncate max-w-[100px]" title={serviceRequest}>{serviceRequest}</span>
//                         </div>
//                       </td>
//                       <td className="px-3 py-1.5 text-sm text-slate-700">{representativeChild.patient_name || representativeChild.patient}</td>
//                       <td className="px-3 py-1.5 text-sm">
//                         <button type="button" data-no-row-click
//                           onClick={(e) => { e.stopPropagation(); setExpandedGroupKeys(prev => ({ ...prev, [serviceRequest]: !isExpanded })) }}
//                           className="flex items-center gap-2 text-indigo-700 font-semibold hover:text-indigo-900">
//                           {isExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
//                           <span>{groupLabel}</span>
//                           <span className="text-xs font-normal text-indigo-500">({children.length} tests)</span>
//                         </button>
//                       </td>
//                       <td className="px-3 py-1.5 text-sm text-slate-700">{practitioner}</td>
//                       <td className="px-3 py-1.5">
//                         <div className="flex flex-col gap-1">
//                           <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
//                             groupStatus.status === 'Complete' ? 'bg-green-100 text-green-700' :
//                             groupStatus.status === 'Partially Complete' ? 'bg-blue-100 text-blue-700' :
//                             'bg-amber-100 text-amber-700'
//                           }`}>
//                             <span>{groupStatus.icon}</span>
//                             <span>{groupStatus.status}</span>
//                           </span>
//                           <span className="text-[10px] text-slate-500">
//                             {children.filter(labTestHasResultsEntered).length}/{children.length} with results
//                           </span>
//                         </div>
//                       </td>
//                       <td className="px-3 py-1.5"><span className="text-slate-400 text-xs">—</span></td>
//                       <td className="px-3 py-1.5 text-sm text-slate-700">{latestDate ? new Date(latestDate).toLocaleDateString('en-GB') : '-'}</td>
//                       <td className="px-3 py-1.5 text-sm font-semibold text-indigo-700 text-right">{combinedAmount > 0 ? combinedAmount.toFixed(3) : '-'}</td>
//                       <td className="px-3 py-1.5 text-sm text-slate-700">
//                         <div className="flex items-center gap-2">
//                           <button type="button" data-no-row-click
//                             disabled={groupStatus.status !== 'Complete' || finishingGroupKey === serviceRequest}
//                             onClick={(e) => { e.stopPropagation(); handleFinishGroup(serviceRequest, serviceRequest) }}
//                             className={`px-2 py-1 text-xs rounded-md border transition-colors ${
//                               groupStatus.status === 'Complete'
//                                 ? 'border-emerald-600 text-emerald-700 hover:bg-emerald-50'
//                                 : 'border-slate-300 text-slate-400 cursor-not-allowed'
//                             }`}
//                             title={groupStatus.status === 'Complete' ? 'Finish this grouped request' : 'All tests must be submitted first'}>
//                             {finishingGroupKey === serviceRequest ? 'Finishing…' : 'Finish Group'}
//                           </button>
//                           <button
//                             type="button"
//                             data-no-row-click
//                             onClick={(e) => {
//                               e.stopPropagation()
//                               void handlePrintGroup(serviceRequest, groupLabel, children)
//                             }}
//                             className="px-2 py-1 text-xs rounded-md border border-primary text-primary hover:bg-primary/5"
//                             title="Print all tests under this group"
//                           >
//                             Print Group
//                           </button>
//                         </div>
//                       </td>
//                       {rangeHeaders.showFemale && <><td /><td /></>}
//                       {rangeHeaders.showMale && <><td /><td /></>}
//                       {rangeHeaders.showGeneric && <><td /><td /></>}
//                       <td className="px-3 py-1.5 text-xs text-indigo-400 italic">— group —</td>
//                       <td className="px-3 py-1.5"><span className="text-xs text-slate-400">—</span></td>
//                       <td className="px-3 py-1.5"><span className="text-xs text-slate-400">—</span></td>
//                     </tr>

//                     {isExpanded && children.map((child) => (
//                       <tr key={child.name} className="bg-indigo-50/30 hover:bg-indigo-50">
//                         {/* Lab Test ID - clickable to open details modal */}
//                         <td 
//                           className="px-3 py-1.5 text-sm font-medium text-slate-700 pl-8 cursor-pointer hover:text-indigo-600"
//                           onClick={(e) => {
//                             e.stopPropagation();
//                             setSelectedLabTestForDetails(child.name);
//                           }}
//                         >
//                           ↳ {child.name}
//                         </td>
//                         <td className="px-3 py-1.5 text-sm text-slate-500">{child.patient_name || child.patient}</td>
//                         <td className="px-3 py-1.5 text-sm text-slate-700 pl-6">{child.lab_test_name || child.template || '-'}</td>
//                         <td className="px-3 py-1.5 text-sm text-slate-700">{child.practitioner_name || child.practitioner || '-'}</td>
//                         <td className="px-3 py-1.5"><StatusPill status={statusDisplayLabel(child.status || 'Draft')} color={statusColors[child.status || 'Draft'] || 'default'} /></td>
//                         <td className="px-3 py-1.5">
//                           {child.is_outsourced
//                             ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Outsourced</span>
//                             : <span className="text-slate-400 text-xs">—</span>}
//                         </td>
//                         <td className="px-3 py-1.5 text-sm text-slate-700">
//                           {child.result_date ? new Date(child.result_date).toLocaleDateString('en-GB') : child.submitted_date ? new Date(child.submitted_date).toLocaleDateString('en-GB') : '-'}
//                         </td>
//                         <td className="px-3 py-1.5 text-sm text-slate-700 text-right">
//                           {typeof child.grand_total === 'number' ? child.grand_total.toFixed(3) : typeof child.amount === 'number' ? child.amount.toFixed(3) : '-'}
//                         </td>
//                         {renderActionsCell(child)}
//                         {renderRangeCells(child)}
//                         {renderResultCell(child)}
//                         {renderTechnicianCell(child)}
//                         <td className="px-3 py-1.5 text-sm text-slate-700">
//                           {child.docstatus === 0 && !child.material_request
//                             ? <button type="button" onClick={() => openRequestDialog(child)} className="px-2 py-1 text-xs rounded-md border border-primary text-primary hover:bg-primary/5">Request Consumables</button>
//                             : child.material_request ? <span className="text-xs text-slate-500">MR: {child.material_request}</span>
//                             : <span className="text-xs text-slate-400">-</span>}
//                         </td>
//                       </tr>
//                     ))}
//                   </Fragment>
//                 )
//               })}

//               {/* ── STANDALONE (non-grouped) ROWS ── */}
//               {standaloneTests.map((labTest) => (
//                 <tr key={labTest.name} className="hover:bg-slate-50">
//                   {/* Lab Test ID - clickable to open details modal */}
//                   <td 
//                     className="px-3 py-1.5 text-sm font-medium text-slate-900 cursor-pointer hover:text-primary"
//                     onClick={(e) => {
//                       e.stopPropagation();
//                       setSelectedLabTestForDetails(labTest.name);
//                     }}
//                   >
//                     {labTest.name}
//                   </td>
//                   <td className="px-3 py-1.5 text-sm text-slate-700">{labTest.patient_name || labTest.patient}</td>
//                   <td className="px-3 py-1.5 text-sm text-slate-700">{labTest.lab_test_name || labTest.template || '-'}</td>
//                   <td className="px-3 py-1.5 text-sm text-slate-700">{labTest.practitioner_name || labTest.practitioner || '-'}</td>
//                   <td className="px-3 py-1.5"><StatusPill status={statusDisplayLabel(labTest.status || 'Draft')} color={statusColors[labTest.status || 'Draft'] || 'default'} /></td>
//                   <td className="px-3 py-1.5">
//                     {labTest.is_outsourced
//                       ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Outsourced</span>
//                       : <span className="text-slate-400 text-xs">—</span>}
//                   </td>
//                   <td className="px-3 py-1.5 text-sm text-slate-700">
//                     {labTest.result_date ? new Date(labTest.result_date).toLocaleDateString('en-GB') : labTest.submitted_date ? new Date(labTest.submitted_date).toLocaleDateString('en-GB') : '-'}
//                   </td>
//                   <td className="px-3 py-1.5 text-sm text-slate-700 text-right">
//                     {typeof labTest.grand_total === 'number' ? labTest.grand_total.toFixed(3) : typeof labTest.amount === 'number' ? labTest.amount.toFixed(3) : '-'}
//                   </td>
//                   {renderActionsCell(labTest)}
//                   {renderRangeCells(labTest)}
//                   {renderResultCell(labTest)}
//                   {renderTechnicianCell(labTest)}
//                   <td className="px-3 py-1.5 text-sm text-slate-700">
//                     {labTest.docstatus === 0 && !labTest.material_request
//                       ? <button type="button" onClick={() => openRequestDialog(labTest)} className="px-2 py-1 text-xs rounded-md border border-primary text-primary hover:bg-primary/5">Request Consumables</button>
//                       : labTest.material_request ? <span className="text-xs text-slate-500">MR: {labTest.material_request}</span>
//                       : <span className="text-xs text-slate-400">-</span>}
//                   </td>
//                 </tr>
//               ))}

//             </tbody>
//           </table>
//         </div>
//       )}

//       {/* ── Lab Test Details slide-over ── */}
//       {selectedLabTestForDetails && (
//         <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={() => setSelectedLabTestForDetails(null)}>
//           <div className="absolute inset-0 bg-black/30" />
//           <div className="relative z-10 h-full w-full max-w-2xl bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
//             <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
//               <div>
//                 <p className="text-xs text-slate-500 uppercase tracking-wide">Lab Test Details</p>
//                 <p className="text-sm font-semibold text-slate-800">{selectedLabTestForDetails}</p>
//               </div>
//               <div className="flex items-center gap-2">
//                 <PrintFormatDropdown doctype="Lab Test" docName={selectedLabTestForDetails} noLetterhead={0} triggerPrint={1}
//                   className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-primary hover:bg-slate-50" />
//                 <button type="button" onClick={() => setSelectedLabTestForDetails(null)}
//                   className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200" aria-label="Close">
//                   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
//                   </svg>
//                 </button>
//               </div>
//             </div>
//             <div className="flex-1 overflow-y-auto p-6">
//               <LabTestDetails labTestName={selectedLabTestForDetails} onUpdate={() => refetch()} />
//             </div>
//           </div>
//         </div>
//       )}

//       {/* ── Sample Collection Modal with instructions visible by default ── */}
//       {sampleModalLabTest && !isCreatingSample && (
//         <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
//           <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
//             <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
//               <div>
//                 <h2 className="text-base font-semibold text-slate-900">Sample Collection — {sampleModalLabTest.name}</h2>
//                 <p className="text-xs text-slate-500 mt-0.5">Patient: {sampleModalLabTest.patient_name || sampleModalLabTest.patient || '-'}{sampleModalLabTest.lab_test_name ? ` · ${sampleModalLabTest.lab_test_name}` : ''}</p>
//               </div>
//               <button type="button" onClick={() => { setSampleModalLabTest(null); setSampleModalError(null); setTemplateSampleDetails('') }}
//                 className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
//             </div>
//             <div className="flex-1 overflow-y-auto p-5 space-y-4">
//               {sampleModalLoading && <div className="text-sm text-slate-600">Loading sample instances…</div>}
//               {sampleModalError && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-md px-3 py-2">{sampleModalError}</div>}
//               {!sampleModalLoading && !sampleModalError && (
//                 <>
//                   {(!sampleModalLabTest.sample_instances || sampleModalLabTest.sample_instances.length === 0) ? (
//                     <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-4">
//                       No sample instances are defined for this lab test. Please configure Sample Requirements on the Lab Test Template.
//                     </div>
//                   ) : (
//                     <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
//                       <thead className="bg-slate-50 border-b border-slate-200">
//                         <tr>
//                           <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Sample</th>
//                           <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-16">Qty</th>
//                           <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Collection Instructions</th>
//                           <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-44">Sample Collection</th>
//                         </tr>
//                       </thead>
//                       <tbody className="divide-y divide-slate-100">
//                         {sampleModalLabTest.sample_instances!.map((row, idx) => {
//                           // Default expand instructions for first row or if none expanded
//                           const isInstructionsExpanded = expandedSampleDetailIdx === idx || (expandedSampleDetailIdx === null && row.sample_details)
//                           return (
//                             <tr key={idx} className="hover:bg-slate-50/60">
//                               <td className="px-3 py-2.5 text-slate-800 font-medium">{row.sample || '-'}</td>
//                               <td className="px-3 py-2.5 text-slate-700">{row.sample_qty ?? '-'}</td>
//                               <td className="px-3 py-2.5 text-slate-600">
//                                 {row.sample_details ? (
//                                   <div>
//                                     <button type="button" className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 text-sm font-semibold"
//                                       onClick={() => setExpandedSampleDetailIdx(isInstructionsExpanded ? null : idx)}>
//                                       <span>📋 View Instructions</span>
//                                       <span className="text-slate-400">{isInstructionsExpanded ? '▲' : '▼'}</span>
//                                     </button>
//                                     {isInstructionsExpanded && (
//                                       <div className="mt-3 p-3 bg-blue-50 border border-blue-300 rounded text-sm text-slate-800 max-h-96 overflow-y-auto">
//                                         {row.sample_details.includes('<')
//                                           ? <div className="prose prose-base max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-slate-900 [&_em]:italic [&_p]:mb-2.5" dangerouslySetInnerHTML={{ __html: row.sample_details }} />
//                                           : <div className="whitespace-pre-wrap leading-relaxed text-base">{row.sample_details}</div>}
//                                       </div>
//                                     )}
//                                   </div>
//                                 ) : <span className="text-slate-400 italic">No instructions</span>}
//                               </td>
//                               <td className="px-3 py-2.5">
//                                 {row.sample_collection ? (
//                                   <button type="button" onClick={() => window.open(`/app/sample-collection/${encodeURIComponent(row.sample_collection!)}`, '_blank')}
//                                     className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">✓ Open Record</button>
//                                 ) : (
//                                   <button type="button" onClick={async () => {
//                                     setSampleFormError(null)
//                                     setSampleObsRows([{ sample: row.sample, sample_qty: row.sample_qty, collection_date_time: new Date().toISOString().slice(0, 16).replace('T', ' ') }])
//                                     if (sampleModalLabTest.template) {
//                                       fetchLabTestTemplateDetails(sampleModalLabTest.template).then((d) => setTemplateSampleDetails(d.sample_details || '')).catch(() => setTemplateSampleDetails(''))
//                                     }
//                                     // Close the parent modal and open the create form
//                                     setIsCreatingSample(true)
//                                     setSampleFormRowIndex(idx)
//                                   }} className="inline-flex items-center px-2.5 py-1 rounded bg-primary text-white text-xs hover:bg-primary/90">+ Create</button>
//                                 )}
//                               </td>
//                             </tr>
//                           )
//                         })}
//                       </tbody>
//                     </table>
//                   )}
//                 </>
//               )}
//             </div>
//             <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
//               <button type="button" onClick={() => { setSampleModalLabTest(null); setSampleModalError(null); setTemplateSampleDetails('') }}
//                 className="px-3 py-1.5 text-xs rounded-md border border-slate-300 text-slate-700 hover:bg-white">Close</button>
//             </div>
//           </div>
//         </div>
//       )}

//       {/* ── Create Sample Collection Form Modal (separate, closes parent) ── */}
//       {sampleFormRowIndex !== null && sampleModalLabTest && isCreatingSample && (
//         <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
//           <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
//             <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
//               <div>
//                 <h3 className="text-base font-semibold text-slate-900">Create Sample Collection</h3>
//                 <p className="text-xs text-slate-500 mt-0.5">Sample: <strong>{sampleModalLabTest.sample_instances?.[sampleFormRowIndex!]?.sample || '—'}</strong></p>
//               </div>
//               <button type="button" disabled={sampleFormLoading}
//                 onClick={() => { if (!sampleFormLoading) { setSampleFormRowIndex(null); setSampleFormError(null); setSampleFormCollectionPoint(''); setSampleFormRefPractitioner(''); setRefPractitionerQuery(''); setRefPractitionerOptions([]); setRefPractitionerOpen(false); setSampleObsRows([]); setTemplateSampleDetails(''); setIsCreatingSample(false) } }}
//                 className="text-slate-400 hover:text-slate-600 disabled:opacity-40 text-lg">✕</button>
//             </div>
//             <div className="p-5 space-y-4 overflow-y-auto flex-1">
//               {sampleFormError && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-md px-3 py-2">{sampleFormError}</div>}
//               {templateSampleDetails && (
//                 <div className="rounded-md border border-blue-200 bg-blue-50 px-5 py-4">
//                   <p className="text-sm font-bold text-blue-800 mb-3">📋 Collection Instructions (from template)</p>
//                   <div className="prose prose-base max-w-none text-base text-blue-900 leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-2.5 [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-blue-950 [&_em]:italic [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: templateSampleDetails }} />
//                 </div>
//               )}
//               {(() => {
//                 const row = sampleModalLabTest.sample_instances?.[sampleFormRowIndex!]
//                 if (!row) return null
//                 return (
//                   <>
//                     <div className="grid grid-cols-2 gap-3 text-xs bg-slate-100 border border-slate-300 rounded-lg p-2">
//                       <div><div className="text-[9px] font-medium text-slate-500 mb-0.5">Sample</div><div className="text-slate-900 font-semibold text-sm truncate">{row.sample || '-'}</div></div>
//                       <div><div className="text-[9px] font-medium text-slate-500 mb-0.5">Qty / Patient</div><div className="text-slate-900 font-semibold text-sm truncate">{row.sample_qty ?? '-'} · {sampleModalLabTest.patient_name || sampleModalLabTest.patient || '-'}</div></div>
//                     </div>
//                     <div>
//                       <label className="block text-sm font-bold text-slate-800 mb-2">Collection Details & Observations</label>
//                       {row.sample_details && row.sample_details.includes('<')
//                         ? <div className="w-full rounded-md border border-slate-300 px-3 py-1.5 bg-slate-50 min-h-[200px] overflow-y-auto"><div className="prose prose-base max-w-none text-base text-slate-800 leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-2.5 [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-slate-900 [&_em]:italic [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: row.sample_details }} /></div>
//                         : row.sample_details
//                         ? <div className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-base bg-slate-50 min-h-[200px] whitespace-pre-wrap leading-relaxed text-slate-800 font-medium">{row.sample_details}</div>
//                         : <div className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-base bg-slate-50 min-h-[120px] text-slate-400 flex items-center justify-center">Collection details will appear here...</div>}
//                     </div>
//                     <div className="grid grid-cols-2 gap-4">
//                       <div className="relative">
//                         <label className="block text-xs font-semibold text-slate-700 mb-1">Referring Practitioner</label>
//                         <input type="text" value={sampleFormRefPractitioner || refPractitionerQuery}
//                           onChange={(e) => { setSampleFormRefPractitioner(''); setRefPractitionerQuery(e.target.value); setRefPractitionerOpen(true) }}
//                           onFocus={() => setRefPractitionerOpen(true)} placeholder="Search practitioner..."
//                           className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
//                         {refPractitionerOpen && (refPractitionerQuery || refPractitionerOptions.length > 0) && (
//                           <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-md bg-white border border-slate-200 shadow-lg">
//                             {refPractitionerOptions.length === 0
//                               ? <div className="px-3 py-2 text-[11px] text-slate-500">Type to search…</div>
//                               : refPractitionerOptions.map((opt) => (
//                                 <button key={opt.name} type="button" onClick={() => { setSampleFormRefPractitioner(opt.name); setRefPractitionerQuery(opt.label || opt.name); setRefPractitionerOpen(false) }}
//                                   className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-slate-100">{opt.label || opt.name}</button>
//                               ))}
//                           </div>
//                         )}
//                       </div>
//                     </div>
//                     <div>
//                       <div className="flex items-center justify-between mb-2">
//                         <label className="block text-xs font-semibold text-slate-700">Observation Sample Collection</label>
//                         <button type="button" onClick={() => setSampleObsRows((prev) => [...prev, { sample: row.sample, sample_qty: row.sample_qty, collection_date_time: new Date().toISOString().slice(0, 16).replace('T', ' ') }])}
//                           className="text-xs text-primary font-medium hover:underline">+ Add Row</button>
//                       </div>
//                       {sampleObsRows.length === 0
//                         ? <div className="text-xs text-slate-400 italic border border-dashed border-slate-200 rounded p-3 text-center">No observation rows. Click "+ Add Row" to add.</div>
//                         : (
//                           <div className="overflow-x-auto rounded-lg border border-slate-200">
//                             <table className="w-full text-xs">
//                               <thead className="bg-slate-50 border-b border-slate-200">
//                                 <tr>
//                                   <th className="px-2 py-2 text-left font-medium text-slate-500">Sample</th>
//                                   <th className="px-2 py-2 text-left font-medium text-slate-500">Qty</th>
//                                   <th className="px-2 py-2 text-left font-medium text-slate-500">Date Time</th>
//                                   <th className="px-2 py-2 text-left font-medium text-slate-500">Status</th>
//                                   <th className="px-2 py-2 w-8"></th>
//                                 </tr>
//                               </thead>
//                               <tbody className="divide-y divide-slate-100">
//                                 {sampleObsRows.map((obsRow, obsIdx) => (
//                                   <tr key={obsIdx}>
//                                     <td className="px-2 py-1.5"><input value={obsRow.sample || ''} onChange={(e) => setSampleObsRows((prev) => { const n=[...prev]; n[obsIdx]={...n[obsIdx],sample:e.target.value}; return n })} className="w-full border border-slate-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary focus:outline-none" placeholder="Sample" /></td>
//                                     <td className="px-2 py-1.5"><input type="number" step="any" value={obsRow.sample_qty ?? ''} onChange={(e) => setSampleObsRows((prev) => { const n=[...prev]; n[obsIdx]={...n[obsIdx],sample_qty:parseFloat(e.target.value)||0}; return n })} className="w-16 border border-slate-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary focus:outline-none" /></td>
//                                     <td className="px-2 py-1.5"><input type="datetime-local" value={(obsRow.collection_date_time || '').replace(' ','T').slice(0,16)} onChange={(e) => setSampleObsRows((prev) => { const n=[...prev]; n[obsIdx]={...n[obsIdx],collection_date_time:e.target.value.replace('T',' ')+':00'}; return n })} className="border border-slate-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary focus:outline-none" /></td>
//                                     <td className="px-2 py-1.5"><select value={obsRow.status || 'Open'} onChange={(e) => setSampleObsRows((prev) => { const n=[...prev]; n[obsIdx]={...n[obsIdx],status:e.target.value}; return n })} className="border border-slate-300 rounded px-1.5 py-1 bg-white focus:ring-1 focus:ring-primary focus:outline-none"><option value="Open">Open</option><option value="Collected">Collected</option></select></td>
//                                     <td className="px-2 py-1.5 text-right"><button type="button" onClick={() => setSampleObsRows((prev) => prev.filter((_,i)=>i!==obsIdx))} className="text-red-400 hover:text-red-600">✕</button></td>
//                                   </tr>
//                                 ))}
//                               </tbody>
//                             </table>
//                           </div>
//                         )}
//                     </div>
//                   </>
//                 )
//               })()}
//             </div>
//             <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
//               <button type="button" disabled={sampleFormLoading}
//                   onClick={() => { if (!sampleFormLoading) { setSampleFormRowIndex(null); setSampleFormError(null); setSampleFormCollectionPoint(''); setSampleFormRefPractitioner(''); setRefPractitionerQuery(''); setRefPractitionerOptions([]); setRefPractitionerOpen(false); setSampleObsRows([]); setTemplateSampleDetails(''); setIsCreatingSample(false) } }}
//                 className="px-4 py-2 text-xs rounded-md border border-slate-300 text-slate-700 hover:bg-white disabled:opacity-50">Cancel</button>
//               <button type="button" disabled={sampleFormLoading || sampleFormRowIndex === null}
//                 className="px-4 py-2 text-xs rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 font-medium"
//                 onClick={async () => {
//                   if (!sampleModalLabTest || sampleFormRowIndex === null) return
//                   const row = sampleModalLabTest.sample_instances?.[sampleFormRowIndex]
//                   if (!row) { setSampleFormError('Missing sample row data'); return }
//                   try {
//                     setSampleFormLoading(true); setSampleFormError(null)
//                     const res = await createSampleCollectionForLabSample(sampleModalLabTest.name, sampleFormRowIndex, row.sample_details || '', sampleFormCollectionPoint || undefined, sampleFormRefPractitioner || undefined, sampleObsRows.length ? sampleObsRows : undefined)
//                     toast.success(`Sample Collection ${res.sample_collection} created`)
//                     refetch()
//                     setSampleModalLabTest((prev) => {
//                       if (!prev) return prev
//                       const next = { ...prev }; const arr = [...(next.sample_instances || [])]
//                       arr[sampleFormRowIndex] = { ...(arr[sampleFormRowIndex] || {}), sample_collection: res.sample_collection }
//                       next.sample_instances = arr; return next
//                     })
//                     setSampleFormRowIndex(null); setSampleObsRows([]); setTemplateSampleDetails(''); setIsCreatingSample(false)
//                   } catch (e) { setSampleFormError(e instanceof Error ? e.message : 'Failed to create Sample Collection') }
//                   finally { setSampleFormLoading(false) }
//                 }}>
//                 {sampleFormLoading ? 'Creating…' : 'Create Sample Collection'}
//               </button>
//             </div>
//           </div>
//         </div>
//       )}

//       {/* ── Remarks modal ── */}
//       {remarksModalOpen && remarksLabTestName && (
//         <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
//           <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
//             <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
//               <h2 className="text-lg font-semibold text-slate-900">Doctor's Remarks — {remarksLabTestName}</h2>
//               <button type="button" onClick={closeRemarksModal} disabled={remarksLoading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50"><X className="w-5 h-5" /></button>
//             </div>
//             <div className="p-4 overflow-y-auto flex-1 space-y-4">
//               {remarksError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{remarksError}</div>}
//               <p className="text-sm text-slate-500">Add one or more remarks.</p>
//               {remarksList.map((row, idx) => (
//                 <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
//                   <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white">
//                     <span className="text-xs font-medium text-slate-500">Remark #{idx + 1}</span>
//                     <button type="button" onClick={() => removeRemarksRow(idx)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50" disabled={remarksList.length <= 1}><X className="w-4 h-4" /></button>
//                   </div>
//                   <div className="p-3">
//                     <textarea value={row.rrmark} onChange={(e) => updateRemarksRow(idx, e.target.value)} placeholder="Enter remark..." rows={3}
//                       className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" disabled={remarksLoading} />
//                   </div>
//                 </div>
//               ))}
//               <button type="button" onClick={addRemarksRow} className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"><span>+</span> Add another remark</button>
//             </div>
//             <div className="p-4 border-t border-slate-200 flex justify-end gap-2 flex-shrink-0 bg-white">
//               <button type="button" onClick={closeRemarksModal} disabled={remarksLoading} className="px-3 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50 text-slate-700">Cancel</button>
//               <button type="button" onClick={handleSubmitRemarks} disabled={remarksLoading} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50">{remarksLoading ? 'Saving…' : 'Save remarks'}</button>
//             </div>
//           </div>
//         </div>
//       )}

//       {/* ── Consumables dialog ── */}
//       {requestingFor && (
//         <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
//           <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
//             <div className="p-4 border-b border-slate-200 flex items-center justify-between">
//               <h2 className="text-lg font-semibold text-slate-900">Request Consumables for {requestingFor}</h2>
//               <button type="button" onClick={closeRequestDialog} className="text-slate-400 hover:text-slate-600">✕</button>
//             </div>
//             <div className="p-4 space-y-3">
//               {dialogError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{dialogError}</div>}
//               <div className="overflow-x-auto">
//                 <table className="min-w-full text-sm border border-slate-200 rounded-md">
//                   <thead className="bg-slate-50">
//                     <tr>
//                       <th className="px-3 py-2 text-left font-semibold text-slate-700">Item Code</th>
//                       <th className="px-3 py-2 text-left font-semibold text-slate-700">Item Name</th>
//                       <th className="px-3 py-2 text-left font-semibold text-slate-700">Qty</th>
//                       <th className="px-3 py-2 text-left font-semibold text-slate-700">Warehouse</th>
//                       <th className="px-3 py-2" />
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {dialogItems.map((row, index) => (
//                       <tr key={index} className="border-t border-slate-200">
//                         <td className="px-3 py-2">
//                           <div className="relative">
//                             <input type="text" value={row.item_code} onChange={(e) => { updateItem(index, 'item_code', e.target.value); setOpenItemIndex(index) }} onFocus={() => setOpenItemIndex(index)}
//                               className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Select item..." />
//                             {openItemIndex === index && itemOptions.length > 0 && (
//                               <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
//                                 {itemOptions.filter((opt) => (opt.label || opt.name).toLowerCase().includes((row.item_code || '').toLowerCase())).slice(0, 20).map((opt) => (
//                                   <button key={opt.name} type="button" className="w-full text-left px-3 py-1 text-xs hover:bg-slate-100"
//                                     onClick={() => { updateItem(index, 'item_code', opt.name); updateItem(index, 'item_name', opt.label || opt.name); setOpenItemIndex(null) }}>{opt.label || opt.name}</button>
//                                 ))}
//                               </div>
//                             )}
//                           </div>
//                         </td>
//                         <td className="px-3 py-2"><input type="text" value={row.item_name || ''} onChange={(e) => updateItem(index, 'item_name', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Item name" /></td>
//                         <td className="px-3 py-2"><input type="number" min={0} step={0.01} value={row.qty} onChange={(e) => updateItem(index, 'qty', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" /></td>
//                         <td className="px-3 py-2">
//                           <div className="relative">
//                             <input type="text" value={row.warehouse || ''} onChange={(e) => { updateItem(index, 'warehouse', e.target.value); setOpenWarehouseIndex(index) }} onFocus={() => setOpenWarehouseIndex(index)}
//                               className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Select warehouse..." />
//                             {openWarehouseIndex === index && warehouseOptions.length > 0 && (
//                               <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
//                                 {warehouseOptions.filter((opt) => (opt.label || opt.name).toLowerCase().includes((row.warehouse || '').toLowerCase())).slice(0, 20).map((opt) => (
//                                   <button key={opt.name} type="button" className="w-full text-left px-3 py-1 text-xs hover:bg-slate-100"
//                                     onClick={() => { updateItem(index, 'warehouse', opt.name); setOpenWarehouseIndex(null) }}>{opt.label || opt.name}</button>
//                                 ))}
//                               </div>
//                             )}
//                           </div>
//                         </td>
//                         <td className="px-3 py-2 text-right"><button type="button" onClick={() => removeRow(index)} className="text-xs text-red-600 hover:text-red-800">Remove</button></td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//               <div className="flex justify-between items-center pt-2">
//                 <button type="button" onClick={addRow} className="px-3 py-1 text-xs border border-slate-300 rounded-md hover:bg-slate-50">+ Add Row</button>
//                 <div className="flex gap-2">
//                   <button type="button" onClick={closeRequestDialog} disabled={dialogLoading} className="px-3 py-1 text-xs border border-slate-300 rounded-md hover:bg-slate-50">Cancel</button>
//                   <button type="button" onClick={submitRequest} disabled={dialogLoading} className="px-3 py-1 text-xs bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50">{dialogLoading ? 'Submitting...' : 'Create Material Request'}</button>
//                 </div>
//               </div>
//             </div>
//           </div>
//         </div>
//       )}

//       {/* ── Results dialog ── */}
//       {resultDialogOpen && (
//         <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
//           <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
//             <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
//               <h2 className="text-lg font-semibold text-slate-900">Enter Results {activeLabTest?.name ? `for ${activeLabTest.name}` : ''}</h2>
//               <button type="button" onClick={closeResultDialog} className="text-slate-400 hover:text-slate-600">✕</button>
//             </div>
//             <div className="flex border-b border-slate-200 px-4 flex-shrink-0">
//               {(['results', 'documents'] as const).map((tab) => (
//                 <button key={tab} type="button" onClick={() => setResultDialogTab(tab)}
//                   className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${resultDialogTab === tab ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
//                   {tab === 'documents' ? `Documents${resultDocuments.length > 0 ? ` (${resultDocuments.length})` : ''}` : 'Results'}
//                 </button>
//               ))}
//             </div>
//             <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-4">
//               {resultDialogError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{resultDialogError}</div>}
//               {resultDialogLoading ? <div className="text-sm text-slate-600">Loading...</div>
//               : resultDialogTab === 'results' ? (
//                 <>
//                   <div className="relative rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3" data-no-row-click onClick={(e) => e.stopPropagation()}>
//                     <label className="block text-sm font-semibold text-slate-800 mb-0.5">
//                       Lab technician <span className="text-red-600" title="Required">*</span>
//                     </label>
//                     <p className="text-xs text-slate-500 mb-2">Only practitioners whose Medical Role is Lab Technologist or Lab Technician.</p>
//                     <div className="relative max-w-md">
//                       <input
//                         type="text"
//                         value={labTechnician ? (labTechnicianQuery || labTechnician) : labTechnicianQuery}
//                         onChange={(e) => {
//                           setLabTechnician('')
//                           setLabTechnicianQuery(e.target.value)
//                           setLabTechnicianOpen(true)
//                         }}
//                         onFocus={() => setLabTechnicianOpen(true)}
//                         placeholder="Search by name…"
//                         className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
//                       />
//                       {labTechnicianOpen && (
//                         <div className="absolute z-30 mt-1 w-full max-h-52 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
//                           {labTechnicianOptions.length === 0 ? (
//                             <div className="px-3 py-2 text-xs text-slate-500">No matches. Try another search or create practitioners with the correct Medical Role.</div>
//                           ) : (
//                             labTechnicianOptions.map((opt) => (
//                               <button
//                                 key={opt.name}
//                                 type="button"
//                                 className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 border-b border-slate-50 last:border-0"
//                                 onClick={() => {
//                                   setLabTechnician(opt.name)
//                                   setLabTechnicianQuery(opt.label || opt.name)
//                                   setLabTechnicianOpen(false)
//                                 }}
//                               >
//                                 <span className="font-medium text-slate-800">{opt.label || opt.name}</span>
//                                 {opt.medical_role && (
//                                   <span className="block text-[11px] text-slate-500 mt-0.5">Role: {opt.medical_role}</span>
//                                 )}
//                               </button>
//                             ))
//                           )}
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                   {normalTestItems.length > 0 && (
//                     <div>
//                       <label className="block text-sm font-semibold text-slate-800 mb-2">Test Results</label>
//                       <div className="rounded-lg border border-slate-200 overflow-hidden">
//                         <table className="w-full text-sm">
//                           <thead className="bg-slate-50 border-b border-slate-200">
//                             <tr>
//                               <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Test / Event</th>
//                               <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 w-24">Min</th>
//                               <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 w-24">Max</th>
//                               <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 w-36">Result</th>
//                               <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Comment</th>
//                             </tr>
//                           </thead>
//                           <tbody className="divide-y divide-slate-100">
//                             {normalTestItems.map((row, idx) => {
//                               const result = parseFloat(row.result_value || '')
//                               const min = templateDetails.min_range; const max = templateDetails.max_range
//                               const outOfRange = row.result_value !== '' && row.result_value != null && !isNaN(result) && min != null && max != null ? (result < min || result > max) : false
//                               return (
//                                 <tr key={idx} className={outOfRange ? 'bg-red-50' : 'hover:bg-slate-50/50'}>
//                                   <td className="px-3 py-3">
//                                     <div className="text-sm font-medium text-slate-800">{row.lab_test_event || row.lab_test_name || '—'}</div>
//                                     {row.lab_test_uom && <div className="text-[11px] text-slate-400 mt-0.5">{row.lab_test_uom}</div>}
//                                   </td>
//                                   <td className="px-3 py-3 text-center"><span className={`text-sm font-medium ${min != null ? 'text-slate-700' : 'text-slate-300'}`}>{min != null ? min : '—'}</span></td>
//                                   <td className="px-3 py-3 text-center"><span className={`text-sm font-medium ${max != null ? 'text-slate-700' : 'text-slate-300'}`}>{max != null ? max : '—'}</span></td>
//                                   <td className="px-3 py-3">
//                                     <input type="number" step="any" value={row.result_value ?? ''}
//                                       onChange={(e) => { const v = e.target.value; setNormalTestItems((prev) => { const next = [...prev]; next[idx] = { ...next[idx], result_value: v }; return next }) }}
//                                       className={`w-full border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${outOfRange ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300' : 'border-slate-300'}`}
//                                       placeholder="0.00" />
//                                     {outOfRange && <div className="text-[10px] text-red-600 mt-0.5 font-medium">⚠ Out of range</div>}
//                                   </td>
//                                   <td className="px-3 py-3">
//                                     <input type="text" value={row.lab_test_comment || ''}
//                                       onChange={(e) => { const v = e.target.value; setNormalTestItems((prev) => { const next = [...prev]; next[idx] = { ...next[idx], lab_test_comment: v }; return next }) }}
//                                       className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Add comment..." />
//                                   </td>
//                                 </tr>
//                               )
//                             })}
//                           </tbody>
//                         </table>
//                       </div>
//                     </div>
//                   )}
//                   <div>
//                     <label className="block text-sm font-medium text-slate-700 mb-1">Result</label>
//                     <textarea className="w-full border border-slate-300 rounded-md p-2 text-sm min-h-[80px]" value={customResult} onChange={(e) => setCustomResult(e.target.value)} placeholder="Enter descriptive or custom result..." />
//                   </div>
//                   <div>
//                     <label className="block text-sm font-medium text-slate-700 mb-1">General Comments</label>
//                     <textarea className="w-full border border-slate-300 rounded-md p-2 text-sm min-h-[70px]" value={labComment} onChange={(e) => setLabComment(e.target.value)} placeholder="Overall test comments..." />
//                   </div>
//                   {(worksheetText || templateDetails.worksheet_instructions) && (
//                     <div className="rounded-md border border-amber-200 bg-amber-50">
//                       <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors" onClick={() => setWorksheetExpanded((v) => !v)}>
//                         <span>📋 Worksheet Instructions</span>
//                         <span className="text-xs text-amber-600">{worksheetExpanded ? '▲ Hide' : '▼ Show'}</span>
//                       </button>
//                       {worksheetExpanded && (
//                         <div className="px-3 pb-3">
//                           <textarea className="w-full border border-amber-300 rounded-md p-2 text-sm bg-white min-h-[80px]" value={worksheetText} onChange={(e) => setWorksheetText(e.target.value)} placeholder="Worksheet instructions..." />
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </>
//               ) : (
//                 <div className="space-y-4">
//                   <p className="text-sm text-slate-500">Attach lab documents (reports, scans).</p>
//                   {resultDocuments.length === 0 && <div className="text-center py-6 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-sm">No documents. Click below to add one.</div>}
//                   {resultDocuments.map((row, idx) => (
//                     <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
//                       <div><label className="block text-xs font-medium text-slate-600 mb-0.5">File Name</label><input value={row.file_name || ''} onChange={(e) => updateResultDocumentRow(idx, 'file_name', e.target.value)} placeholder="File name" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" /></div>
//                       <div><label className="block text-xs font-medium text-slate-600 mb-0.5">Document Type</label><select value={row.document_type || ''} onChange={(e) => updateResultDocumentRow(idx, 'document_type', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm bg-white"><option value="">Select type</option>{resultDocumentTypes.map((dt) => <option key={dt.name} value={dt.name}>{dt.document_name || dt.name}</option>)}</select></div>
//                       <div><label className="block text-xs font-medium text-slate-600 mb-0.5">Transaction No</label><input value={row.transaction_no || ''} onChange={(e) => updateResultDocumentRow(idx, 'transaction_no', e.target.value)} placeholder="Optional" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" /></div>
//                       <div><label className="block text-xs font-medium text-slate-600 mb-0.5">Upload Remarks</label><input value={row.upload_remarks || ''} onChange={(e) => updateResultDocumentRow(idx, 'upload_remarks', e.target.value)} placeholder="Optional" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" /></div>
//                       <div className="sm:col-span-2">
//                         <label className="block text-xs font-medium text-slate-600 mb-0.5">File</label>
//                         <input type="file" disabled={resultDocumentUploading === idx} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResultDocumentFile(idx, f); e.target.value = '' }} className="w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-white file:text-sm" />
//                         {resultDocumentUploading === idx && <span className="text-xs text-slate-500">Uploading...</span>}
//                         {row.document && resultDocumentUploading !== idx && <span className="text-xs text-green-600 block">✓ File attached</span>}
//                       </div>
//                     </div>
//                   ))}
//                   <button type="button" onClick={addResultDocumentRow} className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"><span>+</span> Add document</button>
//                 </div>
//               )}
//             </div>
//             <div className="flex justify-end gap-2 p-4 border-t border-slate-200 flex-shrink-0 bg-white">
//               <button type="button" onClick={closeResultDialog} disabled={resultDialogLoading} className="px-3 py-1 text-sm border border-slate-300 rounded-md hover:bg-slate-50">Cancel</button>
//               <button type="button" onClick={handleSubmitLabTestWithResults} disabled={resultDialogLoading} className="px-3 py-1 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50">Save Results</button>
//             </div>
//           </div>
//         </div>
//       )}

//       {/* ── Edit Lab Test modal ── */}
//       {editLabTestName && (
//         <EditLabTestModal labTestName={editLabTestName} onClose={() => setEditLabTestName(null)}
//           onSuccess={() => { setEditLabTestName(null); refetch() }} />
//       )}
//     </div>
//   )
// }


import { useState, useEffect, useRef, useMemo, useCallback, Fragment, type MutableRefObject, type ReactNode } from 'react'
import { useLabTests } from '../../hooks/useLabTests'
import { useCareContext } from '../../providers/CareContextProvider'
import { getPortalBranch } from '../../services/costCenterPermission'
import { StatusPill } from '../ui/StatusPill'
import {
  getLabTestConsumables,
  requestLabConsumables,
  fetchLabTest,
  fetchLabResultAssessmentHtml,
  saveAndSubmitLabTest,
  finishGroupLabTests,
  updateLabTestRemarks,
  canEditLabTestSampleCollection,
  canRecordAdHocSampleCollection,
  isLabTestSampleCollectionDone,
  fetchLabTestTemplateDetails,
  type LabConsumableRow,
  type LabTest,
  type NormalTestResultRow,
  type LabTestTemplateDetails,
} from '../../services/labTests'
import { cancelLabSampleHandling, deleteRequestedLabTest } from '../../services/labRequestActions'
import { showLabTestRuleFeedback } from '../../utils/labTestRuleFeedback'
import { ConfirmActionModal } from '../ui/ConfirmActionModal'
import {
  fetchItems,
  fetchWarehouses,
  fetchDocumentTypes,
  fetchHealthcarePractitioners,
  fetchLabTechnicianPractitioners,
  fetchLabTestTemplateList,
  fetchLabTestTemplates,
  getCurrentUserLabTechnicianOption,
  getCurrentUserPractitioner,
  type LabTestTemplateListRow,
  type LinkFieldOption,
} from '../../services/common'
import { uploadPatientFile, type PatientDocumentRow } from '../../services/patients'
import { LabTestDetails } from './LabTestDetails'
import { EditLabTestModal } from './EditLabTestModal'
import { LabTestReviewModal } from './LabTestReviewModal'
import { LabTestSampleCollectionModal } from './LabTestSampleCollectionModal'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { PaginationControls, LoadMoreControls, DEFAULT_PAGE_SIZE, type PageSize } from '../ui/PaginationControls'
import { toast } from '../../hooks/useToast'
import {
  canEditLabTestResults,
  canEditLabTestResultForRow,
  isGroupedLabRequestFinished,
  labResultLockReason,
} from '../../config/permissions'
import { Search, X, ChevronDown, ChevronRight, ArrowDown, ArrowUp, AlertTriangle, Trash2, Download } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCardFilters, useCardHeaderSlot, useCardLeadingSlot, useDashboardCompactClinical, usePreferCardLoadMore } from '../../contexts/CardFilterContext'
import { useBatchLabTestResults } from '../../hooks/useBatchLabTestResults'
import { LabTestDashboardCardTable, labTestReportDate } from './LabTestDashboardCardTable'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { DocumentTypeSelect } from '../ui/DocumentTypeSelect'
import { DateFilterInput } from '../ui/DateFilterInput'
import {
  IsMedicalSelect,
  isMedicalChoiceRequired,
  isMedicalPayload,
  type IsMedicalChoice,
} from '../ui/IsMedicalSelect'
import {
  expandLegacyLabTestsForDisplay,
  isLegacyHistoryLabRow,
  resolveLabTestDocName,
} from './labTestDisplayUtils'

export type LabTestListBatchSaveRef = {
  savePendingChanges: () => Promise<void>
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  'Draft', 'Requested', 'Awaiting sample collection', 'Sample Collection in Progress',
  'Sample Collected', 'Testing in Progress', 'Completed', 'Pending Review',
  'Reviewed', 'Rejected', 'Cancelled',
] as const

// Outsourced tests are sent out, so the internal request/sample-collection stages don't apply.
const OUTSOURCED_HIDDEN_STATUSES = new Set<string>([
  'Draft', 'Requested', 'Awaiting sample collection', 'Sample Collection in Progress', 'Sample Collected',
])
const OUTSOURCED_STATUS_OPTIONS = STATUS_OPTIONS.filter((s) => !OUTSOURCED_HIDDEN_STATUSES.has(s))

// Display label overrides for the Status dropdown (the value stays the stored status).
const STATUS_DISPLAY_LABELS: Record<string, string> = {
  'Testing in progress': 'Test In-Progress',
  'Testing in Progress': 'Test In-Progress',
}
const statusDisplayLabel = (status: string) => STATUS_DISPLAY_LABELS[status] || status

const statusColors: Record<string, string> = {
  'Reviewed': 'success', 'Rejected': 'danger', 'Completed': 'success',
  'Pending Review': 'warning', 'Submitted': 'info', 'Cancelled': 'default',
  'Draft': 'warning', 'Pending': 'warning', 'Requested': 'info',
  'Awaiting sample collection': 'warning', 'Sample Collection in Progress': 'info',
  'Sample Collected': 'info', 'Testing in Progress': 'info', 'Testing in progress': 'info',
}

const LAB_POST_SAMPLE_REVIEW_STATUSES = new Set([
  'Partial Result Enter',
  'Testing in Progress',
  'Testing in progress',
  'Completed',
  'Pending Review',
  'Reviewed',
  'Approved',
  'Rejected',
])

function canCancelSampleHandlingForLabTest(labTest: LabTest): boolean {
  const status = (labTest.status || '').trim()
  if ((labTest.docstatus ?? 0) >= 1) return false
  if (LAB_POST_SAMPLE_REVIEW_STATUSES.has(status)) return false
  if (!canEditLabTestSampleCollection(status)) return false
  return (
    status === 'Sample Collected' ||
    status === 'Sample Collection in Progress' ||
    status === 'Sample collection in progress'
  )
}

function canDeleteRequestedLabTest(labTest: LabTest): boolean {
  if (isLegacyHistoryLabRow(labTest)) return false
  if ((labTest.docstatus ?? 0) !== 0) return false
  return (labTest.status || '').trim() === 'Requested'
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const fetchCostCenterLetterHead = async (costCenter?: string): Promise<{ content: string; footer: string }> => {
  if (!costCenter) return { content: '', footer: '' }
  try {
    const ccRes = await fetch(
      `/api/method/frappe.client.get_value?doctype=Cost+Center&fieldname=custom_letter_head&filters=${encodeURIComponent(JSON.stringify({ name: costCenter }))}`,
      { credentials: 'include' }
    )
    const ccData = await ccRes.json().catch(() => ({}))
    const letterHeadName = ccData?.message?.custom_letter_head as string | undefined
    if (!letterHeadName) return { content: '', footer: '' }

    const lhRes = await fetch(
      `/api/method/frappe.client.get?doctype=Letter+Head&name=${encodeURIComponent(letterHeadName)}`,
      { credentials: 'include' }
    )
    const lhData = await lhRes.json().catch(() => ({}))
    const doc = lhData?.message || {}
    return {
      content: String(doc.content || ''),
      footer: String(doc.footer || ''),
    }
  } catch {
    return { content: '', footer: '' }
  }
}

interface Filters {
  status: string; fromDate: string; toDate: string
  isOutsourced: string; practitioner: string; practitionerLabel: string; template: string; templateLabel: string
}

const makeEmptyFilters = (): Filters => ({
  status: '', fromDate: '', toDate: '', isOutsourced: '', practitioner: '', practitionerLabel: '', template: '', templateLabel: '',
})

// ─── Helper: Calculate Result Flag ─────────────────────────────────────────

interface ResultFlagResult {
  flag: string
  color: string
  bgColor: string
  textColor: string
}

const calculateResultFlag = (
  resultValue: number | string | null | undefined,
  patientGender: string | null | undefined,
  femaleMin?: number | null,
  femaleMax?: number | null,
  maleMin?: number | null,
  maleMax?: number | null,
  genericMin?: number | null,
  genericMax?: number | null
): ResultFlagResult => {
  // Parse result value
  let val: number | null = null
  if (typeof resultValue === 'string') {
    val = parseFloat(resultValue)
  } else if (typeof resultValue === 'number') {
    val = resultValue
  }
  
  // Return empty if no valid result
  if (val === null || isNaN(val)) {
    return { flag: '', color: 'default', bgColor: 'bg-slate-100', textColor: 'text-slate-500' }
  }
  
  // Select appropriate ranges based on patient gender
  let min: number | null | undefined = null
  let max: number | null | undefined = null
  
  if (patientGender === 'Female') {
    min = femaleMin ?? genericMin
    max = femaleMax ?? genericMax
  } else if (patientGender === 'Male') {
    min = maleMin ?? genericMin
    max = maleMax ?? genericMax
  } else {
    min = genericMin
    max = genericMax
  }
  
  // If no ranges available, return empty
  if (min === null || min === undefined || max === null || max === undefined) {
    return { flag: '', color: 'default', bgColor: 'bg-slate-100', textColor: 'text-slate-500' }
  }
  
  // Check for critical values (2x normal range)
  if (val > max * 2) {
    return { flag: 'Critically High', color: 'danger', bgColor: 'bg-red-100', textColor: 'text-red-700' }
  }
  if (val < min * 0.5) {
    return { flag: 'Critically Low', color: 'warning', bgColor: 'bg-yellow-100', textColor: 'text-yellow-900' }
  }
  
  // Check normal range
  if (val > max) {
    return { flag: 'High', color: 'warning', bgColor: 'bg-orange-100', textColor: 'text-orange-700' }
  }
  if (val < min) {
    return { flag: 'Low', color: 'warning', bgColor: 'bg-yellow-100', textColor: 'text-yellow-800' }
  }
  
  return { flag: 'Normal', color: 'success', bgColor: 'bg-green-100', textColor: 'text-green-700' }
}

const getLabTestResultFlag = (labTest: LabTest, getDisplayResult: (lt: LabTest) => number | string | null | undefined) =>
  calculateResultFlag(
    getDisplayResult(labTest),
    labTest.gender || labTest.patient_sex,
    labTest.female_min_range,
    labTest.female_max_range,
    labTest.male_min_range,
    labTest.male_max_range,
    labTest.min_range,
    labTest.max_range,
  ).flag

/** True when a flag is a critical (panic) value that needs urgent attention. */
const isCriticalResultFlag = (flag: string): boolean =>
  flag === 'Critically High' || flag === 'Critically Low'

/** Table display label — keeps the critical distinction (LAB-07/LAB-08). */
const resultFlagLabel = (flag: string): string => {
  if (flag === 'Critically High') return 'Critical High'
  if (flag === 'Critically Low') return 'Critical Low'
  if (flag === 'High') return 'High'
  if (flag === 'Low') return 'Low'
  return ''
}

/** Parse a normal-range string ("4 - 11", "<200", ">5") into numeric bounds. */
const parseNormalRange = (raw?: string | null): { min: number | null; max: number | null } => {
  if (raw == null) return { min: null, max: null }
  const s = String(raw).replace(/[–—]/g, '-').trim()
  if (!s) return { min: null, max: null }
  const between = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)$/i)
  if (between) return { min: parseFloat(between[1]), max: parseFloat(between[2]) }
  const lt = s.match(/^[<≤]\s*=?\s*(-?\d+(?:\.\d+)?)$/)
  if (lt) return { min: null, max: parseFloat(lt[1]) }
  const gt = s.match(/^[>≥]\s*=?\s*(-?\d+(?:\.\d+)?)$/)
  if (gt) return { min: parseFloat(gt[1]), max: null }
  return { min: null, max: null }
}

/**
 * Effective (min,max) reference range for a result-entry row (LAB-07):
 * the row's own normal_range (compound panels) first, then gendered ranges
 * stored on the is_multiple row, then the template's gender-appropriate range,
 * then the template's generic range.
 */
const effectiveRowRange = (
  row: NormalTestResultRow,
  details: LabTestTemplateDetails,
  sex?: string,
): { min: number | null; max: number | null } => {
  const rowRange = parseNormalRange((row as { normal_range?: string | null }).normal_range)
  // Prefer explicit numeric min/max on is_multiple rows over a multi-line status legend in normal_range.
  const s = (sex || '').toLowerCase()
  const toNum = (v: unknown): number | null => {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isFinite(n) ? n : null
  }
  if (s === 'female') {
    const fMin = toNum(row.female_min_range)
    const fMax = toNum(row.female_max_range)
    if (fMin != null || fMax != null) return { min: fMin, max: fMax }
  }
  if (s === 'male') {
    const mMin = toNum(row.male_min_range)
    const mMax = toNum(row.male_max_range)
    if (mMin != null || mMax != null) return { min: mMin, max: mMax }
  }
  // Fall back: either gender's numeric range on the row
  {
    const mMin = toNum(row.male_min_range)
    const mMax = toNum(row.male_max_range)
    const fMin = toNum(row.female_min_range)
    const fMax = toNum(row.female_max_range)
    if (mMin != null || mMax != null) return { min: mMin, max: mMax }
    if (fMin != null || fMax != null) return { min: fMin, max: fMax }
  }
  if (rowRange.min != null || rowRange.max != null) return rowRange
  if (s === 'female' && (details.female_min_range != null || details.female_max_range != null))
    return { min: details.female_min_range ?? null, max: details.female_max_range ?? null }
  if (s === 'male' && (details.male_min_range != null || details.male_max_range != null))
    return { min: details.male_min_range ?? null, max: details.male_max_range ?? null }
  return { min: details.min_range ?? null, max: details.max_range ?? null }
}

/** Map "Deficiency  <10" → "Deficiency" (Lab Test.result_flag Select values). */
const normalizeMultipleStatusMark = (statusText: string): string => {
  const raw = (statusText || '').trim()
  if (!raw) return ''
  const allowed = new Set([
    'High', 'Low', 'Normal', 'Critically High', 'Critically Low',
    'Deficiency', 'Insuficiency', 'Sufficiency', 'Toxicity',
  ])
  if (allowed.has(raw)) return raw
  const label = (raw.split(/[\s<>0-9]/)[0] || raw.split(/\s+/)[0] || '').trim()
  const key = label.toLowerCase()
  if (key.startsWith('deficien')) return 'Deficiency'
  if (key.startsWith('insufficien') || key.startsWith('insuficien')) return 'Insuficiency'
  if (key.startsWith('sufficien')) return 'Sufficiency'
  if (key.startsWith('toxicit')) return 'Toxicity'
  return ''
}

const suggestMultipleResultStatus = (value: string, options: string[]): string => {
  const val = parseFloat(value)
  if (!Number.isFinite(val) || !options.length) return ''
  // Match thresholds from option placeholders (e.g. "Deficiency  <10"),
  // but return only the short mark for result_flag / Status display.
  let matched = ''
  for (const opt of options) {
    const lt = opt.match(/<\s*([\d.]+)/)
    if (lt && val < parseFloat(lt[1])) {
      matched = opt
      break
    }
  }
  if (!matched) {
    for (const opt of options) {
      const range = opt.match(/([\d.]+)\s*[-–—]\s*([\d.]+)/)
      if (range) {
        const lo = parseFloat(range[1])
        const hi = parseFloat(range[2])
        if (val >= lo && val <= hi) {
          matched = opt
          break
        }
      }
    }
  }
  if (!matched) {
    for (const opt of options) {
      const gt = opt.match(/>\s*([\d.]+)/)
      if (gt && val > parseFloat(gt[1])) {
        matched = opt
        break
      }
    }
  }
  return normalizeMultipleStatusMark(matched)
}

const highLowMarkFromRange = (
  value: string,
  min: number | null,
  max: number | null,
): string => {
  const val = parseFloat(value)
  if (!Number.isFinite(val) || (min == null && max == null)) return ''
  if (min != null && val < min) return 'Low'
  if (max != null && val > max) return 'High'
  return 'Normal'
}

const multipleStatusMarkClass = (status: string): string => {
  const s = status.toLowerCase()
  if (s === 'low' || s === 'critically low') {
    return 'border-yellow-300 bg-yellow-50 text-yellow-900'
  }
  if (
    s.includes('deficien') ||
    s.includes('toxicity') ||
    s === 'high' ||
    s === 'critically high' ||
    s === 'abnormal'
  ) {
    return 'border-red-300 bg-red-50 text-red-800'
  }
  if (s.includes('insufficien') || s.includes('insuficien')) return 'border-amber-300 bg-amber-50 text-amber-900'
  if (s.includes('sufficien') || s === 'normal') return 'border-green-300 bg-green-50 text-green-800'
  return 'border-slate-300 bg-white text-slate-800'
}

// ─── Filter Bar ─────────────────────────────────────────────────────────────

const templateRowMatchesQuery = (row: LabTestTemplateListRow, query: string): boolean => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    row.name.toLowerCase().includes(q) ||
    (row.lab_test_name || '').toLowerCase().includes(q) ||
    (row.lab_test_code || '').toLowerCase().includes(q)
  )
}

const FilterBar = ({ filters, onChange, onClear, activeCount, byNurse, outsourced }: {
  filters: Filters; onChange: (f: Filters) => void; onClear: () => void; activeCount: number
  /** When true, template search only lists Lab Test Templates with by_nurse set */
  byNurse?: boolean
  /** Outsourced Tests screen: lock "Is Outsourced" to Yes, hide Status + Doctor filters. */
  outsourced?: boolean
}) => {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value })
  const [templateQuery, setTemplateQuery] = useState('')
  const [allTemplates, setAllTemplates] = useState<LabTestTemplateListRow[]>([])
  const [templateLoadState, setTemplateLoadState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [practitionerQuery, setPractitionerQuery] = useState('')
  const [practitionerOptions, setPractitionerOptions] = useState<LinkFieldOption[]>([])
  const [practitionerOpen, setPractitionerOpen] = useState(false)
  const templateRef = useRef<HTMLDivElement>(null)
  const practitionerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(event.target as Node)) {
        setTemplateOpen(false)
      }
      if (practitionerRef.current && !practitionerRef.current.contains(event.target as Node)) {
        setPractitionerOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  useEffect(() => {
    if (!templateOpen || templateLoadState !== 'idle') return
    setTemplateLoadState('loading')
    const load = byNurse
      ? fetchLabTestTemplates(undefined, undefined, true).then((rows) =>
          rows.map((row) => ({
            name: row.name,
            lab_test_name: row.label || row.name,
            lab_test_code: '',
            department: row.department || '',
            lab_test_template_type: '',
            is_group: Number(row.is_group) ? 1 : 0,
            is_billable: 0,
            disabled: 0,
            female_min_range: '',
            female_max_range: '',
            male_min_range: '',
            male_max_range: '',
            min_range: '',
            max_range: '',
            lab_test_uom: '',
            lab_test_rate: 0,
          } satisfies LabTestTemplateListRow)),
        )
      : fetchLabTestTemplateList()
    load
      .then((rows) => {
        setAllTemplates(rows)
        setTemplateLoadState('done')
      })
      .catch(() => {
        setAllTemplates([])
        setTemplateLoadState('done')
      })
  }, [templateOpen, templateLoadState, byNurse])

  const filteredTemplates = useMemo(
    () => allTemplates.filter((row) => templateRowMatchesQuery(row, templateQuery)).slice(0, 50),
    [allTemplates, templateQuery],
  )

  const templateLoading = templateLoadState === 'loading'
  const templateHasFetched = templateLoadState === 'done'

  useEffect(() => {
    if (!practitionerOpen) return
    const t = setTimeout(async () => {
      try {
        setPractitionerOptions(await fetchHealthcarePractitioners(practitionerQuery || undefined))
      } catch { setPractitionerOptions([]) }
    }, practitionerQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [practitionerOpen, practitionerQuery])

  return (
    <div className="card-filter-bar relative z-10 flex flex-wrap items-end gap-3 px-1 py-2 bg-slate-50/80 border-b border-slate-100 rounded-md overflow-visible">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">From Date</label>
        <DateFilterInput value={filters.fromDate} onChange={(e) => set('fromDate', e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">To Date</label>
        <DateFilterInput value={filters.toDate} onChange={(e) => set('toDate', e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <div className="flex flex-col gap-1 min-w-[160px]">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
        <div className="relative">
          <select value={filters.status} onChange={(e) => set('status', e.target.value)}
            className="w-full appearance-none pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">Select All</option>
            {(outsourced ? OUTSOURCED_STATUS_OPTIONS : STATUS_OPTIONS).map((s) => <option key={s} value={s}>{statusDisplayLabel(s)}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>
      <div className="flex flex-col gap-1 min-w-[200px] relative" ref={practitionerRef}>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Doctor</label>
        <div className="relative">
          <input
            type="text"
            value={filters.practitioner ? filters.practitionerLabel : practitionerQuery}
            onChange={(e) => {
              setPractitionerQuery(e.target.value)
              onChange({ ...filters, practitioner: '', practitionerLabel: '' })
              setPractitionerOpen(true)
            }}
            onFocus={() => setPractitionerOpen(true)}
            placeholder="SELECT DOCTOR"
            className="w-full pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {filters.practitioner && (
            <button
              type="button"
              onClick={() => {
                setPractitionerQuery('')
                onChange({ ...filters, practitioner: '', practitionerLabel: '' })
              }}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Clear practitioner filter"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
        {practitionerOpen && practitionerOptions.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
            {practitionerOptions.map((opt) => (
              <button
                key={opt.name}
                type="button"
                onClick={() => {
                  onChange({ ...filters, practitioner: opt.name, practitionerLabel: opt.label || opt.name })
                  setPractitionerQuery('')
                  setPractitionerOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
              >
                <div className="font-medium text-slate-800">{opt.label || opt.name}</div>
                {opt.label && opt.label !== opt.name && <div className="text-xs text-slate-500">{opt.name}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 min-w-[120px]">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">Is Outsourced</label>
        <div className="relative">
          <select
            value={outsourced ? 'yes' : filters.isOutsourced}
            onChange={(e) => set('isOutsourced', e.target.value)}
            disabled={outsourced}
            className={`w-full appearance-none pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary ${outsourced ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white'}`}>
            {!outsourced && <option value="">Select All</option>}
            <option value="yes">Yes</option>
            {!outsourced && <option value="no">No</option>}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>
      <div className="flex flex-col gap-1 min-w-[200px] relative z-30" ref={templateRef}>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lab Test Template</label>
        <div className="relative">
          <input type="text" value={filters.template ? filters.templateLabel : templateQuery}
            onChange={(e) => { setTemplateQuery(e.target.value); onChange({ ...filters, template: '', templateLabel: '' }); setTemplateOpen(true) }}
            onFocus={() => setTemplateOpen(true)} placeholder="SELECT TEMPLATE"
            className="w-full pl-3 pr-8 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary" />
          {filters.template && (
            <button type="button" onClick={() => { setTemplateQuery(''); onChange({ ...filters, template: '', templateLabel: '' }) }}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
        {templateOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
            {templateLoading || !templateHasFetched ? (
              <div className="px-3 py-2 text-sm text-slate-500">Loading templates…</div>
            ) : filteredTemplates.length > 0 ? (
              filteredTemplates.map((row) => (
                <button key={row.name} type="button"
                  onClick={() => {
                    onChange({
                      ...filters,
                      template: row.name,
                      templateLabel: row.is_group
                        ? `${row.lab_test_name || row.name} (Group)`
                        : row.lab_test_name || row.name,
                    })
                    setTemplateQuery('')
                    setTemplateOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-slate-800 truncate">
                      {row.lab_test_name || row.name}
                    </span>
                    {row.is_group ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-200 text-indigo-700 shrink-0">
                        GROUP
                      </span>
                    ) : null}
                  </div>
                  {(row.lab_test_name && row.lab_test_name !== row.name) || row.lab_test_code ? (
                    <div className="text-xs text-slate-500">
                      {[row.name !== (row.lab_test_name || row.name) ? row.name : '', row.lab_test_code]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-slate-500">
                {templateQuery.trim()
                  ? `No template matches “${templateQuery.trim()}”`
                  : 'NO LAB TEST TEMPLATES AVAILABLE'}
              </div>
            )}
          </div>
        )}
      </div>
      <ClearFiltersButton className="!ml-0" onClick={onClear} activeCount={activeCount || undefined} disabled={activeCount === 0} />
    </div>
  )
}

const labTestHasResultsEntered = (child: LabTest) =>
  ['Pending Review', 'Reviewed', 'Rejected', 'Completed'].includes(child.status || '')

// Helper: group progress when all child tests have results saved (Pending Review or beyond)
const getGroupCompletionStatus = (children: LabTest[]) => {
  const total = children.length
  const completedCount = children.filter(labTestHasResultsEntered).length
  
  if (completedCount === 0) return { status: 'Not Started', color: 'warning', icon: '○' }
  if (completedCount === total) return { status: 'Complete', color: 'success', icon: '✓' }
  return { status: 'Partially Complete', color: 'info', icon: '◐' }
}

const FilterToggleButton = ({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-md border p-1.5 transition-colors ${
      active ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
    }`}
    title={active ? 'Hide filters' : 'Show filters'}
    aria-label={active ? 'Hide filters' : 'Show filters'}
  >
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
      />
    </svg>
  </button>
)

// Lab workflow tabs — each tab filters the list to one status. First tab is the
// default (Lab Requested). "All" clears the status filter.
// Ordered to follow the lab workflow sequence:
// Requested → Sample Collected → Test In Progress → Review Pending → Reviewed →
// Completed → Rejected, then Approved and All (kept so no status filter is lost).
const LAB_STATUS_TABS: { label: string; status: string }[] = [
  { label: 'Requested', status: 'Requested' },
  { label: 'Sample Collected', status: 'Sample Collected' },
  { label: 'Test In-Progress', status: 'Testing in Progress' },
  { label: 'Review Pending', status: 'Pending Review' },
  { label: 'Reviewed', status: 'Reviewed' },
  { label: 'Completed', status: 'Completed' },
  { label: 'Rejected', status: 'Rejected' },
  { label: 'Approved', status: 'Approved' },
  { label: 'All', status: '' },
]

/** Distinct listing header type — plain mono, no bold. */
const LAB_LIST_TH =
  'px-3 py-2 text-[11px] font-normal uppercase tracking-wide text-black [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace]'
const LAB_LIST_TH_CENTER = `${LAB_LIST_TH} text-center`
const LAB_LIST_TH_RIGHT = `${LAB_LIST_TH} text-right`

// ─── Main Component ──────────────────────────────────────────────────────────

export const LabTestList = ({
  patient, isOutsourced, defaultStatus, byNurse, onPatientClick, hideAmount,
  onPendingCountChange,
  onBatchSavingChange,
  batchSaveRef,
  doctorLabDefaults = false,
  pipelinePending = false,
  title = 'Lab Tests',
  onAdd,
  addButtonTitle = 'New Lab Test',
  headerExtra,
  focusLabTest,
  focusLabTests,
  focusLabGroupLabel,
  focusOpenSampleCollection = false,
  focusOpenReview = false,
  focusOpenResults = false,
  statusTabs = false,
  onOpenLabTrends,
}: {
  patient?: string
  isOutsourced?: boolean
  defaultStatus?: string
  byNurse?: boolean
  /** Show workflow status tabs (Lab Requested → Sample Collected → …) driving the status filter. */
  statusTabs?: boolean
  onPatientClick?: (patient: string) => void
  hideAmount?: boolean
  onPendingCountChange?: (count: number) => void
  onBatchSavingChange?: (saving: boolean) => void
  batchSaveRef?: MutableRefObject<LabTestListBatchSaveRef | null>
  /** Default practitioner filter to the logged-in user's linked practitioner (doctor dashboard). */
  doctorLabDefaults?: boolean
  /** Only show tests still in the lab pipeline (requested through testing, before doctor review). */
  pipelinePending?: boolean
  title?: string
  onAdd?: () => void
  addButtonTitle?: string
  headerExtra?: ReactNode
  /** When set, scroll to this lab test and optionally open sample collection, review, or results. */
  focusLabTest?: string
  /** Comma-separated lab test names — opens group/bulk review when focusOpenReview. */
  focusLabTests?: string
  focusLabGroupLabel?: string
  focusOpenSampleCollection?: boolean
  focusOpenReview?: boolean
  focusOpenResults?: boolean
  /** Doctor lab: open Lab Trends with this test name prefilled. */
  onOpenLabTrends?: (testName: string) => void
}) => {
  const {
    selectedPatient: contextPatient,
    userRole,
    guardClinicalEdit,
    userCostCenter,
    haveMultiresultsOnLabTest,
  } = useCareContext()
  // Multiple-unit result entry is opt-in via Healthcare Settings.have_multiresults_on_lab_test.
  // When off, a Multiple Results template behaves like any normal single-result lab test.
  const allowMultipleResults = Boolean(haveMultiresultsOnLabTest)
  const effectivePatient = patient ?? (contextPatient || undefined)
  const resultsReadOnly = doctorLabDefaults
  const nurseLabContext = Boolean(byNurse)
  const canEditResults = canEditLabTestResults(userRole, { nurseLabContext })
  const canEditResultRow = useCallback(
    (labTest: LabTest) =>
      !isLegacyHistoryLabRow(labTest) &&
      !resultsReadOnly &&
      canEditLabTestResultForRow(labTest, userRole, { nurseLabContext }),
    [resultsReadOnly, userRole, nurseLabContext]
  )

  // Pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)

  const cardFilters = useCardFilters()
  const preferLoadMore = usePreferCardLoadMore()
  const leadingSlot = useCardLeadingSlot()
  const headerSlot = useCardHeaderSlot()
  const [exportingPdf, setExportingPdf] = useState(false)
  const [showAssessmentExportModal, setShowAssessmentExportModal] = useState(false)
  const [assessmentExportFrom, setAssessmentExportFrom] = useState('')
  const [assessmentExportTo, setAssessmentExportTo] = useState('')
  const [showFiltersInternal, setShowFiltersInternal] = useState(false)
  const inDashboardCard = cardFilters !== undefined
  // Own the filter icon after status tabs (or when the card opts out of forced filters).
  const ownsFilterToggle = Boolean(statusTabs) || (inDashboardCard && cardFilters === false)
  const showFilters = ownsFilterToggle
    ? showFiltersInternal
    : cardFilters !== undefined
      ? cardFilters
      : showFiltersInternal
  const compactClinical = useDashboardCompactClinical()
  const [defaultPractitionerId, setDefaultPractitionerId] = useState<string | null>(null)
  const [defaultsReady, setDefaultsReady] = useState(!doctorLabDefaults)
  // The status the list starts on: an explicit defaultStatus, else the first status tab
  // (when status tabs are shown), else none. Used so the initial tab isn't counted as an
  // "active filter" and Clear returns to it rather than jumping to the "All" tab.
  const effectiveDefaultStatus = defaultStatus ?? (statusTabs ? LAB_STATUS_TABS[0].status : '')
  const [filters, setFilters] = useState<Filters>(() => ({
    ...makeEmptyFilters(),
    status: effectiveDefaultStatus,
    // Outsourced Tests screen: lock the Is Outsourced filter to Yes.
    isOutsourced: isOutsourced ? 'yes' : '',
  }))

  const selectStatusTab = (status: string) => {
    setFilters((prev) => ({ ...prev, status }))
    setPage(1)
  }

  // All lists start unfiltered — no default practitioner filter (nurse-dept request).
  useEffect(() => {
    if (true) {
      setDefaultsReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const practId = await getCurrentUserPractitioner()
        if (cancelled) return
        setDefaultPractitionerId(practId)
        if (practId) {
          let label = practId
          try {
            const options = await fetchHealthcarePractitioners()
            const match = options.find((p) => p.name === practId)
            label = match?.label || practId
          } catch { /* keep practId as label */ }
          setFilters((prev) => ({
            ...prev,
            practitioner: practId,
            practitionerLabel: label,
          }))
        }
      } finally {
        if (!cancelled) setDefaultsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doctorLabDefaults])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [filters])

  const activeCount = [
    filters.status && filters.status !== effectiveDefaultStatus ? filters.status : '',
    filters.fromDate,
    filters.toDate,
    // On the Outsourced screen the Is Outsourced value is a locked default, not a user filter.
    isOutsourced ? '' : filters.isOutsourced,
    doctorLabDefaults && filters.practitioner === (defaultPractitionerId || '') ? '' : filters.practitioner,
    filters.template,
  ].filter(Boolean).length

  const handleClearFilters = async () => {
    const cleared: Filters = {
      ...makeEmptyFilters(),
      status: effectiveDefaultStatus,
      isOutsourced: isOutsourced ? 'yes' : '',
    }
    if (doctorLabDefaults && defaultPractitionerId) {
      cleared.practitioner = defaultPractitionerId
      try {
        const options = await fetchHealthcarePractitioners()
        const match = options.find((p) => p.name === defaultPractitionerId)
        cleared.practitionerLabel = match?.label || defaultPractitionerId
      } catch {
        cleared.practitionerLabel = defaultPractitionerId
      }
    }
    setFilters(cleared)
  }

  const currentMonthRange = () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const last = String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` }
  }

  const openAssessmentExportModal = () => {
    const month = currentMonthRange()
    setAssessmentExportFrom(filters.fromDate || month.from)
    setAssessmentExportTo(filters.toDate || month.to)
    setShowAssessmentExportModal(true)
  }

  const exportAssessmentPdf = async (dateFrom: string, dateTo: string) => {
    setExportingPdf(true)
    try {
      const html = await fetchLabResultAssessmentHtml({
        dateFrom,
        dateTo,
        costCenter: userCostCenter || getPortalBranch() || undefined,
      })
      const win = window.open('', '_blank', 'width=1400,height=900')
      if (!win) {
        toast.error('Pop-up blocked. Allow pop-ups to download the PDF.')
        return
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
      win.focus()
      setShowAssessmentExportModal(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export lab report')
    } finally {
      setExportingPdf(false)
    }
  }

  const confirmAssessmentExport = () => {
    if (!assessmentExportFrom || !assessmentExportTo) {
      toast.error('Select From Date and To Date')
      return
    }
    if (assessmentExportTo < assessmentExportFrom) {
      toast.error('To Date cannot be before From Date')
      return
    }
    void exportAssessmentPdf(assessmentExportFrom, assessmentExportTo)
  }

  const downloadButton = (
    <button
      type="button"
      onClick={openAssessmentExportModal}
      disabled={exportingPdf}
      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      title="Download Lab Result Assessment Report"
      aria-label="Download Lab Result Assessment Report"
    >
      <Download className="h-3.5 w-3.5" strokeWidth={2.25} />
    </button>
  )

  const { labTests, totalCount, loading, error, refetch } = useLabTests(
    effectivePatient, filters.status || undefined, filters.status === 'Pending Review',
    isOutsourced !== undefined ? isOutsourced : (filters.isOutsourced ? filters.isOutsourced === 'yes' : undefined),
    filters.fromDate || undefined, filters.toDate || undefined,
    filters.template || undefined, filters.practitioner || undefined, byNurse,
    pageSize, (page - 1) * pageSize, defaultsReady, pipelinePending,
    preferLoadMore,
  )

  /** Legacy LAB 00-03 parents expand into LAB 00-04 singles for the list UI. */
  const displayLabTests = useMemo(() => {
    const expanded = expandLegacyLabTestsForDisplay(labTests)
    const templateFilter = filters.template?.trim()
    if (!templateFilter) return expanded

    return expanded.filter((lt) => {
      if (
        lt.template === templateFilter ||
        lt.lab_test_group === templateFilter ||
        lt.legacy_sub_template === templateFilter
      ) {
        return true
      }
      if (lt.is_legacy_line_row && filters.templateLabel) {
        const label = filters.templateLabel.replace(/\s*\(Group\)\s*$/i, '').trim().toLowerCase()
        const rowLabel = (lt.lab_test_name || '').trim().toLowerCase()
        if (label && rowLabel === label) return true
      }
      return false
    })
  }, [labTests, filters.template, filters.templateLabel])

  const [defaultLabTechnician, setDefaultLabTechnician] = useState<LinkFieldOption | null>(null)

  useEffect(() => {
    let cancelled = false
    getCurrentUserLabTechnicianOption()
      .then((opt) => {
        if (!cancelled) setDefaultLabTechnician(opt)
      })
      .catch(() => {
        if (!cancelled) setDefaultLabTechnician(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const batch = useBatchLabTestResults(
    labTests,
    canEditResultRow,
    onPendingCountChange,
    onBatchSavingChange,
    refetch,
    defaultLabTechnician
  )

  useEffect(() => {
    if (!batchSaveRef) return
    batchSaveRef.current = {
      savePendingChanges: async () => {
        await batch.savePendingChanges()
      },
    }
  }, [batchSaveRef, batch.savePendingChanges])

  // ── Inline Result Editing ──
  const [editingResult, setEditingResult] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState<string>('')

  /** Inline lab technician picker (table column after Results). */
  const [inlineLabTechLabTestName, setInlineLabTechLabTestName] = useState<string | null>(null)
  const [inlineLabTechQuery, setInlineLabTechQuery] = useState('')
  const [inlineLabTechOptions, setInlineLabTechOptions] = useState<LinkFieldOption[]>([])

  const finishResultEdit = (labTest: LabTest) => {
    batch.commitEditToPending(labTest, editingValue)
    setEditingResult(null)
    setEditingValue('')
  }

  const cancelResultEdit = (labTest: LabTest) => {
    batch.cancelPendingFor(labTest.name)
    setEditingResult(null)
    setEditingValue('')
  }

  const handleInlineLabTechPick = (labTestName: string, practitionerId: string, label?: string) => {
    batch.setPendingLabTechnician(labTestName, practitionerId)
    setInlineLabTechLabTestName(null)
    setInlineLabTechQuery(label || practitionerId)
    setInlineLabTechOptions([])
  }

  // ── Consumables dialog ───────────────────────────────────────────────────
  const [requestingFor, setRequestingFor] = useState<string | null>(null)
  const [dialogItems, setDialogItems] = useState<LabConsumableRow[]>([])
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [dialogIsMedical, setDialogIsMedical] = useState<IsMedicalChoice>('')
  const [itemOptions, setItemOptions] = useState<LinkFieldOption[]>([])
  const [warehouseOptions, setWarehouseOptions] = useState<LinkFieldOption[]>([])
  const [openItemIndex, setOpenItemIndex] = useState<number | null>(null)
  const [openWarehouseIndex, setOpenWarehouseIndex] = useState<number | null>(null)

  // ── Results dialog ───────────────────────────────────────────────────────
  const [resultDialogOpen, setResultDialogOpen] = useState(false)
  const [resultDialogLoading, setResultDialogLoading] = useState(false)
  const [resultDialogError, setResultDialogError] = useState<string | null>(null)
  const [activeLabTest, setActiveLabTest] = useState<LabTest | null>(null)
  const [customResult, setCustomResult] = useState('')
  const [labComment, setLabComment] = useState('')
  const [worksheetText, setWorksheetText] = useState('')
  const [resultDialogTab, setResultDialogTab] = useState<'results' | 'documents'>('results')
  const [resultDocuments, setResultDocuments] = useState<PatientDocumentRow[]>([])
  const [resultDocumentTypes, setResultDocumentTypes] = useState<{ name: string; document_name?: string }[]>([])
  const [resultDocumentUploading, setResultDocumentUploading] = useState<number | null>(null)
  const [normalTestItems, setNormalTestItems] = useState<NormalTestResultRow[]>([])
  const [templateDetails, setTemplateDetails] = useState<LabTestTemplateDetails>({})
  /**
   * Template is Multiple Results AND the Multiple Results feature is enabled
   * (fresh value from the template fetch, falling back to the app-load-time flag).
   * When disabled the template is entered as a normal single-result lab test.
   */
  const showMultipleUnitResults =
    Boolean(templateDetails.is_multiple) &&
    Boolean(templateDetails.have_multiresults_on_lab_test ?? allowMultipleResults)
  const [worksheetExpanded, setWorksheetExpanded] = useState(false)
  const [labTechnician, setLabTechnician] = useState('')
  const [labTechnicianQuery, setLabTechnicianQuery] = useState('')
  const [labTechnicianOptions, setLabTechnicianOptions] = useState<LinkFieldOption[]>([])
  const [labTechnicianOpen, setLabTechnicianOpen] = useState(false)

  // ── Review / actions ───────────────────────────────────────────────────────
  const [openActionRow, setOpenActionRow] = useState<string | null>(null)
  const [selectedLabTestForDetails, setSelectedLabTestForDetails] = useState<string | null>(null)
  const [editLabTestName, setEditLabTestName] = useState<string | null>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const [sampleModalLabTest, setSampleModalLabTest] = useState<LabTest | null>(null)
  const [sampleModalLoading, setSampleModalLoading] = useState(false)
  const [sampleModalError, setSampleModalError] = useState<string | null>(null)
  const [sampleModalGroup, setSampleModalGroup] = useState<{
    children: LabTest[]
    label: string
    serviceRequest: string
    labTestGroup?: string
  } | null>(null)
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Record<string, boolean>>({})
  const [finishingGroupKey, setFinishingGroupKey] = useState<string | null>(null)

  const resetSampleModalState = () => {
    setSampleModalLabTest(null)
    setSampleModalError(null)
    setSampleModalGroup(null)
  }

  useEffect(() => {
    if (!resultDialogOpen) return
    const t = setTimeout(async () => {
      try {
        setLabTechnicianOptions(await fetchLabTechnicianPractitioners(labTechnicianQuery.trim() || undefined))
      } catch {
        setLabTechnicianOptions([])
      }
    }, labTechnicianQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [resultDialogOpen, labTechnicianQuery])

  useEffect(() => {
    if (!inlineLabTechLabTestName) return
    const t = setTimeout(async () => {
      try {
        setInlineLabTechOptions(await fetchLabTechnicianPractitioners(inlineLabTechQuery.trim() || undefined))
      } catch {
        setInlineLabTechOptions([])
      }
    }, inlineLabTechQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [inlineLabTechLabTestName, inlineLabTechQuery])

  useEffect(() => {
    if (!inlineLabTechLabTestName) return
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-inline-lab-tech-cell]')) return
      setInlineLabTechLabTestName(null)
      setInlineLabTechQuery('')
      setInlineLabTechOptions([])
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [inlineLabTechLabTestName])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-portal-actions-menu]')) return
      if (el.closest('button[aria-label="Actions"]')) return
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) setOpenActionRow(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const [reviewModal, setReviewModal] = useState<{
    name?: string
    outcome: 'Reviewed' | 'Rejected'
    bulk?: {
      serviceRequest: string
      groupLabel: string
      tests: LabTest[]
    }
  } | null>(null)

  const openReviewModal = (name: string, outcome: 'Reviewed' | 'Rejected') => {
    setOpenActionRow(null)
    setReviewModal({ name, outcome })
  }

  const openBulkReviewModal = (serviceRequest: string, groupLabel: string, children: LabTest[]) => {
    const eligible = children.filter((child) => child.status === 'Pending Review')
    if (!eligible.length) {
      toast.error('No tests in this group are pending review.')
      return
    }
    setReviewModal({
      outcome: 'Reviewed',
      bulk: { serviceRequest, groupLabel, tests: children },
    })
  }

  const handleFinishGroup = async (serviceRequest: string, groupKey: string, labTestGroup?: string) => {
    try {
      setFinishingGroupKey(groupKey)
      await finishGroupLabTests(serviceRequest, labTestGroup)
      toast.success('Grouped lab request finished')
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to finish grouped lab request')
    } finally { setFinishingGroupKey(null) }
  }

  const [sampleCancelLabTest, setSampleCancelLabTest] = useState<LabTest | null>(null)
  const [sampleCancelLoading, setSampleCancelLoading] = useState(false)
  const [deleteLabTestTarget, setDeleteLabTestTarget] = useState<LabTest | null>(null)
  const [deleteLabTestLoading, setDeleteLabTestLoading] = useState(false)

  const handleCancelSampleHandlingForLabTest = (labTest: LabTest) => {
    setOpenActionRow(null)
    setSampleCancelLabTest(labTest)
  }

  const confirmCancelSampleHandling = async () => {
    if (!sampleCancelLabTest) return
    setSampleCancelLoading(true)
    try {
      await cancelLabSampleHandling({ labTestName: sampleCancelLabTest.name })
      toast.success('Sample handling cancelled')
      setSampleCancelLabTest(null)
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel sample handling')
    } finally {
      setSampleCancelLoading(false)
    }
  }

  const handleDeleteRequestedLabTest = (labTest: LabTest) => {
    setOpenActionRow(null)
    setDeleteLabTestTarget(labTest)
  }

  const confirmDeleteRequestedLabTest = async () => {
    if (!deleteLabTestTarget) return
    setDeleteLabTestLoading(true)
    try {
      const result = await deleteRequestedLabTest(deleteLabTestTarget.name)
      if (result.deleted_service_request && result.service_request) {
        toast.success(`Lab test deleted. Lab request ${result.service_request} was also removed.`)
      } else {
        toast.success('Lab test deleted')
      }
      setDeleteLabTestTarget(null)
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete lab test')
    } finally {
      setDeleteLabTestLoading(false)
    }
  }

  const handleOpenSampleCollection = (
    labTest: LabTest,
    group?: { children: LabTest[]; label: string; serviceRequest: string; labTestGroup?: string } | null
  ) => {
    setOpenActionRow(null)
    setSampleModalError(null)
    setSampleModalGroup(group ?? null)
    setSampleModalLoading(true)
    setSampleModalLabTest(labTest)
    fetchLabTest(labTest.name)
      .then(setSampleModalLabTest)
      .catch((e) => { const msg = e instanceof Error ? e.message : 'Failed to load lab test'; setSampleModalError(msg); toast.error(msg) })
      .finally(() => setSampleModalLoading(false))
  }

  const focusLabTestHandledRef = useRef<string | null>(null)
  useEffect(() => {
    const multiTargets = (focusLabTests || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const singleTarget = (focusLabTest || '').trim()
    const focusKey = multiTargets.length > 1
      ? `bulk:${multiTargets.join(',')}`
      : singleTarget || (multiTargets[0] || '')
    if (!focusKey || loading || focusLabTestHandledRef.current === focusKey) return

    if (multiTargets.length > 1 && focusOpenReview) {
      focusLabTestHandledRef.current = focusKey
      const fromList = displayLabTests.filter((lt) => {
        const docName = resolveLabTestDocName(lt)
        return multiTargets.includes(docName) || multiTargets.includes(lt.name)
      })
      const openBulk = (tests: LabTest[]) => {
        if (!tests.length) {
          toast.error('Could not load group tests for review')
          return
        }
        const first = tests[0]
        openBulkReviewModal(
          first.service_request || '',
          focusLabGroupLabel || first.lab_test_group_name || first.lab_test_group || 'Group',
          tests
        )
      }
      if (fromList.length >= multiTargets.length) {
        openBulk(fromList)
        return
      }
      Promise.all(multiTargets.map((name) => fetchLabTest(name).catch(() => null)))
        .then((docs) => {
          const tests = docs.filter(Boolean) as LabTest[]
          openBulk(tests.length ? tests : fromList)
        })
        .catch(() => {
          focusLabTestHandledRef.current = null
          toast.error('Failed to load group tests for review')
        })
      return
    }

    const target = singleTarget || multiTargets[0] || ''
    if (!target) return

    const openForTest = (labTest: LabTest) => {
      focusLabTestHandledRef.current = focusKey
      const docName = resolveLabTestDocName(labTest)
      window.requestAnimationFrame(() => {
        document.getElementById(`lab-test-row-${docName}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
      if (focusOpenSampleCollection) {
        handleOpenSampleCollection(labTest)
      } else if (focusOpenReview) {
        openReviewModal(docName, 'Reviewed')
      } else if (focusOpenResults) {
        void openResultDialog(docName)
      } else {
        setSelectedLabTestForDetails(docName)
      }
    }

    const match = displayLabTests.find((lt) => {
      const docName = resolveLabTestDocName(lt)
      return docName === target || lt.name === target
    })

    if (match) {
      openForTest(match)
      return
    }

    if (labTests.length === 0) return

    focusLabTestHandledRef.current = focusKey
    fetchLabTest(target)
      .then((doc) => {
        if (focusOpenSampleCollection) {
          handleOpenSampleCollection(doc)
        } else if (focusOpenReview) {
          openReviewModal(resolveLabTestDocName(doc), 'Reviewed')
        } else if (focusOpenResults) {
          void openResultDialog(resolveLabTestDocName(doc))
        } else {
          setSelectedLabTestForDetails(resolveLabTestDocName(doc))
        }
      })
      .catch((e) => {
        focusLabTestHandledRef.current = null
        toast.error(e instanceof Error ? e.message : 'Failed to load lab test')
      })
  }, [
    focusLabTest,
    focusLabTests,
    focusLabGroupLabel,
    focusOpenSampleCollection,
    focusOpenReview,
    focusOpenResults,
    loading,
    displayLabTests,
    labTests.length,
  ])

  // ── Remarks modal ──────────────────────────────────────────────────────────
  const [remarksModalOpen, setRemarksModalOpen] = useState(false)
  const [remarksLabTestName, setRemarksLabTestName] = useState<string | null>(null)
  const [remarksList, setRemarksList] = useState<Array<{ rrmark: string }>>([{ rrmark: '' }])
  const [remarksLoading, setRemarksLoading] = useState(false)
  const [remarksError, setRemarksError] = useState<string | null>(null)

  const openRemarksModal = async (labTestName: string) => {
    setOpenActionRow(null); setRemarksLabTestName(labTestName); setRemarksError(null)
    setRemarksList([{ rrmark: '' }]); setRemarksLoading(true); setRemarksModalOpen(true)
    try {
      const doc = await fetchLabTest(labTestName)
      const existing = (doc as LabTest).remarks
      setRemarksList(existing?.length ? existing.map((r) => ({ rrmark: r.rrmark || '' })) : [{ rrmark: '' }])
    } catch (e) { setRemarksError(e instanceof Error ? e.message : 'Failed to load lab test') }
    finally { setRemarksLoading(false) }
  }
  const closeRemarksModal = () => { setRemarksModalOpen(false); setRemarksLabTestName(null); setRemarksList([{ rrmark: '' }]); setRemarksError(null) }
  const addRemarksRow = () => setRemarksList((prev) => [...prev, { rrmark: '' }])
  const updateRemarksRow = (idx: number, value: string) => setRemarksList((prev) => { const next = [...prev]; next[idx] = { rrmark: value }; return next })
  const removeRemarksRow = (idx: number) => setRemarksList((prev) => prev.length <= 1 ? [{ rrmark: '' }] : prev.filter((_, i) => i !== idx))
  const handleSubmitRemarks = async () => {
    if (!remarksLabTestName) return
    const payload = remarksList.map((r) => ({ rrmark: (r.rrmark || '').trim() })).filter((r) => r.rrmark)
    setRemarksLoading(true); setRemarksError(null)
    try {
      await updateLabTestRemarks(remarksLabTestName, payload.length ? payload : [])
      toast.success('Remarks saved'); refetch(); closeRemarksModal()
    } catch (e) { setRemarksError(e instanceof Error ? e.message : 'Failed to save remarks'); toast.error('Failed to save remarks') }
    finally { setRemarksLoading(false) }
  }

  const openRequestDialog = async (labTest: LabTest) => {
    try {
      setDialogError(null); setDialogLoading(true); setRequestingFor(labTest.name); setDialogIsMedical('')
      if (!itemOptions.length) fetchItems().then(setItemOptions).catch(() => setItemOptions([]))
      if (!warehouseOptions.length) fetchWarehouses(labTest.company || undefined).then(setWarehouseOptions).catch(() => setWarehouseOptions([]))
      const items = await getLabTestConsumables(labTest.name)
      setDialogItems(items.length ? items : [{ item_code: '', item_name: '', qty: 1 }])
    } catch (e) { setDialogError(e instanceof Error ? e.message : 'Failed to load consumables') }
    finally { setDialogLoading(false) }
  }

  const closeRequestDialog = () => { setRequestingFor(null); setDialogItems([]); setDialogError(null); setDialogLoading(false); setDialogIsMedical('') }
  const updateItem = (index: number, field: keyof LabConsumableRow, value: string) => {
    setDialogItems((prev) => prev.map((row, i) => i === index ? { ...row, [field]: field === 'qty' ? Number(value) || 0 : value } : row))
  }
  const addRow = () => setDialogItems((prev) => [...prev, { item_code: '', item_name: '', qty: 1 }])
  const removeRow = (index: number) => setDialogItems((prev) => prev.filter((_, i) => i !== index))
  const submitRequest = async () => {
    if (!requestingFor) return
    const validItems = dialogItems.filter((row) => row.item_code && row.qty > 0)
    if (!validItems.length) { setDialogError('Please add at least one item with quantity.'); return }
    if (!isMedicalChoiceRequired(dialogIsMedical)) {
      setDialogError('Please select a category (Medical or Consumable).')
      return
    }
    try {
      setDialogLoading(true); setDialogError(null)
      const mrName = await requestLabConsumables(requestingFor, validItems, undefined, isMedicalPayload(dialogIsMedical))
      await refetch(); closeRequestDialog(); alert(`Material Request ${mrName} created`)
    } catch (e) { setDialogError(e instanceof Error ? e.message : 'Failed to create Material Request') }
    finally { setDialogLoading(false) }
  }

  const openResultDialog = async (labTestName: string) => {
    try {
      setResultDialogError(null); setResultDialogLoading(true); setResultDialogOpen(true)
      setResultDialogTab('results'); setWorksheetExpanded(false)
      setActiveLabTest({ name: labTestName, patient: '' })
      const [doc, docTypes] = await Promise.all([fetchLabTest(labTestName), fetchDocumentTypes()])
      if (!isLabTestSampleCollectionDone(doc) || !canEditLabTestResultForRow(doc, userRole, { nurseLabContext })) {
        setResultDialogOpen(false)
        setResultDialogLoading(false)
        toast.error(
          labResultLockReason(doc, userRole, { nurseLabContext }) ||
            'Complete sample collection before entering results.'
        )
        return
      }
      setActiveLabTest(doc); setCustomResult(doc.custom_result || ''); setLabComment(doc.lab_test_comment || '')
      setWorksheetText(doc.worksheet_instructions || ''); setResultDocumentTypes(docTypes)
      const existingItems: NormalTestResultRow[] = (doc.normal_test_items || []).map((r: any) => ({ ...r }))
      setNormalTestItems(existingItems)
      if (doc.template) {
        fetchLabTestTemplateDetails(doc.template).then((d) => {
          setTemplateDetails(d)
          // The setting returned with this fetch is authoritative (fresh) over the
          // app-load-time Healthcare Settings flag.
          const allowUnits = Boolean(d.have_multiresults_on_lab_test ?? allowMultipleResults)
          if (!doc.worksheet_instructions && d.worksheet_instructions) setWorksheetText(d.worksheet_instructions)
          if (existingItems.length === 0 && (d.normal_test_templates || []).length > 0) {
            setNormalTestItems((d.normal_test_templates || []).map((t) => ({
              lab_test_event: t.lab_test_event || '', lab_test_name: t.lab_test_event || '',
              lab_test_uom: t.lab_test_uom || '', normal_range: t.normal_range || '',
              result_value: '', lab_test_comment: '', template: doc.template || '',
            })))
          } else if (
            allowUnits &&
            existingItems.length > 0 &&
            d.is_multiple &&
            (d.multiple_result_type || []).length > 0
          ) {
            // Re-attach per-unit range metadata; Deficiency bands only when use_status=1
            const byUnit = new Map(
              (d.multiple_result_type || []).map((t) => [(t.test_unit || t.uom || '').trim(), t])
            )
            const statusOptions = d.status_options || []
            setNormalTestItems(
              existingItems.map((row) => {
                const key = (row.lab_test_event || row.lab_test_name || '').trim()
                const t = byUnit.get(key)
                const useStatus = Boolean(t?.use_status ?? t?.uses_status_bands)
                const sex = (doc as LabTest).patient_sex || (doc as LabTest).gender
                const enriched: NormalTestResultRow = {
                  ...row,
                  uses_status_bands: useStatus,
                  male_min_range: t?.male_min_range ?? row.male_min_range,
                  male_max_range: t?.male_max_range ?? row.male_max_range,
                  female_min_range: t?.female_min_range ?? row.female_min_range,
                  female_max_range: t?.female_max_range ?? row.female_max_range,
                  normal_range: row.normal_range || t?.normal_range || '',
                }
                if (row.result_value) {
                  if (useStatus && statusOptions.length) {
                    enriched.result_status = suggestMultipleResultStatus(String(row.result_value), statusOptions)
                  } else {
                    const { min, max } = effectiveRowRange(enriched, d, sex)
                    enriched.result_status = highLowMarkFromRange(String(row.result_value), min, max)
                  }
                }
                return enriched
              })
            )
          } else if (
            allowUnits &&
            existingItems.length === 0 &&
            d.is_multiple &&
            (d.multiple_result_type || []).length > 0
          ) {
            setNormalTestItems((d.multiple_result_type || []).map((t) => {
              const unit = (t.test_unit || t.uom || '').trim()
              const useStatus = Boolean(t.use_status ?? t.uses_status_bands)
              return {
                lab_test_event: unit,
                lab_test_name: unit,
                lab_test_uom: (t.uom || t.test_unit || '').trim(),
                normal_range: t.normal_range || '',
                result_value: '',
                result_status: '',
                lab_test_comment: '',
                template: doc.template || '',
                uses_status_bands: useStatus,
                male_min_range: t.male_min_range,
                male_max_range: t.male_max_range,
                female_min_range: t.female_min_range,
                female_max_range: t.female_max_range,
              }
            }))
          }
        }).catch(() => setTemplateDetails({}))
      } else { setTemplateDetails({}) }
      const docs = (doc as LabTest).documents?.length
        ? (doc as LabTest).documents!.map((d) => ({ file_name: d.file_name || '', document_type: d.document_type || '', transaction_no: d.transaction_no || '', upload_remarks: d.upload_remarks || '', document: d.document || '' }))
        : [{ file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }]
      setResultDocuments(docs)
      const existingTech = (doc.lab_technician || '').trim()
      if (existingTech) {
        setLabTechnician(existingTech)
        setLabTechnicianQuery((doc.lab_technician_name || '').trim() || existingTech)
      } else if (defaultLabTechnician?.name) {
        setLabTechnician(defaultLabTechnician.name)
        setLabTechnicianQuery(defaultLabTechnician.label || defaultLabTechnician.name)
      } else {
        setLabTechnician('')
        setLabTechnicianQuery('')
      }
      setLabTechnicianOpen(false)
    } catch (e) { setResultDialogError(e instanceof Error ? e.message : 'Failed to load lab test') }
    finally { setResultDialogLoading(false) }
  }
  const closeResultDialog = () => {
    setResultDialogOpen(false); setActiveLabTest(null); setCustomResult(''); setLabComment('')
    setWorksheetText(''); setResultDialogTab('results'); setResultDocuments([])
    setResultDialogError(null); setResultDialogLoading(false); setNormalTestItems([]); setTemplateDetails({}); setWorksheetExpanded(false)
    setLabTechnician(''); setLabTechnicianQuery(''); setLabTechnicianOptions([]); setLabTechnicianOpen(false)
  }
  const addResultDocumentRow = () => setResultDocuments(prev => [...prev, { file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }])
  const updateResultDocumentRow = (idx: number, field: keyof PatientDocumentRow, value: string) => {
    setResultDocuments(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next })
  }
  const handleResultDocumentFile = async (idx: number, file: File | null) => {
    if (!file) return
    setResultDocumentUploading(idx)
    try {
      const file_url = await uploadPatientFile(file)
      if (!file_url) throw new Error('No URL returned from upload')
      setResultDocuments(prev => { const next = [...prev]; next[idx] = { ...next[idx], document: file_url, file_name: (next[idx].file_name || '').trim() || file.name }; return next })
      toast.success('File uploaded')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'File upload failed') }
    finally { setResultDocumentUploading(null) }
  }
  const handleSubmitLabTestWithResults = async () => {
    if (!activeLabTest) return
    try {
      setResultDialogLoading(true); setResultDialogError(null)
      const docPayload = resultDocuments.filter((r) => (r.file_name || '').trim() || (r.document || '').trim())
        .map((r) => ({ file_name: (r.file_name || '').trim() || undefined, document_type: (r.document_type || '').trim() || undefined, transaction_no: (r.transaction_no || '').trim() || undefined, upload_remarks: (r.upload_remarks || '').trim() || undefined, document: (r.document || '').trim() || undefined }))
      const res = await saveAndSubmitLabTest(activeLabTest.name, {
        custom_result: customResult, lab_test_comment: labComment, worksheet_instructions: worksheetText,
        documents: docPayload.length ? docPayload : undefined,
        normal_test_items: normalTestItems.length ? normalTestItems : undefined,
        lab_technician: labTechnician.trim() || undefined,
      })
      showLabTestRuleFeedback(res)
      await refetch(); closeResultDialog()
    } catch (e) { setResultDialogError(e instanceof Error ? e.message : 'Failed to save lab results') }
    finally { setResultDialogLoading(false) }
  }

  const getRangeHeaders = (list: LabTest[]) => {
    if (!list.length) return { showFemale: false, showMale: false, showGeneric: true }
    const gender = list[0].gender
    if (gender === 'Female') return { showFemale: true, showMale: false, showGeneric: false }
    if (gender === 'Male') return { showFemale: false, showMale: true, showGeneric: false }
    return { showFemale: false, showMale: false, showGeneric: true }
  }

  // ── Group + standalone rows in creation order (not groups-first) ───────────
  type LabTestDisplayRow =
    | { kind: 'group'; serviceRequest: string; labTestGroup?: string; groupKey: string; children: LabTest[]; sortMs: number }
    | { kind: 'standalone'; labTest: LabTest; sortMs: number }

  const labTestCreationMs = (lt: LabTest) => {
    if (lt.creation) {
      const ms = new Date(lt.creation).getTime()
      if (!Number.isNaN(ms)) return ms
    }
    return 0
  }

  const labRequestDisplayGroupKey = (lt: Pick<LabTest, 'service_request' | 'lab_test_group'>) => {
    const sr = (lt.service_request || '').trim()
    const group = (lt.lab_test_group || '').trim()
    return group ? `${sr}::${group}` : sr
  }

  const displayRows = useMemo((): LabTestDisplayRow[] => {
    const groups = new Map<string, LabTest[]>()
    const standalone: LabTest[] = []

    for (const lt of displayLabTests) {
      if (lt.is_group_lab_test && lt.service_request) {
        const key = labRequestDisplayGroupKey(lt)
        const arr = groups.get(key) || []
        arr.push(lt)
        groups.set(key, arr)
      } else {
        standalone.push(lt)
      }
    }

    const rows: LabTestDisplayRow[] = []

    for (const [groupKey, children] of groups.entries()) {
      const sortedChildren = [...children].sort(
        (a, b) => labTestCreationMs(b) - labTestCreationMs(a) || a.name.localeCompare(b.name)
      )
      const sortMs = Math.max(...sortedChildren.map(labTestCreationMs), 0)
      const representative = sortedChildren[0]
      rows.push({
        kind: 'group',
        serviceRequest: representative.service_request || groupKey,
        labTestGroup: (representative.lab_test_group || '').trim() || undefined,
        groupKey,
        children: sortedChildren,
        sortMs,
      })
    }

    for (const lt of standalone) {
      rows.push({ kind: 'standalone', labTest: lt, sortMs: labTestCreationMs(lt) })
    }

    return rows.sort((a, b) => b.sortMs - a.sortMs || (a.kind === 'group' ? a.groupKey : a.labTest.name).localeCompare(
      b.kind === 'group' ? b.groupKey : b.labTest.name
    ))
  }, [displayLabTests])

  const rangeHeaders = getRangeHeaders(displayLabTests)

  const hasGroupedLabTests = useMemo(
    () => displayLabTests.some((lt) => lt.is_group_lab_test && lt.service_request),
    [displayLabTests]
  )

  const useDoctorCompactCard = compactClinical && Boolean(effectivePatient) && doctorLabDefaults
  const useCompactCardTable = compactClinical && Boolean(effectivePatient) && !hasGroupedLabTests && !doctorLabDefaults

  useEffect(() => {
    if (!doctorLabDefaults || !hasGroupedLabTests) return
    const groups = new Map<string, LabTest[]>()
    for (const lt of displayLabTests) {
      if (lt.is_group_lab_test && lt.service_request) {
        const key = labRequestDisplayGroupKey(lt)
        const arr = groups.get(key) || []
        arr.push(lt)
        groups.set(key, arr)
      }
    }
    const toExpand: Record<string, boolean> = {}
    for (const [groupKey, children] of groups.entries()) {
      if (getGroupCompletionStatus(children).status === 'Partially Complete') {
        toExpand[groupKey] = true
      }
    }
    if (Object.keys(toExpand).length) {
      setExpandedGroupKeys((prev) => ({ ...prev, ...toExpand }))
    }
  }, [doctorLabDefaults, hasGroupedLabTests, displayLabTests])

  // Helper: render the result edit cell for a child/standalone test
  const renderResultCell = (labTest: LabTest) => {
    const displayResult = batch.getDisplayResult(labTest)
    const dirty = batch.isDirty(labTest)
    const rowEditable = canEditResultRow(labTest)
    const isEmpty = !displayResult
    return (
    <td className="px-3 py-1.5 text-sm max-w-[200px]">
      {editingResult === labTest.name ? (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input type="text" value={editingValue} onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishResultEdit(labTest)
              else if (e.key === 'Escape') cancelResultEdit(labTest)
            }}
            onBlur={() => finishResultEdit(labTest)}
            className="w-full px-2 py-0.5 text-sm border border-emerald-500 rounded focus:outline-none focus:ring-2 focus:ring-emerald-400" autoFocus />
        </div>
      ) : (
        <div onClick={(e) => {
          e.stopPropagation()
          if (!rowEditable) return
          setEditingResult(labTest.name)
          setEditingValue(displayResult)
        }}
          className={`min-h-[22px] min-w-[72px] rounded px-1.5 py-0.5 text-sm transition-colors ${
            !rowEditable
              ? displayResult
                ? 'cursor-not-allowed bg-slate-50 text-slate-800'
                : 'cursor-not-allowed border border-dashed border-slate-200 bg-slate-50 text-slate-400'
              : dirty
                ? 'cursor-pointer border border-amber-300 bg-amber-50 text-amber-900 font-medium hover:bg-amber-100/80'
                : isEmpty
                  ? 'cursor-pointer border border-emerald-500 bg-white hover:bg-emerald-50/50'
                  : 'cursor-pointer border border-slate-200 bg-white text-slate-800 font-medium hover:bg-slate-50'
          }`}
          title={
            !rowEditable
              ? resultsReadOnly
                ? 'Results are read-only on the doctor view'
                : labResultLockReason(labTest, userRole, { nurseLabContext }) ||
                  'Results cannot be edited in this status'
              : dirty
                ? 'Unsaved — click Save in the header'
                : isEmpty
                  ? 'Enter result'
                  : 'Edit result'
          }>
          {!rowEditable && isEmpty ? (
            <span className="text-slate-400" title="Complete sample collection before entering results">
              —
            </span>
          ) : displayResult ? (
            <span className="block truncate">{displayResult}</span>
          ) : (
            <span className="block min-h-[1rem]" aria-hidden />
          )}
        </div>
      )}
    </td>
  )
  }

  const renderResultArrowCell = (labTest: LabTest) => {
    const flag = getLabTestResultFlag(labTest, batch.getDisplayResult)
    const isLow = flag === 'Critically Low' || flag === 'Low'
    const isHigh = flag === 'Critically High' || flag === 'High'

    if (!isLow && !isHigh) {
      return (
        <td className="px-2 py-1.5 text-center">
          <span className="text-xs text-slate-300">—</span>
        </td>
      )
    }

    const Icon = isLow ? ArrowDown : ArrowUp
    const colorClass = isLow
      ? isCriticalResultFlag(flag)
        ? 'text-yellow-700'
        : 'text-yellow-600'
      : isCriticalResultFlag(flag)
        ? 'text-red-600'
        : 'text-orange-600'

    return (
      <td className="px-2 py-1.5 text-center" title={resultFlagLabel(flag)}>
        <Icon className={`mx-auto h-4 w-4 ${colorClass}`} aria-label={resultFlagLabel(flag)} />
      </td>
    )
  }

  // Helper: render result flag cell
  const renderResultFlagCell = (labTest: LabTest) => {
    const rawFlag = getLabTestResultFlag(labTest, batch.getDisplayResult)
    const flag = resultFlagLabel(rawFlag)

    if (!flag) {
      return (
        <td className="px-3 py-1.5 text-sm text-slate-400">
          <span className="text-xs">—</span>
        </td>
      )
    }

    const isLow = rawFlag === 'Critically Low' || rawFlag === 'Low'
    const critical = isCriticalResultFlag(rawFlag)
    const badgeClass = isLow
      ? critical
        ? 'bg-yellow-100 text-yellow-900 ring-1 ring-yellow-400'
        : 'bg-yellow-100 text-yellow-800'
      : critical
        ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
        : 'bg-orange-100 text-orange-700'
    return (
      <td className="px-3 py-1.5">
        <span
          className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${badgeClass}`}
          title={critical ? 'Critical value — urgent attention required' : undefined}
        >
          {flag}
        </span>
      </td>
    )
  }

  const renderTechnicianCell = (labTest: LabTest) => {
    const displayName = batch.getDisplayLabTechName(labTest)
    const techPending = Boolean(batch.pendingLabTech[labTest.name])
    const rowEditable = canEditResultRow(labTest)
    if (!rowEditable) {
      return (
        <td className="px-3 py-1.5 text-sm text-slate-700 max-w-[200px]">
          <span className="truncate block" title={displayName || undefined}>{displayName || '—'}</span>
        </td>
      )
    }
    if (!canEditResults) {
      return (
        <td className="px-3 py-1.5 text-sm text-slate-600 max-w-[200px]">
          <span className="truncate block text-slate-500" title={displayName || undefined}>{displayName || '—'}</span>
        </td>
      )
    }
    return (
      <td className="px-3 py-1.5 text-sm max-w-[220px] align-top" data-inline-lab-tech-cell onClick={(e) => e.stopPropagation()}>
        {inlineLabTechLabTestName === labTest.name ? (
          <div className="relative z-20" data-inline-lab-tech-popover>
            <input
              type="text"
              value={inlineLabTechQuery}
              onChange={(e) => setInlineLabTechQuery(e.target.value)}
              className="w-full rounded border border-primary px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Search by name…"
              autoFocus
            />
            <div className="absolute left-0 right-0 mt-1 max-h-40 overflow-auto rounded border border-slate-200 bg-white shadow-lg">
              {inlineLabTechOptions.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-slate-500">No matches. Try another name.</div>
              ) : (
                inlineLabTechOptions.map((opt) => (
                  <button
                    key={opt.name}
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 border-b border-slate-50 last:border-0"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleInlineLabTechPick(labTest.name, opt.name, opt.label || opt.name)}
                  >
                    <span className="font-medium text-slate-800">{opt.label || opt.name}</span>
                    {opt.medical_role ? <span className="block text-[10px] text-slate-500">{opt.medical_role}</span> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`w-full text-left rounded-md px-2 py-1 text-xs transition-colors truncate ${
              techPending
                ? 'text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 font-medium'
                : displayName
                  ? 'text-slate-800 font-medium hover:bg-slate-100 border border-transparent'
                  : 'text-slate-500 bg-slate-50 border border-slate-200 hover:bg-slate-100'
            }`}
            title={displayName ? 'Change lab technician for this row' : 'Pick lab technician for this row'}
            onClick={() => {
              setInlineLabTechLabTestName(labTest.name)
              setInlineLabTechQuery(displayName)
            }}
          >
            {displayName || 'Pick lab tech…'}
          </button>
        )}
      </td>
    )
  }

  // Helper: render range cells
  const renderRangeCells = (labTest: LabTest) => (
    <>
      {rangeHeaders.showFemale && (
        <>
          <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.female_min_range != null ? <span className="font-medium">{labTest.female_min_range}</span> : <span className="text-slate-300">—</span>}</td>
          <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.female_max_range != null ? <span className="font-medium">{labTest.female_max_range}</span> : <span className="text-slate-300">—</span>}</td>
        </>
      )}
      {rangeHeaders.showMale && (
        <>
          <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.male_min_range != null ? <span className="font-medium">{labTest.male_min_range}</span> : <span className="text-slate-300">—</span>}</td>
          <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.male_max_range != null ? <span className="font-medium">{labTest.male_max_range}</span> : <span className="text-slate-300">—</span>}</td>
        </>
      )}
      {rangeHeaders.showGeneric && (
        <>
          <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.min_range != null ? <span className="font-medium">{labTest.min_range}</span> : <span className="text-slate-300">—</span>}</td>
          <td className="px-3 py-1.5 text-center text-sm text-slate-700">{labTest.max_range != null ? <span className="font-medium">{labTest.max_range}</span> : <span className="text-slate-300">—</span>}</td>
        </>
      )}
    </>
  )

  // Helper: actions menu for any lab test row
  const renderActionsCell = (labTest: LabTest, isGroupRow = false) => (
    <td className="px-3 py-1.5 text-sm text-slate-700">
      <div className="flex items-center gap-1 flex-wrap">
        {isGroupRow && labTest.service_request && (
          <button type="button" data-no-row-click
            disabled={isGroupedLabRequestFinished(labTest) || finishingGroupKey === labRequestDisplayGroupKey(labTest)}
            onClick={(e) => {
              e.stopPropagation()
              handleFinishGroup(
                labTest.service_request!,
                labRequestDisplayGroupKey(labTest),
                (labTest.lab_test_group || '').trim() || undefined
              )
            }}
            className="px-2 py-1 text-xs rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed">
            {isGroupedLabRequestFinished(labTest)
              ? 'Finished'
              : finishingGroupKey === labRequestDisplayGroupKey(labTest)
                ? 'Finishing…'
                : 'Finish Group'}
          </button>
        )}
        <div className="relative inline-block" ref={openActionRow === labTest.name ? actionMenuRef : undefined}>
          <button type="button"
            onClick={() => setOpenActionRow((prev) => prev === labTest.name ? null : labTest.name)}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            aria-label="Actions">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>
          <PortalActionsMenu open={openActionRow === labTest.name} onClose={() => setOpenActionRow(null)} triggerRef={actionMenuRef} minWidth={160}>
            {!isLegacyHistoryLabRow(labTest) && (
            <button type="button" onClick={() => handleOpenSampleCollection(labTest)}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Sample Collection</button>
            )}
            {canCancelSampleHandlingForLabTest(labTest) && (
              <button
                type="button"
                onClick={() => handleCancelSampleHandlingForLabTest(labTest)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
              >
                Cancel Sample Handling
              </button>
            )}
            {canDeleteRequestedLabTest(labTest) && (
              <button
                type="button"
                onClick={() => handleDeleteRequestedLabTest(labTest)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                Delete Lab Test
              </button>
            )}
            {canEditResults && !resultsReadOnly && (
              <button
                type="button"
                disabled={!canEditResultRow(labTest)}
                onClick={() => {
                  if (!canEditResultRow(labTest)) return
                  setOpenActionRow(null)
                  void openResultDialog(labTest.name)
                }}
                title={
                  canEditResultRow(labTest)
                    ? 'Enter results'
                    : labResultLockReason(labTest, userRole, { nurseLabContext }) ||
                      'Complete sample collection before entering results.'
                }
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
              >
                Enter Results
              </button>
            )}
            {labTest.docstatus === 0 && (
              <button type="button" onClick={() => { setOpenActionRow(null); guardClinicalEdit(() => setEditLabTestName(labTest.name)) }}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Edit</button>
            )}
            {labTest.docstatus === 0 && !labTest.material_request && (
              <button type="button" onClick={() => { setOpenActionRow(null); void openRequestDialog(labTest) }}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Request Consumables</button>
            )}
            <button type="button" onClick={() => openRemarksModal(labTest.name)}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Add Remarks</button>
            {labTest.status === 'Pending Review' && (
              <>
                <div className="border-t border-slate-100 my-1" />
                <button type="button" onClick={() => openReviewModal(labTest.name, 'Reviewed')}
                  className="block w-full text-left px-3 py-2 text-sm text-green-700 font-medium hover:bg-green-50">Review result…</button>
                <button type="button" onClick={() => openReviewModal(labTest.name, 'Rejected')}
                  className="block w-full text-left px-3 py-2 text-sm text-red-600 font-medium hover:bg-red-50">Reject result…</button>
              </>
            )}
          </PortalActionsMenu>
        </div>
        <PrintFormatDropdown doctype="Lab Test" docName={labTest.name} noLetterhead={0} triggerPrint={1} />
      </div>
    </td>
  )

  const slideOverActionBtn =
    'inline-flex items-center rounded-md border border-emerald-200/80 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50'

  const renderSlideOverActions = (labTest: LabTest) => (
    <div className="relative flex shrink-0 flex-wrap items-center gap-1.5 border-b border-emerald-100/80 bg-emerald-50/40 px-4 py-2.5">
      {!isLegacyHistoryLabRow(labTest) && (
        <button
          type="button"
          onClick={() => handleOpenSampleCollection(labTest)}
          className={slideOverActionBtn}
        >
          Sample Collection
        </button>
      )}
      {canCancelSampleHandlingForLabTest(labTest) && (
        <button
          type="button"
          onClick={() => handleCancelSampleHandlingForLabTest(labTest)}
          className={`${slideOverActionBtn} border-amber-200 text-amber-800 hover:bg-amber-50`}
        >
          Cancel Sample Handling
        </button>
      )}
      {canDeleteRequestedLabTest(labTest) && (
        <button
          type="button"
          onClick={() => handleDeleteRequestedLabTest(labTest)}
          className={`${slideOverActionBtn} border-red-200 text-red-700 hover:bg-red-50`}
        >
          Delete Lab Test
        </button>
      )}
      {canEditResults && !resultsReadOnly && (
        <button
          type="button"
          disabled={!canEditResultRow(labTest)}
          onClick={() => {
            if (!canEditResultRow(labTest)) return
            void openResultDialog(labTest.name)
          }}
          title={
            canEditResultRow(labTest)
              ? 'Enter results'
              : labResultLockReason(labTest, userRole, { nurseLabContext }) ||
                'Complete sample collection before entering results.'
          }
          className={slideOverActionBtn}
        >
          Enter Results
        </button>
      )}
      {labTest.docstatus === 0 && (
        <button
          type="button"
          onClick={() => guardClinicalEdit(() => setEditLabTestName(labTest.name))}
          className={slideOverActionBtn}
        >
          Edit
        </button>
      )}
      {labTest.docstatus === 0 && !labTest.material_request && (
        <button
          type="button"
          onClick={() => void openRequestDialog(labTest)}
          className={slideOverActionBtn}
        >
          Request Consumables
        </button>
      )}
      <button
        type="button"
        onClick={() => openRemarksModal(labTest.name)}
        className={slideOverActionBtn}
      >
        Add Remarks
      </button>
      {labTest.status === 'Pending Review' && (
        <>
          <button
            type="button"
            onClick={() => openReviewModal(labTest.name, 'Reviewed')}
            className={`${slideOverActionBtn} border-emerald-300 text-emerald-800 hover:bg-emerald-100`}
          >
            Review result…
          </button>
          <button
            type="button"
            onClick={() => openReviewModal(labTest.name, 'Rejected')}
            className={`${slideOverActionBtn} border-red-200 text-red-700 hover:bg-red-50`}
          >
            Reject result…
          </button>
        </>
      )}
    </div>
  )

  const detailsSlideOverLabTest = selectedLabTestForDetails
    ? displayLabTests.find((lt) => resolveLabTestDocName(lt) === selectedLabTestForDetails) ||
      labTests.find((lt) => resolveLabTestDocName(lt) === selectedLabTestForDetails) ||
      null
    : null

  const handlePrintGroup = async (serviceRequest: string, groupLabel: string, children: LabTest[]) => {
    // The "Lab Test Print" format renders the whole Service Request group when given
    // any member, so open the Frappe print view for the first child.
    const firstChild = children[0]?.name
    if (firstChild) {
      const params = new URLSearchParams({
        doctype: 'Lab Test',
        name: firstChild,
        format: 'Lab Test Print',
        trigger_print: '1',
        no_letterhead: '0',
      })
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      window.open(`${base}/printview?${params.toString()}`, '_blank', 'noopener,noreferrer')
      return
    }

    try {
      const fullTests = await Promise.all(children.map((c) => fetchLabTest(c.name)))
      const issuedOn = new Date().toLocaleString('en-GB')
      const first = fullTests[0]
      const { content: letterHeadContent, footer: letterHeadFooter } = await fetchCostCenterLetterHead((first as any)?.cost_center)
      const rowsHtml = fullTests.map((test) => {
        const normalItems = ((test as any).normal_test_items || []) as any[]
        const descriptiveItems = ((test as any).descriptive_test_items || []) as any[]

        const resultBits: string[] = []
        normalItems.forEach((item) => {
          const main = `${item.result_value ?? ''}${item.lab_test_uom ? ` ${item.lab_test_uom}` : ''}`.trim()
          const range = item.normal_range ? ` (Range: ${item.normal_range})` : ''
          const flag = item.result_status ? ` [${item.result_status}]` : ''
          if (main) resultBits.push(`${main}${range}${flag}`)
        })
        descriptiveItems.forEach((item) => {
          if (item.lab_test_comment) resultBits.push(String(item.lab_test_comment))
        })
        if (!resultBits.length && (test as any).custom_result) {
          resultBits.push(String((test as any).custom_result))
        }
        const combinedResult = resultBits.length ? resultBits.join(' | ') : 'No result entered'

        const resultFlag = (test as any).result_flag || ''
        const flagBadge = resultFlag ? `<span style="display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; ${
          resultFlag === 'Low' || resultFlag === 'Critically Low' ? 'background: #fef9c3; color: #854d0e;' :
          resultFlag === 'High' ? 'background: #fed7aa; color: #9b2c2c;' :
          resultFlag === 'Critically High' ? 'background: #fee2e2; color: #991b1b;' :
          'background: #dcfce7; color: #166534;'
        }">${resultFlag}</span>` : ''

        return `
          <tr>
            <td>${escapeHtml(test.lab_test_name || test.name)}${flagBadge}</td>
            <td>${escapeHtml(combinedResult)}</td>
            <td>${escapeHtml(test.status || 'Draft')}</td>
            <td>${escapeHtml(test.result_date || '')}</td>
          </tr>
        `
      }).join('')

      const html = `
        <html>
          <head>
            <title>Group Lab Test Print</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px 20px 120px; color: #1f2937; }
              h1 { margin: 0; font-size: 20px; color: #1e3a8a; }
              .top { margin-bottom: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
              .meta { font-size: 12px; color: #475569; margin-top: 4px; }
              .letter-head-top { margin-bottom: 10px; }
              .letter-head-footer { margin-top: 20px; }
              .patient-table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; }
              .patient-table td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 12px; }
              .lbl { font-weight: bold; color: #1e3a8a; width: 16%; }
              table { width: 100%; border-collapse: collapse; font-size: 12px; }
              th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
              th { background: #f1f5f9; }
              @media print {
                @page { margin: 16mm 12mm 18mm; }
                body { padding: 0 0 95px 0; }
                .letter-head-footer {
                  position: fixed;
                  left: 0;
                  right: 0;
                  bottom: 0;
                  margin: 0;
                  padding: 6px 12px 0;
                  background: #fff;
                }
              }
            </style>
          </head>
          <body>
            ${letterHeadContent ? `<div class="letter-head-top">${letterHeadContent}</div>` : ''}
            <div class="top">
              <h1>${escapeHtml(groupLabel)} - Group Test Report</h1>
              <div class="meta">Group Reference: ${escapeHtml(serviceRequest)} | Patient: ${escapeHtml(first?.patient_name || '')}</div>
              <div class="meta">Printed On: ${escapeHtml(issuedOn)} | Total Tests: ${fullTests.length}</div>
            </div>

            <table class="patient-table">
              <tr>
                <td class="lbl">Patient Name</td><td>${escapeHtml(first?.patient_name || '')}</td>
                <td class="lbl">Request No.</td><td>${escapeHtml(serviceRequest)}</td>
              </tr>
              <tr>
                <td class="lbl">Patient File No.</td><td>${escapeHtml(first?.patient || '')}</td>
                <td class="lbl">Date</td><td>${escapeHtml(first?.result_date || '')}</td>
              </tr>
              <tr>
                <td class="lbl">Referred Doctor</td><td>${escapeHtml(first?.practitioner_name || first?.practitioner || '')}</td>
                <td class="lbl">Visit No.</td><td>${escapeHtml(first?.service_request || '')}</td>
              </tr>
              <tr>
                <td class="lbl">IP Admission</td><td>${escapeHtml(first?.inpatient_admission || first?.inpatient_record || '')}</td>
                <td class="lbl">User</td><td>${escapeHtml((first as any)?.custom_user || '')}</td>
              </tr>
            </table>

            <table>
              <thead>
                <tr><th>Test Item</th><th>Result / Observation</th><th>Status</th><th>Result Date</th></tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="4">No tests found in this group.</td></tr>'}
              </tbody>
            </table>
            ${letterHeadFooter ? `<div class="letter-head-footer">${letterHeadFooter}</div>` : ''}
          </body>
        </html>
      `

      const win = window.open('', '_blank', 'width=1200,height=900')
      if (!win) return
      win.document.open()
      win.document.write(html)
      win.document.close()
      win.focus()
      win.print()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to print group tests')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-w-full flex-1 min-h-0 h-full">
      <ConfirmActionModal
        open={showAssessmentExportModal}
        title="Lab Result Assessment Report"
        subtitle="Choose the date range to include in the report."
        tone="primary"
        loading={exportingPdf}
        confirmLabel="Download PDF"
        onClose={() => {
          if (!exportingPdf) setShowAssessmentExportModal(false)
        }}
        onConfirm={confirmAssessmentExport}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              From Date <span className="text-red-500">*</span>
            </label>
            <DateFilterInput
              value={assessmentExportFrom}
              onChange={(e) => setAssessmentExportFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              To Date <span className="text-red-500">*</span>
            </label>
            <DateFilterInput
              value={assessmentExportTo}
              onChange={(e) => setAssessmentExportTo(e.target.value)}
            />
          </div>
        </div>
      </ConfirmActionModal>

      {inDashboardCard && headerSlot ? createPortal(downloadButton, headerSlot) : null}

      {/* Header row */}
      {!inDashboardCard && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 px-4 py-2.5">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {!statusTabs ? (
              <FilterToggleButton
                active={Boolean(showFilters)}
                onClick={() => setShowFiltersInternal((prev) => !prev)}
              />
            ) : null}
            {headerExtra}
            {downloadButton}
            {onAdd ? (
              <button
                type="button"
                onClick={onAdd}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-white transition-colors hover:bg-primary/90"
                title={addButtonTitle}
              >
                +
              </button>
            ) : null}
          </div>
        </div>
      )}

      {statusTabs && (() => {
        const tabs = (
          <div
            className={
              inDashboardCard
                ? 'flex flex-wrap items-center gap-1'
                : 'flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-1 pb-2 pt-1'
            }
          >
            {LAB_STATUS_TABS.map((tab) => {
              const active = (filters.status || '') === tab.status
              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => selectStatusTab(tab.status)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
            <FilterToggleButton
              active={Boolean(showFilters)}
              onClick={() => setShowFiltersInternal((prev) => !prev)}
            />
          </div>
        )
        if (inDashboardCard) {
          return leadingSlot ? createPortal(tabs, leadingSlot) : null
        }
        return tabs
      })()}

      {inDashboardCard && !statusTabs && ownsFilterToggle && leadingSlot
        ? createPortal(
            <FilterToggleButton
              active={Boolean(showFilters)}
              onClick={() => setShowFiltersInternal((prev) => !prev)}
            />,
            leadingSlot
          )
        : null}

      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onClear={handleClearFilters}
          activeCount={activeCount}
          byNurse={byNurse}
          outsourced={isOutsourced === true}
        />
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
      {!defaultsReady || loading ? (
        <div className="flex items-center justify-center p-8"><div className="text-slate-600">Loading lab tests...</div></div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center p-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl w-full">
            <h3 className="text-red-800 font-semibold mb-2">Error Loading Lab Tests</h3>
            <p className="text-red-700 text-sm mb-2">{error.message}</p>
            <button onClick={() => refetch()} className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700">Retry</button>
          </div>
        </div>
      ) : labTests.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400">
          <Search className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">{activeCount > 0 ? 'NO LAB TESTS MATCH THE CURRENT FILTERS.' : 'NO LAB TESTS FOUND.'}</p>
          {activeCount > 0 ? (
            <ClearFiltersButton className="mt-3 self-center" onClick={handleClearFilters} />
          ) : null}
        </div>
      ) : useDoctorCompactCard ? (
        <LabTestDashboardCardTable
          labTests={displayLabTests}
          variant="doctor"
          onOpen={(name) => setSelectedLabTestForDetails(name)}
          onOpenTrends={onOpenLabTrends}
          resolveDocName={resolveLabTestDocName}
          onReview={(name) => openReviewModal(name, 'Reviewed')}
          onReviewGroup={({ serviceRequest, groupLabel, children }) =>
            openBulkReviewModal(serviceRequest, groupLabel, children)
          }
        />
      ) : useCompactCardTable ? (
        <LabTestDashboardCardTable
          labTests={displayLabTests}
          onOpen={(name) => setSelectedLabTestForDetails(name)}
          onOpenTrends={onOpenLabTrends}
          resolveDocName={resolveLabTestDocName}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px]">
            <thead className="lab-list-head bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={`${LAB_LIST_TH} text-left`}>Date</th>
                {!patient && (
                  <th className={`${LAB_LIST_TH} text-left`}>File No.</th>
                )}
                {!patient && (
                  <th className={`${LAB_LIST_TH} text-left max-w-[11rem] w-[11rem]`}>Patient Name</th>
                )}
                <th className={`${LAB_LIST_TH} text-left`}>Test</th>
                <th className={`${LAB_LIST_TH} text-left`}>Results</th>
                {rangeHeaders.showFemale && (
                  <>
                    <th className={LAB_LIST_TH_CENTER}>F-Min</th>
                    <th className={LAB_LIST_TH_CENTER}>F-Max</th>
                  </>
                )}
                {rangeHeaders.showMale && (
                  <>
                    <th className={LAB_LIST_TH_CENTER}>M-Min</th>
                    <th className={LAB_LIST_TH_CENTER}>M-Max</th>
                  </>
                )}
                {rangeHeaders.showGeneric && (
                  <>
                    <th className={LAB_LIST_TH_CENTER}>Min</th>
                    <th className={LAB_LIST_TH_CENTER}>Max</th>
                  </>
                )}
                <th className={`${LAB_LIST_TH} text-left`}>Result Flag</th>
                <th className={`${LAB_LIST_TH_CENTER} px-2 w-10`} title="Result trend">↑↓</th>
                <th className={`${LAB_LIST_TH} text-left`}>Lab technician</th>
                <th className={`${LAB_LIST_TH} text-left max-w-[11rem] w-[11rem]`}>Doctor</th>
                <th className={`${LAB_LIST_TH} text-left`}>Outsourced</th>
                {!hideAmount && <th className={LAB_LIST_TH_RIGHT}>Amount</th>}
                <th className={`${LAB_LIST_TH} text-left`}>Status</th>
                <th className={`${LAB_LIST_TH} text-left`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">

              {displayRows.map((row) => {
                if (row.kind === 'group') {
                const { serviceRequest, children, groupKey, labTestGroup } = row
                const isExpanded = !!expandedGroupKeys[groupKey]
                const representativeChild = children[0]
                // Show the test group's NAME (e.g. "Lipid Profile"), resolved from the
                // group code (lab_test_group like LAB-004) by the backend — not the child test names.
                const groupLabel =
                  representativeChild.lab_test_group_name ||
                  representativeChild.lab_test_group ||
                  'Group'
                const practitioner = representativeChild.practitioner_name || representativeChild.practitioner || '-'
                const combinedAmount = children.reduce((sum, c) => sum + (typeof c.grand_total === 'number' ? c.grand_total : typeof c.amount === 'number' ? c.amount : 0), 0)
                const latestDate = children.reduce((latest, c) => {
                  const d = c.result_date || c.submitted_date || ''
                  return d > latest ? d : latest
                }, '')
                
                const groupStatus = getGroupCompletionStatus(children)
                const groupFinished = isGroupedLabRequestFinished(representativeChild)

                return (
                  <Fragment key={`group-${groupKey}`}>
                    <tr
                      className="bg-indigo-50 hover:bg-indigo-100 border-l-4 border-indigo-400 cursor-pointer"
                      title="Click to record sample collection for this group"
                      onClick={(e) => {
                        const el = e.target as HTMLElement
                        if (el.closest('[data-no-row-click]')) return
                        if (el.closest('button, a, input, select, textarea, label')) return
                        const allCollected = children.every((c) => isLabTestSampleCollectionDone(c))
                        if (allCollected) return
                        const sampleTarget =
                          children.find(
                            (c) => canRecordAdHocSampleCollection(c) && !isLabTestSampleCollectionDone(c)
                          ) ||
                          children.find((c) => canRecordAdHocSampleCollection(c)) ||
                          representativeChild
                        if (sampleTarget) {
                          handleOpenSampleCollection(sampleTarget, {
                            children,
                            label: groupLabel,
                            serviceRequest,
                            labTestGroup,
                          })
                        }
                      }}
                    >
                      {/* Date */}
                      <td className="px-3 py-1.5 text-sm text-slate-700">{latestDate ? new Date(latestDate).toLocaleDateString('en-GB') : '-'}</td>
                      {/* File No */}
                      {!patient && (
                        <td className="px-3 py-1.5 text-sm text-slate-600">{representativeChild.file_no || '-'}</td>
                      )}
                      {/* Patient Name */}
                      {!patient && (
                        <td
                          className="px-3 py-1.5 text-sm text-slate-700 cursor-pointer max-w-[11rem] w-[11rem]"
                          data-no-row-click
                          onClick={(e) => {
                            e.stopPropagation()
                            representativeChild.patient && onPatientClick?.(representativeChild.patient)
                          }}
                        >
                          <span
                            className="font-medium text-primary hover:underline line-clamp-2 break-words"
                            title={representativeChild.patient_name || undefined}
                          >
                            {representativeChild.patient_name || '-'}
                          </span>
                        </td>
                      )}
                      {/* Test (group) */}
                      <td className="px-3 py-1.5 text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-200 text-indigo-700 shrink-0">GROUP</span>
                          <button
                            type="button"
                            data-no-row-click
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedGroupKeys((prev) => ({ ...prev, [groupKey]: !isExpanded }))
                            }}
                            className="inline-flex items-center justify-center p-0.5 rounded text-indigo-700 hover:bg-indigo-200/60"
                            title={isExpanded ? 'Collapse group' : 'Expand group'}
                            aria-label={isExpanded ? 'Collapse group' : 'Expand group'}
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                          </button>
                          {onOpenLabTrends ? (
                            <button
                              type="button"
                              data-no-row-click
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenLabTrends(groupLabel)
                              }}
                              className="text-indigo-700 font-semibold hover:underline text-left"
                              title={`Open lab trends for ${groupLabel}`}
                            >
                              {groupLabel}
                            </button>
                          ) : (
                            <span className="text-indigo-700 font-semibold">{groupLabel}</span>
                          )}
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700" title={`${children.length} test${children.length === 1 ? '' : 's'}`}>{children.length}</span>
                        </div>
                       </td>
                      {/* Results */}
                      <td className="px-3 py-1.5 text-xs text-indigo-400 italic">— group —</td>
                      {/* Min / Max */}
                      {rangeHeaders.showFemale && <><td /><td /></>}
                      {rangeHeaders.showMale && <><td /><td /></>}
                      {rangeHeaders.showGeneric && <><td /><td /></>}
                      {/* Result Flag */}
                      <td className="px-3 py-1.5"><span className="text-xs text-slate-400">—</span></td>
                      {/* Result Trend */}
                      <td className="px-3 py-1.5"><span className="text-xs text-slate-400">—</span></td>
                      {/* Lab technician */}
                      <td className="px-3 py-1.5"><span className="text-xs text-slate-400">—</span></td>
                      {/* Doctor */}
                      <td className="px-3 py-1.5 text-sm text-slate-700 max-w-[11rem] w-[11rem]">
                        <span className="line-clamp-2 break-words" title={practitioner !== '-' ? practitioner : undefined}>
                          {practitioner}
                        </span>
                      </td>
                      {/* Outsourced */}
                      <td className="px-3 py-1.5"><span className="text-slate-400 text-xs">—</span></td>
                      {/* Amount */}
                      {!hideAmount && <td className="px-3 py-1.5 text-sm font-semibold text-indigo-700 text-right">{combinedAmount > 0 ? combinedAmount.toFixed(3) : '-'}</td>}
                      {/* Status */}
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                            groupStatus.status === 'Complete' ? 'bg-green-100 text-green-700' :
                            groupStatus.status === 'Partially Complete' ? 'bg-blue-100 text-blue-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            <span>{groupStatus.icon}</span>
                            <span>{groupStatus.status}</span>
                            <span className="font-normal opacity-80">
                              ({children.filter(labTestHasResultsEntered).length}/{children.length})
                            </span>
                          </span>
                          {groupFinished && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">
                              Finished
                            </span>
                          )}
                        </div>
                       </td>
                      {/* Actions */}
                      <td className="px-3 py-1.5 text-sm text-slate-700" data-no-row-click onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button type="button" data-no-row-click
                            disabled={groupFinished || groupStatus.status !== 'Complete' || finishingGroupKey === groupKey}
                            onClick={(e) => { e.stopPropagation(); handleFinishGroup(serviceRequest, groupKey, labTestGroup) }}
                            className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                              !groupFinished && groupStatus.status === 'Complete'
                                ? 'border-emerald-600 text-emerald-700 hover:bg-emerald-50'
                                : 'border-slate-300 text-slate-400 cursor-not-allowed'
                            }`}
                            title={
                              groupFinished
                                ? 'This grouped request is already finished'
                                : groupStatus.status === 'Complete'
                                  ? 'Finish this grouped request'
                                  : 'All tests must have results entered first'
                            }>
                            {groupFinished ? 'Finished' : finishingGroupKey === groupKey ? 'Finishing…' : 'Finish Group'}
                          </button>
                          <button
                            type="button"
                            data-no-row-click
                            onClick={(e) => {
                              e.stopPropagation()
                              void handlePrintGroup(serviceRequest, groupLabel, children)
                            }}
                            className="px-2 py-1 text-xs rounded-md border border-primary text-primary hover:bg-primary/5"
                            title="Print all tests under this group"
                          >
                            Print Group
                          </button>
                          {children.some((child) => child.status === 'Pending Review') && (
                            <button
                              type="button"
                              data-no-row-click
                              onClick={(e) => {
                                e.stopPropagation()
                                openBulkReviewModal(serviceRequest, groupLabel, children)
                              }}
                              className="px-2 py-1 text-xs rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                              title="Review all pending tests in this group with one note"
                            >
                              Review
                            </button>
                          )}
                        </div>
                       </td>
                    </tr>

                    {isExpanded && children.map((child) => (
                      <tr key={child.name} className="bg-indigo-50/30 hover:bg-indigo-50">
                        {/* Date */}
                        <td className="px-3 py-1.5 text-sm text-slate-700">
                          {(() => {
                            const d = labTestReportDate(child)
                            return d ? new Date(d).toLocaleDateString('en-GB') : '-'
                          })()}
                        </td>
                        {/* File No */}
                        {!patient && (
                          <td className="px-3 py-1.5 text-sm text-slate-500">{child.file_no || '-'}</td>
                        )}
                        {/* Patient Name */}
                        {!patient && (
                          <td
                            className="px-3 py-1.5 text-sm text-slate-500 cursor-pointer max-w-[11rem] w-[11rem]"
                            onClick={() => child.patient && onPatientClick?.(child.patient)}
                          >
                            <span
                              className="font-medium text-primary hover:underline line-clamp-2 break-words"
                              title={child.patient_name || child.patient || undefined}
                            >
                              {child.patient_name || child.patient || '-'}
                            </span>
                          </td>
                        )}
                        {/* Test */}
                        <td
                          className="px-3 py-1.5 text-sm text-slate-700 pl-6 cursor-pointer hover:text-indigo-600"
                          onClick={(e) => {
                            e.stopPropagation()
                            const testLabel = (child.lab_test_name || child.template || '').trim()
                            if (onOpenLabTrends && testLabel) {
                              onOpenLabTrends(testLabel)
                              return
                            }
                            setSelectedLabTestForDetails(child.name)
                          }}
                        >
                          <span className="text-slate-400 mr-1">↳</span>{child.lab_test_name || child.template || '-'}
                        </td>
                        {/* Results */}
                        {renderResultCell(child)}
                        {/* Min / Max */}
                        {renderRangeCells(child)}
                        {/* Result Flag */}
                        {renderResultFlagCell(child)}
                        {/* Result Trend */}
                        {renderResultArrowCell(child)}
                        {/* Lab technician */}
                        {renderTechnicianCell(child)}
                        {/* Doctor */}
                        <td className="px-3 py-1.5 text-sm text-slate-700 max-w-[11rem] w-[11rem]">
                          <span
                            className="line-clamp-2 break-words"
                            title={child.practitioner_name || child.practitioner || undefined}
                          >
                            {child.practitioner_name || child.practitioner || '-'}
                          </span>
                        </td>
                        {/* Outsourced */}
                        <td className="px-3 py-1.5">
                          {child.is_outsourced
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Outsourced</span>
                            : <span className="text-slate-400 text-xs">—</span>}
                        </td>
                        {/* Amount */}
                        {!hideAmount && <td className="px-3 py-1.5 text-sm text-slate-700 text-right">
                          {typeof child.grand_total === 'number' ? child.grand_total.toFixed(3) : typeof child.amount === 'number' ? child.amount.toFixed(3) : '-'}
                        </td>}
                        {/* Status */}
                        <td className="px-3 py-1.5"><StatusPill status={statusDisplayLabel(child.status || 'Draft')} color={statusColors[child.status || 'Draft'] || 'default'} /></td>
                        {/* Actions */}
                        {renderActionsCell(child)}
                      </tr>
                    ))}
                  </Fragment>
                )
                }
                const labTest = row.labTest
                const detailsName = resolveLabTestDocName(labTest)
                const isFocusedRow = Boolean(
                  focusLabTest &&
                    (detailsName === focusLabTest || labTest.name === focusLabTest),
                )
                return (
                <tr
                  key={labTest.name}
                  id={`lab-test-row-${detailsName}`}
                  className={
                    isLegacyHistoryLabRow(labTest)
                      ? `hover:bg-slate-50 bg-amber-50/30${isFocusedRow ? ' ring-2 ring-inset ring-primary' : ''}`
                      : `hover:bg-slate-50${isFocusedRow ? ' bg-primary/5 ring-2 ring-inset ring-primary' : ''}`
                  }
                >
                  {/* Date */}
                  <td className="px-3 py-1.5 text-sm text-slate-700">
                    {(() => {
                      const d = labTestReportDate(labTest)
                      return d ? new Date(d).toLocaleDateString('en-GB') : '-'
                    })()}
                  </td>
                  {/* File No */}
                  {!patient && (
                    <td className="px-3 py-1.5 text-sm text-slate-700">{labTest.file_no || '-'}</td>
                  )}
                  {/* Patient Name */}
                  {!patient && (
                    <td
                      className="px-3 py-1.5 text-sm text-slate-700 cursor-pointer max-w-[11rem] w-[11rem]"
                      onClick={() => labTest.patient && onPatientClick?.(labTest.patient)}
                    >
                      <span
                        className="font-medium text-primary hover:underline line-clamp-2 break-words"
                        title={labTest.patient_name || labTest.patient || undefined}
                      >
                        {labTest.patient_name || labTest.patient || '-'}
                      </span>
                    </td>
                  )}
                  {/* Test */}
                  <td
                    className="px-3 py-1.5 text-sm text-slate-700 cursor-pointer hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      const testLabel = (labTest.lab_test_name || labTest.template || '').trim()
                      if (onOpenLabTrends && testLabel) {
                        onOpenLabTrends(testLabel)
                        return
                      }
                      setSelectedLabTestForDetails(detailsName)
                    }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isLegacyHistoryLabRow(labTest) && (
                        <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          History
                        </span>
                      )}
                      <span className="truncate font-medium">{labTest.lab_test_name || labTest.template || '-'}</span>
                    </div>
                    {isLegacyHistoryLabRow(labTest) && labTest.lab_test_group && (
                      <span className="text-[10px] font-normal text-slate-500">{labTest.lab_test_group}</span>
                    )}
                  </td>
                  {/* Results */}
                  {renderResultCell(labTest)}
                  {/* Min / Max */}
                  {renderRangeCells(labTest)}
                  {/* Result Flag */}
                  {renderResultFlagCell(labTest)}
                  {/* Result Trend */}
                  {renderResultArrowCell(labTest)}
                  {/* Lab technician */}
                  {renderTechnicianCell(labTest)}
                  {/* Doctor */}
                  <td className="px-3 py-1.5 text-sm text-slate-700 max-w-[11rem] w-[11rem]">
                    <span
                      className="line-clamp-2 break-words"
                      title={labTest.practitioner_name || labTest.practitioner || undefined}
                    >
                      {labTest.practitioner_name || labTest.practitioner || '-'}
                    </span>
                  </td>
                  {/* Outsourced */}
                  <td className="px-3 py-1.5">
                    {labTest.is_outsourced
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Outsourced</span>
                      : <span className="text-slate-400 text-xs">—</span>}
                  </td>
                  {/* Amount */}
                  {!hideAmount && <td className="px-3 py-1.5 text-sm text-slate-700 text-right">
                    {typeof labTest.grand_total === 'number' ? labTest.grand_total.toFixed(3) : typeof labTest.amount === 'number' ? labTest.amount.toFixed(3) : '-'}
                  </td>}
                  {/* Status */}
                  <td className="px-3 py-1.5"><StatusPill status={statusDisplayLabel(labTest.status || 'Draft')} color={statusColors[labTest.status || 'Draft'] || 'default'} /></td>
                  {/* Actions */}
                  {renderActionsCell(labTest)}
                </tr>
                )
              })}

            </tbody>
          </table>
        </div>
      )}
        </div>

      {preferLoadMore ? (
        <LoadMoreControls
          loadedCount={labTests.length}
          totalCount={totalCount}
          pageSize={pageSize}
          loading={loading}
          onLoadMore={() => setPage((p) => p + 1)}
        />
      ) : (
        <PaginationControls
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
        />
      )}

      </div>

      {/* ── Lab Test Details slide-over ── */}
      {selectedLabTestForDetails && (
        <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={() => setSelectedLabTestForDetails(null)}>
          <div className="absolute inset-0 bg-primary/15 backdrop-blur-[2px]" />
          <div
            className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-emerald-200/60 bg-white shadow-2xl shadow-emerald-900/10 ring-1 ring-emerald-100/80"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex shrink-0 items-center justify-between border-b border-emerald-100/80 bg-gradient-to-r from-emerald-100 via-teal-50 to-sky-100 px-6 py-4">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.15),transparent_55%)]" />
              <div className="relative min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-800/70">Lab Test Details</p>
                <p className="truncate text-sm font-semibold text-emerald-950">
                  {detailsSlideOverLabTest?.lab_test_name || selectedLabTestForDetails}
                </p>
              </div>
              <div className="relative flex items-center gap-2">
                <PrintFormatDropdown doctype="Lab Test" docName={selectedLabTestForDetails} noLetterhead={0} triggerPrint={1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200/80 bg-white text-primary shadow-sm hover:bg-emerald-50" />
                <button type="button" onClick={() => setSelectedLabTestForDetails(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-800/70 transition hover:bg-emerald-200/50 hover:text-emerald-950" aria-label="Close">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {detailsSlideOverLabTest ? renderSlideOverActions(detailsSlideOverLabTest) : null}
            <div className="flex-1 overflow-y-auto bg-gradient-to-b from-emerald-50/30 via-white to-teal-50/20 p-6">
              <LabTestDetails labTestName={selectedLabTestForDetails} onUpdate={() => refetch()} />
            </div>
          </div>
        </div>
      )}


      {sampleModalLabTest && (
        <LabTestSampleCollectionModal
          labTest={sampleModalLabTest}
          groupChildren={sampleModalGroup?.children}
          groupLabel={sampleModalGroup?.label}
          groupServiceRequest={sampleModalGroup?.serviceRequest}
          groupLabTestGroup={sampleModalGroup?.labTestGroup}
          loading={sampleModalLoading}
          error={sampleModalError}
          onClose={resetSampleModalState}
          onSaved={refetch}
        />
      )}

      {/* ── Remarks modal ── */}
      {remarksModalOpen && remarksLabTestName && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-slate-900">Doctor's Remarks — {remarksLabTestName}</h2>
              <button type="button" onClick={closeRemarksModal} disabled={remarksLoading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {remarksError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{remarksError}</div>}
              <p className="text-sm text-slate-500">Add one or more remarks.</p>
              {remarksList.map((row, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white">
                    <span className="text-xs font-medium text-slate-500">Remark #{idx + 1}</span>
                    <button type="button" onClick={() => removeRemarksRow(idx)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50" disabled={remarksList.length <= 1}><X className="w-4 h-4" /></button>
                  </div>
                  <div className="p-3">
                    <textarea value={row.rrmark} onChange={(e) => updateRemarksRow(idx, e.target.value)} placeholder="Enter remark..." rows={3}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" disabled={remarksLoading} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addRemarksRow} className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"><span>+</span> Add another remark</button>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-2 flex-shrink-0 bg-white">
              <button type="button" onClick={closeRemarksModal} disabled={remarksLoading} className="px-3 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50 text-slate-700">Cancel</button>
              <button type="button" onClick={handleSubmitRemarks} disabled={remarksLoading} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50">{remarksLoading ? 'Saving…' : 'Save remarks'}</button>
            </div>
          </div>
        </div>
      )}

      {requestingFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Request Consumables for {requestingFor}</h2>
              <button type="button" onClick={closeRequestDialog} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-4 space-y-3">
              {dialogError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{dialogError}</div>}
              <IsMedicalSelect value={dialogIsMedical} onChange={setDialogIsMedical} compact />
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-slate-200 rounded-md">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Item Code</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Item Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Qty</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Warehouse</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {dialogItems.map((row, index) => (
                      <tr key={index} className="border-t border-slate-200">
                        <td className="px-3 py-2">
                          <div className="relative">
                            <input type="text" value={row.item_code} onChange={(e) => { updateItem(index, 'item_code', e.target.value); setOpenItemIndex(index) }} onFocus={() => setOpenItemIndex(index)}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Select item..." />
                            {openItemIndex === index && itemOptions.length > 0 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                {itemOptions.filter((opt) => (opt.label || opt.name).toLowerCase().includes((row.item_code || '').toLowerCase())).slice(0, 20).map((opt) => (
                                  <button key={opt.name} type="button" className="w-full text-left px-3 py-1 text-xs hover:bg-slate-100"
                                    onClick={() => { updateItem(index, 'item_code', opt.name); updateItem(index, 'item_name', opt.label || opt.name); setOpenItemIndex(null) }}>{opt.label || opt.name}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2"><input type="text" value={row.item_name || ''} onChange={(e) => updateItem(index, 'item_name', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Item name" /></td>
                        <td className="px-3 py-2"><input type="number" min={0} step={0.01} value={row.qty} onChange={(e) => updateItem(index, 'qty', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" /></td>
                        <td className="px-3 py-2">
                          <div className="relative">
                            <input type="text" value={row.warehouse || ''} onChange={(e) => { updateItem(index, 'warehouse', e.target.value); setOpenWarehouseIndex(index) }} onFocus={() => setOpenWarehouseIndex(index)}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Select warehouse..." />
                            {openWarehouseIndex === index && warehouseOptions.length > 0 && (
                              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                {warehouseOptions.filter((opt) => (opt.label || opt.name).toLowerCase().includes((row.warehouse || '').toLowerCase())).slice(0, 20).map((opt) => (
                                  <button key={opt.name} type="button" className="w-full text-left px-3 py-1 text-xs hover:bg-slate-100"
                                    onClick={() => { updateItem(index, 'warehouse', opt.name); setOpenWarehouseIndex(null) }}>{opt.label || opt.name}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right"><button type="button" onClick={() => removeRow(index)} className="text-xs text-red-600 hover:text-red-800">Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center pt-2">
                <button type="button" onClick={addRow} className="px-3 py-1 text-xs border border-slate-300 rounded-md hover:bg-slate-50">+ Add Row</button>
                <div className="flex gap-2">
                  <button type="button" onClick={closeRequestDialog} disabled={dialogLoading} className="px-3 py-1 text-xs border border-slate-300 rounded-md hover:bg-slate-50">Cancel</button>
                  <button type="button" onClick={submitRequest} disabled={dialogLoading || !isMedicalChoiceRequired(dialogIsMedical)} className="px-3 py-1 text-xs bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50">{dialogLoading ? 'Submitting...' : 'Create Material Request'}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Results dialog ── */}
      {resultDialogOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-slate-900">Enter Results {activeLabTest?.name ? `for ${activeLabTest.name}` : ''}</h2>
              <button type="button" onClick={closeResultDialog} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="flex border-b border-slate-200 px-4 flex-shrink-0">
              {(['results', 'documents'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setResultDialogTab(tab)}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${resultDialogTab === tab ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  {tab === 'documents' ? `Documents${resultDocuments.length > 0 ? ` (${resultDocuments.length})` : ''}` : 'Results'}
                </button>
              ))}
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-4">
              {resultDialogError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{resultDialogError}</div>}
              {resultDialogLoading ? <div className="text-sm text-slate-600">Loading...</div>
              : resultDialogTab === 'results' ? (
                <>
                  <div className="relative rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3" data-no-row-click onClick={(e) => e.stopPropagation()}>
                    <label className="block text-sm font-semibold text-slate-800 mb-0.5">
                      Lab technician <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <p className="text-xs text-slate-500 mb-2">
                      Lab Technologist or Lab Technician. Required only when the test is submitted after doctor review.
                    </p>
                    <div className="relative max-w-md">
                      <input
                        type="text"
                        value={labTechnician ? (labTechnicianQuery || labTechnician) : labTechnicianQuery}
                        onChange={(e) => {
                          setLabTechnician('')
                          setLabTechnicianQuery(e.target.value)
                          setLabTechnicianOpen(true)
                        }}
                        onFocus={() => setLabTechnicianOpen(true)}
                        placeholder="Search by name…"
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {labTechnicianOpen && (
                        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                          {labTechnicianOptions.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-slate-500">No matches. Try another search or create practitioners with the correct Medical Role.</div>
                          ) : (
                            labTechnicianOptions.map((opt) => (
                              <button
                                key={opt.name}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 border-b border-slate-50 last:border-0"
                                onClick={() => {
                                  setLabTechnician(opt.name)
                                  setLabTechnicianQuery(opt.label || opt.name)
                                  setLabTechnicianOpen(false)
                                }}
                              >
                                <span className="font-medium text-slate-800">{opt.label || opt.name}</span>
                                {opt.medical_role && (
                                  <span className="block text-[11px] text-slate-500 mt-0.5">Role: {opt.medical_role}</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {normalTestItems.length > 0 && !(templateDetails.is_multiple && !showMultipleUnitResults) && (
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-2">
                        {showMultipleUnitResults ? 'Multiple Unit Results' : 'Test Results'}
                      </label>
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">
                                {showMultipleUnitResults ? 'Unit' : 'Test / Event'}
                              </th>
                              <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 w-24">Min</th>
                              <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 w-24">Max</th>
                              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 w-36">Result</th>
                              {showMultipleUnitResults ? (
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 w-48">Status</th>
                              ) : null}
                              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Comment</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {normalTestItems.map((row, idx) => {
                              const result = parseFloat(row.result_value || '')
                              // Per-row reference range: the row's own normal_range (panels),
                              // else the patient's gendered range, else the template range.
                              const { min, max } = effectiveRowRange(row, templateDetails, activeLabTest?.patient_sex || activeLabTest?.gender)
                              const hasResult = row.result_value !== '' && row.result_value != null && !isNaN(result)
                              const isLowResult =
                                hasResult && !row.uses_status_bands && min != null && result < min
                              const isHighResult =
                                hasResult && !row.uses_status_bands && max != null && result > max
                              const statusOptions = templateDetails.status_options || []
                              const isMultiple = showMultipleUnitResults
                              const statusMark = isMultiple ? (row.result_status || '') : ''
                              return (
                                <tr
                                  key={idx}
                                  className={
                                    isLowResult
                                      ? 'bg-yellow-50'
                                      : isHighResult
                                        ? 'bg-red-50'
                                        : 'hover:bg-slate-50/50'
                                  }
                                >
                                  <td className="px-3 py-3">
                                    <div className="text-sm font-medium text-slate-800">{row.lab_test_event || row.lab_test_name || '—'}</div>
                                    {row.lab_test_uom && <div className="text-[11px] text-slate-400 mt-0.5">{row.lab_test_uom}</div>}
                                  </td>
                                  <td className="px-3 py-3 text-center"><span className={`text-sm font-medium ${min != null ? 'text-slate-700' : 'text-slate-300'}`}>{min != null ? min : '—'}</span></td>
                                  <td className="px-3 py-3 text-center"><span className={`text-sm font-medium ${max != null ? 'text-slate-700' : 'text-slate-300'}`}>{max != null ? max : '—'}</span></td>
                                  <td className="px-3 py-3">
                                    <input type="number" step="any" value={row.result_value ?? ''}
                                      onChange={(e) => {
                                        const v = e.target.value
                                        setNormalTestItems((prev) => {
                                          const next = [...prev]
                                          const updated: NormalTestResultRow = { ...next[idx], result_value: v }
                                          if (isMultiple) {
                                            if (updated.uses_status_bands && statusOptions.length) {
                                              // nmol/L-style: Deficiency / Insufficiency / …
                                              updated.result_status = suggestMultipleResultStatus(v, statusOptions)
                                            } else {
                                              // Other units: High / Low / Normal from min/max
                                              const range = effectiveRowRange(
                                                updated,
                                                templateDetails,
                                                activeLabTest?.patient_sex || activeLabTest?.gender,
                                              )
                                              updated.result_status = highLowMarkFromRange(v, range.min, range.max)
                                            }
                                          }
                                          next[idx] = updated
                                          return next
                                        })
                                      }}
                                      className={`w-full border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${
                                        isLowResult
                                          ? 'border-yellow-400 bg-yellow-50 text-yellow-900 focus:ring-yellow-300'
                                          : isHighResult
                                            ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300'
                                            : 'border-slate-300'
                                      }`}
                                      placeholder="0.00" />
                                    {isLowResult && (
                                      <div className="text-[10px] text-yellow-800 mt-0.5 font-medium">⚠ Low (below range)</div>
                                    )}
                                    {isHighResult && (
                                      <div className="text-[10px] text-red-600 mt-0.5 font-medium">⚠ High (above range)</div>
                                    )}
                                  </td>
                                  {isMultiple ? (
                                    <td className="px-3 py-3">
                                      {statusMark ? (
                                        <span
                                          className={`inline-flex max-w-full rounded-md border px-2 py-1 text-xs font-semibold ${multipleStatusMarkClass(statusMark)}`}
                                          title={row.uses_status_bands ? 'Status band mark' : 'High / Low from range'}
                                        >
                                          {statusMark}
                                        </span>
                                      ) : (
                                        <span className="text-slate-300 text-sm">—</span>
                                      )}
                                    </td>
                                  ) : null}
                                  <td className="px-3 py-3">
                                    <input type="text" value={row.lab_test_comment || ''}
                                      onChange={(e) => { const v = e.target.value; setNormalTestItems((prev) => { const next = [...prev]; next[idx] = { ...next[idx], lab_test_comment: v }; return next }) }}
                                      className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Add comment..." />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {!(showMultipleUnitResults && normalTestItems.length > 0) && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Result</label>
                    <textarea className="w-full border border-slate-300 rounded-md p-2 text-sm min-h-[80px]" value={customResult} onChange={(e) => setCustomResult(e.target.value)} placeholder="Enter descriptive or custom result..." />
                  </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">General Comments</label>
                    <textarea className="w-full border border-slate-300 rounded-md p-2 text-sm min-h-[70px]" value={labComment} onChange={(e) => setLabComment(e.target.value)} placeholder="Overall test comments..." />
                  </div>
                  {(worksheetText || templateDetails.worksheet_instructions) && (
                    <div className="rounded-md border border-amber-200 bg-amber-50">
                      <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors" onClick={() => setWorksheetExpanded((v) => !v)}>
                        <span>📋 Worksheet Instructions</span>
                        <span className="text-xs text-amber-600">{worksheetExpanded ? '▲ Hide' : '▼ Show'}</span>
                      </button>
                      {worksheetExpanded && (
                        <div className="px-3 pb-3">
                          <textarea className="w-full border border-amber-300 rounded-md p-2 text-sm bg-white min-h-[80px]" value={worksheetText} onChange={(e) => setWorksheetText(e.target.value)} placeholder="Worksheet instructions..." />
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">Attach lab documents (reports, scans).</p>
                  {resultDocuments.length === 0 && <div className="text-center py-6 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-sm">No documents. Click below to add one.</div>}
                  {resultDocuments.map((row, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label className="block text-xs font-medium text-slate-600 mb-0.5">File Name</label><input value={row.file_name || ''} onChange={(e) => updateResultDocumentRow(idx, 'file_name', e.target.value)} placeholder="File name" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" /></div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-0.5">Document Type</label>
                        <DocumentTypeSelect
                          value={row.document_type || ''}
                          onChange={(v) => updateResultDocumentRow(idx, 'document_type', v)}
                          types={resultDocumentTypes}
                          onTypesUpdated={setResultDocumentTypes}
                        />
                      </div>
                      <div><label className="block text-xs font-medium text-slate-600 mb-0.5">Transaction No</label><input value={row.transaction_no || ''} onChange={(e) => updateResultDocumentRow(idx, 'transaction_no', e.target.value)} placeholder="Optional" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" /></div>
                      <div><label className="block text-xs font-medium text-slate-600 mb-0.5">Upload Remarks</label><input value={row.upload_remarks || ''} onChange={(e) => updateResultDocumentRow(idx, 'upload_remarks', e.target.value)} placeholder="Optional" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" /></div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-0.5">File</label>
                        <input type="file" disabled={resultDocumentUploading === idx} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResultDocumentFile(idx, f); e.target.value = '' }} className="w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-white file:text-sm" />
                        {resultDocumentUploading === idx && <span className="text-xs text-slate-500">Uploading...</span>}
                        {row.document && resultDocumentUploading !== idx && <span className="text-xs text-green-600 block">✓ File attached</span>}
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addResultDocumentRow} className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"><span>+</span> Add document</button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-slate-200 flex-shrink-0 bg-white">
              <button type="button" onClick={closeResultDialog} disabled={resultDialogLoading} className="px-3 py-1 text-sm border border-slate-300 rounded-md hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSubmitLabTestWithResults} disabled={resultDialogLoading} className="px-3 py-1 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50">Save Results</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Lab Test modal ── */}
      {editLabTestName && (
        <EditLabTestModal labTestName={editLabTestName} onClose={() => setEditLabTestName(null)}
          onSuccess={() => { setEditLabTestName(null); refetch() }} />
      )}

      {reviewModal && (
        <LabTestReviewModal
          labTestName={reviewModal.name}
          bulkTests={reviewModal.bulk?.tests}
          groupLabel={reviewModal.bulk?.groupLabel}
          serviceRequest={reviewModal.bulk?.serviceRequest}
          initialOutcome={reviewModal.outcome}
          onClose={() => setReviewModal(null)}
          onSuccess={() => {
            setReviewModal(null)
            refetch()
          }}
        />
      )}

      <ConfirmActionModal
        open={!!sampleCancelLabTest}
        title="Cancel sample handling?"
        subtitle={sampleCancelLabTest?.name}
        icon={<AlertTriangle className="h-5 w-5" />}
        tone="warning"
        loading={sampleCancelLoading}
        confirmLabel="Cancel sample handling"
        onClose={() => {
          if (!sampleCancelLoading) setSampleCancelLabTest(null)
        }}
        onConfirm={() => void confirmCancelSampleHandling()}
      >
        <p className="text-sm leading-relaxed text-slate-600">
          Linked sample collection records will be reversed. The lab test itself is not deleted.
        </p>
      </ConfirmActionModal>

      <ConfirmActionModal
        open={!!deleteLabTestTarget}
        title="Delete lab test?"
        subtitle={deleteLabTestTarget?.name}
        icon={<Trash2 className="h-5 w-5" />}
        tone="danger"
        loading={deleteLabTestLoading}
        confirmLabel="Delete permanently"
        cancelLabel="Keep test"
        onClose={() => {
          if (!deleteLabTestLoading) setDeleteLabTestTarget(null)
        }}
        onConfirm={() => void confirmDeleteRequestedLabTest()}
      >
        <div className="rounded-xl border border-red-200/80 bg-red-50/80 px-4 py-3 text-sm text-red-900">
          This lab test is in <span className="font-semibold">Requested</span> status and will be permanently
          removed. This cannot be undone.
        </div>
        {deleteLabTestTarget?.service_request ? (
          <p className="text-sm leading-relaxed text-slate-600">
            If this is the only test on lab request{' '}
            <span className="font-semibold text-slate-800">{deleteLabTestTarget.service_request}</span>, the lab
            request and linked billing will also be removed. Patient credit is recorded only when payment was
            actually received for the order.
          </p>
        ) : null}
      </ConfirmActionModal>
    </div>
  )
}