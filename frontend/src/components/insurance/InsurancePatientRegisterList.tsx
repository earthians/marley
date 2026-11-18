import { useState, useEffect, useCallback, useRef } from 'react'
import { MoreHorizontal, UserPlus, Eye, X, ExternalLink, ShieldCheck, Pencil, AlertTriangle, Lock } from 'lucide-react'
import { fetchInsurancePatientRegisters, linkPatientToInsuranceRegister, type InsurancePatientRegisterRow } from '../../services/common'
import { CreatePatientModal } from '../patients/CreatePatientModal'
import { EditInsurancePatientRegisterModal } from './EditInsurancePatientRegisterModal'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { formatDate } from '../../utils/formatDate'
import { canSetInsuranceRegisterValidity } from '../../config/permissions'

const STATUS_COLORS: Record<string, string> = {
  Active: 'bg-green-100 text-green-700',
  Unused: 'bg-slate-100 text-slate-600',
  Exhausted: 'bg-orange-100 text-orange-700',
  Expired: 'bg-red-100 text-red-600',
  Cancelled: 'bg-slate-200 text-slate-500',
}

function parseApprovedVisits(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = parseInt(String(value), 10)
  return Number.isNaN(n) ? null : n
}

function visitsRemaining(row: InsurancePatientRegisterRow): string {
  const approved = parseApprovedVisits(row.no_of_visits)
  if (approved === null) return '—'
  const used = row.no_of_patient_visit ?? 0
  return String(Math.max(0, approved - used))
}

function linkedPatientLabel(row: InsurancePatientRegisterRow): string | null {
  if (!row.patient) return null
  const fileNo = (row.patient_file_no || row.patient).trim()
  const name = (row.patient_name || row.full_name || '').trim()
  if (fileNo && name) return `${fileNo}: ${name}`
  return fileNo || name || row.patient
}

/**
 * Registers created in ERPNext need an approval window so Approval Validity
 * (Days) can be calculated. Legacy (imported) registers are exempt — their
 * dates were never captured in the source system.
 */
function needsValidityDays(row: InsurancePatientRegisterRow): boolean {
  if (row.legacy) return false
  return !row.valid_from && !row.valid_to
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value ?? <span className="text-slate-400 italic">—</span>}</p>
    </div>
  )
}

interface InsurancePatientRegisterListProps {
  refreshKey?: number
  showFilters?: boolean
  /** Wire to the page header patient picker (local + URL + CareContext). */
  onPatientClick?: (patient: string) => void
}

