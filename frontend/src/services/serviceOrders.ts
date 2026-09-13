// services/serviceOrders.ts
import { ensureCSRF } from './apiClient'

export interface ServiceOrder {
  name: string
  customer: string
  customer_name: string
  transaction_date: string
  status: string
  grand_total: number
  billable_grand_total?: number
  returned_amount?: number
  has_dispense_returns?: boolean
  total: number
  custom_reference_type: 'Patient Visit' | 'Inpatient Admission'
  custom_reference_name: string
  custom_base_reference: string
  custom_base_reference_name: string
  patient: string
  patient_name: string
  docstatus: number
  invoice_status?: string
  invoice_name?: string
  invoice_amount?: number
  cost_center?: string | null
  cost_center_name?: string
  /** Reception label e.g. Consultation — Initial, Lab tests — CBC */
  order_kind_label?: string
  items?: {
    item_code?: string
    item_name?: string
    description?: string
    qty?: number
    original_qty?: number
    returned_qty?: number
    rate?: number
    amount?: number
  }[]
}

export function getServiceOrderBillableTotal(order: ServiceOrder): number {
  if (order.billable_grand_total != null) {
    return Number(order.billable_grand_total) || 0
  }
  return Number(order.grand_total) || 0
}

export interface OutpatientBalance {
  visit_id: string
  patient_name: string
  patient_id: string
  visit_date: string
  practitioner?: string
  /** Patient Visit branch */
  cost_center?: string | null
  /** Most recent submitted invoice for this visit (for quick open / print) */
  latest_invoice_name?: string | null
  total_amount: number
  total_paid: number
  outstanding_amount: number
  days_overdue: number
  last_invoice_date?: string
  /** Submitted sales orders not yet on an invoice (Daily Auto Visit billing). */
  pending_sales_order_names?: string[]
  uninvoiced_amount?: number
}

export interface ServiceInvoice {
  name: string
  /** 0 draft, 1 submitted, 2 cancelled */
  docstatus?: number
  company?: string
  customer: string
  customer_name: string
  posting_date: string
  due_date: string
  status: string
  grand_total: number
  outstanding_amount: number
  paid_amount: number
  custom_reference_type: string
  custom_reference_name: string
  patient: string
  patient_name: string
  order_count?: number
  /** Collection / created-at branch (same convention as specialty billing) */
  custom_created_at?: string | null
  cost_center?: string | null
  cost_center_name?: string
}

export interface OrderSummary {
  total_orders: number
  total_amount: number
  draft: { count: number; amount: number }
  submitted: { count: number; amount: number }
  cancelled: { count: number; amount: number }
  invoiced: { count: number; amount: number }
  partially_invoiced: { count: number; amount: number }
  not_invoiced: { count: number; amount: number }
}

export interface InvoiceSummary {
  total_invoices: number
  total_amount: number
  total_paid: number
  total_outstanding: number
  paid: { count: number; amount: number }
  unpaid: { count: number; amount: number }
  overdue: { count: number; amount: number }
  partially_paid: { count: number; amount: number }
}

export interface PaymentEntryRow {
  name: string
  docstatus?: number
  posting_date: string
  /** Frappe creation datetime — used to consolidate multi-mode advances. */
  creation?: string | null
  payment_type?: string
  mode_of_payment: string
  paid_amount: number
  party?: string | null
  party_name?: string
  reference_no?: string
  cost_center?: string | null
  remarks?: string | null
  cashier?: string | null
  cashier_name?: string | null
  invoice_name?: string | null
  invoice_reference_type?: string | null
  invoice_reference_name?: string | null
  /** Advance tagging: "Patient Visit" | "Inpatient Admission" */
  custom_op_or_ip?: string | null
  /** Advance visit / admission name */
  custom_case_no?: string | null
  /** Shared id when one UI payment creates multiple PEs (multi mode-of-payment). */
  custom_unique_identity?: string | null
}

export interface PaymentModeSummary {
  mode_of_payment: string
  count: number
  amount: number
}

export interface PaymentSummary {
  payment_count: number
  total_paid: number
  advance_amount?: number
  modes: PaymentModeSummary[]
}

