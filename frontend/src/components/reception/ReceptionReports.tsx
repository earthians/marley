import { useEffect, useMemo, useRef, useState } from 'react'
import { DateFilterInput } from '../ui/DateFilterInput'
import {
  fetchInpatientAdmissionOptions,
  fetchPatientVisits,
  type LinkFieldOption,
} from '../../services/common'
import { apiRequest } from '../../services/apiClient'
import { toast } from '../../hooks/useToast'
import { useCareContext } from '../../providers/CareContextProvider'
import { resolveAdmissionDateTime } from '../../utils/admissionDateTime'
import {
  readPersistedListFilters,
  writePersistedListFilters,
} from '../../utils/persistedListFilters'
import {
  PackageChargeToTodayModal,
  type PackageChargePreview,
} from './PackageChargeToTodayModal'

type ReportId = 'receipts' | 'ip-payments' | 'soa' | 'soa-op'

const RECEPTION_REPORT_FILTERS_KEY = 'healthcare:receptionReportFilters'

type PersistedReceptionFilters = {
  report: ReportId
  fromDate: string
  toDate: string
  admission: string
  admissionQuery: string
  visit: string
  visitQuery: string
}

function isReportId(value: unknown): value is ReportId {
  return value === 'receipts' || value === 'ip-payments' || value === 'soa' || value === 'soa-op'
}

function readReceptionReportFilters(): PersistedReceptionFilters | null {
  const raw = readPersistedListFilters<PersistedReceptionFilters>(RECEPTION_REPORT_FILTERS_KEY)
  if (!raw || !isReportId(raw.report)) return null
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    report: raw.report,
    fromDate: text(raw.fromDate),
    toDate: text(raw.toDate),
    admission: text(raw.admission),
    admissionQuery: text(raw.admissionQuery),
    visit: text(raw.visit),
    visitQuery: text(raw.visitQuery),
  }
}

function toInputDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayInputDate(): string {
  return toInputDate(new Date())
}

type LetterHeadHtml = { content?: string; footer?: string }

const LETTERHEAD = {
  name: 'SERENE PSYCHIATRY HOSPITAL W.L.L',
  address: 'Building 2093, Road 94, Block 960, Jau Bahrain',
  contact: 'Contact No. 13384444, 38853666',
  web: 'www.serenehospital.com',
}

function letterHeadBlocks(letterHead?: LetterHeadHtml | null) {
  const content = String(letterHead?.content || '').trim()
  const footer = String(letterHead?.footer || '').trim()
  return {
    top: content ? `<div class="letter-head-top">${content}</div>` : '',
    footer: footer ? `<div class="letter-head-footer">${footer}</div>` : '',
  }
}

function buildLetterhead(
  reportTitle: string,
  meta: string,
  opts?: { soa?: boolean; letterHead?: LetterHeadHtml | null },
) {
  const { top } = letterHeadBlocks(opts?.letterHead)
  if (opts?.soa) {
    return `
    ${top}
    <div class="lh soa-lh${top ? ' soa-lh-cc' : ''}">
      ${
        top
          ? ''
          : `<div class="lh-box">
        <div class="lh-name">${LETTERHEAD.name}</div>
        <div>${LETTERHEAD.address}</div>
        <div>${LETTERHEAD.contact}</div>
        <div>${LETTERHEAD.web}</div>
      </div>`
      }
      <div class="lh-title">
        <h1>${reportTitle}</h1>
        <div class="lh-meta">${meta}</div>
        <div class="lh-meta">Printed on: ${new Date().toLocaleString('en-GB')}</div>
      </div>
    </div>`
  }
  return `
    ${top}
    <div class="lh">
      ${
        top
          ? ''
          : `<div>
        <div class="lh-name">${LETTERHEAD.name}</div>
        <div>${LETTERHEAD.address}</div>
        <div>${LETTERHEAD.contact} · ${LETTERHEAD.web}</div>
      </div>`
      }
      <div class="lh-title">
        <h1>${reportTitle}</h1>
        <div>${meta}</div>
        <div>Printed on: ${new Date().toLocaleString('en-GB')}</div>
      </div>
    </div><hr/>`
}

/** Lab-report palette (maroon labels / navy table headers). */
const SOA_MAROON = '#800000'
const SOA_NAVY = '#000080'
const SOA_TH_BG = '#e8eaf0'

const fmtAmt = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

const RECEIPT_COLS = [
  ['rv_no', 'RV No.'], ['rv_date', 'RV Date'], ['payment_type', 'Payment Type'],
  ['file_no', 'File No.'], ['patient_name', 'Patient Name'], ['chq_num', 'Chq Num'],
  ['chq_date', 'Chq Date'], ['case_no', 'Visit/Case No.'], ['visit_booked_by', 'Visit Booked By'],
  ['received_by', 'Received By'], ['received_date', 'Received Date'], ['amount', 'Amount'],
] as const

const PD_COLS = [
  ['rv_no', 'RV No.'], ['rv_date', 'RV Date'], ['payment_type', 'Payment Type'],
  ['chq_num', 'Cheque No.'], ['chq_date', 'Cheque Date'], ['user', 'User'],
  ['entry_date', 'Entry Date'], ['amount', 'Amount'],
] as const

