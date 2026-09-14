
import { localDateInputValue, localDatetimeInputValue } from '../../utils/formatDate'
import { fromDatetimeLocalValue } from '../../utils/datetimeLocal'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  createDischarge,
  dischargeWithoutFinance,
  deleteDischargeObservation,
  deleteDischargeExtraCharge,
  fetchDischargeDraftForAdmission,
  fetchInpatientRecord,
  fetchServiceUnits,
  fetchServiceUnitChargeItem,
  fetchMedicalSupervisionChargePreview,
  fetchBedNumbers,
  saveDischargeDraftToServer,
  UnbilledServicesError,
  type ServiceUnit,
  type InpatientRecord,
} from '../../services/inpatientRecords'
import { uploadPatientFile, type PatientDocumentRow } from '../../services/patients'
import { MedicineGivenList } from '../medication/MedicineGivenList'
import { MedicineReconciliationList } from '../medication/MedicineReconciliationList'
import { DischargePrescriptionCardsEditable, DischargePrescriptionCardsReadonly } from '../discharges/DischargePrescriptionCards'
import {
  getDischargePrescriptionSections,
  type DischargePrescriptionSections,
} from '../../services/medicineGiven'
import { DocumentTypeSelect } from '../ui/DocumentTypeSelect'
import { SignaturePad, attachFileDisplayUrl } from '../ui/SignaturePad'
import {
  fetchDischargeDoctorPractitioners,
  fetchDischargeNursePractitioners,
  fetchUsers,
  fetchDischargeTemplates,
  fetchDischargeChecklist,
  fetchDepartments,
  fetchDocumentTypes,
  createDocumentType,
  fetchMedicalDepartments,
  fetchHealthcarePractitioners,
  fetchNursingDischargeTemplates,
  fetchNursingTemplateDisplayLabel,
  type LinkFieldOption,
  fetchNursingDischargeChecklist,
  fetchCurrentUserDepartments,
  pickDefaultLinkOption,
  type NursingDischargeTemplateOption,
  type NursingDischargeTemplateSource,
} from '../../services/common'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { fetchAfterDischargePrescriptions } from '../../services/prescriptions'
import { fetchObservationLevels } from '../../services/common'
import { fetchObservationLevelDetails, fetchLatestObservationForAdmission } from '../../services/observations'
import { fetchMedicineGiven } from '../../services/medicineGiven'
import { toast } from '../../hooks/useToast'
import { frappeErrorMessage } from '../../utils/frappeErrorMessage'
import { SetupServicesEditor } from '../patientVisits/SetupServicesEditor'
import { normalizeSetupServices } from '../../services/dailyPatientVisitSetup'
import { useCareContext } from '../../providers/CareContextProvider'
import {
  canEditMainDischargeChecklist,
  getVisibleDischargeTabIds,
  isNurseRole,
  type DischargeTabId,
} from '../../config/permissions'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import { saveDischargeDraft, loadDischargeDraft, clearDischargeDraft, draftSavedAt } from '../../services/dischargeDraft'
import {
  summarizeDischargeChecklistStatus,
  canSubmitDischargeWithChecklist,
  canDischargeWithoutFinance,
  CHECKLIST_STATUS_LABELS,
} from '../../utils/dischargeChecklistStatus'
import {
  canUserEditDischargeChecklistItem,
  checklistItemDepartmentLabel,
  mergeChecklistWithTemplateDepartments,
  sortChecklistByOrder,
  canToggleDischargeChecklistItem,
} from '../../utils/dischargeChecklistPermissions'
import { DischargeChecklistStatusCard } from '../discharges/DischargeChecklistStatusCard'
import {
  DISCHARGE_SECTION_SEARCH_PARAM,
  parseDischargeSection,
} from '../../utils/dischargeNavigation'
import { CollapsibleFormSection } from '../billing/CollapsibleFormSection'
import { X, ArrowLeft, CheckCircle2, Circle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, AlertCircle, Receipt, PenLine, Trash2, Check, Save, Clock, Pill, Calendar, DollarSign, ClipboardList, HeartPulse, ArrowRightLeft, FolderOpen, Users, Lock, type LucideIcon } from 'lucide-react'
import { DateFilterInput } from '../ui/DateFilterInput'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChecklistItem {
  name: string
  action_required: string
  department: string
  department_label?: string
  department_2?: string
  department_2_label?: string
  department_3?: string
  department_3_label?: string
  user: string
  name1: string
  date_time: string
  click: boolean
  description?: string
  sr_num?: string
}

/** Plain text for checklist note textarea (description may arrive as HTML from templates). */
function checklistNoteText(value?: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!/<\/?[a-z][\s\S]*>/i.test(trimmed)) return trimmed
  return trimmed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface DischargePatientFormProps {
  admission: {
    name: string
    patient: string
    patient_name?: string
    /** Practitioner who scheduled discharge — default for Discharge Doctor */
    discharge_practitioner?: string
    primary_practitioner?: string
    /** Branch / Cost Center for daily visit setup fallback */
    cost_center?: string
  }
  onClose: () => void
  onSuccess: () => void
}


interface DailyPatientVisitSetup {
  name?: string
  patient: string
  patient_name?: string
  from_date: string
  to_date: string
  time: string
  /** Healthcare Service Template (legacy first line). */
  session?: string
  services?: Array<{ session: string; amount: number }>
  is_active: boolean
  amount: number
  admission: string      // Add this field
  discharge?: string
  /** Cost Center / branch */
  branch?: string
}

const RELATION_OPTIONS = [
  'Father',
  'Mother',
  'Brother',
  'Sister',
  'Husband',
  'Wife',
  'Son',
  'Daughter',
] as const

const DISCHARGE_TAB_DEFINITIONS: {
  id: DischargeTabId
  label: string
  shortLabel?: string
  Icon: LucideIcon
  borderColor: string
  activeBg: string
  hoverBg: string
  iconColor: string
}[] = [
  {
    id: 'details',
    label: 'Details',
    Icon: ClipboardList,
    borderColor: 'border-slate-400',
    activeBg: 'bg-slate-50/80',
    hoverBg: 'hover:bg-slate-50/50',
    iconColor: 'text-slate-600',
  },
  {
    id: 'checklist',
    label: 'Discharge Checklist',
    shortLabel: 'Checklist',
    Icon: CheckCircle2,
    borderColor: 'border-emerald-400',
    activeBg: 'bg-emerald-50/80',
    hoverBg: 'hover:bg-emerald-50/50',
    iconColor: 'text-emerald-600',
  },
  {
    id: 'nursing',
    label: 'Nursing Checklist',
    shortLabel: 'Nursing',
    Icon: HeartPulse,
    borderColor: 'border-sky-400',
    activeBg: 'bg-sky-50/80',
    hoverBg: 'hover:bg-sky-50/50',
    iconColor: 'text-sky-600',
  },
  {
    id: 'transfer',
    label: 'Prescription',
    shortLabel: 'Prescription',
    Icon: ArrowRightLeft,
    borderColor: 'border-violet-400',
    activeBg: 'bg-violet-50/80',
    hoverBg: 'hover:bg-violet-50/50',
    iconColor: 'text-violet-600',
  },
  {
    id: 'charges',
    label: 'Room/Observation',
    shortLabel: 'Room/Observation',
    Icon: Receipt,
    borderColor: 'border-amber-500',
    activeBg: 'bg-amber-50/80',
    hoverBg: 'hover:bg-amber-50/50',
    iconColor: 'text-amber-700',
  },
  {
    id: 'medicine-sales',
    label: 'Sales of Medicine',
    shortLabel: 'Med Sales',
    Icon: DollarSign,
    borderColor: 'border-amber-400',
    activeBg: 'bg-amber-50/80',
    hoverBg: 'hover:bg-amber-50/50',
    iconColor: 'text-amber-600',
  },
  {
    id: 'reconcile',
    label: 'Medicine Reconciliation',
    shortLabel: 'Reconcile',
    Icon: Pill,
    borderColor: 'border-teal-400',
    activeBg: 'bg-teal-50/80',
    hoverBg: 'hover:bg-teal-50/50',
    iconColor: 'text-teal-600',
  },
  {
    id: 'daily-visit',
    label: 'Daily Visit Setup',
    shortLabel: 'Daily Visit',
    Icon: Calendar,
    borderColor: 'border-indigo-400',
    activeBg: 'bg-indigo-50/80',
    hoverBg: 'hover:bg-indigo-50/50',
    iconColor: 'text-indigo-600',
  },
  {
    id: 'documents',
    label: 'Documents',
    Icon: FolderOpen,
    borderColor: 'border-orange-400',
    activeBg: 'bg-orange-50/80',
    hoverBg: 'hover:bg-orange-50/50',
    iconColor: 'text-orange-600',
  },
  {
    id: 'relatives',
    label: 'Relatives',
    Icon: Users,
    borderColor: 'border-rose-400',
    activeBg: 'bg-rose-50/80',
    hoverBg: 'hover:bg-rose-50/50',
    iconColor: 'text-rose-600',
  },
]

const groupByDepartment = (items: ChecklistItem[]) => {
  return items.reduce((acc, item) => {
    const dept = item.department_label || item.department || 'General'
    if (!acc[dept]) acc[dept] = []
    acc[dept].push(item)
    return acc
  }, {} as Record<string, ChecklistItem[]>)
}

function toFrappeDateTime(value?: string): string {
  if (!value) return ''
  let s = value.trim()
  if (s.includes('T')) {
    if (s.endsWith('Z')) s = s.slice(0, -1)
    s = s.replace('T', ' ')
  }
  if (s.length > 19) s = s.slice(0, 19)
  if (s.length === 16) s += ':00'
  return s
}

function checkToYesNo(value: unknown): 'Yes' | 'No' {
  return Number(value) ? 'Yes' : 'No'
}

function YesNoField({
  label,
  value,
  onChange,
  required,
}: {
  label: string
  value: 'Yes' | 'No'
  onChange: (v: 'Yes' | 'No') => void
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="radio"
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            checked={value === 'Yes'}
            onChange={() => onChange('Yes')}
          />
          Yes
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="radio"
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            checked={value === 'No'}
            onChange={() => onChange('No')}
          />
          No
        </label>
      </div>
    </div>
  )
}

// ─── Signature Pad Component ────────────────────────────────────────────────

interface MedicineSalesData {
  prescriptions: any[]
  given_medicines: any[]
  prescription_total: number
  given_total: number
  grand_total: number
}

/** Patient relation on e-signature rows (Patient Upload Document.patient_relation) */
const SIGNATURE_RELATION_OPTIONS = [
  'Self',
  'Father',
  'Mother',
  'Spouse',
  'Siblings',
  'Family',
  'Guardian',
  'Other',
] as const

const DEFAULT_SIGNATURE_DOC_TYPE = 'Signature'

function resolveSignatureDocumentType(
  types: { name: string; document_name?: string }[],
): string {
  // Prefer exact "Signature" — never pick "Legacy Signature" (old-system imports).
  const exact = types.find((t) => {
    const name = (t.name || '').trim().toLowerCase()
    const label = (t.document_name || '').trim().toLowerCase()
    return name === 'signature' || label === 'signature'
  })
  return exact?.name || DEFAULT_SIGNATURE_DOC_TYPE
}

function isSignatureDocumentRow(row: PatientDocumentRow, signatureDocType: string): boolean {
  const dt = (row.document_type || '').trim()
  if (
    !dt &&
    !(row.patient_relation || '').trim() &&
    !(row.signee_name || '').trim() &&
    !(row.file_name || '').trim()
  ) {
    return false
  }
  const lower = dt.toLowerCase()
  if (lower.includes('signature') || dt === signatureDocType) return true
  if ((row.patient_relation || '').trim() || (row.signee_name || '').trim()) return true
  return false
}

/** Restore signee_name after reload — historically only stored on file_name. */
function hydrateSignatureRow(row: PatientDocumentRow): PatientDocumentRow {
  const signee = (row.signee_name || '').trim()
  const fromFile = (row.file_name || '').trim()
  // Skip generic placeholders written when signee was empty at upload time.
  const placeholder = /^signature(\s+\d+)?$/i.test(fromFile)
  return {
    ...row,
    signee_name: signee || (placeholder ? '' : fromFile) || '',
    patient_relation: row.patient_relation || '',
    document_type: row.document_type || '',
    upload_remarks: row.upload_remarks || '',
    document: row.document || '',
    file_name: row.file_name || '',
  }
}

function splitPatientDocumentRows(
  rows: PatientDocumentRow[] | undefined,
  signatureDocType: string,
): { documents: PatientDocumentRow[]; signatures: PatientDocumentRow[] } {
  if (!rows?.length) return { documents: [], signatures: [] }
  const documents: PatientDocumentRow[] = []
  const signatures: PatientDocumentRow[] = []
  for (const row of rows) {
    if (isSignatureDocumentRow(row, signatureDocType)) signatures.push(hydrateSignatureRow(row))
    else documents.push(row)
  }
  return { documents, signatures }
}