export interface BillingCostCenterScope {
  restricted: boolean
}

export interface PatientBillingCcCareTotals {
  sales_orders: number
  orders_amount: number
  invoices: number
  invoices_grand_total: number
  outstanding: number
}

export interface PatientBillingCcRow {
  cost_center: string
  cost_center_name: string
  sales_orders: number
  orders_amount: number
  invoices: number
  invoices_grand_total: number
  outstanding: number
  op?: PatientBillingCcCareTotals
  ip?: PatientBillingCcCareTotals
}

export interface PatientBillingCcBreakdown {
  restricted: boolean
  rows: PatientBillingCcRow[]
}

export async function fetchServiceOrders(
  referenceType?: string,
  referenceName?: string,
  patient?: string,
  status?: string,
  fromDate?: string,
  toDate?: string,
  search?: string
): Promise<ServiceOrder[]> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  if (status) params.append('status', status)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  if (search?.trim()) params.append('search', search.trim())

  const response = await fetch(
    `/api/method/healthcare.api.sales_order.get_service_orders?${params.toString()}`
  )
  const data = await response.json()
  return data.message || []
}

export async function fetchServiceOrderSummary(
  referenceType?: string,
  referenceName?: string,
  patient?: string,
  fromDate?: string,
  toDate?: string,
  search?: string
): Promise<OrderSummary> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  if (search?.trim()) params.append('search', search.trim())

  const response = await fetch(
    `/api/method/healthcare.api.sales_order.get_service_order_summary?${params.toString()}`
  )
  const data = await response.json()
  return data.message || {}
}

export async function fetchServiceInvoices(
  referenceType?: string,
  referenceName?: string,
  patient?: string,
  status?: string,
  fromDate?: string,
  toDate?: string,
  search?: string,
  filterByOpenShift?: boolean
): Promise<ServiceInvoice[]> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  if (status) params.append('status', status)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  if (search?.trim()) params.append('search', search.trim())
  if (filterByOpenShift) params.append('filter_by_open_shift', '1')

  const response = await fetch(
    `/api/method/healthcare.api.sales_invoice.get_service_invoices?${params.toString()}`
  )
  const data = await response.json()

  return data.message || []

}

export async function fetchInvoiceSummary(
  referenceType?: string,
  referenceName?: string,
  patient?: string,
  fromDate?: string,
  toDate?: string,
  search?: string,
  filterByOpenShift?: boolean
): Promise<InvoiceSummary> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  if (search?.trim()) params.append('search', search.trim())
  if (filterByOpenShift) params.append('filter_by_open_shift', '1')

  const response = await fetch(
    `/api/method/healthcare.api.sales_invoice.get_invoice_summary?${params.toString()}`
  )
  const data = await response.json()
  return data.message || {}
}

export async function fetchBillingCostCenterScope(): Promise<BillingCostCenterScope> {
  const response = await fetch(
    '/api/method/healthcare.api.common.get_billing_cost_center_scope',
    { credentials: 'include' }
  )
  const data = await response.json()
  return (data.message as BillingCostCenterScope) || { restricted: false }
}

export interface LetterHeadHtml {
  content?: string
  footer?: string
}

export async function fetchCostCenterLetterHead(
  costCenter?: string,
  opts?: { patient?: string; referenceType?: string; referenceName?: string },
): Promise<LetterHeadHtml> {
  const params = new URLSearchParams()
  if (costCenter) params.append('cost_center', costCenter)
  if (opts?.patient) params.append('patient', opts.patient)
  if (opts?.referenceType) params.append('reference_type', opts.referenceType)
  if (opts?.referenceName) params.append('reference_name', opts.referenceName)
  const response = await fetch(
    `/api/method/healthcare.api.common.get_cost_center_letter_head?${params.toString()}`,
    { credentials: 'include', headers: { Accept: 'application/json' } },
  )
  const data = await response.json()
  if (data?.exc) {
    throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load letter head')
  }
  return (data.message as LetterHeadHtml) || { content: '', footer: '' }
}