function sectionTable(title: string, rows: any[], cols: readonly (readonly [string, string])[], total?: number) {
  const head = cols.map(([, l]) => `<th>${l}</th>`).join('')
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map(([k]) => `<td${k === 'amount' ? ' class="num"' : ''}>${k === 'amount' ? fmtAmt(r[k]) : r[k] ?? ''}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  const totalRow =
    total !== undefined
      ? `<tr class="total"><td colspan="${cols.length - 1}">Total</td><td class="num">${fmtAmt(total)}</td></tr>`
      : ''
  return `<h3>${title}</h3><table><thead><tr>${head}</tr></thead><tbody>${body}${totalRow}</tbody></table>`
}

function soaInfoCell(label: string, value: string | number | null | undefined) {
  return `<td class="soa-lbl">${label}</td><td class="soa-val">${value ?? ''}</td>`
}

/** Right half of the last header row: Service Category | IP/OP | Case Branch | branch */
function soaCategoryBranchCells(care: 'IP' | 'OP', branch: string | number | null | undefined) {
  return `<td colspan="2" class="soa-cat-wrap"><table class="soa-cat-branch"><colgroup>
      <col class="soa-c-sc"/><col class="soa-c-sv"/><col class="soa-c-cb"/><col class="soa-c-br"/>
    </colgroup><tbody><tr>
      <td class="soa-lbl">Service Category</td>
      <td class="soa-val">${care}</td>
      <td class="soa-lbl">Case Branch</td>
      <td class="soa-val">${branch ?? ''}</td>
    </tr></tbody></table></td>`
}

const IP_SOA_CATEGORY_ORDER = [
  'Standard Admission Assessment Fee',
  'Room Charge',
  'Medical Supervision',
  'Medicines',
  'Lab Tests',
  'Services',
  'Other Services',
]

function orderedSoaCategoryEntries(cats: Record<string, any[]>, ordered: boolean) {
  const keys = Object.keys(cats).filter((k) => (cats[k] || []).length)
  if (!ordered) return keys.map((k) => [k, cats[k]] as [string, any[]])
  const listed = IP_SOA_CATEGORY_ORDER.filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !IP_SOA_CATEGORY_ORDER.includes(k))
  return [...listed, ...rest].map((k) => [k, cats[k]] as [string, any[]])
}

function soaCategoryRows(cats: Record<string, any[]>, opts?: { showDays?: boolean }) {
  const summaryCodes = new Set([
    'Medicine',
    'Lab test',
    'Medicines',
    'Lab Tests',
    'IP_MEDI',
    'IP-MED',
    'OP-MED',
    'IP-LAB',
    'OP-LAB',
    'Medicine Charges',
    'Lab tests',
  ])
  const isIp = Boolean(opts?.showDays)
  return orderedSoaCategoryEntries(cats, isIp)
    .map(([cat, rows]) =>
      rows
        .map((r, i) => {
          const code = String(r.item_code || '')
          const name = String(r.item_name || '')
          const isMedOrLab =
            cat === 'Medicines' ||
            cat === 'Lab Tests' ||
            summaryCodes.has(code) ||
            name === 'Medicine Charges' ||
            name === 'Medicines' ||
            name === 'Lab tests' ||
            name === 'Lab Tests'
          const isSessions = isIp && cat === 'Services'
          const rateCell = isMedOrLab || r.rate == null ? '—' : fmtAmt(r.rate)
          const daysCell = opts?.showDays
            ? `<td class="num">${isMedOrLab || isSessions ? '' : (r.qty ?? '')}</td>`
            : ''
          const freqCell = isMedOrLab ? '' : isSessions ? (r.frequency ?? r.qty ?? '') : (r.frequency ?? '')
          const isLab =
            cat === 'Lab Tests' || name === 'Lab Tests' || name === 'Lab tests' || code === 'IP-LAB' || code === 'OP-LAB'
          const serviceCode = isIp && isMedOrLab ? (isLab ? 'IP-LAB' : 'IP-MED') : (r.item_code ?? '')
          const serviceName =
            isIp && isMedOrLab ? (isLab ? 'Lab Tests' : 'Medicines') : (r.item_name ?? '')
          return `<tr>${i === 0 ? `<td class="soa-cat" rowspan="${rows.length}">${cat}</td>` : ''}<td>${serviceCode}</td><td>${serviceName}</td><td class="num">${rateCell}</td>${daysCell}<td class="num">${freqCell}</td><td class="num">${fmtAmt(r.amount)}</td></tr>`
        })
        .join(''),
    )
    .join('')
}

function soaTotalsFooter(data: any, labelColspan: number) {
  return `<tr class="total"><td colspan="${labelColspan}">Total Bill Amount</td><td class="num">${fmtAmt(data.bill_total)}</td></tr>
      <tr class="total"><td colspan="${labelColspan}">Discount Amount</td><td class="num">(${fmtAmt(data.discount_total)})</td></tr>
      <tr class="total"><td colspan="${labelColspan}">Paid Amount</td><td class="num">(${fmtAmt(data.paid_total)})</td></tr>
      <tr class="total"><td colspan="${labelColspan}">Net Bill Amount</td><td class="num">${fmtAmt(data.net_total)}</td></tr>
      <tr class="total"><td colspan="${labelColspan}">Balance Amount</td><td class="num">${fmtAmt(data.balance)}</td></tr>`
}

/** Single Paid table for SOA (mode is a column — no separate Payments-by-Mode table). */
function soaPaymentsHtml(data: any) {
  const payments = (data.payments || []) as Array<{
    rv_no: string
    rv_date: string
    mode_of_payment: string
    amount: number
    status: string
  }>
  const advances = (data.advances || []) as Array<{
    rv_no: string
    rv_date: string
    mode_of_payment: string
    amount: number
    status: string
  }>

  const byRv = new Map<string, (typeof payments)[0]>()
  for (const row of [...payments, ...advances]) {
    const key = row.rv_no || `${row.rv_date}-${row.mode_of_payment}-${row.amount}`
    if (!byRv.has(key)) byRv.set(key, row)
  }
  const rows = Array.from(byRv.values())
  const total = Number(data.paid_total || 0)
  if (!rows.length && total <= 0) return ''

  const detailRows = rows
    .map(
      (a) =>
        `<tr><td>${a.rv_no ?? ''}</td><td>${a.rv_date ?? ''}</td><td>${a.mode_of_payment ?? ''}</td>
         <td class="num">${fmtAmt(a.amount)}</td>
         <td class="soa-paid">${a.status || 'Paid'}</td></tr>`,
    )
    .join('')

  return `<h3 class="soa-h3">Paid</h3>
    <table class="soa-pay"><thead><tr><th>RV No.</th><th>Date</th><th>Mode</th><th class="num">Amount (BHD)</th><th>Status</th></tr></thead>
      <tbody>${detailRows}
      <tr class="total"><td colspan="3">Total</td><td class="num">${fmtAmt(total)}</td><td></td></tr>
      </tbody></table>`
}

function fmtSoaShortDate(v: string | null | undefined) {
  if (!v) return ''
  const s = String(v).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[3]}-${m[2]}-${m[1].slice(2)}`
  return s
}

function buildOldOpSoaHtml(data: any, fromDate: string, toDate: string) {
  const rangeFrom = fmtSoaShortDate(data.from_date || fromDate)
  const rangeTo = fmtSoaShortDate(data.to_date || toDate)
  const range = rangeFrom && rangeTo ? `(From ${rangeFrom} to ${rangeTo})` : ''
  const cat = 'OP / IOP'
  let html = buildLetterhead('Patient Statement of Account', range, {
    soa: true,
    letterHead: data.letter_head,
  })
  html += `<table class="soa-info soa-old-head"><colgroup><col style="width:50%"/><col style="width:50%"/></colgroup><tbody><tr>
    <td class="soa-head-col"><table class="soa-info"><colgroup><col class="soa-oh-l"/><col class="soa-oh-v"/></colgroup><tbody>
      <tr>${soaInfoCell('File No.', data.file_no)}</tr>
      <tr>${soaInfoCell('CPR / ID No.', data.cpr)}</tr>
      <tr>${soaInfoCell('Gender', data.gender)}</tr>
      <tr>${soaInfoCell('Nationality', data.nationality)}</tr>
      <tr>${soaInfoCell('Age', data.age)}</tr>
    </tbody></table></td>
    <td class="soa-head-col soa-head-right"><table class="soa-info"><colgroup><col class="soa-oh-l"/><col class="soa-oh-v"/></colgroup><tbody>
      <tr>${soaInfoCell('Patient Name', data.patient_name)}</tr>
      <tr>${soaInfoCell('Patient Address', data.address)}</tr>
      <tr>${soaInfoCell('Services Category', cat)}</tr>
    </tbody></table></td>
  </tr></tbody></table>`
  const lines = (data.old_lines || []) as Array<{
    invoice_date?: string
    invoice_no?: string
    description?: string
    doctor_name?: string
    due_amount?: number
    paid_amount?: number
    balance_amount?: number
  }>
  const dueSum = lines.reduce((s, r) => s + Number(r.due_amount || 0), 0)
  const paidSum = lines.reduce((s, r) => s + Number(r.paid_amount || 0), 0)
  const balSum = lines.reduce((s, r) => s + Number(r.balance_amount || 0), 0)
  const body = lines
    .map(
      (r) =>
        `<tr>
          <td>${fmtSoaShortDate(r.invoice_date)}</td>
          <td>${r.invoice_no ?? ''}</td>
          <td><div class="soa-doc">${r.doctor_name ?? ''}</div><div class="soa-desc">${r.description ?? ''}</div></td>
          <td class="num">${fmtAmt(r.due_amount)}</td>
          <td class="num">${fmtAmt(r.paid_amount)}</td>
          <td class="num">${fmtAmt(r.balance_amount)}</td>
        </tr>`,
    )
    .join('')
  html += `<table class="soa-old-lines"><colgroup>
      <col class="soa-od"/><col class="soa-on"/><col class="soa-os"/>
      <col class="soa-oa"/><col class="soa-oa"/><col class="soa-oa"/>
    </colgroup><thead><tr>
      <th>Invoice Date</th><th>Invoice No.</th>
      <th>Doctor Name<br/><span class="soa-desc-h">Services Description</span></th>
      <th class="num">Due Amount</th><th class="num">Paid / Adjustment Amount</th><th class="num">Balance Amount</th>
    </tr></thead><tbody>${body}
      <tr class="total"><td colspan="3">Total Amount (BHD)</td>
        <td class="num">${fmtAmt(dueSum || data.net_total)}</td>
        <td class="num">${fmtAmt(paidSum)}</td>
        <td class="num">${fmtAmt(balSum)}</td></tr>
      <tr class="total"><td colspan="3">Pending Adjustment Amount</td>
        <td></td><td></td>
        <td class="num">${fmtAmt(data.pending_adjustment)}</td></tr>
      <tr class="total"><td colspan="3" class="soa-bal">Balance Amount</td>
        <td></td><td></td>
        <td class="num soa-bal">${fmtAmt(data.balance)}</td></tr>
    </tbody></table>`
  html += `<p class="soa-note" style="margin-top:10px">This is not an invoice, all charges are inclusive of VAT.</p>`
  html += letterHeadBlocks(data.letter_head).footer
  return html
}

function docCss(orientation: 'portrait' | 'landscape' = 'landscape', soa = false) {
  if (soa) {
    return `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; margin: 14px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .soa-lh { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
  .soa-lh.soa-lh-cc { display: block; text-align: center; }
  .letter-head-top { margin-bottom: 10px; }
  .letter-head-top img, .letter-head-footer img { max-width: 100%; height: auto; }
  .letter-head-footer { margin-top: 16px; page-break-inside: avoid; }
  .letter-head-top table, .letter-head-footer table { border: none; margin-bottom: 0; width: 100%; }
  .letter-head-top td, .letter-head-footer td, .letter-head-top th, .letter-head-footer th {
    border: none; background: transparent; padding: 0;
  }
  .lh-box { border: 1px solid #888; padding: 6px 8px; max-width: 48%; }
  .lh-name { font-size: 13px; font-weight: bold; color: #000; }
  .lh-title { text-align: center; flex: 1; }
  .lh-title h1 { font-size: 18px; margin: 0 0 4px; color: ${SOA_MAROON}; text-decoration: underline; font-weight: bold; }
  .lh-meta { color: ${SOA_MAROON}; font-size: 10px; }
  .soa-h3 { margin: 12px 0 4px; font-size: 13px; color: ${SOA_MAROON}; font-weight: bold; text-align: center; }
  .soa-note { margin: 2px 0 6px; font-size: 10px; color: #444; }
  .soa-info { width: 100%; border-collapse: collapse; margin-bottom: 10px; table-layout: fixed; }
  .soa-info td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; word-wrap: break-word; }
  .soa-lbl { font-weight: bold; color: ${SOA_MAROON}; }
  .soa-val { color: #000; }
  .soa-c-al { width: 13%; }
  .soa-c-av { width: 22%; }
  .soa-c-bl { width: 14%; }
  .soa-c-bv { width: 51%; }
  .soa-cat-wrap { padding: 0; }
  .soa-cat-branch { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .soa-cat-branch td { border: none; border-left: 1px solid #000; padding: 4px 6px; vertical-align: top; word-wrap: break-word; }
  .soa-cat-branch td:first-child { border-left: none; }
  .soa-c-sc { width: 28%; }
  .soa-c-sv { width: 12%; }
  .soa-c-cb { width: 24%; }
  .soa-c-br { width: 36%; }
  .soa-old-head { margin-bottom: 10px; }
  .soa-old-head > tbody > tr > td.soa-head-col { padding: 0; vertical-align: top; }
  .soa-old-head .soa-info { margin-bottom: 0; width: 100%; }
  .soa-oh-l { width: 36%; }
  .soa-oh-v { width: 64%; }
  .soa-head-right .soa-info { height: 100%; }
  .soa-head-right tr:nth-child(2) td { height: 3.6em; vertical-align: top; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #000; padding: 3px 5px; text-align: left; }
  th { background: ${SOA_TH_BG}; color: ${SOA_NAVY}; font-weight: bold; }
  td.num, th.num { text-align: right; }
  td.soa-cat { color: ${SOA_MAROON}; font-weight: bold; vertical-align: top; }
  tr.total td { font-weight: bold; background: #f8fafc; }
  .soa-pay { width: 100%; max-width: 640px; }
  .soa-old-cat { margin: 6px 0 10px; font-size: 12px; }
  .soa-old-lines { width: 100%; }
  .soa-old-lines col.soa-od { width: 11%; }
  .soa-old-lines col.soa-on { width: 16%; }
  .soa-old-lines col.soa-os { width: 43%; }
  .soa-old-lines col.soa-oa { width: 10%; }
  .soa-doc { font-weight: bold; text-decoration: underline; margin-bottom: 6px; }
  .soa-desc { font-size: 10px; color: #222; }
  .soa-desc-h { font-weight: bold; font-size: 10px; }
  .soa-bal { color: #cc0000 !important; font-weight: bold; }
  .soa-paid { color: ${SOA_MAROON}; font-weight: bold; }
  .soa-old-footer { font-size: 9px; text-align: center; color: #333; line-height: 1.45; margin-top: 16px; padding-top: 6px; border-top: 1px solid #888; }
  @page { size: A4 ${orientation}; margin: 10mm 10mm 22mm 10mm; }
  @media print {
    .soa-old-footer { position: fixed; bottom: 6px; left: 10mm; right: 10mm; margin-top: 0; }
  }
`
  }
  return `
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 16px; }
  .lh { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .lh-name { font-size: 15px; font-weight: bold; }
  .lh-title h1 { font-size: 16px; margin: 0 0 4px; text-align: right; text-decoration: underline; }
  .lh-title { text-align: right; }
  h3 { margin: 14px 0 4px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #333; padding: 3px 5px; text-align: left; }
  th { background: #f1f5f9; }
  td.num, th.num { text-align: right; }
  tr.total td { font-weight: bold; background: #f8fafc; }
  @page { size: A4 ${orientation}; margin: 10mm; }
`
}

function openDocument(
  html: string,
  mode: 'pdf' | 'excel',
  filename: string,
  orientation: 'portrait' | 'landscape' = 'landscape',
  soa = false,
) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${docCss(orientation, soa)}</style></head><body>${html}</body></html>`
  if (mode === 'pdf') {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(doc + '<script>window.onload = () => window.print()</'.concat('script>'))
    win.document.close()
  } else {
    const blob = new Blob([doc], { type: 'application/vnd.ms-excel' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${filename}.xls`
    a.click()
    URL.revokeObjectURL(a.href)
  }
}

