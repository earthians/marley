import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Pencil, X } from 'lucide-react'
import { toast } from '../../hooks/useToast'
import { fetchLongActingFrequencies, fetchStandardUoms, type LinkFieldOption } from '../../services/common'
import {
  fetchLongActingMedicine,
  formatLongActingDose,
  updateLongActingMedicine,
  type LongActingMedicineRow,
  type LongActingMedicineUpdateValues,
} from '../../services/longActingMedicine'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_BODY_GRADIENT,
  CREATE_MODAL_OVERLAY,
  MODAL_FIELD_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_SECTION_CLASS,
  MODAL_SECTION_TITLE_CLASS,
  MODAL_TEXTAREA_CLASS,
  CreateModalFooter,
  CreateModalHeader,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'

const STATUS_OPTIONS = ['Draft', 'Active', 'Inactive', 'Paused', 'Completed'] as const

const INJECTION_SIDE_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'LT', label: 'Left (L)' },
  { value: 'RT', label: 'Right (R)' },
] as const

/**
 * Searchable Unit of Measure picker — same behaviour as the prescription
 * Dosage / Unit of Measure field (async search + medical-only filter).
 * Clearing the input keeps the unit blank, which means "use prescribed unit".
 */
const DoseUomCombobox = ({
  value,
  inputId,
  options,
  loading,
  disabled,
  onChange,
  onSearch,
}: {
  value: string
  inputId?: string
  options: LinkFieldOption[]
  loading?: boolean
  disabled?: boolean
  onChange: (uom: string) => void
  onSearch: (query: string) => void
}) => {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Capture phase so mousedown is still seen when a parent panel stops propagation.
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [])

  // Only units returned by the medical-only UOM API are offered here.
  const choices = options

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            onSearch(e.target.value)
          }}
          onFocus={() => {
            setOpen(true)
            onSearch('')
          }}
          placeholder="Use prescribed unit"
          disabled={disabled}
          className={
            linkComboboxInputWithClearClass +
            (disabled ? ' !bg-slate-100 !text-slate-500' : '')
          }
        />
        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setQuery('')
                onChange('')
                setOpen(false)
              }}
              className="p-0.5 text-slate-400 transition-colors hover:text-slate-600"
              title="Use prescribed unit"
            >
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
          ) : choices.length ? (
            choices.map((opt) => (
              <button
                key={opt.name}
                type="button"
                className={linkComboboxOptionClassCompact}
                onClick={() => {
                  setQuery(opt.label || opt.name)
                  onChange(opt.name)
                  setOpen(false)
                }}
              >
                {opt.label || opt.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">
              {query ? 'No matches' : 'Type to search...'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface DoseFormRow {
  /** Subscription Medication Plan Item row name. */
  name: string
  label: string
  /** Unit of Measure stored on the plan row; blank falls back to the prescription / Item. */
  uom: string
  dosage: string
}

interface EditFormState {
  frequency: string
  start_date: string
  end_date: string
  next_run_date: string
  status: string
  injection_given_on: string
  remarks: string
  doctors_remark: string
  medications: DoseFormRow[]
}

const EMPTY_FORM: EditFormState = {
  frequency: '',
  start_date: '',
  end_date: '',
  next_run_date: '',
  status: 'Active',
  injection_given_on: '',
  remarks: '',
  doctors_remark: '',
  medications: [],
}

/** Plan-item doses stored on the Long Acting Medicine (copied from its prescription). */
function doseRowsFromRecord(row: LongActingMedicineRow): DoseFormRow[] {
  return (row.medications || [])
    .filter((med) => Boolean(med.name))
    .map((med) => ({
      name: String(med.name),
      label:
        med.drug_name ||
        med.old_medication_name ||
        row.medication_label ||
        'Medication',
      uom: med.uom || row.default_uom || '',
      dosage: med.dosage == null || med.dosage === '' ? '' : String(med.dosage),
    }))
}

function formFromRow(row: LongActingMedicineRow): EditFormState {
  return {
    frequency: row.frequency || '',
    start_date: row.start_date || '',
    end_date: row.end_date || '',
    next_run_date: row.next_run_date || '',
    status: row.status || 'Active',
    injection_given_on: row.injection_given_on || '',
    remarks: row.remarks || '',
    doctors_remark: row.doctors_remark || '',
    medications: doseRowsFromRecord(row),
  }
}

interface EditLongActingMedicineModalProps {
  name: string
  /** List row — used for instant paint while the full record loads. */
  initialRow?: LongActingMedicineRow | null
  onClose: () => void
  onSaved?: (updated: LongActingMedicineRow) => void
}

export const EditLongActingMedicineModal = ({
  name,
  initialRow,
  onClose,
  onSaved,
}: EditLongActingMedicineModalProps) => {
  const [form, setForm] = useState<EditFormState>(() => (initialRow ? formFromRow(initialRow) : EMPTY_FORM))
  const [record, setRecord] = useState<LongActingMedicineRow | null>(initialRow ?? null)
  const [frequencyOptions, setFrequencyOptions] = useState<LinkFieldOption[]>([])
  const [uomOptions, setUomOptions] = useState<LinkFieldOption[]>([])
  const [uomLoading, setUomLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = <K extends keyof EditFormState>(key: K, value: EditFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const updateMedication = (index: number, patch: Partial<Pick<DoseFormRow, 'dosage' | 'uom'>>) => {
    setForm((prev) => ({
      ...prev,
      medications: prev.medications.map((med, i) =>
        i === index ? { ...med, ...patch } : med,
      ),
    }))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [doc, frequencies, uoms] = await Promise.all([
        fetchLongActingMedicine(name),
        fetchLongActingFrequencies().catch(() => [] as LinkFieldOption[]),
        fetchStandardUoms(undefined, { medicalOnly: true }).catch(() => [] as LinkFieldOption[]),
      ])
      setRecord(doc)
      setForm(formFromRow(doc))
      setFrequencyOptions(frequencies)
      setUomOptions(uoms)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load long acting medicine')
    } finally {
      setLoading(false)
    }
  }, [name])

  useEffect(() => {
    load()
  }, [load])

  /** Same medical-only UOM search used by the prescription Dosage / Unit field. */
  const searchUoms = useCallback(async (query: string) => {
    setUomLoading(true)
    try {
      setUomOptions(await fetchStandardUoms(query || undefined, { medicalOnly: true }))
    } catch {
      setUomOptions([])
    } finally {
      setUomLoading(false)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!form.frequency.trim()) {
      setError('Please select a frequency.')
      return
    }
    if (!form.start_date) {
      setError('Please enter a start date.')
      return
    }
    if (form.end_date && form.end_date < form.start_date) {
      setError('End date cannot be before the start date.')
      return
    }

    for (const med of form.medications) {
      if (med.dosage === '') continue
      const dosage = Number(med.dosage)
      if (!Number.isFinite(dosage)) {
        setError(`Dose for ${med.label} must be a number.`)
        return
      }
      if (dosage < 0) {
        setError(`Dose for ${med.label} cannot be negative.`)
        return
      }
    }

    const initialUomByName = new Map(
      (record ? doseRowsFromRecord(record) : []).map(
        (med) => [med.name, med.uom.trim()] as const,
      ),
    )

    const payload: LongActingMedicineUpdateValues = {
      frequency: form.frequency.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      next_run_date: form.next_run_date,
      status: form.status,
      injection_given_on: form.injection_given_on,
      remarks: form.remarks,
      doctors_remark: form.doctors_remark,
      medications: form.medications.map((med) => {
        const uom = med.uom.trim()
        const originalUom = initialUomByName.get(med.name) ?? ''
        return {
          name: med.name,
          dosage: med.dosage === '' ? 0 : Number(med.dosage),
          // Omit an untouched unit so it keeps following the linked prescription.
          ...(uom !== originalUom ? { uom } : {}),
        }
      }),
    }

    try {
      setSaving(true)
      const updated = await updateLongActingMedicine(name, payload)
      toast.success('Long acting medicine updated')
      onSaved?.(updated)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update long acting medicine'
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const frequencyChoices =
    form.frequency && !frequencyOptions.some((o) => o.name === form.frequency)
      ? [{ name: form.frequency, label: form.frequency }, ...frequencyOptions]
      : frequencyOptions

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div
        className={createModalShellClass(
          'max-w-xl w-full max-h-[min(90dvh,calc(100vh-1.5rem))] overflow-hidden my-auto',
        )}
      >
        <CreateModalHeader
          title="Edit Long Acting Medicine"
          subtitle={record?.patient_name || record?.patient || name}
          icon={<Pencil className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          onClose={onClose}
          alert={error}
        />

        <form onSubmit={handleSubmit} className={`${CREATE_MODAL_BODY_GRADIENT} flex-1 min-h-0`}>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5 space-y-4">
            {loading ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading long acting medicine…</p>
            ) : (
              <>

                <div className={MODAL_SECTION_CLASS}>
                  <p className={MODAL_SECTION_TITLE_CLASS}>Medicine</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <span className={MODAL_LABEL_CLASS}>Medication</span>
                      <p className="text-sm font-medium text-slate-900">
                        {record?.medication_label || record?.drug_name || '—'}
                      </p>
                    </div>
                    <div>
                      <span className={MODAL_LABEL_CLASS}>Patient</span>
                      <p className="text-sm text-slate-800">
                        {record?.patient_name || record?.patient || '—'}
                      </p>
                    </div>
                    <div>
                      <span className={MODAL_LABEL_CLASS}>Practitioner</span>
                      <p className="text-sm text-slate-800">
                        {record?.practitioner_name || record?.practitioner || '—'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className={MODAL_SECTION_CLASS}>
                  <p className={MODAL_SECTION_TITLE_CLASS}>Dose</p>
                  <div className="space-y-3">
                    {form.medications.length === 0 ? (
                      <div>
                        <span className={MODAL_LABEL_CLASS}>Prescribed dose</span>
                        <p className="text-sm text-slate-800">
                          {formatLongActingDose(record?.default_dosage, record?.default_uom) || '—'}
                        </p>
                      </div>
                    ) : (
                      <>
                        {form.medications.map((med, index) => (
                          <div key={med.name} className="space-y-2">
                            <p className="text-sm font-medium text-slate-900">{med.label}</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label
                                  className={MODAL_LABEL_CLASS}
                                  htmlFor={`lam-dose-${med.name}`}
                                >
                                  Dose
                                </label>
                                <input
                                  id={`lam-dose-${med.name}`}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="any"
                                  value={med.dosage}
                                  onChange={(e) => updateMedication(index, { dosage: e.target.value })}
                                  className={MODAL_FIELD_CLASS}
                                  disabled={saving}
                                />
                              </div>
                              <div>
                                <label
                                  className={MODAL_LABEL_CLASS}
                                  htmlFor={`lam-uom-${med.name}`}
                                >
                                  Unit of Measure
                                </label>
                                <DoseUomCombobox
                                  value={med.uom}
                                  inputId={`lam-uom-${med.name}`}
                                  options={uomOptions}
                                  loading={uomLoading}
                                  disabled={saving}
                                  onChange={(uom) => updateMedication(index, { uom })}
                                  onSearch={searchUoms}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        <p className="text-xs text-slate-500">
                          Dose and unit are stored on this long acting order and used for the
                          give-out default. Changing them here does not rewrite the
                          doctor&apos;s prescription.
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className={MODAL_SECTION_CLASS}>
                  <p className={MODAL_SECTION_TITLE_CLASS}>Schedule</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-frequency">
                        Frequency <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="lam-frequency"
                        value={form.frequency}
                        onChange={(e) => update('frequency', e.target.value)}
                        className={MODAL_FIELD_CLASS}
                        disabled={saving}
                      >
                        <option value="">Select frequency…</option>
                        {frequencyChoices.map((opt) => (
                          <option key={opt.name} value={opt.name}>
                            {opt.label || opt.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-status">
                        Status
                      </label>
                      <select
                        id="lam-status"
                        value={form.status}
                        onChange={(e) => update('status', e.target.value)}
                        className={MODAL_FIELD_CLASS}
                        disabled={saving}
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-start-date">
                        Start date <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="lam-start-date"
                        type="date"
                        value={form.start_date}
                        onChange={(e) => update('start_date', e.target.value)}
                        className={MODAL_FIELD_CLASS}
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-end-date">
                        End date
                      </label>
                      <input
                        id="lam-end-date"
                        type="date"
                        value={form.end_date}
                        onChange={(e) => update('end_date', e.target.value)}
                        className={MODAL_FIELD_CLASS}
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-next-run-date">
                        Next run date
                      </label>
                      <input
                        id="lam-next-run-date"
                        type="date"
                        value={form.next_run_date}
                        onChange={(e) => update('next_run_date', e.target.value)}
                        className={MODAL_FIELD_CLASS}
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-injection-side">
                        Last injection side
                      </label>
                      <select
                        id="lam-injection-side"
                        value={form.injection_given_on}
                        onChange={(e) => update('injection_given_on', e.target.value)}
                        className={MODAL_FIELD_CLASS}
                        disabled={saving}
                      >
                        {INJECTION_SIDE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className={MODAL_SECTION_CLASS}>
                  <p className={MODAL_SECTION_TITLE_CLASS}>Notes</p>
                  <div className="space-y-3">
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-remarks">
                        Remarks
                      </label>
                      <textarea
                        id="lam-remarks"
                        value={form.remarks}
                        onChange={(e) => update('remarks', e.target.value)}
                        rows={3}
                        placeholder="Reception / nursing remarks"
                        className={MODAL_TEXTAREA_CLASS}
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className={MODAL_LABEL_CLASS} htmlFor="lam-doctors-remark">
                        Doctor&apos;s remark
                      </label>
                      <textarea
                        id="lam-doctors-remark"
                        value={form.doctors_remark}
                        onChange={(e) => update('doctors_remark', e.target.value)}
                        rows={3}
                        placeholder="Doctor's remark"
                        className={MODAL_TEXTAREA_CLASS}
                        disabled={saving}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <CreateModalFooter
            hint={loading ? undefined : 'Saved changes apply immediately to this order.'}
          >
            <button type="button" onClick={onClose} className={CM_BTN_CANCEL} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={CM_BTN_PRIMARY} disabled={saving || loading}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </CreateModalFooter>
        </form>
      </div>
    </div>
  )
}

