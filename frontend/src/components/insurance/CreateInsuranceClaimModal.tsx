import { useState, useCallback, useEffect } from 'react'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_BODY_GRADIENT,
  CREATE_MODAL_FOOTER_STICKY,
  CREATE_MODAL_OVERLAY,
  CREATE_MODAL_TAB_BAR,
  CreateModalHeader,
  createModalShellClass,
  createModalTabButtonClass,
  MODAL_FIELD_CLASS_COMPACT,
  MODAL_LABEL_CLASS,
  MODAL_SECTION_CLASS,
  MODAL_SECTION_TITLE_CLASS,
} from '../ui/CreateModalChrome'
import { Plus, Trash2, FileText, AlertCircle } from 'lucide-react'
import { fetchHealthcareInsurance, fetchInsuranceClaimDetail, saveInsuranceClaim, type LinkFieldOption, type InvoiceNeedingClaimRow } from '../../services/common'
import {
  searchPatients,
  fetchPatients,
  fetchPatientById,
  fetchPatientDoc,
  type PatientListItem,
  type PatientInsuranceCoverageRow,
} from '../../services/patients'
import {
  linkComboboxDropdownClassShort,
  linkComboboxInputClassCompact,
  linkComboboxOptionClassCompact,
} from '../ui/linkComboboxStyles'
import { DateFilterInput } from '../ui/DateFilterInput'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClaimItemRow {
  id: number
  service_type: string
  item_name: string
  description: string
  qty?: string
  rate?: string
  discount_percentage?: string
  discount_amount?: string
  net_amount?: string
  gross_amount: string
  covered_amount: string
  co_pay_amount: string
  non_covered_amount: string
  patient_liability: string
  paid_amount: string
  sales_invoice?: string
  sales_invoice_item?: string
}

interface InvoiceOption {
  name: string
  posting_date: string
  grand_total: number
  discount_amount: number
  outstanding_amount: number
  claimed_amount?: number
  remaining_claimable?: number
  status: string
  custom_base_reference: string | null
  custom_base_reference_name: string | null
  custom_reference_type?: string | null
}

interface PatientCoverageOption extends PatientInsuranceCoverageRow {
  id: string
  label: string
}

const SERVICE_TYPES = ['OP', 'IP', 'Lab', 'Pharmacy', 'Other']
const IP_OP_SOURCE_OPTIONS = ['OP', 'IP', 'PH']
const STATUS_OPTIONS = ['Draft', 'Submitted', 'Partially Paid', 'Paid', 'Rejected']

// Sales Invoice healthcare references that identify an Inpatient / Outpatient case.
const IP_REFERENCE_VALUES = ['Inpatient Admission', 'Discharge', 'IP Service']
const OP_REFERENCE_VALUES = ['Patient Visit']

type InvoiceReference = {
  custom_reference_type?: string | null
  custom_base_reference?: string | null
}

/** Map a Sales Invoice's healthcare reference to an IP / OP Source value. */
function invoiceIpOpSource(inv: InvoiceReference): string {
  const refType = (inv.custom_reference_type || '').trim()
  if (IP_REFERENCE_VALUES.includes(refType)) return 'IP'
  if (OP_REFERENCE_VALUES.includes(refType)) return 'OP'
  const baseRef = (inv.custom_base_reference || '').trim()
  if (IP_REFERENCE_VALUES.includes(baseRef)) return 'IP'
  if (OP_REFERENCE_VALUES.includes(baseRef)) return 'OP'
  return ''
}

/** Infer the claim-level IP / OP Source from the selected invoices. */
function inferIpOpSource(invoices: InvoiceReference[]): string {
  for (const inv of invoices) {
    const source = invoiceIpOpSource(inv)
    if (source) return source
  }
  return ''
}

function invoiceServiceType(inv: InvoiceReference): string {
  return invoiceIpOpSource(inv) || 'OP'
}

// ─── Generic searchable link field ────────────────────────────────────────────

interface LinkFieldProps {
  label: string
  required?: boolean
  placeholder?: string
  query: string
  options: LinkFieldOption[]
  selected: LinkFieldOption | null
  open: boolean
  onFocus: () => void
  onQueryChange: (q: string) => void
  onSelect: (opt: LinkFieldOption) => void
  onClear: () => void
  onOpenChange: (v: boolean) => void
}