export function ReceptionReports() {
  const { activeAdmission, activeVisit, selectedPatient, userCostCenter } = useCareContext()
  const [savedFilters] = useState(() => readReceptionReportFilters())
  // Branch changes reload the page. Skip the first date/visit autofill so a
  // restored filter set is not immediately overwritten.
  const skipDateAutofill = useRef(Boolean(savedFilters && (savedFilters.fromDate || savedFilters.toDate)))
  const skipVisitPrefill = useRef(savedFilters?.report === 'soa-op')
  const [report, setReport] = useState<ReportId>(savedFilters?.report || 'receipts')
  const [fromDate, setFromDate] = useState(savedFilters?.fromDate || '')
  const [toDate, setToDate] = useState(savedFilters?.toDate || '')
  const [admission, setAdmission] = useState(savedFilters?.admission || '')
  const [admissionQuery, setAdmissionQuery] = useState(savedFilters?.admissionQuery || '')
  const [admissionOptions, setAdmissionOptions] = useState<LinkFieldOption[]>([])
  const [admissionOpen, setAdmissionOpen] = useState(false)
  const [visit, setVisit] = useState(savedFilters?.visit || '')
  const [visitQuery, setVisitQuery] = useState(savedFilters?.visitQuery || '')
  const [visitOptions, setVisitOptions] = useState<LinkFieldOption[]>([])
  const [visitOpen, setVisitOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingPackagePreview, setLoadingPackagePreview] = useState(false)
  const [chargingPackage, setChargingPackage] = useState(false)
  const [packagePreview, setPackagePreview] = useState<PackageChargePreview | null>(null)
  const [data, setData] = useState<any>(null)

  const needsAdmission = report === 'ip-payments' || report === 'soa'
  const isSoaOp = report === 'soa-op'
  const resolvedAdmission = (activeAdmission || admission || '').trim()
  // Visit is optional for OP SOA — do not force the header active visit.
  const resolvedVisit = (visit || '').trim()

  const headerCaseLabel = useMemo(() => {
    if (!activeAdmission) return ''
    try {
      return localStorage.getItem('patientSearch_activeAdmissionLabel') || activeAdmission
    } catch {
      return activeAdmission
    }
  }, [activeAdmission])

  const headerVisitLabel = useMemo(() => {
    if (!activeVisit) return ''
    try {
      return localStorage.getItem('patientSearch_activeVisitLabel') || activeVisit
    } catch {
      return activeVisit
    }
  }, [activeVisit])

  useEffect(() => {
    if (!activeAdmission) return
    setAdmission(activeAdmission)
    setAdmissionQuery(headerCaseLabel || activeAdmission)
  }, [activeAdmission, headerCaseLabel])

  useEffect(() => {
    writePersistedListFilters(RECEPTION_REPORT_FILTERS_KEY, {
      report,
      fromDate,
      toDate,
      admission,
      admissionQuery,
      visit,
      visitQuery,
    } satisfies PersistedReceptionFilters)
  }, [report, fromDate, toDate, admission, admissionQuery, visit, visitQuery])

  // Prefill visit from care context when the active visit changes; user can still clear it.
  useEffect(() => {
    if (skipVisitPrefill.current) {
      skipVisitPrefill.current = false
      return
    }
    if (!activeVisit) return
    setVisit(activeVisit)
    setVisitQuery(headerVisitLabel || activeVisit)
  }, [activeVisit, headerVisitLabel])

  // SOA (IP): From Date = admission date, To Date = today
  useEffect(() => {
    if (report !== 'soa') return
    if (skipDateAutofill.current && savedFilters?.report === 'soa') {
      skipDateAutofill.current = false
      return
    }

    setToDate(todayInputDate())

    if (!resolvedAdmission) return

    let cancelled = false
    ;(async () => {
      try {
        const fields = JSON.stringify([
          'scheduled_date',
          'admitted_datetime',
          'admission_date',
          'admission_time',
        ])
        const row = await apiRequest<{
          scheduled_date?: string
          admitted_datetime?: string
          admission_date?: string
          admission_time?: string
        }>(
          `/api/resource/Inpatient%20Admission/${encodeURIComponent(resolvedAdmission)}?fields=${encodeURIComponent(fields)}`,
        )
        if (cancelled || !row) return
        // Match SOA report's admission_date (scheduled_date), then fall back to admitted datetime.
        const scheduled = (row.scheduled_date || '').toString().slice(0, 10)
        if (scheduled) {
          setFromDate(scheduled)
          return
        }
        const dt = resolveAdmissionDateTime(row)
        if (dt) setFromDate(toInputDate(dt))
      } catch {
        /* leave From Date unchanged if admission cannot be loaded */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [report, resolvedAdmission])

  // SOA (OP): To Date = today.
  // Visit selected → From Date = that visit's encounter date.
  // Visit blank → From Date = patient's first visit ever.
  useEffect(() => {
    if (report !== 'soa-op') return
    if (skipDateAutofill.current && savedFilters?.report === 'soa-op') {
      skipDateAutofill.current = false
      return
    }

    setToDate(todayInputDate())

    let cancelled = false
    ;(async () => {
      try {
        if (resolvedVisit) {
          const row = await apiRequest<{ encounter_date?: string }>(
            `/api/resource/Patient%20Visit/${encodeURIComponent(resolvedVisit)}?fields=${encodeURIComponent(JSON.stringify(['encounter_date']))}`,
          )
          if (cancelled || !row) return
          const d = (row.encounter_date || '').toString().slice(0, 10)
          if (d) setFromDate(d)
          return
        }

        if (!selectedPatient) return

        const first = await apiRequest<string | null>(
          `/api/method/healthcare.api.reception_reports.get_patient_first_visit_date?patient=${encodeURIComponent(selectedPatient)}`,
        )
        if (cancelled) return
        const d = (first || '').toString().slice(0, 10)
        if (d) setFromDate(d)
      } catch {
        /* leave From Date unchanged if visit/patient history cannot be loaded */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [report, resolvedVisit, selectedPatient])

  const run = async () => {
    if (report === 'receipts' && (!fromDate || !toDate)) {
      toast.error('Select From Date and To Date')
      return
    }
    if (needsAdmission && !resolvedAdmission) {
      toast.error('Select a case at the top (patient / admission), then run the report')
      return
    }
    if (isSoaOp) {
      if (!resolvedVisit) {
        if (!selectedPatient) {
          toast.error('Select a patient at the top, or pick a Patient Visit')
          return
        }
        if (!fromDate || !toDate) {
          toast.error('Select From Date and To Date when Visit is blank')
          return
        }
      }
    }
    setLoading(true)
    setData(null)
    try {
      const params = new URLSearchParams()
      if (fromDate) params.append('from_date', fromDate)
      if (toDate) params.append('to_date', toDate)
      if (report === 'receipts' && userCostCenter) params.append('cost_center', userCostCenter)
      if (needsAdmission) params.append('admission', resolvedAdmission)
      if (isSoaOp) {
        if (resolvedVisit) params.append('visit', resolvedVisit)
        if (selectedPatient) params.append('patient', selectedPatient)
      }
      const method =
        report === 'receipts'
          ? 'get_patient_receipts_summary'
          : report === 'ip-payments'
            ? 'get_ip_payment_discounts'
            : report === 'soa-op'
              ? 'get_op_statement_of_account'
              : 'get_ip_statement_of_account'
      const res = await apiRequest<any>(
        `/api/method/healthcare.api.reception_reports.${method}?${params.toString()}`,
      )
      setData(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  const openPackageChargeModal = async () => {
    if (report !== 'soa') return
    if (!resolvedAdmission) {
      toast.error('Select an admission / case first')
      return
    }
    setPackagePreview(null)
    setLoadingPackagePreview(true)
    try {
      const preview = await apiRequest<PackageChargePreview>(
        `/api/method/healthcare.api.package_charge_to_today.preview_package_charge_to_today?admission=${encodeURIComponent(resolvedAdmission)}`,
      )
      if (!preview?.can_charge) {
        if (Number(preview?.days_to_charge || 0) > 0) {
          toast.error(
            'Package days are available but no billable package/room Item is linked to this admission.',
          )
        } else {
          toast.error(
            `No unbilled package days. Elapsed ${preview?.days_elapsed ?? 0}, already billed ${preview?.days_already_billed ?? 0}, package ${
              preview?.is_daily_package ? 'daily / open' : `${preview?.program_days ?? '—'} days`
            }${preview?.quotation ? ` (Quotation ${preview.quotation}).` : '.'}`,
          )
        }
        return
      }
      setPackagePreview(preview)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check package charge')
    } finally {
      setLoadingPackagePreview(false)
    }
  }

  const confirmPackageCharge = async () => {
    const admissionToCharge = packagePreview?.admission || resolvedAdmission
    if (!admissionToCharge || !packagePreview) return
    setChargingPackage(true)
    try {
      const result = await apiRequest<any>(
        '/api/method/healthcare.api.package_charge_to_today.charge_package_to_today',
        {
          method: 'POST',
          body: JSON.stringify({ admission: admissionToCharge }),
        },
      )
      toast.success(
        result?.message ||
          `Charged ${result?.days_charged || 0} day(s). Remaining ${result?.remaining_days ?? '—'}.`,
      )
      setPackagePreview(null)
      // Refresh SOA so the new Sales Order lines appear
      await run()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to charge package')
    } finally {
      setChargingPackage(false)
    }
  }

  const closePackageChargeModal = () => {
    if (chargingPackage) return
    setPackagePreview(null)
  }

  const buildHtml = (): { html: string; filename: string } | null => {
    if (!data) return null
    const range = fromDate && toDate ? `From Date: ${fromDate} to ${toDate}` : ''
    if (report === 'receipts') {
      let html = buildLetterhead('Patient Receipts Summary', range)
      html += sectionTable('OP', data.op || [], RECEIPT_COLS, data.totals?.op)
      html += sectionTable('Payment Only', data.payment_only || [], RECEIPT_COLS, data.totals?.payment_only)
      html += sectionTable('IP', data.ip || [], RECEIPT_COLS, data.totals?.ip)
      const rows = Object.entries(data.summary || {})
        .map(([k, v]) => `<tr><td>${k}</td><td class="num">${fmtAmt(v as number)}</td></tr>`)
        .join('')
      html += `<h3>Summary</h3><table style="width:340px"><tbody>${rows}<tr class="total"><td>Grand Total</td><td class="num">${fmtAmt(data.grand_total)}</td></tr></tbody></table>`
      return { html, filename: `patient-receipts-${fromDate}-${toDate}` }
    }
    if (report === 'ip-payments') {
      let html = buildLetterhead('IP Payments and Discounts', `${range}${range ? ' · ' : ''}Case No. ${resolvedAdmission}`)
      html += sectionTable('DISCOUNT', data.discounts || [], PD_COLS, data.discount_total)
      html += sectionTable('PAID', data.paid || [], PD_COLS, data.paid_total)
      html += `<table style="width:340px"><tbody><tr class="total"><td>Gross Total</td><td class="num">${fmtAmt(data.gross_total)}</td></tr></tbody></table>`
      return { html, filename: `ip-payments-discounts-${resolvedAdmission}` }
    }
    if (report === 'soa-op') {
      if (data.use_old_approach_soa) {
        return {
          html: buildOldOpSoaHtml(data, fromDate, toDate),
          filename: `soa-op-${data.case_no || data.visit || selectedPatient || 'patient'}`,
        }
      }
      const visitMeta = resolvedVisit
        ? `Visit No. ${data.case_no || data.visit}`
        : `Patient ${data.patient_name || selectedPatient || ''} · All OP visits`
      let html = buildLetterhead('Statement of Account (OP)', `${visitMeta}${range ? ` · ${range}` : ''}`, {
        soa: true,
        letterHead: data.letter_head,
      })
      html += `<table class="soa-info"><colgroup><col class="soa-c-al"/><col class="soa-c-av"/><col class="soa-c-bl"/><col class="soa-c-bv"/></colgroup><tbody>
        <tr>${soaInfoCell('Visit No.', data.visit ?? (resolvedVisit ? resolvedVisit : 'Multiple visits'))}${soaInfoCell('Patient File No.', data.file_no)}</tr>
        <tr>${soaInfoCell('Visit Date', data.visit_date)}${soaInfoCell('Patient Name', data.patient_name)}</tr>
        <tr>${soaInfoCell('Visit Type', data.visit_type ?? (resolvedVisit ? '' : 'All OP'))}${soaInfoCell('Doctor Name', data.doctor_name)}</tr>
        <tr>${soaInfoCell('Status', data.status)}${soaCategoryBranchCells('OP', data.branch)}</tr>
      </tbody></table>`
      html += `<h3 class="soa-h3">Service Details</h3>`
      html += `<table><thead><tr><th>Service Category</th><th>Service Code</th><th>Service Name</th><th class="num">Rate (BHD)</th><th class="num">Frequency</th><th class="num">Total Amount (BHD)</th></tr></thead><tbody>${soaCategoryRows(data.categories || {})}
        ${soaTotalsFooter(data, 5)}
      </tbody></table>`
      html += soaPaymentsHtml(data)
      html += `<p class="soa-note" style="margin-top:10px">This is not an invoice, all charges are inclusive of VAT.</p>`
      html += letterHeadBlocks(data.letter_head).footer
      return { html, filename: `soa-op-${data.case_no || data.visit || selectedPatient || 'patient'}` }
    }
    // SOA IP
    let html = buildLetterhead('Statement of Account (IP)', `Case No. ${data.case_no} · ${range}`, {
      soa: true,
      letterHead: data.letter_head,
    })
    html += `<table class="soa-info"><colgroup><col class="soa-c-al"/><col class="soa-c-av"/><col class="soa-c-bl"/><col class="soa-c-bv"/></colgroup><tbody>
      <tr>${soaInfoCell('Admission No.', data.admission)}${soaInfoCell('Patient File No.', data.file_no)}</tr>
      <tr>${soaInfoCell('Admission Date', data.admission_date)}${soaInfoCell('Patient Name', data.patient_name)}</tr>
      <tr>${soaInfoCell('Discharge Date', data.discharge_date)}${soaInfoCell('Doctor Name', data.doctor_name)}</tr>
      <tr>${soaInfoCell('Days Charged', data.days_charged)}${soaCategoryBranchCells('IP', data.branch)}</tr>
    </tbody></table>`
    html += `<h3 class="soa-h3">Service Details</h3>`
    html += `<table><thead><tr><th>Service Category</th><th>Service Code</th><th>Service Name</th><th class="num">Rate (BHD)</th><th class="num">No of Days</th><th class="num">Frequency</th><th class="num">Total Amount (BHD)</th></tr></thead><tbody>${soaCategoryRows(data.categories || {}, { showDays: true })}
      ${soaTotalsFooter(data, 6)}
    </tbody></table>`
    html += soaPaymentsHtml(data)
    html += `<p class="soa-note" style="margin-top:10px">This is not an invoice, all charges are inclusive of VAT.</p>`
    html += letterHeadBlocks(data.letter_head).footer
    return { html, filename: `soa-${data.case_no || resolvedAdmission}` }
  }

  const doExport = (mode: 'pdf' | 'excel') => {
    const built = buildHtml()
    if (!built) {
      toast.error('Run the report first')
      return
    }
    const isSoa = report === 'soa' || report === 'soa-op'
    const orientation = isSoa ? 'portrait' : 'landscape'
    openDocument(built.html, mode, built.filename, orientation, isSoa)
  }

  const searchAdmissions = async (q: string) => {
    try {
      setAdmissionOptions(await fetchInpatientAdmissionOptions(q || undefined))
    } catch {
      setAdmissionOptions([])
    }
  }

  const searchVisits = async (q: string) => {
    try {
      setVisitOptions(await fetchPatientVisits(selectedPatient || undefined, q || undefined))
    } catch {
      setVisitOptions([])
    }
  }

  const rowsCount =
    !data ? null
    : report === 'receipts' ? (data.op?.length || 0) + (data.payment_only?.length || 0) + (data.ip?.length || 0)
    : report === 'ip-payments' ? (data.discounts?.length || 0) + (data.paid?.length || 0)
    : Object.values(data.categories || {}).reduce((s: number, v: any) => s + v.length, 0)

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ['receipts', 'Patient Receipts Summary'],
            ['ip-payments', 'IP Payments & Discounts'],
            ['soa', 'Statement of Account (IP)'],
            ['soa-op', 'Statement of Account (OP)'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setReport(id)
              setData(null)
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium border transition-colors ${
              report === id
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card-filter-bar flex flex-wrap items-end gap-3 mb-4 px-1 py-2 border-b border-slate-100 bg-slate-50/80 rounded-md">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">From Date</label>
          <DateFilterInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">To Date</label>
          <DateFilterInput value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white" />
        </div>
        {needsAdmission && activeAdmission ? (
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-xs font-medium text-slate-500">Case</label>
            <div className="h-[30px] flex items-center rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-800 truncate" title={headerCaseLabel}>
              {activeAdmission}
            </div>
          </div>
        ) : needsAdmission ? (
          <div className="relative flex flex-col gap-1 min-w-[220px]">
            <label className="text-xs font-medium text-slate-500">Admission / Case</label>
            <input
              type="text"
              value={admission ? admissionQuery || admission : admissionQuery}
              onChange={(e) => {
                setAdmissionQuery(e.target.value)
                setAdmission('')
                setAdmissionOpen(true)
                void searchAdmissions(e.target.value)
              }}
              onFocus={() => {
                setAdmissionOpen(true)
                void searchAdmissions(admissionQuery)
              }}
              onBlur={() => setTimeout(() => setAdmissionOpen(false), 150)}
              placeholder="Search admission…"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
            />
            {admissionOpen && admissionOptions.length > 0 && (
              <div className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {admissionOptions.map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    onMouseDown={() => {
                      setAdmission(o.name)
                      setAdmissionQuery(o.label || o.name)
                      setAdmissionOpen(false)
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    {o.label || o.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {isSoaOp ? (
          <div className="relative flex flex-col gap-1 min-w-[220px]">
            <label className="text-xs font-medium text-slate-500">
              Patient Visit <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={visit ? visitQuery || visit : visitQuery}
                onChange={(e) => {
                  setVisitQuery(e.target.value)
                  setVisit('')
                  setVisitOpen(true)
                  void searchVisits(e.target.value)
                }}
                onFocus={() => {
                  setVisitOpen(true)
                  void searchVisits(visitQuery)
                }}
                onBlur={() => setTimeout(() => setVisitOpen(false), 150)}
                placeholder={selectedPatient ? 'All visits for patient (leave blank)' : 'Search visit…'}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 pr-7 text-sm bg-white"
              />
              {(visit || visitQuery) && (
                <button
                  type="button"
                  className="absolute inset-y-0 right-1 my-auto h-6 w-6 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Clear visit"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setVisit('')
                    setVisitQuery('')
                    setVisitOpen(false)
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {visitOpen && visitOptions.length > 0 && (
              <div className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {visitOptions.map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    onMouseDown={() => {
                      setVisit(o.name)
                      setVisitQuery(o.label || o.name)
                      setVisitOpen(false)
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    {o.label || o.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="h-[30px] self-end rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Run Report'}
        </button>
        {report === 'soa' ? (
          <button
            type="button"
            onClick={() => void openPackageChargeModal()}
            disabled={loadingPackagePreview || chargingPackage || !resolvedAdmission}
            className="h-[30px] self-end rounded-md border border-emerald-600 bg-white px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
            title="Partial Sales Order from existing package Quotation for unbilled days up to today"
          >
            {loadingPackagePreview
              ? 'Checking…'
              : chargingPackage
                ? 'Charging…'
                : 'Charge Package to Today'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => doExport('pdf')}
          disabled={!data}
          className="h-[30px] self-end rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Export PDF
        </button>
        <button
          type="button"
          onClick={() => doExport('excel')}
          disabled={!data}
          className="h-[30px] self-end rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Export Excel
        </button>
      </div>

      {data ? (
        <div className="rr-doc dense-listing overflow-x-auto">
          <style>{`
            .rr-doc table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
            .rr-doc th, .rr-doc td { border: 1px solid #cbd5e1; padding: 3px 6px; text-align: left; font-size: 12px; }
            .rr-doc th { background: #f1f5f9; }
            .rr-doc td.num, .rr-doc th.num { text-align: right; }
            .rr-doc tr.total td { font-weight: 600; background: #f8fafc; }
            .rr-doc h3 { font-weight: 600; margin: 12px 0 4px; }
            .rr-doc .lh { display: flex; justify-content: space-between; gap: 16px; }
            .rr-doc .lh-name { font-weight: 700; }
            .rr-doc .lh-title { text-align: right; }
            .rr-doc .lh-title h1 { font-weight: 700; text-decoration: underline; }
            .rr-doc .letter-head-top { margin-bottom: 10px; }
            .rr-doc .letter-head-top img, .rr-doc .letter-head-footer img { max-width: 100%; height: auto; }
            .rr-doc .letter-head-footer { margin-top: 16px; }
            .rr-doc .letter-head-top table, .rr-doc .letter-head-footer table { border: none; margin-bottom: 0; }
            .rr-doc .letter-head-top td, .rr-doc .letter-head-footer td,
            .rr-doc .letter-head-top th, .rr-doc .letter-head-footer th { border: none; background: transparent; }
            .rr-doc .soa-lh { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
            .rr-doc .soa-lh.soa-lh-cc { display: block; text-align: center; }
            .rr-doc .soa-lh .lh-title { text-align: center; flex: 1; }
            .rr-doc .soa-lh .lh-title h1 { color: #800000; font-size: 18px; }
            .rr-doc .soa-lh .lh-meta { color: #800000; font-size: 11px; }
          `}</style>
          <div dangerouslySetInnerHTML={{ __html: buildHtml()?.html || '' }} />
        </div>
      ) : (
        <p className="py-10 text-center text-sm font-semibold uppercase tracking-wide text-slate-400">
          {loading ? 'Loading…' : 'Set the filters and run the report'}
        </p>
      )}
      {rowsCount !== null && rowsCount === 0 && (
        <p className="py-4 text-center text-xs text-slate-400">NO RECORDS FOUND FOR THE SELECTED FILTERS</p>
      )}
      <PackageChargeToTodayModal
        open={Boolean(packagePreview)}
        preview={packagePreview}
        loading={chargingPackage}
        onClose={closePackageChargeModal}
        onConfirm={() => void confirmPackageCharge()}
      />
    </section>
  )
}
