import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchPrescriptionByInpatientOrEncounter,
  fetchPrescriptions,
  fetchPrescription,
  saveMedicationOrderEntryStopReason,
  updateMedicationOrderEntry,
  checkMedicineGivenForEntry,
  addMedicationOrderEntry,
  getGivenStatusForPrescription,
  previewPrescriptionDoseValidation,
  fetchMedicineDoseLimitInfo,
  createPrescriptionSalesOrder,
  mapOrderToDuplicateMedication,
  type Prescription,
  type PrescriptionDoseValidationPreview,
  type MedicineDoseLimitInfo,
} from '../../services/prescriptions'
import {
  flagsFromPrescriptionType,
  isLongActingPrescriptionType,
  matchesPrescriptionTypeFilter,
  normalizeMedicationOrderForSave,
  normalizePrescriptionType,
  isFuturePlanByStartDate,
  isMedicationStopped,
  SELECTABLE_PRESCRIPTION_TYPES,
  syncPrescriptionEndDateAndDays,
} from '../../utils/prescriptionType'
import { prescriptionNeedsSignature, prescriptionIsSigned } from '../../utils/prescriptionSigning'
import { RefreshCw, MoreVertical, Plus, X, ChevronDown, History } from 'lucide-react'
import { useCareContext } from '../../providers/CareContextProvider'
import { CreatePrescriptionModal } from './CreatePrescriptionModal'
import { SignPrescriptionModal } from './SignPrescriptionModal'
import { PrescriptionDoseLimitConfirmModal } from './PrescriptionDoseLimitConfirmModal'
import { DoseLimitHint } from './DoseLimitHint'
import { IpMedicationPlanPrintButton } from './IpMedicationPlanPrintButton'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { toast } from '../../hooks/useToast'
import { CREATE_MODAL_OVERLAY, createModalShellClass } from '../ui/CreateModalChrome'
import { CardRowPopoverHint } from '../ui/dashboardCardListing'
import {
  displayMedicationDosage,
  displayMedicationDrugCode,
  displayMedicationDrugName,
  displayMedicationEndDate,
  displayMedicationFrequency,
  displayMedicationInstructionTooltip,
  displayMedicationRoute,
  displayMedicationStartDate,
  displayPrescriptionPractitioner,
  isLegacyMedicationOrderRow,
} from '../../utils/medicationOrderDisplayUtils'
import {
  linkComboboxInputWithClearClass,
  linkComboboxDropdownClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import {
  fetchPrescriptionItems,
  fetchPrescriptionFrequencies,
  fetchLongActingFrequencies,
  fetchRouteOfAdministrationList,
  fetchDosageForms,
  fetchStandardUoms,
  resolvePrescriptionDrugRoute,
  fetchHealthcarePractitioners,
  getCurrentUserPractitioner,
  getCurrentUserPractitionerOption,
  type LinkFieldOption,
} from '../../services/common'
import {
  CreateFrequencyMiniModal,
  type CreateFrequencyKind,
} from './CreateFrequencyMiniModal'
import { DateFilterInput } from '../ui/DateFilterInput'
import {
  getMedicationTypeLabel,
  medicationTypeBadgeStyle,
  resolveMedicationTypeForDisplay,
} from '../../utils/medicationTypeColors'

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + Math.round(days))
  return d.toISOString().split('T')[0]
}
function daysBetween(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0
  const diff = new Date(endStr).getTime() - new Date(startStr).getTime()
  return Math.round(diff / (24 * 60 * 60 * 1000))
}


