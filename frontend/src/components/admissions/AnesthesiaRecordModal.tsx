


import { Check, ChevronDown, PenLine, Trash2, FileText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../hooks/useToast'
import { useCareContext } from '../../providers/CareContextProvider'
import { apiRequest } from '../../services/apiClient'
import { updateDoctypeRow } from '../../services/doctypeResource'
import { fetchDoc, fetchHealthcarePractitioners, fetchInpatientAdmissionOptions, fetchPatientOptions, fetchPatientVisits, type LinkFieldOption } from '../../services/common'
import { uploadPatientFile } from '../../services/patients'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'

import { CM_BTN_CANCEL, CM_BTN_PRIMARY, CREATE_MODAL_BODY_GRADIENT, CREATE_MODAL_FOOTER_STICKY, CREATE_MODAL_OVERLAY, CreateModalHeader, createModalShellClass, createModalTabButtonClass } from '../ui/CreateModalChrome'
import { DateFilterInput } from '../ui/DateFilterInput'

// ─── Signature Pad (mirrors DischargeModal implementation) ───────────────────

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
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    onClear?.()
  }

  const saveSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `anesthesia_signature_${Date.now()}.png`, { type: 'image/png' })
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
      <button
        type="button"
        onClick={() => setMode('drawing')}
        className="w-full min-h-[96px] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-green-400 hover:text-green-600 hover:bg-green-50/50 transition-all group"
      >
        <PenLine className="w-5 h-5 group-hover:scale-110 transition-transform" />
        <span className="text-xs font-medium">Click to add signature</span>
      </button>
    )
  }

  if (mode === 'done' && existingUrl) {
    return (
      <div className="w-full min-h-[96px] flex flex-col items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
        <img src={existingUrl} alt="Signature" className="max-h-20 object-contain" />
        <button
          type="button"
          onClick={() => { setMode('drawing'); clearCanvas() }}
          className="text-xs text-slate-500 hover:text-red-500 flex items-center gap-1 transition-colors"
        >
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
          <button
            type="button"
            onClick={clearCanvas}
            disabled={!hasStrokes}
            className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-30 flex items-center gap-0.5 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
          <button
            type="button"
            onClick={() => { setMode('idle'); clearCanvas() }}
            className="text-xs text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      <div className="relative" style={{ touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '120px', display: 'block', cursor: 'crosshair' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 pointer-events-none select-none">
            Sign here
          </span>
        )}
      </div>
      <div className="px-2.5 py-2 border-t border-slate-100 flex justify-end">
        <button
          type="button"
          onClick={saveSignature}
          disabled={!hasStrokes || uploading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Saving…
            </span>
          ) : (
            <><Check className="w-3 h-3" /> Save Signature</>
          )}
        </button>
      </div>
    </div>
  )
}

// ─── Searchable Link Combobox ─────────────────────────────────────────────────

interface LinkComboboxProps {
  label: string
  value: string           // display value (label/name shown in input)
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

  // Sync display when value changes from outside (e.g. initial clear)
  useEffect(() => { setQuery(value) }, [value])

