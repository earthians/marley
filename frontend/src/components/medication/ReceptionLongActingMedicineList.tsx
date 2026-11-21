import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { fetchReceptionLongActingMedicineList } from '../../services/receptionLongActingMedicine'
import type { LongActingMedicineRow, ReminderChannel, InjectionSide } from '../../services/longActingMedicine'
import { sendLongActingMedicineReminder, updateLongActingMedicineRemarks, recordLongActingMedicineGiveOut, stopLongActingMedicine, fetchLongActingMedicine, formatInjectionSide, formatInjectionSideShort, formatLongActingDose, suggestedNextInjectionSide, fetchLongActingGiveOutsForPatient, resolveGiveOutGivenBy, type LongActingGiveOutHistoryRow } from '../../services/longActingMedicine'
import {
  LONG_ACTING_FREQUENCY_OPTIONS,
  mapLongActingMedicineToDuplicateMedications,
  type MedicationOrderRow,
} from '../../services/prescriptions'
import { CreatePrescriptionModal } from '../prescriptions/CreatePrescriptionModal'
import { LongActingMedicineDetailPanel } from './LongActingMedicineDetailPanel'
import { toast } from '../../hooks/useToast'
import { Mail, MoreHorizontal, Pencil } from 'lucide-react'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { useCardFilters } from '../../contexts/CardFilterContext'
import { useCareContext } from '../../providers/CareContextProvider'
import { isDoctorRole, isNurseRole, canSeeLongActingMedDetails } from '../../config/permissions'
import { DateFilterInput } from '../ui/DateFilterInput'
import { SendWhatsAppLongActingModal } from './SendWhatsAppLongActingModal'
import { EditLongActingMedicineModal } from './EditLongActingMedicineModal'

interface ReceptionLongActingMedicineListProps {
  patient?: string
  refreshKey?: string | number
  onPatientClick?: (patient: string) => void
  /** When a prescription is created from Duplicate / parent +, refresh parent lists */
  onPrescriptionCreated?: () => void
}