export async function fetchPatientBillingCostCenterBreakdown(
  referenceType?: string,
  referenceName?: string,
  patient?: string
): Promise<PatientBillingCcBreakdown> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  const response = await fetch(
    `/api/method/healthcare.api.sales_invoice.get_patient_billing_cost_center_breakdown?${params.toString()}`,
    { credentials: 'include' }
  )
  const data = await response.json()
  const msg = data.message as PatientBillingCcBreakdown | undefined
  return msg && Array.isArray(msg.rows) ? msg : { restricted: false, rows: [] }
}

export interface PatientCrossBranchPaidRow {
  invoice_cost_center: string
  invoice_branch_name: string
  payment_cost_center: string
  payment_branch_name: string
  paid_amount: number
  payment_count: number
  invoice_count: number
}

export interface PatientCrossBranchPaidBreakdown {
  restricted: boolean
  rows: PatientCrossBranchPaidRow[]
}

export async function fetchPatientCrossBranchPaidBreakdown(
  referenceType?: string,
  referenceName?: string,
  patient?: string
): Promise<PatientCrossBranchPaidBreakdown> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  const response = await fetch(
    `/api/method/healthcare.api.sales_invoice.get_patient_cross_branch_paid_breakdown?${params.toString()}`,
    { credentials: 'include' }
  )
  const data = await response.json()
  const msg = data.message as PatientCrossBranchPaidBreakdown | undefined
  return msg && Array.isArray(msg.rows) ? msg : { restricted: false, rows: [] }
}

export interface CreateBulkInvoiceOptions {
  salesOrderNames: string[]
  referenceType?: string
  referenceName?: string
  patient?: string
}

export interface BulkInvoiceSplitResult {
  split_by_cost_center?: boolean
  split_by_fulfillment?: boolean
  invoices: string[]
  details?: Array<{
    invoice: string
    cost_center?: string | null
    source?: string
    delivery_notes?: string[]
    sales_orders?: string[]
  }>
}

export type BulkInvoiceResult = string | BulkInvoiceSplitResult

function parseBulkInvoiceMessage(message: unknown): BulkInvoiceResult {
  if (typeof message === 'string' && message) return message
  if (
    message &&
    typeof message === 'object' &&
    Array.isArray((message as BulkInvoiceSplitResult).invoices) &&
    ((message as BulkInvoiceSplitResult).split_by_cost_center ||
      (message as BulkInvoiceSplitResult).split_by_fulfillment)
  ) {
    return message as BulkInvoiceSplitResult
  }
  throw new Error('Failed to create bulk invoice')
}

export async function createBulkInvoice(options: CreateBulkInvoiceOptions): Promise<BulkInvoiceResult> {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()

  const response = await fetch('/api/method/healthcare.api.sales_order.create_bulk_invoice', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({
      sales_order_names: options.salesOrderNames,
      reference_type: options.referenceType,
      reference_name: options.referenceName,
      patient: options.patient,
    }),
  })

  const data = await response.json()
  if (!response.ok || data.exc) {
    const msg =
      typeof data._server_messages === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(data._server_messages) as string[]
              const inner = parsed[0] ? JSON.parse(parsed[0]) : null
              return (inner as { message?: string })?.message
            } catch {
              return undefined
            }
          })()
        : typeof data.message === 'string'
          ? data.message
          : undefined
    throw new Error(msg || data.exc || 'Failed to create bulk invoice')
  }
  return parseBulkInvoiceMessage(data.message)
}

/** Create + submit a credit note (return Sales Invoice) against a submitted invoice (BIL-11). */
export async function createCreditNote(salesInvoice: string, reason: string): Promise<{ credit_note: string; grand_total: number }> {
  const csrf = await ensureCSRF()
  const response = await fetch('/api/method/healthcare.api.billing.create_credit_note', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ sales_invoice: salesInvoice, reason }),
  })
  const data = await response.json()
  if (!response.ok || data.exc) {
    let msg: string | undefined
    try {
      const parsed = JSON.parse(data._server_messages) as string[]
      msg = parsed[0] ? (JSON.parse(parsed[0]) as { message?: string }).message : undefined
    } catch { /* ignore */ }
    throw new Error(msg || data.exc || 'Failed to create credit note')
  }
  return data.message as { credit_note: string; grand_total: number }
}

