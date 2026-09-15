import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_BODY_GRADIENT,
  CREATE_MODAL_OVERLAY,
  CreateModalFooter,
  CreateModalHeader,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { searchPatients, fetchPatients, uploadPatientFile, type PatientListItem } from '../../services/patients'
import {
  fetchCompanies,
  resolveDefaultCompany,
  fetchHealthcarePractitioners,
  fetchPatientVisits,
  fetchInpatientAdmissions,
  fetchPrescriptionItems,
  fetchStandardUoms,
  fetchDosageForms,
  fetchPrescriptionFrequencies,
  fetchLongActingFrequencies,
  fetchRouteOfAdministrationList,
  resolvePrescriptionDrugRoute,
  fetchDoc,
  type LinkFieldOption,
} from '../../services/common'
import { useLockedLinkedPractitioner } from '../../hooks/useLockedLinkedPractitioner'
import {
  createPrescription,
  updatePrescription,
  resolveMedicationsForDuplicate,
  type CreatePrescriptionData,
  type MedicationOrderRow,
  type Prescription,
  checkPrescriptionDrugStock,
  type PrescriptionDrugStockCheck,
  previewPrescriptionDoseValidation,
  fetchMedicineDoseLimitInfo,
  type PrescriptionDoseValidationPreview,
  type MedicineDoseLimitInfo,
} from '../../services/prescriptions'
import { isLegacyMedicationOrderRow } from '../../utils/medicationOrderDisplayUtils'
import { createVisitAndPrescriptionOnDischarge } from '../../services/medicineGiven'
import { bulkCreateNurseTasks, type CreateNurseTaskData } from '../../services/nurseTask'
import { toast } from '../../hooks/useToast'
import {
  flagsFromPrescriptionType,
  isLongActingPrescriptionType,
  isPrnPrescriptionType,
  syncPrescriptionEndDateAndDays,
} from '../../utils/prescriptionType'
import { X, Plus, Trash2, Pill, ChevronDown, ChevronUp, PenLine } from 'lucide-react'
import { SignaturePad, attachFileDisplayUrl } from '../ui/SignaturePad'
import { useCareContext } from '../../providers/CareContextProvider'
import { useBlockIfActiveCareClosed } from '../../hooks/useBlockIfActiveCareClosed'
import { useRejectEditModeWhenLocked } from '../../hooks/useRejectEditModeWhenLocked'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import {
  CreateFrequencyMiniModal,
  type CreateFrequencyKind,
} from './CreateFrequencyMiniModal'
import {
  PrescriptionDoseLimitConfirmModal,
  type PrescriptionDoseLimitIssue,
} from './PrescriptionDoseLimitConfirmModal'
import { DoseLimitHint } from './DoseLimitHint'
import { DateFilterInput } from '../ui/DateFilterInput'
import { localDateInputValue } from '../../utils/formatDate'

interface CreatePrescriptionModalProps {
  onClose: () => void
  onSuccess: (result?: { patient_visit: string; patient_medication_order: string }) => void
  initialPatient?: string
  initialMedications?: MedicationOrderRow[]
  initialCareContext?: 'Patient Visit' | 'Inpatient Admission'
  initialPatientEncounter?: string
  initialInpatientRecord?: string
  initialStartDate?: string
  initialPractitioner?: string
  transferAdmission?: string
  transferOrderEntryNames?: string[]
  editMode?: boolean
  prescriptionData?: Prescription | null
}

type TabId = 'details' | 'medications' | 'signature'

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + Math.round(days))
  return d.toISOString().split('T')[0]
}

function daysBetween(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0
  const start = new Date(startStr)
  const end = new Date(endStr)
  const diff = end.getTime() - start.getTime()
  return Math.round(diff / (24 * 60 * 60 * 1000))
}

const PRESCRIPTION_TYPES = [
  'STAT',
  'PRN',
  'Regular - Psy (Active)',
  'Regular - Med (Active)',
  'Long Acting Medicine',
] as const

const emptyMedicationRow = (startDate: string): MedicationOrderRow => ({
  drug: '',
  drug_name: '',
  dosage: '',
  uom: 'UNIT',
  no_of_days: 1,
  dosage_form: '',
  instructions: '',
  date: startDate,
  end_date: '',
  time: '',
  patient_frequency: '',
  is_pink: false,
  reference_no: '',
  is_prn: false,
  is_long_acting: false,
  long_acting_frequency: 'Weekly',
  route_of_administration: '',
  medication_type: '',
})

function formatMedicationStockInline(stock: PrescriptionDrugStockCheck): string | null {
  if (!stock.warn || !stock.level) return null
  const qty = stock.actual_qty ?? 0
  if (stock.level === 'out_of_stock') return `Out of stock - ${qty}`
  return `Low stock - ${qty}`
}

// COMBOBOX WITH FIXED POSITIONING - DROPDOWNS ESCAPE MODAL
interface ComboboxProps {
  value: string
  displayValue: string
  placeholder: string
  options: LinkFieldOption[]
  loading?: boolean
  onQueryChange: (q: string) => void
  onSelect: (opt: LinkFieldOption) => void
  onOpen: () => void
  onClear?: () => void
  label?: string
  required?: boolean
  renderOption?: (opt: LinkFieldOption) => React.ReactNode
  allowCustom?: boolean
  onCreateClick?: () => void
  readOnly?: boolean
}

