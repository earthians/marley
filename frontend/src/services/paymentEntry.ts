// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentModePayload {
  mode_of_payment: string
  amount: number
  reference_no?: string
}

export interface CreatePaymentEntryData {
  visit?: string
  appointment?: string
  reference_doctype: 'Sales Invoice' | 'Sales Order'
  reference_name: string
  paid_amount: number
  mode_of_payment: string
  /** When set, backend creates one Payment Entry per mode. */
  payment_modes?: PaymentModePayload[]
  remarks?: string
  patient?: string
  /** Bank/card transaction reference shown on the Payment Entry. */
  reference_no?: string
}

export interface SalesInvoiceSummary {
  name: string
  grand_total: number
  outstanding_amount: number
  status?: string
}

export interface CreatePaymentEntryResult {
  name: string
  /** Present when multiple modes created multiple Payment Entries. */
  names?: string[]
  server_message?: string
  unallocated_amount?: number
  docstatus?: number
  is_draft?: boolean
}

export interface PatientBillingBalance {
  patient: string
  customer: string
  company: string
  outstanding_invoices: number
  credit_balance: number
}

export interface InvoiceAllocationRow {
  reference_name: string
  allocated_amount: number
}

export interface PaymentReferenceOption {
  name: string
  label: string
  outstanding_amount?: number
  grand_total?: number
  customer_name?: string
  patient?: string
  patient_name?: string
}

// ─── Service ──────────────────────────────────────────────────────────────────