export async function createServiceOrder(data: any): Promise<string> {
  const response = await fetch('/api/method/healthcare.api.sales_order.create_service_order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  const result = await response.json()
  return result.message
}


// Add to services/serviceOrders.ts

export interface InpatientBalance {
  admission_id: string
  patient_name: string
  patient_id: string
  admission_date: string
  discharge_date?: string
  cost_center?: string
  /** Most recent submitted invoice for this admission */
  latest_invoice_name?: string | null
  total_amount: number
  total_paid: number
  outstanding_amount: number
  days_overdue: number
  last_invoice_date?: string
}

export interface InvoiceItem {
  item_code: string
  item_name: string
  description?: string
  qty: number
  rate: number
  amount: number
  discount_amount?: number
  net_amount: number
}

export interface InvoiceDetails {
  name: string
  customer: string
  customer_name: string
  posting_date: string
  due_date: string
  grand_total: number
  outstanding_amount: number
  status: string
  cost_center?: string | null
  items: InvoiceItem[]
  company: string
  department?: string | null
}

export interface PaymentResponse {
  success: boolean
  message: string
  payment_entry?: string
  payment_entries?: string[]
}

export interface PaymentModePayload {
  mode_of_payment: string
  amount: number
  reference_no?: string
}


export async function fetchInpatientBalances(patientId?: string, fromDate?: string, toDate?: string): Promise<InpatientBalance[]> {
  let url = '/api/method/healthcare.api.billing.get_inpatient_balances'
  const params = new URLSearchParams()
  if (patientId) params.append('patient', patientId)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  const q = params.toString()
  if (q) {
    url += `?${q}`
  }
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) throw new Error(data.message || 'Failed to fetch inpatient balances')
  return data.message || []
}


// Add these new API functions

export const getInvoiceDetails = async (invoiceName: string): Promise<InvoiceDetails | null> => {
  if (!invoiceName?.trim()) {
    throw new Error('Invoice name is required')
  }
  const csrf = await ensureCSRF()
  const response = await fetch('/api/method/healthcare.api.billing.get_invoice_details', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({ invoice_name: invoiceName }),
  })

  const result = await response.json()
  if (!response.ok) {
    const msg =
      typeof result?.message === 'string'
        ? result.message
        : typeof result?.exc === 'string'
          ? 'Server error loading invoice'
          : 'Failed to load invoice details'
    throw new Error(msg)
  }
  if (result.message) {
    return result.message as InvoiceDetails
  }
  throw new Error('Failed to load invoice details')
}

export const getInvoiceItems = async (invoiceName: string): Promise<InvoiceItem[]> => {
  try {
    const response = await fetch('/api/method/healthcare.api.billing.get_invoice_items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'X-Frappe-CSRF-Token': frappe.csrf_token
      },
      body: JSON.stringify({ invoice_name: invoiceName })
    })
    
    const result = await response.json()
    if (result.message) {
      return result.message
    }
    throw new Error('Failed to load invoice items')
  } catch (error) {
    console.error('Error loading invoice items:', error)
    throw error
  }
}

export const createPaymentEntry = async (
  invoiceName: string,
  paymentAmount: number,
  paymentMode: string,
  costCenter?: string,
  department?: string,
  referenceNumber?: string,
  paymentModes?: PaymentModePayload[]
): Promise<PaymentResponse> => {
  const { ensureCSRF } = await import('./apiClient')
  const csrf = await ensureCSRF()
  const response = await fetch('/api/method/healthcare.api.billing.create_payment_entry', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify({
      invoice_name: invoiceName,
      payment_amount: paymentAmount,
      payment_mode: paymentMode,
      cost_center: costCenter,
      department,
      reference_number: referenceNumber,
      payment_modes: paymentModes,
    }),
  })

  const result = await response.json()
  if (!response.ok) {
    throw new Error(
      typeof result?.message === 'string' ? result.message : result?.exc || 'Failed to create payment entry'
    )
  }
  if (result.message) {
    return result.message as PaymentResponse
  }
  throw new Error('Failed to create payment entry')
}

