import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { fetchInvoicesNeedingInsuranceClaim, fetchPatientCategories, fetchHealthcareInsurance, type InvoiceNeedingClaimRow, type LinkFieldOption } from '../../services/common'
import { searchPatients, fetchPatients, type PatientListItem } from '../../services/patients'
import { formatMoneyAmount } from '../../utils/currencyFormat'
import { useCareContext } from '../../providers/CareContextProvider'
import { SpecialtySalesInvoiceSlideOver } from '../billing/SpecialtySalesInvoiceSlideOver'
import { DateFilterInput } from '../ui/DateFilterInput'

interface Props {
  patient?: string
  refreshKey?: number
  showFilters?: boolean
  onPatientClick?: (patient: string) => void
  onCreateClaim: (invoice: InvoiceNeedingClaimRow) => void
}

function isDraftInvoice(inv: InvoiceNeedingClaimRow): boolean {
  return inv.docstatus === 0 || inv.status === 'Draft'
}

function statusBadgeClass(status: string, isDraft: boolean): string {
  if (isDraft) return 'bg-slate-100 text-slate-700'
  if (status === 'Unpaid') return 'bg-red-100 text-red-700'
  return 'bg-amber-100 text-amber-700'
}

// Sales Invoice healthcare references that identify an Inpatient / Outpatient case.
const IP_REFERENCE_VALUES = ['Inpatient Admission', 'Discharge', 'IP Service']
const OP_REFERENCE_VALUES = ['Patient Visit']
const SOURCE_COLORS: Record<string, string> = {
  IP: 'bg-indigo-100 text-indigo-700',
  OP: 'bg-teal-100 text-teal-700',
  PH: 'bg-purple-100 text-purple-700',
}

function invoiceIpOpSource(inv: InvoiceNeedingClaimRow): string {
  const refType = (inv.custom_reference_type || '').trim()
  if (IP_REFERENCE_VALUES.includes(refType)) return 'IP'
  if (OP_REFERENCE_VALUES.includes(refType)) return 'OP'
  const baseRef = (inv.custom_base_reference || '').trim()
  if (IP_REFERENCE_VALUES.includes(baseRef)) return 'IP'
  if (OP_REFERENCE_VALUES.includes(baseRef)) return 'OP'
  return ''
}

