import { Fragment, useEffect, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  canEditLabTestResultForRow,
  labResultLockReason,
} from '../../config/permissions'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import {
  fetchDocumentTypes,
  fetchLabTechnicianPractitioners,
  getCurrentUserLabTechnicianOption,
  type LinkFieldOption,
} from '../../services/common'
import {
  fetchLabTest,
  fetchLabTestTemplateDetails,
  isLabTestSampleCollectionDone,
  saveAndSubmitLabTest,
  type LabTest,
  type LabTestTemplateDetails,
  type NormalTestResultRow,
} from '../../services/labTests'
import { uploadPatientFile, type PatientDocumentRow } from '../../services/patients'
import { showLabTestRuleFeedback } from '../../utils/labTestRuleFeedback'
import { DocumentTypeSelect } from '../ui/DocumentTypeSelect'
import { CREATE_MODAL_OVERLAY_STACK } from '../ui/CreateModalChrome'
import {
  flagOn,
  groupCollectionsEnabled,
  groupResultRows,
  inclusionsForCollection,
  SpecimenAndCommentFields,
  TotalInclusionRows,
  unmatchedInclusions,
  withoutTotalInclusionRows,
} from './multipleResultEntry'

export interface LabTestEnterResultsModalProps {
  labTestName: string
  onClose: () => void
  onSaved?: () => void
  nurseLabContext?: boolean
  /** Stack above another open modal (e.g. Lab Request review). */
  elevated?: boolean
}

/** Parse a normal-range string ("4 - 11", "<200", ">5") into numeric bounds. */
function parseNormalRange(raw?: string | null): { min: number | null; max: number | null } {
  if (raw == null) return { min: null, max: null }
  const s = String(raw).replace(/[–—]/g, '-').trim()
  if (!s) return { min: null, max: null }
  const between = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)$/i)
  if (between) return { min: parseFloat(between[1]), max: parseFloat(between[2]) }
  const lt = s.match(/^[<≤]\s*=?\s*(-?\d+(?:\.\d+)?)$/)
  if (lt) return { min: null, max: parseFloat(lt[1]) }
  const gt = s.match(/^[>≥]\s*=?\s*(-?\d+(?:\.\d+)?)$/)
  if (gt) return { min: parseFloat(gt[1]), max: null }
  return { min: null, max: null }
}

function effectiveRowRange(
  row: NormalTestResultRow,
  details: LabTestTemplateDetails,
  sex?: string
): { min: number | null; max: number | null } {
  const rowRange = parseNormalRange((row as { normal_range?: string | null }).normal_range)
  const s = (sex || '').toLowerCase()
  const toNum = (v: unknown): number | null => {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isFinite(n) ? n : null
  }
  if (s === 'female') {
    const fMin = toNum(row.female_min_range)
    const fMax = toNum(row.female_max_range)
    if (fMin != null || fMax != null) return { min: fMin, max: fMax }
  }
  if (s === 'male') {
    const mMin = toNum(row.male_min_range)
    const mMax = toNum(row.male_max_range)
    if (mMin != null || mMax != null) return { min: mMin, max: mMax }
  }
  {
    const mMin = toNum(row.male_min_range)
    const mMax = toNum(row.male_max_range)
    const fMin = toNum(row.female_min_range)
    const fMax = toNum(row.female_max_range)
    if (mMin != null || mMax != null) return { min: mMin, max: mMax }
    if (fMin != null || fMax != null) return { min: fMin, max: fMax }
  }
  if (rowRange.min != null || rowRange.max != null) return rowRange
  // A multiple-result unit with no min/max of its own stays blank. Do not
  // inherit the template range, which is often 0.
  if (
    row.uses_status_bands != null ||
    row.collection_name != null ||
    'male_min_range' in row ||
    'female_min_range' in row
  ) {
    return { min: null, max: null }
  }
  if (s === 'female' && (details.female_min_range != null || details.female_max_range != null)) {
    return { min: details.female_min_range ?? null, max: details.female_max_range ?? null }
  }
  if (s === 'male' && (details.male_min_range != null || details.male_max_range != null)) {
    return { min: details.male_min_range ?? null, max: details.male_max_range ?? null }
  }
  return { min: details.min_range ?? null, max: details.max_range ?? null }
}