// ─── Mini Combobox (matches CreatePrescriptionModal's Combobox) ───────────────
const MiniCombobox = ({
  value,
  displayValue,
  placeholder,
  options,
  loading,
  onQueryChange,
  onSelect,
  onOpen,
  onClear,
  disabled,
  onCreateClick,
}: {
  value: string
  displayValue: string
  placeholder: string
  options: LinkFieldOption[]
  loading?: boolean
  onQueryChange: (q: string) => void
  onSelect: (opt: LinkFieldOption) => void
  onOpen: () => void
  onClear?: () => void
  disabled?: boolean
  onCreateClick?: () => void
}) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          type="text"
          value={displayValue}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); onOpen() }}
          placeholder={placeholder}
          disabled={disabled}
          className={linkComboboxInputWithClearClass + (disabled ? ' !bg-slate-100 !text-slate-500' : '')}
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {onCreateClick && !disabled && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCreateClick() }}
              className="p-0.5 text-primary hover:text-primary/80 rounded"
              title="Create new"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {displayValue && onClear && !disabled && (
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear(); setOpen(false) }}
              className="text-slate-400 hover:text-slate-600 transition-colors p-0.5" title="Clear">
              <X className="w-4 h-4" />
            </button>
          )}
          <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>
      {open && !disabled && (
        <div className={linkComboboxDropdownClass}>
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-500">Loading...</div>
          ) : options.length ? (
            options.map((opt) => (
              <button key={opt.name} type="button" className={linkComboboxOptionClassCompact}
                onClick={() => { onSelect(opt); setOpen(false) }}>
                {opt.label || opt.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">
              {value ? 'No matches' : 'Type to search...'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Medication type definitions ──────────────────────────────────────────────
const MED_TYPES = [
  { key: 'All',                        label: 'All',              icon: '💊', color: 'slate'   },
  { key: 'STAT',                       label: 'STAT',             icon: '⚡', color: '#fe80c0' },
  { key: 'PRN',                        label: 'PRN',              icon: '🔔', color: '#fefebf' },
  { key: 'Regular - Psy (Active)',     label: 'Reg Psy Active',   icon: '🧠', color: '#00ff02' },
  { key: 'Regular - Med (Active)',     label: 'Reg Med Active',   icon: '💉', color: '#4080e1' },
  { key: 'Regular - Psy (Inactive)',   label: 'Reg Psy Inactive', icon: '🧠', color: 'slate'   },
  { key: 'Regular - Med (Inactive)',   label: 'Reg Med Inactive', icon: '💉', color: 'slate'   },
  { key: 'Long Acting Medicine',       label: 'Long Acting',      icon: '⏳', color: 'teal'    },
  { key: 'Future Plan',                label: 'Future Plan',      icon: '📅', color: 'indigo'  },
  { key: '__stopped__',                label: 'Stopped',          icon: '🛑', color: 'rose'    },
]

const DEFAULT_PRESCRIPTION_TYPE_FILTER = 'Regular - Psy (Active)'

const TYPE_COLORS: Record<string, { active: string; inactive: string; badge: string; activeBadge: string }> = {
  slate:  { active: 'bg-slate-700 text-white border-slate-700',          inactive: 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',   badge: 'bg-slate-100 text-slate-700',   activeBadge: 'bg-white/20 text-white' },
  rose:   { active: 'bg-rose-600 text-white border-rose-600',            inactive: 'bg-white text-rose-600 border-rose-200 hover:border-rose-400',       badge: 'bg-rose-100 text-rose-700',     activeBadge: 'bg-white/20 text-white' },
  teal:   { active: 'bg-teal-600 text-white border-teal-600',            inactive: 'bg-white text-teal-600 border-teal-200 hover:border-teal-400',       badge: 'bg-teal-100 text-teal-700',     activeBadge: 'bg-white/20 text-white' },
  indigo: { active: 'bg-indigo-600 text-white border-indigo-600',        inactive: 'bg-white text-indigo-600 border-indigo-200 hover:border-indigo-400', badge: 'bg-indigo-100 text-indigo-700', activeBadge: 'bg-white/20 text-white' },
}

const isHex = (color: string) => color.startsWith('#')

const hexButtonStyle = (hex: string, active: boolean): React.CSSProperties =>
  active
    ? { backgroundColor: hex, borderColor: hex, color: '#1e293b' }
    : { backgroundColor: `${hex}18`, borderColor: `${hex}55`, color: '#334155' }

const hexBadgeStyle = (hex: string, active: boolean): React.CSSProperties =>
  active
    ? { backgroundColor: 'rgba(0,0,0,0.15)', color: '#1e293b' }
    : { backgroundColor: `${hex}33`, color: '#334155' }

const hexRowStyle = (hex: string): React.CSSProperties => ({
  backgroundColor: `${hex}18`,
  borderColor: `${hex}44`,
})

const getTypeColor = (medicationType: string): string =>
  MED_TYPES.find(t => t.key === normalizePrescriptionType(medicationType))?.color ?? 'slate'

// ─── Primitives ───────────────────────────────────────────────────────────────
const SmallBadge = ({ children, cls }: { children: React.ReactNode; cls: string }) => (
  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{children}</span>
)

// ─── Type filter card ─────────────────────────────────────────────────────────
const TypeFilterCard = ({
  typeDef, count, isActive, onClick,
}: {
  typeDef: (typeof MED_TYPES)[number]
  count: number
  isActive: boolean
  onClick: () => void
}) => {
  const hex = isHex(typeDef.color)
  const tailwind = !hex ? (TYPE_COLORS[typeDef.color] ?? TYPE_COLORS.slate) : null
  const isEmpty = count === 0 && typeDef.key !== 'All' && typeDef.key !== '__stopped__'

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all min-w-[72px] cursor-pointer ${
        hex ? '' : isActive ? tailwind!.active : tailwind!.inactive
      } ${isEmpty && !isActive ? 'opacity-55' : ''}`}
      style={hex ? hexButtonStyle(typeDef.color, isActive) : undefined}
    >
      <span className="text-base leading-none">{typeDef.icon}</span>
      <span className="leading-tight text-center">{typeDef.label}</span>
      <span
        className={`mt-0.5 rounded-full px-1.5 py-0 text-[10px] font-semibold ${
          hex ? '' : isActive ? tailwind!.activeBadge : tailwind!.badge
        }`}
        style={hex ? hexBadgeStyle(typeDef.color, isActive) : undefined}
      >
        {count}
      </span>
    </button>
  )
}

const CLINICAL_EDIT_FIELDS = [
  'drug',
  'dosage',
  'uom',
  'dosage_form',
  'instructions',
  'patient_frequency',
  'long_acting_frequency',
  'route_of_administration',
  'reference_no',
  'is_pink',
  'is_prn',
  'medication_type',
  'healthcare_practitioner',
] as const

const CASEFOLD_EDIT_FIELDS = new Set([
  'uom',
  'dosage_form',
  'route_of_administration',
  'patient_frequency',
  'long_acting_frequency',
])

function normMedCompare(field: string, value: unknown): string {
  if (value === true || value === 1 || value === '1') return '1'
  if (value === false || value === 0 || value === '0' || value == null) return ''
  const text = String(value).trim()
  if (field === 'medication_type') return text
  if (CASEFOLD_EDIT_FIELDS.has(field)) return text.toLowerCase()
  return text
}

function medicationClinicalFieldsChanged(order: any, form: Record<string, unknown>): boolean {
  return CLINICAL_EDIT_FIELDS.some(
    (field) => normMedCompare(field, order[field]) !== normMedCompare(field, form[field]),
  )
}

// ─── Edit medication entry modal ──────────────────────────────────────────────
export const EditMedicationEntryModal = ({
  order,
  prescriptionName,
  patient,
  patientEncounter,
  inpatientRecord,
  onClose,
  onSaved,
}: {
  order: any
  prescriptionName: string
  patient?: string
  patientEncounter?: string
  inpatientRecord?: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}) => {
  const [form, setForm] = useState({
    drug: order.drug || '',
    drug_name: order.drug_name || '',
    dosage: order.dosage || '',
    uom: order.uom || '',
    dosage_form: order.dosage_form || '',
    no_of_days: order.no_of_days || '',
    instructions: order.instructions || '',
    date: order.date || '',
    end_date: order.end_date || '',
    patient_frequency: order.patient_frequency || '',
    route_of_administration: order.route_of_administration || '',
    is_pink: order.is_pink || false,
    reference_no: order.reference_no || '',
    long_acting_frequency: order.long_acting_frequency || '',
    healthcare_practitioner: order.healthcare_practitioner || '',
    medication_type:
      order.medication_type === 'Contraindicated' ? '' : (order.medication_type || ''),
    ...flagsFromPrescriptionType(
      order.medication_type === 'Contraindicated' ? '' : order.medication_type
    ),
  })
  const [saving, setSaving] = useState(false)
  const [changeReason, setChangeReason] = useState('')
  const [givenCheck, setGivenCheck] = useState<{ loading: boolean; given: boolean }>({ loading: true, given: false })
  const [doseWarning, setDoseWarning] = useState<PrescriptionDoseValidationPreview | null>(null)
  const [checkingDose, setCheckingDose] = useState(false)
  const [doseLimitInfo, setDoseLimitInfo] = useState<MedicineDoseLimitInfo | null>(null)
  const [loadingDoseLimitInfo, setLoadingDoseLimitInfo] = useState(false)
  const [doseLimitConfirmOpen, setDoseLimitConfirmOpen] = useState(false)

  const [freqQuery, setFreqQuery] = useState(order.patient_frequency || '')
  const [freqOptions, setFreqOptions] = useState<LinkFieldOption[]>([])
  const [freqLoading, setFreqLoading] = useState(false)
  const [longActingFreqQuery, setLongActingFreqQuery] = useState(order.long_acting_frequency || 'Weekly')
  const [longActingFreqOptions, setLongActingFreqOptions] = useState<LinkFieldOption[]>([])
  const [longActingFreqLoading, setLongActingFreqLoading] = useState(false)
  const [createFreqModal, setCreateFreqModal] = useState<CreateFrequencyKind | null>(null)
  const [routeQuery, setRouteQuery] = useState(order.route_of_administration || '')
  const [routeOptions, setRouteOptions] = useState<LinkFieldOption[]>([])
  const [routeLoading, setRouteLoading] = useState(false)
  const [uomQuery, setUomQuery] = useState(order.uom || '')
  const [uomOptions, setUomOptions] = useState<LinkFieldOption[]>([])
  const [uomLoading, setUomLoading] = useState(false)
  const [dosageFormOptions, setDosageFormOptions] = useState<LinkFieldOption[]>([])
  const [practitioners, setPractitioners] = useState<LinkFieldOption[]>([])
  const [practQuery, setPractQuery] = useState(
    order.healthcare_practitioner_name || order.healthcare_practitioner || ''
  )

  const formIsLongActing =
    Boolean(form.is_long_acting) || isLongActingPrescriptionType(String(form.medication_type || ''))

  useEffect(() => {
    fetchDosageForms().then(setDosageFormOptions).catch(() => setDosageFormOptions([]))
    fetchStandardUoms(undefined, { medicalOnly: true }).then(setUomOptions).catch(() => setUomOptions([]))
  }, [])

  // Editing creates a new medicine line when clinical fields change — stamp the
  // logged-in doctor's practitioner on that new line (same as Add Medication).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pract = await getCurrentUserPractitionerOption()
        if (cancelled || !pract?.name) return
        setForm((f) => ({ ...f, healthcare_practitioner: pract.name }))
        setPractitioners((prev) => {
          if (prev.some((p) => p.name === pract.name)) return prev
          return [pract, ...prev]
        })
        setPractQuery(pract.label || pract.name)
      } catch {
        /* keep original line doctor if user has no linked practitioner */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const searchUoms = async (q: string) => {
    setUomLoading(true)
    try { setUomOptions(await fetchStandardUoms(q || undefined, { medicalOnly: true })) }
    catch { setUomOptions([]) } finally { setUomLoading(false) }
  }

  const updateFieldWithDateCalc = (field: string, value: unknown) => {
    setForm((f) => {
      const next = { ...f, [field]: value }
      if (field === 'date' || field === 'end_date' || field === 'no_of_days') {
        return syncPrescriptionEndDateAndDays(next, field, addDaysToDate, daysBetween)
      }
      return next
    })
  }

  const searchFrequencies = async (q: string) => {
    setFreqLoading(true)
    try {
      setFreqOptions(await fetchPrescriptionFrequencies(q || undefined))
    } catch { setFreqOptions([]) } finally { setFreqLoading(false) }
  }
  const searchLongActingFrequencies = async (q: string) => {
    setLongActingFreqLoading(true)
    try {
      setLongActingFreqOptions(await fetchLongActingFrequencies(q || undefined))
    } catch { setLongActingFreqOptions([]) } finally { setLongActingFreqLoading(false) }
  }
  const searchRoutes = async (q: string) => {
    setRouteLoading(true)
    try {
      const all = await fetchRouteOfAdministrationList()
      setRouteOptions(!q.trim() ? all : all.filter(r => r.label?.toLowerCase().includes(q.toLowerCase()) || r.name?.toLowerCase().includes(q.toLowerCase())))
    } catch { setRouteOptions([]) } finally { setRouteLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    checkMedicineGivenForEntry(prescriptionName, order.name)
      .then((res) => {
        if (!cancelled) setGivenCheck({ loading: false, given: res.has_given })
      })
      .catch(() => {
        if (!cancelled) setGivenCheck({ loading: false, given: false })
      })
    return () => { cancelled = true }
  }, [prescriptionName, order.name])

  useEffect(() => {
    const drug = (form.drug || '').trim()
    const dosage = (form.dosage || '').trim()
    if (!drug || !dosage) {
      setDoseWarning(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setCheckingDose(true)
      previewPrescriptionDoseValidation({
        medicine_code: drug,
        dose: dosage,
        patient,
        patient_encounter: patientEncounter,
        inpatient_record: inpatientRecord,
        route_of_administration: form.route_of_administration || undefined,
        is_long_acting: formIsLongActing ? 1 : 0,
      })
        .then((preview) => {
          if (!cancelled) {
            setDoseWarning(preview.has_limit && !preview.ok && preview.message ? preview : null)
          }
        })
        .catch(() => {
          if (!cancelled) setDoseWarning(null)
        })
        .finally(() => {
          if (!cancelled) setCheckingDose(false)
        })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    form.drug,
    form.dosage,
    form.route_of_administration,
    formIsLongActing,
    patient,
    patientEncounter,
    inpatientRecord,
  ])

  useEffect(() => {
    const drug = (form.drug || '').trim()
    if (!drug) {
      setDoseLimitInfo(null)
      return
    }
    let cancelled = false
    setLoadingDoseLimitInfo(true)
    fetchMedicineDoseLimitInfo(drug, formIsLongActing)
      .then((info) => {
        if (!cancelled) setDoseLimitInfo(info)
      })
      .catch(() => {
        if (!cancelled) setDoseLimitInfo(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingDoseLimitInfo(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.drug, formIsLongActing])

  const handleSave = async () => {
    if (isDiscontinued) return
    if (!String(form.healthcare_practitioner || '').trim()) {
      toast.error('Doctor is required')
      return
    }
    if (form.is_pink && !String(form.reference_no || '').trim() && !inpatientRecord) {
      toast.error('Reference No is required for pink medications')
      return
    }
    if (medicationClinicalFieldsChanged(order, form) && !changeReason.trim()) {
      toast.error(
        'Enter a reason for changing dosage, dosage form, unit of measure, route, prescription type, frequency, or other details',
      )
      return
    }
    if (doseWarning?.message) {
      setDoseLimitConfirmOpen(true)
      return
    }
    await performSave()
  }

  const performSave = async () => {
    try {
      setSaving(true)
      const payload = normalizeMedicationOrderForSave(form)
      const willAmend = medicationClinicalFieldsChanged(order, form)
      const res = await updateMedicationOrderEntry(
        prescriptionName,
        order.name,
        payload,
        willAmend ? changeReason.trim() : undefined,
      )
      toast.success(
        res.amended
          ? 'Previous line discontinued and a new medicine line created'
          : 'Medication entry updated',
      )
      setDoseLimitConfirmOpen(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field: string, value: unknown) => {
    setForm((f) => {
      const next = { ...f, [field]: value }
      if (field === 'medication_type') {
        Object.assign(next, flagsFromPrescriptionType(String(value)))
        if (isLongActingPrescriptionType(String(value))) {
          const lf = next.long_acting_frequency || 'Weekly'
          next.long_acting_frequency = lf
          next.patient_frequency = lf
          setFreqQuery(lf)
          setLongActingFreqQuery(lf)
        }
      }
      if (field === 'long_acting_frequency') {
        next.patient_frequency = String(value)
        setFreqQuery(String(value))
      }
      return next
    })
  }
  const isDiscontinued =
    String(order.medication_status || '').trim() === 'Discontinued' || Boolean(order.stopped)
  const willAmend = medicationClinicalFieldsChanged(order, form)
  const disabled = isDiscontinued

  return createPortal(
    <>
    <div
      className={CREATE_MODAL_OVERLAY}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={createModalShellClass('max-w-xl w-full max-h-[85vh]')}>
        <div className="px-6 py-4 border-b border-slate-200 shrink-0 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-emerald-950">
              Edit Prescription
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{order.drug_name}</p>
          </div>
          <div className="flex items-center gap-2">
            {isDiscontinued ? (
              <span className="text-xs text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full font-medium">
                Discontinued
              </span>
            ) : givenCheck.loading ? (
              <span className="text-xs text-slate-400">Checking...</span>
            ) : givenCheck.given ? (
              <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                Already given — dose/frequency changes create a new line
              </span>
            ) : null}
            <button onClick={onClose} className="shrink-0 rounded-lg p-2 text-emerald-800/70 transition hover:bg-emerald-200/50 hover:text-emerald-950">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Drug</label>
            <input value={form.drug_name} disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 shadow-sm" />
            <div className="hidden text-[10px] text-slate-400 mt-0.5" aria-hidden="true">
              {form.drug}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Doctor *</label>
            <MiniCombobox
              value={form.healthcare_practitioner}
              displayValue={
                form.healthcare_practitioner
                  ? practitioners.find((p) => p.name === form.healthcare_practitioner)?.label || practQuery
                  : practQuery
              }
              placeholder="Search doctor..."
              options={practitioners}
              disabled={disabled}
              onQueryChange={(q) => {
                setPractQuery(q)
                setForm((f) => ({ ...f, healthcare_practitioner: '' }))
                fetchHealthcarePractitioners(q || undefined).then(setPractitioners).catch(() => {})
              }}
              onOpen={() => {
                fetchHealthcarePractitioners(practQuery || undefined).then(setPractitioners).catch(() => {})
              }}
              onSelect={(opt) => {
                setForm((f) => ({ ...f, healthcare_practitioner: opt.name }))
                setPractQuery(opt.label || opt.name)
              }}
              onClear={() => {
                setForm((f) => ({ ...f, healthcare_practitioner: '' }))
                setPractQuery('')
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Dosage</label>
              <input value={form.dosage} onChange={(e) => updateField('dosage', e.target.value)} disabled={disabled} placeholder="45mg"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500" />
              {checkingDose ? (
                <p className="mt-1 text-xs text-slate-500">Checking dose limit…</p>
              ) : (
                <DoseLimitHint
                  info={doseLimitInfo}
                  loading={loadingDoseLimitInfo}
                  hasWarning={Boolean(doseWarning?.message)}
                  warningMessage={doseWarning?.message}
                  enteredDose={form.dosage}
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit of Measure</label>
              <MiniCombobox
                value={form.uom}
                displayValue={uomQuery}
                placeholder="Type or select unit of measure…"
                options={uomOptions}
                loading={uomLoading}
                disabled={disabled}
                onQueryChange={(q) => { setUomQuery(q); searchUoms(q) }}
                onOpen={() => { if (uomOptions.length === 0) searchUoms('') }}
                onSelect={(opt) => { updateField('uom', opt.name); setUomQuery(opt.label || opt.name) }}
                onClear={() => { updateField('uom', ''); setUomQuery('') }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Prescription Type</label>
              <select
                value={form.medication_type}
                onChange={(e) => updateField('medication_type', e.target.value)}
                disabled={disabled}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="">— Select —</option>
                {SELECTABLE_PRESCRIPTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MED_TYPES.find((m) => m.key === t)?.label || t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Dosage Form</label>
              <select value={form.dosage_form} onChange={(e) => updateField('dosage_form', e.target.value)} disabled={disabled}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500">
                <option value="">Select...</option>
                {dosageFormOptions.map((df) => <option key={df.name} value={df.name}>{df.label || df.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              {isLongActingPrescriptionType(form.medication_type) ? (
                <>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Long Acting Frequency</label>
                  <MiniCombobox
                    value={form.long_acting_frequency ?? ''}
                    displayValue={longActingFreqQuery}
                    placeholder="Select long acting frequency..."
                    options={longActingFreqOptions}
                    loading={longActingFreqLoading}
                    disabled={disabled}
                    onCreateClick={() => setCreateFreqModal('long_acting')}
                    onQueryChange={(q) => { setLongActingFreqQuery(q); searchLongActingFrequencies(q) }}
                    onOpen={() => { if (longActingFreqOptions.length === 0) searchLongActingFrequencies('') }}
                    onSelect={(opt) => {
                      updateField('long_acting_frequency', opt.name)
                      updateField('patient_frequency', opt.name)
                      setLongActingFreqQuery(opt.label || opt.name)
                      setFreqQuery(opt.label || opt.name)
                    }}
                    onClear={() => {
                      updateField('long_acting_frequency', 'Weekly')
                      setLongActingFreqQuery('')
                    }}
                  />
                </>
              ) : (
                <>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Frequency</label>
                  <MiniCombobox
                    value={form.patient_frequency}
                    displayValue={freqQuery}
                    placeholder="Search frequency..."
                    options={freqOptions}
                    loading={freqLoading}
                    disabled={disabled}
                    onCreateClick={() => setCreateFreqModal('regular')}
                    onQueryChange={(q) => { setFreqQuery(q); searchFrequencies(q) }}
                    onOpen={() => { if (freqOptions.length === 0) searchFrequencies('') }}
                    onSelect={(opt) => { updateField('patient_frequency', opt.name); setFreqQuery(opt.label || opt.name) }}
                    onClear={() => { updateField('patient_frequency', ''); setFreqQuery('') }}
                  />
                </>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Route</label>
              <MiniCombobox
                value={form.route_of_administration}
                displayValue={routeQuery}
                placeholder="Search route..."
                options={routeOptions}
                loading={routeLoading}
                disabled={disabled}
                onQueryChange={(q) => { setRouteQuery(q); searchRoutes(q) }}
                onOpen={() => { if (routeOptions.length === 0) searchRoutes('') }}
                onSelect={(opt) => { updateField('route_of_administration', opt.name); setRouteQuery(opt.label || opt.name) }}
                onClear={() => { updateField('route_of_administration', ''); setRouteQuery('') }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
              <DateFilterInput value={form.date} onChange={(e) => updateFieldWithDateCalc('date', e.target.value)} disabled={disabled}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
              <DateFilterInput value={form.end_date} onChange={(e) => updateFieldWithDateCalc('end_date', e.target.value)} disabled={disabled}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Days</label>
              <input type="number" min={1} step={1} value={form.no_of_days} onChange={(e) => updateFieldWithDateCalc('no_of_days', e.target.value)} disabled={disabled}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">Start + End Date → Days; or Start Date + Days → End Date. Clear End Date or Days to clear both.</p>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Instructions</label>
            <textarea value={form.instructions} onChange={(e) => updateField('instructions', e.target.value)} disabled={disabled}
              rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.is_pink}
                  onChange={(e) => {
                    const checked = e.target.checked
                    updateField('is_pink', checked)
                    if (!checked) updateField('reference_no', '')
                  }}
                  disabled={disabled}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Is Pink
              </label>
            </div>
            {!!form.is_pink && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Reference No
                  {!inpatientRecord ? (
                    <span className="text-red-500"> *</span>
                  ) : (
                    <span className="text-slate-400 font-normal"> (optional)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={form.reference_no || ''}
                  onChange={(e) => updateField('reference_no', e.target.value)}
                  disabled={disabled}
                  placeholder={inpatientRecord ? 'Optional for inpatient' : 'Enter reference number'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Reason for change {willAmend ? <span className="text-red-500">*</span> : null}
            </label>
            <textarea
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              disabled={disabled}
              rows={2}
              placeholder="Required if you change route, unit of measure, prescription type, dosage form, dosage, or frequency."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-slate-100 disabled:text-slate-500"
            />
            {willAmend ? (
              <p className="mt-1 text-[11px] text-amber-800">
                Changing route, unit of measure, prescription type, dosage form, dosage, or frequency
                discontinues this line and adds a new one.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                Only start date, end date, and days stay on this line. Route, UOM, prescription type,
                dosage form, and similar details always create a new line.
              </p>
            )}
          </div>

        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 rounded-b-2xl bg-slate-50/50">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors">
            {disabled ? 'Close' : 'Cancel'}
          </button>
          {!disabled && (
            <button type="button" disabled={saving || givenCheck.loading} onClick={() => void handleSave()}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Saving...' : willAmend ? 'Discontinue & add new line' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
    {createFreqModal && (
      <CreateFrequencyMiniModal
        kind={createFreqModal}
        initialName={createFreqModal === 'long_acting' ? longActingFreqQuery : freqQuery}
        onClose={() => setCreateFreqModal(null)}
        onCreated={(opt) => {
          if (createFreqModal === 'long_acting') {
            setLongActingFreqOptions((prev) => (prev.some((p) => p.name === opt.name) ? prev : [...prev, opt]))
            updateField('long_acting_frequency', opt.name)
            setLongActingFreqQuery(opt.label || opt.name)
          } else {
            setFreqOptions((prev) => (prev.some((p) => p.name === opt.name) ? prev : [...prev, opt]))
            updateField('patient_frequency', opt.name)
            setFreqQuery(opt.label || opt.name)
          }
          setCreateFreqModal(null)
        }}
      />
    )}
    <PrescriptionDoseLimitConfirmModal
      open={doseLimitConfirmOpen}
      issues={
        doseWarning?.message
          ? [{ drugLabel: form.drug_name || form.drug, message: doseWarning.message }]
          : []
      }
      loading={saving}
      confirmLabel="Save anyway"
      onClose={() => {
        if (saving) return
        setDoseLimitConfirmOpen(false)
      }}
      onConfirm={() => void performSave()}
    />
    </>,
    document.body
  )
}

// ─── Add medication entry modal ──────────────────────────────────────────────
export const AddMedicationEntryModal = ({
  prescriptionName,
  patient,
  patientEncounter,
  inpatientRecord,
  onClose,
  onSaved,
}: {
  prescriptionName: string
  patient?: string
  patientEncounter?: string
  inpatientRecord?: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}) => {
  const [form, setForm] = useState({
    drug: '',
    drug_name: '',
    dosage: '',
    uom: 'UNIT',
    dosage_form: '',
    no_of_days: '',
    instructions: '',
    date: new Date().toISOString().split('T')[0],
    end_date: '',
    patient_frequency: '',
    route_of_administration: '',
    is_pink: false,
    reference_no: '',
    is_prn: false,
    is_long_acting: false,
    long_acting_frequency: '',
    medication_type: '',
    healthcare_practitioner: '',
  })
  const [saving, setSaving] = useState(false)
  const [doseWarning, setDoseWarning] = useState<PrescriptionDoseValidationPreview | null>(null)
  const [checkingDose, setCheckingDose] = useState(false)
  const [doseLimitInfo, setDoseLimitInfo] = useState<MedicineDoseLimitInfo | null>(null)
  const [loadingDoseLimitInfo, setLoadingDoseLimitInfo] = useState(false)
  const [doseLimitConfirmOpen, setDoseLimitConfirmOpen] = useState(false)
  const [drugQuery, setDrugQuery] = useState('')
  const [drugOpts, setDrugOpts] = useState<LinkFieldOption[]>([])
  const [drugLoading, setDrugLoading] = useState(false)

  const [addFreqQuery, setAddFreqQuery] = useState('')
  const [addFreqOptions, setAddFreqOptions] = useState<LinkFieldOption[]>([])
  const [addFreqLoading, setAddFreqLoading] = useState(false)
  const [addLongActingFreqQuery, setAddLongActingFreqQuery] = useState('Weekly')
  const [addLongActingFreqOptions, setAddLongActingFreqOptions] = useState<LinkFieldOption[]>([])
  const [addLongActingFreqLoading, setAddLongActingFreqLoading] = useState(false)
  const [addCreateFreqModal, setAddCreateFreqModal] = useState<CreateFrequencyKind | null>(null)
  const [addRouteQuery, setAddRouteQuery] = useState('')
  const [addRouteOptions, setAddRouteOptions] = useState<LinkFieldOption[]>([])
  const [addRouteLoading, setAddRouteLoading] = useState(false)
  const [addUomQuery, setAddUomQuery] = useState('UNIT')
  const [addUomOptions, setAddUomOptions] = useState<LinkFieldOption[]>([])
  const [addUomLoading, setAddUomLoading] = useState(false)
  const [addDosageForms, setAddDosageForms] = useState<LinkFieldOption[]>([])
  const [practitioners, setPractitioners] = useState<LinkFieldOption[]>([])
  const [practQuery, setPractQuery] = useState('')

  const formIsLongActing =
    Boolean(form.is_long_acting) || isLongActingPrescriptionType(String(form.medication_type || ''))

  useEffect(() => {
    fetchDosageForms().then(setAddDosageForms).catch(() => setAddDosageForms([]))
    fetchStandardUoms(undefined, { medicalOnly: true }).then(setAddUomOptions).catch(() => setAddUomOptions([]))
  }, [])

  // Same as Create Prescription: default doctor = Healthcare Practitioner linked to the logged-in user.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pract = await getCurrentUserPractitioner()
        if (cancelled || !pract) return
        setForm((f) => (f.healthcare_practitioner ? f : { ...f, healthcare_practitioner: pract }))
        const opts = await fetchHealthcarePractitioners(pract).catch(() => [])
        if (cancelled) return
        setPractitioners(opts)
        const match = opts.find((p) => p.name === pract)
        setPractQuery(match?.label || pract)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const addSearchUoms = async (q: string) => {
    setAddUomLoading(true)
    try { setAddUomOptions(await fetchStandardUoms(q || undefined, { medicalOnly: true })) }
    catch { setAddUomOptions([]) } finally { setAddUomLoading(false) }
  }

  const addUpdateFieldWithDateCalc = (field: string, value: unknown) => {
    setForm((f) => {
      const next = { ...f, [field]: value }
      if (field === 'date' || field === 'end_date' || field === 'no_of_days') {
        return syncPrescriptionEndDateAndDays(next, field, addDaysToDate, daysBetween)
      }
      return next
    })
  }

  const loadDrugOptions = (query: string) => {
    if (!query || query.length < 1) { setDrugOpts([]); return }
    setDrugLoading(true)
    fetchPrescriptionItems(query)
      .then((opts) => setDrugOpts(opts))
      .catch(() => setDrugOpts([]))
      .finally(() => setDrugLoading(false))
  }

  const addSearchFrequencies = async (q: string) => {
    setAddFreqLoading(true)
    try {
      setAddFreqOptions(await fetchPrescriptionFrequencies(q || undefined))
    } catch { setAddFreqOptions([]) } finally { setAddFreqLoading(false) }
  }
  const addSearchLongActingFrequencies = async (q: string) => {
    setAddLongActingFreqLoading(true)
    try {
      setAddLongActingFreqOptions(await fetchLongActingFrequencies(q || undefined))
    } catch { setAddLongActingFreqOptions([]) } finally { setAddLongActingFreqLoading(false) }
  }
  const addSearchRoutes = async (q: string) => {
    setAddRouteLoading(true)
    try {
      const all = await fetchRouteOfAdministrationList()
      setAddRouteOptions(!q.trim() ? all : all.filter(r => r.label?.toLowerCase().includes(q.toLowerCase()) || r.name?.toLowerCase().includes(q.toLowerCase())))
    } catch { setAddRouteOptions([]) } finally { setAddRouteLoading(false) }
  }

  useEffect(() => {
    const drug = (form.drug || '').trim()
    const dosage = (form.dosage || '').trim()
    if (!drug || !dosage) {
      setDoseWarning(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setCheckingDose(true)
      previewPrescriptionDoseValidation({
        medicine_code: drug,
        dose: dosage,
        patient,
        patient_encounter: patientEncounter,
        inpatient_record: inpatientRecord,
        route_of_administration: form.route_of_administration || undefined,
        is_long_acting: formIsLongActing ? 1 : 0,
      })
        .then((preview) => {
          if (!cancelled) {
            setDoseWarning(preview.has_limit && !preview.ok && preview.message ? preview : null)
          }
        })
        .catch(() => {
          if (!cancelled) setDoseWarning(null)
        })
        .finally(() => {
          if (!cancelled) setCheckingDose(false)
        })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    form.drug,
    form.dosage,
    form.route_of_administration,
    formIsLongActing,
    patient,
    patientEncounter,
    inpatientRecord,
  ])

  useEffect(() => {
    const drug = (form.drug || '').trim()
    if (!drug) {
      setDoseLimitInfo(null)
      return
    }
    let cancelled = false
    setLoadingDoseLimitInfo(true)
    fetchMedicineDoseLimitInfo(drug, formIsLongActing)
      .then((info) => {
        if (!cancelled) setDoseLimitInfo(info)
      })
      .catch(() => {
        if (!cancelled) setDoseLimitInfo(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingDoseLimitInfo(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.drug, formIsLongActing])

  const handleSave = async () => {
    if (!form.drug || !form.dosage || !form.date) {
      toast.error('Drug, Dosage, and Start Date are required')
      return
    }
    if (!String(form.healthcare_practitioner || '').trim()) {
      toast.error('Doctor is required')
      return
    }
    if (form.is_pink && !String(form.reference_no || '').trim() && !inpatientRecord) {
      toast.error('Reference No is required for pink medications')
      return
    }
    if (doseWarning?.message) {
      setDoseLimitConfirmOpen(true)
      return
    }
    await performSave()
  }

  const performSave = async () => {
    try {
      setSaving(true)
      const payload = normalizeMedicationOrderForSave(form)
      await addMedicationOrderEntry(prescriptionName, payload)
      toast.success('Medicine added to prescription')
      setDoseLimitConfirmOpen(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add medicine')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field: string, value: unknown) => {
    setForm((f) => {
      const next = { ...f, [field]: value }
      if (field === 'medication_type') {
        Object.assign(next, flagsFromPrescriptionType(String(value)))
        if (isLongActingPrescriptionType(String(value))) {
          const lf = next.long_acting_frequency || 'Weekly'
          next.long_acting_frequency = lf
          next.patient_frequency = lf
          setAddFreqQuery(lf)
          setAddLongActingFreqQuery(lf)
        }
      }
      if (field === 'long_acting_frequency') {
        next.patient_frequency = String(value)
        setAddFreqQuery(String(value))
      }
      return next
    })
  }

  return createPortal(
    <>
    <div
      className={CREATE_MODAL_OVERLAY}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={createModalShellClass('max-w-xl w-full max-h-[85vh]')}>
        <div className="px-6 py-4 border-b border-slate-200 shrink-0 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-emerald-950">Add Medicine</h2>
            <p className="text-xs text-slate-500 mt-0.5">Add a new medicine to the current prescription</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-2 text-emerald-800/70 transition hover:bg-emerald-200/50 hover:text-emerald-950">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Doctor *</label>
            <MiniCombobox
              value={form.healthcare_practitioner}
              displayValue={
                form.healthcare_practitioner
                  ? practitioners.find((p) => p.name === form.healthcare_practitioner)?.label || practQuery
                  : practQuery
              }
              placeholder="Search doctor..."
              options={practitioners}
              onQueryChange={(q) => {
                setPractQuery(q)
                setForm((f) => ({ ...f, healthcare_practitioner: '' }))
                fetchHealthcarePractitioners(q || undefined).then(setPractitioners).catch(() => {})
              }}
              onOpen={() => {
                fetchHealthcarePractitioners(practQuery || undefined).then(setPractitioners).catch(() => {})
              }}
              onSelect={(opt) => {
                setForm((f) => ({ ...f, healthcare_practitioner: opt.name }))
                setPractQuery(opt.label || opt.name)
              }}
              onClear={() => {
                setForm((f) => ({ ...f, healthcare_practitioner: '' }))
                setPractQuery('')
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Drug *</label>
            <MiniCombobox
              value={form.drug}
              displayValue={drugQuery}
              placeholder="Search drug..."
              options={drugOpts}
              loading={drugLoading}
              onQueryChange={(q) => { setDrugQuery(q); loadDrugOptions(q) }}
              onOpen={() => loadDrugOptions(drugQuery || '')}
              onSelect={async (opt) => {
                const route = (await resolvePrescriptionDrugRoute(opt)).trim()
                // Match create prescription: UOM defaults to UNIT
                const stockUom = 'UNIT'
                setForm((f) => ({
                  ...f,
                  drug: opt.name,
                  drug_name: opt.label || opt.name,
                  uom: stockUom,
                  is_pink: Boolean(opt.is_pink),
                  reference_no: opt.is_pink ? f.reference_no || '' : '',
                  ...(route ? { route_of_administration: route } : {}),
                }))
                setAddUomQuery(stockUom)
                if (route) {
                  let routes = addRouteOptions
                  if (!routes.length) {
                    routes = await fetchRouteOfAdministrationList().catch(() => [])
                    setAddRouteOptions(routes)
                  }
                  const match = routes.find((r) => r.name === route || r.label === route)
                  setAddRouteQuery(match?.label || match?.name || route)
                }
                setDrugQuery(opt.label || opt.name)
              }}
              onClear={() => { updateField('drug', ''); updateField('drug_name', ''); setDrugQuery('') }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Dosage *</label>
              <input value={form.dosage} onChange={(e) => updateField('dosage', e.target.value)} placeholder="45mg"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25" />
              {checkingDose ? (
                <p className="mt-1 text-xs text-slate-500">Checking dose limit…</p>
              ) : (
                <DoseLimitHint
                  info={doseLimitInfo}
                  loading={loadingDoseLimitInfo}
                  hasWarning={Boolean(doseWarning?.message)}
                  warningMessage={doseWarning?.message}
                  enteredDose={form.dosage}
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit of Measure</label>
              <MiniCombobox
                value={form.uom}
                displayValue={addUomQuery}
                placeholder="Type or select unit of measure…"
                options={addUomOptions}
                loading={addUomLoading}
                onQueryChange={(q) => { setAddUomQuery(q); addSearchUoms(q) }}
                onOpen={() => { if (addUomOptions.length === 0) addSearchUoms('') }}
                onSelect={(opt) => { updateField('uom', opt.name); setAddUomQuery(opt.label || opt.name) }}
                onClear={() => { updateField('uom', ''); setAddUomQuery('') }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Prescription Type</label>
              <select
                value={form.medication_type}
                onChange={(e) => updateField('medication_type', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
              >
                <option value="">— Select —</option>
                {SELECTABLE_PRESCRIPTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MED_TYPES.find((m) => m.key === t)?.label || t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Dosage Form</label>
              <select value={form.dosage_form} onChange={(e) => updateField('dosage_form', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25">
                <option value="">Select...</option>
                {addDosageForms.map((df) => <option key={df.name} value={df.name}>{df.label || df.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              {isLongActingPrescriptionType(form.medication_type) ? (
                <>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Long Acting Frequency</label>
                  <MiniCombobox
                    value={form.long_acting_frequency ?? ''}
                    displayValue={addLongActingFreqQuery}
                    placeholder="Select long acting frequency..."
                    options={addLongActingFreqOptions}
                    loading={addLongActingFreqLoading}
                    onCreateClick={() => setAddCreateFreqModal('long_acting')}
                    onQueryChange={(q) => { setAddLongActingFreqQuery(q); addSearchLongActingFrequencies(q) }}
                    onOpen={() => { if (addLongActingFreqOptions.length === 0) addSearchLongActingFrequencies('') }}
                    onSelect={(opt) => {
                      updateField('long_acting_frequency', opt.name)
                      updateField('patient_frequency', opt.name)
                      setAddLongActingFreqQuery(opt.label || opt.name)
                      setAddFreqQuery(opt.label || opt.name)
                    }}
                    onClear={() => {
                      updateField('long_acting_frequency', 'Weekly')
                      setAddLongActingFreqQuery('')
                    }}
                  />
                </>
              ) : (
                <>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Frequency</label>
                  <MiniCombobox
                    value={form.patient_frequency}
                    displayValue={addFreqQuery}
                    placeholder="Search frequency..."
                    options={addFreqOptions}
                    loading={addFreqLoading}
                    onCreateClick={() => setAddCreateFreqModal('regular')}
                    onQueryChange={(q) => { setAddFreqQuery(q); addSearchFrequencies(q) }}
                    onOpen={() => { if (addFreqOptions.length === 0) addSearchFrequencies('') }}
                    onSelect={(opt) => { updateField('patient_frequency', opt.name); setAddFreqQuery(opt.label || opt.name) }}
                    onClear={() => { updateField('patient_frequency', ''); setAddFreqQuery('') }}
                  />
                </>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Route</label>
              <MiniCombobox
                value={form.route_of_administration}
                displayValue={addRouteQuery}
                placeholder="Search route..."
                options={addRouteOptions}
                loading={addRouteLoading}
                onQueryChange={(q) => { setAddRouteQuery(q); addSearchRoutes(q) }}
                onOpen={() => { if (addRouteOptions.length === 0) addSearchRoutes('') }}
                onSelect={(opt) => { updateField('route_of_administration', opt.name); setAddRouteQuery(opt.label || opt.name) }}
                onClear={() => { updateField('route_of_administration', ''); setAddRouteQuery('') }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Date *</label>
              <DateFilterInput value={form.date} onChange={(e) => addUpdateFieldWithDateCalc('date', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
              <DateFilterInput value={form.end_date} onChange={(e) => addUpdateFieldWithDateCalc('end_date', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Days</label>
              <input type="number" min={1} step={1} value={form.no_of_days} onChange={(e) => addUpdateFieldWithDateCalc('no_of_days', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">Start + End Date → Days; or Start Date + Days → End Date. Clear End Date or Days to clear both.</p>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Instructions</label>
            <textarea value={form.instructions} onChange={(e) => updateField('instructions', e.target.value)}
              rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.is_pink}
                  onChange={(e) => {
                    const checked = e.target.checked
                    updateField('is_pink', checked)
                    if (!checked) updateField('reference_no', '')
                  }}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Is Pink
              </label>
            </div>
            {!!form.is_pink && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Reference No
                  {!inpatientRecord ? (
                    <span className="text-red-500"> *</span>
                  ) : (
                    <span className="text-slate-400 font-normal"> (optional)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={form.reference_no || ''}
                  onChange={(e) => updateField('reference_no', e.target.value)}
                  placeholder={inpatientRecord ? 'Optional for inpatient' : 'Enter reference number'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                />
              </div>
            )}
          </div>

        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 rounded-b-2xl bg-slate-50/50">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={() => void handleSave()}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium">
            {saving ? 'Adding...' : 'Add Medicine'}
          </button>
        </div>
      </div>
    </div>
    {addCreateFreqModal && (
      <CreateFrequencyMiniModal
        kind={addCreateFreqModal}
        initialName={addCreateFreqModal === 'long_acting' ? addLongActingFreqQuery : addFreqQuery}
        onClose={() => setAddCreateFreqModal(null)}
        onCreated={(opt) => {
          if (addCreateFreqModal === 'long_acting') {
            setAddLongActingFreqOptions((prev) => (prev.some((p) => p.name === opt.name) ? prev : [...prev, opt]))
            updateField('long_acting_frequency', opt.name)
            setAddLongActingFreqQuery(opt.label || opt.name)
          } else {
            setAddFreqOptions((prev) => (prev.some((p) => p.name === opt.name) ? prev : [...prev, opt]))
            updateField('patient_frequency', opt.name)
            setAddFreqQuery(opt.label || opt.name)
          }
          setAddCreateFreqModal(null)
        }}
      />
    )}
    <PrescriptionDoseLimitConfirmModal
      open={doseLimitConfirmOpen}
      issues={
        doseWarning?.message
          ? [{ drugLabel: form.drug_name || form.drug, message: doseWarning.message }]
          : []
      }
      loading={saving}
      confirmLabel="Add anyway"
      onClose={() => {
        if (saving) return
        setDoseLimitConfirmOpen(false)
      }}
      onConfirm={() => void performSave()}
    />
    </>,
    document.body
  )
}

// ─── Table row ────────────────────────────────────────────────────────────────
const MedicationRow = ({
  order,
  prescriptionName,
  prescriptionPractitioner,
  onUpdated,
  onEdit,
  readOnly = false,
  givenInfo,
  parentStartDate,
  parentEndDate,
  historyPrescriptionName,
}: {
  order: any
  prescriptionName: string
  prescriptionPractitioner: {
    healthcare_practitioner_name?: string
    healthcare_practitioner?: string
    practitioner?: string
    user_name?: string
  }
  onUpdated: () => void | Promise<void>
  onEdit: () => void
  readOnly?: boolean
  givenInfo?: { has_given: boolean; count: number }
  parentStartDate?: string
  parentEndDate?: string
  /** When set, show a Prescription ID column (history view). */
  historyPrescriptionName?: string
}) => {
  const isFuture = isFuturePlanByStartDate(order)
  const typeForDisplay = resolveMedicationTypeForDisplay(
    isFuture ? 'Future Plan' : order.medication_type,
    order.is_prn,
  )
  const typeLabel = getMedicationTypeLabel(typeForDisplay, order.is_prn)
  const color = getTypeColor(typeForDisplay || (isFuture ? 'Future Plan' : order.medication_type))
  const rowStyle = isHex(color) ? hexRowStyle(color) : {}
  const reasonStopped = String(order.reason_stopped || '').trim()
  const isStopped = isMedicationStopped(order)
  const isLegacyRow = isLegacyMedicationOrderRow(order)
  const displayDrugName = displayMedicationDrugName(order)
  const displayDrugCode = displayMedicationDrugCode(order)
  const displayDosage = displayMedicationDosage(order)
  const displayFrequency = displayMedicationFrequency(order)
  const instructionTooltip = displayMedicationInstructionTooltip(order)
  const displayRoute = displayMedicationRoute(order)
  const displayPractitioner = displayPrescriptionPractitioner(prescriptionPractitioner, order)
  const displayStartDate = displayMedicationStartDate(order, parentStartDate)
  const displayEndDate = displayMedicationEndDate(order, parentEndDate)

  const [menuOpen, setMenuOpen] = useState(false)
  const [stopModalOpen, setStopModalOpen] = useState(false)
  const [stopModalMode, setStopModalMode] = useState<'stop' | 'edit'>('stop')
  const [reasonDraft, setReasonDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const openStopModal = (mode: 'stop' | 'edit') => {
    setStopModalMode(mode)
    setReasonDraft(mode === 'edit' ? reasonStopped : '')
    setStopModalOpen(true)
    setMenuOpen(false)
  }

  const handleSaveStopReason = async () => {
    const text = reasonDraft.trim()
    if (!text) {
      toast.error('Please enter a stop reason.')
      return
    }
    try {
      setSaving(true)
      await saveMedicationOrderEntryStopReason(prescriptionName, order.name, { reasonStopped: text })
      toast.success(stopModalMode === 'edit' ? 'Stop reason updated' : 'Medication marked as stopped')
      setStopModalOpen(false)
      await onUpdated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save stop reason')
    } finally {
      setSaving(false)
    }
  }

  const handleResume = async () => {
    if (!window.confirm('Clear the stop and resume this medication line?')) return
    try {
      setSaving(true)
      await saveMedicationOrderEntryStopReason(prescriptionName, order.name, { clear: true })
      toast.success('Stop cleared — line active again')
      setMenuOpen(false)
      await onUpdated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to clear stop')
    } finally {
      setSaving(false)
    }
  }

  const stopModal =
    stopModalOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setStopModalOpen(false)
            }}
          >
            <div className="w-full max-w-md rounded-lg bg-white shadow-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {stopModalMode === 'edit' ? 'Change stop reason' : 'Stop medication'}
              </h3>
              <p className="text-xs text-slate-500">
                {stopModalMode === 'edit'
                  ? 'Update the reason documented for stopping this line.'
                  : 'This line will show as stopped. Enter a clinical reason (required).'}
              </p>
              <label className="block text-xs font-medium text-slate-600">Reason stopped</label>
              <textarea
                value={reasonDraft}
                onChange={(e) => setReasonDraft(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-400/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                placeholder="e.g. Side effects, replaced by X, patient refused…"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStopModalOpen(false)}
                  className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveStopReason()}
                  className="px-3 py-1.5 text-sm rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      {stopModal}
      <tr
        className={`${order.is_pink ? 'bg-pink-50/60' : ''} ${isStopped ? 'opacity-90' : ''}`}
        style={!order.is_pink && isHex(color) ? rowStyle : undefined}
      >
        <td className="px-3 py-2.5 min-w-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 min-w-0">
              <span
                className={`font-medium ${isStopped ? 'text-slate-500 line-through' : 'text-slate-800'}`}
              >
                {displayDrugName}
              </span>
              <CardRowPopoverHint content={instructionTooltip} title="Instructions" />
              {isStopped && <SmallBadge cls="bg-rose-100 text-rose-800 border border-rose-200">Stopped</SmallBadge>}
              {isLegacyRow && <SmallBadge cls="bg-amber-100 text-amber-800 border border-amber-200">Legacy</SmallBadge>}
              {order.is_pink && <SmallBadge cls="bg-pink-100 text-pink-700">🩷 Pink</SmallBadge>}
              {order.is_pink && order.reference_no ? (
                <SmallBadge cls="bg-pink-50 text-pink-800 border border-pink-200">Ref: {order.reference_no}</SmallBadge>
              ) : null}
              {typeLabel ? (
                <span
                  className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={medicationTypeBadgeStyle(typeForDisplay)}
                >
                  {typeLabel}
                </span>
              ) : null}
              {order.is_long_acting_medicine && typeForDisplay !== 'Long Acting Medicine' ? (
                <SmallBadge cls="bg-teal-100 text-teal-700">⏳ Long Acting</SmallBadge>
              ) : null}
              {isFuture && typeForDisplay !== 'Future Plan' ? (
                <SmallBadge cls="bg-indigo-100 text-indigo-800 border border-indigo-200">📅 Future Plan</SmallBadge>
              ) : null}
            </div>
            {displayDrugCode && displayDrugCode !== '-' ? (
              <div className="hidden w-full text-xs text-slate-400 tabular-nums" aria-hidden="true">
                {displayDrugCode}
              </div>
            ) : null}
          </div>
          {isLegacyRow && (
            <div className="mt-1 text-[11px] text-slate-500 space-x-2">
              {order.trans_num ? <span>IP Med: {order.trans_num}</span> : null}
              {order.redundancy_type ? <span>Redundancy: {order.redundancy_type}</span> : null}
            </div>
          )}
          {isStopped && (
            <div
              className="mt-1.5 text-xs text-rose-800 bg-rose-50/80 border border-rose-100 rounded px-2 py-1 max-w-md"
              title={reasonStopped || undefined}
            >
              {reasonStopped ? (
                <>
                  <span className="font-semibold text-rose-900">Reason: </span>
                  {reasonStopped}
                </>
              ) : (
                <span className="font-semibold text-rose-900">Discontinued / stopped</span>
              )}
            </div>
          )}
        </td>
        {historyPrescriptionName ? (
          <td className="px-3 py-2.5">
            <span className="font-mono text-xs text-slate-600">{historyPrescriptionName}</span>
          </td>
        ) : null}
        <td className="px-3 py-2.5">
          <span className="font-medium text-slate-800">{displayDosage}</span>
          <span className="text-slate-500 text-xs ml-1">{order.uom}</span>
        </td>
        <td className="px-3 py-2.5 text-slate-600 text-sm">{order.dosage_form}</td>
        <td className="px-3 py-2.5">
          <SmallBadge cls="bg-blue-100 text-blue-700">{displayFrequency}</SmallBadge>
          {order.frequency_in_a_day > 0 && (
            <div className="text-xs text-slate-400 mt-0.5">{order.frequency_in_a_day}×/day</div>
          )}
        </td>
        <td className="px-3 py-2.5 text-slate-600 text-xs">{displayRoute}</td>
        <td className="px-3 py-2.5 text-slate-600 text-xs">{displayPractitioner}</td>
        <td className="px-3 py-2.5 text-xs text-slate-500">
          <div>{displayStartDate}</div>
          <div className="text-slate-400">→ {displayEndDate}</div>
        </td>
        <td className="px-3 py-2.5">
          {isStopped ? (
            <SmallBadge cls="bg-rose-100 text-rose-800">Stopped</SmallBadge>
          ) : isLegacyRow || givenInfo?.has_given ? (
            <SmallBadge cls="bg-green-100 text-green-700">Given</SmallBadge>
          ) : (
            <SmallBadge cls="bg-amber-100 text-amber-700">Not Given</SmallBadge>
          )}
        </td>
        {!readOnly && (
        <td className="px-3 py-2.5 text-right align-middle">
          <div className="inline-flex items-center gap-1">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              title="Actions"
              aria-label="Row actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
          <PortalActionsMenu open={menuOpen} onClose={() => setMenuOpen(false)} triggerRef={triggerRef} placement="below-right">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
              className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Edit Prescription
            </button>
            <button
              type="button"
              disabled={isStopped}
              onClick={() => openStopModal('stop')}
              className="block w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Stop medication…
            </button>
            <button
              type="button"
              disabled={!isStopped}
              onClick={() => openStopModal('edit')}
              className="block w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Change stop reason…
            </button>
            <button
              type="button"
              disabled={!isStopped}
              onClick={() => {
                setMenuOpen(false)
                void handleResume()
              }}
              className="block w-full text-left px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Resume medication
            </button>
          </PortalActionsMenu>
        </td>
        )}
      </tr>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
// interface RxPageProps {
//   inpatientRecordId?: string | null
//   patientEncounterId?: string | null
// }

export const RxPage = ({ readOnly = false }: { readOnly?: boolean } = {}) => {
  const {
    selectedPatient,
    mode,
    activeVisit,
    activeAdmission,
    guardClinicalCreate,
    guardClinicalEdit,
  } = useCareContext()
  const [prescription, setPrescription] = useState<Prescription | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeType, setActiveType] = useState(DEFAULT_PRESCRIPTION_TYPE_FILTER)
  const [showTypeFilters, setShowTypeFilters] = useState(true)
  const [showCreatePrescriptionModal, setShowCreatePrescriptionModal] = useState(false)
  const [showEditPrescriptionModal, setShowEditPrescriptionModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [duplicateSource, setDuplicateSource] = useState<Prescription | null>(null)
  const [salesOrderLoading, setSalesOrderLoading] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const headerMenuRef = useRef<HTMLButtonElement>(null)

  const [editingOrder, setEditingOrder] = useState<any>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showSignModal, setShowSignModal] = useState(false)
  const [givenStatus, setGivenStatus] = useState<Record<string, { has_given: boolean; count: number }>>({})

  /** Same layout as current Rx, but all patient prescriptions (type filters kept). */
  const [showHistory, setShowHistory] = useState(false)
  const [historyOrders, setHistoryOrders] = useState<any[]>([])
  const [historyRxCount, setHistoryRxCount] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const load = async () => {
    const inpatientRecordId = mode === 'IP' ? activeAdmission : null
    const patientEncounterId = mode === 'OP' ? activeVisit : null

    if (!inpatientRecordId && !patientEncounterId) {
      setPrescription(null)
      setGivenStatus({})
      return
    }

    setLoading(true)
    setError(null)
    try {
      const data = await fetchPrescriptionByInpatientOrEncounter(inpatientRecordId, patientEncounterId)
      setPrescription(data)
      const rxNames = [
        ...new Set(
          [
            data?.name,
            ...(data?.active_prescriptions || []).map((r) => r.name),
            ...(data?.medication_orders || []).map((o: any) => o.parent || o._prescription_name),
          ].filter(Boolean) as string[],
        ),
      ]
      if (rxNames.length) {
        try {
          const statusMaps = await Promise.all(
            rxNames.map((name) => getGivenStatusForPrescription(name).catch(() => ({}))),
          )
          setGivenStatus(Object.assign({}, ...statusMaps))
        } catch {
          setGivenStatus({})
        }
      } else {
        setGivenStatus({})
      }
    } catch (e) {
      setError('Could not load prescription.')
      setPrescription(null)
      setGivenStatus({})
    } finally {
      setLoading(false)
    }
  }

  const loadHistory = async () => {
    if (!selectedPatient) {
      setHistoryOrders([])
      setHistoryRxCount(0)
      return
    }
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const list = await fetchPrescriptions(200, 0, { patient: selectedPatient })
      setHistoryRxCount(list.length)
      const orders = list.flatMap((rx) =>
        (rx.medication_orders || []).map((order) => ({
          ...order,
          _rx_name: rx.name,
          _rx_start: rx.start_date,
          _rx_end: rx.end_date,
          _rx_status: rx.status,
          _rx_practitioner: {
            healthcare_practitioner_name: rx.healthcare_practitioner_name,
            healthcare_practitioner: rx.healthcare_practitioner,
            practitioner: rx.practitioner,
            user_name: rx.user_name,
          },
        })),
      )
      setHistoryOrders(orders)
    } catch {
      setHistoryError('Could not load prescription history.')
      setHistoryOrders([])
      setHistoryRxCount(0)
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    setActiveType(DEFAULT_PRESCRIPTION_TYPE_FILTER)
    setShowHistory(false)
    if ((mode === 'OP' && activeVisit) || (mode === 'IP' && activeAdmission)) {
      load()
    } else {
      setPrescription(null)
    }
  }, [mode, activeVisit, activeAdmission, selectedPatient])

  useEffect(() => {
    if (!showHistory) return
    setActiveType(DEFAULT_PRESCRIPTION_TYPE_FILTER)
    void loadHistory()
  }, [showHistory, selectedPatient])

  if (!selectedPatient) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
        <span className="text-4xl">💊</span>
        <p className="text-sm">Select a patient to view their prescription.</p>
      </div>
    )
  }

  const historyToggleButton = showHistory ? (
    <button
      type="button"
      onClick={() => setShowHistory(false)}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      title="Back to current prescription"
    >
      Current
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setShowHistory(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      title="View all medications across every prescription"
    >
      <History className="h-3.5 w-3.5" />
      History
    </button>
  )

  // ── History: same type filters, all prescriptions for this patient ──
  if (showHistory) {
    const countFor = (key: string) =>
      historyOrders.filter((o) => matchesPrescriptionTypeFilter(o, key)).length
    const filteredOrders = historyOrders.filter((o) =>
      matchesPrescriptionTypeFilter(o, activeType)
    )
    const activeTypeDef = MED_TYPES.find((t) => t.key === activeType)

    return (
      <div className="flex flex-col h-full">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide leading-none mb-0.5">
                Prescription History
              </p>
              <h1 className="text-base font-bold text-slate-900 leading-none">
                All medications
                <span className="ml-2 text-xs font-medium text-slate-500">
                  {historyRxCount} prescription{historyRxCount === 1 ? '' : 's'} · {historyOrders.length}{' '}
                  line{historyOrders.length === 1 ? '' : 's'}
                </span>
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTypeFilters((prev) => !prev)}
                className={`p-1.5 rounded-md border transition-colors ${
                  showTypeFilters
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                }`}
                title={showTypeFilters ? 'Hide medicine type filters' : 'Show medicine type filters'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void loadHistory()}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
              </button>
              {historyToggleButton}
            </div>
          </div>

          {showTypeFilters && (
            <div className="flex flex-wrap gap-2">
              {MED_TYPES.map((typeDef) => (
                <TypeFilterCard
                  key={typeDef.key}
                  typeDef={typeDef}
                  count={countFor(typeDef.key)}
                  isActive={activeType === typeDef.key}
                  onClick={() => setActiveType(typeDef.key)}
                />
              ))}
            </div>
          )}

          {activeType !== 'All' && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Showing:</span>
              <span className="font-medium text-slate-700">
                {activeTypeDef?.icon} {activeTypeDef?.label}
              </span>
              <span className="text-slate-400">
                ({filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'})
              </span>
              <button onClick={() => setActiveType('All')} className="text-blue-500 hover:underline ml-1">
                Clear
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {historyLoading ? (
            <div className="flex items-center justify-center h-40 text-slate-500 gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading history…</span>
            </div>
          ) : historyError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {historyError}
              <button onClick={() => void loadHistory()} className="ml-3 underline hover:no-underline">
                Retry
              </button>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2 border border-dashed border-slate-200 rounded-lg">
              <span className="text-2xl">{activeTypeDef?.icon}</span>
              <p className="text-sm">
                No orders for <strong>{activeTypeDef?.label}</strong>
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    {['Drug', 'Prescription', 'Dosage', 'Form', 'Frequency', 'Route', 'Practitioner', 'Period', 'Status'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-3 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide text-left"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredOrders.map((order: any) => (
                    <MedicationRow
                      key={`${order._rx_name}-${order.name}`}
                      order={order}
                      prescriptionName={order._rx_name}
                      prescriptionPractitioner={order._rx_practitioner || {}}
                      onUpdated={loadHistory}
                      onEdit={() => undefined}
                      readOnly
                      parentStartDate={order._rx_start}
                      parentEndDate={order._rx_end}
                      historyPrescriptionName={order._rx_name}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  if ((mode === 'OP' && !activeVisit) || (mode === 'IP' && !activeAdmission)) {
    return (
      <div className="flex flex-col h-full min-h-[240px]">
        <div className="flex items-center justify-end px-4 pt-3">
          {historyToggleButton}
        </div>
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
          <span className="text-4xl">📋</span>
          <p className="text-sm">
            {mode === 'OP' ? 'Select an OP visit to view prescription.' : 'Select an IP admission to view prescription.'}
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading prescription…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
        <button onClick={() => load()} className="ml-3 underline hover:no-underline">
          Retry
        </button>
      </div>
    )
  }

  const contextLabel = mode === 'OP' ? 'Outpatient visit' : 'Inpatient admission'
  const contextId = mode === 'OP' ? activeVisit : activeAdmission

  const isIpPrescription = (rx?: Prescription | null) =>
    Boolean(rx?.inpatient_record) || rx?.care_context === 'Inpatient Admission' || mode === 'IP'

  const canAddMedicationToPrescription = (rx?: Prescription | null) => {
    if (!rx || readOnly) return false
    if (prescriptionNeedsSignature(rx)) return true
    return prescriptionIsSigned(rx) && isIpPrescription(rx)
  }

  const showSignedIpAddButton = (rx?: Prescription | null) =>
    Boolean(rx && !readOnly && prescriptionIsSigned(rx) && isIpPrescription(rx))

  const openDuplicatePrescription = (rx: Prescription) => {
    setHeaderMenuOpen(false)
    void (async () => {
      try {
        const full = await fetchPrescription(rx.name)
        setDuplicateSource(full || rx)
      } catch {
        setDuplicateSource(rx)
      }
      setShowDuplicateModal(true)
    })()
  }

  const handleCreateSalesOrder = async (rx: Prescription) => {
    try {
      setSalesOrderLoading(true)
      setHeaderMenuOpen(false)
      const res = await createPrescriptionSalesOrder(rx.name)
      await load()
      toast.success(`Sales Order ${res.sales_order} created as Draft`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create Service Bill'
      toast.error(msg)
    } finally {
      setSalesOrderLoading(false)
    }
  }

  const handleEditSalesOrder = (rx: Prescription) => {
    if (!rx.reference_document_name) return
    setHeaderMenuOpen(false)
    window.open(`/app/sales-order/${encodeURIComponent(rx.reference_document_name)}`, '_blank')
  }

  const renderHeaderActions = (hasPrescription: boolean, rx?: Prescription | null) => (
    <div className="flex items-center gap-2">
      <IpMedicationPlanPrintButton />
      <button
        type="button"
        onClick={() => hasPrescription && setShowTypeFilters((prev) => !prev)}
        disabled={!hasPrescription}
        className={`p-1.5 rounded-md border transition-colors ${
          !hasPrescription
            ? 'border-slate-200 text-slate-300 cursor-not-allowed'
            : showTypeFilters
              ? 'bg-primary/10 border-primary text-primary'
              : 'border-slate-300 text-slate-500 hover:bg-slate-50'
        }`}
        title={
          hasPrescription
            ? showTypeFilters
              ? 'Hide medicine type filters'
              : 'Show medicine type filters'
            : 'Medicine type filters available after a prescription is created'
        }
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
          />
        </svg>
      </button>
      {!readOnly && !showSignedIpAddButton(rx) && (
        <button
          type="button"
          onClick={() =>
            guardClinicalCreate(() => {
              if (hasPrescription) {
                setShowAddModal(true)
              } else {
                setShowCreatePrescriptionModal(true)
              }
            })
          }
          className="inline-flex items-center justify-center rounded-md bg-primary text-white p-1.5 hover:bg-primary/90 transition-colors"
          title={hasPrescription ? 'Add new medicine' : 'Create prescription'}
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
      {showSignedIpAddButton(rx) && (
        <button
          type="button"
          onClick={() => guardClinicalCreate(() => setShowAddModal(true))}
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
        >
          Add Medication
        </button>
      )}
      {!readOnly && hasPrescription && (
        <div className="relative inline-block">
          <button
            ref={headerMenuRef}
            type="button"
            onClick={() => setHeaderMenuOpen((o) => !o)}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Actions"
            aria-label="Prescription actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          <PortalActionsMenu
            open={headerMenuOpen}
            onClose={() => setHeaderMenuOpen(false)}
            triggerRef={headerMenuRef}
            placement="below-right"
            minWidth={200}
          >
            {rx && prescriptionNeedsSignature(rx) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    guardClinicalEdit(() => setShowEditPrescriptionModal(true))
                  }}
                  className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Edit Prescription
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    setShowSignModal(true)
                  }}
                  className="block w-full text-left px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
                >
                  Sign Prescription
                </button>
              </>
            )}
            {canAddMedicationToPrescription(rx) && (
              <button
                type="button"
                onClick={() => {
                  setHeaderMenuOpen(false)
                  guardClinicalCreate(() => setShowAddModal(true))
                }}
                className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Add Medication
              </button>
            )}
            {rx && (
              <>
                <button
                  type="button"
                  onClick={() => openDuplicatePrescription(rx)}
                  className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false)
                    window.open(
                      `/app/patient-medication-order/${encodeURIComponent(rx.name)}`,
                      '_blank',
                    )
                  }}
                  className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Open in Form
                </button>
                {rx.reference_doctype === 'Sales Order' && rx.reference_document_name ? (
                  <button
                    type="button"
                    onClick={() => handleEditSalesOrder(rx)}
                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Edit Sales Order
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={salesOrderLoading}
                    onClick={() => void handleCreateSalesOrder(rx)}
                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {salesOrderLoading ? 'Creating Service Bill…' : 'Create Service Bill'}
                  </button>
                )}
              </>
            )}
          </PortalActionsMenu>
        </div>
      )}
      <button
        type="button"
        onClick={() => load()}
        className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        title="Refresh"
      >
        <RefreshCw className="w-4 h-4" />
      </button>
      {historyToggleButton}
    </div>
  )

  if (!prescription) {
    return (
      <div className="flex flex-col h-full min-h-[320px]">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide leading-none mb-0.5">
                Current Prescription — {contextLabel}
              </p>
              <h1 className="text-base font-bold text-slate-900 leading-none font-mono">{contextId}</h1>
            </div>
            {renderHeaderActions(false)}
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center text-slate-400 gap-2 px-4 py-12">
          <span className="text-4xl">📋</span>
          <p className="text-sm text-center">
            No prescription found for this {mode === 'OP' ? 'visit' : 'admission'}.
          </p>
          {!readOnly && (
            <p className="text-xs text-slate-500 text-center max-w-sm">
              Use the <strong>+</strong> button above to create a prescription (same as All Prescriptions).
            </p>
          )}
        </div>
        {showCreatePrescriptionModal && selectedPatient && (
          <CreatePrescriptionModal
            onClose={() => setShowCreatePrescriptionModal(false)}
            onSuccess={() => {
              setShowCreatePrescriptionModal(false)
              load()
            }}
            initialPatient={selectedPatient}
            initialCareContext={mode === 'IP' ? 'Inpatient Admission' : 'Patient Visit'}
            initialInpatientRecord={mode === 'IP' ? activeAdmission ?? undefined : undefined}
            initialPatientEncounter={mode === 'OP' ? activeVisit ?? undefined : undefined}
          />
        )}
      </div>
    )
  }

  const orders = prescription.medication_orders || []
  const activePrescriptions = prescription.active_prescriptions?.length
    ? prescription.active_prescriptions
    : [{ name: prescription.name, status: prescription.status }]
  const practitionerForOrder = (order: any) => {
    const parentName = order.parent || order._prescription_name || prescription.name
    const fromActive = activePrescriptions.find((r) => r.name === parentName)
    if (fromActive) {
      return {
        healthcare_practitioner_name: fromActive.healthcare_practitioner_name,
        healthcare_practitioner: fromActive.healthcare_practitioner,
        practitioner: fromActive.practitioner,
        user_name: fromActive.user_name,
      }
    }
    return {
      healthcare_practitioner_name: prescription.healthcare_practitioner_name,
      healthcare_practitioner: prescription.healthcare_practitioner,
      practitioner: prescription.practitioner,
      user_name: prescription.user_name,
    }
  }
  const orderForTypeFilter = (order: any) => {
    if (order.end_date || order._rx_end) return order
    const parentName = order.parent || order._prescription_name || prescription.name
    const fromActive = activePrescriptions.find((r) => r.name === parentName) as
      | { end_date?: string }
      | undefined
    return {
      ...order,
      _rx_end: fromActive?.end_date || prescription.end_date,
    }
  }
  const countFor = (key: string) =>
    orders.filter((o: any) => matchesPrescriptionTypeFilter(orderForTypeFilter(o), key)).length
  const filteredOrders = orders.filter((o: any) =>
    matchesPrescriptionTypeFilter(orderForTypeFilter(o), activeType)
  )
  const activeTypeDef = MED_TYPES.find((t) => t.key === activeType)
  const completionPct =
    (prescription.total_orders ?? 0) > 0
      ? Math.round(((prescription.completed_orders ?? 0) / (prescription.total_orders ?? 0)) * 100)
      : 0

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide leading-none mb-0.5">
                Prescription - {mode === 'OP' ? 'Outpatient' : 'Inpatient'}
                {activePrescriptions.length > 1 ? (
                  <span className="ml-1 text-slate-500 normal-case tracking-normal">
                    · {activePrescriptions.length} active orders
                  </span>
                ) : null}
              </p>
              <h1 className="text-base font-bold text-slate-900 leading-none">
                {activePrescriptions.map((rx, i) => (
                  <span key={rx.name}>
                    {i > 0 ? <span className="text-slate-300 font-normal"> · </span> : null}
                    <span className="font-mono">{rx.name}</span>
                    {rx.status ? (
                      <span
                        className={`ml-1.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
                          rx.status === 'Signed'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : rx.status === 'Unsigned'
                              ? 'bg-orange-100 text-orange-800 border-orange-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {rx.status}
                      </span>
                    ) : null}
                  </span>
                ))}
                {prescription.is_pink && (
                  <span className="ml-2 text-xs font-medium text-pink-500">🩷 Pink</span>
                )}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">
                {prescription.completed_orders} / {prescription.total_orders} completed
              </div>
              <div className="w-36 bg-slate-100 rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>
            {renderHeaderActions(true, prescription)}
          </div>
        </div>

        {showTypeFilters && (
          <div className="flex flex-wrap gap-2">
            {MED_TYPES.map((typeDef) => (
              <TypeFilterCard
                key={typeDef.key}
                typeDef={typeDef}
                count={countFor(typeDef.key)}
                isActive={activeType === typeDef.key}
                onClick={() => setActiveType(typeDef.key)}
              />
            ))}
          </div>
        )}

        {activeType !== 'All' && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Showing:</span>
            <span className="font-medium text-slate-700">
              {activeTypeDef?.icon} {activeTypeDef?.label}
            </span>
            <span className="text-slate-400">
              ({filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'})
            </span>
            <button onClick={() => setActiveType('All')} className="text-blue-500 hover:underline ml-1">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2 border border-dashed border-slate-200 rounded-lg">
            <span className="text-2xl">{activeTypeDef?.icon}</span>
            <p className="text-sm">
              No orders for <strong>{activeTypeDef?.label}</strong>
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {(
                    activePrescriptions.length > 1
                      ? ['Drug', 'Prescription', 'Dosage', 'Form', 'Frequency', 'Route', 'Practitioner', 'Period', 'Status', ...(readOnly ? [] : ['Actions'])]
                      : ['Drug', 'Dosage', 'Form', 'Frequency', 'Route', 'Practitioner', 'Period', 'Status', ...(readOnly ? [] : ['Actions'])]
                  ).map(
                    (h) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide ${
                          h === 'Actions' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredOrders.map((order: any) => (
                  <MedicationRow
                    key={`${order.parent || prescription.name}:${order.name}`}
                    order={order}
                    prescriptionName={order.parent || order._prescription_name || prescription.name}
                    prescriptionPractitioner={practitionerForOrder(order)}
                    onUpdated={load}
                    onEdit={() => guardClinicalEdit(() => setEditingOrder(order))}
                    readOnly={readOnly}
                    givenInfo={givenStatus[order.name]}
                    parentStartDate={prescription.start_date}
                    parentEndDate={prescription.end_date}
                    historyPrescriptionName={
                      activePrescriptions.length > 1
                        ? order.parent || order._prescription_name || prescription.name
                        : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingOrder && (
        <EditMedicationEntryModal
          order={editingOrder}
          prescriptionName={
            editingOrder.parent || editingOrder._prescription_name || prescription.name
          }
          patient={prescription.patient}
          patientEncounter={prescription.patient_encounter}
          inpatientRecord={prescription.inpatient_record}
          onClose={() => setEditingOrder(null)}
          onSaved={() => {
            setEditingOrder(null)
            load()
          }}
        />
      )}

      {showAddModal && (
        <AddMedicationEntryModal
          prescriptionName={prescription.name}
          patient={prescription.patient}
          patientEncounter={prescription.patient_encounter}
          inpatientRecord={prescription.inpatient_record}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false)
            load()
          }}
        />
      )}

      {showSignModal && prescription && (
        <SignPrescriptionModal
          prescriptionName={prescription.name}
          currentSignature={prescription.doctors_signature}
          status={prescription.status}
          newSystem={prescription.new_system}
          onClose={() => setShowSignModal(false)}
          onSigned={() => {
            setShowSignModal(false)
            load()
          }}
        />
      )}

      {showEditPrescriptionModal && prescription && selectedPatient && (
        <CreatePrescriptionModal
          editMode
          prescriptionData={prescription}
          initialPatient={prescription.patient || selectedPatient}
          initialCareContext={
            prescription.patient_encounter || prescription.after_discharge
              ? 'Patient Visit'
              : prescription.care_context === 'Inpatient Admission'
                ? 'Inpatient Admission'
                : mode === 'IP'
                  ? 'Inpatient Admission'
                  : 'Patient Visit'
          }
          initialPatientEncounter={prescription.patient_encounter || activeVisit || undefined}
          initialInpatientRecord={prescription.inpatient_record || activeAdmission || undefined}
          onClose={() => setShowEditPrescriptionModal(false)}
          onSuccess={() => {
            setShowEditPrescriptionModal(false)
            load()
          }}
        />
      )}

      {showDuplicateModal && duplicateSource && selectedPatient && (
        <CreatePrescriptionModal
          onClose={() => {
            setShowDuplicateModal(false)
            setDuplicateSource(null)
          }}
          onSuccess={() => {
            setShowDuplicateModal(false)
            setDuplicateSource(null)
            toast.success('Prescription duplicated successfully')
            load()
          }}
          initialPatient={selectedPatient}
          initialCareContext={mode === 'IP' ? 'Inpatient Admission' : 'Patient Visit'}
          initialPatientEncounter={mode === 'OP' ? activeVisit ?? undefined : undefined}
          initialInpatientRecord={mode === 'IP' ? activeAdmission ?? undefined : undefined}
          initialMedications={(duplicateSource.medication_orders || []).map(
            mapOrderToDuplicateMedication,
          )}
          initialPractitioner={duplicateSource.practitioner || duplicateSource.healthcare_practitioner}
        />
      )}
    </div>
  )
}
