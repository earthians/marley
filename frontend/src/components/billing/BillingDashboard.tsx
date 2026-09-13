// components/billing/BillingDashboard.tsx
import { useState, useEffect, useRef, useMemo } from 'react'

import { ServiceOrderServiceCell } from './ServiceOrderServiceCell'
import { 
  fetchServiceOrders, 
  fetchServiceInvoices,
  fetchServiceOrderSummary,
  fetchInvoiceSummary,
  fetchInpatientBalances,
  fetchOutpatientBalances,
  fetchIopBalances,
  fetchDailyAutoVisitBalances,
  fetchBillingCostCenterScope,
  fetchPatientBillingCostCenterBreakdown,
  fetchPatientCrossBranchPaidBreakdown,
  fetchPaymentEntries,
  fetchPaymentSummary,
  fetchDailyCollectionSummary,
  fetchCostCenterLetterHead,
  getInvoicesByReference,
  getInvoiceDetails,
  type ServiceOrder,
  type ServiceInvoice,
  type OrderSummary,
  type InvoiceSummary,
  type InpatientBalance,
  type OutpatientBalance,
  type PatientBillingCcRow,
  type PatientBillingCcCareTotals,
  type PatientCrossBranchPaidRow,
  type PaymentEntryRow,
  type PaymentSummary,
} from '../../services/serviceOrders'
import { fetchModeOfPayments, fetchUsers, fetchBranchOptions, type LinkFieldOption } from '../../services/common'
import { useCareContext } from '../../providers/CareContextProvider'
import { useReceptionistShift } from '../../providers/ReceptionistShiftProvider'
import { ReceptionistOwnerCell } from '../ui/ReceptionistOwnerCell'
import { 
  Receipt, 
  CreditCard, 
  Clock, 
  AlertCircle,
  CheckCircle,
  TrendingUp,
  Package,
  ChevronRight,
  LayoutDashboard,
  ListOrdered,
  FileText as FileIcon,
  Users,
  User,
  Filter,
  Loader2,
  CalendarRange,
  Activity,
  CalendarClock,
  Printer,
  FileDown,
  X,
  Wallet,
  ChevronDown,
} from 'lucide-react'
import { toast } from '../../hooks/useToast'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import { createInvoiceForVisit } from '../../services/patientVisits'

import { ServiceOrdersList } from './ServiceOrdersList'
import { ServiceInvoicesList } from './ServiceInvoicesList'
import { PaymentModal } from './PaymentModal'
import { StandalonePaymentModal } from './StandalonePaymentModal'
import { AdvanceInvoiceReconcileModal } from './AdvanceInvoiceReconcileModal'
import { PatientStatementOfAccountModal } from './PatientStatementOfAccountModal'
import { openDailyCollectionSummaryPrint } from './dailyCollectionSummaryPrint'
import { SpecialtySalesInvoiceSlideOver } from './SpecialtySalesInvoiceSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { useAuth } from '../../providers/AuthProvider'
import { canReconcileInvoiceAdvances } from '../../config/permissions'
import { DateFilterInput } from '../ui/DateFilterInput'
import {
  BILLING_PRINT_LETTERHEAD_STYLES,
  buildBillingPrintLetterhead,
  letterHeadBlocks,
} from '../../utils/billingPrintLetterhead'

type DashboardView = 'overview' | 'orders' | 'invoices' | 'inpatient' | 'outpatient' | 'iop' | 'dv' | 'unpaid' | 'paid' | 'payments'

function normalizePatientId(value?: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

/** UI-only consolidation: shared custom_unique_identity (multi-mode), else invoice,
 * else advances created together within a short window (legacy rows). */
type PaymentDisplayRow = PaymentEntryRow & {
  _memberNames: string[]
  _consolidatedCount: number
}

/** Fallback for advances created before custom_unique_identity existed. */
const ADVANCE_CONSOLIDATE_WINDOW_MS = 5 * 60 * 1000

function paymentCreationMs(p: PaymentEntryRow): number {
  const raw = (p.creation || '').trim()
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const t = Date.parse(normalized)
  return Number.isFinite(t) ? t : 0
}

function isAdvancePaymentRow(p: PaymentEntryRow): boolean {
  if (Number(p.docstatus) === 0) return false
  if ((p.payment_type || 'Receive').trim() === 'Pay') return false
  if ((p.custom_unique_identity || '').trim()) return false
  return !(p.invoice_name || '').trim()
}

function advanceConsolidateIdentity(p: PaymentEntryRow): string {
  const party = (p.party || p.party_name || '').trim().toLowerCase()
  const caseNo = (p.custom_case_no || '').trim()
  const opIp = (p.custom_op_or_ip || '').trim()
  const cashier = (p.cashier || '').trim()
  const type = (p.payment_type || 'Receive').trim() || 'Receive'
  return `${party}||${caseNo}||${opIp}||${cashier}||${type}`
}

function paymentConsolidateGroupKey(p: PaymentEntryRow): string | null {
  if (Number(p.docstatus) === 0) return null
  const uid = (p.custom_unique_identity || '').trim()
  if (uid) return `uid:${uid}`
  const inv = (p.invoice_name || '').trim()
  if (!inv) return null
  const type = (p.payment_type || 'Receive').trim() || 'Receive'
  return `inv:${inv}||${type}`
}

function mergePaymentMembers(members: PaymentEntryRow[]): PaymentDisplayRow {
  if (members.length <= 1) {
    const p = members[0]
    return {
      ...p,
      _memberNames: [p.name],
      _consolidatedCount: 1,
    }
  }

  const sorted = [...members].sort((a, b) => {
    const byCreation = paymentCreationMs(b) - paymentCreationMs(a)
    if (byCreation) return byCreation
    const byDate = (b.posting_date || '').localeCompare(a.posting_date || '')
    if (byDate) return byDate
    return b.name.localeCompare(a.name)
  })
  const primary = sorted[0]
  const paid_amount = members.reduce((sum, m) => sum + (Number(m.paid_amount) || 0), 0)
  const modes = [
    ...new Set(members.map((m) => (m.mode_of_payment || '').trim()).filter(Boolean)),
  ]
  const cashiers = [...new Set(members.map((m) => (m.cashier || '').trim()).filter(Boolean))]
  const cashierNames = [
    ...new Set(members.map((m) => (m.cashier_name || m.cashier || '').trim()).filter(Boolean)),
  ]

  return {
    ...primary,
    paid_amount,
    mode_of_payment: modes.length <= 1 ? modes[0] || primary.mode_of_payment || '' : 'Multiple',
    cashier: cashiers.length === 1 ? cashiers[0] : primary.cashier,
    cashier_name:
      cashiers.length === 1
        ? primary.cashier_name || cashiers[0]
        : cashierNames.length > 1
          ? 'Multiple'
          : primary.cashier_name,
    _memberNames: members.map((m) => m.name),
    _consolidatedCount: members.length,
  }
}

/** Cluster same-case advances whose creation times fall within a 5-minute window. */
function clusterAdvancePayments(advances: PaymentEntryRow[]): PaymentEntryRow[][] {
  const byIdentity = new Map<string, PaymentEntryRow[]>()
  for (const p of advances) {
    const key = advanceConsolidateIdentity(p)
    if (!byIdentity.has(key)) byIdentity.set(key, [])
    byIdentity.get(key)!.push(p)
  }

  const clusters: PaymentEntryRow[][] = []
  for (const group of byIdentity.values()) {
    const withTime = group.filter((p) => paymentCreationMs(p) > 0)
    const withoutTime = group.filter((p) => paymentCreationMs(p) <= 0)
    for (const p of withoutTime) clusters.push([p])

    const sorted = [...withTime].sort((a, b) => paymentCreationMs(a) - paymentCreationMs(b))
    let current: PaymentEntryRow[] = []
    let windowStart = 0
    for (const p of sorted) {
      const t = paymentCreationMs(p)
      if (!current.length) {
        current = [p]
        windowStart = t
        continue
      }
      if (t - windowStart <= ADVANCE_CONSOLIDATE_WINDOW_MS) {
        current.push(p)
      } else {
        clusters.push(current)
        current = [p]
        windowStart = t
      }
    }
    if (current.length) clusters.push(current)
  }
  return clusters
}

/** Default consolidated list for the Payments table only (PDF/Excel/summary use raw rows). */
function buildPaymentDisplayRows(rows: PaymentEntryRow[], expanded: boolean): PaymentDisplayRow[] {
  if (expanded) {
    return rows.map((p) => ({
      ...p,
      _memberNames: [p.name],
      _consolidatedCount: 1,
    }))
  }

  const invoiceGroups = new Map<string, PaymentEntryRow[]>()
  const advances: PaymentEntryRow[] = []

  for (const p of rows) {
    const invKey = paymentConsolidateGroupKey(p)
    if (invKey) {
      if (!invoiceGroups.has(invKey)) invoiceGroups.set(invKey, [])
      invoiceGroups.get(invKey)!.push(p)
      continue
    }
    if (isAdvancePaymentRow(p)) advances.push(p)
  }

  const advanceClusterByName = new Map<string, PaymentEntryRow[]>()
  for (const cluster of clusterAdvancePayments(advances)) {
    for (const m of cluster) advanceClusterByName.set(m.name, cluster)
  }

  const output: PaymentDisplayRow[] = []
  const emitted = new Set<string>()
  for (const p of rows) {
    if (emitted.has(p.name)) continue

    const invKey = paymentConsolidateGroupKey(p)
    if (invKey) {
      const members = invoiceGroups.get(invKey) || [p]
      for (const m of members) emitted.add(m.name)
      output.push(mergePaymentMembers(members))
      continue
    }

    if (isAdvancePaymentRow(p)) {
      const cluster = advanceClusterByName.get(p.name) || [p]
      for (const m of cluster) emitted.add(m.name)
      output.push(mergePaymentMembers(cluster))
      continue
    }

    emitted.add(p.name)
    output.push(mergePaymentMembers([p]))
  }

  return output
}

type CcBreakdownDisplayRow = PatientBillingCcRow & {
  row_key: string
  branch_label: string
  care_type?: 'IP' | 'OP'
}

function sideHasCharges(side?: PatientBillingCcCareTotals): boolean {
  if (!side) return false
  return (
    Number(side.sales_orders) > 0 ||
    Number(side.invoices) > 0 ||
    Number(side.outstanding) > 0 ||
    Number(side.orders_amount) > 0
  )
}

/** One row per branch, or duplicate rows as "Branch IP" / "Branch OP" when unscoped. */
function expandCcBreakdownForDisplay(
  rows: PatientBillingCcRow[],
  splitOpIp: boolean,
): CcBreakdownDisplayRow[] {
  if (!splitOpIp) {
    return rows.map((row) => ({
      ...row,
      row_key: row.cost_center || '__none__',
      branch_label: row.cost_center_name,
    }))
  }

  const expanded: CcBreakdownDisplayRow[] = []
  for (const row of rows) {
    const sides: Array<{ key: 'op' | 'ip'; label: string }> = [
      { key: 'ip', label: 'IP' },
      { key: 'op', label: 'OP' },
    ]
    for (const { key, label } of sides) {
      const side = row[key]
      if (!sideHasCharges(side)) continue
      expanded.push({
        ...row,
        row_key: `${row.cost_center || '__none__'}|${key}`,
        branch_label: row.cost_center_name,
        care_type: label as 'IP' | 'OP',
        sales_orders: side!.sales_orders,
        orders_amount: side!.orders_amount,
        invoices: side!.invoices,
        invoices_grand_total: side!.invoices_grand_total,
        outstanding: side!.outstanding,
      })
    }
  }
  return expanded
}

// Navigation Button Component
const NavButton = ({ 
  icon: Icon, 
  label, 
  isActive, 
  onClick,
  count 
}: { 
  icon: any
  label: string
  isActive: boolean
  onClick: () => void
  count?: number
}) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all ${
      isActive 
        ? 'bg-primary text-white shadow-md' 
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`}
  >
    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-primary'}`} />
    <span className="text-sm font-medium">{label}</span>
    {count !== undefined && count > 0 && (
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
        isActive ? 'bg-white/20 text-white' : 'bg-white text-primary'
      }`}>
        {count}
      </span>
    )}
  </button>
)

// Filter Button Component
const FilterButton = ({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color: string }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
      active 
        ? `${color} text-white shadow-sm` 
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`}
  >
    {label}
  </button>
)