export const ReceptionLongActingMedicineList = ({
  patient,
  refreshKey,
  onPatientClick,
  onPrescriptionCreated,
}: ReceptionLongActingMedicineListProps) => {
  const { userRole, guardClinicalCreate } = useCareContext()
  const canRecordGiveOut = isDoctorRole(userRole) || isNurseRole(userRole)
  const canDuplicateAsPrescription = isDoctorRole(userRole)
  // #11: reception / non-clinical roles see only due dates — medicine details are masked (not removed).
  const maskMedDetails = !canSeeLongActingMedDetails(userRole)
  // Edit is available to the same clinical roles that can see medicine details.
  const canEditLongActing = canSeeLongActingMedDetails(userRole)
  const mask = (value: React.ReactNode) =>
    maskMedDetails ? <span className="text-slate-400" title="Restricted">••••</span> : value
  const cardFilters = useCardFilters()
  const inDashboardCard = cardFilters !== undefined
  const [showFiltersInternal, setShowFiltersInternal] = useState(false)
  const showFilters = inDashboardCard ? cardFilters : showFiltersInternal

  const [rows, setRows] = useState<LongActingMedicineRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState('')
  const [frequency, setFrequency] = useState<string>('')
  const [status, setStatus] = useState<string>('Active')
  const [sortBy, setSortBy] = useState<'next_run_date' | 'start_date'>('next_run_date')
  const hasActiveFilters = Boolean(startDate || frequency || (status && status !== 'Active'))
  const [detailName, setDetailName] = useState<string | null>(null)
  const [detailPreview, setDetailPreview] = useState<LongActingMedicineRow | undefined>(undefined)
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkChannelMenuOpen, setBulkChannelMenuOpen] = useState(false)
  const bulkMenuRef = useRef<HTMLDivElement>(null)

  // Three-dot action menu
  const [openMenuRow, setOpenMenuRow] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Remarks modal
  const [remarksModal, setRemarksModal] = useState<{ name: string; current: string } | null>(null)
  const [remarksText, setRemarksText] = useState('')
  const [remarksSaving, setRemarksSaving] = useState(false)
  // In-app edit modal (schedule / status / side / notes)
  const [editRow, setEditRow] = useState<LongActingMedicineRow | null>(null)
  const [giveOutModal, setGiveOutModal] = useState<LongActingMedicineRow | null>(null)
  const [giveOutNotes, setGiveOutNotes] = useState('')
  const [giveOutDosage, setGiveOutDosage] = useState('')
  const [giveOutDosageForm, setGiveOutDosageForm] = useState('')
  const [giveOutInjectionSide, setGiveOutInjectionSide] = useState<InjectionSide | null>(null)
  const [giveOutModalLoading, setGiveOutModalLoading] = useState(false)
  const [givingOutId, setGivingOutId] = useState<string | null>(null)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [whatsappTarget, setWhatsappTarget] = useState<{ name: string; patientName: string } | null>(null)

  // Duplicate → Create Prescription (Long Acting type pre-selected)
  const [duplicateRx, setDuplicateRx] = useState<{
    patient?: string
    practitioner?: string
    medications: MedicationOrderRow[]
    sourceName: string
  } | null>(null)
  const [duplicateLoadingId, setDuplicateLoadingId] = useState<string | null>(null)

  const openDuplicatePrescription = async (e: React.MouseEvent, row: LongActingMedicineRow) => {
    e.stopPropagation()
    setOpenMenuRow(null)
    if (!canDuplicateAsPrescription) return
    try {
      setDuplicateLoadingId(row.name)
      let source: LongActingMedicineRow = row
      try {
        source = await fetchLongActingMedicine(row.name)
      } catch {
        /* use list row if detail fetch fails */
      }
      const medications = mapLongActingMedicineToDuplicateMedications(source)
      guardClinicalCreate(() =>
        setDuplicateRx({
          patient: source.patient || row.patient,
          /* Fallback only when the creator has no linked practitioner (e.g. reception).
           * CreatePrescriptionModal prefers the logged-in linked doctor, and the API
           * keeps that doctor on the new PMO / Long Acting Medicine (visit fetch_from
           * must not put the original doctor back). */
          practitioner: source.practitioner || row.practitioner,
          medications,
          sourceName: row.name,
        })
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open duplicate prescription')
    } finally {
      setDuplicateLoadingId(null)
    }
  }

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchReceptionLongActingMedicineList({
        start_date: startDate || undefined,
        frequency: frequency || undefined,
        status: status || undefined,
        patient: patient || undefined,
        limit: 100,
        offset: 0,
      })
      setRows(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load long acting medicines'
      setError(msg)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, frequency, status, patient])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  // Merged give-out history across all of the patient's long-acting medicines (latest first).
  const [history, setHistory] = useState<LongActingGiveOutHistoryRow[]>([])
  const loadHistory = useCallback(() => {
    fetchLongActingGiveOutsForPatient(patient || undefined).then(setHistory).catch(() => setHistory([]))
  }, [patient])
  useEffect(() => { loadHistory() }, [loadHistory, refreshKey])

  const clearFilters = () => {
    setStartDate('')
    setFrequency('')
    setStatus('Active')
  }

  // Close action menu when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-portal-actions-menu]')) return
      if (el.closest('button[aria-label="Actions"]')) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuRow(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const openRemarksModal = (e: React.MouseEvent, row: LongActingMedicineRow) => {
    e.stopPropagation()
    setOpenMenuRow(null)
    setRemarksText(row.remarks || '')
    setRemarksModal({ name: row.name, current: row.remarks || '' })
  }

  const handleSaveRemarks = async () => {
    if (!remarksModal) return
    setRemarksSaving(true)
    try {
      await updateLongActingMedicineRemarks(remarksModal.name, remarksText)
      toast.success('Reception remarks updated')
      setRows((prev) =>
        prev.map((r) => r.name === remarksModal.name ? { ...r, remarks: remarksText } : r)
      )
      setRemarksModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update reception remarks')
    } finally {
      setRemarksSaving(false)
    }
  }

  const formattedRows = useMemo(() => {
    const sorted = [...rows]
    sorted.sort((a, b) => {
      const aVal = (sortBy === 'next_run_date' ? a.next_run_date : a.start_date) || ''
      const bVal = (sortBy === 'next_run_date' ? b.next_run_date : b.start_date) || ''
      if (!aVal && !bVal) return 0
      if (!aVal) return 1
      if (!bVal) return -1
      return aVal.localeCompare(bVal)
    })
    return sorted
  }, [rows, sortBy])

  const formatDate = (d?: string) => {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-GB')
  }

  const getRowColorClass = (row: LongActingMedicineRow) => {
    if (row.status === 'Completed' || row.status === 'Paused') {
      return 'bg-slate-100 hover:bg-slate-200 text-slate-600'
    }
    if (row.is_given_out_for_current_run) return 'bg-white hover:bg-slate-50'
    if (!row.next_run_date) return 'bg-white hover:bg-slate-50'
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const next = new Date(row.next_run_date)
    next.setHours(0, 0, 0, 0)
    const diffDays = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return 'bg-red-100 hover:bg-red-200'
    if (diffDays === 0 || diffDays === 1) return 'bg-green-100 hover:bg-green-200'
    return 'bg-white hover:bg-slate-50'
  }

  const isDueNextRun = (row: LongActingMedicineRow) => {
    if (!row.next_run_date) return false
    const status = row.status || 'Draft'
    if (status !== 'Active' && status !== 'Draft') return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const next = new Date(row.next_run_date)
    next.setHours(0, 0, 0, 0)
    return next.getTime() <= today.getTime()
  }

  const showAwaitingNewOrder =
    isNurseRole(userRole) && !isDoctorRole(userRole) && !canDuplicateAsPrescription

  const applyGiveOutDefaults = (row: LongActingMedicineRow, detail?: LongActingMedicineRow) => {
    const source = detail || row
    const med = source.medications?.[0]
    const dosage =
      source.default_dosage
      ?? (med?.dosage != null && med.dosage !== '' && Number(med.dosage) !== 0
        ? String(med.dosage)
        : '')
    const uom = source.default_uom ?? med?.uom ?? ''
    setGiveOutDosage(dosage || '')
    setGiveOutDosageForm(uom || '')
    setGiveOutInjectionSide(suggestedNextInjectionSide(source.injection_given_on))
  }

  const resetGiveOutModal = () => {
    setGiveOutModal(null)
    setGiveOutNotes('')
    setGiveOutDosage('')
    setGiveOutDosageForm('')
    setGiveOutInjectionSide(null)
  }

  const handleGiveOut = async (e: React.MouseEvent, row: LongActingMedicineRow) => {
    e.stopPropagation()
    if (!row.can_give_out) return
    setGiveOutNotes('')
    applyGiveOutDefaults(row)
    setGiveOutModal(row)
    setGiveOutModalLoading(true)
    try {
      const detail = await fetchLongActingMedicine(row.name)
      applyGiveOutDefaults(row, detail)
      setGiveOutModal((prev) => (prev ? { ...prev, ...detail } : prev))
    } catch {
      // keep list defaults if detail fetch fails
    } finally {
      setGiveOutModalLoading(false)
    }
  }

  const handleConfirmGiveOut = async () => {
    if (!giveOutModal) return
    if (!giveOutInjectionSide) {
      toast.error('Please select injection side (Left or Right)')
      return
    }
    setGivingOutId(giveOutModal.name)
    try {
      const updated = await recordLongActingMedicineGiveOut(
        giveOutModal.name,
        giveOutNotes.trim() || undefined,
        giveOutDosage.trim(),
        giveOutDosageForm.trim(),
        giveOutInjectionSide,
      )
      setRows((prev) =>
        prev.map((item) => (item.name === giveOutModal.name ? { ...item, ...updated } : item)),
      )
      resetGiveOutModal()
      loadHistory()
      toast.success('Long acting medicine marked as given out')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record give-out')
    } finally {
      setGivingOutId(null)
    }
  }

  const handleStop = async (e: React.MouseEvent, row: LongActingMedicineRow) => {
    e.stopPropagation()
    setOpenMenuRow(null)
    if (!row.can_stop) return
    const reason = window.prompt(
      `Stop long acting medicine for ${row.patient_name || row.patient || row.name}?\n\nOptional reason:`,
    )
    if (reason === null) return
    if (!window.confirm('Stop this long acting medicine? No further doses will be scheduled.')) return

    setStoppingId(row.name)
    try {
      const updated = await stopLongActingMedicine(row.name, reason.trim() || undefined)
      setRows((prev) =>
        prev.map((item) => (item.name === row.name ? { ...item, ...updated } : item)),
      )
      toast.success('Long acting medicine stopped')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop long acting medicine')
    } finally {
      setStoppingId(null)
    }
  }

  const handleEdit = (e: React.MouseEvent, row: LongActingMedicineRow) => {
    e.stopPropagation()
    setOpenMenuRow(null)
    setEditRow(row)
  }

  const handleRowClick = (row: LongActingMedicineRow) => {
    setDetailPreview(row)
    setDetailName(row.name)
  }


  const handleBulkSendReminders = async (channel: ReminderChannel) => {
    if (formattedRows.length === 0) {
      toast.error('No long acting medicines to send reminders for')
      return
    }
    const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Email'
    if (!window.confirm(`Send ${channelLabel} reminders for all ${formattedRows.length} long acting medicine record(s) in the current view?`)) {
      return
    }
    
    setBulkSending(true)
    let successCount = 0
    let failCount = 0
    
    for (const row of formattedRows) {
      try {
        await sendLongActingMedicineReminder(row.name, channel)
        successCount++
      } catch {
        failCount++
      }
    }
    
    setBulkSending(false)
    
    if (failCount === 0) {
      toast.success(`${channelLabel} reminders sent for ${successCount} record(s)`)
    } else {
      toast.error(`${successCount} sent, ${failCount} failed`)
    }
  }

  const handleSendReminder = async (e: React.MouseEvent, rowName: string, patientName: string, channel: ReminderChannel) => {
    e.stopPropagation()
    setOpenMenuRow(null)
    if (channel === 'whatsapp') {
      setWhatsappTarget({ name: rowName, patientName: patientName || rowName })
      return
    }
    const channelLabel = channel === 'sms' ? 'SMS' : 'Email'
    try {
      await sendLongActingMedicineReminder(rowName, channel)
      toast.success(`${channelLabel} reminder sent for ${patientName || rowName}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to send ${channelLabel} reminder`)
    }
  }

  const handleCloseDetail = () => {
    setDetailName(null)
    setDetailPreview(undefined)
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {!inDashboardCard && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowFiltersInternal((v) => !v)}
            className={`p-1.5 rounded-md border transition-colors ${
              showFilters ? 'bg-primary/10 border-primary text-primary' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
            }`}
            title={showFilters ? 'Hide filters' : 'Show filters'}
            aria-label={showFilters ? 'Hide filters' : 'Show filters'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
              />
            </svg>
          </button>
        </div>
      )}

      <div className="card-filter-bar flex flex-wrap items-end gap-3 px-1 py-2 border-b border-slate-100 bg-slate-50/80 rounded-md">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select
            className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white min-w-[140px]"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Select All</option>
            <option value="Active">Active</option>
            <option value="Draft">Draft</option>
            <option value="Paused">Paused</option>
            <option value="Inactive">Inactive</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
        <div className="relative" ref={bulkMenuRef}>
          <button
            type="button"
            disabled={bulkSending || formattedRows.length === 0}
            onClick={() => setBulkChannelMenuOpen((p) => !p)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-primary bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Mail className="w-4 h-4" />
            {bulkSending ? 'Sending…' : `Bulk Send Reminders${formattedRows.length ? ` (${formattedRows.length})` : ''}`}
            {!bulkSending && (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            )}
          </button>
          {bulkChannelMenuOpen && (
            <div className="absolute left-0 bottom-full z-30 mb-1 w-48 bg-white border border-slate-200 rounded-md shadow-lg py-1">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                Choose Channel
              </div>
              <button type="button" onClick={() => { setBulkChannelMenuOpen(false); handleBulkSendReminders('email') }}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-blue-500" /> Email
              </button>
              <button type="button" onClick={() => { setBulkChannelMenuOpen(false); handleBulkSendReminders('whatsapp') }}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <span className="text-green-500 text-base leading-none">💬</span> WhatsApp
              </button>
              <button type="button" onClick={() => { setBulkChannelMenuOpen(false); handleBulkSendReminders('sms') }}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <span className="text-purple-500 text-base leading-none">📱</span> SMS
              </button>
            </div>
          )}
        </div>

        {showFilters && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
              <DateFilterInput
                className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Frequency</label>
              <select
                className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white min-w-[160px]"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="">Select All</option>
                {LONG_ACTING_FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Sort By</label>
              <select
                className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white min-w-[160px]"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'next_run_date' | 'start_date')}
              >
                <option value="next_run_date">Next Run Date</option>
                <option value="start_date">Start Date</option>
              </select>
            </div>

            <ClearFiltersButton onClick={clearFilters} disabled={!hasActiveFilters} />
          </>
        )}
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="text-sm text-slate-600 py-4">Loading long acting medicines…</div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : formattedRows.length === 0 ? (
        <div className="text-sm text-slate-500 py-4">
          NO LONG ACTING MEDICINES FOUND FOR THE SELECTED FILTERS.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Name</th>
                {!patient && (
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Patient</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Frequency</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Start</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Next Run</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Medication</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Dose</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase">Last Inj.</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Doctor</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Reception Remarks</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Doctors Remark</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Status</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {formattedRows.map((row) => (
                    <tr
                      key={row.name}
                      className={`cursor-pointer transition-colors ${getRowColorClass(row)}`}
                      onClick={() => handleRowClick(row)}
                    >
                      <td className="px-3 py-2">
                        <span className="text-primary font-medium">{row.name}</span>
                      </td>
                      {!patient && (
                        <td
                          className="px-3 py-2 text-slate-700 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); row.patient && onPatientClick?.(row.patient) }}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-primary hover:underline">{row.patient_name || '—'}</span>
                            <span className="text-xs text-slate-500">{row.patient || ''}</span>
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-2 text-slate-700">{mask(row.frequency || '—')}</td>
                      <td className="px-3 py-2 text-slate-700">{formatDate(row.start_date)}</td>
                      <td className="px-3 py-2 text-slate-700">{formatDate(row.next_run_date)}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[180px]">
                        {mask(
                          <span className="line-clamp-2" title={row.medication_label || undefined}>
                            {row.medication_label || '—'}
                          </span>,
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        {mask(
                          formatLongActingDose(row.default_dosage, row.default_uom) || '—',
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-center text-slate-700 whitespace-nowrap"
                        title={row.injection_given_on ? formatInjectionSide(row.injection_given_on) : undefined}
                      >
                        {mask(
                          <span className="inline-flex items-center justify-center min-w-[1.75rem] rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                            {formatInjectionSideShort(row.injection_given_on)}
                          </span>,
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700 max-w-[9rem]">
                        {mask(
                          <span
                            className="block truncate"
                            title={row.practitioner_name || row.practitioner || undefined}
                          >
                            {row.practitioner_name || row.practitioner || '—'}
                          </span>,
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700 max-w-[10rem]">
                        {/* Reception remarks are for this screen — never mask them. */}
                        <span
                          className="block truncate text-slate-700"
                          title={row.remarks || undefined}
                        >
                          {row.remarks?.trim() ? row.remarks : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700 max-w-[12rem]">
                        {mask(
                          <span
                            className="block truncate text-slate-700"
                            title={row.doctors_remark || undefined}
                          >
                            {row.doctors_remark || '—'}
                          </span>,
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <span>{row.status || 'Draft'}</span>
                      </td>
                      {/* Actions column */}
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {canRecordGiveOut && row.can_stop && (
                            <button
                              type="button"
                              onClick={(e) => handleStop(e, row)}
                              disabled={stoppingId === row.name}
                              className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              {stoppingId === row.name ? 'Stopping…' : 'Stop'}
                            </button>
                          )}
                          {canRecordGiveOut && row.can_give_out && (
                            <button
                              type="button"
                              onClick={(e) => handleGiveOut(e, row)}
                              disabled={givingOutId === row.name}
                              className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded border border-emerald-600 bg-white text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {givingOutId === row.name ? 'Saving…' : 'Give out'}
                            </button>
                          )}
                          {canDuplicateAsPrescription && row.can_duplicate_for_next_run && (
                            <button
                              type="button"
                              onClick={(e) => void openDuplicatePrescription(e, row)}
                              disabled={duplicateLoadingId === row.name}
                              className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded border border-teal-600 bg-white text-teal-800 hover:bg-teal-50 disabled:opacity-50"
                              title="Create a new long-acting order for this due cycle"
                            >
                              {duplicateLoadingId === row.name ? 'Opening…' : 'Duplicate'}
                            </button>
                          )}
                          {showAwaitingNewOrder &&
                            isDueNextRun(row) &&
                            !row.can_give_out &&
                            !row.can_duplicate_for_next_run && (
                              <span
                                className="inline-flex items-center px-2 py-1 text-[10px] font-medium rounded border border-amber-200 bg-amber-50 text-amber-800"
                                title="A doctor must Duplicate this order before the next dose can be given"
                              >
                                Awaiting new order
                              </span>
                            )}
                          {/* Three-dot menu */}
                          <div className="relative" ref={openMenuRow === row.name ? menuRef : undefined}>
                            <button
                              type="button"
                              aria-label="Actions"
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenMenuRow(openMenuRow === row.name ? null : row.name)
                              }}
                              className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            <PortalActionsMenu
                              open={openMenuRow === row.name}
                              onClose={() => setOpenMenuRow(null)}
                              triggerRef={menuRef}
                              placement="above-right"
                              minWidth={176}
                            >
                              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                                Send Reminder
                              </div>
                              <button
                                type="button"
                                onClick={(e) => handleSendReminder(e, row.name, row.patient_name || row.patient || row.name, 'email')}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <Mail className="w-3.5 h-3.5 text-blue-500" /> Send Email
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleSendReminder(e, row.name, row.patient_name || row.patient || row.name, 'whatsapp')}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <span className="text-green-500 text-base leading-none">💬</span> Send WhatsApp
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleSendReminder(e, row.name, row.patient_name || row.patient || row.name, 'sms')}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <span className="text-purple-500 text-base leading-none">📱</span> Send SMS
                              </button>
                              <div className="border-t border-slate-100 my-1" />
                              {canEditLongActing && (
                                <button
                                  type="button"
                                  onClick={(e) => handleEdit(e, row)}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-indigo-500" /> Edit long acting
                                </button>
                              )}
                              {canDuplicateAsPrescription && (
                                <button
                                  type="button"
                                  onClick={(e) => void openDuplicatePrescription(e, row)}
                                  disabled={duplicateLoadingId === row.name}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
                                >
                                  <span className="text-teal-600 text-base leading-none">⧉</span>
                                  {duplicateLoadingId === row.name ? 'Opening…' : 'Duplicate'}
                                </button>
                              )}
                              {canRecordGiveOut && row.can_stop && (
                                <button
                                  type="button"
                                  onClick={(e) => handleStop(e, row)}
                                  disabled={stoppingId === row.name}
                                  className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 flex items-center gap-2"
                                >
                                  <span className="text-red-500 text-base leading-none">⏹</span> Stop medicine
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => openRemarksModal(e, row)}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <span className="text-slate-500 text-base leading-none">✏️</span> Add Reception Remarks
                              </button>
                            </PortalActionsMenu>
                          </div>

                          {/* Print */}
                          <PrintFormatDropdown
                            doctype="Long Acting Medicine"
                            docName={row.name}
                            noLetterhead={0}
                            triggerPrint={1}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-primary hover:bg-slate-100 transition-colors"
                          />
                        </div>
                      </td>
                    </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom: merged give-out history across long-acting medicines (latest first) */}
      {history.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            Give-out history{' '}
            <span className="font-normal text-slate-400">(all long-acting medicines, latest first)</span>
          </h3>
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Date</th>
                  {!patient && (
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Patient</th>
                  )}
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Medicine</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Dose</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase">Side</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Given by</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Notes</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Cancelled Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.name} className={h.is_cancelled ? 'bg-red-50/40 text-slate-400 line-through' : 'hover:bg-slate-50'}>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {h.date ? new Date(h.date).toLocaleDateString('en-GB') : '-'}
                      {h.time && <span className="ml-1 text-xs text-slate-400">{String(h.time).slice(0, 5)}</span>}
                    </td>
                    {!patient && (
                      <td className="px-3 py-2 text-slate-700">{h.patient_name || h.patient || '-'}</td>
                    )}
                    <td className="px-3 py-2 text-slate-800">{mask(h.medicine_label || h.medication || h.medicine || '-')}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {mask(<>{h.dose || '-'}{h.dose_term ? ` ${h.dose_term}` : ''}</>)}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-600">{mask(h.rt_flag ? 'R' : h.lt_flag ? 'L' : '-')}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {mask(
                        resolveGiveOutGivenBy(h.user, h.notes, !maskMedDetails) || '-',
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {mask(
                        h.is_cancelled ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700 no-underline">
                              Cancelled
                            </span>
                            {h.notes || ''}
                          </span>
                        ) : (
                          h.notes || '-'
                        ),
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{mask(h.cancelled_notes || '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailName ? (
        <LongActingMedicineDetailPanel
          name={detailName}
          preview={detailPreview}
          onClose={handleCloseDetail}
          onPatientClick={onPatientClick}
        />
      ) : null}

      {/* Record Give Out Modal */}
      {giveOutModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Record Give Out</h2>
                <p className="text-xs text-slate-500 mt-0.5">{giveOutModal.name}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (givingOutId) return
                  resetGiveOutModal()
                }}
                disabled={Boolean(givingOutId)}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Medication</p>
                <p className="mt-0.5 font-medium text-slate-800">
                  {giveOutModal.medication_label || '—'}
                </p>
                {giveOutModal.next_run_date ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Scheduled run: {formatDate(giveOutModal.next_run_date)}
                  </p>
                ) : null}
              </div>
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Dosage</label>
                    <input
                      type="text"
                      value={giveOutDosage}
                      onChange={(e) => setGiveOutDosage(e.target.value)}
                      placeholder={giveOutModalLoading ? 'Loading…' : '25'}
                      disabled={giveOutModalLoading || Boolean(givingOutId)}
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Unit of Measure</label>
                    <input
                      type="text"
                      value={giveOutDosageForm}
                      onChange={(e) => setGiveOutDosageForm(e.target.value)}
                      placeholder={giveOutModalLoading ? 'Loading…' : 'mg'}
                      disabled={giveOutModalLoading || Boolean(givingOutId)}
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50"
                    />
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Prefilled from the medication plan; edit either field if needed.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Injection side <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setGiveOutInjectionSide('LT')}
                    disabled={giveOutModalLoading || Boolean(givingOutId)}
                    className={`rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                      giveOutInjectionSide === 'LT'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Left (L)
                  </button>
                  <button
                    type="button"
                    onClick={() => setGiveOutInjectionSide('RT')}
                    disabled={giveOutModalLoading || Boolean(givingOutId)}
                    className={`rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                      giveOutInjectionSide === 'RT'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Right (R)
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {giveOutModal.injection_given_on
                    ? `Last time was ${formatInjectionSide(giveOutModal.injection_given_on)}. Alternate side is suggested.`
                    : 'Select which hand/arm this injection was given on.'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={giveOutNotes}
                  onChange={(e) => setGiveOutNotes(e.target.value)}
                  rows={4}
                  placeholder="Optional notes for this give-out…"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => resetGiveOutModal()}
                disabled={Boolean(givingOutId)}
                className="px-4 py-2 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmGiveOut}
                disabled={Boolean(givingOutId) || !giveOutInjectionSide}
                className="px-4 py-2 text-sm rounded-md bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 font-medium"
              >
                {givingOutId === giveOutModal.name ? 'Saving…' : 'Confirm Give Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Long Acting Medicine Modal */}
      {editRow && (
        <EditLongActingMedicineModal
          name={editRow.name}
          initialRow={editRow}
          onClose={() => setEditRow(null)}
          onSaved={(updated) => {
            const editedName = editRow.name
            setRows((prev) =>
              prev.map((item) => (item.name === editedName ? { ...item, ...updated } : item)),
            )
            // Re-query so mapped flags (can_stop / can_give_out) and status filters stay accurate.
            load()
          }}
        />
      )}

      {/* Add Reception Remarks Modal */}
      {remarksModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Add Reception Remarks</h2>
                <p className="text-xs text-slate-500 mt-0.5">{remarksModal.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setRemarksModal(null)}
                disabled={remarksSaving}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reception Remarks</label>
                <textarea
                  value={remarksText}
                  onChange={(e) => setRemarksText(e.target.value)}
                  rows={5}
                  placeholder="Enter reception remarks…"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemarksModal(null)}
                disabled={remarksSaving}
                className="px-4 py-2 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRemarks}
                disabled={remarksSaving}
                className="px-4 py-2 text-sm rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 font-medium"
              >
                {remarksSaving ? 'Saving…' : 'Save Reception Remarks'}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateRx && (
        <CreatePrescriptionModal
          onClose={() => setDuplicateRx(null)}
          onSuccess={async () => {
            const sourceName = duplicateRx.sourceName
            setDuplicateRx(null)
            try {
              if (sourceName) {
                await stopLongActingMedicine(
                  sourceName,
                  'Superseded by new prescription from Duplicate',
                )
              }
              toast.success('New order created — nurse can give out the new long-acting medicine')
            } catch (err) {
              toast.success('Prescription created from long acting medicine')
              toast.error(
                err instanceof Error
                  ? err.message
                  : 'New order created, but failed to stop the previous long-acting medicine',
              )
            }
            load()
            onPrescriptionCreated?.()
          }}
          initialPatient={duplicateRx.patient}
          initialPractitioner={duplicateRx.practitioner}
          initialMedications={duplicateRx.medications}
        />
      )}

      {whatsappTarget && (
        <SendWhatsAppLongActingModal
          name={whatsappTarget.name}
          patientName={whatsappTarget.patientName}
          onClose={() => setWhatsappTarget(null)}
        />
      )}
    </div>
  )
}