export async function fetchOutpatientBalances(patientId?: string, fromDate?: string, toDate?: string): Promise<OutpatientBalance[]> {
  let url = '/api/method/healthcare.api.billing.get_outpatient_balances'
  const params = new URLSearchParams()
  if (patientId) params.append('patient', patientId)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  const q = params.toString()
  if (q) {
    url += `?${q}`
  }
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch outpatient balances')
  return data.message || []
}

export async function fetchIopBalances(patientId?: string, fromDate?: string, toDate?: string): Promise<OutpatientBalance[]> {
  let url = '/api/method/healthcare.api.billing.get_iop_balances'
  const params = new URLSearchParams()
  if (patientId) params.append('patient', patientId)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  const q = params.toString()
  if (q) {
    url += `?${q}`
  }
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch IOP balances')
  return data.message || []
}

export async function fetchDailyAutoVisitBalances(
  patientId?: string,
  fromDate?: string,
  toDate?: string
): Promise<OutpatientBalance[]> {
  let url = '/api/method/healthcare.api.billing.get_daily_auto_visit_balances'
  const params = new URLSearchParams()
  if (patientId) params.append('patient', patientId)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  const q = params.toString()
  if (q) {
    url += `?${q}`
  }
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch daily auto visit balances')
  return data.message || []
}

export async function fetchPaymentEntries(
  referenceType?: string,
  referenceName?: string,
  patient?: string,
  fromDate?: string,
  toDate?: string,
  modeOfPayment?: string,
  filterByOpenShift?: boolean,
  cashier?: string,
  costCenter?: string,
): Promise<PaymentEntryRow[]> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  if (modeOfPayment) params.append('mode_of_payment', modeOfPayment)
  if (filterByOpenShift) params.append('filter_by_open_shift', '1')
  if (cashier) params.append('cashier', cashier)
  if (costCenter) params.append('cost_center', costCenter)
  const response = await fetch(`/api/method/healthcare.api.billing.get_payment_entries?${params.toString()}`)
  const data = await response.json()
  return data.message || []
}

export async function fetchPaymentSummary(
  referenceType?: string,
  referenceName?: string,
  patient?: string,
  fromDate?: string,
  toDate?: string,
  modeOfPayment?: string,
  filterByOpenShift?: boolean,
  cashier?: string,
  costCenter?: string,
): Promise<PaymentSummary> {
  const params = new URLSearchParams()
  if (referenceType) params.append('reference_type', referenceType)
  if (referenceName) params.append('reference_name', referenceName)
  if (patient) params.append('patient', patient)
  if (fromDate) params.append('from_date', fromDate)
  if (toDate) params.append('to_date', toDate)
  if (modeOfPayment) params.append('mode_of_payment', modeOfPayment)
  if (filterByOpenShift) params.append('filter_by_open_shift', '1')
  if (cashier) params.append('cashier', cashier)
  if (costCenter) params.append('cost_center', costCenter)
  const response = await fetch(`/api/method/healthcare.api.billing.get_payment_summary?${params.toString()}`)
  const data = await response.json()
  return data.message || { payment_count: 0, total_paid: 0, advance_amount: 0, modes: [] }
}

export interface DailyCollectionAmounts {
  consultation: number
  pharmacy: number
  lab: number
  cash: number
  cheque: number
  card: number
  bwallet: number
  disc: number
  balance: number
  total_due: number
  paid_previous: number
  disc_previous: number
}

export interface DailyCollectionRow extends DailyCollectionAmounts {
  cashier?: string
  cashier_name?: string
  patient_type?: string
  visit_no?: string
  date?: string
  file_no?: string
  patient_name?: string
  doctor_name?: string
}

export interface DailyCollectionUser {
  cashier: string
  cashier_name: string
  ip: DailyCollectionRow[]
  op: DailyCollectionRow[]
  ip_total: DailyCollectionAmounts
  op_total: DailyCollectionAmounts
  user_total: DailyCollectionAmounts
}

export interface DailyCollectionSummary {
  from_date: string
  to_date: string
  company: string
  branch: string
  users: DailyCollectionUser[]
  report_total: DailyCollectionAmounts
}