interface BillingDashboardProps {
  patient?: string
  admission?: string
  visit?: string
}

export const BillingDashboard = ({ patient, admission, visit }: BillingDashboardProps) => {
  const { mode, activeAdmission, activeVisit, costCenterCareScope, userCostCenter } = useCareContext()
  const shiftContext = useReceptionistShift()
  const { user } = useAuth()
  const formatCurrency = useFormatMoney()
  const userRoles = user?.roles?.length
    ? user.roles
    : ([user?.role, user?.role_profile_name].filter(Boolean) as string[])
  const showReconcileButton = canReconcileInvoiceAdvances(userRoles)

  // Load saved view from localStorage
  const getSavedView = (): DashboardView => {
    const saved = localStorage.getItem('billingDashboardView')
    if (saved === 'overview' || saved === 'orders' || saved === 'invoices' || saved === 'inpatient' || saved === 'outpatient' || saved === 'iop' || saved === 'dv' || saved === 'unpaid' || saved === 'paid' || saved === 'payments') {
      return saved as DashboardView
    }
    return 'overview'
  }

  const [currentView, setCurrentView] = useState<DashboardView>(getSavedView)
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null)
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null)
  const [inpatientBalances, setInpatientBalances] = useState<InpatientBalance[]>([])
  const [filteredInpatient, setFilteredInpatient] = useState<InpatientBalance[]>([])
  const [outpatientBalances, setOutpatientBalances] = useState<OutpatientBalance[]>([])
  const [filteredOutpatient, setFilteredOutpatient] = useState<OutpatientBalance[]>([])
  const [iopBalances, setIopBalances] = useState<OutpatientBalance[]>([])
  const [filteredIop, setFilteredIop] = useState<OutpatientBalance[]>([])
  const [dvBalances, setDvBalances] = useState<OutpatientBalance[]>([])
  const [filteredDv, setFilteredDv] = useState<OutpatientBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const loadGenerationRef = useRef(0)
  const [recentOrders, setRecentOrders] = useState<ServiceOrder[]>([])
  const [recentInvoices, setRecentInvoices] = useState<ServiceInvoice[]>([])
  const [inpatientFilter, setInpatientFilter] = useState<'all' | 'paid' | 'unpaid' | 'partial' | 'overdue'>('all')
  const [outpatientFilter, setOutpatientFilter] = useState<'all' | 'paid' | 'unpaid' | 'partial' | 'overdue'>('all')
  const [iopFilter, setIopFilter] = useState<'all' | 'paid' | 'unpaid' | 'partial' | 'overdue'>('all')
  const [dvFilter, setDvFilter] = useState<'all' | 'paid' | 'unpaid' | 'partial' | 'overdue'>('all')
  
  // Modal states
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showStandalonePaymentModal, setShowStandalonePaymentModal] = useState(false)
  const [showStatementOfAccountModal, setShowStatementOfAccountModal] = useState(false)
  const [printingCollection, setPrintingCollection] = useState(false)
  const [showAdvanceReconcileModal, setShowAdvanceReconcileModal] = useState(false)
  const [selectedPaymentInvoice, setSelectedPaymentInvoice] = useState<{
    name: string
    customer_name: string
    outstanding_amount: number
    company?: string
    cost_center?: string
    department?:string
  } | null>(null)
  const [loadingInvoices, setLoadingInvoices] = useState<string | null>(null)
  const [salesInvoiceDetailName, setSalesInvoiceDetailName] = useState<string | null>(null)
  const [salesInvoiceEditMode, setSalesInvoiceEditMode] = useState(false)
  const [invoiceListRefreshKey, setInvoiceListRefreshKey] = useState(0)
  const [billingCcRestricted, setBillingCcRestricted] = useState<boolean | null>(null)
  const [ccBreakdown, setCcBreakdown] = useState<PatientBillingCcRow[]>([])
  const [crossBranchPaid, setCrossBranchPaid] = useState<PatientCrossBranchPaidRow[]>([])
  const [crossBranchOpen, setCrossBranchOpen] = useState(false)
  const [payments, setPayments] = useState<PaymentEntryRow[]>([])
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null)
  /** false = consolidated (default); true = show every Payment Entry row */
  const [paymentsExpanded, setPaymentsExpanded] = useState(false)
  const [showDateFilters, setShowDateFilters] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [paymentModeFilter, setPaymentModeFilter] = useState('')
  const [paymentModes, setPaymentModes] = useState<Array<{ name: string; label: string }>>([])
  const [cashierFilter, setCashierFilter] = useState('')
  const [cashiers, setCashiers] = useState<LinkFieldOption[]>([])
  const [branchFilter, setBranchFilter] = useState('')
  const [branchOptions, setBranchOptions] = useState<LinkFieldOption[]>([])
  const [filterByOpenShift, setFilterByOpenShift] = useState(true)

  const shiftFilterActive = Boolean(shiftContext?.shiftRequired && filterByOpenShift)
  const openShiftName = shiftContext?.context?.open_shift?.name

  const paymentDisplayRows = useMemo(
    () => buildPaymentDisplayRows(payments, paymentsExpanded),
    [payments, paymentsExpanded],
  )
  const hasConsolidatablePayments = useMemo(
    () => buildPaymentDisplayRows(payments, false).some((r) => r._consolidatedCount > 1),
    [payments],
  )

  // Patient filter comes from the parent page; do not fall back to context (avoids stale ID after navbar clear).
  const effectivePatient = normalizePatientId(patient)
  const rawReferenceName =
    mode === 'IP'
      ? normalizePatientId(admission) ?? activeAdmission
      : normalizePatientId(visit) ?? activeVisit
  const scopedReferenceName = effectivePatient ? rawReferenceName || undefined : undefined
  const scopedReferenceType = scopedReferenceName
    ? mode === 'IP'
      ? 'Inpatient Admission'
      : 'Patient Visit'
    : undefined
  const effectiveReferenceType = scopedReferenceType
  const effectiveReferenceName = scopedReferenceName

  const showOpIpBranchSplit = !scopedReferenceName
  const ccBreakdownDisplay = useMemo(
    () => expandCcBreakdownForDisplay(ccBreakdown, showOpIpBranchSplit),
    [ccBreakdown, showOpIpBranchSplit],
  )
  const showCcBreakdown =
    !!(effectivePatient || effectiveReferenceName) &&
    billingCcRestricted === false &&
    ccBreakdownDisplay.length > 0

  // Save view to localStorage
  const handleViewChange = (view: DashboardView) => {
    setCurrentView(view)
    localStorage.setItem('billingDashboardView', view)
  }

  useEffect(() => {
    if (costCenterCareScope === 'op_only' && currentView === 'inpatient') {
      setCurrentView('overview')
      localStorage.setItem('billingDashboardView', 'overview')
    }
    if (costCenterCareScope === 'ip_only' && (currentView === 'outpatient' || currentView === 'iop')) {
      setCurrentView('overview')
      localStorage.setItem('billingDashboardView', 'overview')
    }
  }, [costCenterCareScope, currentView])

  /** Open the Sales Invoice slide-over (latest known invoice or first match for this visit/admission). */
  const openInvoiceForHealthcareReference = async (
    referenceId: string,
    referenceType: 'Inpatient Admission' | 'Patient Visit',
    preferredInvoiceName?: string | null
  ) => {
    try {
      setLoadingInvoices(referenceId)
      if (preferredInvoiceName) {
        setSalesInvoiceDetailName(preferredInvoiceName)
        return
      }
      const invoices = await getInvoicesByReference(
        referenceId,
        referenceType,
        effectivePatient || undefined
      )
      if (invoices.length === 0) {
        toast.error('No invoices found for this admission/visit')
        return
      }
      setSalesInvoiceDetailName(invoices[0].name)
    } catch (error) {
      console.error('Error loading invoices:', error)
      toast.error('Failed to open invoice')
    } finally {
      setLoadingInvoices(null)
    }
  }

  // Handle make payment - fetch invoice details for company and branch
