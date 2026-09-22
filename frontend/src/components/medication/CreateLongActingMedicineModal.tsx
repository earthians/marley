import { useState, useEffect, useRef } from 'react'
import {
  CREATE_MODAL_OVERLAY,
  CreateModalHeader,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { apiRequest } from '../../services/apiClient'
import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'
import {
  fetchHealthcarePractitioners,
  fetchCompanies,
  resolveDefaultCompany,
  fetchItems,
  fetchDosageForms,
  fetchPrescriptionFrequencies,
  type LinkFieldOption,
} from '../../services/common'
import {
  LOCKED_PRACTITIONER_INPUT_CLASS,
  useLockedLinkedPractitioner,
} from '../../hooks/useLockedLinkedPractitioner'
import type { LongActingFrequency, MedicationOrderEntry } from '../../services/prescriptions'
import { LONG_ACTING_FREQUENCY_OPTIONS, fetchPrescriptions } from '../../services/prescriptions'
import { toast } from '../../hooks/useToast'
import { X, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { DateFilterInput } from '../ui/DateFilterInput'

interface CreateLongActingMedicineModalProps {
  initialPatient?: string
  onClose: () => void
  onSuccess?: () => void
}

interface MedicationItem {
  drug: string
  drug_name?: string
  dosage: string | number
  dosage_form: string
  patient_frequency: string
  date: string
  time: string
  instructions?: string
  qty_per_cycle?: number
  is_active?: boolean
  [key: string]: any
}

type TabId = 'details' | 'medications'

// Reusable Combobox
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
  locked?: boolean
  renderOption?: (opt: LinkFieldOption) => React.ReactNode
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
  locked,
  renderOption,
  onClear,
}: ComboboxProps) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Capture phase: the modal shell stops mousedown propagation (React portals
    // listen on document.body), so the dropdown must observe the event first.
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          type="text"
          value={displayValue}
          readOnly={locked}
          onChange={(e) => {
            if (locked) return
            onQueryChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (locked) return
            setOpen(true)
            onOpen()
          }}
          placeholder={placeholder}
          required={required}
          title={locked ? 'Locked to your linked practitioner' : undefined}
          className={
            locked
              ? LOCKED_PRACTITIONER_INPUT_CLASS
              : 'w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'
          }
        />
        {!locked ? (
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
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
      {open && !locked && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-52 overflow-auto">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-500">Loading...</div>
          ) : options.length ? (
            options.map((opt) => (
              <button
                key={opt.name}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(opt)
                  setOpen(false)
                }}
              >
                {renderOption ? renderOption(opt) : (opt.label || opt.name)}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">NO RESULTS FOUND</div>
          )}
        </div>
      )}
    </div>
  )
}