export async function fetchDailyCollectionSummary(opts: {
  referenceType?: string
  referenceName?: string
  patient?: string
  fromDate?: string
  toDate?: string
  modeOfPayment?: string
  filterByOpenShift?: boolean
  cashier?: string
  costCenter?: string
}): Promise<DailyCollectionSummary> {
  const params = new URLSearchParams()
  if (opts.referenceType) params.append('reference_type', opts.referenceType)
  if (opts.referenceName) params.append('reference_name', opts.referenceName)
  if (opts.patient) params.append('patient', opts.patient)
  if (opts.fromDate) params.append('from_date', opts.fromDate)
  if (opts.toDate) params.append('to_date', opts.toDate)
  if (opts.modeOfPayment) params.append('mode_of_payment', opts.modeOfPayment)
  if (opts.filterByOpenShift) params.append('filter_by_open_shift', '1')
  if (opts.cashier) params.append('cashier', opts.cashier)
  if (opts.costCenter) params.append('cost_center', opts.costCenter)
  const response = await fetch(
    `/api/method/healthcare.api.billing.get_daily_collection_summary?${params.toString()}`,
  )
  const data = await response.json()
  if (!response.ok || data?.exc) {
    throw new Error(
      typeof data?.message === 'string' ? data.message : 'Failed to load daily collection summary',
    )
  }
  return data.message as DailyCollectionSummary
}

export interface PatientStatementEntry {
  posting_date?: string | null
  account?: string
  debit?: number
  credit?: number
  balance?: number
  voucher_type?: string
  voucher_no?: string
  against_voucher?: string
  remarks?: string
  is_section_row?: boolean
}

export interface PatientStatementOfAccount {
  patient: string
  patient_name?: string
  customer: string
  customer_name?: string
  company: string
  from_date: string
  to_date: string
  currency?: string
  closing_balance?: number
  entries: PatientStatementEntry[]
}

export async function fetchPatientStatementOfAccount(opts: {
  patient: string
  fromDate?: string
  toDate?: string
  company?: string
}): Promise<PatientStatementOfAccount> {
  const params = new URLSearchParams()
  params.append('patient', opts.patient)
  if (opts.fromDate) params.append('from_date', opts.fromDate)
  if (opts.toDate) params.append('to_date', opts.toDate)
  if (opts.company) params.append('company', opts.company)
  const response = await fetch(
    `/api/method/healthcare.api.billing.get_patient_statement_of_account?${params.toString()}`
  )
  const data = await response.json()
  if (data?.exc_type || !response.ok) {
    throw new Error(
      typeof data?.message === 'string' ? data.message : 'Failed to load statement of account'
    )
  }
  return data.message as PatientStatementOfAccount
}


// Add to services/serviceOrders.ts

export async function fetchInvoicesByReference(
  referenceType: 'Inpatient Admission' | 'Patient Visit',
  referenceName: string,
  patient?: string
): Promise<ServiceInvoice[]> {
  let url = `/api/method/healthcare.api.service_orders.get_invoices_by_reference?reference_type=${encodeURIComponent(referenceType)}&reference_name=${encodeURIComponent(referenceName)}`
  if (patient) {
    url += `&patient=${encodeURIComponent(patient)}`
  }
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch invoices')
  return data.message || []
}


// Add to services/serviceOrders.ts

export interface ReferenceInvoice {
  name: string
  grand_total: number
  outstanding_amount: number
  posting_date: string
  status: string
}

export interface RelatedSalesOrderLine {
  item_code: string
  item_name: string
  description?: string
  qty: number
  rate?: number
  amount?: number
}

export interface RelatedSalesOrder {
  name: string
  transaction_date: string
  grand_total: number
  status: string
  customer?: string
  company?: string
  custom_reference_type?: string
  custom_reference_name?: string
  custom_base_reference?: string
  /** Reception-friendly e.g. Lab tests, Medication / pharmacy, IP / ward service */
  order_kind_label?: string
  items?: RelatedSalesOrderLine[]
}

