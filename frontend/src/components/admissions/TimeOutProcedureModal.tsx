import { useState, useRef, useCallback, useEffect } from 'react'
import { apiRequest } from '../../services/apiClient'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { uploadPatientFile } from '../../services/patients'
import { fetchDoc, fetchHealthcarePractitioners, fetchPatientVisits, fetchPatientOptions, fetchInpatientAdmissionOptions, getCurrentUserPractitioner, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { PenLine, Trash2, Check, ChevronDown, Plus, AlertCircle , ClipboardList } from 'lucide-react'

import { CM_BTN_CANCEL, CM_BTN_PRIMARY, CREATE_MODAL_BODY_GRADIENT, CREATE_MODAL_FOOTER_STICKY, CREATE_MODAL_OVERLAY, CreateModalHeader, createModalShellClass, createModalTabButtonClass } from '../ui/CreateModalChrome'
import { parseToDatetimeLocalValue, toDatetimeLocalValue } from '../../utils/datetimeLocal'
import { localDateInputValue } from '../../utils/formatDate'
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

  const endDraw = () => { isDrawing.current = false }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    onClear?.()
  }

  const saveSignature = () => {
    canvasRef.current?.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `timeout_signature_${Date.now()}.png`, { type: 'image/png' })
      onSave(file)
      setMode('done')
    }, 'image/png')
  }

  useEffect(() => {
    if (mode !== 'drawing') return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * window.devicePixelRatio
    canvas.height = rect.height * window.devicePixelRatio
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    setHasStrokes(false)
  }, [mode])

  if (mode === 'idle') {
    return (
      <button type="button" onClick={() => setMode('drawing')}
        className="w-full min-h-[96px] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-green-400 hover:text-green-600 hover:bg-green-50/50 transition-all group">
        <PenLine className="w-5 h-5 group-hover:scale-110 transition-transform" />
        <span className="text-xs font-medium">Click to add signature</span>
      </button>
    )
  }

  if (mode === 'done' && existingUrl) {
    return (
      <div className="w-full min-h-[96px] flex flex-col items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
        <img src={existingUrl} alt="Signature" className="max-h-20 object-contain" />
        <button type="button" onClick={() => { setMode('drawing'); clearCanvas() }}
          className="text-xs text-slate-500 hover:text-red-500 flex items-center gap-1 transition-colors">
          <Trash2 className="w-3 h-3" /> Re-sign
        </button>
      </div>
    )
  }

  return (
    <div className="w-full rounded-lg border border-slate-300 bg-white overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
          <PenLine className="w-3 h-3" /> Draw signature
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={clearCanvas} disabled={!hasStrokes}
            className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-30 flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors">
            <Trash2 className="w-3 h-3" /> Clear
          </button>
          <button type="button" onClick={() => { setMode('idle'); clearCanvas() }}
            className="text-xs text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors">
            Cancel
          </button>
        </div>
      </div>
      <div className="relative" style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef}
          style={{ width: '100%', height: '120px', display: 'block', cursor: 'crosshair' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 pointer-events-none select-none">
            Sign here
          </span>
        )}
      </div>
      <div className="px-2.5 py-2 border-t border-slate-100 flex justify-end">
        <button type="button" onClick={saveSignature} disabled={!hasStrokes || uploading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {uploading
            ? <span className="flex items-center gap-1"><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</span>
            : <><Check className="w-3 h-3" /> Save Signature</>}
        </button>
      </div>
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
}

