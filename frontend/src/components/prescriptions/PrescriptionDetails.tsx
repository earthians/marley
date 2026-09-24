import { useState, useEffect } from 'react'
import { fetchPrescription, setMedicationEntryStatus, type Prescription, type MedicationAction, mapOrderToDuplicateMedication } from '../../services/prescriptions'
import {
  fetchHealthcarePractitioners,
  getCurrentUserPractitionerOption,
  type LinkFieldOption,
} from '../../services/common'
import { useAuth } from '../../providers/AuthProvider'
import { toast } from '../../hooks/useToast'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { SignPrescriptionModal } from './SignPrescriptionModal'
import { CreatePrescriptionModal } from './CreatePrescriptionModal'
import { CreateSubscriptionPlanModal } from './CreateSubscriptionPlanModal'
import { AddMedicationEntryModal } from './SinglePrescription'
import { prescriptionNeedsSignature, prescriptionIsSigned } from '../../utils/prescriptionSigning'
import { attachFileDisplayUrl } from '../ui/SignaturePad'
import {
  displayMedicationDosage,
  displayMedicationDrugCode,
  displayMedicationDrugName,
  displayMedicationEndDate,
  displayMedicationFrequency,
  displayMedicationInstructions,
  displayMedicationRoute,
  displayMedicationStartDate,
  displayPrescriptionPractitioner,
  isLegacyMedicationOrderRow,
} from '../../utils/medicationOrderDisplayUtils'
import {
  matchesPrescriptionTypeFilter,
  isFuturePlanByStartDate,
  normalizePrescriptionType,
} from '../../utils/prescriptionType'

// ─── Medication type definitions ──────────────────────────────────────────────
const MED_TYPES = [
  { key: 'All',                        label: 'All',             icon: '💊', color: 'slate'   },
  { key: 'STAT',                       label: 'STAT',            icon: '⚡', color: '#fe80c0' },
  { key: 'PRN',                        label: 'PRN',             icon: '🔔', color: '#fefebf' },
  { key: 'Regular - Psy (Active)',     label: 'Reg Psy Active',  icon: '🧠', color: '#00ff02' },
  { key: 'Regular - Med (Active)',     label: 'Reg Med Active',  icon: '💉', color: '#4080e1' },
  { key: 'Regular - Psy (Inactive)',   label: 'Reg Psy Inactive',icon: '🧠', color: 'slate'   },
  { key: 'Regular - Med (Inactive)',   label: 'Reg Med Inactive',icon: '💉', color: 'slate'   },
  { key: 'Long Acting Medicine',       label: 'Long Acting',     icon: '⏳', color: 'teal'    },
  { key: 'Future Plan',                label: 'Future Plan',     icon: '📅', color: 'indigo'  },
]

const DEFAULT_PRESCRIPTION_TYPE_FILTER = 'Regular - Psy (Active)'

// ─── Tailwind-named color map ─────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { active: string; inactive: string; badge: string; activeBadge: string }> = {
  slate:  { active: 'bg-slate-700 text-white border-slate-700',          inactive: 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',   badge: 'bg-slate-100 text-slate-700',   activeBadge: 'bg-white/20 text-white' },
  red:    { active: 'bg-red-600 text-white border-red-600',              inactive: 'bg-white text-red-600 border-red-200 hover:border-red-400',          badge: 'bg-red-100 text-red-700',       activeBadge: 'bg-white/20 text-white' },
  amber:  { active: 'bg-amber-500 text-white border-amber-500',          inactive: 'bg-white text-amber-600 border-amber-200 hover:border-amber-400',    badge: 'bg-amber-100 text-amber-700',   activeBadge: 'bg-white/20 text-white' },
  violet: { active: 'bg-violet-600 text-white border-violet-600',        inactive: 'bg-white text-violet-600 border-violet-200 hover:border-violet-400', badge: 'bg-violet-100 text-violet-700', activeBadge: 'bg-white/20 text-white' },
  blue:   { active: 'bg-blue-600 text-white border-blue-600',            inactive: 'bg-white text-blue-600 border-blue-200 hover:border-blue-400',       badge: 'bg-blue-100 text-blue-700',     activeBadge: 'bg-white/20 text-white' },
  rose:   { active: 'bg-rose-600 text-white border-rose-600',            inactive: 'bg-white text-rose-600 border-rose-200 hover:border-rose-400',       badge: 'bg-rose-100 text-rose-700',     activeBadge: 'bg-white/20 text-white' },
  teal:   { active: 'bg-teal-600 text-white border-teal-600',            inactive: 'bg-white text-teal-600 border-teal-200 hover:border-teal-400',       badge: 'bg-teal-100 text-teal-700',     activeBadge: 'bg-white/20 text-white' },
  indigo: { active: 'bg-indigo-600 text-white border-indigo-600',        inactive: 'bg-white text-indigo-600 border-indigo-200 hover:border-indigo-400', badge: 'bg-indigo-100 text-indigo-700', activeBadge: 'bg-white/20 text-white' },
}