export interface BillingInvoiceItemInput {
  item_code: string
  item_name?: string
  description?: string
  qty: number
  rate: number
  /** Insurance / negotiated list stays in rate; % tracked for SO/SI → invoice */
  discount_percentage?: number
  discount_amount?: number
  cost_center?: string
  /** Default sales / line UOM from Item (ERPNext resolution) */
  uom?: string
  /** Stock UOM from Item — shown for reference */
  stock_uom?: string
  /** UOM choices from Item (stock, sales, conversions) */
  uom_options?: string[]
  /** Last server pricing breakdown (service category multiplier, etc.) */
  billing_price_meta?: {
    base_rate: number
    multiplier: number
    patient_category: string | null
    pricing_source?: string | null
    discount_pct?: number | null
    net_rate?: number | null
  }
}

export interface SalesItemPricingForBilling {
  rate: number
  base_rate?: number
  uom: string | null
  stock_uom: string | null
  item_name?: string | null
  price_list?: string | null
  is_service_item?: number
  is_stock_item?: number
  pricing_source?: string | null
  service_template_dt?: string | null
  service_template_dn?: string | null
  patient_category?: string | null
  multiplier?: number
  discount_pct?: number
  discount_amount?: number
  net_rate?: number
  uom_options?: string[]
}

export async function fetchSalesItemPricingForBilling(params: {
  item_code: string
  company: string
  customer?: string
  patient?: string
  qty?: number
  posting_date?: string
  price_list?: string
  uom?: string
}): Promise<SalesItemPricingForBilling> {
  const csrf = await ensureCSRF()
  const response = await fetch('/api/method/healthcare.api.billing.get_sales_item_pricing_for_billing', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(params),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.message || 'Failed to fetch item price')
  return data.message as SalesItemPricingForBilling
}

// services/serviceOrders.ts
export const getInvoicesByReference = async (
  referenceName: string,
  referenceType: string,
  patient?: string | null
): Promise<ReferenceInvoice[]> => {
  try {
    const csrf = await ensureCSRF()
    const body: Record<string, string> = {
      reference_name: referenceName,
      reference_type: referenceType,
    }
    if (patient) {
      body.patient = patient
    }
    const response = await fetch('/api/method/healthcare.api.billing.get_invoices_by_reference', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify(body),
    })

    const result = await response.json()

    if (result.message) {
      if (Array.isArray(result.message)) {
        return result.message
      }
      return []
    }
    return []
  } catch (error) {
    console.error('Error loading invoices by reference:', error)
    return []
  }
}

export async function fetchRelatedSalesOrders(
  referenceType: 'Patient Visit' | 'Inpatient Admission',
  referenceName: string
): Promise<RelatedSalesOrder[]> {
  const response = await fetch('/api/method/healthcare.api.billing.get_related_sales_orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference_type: referenceType, reference_name: referenceName }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.message || 'Failed to fetch related sales orders')
  return (data?.message || []) as RelatedSalesOrder[]
}

export async function createAdditionalCollectionInvoice(payload: {
  company: string
  customer?: string
  created_at_cost_center: string
  reference_type?: string
  reference_name?: string
  patient?: string
  posting_date?: string
  due_date?: string
  sales_orders?: string[]
  additional_items?: BillingInvoiceItemInput[]
}): Promise<{ name: string; grand_total: number; customer: string }> {
  const csrf = await ensureCSRF()
  const response = await fetch('/api/method/healthcare.api.billing.create_additional_collection_invoice', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
     },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.message || 'Failed to create invoice')
  return data.message
}

export async function createInternalEmployeeInvoice(payload: {
  employee?: string
  employee_name?: string
  company: string
  created_at_cost_center: string
  items: BillingInvoiceItemInput[]
  posting_date?: string
  due_date?: string
  /** Optional Patient docname — used for service category multiplier on UI and stored on invoice */
  patient?: string
}): Promise<{ name: string; customer: string; grand_total: number }> {
  const csrf = await ensureCSRF()
  const response = await fetch('/api/method/healthcare.api.billing.create_internal_employee_invoice', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
     },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.message || 'Failed to create internal invoice')
  return data.message
}