const Combobox = ({
  displayValue,
  placeholder,
  options,
  loading,
  onQueryChange,
  onSelect,
  onOpen,
  required,
  renderOption,
  onClear,
  allowCustom = false,
  onCreateClick,
  readOnly = false,
}: ComboboxProps) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [customValue, setCustomValue] = useState('')

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelectCustom = () => {
    if (customValue.trim()) {
      onSelect({ name: customValue.trim(), label: customValue.trim() })
      setOpen(false)
      setCustomValue('')
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          type="text"
          value={displayValue}
          readOnly={readOnly}
          onChange={(e) => {
            if (readOnly) return
            onQueryChange(e.target.value)
            if (allowCustom) {
              setCustomValue(e.target.value)
            }
            setOpen(true)
          }}
          onFocus={() => {
            if (readOnly) return
            setOpen(true)
            onOpen()
          }}
          placeholder={placeholder}
          required={required}
          title={readOnly ? 'Locked to your linked practitioner' : undefined}
          className={
            readOnly
              ? 'w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700 cursor-not-allowed focus:outline-none'
              : linkComboboxInputWithClearClass
          }
        />
        {!readOnly ? (
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {onCreateClick && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onCreateClick()
              }}
              className="p-0.5 text-primary hover:text-primary/80 rounded"
              title="Create new"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {displayValue && onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClear()
                setOpen(false)
              }}
              className="text-slate-400 hover:text-slate-600 transition-colors p-0.5"
              title="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        ) : null}
      </div>
      
      {open && !readOnly && (
        <div className={linkComboboxDropdownClass}>
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-500">Loading...</div>
          ) : options.length ? (
            <>
              {options.map((opt) => (
                <button
                  key={opt.name}
                  type="button"
                  className={linkComboboxOptionClassCompact}
                  onClick={() => {
                    onSelect(opt)
                    setOpen(false)
                  }}
                >
                  {renderOption ? renderOption(opt) : (opt.label || opt.name)}
                </button>
              ))}
              {allowCustom && customValue && !options.find(o => o.name === customValue || o.label === customValue) && (
                <button
                  type="button"
                  onClick={handleSelectCustom}
                  className="w-full text-left px-3 py-2 text-sm border-t border-slate-100 bg-slate-50 hover:bg-emerald-50/80 transition-colors text-primary font-medium"
                >
                  + Use "{customValue}"
                </button>
              )}
            </>
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">
              {allowCustom && customValue ? (
                <button
                  type="button"
                  onClick={handleSelectCustom}
                  className="w-full text-left text-primary font-medium hover:underline"
                >
                  + Use "{customValue}"
                </button>
              ) : (
                'NO RESULTS FOUND'
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const CreatePrescriptionModal = ({
  onClose,
  onSuccess,
  initialPatient,
  initialMedications,
  initialCareContext,
  initialPatientEncounter,
  initialInpatientRecord,
  initialPractitioner,
  transferAdmission,
  transferOrderEntryNames,
  editMode = false,
  prescriptionData = null,
}: CreatePrescriptionModalProps) => {
  const { mode, activeVisit, activeAdmission, costCenterCompany, userCostCenter } = useCareContext()
  const blockIfActiveCareClosed = useBlockIfActiveCareClosed()
  useRejectEditModeWhenLocked(editMode, onClose)
  const [activeTab, setActiveTab] = useState<TabId>('details')
  const [expandedMedications, setExpandedMedications] = useState<Set<number>>(new Set([0]))

  const [patientQuery, setPatientQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientListItem | null>(null)
  const [patients, setPatients] = useState<PatientListItem[]>([])
  const [loadingPatients, setLoadingPatients] = useState(false)

  const [companies, setCompanies] = useState<LinkFieldOption[]>([])
  const [visits, setVisits] = useState<LinkFieldOption[]>([])
  const [admissions, setAdmissions] = useState<LinkFieldOption[]>([])
  const [practitioners, setPractitioners] = useState<LinkFieldOption[]>([])
  const [practQuery, setPractQuery] = useState('')
  const {
    locked: practitionerLocked,
    practitionerId: linkedPractitionerId,
    practitionerLabel: linkedPractitionerLabel,
  } = useLockedLinkedPractitioner()

  const [formData, setFormData] = useState({
    care_context: 'Patient Visit' as 'Patient Visit' | 'Inpatient Admission',
    patient_encounter: '',
    inpatient_record: '',
    company: '',
    start_date: localDateInputValue(),
    practitioner: '',
  })

  const [medications, setMedications] = useState<MedicationOrderRow[]>(() => [
    emptyMedicationRow(new Date().toISOString().split('T')[0]),
  ])
  /** After the user adds/removes rows, ignore late initialMedications resolve overwrites. */
  const medicationsUserEditedRef = useRef(false)
  const medicationRowKeysRef = useRef<string[]>(['med-0'])
  const medicationKeySeqRef = useRef(1)

  const nextMedicationRowKey = () => {
    const key = `med-${medicationKeySeqRef.current}`
    medicationKeySeqRef.current += 1
    return key
  }

  const [drugQueries, setDrugQueries] = useState<Record<number, string>>({})
  // Scientific / generic name of the drug selected per row (for display under the field).
  const [drugScientific, setDrugScientific] = useState<Record<number, string>>({})
  const [drugOptions, setDrugOptions] = useState<Record<number, LinkFieldOption[]>>({})
  const [drugLoading, setDrugLoading] = useState<Record<number, boolean>>({})

  const [frequencyQueries, setFrequencyQueries] = useState<Record<number, string>>({})
  const [routeQueries, setRouteQueries] = useState<Record<number, string>>({})
  const [uomQueries, setUomQueries] = useState<Record<number, string>>({})

  const [dosageForms, setDosageForms] = useState<LinkFieldOption[]>([])
  const [frequencyOptions, setFrequencyOptions] = useState<LinkFieldOption[]>([])
  const [longActingFrequencyOptions, setLongActingFrequencyOptions] = useState<LinkFieldOption[]>([])
  const [routeOptions, setRouteOptions] = useState<LinkFieldOption[]>([])
  const [uomOptions, setUomOptions] = useState<LinkFieldOption[]>([])
  const [loadingFrequency, setLoadingFrequency] = useState(false)
  const [loadingLongActingFrequency, setLoadingLongActingFrequency] = useState(false)
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [loadingUom, setLoadingUom] = useState(false)
  const [longActingFrequencyQueries, setLongActingFrequencyQueries] = useState<Record<number, string>>({})
  const [createFreqModal, setCreateFreqModal] = useState<{
    kind: CreateFrequencyKind
    rowIndex: number
    initialName?: string
  } | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [createNurseTasks, setCreateNurseTasks] = useState(false)
  const [nurseTaskRows, setNurseTaskRows] = useState<Record<number, boolean>>({})

  const [doctorsSignature, setDoctorsSignature] = useState<string | null>(null)
  const [signatureUploading, setSignatureUploading] = useState(false)
  const [attachmentUploading, setAttachmentUploading] = useState(false)
  const [medicationStock, setMedicationStock] = useState<Record<number, PrescriptionDrugStockCheck>>({})
  const [medicationDoseWarnings, setMedicationDoseWarnings] = useState<
    Record<number, PrescriptionDoseValidationPreview>
  >({})
  const [checkingDoseRows, setCheckingDoseRows] = useState<Record<number, boolean>>({})
  const [medicationDoseLimits, setMedicationDoseLimits] = useState<Record<number, MedicineDoseLimitInfo | null>>(
    {},
  )
  const [loadingDoseLimits, setLoadingDoseLimits] = useState<Record<number, boolean>>({})
  const [doseLimitConfirmOpen, setDoseLimitConfirmOpen] = useState(false)
  const [doseLimitConfirmIssues, setDoseLimitConfirmIssues] = useState<PrescriptionDoseLimitIssue[]>([])

  const isEditing = editMode

  // Re-check max dose when drug, dosage, route, or long-acting mode changes.
  const doseValidationKey = useMemo(
    () =>
      medications
        .map((row) => {
          const longActing =
            Boolean(row.is_long_acting) || isLongActingPrescriptionType(String(row.medication_type))
          return `${(row.drug || '').trim()}\u0001${(row.dosage || '').trim()}\u0001${(row.route_of_administration || '').trim()}\u0001${longActing ? '1' : '0'}`
        })
        .join('\u0002'),
    [medications],
  )

  useEffect(() => {
    let cancelled = false
    const timers: number[] = []

    medications.forEach((row, index) => {
      const drug = (row.drug || '').trim()
      const dosage = (row.dosage || '').trim()
      const longActing =
        Boolean(row.is_long_acting) || isLongActingPrescriptionType(String(row.medication_type))
      if (!drug || !dosage) {
        setMedicationDoseWarnings((prev) => {
          if (!(index in prev)) return prev
          const next = { ...prev }
          delete next[index]
          return next
        })
        return
      }

      const timer = window.setTimeout(() => {
        setCheckingDoseRows((prev) => ({ ...prev, [index]: true }))
        previewPrescriptionDoseValidation({
          medicine_code: drug,
          dose: dosage,
          patient: selectedPatient?.name,
          patient_encounter:
            formData.care_context === 'Patient Visit' ? formData.patient_encounter || undefined : undefined,
          inpatient_record:
            formData.care_context === 'Inpatient Admission'
              ? formData.inpatient_record || undefined
              : undefined,
          route_of_administration: row.route_of_administration || undefined,
          is_long_acting: longActing ? 1 : 0,
        })
          .then((preview) => {
            if (cancelled) return
            setMedicationDoseWarnings((prev) => {
              const next = { ...prev }
              if (preview.has_limit && !preview.ok && preview.message) {
                next[index] = preview
              } else {
                delete next[index]
              }
              return next
            })
          })
          .catch(() => {
            if (cancelled) return
            setMedicationDoseWarnings((prev) => {
              if (!(index in prev)) return prev
              const next = { ...prev }
              delete next[index]
              return next
            })
          })
          .finally(() => {
            if (!cancelled) {
              setCheckingDoseRows((prev) => {
                const next = { ...prev }
                delete next[index]
                return next
              })
            }
          })
      }, 350)
      timers.push(timer)
    })

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only drug/dosage (via doseValidationKey), not other med fields
  }, [
    doseValidationKey,
    selectedPatient?.name,
    formData.care_context,
    formData.patient_encounter,
    formData.inpatient_record,
  ])

  useEffect(() => {
    let cancelled = false
    medications.forEach((row, index) => {
      const drug = (row.drug || '').trim()
      const longActing =
        Boolean(row.is_long_acting) || isLongActingPrescriptionType(String(row.medication_type))
      if (!drug) {
        setMedicationDoseLimits((prev) => {
          if (!(index in prev)) return prev
          const next = { ...prev }
          delete next[index]
          return next
        })
        return
      }
      setLoadingDoseLimits((prev) => ({ ...prev, [index]: true }))
      fetchMedicineDoseLimitInfo(drug, longActing)
        .then((info) => {
          if (!cancelled) setMedicationDoseLimits((prev) => ({ ...prev, [index]: info }))
        })
        .catch(() => {
          if (!cancelled) setMedicationDoseLimits((prev) => ({ ...prev, [index]: null }))
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingDoseLimits((prev) => {
              const next = { ...prev }
              delete next[index]
              return next
            })
          }
        })
    })
    return () => {
      cancelled = true
    }
  }, [doseValidationKey])

  const searchFrequencies = async (query: string) => {
    setLoadingFrequency(true)
    try {
      const allFrequencies = await fetchPrescriptionFrequencies(query || undefined)
      setFrequencyOptions(allFrequencies)
    } catch (error) {
      console.error('Failed to search frequencies:', error)
      setFrequencyOptions([])
    } finally {
      setLoadingFrequency(false)
    }
  }

  const searchLongActingFrequencies = async (query: string) => {
    setLoadingLongActingFrequency(true)
    try {
      const options = await fetchLongActingFrequencies(query || undefined)
      setLongActingFrequencyOptions(options)
    } catch (error) {
      console.error('Failed to search long acting frequencies:', error)
      setLongActingFrequencyOptions([])
    } finally {
      setLoadingLongActingFrequency(false)
    }
  }

  const searchRoutes = async (query: string) => {
    setLoadingRoute(true)
    try {
      const allRoutes = await fetchRouteOfAdministrationList()
      if (!query.trim()) {
        setRouteOptions(allRoutes)
      } else {
        const filtered = allRoutes.filter(r => 
          r.label?.toLowerCase().includes(query.toLowerCase()) || 
          r.name?.toLowerCase().includes(query.toLowerCase())
        )
        setRouteOptions(filtered)
      }
    } catch (error) {
      console.error('Failed to search routes:', error)
      setRouteOptions([])
    } finally {
      setLoadingRoute(false)
    }
  }

  const applyDrugSelection = async (index: number, opt: LinkFieldOption) => {
    const route = (await resolvePrescriptionDrugRoute(opt)).trim()
    // UOM defaults to UNIT on every prescription line (editable if it differs).
    const stockUom = 'UNIT'
    setMedications((prev) => {
      const next = [...prev]
      if (!next[index]) return prev
      next[index] = {
        ...next[index],
        drug: opt.name,
        drug_name: opt.label || opt.name,
        uom: stockUom,
        is_pink: Boolean(opt.is_pink),
        reference_no: opt.is_pink ? next[index].reference_no || '' : '',
        ...(route ? { route_of_administration: route } : {}),
      }
      return next
    })
    setUomQueries((prev) => ({ ...prev, [index]: stockUom }))
    setDrugQueries((prev) => ({ ...prev, [index]: opt.label || opt.name }))
    setDrugScientific((prev) => ({ ...prev, [index]: (opt.scientific_name || '').trim() }))
    if (route) {
      let routes = routeOptions
      if (!routes.length) {
        routes = await fetchRouteOfAdministrationList().catch(() => [])
        setRouteOptions(routes)
      }
      const match = routes.find((r) => r.name === route || r.label === route)
      setRouteQueries((prev) => ({
        ...prev,
        [index]: match?.label || match?.name || route,
      }))
    }
    setDrugOptions((prev) => ({ ...prev, [index]: [] }))

    try {
      const stock = await checkPrescriptionDrugStock(opt.name, userCostCenter, formData.company)
      setMedicationStock((prev) => {
        const next = { ...prev }
        if (stock.warn) {
          next[index] = stock
        } else {
          delete next[index]
        }
        return next
      })
    } catch {
      /* non-blocking */
    }
  }

  const searchUoms = async (query: string) => {
    setLoadingUom(true)
    try {
      const allUoms = await fetchStandardUoms(query || undefined, { medicalOnly: true })
      setUomOptions(allUoms)
    } catch (error) {
      console.error('Failed to search UOMs:', error)
      setUomOptions([])
    } finally {
      setLoadingUom(false)
    }
  }

  // Load initial data
  useEffect(() => {
    fetchPrescriptionFrequencies().then(setFrequencyOptions).catch(() => setFrequencyOptions([]))
    fetchRouteOfAdministrationList().then(setRouteOptions).catch(() => setRouteOptions([]))
    fetchStandardUoms(undefined, { medicalOnly: true }).then(setUomOptions).catch(() => setUomOptions([]))
  }, [])

  useEffect(() => {
    if (editMode && prescriptionData) {
      const linkedVisit = (prescriptionData.patient_encounter || '').trim()
      const careContext: 'Patient Visit' | 'Inpatient Admission' = linkedVisit
        ? 'Patient Visit'
        : prescriptionData.care_context === 'Inpatient Admission'
          ? 'Inpatient Admission'
          : 'Patient Visit'

      setFormData({
        care_context: careContext,
        patient_encounter: linkedVisit,
        inpatient_record:
          careContext === 'Inpatient Admission' ? (prescriptionData.inpatient_record || '') : '',
        company: prescriptionData.company || '',
        start_date: prescriptionData.start_date || localDateInputValue(),
        practitioner: prescriptionData.practitioner || '',
      })
      
      if (prescriptionData.patient) {
        setSelectedPatient({ 
          name: prescriptionData.patient, 
          patient_name: prescriptionData.patient_name || prescriptionData.patient 
        } as PatientListItem)
        setPatientQuery(prescriptionData.patient_name || prescriptionData.patient)
      }
      
      if (prescriptionData.medication_orders && prescriptionData.medication_orders.length > 0) {
        const loadedMedications: MedicationOrderRow[] = prescriptionData.medication_orders.map((med: any) => ({
          drug: med.drug || '',
          drug_name: med.drug_name || med.drug || '',
          dosage: med.dosage || '',
          uom: med.uom || '',
          no_of_days: med.no_of_days || 1,
          dosage_form: med.dosage_form || '',
          instructions: med.instructions || '',
          date: med.date || formData.start_date,
          // Leave end date blank when missing — do not default to today/tomorrow.
          end_date: med.end_date || '',
          time: med.time || '',
          patient_frequency: med.patient_frequency || '',
          is_pink: med.is_pink || false,
          reference_no: med.reference_no || '',
          long_acting_frequency: med.long_acting_frequency || 'Weekly',
          route_of_administration: med.route_of_administration || '',
          medication_type:
            med.medication_type === 'Contraindicated' ? '' : (med.medication_type || ''),
          ...flagsFromPrescriptionType(
            med.medication_type === 'Contraindicated' ? '' : med.medication_type
          ),
        }))
        setMedications(loadedMedications)
        
        const queries: Record<number, string> = {}
        const nextUomQueries: Record<number, string> = {}
        loadedMedications.forEach((med, idx) => {
          if (med.drug) queries[idx] = med.drug_name || med.drug
          if (med.uom) nextUomQueries[idx] = med.uom
        })
        setDrugQueries(queries)
        setUomQueries(nextUomQueries)
      }

      if (prescriptionData.doctors_signature) {
        setDoctorsSignature(prescriptionData.doctors_signature)
      }
    }
  }, [editMode, prescriptionData, formData.start_date])

  useEffect(() => {
    if (isEditing) return
    if (initialCareContext) return
    setFormData((prev) => {
      const next = { ...prev }
      if (mode === 'IP') {
        next.care_context = 'Inpatient Admission'
      } else if (mode === 'OP') {
        next.care_context = 'Patient Visit'
      }
      return next
    })
  }, [mode, initialCareContext, isEditing])

  useEffect(() => {
    if (!selectedPatient) {
      if (isEditing) return
      setVisits([])
      setAdmissions([])
      setFormData((p) => ({ ...p, patient_encounter: '', inpatient_record: '' }))
      return
    }
    fetchPatientVisits(selectedPatient.name).then(setVisits).catch(() => setVisits([]))
    fetchInpatientAdmissions(selectedPatient.name).then(setAdmissions).catch(() => setAdmissions([]))
  }, [selectedPatient?.name, isEditing])

  useEffect(() => {
    if (isEditing) return
    setFormData((prev) => {
      const next = { ...prev }
      if (mode === 'OP' && activeVisit) {
        next.care_context = 'Patient Visit'
        next.patient_encounter = activeVisit
      }
      if (mode === 'IP' && activeAdmission) {
        next.care_context = 'Inpatient Admission'
        next.inpatient_record = activeAdmission
      }
      return next
    })
  }, [mode, activeVisit, activeAdmission, isEditing])

  const displayVisits = useMemo(() => {
    const encounter = formData.patient_encounter.trim()
    if (!encounter) return visits
    if (visits.some((visit) => visit.name === encounter)) return visits
    return [{ name: encounter, label: encounter }, ...visits]
  }, [visits, formData.patient_encounter])

  const lockCareContextOnEdit = Boolean(
    isEditing && (prescriptionData?.patient_encounter || prescriptionData?.after_discharge),
  )

  useEffect(() => {
    fetchCompanies().then(setCompanies).catch(() => setCompanies([]))
    fetchHealthcarePractitioners().then(setPractitioners).catch(() => setPractitioners([]))
    fetchDosageForms().then(setDosageForms).catch(() => setDosageForms([]))
  }, [])

  useEffect(() => {
    if (isEditing || !linkedPractitionerId) return
    setFormData((prev) => (prev.practitioner ? prev : { ...prev, practitioner: linkedPractitionerId }))
    setPractQuery((q) => q.trim() || linkedPractitionerLabel || linkedPractitionerId)
  }, [linkedPractitionerId, linkedPractitionerLabel, isEditing])

  useEffect(() => {
    if (initialPractitioner && !isEditing && !formData.practitioner) {
      setFormData((prev) => ({ ...prev, practitioner: initialPractitioner }))
      const practitionerOption = practitioners.find((p) => p.name === initialPractitioner)
      if (practitionerOption) {
        setPractQuery(practitionerOption.label || initialPractitioner)
      } else {
        setPractQuery(initialPractitioner)
      }
    }
  }, [initialPractitioner, practitioners, isEditing, formData.practitioner])

  // Auto-fill Doctors Signature from Healthcare Practitioner.signature when a doctor is selected.
  useEffect(() => {
    const practitionerName = formData.practitioner?.trim()
    if (!practitionerName) return

    // Keep an existing saved signature when editing the same practitioner.
    if (
      isEditing &&
      prescriptionData?.doctors_signature &&
      prescriptionData.practitioner === practitionerName
    ) {
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const doc = await fetchDoc('Healthcare Practitioner', practitionerName)
        if (cancelled) return
        const sig = typeof doc.signature === 'string' ? doc.signature.trim() : ''
        setDoctorsSignature(sig || null)
      } catch (err) {
        console.error('Failed to load practitioner signature for prescription:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [formData.practitioner, isEditing, prescriptionData?.doctors_signature, prescriptionData?.practitioner])

  useEffect(() => {
    if (initialPatient && !selectedPatient) {
      setPatientQuery(initialPatient)
      fetchPatients(20, 0, initialPatient)
        .then((list) => {
          const match = list.find((p) => p.name === initialPatient)
          setSelectedPatient(match || ({ name: initialPatient, patient_name: initialPatient } as PatientListItem))
        })
        .catch(() =>
          setSelectedPatient({ name: initialPatient, patient_name: initialPatient } as PatientListItem),
        )
    }
  }, [initialPatient, selectedPatient])

  useEffect(() => {
    if (!initialMedications || initialMedications.length === 0) return
    if (medicationsUserEditedRef.current) return

    let cancelled = false
    const applyRows = (rows: MedicationOrderRow[]) => {
      if (cancelled || medicationsUserEditedRef.current) return
      setMedications(rows)
      medicationRowKeysRef.current = rows.map(() => nextMedicationRowKey())
      const queries: Record<number, string> = {}
      const nextFreq: Record<number, string> = {}
      const nextRoute: Record<number, string> = {}
      const nextUom: Record<number, string> = {}
      const nextLongActing: Record<number, string> = {}
      rows.forEach((med, idx) => {
        queries[idx] = (med.drug_name || med.drug || '').trim()
        if (med.patient_frequency) nextFreq[idx] = med.patient_frequency
        if (med.route_of_administration) nextRoute[idx] = med.route_of_administration
        if (med.uom) nextUom[idx] = med.uom
        if (med.long_acting_frequency) nextLongActing[idx] = String(med.long_acting_frequency)
      })
      setDrugQueries(queries)
      setFrequencyQueries(nextFreq)
      setRouteQueries(nextRoute)
      setUomQueries(nextUom)
      setLongActingFrequencyQueries(nextLongActing)
      setExpandedMedications(new Set(rows.map((_, idx) => idx)))
    }

    // Duplicate of legacy Rx: map ITEM_00_01 → current Item when possible.
    const needsLegacyResolve = initialMedications.some(
      (med) =>
        isLegacyMedicationOrderRow(med) ||
        Boolean(med.old_medicine_code || med.medicine_no) ||
        !med.drug,
    )
    if (!needsLegacyResolve) {
      applyRows(initialMedications)
      return () => {
        cancelled = true
      }
    }

    applyRows(initialMedications)
    resolveMedicationsForDuplicate(initialMedications)
      .then((resolved) => {
        if (cancelled || medicationsUserEditedRef.current) return
        // Merge only mapped drug fields so dosage/frequency/etc. from the
        // original duplicate payload are never dropped by the resolve API.
        const merged = initialMedications.map((orig, i) => {
          const r = resolved[i]
          if (!r) return orig
          return {
            ...orig,
            drug: r.drug || orig.drug,
            drug_name: r.drug_name || orig.drug_name,
            old_medicine_code: r.old_medicine_code || orig.old_medicine_code,
          }
        })
        applyRows(merged)
      })
      .catch(() => {
        /* keep original rows; doctor can still pick Item manually */
      })

    return () => {
      cancelled = true
    }
  }, [initialMedications])

  useEffect(() => {
    if (!initialCareContext || isEditing) return
    setFormData((prev) => ({
      ...prev,
      care_context: initialCareContext,
      patient_encounter: initialPatientEncounter || '',
      inpatient_record:
        initialCareContext === 'Patient Visit' ? '' : initialInpatientRecord || prev.inpatient_record,
      start_date: prev.start_date || localDateInputValue(),
    }))
  }, [initialCareContext, initialPatientEncounter, initialInpatientRecord, isEditing])

  useEffect(() => {
    if (isEditing) return
    if (!companies.length) return
    setFormData((p) => {
      if (p.company) return p
      const company = resolveDefaultCompany(companies, costCenterCompany)
      return company ? { ...p, company } : p
    })
  }, [companies, costCenterCompany, isEditing])

  const loadDrugOptions = (index: number, query: string) => {
    if (!query || query.length < 1) {
      setDrugOptions((prev) => ({ ...prev, [index]: [] }))
      return
    }
    setDrugLoading((prev) => ({ ...prev, [index]: true }))
    fetchPrescriptionItems(query)
      .then((opts) => setDrugOptions((prev) => ({ ...prev, [index]: opts })))
      .catch(() => setDrugOptions((prev) => ({ ...prev, [index]: [] })))
      .finally(() => setDrugLoading((prev) => ({ ...prev, [index]: false })))
  }

  const addMedicationRow = () => {
    medicationsUserEditedRef.current = true
    const newIndex = medications.length
    setMedications((prev) => [...prev, emptyMedicationRow(formData.start_date)])
    medicationRowKeysRef.current = [...medicationRowKeysRef.current, nextMedicationRowKey()]
    // Collapse previous rows and expand the newly added one (2nd medication onward).
    if (newIndex >= 1) {
      setExpandedMedications(new Set([newIndex]))
    }
  }

  const removeMedicationRow = (index: number) => {
    medicationsUserEditedRef.current = true
    setMedications((prev) => {
      const nextMeds = prev.filter((_, i) => i !== index)
      setDrugQueries((prevQ) => {
        const next: Record<number, string> = {}
        nextMeds.forEach((med, i) => {
          const oldIndex = i < index ? i : i + 1
          next[i] = (prevQ[oldIndex] || med.drug_name || med.drug || '').trim()
        })
        return next
      })
      return nextMeds
    })
    medicationRowKeysRef.current = medicationRowKeysRef.current.filter((_, i) => i !== index)

    const reindexRecord = <T,>(prev: Record<number, T>): Record<number, T> => {
      const next: Record<number, T> = {}
      Object.entries(prev).forEach(([key, val]) => {
        const i = Number(key)
        if (Number.isNaN(i) || i === index) return
        next[i < index ? i : i - 1] = val
      })
      return next
    }

    setDrugScientific((prev) => reindexRecord(prev))
    setDrugOptions((prev) => reindexRecord(prev))
    setDrugLoading((prev) => reindexRecord(prev))
    setFrequencyQueries((prev) => reindexRecord(prev))
    setRouteQueries((prev) => reindexRecord(prev))
    setUomQueries((prev) => reindexRecord(prev))
    setLongActingFrequencyQueries((prev) => reindexRecord(prev))
    setNurseTaskRows((prev) => reindexRecord(prev))
    setMedicationStock((prev) => reindexRecord(prev))
    setCheckingDoseRows((prev) => reindexRecord(prev))
    setExpandedMedications((prev) => {
      const next = new Set<number>()
      prev.forEach((i) => {
        if (i === index) return
        next.add(i < index ? i : i - 1)
      })
      return next
    })
  }

  const toggleMedicationExpanded = (index: number) => {
    setExpandedMedications((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const updateMedicationRow = (index: number, field: keyof MedicationOrderRow, value: string | number | boolean) => {
    setMedications((prev) => {
      const next = [...prev]
      if (!next[index]) return next
      const row = { ...next[index], [field]: value }
      if (field === 'medication_type') {
        Object.assign(row, flagsFromPrescriptionType(String(value)))
        if (isLongActingPrescriptionType(String(value))) {
          const lf = row.long_acting_frequency || 'Weekly'
          row.long_acting_frequency = lf
          row.patient_frequency = lf
        }
      }
      if (field === 'long_acting_frequency') {
        row.patient_frequency = String(value)
      }

      const isIP = mode === 'IP'
      // Long-acting medicines may have an empty end date — don't auto-compute it for them.
      const rowIsLongActing = row.is_long_acting || isLongActingPrescriptionType(String(row.medication_type))
      if (!isIP && !rowIsLongActing && (field === 'date' || field === 'end_date' || field === 'no_of_days')) {
        Object.assign(row, syncPrescriptionEndDateAndDays(row, field, addDays, daysBetween))
      }
      
      next[index] = row
      return next
    })
  }

	const validMedications = medications
    .filter((m) => {
      const stopped = Boolean(String(m.reason_stopped || '').trim())
      // Stopped/discontinued lines: include if drug + date present (user can remove to exclude).
      if (stopped) return Boolean(m.drug && m.date)
      return Boolean(m.drug && m.dosage && m.date)
    })
    .map((m) => ({ ...m, ...flagsFromPrescriptionType(m.medication_type) }))

  const isSignedEvidence = Boolean(doctorsSignature)

  const handleDoctorSignatureSave = async (file: File) => {
    setSignatureUploading(true)
    try {
      const fileUrl = await uploadPatientFile(file)
      if (!fileUrl) throw new Error('No URL returned from signature upload')
      setDoctorsSignature(fileUrl)
      toast.success('Signature saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signature upload failed')
    } finally {
      setSignatureUploading(false)
    }
  }

  /** Upload alternative to drawing — same doctors_signature Attach field. */
  const handleSignatureAttachment = async (file: File | null) => {
    if (!file) {
      setDoctorsSignature(null)
      return
    }
    setAttachmentUploading(true)
    try {
      const fileUrl = await uploadPatientFile(file)
      if (!fileUrl) throw new Error('No URL returned from upload')
      setDoctorsSignature(fileUrl)
      toast.success('Signature attachment saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attachment upload failed')
    } finally {
      setAttachmentUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setError(null)
    try {
      blockIfActiveCareClosed()
    } catch {
      return
    }
    if (!selectedPatient) { setError('Please select a patient'); setActiveTab('details'); return }
    if (!formData.company) { setError('Please select a company'); setActiveTab('details'); return }
    // A prescription can only be created against the current visit / admission.
    // Discharge transfer creates the visit on save when none is selected.
    if (
      formData.care_context === 'Patient Visit' &&
      !formData.patient_encounter &&
      !transferAdmission
    ) {
      setError('A prescription can only be created for the current patient visit.'); setActiveTab('details'); return
    }
    if (formData.care_context === 'Inpatient Admission' && !formData.inpatient_record) {
      setError('A prescription can only be created for the current admission.'); setActiveTab('details'); return
    }
    if (validMedications.length === 0) {
      setError('Please add at least one medication with Drug, Dosage, and Date')
      setActiveTab('medications'); return
    }
    const pinkMissingRef = validMedications.filter(
      (med) => med.is_pink && !String(med.reference_no || '').trim()
    )
    // Pink reference is required for outpatient only — not inpatient prescriptions
    if (formData.care_context !== 'Inpatient Admission' && pinkMissingRef.length > 0) {
      const names = pinkMissingRef.map((m) => m.drug_name || m.drug).join(', ')
      setError(`Reference No is required for pink medication(s): ${names}`)
      setActiveTab('medications')
      return
    }
    const doseIssues = Object.entries(medicationDoseWarnings)
      .map(([idx, preview]) => {
        const row = medications[Number(idx)]
        if (!row || !preview?.message) return null
        return {
          drugLabel: row.drug_name || row.drug,
          message: preview.message,
        }
      })
      .filter(Boolean) as PrescriptionDoseLimitIssue[]
    if (doseIssues.length > 0) {
      setDoseLimitConfirmIssues(doseIssues)
      setDoseLimitConfirmOpen(true)
      return
    }
    await performPrescriptionSubmit()
  }

  const performPrescriptionSubmit = async () => {
    try {
      setSubmitting(true)
      let successResult: { patient_visit: string; patient_medication_order: string } | undefined
      const headerStartDate = isEditing
        ? (formData.start_date || localDateInputValue())
        : localDateInputValue()
      
      if (initialCareContext === 'Patient Visit' && transferAdmission) {
        const result = await createVisitAndPrescriptionOnDischarge(
          transferAdmission,
          validMedications,
          formData.patient_encounter || undefined,
          true,
          doctorsSignature || undefined,
          transferOrderEntryNames,
        )
        const signedNote = isSignedEvidence ? ' (signed)' : ''
        toast.success(
          `Created visit ${result.patient_visit} and prescription ${result.patient_medication_order}${signedNote}`,
        )
        successResult = result
      } else if (isEditing && prescriptionData) {
        const payload: any = {
          name: prescriptionData.name,
          patient: selectedPatient!.name,
          care_context: formData.care_context,
          company: formData.company,
          start_date: headerStartDate,
          practitioner: formData.practitioner || undefined,
          medication_orders: validMedications,
        }
        if (formData.care_context === 'Patient Visit' && formData.patient_encounter) {
          payload.patient_encounter = formData.patient_encounter
        }
        if (formData.care_context === 'Inpatient Admission' && formData.inpatient_record) {
          payload.inpatient_record = formData.inpatient_record
        }
        payload.doctors_signature = doctorsSignature || ''

        await updatePrescription(payload)
        toast.success(
          isSignedEvidence ? 'Prescription updated and signed' : 'Prescription updated successfully',
        )
      } else {
        const payload: CreatePrescriptionData = {
          patient: selectedPatient!.name,
          care_context: formData.care_context,
          company: formData.company,
          start_date: headerStartDate,
          practitioner: formData.practitioner || undefined,
          medication_orders: validMedications,
        }
        if (formData.care_context === 'Patient Visit' && formData.patient_encounter) {
          payload.patient_encounter = formData.patient_encounter
        }
        if (formData.care_context === 'Inpatient Admission' && formData.inpatient_record) {
          payload.inpatient_record = formData.inpatient_record
        }
        if (doctorsSignature) {
          payload.doctors_signature = doctorsSignature
        }

        await createPrescription(payload)

        if (createNurseTasks) {
          const tasksToCreate: CreateNurseTaskData[] = validMedications.flatMap((med, idx) => {
            const shouldCreate = nurseTaskRows[idx] !== false
            if (!shouldCreate) return []
            const scheduledDatetime = med.date
              ? `${med.date} ${med.time ?? '08:00:00'}`
              : `${headerStartDate} 08:00:00`
            const task: CreateNurseTaskData = {
              patient: selectedPatient!.name,
              task_type: 'Medication Administration',
              scheduled_time: scheduledDatetime,
              description: `${med.drug_name || med.drug} — ${med.dosage}${med.instructions ? `\n${med.instructions}` : ''}`,
              medication: med.drug,
              dosage: med.dosage,
              route: med.route_of_administration || undefined,
              is_prn: med.is_prn ?? false,
              medication_type: med.medication_type || undefined,
            }
            return [task]
          })

          const createdMsg = isSignedEvidence
            ? 'Prescription created (signed)'
            : 'Prescription created (unsigned — sign before giving medicine)'
          if (tasksToCreate.length > 0) {
            try {
              const result = await bulkCreateNurseTasks(tasksToCreate)
              toast.success(
                `${createdMsg} · ${result.count} nurse task${result.count !== 1 ? 's' : ''} created`,
              )
            } catch {
              toast.success(createdMsg)
              toast.error('Prescription saved but some nurse tasks could not be created.')
            }
          } else {
            toast.success(createdMsg)
          }
        } else {
          toast.success(isSignedEvidence ? 'Prescription created (signed)' : 'Prescription created (unsigned — sign before giving medicine)')
        }
      }

      setDoseLimitConfirmOpen(false)
      setDoseLimitConfirmIssues([])
      onSuccess(successResult)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to ${isEditing ? 'update' : 'create'} prescription`
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const practitionerDisplay = formData.practitioner
    ? (practitioners.find((x) => x.name === formData.practitioner)?.label || formData.practitioner)
    : practQuery

  const isExpanded = (index: number) => expandedMedications.has(index)
  const shouldShowCollapse = medications.length >= 2
  const isIP = mode === 'IP'

  const modal = (
    <div
      className={CREATE_MODAL_OVERLAY}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={createModalShellClass('max-w-4xl w-full max-h-[90vh] min-h-[600px]')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <CreateModalHeader
          title={isEditing ? 'Edit Prescription' : 'Create Prescription'}
          icon={<Pill className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          onClose={onClose}
        />

        <div className="flex border-b border-slate-200 shrink-0 bg-slate-50">
          {(['details', 'medications', 'signature'] as TabId[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              {tab === 'medications'
                ? `Medications (${medications.length})`
                : tab === 'signature'
                  ? isSignedEvidence
                    ? 'Signature ✓'
                    : 'Signature'
                  : 'Details'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {error && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 shrink-0">
              {error}
            </div>
          )}

          <div className={`${CREATE_MODAL_BODY_GRADIENT} p-6`}>
            {/* ── DETAILS TAB ── */}
            {activeTab === 'details' && (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Patient <span className="text-red-500">*</span>
                  </label>
                  <Combobox
                    value={selectedPatient?.name || ''}
                    displayValue={selectedPatient ? (selectedPatient.patient_name || selectedPatient.name) : patientQuery}
                    placeholder="Search patient..."
                    options={patients.map((p) => ({ name: p.name, label: p.patient_name || p.name }))}
                    loading={loadingPatients}
                    onQueryChange={(q) => {
                      setPatientQuery(q)
                      setSelectedPatient(null)
                      if (q.length > 0) {
                        setLoadingPatients(true)
                        searchPatients(q, 20).then(setPatients).finally(() => setLoadingPatients(false))
                      }
                    }}
                    onOpen={() => {
                      if (patients.length === 0) {
                        setLoadingPatients(true)
                        fetchPatients(20, 0).then(setPatients).finally(() => setLoadingPatients(false))
                      }
                    }}
                    onSelect={(opt) => {
                      const p = patients.find((x) => x.name === opt.name)
                      if (p) {
                        setSelectedPatient(p)
                        setPatientQuery(p.patient_name || p.name)
                      }
                    }}
                    renderOption={(opt) => {
                      const p = patients.find((x) => x.name === opt.name)
                      return (
                        <div>
                          <div className="font-medium">{opt.label || opt.name}</div>
                          {p && (p.file_number || p.id_number) && (
                            <div className="text-xs text-slate-500 flex gap-x-3 mt-0.5">
                              {p.file_number && <span>File: {p.file_number}</span>}
                              {p.id_number && <span>ID: {p.id_number}</span>}
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Care Context
                    </label>
                    <select
                      value={formData.care_context}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          care_context: e.target.value as 'Patient Visit' | 'Inpatient Admission',
                          patient_encounter: '',
                          inpatient_record: '',
                        }))
                      }
                      disabled={Boolean(transferAdmission) || lockCareContextOnEdit}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <option value="Patient Visit">Patient Visit</option>
                      {!transferAdmission && <option value="Inpatient Admission">Inpatient Admission</option>}
                    </select>
                  </div>

                  {formData.care_context === 'Patient Visit' ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Patient Visit {!transferAdmission ? <span className="text-red-500">*</span> : null}
                      </label>
                      {transferAdmission ? (
                        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                          A discharge patient visit will be created automatically when you save, unless you link an
                          existing visit below.
                        </p>
                      ) : null}
                      <select
                        value={formData.patient_encounter}
                        onChange={(e) => setFormData((p) => ({ ...p, patient_encounter: e.target.value }))}
                        disabled={!!activeVisit || lockCareContextOnEdit}
                        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-slate-100 disabled:cursor-not-allowed ${transferAdmission ? 'mt-2' : ''}`}
                      >
                        <option value="">{transferAdmission ? 'Create new discharge visit on save' : 'Select visit...'}</option>
                        {displayVisits.map((v) => <option key={v.name} value={v.name}>{v.label || v.name}</option>)}
                      </select>
                      {lockCareContextOnEdit && formData.patient_encounter ? (
                        <p className="text-xs text-slate-400 mt-1">
                          Linked to discharge patient visit {formData.patient_encounter}
                        </p>
                      ) : null}
                      {activeVisit && !lockCareContextOnEdit ? (
                        <p className="text-xs text-slate-400 mt-1">Locked to the current visit</p>
                      ) : null}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Inpatient Admission <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.inpatient_record}
                        onChange={(e) => setFormData((p) => ({ ...p, inpatient_record: e.target.value }))}
                        disabled={!!activeAdmission}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
                      >
                        <option value="">Select admission...</option>
                        {admissions.map((a) => <option key={a.name} value={a.name}>{a.label || a.name}</option>)}
                      </select>
                      {activeAdmission && <p className="text-xs text-slate-400 mt-1">Locked to the current admission</p>}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Company <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.company}
                      onChange={(e) => setFormData((p) => ({ ...p, company: e.target.value }))}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      <option value="">Select company...</option>
                      {companies.map((c) => <option key={c.name} value={c.name}>{c.label || c.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Doctor Name</label>
                    <Combobox
                      value={formData.practitioner}
                      displayValue={practitionerDisplay}
                      placeholder="Search doctor..."
                      options={practitioners}
                      readOnly={practitionerLocked && !isEditing}
                      onQueryChange={(q) => {
                        setPractQuery(q)
                        setFormData((p) => ({ ...p, practitioner: '' }))
                        fetchHealthcarePractitioners(q || undefined).then(setPractitioners).catch(() => {})
                      }}
                      onOpen={() => {
                        fetchHealthcarePractitioners(practQuery || undefined).then(setPractitioners).catch(() => {})
                      }}
                      onSelect={(opt) => {
                        setFormData((p) => ({ ...p, practitioner: opt.name }))
                        setPractQuery(opt.label || opt.name)
                      }}
                      renderOption={(opt) => (
                        <div>
                          <div className="font-medium">{opt.label || opt.name}</div>
                          <div className="text-xs text-slate-500">{opt.name}</div>
                        </div>
                      )}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── MEDICATIONS TAB ── */}
            {activeTab === 'medications' && (
              <div className="space-y-4">
                <div className="flex justify-end items-center">
                  <button
                    type="button"
                    onClick={addMedicationRow}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-md hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add Medication
                  </button>
                </div>

                {formData.care_context === 'Inpatient Admission' && (
                  <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 flex items-center gap-2">
                    <input
                      id="create-nurse-tasks"
                      type="checkbox"
                      checked={createNurseTasks}
                      onChange={(e) => setCreateNurseTasks(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <label htmlFor="create-nurse-tasks" className="text-xs font-medium text-teal-800 cursor-pointer select-none">
                      Create a Nurse Task (Medication Administration) for each medication
                    </label>
                  </div>
                )}

                <div className="space-y-3">
                  {medications.map((row, index) => {
                    const stockLabel = medicationStock[index]
                      ? formatMedicationStockInline(medicationStock[index])
                      : null
                    const isStoppedRow = Boolean(String(row.reason_stopped || '').trim())
                    const collapsedDrugTitle = (
                      row.drug_name ||
                      row.drug ||
                      drugQueries[index] ||
                      ''
                    ).trim()
                    const rowKey = medicationRowKeysRef.current[index] || `med-fallback-${index}`
                    return (
                    <div
                      key={rowKey}
                      className={`rounded-lg border bg-white shadow-sm overflow-hidden transition-all ${
                        isStoppedRow
                          ? 'border-rose-300 ring-1 ring-rose-200'
                          : 'border-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleMedicationExpanded(index)}
                        disabled={!shouldShowCollapse}
                        className={`w-full flex items-center justify-between px-4 py-2.5 border-b transition-colors ${
                          isStoppedRow
                            ? 'bg-rose-50 border-rose-200'
                            : 'bg-slate-50 border-slate-200'
                        } ${
                          !shouldShowCollapse
                            ? 'cursor-default'
                            : 'cursor-pointer hover:bg-opacity-90'
                        }`}
                      >
                        <div className={`flex items-center gap-2 text-sm font-medium min-w-0 flex-wrap ${
                          isStoppedRow ? 'text-rose-900' : 'text-slate-700'
                        }`}>
                          <Pill className={`w-4 h-4 shrink-0 ${isStoppedRow ? 'text-rose-600' : 'text-primary'}`} />
                          <span className="shrink-0">Medication {index + 1}</span>
                          {isStoppedRow ? (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-rose-600 text-white">
                              Stopped
                            </span>
                          ) : null}
                          {collapsedDrugTitle ? (
                            <span className={`font-normal truncate ${isStoppedRow ? 'text-rose-700' : 'text-slate-400'}`}>
                              — {collapsedDrugTitle}
                            </span>
                          ) : null}
                          {stockLabel ? (
                            <span
                              className={`font-medium shrink-0 ${
                                medicationStock[index].level === 'out_of_stock'
                                  ? 'text-red-600'
                                  : 'text-amber-600'
                              }`}
                            >
                              {stockLabel}
                            </span>
                          ) : null}
                          {isPrnPrescriptionType(row.medication_type) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                              PRN
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeMedicationRow(index)
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          {shouldShowCollapse && (
                            <div className="text-slate-400">
                              {isExpanded(index) ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </div>
                          )}
                        </div>
                      </button>

                      {isStoppedRow ? (
                        <div className="px-4 py-2.5 space-y-0.5 bg-rose-50 border-b border-rose-200">
                          <p className="text-xs text-rose-800">
                            <span className="font-semibold uppercase tracking-wide">Reason stopped: </span>
                            {row.reason_stopped}
                          </p>
                          <p className="text-[11px] font-medium text-rose-700">
                            Warning: this medicine was stopped/discontinued. Remove this row if it should not be on
                            the discharge prescription.
                          </p>
                        </div>
                      ) : null}

                      {createNurseTasks && formData.care_context === 'Inpatient Admission' && !isStoppedRow && (
                        <div className="px-4 py-1.5 bg-teal-50 border-b border-teal-100 flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`nt-row-${index}`}
                            checked={nurseTaskRows[index] !== false}
                            onChange={(e) =>
                              setNurseTaskRows((prev) => ({ ...prev, [index]: e.target.checked }))
                            }
                            className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          <label
                            htmlFor={`nt-row-${index}`}
                            className="text-[11px] text-teal-700 cursor-pointer select-none"
                          >
                            Create nurse task for this medication
                          </label>
                        </div>
                      )}

                      {(isExpanded(index) || !shouldShowCollapse) && (
                        <div className="p-4 space-y-3 animate-in fade-in duration-200">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">
                              Drug <span className="text-red-500">*</span>
                            </label>
                            <Combobox
                              value={row.drug}
                              displayValue={drugQueries[index] ?? (row.drug ? (row.drug_name || row.drug) : '')}
                              placeholder="Search by commercial or scientific name..."
                              options={drugOptions[index] || []}
                              loading={drugLoading[index]}
                              onQueryChange={(q) => {
                                setDrugQueries((prev) => ({ ...prev, [index]: q }))
                                loadDrugOptions(index, q)
                              }}
                              onOpen={() => loadDrugOptions(index, drugQueries[index] || row.drug || '')}
                              onSelect={(opt) => {
                                void applyDrugSelection(index, opt)
                              }}
                              renderOption={(opt) => (
                                <div className="flex flex-col">
                                  <span>{opt.label || opt.name}</span>
                                  {opt.scientific_name && (
                                    <span className="text-xs text-slate-500 italic">{opt.scientific_name}</span>
                                  )}
                                </div>
                              )}
                            />
                            {row.drug && drugScientific[index] && (
                              <p className="mt-1 text-xs text-slate-500">
                                Scientific name: <span className="italic">{drugScientific[index]}</span>
                              </p>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Dosage <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={row.dosage}
                                onChange={(e) => updateMedicationRow(index, 'dosage', e.target.value)}
                                placeholder="45mg"
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              />
                              {checkingDoseRows[index] ? (
                                <p className="mt-1 text-xs text-slate-500">Checking dose limit…</p>
                              ) : (
                                <DoseLimitHint
                                  info={medicationDoseLimits[index] || null}
                                  loading={Boolean(loadingDoseLimits[index])}
                                  hasWarning={Boolean(medicationDoseWarnings[index]?.message)}
                                  warningMessage={medicationDoseWarnings[index]?.message}
                                  enteredDose={row.dosage}
                                />
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Unit of Measure
                              </label>
                              <Combobox
                                value={row.uom ?? ''}
                                displayValue={uomQueries[index] ?? row.uom ?? ''}
                                placeholder="Type or select unit of measure…"
                                options={uomOptions}
                                loading={loadingUom}
                                allowCustom={true}
                                onQueryChange={(q) => {
                                  setUomQueries((prev) => ({ ...prev, [index]: q }))
                                  searchUoms(q)
                                }}
                                onOpen={() => {
                                  if (uomOptions.length === 0) {
                                    searchUoms('')
                                  }
                                }}
                                onSelect={(opt) => {
                                  updateMedicationRow(index, 'uom', opt.name)
                                  setUomQueries((prev) => ({ ...prev, [index]: opt.label || opt.name }))
                                }}
                                onClear={() => {
                                  updateMedicationRow(index, 'uom', '')
                                  setUomQueries((prev) => ({ ...prev, [index]: '' }))
                                }}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              {isLongActingPrescriptionType(row.medication_type) ? (
                                <>
                                  <label className="block text-xs font-medium text-slate-600 mb-1">
                                    Long Acting Frequency
                                  </label>
                                  <Combobox
                                    value={row.long_acting_frequency ?? ''}
                                    displayValue={
                                      longActingFrequencyQueries[index] ??
                                      (row.long_acting_frequency
                                        ? longActingFrequencyOptions.find((f) => f.name === row.long_acting_frequency)?.label ||
                                          row.long_acting_frequency
                                        : '')
                                    }
                                    placeholder="Select long acting frequency..."
                                    options={longActingFrequencyOptions}
                                    loading={loadingLongActingFrequency}
                                    onCreateClick={() =>
                                      setCreateFreqModal({
                                        kind: 'long_acting',
                                        rowIndex: index,
                                        initialName: longActingFrequencyQueries[index] || '',
                                      })
                                    }
                                    onQueryChange={(q) => {
                                      setLongActingFrequencyQueries((prev) => ({ ...prev, [index]: q }))
                                      searchLongActingFrequencies(q)
                                    }}
                                    onOpen={() => {
                                      if (longActingFrequencyOptions.length === 0) {
                                        searchLongActingFrequencies('')
                                      }
                                    }}
                                    onSelect={(opt) => {
                                      updateMedicationRow(index, 'long_acting_frequency', opt.name)
                                      updateMedicationRow(index, 'patient_frequency', opt.name)
                                      setLongActingFrequencyQueries((prev) => ({
                                        ...prev,
                                        [index]: opt.label || opt.name,
                                      }))
                                      setFrequencyQueries((prev) => ({
                                        ...prev,
                                        [index]: opt.label || opt.name,
                                      }))
                                    }}
                                    onClear={() => {
                                      updateMedicationRow(index, 'long_acting_frequency', 'Weekly')
                                      setLongActingFrequencyQueries((prev) => ({ ...prev, [index]: '' }))
                                    }}
                                  />
                                  <p className="text-[11px] text-slate-500 mt-1">
                                    A Long Acting Medicine record will be created for scheduling and reminders.
                                  </p>
                                </>
                              ) : (
                                <>
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Frequency</label>
                                  <Combobox
                                    value={row.patient_frequency ?? ''}
                                    displayValue={
                                      frequencyQueries[index] ??
                                      (row.patient_frequency
                                        ? frequencyOptions.find((f) => f.name === row.patient_frequency)?.label ||
                                          row.patient_frequency
                                        : '')
                                    }
                                    placeholder="Type or select frequency..."
                                    options={frequencyOptions}
                                    loading={loadingFrequency}
                                    allowCustom={true}
                                    onCreateClick={() =>
                                      setCreateFreqModal({
                                        kind: 'regular',
                                        rowIndex: index,
                                        initialName: frequencyQueries[index] || '',
                                      })
                                    }
                                    onQueryChange={(q) => {
                                      setFrequencyQueries((prev) => ({ ...prev, [index]: q }))
                                      searchFrequencies(q)
                                    }}
                                    onOpen={() => {
                                      if (frequencyOptions.length === 0) {
                                        searchFrequencies('')
                                      }
                                    }}
                                    onSelect={(opt) => {
                                      updateMedicationRow(index, 'patient_frequency', opt.name)
                                      setFrequencyQueries((prev) => ({ ...prev, [index]: opt.label || opt.name }))
                                    }}
                                    onClear={() => {
                                      updateMedicationRow(index, 'patient_frequency', '')
                                      setFrequencyQueries((prev) => ({ ...prev, [index]: '' }))
                                    }}
                                  />
                                </>
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Route of Administration</label>
                              <Combobox
                                value={row.route_of_administration ?? ''}
                                displayValue={routeQueries[index] ?? (row.route_of_administration ? (routeOptions.find((r) => r.name === row.route_of_administration)?.label || row.route_of_administration) : '')}
                                placeholder="Type or select route..."
                                options={routeOptions}
                                loading={loadingRoute}
                                allowCustom={true}
                                onQueryChange={(q) => {
                                  setRouteQueries((prev) => ({ ...prev, [index]: q }))
                                  searchRoutes(q)
                                }}
                                onOpen={() => {
                                  if (routeOptions.length === 0) {
                                    searchRoutes('')
                                  }
                                }}
                                onSelect={(opt) => {
                                  updateMedicationRow(index, 'route_of_administration', opt.name)
                                  setRouteQueries((prev) => ({ ...prev, [index]: opt.label || opt.name }))
                                }}
                                onClear={() => {
                                  updateMedicationRow(index, 'route_of_administration', '')
                                  setRouteQueries((prev) => ({ ...prev, [index]: '' }))
                                }}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Dosage Form
                              </label>
                              <select
                                value={row.dosage_form}
                                onChange={(e) => updateMedicationRow(index, 'dosage_form', e.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              >
                                <option value="">Select...</option>
                                {dosageForms.map((df) => (
                                  <option key={df.name} value={df.name}>
                                    {df.label || df.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Prescription Type <span className="text-red-500">*</span>
                              </label>
                              <select
                                value={row.medication_type || ''}
                                onChange={(e) => updateMedicationRow(index, 'medication_type', e.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              >
                                <option value="">Select...</option>
                                {PRESCRIPTION_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className={`grid ${isIP ? 'grid-cols-2' : 'grid-cols-3'} gap-3`}>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Start Date <span className="text-red-500">*</span>
                              </label>
                              <DateFilterInput
                                value={row.date ?? formData.start_date}
                                onChange={(e) => updateMedicationRow(index, 'date', e.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
                              <DateFilterInput
                                value={row.end_date ?? ''}
                                onChange={(e) => updateMedicationRow(index, 'end_date', e.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              />
                            </div>
                            {!isIP && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Days</label>
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={row.no_of_days ?? ''}
                                  onChange={(e) => updateMedicationRow(index, 'no_of_days', e.target.value === '' ? '' : Number(e.target.value))}
                                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                                />
                              </div>
                            )}
                          </div>
                          {!isIP && (
                            <p className="text-[11px] text-slate-500">Start + End Date → Days; or Start Date + Days → End Date. Clear End Date or Days to clear both.</p>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-2">Is Pink</label>
                              <label className="inline-flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!row.is_pink}
                                  onChange={(e) => {
                                    const checked = e.target.checked
                                    updateMedicationRow(index, 'is_pink', checked)
                                    if (!checked) updateMedicationRow(index, 'reference_no', '')
                                  }}
                                  className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                <span className="text-sm text-slate-600">Yes</span>
                              </label>
                            </div>
                            {!!row.is_pink && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">
                                  Reference No
                                  {formData.care_context !== 'Inpatient Admission' ? (
                                    <span className="text-red-500"> *</span>
                                  ) : (
                                    <span className="text-slate-400 font-normal"> (optional)</span>
                                  )}
                                </label>
                                <input
                                  type="text"
                                  value={row.reference_no ?? ''}
                                  onChange={(e) => updateMedicationRow(index, 'reference_no', e.target.value)}
                                  placeholder={
                                    formData.care_context === 'Inpatient Admission'
                                      ? 'Optional for inpatient'
                                      : 'Enter reference number'
                                  }
                                  required={formData.care_context !== 'Inpatient Admission'}
                                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                                />
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Instructions</label>
                            <textarea
                              value={row.instructions ?? ''}
                              onChange={(e) => updateMedicationRow(index, 'instructions', e.target.value)}
                              placeholder="Add any special instructions or notes for this medication..."
                              rows={3}
                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )})}

                  {medications.length === 0 && (
                    <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                      <Pill className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">NO MEDICATIONS ADDED YET</p>
                      <button
                        type="button"
                        onClick={addMedicationRow}
                        className="mt-3 text-sm text-primary hover:underline"
                      >
                        Add first medication
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'signature' && (
              <div className="space-y-4 max-w-lg">
                <p className="text-sm text-slate-600">
                  Draw a signature or upload a file into the same signature field. Either marks the
                  prescription as <strong>Signed</strong>. Without either it stays{' '}
                  <strong>Unsigned</strong> until signed later.
                  {doctorsSignature ? (
                    <> If the selected doctor already has a signature on their practitioner profile, it is filled in automatically.</>
                  ) : null}
                </p>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <PenLine className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-medium text-slate-600">Doctor&apos;s signature</span>
                  </div>
                  <SignaturePad
                    onSave={handleDoctorSignatureSave}
                    onClear={() => setDoctorsSignature(null)}
                    existingUrl={attachFileDisplayUrl(doctorsSignature)}
                    uploading={signatureUploading || attachmentUploading}
                  />
                  {signatureUploading && (
                    <p className="text-xs text-slate-500 text-center mt-2">Uploading signature…</p>
                  )}
                  <p className="text-xs text-slate-400 leading-relaxed mt-3">
                    Draw your signature, then tap <strong>Save signature</strong>. Stored on Doctors
                    Signature.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <span className="text-xs font-medium text-slate-600">Or upload signature file</span>
                  <p className="text-xs text-slate-500 mt-1 mb-3">
                    Alternative to drawing — uploads into the same Doctors Signature field.
                  </p>
                  {doctorsSignature ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={attachFileDisplayUrl(doctorsSignature)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline truncate max-w-[16rem]"
                      >
                        {doctorsSignature.split('/').pop() || 'View signature'}
                      </a>
                      <button
                        type="button"
                        onClick={() => setDoctorsSignature(null)}
                        className="text-xs text-slate-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      disabled={attachmentUploading || signatureUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        void handleSignatureAttachment(file)
                        e.target.value = ''
                      }}
                      className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                    />
                  )}
                  {attachmentUploading && (
                    <p className="text-xs text-slate-500 mt-2">Uploading into signature…</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <CreateModalFooter>
            <button type="button" onClick={onClose} className={CM_BTN_CANCEL}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} className={CM_BTN_PRIMARY}>
              {submitting ? 'Saving…' : 'Save Prescription'}
            </button>
          </CreateModalFooter>
        </form>
      </div>

      {createFreqModal && (
        <CreateFrequencyMiniModal
          kind={createFreqModal.kind}
          initialName={createFreqModal.initialName}
          onClose={() => setCreateFreqModal(null)}
          onCreated={(opt) => {
            const { kind, rowIndex } = createFreqModal
            if (kind === 'long_acting') {
              setLongActingFrequencyOptions((prev) => {
                if (prev.some((p) => p.name === opt.name)) return prev
                return [...prev, opt]
              })
              setFrequencyOptions((prev) => {
                if (prev.some((p) => p.name === opt.name)) return prev
                return [...prev, opt]
              })
              updateMedicationRow(rowIndex, 'long_acting_frequency', opt.name)
              setLongActingFrequencyQueries((prev) => ({
                ...prev,
                [rowIndex]: opt.label || opt.name,
              }))
              updateMedicationRow(rowIndex, 'patient_frequency', opt.name)
              setFrequencyQueries((prev) => ({
                ...prev,
                [rowIndex]: opt.label || opt.name,
              }))
            } else {
              setFrequencyOptions((prev) => {
                if (prev.some((p) => p.name === opt.name)) return prev
                return [...prev, opt]
              })
              updateMedicationRow(rowIndex, 'patient_frequency', opt.name)
              setFrequencyQueries((prev) => ({
                ...prev,
                [rowIndex]: opt.label || opt.name,
              }))
            }
            setCreateFreqModal(null)
          }}
        />
      )}
      <PrescriptionDoseLimitConfirmModal
        open={doseLimitConfirmOpen}
        issues={doseLimitConfirmIssues}
        loading={submitting}
        confirmLabel={isEditing ? 'Update anyway' : 'Save anyway'}
        onClose={() => {
          if (submitting) return
          setDoseLimitConfirmOpen(false)
          setDoseLimitConfirmIssues([])
          setActiveTab('medications')
        }}
        onConfirm={() => void performPrescriptionSubmit()}
      />
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}