export const CreateLongActingMedicineModal = ({
  initialPatient,
  onClose,
  onSuccess,
}: CreateLongActingMedicineModalProps) => {
  const [activeTab, setActiveTab] = useState<TabId>('details')
  const [expandedMedications, setExpandedMedications] = useState<Set<number>>(new Set([0]))

  // Patient selection
  const [patientQuery, setPatientQuery] = useState('')
  // Prescription medicine lines for the selected patient — dosage auto-fills from
  // the prescription and stays read-only (nurse-department rule).
  const [rxEntries, setRxEntries] = useState<MedicationOrderEntry[]>([])
  const [selectedPatient, setSelectedPatient] = useState<PatientListItem | null>(null)
  const [patients, setPatients] = useState<PatientListItem[]>([])
  const [loadingPatients, setLoadingPatients] = useState(false)

  // Form data
  const [formData, setFormData] = useState({
    frequency: '' as LongActingFrequency | '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    next_run_date: '',
    practitioner: '',
    company: '',
    status: 'Active',
  })

  // Medications
  const [medications, setMedications] = useState<MedicationItem[]>([
    {
      drug: '',
      drug_name: '',
      dosage: '',
      dosage_form: '',
      patient_frequency: '',
      date: new Date().toISOString().split('T')[0],
      time: '08:00',
      instructions: '',
      qty_per_cycle: 1,
      is_active: true,
    },
  ])

  // Drug options per row
  const [drugQueries, setDrugQueries] = useState<Record<number, string>>({})
  const [drugOptions, setDrugOptions] = useState<Record<number, LinkFieldOption[]>>({})
  const [drugLoading, setDrugLoading] = useState<Record<number, boolean>>({})

  // Dropdown options
  const [practitioners, setPractitioners] = useState<LinkFieldOption[]>([])
  const [companies, setCompanies] = useState<LinkFieldOption[]>([])
  const [dosageForms, setDosageForms] = useState<LinkFieldOption[]>([])
  const [frequencies, setFrequencies] = useState<LinkFieldOption[]>([])
  const [practQuery, setPractQuery] = useState('')
  const {
    locked: practitionerLocked,
    practitionerId: linkedPractitionerId,
    practitionerLabel: linkedPractitionerLabel,
  } = useLockedLinkedPractitioner()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize form data
  useEffect(() => {
    if (initialPatient && !selectedPatient) {
      setPatientQuery(initialPatient)
      fetchPatients(20, 0, initialPatient)
        .then((list) => {
          const match = list.find((p) => p.name === initialPatient)
          setSelectedPatient(match || { name: initialPatient, patient_name: initialPatient })
        })
        .catch(() => setSelectedPatient({ name: initialPatient, patient_name: initialPatient }))
    }
  }, [initialPatient])

  // Prescription lines for dosage auto-fill (latest prescriptions for the patient).
  useEffect(() => {
    if (!selectedPatient?.name) {
      setRxEntries([])
      return
    }
    let cancelled = false
    fetchPrescriptions(20, 0, { patient: selectedPatient.name })
      .then((rxs) => {
        if (cancelled) return
        setRxEntries(rxs.flatMap((p) => p.medication_orders || []))
      })
      .catch(() => {
        if (!cancelled) setRxEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedPatient?.name])

  // Load dropdown options
  useEffect(() => {
    fetchHealthcarePractitioners().then(setPractitioners).catch(() => setPractitioners([]))
    fetchCompanies().then(setCompanies).catch(() => setCompanies([]))
    fetchDosageForms().then(setDosageForms).catch(() => setDosageForms([]))
    fetchPrescriptionFrequencies().then(setFrequencies).catch(() => setFrequencies([]))
  }, [])

  useEffect(() => {
    if (!linkedPractitionerId) return
    setFormData((prev) =>
      prev.practitioner ? prev : { ...prev, practitioner: linkedPractitionerId },
    )
    setPractQuery((q) => q.trim() || linkedPractitionerLabel || linkedPractitionerId)
  }, [linkedPractitionerId, linkedPractitionerLabel])

  // Default company: first in list (user can change)
  useEffect(() => {
    if (!formData.company && companies.length) {
      const company = resolveDefaultCompany(companies)
      if (company) setFormData((p) => ({ ...p, company }))
    }
  }, [companies, formData.company])

  const loadDrugOptions = async (index: number, query: string) => {
    if (!query || query.length < 1) {
      setDrugOptions((prev) => ({ ...prev, [index]: [] }))
      return
    }
    setDrugLoading((prev) => ({ ...prev, [index]: true }))
    try {
      const opts = await fetchItems(query)
      setDrugOptions((prev) => ({ ...prev, [index]: opts }))
    } catch {
      setDrugOptions((prev) => ({ ...prev, [index]: [] }))
    } finally {
      setDrugLoading((prev) => ({ ...prev, [index]: false }))
    }
  }

  const addMedicationRow = () => {
    const newIndex = medications.length
    setMedications((prev) => [
      ...prev,
      {
        drug: '',
        drug_name: '',
        dosage: '',
        dosage_form: '',
        patient_frequency: '',
        date: formData.start_date,
        time: '08:00',
        instructions: '',
        qty_per_cycle: 1,
        is_active: true,
      },
    ])
    if (newIndex >= 1) {
      setExpandedMedications(new Set([newIndex]))
    }
  }

  const removeMedicationRow = (index: number) => {
    setMedications((prev) => prev.filter((_, i) => i !== index))
    setDrugQueries((prev) => {
      const n = { ...prev }
      delete n[index]
      return n
    })
    setDrugOptions((prev) => {
      const n = { ...prev }
      delete n[index]
      return n
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

  const updateMedicationRow = (index: number, field: keyof MedicationItem, value: any) => {
    setMedications((prev) => {
      const next = [...prev]
      if (next[index]) {
        next[index] = { ...next[index], [field]: value }
      }
      return next
    })
  }

  const validMedications = medications.filter((m) => m.drug && m.dosage && m.dosage_form && m.date && m.time)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedPatient) {
      setError('Please select a patient')
      setActiveTab('details')
      return
    }
    if (!formData.frequency) {
      setError('Please select a frequency')
      setActiveTab('details')
      return
    }
    if (!formData.start_date) {
      setError('Please set start date')
      setActiveTab('details')
      return
    }
    if (validMedications.length === 0) {
      setError('Please add at least one medication with Drug, Dosage, Dosage Form, Date and Time')
      setActiveTab('medications')
      return
    }

    try {
      setSubmitting(true)
      await apiRequest('/api/resource/Long%20Acting%20Medicine', {
        method: 'POST',
        body: JSON.stringify({
          patient: selectedPatient.name,
          patient_name: selectedPatient.patient_name || selectedPatient.name,
          frequency: formData.frequency,
          start_date: formData.start_date,
          end_date: formData.end_date || undefined,
          next_run_date: formData.next_run_date || formData.start_date || undefined,
          practitioner: formData.practitioner || undefined,
          company: formData.company || undefined,
          status: formData.status,
          medications: validMedications.map((m) => ({
            drug: m.drug,
            drug_name: m.drug_name,
            dosage: m.dosage,
            dosage_form: m.dosage_form,
            patient_frequency: m.patient_frequency,
            date: m.date,
            time: m.time,
            instructions: m.instructions,
            qty_per_cycle: m.qty_per_cycle,
            is_active: m.is_active,
          })),
        }),
      })
      toast.success('Long Acting Medicine created')
      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create Long Acting Medicine'
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const practitionerDisplay = formData.practitioner
    ? practitioners.find((x) => x.name === formData.practitioner)?.label || formData.practitioner
    : practQuery

  const isExpanded = (index: number) => expandedMedications.has(index)
  const shouldShowCollapse = medications.length >= 2

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-4xl w-full max-h-[90vh]')}>
        {/* Header */}
        <CreateModalHeader title="Create Long Acting Medicine" onClose={onClose} />


        {/* Tabs */}
        <div className="flex border-b border-slate-200 shrink-0 bg-slate-50">
          {(['details', 'medications'] as TabId[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? 'border-primary text-primary bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              {tab === 'medications' ? `Medications (${validMedications.length})` : 'Details'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {error && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 shrink-0">
              {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6">
            {/* ── DETAILS TAB ── */}
            {activeTab === 'details' && (
              <div className="space-y-5">
                {/* Row 1: Patient (full width) */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Patient <span className="text-red-500">*</span>
                  </label>
                  <Combobox
                    value={selectedPatient?.name || ''}
                    displayValue={
                      selectedPatient
                        ? selectedPatient.patient_name || selectedPatient.name
                        : patientQuery
                    }
                    placeholder="Search patient..."
                    options={patients.map((p) => ({
                      name: p.name,
                      label: p.patient_name || p.name,
                    }))}
                    loading={loadingPatients}
                    onQueryChange={(q) => {
                      setPatientQuery(q)
                      setSelectedPatient(null)
                      if (q.length > 0) {
                        setLoadingPatients(true)
                        searchPatients(q, 20)
                          .then(setPatients)
                          .finally(() => setLoadingPatients(false))
                      }
                    }}
                    onOpen={() => {
                      if (patients.length === 0) {
                        setLoadingPatients(true)
                        fetchPatients(20, 0)
                          .then(setPatients)
                          .finally(() => setLoadingPatients(false))
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

                {/* Row 2: Frequency + Start Date (2 fields) */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Frequency <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.frequency}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          frequency: e.target.value as LongActingFrequency | '',
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      <option value="">Select frequency...</option>
                      {LONG_ACTING_FREQUENCY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Start Date <span className="text-red-500">*</span>
                    </label>
                    <DateFilterInput
                      value={formData.start_date}
                      onChange={(e) => setFormData((p) => ({ ...p, start_date: e.target.value }))}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    />
                  </div>
                </div>

                {/* Row 3: End Date + Next Run Date (2 fields) */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      End Date
                    </label>
                    <DateFilterInput
                      value={formData.end_date}
                      onChange={(e) => setFormData((p) => ({ ...p, end_date: e.target.value }))}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Next Run Date
                    </label>
                    <DateFilterInput
                      value={formData.next_run_date}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, next_run_date: e.target.value }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Leave blank to use start date (first dose due same day).
                    </p>
                  </div>
                </div>

                {/* Row 4: Practitioner + Company (2 fields) */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Practitioner
                    </label>
                    <Combobox
                      value={formData.practitioner}
                      displayValue={practitionerDisplay}
                      placeholder="Search doctor..."
                      options={practitioners}
                      locked={practitionerLocked}
                      onQueryChange={(q) => {
                        setPractQuery(q)
                        setFormData((p) => ({ ...p, practitioner: '' }))
                      }}
                      onOpen={() => {}}
                      onSelect={(opt) => {
                        setFormData((p) => ({ ...p, practitioner: opt.name }))
                        setPractQuery(opt.label || opt.name)
                      }}
                      onClear={() => {
                        setFormData((p) => ({ ...p, practitioner: '' }))
                        setPractQuery('')
                      }}
                      renderOption={(opt) => (
                        <div>
                          <div className="font-medium">{opt.label || opt.name}</div>
                          <div className="text-xs text-slate-500">{opt.name}</div>
                        </div>
                      )}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Company
                    </label>
                    <select
                      value={formData.company}
                      onChange={(e) => setFormData((p) => ({ ...p, company: e.target.value }))}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      <option value="">Select company...</option>
                      {companies.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.label || c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 5: Status (single field) */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData((p) => ({ ...p, status: e.target.value }))}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      <option value="Active">Active</option>
                      <option value="Paused">Paused</option>
                      <option value="Completed">Completed</option>
                      <option value="Draft">Draft</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ── MEDICATIONS TAB ── */}
            {activeTab === 'medications' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <p className="text-sm text-slate-500">
                    Fill in Drug, Dosage, Dosage Form, Date and Time for each medication.
                  </p>
                  <button
                    type="button"
                    onClick={addMedicationRow}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-md hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add Medication
                  </button>
                </div>

                <div className="space-y-3">
                  {medications.map((row, index) => (
                    <div
                      key={index}
                      className="border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden transition-all"
                    >
                      {/* Card header */}
                      <button
                        type="button"
                        onClick={() => toggleMedicationExpanded(index)}
                        disabled={!shouldShowCollapse}
                        className={`w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition-colors ${
                          !shouldShowCollapse ? 'cursor-default' : 'cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <span>Medication {index + 1}</span>
                          {row.drug && (
                            <span className="text-slate-400 font-normal">
                              — {drugQueries[index] || row.drug_name || row.drug}
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

                      {/* Collapsible content */}
                      {(isExpanded(index) || !shouldShowCollapse) && (
                        <div className="p-4 space-y-3 animate-in fade-in duration-200">
                          {/* Row A: Drug + Dosage (2 fields) */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Drug <span className="text-red-500">*</span>
                              </label>
                              <Combobox
                                value={row.drug}
                                displayValue={
                                  drugQueries[index] ??
                                  (row.drug ? row.drug_name || row.drug : '')
                                }
                                placeholder="Search drug..."
                                options={drugOptions[index] || []}
                                loading={drugLoading[index]}
                                onQueryChange={(q) => {
                                  setDrugQueries((prev) => ({ ...prev, [index]: q }))
                                  loadDrugOptions(index, q)
                                }}
                                onOpen={() =>
                                  loadDrugOptions(index, drugQueries[index] || row.drug || '')
                                }
                                onSelect={(opt) => {
                                  updateMedicationRow(index, 'drug', opt.name)
                                  updateMedicationRow(index, 'drug_name', opt.label || opt.name)
                                  const rx = rxEntries.find((e) => e.drug === opt.name)
                                  if (rx) {
                                    updateMedicationRow(index, 'dosage', rx.dosage || '')
                                    if (rx.dosage_form) updateMedicationRow(index, 'dosage_form', rx.dosage_form)
                                    if (rx.patient_frequency) updateMedicationRow(index, 'patient_frequency', rx.patient_frequency)
                                  }
                                  setDrugQueries((prev) => ({
                                    ...prev,
                                    [index]: opt.label || opt.name,
                                  }))
                                  setDrugOptions((prev) => ({ ...prev, [index]: [] }))
                                }}
                                onClear={() => {
                                  updateMedicationRow(index, 'drug', '')
                                  updateMedicationRow(index, 'drug_name', '')
                                  setDrugQueries((prev) => ({ ...prev, [index]: '' }))
                                }}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Dosage <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={row.dosage}
                                readOnly={rxEntries.some((e) => e.drug === row.drug)}
                                onChange={(e) =>
                                  updateMedicationRow(index, 'dosage', e.target.value)
                                }
                                placeholder="e.g. 1-0-1"
                                title={rxEntries.some((e) => e.drug === row.drug) ? 'Dosage comes from the prescription' : undefined}
                                className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${rxEntries.some((e) => e.drug === row.drug) ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white'}`}
                              />
                            </div>
                          </div>

                          {/* Row B: Dosage Form + Patient Frequency (2 fields) */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Dosage Form <span className="text-red-500">*</span>
                              </label>
                              <select
                                value={row.dosage_form}
                                onChange={(e) =>
                                  updateMedicationRow(index, 'dosage_form', e.target.value)
                                }
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
                                Frequency
                              </label>
                              <Combobox
                                value={row.patient_frequency ?? ''}
                                displayValue={
                                  row.patient_frequency
                                    ? frequencies.find((f) => f.name === row.patient_frequency)
                                        ?.label || row.patient_frequency
                                    : ''
                                }
                                placeholder="Select..."
                                options={frequencies}
                                onQueryChange={(q) => {
                                  if (!q) {
                                    updateMedicationRow(index, 'patient_frequency', '')
                                  }
                                }}
                                onOpen={() => {}}
                                onSelect={(opt) =>
                                  updateMedicationRow(index, 'patient_frequency', opt.name)
                                }
                                onClear={() => updateMedicationRow(index, 'patient_frequency', '')}
                              />
                            </div>
                          </div>

                          {/* Row C: Date + Time (2 fields) */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Date <span className="text-red-500">*</span>
                              </label>
                              <DateFilterInput
                                value={row.date}
                                onChange={(e) =>
                                  updateMedicationRow(index, 'date', e.target.value)
                                }
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Time <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="time"
                                value={row.time}
                                onChange={(e) =>
                                  updateMedicationRow(index, 'time', e.target.value)
                                }
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              />
                            </div>
                          </div>

                          {/* Row D: Instructions + Qty (2 fields) */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Instructions
                              </label>
                              <input
                                type="text"
                                value={row.instructions || ''}
                                onChange={(e) =>
                                  updateMedicationRow(index, 'instructions', e.target.value)
                                }
                                placeholder="Special instructions..."
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Qty per Cycle
                              </label>
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={row.qty_per_cycle || 1}
                                onChange={(e) =>
                                  updateMedicationRow(
                                    index,
                                    'qty_per_cycle',
                                    parseInt(e.target.value) || 1
                                  )
                                }
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              />
                            </div>
                          </div>

                          {/* Row E: Is Active (checkbox) */}
                          <div className="flex items-center">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.is_active ?? true}
                                onChange={(e) =>
                                  updateMedicationRow(index, 'is_active', e.target.checked)
                                }
                                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                              />
                              <span className="text-xs font-medium text-slate-600">
                                Active
                              </span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {medications.length === 0 && (
                    <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                      <p className="text-sm mb-3">NO MEDICATIONS ADDED YET</p>
                      <button
                        type="button"
                        onClick={addMedicationRow}
                        className="text-sm text-primary hover:underline"
                      >
                        Add first medication
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 px-6 py-4 border-t border-slate-200 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}