export function InvoicesNeedingClaimList({
  patient: pagePatient,
  refreshKey = 0,
  showFilters = true,
  onPatientClick,
  onCreateClaim,
}: Props) {
  const { companyCurrency, guardClinicalEdit } = useCareContext()
  const currency = (companyCurrency ?? 'USD').toUpperCase()
  const [rows, setRows] = useState<InvoiceNeedingClaimRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editInvoiceName, setEditInvoiceName] = useState<string | null>(null)

  const [patientFilter, setPatientFilter] = useState(pagePatient || '')
  const [patientQuery, setPatientQuery] = useState('')
  const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [patientLoading, setPatientLoading] = useState(false)

  const [patientCategoryFilter, setPatientCategoryFilter] = useState('')
  const [healthInsuranceFilter, setHealthInsuranceFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categoryOptions, setCategoryOptions] = useState<LinkFieldOption[]>([])
  const [insuranceOptions, setInsuranceOptions] = useState<LinkFieldOption[]>([])

  useEffect(() => {
    setPatientFilter(pagePatient || '')
  }, [pagePatient])

  useEffect(() => {
    if (!showFilters) return
    fetchPatientCategories().then(setCategoryOptions).catch(() => setCategoryOptions([]))
    fetchHealthcareInsurance().then(setInsuranceOptions).catch(() => setInsuranceOptions([]))
  }, [showFilters])

  useEffect(() => {
    if (!showFilters || !patientOpen) return
    const search = async () => {
      setPatientLoading(true)
      try {
        const results = patientQuery.trim() === ''
          ? await fetchPatients(20, 0)
          : await searchPatients(patientQuery, 20)
        setPatientOptions(results)
      } catch {
        setPatientOptions([])
      } finally {
        setPatientLoading(false)
      }
    }
    const t = setTimeout(search, patientQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [patientQuery, patientOpen, showFilters])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchInvoicesNeedingInsuranceClaim({
        patient: patientFilter || undefined,
        patient_category: patientCategoryFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        health_insurance: healthInsuranceFilter || undefined,
        limit: 100,
      })
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [patientFilter, patientCategoryFilter, dateFrom, dateTo, healthInsuranceFilter, refreshKey])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!patientOpen) return
    const handle = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('[data-invoice-patient-filter]')) setPatientOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [patientOpen])

  const fmt = (n: number) => formatMoneyAmount(n, currency)

  const openEdit = (invoiceName: string) => {
    guardClinicalEdit(() => setEditInvoiceName(invoiceName))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Draft, unpaid, or partly paid invoices for insured patients with an active register and no insurance claim yet.
        Edit draft invoices to adjust line rates and discounts before submitting and creating a claim.
      </p>

      {showFilters && (
        <div className="card-filter-bar flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">From Date</label>
            <DateFilterInput
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">To Date</label>
            <DateFilterInput
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="relative min-w-[220px]" data-invoice-patient-filter>
            <label className="block text-xs text-slate-500 mb-0.5">Patient</label>
            <input
              type="text"
              value={patientFilter ? patientFilter : patientQuery}
              onChange={e => {
                setPatientQuery(e.target.value)
                setPatientFilter('')
                setPatientOpen(true)
              }}
              onFocus={() => setPatientOpen(true)}
              placeholder="All patients…"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {patientFilter && (
              <button
                type="button"
                onClick={() => { setPatientFilter(''); setPatientQuery('') }}
                className="absolute right-2 top-[26px] text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
            {patientOpen && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded shadow-lg max-h-48 overflow-y-auto">
                {patientLoading ? (
                  <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
                ) : patientOptions.length > 0 ? (
                  patientOptions.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      onClick={() => {
                        setPatientFilter(p.name)
                        setPatientQuery(p.patient_name || p.name)
                        setPatientOpen(false)
                        onPatientClick?.(p.name)
                      }}
                    >
                      <div className="font-medium text-slate-800">{p.patient_name || p.name}</div>
                      <div className="text-xs text-slate-500">{p.name}</div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-slate-500">NO PATIENTS FOUND</div>
                )}
              </div>
            )}
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
        </div>
      )}

      {loading && <div className="text-center text-sm text-slate-400 py-6">Loading…</div>}
      {error && <div className="text-sm text-red-600 py-2">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Invoice</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Patient</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Register</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Date</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">IP/OP</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600">Status</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Total</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Discount</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Outstanding</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-slate-400 py-8">
                    No invoices needing insurance claims
                  </td>
                </tr>
              )}
              {rows.map(inv => {
                const draft = isDraftInvoice(inv)
                return (
                  <tr key={inv.name} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs font-medium text-primary">{inv.name}</td>
                    <td
                      className="px-3 py-2 text-xs cursor-pointer"
                      onClick={() => inv.patient && onPatientClick?.(inv.patient)}
                    >
                      <div className="font-medium text-slate-800 hover:text-primary hover:underline">
                        {inv.patient_name || inv.patient}
                      </div>
                      <div className="text-slate-400">{inv.patient}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {inv.insurance_register ? (
                        <>
                          <div className="text-slate-700">{inv.insurance_register}</div>
                          <div className="text-green-600">{inv.insurance_register_status || 'Active'}</div>
                          {inv.insurance_provider && (
                            <div className="text-slate-400">{inv.insurance_provider}</div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{inv.posting_date || '—'}</td>
                    <td className="px-3 py-2">
                      {invoiceIpOpSource(inv) ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLORS[invoiceIpOpSource(inv)] || 'bg-slate-100 text-slate-600'}`}>
                          {invoiceIpOpSource(inv)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadgeClass(inv.status, draft)}`}>
                        {draft ? 'Draft' : inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-right font-mono">{fmt(inv.grand_total)}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono text-green-700">
                      {inv.discount_amount > 0 ? fmt(inv.discount_amount) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-right font-mono text-orange-600">
                      {fmt(inv.outstanding_amount ?? inv.grand_total)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {draft ? (
                          <button
                            type="button"
                            onClick={() => openEdit(inv.name)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-primary"
                            title="Edit draft invoice"
                            aria-label="Edit draft invoice"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => guardClinicalEdit(() => onCreateClaim(inv))}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-primary rounded-md hover:bg-primary/90"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Create Claim
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editInvoiceName && (
        <SpecialtySalesInvoiceSlideOver
          invoiceName={editInvoiceName}
          initialEditMode
          partyLabel="Patient"
          onClose={() => setEditInvoiceName(null)}
          onUpdated={() => load()}
        />
      )}
    </div>
  )
}