function normalizeMultipleStatusMark(statusText: string): string {
  const raw = (statusText || '').trim()
  if (!raw) return ''
  const allowed = new Set([
    'High',
    'Low',
    'Normal',
    'Critically High',
    'Critically Low',
    'Deficiency',
    'Insuficiency',
    'Sufficiency',
    'Toxicity',
  ])
  if (allowed.has(raw)) return raw
  const label = (raw.split(/[\s<>0-9]/)[0] || raw.split(/\s+/)[0] || '').trim()
  const key = label.toLowerCase()
  if (key.startsWith('deficien')) return 'Deficiency'
  if (key.startsWith('insufficien') || key.startsWith('insuficien')) return 'Insuficiency'
  if (key.startsWith('sufficien')) return 'Sufficiency'
  if (key.startsWith('toxicit')) return 'Toxicity'
  return ''
}

function suggestMultipleResultStatus(value: string, options: string[]): string {
  const val = parseFloat(value)
  if (!Number.isFinite(val) || !options.length) return ''
  let matched = ''
  for (const opt of options) {
    const lt = opt.match(/<\s*([\d.]+)/)
    if (lt && val < parseFloat(lt[1])) {
      matched = opt
      break
    }
  }
  if (!matched) {
    for (const opt of options) {
      const range = opt.match(/([\d.]+)\s*[-–—]\s*([\d.]+)/)
      if (range) {
        const lo = parseFloat(range[1])
        const hi = parseFloat(range[2])
        if (val >= lo && val <= hi) {
          matched = opt
          break
        }
      }
    }
  }
  if (!matched) {
    for (const opt of options) {
      const gt = opt.match(/>\s*([\d.]+)/)
      if (gt && val > parseFloat(gt[1])) {
        matched = opt
        break
      }
    }
  }
  return normalizeMultipleStatusMark(matched)
}

function highLowMarkFromRange(value: string, min: number | null, max: number | null): string {
  const val = parseFloat(value)
  if (!Number.isFinite(val) || (min == null && max == null)) return ''
  if (min != null && val < min) return 'Low'
  if (max != null && val > max) return 'High'
  return 'Normal'
}

/**
 * Move between result inputs with the keyboard, mirroring the normal lab test
 * request (ArrowDown/Enter → next row, ArrowUp → previous row). Only inputs
 * flagged with `data-lab-result-nav` inside the same table are considered, so
 * collection headers, inclusion totals and comments are skipped.
 */
function handleResultNavKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
  event.preventDefault()
  const table = event.currentTarget.closest('table')
  if (!table) return
  const inputs = Array.from(
    table.querySelectorAll<HTMLInputElement>('input[data-lab-result-nav]:not([disabled])')
  )
  const idx = inputs.indexOf(event.currentTarget)
  if (idx < 0) return
  const next = event.key === 'ArrowUp' ? inputs[idx - 1] : inputs[idx + 1]
  if (!next) return
  next.focus()
  next.select()
}

function multipleStatusMarkClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'low' || s === 'critically low') {
    return 'border-yellow-300 bg-yellow-50 text-yellow-900'
  }
  if (
    s.includes('deficien') ||
    s.includes('toxicity') ||
    s === 'high' ||
    s === 'critically high' ||
    s === 'abnormal'
  ) {
    return 'border-red-300 bg-red-50 text-red-800'
  }
  if (s.includes('insufficien') || s.includes('insuficien')) return 'border-amber-300 bg-amber-50 text-amber-900'
  if (s.includes('sufficien') || s === 'normal') return 'border-green-300 bg-green-50 text-green-800'
  return 'border-slate-300 bg-white text-slate-800'
}

