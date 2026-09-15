import { useState, useRef, useCallback, useEffect } from 'react'
import { apiRequest } from '../../services/apiClient'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { uploadPatientFile } from '../../services/patients'
import { fetchDoc, fetchHealthcarePractitioners, fetchPatientVisits, fetchPatientOptions, fetchInpatientAdmissionOptions, getCurrentUserPractitioner, type LinkFieldOption } from '../../services/common'
import { toast } from '../../hooks/useToast'
import { PenLine, Trash2, Check, ChevronDown, Plus, AlertCircle , ClipboardList } from 'lucide-react'

import { CM_BTN_CANCEL, CM_BTN_PRIMARY, CREATE_MODAL_BODY_GRADIENT, CREATE_MODAL_FOOTER_STICKY, CREATE_MODAL_OVERLAY, CreateModalHeader, createModalShellClass, createModalTabButtonClass } from '../ui/CreateModalChrome'
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
      const file = new File([blob], `pre_ect_signature_${Date.now()}.png`, { type: 'image/png' })
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
}

const LinkCombobox = ({ label, value, onSelect, onClear, fetchOptions, placeholder }: LinkComboboxProps) => {
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
      <label className={lc}>{label}</label>
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

interface PreEctChecklistModalProps {
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
  if (s.includes('T')) return (s.split('T')[1] || '').slice(0, 8)
  if (s.length === 5) return `${s}:00`
  return s.slice(0, 8)
}

interface ChecklistRow {
  _key: string
  checklist: string
  answer: '' | 'Yes' | 'No' | 'N/A'
  remarks: string
}

interface FormState {
  patient_visit: string
  date: string
  time: string
  staff_nurse: string
  nurse_name: string
  sign_time: string
}

type TabId = 'general' | 'checklist' | 'signature'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'signature', label: 'Signature' },
]

const nowDate = () => new Date().toISOString().split('T')[0]
const nowTime = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
const sectionTitleClass = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

// ─── Main Modal ───────────────────────────────────────────────────────────────