async function paymentApiRequest<T>(
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  const { ensureCSRF, parseFrappeErrorPayload } = await import('./apiClient')
  const csrf = (window as any).csrf_token || (await ensureCSRF())

  const response = await fetch(`/api/method/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'X-Frappe-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })

  const resData = await response.json().catch(() => ({}))

  if (!response.ok || resData?.exc) {
    const msg =
      parseFrappeErrorPayload(resData) ||
      (typeof resData?.message === 'string' ? resData.message : '') ||
      `Request failed (${response.status})`
    throw new Error(msg)
  }

  return resData?.message as T
}

export async function createPaymentEntry(
  data: CreatePaymentEntryData
): Promise<CreatePaymentEntryResult> {
  const msg = await paymentApiRequest<CreatePaymentEntryResult | string>(
    'healthcare.api.payment_entry.create_payment_entry',
    { data }
  )

  if (msg && typeof msg === 'object' && (msg as CreatePaymentEntryResult).name) {
    return msg as CreatePaymentEntryResult
  }
  if (typeof msg === 'string' && msg.trim()) {
    return { name: '', server_message: msg.trim() }
  }
  throw new Error('Failed to create payment entry')
}

export interface CancelPaymentEntriesResult {
  cancelled?: string[]
  deleted?: string[]
}

/**
 * Reverse the Payment Entries behind one reception payment row.
 * Submitted entries are cancelled; draft refunds are deleted. The backend
 * rejects entries older than 24 hours.
 */
export async function cancelPaymentEntries(
  paymentEntries: string[]
): Promise<CancelPaymentEntriesResult> {
  return paymentApiRequest<CancelPaymentEntriesResult>(
    'healthcare.api.billing.cancel_payment_entries',
    { payment_entries: paymentEntries }
  )
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export async function fetchSalesInvoices(
  search?: string,
  patient?: string
): Promise<PaymentReferenceOption[]> {
  const rows = await paymentApiRequest<PaymentReferenceOption[]>(
    'healthcare.api.payment_entry.search_sales_invoices_for_payment',
    {
      search: search || '',
      patient: patient || '',
      limit: 30,
    }
  )
  return Array.isArray(rows) ? rows : []
}

export async function fetchSalesOrders(
  search?: string,
  patient?: string
): Promise<PaymentReferenceOption[]> {
  const rows = await paymentApiRequest<PaymentReferenceOption[]>(
    'healthcare.api.payment_entry.search_sales_orders_for_payment',
    {
      search: search || '',
      patient: patient || '',
      limit: 30,
    }
  )
  return Array.isArray(rows) ? rows : []
}

export async function fetchSalesInvoiceSummary(invoiceName: string): Promise<SalesInvoiceSummary> {
  const params = new URLSearchParams({ invoice_name: invoiceName })
  const res = await fetch(
    `/api/method/healthcare.api.common.get_sales_invoice_with_items?${params.toString()}`,
    { credentials: 'include' }
  )
  const data = await res.json()
  const msg = data?.message
  if (!msg || typeof msg !== 'object' || !msg.name) {
    throw new Error('Could not load sales invoice details')
  }
  return {
    name: msg.name,
    grand_total: Number(msg.grand_total) || 0,
    outstanding_amount: Number(msg.outstanding_amount) || 0,
    status: msg.status,
  }
}

export async function fetchModeOfPayments(costCenter?: string): Promise<string[]> {
  // F047: use the whitelisted getter (Reception cannot read the Mode of Payment doctype directly → 403).
  // When costCenter (branch) is set, API returns modes for that branch + unlinked modes.
  const params = new URLSearchParams()
  if (costCenter?.trim()) params.set('cost_center', costCenter.trim())
  const qs = params.toString()
  const res = await fetch(
    `/api/method/healthcare.api.common.get_payment_modes${qs ? `?${qs}` : ''}`,
    { credentials: 'include' }
  )
  const data = await res.json()
  return (data?.message ?? []).map((r: { name: string }) => r.name)
}

export async function fetchPatientBillingBalance(patient: string): Promise<PatientBillingBalance> {
  const msg = await paymentApiRequest<PatientBillingBalance>(
    'healthcare.api.payment_entry.get_patient_billing_balance',
    { patient }
  )
  return msg
}

export async function fetchPatientOutstandingInvoices(
  patient: string
): Promise<PaymentReferenceOption[]> {
  const rows = await paymentApiRequest<PaymentReferenceOption[]>(
    'healthcare.api.payment_entry.list_patient_outstanding_invoices',
    { patient, limit: 50 }
  )
  return Array.isArray(rows) ? rows : []
}

export async function createPatientAdvancePayment(data: {
  patient: string
  paid_amount: number
  mode_of_payment: string
  payment_modes?: PaymentModePayload[]
  remarks?: string
  /** OP / IP / Patient Visit / Inpatient Admission — optional reporting tag */
  custom_op_or_ip?: string
  /** Visit or admission name — optional Dynamic Link case */
  custom_case_no?: string
}): Promise<CreatePaymentEntryResult> {
  return paymentApiRequest<CreatePaymentEntryResult>(
    'healthcare.api.payment_entry.create_patient_advance_payment',
    { data }
  )
}

export async function createMultiInvoicePayment(data: {
  patient: string
  paid_amount: number
  mode_of_payment: string
  payment_modes?: PaymentModePayload[]
  allocations: InvoiceAllocationRow[]
  remarks?: string
}): Promise<CreatePaymentEntryResult> {
  return paymentApiRequest<CreatePaymentEntryResult>(
    'healthcare.api.payment_entry.create_multi_invoice_payment',
    { data }
  )
}

export async function createPatientRefund(data: {
  patient: string
  refund_amount: number
  mode_of_payment: string
  payment_modes?: PaymentModePayload[]
  remarks?: string
}): Promise<CreatePaymentEntryResult> {
  return paymentApiRequest<CreatePaymentEntryResult>(
    'healthcare.api.payment_entry.create_patient_refund',
    { data }
  )
}

export interface ReconciliationAdvanceRow {
  name: string
  posting_date?: string | null
  mode_of_payment?: string
  paid_amount: number
  unallocated_amount: number
  cost_center?: string
  remarks?: string
}

export interface ReconciliationInvoiceRow {
  name: string
  posting_date?: string | null
  due_date?: string | null
  grand_total: number
  outstanding_amount: number
  status?: string
  custom_reference_type?: string
  custom_reference_name?: string
}

export interface ReconciliationCandidates {
  patient: string
  customer: string
  company: string
  advance_total: number
  invoice_outstanding_total: number
  can_reconcile: boolean
  advances: ReconciliationAdvanceRow[]
  invoices: ReconciliationInvoiceRow[]
}

export interface ReconciliationAllocationRow {
  payment_entry: string
  invoice: string
  allocated_amount: number
}

export async function fetchReconciliationCandidates(patient: string): Promise<ReconciliationCandidates> {
  return paymentApiRequest<ReconciliationCandidates>(
    'healthcare.api.invoice_reconciliation.get_reconciliation_candidates',
    { patient }
  )
}

export async function reconcileAdvanceToInvoices(
  patient: string,
  allocations: ReconciliationAllocationRow[]
): Promise<{ ok: boolean; total_allocated: number; message?: string; allocations?: ReconciliationAllocationRow[] }> {
  return paymentApiRequest(
    'healthcare.api.invoice_reconciliation.reconcile_advance_to_invoices',
    { patient, allocations }
  )
}