export function LabTestEnterResultsModal({
  labTestName,
  onClose,
  onSaved,
  nurseLabContext = false,
  elevated = false,
}: LabTestEnterResultsModalProps) {
  const { userRole } = useCareContext()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeLabTest, setActiveLabTest] = useState<LabTest | null>(null)
  const [customResult, setCustomResult] = useState('')
  const [labComment, setLabComment] = useState('')
  const [specimenType, setSpecimenType] = useState('')
  const [worksheetText, setWorksheetText] = useState('')
  const [tab, setTab] = useState<'results' | 'documents'>('results')
  const [resultDocuments, setResultDocuments] = useState<PatientDocumentRow[]>([])
  const [resultDocumentTypes, setResultDocumentTypes] = useState<{ name: string; document_name?: string }[]>([])
  const [resultDocumentUploading, setResultDocumentUploading] = useState<number | null>(null)
  const [normalTestItems, setNormalTestItems] = useState<NormalTestResultRow[]>([])
  const [templateDetails, setTemplateDetails] = useState<LabTestTemplateDetails>({})
  const [worksheetExpanded, setWorksheetExpanded] = useState(false)
  const [labTechnician, setLabTechnician] = useState('')
  const [labTechnicianQuery, setLabTechnicianQuery] = useState('')
  const [labTechnicianOptions, setLabTechnicianOptions] = useState<LinkFieldOption[]>([])
  const [labTechnicianOpen, setLabTechnicianOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setError(null)
        setLoading(true)
        setTab('results')
        setWorksheetExpanded(false)
        const [doc, docTypes, defaultTech] = await Promise.all([
          fetchLabTest(labTestName),
          fetchDocumentTypes(),
          getCurrentUserLabTechnicianOption().catch(() => null),
        ])
        if (cancelled) return
        if (!isLabTestSampleCollectionDone(doc) || !canEditLabTestResultForRow(doc, userRole, { nurseLabContext })) {
          toast.error(
            labResultLockReason(doc, userRole, { nurseLabContext }) ||
              'Complete sample collection before entering results.'
          )
          onClose()
          return
        }
        setActiveLabTest(doc)
        setCustomResult(doc.custom_result || '')
        setLabComment(doc.lab_test_comment || '')
        setSpecimenType(doc.custom_speciment_type || '')
        setWorksheetText(doc.worksheet_instructions || '')
        setResultDocumentTypes(docTypes)
        const loadedItems: NormalTestResultRow[] = (doc.normal_test_items || []).map((r: NormalTestResultRow) => ({
          ...r,
        }))
        let existingItems = loadedItems
        setNormalTestItems(existingItems)
        if (doc.template) {
          try {
            const d = await fetchLabTestTemplateDetails(doc.template)
            if (cancelled) return
            setTemplateDetails(d)
            existingItems = withoutTotalInclusionRows(loadedItems, d)
            setNormalTestItems(existingItems)
            if (!doc.worksheet_instructions && d.worksheet_instructions) {
              setWorksheetText(d.worksheet_instructions)
            }
            const enterAsMultiple = flagOn(d.is_multiple) && !flagOn(d.display_one_result)
            if (existingItems.length === 0 && (d.normal_test_templates || []).length > 0 && !enterAsMultiple) {
              setNormalTestItems(
                (d.normal_test_templates || []).map((t) => ({
                  lab_test_event: t.lab_test_event || '',
                  lab_test_name: t.lab_test_event || '',
                  lab_test_uom: t.lab_test_uom || '',
                  normal_range: t.normal_range || '',
                  result_value: '',
                  lab_test_comment: '',
                  template: doc.template || '',
                }))
              )
            } else if (existingItems.length > 0 && enterAsMultiple && (d.multiple_result_type || []).length > 0) {
              const byUnit = new Map(
                (d.multiple_result_type || []).map((t) => [(t.test_unit || t.uom || '').trim(), t])
              )
              const statusOptions = d.status_options || []
              setNormalTestItems(
                existingItems.map((row) => {
                  const key = (row.lab_test_event || row.lab_test_name || '').trim()
                  const t = byUnit.get(key)
                  const useStatus = Boolean(t?.use_status ?? t?.uses_status_bands)
                  const sex = doc.patient_sex || doc.gender
                  const enriched: NormalTestResultRow = {
                    ...row,
                    uses_status_bands: useStatus,
                    male_min_range: t?.male_min_range ?? row.male_min_range,
                    male_max_range: t?.male_max_range ?? row.male_max_range,
                    female_min_range: t?.female_min_range ?? row.female_min_range,
                    female_max_range: t?.female_max_range ?? row.female_max_range,
                    normal_range: row.normal_range || t?.normal_range || '',
                    collection_name: row.collection_name || t?.collection_name || '',
                  }
                  if (row.result_value) {
                    if (useStatus && statusOptions.length) {
                      enriched.result_status = suggestMultipleResultStatus(String(row.result_value), statusOptions)
                    } else {
                      const { min, max } = effectiveRowRange(enriched, d, sex)
                      enriched.result_status = highLowMarkFromRange(String(row.result_value), min, max)
                    }
                  }
                  return enriched
                })
              )
            } else if (existingItems.length === 0 && enterAsMultiple && (d.multiple_result_type || []).length > 0) {
              setNormalTestItems(
                (d.multiple_result_type || []).filter((t) => !flagOn(t.total_inclusion)).map((t) => {
                  const unit = (t.test_unit || t.uom || '').trim()
                  const useStatus = Boolean(t.use_status ?? t.uses_status_bands)
                  return {
                    lab_test_event: unit,
                    lab_test_name: unit,
                    lab_test_uom: (t.uom || '').trim(),
                    normal_range: t.normal_range || '',
                    result_value: '',
                    result_status: '',
                    lab_test_comment: '',
                    template: doc.template || '',
                    uses_status_bands: useStatus,
                    male_min_range: t.male_min_range,
                    male_max_range: t.male_max_range,
                    female_min_range: t.female_min_range,
                    female_max_range: t.female_max_range,
                    collection_name: t.collection_name || '',
                  }
                })
              )
            }
          } catch {
            if (!cancelled) setTemplateDetails({})
          }
        } else {
          setTemplateDetails({})
        }
        const docs = doc.documents?.length
          ? doc.documents.map((d) => ({
              file_name: d.file_name || '',
              document_type: d.document_type || '',
              transaction_no: d.transaction_no || '',
              upload_remarks: d.upload_remarks || '',
              document: d.document || '',
            }))
          : [{ file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }]
        setResultDocuments(docs)
        const existingTech = (doc.lab_technician || '').trim()
        // Prefer the signed-in Lab Technician / Technologist when entering results.
        // Existing values are often the ordering doctor (wrong field) and must not stick.
        if (defaultTech?.name) {
          setLabTechnician(defaultTech.name)
          setLabTechnicianQuery(defaultTech.label || defaultTech.name)
        } else if (existingTech) {
          setLabTechnician(existingTech)
          setLabTechnicianQuery((doc.lab_technician_name || '').trim() || existingTech)
        } else {
          setLabTechnician('')
          setLabTechnicianQuery('')
        }
        setLabTechnicianOpen(false)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load lab test')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [labTestName, nurseLabContext, onClose, userRole])

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setLabTechnicianOptions(await fetchLabTechnicianPractitioners(labTechnicianQuery.trim() || undefined))
      } catch {
        setLabTechnicianOptions([])
      }
    }, labTechnicianQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [labTechnicianQuery])

  const addResultDocumentRow = () =>
    setResultDocuments((prev) => [...prev, { file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }])

  const updateResultDocumentRow = (idx: number, field: keyof PatientDocumentRow, value: string) => {
    setResultDocuments((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const handleResultDocumentFile = async (idx: number, file: File | null) => {
    if (!file) return
    setResultDocumentUploading(idx)
    try {
      const file_url = await uploadPatientFile(file)
      if (!file_url) throw new Error('No URL returned from upload')
      setResultDocuments((prev) => {
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          document: file_url,
          file_name: (next[idx].file_name || '').trim() || file.name,
        }
        return next
      })
      toast.success('File uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File upload failed')
    } finally {
      setResultDocumentUploading(null)
    }
  }

  const handleSave = async () => {
    if (!activeLabTest) return
    try {
      setSaving(true)
      setError(null)
      const docPayload = resultDocuments
        .filter((r) => (r.file_name || '').trim() || (r.document || '').trim())
        .map((r) => ({
          file_name: (r.file_name || '').trim() || undefined,
          document_type: (r.document_type || '').trim() || undefined,
          transaction_no: (r.transaction_no || '').trim() || undefined,
          upload_remarks: (r.upload_remarks || '').trim() || undefined,
          document: (r.document || '').trim() || undefined,
        }))
      const res = await saveAndSubmitLabTest(activeLabTest.name, {
        custom_result: customResult,
        lab_test_comment: labComment,
        custom_speciment_type: flagOn(templateDetails.allow_specimen_type) ? specimenType : undefined,
        worksheet_instructions: worksheetText,
        documents: docPayload.length ? docPayload : undefined,
        normal_test_items: normalTestItems.length ? normalTestItems : undefined,
        lab_technician: labTechnician.trim() || undefined,
      })
      showLabTestRuleFeedback(res)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save lab results')
    } finally {
      setSaving(false)
    }
  }

  if (typeof document === 'undefined') return null

  const overlayClass = elevated
    ? CREATE_MODAL_OVERLAY_STACK
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40'
  const busy = loading || saving
  const groupByCollection = groupCollectionsEnabled(templateDetails)
  const showSpecimen = flagOn(templateDetails.allow_specimen_type)
  const showTemplateComment = flagOn(templateDetails.include_comment)
  const resultGroups = groupResultRows(normalTestItems, groupByCollection)
  const resultColSpan = templateDetails.is_multiple ? 6 : 5

  return createPortal(
    <div className={overlayClass} data-healthcare-modal>
      <div className="mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Enter Results {activeLabTest?.name ? `for ${activeLabTest.name}` : labTestName ? `for ${labTestName}` : ''}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="flex flex-shrink-0 border-b border-slate-200 px-4">
          {(['results', 'documents'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-1 text-xs font-medium ${
                tab === t ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'documents'
                ? `Documents${resultDocuments.length > 0 ? ` (${resultDocuments.length})` : ''}`
                : 'Results'}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          {loading ? (
            <div className="text-sm text-slate-600">Loading...</div>
          ) : tab === 'results' ? (
            <>
              <div className={showSpecimen ? 'grid grid-cols-2 items-end gap-2' : ''}>
              <div className="relative">
                <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                  Lab technician <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={labTechnician ? labTechnicianQuery || labTechnician : labTechnicianQuery}
                    onChange={(e) => {
                      setLabTechnician('')
                      setLabTechnicianQuery(e.target.value)
                      setLabTechnicianOpen(true)
                    }}
                    onFocus={() => setLabTechnicianOpen(true)}
                    placeholder="Search by name…"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {labTechnicianOpen && (
                    <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                      {labTechnicianOptions.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">
                          No matches. Try another search or create practitioners with the correct Medical Role.
                        </div>
                      ) : (
                        labTechnicianOptions.map((opt) => (
                          <button
                            key={opt.name}
                            type="button"
                            className="w-full border-b border-slate-50 px-2 py-1 text-left text-xs last:border-0 hover:bg-slate-100"
                            onClick={() => {
                              setLabTechnician(opt.name)
                              setLabTechnicianQuery(opt.label || opt.name)
                              setLabTechnicianOpen(false)
                            }}
                          >
                            <span className="font-medium text-slate-800">{opt.label || opt.name}</span>
                            {opt.medical_role && (
                              <span className="mt-0.5 block text-[11px] text-slate-500">Role: {opt.medical_role}</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
              {showSpecimen ? (
                <SpecimenAndCommentFields
                  showSpecimen
                  specimen={specimenType}
                  onSpecimen={setSpecimenType}
                  showComment={false}
                  comment={labComment}
                  onComment={setLabComment}
                />
              ) : null}
              </div>
              {normalTestItems.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-800">
                    {templateDetails.is_multiple ? 'Multiple Unit Results' : 'Test Results'}
                  </label>
                  <div className="overflow-hidden rounded border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          <th className="px-2 py-1 text-left text-xs font-semibold text-slate-600">
                            {templateDetails.is_multiple ? 'Unit' : 'Test / Event'}
                          </th>
                          <th className="w-24 px-2 py-1 text-center text-xs font-semibold text-slate-600">Min</th>
                          <th className="w-24 px-2 py-1 text-center text-xs font-semibold text-slate-600">Max</th>
                          <th className="w-36 px-2 py-1 text-left text-xs font-semibold text-slate-600">Result</th>
                          {templateDetails.is_multiple ? (
                            <th className="w-48 px-2 py-1 text-left text-xs font-semibold text-slate-600">Status</th>
                          ) : null}
                          <th className="px-2 py-1 text-left text-xs font-semibold text-slate-600">Comment</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {resultGroups.map((group) => (
                          <Fragment key={group.name || 'all'}>
                            {group.name ? (
                              <tr className="bg-teal-700 text-white">
                                <td
                                  colSpan={resultColSpan}
                                  className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                                >
                                  {group.name}
                                </td>
                              </tr>
                            ) : null}
                            {group.indexes.map((idx) => {
                          const row = normalTestItems[idx]
                          const result = parseFloat(row.result_value || '')
                          const { min, max } = effectiveRowRange(
                            row,
                            templateDetails,
                            activeLabTest?.patient_sex || activeLabTest?.gender
                          )
                          const hasResult =
                            row.result_value !== '' && row.result_value != null && !Number.isNaN(result)
                          const isLowResult =
                            hasResult && !row.uses_status_bands && min != null && result < min
                          const isHighResult =
                            hasResult && !row.uses_status_bands && max != null && result > max
                          const statusOptions = templateDetails.status_options || []
                          const isMultiple = Boolean(templateDetails.is_multiple)
                          const statusMark = isMultiple ? row.result_status || '' : ''
                          return (
                            <tr
                              key={idx}
                              className={
                                isLowResult
                                  ? 'bg-yellow-50'
                                  : isHighResult
                                    ? 'bg-red-50'
                                    : 'hover:bg-slate-50/50'
                              }
                            >
                              <td className="px-2 py-1">
                                <div className="text-xs font-medium text-slate-800">
                                  {row.lab_test_event || row.lab_test_name || '—'}
                                </div>
                                {row.lab_test_uom && (
                                  <div className="mt-0.5 text-[11px] text-slate-400">{row.lab_test_uom}</div>
                                )}
                              </td>
                              <td className="px-2 py-1 text-center">
                                <span
                                  className={`text-xs font-medium ${min != null ? 'text-slate-700' : 'text-slate-300'}`}
                                >
                                  {min != null ? min : '—'}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-center">
                                <span
                                  className={`text-xs font-medium ${max != null ? 'text-slate-700' : 'text-slate-300'}`}
                                >
                                  {max != null ? max : '—'}
                                </span>
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  data-lab-result-nav={idx}
                                  value={row.result_value ?? ''}
                                  onKeyDown={handleResultNavKeyDown}
                                  title="Enter result. ↑/↓ move between fields"
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setNormalTestItems((prev) => {
                                      const next = [...prev]
                                      const updated: NormalTestResultRow = { ...next[idx], result_value: v }
                                      if (isMultiple) {
                                        if (updated.uses_status_bands && statusOptions.length) {
                                          updated.result_status = suggestMultipleResultStatus(v, statusOptions)
                                        } else {
                                          const range = effectiveRowRange(
                                            updated,
                                            templateDetails,
                                            activeLabTest?.patient_sex || activeLabTest?.gender
                                          )
                                          updated.result_status = highLowMarkFromRange(v, range.min, range.max)
                                        }
                                      }
                                      next[idx] = updated
                                      return next
                                    })
                                  }}
                                  className={`w-full rounded border px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary ${
                                    isLowResult
                                      ? 'border-yellow-400 bg-yellow-50 text-yellow-900 focus:ring-yellow-300'
                                      : isHighResult
                                        ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300'
                                        : 'border-slate-300'
                                  }`}
                                  placeholder={min == null && max == null ? '—' : ''}
                                />
                                {isLowResult && (
                                  <div className="mt-0.5 text-[10px] font-medium text-yellow-800">
                                    ⚠ Low (below range)
                                  </div>
                                )}
                                {isHighResult && (
                                  <div className="mt-0.5 text-[10px] font-medium text-red-600">
                                    ⚠ High (above range)
                                  </div>
                                )}
                              </td>
                              {isMultiple ? (
                                <td className="px-2 py-1">
                                  {statusMark ? (
                                    <span
                                      className={`inline-flex max-w-full rounded-md border px-2 py-1 text-xs font-semibold ${multipleStatusMarkClass(statusMark)}`}
                                      title={row.uses_status_bands ? 'Status band mark' : 'High / Low from range'}
                                    >
                                      {statusMark}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-300">—</span>
                                  )}
                                </td>
                              ) : null}
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  value={row.lab_test_comment || ''}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setNormalTestItems((prev) => {
                                      const next = [...prev]
                                      next[idx] = { ...next[idx], lab_test_comment: v }
                                      return next
                                    })
                                  }}
                                  className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                  placeholder="Add comment..."
                                />
                              </td>
                            </tr>
                          )
                        })}
                            {inclusionsForCollection(templateDetails, group.name).map((line) => (
                              <TotalInclusionRows
                                key={`${group.name}-${line.title}`}
                                line={line}
                                rows={normalTestItems}
                                sex={activeLabTest?.patient_sex || activeLabTest?.gender}
                                colSpan={resultColSpan}
                                showStatus={Boolean(templateDetails.is_multiple)}
                              />
                            ))}
                          </Fragment>
                        ))}
                        {unmatchedInclusions(
                          templateDetails,
                          resultGroups.map((group) => group.name),
                        ).map((line) => (
                          <Fragment key={`total-${line.collection}-${line.title}`}>
                            {line.collection ? (
                              <tr className="bg-teal-700 text-white">
                                <td
                                  colSpan={resultColSpan}
                                  className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                                >
                                  {line.collection}
                                </td>
                              </tr>
                            ) : null}
                            <TotalInclusionRows
                              line={line}
                              rows={normalTestItems}
                              sex={activeLabTest?.patient_sex || activeLabTest?.gender}
                              colSpan={resultColSpan}
                              showStatus={Boolean(templateDetails.is_multiple)}
                            />
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <SpecimenAndCommentFields
                showSpecimen={false}
                specimen={specimenType}
                onSpecimen={setSpecimenType}
                showComment={showTemplateComment}
                comment={labComment}
                onComment={setLabComment}
              />
              {!(flagOn(templateDetails.is_multiple) && !flagOn(templateDetails.display_one_result) && normalTestItems.length > 0) && (
                <div>
                  <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Result</label>
                  <textarea
                    className="min-h-[48px] w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    value={customResult}
                    onChange={(e) => setCustomResult(e.target.value)}
                    placeholder="Enter descriptive or custom result..."
                  />
                </div>
              )}
              {showTemplateComment ? null : (
              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-slate-600">General Comments</label>
                <textarea
                  className="min-h-[40px] w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  value={labComment}
                  onChange={(e) => setLabComment(e.target.value)}
                  placeholder="Overall test comments..."
                />
              </div>
              )}
              {(worksheetText || templateDetails.worksheet_instructions) && (
                <div className="rounded-md border border-amber-200 bg-amber-50">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
                    onClick={() => setWorksheetExpanded((v) => !v)}
                  >
                    <span>📋 Worksheet Instructions</span>
                    <span className="text-xs text-amber-600">{worksheetExpanded ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {worksheetExpanded && (
                    <div className="px-3 pb-3">
                      <textarea
                        className="min-h-[80px] w-full rounded-md border border-amber-300 bg-white p-2 text-sm"
                        value={worksheetText}
                        onChange={(e) => setWorksheetText(e.target.value)}
                        placeholder="Worksheet instructions..."
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Attach lab documents (reports, scans).</p>
              {resultDocuments.length === 0 && (
                <div className="rounded-lg border-2 border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                  No documents. Click below to add one.
                </div>
              )}
              {resultDocuments.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 sm:grid-cols-2"
                >
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-600">File Name</label>
                    <input
                      value={row.file_name || ''}
                      onChange={(e) => updateResultDocumentRow(idx, 'file_name', e.target.value)}
                      placeholder="File name"
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-600">Document Type</label>
                    <DocumentTypeSelect
                      value={row.document_type || ''}
                      onChange={(v) => updateResultDocumentRow(idx, 'document_type', v)}
                      types={resultDocumentTypes}
                      onTypesUpdated={setResultDocumentTypes}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-600">Transaction No</label>
                    <input
                      value={row.transaction_no || ''}
                      onChange={(e) => updateResultDocumentRow(idx, 'transaction_no', e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-600">Upload Remarks</label>
                    <input
                      value={row.upload_remarks || ''}
                      onChange={(e) => updateResultDocumentRow(idx, 'upload_remarks', e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-0.5 block text-xs font-medium text-slate-600">File</label>
                    <input
                      type="file"
                      disabled={resultDocumentUploading === idx}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void handleResultDocumentFile(idx, f)
                        e.target.value = ''
                      }}
                      className="w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-white"
                    />
                    {resultDocumentUploading === idx && (
                      <span className="text-xs text-slate-500">Uploading...</span>
                    )}
                    {row.document && resultDocumentUploading !== idx && (
                      <span className="block text-xs text-green-600">✓ File attached</span>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addResultDocumentRow}
                className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <span>+</span> Add document
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !activeLabTest}
            className="rounded bg-primary px-2.5 py-1 text-xs text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Results'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
