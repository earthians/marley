import { useState, useCallback, useEffect } from 'react'
import { Lock, Pencil, X } from 'lucide-react'
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
  fetchHealthcareInsurance,
  fetchPatientOptions,
  updateInsurancePatientRegister,
  type InsurancePatientRegisterRow,
  type LinkFieldOption,
} from '../../services/common'
import { toast } from '../../hooks/useToast'
import { useRejectEditModeWhenLocked } from '../../hooks/useRejectEditModeWhenLocked'
import { useBlockIfEditingLocked } from '../../hooks/useBlockIfEditingLocked'
import {
  linkComboboxDropdownClass,
  linkComboboxEmptyPanelClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import { DateFilterInput } from '../ui/DateFilterInput'
import { isValidityRangeInverted, validityDaysInclusive } from '../../utils/insuranceValidity'
import { formatDate } from '../../utils/formatDate'
import { useCareContext } from '../../providers/CareContextProvider'
import { canSetInsuranceRegisterValidity } from '../../config/permissions'

function patientOptionLabel(name: string, patientName?: string | null): string {
  const label = (patientName || '').trim()
  return label ? `${label} (${name})` : name
}

const STATUS_OPTIONS = ['Unused', 'Active', 'Exhausted', 'Expired', 'Cancelled']

function toDateInputValue(value?: string | null): string {
  if (!value) return ''
  return value.slice(0, 10)
}

interface EditInsurancePatientRegisterModalProps {
  register: InsurancePatientRegisterRow
  onClose: () => void
  onSuccess?: (record: InsurancePatientRegisterRow) => void
}

export const EditInsurancePatientRegisterModal = ({
  register,
  onClose,
  onSuccess,
}: EditInsurancePatientRegisterModalProps) => {
  const blockIfEditingLocked = useBlockIfEditingLocked()
  useRejectEditModeWhenLocked(true, onClose)
  // The approval window (Valid From / Valid To) is owned by the Insurance team;
  // Reception can edit the rest of the register but sees these fields locked.
  const { userRole } = useCareContext()
  const canSetValidity = canSetInsuranceRegisterValidity(userRole)
  const [fullName, setFullName] = useState(register.full_name || '')
  const [nationalId, setNationalId] = useState(register.national_id_cpr_no || '')
  const [status, setStatus] = useState(register.status || 'Unused')
  const [approvalId, setApprovalId] = useState(register.approval_id || '')
  // Approval window: when both dates are set the validity days are derived from them.
  const [validFrom, setValidFrom] = useState(toDateInputValue(register.valid_from))
  const [validTo, setValidTo] = useState(toDateInputValue(register.valid_to))
  const [approvalValidityDays, setApprovalValidityDays] = useState(
    register.approval_validitydays != null ? String(register.approval_validitydays) : ''
  )
  const [noOfVisits, setNoOfVisits] = useState(register.no_of_visits || '')
  const [selectedPatient, setSelectedPatient] = useState<LinkFieldOption | null>(
    register.patient
      ? {
          name: register.patient,
          label: patientOptionLabel(register.patient, register.patient_name),
        }
      : null,
  )
  const [patientOpts, setPatientOpts] = useState<LinkFieldOption[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientQuery, setPatientQuery] = useState(
    register.patient
      ? patientOptionLabel(register.patient, register.patient_name)
      : '',
  )

  const [insuranceOpts, setInsuranceOpts] = useState<LinkFieldOption[]>([])
  const [insuranceOpen, setInsuranceOpen] = useState(false)
  const [insuranceQuery, setInsuranceQuery] = useState(register.insurance_provider || '')
  const [selectedInsurance, setSelectedInsurance] = useState<LinkFieldOption | null>(
    register.insurance_provider
      ? { name: register.insurance_provider, label: register.insurance_provider }
      : null
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inclusively counted approval days (null until both dates are present and valid).
  const validityDays = validityDaysInclusive(validFrom, validTo)
  const validityRangeInverted = isValidityRangeInverted(validFrom, validTo)

  // Plain-text summary for users who may not edit the approval window: they see
  // the stored window (or "Not set") without ever getting an editable control.
  const validityWindowSummary =
    !validFrom && !validTo
      ? 'Not set'
      : [
          validFrom ? formatDate(validFrom) : '—',
          validTo ? formatDate(validTo) : '—',
        ].join(' → ') +
        (validityDays != null
          ? ` · ${validityDays} ${validityDays === 1 ? 'day' : 'days'}`
          : approvalValidityDays
            ? ` · ${approvalValidityDays} ${approvalValidityDays === '1' ? 'day' : 'days'}`
            : '')

  const loadInsurance = useCallback(async (q?: string) => {
    const opts = await fetchHealthcareInsurance(q)
    setInsuranceOpts(opts)
  }, [])

  const loadPatients = useCallback(async (q?: string) => {
    const opts = await fetchPatientOptions(q)
    setPatientOpts(opts)
  }, [])

  useEffect(() => {
    void loadInsurance()
  }, [loadInsurance])

  useEffect(() => {
    const t = setTimeout(() => {
      if (!patientOpen) return
      void loadPatients(patientQuery || undefined)
    }, patientQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [patientOpen, patientQuery, loadPatients])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-ipr-edit-patient-field]')) {
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

  const clearLinkedPatient = () => {
    setSelectedPatient(null)
    setPatientQuery('')
    setPatientOpts([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      blockIfEditingLocked()
    } catch {
      return
    }
    if (!fullName.trim()) {
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

    try {
      setSaving(true)
      setError(null)
      const updated = await updateInsurancePatientRegister({
        name: register.name,
        full_name: fullName.trim(),
        national_id_cpr_no: nationalId.trim() || null,
        status,
        insurance_provider: selectedInsurance.name,
        approval_id: approvalId.trim() || null,
        no_of_visits: noOfVisits.trim() || null,
        // Explicit null clears; a name links / replaces the linked patient.
        patient: selectedPatient?.name || null,
        // The approval window is omitted entirely for users without Insurance
        // access: the server keeps the stored dates and rejects any change.
        ...(canSetValidity
          ? {
              approval_validitydays:
                validityDays ?? (approvalValidityDays ? parseInt(approvalValidityDays, 10) : 0),
              valid_from: validFrom || null,
              valid_to: validTo || null,
            }
          : {}),
      })
      toast.success(
        selectedPatient?.name
          ? `Register ${register.name} updated`
          : `Register ${register.name} updated · patient unlinked`,
        3000,
      )
      onSuccess?.(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update record')
    } finally {
      setSaving(false)
    }
  }

  const visitsUsed = register.no_of_patient_visit ?? 0

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
          title="Edit Insurance Patient Register"
          subtitle={register.name}
          icon={<Pencil className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
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
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className={`${MODAL_SECTION_CLASS} space-y-3`}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>Patient Information</h3>

                <div>
                  <label className={MODAL_LABEL_CLASS}>Patient File No</label>
                  <input
                    type="text"
                    value={register.patient_file_no || 'Not linked'}
                    readOnly
                    className={`${MODAL_FIELD_CLASS} bg-slate-50 text-slate-600`}
                  />
                </div>

                <div>
                  <label className={MODAL_LABEL_CLASS}>
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={MODAL_FIELD_CLASS}
                  />
                </div>

                <div>
                  <label className={MODAL_LABEL_CLASS}>National ID / CPR No</label>
                  <input
                    type="text"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    className={MODAL_FIELD_CLASS}
                  />
                </div>

                <div data-ipr-edit-patient-field onClick={(e) => e.stopPropagation()}>
                  <label className={MODAL_LABEL_CLASS}>Linked Patient</label>
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
                      className={linkComboboxInputWithClearClass}
                      title={selectedPatient?.name || undefined}
                    />
                    {(selectedPatient || patientQuery) && (
                      <button
                        type="button"
                        onClick={clearLinkedPatient}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
                        title="Clear linked patient"
                        aria-label="Clear linked patient"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.25} />
                      </button>
                    )}
                    {patientOpen && patientOpts.length > 0 && (
                      <div className={linkComboboxDropdownClass}>
                        {patientOpts.map((opt) => (
                          <button
                            key={opt.name}
                            type="button"
                            onClick={() => {
                              setSelectedPatient(opt)
                              setPatientQuery(opt.label)
                              setPatientOpen(false)
                            }}
                            className={linkComboboxOptionClassCompact}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {patientOpen && patientOpts.length === 0 && patientQuery.trim() && !selectedPatient && (
                      <div className={linkComboboxEmptyPanelClass}>NO PATIENTS FOUND</div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Search to link another patient, or clear and save to unlink.
                  </p>
                </div>
              </div>

              <div className={`${MODAL_SECTION_CLASS} space-y-3`}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>Insurance Details</h3>

                <div onClick={(e) => e.stopPropagation()}>
                  <label className={MODAL_LABEL_CLASS}>
                    Insurance Provider <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={selectedInsurance ? selectedInsurance.label || selectedInsurance.name : insuranceQuery}
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
                    {(selectedInsurance || insuranceQuery) && (
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
                  {/* Approval window: editable only for the Insurance team. Everyone
                      else gets a plain-text summary (no inputs to reach at all). */}
                  {canSetValidity ? (
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
                  ) : (
                    <div className="col-span-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          Valid From / Valid To · Approval Validity
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-slate-700">
                          {validityWindowSummary}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Read-only — managed by the Insurance team.
                        </p>
                      </div>
                    </div>
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
                    <label className={MODAL_LABEL_CLASS}>Visits Used</label>
                    <input
                      type="text"
                      value={String(visitsUsed)}
                      readOnly
                      className={`${MODAL_FIELD_CLASS} bg-slate-50 text-slate-600`}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={MODAL_LABEL_CLASS}>Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className={MODAL_SELECT_CLASS}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
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
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </CreateModalFooter>
        </form>
      </div>
    </div>
  )
}