const STATUS_COLORS: Record<string, string> = {
  Pending:   'bg-amber-100 text-amber-700 border-amber-200',
  Active:    'bg-blue-100 text-blue-700 border-blue-200',
  Completed: 'bg-green-100 text-green-700 border-green-200',
  Cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  Stopped:   'bg-red-100 text-red-700 border-red-200',
  Draft:     'bg-amber-100 text-amber-700 border-amber-200',
  Signed:    'bg-emerald-100 text-emerald-800 border-emerald-200',
  Unsigned:  'bg-orange-100 text-orange-800 border-orange-200',
}

// ─── Hex color helpers ────────────────────────────────────────────────────────
const isHex = (color: string) => color.startsWith('#')

// Returns inline style for the filter button (active or inactive state)
const hexButtonStyle = (hex: string, active: boolean): React.CSSProperties =>
  active
    ? { backgroundColor: hex, borderColor: hex, color: '#fff' }
    : { backgroundColor: `${hex}18`, borderColor: `${hex}55`, color: '#334155' }

// Returns inline style for the count badge inside the button
const hexBadgeStyle = (hex: string, active: boolean): React.CSSProperties =>
  active
    ? { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff' }
    : { backgroundColor: `${hex}33`, color: '#334155' }

// Returns a very subtle row/card tint for medication items
const hexRowStyle = (hex: string): React.CSSProperties => ({
  backgroundColor: `${hex}18`,
  borderColor: `${hex}44`,
})

// Gets the color for a given medication_type key
const getTypeColor = (medicationType: string): string => {
  const typeDef = MED_TYPES.find(t => t.key === medicationType)
  return typeDef?.color ?? 'slate'
}

// ─── Primitives ───────────────────────────────────────────────────────────────
const StatusPill = ({ status }: { status: string }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
    {status}
  </span>
)

const Field = ({ label, value }: { label: string; value?: string | number | null }) => {
  if (value === null || value === undefined || value === '') return null
  return (
    <div>
      <span className="font-medium text-slate-700">{label}:</span>{' '}
      <span className="text-slate-600">{value}</span>
    </div>
  )
}

const SectionTitle = ({ title }: { title: string }) => (
  <h3 className="text-sm font-semibold text-slate-700 mb-2 pb-1 border-b border-slate-100">{title}</h3>
)

const SmallBadge = ({ children, cls }: { children: React.ReactNode; cls: string }) => (
  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{children}</span>
)

// ─── Filter tab card ──────────────────────────────────────────────────────────
const TypeFilterCard = ({
  typeDef,
  count,
  isActive,
  onClick,
}: {
  typeDef: (typeof MED_TYPES)[number]
  count: number
  isActive: boolean
  onClick: () => void
}) => {
  const hex = isHex(typeDef.color)
  const tailwind = !hex ? (TYPE_COLORS[typeDef.color] ?? TYPE_COLORS.slate) : null
  const isEmpty = count === 0 && typeDef.key !== 'All'

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

// ─── Table row ────────────────────────────────────────────────────────────────
const MedicationRow = ({
  order,
  parentStartDate,
  parentEndDate,
  prescriptionPractitioner,
  canManage,
  onAction,
}: {
  order: any
  parentStartDate?: string
  parentEndDate?: string
  prescriptionPractitioner: {
    healthcare_practitioner_name?: string
    healthcare_practitioner?: string
    practitioner?: string
    user_name?: string
  }
  canManage?: boolean
  onAction?: (entry: string, drug: string, action: MedicationAction) => void
}) => {
  const isFuture = isFuturePlanByStartDate(order)
  const color = getTypeColor(isFuture ? 'Future Plan' : order.medication_type)
  const rowStyle: React.CSSProperties = isHex(color)
    ? hexRowStyle(color)
    : order.is_pink ? {} : {}
  const isLegacyRow = isLegacyMedicationOrderRow(order)
  const displayDrugName = displayMedicationDrugName(order)
  const displayDrugCode = displayMedicationDrugCode(order)
  const displayDosage = displayMedicationDosage(order)
  const displayFrequency = displayMedicationFrequency(order)
  const displayRoute = displayMedicationRoute(order)
  const displayPractitioner = displayPrescriptionPractitioner(prescriptionPractitioner, order)
  const displayStartDate = displayMedicationStartDate(order, parentStartDate)
  const displayEndDate = displayMedicationEndDate(order, parentEndDate)

  return (
    <tr
      className={order.is_pink ? 'bg-pink-50/60' : ''}
      style={!order.is_pink && isHex(color) ? rowStyle : undefined}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="font-medium text-slate-800">{displayDrugName}</span>
          {isLegacyRow && <SmallBadge cls="bg-amber-100 text-amber-800 border border-amber-200">Legacy</SmallBadge>}
          {order.is_pink && <SmallBadge cls="bg-pink-100 text-pink-700">🩷 Pink</SmallBadge>}
          {order.is_prn  && <SmallBadge cls="bg-amber-100 text-amber-700">PRN</SmallBadge>}
          {order.is_long_acting_medicine && <SmallBadge cls="bg-teal-100 text-teal-700">⏳ Long Acting</SmallBadge>}
          {isFuture && <SmallBadge cls="bg-indigo-100 text-indigo-800 border border-indigo-200">📅 Future Plan</SmallBadge>}
        </div>
        <div className="hidden text-xs text-slate-400 mt-0.5" aria-hidden="true">
          {displayDrugCode}
        </div>
        {isLegacyRow && (
          <div className="mt-1 text-[11px] text-slate-500 space-x-2">
            {order.trans_num ? <span>IP Med: {order.trans_num}</span> : null}
            {order.redundancy_type ? <span>Redundancy: {order.redundancy_type}</span> : null}
          </div>
        )}
      </td>
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
        {order.is_completed || isLegacyRow
          ? <SmallBadge cls="bg-green-100 text-green-700">Completed</SmallBadge>
          : <SmallBadge cls="bg-amber-100 text-amber-700">Pending</SmallBadge>}
        {order.returned_to_store && (
          <div className="mt-1"><SmallBadge cls="bg-slate-100 text-slate-500">Returned</SmallBadge></div>
        )}
        {order.medication_status === 'On Hold' && (
          <div className="mt-1"><SmallBadge cls="bg-orange-100 text-orange-700 border border-orange-200">On Hold</SmallBadge></div>
        )}
        {order.medication_status === 'Discontinued' && (
          <div className="mt-1"><SmallBadge cls="bg-red-100 text-red-700 border border-red-200">Discontinued</SmallBadge></div>
        )}
        {canManage && onAction && !isLegacyRow && order.medication_status !== 'Discontinued' && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {order.medication_status === 'On Hold' ? (
              <button type="button" onClick={() => onAction(order.name, displayDrugName, 'Continue')}
                className="px-2 py-0.5 text-xs rounded border border-green-600 text-green-700 hover:bg-green-50">Continue</button>
            ) : (
              <button type="button" onClick={() => onAction(order.name, displayDrugName, 'Hold')}
                className="px-2 py-0.5 text-xs rounded border border-amber-600 text-amber-700 hover:bg-amber-50">Hold</button>
            )}
            <button type="button" onClick={() => onAction(order.name, displayDrugName, 'Discontinue')}
              className="px-2 py-0.5 text-xs rounded border border-red-600 text-red-700 hover:bg-red-50">Discontinue</button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ─── Detail card ──────────────────────────────────────────────────────────────
const MedicationDetailCard = ({ order, parentStartDate }: { order: any; parentStartDate?: string }) => {
  const isFuture = isFuturePlanByStartDate(order)
  const color = getTypeColor(isFuture ? 'Future Plan' : order.medication_type)
  const cardStyle: React.CSSProperties = isHex(color) ? hexRowStyle(color) : {}
  const instructions = displayMedicationInstructions(order)
  const typeLabel = isFuture
    ? `Future Plan · ${normalizePrescriptionType(order.medication_type) || order.medication_type || '—'}`
    : order.medication_type

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm space-y-2 ${
        order.is_pink
          ? 'border-pink-200 bg-pink-50/40'
          : isHex(color)
          ? ''
          : 'border-slate-200 bg-slate-50/40'
      }`}
      style={!order.is_pink && isHex(color) ? cardStyle : undefined}
    >
      <div className="flex items-center justify-between flex-wrap gap-1">
        <span className="font-semibold text-slate-800">{displayMedicationDrugName(order)}</span>
        <span className="text-xs text-slate-400">{typeLabel}</span>
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        {[
          `Dosage ${displayMedicationDosage(order)}`,
          `Freq ${displayMedicationFrequency(order)}`,
          `Route ${displayMedicationRoute(order)}`,
        ].join(' · ')}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs">
        {instructions && <div><span className="font-medium text-slate-700">Instructions:</span> <span className="text-slate-600">{instructions}</span></div>}
        <div><span className="font-medium text-slate-700">Frequency:</span> <span className="text-slate-600">{displayMedicationFrequency(order)}</span></div>
        <div><span className="font-medium text-slate-700">Start:</span> <span className="text-slate-600">{displayMedicationStartDate(order, parentStartDate)}</span></div>
        {order.reference_no  && <div><span className="font-medium text-slate-700">Ref No:</span> <span className="text-slate-600">{order.reference_no}</span></div>}
        <div><span className="font-medium text-slate-700">Qty:</span> <span className="text-slate-600">{order.quantity} {order.uom}</span></div>
        <div><span className="font-medium text-slate-700">Days:</span> <span className="text-slate-600">{order.no_of_days}</span></div>
        <div><span className="font-medium text-slate-700">Time:</span> <span className="text-slate-600">{order.time}</span></div>
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface PrescriptionDetailsProps {
  prescriptionName: string
  onUpdate?: () => void
}

// ─── Main component ───────────────────────────────────────────────────────────
export const PrescriptionDetails = ({ prescriptionName, onUpdate }: PrescriptionDetailsProps) => {
  const [prescription, setPrescription] = useState<Prescription | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<Error | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [activeType, setActiveType]     = useState(DEFAULT_PRESCRIPTION_TYPE_FILTER)
  const [showSignModal, setShowSignModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddMedicationModal, setShowAddMedicationModal] = useState(false)
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false)

  // Per-drug Hold / Continue / Discontinue (doctor only)
  const { user } = useAuth()
  const canManageMeds = (user?.roles || []).some((r) =>
    ['Doctor', 'Physician', 'Healthcare Administrator', 'System Manager'].includes(r),
  )
  const [pendingAction, setPendingAction] = useState<{ entry: string; drug: string; action: MedicationAction } | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [savingAction, setSavingAction] = useState(false)
  /** Healthcare Practitioner holding / stopping the medicine (required for Hold / Discontinue). */
  const [stoppedBy, setStoppedBy] = useState('')
  const [practitionerOptions, setPractitionerOptions] = useState<LinkFieldOption[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [current, options] = await Promise.all([
          getCurrentUserPractitionerOption(),
          fetchHealthcarePractitioners(),
        ])
        if (cancelled) return
        setPractitionerOptions(options)
        if (current?.name) setStoppedBy((prev) => prev || current.name)
      } catch {
        /* doctor must pick the practitioner manually */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchPrescription(prescriptionName)
      setPrescription(data)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch prescription'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [prescriptionName])

  const handleStatusChange = async (newStatus: string) => {
    setActionLoading(newStatus)
    try {
      await load()
      onUpdate?.()
    } catch (e) {
      console.error(e)
    } finally {
      setActionLoading(null)
    }
  }

  const runMedAction = async (entry: string, action: MedicationAction, reason?: string) => {
    if (!prescription) return
    if (action !== 'Continue' && !stoppedBy.trim()) {
      toast.error('Select the doctor holding / stopping this medicine (Stopped by).')
      return
    }
    setSavingAction(true)
    try {
      await setMedicationEntryStatus(prescription.name, entry, action, reason, stoppedBy.trim() || undefined)
      toast.success(
        action === 'Continue' ? 'Medicine continued' : action === 'Hold' ? 'Medicine put on hold' : 'Medicine discontinued',
      )
      setPendingAction(null)
      setReasonText('')
      await load()
      onUpdate?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setSavingAction(false)
    }
  }

  const handleMedAction = (entry: string, drug: string, action: MedicationAction) => {
    if (action === 'Continue') {
      void runMedAction(entry, action)
    } else {
      setReasonText('')
      setPendingAction({ entry, drug, action })
    }
  }

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-GB') : undefined

  if (loading) return (
    <div className="flex items-center justify-center p-8 text-slate-600">
      Loading prescription details...
    </div>
  )

  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <h3 className="text-red-800 font-semibold mb-2">Error Loading Prescription</h3>
      <p className="text-red-700 text-sm mb-3">{error.message}</p>
      <button onClick={load} className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700">Retry</button>
    </div>
  )

  if (!prescription) return (
    <div className="text-slate-500 text-center p-8">Prescription not found</div>
  )

  const orders = prescription.medication_orders || []
  const orderForTypeFilter = (order: any) =>
    order.end_date || order._rx_end
      ? order
      : { ...order, _rx_end: prescription.end_date }
  const countFor = (key: string) =>
    orders.filter((o: any) => matchesPrescriptionTypeFilter(orderForTypeFilter(o), key)).length
  const filteredOrders = orders.filter((o: any) =>
    matchesPrescriptionTypeFilter(orderForTypeFilter(o), activeType)
  )
  const activeTypeDef = MED_TYPES.find(t => t.key === activeType)
  const completionPct = (prescription.total_orders ?? 0) > 0
    ? Math.round(((prescription.completed_orders ?? 0) / (prescription.total_orders ?? 0)) * 100)
    : 0
  const isIpPrescription =
    Boolean(prescription.inpatient_record) || prescription.care_context === 'Inpatient Admission'
  const canAddMedication =
    prescriptionIsSigned(prescription) && isIpPrescription && prescription.status !== 'Completed' && prescription.status !== 'Stopped'
  const canCreateSubscription =
    orders.length > 0 &&
    prescription.status !== 'Cancelled' &&
    prescription.status !== 'Stopped' &&
    !prescriptionNeedsSignature(prescription)

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Prescription</p>
          <h2 className="text-lg font-bold text-slate-900">{prescription.name}</h2>
          {prescription.is_pink && (
            <span className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-pink-600">
              🩷 Pink Prescription
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {prescription.status && <StatusPill status={prescription.status} />}
          {!prescriptionNeedsSignature(prescription) && prescriptionIsSigned(prescription) && prescription.doctors_signature && (
            <img
              src={attachFileDisplayUrl(prescription.doctors_signature)}
              alt="Doctor signature"
              className="max-h-10 object-contain rounded border border-emerald-200 bg-emerald-50 px-2 py-1"
            />
          )}
        </div>
      </div>

      {showSignModal && (
        <SignPrescriptionModal
          prescriptionName={prescription.name}
          currentSignature={prescription.doctors_signature}
          status={prescription.status}
          newSystem={prescription.new_system}
          onClose={() => setShowSignModal(false)}
          onSigned={() => {
            load()
            onUpdate?.()
          }}
        />
      )}

      {showEditModal && (
        <CreatePrescriptionModal
          editMode
          prescriptionData={prescription}
          initialPatient={prescription.patient}
          initialCareContext={
            prescription.patient_encounter || prescription.after_discharge
              ? 'Patient Visit'
              : prescription.care_context === 'Inpatient Admission'
                ? 'Inpatient Admission'
                : 'Patient Visit'
          }
          initialPatientEncounter={prescription.patient_encounter}
          initialInpatientRecord={prescription.inpatient_record}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false)
            load()
            onUpdate?.()
          }}
        />
      )}

      {showAddMedicationModal && (
        <AddMedicationEntryModal
          prescriptionName={prescription.name}
          patient={prescription.patient}
          patientEncounter={prescription.patient_encounter}
          inpatientRecord={prescription.inpatient_record}
          onClose={() => setShowAddMedicationModal(false)}
          onSaved={() => {
            setShowAddMedicationModal(false)
            load()
            onUpdate?.()
          }}
        />
      )}

      {showSubscriptionModal && (
        <CreateSubscriptionPlanModal
          prescriptionName={prescription.name}
          patientName={prescription.patient_name || prescription.patient}
          startDate={prescription.start_date}
          medicationOrders={orders}
          onClose={() => setShowSubscriptionModal(false)}
          onCreated={() => {
            onUpdate?.()
          }}
        />
      )}

      {/* ── Progress bar ── */}
      <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-600">Order Completion</span>
          <span className="text-xs text-slate-500">
            {prescription.completed_orders} / {prescription.total_orders} orders
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-1.5">
          <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
        </div>
        <div className="text-right mt-1">
          <span className="text-xs text-slate-400">{completionPct}% complete</span>
        </div>
      </div>

      {/* ── Info grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
        <div>
          <SectionTitle title="Patient Information" />
          <div className="space-y-1">
            <Field label="Patient"             value={prescription.patient_name || prescription.patient} />
            <Field label="Patient ID"          value={prescription.patient} />
            <Field label="Inpatient Admission" value={prescription.inpatient_record} />
            <Field label="Care Context"        value={prescription.care_context} />
          </div>
        </div>
        <div>
          <SectionTitle title="Prescribing Details" />
          <div className="space-y-1">
            <Field
              label="Doctor Name"
              value={
                prescription.healthcare_practitioner
                  ? prescription.healthcare_practitioner_name || prescription.healthcare_practitioner
                  : prescription.user_name
              }
            />
            <Field
              label="Practitioner ID"
              value={prescription.healthcare_practitioner || undefined}
            />
            <Field label="Company"         value={prescription.company} />
          </div>
        </div>
        <div>
          <SectionTitle title="Dates & Period" />
          <div className="space-y-1">
            <Field label="Posting Date" value={formatDate(prescription.posting_date)} />
            <Field label="Start Date"   value={formatDate(prescription.start_date)} />
            <Field label="End Date"     value={formatDate(prescription.end_date)} />
          </div>
        </div>
        <div>
          <SectionTitle title="Order Summary" />
          <div className="space-y-1">
            <Field label="Total Orders" value={String(prescription.total_orders)} />
            <Field label="Completed"    value={String(prescription.completed_orders)} />
            <Field label="Pending"      value={String((prescription.total_orders ?? 0) - (prescription.completed_orders ?? 0))} />
          </div>
        </div>
      </div>

      {/* ── Medication Orders ── */}
      {orders.length > 0 && (
        <div className="space-y-3">
          <SectionTitle title="Medication Orders" />

          {/* Filter cards */}
          <div className="flex flex-wrap gap-2">
            {MED_TYPES.map(typeDef => (
              <TypeFilterCard
                key={typeDef.key}
                typeDef={typeDef}
                count={countFor(typeDef.key)}
                isActive={activeType === typeDef.key}
                onClick={() => setActiveType(typeDef.key)}
              />
            ))}
          </div>

          {/* Active filter label */}
          {activeType !== 'All' && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Showing:</span>
              <span className="font-medium text-slate-700">{activeTypeDef?.icon} {activeTypeDef?.label}</span>
              <span className="text-slate-400">({filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'})</span>
              <ClearFiltersButton
                className="ml-1 w-6 h-6 border-0 bg-transparent hover:bg-slate-100"
                title="Clear filter"
                onClick={() => setActiveType('All')}
              />
            </div>
          )}

          {/* Table */}
          {filteredOrders.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-md">
              No orders for <strong>{activeTypeDef?.label}</strong>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full text-sm divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      {['Drug', 'Dosage', 'Form', 'Frequency', 'Route', 'Practitioner', 'Period', 'Status'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredOrders.map((order: any) => (
                      <MedicationRow
                        key={order.name}
                        order={order}
                        parentStartDate={prescription.start_date}
                        parentEndDate={prescription.end_date}
                        prescriptionPractitioner={{
                          healthcare_practitioner_name: prescription.healthcare_practitioner_name,
                          healthcare_practitioner: prescription.healthcare_practitioner,
                          practitioner: prescription.practitioner,
                          user_name: prescription.user_name,
                        }}
                        canManage={canManageMeds}
                        onAction={handleMedAction}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2">
                {filteredOrders.map((order: any) => (
                  <MedicationDetailCard
                    key={order.name}
                    order={order}
                    parentStartDate={prescription.start_date}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Reason prompt for Hold / Discontinue ── */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => !savingAction && setPendingAction(null)}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              {pendingAction.action === 'Hold' ? 'Hold medicine' : 'Discontinue medicine'}
            </h3>
            <p className="text-sm text-slate-500 mb-3">
              {pendingAction.drug}
              {pendingAction.action === 'Discontinue' && (
                <span className="block text-red-600 mt-1">
                  This is permanent — a discontinued medicine cannot be continued again.
                </span>
              )}
            </p>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Stopped by <span className="text-red-500">*</span>
            </label>
            <select
              value={stoppedBy}
              onChange={(e) => setStoppedBy(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-3"
            >
              <option value="">Select doctor…</option>
              {practitionerOptions.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label || p.name}
                </option>
              ))}
              {/* Keep the current value selectable even when the list is still loading */}
              {stoppedBy && !practitionerOptions.some((p) => p.name === stoppedBy) && (
                <option value={stoppedBy}>{practitionerOptions.length ? stoppedBy : 'Loading…'}</option>
              )}
            </select>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              autoFocus
              placeholder={`Reason to ${pendingAction.action.toLowerCase()} this medicine`}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={savingAction}
                className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingAction || !reasonText.trim() || !stoppedBy.trim()}
                onClick={() => runMedAction(pendingAction.entry, pendingAction.action, reasonText.trim())}
                className={`px-3 py-1.5 text-sm rounded-md text-white disabled:opacity-50 ${
                  pendingAction.action === 'Discontinue' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {savingAction ? 'Saving…' : pendingAction.action}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="border-t border-slate-200 pt-4">
        <SectionTitle title="Actions" />
        <div className="flex flex-wrap gap-2">
          {prescriptionNeedsSignature(prescription) && (
            <>
              <button
                type="button"
                onClick={() => setShowEditModal(true)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Edit Prescription
              </button>
              <button
                type="button"
                onClick={() => setShowSignModal(true)}
                className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100"
              >
                Sign Prescription
              </button>
            </>
          )}
          {canAddMedication && (
            <button
              type="button"
              onClick={() => setShowAddMedicationModal(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90"
            >
              Add Medication
            </button>
          )}
          {canCreateSubscription && (
            <button
              type="button"
              onClick={() => setShowSubscriptionModal(true)}
              className="px-4 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-300 rounded-md hover:bg-teal-100"
              title="Create a monthly (or multi-month) subscription medication plan from this prescription"
            >
              Monthly Subscription
            </button>
          )}
          <button
            onClick={() => setShowDuplicateModal(true)}
            className="px-4 py-2 text-sm font-medium text-primary bg-white border border-primary rounded-md hover:bg-primary/5"
          >
            Duplicate
          </button>
          {prescription.status !== 'Completed' && (
            <button
              onClick={() => handleStatusChange('Completed')}
              disabled={!!actionLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {actionLoading === 'Completed' ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : '✓'} Mark Completed
            </button>
          )}
        </div>
      </div>

      {/* ── Duplicate Modal ── */}
      {showDuplicateModal && (
        <CreatePrescriptionModal
          onClose={() => setShowDuplicateModal(false)}
          onSuccess={() => {
            setShowDuplicateModal(false)
            toast.success('Prescription duplicated successfully')
            onUpdate?.()
          }}
          initialPatient={prescription.patient}
          initialCareContext={prescription.care_context as 'Patient Visit' | 'Inpatient Admission' | undefined}
          initialPatientEncounter={prescription.patient_encounter}
          initialInpatientRecord={prescription.inpatient_record}
          initialMedications={orders.map(mapOrderToDuplicateMedication)}
          initialPractitioner={prescription.practitioner}
        />
      )}

    </div>
  )
}