const handleMakePayment = async (
  referenceId: string,
  customerName: string,
  outstandingAmount: number,
  referenceType: string,
  /** Restrict invoice lookup to this patient (row’s patient); avoids empty results when context patient differs. */
  patientIdForInvoices?: string
) => {
  try {
    setLoadingInvoices(referenceId)
    const invoices = await getInvoicesByReference(
      referenceId,
      referenceType,
      patientIdForInvoices || undefined
    )
    
    if (!invoices || invoices.length === 0) {
      toast.error('No invoices found for this admission/visit')
      return
    }

    // Pay one invoice at a time — the oldest with an outstanding balance — and cap the amount
    // to THAT invoice's balance (not the reference's aggregate). This stops the whole
    // outstanding being recorded against invoices[0] (excess -> credit, other invoices unpaid)
    // and lets the PaymentModal's "exceeds outstanding" guard work correctly.
    const payable = invoices
      .filter((inv) => Number(inv.outstanding_amount) > 0)
      .sort((a, b) => (a.posting_date || '').localeCompare(b.posting_date || ''))
    const target = payable[0] || invoices[0]
    const invoiceName = target.name

    // Fetch invoice details to get company and branch
    const invoiceDetails = await getInvoiceDetails(invoiceName)

    setSelectedPaymentInvoice({
      name: invoiceName,  // Now this is the actual invoice name, not the admission ID
      customer_name: customerName,
      outstanding_amount: Number(target.outstanding_amount) || outstandingAmount,
      company: invoiceDetails?.company || '',
      cost_center: invoiceDetails?.cost_center || '',
      department:invoiceDetails?.department || '',
    })
    setShowPaymentModal(true)
  } catch (error) {
    console.error('Error fetching invoice details:', error)
    toast.error(
      error instanceof Error ? error.message : 'Failed to load invoice details for payment'
    )
  } finally {
    setLoadingInvoices(null)
  }
}

  const handlePaymentSuccess = () => {
    if (currentView === 'inpatient') {
      loadInpatientBalances()
    } else if (currentView === 'outpatient') {
      loadOutpatientBalances()
    } else if (currentView === 'iop') {
      loadIopBalances()
    } else if (currentView === 'dv') {
      loadDailyAutoVisitBalances()
    } else {
      loadDashboardData()
    }
  }

  const openInvoiceDetail = (name: string, options?: { edit?: boolean }) => {
    setSalesInvoiceDetailName(name)
    setSalesInvoiceEditMode(Boolean(options?.edit))
  }

  const notifyInvoiceDataChanged = () => {
    setInvoiceListRefreshKey((k) => k + 1)
    handlePaymentSuccess()
  }

  const loadDashboardData = async (isStale?: () => boolean) => {
    if (!effectivePatient && !scopedReferenceName) {
      try {
        if (!hasLoadedOnce) setLoading(true)
        const [paymentRows, paySummary] = await Promise.all([
          fetchPaymentEntries(undefined, undefined, undefined, fromDate || undefined, toDate || undefined, paymentModeFilter || undefined, shiftFilterActive, cashierFilter || undefined, branchFilter || undefined),
          fetchPaymentSummary(undefined, undefined, undefined, fromDate || undefined, toDate || undefined, paymentModeFilter || undefined, shiftFilterActive, cashierFilter || undefined, branchFilter || undefined),
        ])
        if (isStale?.()) return
        setPayments(paymentRows)
        setPaymentSummary(paySummary)
      } catch {
        if (isStale?.()) return
        setPayments([])
        setPaymentSummary(null)
      } finally {
        if (isStale?.()) return
        setOrderSummary(null)
        setInvoiceSummary(null)
        setRecentOrders([])
        setRecentInvoices([])
        setBillingCcRestricted(null)
        setCcBreakdown([])
        setCrossBranchPaid([])
        setLoading(false)
        setHasLoadedOnce(true)
      }
      return
    }

    try {
      if (!hasLoadedOnce) setLoading(true)
      const [ordersSummary, invSummary, recentOrdersData, recentInvoicesData] = await Promise.all([
        fetchServiceOrderSummary(scopedReferenceType, scopedReferenceName, effectivePatient, fromDate || undefined, toDate || undefined),
        fetchInvoiceSummary(scopedReferenceType, scopedReferenceName, effectivePatient, fromDate || undefined, toDate || undefined, undefined, shiftFilterActive),
        fetchServiceOrders(scopedReferenceType, scopedReferenceName, effectivePatient, undefined, fromDate || undefined, toDate || undefined),
        fetchServiceInvoices(scopedReferenceType, scopedReferenceName, effectivePatient, undefined, fromDate || undefined, toDate || undefined, undefined, shiftFilterActive),
      ])

      if (isStale?.()) return

      setOrderSummary(ordersSummary)
      setInvoiceSummary(invSummary)
      setRecentOrders(recentOrdersData)
      setRecentInvoices(recentInvoicesData)

      try {
        const [ccScope, ccBreakdownRes, crossBranchRes, paymentRows, paySummary] = await Promise.all([
          fetchBillingCostCenterScope(),
          fetchPatientBillingCostCenterBreakdown(
            scopedReferenceType,
            scopedReferenceName,
            effectivePatient
          ),
          fetchPatientCrossBranchPaidBreakdown(
            scopedReferenceType,
            scopedReferenceName,
            effectivePatient
          ),
          fetchPaymentEntries(scopedReferenceType, scopedReferenceName, effectivePatient, fromDate || undefined, toDate || undefined, paymentModeFilter || undefined, shiftFilterActive, cashierFilter || undefined, branchFilter || undefined),
          fetchPaymentSummary(scopedReferenceType, scopedReferenceName, effectivePatient, fromDate || undefined, toDate || undefined, paymentModeFilter || undefined, shiftFilterActive, cashierFilter || undefined, branchFilter || undefined),
        ])
        if (isStale?.()) return
        setBillingCcRestricted(!!ccScope.restricted)
        setCcBreakdown(ccBreakdownRes.restricted ? [] : ccBreakdownRes.rows || [])
        setCrossBranchPaid(crossBranchRes.restricted ? [] : crossBranchRes.rows || [])
        setPayments(paymentRows)
        setPaymentSummary(paySummary)
      } catch {
        if (isStale?.()) return
        setBillingCcRestricted(null)
        setCcBreakdown([])
        setCrossBranchPaid([])
        setPayments([])
        setPaymentSummary(null)
      }
    } catch (error) {
      if (isStale?.()) return
      console.error('Failed to load dashboard data:', error)
      toast.error('Failed to load dashboard data')
    } finally {
      if (isStale?.()) return
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }

  const loadInpatientBalances = async (isStale?: () => boolean) => {
    try {
      if (!hasLoadedOnce) setLoading(true)
      const balances = await fetchInpatientBalances(effectivePatient, fromDate || undefined, toDate || undefined)
      if (isStale?.()) return
      setInpatientBalances(balances)
      setFilteredInpatient(balances)
    } catch (error) {
      if (isStale?.()) return
      console.error('Failed to load inpatient balances:', error)
      toast.error('Failed to load inpatient balances')
    } finally {
      if (isStale?.()) return
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }

  const loadOutpatientBalances = async (isStale?: () => boolean) => {
    try {
      if (!hasLoadedOnce) setLoading(true)
      const balances = await fetchOutpatientBalances(effectivePatient, fromDate || undefined, toDate || undefined)
      if (isStale?.()) return
      setOutpatientBalances(balances)
      setFilteredOutpatient(balances)
    } catch (error) {
      if (isStale?.()) return
      console.error('Failed to load outpatient balances:', error)
      toast.error('Failed to load outpatient balances')
    } finally {
      if (isStale?.()) return
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }

  const loadIopBalances = async (isStale?: () => boolean) => {
    try {
      if (!hasLoadedOnce) setLoading(true)
      const balances = await fetchIopBalances(effectivePatient, fromDate || undefined, toDate || undefined)
      if (isStale?.()) return
      setIopBalances(balances)
      setFilteredIop(balances)
    } catch (error) {
      if (isStale?.()) return
      console.error('Failed to load IOP balances:', error)
      toast.error('Failed to load IOP balances')
    } finally {
      if (isStale?.()) return
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }

  const loadDailyAutoVisitBalances = async (isStale?: () => boolean) => {
    try {
      if (!hasLoadedOnce) setLoading(true)
      const balances = await fetchDailyAutoVisitBalances(effectivePatient, fromDate || undefined, toDate || undefined)
      if (isStale?.()) return
      setDvBalances(balances)
      setFilteredDv(balances)
    } catch (error) {
      if (isStale?.()) return
      console.error('Failed to load daily auto visit balances:', error)
      toast.error('Failed to load daily auto visit balances')
    } finally {
      if (isStale?.()) return
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }

  const handleCreateInvoiceForDailyVisit = async (visitId: string) => {
    try {
      setLoadingInvoices(visitId)
      const result = await createInvoiceForVisit(visitId)
      toast.success(result.message || `Invoice ${result.sales_invoice} created`)
      setSalesInvoiceDetailName(result.sales_invoice)
      loadDailyAutoVisitBalances()
    } catch (error) {
      console.error('Failed to create invoice for daily auto visit:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create invoice')
    } finally {
      setLoadingInvoices(null)
    }
  }

  useEffect(() => {
    const generation = ++loadGenerationRef.current
    let cancelled = false
    const isStale = () => cancelled || generation !== loadGenerationRef.current

    if (currentView === 'inpatient') {
      void loadInpatientBalances(isStale)
    } else if (currentView === 'outpatient') {
      void loadOutpatientBalances(isStale)
    } else if (currentView === 'iop') {
      void loadIopBalances(isStale)
    } else if (currentView === 'dv') {
      void loadDailyAutoVisitBalances(isStale)
    } else {
      void loadDashboardData(isStale)
    }

    return () => {
      cancelled = true
    }
  }, [currentView, effectivePatient, scopedReferenceName, fromDate, toDate, paymentModeFilter, cashierFilter, branchFilter, shiftFilterActive])

  useEffect(() => {
    fetchModeOfPayments()
      .then(setPaymentModes)
      .catch(() => setPaymentModes([]))
    fetchUsers(undefined, 'Receptionist')
      .then(setCashiers)
      .catch(() => setCashiers([]))
    fetchBranchOptions()
      .then(setBranchOptions)
      .catch(() => setBranchOptions([]))
  }, [])

  // Filter inpatient balances
  useEffect(() => {
    if (inpatientFilter === 'all') {
      setFilteredInpatient(inpatientBalances)
    } else {
      const filtered = inpatientBalances.filter(balance => {
        if (inpatientFilter === 'paid') return balance.outstanding_amount === 0 && balance.total_paid > 0
        if (inpatientFilter === 'unpaid') return balance.outstanding_amount === balance.total_amount && balance.total_amount > 0
        if (inpatientFilter === 'partial') return balance.outstanding_amount > 0 && balance.outstanding_amount < balance.total_amount
        if (inpatientFilter === 'overdue') return balance.days_overdue > 0
        return true
      })
      setFilteredInpatient(filtered)
    }
  }, [inpatientFilter, inpatientBalances])

  // Filter outpatient balances
  useEffect(() => {
    if (outpatientFilter === 'all') {
      setFilteredOutpatient(outpatientBalances)
    } else {
      const filtered = outpatientBalances.filter(balance => {
        if (outpatientFilter === 'paid') return balance.outstanding_amount === 0 && balance.total_paid > 0
        if (outpatientFilter === 'unpaid') return balance.outstanding_amount === balance.total_amount && balance.total_amount > 0
        if (outpatientFilter === 'partial') return balance.outstanding_amount > 0 && balance.outstanding_amount < balance.total_amount
        if (outpatientFilter === 'overdue') return balance.days_overdue > 0
        return true
      })
      setFilteredOutpatient(filtered)
    }
  }, [outpatientFilter, outpatientBalances])

  // Filter IOP balances
  useEffect(() => {
    if (iopFilter === 'all') {
      setFilteredIop(iopBalances)
    } else {
      const filtered = iopBalances.filter(balance => {
        if (iopFilter === 'paid') return balance.outstanding_amount === 0 && balance.total_paid > 0
        if (iopFilter === 'unpaid') return balance.outstanding_amount === balance.total_amount && balance.total_amount > 0
        if (iopFilter === 'partial') return balance.outstanding_amount > 0 && balance.outstanding_amount < balance.total_amount
        if (iopFilter === 'overdue') return balance.days_overdue > 0
        return true
      })
      setFilteredIop(filtered)
    }
  }, [iopFilter, iopBalances])

  // Filter Daily Auto Visit balances
  useEffect(() => {
    if (dvFilter === 'all') {
      setFilteredDv(dvBalances)
    } else {
      const filtered = dvBalances.filter(balance => {
        if (dvFilter === 'paid') return balance.outstanding_amount === 0 && balance.total_paid > 0
        if (dvFilter === 'unpaid') return balance.outstanding_amount === balance.total_amount && balance.total_amount > 0
        if (dvFilter === 'partial') return balance.outstanding_amount > 0 && balance.outstanding_amount < balance.total_amount
        if (dvFilter === 'overdue') return balance.days_overdue > 0
        return true
      })
      setFilteredDv(filtered)
    }
  }, [dvFilter, dvBalances])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid': return 'text-green-600 bg-green-50'
      case 'Unpaid': return 'text-yellow-600 bg-yellow-50'
      case 'Overdue': return 'text-red-600 bg-red-50'
      case 'Partially Paid': return 'text-blue-600 bg-blue-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getBalanceStatusColor = (balance: InpatientBalance | OutpatientBalance) => {
    if (balance.outstanding_amount === 0 && balance.total_paid > 0) {
      return { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', badge: 'bg-green-100 text-green-800', label: 'Paid in Full' }
    }
    if (balance.days_overdue > 0) {
      return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-800', label: `Overdue (${balance.days_overdue} days)` }
    }
    if (balance.outstanding_amount > 0 && balance.outstanding_amount < balance.total_amount) {
      return { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-800', label: 'Partially Paid' }
    }
    if (balance.outstanding_amount === balance.total_amount && balance.total_amount > 0) {
      return { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800', label: 'Unpaid' }
    }
    return { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', badge: 'bg-slate-100 text-slate-800', label: 'No Charges' }
  }

  // StatCard component
  const StatCard = ({ 
    title, 
    value, 
    subValue, 
    icon: Icon, 
    color, 
    onClick 
  }: { 
    title: string
    value: string | number
    subValue?: string
    icon: any
    color: string
    onClick?: () => void
  }) => (
    <div 
      onClick={onClick}
      className={`bg-white rounded-xl border border-slate-200 p-5 shadow-sm transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:border-primary/30' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          {subValue && <p className="text-xs text-slate-400 mt-1">{subValue}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  )

  // QuickActionCard component
  const QuickActionCard = ({ 
    title, 
    count, 
    amount, 
    icon: Icon, 
    color, 
    onClick 
  }: { 
    title: string
    count: number
    amount: number
    icon: any
    color: string
    onClick: () => void
  }) => (
    <div 
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">{title}</p>
            <p className="text-xs text-slate-400">{count} items</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-slate-900">{formatCurrency(amount)}</p>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-primary transition-colors ml-auto" />
        </div>
      </div>
    </div>
  )

  // Navigation Row
  const NavigationRow = () => {
    const totalOrders = orderSummary?.total_orders || 0
    const totalInvoices = invoiceSummary?.total_invoices || 0

    return (
      <div className="flex gap-3 mb-6 flex-wrap">
        <NavButton
          icon={LayoutDashboard}
          label="Overview"
          isActive={currentView === 'overview'}
          onClick={() => handleViewChange('overview')}
        />
        <NavButton
          icon={ListOrdered}
          label="Medication/Services/LabTest"
          isActive={currentView === 'orders'}
          onClick={() => handleViewChange('orders')}
          count={totalOrders}
        />
        <NavButton
          icon={FileIcon}
          label="Invoices"
          isActive={currentView === 'invoices'}
          onClick={() => handleViewChange('invoices')}
          count={totalInvoices}
        />
        {costCenterCareScope !== 'op_only' && (
          <NavButton
            icon={Users}
            label="All IP"
            isActive={currentView === 'inpatient'}
            onClick={() => handleViewChange('inpatient')}
            count={inpatientBalances.length}
          />
        )}
        {costCenterCareScope !== 'ip_only' && (
          <NavButton
            icon={User}
            label="All OP"
            isActive={currentView === 'outpatient'}
            onClick={() => handleViewChange('outpatient')}
            count={outpatientBalances.length}
          />
        )}
        {costCenterCareScope !== 'ip_only' && (
          <NavButton
            icon={Activity}
            label="All IOP"
            isActive={currentView === 'iop'}
            onClick={() => handleViewChange('iop')}
            count={iopBalances.length}
          />
        )}
        <NavButton
          icon={CalendarClock}
          label="All DV"
          isActive={currentView === 'dv'}
          onClick={() => handleViewChange('dv')}
          count={dvBalances.length}
        />
        <NavButton
          icon={CreditCard}
          label="Payments"
          isActive={currentView === 'payments'}
          onClick={() => handleViewChange('payments')}
          count={payments.length}
        />
        <div className="ml-auto flex items-center gap-2">
          {shiftContext?.shiftRequired && (
            <button
              type="button"
              onClick={() => setFilterByOpenShift((v) => !v)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                filterByOpenShift
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title={openShiftName ? `Open shift: ${openShiftName}` : 'Filter by open shift'}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">Open Shift: {filterByOpenShift ? 'On' : 'Off'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDateFilters((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            <CalendarRange className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Date Filters</span>
          </button>
        </div>
      </div>
    )
  }

  // FIX: Shared modals rendered regardless of current view
  const SharedModals = () => (
    <>
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false)
          setSelectedPaymentInvoice(null)
        }}
        invoiceName={selectedPaymentInvoice?.name || ''}
        customerName={selectedPaymentInvoice?.customer_name || ''}
        outstandingAmount={selectedPaymentInvoice?.outstanding_amount || 0}
        defaultCompany={selectedPaymentInvoice?.company}
        defaultCostCenter={selectedPaymentInvoice?.cost_center}
        defaultDepartment={selectedPaymentInvoice?.department}
        onPaymentSuccess={() => {
          setInvoiceListRefreshKey((k) => k + 1)
          handlePaymentSuccess()
        }}
      />

      <SpecialtySalesInvoiceSlideOver
        invoiceName={salesInvoiceDetailName}
        initialEditMode={salesInvoiceEditMode}
        onClose={() => {
          setSalesInvoiceDetailName(null)
          setSalesInvoiceEditMode(false)
        }}
        onUpdated={notifyInvoiceDataChanged}
      />

      {showStandalonePaymentModal && (
        <StandalonePaymentModal
          patient={effectivePatient || undefined}
          onClose={() => setShowStandalonePaymentModal(false)}
          onSuccess={() => {
            setShowStandalonePaymentModal(false)
            handlePaymentSuccess()
          }}
        />
      )}

      {showAdvanceReconcileModal && effectivePatient && (
        <AdvanceInvoiceReconcileModal
          patient={effectivePatient}
          patientName={payments[0]?.party_name || recentInvoices[0]?.patient_name}
          onClose={() => setShowAdvanceReconcileModal(false)}
          onSuccess={() => {
            setShowAdvanceReconcileModal(false)
            setInvoiceListRefreshKey((k) => k + 1)
            handlePaymentSuccess()
          }}
        />
      )}

      {showStatementOfAccountModal && effectivePatient && (
        <PatientStatementOfAccountModal
          patient={effectivePatient}
          patientName={payments[0]?.party_name}
          fromDate={fromDate || undefined}
          toDate={toDate || undefined}
          onClose={() => setShowStatementOfAccountModal(false)}
        />
      )}
    </>
  )

  if (loading && !hasLoadedOnce && (currentView === 'inpatient' || currentView === 'outpatient' || currentView === 'iop')) {
    return (
      <div className="space-y-4">
        <NavigationRow />
        <DateFiltersPanel />
        <div className="flex items-center justify-center h-96">
          <div className="text-slate-500">Loading balances...</div>
        </div>
        <SharedModals />
      </div>
    )
  }

  if (loading && !hasLoadedOnce) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-500">Loading dashboard...</div>
        <SharedModals />
      </div>
    )
  }

  // Orders View
  if (currentView === 'orders') {
    return (
      <div className="space-y-4">
        <NavigationRow />
        <DateFiltersPanel />
        <ServiceOrdersList 
          patient={effectivePatient}
          admission={effectiveReferenceName}
          visit={effectiveReferenceType === 'Patient Visit' ? effectiveReferenceName : undefined}
          fromDate={fromDate || undefined}
          toDate={toDate || undefined}
        />
        <SharedModals />
      </div>
    )
  }

  // Invoices View
  if (currentView === 'invoices') {
    return (
      <div className="space-y-4">
        <NavigationRow />
        <DateFiltersPanel />
        <ServiceInvoicesList
          patient={effectivePatient}
          admission={effectiveReferenceName}
          visit={effectiveReferenceType === 'Patient Visit' ? effectiveReferenceName : undefined}
          onOpenInvoiceDetail={openInvoiceDetail}
          invoiceRefreshKey={invoiceListRefreshKey}
          onAfterInvoiceMutation={notifyInvoiceDataChanged}
          fromDate={fromDate || undefined}
          toDate={toDate || undefined}
          filterByOpenShift={shiftFilterActive}
        />
        <SharedModals />
      </div>
    )
  }

  // Unpaid View
  if (currentView === 'unpaid') {
    return (
      <div className="space-y-4">
        <button
          onClick={() => handleViewChange('overview')}
          className="flex items-center gap-2 text-sm text-primary hover:underline mb-4"
        >
          ← Back to Dashboard
        </button>
        <ServiceInvoicesList
          patient={effectivePatient}
          admission={effectiveReferenceName}
          visit={effectiveReferenceType === 'Patient Visit' ? effectiveReferenceName : undefined}
          statusFilter="Unpaid,Overdue"
          onOpenInvoiceDetail={openInvoiceDetail}
          invoiceRefreshKey={invoiceListRefreshKey}
          onAfterInvoiceMutation={notifyInvoiceDataChanged}
          fromDate={fromDate || undefined}
          toDate={toDate || undefined}
          filterByOpenShift={shiftFilterActive}
        />
        <SharedModals />
      </div>
    )
  }

  // Paid View
  if (currentView === 'paid') {
    return (
      <div className="space-y-4">
        <button
          onClick={() => handleViewChange('overview')}
          className="flex items-center gap-2 text-sm text-primary hover:underline mb-4"
        >
          ← Back to Dashboard
        </button>
        <ServiceInvoicesList
          patient={effectivePatient}
          admission={effectiveReferenceName}
          visit={effectiveReferenceType === 'Patient Visit' ? effectiveReferenceName : undefined}
          statusFilter="Paid"
          onOpenInvoiceDetail={openInvoiceDetail}
          invoiceRefreshKey={invoiceListRefreshKey}
          onAfterInvoiceMutation={notifyInvoiceDataChanged}
          fromDate={fromDate || undefined}
          toDate={toDate || undefined}
          filterByOpenShift={shiftFilterActive}
        />
        <SharedModals />
      </div>
    )
  }

  function DateFiltersPanel() {
    if (!showDateFilters) return null
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-600 mb-1">From Date</label>
          <DateFilterInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">To Date</label>
          <DateFilterInput value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="button" onClick={() => { setFromDate(''); setToDate('') }} className="inline-flex items-center gap-1 px-3 py-2 text-sm border border-slate-300 rounded-md">
          <X className="w-3 h-3" /> Clear
        </button>
        {currentView === 'payments' && (
          <>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Mode of Payment</label>
              <select
                value={paymentModeFilter}
                onChange={(e) => setPaymentModeFilter(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">Select All</option>
                {paymentModes.map((mode) => (
                  <option key={mode.name} value={mode.name}>{mode.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Receptionist</label>
              <select
                value={cashierFilter}
                onChange={(e) => setCashierFilter(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
              >
                <option value="">Select All</option>
                {cashiers.map((user) => (
                  <option key={user.name} value={user.name}>{user.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Branch</label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
              >
                <option value="">Select All</option>
                {branchOptions.map((branch) => (
                  <option key={branch.name} value={branch.name}>{branch.label}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    )
  }

  const exportPaymentsCsv = () => {
    const headers = ['Payment Entry', 'Posting Date', 'Mode', 'Amount', 'Party', 'Receptionist', 'Branch', 'Invoice', 'Reference Type', 'Reference Name']
    const rows = payments.map((p) => [
      p.name,
      p.posting_date || '',
      p.mode_of_payment || '',
      String(p.paid_amount ?? 0),
      p.party_name || '',
      p.cashier_name || p.cashier || '',
      p.cost_center || '',
      p.invoice_name || '',
      p.invoice_reference_type || '',
      p.invoice_reference_name || '',
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payments-${fromDate || 'all'}-${toDate || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printPayments = async () => {
    const win = window.open('', '_blank', 'width=1200,height=800')
    if (!win) {
      toast.error('Pop-up blocked — allow pop-ups to print PDF')
      return
    }
    try {
      const letterHead = await fetchCostCenterLetterHead(userCostCenter || undefined, {
        patient: effectivePatient,
        referenceType: scopedReferenceType,
        referenceName: scopedReferenceName,
      })
      const { footer } = letterHeadBlocks(letterHead)
      const metaParts: string[] = []
      if (fromDate || toDate) metaParts.push(`From ${fromDate || '…'} to ${toDate || '…'}`)
      if (paymentModeFilter) metaParts.push(`Mode: ${paymentModeFilter}`)
      if (cashierFilter) {
        const cashierLabel = cashiers.find((c) => c.name === cashierFilter)?.label || cashierFilter
        metaParts.push(`Receptionist: ${cashierLabel}`)
      }
      if (branchFilter) {
        const branchLabel = branchOptions.find((b) => b.name === branchFilter)?.label || branchFilter
        metaParts.push(`Branch: ${branchLabel}`)
      }
      if (effectivePatient) metaParts.push(`Patient: ${effectivePatient}`)
      if (effectiveReferenceName) metaParts.push(`${effectiveReferenceType}: ${effectiveReferenceName}`)
      const meta = metaParts.join(' · ') || 'All payments'
      const rows = payments
        .map(
          (p) =>
            `<tr>
              <td>${p.name}</td>
              <td>${p.posting_date || ''}</td>
              <td>${p.mode_of_payment || ''}</td>
              <td class="num">${formatCurrency(p.paid_amount || 0)}</td>
              <td>${p.party_name || ''}</td>
              <td>${p.cashier_name || p.cashier || ''}</td>
              <td>${p.invoice_name || ''}</td>
            </tr>`,
        )
        .join('')
      win.document.write(`<!DOCTYPE html><html><head><title>Payment Collection</title>
        <style>${BILLING_PRINT_LETTERHEAD_STYLES}</style></head><body>
        ${buildBillingPrintLetterhead('Payment Collection', meta, letterHead)}
        <table class="data">
          <thead><tr>
            <th>Payment Entry</th>
            <th>Date</th>
            <th>Mode</th>
            <th class="num">Amount</th>
            <th>Party</th>
            <th>Receptionist</th>
            <th>Invoice</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${footer}
        </body></html>`)
      win.document.close()
      win.focus()
      win.print()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to print payments')
    }
  }

  const printChargesByBranch = () => {
    const win = window.open('', '_blank', 'width=1200,height=800')
    if (!win) {
      toast.error('Pop-up blocked — allow pop-ups to print PDF')
      return
    }
    const subtitleParts: string[] = []
    if (effectivePatient) subtitleParts.push(`Patient: ${effectivePatient}`)
    if (effectiveReferenceName) subtitleParts.push(`${effectiveReferenceType}: ${effectiveReferenceName}`)
    const subtitle = subtitleParts.join(' · ')
    const rows = ccBreakdownDisplay
      .map((row) => {
        const branchCell = row.care_type
          ? `${row.branch_label} <span style="color:#9333ea;font-weight:600">(${row.care_type})</span>`
          : row.branch_label
        return `<tr>
          <td>${branchCell}</td>
          <td class="num">${row.sales_orders}</td>
          <td class="num">${formatCurrency(row.orders_amount)}</td>
          <td class="num">${row.invoices}</td>
          <td class="num">${formatCurrency(row.invoices_grand_total)}</td>
          <td class="num">${formatCurrency(row.outstanding)}</td>
        </tr>`
      })
      .join('')
    win.document.write(`<!DOCTYPE html><html><head><title>Charges by Branch</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 24px; color: #0f172a; }
        h3 { margin: 0 0 4px; font-size: 18px; }
        .sub { color: #64748b; font-size: 12px; margin: 0 0 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; }
        th { background: #f8fafc; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
        td.num, th.num { text-align: right; }
      </style></head><body>
      <h3>Charges by Branch</h3>
      ${subtitle ? `<p class="sub">${subtitle}</p>` : ''}
      <table>
        <thead><tr>
          <th>Branch</th>
          <th class="num">Service orders</th>
          <th class="num">Orders amount</th>
          <th class="num">Invoices</th>
          <th class="num">Invoiced total</th>
          <th class="num">Outstanding</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></body></html>`)
    win.document.close()
    win.focus()
    win.print()
  }

  const printDailyCollectionSummary = async () => {
    setPrintingCollection(true)
    try {
      const data = await fetchDailyCollectionSummary({
        referenceType: scopedReferenceType,
        referenceName: scopedReferenceName,
        patient: effectivePatient,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        modeOfPayment: paymentModeFilter || undefined,
        filterByOpenShift: shiftFilterActive,
        cashier: cashierFilter || undefined,
        costCenter: branchFilter || undefined,
      })
      openDailyCollectionSummaryPrint(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to print daily collection summary')
    } finally {
      setPrintingCollection(false)
    }
  }

  if (currentView === 'payments') {
    return (
      <div className="space-y-4">
        <NavigationRow />
        <DateFiltersPanel />
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">Payments</h3>
              {hasConsolidatablePayments && (
                <button
                  type="button"
                  onClick={() => setPaymentsExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title={
                    paymentsExpanded
                      ? 'Group payment entries that settle the same invoice into one row'
                      : 'Show every payment entry as its own row'
                  }
                >
                  {paymentsExpanded ? 'Consolidate' : 'Expand'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowStandalonePaymentModal(true)}
                className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold shrink-0"
                title="Create standalone payment"
              >
                +
              </button>
              <button type="button" onClick={printPayments} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 text-xs"><Printer className="w-3 h-3" /> PDF</button>
              <button type="button" onClick={exportPaymentsCsv} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 text-xs"><FileDown className="w-3 h-3" /> Excel</button>
              {effectivePatient &&
                showReconcileButton &&
                (paymentSummary?.advance_amount || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAdvanceReconcileModal(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-teal-300 bg-teal-50 text-xs font-medium text-teal-800 hover:bg-teal-100"
                  title="Apply advance credit to outstanding invoices"
                >
                  <Wallet className="w-3 h-3" />
                  Reconcile advance
                </button>
              )}
              {effectivePatient && (
                <button
                  type="button"
                  onClick={() => setShowStatementOfAccountModal(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                  title="Customer statement of account for this patient"
                >
                  <FileIcon className="w-3 h-3" />
                  Statement
                </button>
              )}
              <button
                type="button"
                onClick={() => void printDailyCollectionSummary()}
                disabled={printingCollection}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Daily collection summary for the current payment filters"
              >
                <FileIcon className="w-3 h-3" />
                {printingCollection ? 'Preparing…' : 'Collection Summary'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left">Payment</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">OP / IP</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Receptionist</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-center w-12">Print</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paymentDisplayRows.map((p) => {
                  const isRefund = p.payment_type === 'Pay'
                  const isDraft = Number(p.docstatus) === 0
                  const isAdvance = !isRefund && !isDraft && !p.invoice_name
                  const signedAmount = isRefund ? -(p.paid_amount || 0) : p.paid_amount || 0
                  const typeLabel = isDraft
                    ? 'Draft refund'
                    : isRefund
                      ? 'Refund'
                      : p.invoice_name
                        ? 'Invoice payment'
                        : 'Advance'
                  const opIpRaw = (p.custom_op_or_ip || '').trim()
                  const opIpLabel =
                    opIpRaw === 'Patient Visit' || opIpRaw.toUpperCase() === 'OP'
                      ? 'OP'
                      : opIpRaw === 'Inpatient Admission' || opIpRaw.toUpperCase() === 'IP'
                        ? 'IP'
                        : ''
                  const caseNo = (p.custom_case_no || '').trim()
                  const advanceCaseLabel =
                    isAdvance && (opIpLabel || caseNo)
                      ? [opIpLabel, caseNo].filter(Boolean).join(' · ')
                      : ''
                  const isConsolidated = p._consolidatedCount > 1
                  return (
                  <tr key={isConsolidated ? `c:${p.custom_unique_identity || p.invoice_name || p.custom_case_no || 'adv'}:${p.payment_type}:${p.name}` : p.name}>
                    <td className="px-3 py-2 font-mono text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span>{p.name}</span>
                        {isConsolidated && (
                          <span className="text-[10px] font-sans font-medium text-slate-500">
                            +{p._consolidatedCount - 1} more · total of {p._consolidatedCount}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{p.posting_date || '-'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        isDraft
                          ? 'bg-slate-100 text-slate-700'
                          : isRefund
                          ? 'bg-amber-100 text-amber-800'
                          : p.invoice_name
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                      }`}>
                        {typeLabel}
                        {isConsolidated ? ' · consolidated' : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                      {advanceCaseLabel || '—'}
                    </td>
                    <td className="px-3 py-2">{p.mode_of_payment || '-'}</td>
                    <td className={`px-3 py-2 text-right font-medium ${isDraft ? 'text-slate-500' : isRefund ? 'text-amber-700' : 'text-slate-800'}`}>
                      {isDraft ? '—' : formatCurrency(signedAmount)}
                    </td>
                    <td className="px-3 py-2">
                      <ReceptionistOwnerCell
                        doctype="Payment Entry"
                        docName={p.name}
                        userId={p.cashier}
                        userLabel={p.cashier_name || p.cashier}
                        onChanged={(userId, fullName) => {
                          const names = new Set(p._memberNames)
                          setPayments((prev) =>
                            prev.map((row) =>
                              names.has(row.name)
                                ? { ...row, cashier: userId, cashier_name: fullName }
                                : row
                            )
                          )
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">{p.invoice_name || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {!isDraft ? (
                        <PrintFormatDropdown
                          doctype="Payment Entry"
                          docName={p.name}
                          noLetterhead={0}
                          triggerPrint={1}
                          className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                          ariaLabel={`Print payment ${p.name}`}
                          title={
                            isConsolidated
                              ? p.invoice_name
                                ? 'Print consolidated payment (covers all entries for this invoice)'
                                : 'Print consolidated advance (covers all modes created together)'
                              : 'Print payment entry'
                          }
                        />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                  )
                })}
                {paymentDisplayRows.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">NO PAYMENTS FOUND FOR SELECTED FILTERS.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <SharedModals />
      </div>
    )
  }

  // Inpatient Balances View
  if (currentView === 'inpatient') {
    const totalOutstanding = inpatientBalances.reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalOverdue = inpatientBalances.filter(b => b.days_overdue > 0).reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalPaid = inpatientBalances.reduce((sum, b) => sum + b.total_paid, 0)

    return (
      <div className="space-y-6">
        <NavigationRow />
        <DateFiltersPanel />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Total Outstanding"
            value={formatCurrency(totalOutstanding)}
            subValue={`Across ${inpatientBalances.length} admissions`}
            icon={AlertCircle}
            color="bg-red-50 text-red-600"
          />
          <StatCard
            title="Overdue Amount"
            value={formatCurrency(totalOverdue)}
            subValue={`${inpatientBalances.filter(b => b.days_overdue > 0).length} overdue`}
            icon={Clock}
            color="bg-orange-50 text-orange-600"
          />
          <StatCard
            title="Total Paid"
            value={formatCurrency(totalPaid)}
            subValue="Across all admissions"
            icon={CheckCircle}
            color="bg-green-50 text-green-600"
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-600 mr-2">Filter:</span>
          <FilterButton label="All" active={inpatientFilter === 'all'} onClick={() => setInpatientFilter('all')} color="bg-slate-600" />
          <FilterButton label="Unpaid" active={inpatientFilter === 'unpaid'} onClick={() => setInpatientFilter('unpaid')} color="bg-orange-600" />
          <FilterButton label="Partial" active={inpatientFilter === 'partial'} onClick={() => setInpatientFilter('partial')} color="bg-yellow-600" />
          <FilterButton label="Paid" active={inpatientFilter === 'paid'} onClick={() => setInpatientFilter('paid')} color="bg-green-600" />
          <FilterButton label="Overdue" active={inpatientFilter === 'overdue'} onClick={() => setInpatientFilter('overdue')} color="bg-red-600" />
        </div>

        {filteredInpatient.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <Users className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-30" />
            <p className="text-slate-500">NO INPATIENT BALANCES FOUND</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredInpatient.map((balance) => {
              const status = getBalanceStatusColor(balance)
              const percentagePaid = balance.total_amount > 0 ? (balance.total_paid / balance.total_amount) * 100 : 0
              const isLoading = loadingInvoices === balance.admission_id
              
              return (
                <div key={balance.admission_id} className={`bg-white rounded-xl border ${status.border} p-5 hover:shadow-md transition-all`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-2 h-2 rounded-full ${status.badge.replace('bg-', 'bg-')}`} />
                        <h3 className="font-semibold text-slate-900">{balance.patient_name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${status.badge}`}>{status.label}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div><p className="text-xs text-slate-400">Admission ID</p><p className="text-slate-700 font-mono text-xs">{balance.admission_id}</p></div>
                        <div><p className="text-xs text-slate-400">Admission Date</p><p className="text-slate-700">{balance.admission_date}</p></div>
                        <div><p className="text-xs text-slate-400">Branch</p><p className="text-slate-700">{balance.cost_center || '—'}</p></div>
                        {balance.days_overdue > 0 && <div><p className="text-xs text-slate-400">Days Overdue</p><p className="text-red-600 font-medium">{balance.days_overdue} days</p></div>}
                      </div>
                    </div>
                    <div className="text-right min-w-[180px]">
                      <p className="text-xs text-slate-400">Total Charges</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(balance.total_amount)}</p>
                      <div className="mt-1">
                        <p className="text-xs text-green-600">Paid: {formatCurrency(balance.total_paid)}</p>
                        <p className={`text-xs font-medium ${balance.outstanding_amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          Outstanding: {formatCurrency(balance.outstanding_amount)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {balance.total_amount > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Payment Progress</span>
                        <span>{percentagePaid.toFixed(1)}% paid</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${percentagePaid === 100 ? 'bg-green-500' : balance.days_overdue > 0 ? 'bg-red-500' : 'bg-primary'}`}
                          style={{ width: `${percentagePaid}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() =>
                        void openInvoiceForHealthcareReference(
                          balance.admission_id,
                          'Inpatient Admission',
                          balance.latest_invoice_name
                        )
                      }
                      disabled={isLoading}
                      className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Open invoice details (slide-over)"
                    >
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Receipt className="w-3 h-3" />
                      )}
                      View invoice
                    </button>
                    {balance.latest_invoice_name ? (
                      <PrintFormatDropdown
                        doctype="Sales Invoice"
                        docName={balance.latest_invoice_name}
                        noLetterhead={0}
                        triggerPrint={1}
                        className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      />
                    ) : null}
                    {balance.outstanding_amount > 0 && (
  <button 
    onClick={() =>
      handleMakePayment(
        balance.admission_id,
        balance.patient_name,
        balance.outstanding_amount,
        'Inpatient Admission',
        balance.patient_id
      )
    }
    className="text-xs text-green-600 hover:underline flex items-center gap-1"
    title={`Pay outstanding amount of ${formatCurrency(balance.outstanding_amount)}`}
  >
    <CreditCard className="w-3 h-3" /> Make Payment
  </button>
)}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <SharedModals />
      </div>
    )
  }

  // Outpatient Balances View
  if (currentView === 'outpatient') {
    const totalOutstanding = outpatientBalances.reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalOverdue = outpatientBalances.filter(b => b.days_overdue > 0).reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalPaid = outpatientBalances.reduce((sum, b) => sum + b.total_paid, 0)

    return (
      <div className="space-y-6">
        <NavigationRow />
        <DateFiltersPanel />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Total Outstanding" value={formatCurrency(totalOutstanding)} subValue={`Across ${outpatientBalances.length} visits`} icon={AlertCircle} color="bg-red-50 text-red-600" />
          <StatCard title="Overdue Amount" value={formatCurrency(totalOverdue)} subValue={`${outpatientBalances.filter(b => b.days_overdue > 0).length} overdue`} icon={Clock} color="bg-orange-50 text-orange-600" />
          <StatCard title="Total Paid" value={formatCurrency(totalPaid)} subValue="Across all visits" icon={CheckCircle} color="bg-green-50 text-green-600" />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-600 mr-2">Filter:</span>
          <FilterButton label="All" active={outpatientFilter === 'all'} onClick={() => setOutpatientFilter('all')} color="bg-slate-600" />
          <FilterButton label="Unpaid" active={outpatientFilter === 'unpaid'} onClick={() => setOutpatientFilter('unpaid')} color="bg-orange-600" />
          <FilterButton label="Partial" active={outpatientFilter === 'partial'} onClick={() => setOutpatientFilter('partial')} color="bg-yellow-600" />
          <FilterButton label="Paid" active={outpatientFilter === 'paid'} onClick={() => setOutpatientFilter('paid')} color="bg-green-600" />
          <FilterButton label="Overdue" active={outpatientFilter === 'overdue'} onClick={() => setOutpatientFilter('overdue')} color="bg-red-600" />
        </div>

        {filteredOutpatient.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <User className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-30" />
            <p className="text-slate-500">NO OUTPATIENT BALANCES FOUND</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOutpatient.map((balance) => {
              const status = getBalanceStatusColor(balance)
              const percentagePaid = balance.total_amount > 0 ? (balance.total_paid / balance.total_amount) * 100 : 0
              const isLoading = loadingInvoices === balance.visit_id
              
              return (
                <div key={balance.visit_id} className={`bg-white rounded-xl border ${status.border} p-5 hover:shadow-md transition-all`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-2 h-2 rounded-full ${status.badge.replace('bg-', 'bg-')}`} />
                        <h3 className="font-semibold text-slate-900">{balance.patient_name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${status.badge}`}>{status.label}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div><p className="text-xs text-slate-400">Visit ID</p><p className="text-slate-700 font-mono text-xs">{balance.visit_id}</p></div>
                        <div><p className="text-xs text-slate-400">Visit Date</p><p className="text-slate-700">{balance.visit_date}</p></div>
                        <div><p className="text-xs text-slate-400">Doctor</p><p className="text-slate-700">{balance.practitioner || '—'}</p></div>
                        <div><p className="text-xs text-slate-400">Branch</p><p className="text-slate-700">{balance.cost_center || '—'}</p></div>
                        {balance.days_overdue > 0 && <div><p className="text-xs text-slate-400">Days Overdue</p><p className="text-red-600 font-medium">{balance.days_overdue} days</p></div>}
                      </div>
                    </div>
                    <div className="text-right min-w-[180px]">
                      <p className="text-xs text-slate-400">Total Charges</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(balance.total_amount)}</p>
                      <div className="mt-1">
                        <p className="text-xs text-green-600">Paid: {formatCurrency(balance.total_paid)}</p>
                        <p className={`text-xs font-medium ${balance.outstanding_amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          Outstanding: {formatCurrency(balance.outstanding_amount)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {balance.total_amount > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Payment Progress</span>
                        <span>{percentagePaid.toFixed(1)}% paid</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${percentagePaid === 100 ? 'bg-green-500' : balance.days_overdue > 0 ? 'bg-red-500' : 'bg-primary'}`}
                          style={{ width: `${percentagePaid}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() =>
                        void openInvoiceForHealthcareReference(
                          balance.visit_id,
                          'Patient Visit',
                          balance.latest_invoice_name
                        )
                      }
                      disabled={isLoading}
                      className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Open invoice details (slide-over)"
                    >
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Receipt className="w-3 h-3" />
                      )}
                      View invoice
                    </button>
                    {balance.latest_invoice_name ? (
                      <PrintFormatDropdown
                        doctype="Sales Invoice"
                        docName={balance.latest_invoice_name}
                        noLetterhead={0}
                        triggerPrint={1}
                        className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      />
                    ) : null}
                    {balance.outstanding_amount > 0 && (
  <button 
    onClick={() =>
      handleMakePayment(
        balance.visit_id,
        balance.patient_name,
        balance.outstanding_amount,
        'Patient Visit',
        balance.patient_id
      )
    }
    className="text-xs text-green-600 hover:underline flex items-center gap-1"
    title={`Pay outstanding amount of ${formatCurrency(balance.outstanding_amount)}`}
  >
    <CreditCard className="w-3 h-3" /> Make Payment
  </button>
)}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <SharedModals />
      </div>
    )
  }

  // IOP Balances View (Patient Visit with visit type IOP)
  if (currentView === 'iop') {
    const totalOutstanding = iopBalances.reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalOverdue = iopBalances.filter(b => b.days_overdue > 0).reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalPaid = iopBalances.reduce((sum, b) => sum + b.total_paid, 0)

    return (
      <div className="space-y-6">
        <NavigationRow />
        <DateFiltersPanel />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Total Outstanding" value={formatCurrency(totalOutstanding)} subValue={`Across ${iopBalances.length} IOP visits`} icon={AlertCircle} color="bg-red-50 text-red-600" />
          <StatCard title="Overdue Amount" value={formatCurrency(totalOverdue)} subValue={`${iopBalances.filter(b => b.days_overdue > 0).length} overdue`} icon={Clock} color="bg-orange-50 text-orange-600" />
          <StatCard title="Total Paid" value={formatCurrency(totalPaid)} subValue="Across all IOP visits" icon={CheckCircle} color="bg-green-50 text-green-600" />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-600 mr-2">Filter:</span>
          <FilterButton label="All" active={iopFilter === 'all'} onClick={() => setIopFilter('all')} color="bg-slate-600" />
          <FilterButton label="Unpaid" active={iopFilter === 'unpaid'} onClick={() => setIopFilter('unpaid')} color="bg-orange-600" />
          <FilterButton label="Partial" active={iopFilter === 'partial'} onClick={() => setIopFilter('partial')} color="bg-yellow-600" />
          <FilterButton label="Paid" active={iopFilter === 'paid'} onClick={() => setIopFilter('paid')} color="bg-green-600" />
          <FilterButton label="Overdue" active={iopFilter === 'overdue'} onClick={() => setIopFilter('overdue')} color="bg-red-600" />
        </div>

        {filteredIop.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <Activity className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-30" />
            <p className="text-slate-500">NO IOP VISIT BALANCES FOUND</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredIop.map((balance) => {
              const status = getBalanceStatusColor(balance)
              const percentagePaid = balance.total_amount > 0 ? (balance.total_paid / balance.total_amount) * 100 : 0
              const isLoading = loadingInvoices === balance.visit_id

              return (
                <div key={balance.visit_id} className={`bg-white rounded-xl border ${status.border} p-5 hover:shadow-md transition-all`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-2 h-2 rounded-full ${status.badge.replace('bg-', 'bg-')}`} />
                        <h3 className="font-semibold text-slate-900">{balance.patient_name}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">IOP</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${status.badge}`}>{status.label}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div><p className="text-xs text-slate-400">Visit ID</p><p className="text-slate-700 font-mono text-xs">{balance.visit_id}</p></div>
                        <div><p className="text-xs text-slate-400">Visit Date</p><p className="text-slate-700">{balance.visit_date}</p></div>
                        <div><p className="text-xs text-slate-400">Doctor</p><p className="text-slate-700">{balance.practitioner || '—'}</p></div>
                        <div><p className="text-xs text-slate-400">Branch</p><p className="text-slate-700">{balance.cost_center || '—'}</p></div>
                        {balance.days_overdue > 0 && <div><p className="text-xs text-slate-400">Days Overdue</p><p className="text-red-600 font-medium">{balance.days_overdue} days</p></div>}
                      </div>
                    </div>
                    <div className="text-right min-w-[180px]">
                      <p className="text-xs text-slate-400">Total Charges</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(balance.total_amount)}</p>
                      <div className="mt-1">
                        <p className="text-xs text-green-600">Paid: {formatCurrency(balance.total_paid)}</p>
                        <p className={`text-xs font-medium ${balance.outstanding_amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          Outstanding: {formatCurrency(balance.outstanding_amount)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {balance.total_amount > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Payment Progress</span>
                        <span>{percentagePaid.toFixed(1)}% paid</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${percentagePaid === 100 ? 'bg-green-500' : balance.days_overdue > 0 ? 'bg-red-500' : 'bg-primary'}`}
                          style={{ width: `${percentagePaid}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() =>
                        void openInvoiceForHealthcareReference(
                          balance.visit_id,
                          'Patient Visit',
                          balance.latest_invoice_name
                        )
                      }
                      disabled={isLoading}
                      className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Open invoice details (slide-over)"
                    >
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Receipt className="w-3 h-3" />
                      )}
                      View invoice
                    </button>
                    {balance.latest_invoice_name ? (
                      <PrintFormatDropdown
                        doctype="Sales Invoice"
                        docName={balance.latest_invoice_name}
                        noLetterhead={0}
                        triggerPrint={1}
                        className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      />
                    ) : null}
                    {balance.outstanding_amount > 0 && (
                      <button
                        onClick={() =>
                          handleMakePayment(
                            balance.visit_id,
                            balance.patient_name,
                            balance.outstanding_amount,
                            'Patient Visit',
                            balance.patient_id
                          )
                        }
                        className="text-xs text-green-600 hover:underline flex items-center gap-1"
                        title={`Pay outstanding amount of ${formatCurrency(balance.outstanding_amount)}`}
                      >
                        <CreditCard className="w-3 h-3" /> Make Payment
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <SharedModals />
      </div>
    )
  }

  // Daily Auto Visit balances
  if (currentView === 'dv') {
    const totalOutstanding = dvBalances.reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalOverdue = dvBalances.filter(b => b.days_overdue > 0).reduce((sum, b) => sum + b.outstanding_amount, 0)
    const totalPaid = dvBalances.reduce((sum, b) => sum + b.total_paid, 0)

    return (
      <div className="space-y-6">
        <NavigationRow />
        <DateFiltersPanel />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Total Outstanding" value={formatCurrency(totalOutstanding)} subValue={`Across ${dvBalances.length} daily auto visits`} icon={AlertCircle} color="bg-red-50 text-red-600" />
          <StatCard title="Overdue Amount" value={formatCurrency(totalOverdue)} subValue={`${dvBalances.filter(b => b.days_overdue > 0).length} overdue`} icon={Clock} color="bg-orange-50 text-orange-600" />
          <StatCard title="Total Paid" value={formatCurrency(totalPaid)} subValue="Across all daily auto visits" icon={CheckCircle} color="bg-green-50 text-green-600" />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-600 mr-2">Filter:</span>
          <FilterButton label="All" active={dvFilter === 'all'} onClick={() => setDvFilter('all')} color="bg-slate-600" />
          <FilterButton label="Unpaid" active={dvFilter === 'unpaid'} onClick={() => setDvFilter('unpaid')} color="bg-orange-600" />
          <FilterButton label="Partial" active={dvFilter === 'partial'} onClick={() => setDvFilter('partial')} color="bg-yellow-600" />
          <FilterButton label="Paid" active={dvFilter === 'paid'} onClick={() => setDvFilter('paid')} color="bg-green-600" />
          <FilterButton label="Overdue" active={dvFilter === 'overdue'} onClick={() => setDvFilter('overdue')} color="bg-red-600" />
        </div>

        {filteredDv.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <CalendarClock className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-30" />
            <p className="text-slate-500">NO DAILY AUTO VISIT BALANCES FOUND</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDv.map((balance) => {
              const status = getBalanceStatusColor(balance)
              const percentagePaid = balance.total_amount > 0 ? (balance.total_paid / balance.total_amount) * 100 : 0
              const isLoading = loadingInvoices === balance.visit_id
              const hasPendingOrders = (balance.pending_sales_order_names?.length ?? 0) > 0
              const needsInvoice = !balance.latest_invoice_name && hasPendingOrders

              return (
                <div key={balance.visit_id} className={`bg-white rounded-xl border ${status.border} p-5 hover:shadow-md transition-all`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-2 h-2 rounded-full ${status.badge.replace('bg-', 'bg-')}`} />
                        <h3 className="font-semibold text-slate-900">{balance.patient_name}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">DV</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${status.badge}`}>{status.label}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div><p className="text-xs text-slate-400">Visit ID</p><p className="text-slate-700 font-mono text-xs">{balance.visit_id}</p></div>
                        <div><p className="text-xs text-slate-400">Visit Date</p><p className="text-slate-700">{balance.visit_date}</p></div>
                        <div><p className="text-xs text-slate-400">Doctor</p><p className="text-slate-700">{balance.practitioner || '—'}</p></div>
                        <div><p className="text-xs text-slate-400">Branch</p><p className="text-slate-700">{balance.cost_center || '—'}</p></div>
                        {balance.days_overdue > 0 && <div><p className="text-xs text-slate-400">Days Overdue</p><p className="text-red-600 font-medium">{balance.days_overdue} days</p></div>}
                      </div>
                      {needsInvoice && (balance.uninvoiced_amount ?? 0) > 0 && (
                        <p className="text-xs text-amber-700 mt-2">
                          {formatCurrency(balance.uninvoiced_amount ?? 0)} on sales order(s) — invoice not created yet
                        </p>
                      )}
                    </div>
                    <div className="text-right min-w-[180px]">
                      <p className="text-xs text-slate-400">Total Charges</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(balance.total_amount)}</p>
                      <div className="mt-1">
                        <p className="text-xs text-green-600">Paid: {formatCurrency(balance.total_paid)}</p>
                        <p className={`text-xs font-medium ${balance.outstanding_amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          Outstanding: {formatCurrency(balance.outstanding_amount)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {balance.total_amount > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Payment Progress</span>
                        <span>{percentagePaid.toFixed(1)}% paid</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${percentagePaid === 100 ? 'bg-green-500' : balance.days_overdue > 0 ? 'bg-red-500' : 'bg-primary'}`}
                          style={{ width: `${percentagePaid}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                    {needsInvoice ? (
                      <button
                        type="button"
                        onClick={() => void handleCreateInvoiceForDailyVisit(balance.visit_id)}
                        disabled={isLoading}
                        className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Receipt className="w-3 h-3" />}
                        Create invoice
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void openInvoiceForHealthcareReference(
                            balance.visit_id,
                            'Patient Visit',
                            balance.latest_invoice_name
                          )
                        }
                        disabled={isLoading}
                        className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Open invoice details (slide-over)"
                      >
                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Receipt className="w-3 h-3" />}
                        View invoice
                      </button>
                    )}
                    {balance.latest_invoice_name ? (
                      <PrintFormatDropdown
                        doctype="Sales Invoice"
                        docName={balance.latest_invoice_name}
                        noLetterhead={0}
                        triggerPrint={1}
                        className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      />
                    ) : null}
                    {balance.latest_invoice_name && balance.outstanding_amount > 0 && (
                      <button
                        onClick={() =>
                          handleMakePayment(
                            balance.visit_id,
                            balance.patient_name,
                            balance.outstanding_amount,
                            'Patient Visit',
                            balance.patient_id
                          )
                        }
                        className="text-xs text-green-600 hover:underline flex items-center gap-1"
                        title={`Pay outstanding amount of ${formatCurrency(balance.outstanding_amount)}`}
                      >
                        <CreditCard className="w-3 h-3" /> Make Payment
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <SharedModals />
      </div>
    )
  }

  // Overview Dashboard
  return (
    <div className="space-y-6">
      <NavigationRow />
      <DateFiltersPanel />

      {billingCcRestricted === true && (effectivePatient || effectiveReferenceName) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Billing lists and totals are limited to your assigned branch (Settings → Branch Filter). To see all
          branches, clear that filter or ask an administrator.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        <StatCard title="Total Orders" value={orderSummary?.total_orders || 0} subValue={`${formatCurrency(orderSummary?.total_amount || 0)} total value`} icon={Package} color="bg-blue-50 text-blue-600" onClick={() => handleViewChange('orders')} />
        <StatCard title="Total Invoices" value={invoiceSummary?.total_invoices || 0} subValue={`${formatCurrency(invoiceSummary?.total_amount || 0)} total value`} icon={Receipt} color="bg-purple-50 text-purple-600" onClick={() => handleViewChange('invoices')} />
        <StatCard title="Paid Amount" value={formatCurrency(invoiceSummary?.total_paid || 0)} subValue={`${invoiceSummary?.paid.count || 0} invoices paid`} icon={CheckCircle} color="bg-green-50 text-green-600" onClick={() => handleViewChange('paid')} />
        <StatCard title="Outstanding" value={formatCurrency(invoiceSummary?.total_outstanding || 0)} subValue={`${(invoiceSummary?.unpaid.count || 0) + (invoiceSummary?.overdue.count || 0)} invoices pending`} icon={AlertCircle} color="bg-red-50 text-red-600" onClick={() => handleViewChange('unpaid')} />
        <StatCard title="Advance / Credit" value={formatCurrency(paymentSummary?.advance_amount || 0)} subValue={effectivePatient ? 'Unallocated credit on account' : 'Held across branches'} icon={Wallet} color="bg-teal-50 text-teal-600" onClick={() => handleViewChange('payments')} />
      </div>

      {showCcBreakdown && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800">Charges by Branch</h3>
                <p className="text-xs text-slate-500 mt-1">
                  For the selected patient{effectiveReferenceName ? ` · ${effectiveReferenceType}: ${effectiveReferenceName}` : ''}.
                  {showOpIpBranchSplit
                    ? ' Separate row per branch for OP and IP when no visit or admission is selected in the navbar.'
                    : ' Shown when your account is not restricted to a single branch.'}
                </p>
              </div>
              <button
                type="button"
                onClick={printChargesByBranch}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Printer className="w-3 h-3" />
                PDF
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Branch</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Service orders</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Orders amount</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Invoices</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Invoiced total</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ccBreakdownDisplay.map((row) => (
                    <tr key={row.row_key} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-800 font-medium">
                        {row.branch_label}
                        {row.care_type ? (
                          <span className="ml-1 font-semibold text-purple-600">({row.care_type})</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.sales_orders}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(row.orders_amount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.invoices}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(row.invoices_grand_total)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">{formatCurrency(row.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setCrossBranchOpen((open) => !open)}
              className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition"
              aria-expanded={crossBranchOpen}
            >
              <div>
                <h3 className="font-semibold text-slate-800">
                  Cross-branch paid charges
                  {crossBranchPaid.length > 0 ? (
                    <span className="ml-2 text-xs font-medium text-slate-500">
                      ({crossBranchPaid.length})
                    </span>
                  ) : null}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Invoice branch differs from Payment Entry branch — paid at another branch (Cross‑Branch Payment).
                </p>
              </div>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${
                  crossBranchOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {crossBranchOpen ? (
              <div className="border-t border-slate-200 overflow-x-auto">
                {crossBranchPaid.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-slate-400">
                    No cross-branch payments for this selection.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">
                          Invoice branch
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">
                          Payment branch
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">
                          Invoices
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">
                          Payments
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">
                          Paid amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {crossBranchPaid.map((row) => (
                        <tr
                          key={`${row.invoice_cost_center}|${row.payment_cost_center}`}
                          className="hover:bg-slate-50"
                        >
                          <td className="px-4 py-2.5 text-slate-800 font-medium">
                            {row.invoice_branch_name}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">
                            {row.payment_branch_name}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                            {row.invoice_count}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                            {row.payment_count}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                            {formatCurrency(row.paid_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-md font-semibold text-slate-800 mb-4 flex items-center gap-2"><Package className="w-4 h-4 text-primary" /> Order Summary</h3>
          <div className="space-y-3">
            <QuickActionCard title="Not Invoiced" count={orderSummary?.not_invoiced.count || 0} amount={orderSummary?.not_invoiced.amount || 0} icon={Clock} color="bg-yellow-50 text-yellow-600" onClick={() => handleViewChange('orders')} />
            <QuickActionCard title="Invoiced (Paid)" count={orderSummary?.invoiced.count || 0} amount={orderSummary?.invoiced.amount || 0} icon={CheckCircle} color="bg-green-50 text-green-600" onClick={() => handleViewChange('paid')} />
            <QuickActionCard title="Partially Invoiced" count={orderSummary?.partially_invoiced.count || 0} amount={orderSummary?.partially_invoiced.amount || 0} icon={AlertCircle} color="bg-orange-50 text-orange-600" onClick={() => handleViewChange('invoices')} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-md font-semibold text-slate-800 mb-4 flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" /> Invoice Summary</h3>
          <div className="space-y-3">
            <QuickActionCard title="Paid Invoices" count={invoiceSummary?.paid.count || 0} amount={invoiceSummary?.paid.amount || 0} icon={CheckCircle} color="bg-green-50 text-green-600" onClick={() => handleViewChange('paid')} />
            <QuickActionCard title="Unpaid/Overdue" count={(invoiceSummary?.unpaid.count || 0) + (invoiceSummary?.overdue.count || 0)} amount={(invoiceSummary?.unpaid.amount || 0) + (invoiceSummary?.overdue.amount || 0)} icon={AlertCircle} color="bg-red-50 text-red-600" onClick={() => handleViewChange('unpaid')} />
            <QuickActionCard title="Partially Paid" count={invoiceSummary?.partially_paid.count || 0} amount={invoiceSummary?.partially_paid.amount || 0} icon={TrendingUp} color="bg-blue-50 text-blue-600" onClick={() => handleViewChange('invoices')} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-md font-semibold text-slate-800 flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Payment Summary</h3>
            <button type="button" onClick={() => handleViewChange('payments')} className="text-xs text-primary hover:underline">View payments</button>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-slate-600">Total Paid</div>
            <div className="text-xl font-bold text-green-600">{formatCurrency(paymentSummary?.total_paid || 0)}</div>
            <div className="text-xs text-slate-500">{paymentSummary?.payment_count || 0} payments</div>
            {(paymentSummary?.advance_amount || 0) > 0 && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-teal-50 px-3 py-2 gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-teal-700">
                  <Wallet className="w-3.5 h-3.5" /> Advance / Credit
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-teal-700">
                    {formatCurrency(paymentSummary?.advance_amount || 0)}
                  </span>
                  {effectivePatient && showReconcileButton && (
                    <button
                      type="button"
                      onClick={() => setShowAdvanceReconcileModal(true)}
                      className="text-[11px] font-semibold text-teal-800 underline hover:no-underline"
                    >
                      Reconcile
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="pt-2 border-t border-slate-100 space-y-1">
              {(paymentSummary?.modes || []).slice(0, 5).map((mode) => (
                <div key={mode.mode_of_payment} className="flex items-center justify-between text-xs">
                  <span className="text-slate-700">{mode.mode_of_payment} ({mode.count})</span>
                  <span className="font-medium text-slate-900">{formatCurrency(mode.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl border border-primary/20 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Inpatient Balances</h3>
            <button onClick={() => handleViewChange('inpatient')} className="text-sm text-primary hover:underline flex items-center gap-1">View All <ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-3 text-center"><p className="text-2xl font-bold text-red-600">{formatCurrency(inpatientBalances.reduce((sum, b) => sum + b.outstanding_amount, 0))}</p><p className="text-xs text-slate-500">Outstanding</p></div>
            <div className="bg-white rounded-lg p-3 text-center"><p className="text-2xl font-bold text-orange-600">{formatCurrency(inpatientBalances.filter(b => b.days_overdue > 0).reduce((sum, b) => sum + b.outstanding_amount, 0))}</p><p className="text-xs text-slate-500">Overdue</p></div>
            <div className="bg-white rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-600">{inpatientBalances.filter(b => b.outstanding_amount === 0 && b.total_paid > 0).length}</p><p className="text-xs text-slate-500">Fully Paid</p></div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl border border-primary/20 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Outpatient Balances</h3>
            <button onClick={() => handleViewChange('outpatient')} className="text-sm text-primary hover:underline flex items-center gap-1">View All <ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-3 text-center"><p className="text-2xl font-bold text-red-600">{formatCurrency(outpatientBalances.reduce((sum, b) => sum + b.outstanding_amount, 0))}</p><p className="text-xs text-slate-500">Outstanding</p></div>
            <div className="bg-white rounded-lg p-3 text-center"><p className="text-2xl font-bold text-orange-600">{formatCurrency(outpatientBalances.filter(b => b.days_overdue > 0).reduce((sum, b) => sum + b.outstanding_amount, 0))}</p><p className="text-xs text-slate-500">Overdue</p></div>
            <div className="bg-white rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-600">{outpatientBalances.filter(b => b.outstanding_amount === 0 && b.total_paid > 0).length}</p><p className="text-xs text-slate-500">Fully Paid</p></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200"><h3 className="font-semibold text-slate-800">Recent Orders</h3><button onClick={() => handleViewChange('orders')} className="text-xs text-primary hover:underline">View All →</button></div>
          {recentOrders.length === 0 ? <div className="p-8 text-center text-slate-400"><Package className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm">No recent orders</p></div> : (
            <div className="divide-y divide-slate-100">
              {recentOrders.map((order) => (
                <div key={order.name} className="px-5 py-3 hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-primary">{order.name}</p>
                      <p className="text-xs text-slate-400">{order.transaction_date}</p>
                      <div className="mt-1">
                        <ServiceOrderServiceCell order={order} />
                      </div>
                      {(order.cost_center_name || order.cost_center) && (
                        <p
                          className="text-[11px] text-slate-500 mt-0.5 truncate"
                          title={order.cost_center_name || order.cost_center || undefined}
                        >
                          Branch: {order.cost_center_name || order.cost_center}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-slate-900">{formatCurrency(order.grand_total)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200"><h3 className="font-semibold text-slate-800">Recent Invoices</h3><button onClick={() => handleViewChange('invoices')} className="text-xs text-primary hover:underline">View All →</button></div>
          {recentInvoices.length === 0 ? <div className="p-8 text-center text-slate-400"><Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm">No recent invoices</p></div> : (
            <div className="divide-y divide-slate-100">
              {recentInvoices.map((invoice) => (
                <div key={invoice.name} className="px-5 py-3 hover:bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <button
                        type="button"
                        onClick={() => openInvoiceDetail(invoice.name)}
                        className="font-mono text-[11px] font-medium text-primary hover:underline text-left"
                      >
                        {invoice.name}
                      </button>
                      <p className="text-xs text-slate-400">{invoice.posting_date}</p>
                      {(invoice.cost_center_name || invoice.cost_center || invoice.custom_created_at) && (
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={invoice.cost_center_name || invoice.cost_center || invoice.custom_created_at || ''}>
                          Branch: {invoice.cost_center_name || invoice.cost_center || invoice.custom_created_at}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{formatCurrency(invoice.grand_total)}</p>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(invoice.status)}`}>
                        {invoice.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SharedModals />
    </div>
  )
}