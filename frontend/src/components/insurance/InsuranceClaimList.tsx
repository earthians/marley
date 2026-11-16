import { useState, useEffect, useCallback, useRef } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { fetchInsuranceClaims, rejectInsuranceClaim, fetchHealthcareInsurance, fetchPatientCategories, type InsuranceClaimRow, type LinkFieldOption } from '../../services/common'
import { fetchModeOfPayments } from '../../services/paymentEntry'
import { apiRequest } from '../../services/apiClient'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { useCareContext } from '../../providers/CareContextProvider'
import { formatMoneyAmount } from '../../utils/currencyFormat'
import { DateFilterInput } from '../ui/DateFilterInput'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Submitted: 'bg-blue-100 text-blue-700',
  'Partially Paid': 'bg-amber-100 text-amber-700',
  Paid: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-600',
}

function fmt(amount: number | null | undefined, currency: string): string {
  if (amount == null || amount === 0) return '—'
  return formatMoneyAmount(Number(amount), currency)
}

// Legacy voucher status codes → human label (e.g. "A" means Approved)
const VCH_STATUS_LABELS: Record<string, string> = {
  A: 'Approved',
  R: 'Rejected',
  P: 'Pending',
  C: 'Cancelled',
}

function vchStatusLabel(value?: string | null): string | null {
  if (!value) return null
  const key = value.trim().toUpperCase()
  return VCH_STATUS_LABELS[key] || value
}

// IP / OP Source badge colours (matches Insurance Claim.ip_op_source options)
const SOURCE_COLORS: Record<string, string> = {
  IP: 'bg-indigo-100 text-indigo-700',
  OP: 'bg-teal-100 text-teal-700',
  PH: 'bg-purple-100 text-purple-700',
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value ?? <span className="text-slate-400 italic">—</span>}</p>
    </div>
  )
}

// ─── Update Claim Modal ────────────────────────────────────────────────────────

interface UpdateClaimModalProps {
  row: InsuranceClaimRow
  currency: string
  onClose: () => void
  onSuccess: (updated: Partial<InsuranceClaimRow>) => void
}

function deriveStatus(approved: number, totalClaimed: number, isRejected: boolean): string {
  if (isRejected) return 'Rejected'
  if (approved <= 0) return 'Submitted'
  if (totalClaimed > 0 && approved >= totalClaimed) return 'Paid'
  return 'Partially Paid'
}

const LEGACY_STATUS_OPTIONS = ['Submitted', 'Partially Paid', 'Paid', 'Rejected']