function LinkField({
  label, required, placeholder, query, options, selected,
  open, onFocus, onQueryChange, onSelect, onClear, onOpenChange,
}: LinkFieldProps) {
  return (
    <div onClick={e => e.stopPropagation()}>
      <label className={`${MODAL_LABEL_CLASS} text-xs`}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <input
          type="text"
          value={selected ? (selected.label || selected.name) : query}
          onChange={e => { onQueryChange(e.target.value); onOpenChange(true) }}
          onFocus={() => { onFocus(); onOpenChange(true) }}
          placeholder={placeholder || `Search ${label}…`}
          className={`${linkComboboxInputClassCompact} pr-7`}
        />
        {(selected || query) && (
          <button type="button" onClick={() => { onClear(); onQueryChange('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs transition-colors">✕</button>
        )}
        {open && options.length > 0 && (
          <div className={linkComboboxDropdownClassShort}>
            {options.map(o => (
              <button key={o.name} type="button"
                onClick={() => { onSelect(o); onOpenChange(false) }}
                className={linkComboboxOptionClassCompact}>
                {o.label || o.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Multi invoice picker ──────────────────────────────────────────────────────

interface InvoiceMultiSelectProps {
  invoices: InvoiceOption[]
  selected: InvoiceOption[]
  loading: boolean
  patientSelected: boolean
  onToggle: (inv: InvoiceOption) => void
  onClear: () => void
}

function InvoiceMultiSelect({
  invoices, selected, loading, patientSelected, onToggle, onClear,
}: InvoiceMultiSelectProps) {
  const selectedNames = new Set(selected.map(s => s.name))
  const fmtCurrency = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  const totalOutstanding = selected.reduce(
    (s, inv) => s + (inv.remaining_claimable ?? inv.outstanding_amount ?? 0),
    0,
  )

  return (
    <div onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-slate-700">
          Sales Invoices <span className="text-slate-400 font-normal">(select one or more)</span>
        </label>
        {selected.length > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-slate-500 hover:text-slate-700">
            Clear all
          </button>
        )}
      </div>

      {!patientSelected ? (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          Select a patient first to load their invoices
        </div>
      ) : loading ? (
        <div className="rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-400 animate-pulse">
          Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" />
          No unpaid invoices found for this patient
        </div>
      ) : (
        <div className="rounded border border-slate-300 bg-white max-h-56 overflow-y-auto divide-y divide-slate-100">
          {invoices.map(inv => {
            const checked = selectedNames.has(inv.name)
            const source = invoiceIpOpSource(inv)
            return (
              <label
                key={inv.name}
                className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors ${checked ? 'bg-blue-50/70' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(inv)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800 text-sm">{inv.name}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${inv.status === 'Unpaid' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                      {inv.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-500">
                    <span>{inv.posting_date}</span>
                    {source && (
                      <span className="font-semibold text-indigo-600">{source}</span>
                    )}
                    <span>Total: <strong className="text-slate-700">{fmtCurrency(inv.grand_total)}</strong></span>
                    <span>Claimable: <strong className="text-orange-600">{fmtCurrency(inv.remaining_claimable ?? inv.outstanding_amount)}</strong></span>
                    {inv.custom_base_reference && (
                      <span className="text-blue-500">{inv.custom_base_reference}: {inv.custom_base_reference_name}</span>
                    )}
                  </div>
                </div>
              </label>
            )
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">
              <strong>{selected.length}</strong> invoice{selected.length === 1 ? '' : 's'} selected
            </span>
            <span className="text-slate-600">
              Combined claimable:{' '}
              <strong className="text-orange-700">{fmtCurrency(totalOutstanding)}</strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selected.map(inv => (
              <span
                key={inv.name}
                className="inline-flex items-center gap-1 rounded-full bg-white border border-blue-200 px-2 py-0.5 text-xs text-slate-700"
              >
                {inv.name}
                <button
                  type="button"
                  onClick={() => onToggle(inv)}
                  className="text-slate-400 hover:text-slate-600"
                  aria-label={`Remove ${inv.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface CreateInsuranceClaimModalProps {
  onClose: () => void
  onSuccess?: (claimName: string) => void
  initialPatient?: string
  initialInvoice?: InvoiceNeedingClaimRow
  editClaimName?: string
}

let _itemId = 0
const newRow = (): ClaimItemRow => ({
  id: ++_itemId,
  service_type: 'OP',
  item_name: '',
  description: '',
  gross_amount: '',
  covered_amount: '',
  co_pay_amount: '',
  non_covered_amount: '',
  patient_liability: '',
  paid_amount: '',
})

const to3 = (n: number) => Math.round(n * 1000) / 1000

function formatCoverageLabel(row: PatientInsuranceCoverageRow, index: number): string {
  const parts = [
    row.health_insurance || `Insurance ${index + 1}`,
    row.insurance_policy_no ? `Policy ${row.insurance_policy_no}` : '',
    row.insurance_register ? `Register ${row.insurance_register}` : '',
  ].filter(Boolean)
  return parts.join(' • ')
}

function distributeClaimAmount(rows: ClaimItemRow[], amount: number): ClaimItemRow[] {
  const validAmount = Math.max(to3(amount), 0)
  const totalGross = rows.reduce((sum, row) => sum + (parseFloat(row.gross_amount) || 0), 0)
  if (!rows.length || totalGross <= 0) return rows

  let allocated = 0
  return rows.map((row, index) => {
    const gross = parseFloat(row.gross_amount) || 0
    const share = index === rows.length - 1
      ? to3(validAmount - allocated)
      : to3((gross / totalGross) * validAmount)
    allocated = to3(allocated + share)
    const covered = Math.min(gross, Math.max(share, 0))
    const patientLiability = Math.max(to3(gross - covered), 0)
    return {
      ...row,
      covered_amount: covered.toFixed(3),
      patient_liability: patientLiability.toFixed(3),
    }
  })
}

export const CreateInsuranceClaimModal = ({
  onClose, onSuccess, initialPatient, initialInvoice, editClaimName,
}: CreateInsuranceClaimModalProps) => {
  const isEdit = Boolean(editClaimName)
  // Basic fields
  const [claimDate, setClaimDate] = useState(new Date().toISOString().split('T')[0])
  const [status, setStatus] = useState('Submitted')

  // Health Insurance link
  const [insOpts, setInsOpts] = useState<LinkFieldOption[]>([])
  const [insOpen, setInsOpen] = useState(false)
  const [insQuery, setInsQuery] = useState('')
  const [selectedIns, setSelectedIns] = useState<LinkFieldOption | null>(null)
  const [patientCoverages, setPatientCoverages] = useState<PatientCoverageOption[]>([])
  const [selectedCoverageId, setSelectedCoverageId] = useState('')
  const [claimAmount, setClaimAmount] = useState('')

  // Patient (same pattern as CreateAdmissionModal)
  const [patientQuery, setPatientQuery] = useState(initialPatient || '')
  const [selectedPatient, setSelectedPatient] = useState<PatientListItem | null>(
    initialPatient ? { name: initialPatient, patient_name: initialPatient } as PatientListItem : null
  )
  const [patients, setPatients] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientLoading, setPatientLoading] = useState(false)

  // Navbar only passes the patient id — resolve the display name.
  useEffect(() => {
    if (!initialPatient || initialInvoice || editClaimName) return
    let cancelled = false
    fetchPatientById(initialPatient)
      .then((match) => {
        if (cancelled || !match) return
        setSelectedPatient(match)
        setPatientQuery(match.patient_name || match.name)
      })
      .catch(() => {
        /* keep id fallback */
      })
    return () => {
      cancelled = true
    }
  }, [initialPatient, initialInvoice, editClaimName])

  // Invoices (multi-select)
  const [invoices, setInvoices] = useState<InvoiceOption[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [selectedInvoices, setSelectedInvoices] = useState<InvoiceOption[]>([])
  // Claim-level IP / OP Source, auto-filled from the selected invoices
  const [ipOpSource, setIpOpSource] = useState('')

  // Claim items
  const [items, setItems] = useState<ClaimItemRow[]>([newRow()])

  const [saving, setSaving] = useState(false)
  const [loadingClaim, setLoadingClaim] = useState(Boolean(editClaimName))
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'info' | 'items'>('info')
  const [editClaimId, setEditClaimId] = useState<string | undefined>(editClaimName)

  // ─── Loaders ──────────────────────────────────────────────────────────────

  const loadInsurance = useCallback(async (q?: string) => {
    const opts = await fetchHealthcareInsurance(q)
    setInsOpts(opts)
  }, [])

  // Patient search — same useEffect pattern as CreateAdmissionModal
  useEffect(() => {
    if (!patientOpen) return
    const search = async () => {
      setPatientLoading(true)
      try {
        const results = patientQuery.trim() === ''
          ? await fetchPatients(20, 0)
          : await searchPatients(patientQuery, 20)
        setPatients(results)
      } catch { setPatients([]) } finally { setPatientLoading(false) }
    }
    const t = setTimeout(search, patientQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [patientQuery, patientOpen])

  const loadInvoices = useCallback(async (patientName: string) => {
    setInvoicesLoading(true)
    setInvoices([])
    setSelectedInvoices([])
    try {
      const res = await fetch(
        `/api/method/healthcare.api.common.get_patient_unpaid_invoices?patient=${encodeURIComponent(patientName)}`
      )
      const data = await res.json()
      if (data?.message) {
        setInvoices(data.message as InvoiceOption[])
      }
    } catch { /* ignore */ } finally {
      setInvoicesLoading(false)
    }
  }, [])

  const loadPatientCoverages = useCallback(async (patientName: string) => {
    try {
      const patient = await fetchPatientDoc(patientName)
      const rows = (patient.patient_insurance_coverages || [])
        .filter(row => row.health_insurance)
        .map((row, index) => ({
          ...row,
          id: row.name || `${row.health_insurance || 'insurance'}-${index}`,
          label: formatCoverageLabel(row, index),
        }))
      setPatientCoverages(rows)
      if (rows.length) {
        const active = rows.find(row => row.is_active === 1) || rows[0]
        setSelectedCoverageId(active.id)
        if (active.health_insurance) {
          setSelectedIns({ name: active.health_insurance, label: active.health_insurance })
          setInsQuery(active.health_insurance)
        }
      } else {
        setPatientCoverages([])
        setSelectedCoverageId('')
      }
    } catch {
      setPatientCoverages([])
      setSelectedCoverageId('')
    }
  }, [])

  const mapInvoiceLines = useCallback((
    invoiceName: string,
    msgItems: Array<{
      item_code: string
      item_name: string
      description: string
      qty: number
      rate: number
      amount: number
      net_amount: number
      discount_percentage: number
      discount_amount: number
    }>,
    claimableAmount: number,
    defaultServiceType: string,
  ): ClaimItemRow[] => {
    const mapped: ClaimItemRow[] = msgItems.map(item => ({
      id: ++_itemId,
      service_type: defaultServiceType || 'OP',
      item_name: item.item_name || '',
      description: item.description || '',
      qty: String(item.qty ?? ''),
      rate: String(item.rate ?? ''),
      discount_percentage: String(item.discount_percentage ?? ''),
      discount_amount: String(item.discount_amount ?? ''),
      net_amount: String(item.net_amount ?? item.amount ?? ''),
      gross_amount: String(item.net_amount ?? item.amount ?? ''),
      covered_amount: String(item.net_amount ?? item.amount ?? ''),
      co_pay_amount: '',
      non_covered_amount: '',
      patient_liability: '',
      paid_amount: '',
      sales_invoice: invoiceName,
      sales_invoice_item: item.item_code || '',
    }))
    return distributeClaimAmount(mapped, to3(claimableAmount || 0))
  }, [])

  const fetchInvoiceLines = useCallback(async (invoiceName: string) => {
    const res = await fetch(
      `/api/method/healthcare.api.common.get_sales_invoice_with_items?invoice_name=${encodeURIComponent(invoiceName)}`
    )
    const data = await res.json()
    return data?.message || null
  }, [])

  const syncClaimAmountFromInvoices = useCallback((list: InvoiceOption[]) => {
    const total = list.reduce(
      (sum, inv) => sum + (inv.remaining_claimable ?? inv.outstanding_amount ?? 0),
      0,
    )
    const normalized = to3(total)
    setClaimAmount(normalized ? normalized.toFixed(3) : '')
  }, [])

  const toggleInvoice = useCallback(async (inv: InvoiceOption) => {
    const already = selectedInvoices.some(s => s.name === inv.name)
    if (already) {
      const next = selectedInvoices.filter(s => s.name !== inv.name)
      setSelectedInvoices(next)
      setIpOpSource(inferIpOpSource(next))
      setItems(prev => {
        const remaining = prev.filter(r => r.sales_invoice !== inv.name)
        return remaining.length ? remaining : [newRow()]
      })
      syncClaimAmountFromInvoices(next)
      return
    }

    const next = [...selectedInvoices, inv]
    setSelectedInvoices(next)
    setIpOpSource(inferIpOpSource(next))
    try {
      const msg = await fetchInvoiceLines(inv.name)
      if (msg?.items?.length) {
        const claimable =
          inv.remaining_claimable ??
          inv.outstanding_amount ??
          msg.items.reduce(
            (sum: number, item: { net_amount: number; amount: number }) =>
              sum + (item.net_amount ?? item.amount ?? 0),
            0,
          )
        const mapped = mapInvoiceLines(inv.name, msg.items, claimable, invoiceServiceType(inv))
        setItems(prev => {
          const withoutEmptyManual = prev.filter(
            r => r.sales_invoice || r.item_name.trim() || r.gross_amount,
          )
          const base = withoutEmptyManual.some(r => r.sales_invoice || r.item_name.trim())
            ? withoutEmptyManual
            : []
          return [...base.filter(r => r.sales_invoice !== inv.name), ...mapped]
        })
      }
      if (msg?.custom_health_insurance && !selectedIns) {
        setSelectedIns({ name: msg.custom_health_insurance, label: msg.custom_health_insurance })
        setInsQuery(msg.custom_health_insurance)
      }
    } catch { /* ignore */ }
    syncClaimAmountFromInvoices(next)
  }, [
    selectedInvoices, fetchInvoiceLines, mapInvoiceLines, selectedIns, syncClaimAmountFromInvoices,
  ])

  const clearInvoices = useCallback(() => {
    setSelectedInvoices([])
    setItems([newRow()])
    setClaimAmount('')
    setIpOpSource('')
  }, [])

  // Load invoices when patient changes
  useEffect(() => {
    if (selectedPatient?.name) {
      loadInvoices(selectedPatient.name)
      loadPatientCoverages(selectedPatient.name)
    } else {
      setInvoices([])
      setSelectedInvoices([])
      setPatientCoverages([])
      setSelectedCoverageId('')
    }
  }, [selectedPatient?.name, loadInvoices, loadPatientCoverages])

  // Pre-load initial patient invoices
  useEffect(() => {
    if (initialPatient) {
      loadInvoices(initialPatient)
      loadPatientCoverages(initialPatient)
    }
  }, [initialPatient, loadInvoices, loadPatientCoverages])

  // Pre-select invoice from "needs claim" card
  useEffect(() => {
    if (!initialInvoice || isEdit) return
    const inv: InvoiceOption = {
      name: initialInvoice.name,
      posting_date: initialInvoice.posting_date,
      grand_total: initialInvoice.grand_total,
      discount_amount: initialInvoice.discount_amount,
      outstanding_amount: initialInvoice.outstanding_amount,
      claimed_amount: initialInvoice.claimed_amount,
      remaining_claimable: initialInvoice.remaining_claimable,
      status: initialInvoice.status,
      custom_base_reference: initialInvoice.custom_base_reference,
      custom_base_reference_name: initialInvoice.custom_base_reference_name,
      custom_reference_type: initialInvoice.custom_reference_type,
    }
    if (initialInvoice.patient) {
      setSelectedPatient({ name: initialInvoice.patient, patient_name: initialInvoice.patient_name || initialInvoice.patient } as PatientListItem)
      setPatientQuery(initialInvoice.patient_name || initialInvoice.patient)
    }
    setSelectedInvoices([inv])
    setIpOpSource(inferIpOpSource([inv]))
    if (initialInvoice.custom_health_insurance) {
      setSelectedIns({ name: initialInvoice.custom_health_insurance, label: initialInvoice.custom_health_insurance })
      setInsQuery(initialInvoice.custom_health_insurance)
    }
    const baseAmount = initialInvoice.remaining_claimable ?? initialInvoice.outstanding_amount
    setClaimAmount(baseAmount ? to3(baseAmount).toFixed(3) : '')
    // Load lines for the pre-selected invoice
    fetchInvoiceLines(inv.name)
      .then(msg => {
        if (!msg?.items?.length) return
        setItems(mapInvoiceLines(inv.name, msg.items, baseAmount || 0, invoiceServiceType(inv)))
      })
      .catch(() => { /* ignore */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoice])

  // Load existing draft for edit
  useEffect(() => {
    if (!editClaimName) return
    let cancelled = false
    setLoadingClaim(true)
    fetchInsuranceClaimDetail(editClaimName)
      .then(detail => {
        if (cancelled || !detail) return
        setEditClaimId(detail.name)
        setClaimDate(detail.claim_date || new Date().toISOString().split('T')[0])
        setStatus(detail.status || 'Draft')
        setIpOpSource(detail.ip_op_source || '')
        setSelectedPatient({ name: detail.patient, patient_name: detail.patient_name || detail.patient } as PatientListItem)
        setPatientQuery(detail.patient_name || detail.patient)
        if (detail.health_insurance) {
          setSelectedIns({ name: detail.health_insurance, label: detail.health_insurance })
          setInsQuery(detail.health_insurance)
        }
        if (detail.patient_insurance_coverage) {
          setSelectedCoverageId(detail.patient_insurance_coverage)
        }
        const invNames = Array.from(new Set([
          ...(detail.sales_invoices || []),
          detail.sales_invoice || '',
          ...(detail.claim_items || []).map(ci => ci.sales_invoice || ''),
        ].filter(Boolean))) as string[]
        if (invNames.length) {
          setSelectedInvoices(invNames.map((name, idx) => ({
            name,
            posting_date: '',
            grand_total: idx === 0 ? detail.total_claimed : 0,
            discount_amount: 0,
            outstanding_amount: 0,
            claimed_amount: idx === 0 ? detail.total_claimed : 0,
            remaining_claimable: idx === 0 ? detail.total_claimed : 0,
            status: '',
            custom_base_reference: idx === 0 ? detail.reference_doctype : null,
            custom_base_reference_name: idx === 0 ? detail.reference_name : null,
            custom_reference_type: idx === 0 ? detail.reference_doctype : null,
          })))
        }
        if (detail.claim_items?.length) {
          setClaimAmount((detail.total_claimed ?? 0).toFixed(3))
          setItems(detail.claim_items.map(ci => ({
            id: ++_itemId,
            service_type: ci.service_type || 'OP',
            item_name: ci.item_name || '',
            description: ci.description || '',
            gross_amount: String(ci.gross_amount ?? ''),
            covered_amount: String(ci.covered_amount ?? ''),
            co_pay_amount: String(ci.co_pay_amount ?? ''),
            non_covered_amount: String(ci.non_covered_amount ?? ''),
            patient_liability: String(ci.patient_liability ?? ''),
            paid_amount: String(ci.paid_amount ?? ''),
            sales_invoice: ci.sales_invoice || detail.sales_invoice || undefined,
            sales_invoice_item: ci.sales_invoice_item,
          })))
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load claim'))
      .finally(() => { if (!cancelled) setLoadingClaim(false) })
    return () => { cancelled = true }
  }, [editClaimName])

  useEffect(() => {
    if (!selectedCoverageId) return
    const coverage = patientCoverages.find(row => row.id === selectedCoverageId)
    if (!coverage?.health_insurance) return
    setSelectedIns({ name: coverage.health_insurance, label: coverage.health_insurance })
    setInsQuery(coverage.health_insurance)
  }, [patientCoverages, selectedCoverageId])

  // ─── Row helpers ──────────────────────────────────────────────────────────

  const updateItem = (id: number, field: keyof ClaimItemRow, val: string) =>
    setItems(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r))

  const handleClaimAmountChange = (value: string) => {
    if (value !== '' && !/^\d*\.?\d{0,3}$/.test(value)) return
    setClaimAmount(value)
    const parsed = parseFloat(value)
    if (!Number.isNaN(parsed)) {
      setItems(prev => distributeClaimAmount(prev, parsed))
    }
  }

  const removeItem = (id: number) =>
    setItems(prev => prev.filter(r => r.id !== id))

  const calcTotal = (field: keyof ClaimItemRow) =>
    items.reduce((s, r) => s + (parseFloat(r[field] as string) || 0), 0)

  const fmtCurrency = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

  // ─── Submit ───────────────────────────────────────────────────────────────

  const primaryInvoice = selectedInvoices[0] || null

  const buildPayload = (submit: boolean) => ({
    ...(editClaimId ? { name: editClaimId } : {}),
    patient: selectedPatient!.name,
    claim_date: claimDate || null,
    status: submit ? 'Submitted' : 'Draft',
    health_insurance: selectedIns?.name || null,
    patient_insurance_coverage: selectedCoverageId || null,
    sales_invoice: primaryInvoice?.name || null,
    sales_invoices: selectedInvoices.map(inv => inv.name),
    reference_doctype: primaryInvoice?.custom_base_reference || null,
    reference_name: primaryInvoice?.custom_base_reference_name || null,
    ip_op_source: ipOpSource || null,
    submit,
    claim_items: items
      .filter(r => r.item_name.trim() || r.gross_amount)
      .map(r => ({
        service_type: r.service_type,
        item_name: r.item_name.trim(),
        description: r.description.trim(),
        gross_amount: parseFloat(r.gross_amount) || 0,
        covered_amount: parseFloat(r.covered_amount) || 0,
        co_pay_amount: parseFloat(r.co_pay_amount) || 0,
        non_covered_amount: parseFloat(r.non_covered_amount) || 0,
        patient_liability: parseFloat(r.patient_liability) || 0,
        paid_amount: parseFloat(r.paid_amount) || 0,
        ...(r.sales_invoice ? { sales_invoice: r.sales_invoice } : {}),
        ...(r.sales_invoice_item ? { sales_invoice_item: r.sales_invoice_item } : {}),
      })),
  })

  const handleSave = async (submit: boolean) => {
    if (!selectedPatient) { setError('Patient is required'); return }

    try {
      setSaving(true)
      setError(null)
      const result = await saveInsuranceClaim(buildPayload(submit))
      onSuccess?.(result.name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save claim')
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await handleSave(true)
  }

  const itemsFromInvoice = items.some(r => r.sales_invoice_item || r.sales_invoice)

  const tabs = [
    { id: 'info' as const, label: 'Claim Info' },
    { id: 'items' as const, label: `Items (${items.length})${itemsFromInvoice ? ' ✓' : ''}` },
  ]

  return (
    <div
      className={CREATE_MODAL_OVERLAY}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={createModalShellClass('max-w-3xl h-[85vh]')}
        onClick={() => { setInsOpen(false); setPatientOpen(false) }}
      >
        <CreateModalHeader
          title={isEdit ? `Edit Insurance Claim — ${editClaimName}` : 'New Insurance Claim'}
          subtitle="Submit a claim to the insurance provider"
          icon={<FileText className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          onClose={onClose}
          alert={error || undefined}
        >
          <div className={`${CREATE_MODAL_TAB_BAR} -mx-5 px-5 sm:-mx-6 sm:px-6`}>
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={createModalTabButtonClass(activeTab === t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </CreateModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className={`${CREATE_MODAL_BODY_GRADIENT} px-6 py-5 space-y-4`} style={{ scrollbarWidth: 'thin' }}>

            {/* ── Claim Info ── */}
            {activeTab === 'info' && (
              <div className="space-y-4">
                {/* Patient & Insurance card */}
                <div className={`${MODAL_SECTION_CLASS} space-y-3`}>
                  <h3 className={MODAL_SECTION_TITLE_CLASS}>Patient & Insurance</h3>

                  {/* Patient */}
                  <div onClick={e => e.stopPropagation()}>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Patient <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={
                          selectedPatient
                            ? selectedPatient.patient_name && selectedPatient.patient_name !== selectedPatient.name
                              ? `${selectedPatient.patient_name} (${selectedPatient.name})`
                              : (selectedPatient.patient_name || selectedPatient.name)
                            : patientQuery
                        }
                        onChange={e => {
                          setSelectedPatient(null)
                          setPatientQuery(e.target.value)
                          setPatientOpen(true)
                        }}
                        onFocus={() => setPatientOpen(true)}
                        placeholder="Search patient…"
                        title={selectedPatient?.name || undefined}
                        className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2.5 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                      />
                      {patientOpen && (
                        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                          {patientLoading ? (
                            <div className="px-3 py-2 text-xs text-slate-500">Loading patients…</div>
                          ) : patients.length > 0 ? (
                            patients.map(p => (
                              <button key={p.name} type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-slate-900 transition-colors"
                                onClick={() => {
                                  setSelectedPatient(p)
                                  setPatientQuery(p.patient_name || p.name)
                                  setPatientOpen(false)
                                }}
                              >
                                <div className="font-medium">{p.patient_name || p.name}</div>
                                <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 mt-0.5">
                                  {p.file_number && <span>File: {p.file_number}</span>}
                                  {p.id_number && <span>ID: {p.id_number}</span>}
                                  {p.mobile && <span>{p.mobile}</span>}
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-xs text-slate-500">
                              {patientQuery ? 'No Patient Found.' : 'NO PATIENTS FOUND.'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {patientCoverages.length > 0 ? (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Patient Insurance</label>
                      <select
                        value={selectedCoverageId}
                        onChange={e => setSelectedCoverageId(e.target.value)}
                        className={MODAL_FIELD_CLASS_COMPACT}
                      >
                        <option value="">Select insurance coverage…</option>
                        {patientCoverages.map(row => (
                          <option key={row.id} value={row.id}>
                            {row.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <LinkField
                      label="Health Insurance"
                      placeholder="Search insurance record…"
                      query={insQuery}
                      options={insOpts}
                      selected={selectedIns}
                      open={insOpen}
                      onFocus={() => loadInsurance()}
                      onQueryChange={q => { setInsQuery(q); loadInsurance(q) }}
                      onSelect={o => { setSelectedIns(o); setInsQuery(o.label || o.name) }}
                      onClear={() => { setSelectedIns(null); setInsQuery('') }}
                      onOpenChange={setInsOpen}
                    />
                  )}
                </div>

                {/* Invoice selection card */}
                <div className={`${MODAL_SECTION_CLASS} space-y-3`}>
                  <h3 className={MODAL_SECTION_TITLE_CLASS}>Invoices</h3>
                  <InvoiceMultiSelect
                    invoices={invoices}
                    selected={selectedInvoices}
                    loading={invoicesLoading}
                    patientSelected={!!selectedPatient}
                    onToggle={toggleInvoice}
                    onClear={clearInvoices}
                  />
                </div>

                {/* Claim details card */}
                <div className={`${MODAL_SECTION_CLASS} space-y-3`}>
                  <h3 className={MODAL_SECTION_TITLE_CLASS}>Claim Details</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Claim Date</label>
                      <DateFilterInput value={claimDate} onChange={e => setClaimDate(e.target.value)}
                        className={MODAL_FIELD_CLASS_COMPACT} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                      <select value={status} onChange={e => setStatus(e.target.value)}
                        className={MODAL_FIELD_CLASS_COMPACT}>
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">IP / OP Source</label>
                      <select value={ipOpSource} onChange={e => setIpOpSource(e.target.value)}
                        className={MODAL_FIELD_CLASS_COMPACT}>
                        <option value="">Select IP / OP…</option>
                        {IP_OP_SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <p className="text-[11px] text-slate-400 mt-0.5">Auto-filled from the selected invoice</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Claim Amount</label>
                      <input
                        type="text"
                        value={claimAmount}
                        onChange={e => handleClaimAmountChange(e.target.value)}
                        placeholder="0.000"
                        className={MODAL_FIELD_CLASS_COMPACT}
                      />
                    </div>
                  </div>
                  {selectedInvoices.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Remaining claimable across selected invoice{selectedInvoices.length === 1 ? '' : 's'}:{' '}
                      <strong>
                        {fmtCurrency(
                          selectedInvoices.reduce(
                            (s, inv) => s + (inv.remaining_claimable ?? inv.outstanding_amount ?? 0),
                            0,
                          ),
                        )}
                      </strong>
                    </p>
                  )}
                </div>

                {/* Totals preview */}
                {items.some(r => r.gross_amount) && (
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
                      <div className="text-xs text-blue-500 mb-0.5">Total Gross</div>
                      <div className="font-semibold text-blue-800 text-sm">{fmtCurrency(calcTotal('gross_amount'))}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 border border-green-100 p-3">
                      <div className="text-xs text-green-500 mb-0.5">Total Covered</div>
                      <div className="font-semibold text-green-800 text-sm">{fmtCurrency(calcTotal('covered_amount'))}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                      <div className="text-xs text-amber-500 mb-0.5">Patient Liability</div>
                      <div className="font-semibold text-amber-800 text-sm">{fmtCurrency(calcTotal('patient_liability'))}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Claim Items ── */}
            {activeTab === 'items' && (
              <div className="space-y-3">
                {itemsFromInvoice && (
                  <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    Items loaded from{' '}
                    <strong>
                      {selectedInvoices.length > 1
                        ? `${selectedInvoices.length} invoices`
                        : (selectedInvoices[0]?.name || 'invoice')}
                    </strong>
                    . Review qty, rate, discounts, and claim amounts below.
                  </div>
                )}
                {itemsFromInvoice && items.some(r => r.qty) && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-left">
                          {selectedInvoices.length > 1 && (
                            <th className="px-2 py-1.5 font-semibold text-slate-600">Invoice</th>
                          )}
                          <th className="px-2 py-1.5 font-semibold text-slate-600">Item</th>
                          <th className="px-2 py-1.5 font-semibold text-slate-600 text-right">Qty</th>
                          <th className="px-2 py-1.5 font-semibold text-slate-600 text-right">Rate</th>
                          <th className="px-2 py-1.5 font-semibold text-slate-600 text-right">Disc %</th>
                          <th className="px-2 py-1.5 font-semibold text-slate-600 text-right">Net</th>
                          <th className="px-2 py-1.5 font-semibold text-slate-600 text-right">Claim</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.filter(r => r.item_name.trim()).map(row => (
                          <tr key={row.id} className="border-t border-slate-100">
                            {selectedInvoices.length > 1 && (
                              <td className="px-2 py-1.5 text-slate-500 font-mono">{row.sales_invoice || '—'}</td>
                            )}
                            <td className="px-2 py-1.5">{row.item_name}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{row.qty || '—'}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{row.rate || '—'}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-green-700">{row.discount_percentage ? `${row.discount_percentage}%` : '—'}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{row.net_amount || row.gross_amount || '—'}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-primary">{row.covered_amount || row.gross_amount || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">{itemsFromInvoice ? 'Review and adjust amounts (3 decimal places for BDH)' : 'Add services and amounts for this claim (3 decimal places for BDH)'}</p>
                  <button
                    type="button"
                    onClick={() => setItems(prev => [...prev, newRow()])}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Item
                  </button>
                </div>

                {items.map((row, idx) => (
                  <div key={row.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-slate-500">Item #{idx + 1}</span>
                        {row.sales_invoice && (
                          <span className="truncate rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">
                            {row.sales_invoice}
                          </span>
                        )}
                      </div>
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeItem(row.id)}
                          className="text-red-400 hover:text-red-600 p-1 rounded transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Service Type</label>
                        <select value={row.service_type}
                          onChange={e => updateItem(row.id, 'service_type', e.target.value)}
                          className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
                          {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Item / Service Name</label>
                        <input type="text" value={row.item_name}
                          onChange={e => updateItem(row.id, 'item_name', e.target.value)}
                          placeholder="e.g. Consultation fee"
                          className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2.5 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                        <input type="text" value={row.description}
                          onChange={e => updateItem(row.id, 'description', e.target.value)}
                          placeholder="Optional description"
                          className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2.5 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {(
                        [
                          { field: 'gross_amount', label: 'Gross Amount' },
                          { field: 'covered_amount', label: 'Covered Amount' },
                          { field: 'co_pay_amount', label: 'Co-pay Amount' },
                          { field: 'non_covered_amount', label: 'Non-covered' },
                          { field: 'patient_liability', label: 'Patient Liability' },
                          { field: 'paid_amount', label: 'Paid Amount' },
                        ] as { field: keyof ClaimItemRow; label: string }[]
                      ).map(({ field, label }) => (
                        <div key={field}>
                          <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
                          <input type="text" value={row[field] as string}
                            onChange={e => {
                              const val = e.target.value
                              // Allow 3 decimal places for BDH
                              if (val === '' || /^\d*\.?\d{0,3}$/.test(val)) {
                                updateItem(row.id, field, val)
                              }
                            }}
                            placeholder="0.000" 
                            className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2.5 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Totals summary at bottom of items */}
                {items.some(r => r.gross_amount) && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Totals</h4>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      {(
                        [
                          { field: 'gross_amount', label: 'Gross', color: 'text-slate-800' },
                          { field: 'covered_amount', label: 'Covered', color: 'text-green-700' },
                          { field: 'co_pay_amount', label: 'Co-pay', color: 'text-amber-700' },
                          { field: 'non_covered_amount', label: 'Non-covered', color: 'text-red-600' },
                          { field: 'patient_liability', label: 'Pt. Liability', color: 'text-orange-700' },
                          { field: 'paid_amount', label: 'Paid', color: 'text-blue-700' },
                        ] as { field: keyof ClaimItemRow; label: string; color: string }[]
                      ).map(({ field, label, color }) => (
                        <div key={field} className="text-xs">
                          <div className="text-slate-500 mb-0.5">{label}</div>
                          <div className={`font-semibold ${color}`}>{fmtCurrency(calcTotal(field))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`${CREATE_MODAL_FOOTER_STICKY} justify-between items-center`}>
            <button type="button" onClick={() => setActiveTab(activeTab === 'info' ? 'items' : 'info')}
              className="text-sm text-emerald-800/70 hover:text-emerald-950 underline transition-colors">
              {activeTab === 'info' ? 'Go to Items →' : '← Back to Info'}
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className={CM_BTN_CANCEL} disabled={saving || loadingClaim}>
                Cancel
              </button>
              {!isEdit && (
                <button
                  type="button"
                  disabled={saving || loadingClaim}
                  onClick={() => handleSave(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
              )}
              {isEdit && (
                <button
                  type="button"
                  disabled={saving || loadingClaim}
                  onClick={() => handleSave(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
              <button type="submit" disabled={saving || loadingClaim} className={CM_BTN_PRIMARY}>
                {saving ? 'Submitting…' : isEdit ? 'Submit Claim' : 'Create & Submit'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}