// ─── Daily Visit Setup Form Component ───────────────────────────────────────
const DailyVisitSetupForm = ({ 
  patient, 
  admission,
  branch,
  onSave, 
  initialData,
  onCancel
}: { 
  patient: string;
  admission: string;
  /** Top nav / admission cost center */
  branch?: string;
  onSave: (data: DailyPatientVisitSetup) => void;
  initialData?: DailyPatientVisitSetup;
  onCancel?: () => void;
}) => {
  // Ensure admission is always set from props, not overwritten by initialData
  const initialServices = normalizeSetupServices(initialData || {})
  const resolvedBranch =
    (initialData?.branch || '').trim() ||
    (branch || '').trim() ||
    ''
  const [formData, setFormData] = useState<DailyPatientVisitSetup>({
    patient: patient,
    patient_name: '',
    admission: admission,  // This comes from props
    discharge: initialData?.discharge || '',
    from_date: initialData?.from_date || '',
    to_date: initialData?.to_date || '',
    time: initialData?.time || '',
    session: initialServices[0]?.session || initialData?.session || '',
    services: initialServices,
    is_active: initialData?.is_active ?? true,
    amount: initialServices.reduce((sum, line) => sum + (Number(line.amount) || 0), 0) || initialData?.amount || 0,
    branch: resolvedBranch,
  })

  // Add a useEffect to ensure admission is always synced from props
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      admission: admission,  // Always use the current admission prop
      patient: patient,
      branch: (prev.branch || '').trim() || (branch || '').trim() || prev.branch,
    }))
  }, [admission, patient, branch])

  const handleSave = () => {
    if (!(formData.from_date || '').trim()) {
      toast.error('From Date is required.')
      return
    }
    if (!(formData.to_date || '').trim()) {
      toast.error('End Date is required.')
      return
    }
    if (!(formData.time || '').trim()) {
      toast.error('Time is required.')
      return
    }
    const services = normalizeSetupServices(formData).filter((line) => line.session || line.amount)
    if (!services.length) {
      toast.error('Add at least one Healthcare Service Template.')
      return
    }
    const branchValue =
      (formData.branch || '').trim() ||
      (branch || '').trim() ||
      ''
    // Ensure admission is included in the data being saved
    const saveData = {
      ...formData,
      admission: admission,  // Explicitly set admission from props
      patient: patient,
      branch: branchValue || undefined,
      services,
      session: services[0]?.session || '',
      amount: services.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
    }
    onSave(saveData)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">From Date *</label>
          <DateFilterInput
            value={formData.from_date}
            onChange={(e) => setFormData({ ...formData, from_date: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">End Date *</label>
          <DateFilterInput
            value={formData.to_date}
            onChange={(e) => setFormData({ ...formData, to_date: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Time *</label>
          <input
            type="time"
            value={formData.time}
            onChange={(e) => setFormData({ ...formData, time: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            required
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="rounded border-slate-300 text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium text-slate-700">Activate Daily Visits</span>
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Therapy Session / Service <span className="text-slate-400 font-normal">(Healthcare Service Template)</span>
        </label>
        <SetupServicesEditor
          services={formData.services || [{ session: '', amount: 0 }]}
          onChange={(services) =>
            setFormData({
              ...formData,
              services,
              session: services[0]?.session || '',
              amount: services.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
            })
          }
        />
      </div>

      {/* Show read-only fields for admission and discharge info */}
      <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-slate-100">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Admission</label>
          <input
            type="text"
            value={formData.admission}
            disabled
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Discharge (will be set after discharge)</label>
          <input
            type="text"
            value={formData.discharge || 'Not discharged yet'}
            disabled
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90"
        >
          Save Daily Visit Setup
        </button>
      </div>
    </div>
  )
}

function nursingTemplateSourceForName(
  templateName: string,
  options: NursingDischargeTemplateOption[]
): NursingDischargeTemplateSource {
  const match = options.find((o) => o.name === templateName)
  return match?.template_source ?? 'discharge_nursing'
}

function pickDefaultNursingTemplate(
  nurseTemplates: NursingDischargeTemplateOption[]
): { template: NursingDischargeTemplateOption; src: NursingDischargeTemplateSource } | null {
  const template = pickDefaultLinkOption(nurseTemplates)
  if (!template) return null
  return {
    template,
    src: template.template_source ?? 'discharge_nursing',
  }
}

type AdmissionRoomDefault = {
  serviceUnit: string
  displayName: string
  rate: number
}

function resolveAdmissionRoomFromRecord(record: InpatientRecord): { id: string; label: string } | null {
  const occ = record.current_occupancy
  if (occ?.service_unit) {
    return { id: occ.service_unit, label: occ.service_unit_name || occ.service_unit }
  }
  const activeOcc = record.inpatient_occupancies?.find((row) => !row.left && row.service_unit)
  if (activeOcc?.service_unit) {
    return { id: activeOcc.service_unit, label: activeOcc.service_unit_name || activeOcc.service_unit }
  }
  const selected = record.service_unit_selections?.find((row) => row.service_unit)
  if (selected?.service_unit) {
    return { id: selected.service_unit, label: selected.service_unit }
  }
  return null
}

async function resolveAdmissionRoomDefault(record: InpatientRecord): Promise<AdmissionRoomDefault | null> {
  let room = resolveAdmissionRoomFromRecord(record)
  if (!room && record.bed_no) {
    try {
      const beds = await fetchBedNumbers({ search: record.bed_no })
      const bed = beds.find((row) => row.name === record.bed_no || row.bed_no === record.bed_no)
      if (bed?.service_unit) {
        room = { id: bed.service_unit, label: bed.bed_no || bed.service_unit }
      }
    } catch {
      /* optional bed lookup */
    }
  }
  if (!room) return null

  const storedRate = Number(record.room_charges ?? record.charges?.room_charges ?? 0)
  if (storedRate > 0) {
    return { serviceUnit: room.id, displayName: room.label, rate: storedRate }
  }

  try {
    const chargeItem = await fetchServiceUnitChargeItem(room.id)
    if (chargeItem.rate && chargeItem.rate > 0) {
      return { serviceUnit: room.id, displayName: room.label, rate: chargeItem.rate }
    }
    if (chargeItem.item_code) {
      const res = await fetch(
        `/api/method/healthcare.api.patient_medication_order.get_item_rate_api?item_code=${encodeURIComponent(chargeItem.item_code)}`
      )
      const data = await res.json()
      const rate = Number(data?.message?.rate ?? 0)
      if (rate > 0) {
        return { serviceUnit: room.id, displayName: room.label, rate }
      }
    }
  } catch {
    /* fall through to legacy lookup */
  }

  let rate = 0
  for (const itemCode of [room.label, room.id]) {
    if (!itemCode?.trim()) continue
    try {
      const res = await fetch(
        `/api/method/healthcare.api.patient_medication_order.get_item_rate_api?item_code=${encodeURIComponent(itemCode)}`
      )
      const data = await res.json()
      rate = Number(data?.message?.rate ?? 0)
      if (rate > 0) break
    } catch {
      /* try next code */
    }
  }

  return { serviceUnit: room.id, displayName: room.label, rate }
}

type ChargeSectionKind = 'room' | 'medical' | 'observation'

function ChargeSectionActions({
  onCancel,
  onDelete,
  onProceed,
  showDelete = false,
  proceedLabel = 'Proceed',
  cancelLabel = 'Cancel',
  deleteLabel = 'Delete',
  saving = false,
  deleting = false,
  disabled = false,
}: {
  onCancel: () => void
  onDelete?: () => void
  onProceed: () => void
  showDelete?: boolean
  proceedLabel?: string
  cancelLabel?: string
  deleteLabel?: string
  saving?: boolean
  deleting?: boolean
  disabled?: boolean
}) {
  const busy = saving || deleting
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-3 mt-1 border-t border-slate-100">
      {showDelete && onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          {deleting ? 'Deleting…' : deleteLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onCancel}
        disabled={busy || disabled}
        className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onProceed}
        disabled={busy || disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Receipt className="w-4 h-4" />
        {saving ? 'Saving…' : proceedLabel}
      </button>
    </div>
  )
}

// ─── Main discharge form (full page) ────────────────────────────────────────

export const DischargePatientForm = ({ admission, onClose, onSuccess }: DischargePatientFormProps) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [savingObservation, setSavingObservation] = useState(false)
  const [deletingObservation, setDeletingObservation] = useState(false)
  const [savingChargeSection, setSavingChargeSection] = useState<ChargeSectionKind | null>(null)
  const [deletingChargeSection, setDeletingChargeSection] = useState<ChargeSectionKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unbilledServices, setUnbilledServices] = useState<{ type: string; ids: string[] }[] | null>(null)
  const activeTab = useMemo(
    () => parseDischargeSection(searchParams.get(DISCHARGE_SECTION_SEARCH_PARAM)),
    [searchParams],
  )
  const setActiveTab = useCallback(
    (tab: DischargeTabId) => {
      const np = new URLSearchParams(searchParams)
      if (tab === 'details') np.delete(DISCHARGE_SECTION_SEARCH_PARAM)
      else np.set(DISCHARGE_SECTION_SEARCH_PARAM, tab)
      setSearchParams(np, { replace: true })
    },
    [searchParams, setSearchParams],
  )
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false)
  const sectionMenuRef = useRef<HTMLDivElement>(null)
  const sectionTabsScrollRef = useRef<HTMLDivElement>(null)
  const [sectionScroll, setSectionScroll] = useState({ left: false, right: false })

  const { userRole, user: currentUser, userCostCenter } = useCareContext()
  const formatMedicineMoney = useFormatMoney()
  const roleVisibleTabIds = useMemo(() => getVisibleDischargeTabIds(userRole), [userRole])
  const canEditMainChecklist = useMemo(() => canEditMainDischargeChecklist(userRole), [userRole])
  const nursePrimaryUser = useMemo(() => isNurseRole(userRole) && !canEditMainChecklist, [userRole, canEditMainChecklist])
  const [userDepartments, setUserDepartments] = useState<string[]>([])
  const canEditChecklistRow = useCallback(
    (item: ChecklistItem) => canUserEditDischargeChecklistItem(item, userDepartments, userRole),
    [userDepartments, userRole],
  )

  useEffect(() => {
    let cancelled = false
    fetchCurrentUserDepartments()
      .then((depts) => {
        if (!cancelled) setUserDepartments(depts)
      })
      .catch(() => {
        if (!cancelled) setUserDepartments([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [medicineSales, setMedicineSales] = useState<MedicineSalesData>({
  prescriptions: [],
  given_medicines: [],
  prescription_total: 0,
  given_total: 0,
  grand_total: 0
})
  const [salesLoading, setSalesLoading] = useState(false)

  const [prescriptionSections, setPrescriptionSections] = useState<DischargePrescriptionSections>({
    current_medications: [],
    discharged_medications: [],
    stopped_medications: [],
  })
  const [prescriptionSectionsLoading, setPrescriptionSectionsLoading] = useState(false)

  const loadPrescriptionSections = useCallback(async () => {
    if (!admission?.name) return
    setPrescriptionSectionsLoading(true)
    try {
      const sections = await getDischargePrescriptionSections(admission.name)
      setPrescriptionSections(sections)
    } catch {
      setPrescriptionSections({
        current_medications: [],
        discharged_medications: [],
        stopped_medications: [],
      })
    } finally {
      setPrescriptionSectionsLoading(false)
    }
  }, [admission?.name])

  // Daily Visit Setup state
  const [dailyVisitSetup, setDailyVisitSetup] = useState<DailyPatientVisitSetup | null>(null)
  const [dailyVisitLoading, setDailyVisitLoading] = useState(false)
  const [dailyVisitSaved, setDailyVisitSaved] = useState(false)
  const [showDailyVisitForm, setShowDailyVisitForm] = useState(false)

  // Checklist state
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [checklistLoading, setChecklistLoading] = useState(false)
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})

  // Nursing Checklist state
  const [nurseChecklistItems, setNurseChecklistItems] = useState<ChecklistItem[]>([])
  const [nurseChecklistLoading, setNurseChecklistLoading] = useState(false)
  const [expandedNurseDepts, setExpandedNurseDepts] = useState<Record<string, boolean>>({})

  // Documents + signatures (signatures section under documents on Documents tab)
  const [documents, setDocuments] = useState<PatientDocumentRow[]>([])
  const [signatures, setSignatures] = useState<PatientDocumentRow[]>([])
  const [documentTypes, setDocumentTypes] = useState<{ name: string; document_name?: string }[]>([])
  const [documentUploading, setDocumentUploading] = useState<number | null>(null)
  const [signatureUploading, setSignatureUploading] = useState<number | null>(null)
  const signatureDocType = useMemo(
    () => resolveSignatureDocumentType(documentTypes),
    [documentTypes],
  )

  // Relatives / guardians
  const [relatives, setRelatives] = useState<
    { relationship_with_patient: string; relative_name: string; cpr__id_no: string; any_remarks: string, relative_phone_no: string, relative_alternative_phone_no: string, relative_alternative_phone_no_2: string }[]
  >([{ relationship_with_patient: '', relative_name: '', cpr__id_no: '', any_remarks: '', relative_phone_no: '', relative_alternative_phone_no: '', relative_alternative_phone_no_2: '' }])

  // Link field dropdowns
  const [dischargedByUsers, setDischargedByUsers] = useState<LinkFieldOption[]>([])
  const [dischargeTemplates, setDischargeTemplates] = useState<LinkFieldOption[]>([])
  const [nurseTemplateOptions, setNurseTemplateOptions] = useState<LinkFieldOption[]>([])
  const [nursingTemplateSource, setNursingTemplateSource] = useState<NursingDischargeTemplateSource | null>(null)

  const [dischargeReceptionistOpen, setDischargeReceptionistOpen] = useState(false)
  const [dischargeDoctorOpen, setDischargeDoctorOpen] = useState(false)
  const [dischargeNurseOpen, setDischargeNurseOpen] = useState(false)
  const [dischargeTemplateOpen, setDischargeTemplateOpen] = useState(false)
  const [nurseTemplateOpen, setNurseTemplateOpen] = useState(false)

  const [dischargeReceptionistQuery, setDischargeReceptionistQuery] = useState('')
  const [dischargeDoctorQuery, setDischargeDoctorQuery] = useState('')
  const [dischargeNurseQuery, setDischargeNurseQuery] = useState('')
  const [dischargeTemplateQuery, setDischargeTemplateQuery] = useState('')
  const [nurseTemplateQuery, setNurseTemplateQuery] = useState('')

  const [dischargeDoctorOptions, setDischargeDoctorOptions] = useState<LinkFieldOption[]>([])
  const [dischargeNurseOptions, setDischargeNurseOptions] = useState<LinkFieldOption[]>([])
  const [selectedDischargeReceptionist, setSelectedDischargeReceptionist] = useState<LinkFieldOption | null>(null)
  const [selectedDischargeDoctor, setSelectedDischargeDoctor] = useState<LinkFieldOption | null>(null)
  const [selectedDischargeNurse, setSelectedDischargeNurse] = useState<LinkFieldOption | null>(null)
  const [selectedDischargeTemplate, setSelectedDischargeTemplate] = useState<LinkFieldOption | null>(null)
  const [selectedNurseTemplate, setSelectedNurseTemplate] = useState<LinkFieldOption | null>(null)

  // Department dropdown for checklist
  const [departmentOptions, setDepartmentOptions] = useState<LinkFieldOption[]>([])
  const [departmentQuery, setDepartmentQuery] = useState('')
  const [departmentOpenForItem, setDepartmentOpenForItem] = useState<string | null>(null)
  const departmentTriggerRef = useRef<HTMLInputElement | null>(null)

  // User dropdown for checklist
  const [userOpenForItem, setUserOpenForItem] = useState<string | null>(null)
  const [userQuery, setUserQuery] = useState('')
  const userTriggerRef = useRef<HTMLInputElement | null>(null)

  const [formData, setFormData] = useState({
    discharge_type: '',
    ama_type: '',
    discharge_date: localDatetimeInputValue(),
    discharge_time: new Date().toISOString().slice(0, 10),
    final_discharge_date: new Date().toISOString().slice(0, 10),
    final_discharge_time: new Date().toTimeString().slice(0, 5),
    discharged_by_user: '',
    final_discharge_user_id: '',
    receiving_doctors: '',
    discharge_receptionist: '',
    discharge_doctor: '',
    discharge_nurse: '',
    discharge_template: '',
    nurse_discharge_template: '',
    discharge_treatment_plan: '',
    discharge_reason: '',
    discharge_diagnosis: '',
    discharge_conditions: '',
    discharge_instructions: '',
    final_exam_mental_status_summary: '',
    management_in_hospital: '',
    prognosis: '',
    next_appointment_date: '',
    next_appointment_time: '',
    today_charge: 0,
    room_charge_today: 0,
    room_charge_service_unit: '',
    room_charges: 0,
    medical_supervision_amount: 0,
    today_charge_sales_order: '',
    today_charge_obs: 0,
    discharge_to_observation: 0,
    charge_observation_today: 0,
    observation_level: '',
    observation_room: '',
    observation_start_date: new Date().toISOString().split('T')[0],
    observation_practitioner: '',
    observation_department: '',
    observation_designated_security_personel: '',
    observation_amount: 0,
    observation_duration: '',
    observation_note: '',
    observation_record: '',
  })

  const [observationLevelOptions, setObservationLevelOptions] = useState<LinkFieldOption[]>([])
  const [observationLevelOpen, setObservationLevelOpen] = useState(false)
  const [observationLevelQuery, setObservationLevelQuery] = useState('')
  const [selectedObservationLevel, setSelectedObservationLevel] = useState<LinkFieldOption | null>(null)
  const [observationLevelLoading, setObservationLevelLoading] = useState(false)
  const [roomChargeRoomOptions, setRoomChargeRoomOptions] = useState<ServiceUnit[]>([])
  const [roomChargeRoomOpen, setRoomChargeRoomOpen] = useState(false)
  const [roomChargeRoomQuery, setRoomChargeRoomQuery] = useState('')
  const [selectedRoomChargeRoom, setSelectedRoomChargeRoom] = useState<ServiceUnit | null>(null)
  const [roomChargeRoomLoading, setRoomChargeRoomLoading] = useState(false)
  const [extraChargeSalesOrders, setExtraChargeSalesOrders] = useState<Record<string, string>>({})
  const [obsDepartmentOptions, setObsDepartmentOptions] = useState<LinkFieldOption[]>([])
  const [obsDepartmentOpen, setObsDepartmentOpen] = useState(false)
  const [obsDepartmentQuery, setObsDepartmentQuery] = useState('')
  const [selectedObsDepartment, setSelectedObsDepartment] = useState<LinkFieldOption | null>(null)
  const [obsPractitionerOptions, setObsPractitionerOptions] = useState<LinkFieldOption[]>([])
  const [obsPractitionerOpen, setObsPractitionerOpen] = useState(false)
  const [obsPractitionerQuery, setObsPractitionerQuery] = useState('')
  const [selectedObsPractitioner, setSelectedObsPractitioner] = useState<LinkFieldOption | null>(null)

  // Observation level & related details auto-fetch from the admission's latest
  // observation record (reception request) — only when the section is untouched.
  useEffect(() => {
    const admissionId = typeof admission === 'string' ? admission : admission?.name
    if (!admissionId) return
    let cancelled = false
    ;(async () => {
      try {
        const obs = await fetchLatestObservationForAdmission(admissionId)
        if (cancelled || !obs || !obs.observation_level) return
        setFormData((prev) => {
          if (prev.observation_level) return prev
          return {
            ...prev,
            observation_level: obs.observation_level || '',
            observation_room: obs.room || prev.observation_room,
            observation_start_date: obs.start_date || prev.observation_start_date,
            observation_duration: obs.duration || prev.observation_duration,
            observation_amount: obs.amount ?? prev.observation_amount,
            observation_practitioner: obs.healthcare_practitioner || prev.observation_practitioner,
            observation_department: obs.medical_department || prev.observation_department,
            observation_designated_security_personel:
              obs.designated_security_personel || prev.observation_designated_security_personel,
            observation_note: obs.note || prev.observation_note,
            observation_record: obs.name || prev.observation_record,
          }
        })
        setSelectedObservationLevel({ name: obs.observation_level, label: obs.observation_level })
        setObservationLevelQuery(obs.observation_level)
        if (obs.healthcare_practitioner) {
          setSelectedObsPractitioner({
            name: obs.healthcare_practitioner,
            label: obs.practitioner_name || obs.healthcare_practitioner,
          })
          setObsPractitionerQuery(obs.practitioner_name || obs.healthcare_practitioner)
        }
      } catch {
        /* manual entry stays available */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [typeof admission === 'string' ? admission : admission?.name])
  const [admissionMedicalDepartment, setAdmissionMedicalDepartment] = useState('')
  const [admissionRoomDefault, setAdmissionRoomDefault] = useState<AdmissionRoomDefault | null>(null)

  const visibleTabIds = useMemo(() => {
    const hasReceptionist = Boolean((formData.discharge_receptionist || '').trim())
    if (hasReceptionist) return roleVisibleTabIds
    // Checklist tabs only apply once a discharge receptionist is assigned.
    return roleVisibleTabIds.filter((id) => id !== 'checklist' && id !== 'nursing')
  }, [roleVisibleTabIds, formData.discharge_receptionist])

  const tabs = useMemo(
    () => DISCHARGE_TAB_DEFINITIONS.filter((t) => visibleTabIds.includes(t.id)),
    [visibleTabIds]
  )

  const canViewDischargeTabPanel = (tabId: DischargeTabId) =>
    visibleTabIds.includes(tabId) && activeTab === tabId

  useEffect(() => {
    if (!visibleTabIds.includes(activeTab)) {
      setActiveTab(visibleTabIds[0] ?? 'details')
    }
  }, [visibleTabIds, activeTab, setActiveTab])

  const clearObservationFields = useCallback((options?: { keepLinkedRecord?: boolean }) => {
    setFormData((prev) => ({
      ...prev,
      discharge_to_observation: 0,
      charge_observation_today: 0,
      observation_level: '',
      observation_room: '',
      observation_start_date: new Date().toISOString().split('T')[0],
      observation_practitioner: '',
      observation_department: '',
      observation_designated_security_personel: '',
      observation_amount: 0,
      observation_duration: '',
      observation_note: '',
      today_charge_obs: 0,
      observation_record: options?.keepLinkedRecord === false ? '' : prev.observation_record,
    }))
    setSelectedObservationLevel(null)
    setObservationLevelQuery('')
    setSelectedObsDepartment(null)
    setObsDepartmentQuery('')
    setSelectedObsPractitioner(null)
    setObsPractitionerQuery('')
  }, [])

  const handleObservationLevelSelect = async (obsLevel: LinkFieldOption) => {
    setSelectedObservationLevel(obsLevel)
    setObservationLevelQuery(obsLevel.label)
    setObservationLevelOpen(false)

    let rateFromLevel: number | undefined
    let intervalFromLevel: string | undefined
    try {
      const details = await fetchObservationLevelDetails(obsLevel.name)
      if (details?.rate != null && Number(details.rate) > 0) {
        rateFromLevel = Number(details.rate)
      }
      if (details?.interval) {
        intervalFromLevel = details.interval
      }
    } catch {
      /* keep manual values */
    }

    setFormData((prev) => {
      const next = {
        ...prev,
        observation_level: obsLevel.name,
      }
      if (rateFromLevel != null && (!prev.observation_amount || Number(prev.observation_amount) === 0)) {
        next.observation_amount = rateFromLevel
        if (Number(prev.charge_observation_today)) {
          next.today_charge_obs = rateFromLevel
        }
      }
      if (intervalFromLevel) {
        next.observation_duration = intervalFromLevel
      }
      return next
    })
  }

  const handleNeedObservationChange = (yes: boolean) => {
    if (yes) {
      const today = new Date().toISOString().split('T')[0]
      setFormData((prev) => ({
        ...prev,
        discharge_to_observation: 1,
        charge_observation_today: prev.charge_observation_today || 1,
        observation_practitioner:
          prev.observation_practitioner ||
          prev.discharge_doctor ||
          admission.discharge_practitioner ||
          admission.primary_practitioner ||
          '',
        observation_department: prev.observation_department || admissionMedicalDepartment || '',
        observation_start_date:
          prev.observation_start_date ||
          (prev.discharge_date ? String(prev.discharge_date).slice(0, 10) : today),
        today_charge_obs: prev.today_charge_obs || prev.observation_amount || 0,
      }))
      if (!selectedObsPractitioner) {
        const practId =
          selectedDischargeDoctor?.name ||
          admission.discharge_practitioner ||
          admission.primary_practitioner
        if (practId) {
          setObsPractitionerQuery(selectedDischargeDoctor?.label || practId)
        }
      }
      if (!selectedObsDepartment && admissionMedicalDepartment) {
        setObsDepartmentQuery(admissionMedicalDepartment)
      }
      // Auto-select Observation Level marked as Default when none is chosen yet.
      void (async () => {
        try {
          const alreadySet = Boolean(
            (formData.observation_level || '').trim() || selectedObservationLevel?.name,
          )
          if (alreadySet) return
          const levels = await fetchObservationLevels()
          const def = pickDefaultLinkOption(levels)
          if (def) await handleObservationLevelSelect(def)
        } catch {
          /* leave level empty for manual pick */
        }
      })()
      return
    }
    clearObservationFields()
  }

  const applyAdmissionRoomChargeDefaults = useCallback(() => {
    if (!admissionRoomDefault) return
    const def = admissionRoomDefault
    setFormData((prev) => {
      const hasUnit = Boolean(prev.room_charge_service_unit?.trim())
      if (!hasUnit) {
        setSelectedRoomChargeRoom({
          name: def.serviceUnit,
          healthcare_service_unit_name: def.displayName,
        } as ServiceUnit)
        setRoomChargeRoomQuery(def.displayName)
      }
      return {
        ...prev,
        room_charge_service_unit: hasUnit ? prev.room_charge_service_unit : def.serviceUnit,
        room_charges:
          prev.room_charges && Number(prev.room_charges) > 0 ? prev.room_charges : def.rate,
      }
    })
  }, [admissionRoomDefault])

  const handleRoomChargeTodayChange = (yes: boolean) => {
    if (yes) {
      setFormData((prev) => ({ ...prev, room_charge_today: 1 }))
      applyAdmissionRoomChargeDefaults()
      return
    }
    setFormData((prev) => ({
      ...prev,
      room_charge_today: 0,
      room_charge_service_unit: '',
      room_charges: 0,
    }))
    setSelectedRoomChargeRoom(null)
    setRoomChargeRoomQuery('')
  }

  const resolveMedicalSupervisionDefaultRate = useCallback(async (): Promise<number> => {
    const serviceUnit =
      formData.room_charge_service_unit?.trim() || admissionRoomDefault?.serviceUnit || ''
    try {
      const preview = await fetchMedicalSupervisionChargePreview(serviceUnit || undefined)
      const rate = Number(preview.rate ?? 0)
      if (rate > 0) return rate
      if (serviceUnit) {
        const chargeItem = await fetchServiceUnitChargeItem(serviceUnit)
        const unitRate = Number(chargeItem.rate ?? 0)
        if (unitRate > 0) return unitRate
        if (chargeItem.item_code) {
          const res = await fetch(
            `/api/method/healthcare.api.patient_medication_order.get_item_rate_api?item_code=${encodeURIComponent(chargeItem.item_code)}`
          )
          const data = await res.json()
          return Number(data?.message?.rate ?? 0)
        }
      }
      if (preview.item_code) {
        const res = await fetch(
          `/api/method/healthcare.api.patient_medication_order.get_item_rate_api?item_code=${encodeURIComponent(preview.item_code)}`
        )
        const data = await res.json()
        return Number(data?.message?.rate ?? 0)
      }
    } catch {
      /* optional default */
    }
    return 0
  }, [formData.room_charge_service_unit, admissionRoomDefault?.serviceUnit])

  const handleMedicalSupervisionTodayChange = (yes: boolean) => {
    if (!yes) {
      setFormData((prev) => ({
        ...prev,
        today_charge: 0,
        medical_supervision_amount: 0,
      }))
      return
    }

    void (async () => {
      const defaultRate = await resolveMedicalSupervisionDefaultRate()
      setFormData((prev) => ({
        ...prev,
        today_charge: 1,
        medical_supervision_amount:
          prev.medical_supervision_amount && Number(prev.medical_supervision_amount) > 0
            ? prev.medical_supervision_amount
            : defaultRate,
      }))
    })()
  }

  const loadAdmissionRoomDefaultFromRecord = useCallback(async (ipRecord: InpatientRecord) => {
    try {
      setAdmissionRoomDefault(await resolveAdmissionRoomDefault(ipRecord))
    } catch {
      setAdmissionRoomDefault(null)
    }
  }, [])

  useEffect(() => {
    if (Number(formData.room_charge_today) !== 1 || !admissionRoomDefault) return
    if (formData.room_charge_service_unit?.trim()) return
    applyAdmissionRoomChargeDefaults()
  }, [
    admissionRoomDefault,
    formData.room_charge_today,
    formData.room_charge_service_unit,
    applyAdmissionRoomChargeDefaults,
  ])

  // ─── Load Medicine Sales ───────────────────────────────────────────────────
const loadMedicineSales = async () => {
  if (!admission?.patient) return
  setSalesLoading(true)
  try {
    // Fetch after-discharge prescriptions (medicines for patient to take home)
    const prescriptions = await fetchAfterDischargePrescriptions(admission.patient, admission.name)
    console.log('After-discharge prescriptions:', prescriptions)
    
    // Fetch given medicines (medicines administered during admission)
    const givenMedicines = await fetchMedicineGiven(admission.name, 500, 0)
    console.log('Given medicines during admission:', givenMedicines)
    
    // Get rates for given medicines
    const medicineCodes = [...new Set(
  givenMedicines
    .map(g => g.medicine_code)
    .filter((code): code is string => Boolean(code))
)]
    const itemRates: Record<string, number> = {}
    
    for (const code of medicineCodes) {
      try {
        const response = await fetch(`/api/method/healthcare.api.patient_medication_order.get_item_rate_api?item_code=${encodeURIComponent(code)}`)
        const data = await response.json()
        itemRates[code] = data.message?.rate || 0
      } catch (err) {
        itemRates[code] = 0
      }
    }
    
    // Calculate totals for given medicines
    const givenMedicinesWithAmount = givenMedicines.map(given => ({
      ...given,
      rate: given.medicine_code ? (itemRates[given.medicine_code] || 0) : 0,
amount: (given.qty || 0) * (given.medicine_code ? (itemRates[given.medicine_code] || 0) : 0)
    }))
    
    const givenTotal = givenMedicinesWithAmount.reduce((sum, g) => sum + (g.amount || 0), 0)
    
    // Calculate prescription totals
    let prescriptionTotal = 0
    for (const prescription of prescriptions) {
      const items = (prescription as any).drugs || (prescription as any).medication_orders || (prescription as any).items || []
const presTotal = items.reduce((sum: number, d: any) => sum + (d.amount || 0), 0)
      prescriptionTotal += presTotal
    }
    
    setMedicineSales({
      prescriptions,
      given_medicines: givenMedicinesWithAmount,
      prescription_total: prescriptionTotal,
      given_total: givenTotal,
      grand_total: prescriptionTotal + givenTotal
    })
  } catch (err) {
    console.error('Failed to load medicine sales:', err)
    toast.error('Failed to load medicine sales data')
  } finally {
    setSalesLoading(false)
  }
}

  // ─── Load Daily Visit Setup ────────────────────────────────────────────────
  const loadDailyVisitSetup = async () => {
    if (!admission?.name) return
    setDailyVisitLoading(true)
    try {
      const response = await fetch(
        `/api/method/healthcare.api.daily_patient_visit.get_daily_patient_visit_setup_for_admission?admission=${encodeURIComponent(admission.name)}`
      )
      const data = await response.json()
      if (data?.exc) {
        throw new Error(frappeErrorMessage(data, 'Failed to load daily visit setup'))
      }
      if (data.message?.name) {
        setDailyVisitSetup(data.message)
        setDailyVisitSaved(true)
        setShowDailyVisitForm(false)
      } else {
        setDailyVisitSaved(false)
        setDailyVisitSetup(null)
      }
    } catch (err) {
      console.error('Failed to load daily visit setup:', err)
    } finally {
      setDailyVisitLoading(false)
    }
  }
  // ─── Save Daily Visit Setup ────────────────────────────────────────────────
  const saveDailyVisitSetup = async (setupData: DailyPatientVisitSetup) => {
    try {
      const csrf = (window as any).csrf_token
      let response
      const payload = {
        ...setupData,
        branch:
          (setupData.branch || '').trim() ||
          (userCostCenter || '').trim() ||
          (admission.cost_center || '').trim() ||
          undefined,
      }
      
      if (dailyVisitSetup?.name) {
        response = await fetch('/api/method/healthcare.api.daily_patient_visit.update_daily_patient_visit_setup', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
          },
          body: JSON.stringify({ name: dailyVisitSetup.name, data: payload })
        })
      } else {
        response = await fetch('/api/method/healthcare.api.daily_patient_visit.create_daily_patient_visit_setup', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {})
          },
          body: JSON.stringify({ data: payload })
        })
      }
      
      const resData = await response.json()
      if (resData?.exc) {
        throw new Error(
          frappeErrorMessage(resData, 'Failed to save daily visit setup')
        )
      }
      
      const successMessage =
        resData?.message?.message ||
        (dailyVisitSetup?.name
          ? 'Daily visit setup updated successfully'
          : 'Daily visit setup created successfully')
      toast.success(successMessage)
      const saved = resData?.message
      if (saved?.name) {
        setDailyVisitSetup(saved)
      }
      setDailyVisitSaved(true)
      setShowDailyVisitForm(false)
      await loadDailyVisitSetup()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save daily visit setup')
    }
  }

  // ─── Load Data ────────────────────────────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      try {
        const [users, doctors, nurses, templates, nurseTemplates, docTypes] = await Promise.all([
          fetchUsers(undefined, 'Receptionist'),
          fetchDischargeDoctorPractitioners(),
          fetchDischargeNursePractitioners(),
          fetchDischargeTemplates(),
          fetchNursingDischargeTemplates(),
          fetchDocumentTypes(),
        ])
        setDischargedByUsers(users)
        setDischargeDoctorOptions(doctors)
        setDischargeNurseOptions(nurses)
        setDischargeTemplates(templates)
        setNurseTemplateOptions(nurseTemplates)
        let resolvedDocTypes = docTypes
        const hasSignatureType = resolvedDocTypes.some((t) => {
          const name = (t.name || '').trim().toLowerCase()
          const label = (t.document_name || '').trim().toLowerCase()
          return name === 'signature' || label === 'signature'
        })
        if (!hasSignatureType) {
          try {
            const created = await createDocumentType(DEFAULT_SIGNATURE_DOC_TYPE)
            resolvedDocTypes = [...resolvedDocTypes, created]
          } catch {
            // Document Type may already exist under another name
          }
        }
        setDocumentTypes(resolvedDocTypes)
        const sigType = resolveSignatureDocumentType(resolvedDocTypes)
        setSignatures((prev) =>
          prev.length
            ? prev
            : [
                {
                  patient_relation: '',
                  signee_name: '',
                  document_type: sigType,
                  upload_remarks: '',
                  document: '',
                },
              ],
        )

        const pickLink = (
          id: string | undefined,
          options: LinkFieldOption[],
          fallbackUsers?: LinkFieldOption[]
        ): LinkFieldOption | null => {
          if (!id) return null
          return (
            options.find((o) => o.name === id) ||
            fallbackUsers?.find((o) => o.name === id) || { name: id, label: id }
          )
        }

        const applyDraftForm = async (
          fd: Record<string, string | number | undefined>,
          checklist: ChecklistItem[] | undefined,
          nursing: ChecklistItem[] | undefined,
          docs: PatientDocumentRow[] | undefined,
          rels: typeof relatives | undefined,
          sigDocType: string = sigType,
        ) => {
          const fdStr = (key: string) => String(fd[key] ?? '')
          setFormData((prev) => ({ ...prev, ...fd }))

          const obsLevel = fdStr('observation_level')
          if (obsLevel) {
            setSelectedObservationLevel({ name: obsLevel, label: obsLevel })
            setObservationLevelQuery(obsLevel)
          }

          const roomChargeUnit = fdStr('room_charge_service_unit')
          if (roomChargeUnit) {
            setSelectedRoomChargeRoom({
              name: roomChargeUnit,
              healthcare_service_unit_name: roomChargeUnit,
            } as ServiceUnit)
            setRoomChargeRoomQuery(roomChargeUnit)
          }

          const obsPractitioner = fdStr('observation_practitioner')
          if (obsPractitioner) {
            const pract = pickLink(obsPractitioner, doctors)
            if (pract) {
              setSelectedObsPractitioner(pract)
              setObsPractitionerQuery(pract.label)
            } else {
              setSelectedObsPractitioner({ name: obsPractitioner, label: obsPractitioner })
              setObsPractitionerQuery(obsPractitioner)
            }
          }

          const obsDepartment = fdStr('observation_department')
          if (obsDepartment) {
            setSelectedObsDepartment({ name: obsDepartment, label: obsDepartment })
            setObsDepartmentQuery(obsDepartment)
          }

          const obsAmount = Number(fd.observation_amount ?? 0)
          const legacyCharge = Number(fd.today_charge_obs ?? 0)
          if (!obsAmount && legacyCharge > 0) {
            setFormData((prev) => ({ ...prev, observation_amount: legacyCharge }))
          }

          const receptionist = pickLink(fdStr('discharge_receptionist') || undefined, users)
          if (receptionist) {
            setSelectedDischargeReceptionist(receptionist)
            setDischargeReceptionistQuery(receptionist.label)
          }

          const doctor = pickLink(fdStr('discharge_doctor') || undefined, doctors)
          if (doctor) {
            setSelectedDischargeDoctor(doctor)
            setDischargeDoctorQuery(doctor.label)
          } else if (!fdStr('discharge_doctor')) {
            const defaultDoctorId = admission.discharge_practitioner || admission.primary_practitioner
            const defaultDoctor = defaultDoctorId ? doctors.find((d) => d.name === defaultDoctorId) : null
            if (defaultDoctor) {
              setSelectedDischargeDoctor(defaultDoctor)
              setDischargeDoctorQuery(defaultDoctor.label)
              setFormData((prev) => ({ ...prev, discharge_doctor: defaultDoctor.name }))
            }
          }

          const nurse = pickLink(fdStr('discharge_nurse') || undefined, nurses)
          if (nurse) {
            setSelectedDischargeNurse(nurse)
            setDischargeNurseQuery(nurse.label)
          }

          const template = pickLink(fdStr('discharge_template') || undefined, templates)
          if (template) {
            setSelectedDischargeTemplate(template)
            setDischargeTemplateQuery(template.label)
          }

          const nurseTpl = fdStr('nurse_discharge_template').trim()
          let nurseSrc = nursingTemplateSourceForName(nurseTpl, nurseTemplates)

          if (nurseTpl) {
            const opt = pickLink(nurseTpl, nurseTemplates)
            const label =
              opt?.label ||
              (await fetchNursingTemplateDisplayLabel(nurseTpl, nurseSrc || undefined))
            setSelectedNurseTemplate({ name: nurseTpl, label })
            setNurseTemplateQuery(label)
            setNursingTemplateSource(nurseSrc)
            setFormData((prev) => ({
              ...prev,
              nurse_discharge_template: nurseTpl,
            }))
          }

          if (checklist?.length) {
            const templateName = fdStr('discharge_template')
            if (templateName) {
              try {
                const templateItems = await fetchDischargeChecklist(templateName)
                setChecklistItems(sortChecklistByOrder(mergeChecklistWithTemplateDepartments(checklist, templateItems)))
              } catch {
                setChecklistItems(sortChecklistByOrder(checklist))
              }
            } else {
              setChecklistItems(sortChecklistByOrder(checklist))
            }
          } else if (fdStr('discharge_template')) {
            await loadChecklist(fdStr('discharge_template'))
          } else if (!nursePrimaryUser) {
            const defaultTemplate = pickDefaultLinkOption(templates)
            if (defaultTemplate) {
              setSelectedDischargeTemplate(defaultTemplate)
              setDischargeTemplateQuery(defaultTemplate.label)
              setFormData((prev) => ({ ...prev, discharge_template: defaultTemplate.name }))
              await loadChecklist(defaultTemplate.name)
            }
          }

          if (nursing?.length) {
            setNurseChecklistItems(nursing)
            const deptMap: Record<string, boolean> = {}
            nursing.forEach((item) => {
              const dept = item.department_label || item.department || 'Nursing'
              deptMap[dept] = true
            })
            setExpandedNurseDepts(deptMap)
          } else if (nurseTpl && nurseSrc) {
            await loadNurseChecklist(nurseTpl, nurseSrc)
          } else if (!nurseTpl) {
            try {
              const ipRecord = await fetchInpatientRecord(admission.name)
              await loadAdmissionRoomDefaultFromRecord(ipRecord)
              const admissionNursingTemplate = ipRecord?.discharge_nursing_checklist_template as
                | string
                | undefined
              if (admissionNursingTemplate) {
                const nctOpt = nurseTemplates.find((t) => t.name === admissionNursingTemplate)
                const label =
                  nctOpt?.label ||
                  (await fetchNursingTemplateDisplayLabel(
                    admissionNursingTemplate,
                    'nursing_checklist'
                  ))
                setSelectedNurseTemplate({ name: admissionNursingTemplate, label })
                setNurseTemplateQuery(label)
                setNursingTemplateSource('nursing_checklist')
                setFormData((prev) => ({
                  ...prev,
                  nurse_discharge_template: admissionNursingTemplate,
                }))
                if (!nursing?.length) {
                  await loadNurseChecklist(admissionNursingTemplate, 'nursing_checklist')
                }
              } else {
                const defaultNursing = pickDefaultNursingTemplate(nurseTemplates)
                if (defaultNursing) {
                  setSelectedNurseTemplate(defaultNursing.template)
                  setNurseTemplateQuery(defaultNursing.template.label)
                  setNursingTemplateSource(defaultNursing.src)
                  setFormData((prev) => ({
                    ...prev,
                    nurse_discharge_template: defaultNursing.template.name,
                  }))
                  if (!nursing?.length) {
                    await loadNurseChecklist(defaultNursing.template.name, defaultNursing.src)
                  }
                }
              }
            } catch {
              /* ignore */
            }
          }

          if (docs?.length) {
            const split = splitPatientDocumentRows(docs, sigDocType)
            setDocuments(split.documents)
            setSignatures(
              split.signatures.length
                ? split.signatures
                : [
                    {
                      patient_relation: '',
                      signee_name: '',
                      document_type: sigDocType,
                      upload_remarks: '',
                      document: '',
                    },
                  ],
            )
          }
          if (rels?.length) {
            setRelatives(rels)
          }
        }

        let resumed = false
        try {
          const serverDraft = await fetchDischargeDraftForAdmission(admission.name)
          if (serverDraft?.form_data) {
            await applyDraftForm(
              serverDraft.form_data,
              serverDraft.discharge_checklist as ChecklistItem[] | undefined,
              serverDraft.nursing_checklist as ChecklistItem[] | undefined,
              serverDraft.patient_documents as PatientDocumentRow[] | undefined,
              serverDraft.patient_relatives as typeof relatives | undefined
            )
            if (serverDraft.extra_charges?.length) {
              const orders: Record<string, string> = {}
              for (const row of serverDraft.extra_charges) {
                if (row.charge_type && row.sales_order) {
                  orders[row.charge_type] = row.sales_order
                }
              }
              setExtraChargeSalesOrders(orders)
            }
            const fd = serverDraft.form_data
            const hasNurseTemplate = Boolean((fd.nurse_discharge_template || '').trim())
            const localDraft = loadDischargeDraft(admission.name)
            if (!hasNurseTemplate && localDraft?.selectedOptions?.nurseTemplate) {
              const lt = localDraft.selectedOptions.nurseTemplate
              const src =
                localDraft.selectedOptions.nursingTemplateSource ||
                nursingTemplateSourceForName(lt.name, nurseTemplates)
              setSelectedNurseTemplate(lt)
              setNurseTemplateQuery(
                localDraft.selectedOptions.nurseTemplateQuery || lt.label
              )
              setNursingTemplateSource(src)
              setFormData((prev) => ({
                ...prev,
                nurse_discharge_template: lt.name,
              }))
              if (!serverDraft.nursing_checklist?.length) {
                await loadNurseChecklist(lt.name, src)
              }
            }
            toast.info(`Resumed server draft ${serverDraft.name}`, 3000)
            resumed = true
            try {
              await loadAdmissionRoomDefaultFromRecord(await fetchInpatientRecord(admission.name))
            } catch {
              /* optional room default */
            }
          }
        } catch (serverDraftErr) {
          console.error('Failed to load server discharge draft:', serverDraftErr)
        }

        if (resumed) {
          return
        }

        const draft = loadDischargeDraft(admission.name)
        if (draft) {
          await applyDraftForm(
            draft.formData,
            draft.checklistItems as ChecklistItem[] | undefined,
            draft.nurseChecklistItems as ChecklistItem[] | undefined,
            draft.documents as PatientDocumentRow[] | undefined,
            draft.relatives as typeof relatives | undefined
          )
          if (draft.selectedOptions.dischargeReceptionist && !draft.formData.discharge_receptionist) {
            setSelectedDischargeReceptionist(draft.selectedOptions.dischargeReceptionist)
            setDischargeReceptionistQuery(
              draft.selectedOptions.dischargeReceptionistQuery ||
                draft.selectedOptions.dischargeReceptionist.label
            )
          }
          if (draft.selectedOptions.dischargeDoctor && !draft.formData.discharge_doctor) {
            setSelectedDischargeDoctor(draft.selectedOptions.dischargeDoctor)
            setDischargeDoctorQuery(
              draft.selectedOptions.dischargeDoctorQuery || draft.selectedOptions.dischargeDoctor.label
            )
          } else if (draft.selectedOptions.receivingDoctor) {
            setSelectedDischargeDoctor(draft.selectedOptions.receivingDoctor)
            setDischargeDoctorQuery(
              draft.selectedOptions.receivingDoctorsQuery || draft.selectedOptions.receivingDoctor.label
            )
          }
          if (draft.selectedOptions.dischargeNurse && !draft.formData.discharge_nurse) {
            setSelectedDischargeNurse(draft.selectedOptions.dischargeNurse)
            setDischargeNurseQuery(
              draft.selectedOptions.dischargeNurseQuery || draft.selectedOptions.dischargeNurse.label
            )
          }
          if (draft.selectedOptions.nurseTemplate) {
            const lt = draft.selectedOptions.nurseTemplate
            const src =
              draft.selectedOptions.nursingTemplateSource ||
              nursingTemplateSourceForName(lt.name, nurseTemplates)
            if (!selectedNurseTemplate) {
              setSelectedNurseTemplate(lt)
              setNurseTemplateQuery(draft.selectedOptions.nurseTemplateQuery || lt.label)
              setNursingTemplateSource(src)
              setFormData((prev) => ({
                ...prev,
                nurse_discharge_template: lt.name,
              }))
            }
          }
          toast.info('Resumed from saved draft', 3000)
          try {
            await loadAdmissionRoomDefaultFromRecord(await fetchInpatientRecord(admission.name))
          } catch {
            /* optional room default */
          }
          return
        }

        if (!nursePrimaryUser) {
          const defaultTemplate = pickDefaultLinkOption(templates)
          if (defaultTemplate) {
            setSelectedDischargeTemplate(defaultTemplate)
            setFormData((prev) => ({ ...prev, discharge_template: defaultTemplate.name }))
            setDischargeTemplateQuery(defaultTemplate.label)
            await loadChecklist(defaultTemplate.name)
          }
        }

        try {
          const ipRecord = await fetchInpatientRecord(admission.name)
          await loadAdmissionRoomDefaultFromRecord(ipRecord)
          if (ipRecord?.medical_department) {
            setAdmissionMedicalDepartment(String(ipRecord.medical_department))
          }
          const admissionNursingTemplate = ipRecord?.discharge_nursing_checklist_template as string | undefined
          if (admissionNursingTemplate) {
            const nctOpt = nurseTemplates.find((t) => t.name === admissionNursingTemplate)
            const label = nctOpt?.label || admissionNursingTemplate
            setSelectedNurseTemplate({ name: admissionNursingTemplate, label })
            setNurseTemplateQuery(label)
            setNursingTemplateSource('nursing_checklist')
            setFormData((prev) => ({
              ...prev,
              nurse_discharge_template: admissionNursingTemplate,
            }))
            await loadNurseChecklist(admissionNursingTemplate, 'nursing_checklist')
          } else {
            const defaultNursing = pickDefaultNursingTemplate(nurseTemplates)
            if (defaultNursing) {
              setSelectedNurseTemplate(defaultNursing.template)
              setNurseTemplateQuery(defaultNursing.template.label)
              setNursingTemplateSource(defaultNursing.src)
              setFormData((prev) => ({
                ...prev,
                nurse_discharge_template: defaultNursing.template.name,
              }))
              await loadNurseChecklist(defaultNursing.template.name, defaultNursing.src)
            }
          }
        } catch (admissionTplErr) {
          console.warn('Could not load admission nursing discharge template:', admissionTplErr)
        }

        const defaultDoctorId = admission.discharge_practitioner || admission.primary_practitioner
        if (defaultDoctorId) {
          const defaultDoctor = doctors.find((d) => d.name === defaultDoctorId)
          if (defaultDoctor) {
            setSelectedDischargeDoctor(defaultDoctor)
            setDischargeDoctorQuery(defaultDoctor.label)
            setFormData((prev) => ({ ...prev, discharge_doctor: defaultDoctor.name }))
          }
        }

      } catch (err) {
        console.error('Failed to load data:', err)
      }
    }
    loadData()
  }, [admission.name])

  // Load data when tabs are opened
  useEffect(() => {
    if (activeTab === 'medicine-sales') {
      loadMedicineSales()
    }
    if (activeTab === 'daily-visit') {
      loadDailyVisitSetup()
    }
  }, [activeTab, admission?.patient, admission?.name])

  useEffect(() => {
    if (activeTab === 'details' || activeTab === 'transfer') {
      void loadPrescriptionSections()
    }
  }, [activeTab, loadPrescriptionSections])

  const loadChecklist = async (templateName: string) => {
    if (!templateName) return
    setChecklistLoading(true)
    try {
      const items = await fetchDischargeChecklist(templateName)
      setChecklistItems(sortChecklistByOrder(items))
    } catch (err) {
      console.error('Failed to load checklist:', err)
      setChecklistItems([])
    } finally {
      setChecklistLoading(false)
    }
  }

  const loadNurseChecklist = async (
    templateName: string,
    templateSource?: NursingDischargeTemplateSource | null
  ) => {
    if (!templateName) return
    const source = templateSource ?? nursingTemplateSource ?? undefined
    setNurseChecklistLoading(true)
    try {
      const items = await fetchNursingDischargeChecklist(templateName, source)
      setNurseChecklistItems(items)
      const deptMap: Record<string, boolean> = {}
      items.forEach((item: ChecklistItem) => {
        const dept = item.department_label || item.department || 'General'
        deptMap[dept] = true
      })
      setExpandedNurseDepts(deptMap)
    } catch (err) {
      console.error('Failed to load nursing checklist:', err)
      setNurseChecklistItems([])
    } finally {
      setNurseChecklistLoading(false)
    }
  }

  const addDocumentRow = () => {
    setDocuments(prev => [...prev, { file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }])
  }

  const removeDocumentRow = (idx: number) => {
    setDocuments(prev => prev.filter((_, i) => i !== idx))
  }

  const updateDocumentRow = (idx: number, field: keyof PatientDocumentRow, value: string) => {
    setDocuments(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const addSignatureRow = () => {
    setSignatures((prev) => [
      ...prev,
      {
        patient_relation: '',
        signee_name: '',
        document_type: signatureDocType,
        upload_remarks: '',
        document: '',
      },
    ])
  }

  const removeSignatureRow = (idx: number) => {
    setSignatures((prev) => prev.filter((_, i) => i !== idx))
  }

  const updateSignatureRow = (idx: number, field: keyof PatientDocumentRow, value: string) => {
    setSignatures((prev) => {
      const next = [...prev]
      const updated = { ...next[idx], [field]: value }
      // Keep file_name aligned — historically the only persisted place for the name.
      if (field === 'signee_name') {
        updated.file_name = value.trim() || updated.file_name || ''
      }
      next[idx] = updated
      return next
    })
  }

  const handleDocumentFile = async (idx: number, file: File | null) => {
    if (!file) return
    setDocumentUploading(idx)
    try {
      const file_url = await uploadPatientFile(file)
      if (!file_url) throw new Error('No URL returned from upload')
      setDocuments(prev => {
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          document: file_url,
          file_name: next[idx].file_name?.trim() || file.name,
        }
        return next
      })
      toast.success('File uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File upload failed')
    } finally {
      setDocumentUploading(null)
    }
  }

  const handleSignatureFile = async (idx: number, file: File) => {
    setSignatureUploading(idx)
    try {
      const file_url = await uploadPatientFile(file)
      if (!file_url) throw new Error('No URL returned from signature upload')
      setSignatures((prev) => {
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          document: file_url,
          document_type: next[idx].document_type || signatureDocType,
          file_name: (next[idx].signee_name || '').trim() || `Signature ${idx + 1}`,
        }
        return next
      })
      toast.success('Signature saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signature upload failed')
    } finally {
      setSignatureUploading(null)
    }
  }

  // Search effects
  useEffect(() => {
    if (!dischargeReceptionistOpen) return
    const search = async () => {
      try {
        const results = await fetchUsers(dischargeReceptionistQuery, 'Receptionist')
        setDischargedByUsers(results)
      } catch {
        setDischargedByUsers([])
      }
    }
    const id = setTimeout(search, dischargeReceptionistQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [dischargeReceptionistQuery, dischargeReceptionistOpen])

  useEffect(() => {
    if (!dischargeDoctorOpen) return
    const search = async () => {
      try {
        const results = await fetchDischargeDoctorPractitioners(dischargeDoctorQuery)
        setDischargeDoctorOptions(results)
      } catch {
        setDischargeDoctorOptions([])
      }
    }
    const id = setTimeout(search, dischargeDoctorQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [dischargeDoctorQuery, dischargeDoctorOpen])

  useEffect(() => {
    if (!dischargeNurseOpen) return
    const search = async () => {
      try {
        const results = await fetchDischargeNursePractitioners(dischargeNurseQuery)
        setDischargeNurseOptions(results)
      } catch {
        setDischargeNurseOptions([])
      }
    }
    const id = setTimeout(search, dischargeNurseQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [dischargeNurseQuery, dischargeNurseOpen])

  useEffect(() => {
    if (!dischargeTemplateOpen) return
    const search = async () => {
      try { const results = await fetchDischargeTemplates(dischargeTemplateQuery); setDischargeTemplates(results) }
      catch { setDischargeTemplates([]) }
    }
    const id = setTimeout(search, dischargeTemplateQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [dischargeTemplateQuery, dischargeTemplateOpen])

  useEffect(() => {
    if (!nurseTemplateOpen) return
    const search = async () => {
      try { const results = await fetchNursingDischargeTemplates(nurseTemplateQuery); setNurseTemplateOptions(results) }
      catch { setNurseTemplateOptions([]) }
    }
    const id = setTimeout(search, nurseTemplateQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [nurseTemplateQuery, nurseTemplateOpen])

  useEffect(() => {
    if (!observationLevelOpen) return
    const search = async () => {
      setObservationLevelLoading(true)
      try {
        const results = await fetchObservationLevels(observationLevelQuery.trim() || undefined)
        setObservationLevelOptions(results)
      } catch {
        setObservationLevelOptions([])
      } finally {
        setObservationLevelLoading(false)
      }
    }
    const id = setTimeout(search, observationLevelQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [observationLevelQuery, observationLevelOpen])

  useEffect(() => {
    if (!roomChargeRoomOpen || !Number(formData.room_charge_today)) return
    const search = async () => {
      setRoomChargeRoomLoading(true)
      try {
        const results = await fetchServiceUnits(roomChargeRoomQuery.trim() || undefined, 'Vacant')
        setRoomChargeRoomOptions(results)
      } catch {
        setRoomChargeRoomOptions([])
      } finally {
        setRoomChargeRoomLoading(false)
      }
    }
    const id = setTimeout(search, roomChargeRoomQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [roomChargeRoomQuery, roomChargeRoomOpen, formData.room_charge_today])

  useEffect(() => {
    if (!obsDepartmentOpen || !Number(formData.discharge_to_observation)) return
    const search = async () => {
      try {
        const results = await fetchMedicalDepartments(obsDepartmentQuery.trim() || undefined)
        setObsDepartmentOptions(results)
      } catch {
        setObsDepartmentOptions([])
      }
    }
    const id = setTimeout(search, obsDepartmentQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [obsDepartmentQuery, obsDepartmentOpen, formData.discharge_to_observation])

  useEffect(() => {
    if (!obsPractitionerOpen || !Number(formData.discharge_to_observation)) return
    const search = async () => {
      try {
        const results = await fetchHealthcarePractitioners(
          obsPractitionerQuery.trim() || undefined,
          formData.observation_department || admissionMedicalDepartment || undefined
        )
        setObsPractitionerOptions(results)
      } catch {
        setObsPractitionerOptions([])
      }
    }
    const id = setTimeout(search, obsPractitionerQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [
    obsPractitionerQuery,
    obsPractitionerOpen,
    formData.discharge_to_observation,
    formData.observation_department,
    admissionMedicalDepartment,
  ])

  useEffect(() => {
    if (activeTab !== 'charges' || !Number(formData.discharge_to_observation)) return
    setFormData((prev) => {
      const today = new Date().toISOString().split('T')[0]
      const next = { ...prev }
      if (!prev.observation_practitioner) {
        next.observation_practitioner =
          prev.discharge_doctor ||
          admission.discharge_practitioner ||
          admission.primary_practitioner ||
          ''
      }
      if (!prev.observation_department && admissionMedicalDepartment) {
        next.observation_department = admissionMedicalDepartment
      }
      if (!prev.observation_start_date) {
        next.observation_start_date =
          prev.discharge_date ? String(prev.discharge_date).slice(0, 10) : today
      }
      return next
    })
  }, [activeTab, formData.discharge_to_observation, admission.discharge_practitioner, admission.primary_practitioner, admissionMedicalDepartment])

  useEffect(() => {
    if (!departmentOpenForItem) return
    const search = async () => {
      try { const results = await fetchDepartments(departmentQuery || undefined); setDepartmentOptions(results) }
      catch { setDepartmentOptions([]) }
    }
    const id = setTimeout(search, departmentQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(id)
  }, [departmentQuery, departmentOpenForItem])

  useEffect(() => {
    if (activeTab !== 'checklist' && activeTab !== 'nursing') {
      setDepartmentOpenForItem(null)
      setUserOpenForItem(null)
    }
  }, [activeTab])

  // Checklist helpers
  const toggleItem = (itemName: string) => setExpandedItems(prev => ({ ...prev, [itemName]: !prev[itemName] }))

  const toggleCheck = (itemName: string) => {
    const item = checklistItems.find((row) => row.name === itemName)
    if (!item) return
    const toggle = canToggleDischargeChecklistItem(item, checklistItems, userDepartments, userRole)
    if (!toggle.allowed) {
      toast.error(toggle.reason || 'You cannot update this checklist item.')
      return
    }
    const checking = !item.click
    const loggedInUser = typeof currentUser?.name === 'string' ? currentUser.name : ''
    setChecklistItems(prev =>
      prev.map(row =>
        row.name === itemName
          ? {
              ...row,
              click: checking,
              date_time: checking ? fromDatetimeLocalValue() : '',
              user: checking ? loggedInUser || row.user : '',
            }
          : row
      )
    )
  }

  const updateChecklistItem = (itemName: string, field: keyof ChecklistItem, value: string) => {
    const item = checklistItems.find((row) => row.name === itemName)
    if (!item || !canEditChecklistRow(item)) return
    if (field === 'department' || field === 'department_2' || field === 'department_3') return
    setChecklistItems(prev =>
      prev.map(row => row.name === itemName ? { ...row, [field]: value } : row)
    )
  }

  // Nursing Checklist helpers
  const toggleNurseDept = (dept: string) => setExpandedNurseDepts(prev => ({ ...prev, [dept]: !prev[dept] }))

  const toggleNurseCheck = (itemName: string) => {
    const loggedInUser = typeof currentUser?.name === 'string' ? currentUser.name : ''
    setNurseChecklistItems(prev =>
      prev.map(item =>
        item.name === itemName
          ? {
              ...item,
              click: !item.click,
              date_time: !item.click ? fromDatetimeLocalValue() : '',
              user: !item.click ? loggedInUser || item.user : '',
            }
          : item
      )
    )
  }

  const updateNurseChecklistItem = (itemName: string, field: keyof ChecklistItem, value: string) => {
    setNurseChecklistItems(prev =>
      prev.map(item => item.name === itemName ? { ...item, [field]: value } : item)
    )
  }

  const refreshChecklistFromServerDraft = useCallback(async () => {
    if (!admission?.name) return
    try {
      const serverDraft = await fetchDischargeDraftForAdmission(admission.name)
      if (!serverDraft?.discharge_checklist?.length) return
      const checklist = serverDraft.discharge_checklist as ChecklistItem[]
      const templateName = (serverDraft.form_data as { discharge_template?: string } | undefined)
        ?.discharge_template
      if (templateName) {
        try {
          const templateItems = await fetchDischargeChecklist(templateName)
          setChecklistItems(sortChecklistByOrder(mergeChecklistWithTemplateDepartments(checklist, templateItems)))
        } catch {
          setChecklistItems(sortChecklistByOrder(checklist))
        }
      } else {
        setChecklistItems(sortChecklistByOrder(checklist))
      }
    } catch {
      /* ignore */
    }
  }, [admission?.name])

  const handlePrescriptionSectionChanged = useCallback(
    async (result?: { patient_visit: string; patient_medication_order: string }) => {
      await loadPrescriptionSections()
      if (result?.patient_medication_order) {
        await refreshChecklistFromServerDraft()
        setActiveTab('transfer')
      }
    },
    [loadPrescriptionSections, refreshChecklistFromServerDraft, setActiveTab],
  )

  const orderedChecklist = useMemo(() => sortChecklistByOrder(checklistItems), [checklistItems])
  const checklistSummary = useMemo(
    () => summarizeDischargeChecklistStatus(checklistItems),
    [checklistItems]
  )
  const totalItems = checklistSummary.checklist_total
  const completedItems = checklistSummary.checklist_completed
  const checklistIncomplete = checklistSummary.checklist_incomplete
  const checklistStatus = checklistSummary.checklist_status
  const allCompleted = checklistStatus === 'complete'
  const financeOnlyPending = checklistStatus === 'finance_pending'
  const hasDischargeReceptionist = Boolean((formData.discharge_receptionist || '').trim())
  const canSubmitDischarge =
    !hasDischargeReceptionist || canSubmitDischargeWithChecklist(checklistItems)
  const canDischargeWithoutFinanceAction =
    hasDischargeReceptionist && canDischargeWithoutFinance(checklistItems)
  const showDischargePatientButton = canSubmitDischarge
  const showDischargeWithoutFinanceButton = canDischargeWithoutFinanceAction

  const groupedNurseChecklist = groupByDepartment(nurseChecklistItems)
  const nurseTotalItems = nurseChecklistItems.length
  const nurseCompletedItems = nurseChecklistItems.filter(i => i.click).length
  const nurseAllCompleted = nurseTotalItems > 0 && nurseCompletedItems === nurseTotalItems

  const closeAllDropdowns = () => {
    setDischargeReceptionistOpen(false)
    setDischargeDoctorOpen(false)
    setDischargeNurseOpen(false)
    setDischargeTemplateOpen(false)
    setNurseTemplateOpen(false)
  }

  const buildDischargePayload = () => {
    const patientRelatives = relatives
      .map(r => ({
        relationship_with_patient: r.relationship_with_patient?.trim() || '',
        relative_name: r.relative_name?.trim() || '',
        relative_phone_no: r.relative_phone_no?.trim() || '',
        relative_alternative_phone_no: r.relative_alternative_phone_no?.trim() || '',
        relative_alternative_phone_no_2: r.relative_alternative_phone_no_2?.trim() || '',
        cpr__id_no: r.cpr__id_no?.trim() || '',
        any_remarks: r.any_remarks?.trim() || '',
      }))
      .filter(
        r =>
          r.relationship_with_patient ||
          r.relative_name ||
          r.cpr__id_no ||
          r.any_remarks ||
          r.relative_phone_no ||
          r.relative_alternative_phone_no ||
          r.relative_alternative_phone_no_2
      )

    const payload: Record<string, unknown> = {
      ...formData,
      nurse_discharge_template:
        selectedNurseTemplate?.name || formData.nurse_discharge_template || '',
      patient_document: [
        ...documents
          .filter((r) => (r.file_name || '').trim() || (r.document || '').trim())
          .map((r) => ({
            file_name: (r.file_name || '').trim() || undefined,
            document_type: (r.document_type || '').trim() || undefined,
            transaction_no: (r.transaction_no || '').trim() || undefined,
            upload_remarks: (r.upload_remarks || '').trim() || undefined,
            document: (r.document || '').trim() || undefined,
          })),
        ...signatures
          .filter(
            (r) =>
              (r.document || '').trim() ||
              (r.patient_relation || '').trim() ||
              (r.signee_name || '').trim(),
          )
          .map((r) => ({
            file_name: (r.signee_name || r.file_name || '').trim() || undefined,
            document_type: (r.document_type || signatureDocType || '').trim() || undefined,
            transaction_no: (r.transaction_no || '').trim() || undefined,
            upload_remarks: (r.upload_remarks || '').trim() || undefined,
            document: (r.document || '').trim() || undefined,
            patient_relation: (r.patient_relation || '').trim() || undefined,
            signee_name: (r.signee_name || '').trim() || undefined,
          })),
      ],
      patient_relatives: patientRelatives,
    }
    // observation_record is server-owned once created; never send from the portal.
    delete payload.observation_record
    delete payload.today_charge_sales_order

    // Doctors/reception do not load the Nursing tab; omit so Save does not clear nurse work.
    if (visibleTabIds.includes('checklist')) {
      payload.discharge_checklist = checklistItems.map((item) => ({
        name: item.name,
        action_required: item.action_required,
        department: item.department,
        department_2: item.department_2 || '',
        department_3: item.department_3 || '',
        user: item.user,
        name1: item.name1,
        date_time: item.date_time ? toFrappeDateTime(item.date_time) : '',
        click: item.click ? 1 : 0,
        description: item.description || '',
        sr_num: item.sr_num || '',
      }))
    }
    if (visibleTabIds.includes('nursing')) {
      payload.nursing_checklist = nurseChecklistItems.map((item) => ({
        action_required: item.action_required,
        department: item.department,
        user: item.user,
        name1: item.name1,
        date_time: item.date_time ? toFrappeDateTime(item.date_time) : '',
        click: item.click ? 1 : 0,
        description: item.description || '',
      }))
    }

    return payload
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setUnbilledServices(null)

    if (!formData.discharge_type) {
      setError('Select a Discharge Type')
      return
    }

    if (!canSubmitDischarge) {
      setError(
        financeOnlyPending
          ? 'Only finance checklist items remain. Use Discharge Without Finance, or complete finance first.'
          : `Please complete all discharge checklist items. ${checklistIncomplete} item${checklistIncomplete !== 1 ? 's' : ''} remaining.`
      )
      setActiveTab('checklist')
      return
    }

    if (!validateObservationIfEnabled()) return

    if (Number(formData.room_charge_today)) {
      if (!formData.room_charges || Number(formData.room_charges) <= 0) {
        setError('Room Charges amount must be greater than zero')
        setActiveTab('charges')
        return
      }
    }
    if (
      Number(formData.today_charge) &&
      (!formData.medical_supervision_amount || Number(formData.medical_supervision_amount) <= 0)
    ) {
      setError('Medical Supervision Amount must be greater than zero')
      setActiveTab('charges')
      return
    }

    try {
      setSubmitting(true)
      const result = await createDischarge(admission.name, buildDischargePayload()) as {
        message?: string
        observation?: string
        sales_order?: string
      }
      clearDischargeDraft(admission.name)
      const successMsg =
        result?.message ||
        (result?.observation && result?.sales_order
          ? `Patient discharged. Observation ${result.observation} and Sales Order ${result.sales_order} created.`
          : result?.observation
            ? `Patient discharged. Observation ${result.observation} created.`
            : 'Patient discharged successfully!')
      toast.success(successMsg, 5000)
      onSuccess()
    } catch (err) {
      if (err instanceof UnbilledServicesError) {
        setUnbilledServices(err.services)
        setError(null)
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to discharge patient'
        toast.error(errorMessage, 5000)
        setError(errorMessage)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDischargeWithoutFinance = async () => {
    setError(null)
    setUnbilledServices(null)

    if (!formData.discharge_type) {
      setError('Select a Discharge Type')
      return
    }

    if (!canDischargeWithoutFinanceAction) {
      setError(
        'Discharge Without Finance is only available when the only remaining checklist items are finance/accounts.'
      )
      setActiveTab('checklist')
      return
    }

    if (!validateObservationIfEnabled()) return

    if (Number(formData.room_charge_today)) {
      if (!formData.room_charges || Number(formData.room_charges) <= 0) {
        setError('Room Charges amount must be greater than zero')
        setActiveTab('charges')
        return
      }
    }
    if (
      Number(formData.today_charge) &&
      (!formData.medical_supervision_amount || Number(formData.medical_supervision_amount) <= 0)
    ) {
      setError('Medical Supervision Amount must be greater than zero')
      setActiveTab('charges')
      return
    }

    try {
      setSubmitting(true)
      const result = await dischargeWithoutFinance(admission.name, buildDischargePayload()) as {
        message?: string
        observation?: string
        sales_order?: string
      }
      clearDischargeDraft(admission.name)
      const successMsg =
        result?.message ||
        'Patient discharged without finance. Complete finance checklist and submit the Discharge when ready.'
      toast.success(successMsg, 5000)
      onSuccess()
    } catch (err) {
      if (err instanceof UnbilledServicesError) {
        setUnbilledServices(err.services)
        setError(null)
      } else {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to discharge without finance'
        toast.error(errorMessage, 5000)
        setError(errorMessage)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const validateObservationIfEnabled = (): boolean => {
    // Observation fields (level, room, etc.) are optional when Need Observation is Yes.
    return true
  }

  const persistLocalDischargeDraft = () => {
    saveDischargeDraft(admission.name, {
      formData,
      selectedOptions: {
        dischargeReceptionist: selectedDischargeReceptionist,
        dischargeDoctor: selectedDischargeDoctor,
        dischargeNurse: selectedDischargeNurse,
        dischargeTemplate: selectedDischargeTemplate,
        nurseTemplate: selectedNurseTemplate,
        nursingTemplateSource,
        dischargeReceptionistQuery,
        dischargeDoctorQuery,
        dischargeNurseQuery,
        dischargeTemplateQuery,
        nurseTemplateQuery,
      },
      checklistItems,
      nurseChecklistItems,
      documents: [...documents, ...signatures],
      relatives,
    })
  }

  const applyServerDraftObservationResult = (result: {
    observation?: string
    observation_record?: string
  }) => {
    if (result?.observation || result?.observation_record) {
      setFormData((prev) => ({
        ...prev,
        observation_record: result.observation_record || result.observation || prev.observation_record,
      }))
    }
  }

  const handleSaveObservation = async () => {
    setError(null)
    if (!validateObservationIfEnabled()) return

    try {
      setSavingObservation(true)
      const result = await saveDischargeDraftToServer(admission.name, buildDischargePayload(), {
        syncObservation: true,
        syncChargeTypes: ['Observation'],
      })
      persistLocalDischargeDraft()
      applyServerDraftObservationResult(result)
      toast.success(
        result?.message ||
          (result?.observation
            ? `Observation saved. ${result.observation}${result.sales_order ? ` · Sales Order ${result.sales_order}` : ''}`
            : 'Observation saved.'),
        5000
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save observation'
      toast.error(errorMessage, 5000)
      setError(errorMessage)
    } finally {
      setSavingObservation(false)
    }
  }

  const handleDeleteObservation = async () => {
    if (
      !window.confirm(
        'Delete this observation? The linked observation record and any draft sales order will be removed from this discharge.'
      )
    ) {
      return
    }

    setError(null)
    try {
      setDeletingObservation(true)
      const result = await deleteDischargeObservation(admission.name)
      clearObservationFields({ keepLinkedRecord: false })
      removeExtraChargeOrder('Observation')
      setSelectedObservationLevel(null)
      setObservationLevelQuery('')
      setSelectedObsDepartment(null)
      setObsDepartmentQuery('')
      setSelectedObsPractitioner(null)
      setObsPractitionerQuery('')
      persistLocalDischargeDraft()
      toast.success(result?.message || 'Observation deleted', 5000)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete observation'
      toast.error(errorMessage, 5000)
      setError(errorMessage)
    } finally {
      setDeletingObservation(false)
    }
  }

  const handleChangeObservation = () => {
    toast.info('Update Need Observation? below to change this choice.', 4000)
  }

  const validateChargeIfEnabled = (): boolean => {
    if (Number(formData.room_charge_today)) {
      if (!formData.room_charges || Number(formData.room_charges) <= 0) {
        setError('Room Charges amount must be greater than zero')
        setActiveTab('charges')
        return false
      }
    }
    if (Number(formData.today_charge)) {
      if (!formData.medical_supervision_amount || Number(formData.medical_supervision_amount) <= 0) {
        setError('Medical Supervision Amount must be greater than zero')
        setActiveTab('charges')
        return false
      }
    }
    return true
  }

  const applyServerDraftChargeResult = (result: {
    today_charge_sales_order?: string
    charge_sales_order?: string
    charge_sales_orders?: Record<string, string>
  }) => {
    const orders = { ...extraChargeSalesOrders, ...(result.charge_sales_orders || {}) }
    const so =
      result.today_charge_sales_order ||
      result.charge_sales_order ||
      orders['Room Charges'] ||
      orders['Medical Supervision'] ||
      orders.Observation
    if (result.charge_sales_orders) {
      setExtraChargeSalesOrders(orders)
    }
    if (so) {
      setFormData((prev) => ({
        ...prev,
        today_charge_sales_order: orders['Room Charges'] || prev.today_charge_sales_order,
      }))
    }
  }

  const removeExtraChargeOrder = (chargeType: string) => {
    setExtraChargeSalesOrders((prev) => {
      const next = { ...prev }
      delete next[chargeType]
      return next
    })
  }

  const clearLocalRoomChargeFields = () => {
    setFormData((prev) => ({
      ...prev,
      room_charge_today: 0,
      room_charge_service_unit: '',
      room_charges: 0,
      today_charge_sales_order: '',
    }))
    setSelectedRoomChargeRoom(null)
    setRoomChargeRoomQuery('')
  }

  const clearLocalMedicalSupervisionFields = () => {
    setFormData((prev) => ({
      ...prev,
      today_charge: 0,
      medical_supervision_amount: 0,
    }))
  }

  const validateRoomChargeSection = (): boolean => {
    if (!Number(formData.room_charge_today)) {
      setError('Enable Room charge today to proceed')
      setActiveTab('charges')
      return false
    }
    if (!formData.room_charges || Number(formData.room_charges) <= 0) {
      setError('Room Charges amount must be greater than zero')
      setActiveTab('charges')
      return false
    }
    return true
  }

  const validateMedicalSupervisionSection = (): boolean => {
    if (!Number(formData.today_charge)) {
      setError('Enable Medical supervision charge today to proceed')
      setActiveTab('charges')
      return false
    }
    if (!formData.medical_supervision_amount || Number(formData.medical_supervision_amount) <= 0) {
      setError('Medical Supervision Amount must be greater than zero')
      setActiveTab('charges')
      return false
    }
    return true
  }

  const handleProceedChargeSection = async (section: 'room' | 'medical') => {
    setError(null)
    if (section === 'room' && !validateRoomChargeSection()) return
    if (section === 'medical' && !validateMedicalSupervisionSection()) return

    try {
      setSavingChargeSection(section)
      const chargeType = section === 'room' ? 'Room Charges' : 'Medical Supervision'
      const result = await saveDischargeDraftToServer(admission.name, buildDischargePayload(), {
        syncObservation: false,
        syncChargeTypes: [chargeType],
      })
      persistLocalDischargeDraft()
      applyServerDraftChargeResult(result)
      toast.success(
        result?.message ||
          (result.charge_sales_order || result.today_charge_sales_order
            ? `Charge saved. Sales Order ${result.charge_sales_order || result.today_charge_sales_order}`
            : 'Charge saved.'),
        5000
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save charge'
      toast.error(errorMessage, 5000)
      setError(errorMessage)
    } finally {
      setSavingChargeSection(null)
    }
  }

  const handleDeleteChargeSection = async (section: 'room' | 'medical') => {
    const chargeType = section === 'room' ? 'Room Charges' : 'Medical Supervision'
    if (
      !window.confirm(
        `Delete ${chargeType.toLowerCase()}? The linked Sales Order will be cancelled and removed from this discharge.`
      )
    ) {
      return
    }

    setError(null)
    try {
      setDeletingChargeSection(section)
      const result = await deleteDischargeExtraCharge(admission.name, chargeType)
      if (section === 'room') {
        clearLocalRoomChargeFields()
      } else {
        clearLocalMedicalSupervisionFields()
      }
      removeExtraChargeOrder(chargeType)
      persistLocalDischargeDraft()
      toast.success(result?.message || `${chargeType} deleted`, 5000)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `Failed to delete ${chargeType.toLowerCase()}`
      toast.error(errorMessage, 5000)
      setError(errorMessage)
    } finally {
      setDeletingChargeSection(null)
    }
  }

  const handleCancelChargeSection = async (section: 'room' | 'medical') => {
    const chargeType = section === 'room' ? 'Room Charges' : 'Medical Supervision'
    if (extraChargeSalesOrders[chargeType]) {
      await handleDeleteChargeSection(section)
      return
    }
    if (section === 'room') {
      clearLocalRoomChargeFields()
    } else {
      clearLocalMedicalSupervisionFields()
    }
    persistLocalDischargeDraft()
  }

  const handleSaveAndClose = async () => {
    setError(null)

    if (!validateObservationIfEnabled()) return
    if (!validateChargeIfEnabled()) return

    try {
      setSavingDraft(true)
      const result = await saveDischargeDraftToServer(admission.name, buildDischargePayload(), {
        syncObservation: Number(formData.discharge_to_observation) === 1,
      })
      persistLocalDischargeDraft()
      toast.success(
        result?.message ||
          (result?.observation
            ? `Discharge draft saved. Observation ${result.observation}${result.sales_order ? ` and Sales Order ${result.sales_order}` : ''} created.`
            : `Discharge draft saved${result?.name ? ` (${result.name})` : ''}.`),
        5000
      )
      applyServerDraftObservationResult(result)
      applyServerDraftChargeResult(result)
      onClose()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save discharge draft'
      toast.error(errorMessage, 5000)
      setError(errorMessage)
    } finally {
      setSavingDraft(false)
    }
  }

  const renderTabBadge = (tabId: DischargeTabId) => {
    if (tabId === 'checklist' && totalItems > 0) {
      return (
        <span
          className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold leading-none ${
            allCompleted
              ? 'bg-green-200/80 text-green-800'
              : financeOnlyPending
                ? 'bg-yellow-200/80 text-yellow-900'
                : 'bg-red-200/80 text-red-900'
          }`}
        >
          {completedItems}/{totalItems}
        </span>
      )
    }
    if (tabId === 'nursing' && nurseTotalItems > 0) {
      return (
        <span
          className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold leading-none ${
            nurseAllCompleted ? 'bg-green-200/80 text-green-800' : 'bg-amber-200/80 text-amber-900'
          }`}
        >
          {nurseCompletedItems}/{nurseTotalItems}
        </span>
      )
    }
    if (tabId === 'documents') {
      const count =
        documents.length +
        signatures.filter((s) => s.document || s.signee_name || s.patient_relation).length
      if (count > 0) {
        return (
          <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold bg-white/70 text-slate-700 leading-none">
            {count}
          </span>
        )
      }
    }
    if (tabId === 'relatives' && relatives.length > 0) {
      return (
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold bg-white/70 text-slate-700 leading-none">
          {relatives.length}
        </span>
      )
    }
    return null
  }

  const activeTabMeta = tabs.find((t) => t.id === activeTab) ?? tabs[0]
  const ActiveSectionIcon = activeTabMeta.Icon
  const chargeSectionBusy =
    savingChargeSection !== null ||
    deletingChargeSection !== null ||
    savingObservation ||
    deletingObservation

  const updateSectionScrollArrows = useCallback(() => {
    const el = sectionTabsScrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setSectionScroll({
      left: scrollLeft > 4,
      right: scrollLeft + clientWidth < scrollWidth - 4,
    })
  }, [])

  const scrollSectionTabs = (direction: 'left' | 'right') => {
    const el = sectionTabsScrollRef.current
    if (!el) return
    el.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!sectionMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (sectionMenuRef.current && !sectionMenuRef.current.contains(e.target as Node)) {
        setSectionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [sectionMenuOpen])

  useEffect(() => {
    updateSectionScrollArrows()
    const el = sectionTabsScrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => updateSectionScrollArrows())
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabs.length, updateSectionScrollArrows])

  useEffect(() => {
    const el = sectionTabsScrollRef.current
    if (!el) return
    const btn = el.querySelector<HTMLElement>(`[data-section-tab="${activeTab}"]`)
    btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    updateSectionScrollArrows()
  }, [activeTab, tabs.length, updateSectionScrollArrows])

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full w-full bg-white overflow-hidden">

        {/* Sub-header — below portal top bar */}
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-slate-200 shrink-0 bg-white">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={onClose}
              aria-label="Go back"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">Discharge Patient</h2>
              <p className="text-sm text-slate-500 mt-0.5 truncate">
                {admission.patient_name || admission.patient} &mdash; {admission.name}
              </p>
            </div>
          </div>
          {draftSavedAt(admission.name) && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
              <Clock className="w-3 h-3" />
              Draft saved
            </span>
          )}
        </div>

        {/* Section tabs — menu on small screens, cards from md up */}
        <div className="shrink-0 px-3 md:px-4 py-2.5 border-b border-slate-200 bg-slate-50/80">
          {/* Mobile / narrow: section picker */}
          <div ref={sectionMenuRef} className="md:hidden relative" data-discharge-section-menu>
            <button
              type="button"
              onClick={() => setSectionMenuOpen((open) => !open)}
              aria-expanded={sectionMenuOpen}
              aria-haspopup="listbox"
              className={`w-full flex items-center justify-between gap-2 rounded-lg border-2 px-3 py-2.5 text-left bg-white ${activeTabMeta.borderColor} ${activeTabMeta.activeBg} shadow-sm`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="p-1.5 rounded-md bg-white/70 shrink-0">
                  <ActiveSectionIcon className={`w-4 h-4 ${activeTabMeta.iconColor}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    Section
                  </span>
                  <span className="block text-sm font-semibold text-slate-900 truncate">
                    {activeTabMeta.label}
                  </span>
                </span>
                {renderTabBadge(activeTabMeta.id) && (
                  <span className="shrink-0">{renderTabBadge(activeTabMeta.id)}</span>
                )}
              </span>
              <ChevronDown
                className={`w-5 h-5 text-slate-500 shrink-0 transition-transform ${sectionMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {sectionMenuOpen && (
              <div
                role="listbox"
                aria-label="Discharge sections"
                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[min(18rem,50vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              >
                {tabs.map((tab) => {
                  const isActive = activeTab === tab.id
                  const TabIcon = tab.Icon
                  const badge = renderTabBadge(tab.id)
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        setActiveTab(tab.id)
                        setSectionMenuOpen(false)
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left border-l-4 ${tab.borderColor.replace(/^border-/, 'border-l-')} ${
                        isActive ? `${tab.activeBg} font-semibold` : 'hover:bg-slate-50'
                      }`}
                    >
                      <TabIcon className={`w-4 h-4 shrink-0 ${tab.iconColor}`} />
                      <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{tab.label}</span>
                      {badge}
                      {isActive && <Check className="w-4 h-4 shrink-0 text-green-600" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* md+: single row, horizontal scroll with arrows */}
          <div className="hidden md:flex items-stretch gap-1 min-w-0">
            {sectionScroll.left && (
              <button
                type="button"
                onClick={() => scrollSectionTabs('left')}
                aria-label="Scroll sections left"
                className="shrink-0 flex items-center justify-center w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div
              ref={sectionTabsScrollRef}
              onScroll={updateSectionScrollArrows}
              className="flex flex-1 gap-2 overflow-x-auto scroll-smooth min-w-0 py-0.5 [scrollbar-width:thin]"
              role="tablist"
              aria-label="Discharge sections"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                const TabIcon = tab.Icon
                const badge = renderTabBadge(tab.id)
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-section-tab={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    title={tab.label}
                    className={`flex items-center gap-2 rounded-lg border-2 px-2.5 py-2 text-left transition-all shrink-0 w-[8.75rem] bg-white text-slate-800 ${tab.borderColor} ${tab.hoverBg} ${
                      isActive ? `${tab.activeBg} shadow-sm` : 'hover:shadow-sm'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-md shrink-0 ${isActive ? 'bg-white/70' : 'bg-slate-50/80'}`}
                    >
                      <TabIcon className={`w-3.5 h-3.5 ${tab.iconColor}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold leading-tight truncate text-slate-800">
                        {tab.shortLabel || tab.label}
                      </p>
                      {badge && <div className="mt-0.5">{badge}</div>}
                    </div>
                  </button>
                )
              })}
            </div>
            {sectionScroll.right && (
              <button
                type="button"
                onClick={() => scrollSectionTabs('right')}
                aria-label="Scroll sections right"
                className="shrink-0 flex items-center justify-center w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (!target.closest('.dropdown-container') && !target.closest('[data-discharge-section-menu]')) {
              closeAllDropdowns()
            }
          }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {error && !unbilledServices && (
            <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {unbilledServices && (
            <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3 bg-red-100/60 border-b border-red-200">
                <Receipt className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Cannot Discharge — Unbilled Services</p>
                  <p className="text-xs text-red-600 mt-0.5">Please invoice the following services before discharging this patient.</p>
                </div>
                <button type="button" onClick={() => setUnbilledServices(null)} className="ml-auto text-red-400 hover:text-red-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {unbilledServices.length > 0 ? (
                <div className="divide-y divide-red-100">
                  {unbilledServices.map((svc, i) => (
                    <div key={i} className="px-4 py-3 flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-400 mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-red-800">{svc.type}</p>
                        {svc.ids.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {svc.ids.map(id => (
                              <span key={id} className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-red-200 text-xs font-mono text-red-700">{id}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-3 text-sm text-red-700">
                  There are unbilled healthcare services. Please review and invoice them before proceeding.
                </div>
              )}
            </div>
          )}

          {/* ── TAB: DETAILS ── */}
          {canViewDischargeTabPanel('details') && (
            <div className="grid gap-6 p-6 lg:grid-cols-[1fr_280px]">
              <div className="space-y-6 min-w-0">
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Admission</label>
                    <input type="text" value={admission.name} disabled className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-slate-50 text-slate-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Patient</label>
                    <input type="text" value={admission.patient_name || admission.patient} disabled className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-slate-50 text-slate-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Discharge Type</label>
                    <select
                      value={formData.discharge_type}
                      onChange={(e) => setFormData({ ...formData, discharge_type: e.target.value, ama_type: '' })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select Discharge Type</option>
                      <option value="Home">Home</option>
                      <option value="Refer To Another Hospital">Refer To Another Hospital</option>
                      <option value="DAMA">DAMA</option>
                    </select>
                  </div>
                  {formData.discharge_type === 'DAMA' && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">DAMA Type</label>
                      <select
                        value={formData.ama_type}
                        onChange={(e) => setFormData({ ...formData, ama_type: e.target.value })}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select DAMA Type</option>
                        <option value="Refuse Admission">Refuse Admission</option>
                        <option value="Refuse Treatment / Procedure">Refuse Treatment / Procedure</option>
                        <option value="Discharge Against Medical Advice(DAMA)">Discharge Against Medical Advice (DAMA)</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Discharge Date</label>
                    <input type="datetime-local" value={formData.discharge_date}
                      onChange={(e) => setFormData({ ...formData, discharge_date: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Discharged By</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="relative dropdown-container">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Discharge Receptionist</label>
                    <input
                      type="text"
                      value={selectedDischargeReceptionist ? selectedDischargeReceptionist.label : dischargeReceptionistQuery}
                      onChange={(e) => {
                        setSelectedDischargeReceptionist(null)
                        setFormData((prev) => ({ ...prev, discharge_receptionist: '' }))
                        setDischargeReceptionistQuery(e.target.value)
                        setDischargeReceptionistOpen(true)
                      }}
                      onFocus={() => setDischargeReceptionistOpen(true)}
                      placeholder="Search user..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {dischargeReceptionistOpen && dischargedByUsers.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {dischargedByUsers.map((user) => (
                          <button
                            key={user.name}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                            onClick={() => {
                              setSelectedDischargeReceptionist(user)
                              setFormData((prev) => ({ ...prev, discharge_receptionist: user.name }))
                              setDischargeReceptionistQuery(user.label)
                              setDischargeReceptionistOpen(false)
                            }}
                          >
                            {user.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="relative dropdown-container">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Discharge Doctor</label>
                    <input
                      type="text"
                      value={selectedDischargeDoctor ? selectedDischargeDoctor.label : dischargeDoctorQuery}
                      onChange={(e) => {
                        setSelectedDischargeDoctor(null)
                        setFormData((prev) => ({ ...prev, discharge_doctor: '' }))
                        setDischargeDoctorQuery(e.target.value)
                        setDischargeDoctorOpen(true)
                      }}
                      onFocus={() => setDischargeDoctorOpen(true)}
                      placeholder="Search doctor..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {dischargeDoctorOpen && dischargeDoctorOptions.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {dischargeDoctorOptions.map((doctor) => (
                          <button
                            key={doctor.name}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                            onClick={() => {
                              setSelectedDischargeDoctor(doctor)
                              setFormData((prev) => ({ ...prev, discharge_doctor: doctor.name }))
                              setDischargeDoctorQuery(doctor.label)
                              setDischargeDoctorOpen(false)
                            }}
                          >
                            <div className="font-medium">{doctor.label}</div>
                            {doctor.department && <div className="text-xs text-slate-500">{doctor.department}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                    {admission.discharge_practitioner && (
                      <p className="text-xs text-slate-500 mt-1">
                        Defaults to practitioner who scheduled discharge.
                      </p>
                    )}
                  </div>

                  <div className="relative dropdown-container">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Discharge Nurse</label>
                    <input
                      type="text"
                      value={selectedDischargeNurse ? selectedDischargeNurse.label : dischargeNurseQuery}
                      onChange={(e) => {
                        setSelectedDischargeNurse(null)
                        setFormData((prev) => ({ ...prev, discharge_nurse: '' }))
                        setDischargeNurseQuery(e.target.value)
                        setDischargeNurseOpen(true)
                      }}
                      onFocus={() => setDischargeNurseOpen(true)}
                      placeholder="Search doctor..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {dischargeNurseOpen && dischargeNurseOptions.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {dischargeNurseOptions.map((nurse) => (
                          <button
                            key={nurse.name}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                            onClick={() => {
                              setSelectedDischargeNurse(nurse)
                              setFormData((prev) => ({ ...prev, discharge_nurse: nurse.name }))
                              setDischargeNurseQuery(nurse.label)
                              setDischargeNurseOpen(false)
                            }}
                          >
                            <div className="font-medium">{nurse.label}</div>
                            {nurse.department && <div className="text-xs text-slate-500">{nurse.department}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Discharge Templates</h3>
                <div className={`grid gap-4 ${nursePrimaryUser ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {!nursePrimaryUser && (
                  <div className="relative dropdown-container">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Discharge Template</label>
                    <input type="text" value={selectedDischargeTemplate ? selectedDischargeTemplate.label : dischargeTemplateQuery}
                      onChange={(e) => {
                        setSelectedDischargeTemplate(null)
                        setFormData(prev => ({ ...prev, discharge_template: '' }))
                        setDischargeTemplateQuery(e.target.value)
                        setDischargeTemplateOpen(true)
                      }}
                      onFocus={() => setDischargeTemplateOpen(true)}
                      placeholder="Search discharge template..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    {dischargeTemplateOpen && dischargeTemplates.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {dischargeTemplates.map(template => (
                          <button key={template.name} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                            onClick={() => {
                              setSelectedDischargeTemplate(template)
                              setFormData({ ...formData, discharge_template: template.name })
                              setDischargeTemplateQuery(template.label)
                              setDischargeTemplateOpen(false)
                              loadChecklist(template.name)
                            }}>
                            {template.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  )}

                  {visibleTabIds.includes('nursing') && (
                    <div className="relative dropdown-container">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Nursing Discharge Template</label>
                      <input type="text" value={selectedNurseTemplate ? selectedNurseTemplate.label : nurseTemplateQuery}
                        onChange={(e) => {
                          setSelectedNurseTemplate(null)
                          setFormData((prev) => ({
                            ...prev,
                            nurse_discharge_template: '',
                          }))
                          setNursingTemplateSource(null)
                          setNurseTemplateQuery(e.target.value)
                          setNurseTemplateOpen(true)
                        }}
                        onFocus={() => setNurseTemplateOpen(true)}
                        placeholder="Search nursing template..."
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                      {nurseTemplateOpen && nurseTemplateOptions.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                          {nurseTemplateOptions.map((template) => {
                            const nct = template as NursingDischargeTemplateOption
                            const src = nct.template_source ?? 'discharge_nursing'
                            return (
                            <button key={`${src}-${template.name}`} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                              onClick={() => {
                                setSelectedNurseTemplate(template)
                                setNursingTemplateSource(src)
                                setFormData({
                                  ...formData,
                                  nurse_discharge_template: template.name,
                                })
                                setNurseTemplateQuery(template.label)
                                setNurseTemplateOpen(false)
                                loadNurseChecklist(template.name, src)
                              }}>
                              {template.label}
                            </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Final Discharge</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Final Discharge Date</label>
                    <DateFilterInput value={formData.final_discharge_date}
                      onChange={(e) => setFormData({ ...formData, final_discharge_date: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Final Discharge Time</label>
                    <input type="time" value={formData.final_discharge_time}
                      onChange={(e) => setFormData({ ...formData, final_discharge_time: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Discharge plan & instructions</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {[
                    { key: 'discharge_treatment_plan', label: 'Discharge Treatment Plan' },
                    { key: 'discharge_reason', label: 'Discharge Reason' },
                    { key: 'discharge_conditions', label: 'Discharge Condition' },
                    { key: 'discharge_instructions', label: 'Discharge Instructions' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
                      <textarea
                        rows={3}
                        value={formData[key as keyof typeof formData]}
                        onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Medical Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'discharge_diagnosis', label: 'Discharge Diagnosis' },
                    { key: 'final_exam_mental_status_summary', label: 'Final Exam Mental Status Summary' },
                    { key: 'management_in_hospital', label: 'Management In Hospital' },
                    { key: 'prognosis', label: 'Prognosis' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
                      <textarea rows={3}
                        value={formData[key as keyof typeof formData]}
                        onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Next Appointment</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Next Appointment Date</label>
                    <DateFilterInput min={localDateInputValue()} value={formData.next_appointment_date}
                      onChange={(e) => setFormData({ ...formData, next_appointment_date: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Next Appointment Time</label>
                    <input type="time" value={formData.next_appointment_time}
                      onChange={(e) => setFormData({ ...formData, next_appointment_time: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Prescription</h3>
                <p className="text-xs text-slate-500 mb-4">
                  Summary of current, discharged, and stopped medicines for this admission.
                </p>
                {prescriptionSectionsLoading ? (
                  <div className="text-sm text-slate-600">Loading prescriptions…</div>
                ) : (
                  <DischargePrescriptionCardsReadonly
                    alwaysShow
                    currentMedications={prescriptionSections.current_medications}
                    dischargedMedications={prescriptionSections.discharged_medications}
                    stoppedMedications={prescriptionSections.stopped_medications}
                    allowEditDischarged
                    patient={admission.patient}
                    admission={admission.name}
                    onDischargedChanged={loadPrescriptionSections}
                  />
                )}
              </section>
              </div>

              <aside className="space-y-3 lg:sticky lg:top-4 self-start">
                {hasDischargeReceptionist ? (
                  <DischargeChecklistStatusCard
                    dischargeChecklist={checklistItems}
                    nursingChecklist={nurseChecklistItems}
                    loading={checklistLoading || nurseChecklistLoading}
                  />
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Select a <span className="font-medium text-slate-800">Discharge Receptionist</span> under
                    Discharged By to unlock the checklist tabs.
                  </div>
                )}
              </aside>
            </div>
          )}

          {/* ── TAB: CHECKLIST ── */}
          {canViewDischargeTabPanel('checklist') && (
            <div className="p-6">
              {userDepartments.length > 0 ? (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  You can view the full discharge checklist. You may only complete lines assigned to your employee
                  department; other lines are read-only.
                </div>
              ) : (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Your user account is not linked to an active Employee department, so checklist lines with a
                  department cannot be updated. Ask an administrator to set Employee → Department for your user.
                </div>
              )}
              {totalItems > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">Checklist Progress</span>
                    <span className={`text-sm font-semibold ${allCompleted ? 'text-green-600' : financeOnlyPending ? 'text-yellow-600' : 'text-red-600'}`}>
                      {completedItems} of {totalItems} completed
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${allCompleted ? 'bg-green-500' : financeOnlyPending ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${totalItems ? (completedItems / totalItems) * 100 : 0}%` }}
                    />
                  </div>
                  {financeOnlyPending && (
                    <p className="text-xs text-yellow-700 mt-1.5 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Only finance checklist items remain — use Discharge Without Finance to free the bed
                      (Discharge stays draft until finance is completed)
                    </p>
                  )}
                  {allCompleted && (
                    <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      All items completed — patient is ready for discharge
                    </p>
                  )}
                </div>
              )}

              {checklistLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading checklist...</div>
              ) : checklistItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Circle className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">
                    {nursePrimaryUser
                      ? 'NO HOSPITAL CHECKLIST LOADED YET.'
                      : 'No checklist items found for the selected template.'}
                  </p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                  {orderedChecklist.map((item, index) => {
                    const isItemExpanded = expandedItems[item.name]
                    const rowEditable = canEditChecklistRow(item)
                    const toggleState = canToggleDischargeChecklistItem(
                      item,
                      checklistItems,
                      userDepartments,
                      userRole,
                    )
                    const assignedDeptLabel = checklistItemDepartmentLabel(item)
                    const waitingLabel = !rowEditable
                      ? `Waiting for ${assignedDeptLabel}`
                      : toggleState.reason?.toLowerCase().includes('first checklist item')
                        ? 'Complete the first checklist item first'
                        : null
                    return (
                      <div
                        key={item.name}
                        className={`transition-colors ${item.click ? 'bg-green-50/40' : rowEditable ? 'bg-white' : 'bg-slate-50'}`}
                      >
                        <div className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 shrink-0 w-6 text-center text-xs font-semibold text-slate-400">
                              {item.sr_num || index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleCheck(item.name)}
                              disabled={!toggleState.allowed}
                              title={toggleState.allowed ? undefined : toggleState.reason}
                              className={`mt-0.5 shrink-0 focus:outline-none ${!toggleState.allowed ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              {item.click ? (
                                <CheckCircle2 className="w-5 h-5 text-green-500" />
                              ) : (
                                <Circle className="w-5 h-5 text-slate-300 hover:text-slate-400" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p
                                  className={`text-sm font-medium ${item.click ? 'line-through text-slate-400' : 'text-slate-800'}`}
                                >
                                  {item.action_required}
                                </p>
                                {assignedDeptLabel !== 'Unassigned' && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                    {!rowEditable && <Lock className="h-3 w-3" />}
                                    {assignedDeptLabel}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                {item.name1 && (
                                  <span className="text-xs text-slate-500">
                                    <span className="font-medium">Contact:</span> {item.name1}
                                  </span>
                                )}
                                {item.click && item.date_time && (
                                  <span className="text-xs text-green-600">
                                    ✓ Completed {new Date(item.date_time).toLocaleString('en-GB')}
                                  </span>
                                )}
                                {waitingLabel && !item.click && (
                                  <span className="text-xs text-slate-500">{waitingLabel}</span>
                                )}
                              </div>
                              {item.click && rowEditable && (
                                <div className="mt-3 space-y-3">
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-slate-600 mb-1">User</label>
                                      <input
                                        type="text"
                                        ref={userOpenForItem === item.name ? userTriggerRef : undefined}
                                        value={
                                          userOpenForItem === item.name
                                            ? userQuery
                                            : dischargedByUsers.find((u) => u.name === item.user)?.label ||
                                              item.user ||
                                              ''
                                        }
                                        onChange={(e) => {
                                          updateChecklistItem(item.name, 'user', '')
                                          setUserQuery(e.target.value)
                                          setUserOpenForItem(item.name)
                                        }}
                                        onFocus={() => {
                                          setUserOpenForItem(item.name)
                                          setUserQuery(
                                            dischargedByUsers.find((u) => u.name === item.user)?.label ||
                                              item.user ||
                                              '',
                                          )
                                        }}
                                        placeholder="Search user..."
                                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-slate-600 mb-1">
                                        Date &amp; Time
                                      </label>
                                      <input
                                        type="datetime-local"
                                        value={item.date_time ? item.date_time.slice(0, 16) : ''}
                                        onChange={(e) =>
                                          updateChecklistItem(item.name, 'date_time', toFrappeDateTime(e.target.value))
                                        }
                                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-slate-600 mb-1">Department</label>
                                      <p className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                                        {assignedDeptLabel}
                                      </p>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Note</label>
                                    <textarea
                                      value={checklistNoteText(item.description)}
                                      onChange={(e) =>
                                        updateChecklistItem(item.name, 'description', e.target.value)
                                      }
                                      rows={2}
                                      placeholder="Add a note for this item…"
                                      className="w-full min-h-[2.75rem] resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-green-400"
                                    />
                                  </div>
                                </div>
                              )}
                              {item.click && !rowEditable && checklistNoteText(item.description) ? (
                                <p className="mt-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs text-slate-600 whitespace-pre-wrap">
                                  {checklistNoteText(item.description)}
                                </p>
                              ) : null}
                            </div>
                            {item.description && !item.click && (
                              <button
                                type="button"
                                onClick={() => toggleItem(item.name)}
                                className="shrink-0 text-xs text-slate-400 hover:text-slate-600 mt-0.5"
                              >
                                {isItemExpanded ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                          {isItemExpanded && item.description && !item.click && (
                            <div
                              className="mt-3 ml-14 p-3 bg-slate-50 rounded text-xs text-slate-600 border border-slate-100"
                              dangerouslySetInnerHTML={{ __html: item.description }}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {departmentOpenForItem && (
                <PortalActionsMenu
                  open={!!departmentOpenForItem}
                  onClose={() => setDepartmentOpenForItem(null)}
                  triggerRef={departmentTriggerRef}
                  minWidth={160}
                  maxWidth={280}
                  maxHeight={280}
                >
                  {departmentOptions.map((dept) => (
                    <button
                      key={dept.name}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-green-50"
                      onClick={() => {
                        if (departmentOpenForItem) {
                          updateChecklistItem(departmentOpenForItem, 'department', dept.name)
                          setDepartmentQuery(dept.label)
                          setDepartmentOpenForItem(null)
                        }
                      }}
                    >
                      {dept.label}
                    </button>
                  ))}
                </PortalActionsMenu>
              )}

              {userOpenForItem && (
                <PortalActionsMenu
                  open={!!userOpenForItem}
                  onClose={() => setUserOpenForItem(null)}
                  triggerRef={userTriggerRef}
                  minWidth={160}
                  maxWidth={280}
                  maxHeight={280}
                >
                  {dischargedByUsers
                    .filter((u) => !userQuery.trim() || (u.label || u.name || '').toLowerCase().includes(userQuery.toLowerCase()))
                    .slice(0, 30)
                    .map((user) => (
                      <button
                        key={user.name}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-green-50"
                        onClick={() => {
                          if (userOpenForItem) {
                            updateChecklistItem(userOpenForItem, 'user', user.name)
                            setUserOpenForItem(null)
                          }
                        }}
                      >
                        {user.label}
                      </button>
                    ))}
                </PortalActionsMenu>
              )}
            </div>
          )}

          {/* ── TAB: NURSING CHECKLIST ── */}
          {canViewDischargeTabPanel('nursing') && (
            <div className="p-6">
              {nurseTotalItems > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">Nursing Checklist Progress</span>
                    <span className={`text-sm font-semibold ${nurseAllCompleted ? 'text-green-600' : 'text-amber-600'}`}>
                      {nurseCompletedItems} of {nurseTotalItems} completed
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${nurseAllCompleted ? 'bg-green-500' : 'bg-amber-500'}`}
                      style={{ width: `${nurseTotalItems ? (nurseCompletedItems / nurseTotalItems) * 100 : 0}%` }}
                    />
                  </div>
                  {nurseAllCompleted && (
                    <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      All nursing items completed
                    </p>
                  )}
                </div>
              )}

              {nurseChecklistLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading nursing checklist...</div>
              ) : nurseChecklistItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Circle className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">No nursing checklist items found. Please select a nursing template.</p>
                  {!selectedNurseTemplate && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('details')}
                      className="mt-4 text-sm text-primary hover:underline"
                    >
                      Go to Details tab to select a nursing template
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedNurseChecklist).map(([dept, items]) => {
                    const deptCompleted = items.filter(i => i.click).length
                    const deptTotal = items.length
                    const isDeptDone = deptCompleted === deptTotal
                    const isOpen = expandedNurseDepts[dept] !== false
                    return (
                      <div key={dept} className="border border-slate-200 rounded-lg overflow-hidden">
                        <button type="button" onClick={() => toggleNurseDept(dept)}
                          className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${isDeptDone ? 'bg-green-50' : 'bg-slate-50'} hover:bg-slate-100`}>
                          <div className="flex items-center gap-3">
                            {isDeptDone ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" /> : <Circle className="w-5 h-5 text-slate-400 shrink-0" />}
                            <div>
                              <span className="text-sm font-semibold text-slate-800">{dept}</span>
                              <span className="ml-2 text-xs text-slate-500">({deptCompleted}/{deptTotal})</span>
                            </div>
                          </div>
                          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </button>
                        {isOpen && (
                          <div className="divide-y divide-slate-100">
                            {items.map((item) => (
                                <div key={item.name} className={`transition-colors ${item.click ? 'bg-green-50/40' : 'bg-white'}`}>
                                  <div className="px-4 py-3">
                                    <div className="flex items-start gap-3">
                                      <button type="button" onClick={() => toggleNurseCheck(item.name)} className="mt-0.5 shrink-0 focus:outline-none">
                                        {item.click ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5 text-slate-300 hover:text-slate-400" />}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-medium ${item.click ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                          {item.action_required}
                                        </p>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                          {item.name1 && <span className="text-xs text-slate-500"><span className="font-medium">Contact:</span> {item.name1}</span>}
                                          {item.click && item.date_time && (
                                            <span className="text-xs text-green-600">✓ Completed {new Date(item.date_time).toLocaleString('en-GB')}</span>
                                          )}
                                        </div>
                                        {item.click && (
                                          <div className="mt-3 space-y-3">
                                            <div className="grid grid-cols-2 gap-3">
                                              <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">User</label>
                                                <input
                                                  type="text"
                                                  ref={userOpenForItem === `nurse_${item.name}` ? userTriggerRef : undefined}
                                                  value={userOpenForItem === `nurse_${item.name}` ? userQuery : (dischargedByUsers.find(u => u.name === item.user)?.label || item.user || '')}
                                                  onChange={(e) => {
                                                    updateNurseChecklistItem(item.name, 'user', '')
                                                    setUserQuery(e.target.value)
                                                    setUserOpenForItem(`nurse_${item.name}`)
                                                  }}
                                                  onFocus={() => { setUserOpenForItem(`nurse_${item.name}`); setUserQuery(dischargedByUsers.find(u => u.name === item.user)?.label || item.user || '') }}
                                                  placeholder="Search user..."
                                                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                                />
                                              </div>
                                              <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Date &amp; Time</label>
                                                <input type="datetime-local" value={item.date_time ? item.date_time.slice(0, 16) : ''}
                                                  onChange={(e) => updateNurseChecklistItem(item.name, 'date_time', toFrappeDateTime(e.target.value))}
                                                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400" />
                                              </div>
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                                Note
                                              </label>
                                              <textarea
                                                value={checklistNoteText(item.description)}
                                                onChange={(e) =>
                                                  updateNurseChecklistItem(item.name, 'description', e.target.value)
                                                }
                                                rows={2}
                                                placeholder="Add a note for this item…"
                                                className="w-full min-h-[2.75rem] resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-green-400"
                                              />
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {userOpenForItem && userOpenForItem.startsWith('nurse_') && (
                <PortalActionsMenu
                  open={!!userOpenForItem}
                  onClose={() => setUserOpenForItem(null)}
                  triggerRef={userTriggerRef}
                  minWidth={160}
                  maxWidth={280}
                  maxHeight={280}
                >
                  {dischargedByUsers
                    .filter((u) => !userQuery.trim() || (u.label || u.name || '').toLowerCase().includes(userQuery.toLowerCase()))
                    .slice(0, 30)
                    .map((user) => (
                      <button
                        key={user.name}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-green-50"
                        onClick={() => {
                          if (userOpenForItem) {
                            const itemName = userOpenForItem.replace('nurse_', '')
                            updateNurseChecklistItem(itemName, 'user', user.name)
                            setUserOpenForItem(null)
                          }
                        }}
                      >
                        {user.label}
                      </button>
                    ))}
                </PortalActionsMenu>
              )}
            </div>
          )}

          {/* ── TAB: PRESCRIPTION ── */}
          {canViewDischargeTabPanel('transfer') && (
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-1">Prescription</h3>
                <p className="text-xs text-slate-600">
                  Manage current medicines and create discharged prescriptions for home use.
                </p>
              </div>
              <DischargePrescriptionCardsEditable
                admission={admission.name}
                patient={admission.patient}
                onChanged={handlePrescriptionSectionChanged}
              />
            </div>
          )}

          {/* ── TAB: ROOM CHARGES ── */}
          {canViewDischargeTabPanel('charges') && (
            <div className="p-6 space-y-6">
              <p className="text-sm text-slate-600">
                Reception only — confirm room, observation, and medical supervision charges for today.
                Use Proceed and charge to save and create Sales Orders without leaving this section.
              </p>
              {Object.keys(extraChargeSalesOrders).length > 0 ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 space-y-1">
                  <p className="font-medium">Linked charge orders</p>
                  {Object.entries(extraChargeSalesOrders).map(([type, so]) => (
                    <p key={type}>
                      {type}: <span className="font-medium">{so}</span>
                    </p>
                  ))}
                  <p className="text-xs text-green-800 pt-1">
                    Saving again will update amounts where possible, not create duplicates.
                  </p>
                </div>
              ) : null}

              <CollapsibleFormSection
                title="Room charges"
                defaultOpen
                footer={
                  Number(formData.room_charge_today) ? (
                    <ChargeSectionActions
                      showDelete={Boolean(extraChargeSalesOrders['Room Charges'])}
                      onDelete={() => void handleDeleteChargeSection('room')}
                      onCancel={() => void handleCancelChargeSection('room')}
                      onProceed={() => void handleProceedChargeSection('room')}
                      deleteLabel="Delete room charge"
                      proceedLabel="Proceed"
                      saving={savingChargeSection === 'room'}
                      deleting={deletingChargeSection === 'room'}
                      disabled={submitting || savingDraft || chargeSectionBusy}
                    />
                  ) : null
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <YesNoField
                    label="Room charge today?"
                    value={checkToYesNo(formData.room_charge_today)}
                    onChange={(v) => handleRoomChargeTodayChange(v === 'Yes')}
                  />
                  {Number(formData.room_charge_today) ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Room</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={
                              selectedRoomChargeRoom
                                ? selectedRoomChargeRoom.healthcare_service_unit_name ||
                                  selectedRoomChargeRoom.name
                                : roomChargeRoomQuery
                            }
                            onChange={(e) => {
                              setRoomChargeRoomQuery(e.target.value)
                              setRoomChargeRoomOpen(true)
                              setSelectedRoomChargeRoom(null)
                              setFormData((prev) => ({ ...prev, room_charge_service_unit: '' }))
                            }}
                            onFocus={() => setRoomChargeRoomOpen(true)}
                            placeholder="Search room..."
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                          {roomChargeRoomOpen && (
                            <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                              {roomChargeRoomLoading ? (
                                <div className="px-3 py-2 text-sm text-slate-500">Loading...</div>
                              ) : roomChargeRoomOptions.length > 0 ? (
                                roomChargeRoomOptions.map((unit) => (
                                  <button
                                    key={unit.name}
                                    type="button"
                                    onClick={() => {
                                      setSelectedRoomChargeRoom(unit)
                                      setRoomChargeRoomQuery(
                                        unit.healthcare_service_unit_name || unit.name
                                      )
                                      setRoomChargeRoomOpen(false)
                                      setFormData((prev) => ({
                                        ...prev,
                                        room_charge_service_unit: unit.name,
                                      }))
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                                  >
                                    {unit.healthcare_service_unit_name || unit.name}
                                  </button>
                                ))
                              ) : (
                                <div className="px-3 py-2 text-sm text-slate-500">NO VACANT ROOMS FOUND</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Room Charges amount <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={formData.room_charges || ''}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              room_charges: Number(e.target.value) || 0,
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </CollapsibleFormSection>

              <CollapsibleFormSection
                title="Medical supervision"
                defaultOpen={false}
                footer={
                  Number(formData.today_charge) ? (
                    <ChargeSectionActions
                      showDelete={Boolean(extraChargeSalesOrders['Medical Supervision'])}
                      onDelete={() => void handleDeleteChargeSection('medical')}
                      onCancel={() => void handleCancelChargeSection('medical')}
                      onProceed={() => void handleProceedChargeSection('medical')}
                      deleteLabel="Delete medical supervision"
                      proceedLabel="Proceed"
                      saving={savingChargeSection === 'medical'}
                      deleting={deletingChargeSection === 'medical'}
                      disabled={submitting || savingDraft || chargeSectionBusy}
                    />
                  ) : null
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <YesNoField
                    label="Medical supervision charge today?"
                    value={checkToYesNo(formData.today_charge)}
                    onChange={(v) => handleMedicalSupervisionTodayChange(v === 'Yes')}
                  />
                  {Number(formData.today_charge) ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Medical Supervision Amount <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={formData.medical_supervision_amount || ''}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            medical_supervision_amount: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  ) : null}
                </div>
              </CollapsibleFormSection>

              <CollapsibleFormSection
                key={`observation-${formData.discharge_to_observation}`}
                title="Observation"
                defaultOpen
                footer={
                  Number(formData.discharge_to_observation) &&
                  Number(formData.charge_observation_today) ? (
                    <ChargeSectionActions
                      showDelete={Boolean(
                        formData.observation_record || extraChargeSalesOrders.Observation
                      )}
                      onDelete={() => void handleDeleteObservation()}
                      onCancel={handleChangeObservation}
                      onProceed={() => void handleSaveObservation()}
                      cancelLabel="Change observation"
                      deleteLabel="Delete observation"
                      proceedLabel="Save observation"
                      saving={savingObservation}
                      deleting={deletingObservation}
                      disabled={submitting || savingDraft || chargeSectionBusy}
                    />
                  ) : null
                }
              >
                <YesNoField
                  label="Need Observation?"
                  value={checkToYesNo(formData.discharge_to_observation)}
                  onChange={(v) => handleNeedObservationChange(v === 'Yes')}
                />
                {Number(formData.discharge_to_observation) === 1 ? (
                  <>
                  <p className="text-sm text-slate-600 mt-4">
                    Complete observation details below. The first save creates one Observation and Sales Order;
                    later saves update the discharge only and reuse the linked observation.
                  </p>
                  {formData.observation_record ? (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
                      Linked observation: <span className="font-medium">{formData.observation_record}</span>
                      {' '}— saving again will not create a duplicate.
                    </div>
                  ) : null}
                  <YesNoField
                    label="Charge observation today?"
                    value={checkToYesNo(formData.charge_observation_today)}
                    onChange={(v) => {
                      const yes = v === 'Yes'
                      const today = new Date().toISOString().split('T')[0]
                      setFormData((prev) => ({
                        ...prev,
                        charge_observation_today: yes ? 1 : 0,
                        today_charge_obs: yes ? prev.observation_amount || prev.today_charge_obs : 0,
                        observation_start_date: yes ? today : prev.observation_start_date,
                      }))
                    }}
                    required
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Observation Level
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={selectedObservationLevel ? selectedObservationLevel.label : observationLevelQuery}
                          onChange={(e) => {
                            setObservationLevelQuery(e.target.value)
                            setObservationLevelOpen(true)
                            setSelectedObservationLevel(null)
                            setFormData((prev) => ({ ...prev, observation_level: '' }))
                          }}
                          onFocus={() => setObservationLevelOpen(true)}
                          placeholder="Search observation level..."
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {observationLevelOpen && (
                          <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {observationLevelLoading ? (
                              <div className="px-3 py-2 text-sm text-slate-500">Loading...</div>
                            ) : observationLevelOptions.length > 0 ? (
                              observationLevelOptions.map((obsLevel) => (
                                <button
                                  key={obsLevel.name}
                                  type="button"
                                  onClick={() => handleObservationLevelSelect(obsLevel)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                                >
                                  {obsLevel.label}
                                </button>
                              ))
                            ) : (
                              <div className="px-3 py-2 text-sm text-slate-500">NO OBSERVATION LEVELS FOUND</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                      <DateFilterInput
                        value={
                          Number(formData.charge_observation_today)
                            ? new Date().toISOString().split('T')[0]
                            : formData.observation_start_date
                        }
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, observation_start_date: e.target.value }))
                        }
                        disabled={Number(formData.charge_observation_today) === 1}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={selectedObsDepartment ? selectedObsDepartment.label : obsDepartmentQuery}
                          onChange={(e) => {
                            setObsDepartmentQuery(e.target.value)
                            setObsDepartmentOpen(true)
                            setSelectedObsDepartment(null)
                            setFormData((prev) => ({ ...prev, observation_department: '' }))
                          }}
                          onFocus={() => setObsDepartmentOpen(true)}
                          placeholder="Search department..."
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {obsDepartmentOpen && obsDepartmentOptions.length > 0 && (
                          <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {obsDepartmentOptions.map((dept) => (
                              <button
                                key={dept.name}
                                type="button"
                                onClick={() => {
                                  setSelectedObsDepartment(dept)
                                  setObsDepartmentQuery(dept.label)
                                  setObsDepartmentOpen(false)
                                  setFormData((prev) => ({ ...prev, observation_department: dept.name }))
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                              >
                                {dept.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Doctor Name</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={selectedObsPractitioner ? selectedObsPractitioner.label : obsPractitionerQuery}
                          onChange={(e) => {
                            setObsPractitionerQuery(e.target.value)
                            setObsPractitionerOpen(true)
                            setSelectedObsPractitioner(null)
                            setFormData((prev) => ({ ...prev, observation_practitioner: '' }))
                          }}
                          onFocus={() => setObsPractitionerOpen(true)}
                          placeholder="Search doctor..."
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {obsPractitionerOpen && obsPractitionerOptions.length > 0 && (
                          <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {obsPractitionerOptions.map((pract) => (
                              <button
                                key={pract.name}
                                type="button"
                                onClick={() => {
                                  setSelectedObsPractitioner(pract)
                                  setObsPractitionerQuery(pract.label)
                                  setObsPractitionerOpen(false)
                                  setFormData((prev) => ({ ...prev, observation_practitioner: pract.name }))
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                              >
                                <div className="font-medium">{pract.label}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={formData.observation_amount || ''}
                        onChange={(e) => {
                          const amount = Number(e.target.value) || 0
                          setFormData((prev) => ({
                            ...prev,
                            observation_amount: amount,
                            today_charge_obs: Number(prev.charge_observation_today) ? amount : prev.today_charge_obs,
                          }))
                        }}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Duration</label>
                      <input
                        type="text"
                        value={formData.observation_duration}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, observation_duration: e.target.value }))
                        }
                        placeholder="e.g. 60M, 24H"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                    <textarea
                      rows={3}
                      value={formData.observation_note}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, observation_note: e.target.value }))
                      }
                      placeholder="Observation notes..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  </>
                ) : null}
              </CollapsibleFormSection>
            </div>
          )}

          {/* ── TAB: MEDICINE SALES ── */}
          {/* ── TAB: MEDICINE SALES ── */}
{canViewDischargeTabPanel('medicine-sales') && (
  <div className="flex flex-col min-h-0 max-h-full">
    <div className="shrink-0 px-6 pt-6 pb-2">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Medicine Sales Summary</h3>
      <p className="text-xs text-slate-600">
        Summary of all prescriptions and medicines given during this admission.
      </p>
    </div>

    {salesLoading ? (
      <div className="flex items-center justify-center py-16 px-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    ) : (
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-xs font-medium text-blue-600 uppercase tracking-wide">Total Prescriptions</div>
            <div className="text-2xl font-bold text-blue-800 mt-1">{medicineSales.prescriptions?.length || 0}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-xs font-medium text-green-600 uppercase tracking-wide">Total Prescription Amount</div>
            <div className="text-2xl font-bold text-green-800 mt-1">
              {formatMedicineMoney(medicineSales.prescription_total || 0)}
            </div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-xs font-medium text-purple-600 uppercase tracking-wide">Total Given Medicines Amount</div>
            <div className="text-2xl font-bold text-purple-800 mt-1">
              {formatMedicineMoney(medicineSales.given_total || 0)}
            </div>
          </div>
        </div>

        {/* Prescriptions Section - Medicines for patient to take home */}
<div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-6">
  <div className="bg-blue-50 px-4 py-3 border-b border-blue-200">
    <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
      <span>📋 Prescriptions (Medicines to take home after discharge)</span>
      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">After Discharge</span>
    </h4>
  </div>
  <div className="overflow-auto max-h-[min(50vh,22rem)] [scrollbar-width:thin]">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-[1]">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Medicine</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Dosage</th>
          <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-600">Quantity</th>
          <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-600">Rate</th>
          <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-600">Amount</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200">
        {medicineSales.prescriptions?.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
              NO AFTER-DISCHARGE PRESCRIPTIONS FOUND.
            </td>
          </tr>
        ) : (
          medicineSales.prescriptions?.map((prescription: any) => (
<React.Fragment key={prescription.name}>
              <tr className="bg-slate-50">
                <td colSpan={5} className="px-4 py-2">
                  <div className="font-medium text-primary">Prescription: {prescription.name}</div>
                  <div className="text-xs text-slate-500">Date: {prescription.posting_date}</div>
                </td>
              </tr>
              {prescription.drugs?.map((drug: any, drugIdx: number) => (
                <tr key={`${prescription.name}-${drugIdx}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 pl-8">
                    <div className="text-sm text-slate-700">{drug.drug_name || drug.drug}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{drug.dosage || '-'}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{drug.quantity || 0}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">
                    {formatMedicineMoney(drug.rate || 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-slate-700">
                    {formatMedicineMoney(drug.amount || 0)}
                  </td>
                </tr>
              ))}
</React.Fragment>
          ))
        )}
        {medicineSales.prescriptions?.length > 0 && (
          <tr className="bg-slate-100">
            <td colSpan={4} className="px-4 py-2 text-right font-semibold text-slate-700">
              Prescription Total:
            </td>
            <td className="px-4 py-2 text-right font-bold text-blue-700">
              {formatMedicineMoney(medicineSales.prescription_total || 0)}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
</div>

        {/* Given Medicines Section - Medicines administered during admission */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-green-50 px-4 py-3 border-b border-green-200">
            <h4 className="text-sm font-semibold text-green-800 flex items-center gap-2">
              <span>💊 Given Medicines (Administered during admission)</span>
            </h4>
          </div>
          <div className="overflow-auto max-h-[min(50vh,22rem)] [scrollbar-width:thin]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-[1]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Medicine</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Date/Time</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-600">Quantity</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-600">Rate</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-600">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {medicineSales.given_medicines?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No medicines given during this admission.
                    </td>
                  </tr>
                ) : (
                  medicineSales.given_medicines?.map((given: any, idx: number) => (
                    <tr key={given.name || idx} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-700">{given.medicine_name || given.medicine_code}</div>
                        <div className="text-xs text-slate-400">{given.medicine_code}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {given.date} {given.time}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{given.qty || 0} {given.unit || ''}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        {formatMedicineMoney(given.rate || 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-slate-700">
                        {formatMedicineMoney(given.amount || 0)}
                      </td>
                    </tr>
                  ))
                )}
                {medicineSales.given_medicines?.length > 0 && (
                  <tr className="bg-slate-100">
                    <td colSpan={4} className="px-4 py-2 text-right font-semibold text-slate-700">
                      Given Medicines Total:
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-green-700">
                      {formatMedicineMoney(medicineSales.given_total || 0)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Grand Total — stays visible after scrolling tables */}
        <div className="flex justify-end pt-2 shrink-0">
          <div className="bg-slate-100 rounded-lg p-4 min-w-[250px]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-slate-600">Prescription Total:</span>
              <span className="text-sm font-semibold text-blue-700">
                {formatMedicineMoney(medicineSales.prescription_total || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-slate-600">Given Medicines Total:</span>
              <span className="text-sm font-semibold text-green-700">
                {formatMedicineMoney(medicineSales.given_total || 0)}
              </span>
            </div>
            <div className="border-t border-slate-200 pt-2 mt-2">
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-slate-800">Grand Total:</span>
                <span className="text-lg font-bold text-primary">
                  {formatMedicineMoney(medicineSales.grand_total || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
)}

          {/* ── TAB: MEDICINE RECONCILIATION ── */}
          {canViewDischargeTabPanel('reconcile') && (
            <div className="p-6 space-y-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">Medicine Reconciliation</h3>
              <p className="text-xs text-slate-600 mb-2">
                Review medicines given during this admission and reconcile remaining doses (return to store or transfer to follow-up).
              </p>
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Medicines given</h4>
                  <MedicineGivenList patient={admission.patient} manageRows={false} />
                </div>
                <div>
                  <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Medicines not given (remaining)</h4>
                  <MedicineReconciliationList
                    admission={admission.name}
                    onRefresh={() => {}}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: DAILY PATIENT VISIT SETUP ── */}
          {canViewDischargeTabPanel('daily-visit') && (
  <div className="p-6 space-y-6">
    <h3 className="text-sm font-semibold text-slate-700 mb-1">Daily Patient Visit Setup</h3>
    <p className="text-xs text-slate-600 mb-2">
      Configure automatic daily patient visits. A scheduler will run at 12:01 AM daily to activate these visits and create Patient Visit records.
    </p>

    {dailyVisitLoading ? (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    ) : dailyVisitSaved && !showDailyVisitForm ? (
      <div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">Daily Visit Setup Already Configured</p>
              <p className="text-xs text-green-600 mt-1">
                A daily visit setup already exists for this admission.
              </p>
              {dailyVisitSetup && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div><span className="text-green-700">From:</span> {dailyVisitSetup.from_date}</div>
                  <div><span className="text-green-700">To:</span> {dailyVisitSetup.to_date}</div>
                  <div><span className="text-green-700">Time:</span> {dailyVisitSetup.time}</div>
                  <div><span className="text-green-700">Amount:</span> {dailyVisitSetup.amount}</div>
                  <div><span className="text-green-700">Active:</span> {dailyVisitSetup.is_active ? 'Yes' : 'No'}</div>
                  {dailyVisitSetup.session && <div><span className="text-green-700">Session:</span> {dailyVisitSetup.session}</div>}
                  <div><span className="text-green-700">Admission:</span> {dailyVisitSetup.admission}</div>
                  {dailyVisitSetup.discharge && <div><span className="text-green-700">Discharge:</span> {dailyVisitSetup.discharge}</div>}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowDailyVisitForm(true)}
              className="px-3 py-1.5 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/5"
            >
              Edit Setup
            </button>
          </div>
        </div>
      </div>
    ) : (
      <DailyVisitSetupForm
        patient={admission.patient}
        admission={admission.name}
        branch={
          (userCostCenter || '').trim() ||
          (admission.cost_center || '').trim() ||
          undefined
        }
        initialData={dailyVisitSetup || undefined}
        onSave={saveDailyVisitSetup}
        onCancel={() => setShowDailyVisitForm(false)}
      />
    )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">How Daily Visits Work</p>
                    <ul className="text-xs text-amber-700 mt-2 space-y-1 list-disc list-inside">
                      <li>The system scheduler runs daily at 12:01 AM</li>
                      <li>For each active setup where current date is between From Date and To Date, a Patient Visit is automatically created</li>
                      <li>Once the To Date is passed, the setup is automatically deactivated (is_active set to false)</li>
                      <li>Each visit will be created with the specified time and Healthcare Service Template(s)</li>
                      <li>The specified amount will be applied to each created visit</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: DOCUMENTS (+ Signatures below) ── */}
          {canViewDischargeTabPanel('documents') && (
            <div className="p-6 space-y-8">
              <div>
                <p className="text-sm text-slate-500 mb-4">
                  Attach discharge documents (photo, PDF, etc.). Capture e-signatures in the Signatures section below.
                </p>
                <div className="space-y-4">
                  {documents.length === 0 && (
                    <div className="text-center py-10 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-sm">
                      No documents added yet. Click below to add one.
                    </div>
                  )}

                  {documents.map((row, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Document #{idx + 1}
                        </span>
                        <button type="button" onClick={() => removeDocumentRow(idx)}
                          className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Remove row">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">File Name</label>
                          <input value={row.file_name} onChange={(e) => updateDocumentRow(idx, 'file_name', e.target.value)}
                            placeholder="File name"
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">Document Type</label>
                          <DocumentTypeSelect
                            value={row.document_type || ''}
                            onChange={(v) => updateDocumentRow(idx, 'document_type', v)}
                            types={documentTypes}
                            onTypesUpdated={setDocumentTypes}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">Transaction No</label>
                          <input value={row.transaction_no || ''} onChange={(e) => updateDocumentRow(idx, 'transaction_no', e.target.value)}
                            placeholder="Transaction number"
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">Upload Remarks</label>
                          <input value={row.upload_remarks || ''} onChange={(e) => updateDocumentRow(idx, 'upload_remarks', e.target.value)}
                            placeholder="Remarks"
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">
                            File Attachment
                            <span className="ml-1 font-normal text-slate-400">(photo, PDF, etc.)</span>
                          </label>
                          <input type="file" disabled={documentUploading === idx}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDocumentFile(idx, f); e.target.value = '' }}
                            className="w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-white file:text-sm" />
                          {documentUploading === idx && (
                            <span className="text-xs text-slate-500 mt-0.5 block">Uploading...</span>
                          )}
                          {row.document && documentUploading !== idx && (
                            <span className="text-xs text-green-600 mt-0.5 block truncate" title={row.document}>
                              ✓ File attached
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={addDocumentRow}
                    className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add document
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <PenLine className="w-4 h-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-800">Signatures</h3>
                </div>
                <p className="text-sm text-slate-500 mb-4">
                  Capture discharge e-signatures. Patient Relation and Signee Name are required for each signature.
                </p>
                <div className="space-y-4">
                  {signatures.length === 0 && (
                    <div className="text-center py-10 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-sm">
                      No signatures yet. Click below to add one.
                    </div>
                  )}

                  {signatures.map((row, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Signature #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeSignatureRow(idx)}
                          className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Remove"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">
                              Patient Relation <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={row.patient_relation || ''}
                              onChange={(e) => updateSignatureRow(idx, 'patient_relation', e.target.value)}
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                            >
                              <option value="">Select relation</option>
                              {SIGNATURE_RELATION_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">
                              Signee Name <span className="text-red-500">*</span>
                            </label>
                            <input
                              value={row.signee_name || ''}
                              onChange={(e) => updateSignatureRow(idx, 'signee_name', e.target.value)}
                              placeholder="Full name of person signing"
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">Document Type</label>
                            <DocumentTypeSelect
                              value={row.document_type || signatureDocType}
                              onChange={(v) => updateSignatureRow(idx, 'document_type', v)}
                              types={documentTypes}
                              onTypesUpdated={setDocumentTypes}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">Upload Remarks</label>
                            <input
                              value={row.upload_remarks || ''}
                              onChange={(e) => updateSignatureRow(idx, 'upload_remarks', e.target.value)}
                              placeholder="Remarks"
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                        </div>

                        <div className="p-4 flex flex-col gap-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <PenLine className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs font-medium text-slate-600">
                              Signature <span className="text-red-500">*</span>
                            </span>
                          </div>
                          <div className="flex-1">
                            <SignaturePad
                              onSave={(file) => handleSignatureFile(idx, file)}
                              onClear={() => updateSignatureRow(idx, 'document', '')}
                              existingUrl={attachFileDisplayUrl(row.document)}
                              uploading={signatureUploading === idx}
                            />
                          </div>
                          {signatureUploading === idx && (
                            <p className="text-xs text-slate-500 text-center">Uploading signature...</p>
                          )}
                          <p className="text-xs text-slate-400 leading-relaxed">
                            Draw and save, or upload a signature image.
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addSignatureRow}
                    className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add signature
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: RELATIVES ── */}
          {canViewDischargeTabPanel('relatives') && (
            <div className="p-6">
              <p className="text-sm text-slate-500 mb-4">
                Add relatives / guardians who are relevant for this discharge record.
              </p>
              <div className="border border-slate-200 rounded-md">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
                  <h3 className="text-sm font-semibold text-slate-800">Relatives / Guardians</h3>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded-full bg-primary text-white hover:bg-primary/90"
                    onClick={() =>
                      setRelatives(prev => [
                        ...prev,
                        { relationship_with_patient: '', relative_name: '', cpr__id_no: '', any_remarks: '', relative_phone_no: '', relative_alternative_phone_no: '', relative_alternative_phone_no_2: '' },
                      ])
                    }
                  >
                    + Add Relative
                  </button>
                </div>
                <div className="divide-y divide-slate-200">
                  {relatives.map((row, idx) => (
                    <div key={idx} className="px-3 py-3 space-y-2">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Relation
                          </label>
                          <select
                            value={row.relationship_with_patient}
                            onChange={(e) => {
                              const value = e.target.value
                              setRelatives(prev => prev.map((r, i) =>
                                i === idx ? { ...r, relationship_with_patient: value } : r
                              ))
                            }}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">Select relation</option>
                            {RELATION_OPTIONS.map(opt => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Name
                          </label>
                          <input
                            type="text"
                            value={row.relative_name}
                            onChange={(e) => {
                              const value = e.target.value
                              setRelatives(prev => prev.map((r, i) =>
                                i === idx ? { ...r, relative_name: value } : r
                              ))
                            }}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Relative full name"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            ID Number
                          </label>
                          <input
                            type="text"
                            value={row.cpr__id_no}
                            onChange={(e) => {
                              const value = e.target.value
                              setRelatives(prev => prev.map((r, i) =>
                                i === idx ? { ...r, cpr__id_no: value } : r
                              ))
                            }}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="CPR / ID"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Phone No
                          </label>
                          <input
                            type="text"
                            value={row.relative_phone_no}
                            onChange={(e) => {
                              const value = e.target.value
                              setRelatives(prev => prev.map((r, i) =>
                                i === idx ? { ...r, relative_phone_no: value } : r
                              ))
                            }}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Phone NO"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Alternative Phone No
                          </label>
                          <input
                            type="text"
                            value={row.relative_alternative_phone_no}
                            onChange={(e) => {
                              const value = e.target.value
                              setRelatives(prev => prev.map((r, i) =>
                                i === idx ? { ...r, relative_alternative_phone_no: value } : r
                              ))
                            }}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Alternative Phone"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Alternative Phone No 2
                          </label>
                          <input
                            type="text"
                            value={row.relative_alternative_phone_no_2}
                            onChange={(e) => {
                              const value = e.target.value
                              setRelatives(prev => prev.map((r, i) =>
                                i === idx ? { ...r, relative_alternative_phone_no_2: value } : r
                              ))
                            }}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Alternative Phone 2"
                          />
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Remarks
                          </label>
                          <textarea
                            value={row.any_remarks}
                            onChange={(e) => {
                              const value = e.target.value
                              setRelatives(prev => prev.map((r, i) =>
                                i === idx ? { ...r, any_remarks: value } : r
                              ))
                            }}
                            rows={2}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Any notes about this relative / guardian"
                          />
                        </div>
                        {relatives.length > 1 && (
                          <button
                            type="button"
                            className="mt-5 text-xs text-red-600 hover:text-red-700"
                            onClick={() =>
                              setRelatives(prev => prev.filter((_, i) => i !== idx))
                            }
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          </div>

          {/* Footer */}
          <div className="px-4 md:px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50 shrink-0 sticky bottom-0 z-10">
            <div className="text-xs text-slate-500">
              {hasDischargeReceptionist && checklistStatus === 'incomplete' && totalItems > 0 && (
                <span className="flex items-center gap-1 text-red-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {checklistIncomplete} checklist item{checklistIncomplete !== 1 ? 's' : ''} remaining
                </span>
              )}
              {hasDischargeReceptionist && financeOnlyPending && (
                <span className="flex items-center gap-1 text-yellow-700">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {CHECKLIST_STATUS_LABELS.finance_pending} — use Discharge Without Finance
                </span>
              )}
              {hasDischargeReceptionist && allCompleted && totalItems > 0 && (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Checklist complete
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAndClose}
                disabled={submitting || savingDraft || chargeSectionBusy}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Save draft on server and close. You can continue this discharge later."
              >
                <Save className="w-4 h-4" />
                {savingDraft ? 'Saving…' : 'Save & Close'}
              </button>
              {showDischargeWithoutFinanceButton && (
                <button
                  type="button"
                  onClick={handleDischargeWithoutFinance}
                  disabled={submitting || savingDraft || chargeSectionBusy}
                  title="Mark admission Discharged and free the bed. Discharge document stays draft until finance completes."
                  className="px-4 py-2 text-sm font-medium text-amber-950 bg-yellow-400 rounded-md hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Discharging…' : 'Discharge Without Finance'}
                </button>
              )}
              {showDischargePatientButton && (
                <button
                  type="submit"
                  disabled={submitting || savingDraft || chargeSectionBusy || !canSubmitDischarge}
                  title={
                    !canSubmitDischarge
                      ? `Complete all discharge checklist items first (${checklistIncomplete} remaining)`
                      : undefined
                  }
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Discharging...' : 'Discharge Patient'}
                </button>
              )}
            </div>
          </div>
        </form>
    </div>
  )
}