function UpdateClaimModal({ row, currency, onClose, onSuccess }: UpdateClaimModalProps) {
  const { userCostCenter } = useCareContext()
  const isLegacy = Boolean(row.legacy)
  const [totalApproved, setTotalApproved] = useState(String(row.total_approved || ''))
  const [totalRejected, setTotalRejected] = useState(String(row.total_rejected || ''))
  const [isRejected, setIsRejected] = useState(row.status === 'Rejected')
  const [manualStatus, setManualStatus] = useState(
    LEGACY_STATUS_OPTIONS.includes(row.status) ? row.status : 'Submitted',
  )
  const [authNo, setAuthNo] = useState(row.authorization_no || '')
  const [remark, setRemark] = useState(row.remark || '')
  const [modeOfPayment, setModeOfPayment] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [referenceDate, setReferenceDate] = useState('')
  const [paymentModes, setPaymentModes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const approved = parseFloat(totalApproved) || 0
  const previousApproved = Number(row.total_approved || 0)
  const paymentDelta = Math.max(0, approved - previousApproved)
  const needsPayment = !isLegacy && !isRejected && paymentDelta > 0
  const previewStatus = isLegacy
    ? manualStatus
    : deriveStatus(approved, row.total_claimed || 0, isRejected)

  useEffect(() => {
    if (isLegacy) return
    fetchModeOfPayments(userCostCenter)
      .then((modes) => {
        setPaymentModes(modes)
        setModeOfPayment((prev) => (prev && !modes.includes(prev) ? modes[0] || '' : prev))
      })
      .catch(() => setPaymentModes([]))
  }, [userCostCenter, isLegacy])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (needsPayment && !modeOfPayment.trim()) {
        throw new Error('Mode of Payment is required when recording an insurance payment')
      }
      const params = new URLSearchParams({
        claim_name: row.name,
        ...(isLegacy
          ? { status: manualStatus }
          : isRejected
            ? { status: 'Rejected' }
            : {}),
        ...(totalApproved !== '' ? { total_approved: totalApproved } : {}),
        ...(totalRejected !== '' ? { total_rejected: totalRejected } : {}),
        authorization_no: authNo,
        remark,
      })
      if (needsPayment) {
        params.set('mode_of_payment', modeOfPayment.trim())
        if (referenceNo.trim()) params.set('reference_no', referenceNo.trim())
        if (referenceDate) params.set('reference_date', referenceDate)
      }
      const data = await apiRequest<{ derived_status?: string; payment_entry?: string }>(
        `/api/method/healthcare.api.common.update_insurance_claim?${params.toString()}`,
        { method: 'POST' },
      )
      const finalStatus = data?.derived_status || previewStatus
      onSuccess({
        status: finalStatus,
        total_approved: approved || row.total_approved,
        total_rejected: parseFloat(totalRejected) || row.total_rejected,
        authorization_no: authNo,
        remark,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update claim')
    } finally {
      setSaving(false)
    }
  }

  const statusColor = STATUS_COLORS[previewStatus] || 'bg-slate-100 text-slate-600'

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Update Claim — {row.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {row.patient_name || row.patient}
              {isLegacy ? <span className="ml-1.5 text-amber-700">· Legacy</span> : null}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Claim summary */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 grid grid-cols-2 gap-2 text-center text-xs">
            <div>
              <div className="text-slate-500">Total Claimed</div>
              <div className="font-semibold text-slate-800">{fmt(row.total_claimed, currency)}</div>
            </div>
            <div>
              <div className="text-slate-500">Patient Liability</div>
              <div className="font-semibold text-amber-700">{fmt(row.total_patient_liability, currency)}</div>
            </div>
          </div>

          {isLegacy ? (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select
                value={manualStatus}
                onChange={e => {
                  setManualStatus(e.target.value)
                  setIsRejected(e.target.value === 'Rejected')
                }}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                {LEGACY_STATUS_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                Legacy claims can be marked Paid without recording a payment.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5">
              <span className="text-xs text-slate-500">Status will be set to</span>
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}>
                {previewStatus}
              </span>
            </div>
          )}

          {/* Amounts */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount Approved</label>
              <input
                type="number"
                value={totalApproved}
                onChange={e => {
                  setTotalApproved(e.target.value)
                  if (!isLegacy) setIsRejected(false)
                }}
                placeholder="0.000" step="0.001" min="0"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount Rejected</label>
              <input
                type="number"
                value={totalRejected}
                onChange={e => setTotalRejected(e.target.value)}
                placeholder="0.000" step="0.001" min="0"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {!isLegacy && !isRejected && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mode of Payment{needsPayment ? <span className="text-red-500"> *</span> : null}
                </label>
                {paymentModes.length > 0 ? (
                  <select
                    value={modeOfPayment}
                    onChange={e => setModeOfPayment(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  >
                    <option value="">Select mode…</option>
                    {paymentModes.map(mode => (
                      <option key={mode} value={mode}>{mode}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={modeOfPayment}
                    onChange={e => setModeOfPayment(e.target.value)}
                    placeholder="e.g. Cash, Bank Transfer"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  />
                )}
              </div>
              {needsPayment && (
                <p className="text-xs text-blue-800">
                  Payment of <strong>{fmt(paymentDelta, currency)}</strong> will create a Payment Entry
                  against invoice <strong>{row.sales_invoice || '—'}</strong> and update its outstanding.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reference No</label>
                  <input
                    type="text"
                    value={referenceNo}
                    onChange={e => setReferenceNo(e.target.value)}
                    placeholder="Cheque / txn ref"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reference Date</label>
                  <DateFilterInput
                    value={referenceDate}
                    onChange={e => setReferenceDate(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Reject toggle — non-legacy only; legacy uses Status dropdown */}
          {!isLegacy && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRejected}
                onChange={e => setIsRejected(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
              />
              <span className="text-xs font-medium text-red-700">Mark entire claim as Rejected</span>
            </label>
          )}

          {/* Authorization No */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Authorization No</label>
            <input type="text" value={authNo} onChange={e => setAuthNo(e.target.value)}
              placeholder="e.g. AUTH-2025-00123"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          {/* Remark */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Remark</label>
            <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2}
              placeholder="Add notes or remarks…"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving…' : needsPayment ? 'Record Payment' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main List ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['Draft', 'Submitted', 'Partially Paid', 'Paid', 'Rejected']

// IP / OP Source options — an empty selection shows every claim.
const IP_OP_SOURCE_OPTIONS = ['IP', 'OP', 'PH']

interface InsuranceClaimListProps {
  refreshKey?: number
  patient?: string
  currency?: string
  onPatientClick?: (patient: string) => void
  showFilters?: boolean
  onEditDraft?: (claimName: string) => void
  onRefresh?: () => void
}

export const InsuranceClaimList = ({
  refreshKey = 0,
  patient,
  currency,
  onPatientClick,
  showFilters = true,
  onEditDraft,
  onRefresh,
}: InsuranceClaimListProps) => {
  const { companyCurrency, guardClinicalEdit } = useCareContext()
  const displayCurrency = (currency ?? companyCurrency ?? 'USD').toUpperCase()
  const [rows, setRows] = useState<InsuranceClaimRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [healthInsuranceFilter, setHealthInsuranceFilter] = useState('')
  const [patientCategoryFilter, setPatientCategoryFilter] = useState('')
  const [ipOpFilter, setIpOpFilter] = useState('')
  const [insuranceOptions, setInsuranceOptions] = useState<LinkFieldOption[]>([])
  const [categoryOptions, setCategoryOptions] = useState<LinkFieldOption[]>([])
  const [detailRow, setDetailRow] = useState<InsuranceClaimRow | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)

  // Three-dot menu
  const [openActionRow, setOpenActionRow] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Update modal
  const [updateTarget, setUpdateTarget] = useState<InsuranceClaimRow | null>(null)

  useEffect(() => {
    if (showFilters) {
      fetchHealthcareInsurance().then(setInsuranceOptions).catch(() => setInsuranceOptions([]))
      fetchPatientCategories().then(setCategoryOptions).catch(() => setCategoryOptions([]))
    }
  }, [showFilters])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchInsuranceClaims({
        search: search || undefined,
        patient,
        status: statusFilter || undefined,
        health_insurance: healthInsuranceFilter || undefined,
        patient_category: patientCategoryFilter || undefined,
        ip_op_source: ipOpFilter || undefined,
      })
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }, [search, patient, statusFilter, healthInsuranceFilter, patientCategoryFilter, ipOpFilter, refreshKey])

  useEffect(() => { load() }, [load])

  const handleReject = async (row: InsuranceClaimRow) => {
    if (!window.confirm(`Reject claim ${row.name}?`)) return
    setRejecting(row.name)
    try {
      await rejectInsuranceClaim(row.name)
      setRows(prev => prev.map(r => r.name === row.name ? { ...r, status: 'Rejected' } : r))
      if (detailRow?.name === row.name) setDetailRow(prev => prev ? { ...prev, status: 'Rejected' } : prev)
      onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject claim')
    } finally {
      setRejecting(null)
      setOpenActionRow(null)
    }
  }

  // Close menu on outside click
  useEffect(() => {
    if (!openActionRow) return
    const handle = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('[data-portal-actions-menu]') && !menuRef.current?.contains(t)) {
        setOpenActionRow(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [openActionRow])

  const handleUpdateSuccess = (name: string, updates: Partial<InsuranceClaimRow>) => {
    setRows(prev => prev.map(r => r.name === name ? { ...r, ...updates } : r))
    if (detailRow?.name === name) setDetailRow(prev => prev ? { ...prev, ...updates } : prev)
  }

  const totalClaimed = rows.reduce((s, r) => s + (r.total_claimed || 0), 0)
  const totalApproved = rows.reduce((s, r) => s + (r.total_approved || 0), 0)

  const ThreeDotBtn = ({ row }: { row: InsuranceClaimRow }) => (
    <div
      className="relative inline-block"
      ref={openActionRow === row.name ? menuRef : undefined}
      onClick={e => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpenActionRow(prev => prev === row.name ? null : row.name)}
        className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
        aria-label="Actions"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      <PortalActionsMenu
        open={openActionRow === row.name}
        onClose={() => setOpenActionRow(null)}
        triggerRef={menuRef}
        minWidth={180}
      >
        <button
          type="button"
          className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          onClick={() => { guardClinicalEdit(() => setUpdateTarget(row)); setOpenActionRow(null) }}
        >
          {row.legacy ? 'Update Status' : 'Update Status & Payment'}
        </button>
        {(row.docstatus === 0 || row.status === 'Draft') && onEditDraft && (
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => { guardClinicalEdit(() => onEditDraft(row.name)); setOpenActionRow(null) }}
          >
            Edit Draft
          </button>
        )}
        {row.status !== 'Rejected' && (
          <button
            type="button"
            disabled={rejecting === row.name}
            className="block w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            onClick={() => guardClinicalEdit(() => handleReject(row))}
          >
            {rejecting === row.name ? 'Rejecting…' : 'Reject Claim'}
          </button>
        )}
        <button
          type="button"
          className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          onClick={() => { setDetailRow(row); setOpenActionRow(null) }}
        >
          View Details
        </button>
        <div className="px-3 py-1">
          <PrintFormatDropdown
            doctype="Insurance Claim"
            docName={row.name}
            className="inline-flex items-center gap-2 text-sm text-slate-700 hover:text-slate-900 w-full"
            ariaLabel="Print"
            title="Print"
          />
        </div>
      </PortalActionsMenu>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Summary strip */}
      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
            <div className="text-xs text-slate-500 mb-0.5">Total Claims</div>
            <div className="font-semibold text-slate-800">{rows.length}</div>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-center">
            <div className="text-xs text-blue-500 mb-0.5">Total Claimed</div>
            <div className="font-semibold text-blue-800">{fmt(totalClaimed, displayCurrency)}</div>
          </div>
          <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-center">
            <div className="text-xs text-green-500 mb-0.5">Total Approved</div>
            <div className="font-semibold text-green-800">{fmt(totalApproved, displayCurrency)}</div>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="card-filter-bar flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Search</label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Claim number…"
              className="w-full min-w-[140px] rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select All</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Health Insurance</label>
            <select
              value={healthInsuranceFilter}
              onChange={e => setHealthInsuranceFilter(e.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-sm min-w-[160px] focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select All</option>
              {insuranceOptions.map(o => (
                <option key={o.name} value={o.name}>{o.label || o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Patient Category</label>
            <select
              value={patientCategoryFilter}
              onChange={e => setPatientCategoryFilter(e.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-sm min-w-[140px] focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select All</option>
              {categoryOptions.map(o => (
                <option key={o.name} value={o.name}>{o.label || o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">IP / OP</label>
            <select
              value={ipOpFilter}
              onChange={e => setIpOpFilter(e.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-sm min-w-[110px] focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All</option>
              {IP_OP_SOURCE_OPTIONS.map(source => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {loading && <div className="text-center text-sm text-slate-400 py-6">Loading…</div>}
      {error && <div className="text-sm text-red-600 py-2">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Claim No</th>
                {!patient && (
                  <th className="px-3 py-2 text-xs font-semibold text-slate-600">Patient</th>
                )}
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Category</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">IP/OP</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Health Insurance</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Claim Date</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Claimed</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Approved</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Rejected</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Auth No</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">VCH Status</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Status</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={patient ? 12 : 13} className="text-center text-slate-400 py-8">No insurance claims found</td>
                </tr>
              )}
              {rows.map(row => (
                <tr
                  key={row.name}
                  className="border-t border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setDetailRow(row)}
                >
                  <td className="px-3 py-2">
                    <span className="text-primary font-medium text-xs">{row.name}</span>
                  </td>
                  {!patient && (
                    <td
                      className="px-3 py-2 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (row.patient) onPatientClick?.(row.patient)
                      }}
                    >
                      <span className="font-medium text-primary hover:underline">
                        <div className="text-xs">{row.patient_name || row.patient}</div>
                        {row.patient_name && <div className="text-slate-400 text-xs">{row.patient}</div>}
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2 text-xs text-slate-500">{row.patient_category || '—'}</td>
                  <td className="px-3 py-2">
                    {row.ip_op_source ? (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLORS[row.ip_op_source] || 'bg-slate-100 text-slate-600'}`}>
                        {row.ip_op_source}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{row.health_insurance || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.claim_date || '—'}</td>
                  <td className="px-3 py-2 text-xs text-right font-mono text-slate-700">{fmt(row.total_claimed, displayCurrency)}</td>
                  <td className="px-3 py-2 text-xs text-right font-mono text-green-700">{fmt(row.total_approved, displayCurrency)}</td>
                  <td className="px-3 py-2 text-xs text-right font-mono text-red-600">{fmt(row.total_rejected, displayCurrency)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 font-mono">{row.authorization_no || '—'}</td>
                  <td className="px-3 py-2">
                    {vchStatusLabel(row.vch_status) ? (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${vchStatusLabel(row.vch_status) === 'Approved' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                        {vchStatusLabel(row.vch_status)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] || 'bg-slate-100 text-slate-600'}`}>
                      {row.status || 'Draft'}
                    </span>
                  </td>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <PrintFormatDropdown doctype="Insurance Claim" docName={row.name} />
                      <ThreeDotBtn row={row} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail slide-over */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={() => setDetailRow(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 h-full w-full max-w-2xl bg-white shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-800">{detailRow.name}</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[detailRow.status] || 'bg-slate-100 text-slate-600'}`}>
                    {detailRow.status || 'Draft'}
                  </span>
                  <a
                    href={`/app/insurance-claim/${encodeURIComponent(detailRow.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline flex-shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open in Frappe
                  </a>
                  <PrintFormatDropdown doctype="Insurance Claim" docName={detailRow.name} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{detailRow.patient_name || detailRow.patient}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Financial summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-3 text-center">
                  <p className="text-base font-bold text-blue-800">{fmt(detailRow.total_claimed, displayCurrency)}</p>
                  <p className="text-xs text-blue-500 mt-0.5">Claimed</p>
                </div>
                <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-3 text-center">
                  <p className="text-base font-bold text-green-800">{fmt(detailRow.total_approved, displayCurrency)}</p>
                  <p className="text-xs text-green-500 mt-0.5">Approved</p>
                </div>
                <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-3 text-center">
                  <p className="text-base font-bold text-red-700">{fmt(detailRow.total_rejected, displayCurrency)}</p>
                  <p className="text-xs text-red-400 mt-0.5">Rejected</p>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-3 text-center">
                  <p className="text-base font-bold text-amber-800">{fmt(detailRow.total_patient_liability, displayCurrency)}</p>
                  <p className="text-xs text-amber-500 mt-0.5">Patient Liability</p>
                </div>
              </div>

              {/* Details */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Claim Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Patient" value={detailRow.patient_name || detailRow.patient} />
                  <Field label="Patient ID" value={detailRow.patient} />
                  <Field label="Health Insurance" value={detailRow.health_insurance} />
                  <Field label="Insurer / Payor" value={detailRow.insurance_payor} />
                  <Field label="Claim Date" value={detailRow.claim_date} />
                  <Field label="IP / OP Source" value={detailRow.ip_op_source} />
                  <Field label="VCH Status" value={vchStatusLabel(detailRow.vch_status)} />
                  <Field label="Sales Invoice" value={detailRow.sales_invoice} />
                  <Field label="Authorization No" value={detailRow.authorization_no} />
                  <div className="col-span-2">
                    <p className="text-xs text-slate-500 mb-0.5">Remark</p>
                    <p className="text-sm text-slate-800">{detailRow.remark || <span className="text-slate-400 italic">—</span>}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={() => { guardClinicalEdit(() => setUpdateTarget(detailRow)); setDetailRow(null) }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition"
              >
                Update Status &amp; Payment
              </button>
              {(detailRow.docstatus === 0 || detailRow.status === 'Draft') && onEditDraft && (
                <button
                  type="button"
                  onClick={() => { guardClinicalEdit(() => { onEditDraft(detailRow.name); setDetailRow(null) }) }}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 transition"
                >
                  Edit Draft
                </button>
              )}
              {detailRow.status !== 'Rejected' && (
                <button
                  type="button"
                  disabled={rejecting === detailRow.name}
                  onClick={() => guardClinicalEdit(() => handleReject(detailRow))}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
                >
                  {rejecting === detailRow.name ? 'Rejecting…' : 'Reject Claim'}
                </button>
              )}
              <PrintFormatDropdown
                doctype="Insurance Claim"
                docName={detailRow.name}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 transition"
                ariaLabel="Print claim"
                title="Print claim"
              />
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update Claim Modal */}
      {updateTarget && (
        <UpdateClaimModal
          row={updateTarget}
          currency={displayCurrency}
          onClose={() => setUpdateTarget(null)}
          onSuccess={updates => handleUpdateSuccess(updateTarget.name, updates)}
        />
      )}
    </div>
  )
}
