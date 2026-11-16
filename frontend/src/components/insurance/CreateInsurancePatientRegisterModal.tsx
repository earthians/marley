import { useState, useCallback, useEffect } from 'react'
import { Lock, ShieldCheck } from 'lucide-react'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_BODY_GRADIENT,
  CREATE_MODAL_OVERLAY,
  CreateModalFooter,
  CreateModalHeader,
  MODAL_FIELD_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_SECTION_CLASS,
  MODAL_SECTION_TITLE_CLASS,
  MODAL_SELECT_CLASS,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import {
  createInsurancePatientRegister,
  fetchHealthcareInsurance,
  fetchPatientOptions,
  type LinkFieldOption,
} from '../../services/common'
import { toast } from '../../hooks/useToast'
import {
  linkComboboxDropdownClass,
  linkComboboxEmptyPanelClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import { DateFilterInput } from '../ui/DateFilterInput'
import { isValidityRangeInverted, validityDaysInclusive } from '../../utils/insuranceValidity'
import { useCareContext } from '../../providers/CareContextProvider'
import { canSetInsuranceRegisterValidity } from '../../config/permissions'

const STATUS_OPTIONS = ['Unused', 'Active', 'Exhausted', 'Expired', 'Cancelled']

interface CreateInsurancePatientRegisterModalProps {
  onClose: () => void
  onSuccess?: (record: {
    name: string
    full_name: string
    insurance_provider: string
    national_id_cpr_no: string
  }) => void
}

export const CreateInsurancePatientRegisterModal = ({
  onClose,
  onSuccess,
}: CreateInsurancePatientRegisterModalProps) => {
  const [existingPatient, setExistingPatient] = useState(false)

  // The approval window (Valid From / Valid To) is owned by the Insurance team;
  // Reception can create registers but sees these fields locked.
  const { userRole } = useCareContext()
  const canSetValidity = canSetInsuranceRegisterValidity(userRole)

  const [fullName, setFullName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [status, setStatus] = useState('Unused')
  const [approvalId, setApprovalId] = useState('')
  // Approval window: when both dates are set the validity days are derived from them.
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [approvalValidityDays, setApprovalValidityDays] = useState('')
  const [noOfVisits, setNoOfVisits] = useState('')

  const [patientOpts, setPatientOpts] = useState<LinkFieldOption[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientQuery, setPatientQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<LinkFieldOption | null>(null)

  const [insuranceOpts, setInsuranceOpts] = useState<LinkFieldOption[]>([])
  const [insuranceOpen, setInsuranceOpen] = useState(false)
  const [insuranceQuery, setInsuranceQuery] = useState('')
  const [selectedInsurance, setSelectedInsurance] = useState<LinkFieldOption | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inclusively counted approval days (null until both dates are present and valid).
  const validityDays = validityDaysInclusive(validFrom, validTo)
  const validityRangeInverted = isValidityRangeInverted(validFrom, validTo)

  const loadInsurance = useCallback(async (q?: string) => {
    const opts = await fetchHealthcareInsurance(q)
    setInsuranceOpts(opts)
  }, [])

  const loadPatients = useCallback(async (q?: string) => {
    const opts = await fetchPatientOptions(q)
    setPatientOpts(opts)
  }, [])

  useEffect(() => {
    if (!existingPatient) return
    const t = setTimeout(() => {
      void loadPatients(patientQuery || undefined)
    }, patientQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [existingPatient, patientQuery, loadPatients])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-ipr-patient-field]')) {
        setPatientOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const closeDropdowns = () => {
    setInsuranceOpen(false)
    setPatientOpen(false)
  }

  const handleExistingPatientToggle = (next: boolean) => {
    setExistingPatient(next)
    setError(null)
    if (next) {
      setFullName('')
      setNationalId('')
      void loadPatients()
    } else {
      setSelectedPatient(null)
      setPatientQuery('')
      setPatientOpts([])
    }
  }

  const handlePatientSelect = async (opt: LinkFieldOption) => {
    setSelectedPatient(opt)
    setPatientQuery(opt.label)
    setPatientOpen(false)

    const displayName = opt.label.split(' (')[0].trim()
    setFullName(displayName || opt.name)

    try {
      const params = new URLSearchParams({ patient: opt.name })
      const res = await fetch(
        `/api/method/healthcare.api.patient.get_patient_doc?${params.toString()}`,
        { credentials: 'include' }
      )
      const data = await res.json()
      const doc = data?.message
      if (doc?.patient_name) setFullName(doc.patient_name)
      if (doc?.id_number) setNationalId(doc.id_number)
    } catch {
      /* keep label-derived name */
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (existingPatient && !selectedPatient) {
      setError('Please select an existing patient')
      return
    }
    if (!existingPatient && !fullName.trim()) {
      setError('Full Name is required')
      return
    }
    if (!selectedInsurance) {
      setError('Insurance Provider is required')
      return
    }
    if (canSetValidity && validityRangeInverted) {
      setError('Valid To cannot be before Valid From')
      return
    }

    const resolvedName = fullName.trim() || selectedPatient?.label.split(' (')[0].trim() || ''
    const resolvedStatus = existingPatient && selectedPatient ? 'Active' : status

    try {
      setSaving(true)
      setError(null)
      const created = await createInsurancePatientRegister({
        full_name: resolvedName,
        national_id_cpr_no: nationalId.trim() || null,
        status: resolvedStatus,
        insurance_provider: selectedInsurance.name,
        approval_id: approvalId.trim() || null,
        no_of_visits: noOfVisits.trim() || null,
        patient: existingPatient && selectedPatient ? selectedPatient.name : null,
        // The approval window is omitted entirely for users without Insurance
        // access: the server stores the register without dates instead.
        ...(canSetValidity
          ? {
              approval_validitydays:
                validityDays ?? (approvalValidityDays ? parseInt(approvalValidityDays, 10) : 0),
              valid_from: validFrom || null,
              valid_to: validTo || null,
            }
          : {}),
      })

      if (created.linked_patient && selectedPatient) {
        toast.success(
          `Register ${created.name} created and linked to patient ${selectedPatient.name}`,
          4000
        )
      } else {
        toast.success(`Insurance register ${created.name} created`, 4000)
      }

      onSuccess?.(created)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create record')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={CREATE_MODAL_OVERLAY}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={createModalShellClass('w-full max-w-4xl flex flex-col max-h-[94vh] min-h-[min(560px,90vh)]')}
        onClick={(e) => {
          e.stopPropagation()
          closeDropdowns()
        }}
      >
        <CreateModalHeader
          title="New Insurance Patient Register"
          subtitle="Register insurance approval and visit limits for a patient"
          icon={<ShieldCheck className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          onClose={onClose}
          alert={error}
        />

        <form
          onSubmit={handleSubmit}
          className={`${CREATE_MODAL_BODY_GRADIENT} flex flex-col flex-1 min-h-0`}
        >
          <div
            className="flex-1 overflow-y-auto px-5 py-5 space-y-5 sm:px-6"
            style={{ scrollbarWidth: 'thin' }}
          >
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-950">Existing patient?</p>
                <p className="mt-0.5 text-xs text-emerald-800/70">
                  {existingPatient
                    ? 'Search and link a patient already in the system'
                    : 'Enter details for a new patient (create patient later from the list)'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={existingPatient}
                onClick={() => handleExistingPatientToggle(!existingPatient)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  existingPatient ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    existingPatient ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className={`${MODAL_SECTION_CLASS} space-y-3`}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>Patient Information</h3>

                {existingPatient ? (
                  <div data-ipr-patient-field onClick={(e) => e.stopPropagation()}>
                    <label className={MODAL_LABEL_CLASS}>
                      Patient <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={selectedPatient ? selectedPatient.label : patientQuery}
                        onChange={(e) => {
                          setPatientQuery(e.target.value)
                          setSelectedPatient(null)
                          setPatientOpen(true)
                        }}
                        onFocus={() => {
                          setPatientOpen(true)
                          void loadPatients(patientQuery || undefined)
                        }}
                        placeholder="Search patient by name…"
                        className={`${linkComboboxInputWithClearClass} pr-7`}
                      />
                      {selectedPatient && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPatient(null)
                            setPatientQuery('')
                            setFullName('')
                            setNationalId('')
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                        >
                          ✕
                        </button>
                      )}
                      {patientOpen && patientOpts.length > 0 && (
                        <div className={linkComboboxDropdownClass}>
                          {patientOpts.map((o) => (
                            <button
                              key={o.name}
                              type="button"
                              onClick={() => void handlePatientSelect(o)}
                              className={linkComboboxOptionClassCompact}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {patientOpen && patientOpts.length === 0 && patientQuery.trim() && (
                        <div className={linkComboboxEmptyPanelClass}>NO PATIENTS FOUND</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className={MODAL_LABEL_CLASS}>
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. John Michael Smith"
                        className={MODAL_FIELD_CLASS}
                      />
                    </div>
                    <div>
                      <label className={MODAL_LABEL_CLASS}>National ID / CPR No</label>
                      <input
                        type="text"
                        value={nationalId}
                        onChange={(e) => setNationalId(e.target.value)}
                        placeholder="e.g. 880101-1234"
                        className={MODAL_FIELD_CLASS}
                      />
                    </div>
                  </>
                )}

                {existingPatient && selectedPatient && (
                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-emerald-100/80 bg-emerald-50/40 p-3">
                    <div>
                      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700/70">
                        Full Name
                      </p>
                      <p className="text-sm font-medium text-emerald-950">{fullName || '—'}</p>
                    </div>
                    <div>
                      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700/70">
                        National ID
                      </p>
                      <p className="text-sm font-medium text-emerald-950">{nationalId || '—'}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className={`${MODAL_SECTION_CLASS} space-y-3`}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>Insurance Details</h3>

                {!canSetValidity && (
                  <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <p className="text-[11px] leading-snug text-slate-600">
                      Valid From, Valid To and Approval Validity (Days) are managed by the
                      Insurance team — the register is created without a validity window.
                    </p>
                  </div>
                )}

                <div onClick={(e) => e.stopPropagation()}>
                  <label className={MODAL_LABEL_CLASS}>
                    Insurance Provider <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={insuranceQuery}
                      onChange={(e) => {
                        setInsuranceQuery(e.target.value)
                        setSelectedInsurance(null)
                        setInsuranceOpen(true)
                        void loadInsurance(e.target.value)
                      }}
                      onFocus={() => {
                        setInsuranceOpen(true)
                        void loadInsurance()
                      }}
                      placeholder="Search insurance provider…"
                      className={`${linkComboboxInputWithClearClass} pr-7`}
                    />
                    {insuranceQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedInsurance(null)
                          setInsuranceQuery('')
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                      >
                        ✕
                      </button>
                    )}
                    {insuranceOpen && insuranceOpts.length > 0 && (
                      <div className={linkComboboxDropdownClass}>
                        {insuranceOpts.map((o) => (
                          <button
                            key={o.name}
                            type="button"
                            onClick={() => {
                              setSelectedInsurance(o)
                              setInsuranceQuery(o.label || o.name)
                              setInsuranceOpen(false)
                            }}
                            className={linkComboboxOptionClassCompact}
                          >
                            {o.label || o.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={MODAL_LABEL_CLASS}>Approval ID</label>
                    <input
                      type="text"
                      value={approvalId}
                      onChange={(e) => setApprovalId(e.target.value)}
                      placeholder="Approval reference"
                      className={MODAL_FIELD_CLASS}
                    />
                  </div>
                  {/* Approval window is only rendered for the Insurance team; users
                      without that access never see an editable window at all. */}
                  {canSetValidity && (
                    <>
                      <div>
                        <label className={MODAL_LABEL_CLASS}>Valid From</label>
                        <DateFilterInput
                          value={validFrom}
                          onChange={(e) => setValidFrom(e.target.value)}
                          className={MODAL_FIELD_CLASS}
                        />
                      </div>
                      <div>
                        <label className={MODAL_LABEL_CLASS}>Valid To</label>
                        <DateFilterInput
                          value={validTo}
                          onChange={(e) => setValidTo(e.target.value)}
                          min={validFrom || undefined}
                          className={MODAL_FIELD_CLASS}
                        />
                        {validityRangeInverted && (
                          <p className="mt-1 text-[10px] text-red-600">
                            Valid To cannot be before Valid From
                          </p>
                        )}
                      </div>
                      <div>
                        <label className={MODAL_LABEL_CLASS}>Approval Validity (Days)</label>
                        <input
                          type="number"
                          value={validityDays != null ? String(validityDays) : approvalValidityDays}
                          onChange={(e) => setApprovalValidityDays(e.target.value)}
                          readOnly={validityDays != null}
                          placeholder="e.g. 30"
                          min="0"
                          className={`${MODAL_FIELD_CLASS}${
                            validityDays != null ? ' bg-slate-50 text-slate-600' : ''
                          }`}
                        />
                        {validityDays != null && (
                          <p className="mt-1 text-[10px] text-emerald-700/70">
                            Auto-calculated from Valid From and Valid To
                          </p>
                        )}
                      </div>
                    </>
                  )}
                  <div>
                    <label className={MODAL_LABEL_CLASS}>No. of Visits</label>
                    <input
                      type="text"
                      value={noOfVisits}
                      onChange={(e) => setNoOfVisits(e.target.value)}
                      placeholder="e.g. 10"
                      className={MODAL_FIELD_CLASS}
                    />
                  </div>
                  <div>
                    <label className={MODAL_LABEL_CLASS}>Status</label>
                    <select
                      value={existingPatient && selectedPatient ? 'Active' : status}
                      onChange={(e) => setStatus(e.target.value)}
                      disabled={existingPatient && !!selectedPatient}
                      className={`${MODAL_SELECT_CLASS} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    {existingPatient && selectedPatient && (
                      <p className="mt-1 text-[10px] text-emerald-700/70">Set to Active when linked</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <CreateModalFooter>
            <button type="button" onClick={onClose} className={CM_BTN_CANCEL}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={CM_BTN_PRIMARY}>
              {saving ? 'Creating…' : 'Create Register'}
            </button>
          </CreateModalFooter>
        </form>
      </div>
    </div>
  )
}