  // Debounced fetch
  useEffect(() => {
    if (!open || disabled) return
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const results = await fetchOptions(query)
        setOptions(results)
      } catch {
        setOptions([])
      } finally {
        setLoading(false)
      }
    }, query.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [query, open, fetchOptions, disabled])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const labelClass2 = 'block text-xs font-semibold text-slate-600 mb-1'

  return (
    <div ref={containerRef} className="relative">
      <label className={labelClass2}>{label}</label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => {
            if (!disabled) {
              setQuery(e.target.value)
              onClear()
              setOpen(true)
            }
          }}
          onFocus={() => !disabled && setOpen(true)}
          placeholder={placeholder ?? 'Search...'}
          className={`${linkComboboxInputWithClearClass} ${disabled ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          disabled={disabled}
          autoComplete="off"
        />
        <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
          {loading
            ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </div>
      {open && !disabled && (
        <div className={linkComboboxDropdownClass}>
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">{loading ? 'Searching…' : 'NO RESULTS FOUND'}</div>
          ) : (
            options.map(opt => (
              <button
                key={opt.name}
                type="button"
                className={linkComboboxOptionClassCompact}
                onClick={() => {
                  onSelect(opt)
                  setQuery(opt.label)
                  setOpen(false)
                }}
              >
                <span className="font-medium text-slate-800">{opt.label}</span>
                {opt.label !== opt.name && (
                  <span className="ml-1.5 text-xs text-slate-400">{opt.name}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnesthesiaRecordModalProps {
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

function docCheck(value: unknown): boolean {
  return value === 1 || value === true
}

type TabId = 'general' | 'records' | 'signing'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'records', label: 'Anesthesia Records' },
  { id: 'signing', label: 'Document Signing' },
]

const nowDate = () => new Date().toISOString().split('T')[0]
const nowTime = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
const sectionTitleClass = 'text-sm font-semibold text-slate-800 mb-3 pb-1.5 border-b border-slate-200'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
      />
      <span className="text-sm text-slate-700 group-hover:text-slate-900">{label}</span>
    </label>
  )
}

// ─── Tab 1: General ───────────────────────────────────────────────────────────

interface FormState {
  patient_visit: string
  date: string
  time: string
  bp: string
  hr: string
  rr: string
  spo2: string
  ect_done: string
  anesthetist: string
  full_name: string
  psychiatrist__assistant_doctor: string
  psychiatrist__assistant: string
  preanesthesia_stages: string
  anesthesia_type: string
  oxygen_support: string
  // anesthesia records tab
  awakearousable: boolean
  responds_to_command: boolean
  sustained_head_lift: boolean
  normal_breathing_pattern: boolean
  confused: boolean
  unrespoonsive: boolean
  post_ect_orders: string
  // signing
  sign_time: string
}

function GeneralTab({ form, setField, admissionNo, patient, patientName, fetchAdmissionOpts, setCurrentAdmission }: {
  form: FormState
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  admissionNo: string
  patient: string
  patientName?: string
  fetchAdmissionOpts: (s: string) => Promise<LinkFieldOption[]>
  fetchPatientOpts: (s: string) => Promise<LinkFieldOption[]>
  setCurrentAdmission: (v: string) => void
  setCurrentPatient: (v: string) => void
  setCurrentPatientName: (v: string) => void
}) {
  // Get context for mode detection
  const { mode, activeVisit } = useCareContext()
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'
  
  // Display labels for link fields
  const [anesthetistLabel, setAnesthetistLabel] = useState('')
  const [psychiatristLabel, setPsychiatristLabel] = useState('')
  const [patientVisitLabel, setPatientVisitLabel] = useState('')

  // Auto-set patient visit from context if in OP mode
  useEffect(() => {
    if (isOPMode && activeVisit && !form.patient_visit) {
      setField('patient_visit', activeVisit)
      // Optionally load the label
      fetchPatientVisits(patient, activeVisit).then(visits => {
        const matched = visits.find(v => v.name === activeVisit)
        if (matched) setPatientVisitLabel(matched.label)
      }).catch(() => {})
    }
  }, [isOPMode, activeVisit, form.patient_visit, patient, setField])

  const fetchPractitioners = useCallback(
    (search: string) => fetchHealthcarePractitioners(search || undefined),
    []
  )
  const fetchVisits = useCallback(
    (search: string) => fetchPatientVisits(patient, search || undefined),
    [patient]
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
            ? `The anesthesia record will be linked to the selected inpatient admission.`
            : isOPMode
            ? `The anesthesia record will be linked to the selected outpatient visit.`
            : 'Please select either IP or OP mode from the top navbar.'
          }
        </p>
      </div>

      {/* Basic Information */}
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
              <input type="text" value={admissionNo} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
              <p className="text-xs text-slate-400 mt-1">Auto-selected from IP context</p>
            </div>
          ) : (
            <LinkCombobox
              label="Inpatient Admission"
              value={admissionNo}
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
              <input type="text" value={patientVisitLabel || form.patient_visit} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
              <p className="text-xs text-slate-400 mt-1">Auto-selected from OP context</p>
            </div>
          ) : (
            <LinkCombobox
              label="Patient Visit"
              value={patientVisitLabel}
              onSelect={opt => {
                setField('patient_visit', opt.name)
                setPatientVisitLabel(opt.label)
              }}
              onClear={() => {
                setField('patient_visit', '')
                setPatientVisitLabel('')
              }}
              fetchOptions={fetchVisits}
              placeholder="Search patient visits..."
              disabled={isIPMode}
            />
          )}

          {/* Patient field - locked if from context */}
          <div>
            <label className={labelClass}>Patient *</label>
            <input type="text" value={patientName || patient} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
          </div>
          <div>
            <label className={labelClass}>Patient Name</label>
            <input type="text" value={patientName ?? ''} readOnly className={`${inputClass} bg-slate-100 cursor-not-allowed`} />
          </div>
          <div>
            <label className={labelClass}>Date</label>
            <DateFilterInput value={form.date} onChange={e => setField('date', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Time</label>
            <input type="time" step="1" value={form.time} onChange={e => setField('time', e.target.value)} className={inputClass} />
          </div>
        </div>
      </div>

      {/* Vitals */}
      <div>
        <h3 className={sectionTitleClass}>Pre-Procedure Vitals</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="BP">
            <input type="text" value={form.bp} onChange={e => setField('bp', e.target.value)} placeholder="e.g. 120/80" className={inputClass} />
          </Field>
          <Field label="HR">
            <input type="text" value={form.hr} onChange={e => setField('hr', e.target.value)} placeholder="e.g. 72" className={inputClass} />
          </Field>
          <Field label="RR">
            <input type="text" value={form.rr} onChange={e => setField('rr', e.target.value)} placeholder="e.g. 16" className={inputClass} />
          </Field>
          <Field label="SPO2">
            <input type="text" value={form.spo2} onChange={e => setField('spo2', e.target.value)} placeholder="e.g. 98%" className={inputClass} />
          </Field>
          <div className="col-span-2">
            <SelectField
              label="ECT Done"
              value={form.ect_done}
              onChange={v => setField('ect_done', v)}
              options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
            />
          </div>
        </div>
      </div>

      {/* Personnel */}
      <div>
        <h3 className={sectionTitleClass}>Personnel</h3>
        <div className="grid grid-cols-2 gap-4">
          {/* Anesthetist — searchable link to Healthcare Practitioner */}
          <LinkCombobox
            label="Anesthetist"
            value={anesthetistLabel}
            onSelect={opt => {
              setField('anesthetist', opt.name)
              setField('full_name', opt.label)
              setAnesthetistLabel(opt.label)
            }}
            onClear={() => {
              setField('anesthetist', '')
              setField('full_name', '')
              setAnesthetistLabel('')
            }}
            fetchOptions={fetchPractitioners}
            placeholder="Search doctors..."
          />
          <Field label="Anesthetist Full Name">
            <input
              type="text"
              value={form.full_name}
              onChange={e => setField('full_name', e.target.value)}
              placeholder="Auto-filled on selection, or enter manually..."
              className={inputClass}
            />
          </Field>

          {/* Psychiatrist / Assistant Doctor — searchable link */}
          <LinkCombobox
            label="Psychiatrist / Assistant Doctor"
            value={psychiatristLabel}
            onSelect={opt => {
              setField('psychiatrist__assistant_doctor', opt.name)
              setField('psychiatrist__assistant', opt.label)
              setPsychiatristLabel(opt.label)
            }}
            onClear={() => {
              setField('psychiatrist__assistant_doctor', '')
              setField('psychiatrist__assistant', '')
              setPsychiatristLabel('')
            }}
            fetchOptions={fetchPractitioners}
            placeholder="Search doctors..."
          />
          <Field label="Psychiatrist / Assistant Name">
            <input
              type="text"
              value={form.psychiatrist__assistant}
              onChange={e => setField('psychiatrist__assistant', e.target.value)}
              placeholder="Auto-filled on selection, or enter manually..."
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      {/* Anesthesia Details */}
      <div>
        <h3 className={sectionTitleClass}>Anesthesia Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Pre-Anesthesia Stages"
            value={form.preanesthesia_stages}
            onChange={v => setField('preanesthesia_stages', v)}
            options={[
              { value: 'Awake', label: 'Awake' },
              { value: 'Calm', label: 'Calm' },
              { value: 'Anxious', label: 'Anxious' },
              { value: 'Sedated', label: 'Sedated' },
              { value: 'Uncooperative', label: 'Uncooperative' },
            ]}
          />
          <SelectField
            label="Anesthesia Type"
            value={form.anesthesia_type}
            onChange={v => setField('anesthesia_type', v)}
            options={[
              { value: 'General', label: 'General' },
              { value: 'Regional', label: 'Regional' },
              { value: 'Local', label: 'Local' },
              { value: 'IV Sedation', label: 'IV Sedation' },
              { value: 'Others', label: 'Others' },
            ]}
          />
          <div className="col-span-2">
            <SelectField
              label="Oxygen Support"
              value={form.oxygen_support}
              onChange={v => setField('oxygen_support', v)}
              options={[
                { value: 'Intubated', label: 'Intubated' },
                { value: '02 Mask', label: 'O2 Mask' },
                { value: 'Nasal Cannula', label: 'Nasal Cannula' },
                { value: 'None', label: 'None' },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tab 2: Anesthesia Records (Post ECT) ────────────────────────────────────

function AnesthesiaRecordsTab({ form, setField }: {
  form: FormState
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void
}) {
  const checks: { key: keyof FormState; label: string }[] = [
    { key: 'awakearousable', label: 'Awake / Arousable' },
    { key: 'responds_to_command', label: 'Responds to Command' },
    { key: 'sustained_head_lift', label: 'Sustained Head Lift' },
    { key: 'normal_breathing_pattern', label: 'Normal Breathing Pattern' },
    { key: 'confused', label: 'Confused' },
    { key: 'unrespoonsive', label: 'Unresponsive' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h3 className={sectionTitleClass}>Post ECT Assessment</h3>
        <p className="text-xs text-slate-500 mb-4 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Tick all that apply to the patient's condition post ECT.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {checks.map(c => (
            <div key={c.key} className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <CheckRow
                label={c.label}
                checked={form[c.key] as boolean}
                onChange={v => setField(c.key, v as FormState[typeof c.key])}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className={sectionTitleClass}>Post ECT Orders</h3>
        <div>
          <label className={labelClass}>Post ECT Orders</label>
          <textarea
            rows={6}
            value={form.post_ect_orders}
            onChange={e => setField('post_ect_orders', e.target.value)}
            placeholder="Enter post ECT orders, observations, and instructions..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Tab 3: Document Signing ──────────────────────────────────────────────────

function SigningTab({ form, setField, signatureUrl, setSignatureUrl }: {
  form: FormState
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  signatureUrl: string
  setSignatureUrl: (url: string) => void
}) {
  const [signatureUploading, setSignatureUploading] = useState(false)

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

  return (
    <div className="space-y-6">
      <div>
        <h3 className={sectionTitleClass}>Doctor Signature and Stamp</h3>
        <p className="text-xs text-slate-500 mb-4 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Draw the doctor's signature in the box below. Once saved it will be attached to this record.
          The sign time defaults to now and can be adjusted.
        </p>

        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <label className={labelClass}>Date of Signing</label>
            <DateFilterInput
              value={form.date}
              onChange={e => setField('date', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Time of Signing</label>
            <input
              type="time"
              step="1"
              value={form.sign_time}
              onChange={e => setField('sign_time', e.target.value)}
              className={inputClass}
            />
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
              <Check className="w-3.5 h-3.5" />
              Signature captured and ready to save with record.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export const AnesthesiaRecordModal = ({
  editName,
  admissionNo = '',
  patient = '',
  patientName,
  onClose,
  onSuccess,
}: AnesthesiaRecordModalProps) => {
  const isEdit = Boolean(editName?.trim())
  // Get context from CareContextProvider
  const { mode, activeVisit, activeAdmission, selectedPatient: contextPatient } = useCareContext()
  
  // Determine if we're in IP or OP mode based on context
  const isIPMode = mode === 'IP'
  const isOPMode = mode === 'OP'
  
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [form, setFormState] = useState<FormState>({
    patient_visit: (isOPMode && activeVisit) ? activeVisit : '',
    date: nowDate(),
    time: nowTime(),
    bp: '',
    hr: '',
    rr: '',
    spo2: '',
    ect_done: '',
    anesthetist: '',
    full_name: '',
    psychiatrist__assistant_doctor: '',
    psychiatrist__assistant: '',
    preanesthesia_stages: '',
    anesthesia_type: '',
    oxygen_support: '',
    awakearousable: false,
    responds_to_command: false,
    sustained_head_lift: false,
    normal_breathing_pattern: false,
    confused: false,
    unrespoonsive: false,
    post_ect_orders: '',
    sign_time: nowTime(),
  })
  const [signatureUrl, setSignatureUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(isEdit)

  // Use context values if available, otherwise use props
  const [currentAdmission, setCurrentAdmission] = useState(() => {
    if (isIPMode && activeAdmission) return activeAdmission
    return admissionNo || ''
  })
  const [currentPatient, setCurrentPatient] = useState(patient || contextPatient || '')
  const [currentPatientName, setCurrentPatientName] = useState(patientName || '')

  const fetchPatientOpts = useCallback((s: string) => fetchPatientOptions(s || undefined), [])
  const fetchAdmissionOpts = useCallback(
    (s: string) => fetchInpatientAdmissionOptions(s || undefined, currentPatient || undefined),
    [currentPatient]
  )

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setFormState(prev => ({ ...prev, [k]: v }))
  }

  useEffect(() => {
    if (!editName?.trim()) return
    let cancelled = false
    setLoadingEdit(true)
    fetchDoc('Anesthesia Record', editName.trim())
      .then((doc) => {
        if (cancelled) return
        setCurrentAdmission(String(doc.inpatient_admission || doc.admission || ''))
        setCurrentPatient(String(doc.patient || ''))
        setCurrentPatientName(String(doc.patient_name || ''))
        setFormState({
          patient_visit: String(doc.patient_visit || ''),
          date: toDateInput(doc.date as string) || nowDate(),
          time: toTimeInput(doc.time as string) || nowTime(),
          bp: String(doc.bp || ''),
          hr: String(doc.hr || ''),
          rr: String(doc.rr || ''),
          spo2: String(doc.spo2 || ''),
          ect_done: String(doc.ect_done || ''),
          anesthetist: String(doc.anesthetist || ''),
          full_name: String(doc.full_name || ''),
          psychiatrist__assistant_doctor: String(doc.psychiatrist__assistant_doctor || ''),
          psychiatrist__assistant: String(doc.psychiatrist__assistant || ''),
          preanesthesia_stages: String(doc.preanesthesia_stages || ''),
          anesthesia_type: String(doc.anesthesia_type || ''),
          oxygen_support: String(doc.oxygen_support || ''),
          awakearousable: docCheck(doc.awakearousable),
          responds_to_command: docCheck(doc.responds_to_command),
          sustained_head_lift: docCheck(doc.sustained_head_lift),
          normal_breathing_pattern: docCheck(doc.normal_breathing_pattern),
          confused: docCheck(doc.confused),
          unrespoonsive: docCheck(doc.unrespoonsive),
          post_ect_orders: String(doc.post_ect_orders || ''),
          sign_time: toTimeInput(doc.sign_time as string) || nowTime(),
        })
        const sig = doc.doctor_signature_and_stamp
        if (typeof sig === 'string' && sig.trim()) setSignatureUrl(sig.trim())
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!isEdit) {
      if (isIPMode && !currentAdmission) {
        toast.error('Please select an inpatient admission (IP mode active)')
        return
      }
      if (isOPMode && !form.patient_visit) {
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
        patient_visit: form.patient_visit || undefined,
        date: form.date || undefined,
        time: form.time || undefined,
        bp: form.bp || undefined,
        hr: form.hr || undefined,
        rr: form.rr || undefined,
        spo2: form.spo2 || undefined,
        ect_done: form.ect_done || undefined,
        anesthetist: form.anesthetist || undefined,
        full_name: form.full_name || undefined,
        psychiatrist__assistant_doctor: form.psychiatrist__assistant_doctor || undefined,
        psychiatrist__assistant: form.psychiatrist__assistant || undefined,
        preanesthesia_stages: form.preanesthesia_stages || undefined,
        anesthesia_type: form.anesthesia_type || undefined,
        oxygen_support: form.oxygen_support || undefined,
        doctor_signature_and_stamp: signatureUrl || undefined,
        awakearousable: form.awakearousable ? 1 : 0,
        responds_to_command: form.responds_to_command ? 1 : 0,
        sustained_head_lift: form.sustained_head_lift ? 1 : 0,
        normal_breathing_pattern: form.normal_breathing_pattern ? 1 : 0,
        confused: form.confused ? 1 : 0,
        unrespoonsive: form.unrespoonsive ? 1 : 0,
        post_ect_orders: form.post_ect_orders || undefined,
      }

      if (isEdit && editName?.trim()) {
        await updateDoctypeRow('Anesthesia Record', editName.trim(), payload)
        toast.success('Anesthesia Record updated.')
      } else {
        await apiRequest('/api/resource/Anesthesia%20Record', {
          method: 'POST',
          body: JSON.stringify({ data: payload }),
        })
        toast.success('Anesthesia Record saved successfully.')
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
      <div className={createModalShellClass('w-full max-w-3xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isEdit ? 'Edit Anesthesia Record' : 'Anesthesia Record'}
          icon={<FileText className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          subtitle={
            <>
              {currentPatientName ? `${currentPatientName} · ` : ''}
              {isIPMode && currentAdmission ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">IP: {currentAdmission}</span> : null}
              {isOPMode && form.patient_visit ? <span className="ml-1 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OP Visit</span> : null}
              {!currentAdmission && !form.patient_visit ? 'New Record' : null}
            </>
          }
          onClose={onClose}
        >
          <div className="-mb-px mt-3 flex border-b border-emerald-100/80">
            {TABS.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={createModalTabButtonClass(activeTab === tab.id)}>
                {tab.label}
                {tab.id === 'signing' && signatureUrl ? (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-2.5 w-2.5" />
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
                admissionNo={currentAdmission}
                patient={currentPatient}
                patientName={currentPatientName}
                fetchAdmissionOpts={fetchAdmissionOpts}
                fetchPatientOpts={fetchPatientOpts}
                setCurrentAdmission={setCurrentAdmission}
                setCurrentPatient={setCurrentPatient}
                setCurrentPatientName={setCurrentPatientName}
              />
            )}
            {!loadingEdit && activeTab === 'records' && (
              <AnesthesiaRecordsTab form={form} setField={setField} />
            )}
            {!loadingEdit && activeTab === 'signing' && (
              <SigningTab form={form} setField={setField} signatureUrl={signatureUrl} setSignatureUrl={setSignatureUrl} />
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
                  (!isEdit &&
                    ((!isIPMode && !isOPMode) ||
                      (isIPMode && !currentAdmission) ||
                      (isOPMode && !form.patient_visit)))
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