const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder, required }: LinkComboboxProps) => {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<LinkFieldOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      setLoading(true)
      try { setOptions(await fetchOptions(query)) }
      catch { setOptions([]) }
      finally { setLoading(false) }
    }, query.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [query, open, fetchOptions])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const lc = 'block text-xs font-semibold text-slate-600 mb-1'
  const ic = 'w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

  return (
    <div ref={containerRef} className="relative">
      <label className={lc}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="relative">
        <input type="text" value={query}
          onChange={e => { setQuery(e.target.value); onClear(); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? 'Search...'}
          className={ic} autoComplete="off" />
        <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
          {loading
            ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
          {options.length === 0
            ? <div className="px-3 py-2 text-xs text-slate-400">{loading ? 'Searching…' : 'NO RESULTS FOUND'}</div>
            : options.map(opt => (
              <button key={opt.name} type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 focus:outline-none"
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

interface TimeOutProcedureModalProps {
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

interface ProcedureRow {
  _key: string
  criteria: string
  selection: '' | 'Yes' | 'No' | 'N/A'
}

interface FormState {
  date: string
  patient_visit: string
  time_out_time: string
  procedure_start_time: string
  nurse: string
  nurse_name: string
  sign_time: string
}

type TabId = 'general' | 'procedures' | 'signature'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'procedures', label: 'Procedure Details' },
  { id: 'signature', label: 'Signature' },
]

const nowDate = () => localDateInputValue()
const nowTime = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}
const nowDatetime = () => toDatetimeLocalValue()

const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
const sectionTitleClass = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

// ─── Main Modal ───────────────────────────────────────────────────────────────

export const TimeOutProcedureModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName,
  onClose,
  onSuccess,
}: TimeOutProcedureModalProps) => {
  const isEdit = Boolean(editName?.trim())
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [form, setFormState] = useState<FormState>({
    date: nowDate(),
    patient_visit: '',
    time_out_time: nowDatetime(),
    procedure_start_time: nowTime(),
    nurse: '',
    nurse_name: '',  // auto-filled from the logged-in nurse below
    sign_time: nowTime(),
  })
  const [procedures, setProcedures] = useState<ProcedureRow[]>([])
  const [signatureUrl, setSignatureUrl] = useState('')
  const [signatureUploading, setSignatureUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)

  // Link field display labels
  const [patientVisitLabel, setPatientVisitLabel] = useState('')
  const [nurseLabel, setNurseLabel] = useState('')
  const [templateLabel, setTemplateLabel] = useState('')
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const [currentAdmission, setCurrentAdmission] = useState(admissionNo)
  const [currentPatient, setCurrentPatient] = useState(patient)
  const [currentPatientName, setCurrentPatientName] = useState(patientName || '')
  const isLockedContext = Boolean(admissionNo) || isEdit

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('Time Out Procedure', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setCurrentAdmission(String(doc.inpatient_admission || doc.admission || ''))
        setCurrentPatient(String(doc.patient || ''))
        setCurrentPatientName(String(doc.patient_name || ''))
        const visit = String(doc.patient_visit || '')
        setFormState((prev) => ({
          ...prev,
          date: toDateInput(doc.date as string) || prev.date,
          patient_visit: visit,
          time_out_time: doc.time_out_time ? parseToDatetimeLocalValue(String(doc.time_out_time)) : prev.time_out_time,
          procedure_start_time: String(doc.procedure_start_time || prev.procedure_start_time),
          nurse: String(doc.nurse || prev.nurse),
          nurse_name: String(doc.nurse_name || prev.nurse_name),
          sign_time: String(doc.sign_time || prev.sign_time),
        }))
        setPatientVisitLabel(visit)
        const tpl = String(doc.template || '')
        setTemplateName(tpl)
        setTemplateLabel(tpl)
        if (doc.nurse) setNurseLabel(String(doc.nurse_name || doc.nurse))
        const sig = doc.signature
        if (typeof sig === 'string' && sig.trim()) setSignatureUrl(sig.trim())
        const procRows: Record<string, unknown>[] = Array.isArray(doc.procedures) ? doc.procedures : []
        setProcedures(
          procRows.map((r) => ({
            _key: Math.random().toString(36).slice(2),
            criteria: String(r.criteria ?? ''),
            selection: (String(r.selection ?? '') as '' | 'Yes' | 'No' | 'N/A'),
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

  const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
  const fetchAdmissionOpts = useCallback(
    (s: string) => fetchInpatientAdmissionOptions(s || undefined, currentPatient || undefined),
    [currentPatient]
  )

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setFormState(prev => ({ ...prev, [k]: v }))

  // Staff nurse defaults to the logged-in user's linked practitioner.
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
      setFormState(prev => {
        if (prev.nurse || prev.nurse_name) return prev
        return { ...prev, nurse: practId, nurse_name: label }
      })
      setNurseLabel((prevLabel) => prevLabel || label)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const fetchPractitioners = useCallback(
    (search: string) => fetchHealthcarePractitioners(search || undefined),
    []
  )
  const fetchVisits = useCallback(
    (search: string) => fetchPatientVisits(currentPatient, search || undefined),
    [currentPatient]
  )

  const fetchTemplates = useCallback(async (search: string): Promise<LinkFieldOption[]> => {
    try {
      const params = new URLSearchParams({
        doctype: 'Time Out Procedure Template',
        fields: JSON.stringify(['name', 'template_name', 'default']),
        filters: search.trim()
          ? JSON.stringify([['template_name', 'like', `%${search.trim()}%`]])
          : JSON.stringify([]),
        limit_page_length: '20',
        order_by: 'modified desc',
      })
      const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
      const data = await res.json()
      const rows = Array.isArray(data?.message) ? data.message : []
      return rows.map((r: { name: string; template_name?: string }) => ({
        name: r.name,
        label: r.template_name || r.name,
      }))
    } catch {
      return []
    }
  }, [])

  const applyTemplate = useCallback(async (opt: LinkFieldOption, { silent = false } = {}) => {
    setTemplateName(opt.name)
    setTemplateLabel(opt.label)
    setTemplateLoading(true)
    try {
      const res = await fetch(`/api/resource/Time%20Out%20Procedure%20Template/${encodeURIComponent(opt.name)}`)
      const data = await res.json()
      const doc = data?.data ?? data?.message
      const rows: { criteria?: string }[] = Array.isArray(doc?.procedures) ? doc.procedures : []
      setProcedures(rows.map((r) => ({
        _key: Math.random().toString(36).slice(2),
        criteria: r.criteria ?? '',
        selection: '' as const,
      })))
      if (!silent) {
        toast.success(`Loaded ${rows.length} item${rows.length !== 1 ? 's' : ''} from template.`)
      }
    } catch {
      toast.error('Failed to load template procedures.')
    } finally {
      setTemplateLoading(false)
    }
  }, [])

  const handleTemplateSelect = async (opt: LinkFieldOption) => {
    await applyTemplate(opt)
  }

  useEffect(() => {
    if (isEdit) return
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams({
          doctype: 'Time Out Procedure Template',
          fields: JSON.stringify(['name', 'template_name', 'default']),
          filters: JSON.stringify([['default', '=', 1]]),
          limit_page_length: '1',
          order_by: 'modified desc',
        })
        const res = await fetch(`/api/method/frappe.client.get_list?${params}`)
        const data = await res.json()
        const rows = Array.isArray(data?.message) ? data.message : []
        const tpl = rows[0] as { name?: string; template_name?: string } | undefined
        if (cancelled || !tpl?.name) return
        await applyTemplate(
          { name: tpl.name, label: tpl.template_name || tpl.name },
          { silent: true }
        )
      } catch {
        /* no default template */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyTemplate, isEdit])

  const addRow = () => setProcedures(prev => [...prev, { _key: Math.random().toString(36).slice(2), criteria: '', selection: '' }])
  const removeRow = (key: string) => setProcedures(prev => prev.filter(r => r._key !== key))
  const updateRow = (key: string, field: 'criteria' | 'selection', value: string) =>
    setProcedures(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))

  const handleSignatureSave = async (file: File) => {
    setSignatureUploading(true)
    try {
      const url = await uploadPatientFile(file)
      setSignatureUrl(url)
      toast.success('Signature saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signature upload failed.')
    } finally {
      setSignatureUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSubmitting(true)
    try {
      const payload = {
        inpatient_admission: currentAdmission,
        patient: currentPatient,
        patient_name: currentPatientName,
        date: form.date || undefined,
        patient_visit: form.patient_visit || undefined,
        template: templateName || undefined,
        time_out_time: form.time_out_time || undefined,
        procedure_start_time: form.procedure_start_time || undefined,
        nurse: form.nurse || undefined,
        nurse_name: form.nurse_name || undefined,
        signature: signatureUrl || undefined,
        procedures: procedures.map(({ _key: _unused, ...rest }) => rest),
      }
      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('Time Out Procedure', editName.trim(), payload)
        toast.success('Time Out Procedure updated.')
      } else {
        await apiRequest('/api/resource/Time%20Out%20Procedure', {
          method: 'POST',
          body: JSON.stringify({ data: payload }),
        })
        toast.success('Time Out Procedure saved successfully.')
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
  const unansweredCount = procedures.filter(r => !r.selection).length

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('w-full max-w-3xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isEdit ? 'Edit Time-Out Procedure' : 'Time-Out Procedure'}
          icon={<ClipboardList className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          subtitle={<>{patientName ? `${patientName} · ` : ''}{admissionNo}</>}
          onClose={onClose}
        >
          <div className="-mb-px mt-3 flex border-b border-emerald-100/80">
            {TABS.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`${createModalTabButtonClass(activeTab === tab.id)} flex items-center gap-1.5`}>
                {tab.label}
                {tab.id === 'procedures' && procedures.length > 0 ? (
                  <span className={`inline-flex items-center justify-center min-w-[18px] rounded-full px-1 py-0.5 text-[10px] font-bold ${unansweredCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {procedures.length}
                  </span>
                ) : null}
                {tab.id === 'signature' && signatureUrl ? (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </CreateModalHeader>

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
                  <h3 className={sectionTitleClass}>Basic Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {isLockedContext ? (
                      <div>
                        <label className={labelClass}>Inpatient Admission</label>
                        <input type="text" value={currentAdmission} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
                      </div>
                    ) : (
                      <LinkCombobox
                        label="Inpatient Admission"
                        value={currentAdmission}
                        onSelect={opt => setCurrentAdmission(opt.name)}
                        onClear={() => setCurrentAdmission('')}
                        fetchOptions={fetchAdmissionOpts}
                        placeholder="Search admissions..."
                      />
                    )}
                    <LinkCombobox
                      label="Patient Visit"
                      value={patientVisitLabel}
                      onSelect={opt => { setField('patient_visit', opt.name); setPatientVisitLabel(opt.label) }}
                      onClear={() => { setField('patient_visit', ''); setPatientVisitLabel('') }}
                      fetchOptions={fetchVisits}
                      placeholder="Search patient visits..."
                    />
                    {isLockedContext ? (
                      <div>
                        <label className={labelClass}>Patient</label>
                        <input type="text" value={currentPatient} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
                      </div>
                    ) : (
                      <LinkCombobox
                        label="Patient"
                        value={currentPatientName || currentPatient}
                        onSelect={opt => { setCurrentPatient(opt.name); setCurrentPatientName(opt.label) }}
                        onClear={() => { setCurrentPatient(''); setCurrentPatientName('') }}
                        fetchOptions={fetchPatientOpts}
                        placeholder="Search patients..."
                      />
                    )}
                    <div>
                      <label className={labelClass}>Patient Name</label>
                      <input type="text" value={currentPatientName} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
                    </div>
                    <div>
                      <label className={labelClass}>Date</label>
                      <DateFilterInput value={form.date} onChange={e => setField('date', e.target.value)} className={inputClass} />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className={sectionTitleClass}>Template</h3>
                  <p className="text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    Select a template to automatically populate the procedure checklist. If a template is marked Default, it is loaded when you open this form.
                  </p>
                  <div className="relative">
                    <LinkCombobox
                      label="Template"
                      value={templateLabel}
                      onSelect={handleTemplateSelect}
                      onClear={() => { setTemplateName(''); setTemplateLabel('') }}
                      fetchOptions={fetchTemplates}
                      placeholder="Search templates..."
                    />
                    {templateLoading && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-primary">
                        <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        Loading template procedures…
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className={sectionTitleClass}>Timing</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Time Out Time</label>
                      <input
                        type="datetime-local"
                        value={form.time_out_time}
                        onChange={e => setField('time_out_time', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Procedure Start Time</label>
                      <input
                        type="time"
                        step="1"
                        value={form.procedure_start_time}
                        onChange={e => setField('procedure_start_time', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className={sectionTitleClass}>Nurse</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <LinkCombobox
                      label="Nurse"
                      value={nurseLabel}
                      onSelect={opt => { setField('nurse', opt.name); setField('nurse_name', opt.label); setNurseLabel(opt.label) }}
                      onClear={() => { setField('nurse', ''); setField('nurse_name', ''); setNurseLabel('') }}
                      fetchOptions={fetchPractitioners}
                      placeholder="Search doctors..."
                    />
                    <div>
                      <label className={labelClass}>Nurse Name</label>
                      <input
                        type="text"
                        value={form.nurse_name}
                        onChange={e => setField('nurse_name', e.target.value)}
                        placeholder="Auto-filled on selection..."
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab 2: Procedure Details ── */}
            {activeTab === 'procedures' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className={sectionTitleClass}>Procedure Checklist</h3>
                    {unansweredCount > 0 && (
                      <p className="text-xs text-amber-600 flex items-center gap-1 -mt-2 mb-2">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {unansweredCount} item{unansweredCount !== 1 ? 's' : ''} without a selection
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={addRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-md hover:bg-primary/90 transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </button>
                </div>

                {procedures.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                    <p className="text-sm text-slate-500 mb-1">NO PROCEDURE ITEMS YET.</p>
                    <p className="text-xs text-slate-400 mb-4">Select a template on the General tab, or add items manually.</p>
                    <button type="button" onClick={addRow}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/5 transition-colors">
                      <Plus className="w-4 h-4" /> Add First Item
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_auto_auto] bg-slate-50 border-b border-slate-200 px-3 py-2 gap-3">
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Criteria</span>
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide w-36 text-center">Selection</span>
                      <span className="w-7" />
                    </div>

                    <div className="divide-y divide-slate-100">
                      {procedures.map((row, idx) => (
                        <div key={row._key} className="grid grid-cols-[1fr_auto_auto] items-center px-3 py-2 gap-3 group hover:bg-slate-50">
                          {/* Criteria */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-mono w-5 shrink-0">{idx + 1}</span>
                            <input
                              type="text"
                              value={row.criteria}
                              onChange={e => updateRow(row._key, 'criteria', e.target.value)}
                              placeholder="Describe the criterion..."
                              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                            />
                          </div>

                          {/* Selection buttons */}
                          <div className="flex gap-1 w-36">
                            {(['Yes', 'No', 'N/A'] as const).map(opt => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => updateRow(row._key, 'selection', row.selection === opt ? '' : opt)}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded transition-colors ${
                                  row.selection === opt
                                    ? opt === 'Yes'
                                      ? 'bg-green-600 text-white'
                                      : opt === 'No'
                                        ? 'bg-red-600 text-white'
                                        : 'bg-slate-500 text-white'
                                    : 'border border-slate-300 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
                                }`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>

                          {/* Remove */}
                          <button type="button" onClick={() => removeRow(row._key)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {procedures.length > 0 && (
                  <div className="mt-3 flex gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-green-600 inline-block" />
                      Yes: {procedures.filter(r => r.selection === 'Yes').length}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" />
                      No: {procedures.filter(r => r.selection === 'No').length}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-slate-500 inline-block" />
                      N/A: {procedures.filter(r => r.selection === 'N/A').length}
                    </span>
                    <span className="flex items-center gap-1 text-amber-600">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-200 border border-amber-400 inline-block" />
                      Unanswered: {unansweredCount}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 3: Signature ── */}
            {activeTab === 'signature' && (
              <div className="space-y-6">
                <div>
                  <h3 className={sectionTitleClass}>Signature</h3>
                  <p className="text-xs text-slate-500 mb-4 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    Draw the authorising signature below. The sign time defaults to now.
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <div>
                      <label className={labelClass}>Date of Signing</label>
                      <DateFilterInput value={form.date} onChange={e => setField('date', e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Time of Signing</label>
                      <input type="time" step="1" value={form.sign_time} onChange={e => setField('sign_time', e.target.value)} className={inputClass} />
                      <p className="text-xs text-slate-400 mt-1">Defaults to the current time.</p>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Signature</label>
                    <SignaturePad
                      onSave={handleSignatureSave}
                      onClear={() => setSignatureUrl('')}
                      existingUrl={signatureUrl || undefined}
                      uploading={signatureUploading}
                    />
                    {signatureUrl && (
                      <p className="text-xs text-green-600 flex items-center gap-1 mt-2">
                        <Check className="w-3.5 h-3.5" /> Signature captured and ready to save with record.
                      </p>
                    )}
                  </div>
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
              <button type="submit" disabled={submitting || loadingEdit} className={CM_BTN_PRIMARY}>
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Record'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