export const InsurancePatientRegisterList = ({
  refreshKey = 0,
  showFilters = true,
  onPatientClick,
}: InsurancePatientRegisterListProps) => {
  const { guardClinicalEdit, userRole, setSelectedPatient } = useCareContext()
  // Valid From / Valid To belong to the Insurance team; Reception sees the
  // reminder but cannot set the window (the server enforces it too).
  const canSetValidity = canSetInsuranceRegisterValidity(userRole)

  const selectPatientInNavbar = (row: InsurancePatientRegisterRow) => {
    const patientId = (row.patient || '').trim()
    if (!patientId) return
    const display =
      linkedPatientLabel(row) ||
      (row.patient_name || row.full_name || patientId).trim() ||
      patientId
    try {
      localStorage.setItem('patientSearch_selectedPatientName', display)
    } catch {
      /* ignore */
    }
    // Prefer the page handler so PatientCareHeader (local state + ?patient=) updates.
    if (onPatientClick) {
      onPatientClick(patientId)
    } else {
      setSelectedPatient(patientId)
    }
    toast.success(`Patient ${display} selected in header`)
  }
  const [rows, setRows] = useState<InsurancePatientRegisterRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Three-dot menu — one row open at a time
  const [openActionRow, setOpenActionRow] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Detail slide-over
  const [detailRow, setDetailRow] = useState<InsurancePatientRegisterRow | null>(null)

  // Create patient modal (prefilled from register)
  const [createPatientForRegister, setCreatePatientForRegister] = useState<InsurancePatientRegisterRow | null>(null)

  // Edit register modal
  const [editRegister, setEditRegister] = useState<InsurancePatientRegisterRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchInsurancePatientRegisters(search || undefined)
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load records')
    } finally {
      setLoading(false)
    }
  }, [search, refreshKey])

  useEffect(() => { load() }, [load])

  // Close actions menu when clicking outside (ignore portaled menu and the three-dot trigger)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-portal-actions-menu]')) return
      if (el.closest('button[aria-label="Actions"]')) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenActionRow(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handlePatientCreated = async (patientName: string) => {
    if (createPatientForRegister) {
      try {
        await linkPatientToInsuranceRegister(createPatientForRegister.name, patientName)
        setCreatePatientForRegister(null)
        load()
      } catch (e) {
        // The patient was created but linking to the register failed — tell the user so the
        // register isn't silently left unlinked.
        toast.error(
          e instanceof Error ? e.message : `Patient created but could not be linked to register ${createPatientForRegister.name}. Link it manually.`,
        )
        setCreatePatientForRegister(null)
        load()
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full min-w-0 gap-3">
      {showFilters && (
        <div className="flex-shrink-0">
          <input
            type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full max-w-xs rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}

      {loading && <div className="text-center text-sm text-slate-400 py-6 flex-shrink-0">Loading…</div>}
      {error && <div className="text-sm text-red-600 py-2 flex-shrink-0">{error}</div>}

      {!loading && !error && (
        <div className="flex-1 min-h-0 overflow-auto overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Patient File No</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Full Name</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">National ID / CPR</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Insurance Provider</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">No. of Visits</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Visits Done</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Visits Remaining</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Status</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Patient</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-slate-400 py-8">
                    NO INSURANCE PATIENT REGISTERS FOUND
                  </td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.name}
                  className="border-t border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-3 py-2">
                    {row.patient_file_no ? (
                      <button
                        type="button"
                        onClick={() => setDetailRow(row)}
                        title={`Register ${row.name}`}
                        className="text-primary font-medium hover:underline text-xs"
                      >
                        {row.patient_file_no}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDetailRow(row)}
                        title={`Register ${row.name}`}
                        className="text-slate-400 italic hover:underline text-xs"
                      >
                        Not linked
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{row.full_name || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{row.national_id_cpr_no || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{row.insurance_provider || '—'}</td>
                  <td className="px-3 py-2 text-slate-700 text-xs font-medium tabular-nums">
                    {row.no_of_visits || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-700 text-xs font-medium tabular-nums">
                    {row.no_of_patient_visit ?? 0}
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold tabular-nums">
                    <span
                      className={
                        visitsRemaining(row) === '0'
                          ? 'text-orange-700'
                          : visitsRemaining(row) === '—'
                            ? 'text-slate-400'
                            : 'text-primary'
                      }
                    >
                      {visitsRemaining(row)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] || 'bg-slate-100 text-slate-600'}`}>
                        {row.status || 'Unused'}
                      </span>
                      {needsValidityDays(row) && (
                        <button
                          type="button"
                          onClick={() =>
                            canSetValidity
                              ? guardClinicalEdit(() => setEditRegister(row))
                              : setDetailRow(row)
                          }
                          title={
                            canSetValidity
                              ? 'Valid From / Valid To are not set — approval validity days cannot be calculated'
                              : 'Valid From / Valid To are not set — the Insurance team must add the validity window'
                          }
                          className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 transition-colors"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {canSetValidity ? 'Add validity days' : 'Validity not set'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.patient ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          selectPatientInNavbar(row)
                        }}
                        title="Select this patient in the header"
                        className="text-left text-green-700 font-medium hover:underline hover:text-green-800"
                      >
                        {row.patient_name || row.patient}
                      </button>
                    ) : (
                      <span className="text-slate-400 italic">Not linked</span>
                    )}
                  </td>
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end">
                      <div className="relative inline-block" ref={openActionRow === row.name ? menuRef : undefined}>
                        <button
                          type="button"
                          onClick={() => setOpenActionRow((prev) => (prev === row.name ? null : row.name))}
                          className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          aria-label="Actions"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        <PortalActionsMenu
                          open={openActionRow === row.name}
                          onClose={() => setOpenActionRow(null)}
                          triggerRef={menuRef}
                          minWidth={180}
                        >
                          <button
                            type="button"
                            onClick={() => { setDetailRow(row); setOpenActionRow(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                          >
                            <Eye className="w-4 h-4 text-slate-400" />
                            View Details
                          </button>
                          <button
                            type="button"
                            onClick={() => { guardClinicalEdit(() => setEditRegister(row)); setOpenActionRow(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="w-4 h-4 text-emerald-600" />
                            Edit Register
                          </button>
                          <button
                            type="button"
                            onClick={() => { setCreatePatientForRegister(row); setOpenActionRow(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                          >
                            <UserPlus className="w-4 h-4 text-blue-500" />
                            {row.patient ? 'Reassign Patient' : 'Create Patient'}
                          </button>
                        </PortalActionsMenu>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editRegister && (
        <EditInsurancePatientRegisterModal
          register={editRegister}
          onClose={() => setEditRegister(null)}
          onSuccess={() => {
            setEditRegister(null)
            if (detailRow?.name === editRegister.name) setDetailRow(null)
            load()
          }}
        />
      )}

      {/* Create Patient modal pre-filled from this register */}
      {createPatientForRegister && (
        <CreatePatientModal
          onClose={() => setCreatePatientForRegister(null)}
          onSuccess={handlePatientCreated}
          initialName={createPatientForRegister.full_name}
          initialNationalId={createPatientForRegister.national_id_cpr_no}
          initialInsurance={createPatientForRegister.insurance_provider}
          initialInsuranceRegister={createPatientForRegister.name}
        />
      )}

      {/* Detail slide-over */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={() => setDetailRow(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 h-full w-full max-w-2xl bg-white shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Insurance Patient Register</p>
                  <p className="text-sm font-semibold text-slate-800">{detailRow.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/app/insurance-patient-register/${encodeURIComponent(detailRow.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-md hover:bg-slate-100 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Frappe
                </a>
                <button
                  type="button"
                  onClick={() => setDetailRow(null)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Status badge */}
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLORS[detailRow.status] || 'bg-slate-100 text-slate-600'}`}>
                  {detailRow.status || 'Unused'}
                </span>
              </div>

              {/* Validity reminder — only for registers created in ERPNext */}
              {needsValidityDays(detailRow) && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-red-700">
                      {canSetValidity ? 'Add validity days' : 'Validity not set'}
                    </p>
                    <p className="text-xs text-red-600 mt-0.5">
                      Valid From and Valid To are not set, so Approval Validity (Days) cannot be calculated.
                    </p>
                    {canSetValidity ? (
                      <button
                        type="button"
                        onClick={() => { guardClinicalEdit(() => setEditRegister(detailRow)); setDetailRow(null) }}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-red-700 underline hover:text-red-800"
                      >
                        Set validity dates
                      </button>
                    ) : (
                      <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-red-700">
                        <Lock className="w-3 h-3" />
                        Only the Insurance team can set Valid From and Valid To.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Patient info */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">Patient Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Full Name" value={detailRow.full_name} />
                  <Field label="National ID / CPR No" value={detailRow.national_id_cpr_no} />
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Linked Patient</p>
                    {detailRow.patient ? (
                      <button
                        type="button"
                        onClick={() => selectPatientInNavbar(detailRow)}
                        title="Select this patient in the header"
                        className="text-sm font-medium text-green-700 hover:underline hover:text-green-800 text-left"
                      >
                        {linkedPatientLabel(detailRow)}
                      </button>
                    ) : (
                      <p className="text-sm font-medium text-slate-400 italic">—</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Insurance info */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">Insurance Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Insurance Provider" value={detailRow.insurance_provider} />
                  <Field label="Approval ID" value={detailRow.approval_id} />
                  <Field label="Valid From" value={formatDate(detailRow.valid_from) || undefined} />
                  <Field label="Valid To" value={formatDate(detailRow.valid_to) || undefined} />
                  <Field label="Approval Validity (Days)" value={detailRow.approval_validitydays} />
                  <Field label="No of Approved Visits" value={detailRow.no_of_visits} />
                  <Field label="Visits Used" value={detailRow.no_of_patient_visit ?? 0} />
                  <Field
                    label="Visits Remaining"
                    value={
                      visitsRemaining(detailRow) === '—'
                        ? undefined
                        : visitsRemaining(detailRow)
                    }
                  />
                </div>
              </div>

              {/* Visit stats */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">Visit Statistics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-primary">{detailRow.no_of_patient_visit ?? 0}</p>
                    <p className="text-xs text-slate-500 mt-1">Patient Visits Used</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-slate-700">{detailRow.no_of_visits || '—'}</p>
                    <p className="text-xs text-slate-500 mt-1">Approved Visits</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Panel footer actions */}
            <div className="shrink-0 px-6 py-4 border-t border-slate-200 bg-slate-50 flex gap-3">
              <button
                type="button"
                onClick={() => { guardClinicalEdit(() => setEditRegister(detailRow)); setDetailRow(null) }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition"
              >
                <Pencil className="w-4 h-4" />
                Edit Register
              </button>
              {!detailRow.patient && detailRow.status !== 'Active' && (
                <button
                  type="button"
                  onClick={() => { setCreatePatientForRegister(detailRow); setDetailRow(null) }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition"
                >
                  <UserPlus className="w-4 h-4" />
                  Create Patient
                </button>
              )}
              {detailRow.patient && (
                <button
                  type="button"
                  onClick={() => { setCreatePatientForRegister(detailRow); setDetailRow(null) }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 transition"
                >
                  <UserPlus className="w-4 h-4" />
                  Reassign Patient
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}