export const PreEctChecklistModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName,
  onClose,
  onSuccess,
}: PreEctChecklistModalProps) => {
  const isEdit = Boolean(editName?.trim())
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [form, setFormState] = useState<FormState>({
    patient_visit: '',
    date: nowDate(),
    time: nowTime(),
    staff_nurse: '',
    nurse_name: '',
    sign_time: nowTime(),
  })
  const [checklist, setChecklist] = useState<ChecklistRow[]>([])
  const [signatureUrl, setSignatureUrl] = useState('')
  const [signatureUploading, setSignatureUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)

  // Link display labels
  const [patientVisitLabel, setPatientVisitLabel] = useState('')
  const [nurseLabel, setNurseLabel] = useState('')
  const [templateLabel, setTemplateLabel] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateLoading, setTemplateLoading] = useState(false)

  const [currentAdmission, setCurrentAdmission] = useState(admissionNo)
  const [currentPatient, setCurrentPatient] = useState(patient)
  const [currentPatientName, setCurrentPatientName] = useState(patientName || '')
  const isLockedContext = Boolean(admissionNo) || isEdit

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('Pre-ECT Checklist', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setCurrentAdmission(String(doc.inpatient_admission || doc.admission || ''))
        setCurrentPatient(String(doc.patient || ''))
        setCurrentPatientName(String(doc.patient_name || ''))
        const visit = String(doc.patient_visit || '')
        setFormState((prev) => ({
          ...prev,
          patient_visit: visit,
          date: toDateInput(doc.date as string) || prev.date,
          time: toTimeInput(doc.time as string) || prev.time,
          staff_nurse: String(doc.staff_nurse || prev.staff_nurse),
          nurse_name: String(doc.nurse_name || prev.nurse_name),
          sign_time: toTimeInput(doc.sign_time as string) || prev.sign_time,
        }))
        setPatientVisitLabel(visit)
        if (doc.staff_nurse) setNurseLabel(String(doc.nurse_name || doc.staff_nurse))
        const sig = doc.signature
        if (typeof sig === 'string' && sig.trim()) setSignatureUrl(sig.trim())
        const tpl = String(doc.template || '')
        setTemplateName(tpl)
        setTemplateLabel(tpl)
        const rows: Record<string, unknown>[] = Array.isArray(doc.checklist) ? doc.checklist : []
        setChecklist(
          rows.map((r) => ({
            _key: Math.random().toString(36).slice(2),
            checklist: String(r.checklist ?? ''),
            answer: (String(r.answer ?? '') as '' | 'Yes' | 'No' | 'N/A'),
            remarks: String(r.remarks ?? ''),
          }))
        )
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load checklist')
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
        if (prev.staff_nurse || prev.nurse_name) return prev
        return { ...prev, staff_nurse: practId, nurse_name: label }
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

  // Fetch Pre-ECT Checklist Templates
  const fetchTemplates = useCallback(async (search: string): Promise<LinkFieldOption[]> => {
    try {
      const params = new URLSearchParams({
        doctype: 'Pre-ECT Checklist Template',
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
      return rows.map((r: { name: string; template_name?: string; default?: number }) => ({
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
      const res = await fetch(
        `/api/resource/Pre-ECT%20Checklist%20Template/${encodeURIComponent(opt.name)}`
      )
      const data = await res.json()
      const doc = data?.data ?? data?.message
      const rows: { checklist?: string; remarks?: string }[] = Array.isArray(doc?.checklist)
        ? doc.checklist
        : []
      setChecklist(
        rows.map((r) => ({
          _key: Math.random().toString(36).slice(2),
          checklist: r.checklist ?? '',
          answer: '' as const,
          remarks: r.remarks ?? '',
        }))
      )
      if (!silent) {
        toast.success(`Loaded ${rows.length} item${rows.length !== 1 ? 's' : ''} from template.`)
      }
    } catch {
      toast.error('Failed to load template checklist.')
    } finally {
      setTemplateLoading(false)
    }
  }, [])

  // On template select: fetch its checklist rows and populate child table
  const handleTemplateSelect = async (opt: LinkFieldOption) => {
    await applyTemplate(opt)
  }

  // If a template is marked Default, load it when creating a new checklist.
  useEffect(() => {
    if (isEdit) return
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams({
          doctype: 'Pre-ECT Checklist Template',
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

  const addRow = () =>
    setChecklist(prev => [...prev, { _key: Math.random().toString(36).slice(2), checklist: '', answer: '', remarks: '' }])

  const removeRow = (key: string) =>
    setChecklist(prev => prev.filter(r => r._key !== key))

  const updateRow = (key: string, field: keyof Omit<ChecklistRow, '_key'>, value: string) =>
    setChecklist(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))

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
        patient: currentPatient || undefined,
        patient_visit: form.patient_visit || undefined,
        date: form.date || undefined,
        time: form.time || undefined,
        staff_nurse: form.staff_nurse || undefined,
        nurse_name: form.nurse_name || undefined,
        signature: signatureUrl || undefined,
        checklist: checklist.map(({ _key: _unused, ...rest }) => rest),
      }
      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('Pre-ECT Checklist', editName.trim(), payload)
        toast.success('Pre-ECT Checklist updated.')
      } else {
        await apiRequest('/api/resource/Pre-ECT%20Checklist', {
          method: 'POST',
          body: JSON.stringify({ data: payload }),
        })
        toast.success('Pre-ECT Checklist saved successfully.')
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save checklist.')
    } finally {
      setSubmitting(false)
    }
  }

  const currentTabIdx = TABS.findIndex(t => t.id === activeTab)
  const unansweredCount = checklist.filter(r => !r.answer).length

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('w-full max-w-3xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isEdit ? 'Edit Pre-ECT Checklist' : 'Pre-ECT Checklist'}
          icon={<ClipboardList className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          subtitle={<>{patientName ? `${patientName} · ` : ''}{admissionNo}</>}
          onClose={onClose}
        >
          <div className="-mb-px mt-3 flex border-b border-emerald-100/80">
            {TABS.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`${createModalTabButtonClass(activeTab === tab.id)} flex items-center gap-1.5`}>
                {tab.label}
                {tab.id === 'checklist' && checklist.length > 0 ? (
                  <span className={`inline-flex items-center justify-center min-w-[18px] rounded-full px-1 py-0.5 text-[10px] font-bold ${unansweredCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {checklist.length}
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
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">Loading checklist…</div>
            ) : (
            <>
            {/* ── Tab 1: General ── */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Basic Info */}
                <div>
                  <h3 className={sectionTitleClass}>Basic Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {isLockedContext ? (
                      <div>
                        <label className={labelClass}>Patient</label>
                        <input type="text" value={currentPatient} readOnly
                          className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
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
                    {isLockedContext ? (
                      <div>
                        <label className={labelClass}>Inpatient Admission</label>
                        <input type="text" value={currentAdmission} readOnly
                          className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
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
                    <div>
                      <label className={labelClass}>Date</label>
                      <DateFilterInput value={form.date} onChange={e => setField('date', e.target.value)}
                        className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Time</label>
                      <input type="time" step="1" value={form.time} onChange={e => setField('time', e.target.value)}
                        className={inputClass} />
                    </div>
                  </div>
                </div>

                {/* Staff Nurse */}
                <div>
                  <h3 className={sectionTitleClass}>Staff Nurse</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <LinkCombobox
                      label="Staff Nurse"
                      value={nurseLabel}
                      onSelect={opt => {
                        setField('staff_nurse', opt.name)
                        setField('nurse_name', opt.label)
                        setNurseLabel(opt.label)
                      }}
                      onClear={() => {
                        setField('staff_nurse', '')
                        setField('nurse_name', '')
                        setNurseLabel('')
                      }}
                      fetchOptions={fetchPractitioners}
                      placeholder="Search doctors..."
                    />
                    <div>
                      <label className={labelClass}>Nurse Name</label>
                      <input type="text" value={form.nurse_name}
                        onChange={e => setField('nurse_name', e.target.value)}
                        placeholder="Auto-filled on selection..."
                        className={inputClass} />
                    </div>
                  </div>
                </div>

                {/* Template */}
                <div>
                  <h3 className={sectionTitleClass}>Template</h3>
                  <p className="text-xs text-slate-500 mb-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    Select a template to automatically populate the checklist. If a template is marked Default, it is loaded when you open this form.
                  </p>
                  <LinkCombobox
                    label="Checklist Template"
                    value={templateLabel}
                    onSelect={handleTemplateSelect}
                    onClear={() => { setTemplateName(''); setTemplateLabel('') }}
                    fetchOptions={fetchTemplates}
                    placeholder="Search templates..."
                  />
                  {templateLoading && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-primary">
                      <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      Loading template checklist…
                    </div>
                  )}
                  {templateName && !templateLoading && checklist.length > 0 && (
                    <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      {checklist.length} item{checklist.length !== 1 ? 's' : ''} loaded — go to Checklist tab to fill answers.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab 2: Checklist ── */}
            {activeTab === 'checklist' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className={sectionTitleClass}>Pre-ECT Checklist</h3>
                    {unansweredCount > 0 && (
                      <p className="text-xs text-amber-600 flex items-center gap-1 -mt-2 mb-2">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {unansweredCount} item{unansweredCount !== 1 ? 's' : ''} without an answer
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={addRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-md hover:bg-primary/90 transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </button>
                </div>

                {checklist.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                    <p className="text-sm text-slate-500 mb-1">NO CHECKLIST ITEMS YET.</p>
                    <p className="text-xs text-slate-400 mb-4">Select a template on the General tab, or add items manually.</p>
                    <button type="button" onClick={addRow}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/5 transition-colors">
                      <Plus className="w-4 h-4" /> Add First Item
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {checklist.map((row, idx) => (
                      <div key={row._key}
                        className="rounded-lg border border-slate-200 bg-white p-3 group hover:border-slate-300 transition-colors">
                        <div className="flex items-start gap-3">
                          {/* Row number */}
                          <span className="text-xs text-slate-400 font-mono w-5 pt-2 shrink-0">{idx + 1}</span>

                          {/* Content column */}
                          <div className="flex-1 space-y-2">
                            {/* Checklist text */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                Checklist Item
                              </label>
                              <textarea
                                rows={2}
                                value={row.checklist}
                                onChange={e => updateRow(row._key, 'checklist', e.target.value)}
                                placeholder="Describe the checklist item..."
                                className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-white resize-none"
                              />
                            </div>

                            {/* Answer + Remarks row */}
                            <div className="flex gap-3 items-start">
                              {/* Yes / No / N/A toggle buttons */}
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                  Answer
                                </label>
                                <div className="flex gap-1">
                                  {(['Yes', 'No', 'N/A'] as const).map(opt => (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => updateRow(row._key, 'answer', row.answer === opt ? '' : opt)}
                                      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                                        row.answer === opt
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
                              </div>

                              {/* Remarks */}
                              <div className="flex-1">
                                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                  Remarks
                                </label>
                                <input
                                  type="text"
                                  value={row.remarks}
                                  onChange={e => updateRow(row._key, 'remarks', e.target.value)}
                                  placeholder="Optional remarks..."
                                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Remove */}
                          <button type="button" onClick={() => removeRow(row._key)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors mt-1 opacity-0 group-hover:opacity-100">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary bar */}
                {checklist.length > 0 && (
                  <div className="mt-4 flex gap-4 text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200 px-4 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-green-600 inline-block" />
                      Yes: <strong>{checklist.filter(r => r.answer === 'Yes').length}</strong>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" />
                      No: <strong>{checklist.filter(r => r.answer === 'No').length}</strong>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-slate-500 inline-block" />
                      N/A: <strong>{checklist.filter(r => r.answer === 'N/A').length}</strong>
                    </span>
                    <span className={`flex items-center gap-1.5 ${unansweredCount > 0 ? 'text-amber-600 font-medium' : ''}`}>
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-300 border border-amber-400 inline-block" />
                      Unanswered: <strong>{unansweredCount}</strong>
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
                    Draw the staff nurse's signature below. The sign time defaults to now.
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <div>
                      <label className={labelClass}>Date of Signing</label>
                      <DateFilterInput value={form.date} onChange={e => setField('date', e.target.value)}
                        className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Time of Signing</label>
                      <input type="time" step="1" value={form.sign_time} onChange={e => setField('sign_time', e.target.value)}
                        className={inputClass} />
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
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Checklist'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
