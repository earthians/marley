import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Droplet, FlaskConical, Printer, X } from 'lucide-react'
import { fetchLabRequestReview,
  type LabRequestReview,
  type LabRequestReviewGroup,
  type LabRequestReviewTest,
} from '../../services/serviceRequests'
import {
  canRecordAdHocSampleCollection,
  fetchLabTest,
  finishGroupLabTests,
  isLabTestSampleCollectionDone,
  recalculatePanelForServiceRequest,
  saveAndSubmitLabTest,
  type LabTest,
} from '../../services/labTests'
import { fetchLabTestResultRules, type LabTestResultRulesConfig } from '../../services/labTestResultRules'
import { canEditLabTestResultForRow, isGroupedLabRequestFinished } from '../../config/permissions'
import { useCareContext } from '../../providers/CareContextProvider'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import { toast } from '../../hooks/useToast'
import { CREATE_MODAL_OVERLAY } from '../ui/CreateModalChrome'
import { formatDashboardDate } from '../ui/dashboardCardListing'
import { StatusPill } from '../ui/StatusPill'
import { LabTestSampleCollectionModal } from './LabTestSampleCollectionModal'
import { LabTestEnterResultsModal } from './LabTestEnterResultsModal'
import { openLabSampleBarcodePrint } from '../../utils/printLabSampleBarcodeLabel'
import { openLabTestResultReportPrint } from '../../utils/printLabTestResultReport'
import { showLabTestRuleFeedback } from '../../utils/labTestRuleFeedback'
import {
  buildPatientFormulaContext,
  evaluateLabResultFormula,
  formatLabResultFormulaValue,
  labResultNameKey,
} from '../../utils/labResultFormula'
import { sortLabRequestReviewGroups } from './labTestDisplayUtils'

const LAB_LINE_STATUS_LABELS: Record<string, string> = {
  'Testing in progress': 'Test In-Progress',
  'Testing in Progress': 'Test In-Progress',
}

const labLineStatusLabel = (status: string) => LAB_LINE_STATUS_LABELS[status] || status

/** Same palette as Tests & Results list Status pills. */
const labLineStatusColors: Record<string, string> = {
  Reviewed: 'success',
  Rejected: 'danger',
  Completed: 'success',
  Approved: 'success',
  'Pending Review': 'warning',
  Submitted: 'info',
  Cancelled: 'default',
  Draft: 'warning',
  Pending: 'warning',
  Requested: 'info',
  'Awaiting sample collection': 'warning',
  'Sample Collection in Progress': 'info',
  'Sample collection in progress': 'info',
  'Sample Collected': 'info',
  'Testing in Progress': 'info',
  'Testing in progress': 'info',
  'Partial Result Enter': 'warning',
}

interface LabRequestReviewModalProps {
  serviceRequestName: string
  onClose: () => void
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim()
}

function parseLabResultNumber(raw: string): number | null {
  const s = stripHtml(raw).replace(/,/g, '').trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function testMatchesLabEvent(test: LabRequestReviewTest, event: string): boolean {
  const k = labResultNameKey(event)
  if (!k) return false
  return [test.test_name, test.test_code, test.template].some((n) => labResultNameKey(n) === k)
}

function isSingleResultType(value?: string | null): boolean {
  const v = (value || '').trim().toLowerCase()
  return !v || v === 'single'
}

function highLowFromResult(
  resultValue: string,
  minValue?: string | null,
  maxValue?: string | null
): { flag: '' | 'Low' | 'High' | 'Normal'; label: string } {
  const raw = stripHtml(resultValue)
  if (!raw) return { flag: '', label: '' }
  const val = parseFloat(raw)
  if (Number.isNaN(val)) return { flag: '', label: '' }
  const min = minValue != null && String(minValue).trim() !== '' ? parseFloat(String(minValue)) : NaN
  const max = maxValue != null && String(maxValue).trim() !== '' ? parseFloat(String(maxValue)) : NaN
  if (!Number.isNaN(min) && val < min) return { flag: 'Low', label: 'Low' }
  if (!Number.isNaN(max) && val > max) return { flag: 'High', label: 'High' }
  if (!Number.isNaN(min) || !Number.isNaN(max)) return { flag: 'Normal', label: 'Normal' }
  return { flag: '', label: '' }
}

function ResultFlagIndicator({
  resultValue,
  minValue,
  maxValue,
  statusFlag,
}: {
  resultValue: string
  minValue?: string | null
  maxValue?: string | null
  /** Prefer saved Use Status / result_flag when present. */
  statusFlag?: string | null
}) {
  const stored = (statusFlag || '').trim()
  if (stored) {
    return <StatusFlagBadge flag={stored} />
  }
  const { flag, label } = highLowFromResult(resultValue, minValue, maxValue)
  if (!flag) {
    return <span className="text-[10px] text-slate-300">—</span>
  }
  if (flag === 'Normal') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
        Normal
      </span>
    )
  }
  const isLow = flag === 'Low'
  const Icon = isLow ? ArrowDown : ArrowUp
  const color = isLow ? 'text-amber-700 bg-amber-50' : 'text-orange-700 bg-orange-50'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${color}`}
      title={label}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}

function StatusFlagBadge({ flag }: { flag: string }) {
  const s = flag.trim()
  if (!s) return <span className="text-[10px] text-slate-300">—</span>
  const key = s.toLowerCase()
  let cls = 'bg-slate-50 text-slate-700 border-slate-200'
  if (key === 'normal' || key === 'sufficiency') {
    cls = 'bg-emerald-50 text-emerald-800 border-emerald-200'
  } else if (key === 'low' || key === 'critically low' || key === 'deficiency' || key === 'insuficiency') {
    cls = 'bg-amber-50 text-amber-900 border-amber-200'
  } else if (key === 'high' || key === 'critically high' || key === 'toxicity') {
    cls = 'bg-orange-50 text-orange-800 border-orange-200'
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
      title={s}
    >
      {s}
    </span>
  )
}

const RESULT_ENTERED_STATUSES = new Set([
  'Pending Review',
  'Reviewed',
  'Rejected',
  'Completed',
  'Approved',
])

function labTestLineHasResult(test: LabRequestReviewTest): boolean {
  const status = (test.lab_test_status || '').trim()
  if (RESULT_ENTERED_STATUSES.has(status)) return true
  return stripHtml(String(test.custom_result || '')) !== ''
}

function getGroupResultProgress(group: LabRequestReviewGroup): {
  status: 'Not Started' | 'Partially Complete' | 'Complete'
  done: number
  total: number
} {
  const tests = group.tests || []
  const total = tests.length
  const done = tests.filter(labTestLineHasResult).length
  if (done === 0) return { status: 'Not Started', done, total }
  if (total > 0 && done === total) return { status: 'Complete', done, total }
  return { status: 'Partially Complete', done, total }
}

function ResultTypeCell({ value }: { value: string }) {
  const isMultiple = (value || '').toLowerCase().includes('multiple')
  return (
    <div className="inline-flex items-center gap-3 text-[11px] text-slate-700">
      <label className="inline-flex items-center gap-1.5">
        <span
          className={`h-3.5 w-3.5 rounded-full border ${
            !isMultiple ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white'
          }`}
          aria-hidden
        />
        Single
      </label>
      <label className="inline-flex items-center gap-1.5">
        <span
          className={`h-3.5 w-3.5 rounded-full border ${
            isMultiple ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white'
          }`}
          aria-hidden
        />
        Multiple
      </label>
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  disabled,
  title,
  variant = 'default',
}: {
  children: ReactNode
  onClick: (e: MouseEvent) => void
  disabled?: boolean
  title?: string
  variant?: 'default' | 'primary' | 'sample'
}) {
  const styles =
    variant === 'primary'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
      : variant === 'sample'
        ? 'border-cyan-300 bg-cyan-50 text-cyan-800 hover:bg-cyan-100'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  )
}

function PrintBarcodeBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title="Print barcode"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-slate-400 bg-white px-1.5 text-[10px] font-bold tracking-wide text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      PB
    </button>
  )
}

export function LabRequestReviewModal({
  serviceRequestName,
  onClose,
}: LabRequestReviewModalProps) {
  const formatMoney = useFormatMoney()
  const { userRole, haveMultiresultsOnLabTest } = useCareContext()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<LabRequestReview | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  /** Draft inline results keyed by Lab Test name. */
  const [pendingResults, setPendingResults] = useState<Record<string, string>>({})
  const [savingResultFor, setSavingResultFor] = useState<string | null>(null)

  const [sampleModalLabTest, setSampleModalLabTest] = useState<LabTest | null>(null)
  const [sampleModalGroup, setSampleModalGroup] = useState<{
    children: LabTest[]
    label: string
    serviceRequest: string
    labTestGroup?: string
  } | null>(null)
  const [sampleModalLoading, setSampleModalLoading] = useState(false)
  const [sampleModalError, setSampleModalError] = useState<string | null>(null)
  const [finishingGroup, setFinishingGroup] = useState(false)
  const [enterResultsLabTest, setEnterResultsLabTest] = useState<string | null>(null)
  const [panelRules, setPanelRules] = useState<LabTestResultRulesConfig | null>(null)
  const [groupsPanelCollapsed, setGroupsPanelCollapsed] = useState(false)

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  const requestFinished = isGroupedLabRequestFinished({
    is_group_lab_test: 1,
    service_request_status: review?.service_request_status,
  })

  const isGroupFinished = useCallback(
    (group: LabRequestReviewGroup) => requestFinished || Number(group.finished) === 1,
    [requestFinished]
  )

  const printGroup = useCallback((group: LabRequestReviewGroup) => {
    const firstChild = (group.tests || []).find((t) => t.lab_test)?.lab_test
    if (!firstChild) {
      toast.error('No Lab Test available to print for this group.')
      return
    }
    // "Lab Test Print" expands to every Lab Test on the Service Request (all groups).
    openLabTestResultReportPrint(firstChild)
  }, [])

  const printBarcode = useCallback(() => {
    if (!review?.name) {
      toast.error('Lab Request is not loaded.')
      return
    }
    openLabSampleBarcodePrint(review.name)
  }, [review?.name])

  const handleCompleteGroup = useCallback(
    async (group: LabRequestReviewGroup) => {
      if (!review?.name || !group.template) return
      setFinishingGroup(true)
      try {
        await finishGroupLabTests(review.name, group.template)
        toast.success('Group marked complete')
        reload()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to complete group')
      } finally {
        setFinishingGroup(false)
      }
    },
    [review?.name, reload]
  )

  const patchTestResult = useCallback(
    (
      labTestName: string,
      customResult: string,
      status?: string,
      resultFlag?: string | null,
    ) => {
    setReview((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        groups: prev.groups.map((g) => ({
          ...g,
          tests: g.tests.map((t) =>
            t.lab_test === labTestName
              ? {
                  ...t,
                  custom_result: customResult,
                  ...(status ? { lab_test_status: status } : {}),
                  ...(resultFlag !== undefined ? { result_flag: resultFlag || '' } : {}),
                }
              : t
          ),
        })),
        lab_tests: (prev.lab_tests || []).map((lt) =>
          lt.name === labTestName ? { ...lt, ...(status ? { status } : {}) } : lt
        ),
      }
    })
    setPendingResults((prev) => {
      const next = { ...prev }
      delete next[labTestName]
      return next
    })
  },
  [])

  const rawResultValue = useCallback(
    (test: LabRequestReviewTest) => {
      const name = test.lab_test
      if (!name) return ''
      if (name in pendingResults) return pendingResults[name]
      return stripHtml(String(test.custom_result || ''))
    },
    [pendingResults]
  )

  const applyCalculatedUpdates = useCallback(
    (
      updates?: Array<{
        name: string
        lab_test_name?: string
        custom_result: string
        status?: string
      }>,
    ) => {
      for (const upd of updates || []) {
        if (upd.name && upd.custom_result != null && String(upd.custom_result).trim() !== '') {
          patchTestResult(
            upd.name,
            String(upd.custom_result),
            upd.status || 'Pending Review',
          )
        }
      }
    },
    [patchTestResult]
  )

  const saveInlineResult = useCallback(
    async (test: LabRequestReviewTest) => {
      const name = test.lab_test
      if (!name) return
      const value = rawResultValue(test).trim()
      const original = stripHtml(String(test.custom_result || ''))
      if (value === original) {
        setPendingResults((prev) => {
          const next = { ...prev }
          delete next[name]
          return next
        })
        return
      }
      const stub = {
        name,
        status: test.lab_test_status,
        docstatus: test.lab_test_docstatus ?? 0,
        custom_result: test.custom_result || '',
      } as LabTest
      if (!canEditLabTestResultForRow(stub, userRole)) {
        toast.error('You cannot edit results for this test.')
        return
      }
      setSavingResultFor(name)
      try {
        const groupTests =
          review?.groups?.flatMap((g) => g.tests || []) ||
          []
        const siblingResults = groupTests
          .filter((t) => t.lab_test)
          .map((t) => ({
            name: t.lab_test as string,
            template: t.template || t.test_code,
            lab_test_name: t.test_name,
            custom_result: rawResultValue(t),
          }))
        const saved = await saveAndSubmitLabTest(name, {
          custom_result: value,
          submit: false,
          sibling_results: siblingResults,
        })
        patchTestResult(name, value, saved.status, saved.result_flag)
        applyCalculatedUpdates(saved.calculated_updates)
        showLabTestRuleFeedback(saved)
        toast.success(`Result saved for ${test.test_name || test.test_code}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save result')
      } finally {
        setSavingResultFor(null)
      }
    },
    [rawResultValue, userRole, patchTestResult, applyCalculatedUpdates, review]
  )

  useEffect(() => {
    if (sampleModalLabTest) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, sampleModalLabTest])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchLabRequestReview(serviceRequestName)
      .then((data) => {
        if (cancelled) return
        setReview({ ...data, groups: sortLabRequestReviewGroups(data.groups || []) })
        setPendingResults({})
        setSelectedTemplate((prev) => prev || data.groups[0]?.template || null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load Lab Request')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serviceRequestName, reloadToken])

  const selectedGroup: LabRequestReviewGroup | null = useMemo(() => {
    if (!review?.groups?.length) return null
    return review.groups.find((g) => g.template === selectedTemplate) || review.groups[0]
  }, [review, selectedTemplate])

  const visibleGroups = useMemo(() => {
    if (!review?.groups?.length) return []
    if (!groupsPanelCollapsed) return review.groups
    return selectedGroup ? [selectedGroup] : review.groups
  }, [review?.groups, groupsPanelCollapsed, selectedGroup])

  const toggleGroupsPanel = useCallback(() => {
    setGroupsPanelCollapsed((collapsed) => !collapsed)
  }, [])

  useEffect(() => {
    setGroupsPanelCollapsed(false)
  }, [serviceRequestName])

  useEffect(() => {
    const tpl = selectedGroup?.template
    if (!tpl || !review?.name) {
      setPanelRules(null)
      return
    }
    let cancelled = false
    fetchLabTestResultRules(tpl, review.name)
      .then((rules) => {
        if (!cancelled) setPanelRules(rules)
      })
      .catch(() => {
        if (!cancelled) setPanelRules(null)
      })
    return () => {
      cancelled = true
    }
  }, [review?.name, selectedGroup?.template, reloadToken])

  const allRequestTests = useMemo(
    () => (review?.groups || []).flatMap((group) => group.tests || []),
    [review?.groups],
  )

  useEffect(() => {
    if (!review?.name || loading) return
    let cancelled = false
    recalculatePanelForServiceRequest(review.name)
      .then((res) => {
        if (cancelled) return
        applyCalculatedUpdates(res.calculated_updates)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [review?.name, reloadToken, loading, applyCalculatedUpdates])

  const formulaLines = useMemo(
    () =>
      (panelRules?.rule_lines || []).filter(
        (line) => (line.rule_type || 'Formula') === 'Formula' && (line.formula || '').trim()
      ),
    [panelRules]
  )

  const formulaComputed = useMemo(() => {
    const byKey = new Map<string, string>()
    const tests = allRequestTests
    if (!formulaLines.length || !tests.length) return byKey
    const values: Record<string, number> = {}
    for (const test of tests) {
      if (formulaLines.some((line) => testMatchesLabEvent(test, line.target_event || ''))) continue
      const n = parseLabResultNumber(rawResultValue(test))
      if (n == null) continue
      for (const key of [test.test_name, test.test_code, test.template]) {
        if (key) values[key] = n
      }
    }
    const patientContext = buildPatientFormulaContext(review?.sex, review?.age)
    for (const line of formulaLines) {
      const n = evaluateLabResultFormula(line.formula || '', values, patientContext)
      if (n == null) continue
      const formatted = formatLabResultFormulaValue(n)
      const target = line.target_event || ''
      byKey.set(labResultNameKey(target), formatted)
      const match = tests.find((t) => testMatchesLabEvent(t, target))
      if (match?.template) byKey.set(labResultNameKey(match.template), formatted)
      if (match?.test_name) byKey.set(labResultNameKey(match.test_name), formatted)
    }
    return byKey
  }, [formulaLines, allRequestTests, rawResultValue, review?.sex, review?.age])

  const formulaTargetForTest = useCallback(
    (test: LabRequestReviewTest) =>
      formulaLines.find((line) => testMatchesLabEvent(test, line.target_event || '')),
    [formulaLines]
  )

  const getResultValue = useCallback(
    (test: LabRequestReviewTest) => {
      const name = test.lab_test
      const line = formulaTargetForTest(test)
      const computed =
        formulaComputed.get(labResultNameKey(test.test_name)) ||
        formulaComputed.get(labResultNameKey(test.template)) ||
        formulaComputed.get(labResultNameKey(test.test_code))
      if (line) {
        if (name && name in pendingResults && !line.readonly) return pendingResults[name]
        return computed || stripHtml(String(test.custom_result || ''))
      }
      return rawResultValue(test)
    },
    [pendingResults, formulaTargetForTest, formulaComputed, rawResultValue]
  )

  const hideChildCollectSample = Boolean(review?.remove_collect_sample_button_from_child_test)
  /**
   * Prefer the value that came with this review payload (fresh on every open) over the
   * app-load-time context flag, so ticking Healthcare Settings takes effect immediately.
   */
  const multiResultsEnabled = review?.have_multiresults_on_lab_test ?? haveMultiresultsOnLabTest

  const labTestsByName = useMemo(() => {
    const map = new Map<string, NonNullable<LabRequestReview['lab_tests']>[number]>()
    for (const lt of review?.lab_tests || []) {
      if (lt.name) map.set(lt.name, lt)
    }
    return map
  }, [review])

  const linkedTestsForGroup = useCallback(
    (group: LabRequestReviewGroup): LabTest[] => {
      return (group.tests || [])
        .map((t) => {
          const name = t.lab_test
          if (!name) return null
          const row = labTestsByName.get(name)
          return {
            name,
            template: t.template,
            lab_test_name: t.test_name,
            status: t.lab_test_status || row?.status || '',
            docstatus: t.lab_test_docstatus ?? row?.docstatus ?? 0,
            patient: review?.patient,
            patient_name: review?.patient_name,
            practitioner: review?.practitioner,
            practitioner_name: review?.practitioner_name,
            service_request: serviceRequestName,
            is_group_lab_test: group.kind === 'group' ? 1 : 0,
            lab_test_group: group.kind === 'group' ? group.template : undefined,
          } as LabTest
        })
        .filter(Boolean) as LabTest[]
    },
    [labTestsByName, review, serviceRequestName]
  )

  const groupNeedsSample = useCallback((group: LabRequestReviewGroup) => {
    const tests = group.tests || []
    if (!tests.length) return false
    // Need sample if any linked child is still pre-sample (or has no lab test yet).
    return tests.some((t) => {
      if (!t.lab_test) return true
      return !isLabTestSampleCollectionDone({ status: t.lab_test_status })
    })
  }, [])

  const openSampleForTest = async (test: LabRequestReviewTest) => {
    if (!test.lab_test) {
      toast.error('No Lab Test found for this line yet. Book the request first.')
      return
    }
    setSampleModalError(null)
    setSampleModalLoading(true)
    setSampleModalLabTest({
      name: test.lab_test,
      patient: review?.patient || '',
      status: test.lab_test_status || '',
    } as LabTest)
    try {
      const doc = await fetchLabTest(test.lab_test)
      setSampleModalLabTest(doc)
      setSampleModalGroup(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load lab test'
      setSampleModalError(msg)
      toast.error(msg)
    } finally {
      setSampleModalLoading(false)
    }
  }

  const openGroupSample = async (group: LabRequestReviewGroup) => {
    setSelectedTemplate(group.template)
    const linked = linkedTestsForGroup(group)
    const target =
      linked.find((c) => canRecordAdHocSampleCollection(c) && !isLabTestSampleCollectionDone(c)) ||
      linked.find((c) => canRecordAdHocSampleCollection(c)) ||
      linked[0]
    if (!target) {
      toast.error('No Lab Tests linked to this group yet.')
      return
    }
    setSampleModalError(null)
    setSampleModalLoading(true)
    setSampleModalLabTest({
      name: target.name,
      patient: review?.patient || '',
      status: target.status || '',
    } as LabTest)
    try {
      const doc = await fetchLabTest(target.name)
      setSampleModalLabTest(doc)
      const children = await Promise.all(
        linked.map(async (lt) => {
          try {
            return await fetchLabTest(lt.name)
          } catch {
            return lt
          }
        })
      )
      setSampleModalGroup({
        children: children.length ? children : linked,
        label: group.group_name,
        serviceRequest: serviceRequestName,
        labTestGroup: group.template,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load lab test'
      setSampleModalError(msg)
      toast.error(msg)
    } finally {
      setSampleModalLoading(false)
    }
  }

  const handleEnterResults = (test: LabRequestReviewTest) => {
    if (!test.lab_test) {
      toast.error('No Lab Test found for this line yet.')
      return
    }
    const stub = {
      status: test.lab_test_status,
      docstatus: test.lab_test_docstatus ?? 0,
    }
    if (!isLabTestSampleCollectionDone(stub)) {
      toast.error('Collect the sample first, then enter results.')
      return
    }
    setEnterResultsLabTest(test.lab_test)
  }

  const detailTotal = selectedGroup?.total_price ?? 0
  const detailCount = selectedGroup?.test_count ?? 0

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div className={CREATE_MODAL_OVERLAY} onClick={onClose}>
        <div
          className="my-2 flex h-[min(94dvh,calc(100vh-1rem))] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          data-healthcare-modal
        >
          <div className="flex items-start justify-between gap-3 border-b border-teal-700/20 bg-teal-700 px-4 py-3 text-white sm:px-5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-wide sm:text-lg">Lab Request</h2>
              {review && (
                <p className="mt-0.5 truncate text-xs text-teal-50/90 sm:text-sm">
                  {review.name}
                  {review.patient_name ? ` · ${review.patient_name}` : ''}
                  {review.order_date ? ` · ${formatDashboardDate(review.order_date)}` : ''}
                  {' · New Request'}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {review?.practitioner_name ? (
                <div className="hidden max-w-[14rem] text-right sm:block">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-teal-100/80">
                    Username
                  </p>
                  <p
                    className="truncate text-sm font-medium text-white"
                    title={review.practitioner_name}
                  >
                    {review.practitioner_name}
                  </p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 text-white/90 hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-slate-50 p-3 sm:p-4">
            {loading && (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Loading Lab Request…
              </div>
            )}
            {error && !loading && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {!loading && !error && review && (
              <>
                <div className="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div
                    className={
                      groupsPanelCollapsed
                        ? 'overflow-hidden'
                        : 'max-h-[calc(2rem+3*2.125rem)] overflow-auto'
                    }
                  >
                    <table className="min-w-full text-xs">
                      <thead
                        className="sticky top-0 z-[1] cursor-pointer select-none bg-teal-600 text-left text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-teal-700"
                        onClick={toggleGroupsPanel}
                        title={
                          groupsPanelCollapsed
                            ? 'Show all test groups'
                            : 'Show selected test group only'
                        }
                      >
                        <tr>
                          <th className="px-2.5 py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              {groupsPanelCollapsed ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              )}
                              Test Group Code
                            </span>
                          </th>
                          <th className="px-2.5 py-1.5">
                            Test Group Description
                            {groupsPanelCollapsed && (review.groups.length > 1) ? (
                              <span className="ml-1.5 font-normal normal-case text-teal-100/90">
                                (1 of {review.groups.length})
                              </span>
                            ) : null}
                          </th>
                          <th className="px-2.5 py-1.5 text-right whitespace-nowrap">Tests</th>
                          <th className="px-2.5 py-1.5 text-right whitespace-nowrap">Price</th>
                          <th className="px-2.5 py-1.5 text-right whitespace-nowrap">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleGroups.map((group) => {
                          const active = group.template === selectedGroup?.template
                          const isGroup = Number(group.is_group) === 1 || group.kind === 'group'
                          return (
                            <tr
                              key={group.template}
                              onClick={() => setSelectedTemplate(group.template)}
                              className={`cursor-pointer border-b border-slate-100 ${
                                active ? 'bg-sky-100' : 'hover:bg-slate-50'
                              }`}
                            >
                            <td className="px-2.5 py-1.5 font-medium text-slate-800">
                              {group.group_code}
                            </td>
                            <td className="px-2.5 py-1.5 text-slate-700">
                              <span className="inline-flex items-center gap-2">
                                <span>{group.group_name}</span>
                                {isGroup ? (
                                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">
                                    {group.test_count}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600">
                                {group.test_count}
                              </td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums font-medium text-slate-800">
                                {formatMoney(Number(group.total_price) || 0)}
                              </td>
                              <td className="px-2.5 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  const progress = getGroupResultProgress(group)
                                  const needsSample = groupNeedsSample(group)
                                  const groupFinished = isGroupFinished(group)
                                  const canPrint = groupFinished || !needsSample
                                  const progressClass =
                                    progress.status === 'Complete'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : progress.status === 'Partially Complete'
                                        ? 'bg-sky-50 text-sky-800 border-sky-200'
                                        : 'bg-slate-50 text-slate-600 border-slate-200'

                                  if (!active) {
                                    // Collect Sample stays available on every group row so the
                                    // clicked group is collected — not only the selected one.
                                    if (needsSample && !groupFinished) {
                                      return (
                                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                          <ActionBtn
                                            variant="sample"
                                            title={
                                              isGroup
                                                ? 'Collect sample for this group'
                                                : 'Collect sample'
                                            }
                                            onClick={() =>
                                              isGroup
                                                ? void openGroupSample(group)
                                                : void openSampleForTest(group.tests[0])
                                            }
                                          >
                                            <Droplet className="h-3 w-3" />
                                            Collect Sample
                                          </ActionBtn>
                                          <PrintBarcodeBtn onClick={() => printBarcode()} />
                                        </div>
                                      )
                                    }
                                    // Keep Finished + Print visible on completed groups anytime.
                                    if (!groupFinished && !canPrint) {
                                      return (
                                        <span className="text-[10px] text-slate-400">Select</span>
                                      )
                                    }
                                    return (
                                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                        {groupFinished ? (
                                          <span className="text-[10px] font-medium text-slate-600">
                                            Finished
                                          </span>
                                        ) : (
                                          <span
                                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${progressClass}`}
                                            title="Result progress"
                                          >
                                            {progress.status}
                                            <span className="ml-1 font-normal opacity-80">
                                              ({progress.done}/{progress.total})
                                            </span>
                                          </span>
                                        )}
                                    {canPrint ? (
                                      <>
                                        <button
                                          type="button"
                                          title="Print"
                                          onClick={() => printGroup(group)}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-teal-300 bg-white text-teal-700 hover:bg-teal-50"
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                        </button>
                                        <PrintBarcodeBtn onClick={() => printBarcode()} />
                                      </>
                                    ) : null}
                                      </div>
                                    )
                                  }

                                  return (
                                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                      {!needsSample && !groupFinished && (
                                        <span
                                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${progressClass}`}
                                          title="Result progress"
                                        >
                                          {progress.status}
                                          <span className="ml-1 font-normal opacity-80">
                                            ({progress.done}/{progress.total})
                                          </span>
                                        </span>
                                      )}
                                      {needsSample ? (
                                        <ActionBtn
                                          variant="sample"
                                          title={
                                            isGroup
                                              ? 'Collect sample for this group'
                                              : 'Collect sample'
                                          }
                                          onClick={() =>
                                            isGroup
                                              ? void openGroupSample(group)
                                              : void openSampleForTest(group.tests[0])
                                          }
                                        >
                                          <Droplet className="h-3 w-3" />
                                          Collect Sample
                                        </ActionBtn>
                                      ) : null}
                                      {!needsSample &&
                                      progress.status === 'Complete' &&
                                      !groupFinished ? (
                                        <ActionBtn
                                          variant="primary"
                                          disabled={finishingGroup}
                                          title="Mark this group complete"
                                          onClick={() => void handleCompleteGroup(group)}
                                        >
                                          {finishingGroup ? 'Completing…' : 'Complete'}
                                        </ActionBtn>
                                      ) : null}
                                      {groupFinished ? (
                                        <span className="text-[10px] font-medium text-slate-600">
                                          Finished
                                        </span>
                                      ) : null}
                                      {canPrint ? (
                                        <button
                                          type="button"
                                          title="Print results"
                                          onClick={() => printGroup(group)}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-teal-300 bg-white text-teal-700 hover:bg-teal-50"
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                      <PrintBarcodeBtn onClick={() => printBarcode()} />
                                      {!needsSample &&
                                      progress.status !== 'Complete' &&
                                      !groupFinished ? (
                                        <span className="text-[10px] font-medium text-emerald-700">
                                          Sample done
                                        </span>
                                      ) : null}
                                    </div>
                                  )
                                })()}
                              </td>
                            </tr>
                          )
                        })}
                        {!review.groups.length && (
                          <tr>
                            <td colSpan={5} className="px-2.5 py-5 text-center text-xs text-slate-500">
                              No tests on this Lab Request.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="min-h-0 flex-1 overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 z-[1] bg-teal-600 text-left text-[10px] font-semibold uppercase tracking-wide text-white">
                        <tr>
                          <th className="px-2.5 py-1.5 whitespace-nowrap">Test Code</th>
                          <th className="px-2.5 py-1.5">Test Name</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap bg-emerald-600/90">Price</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap">Lab Result Type</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap">Test Unit</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap">Min.</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap">Max.</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap min-w-[11rem]">Sample / Result</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap">Status</th>
                          <th className="px-2.5 py-1.5 whitespace-nowrap text-right">Flag</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedGroup?.tests || []).map((test) => {
                          const sampleDone = isLabTestSampleCollectionDone({
                            status: test.lab_test_status,
                          })
                          const canSample = !!test.lab_test && canRecordAdHocSampleCollection({
                            status: test.lab_test_status,
                            docstatus: test.lab_test_docstatus ?? 0,
                          })
                          const resultStub = {
                            name: test.lab_test || '',
                            status: test.lab_test_status,
                            docstatus: test.lab_test_docstatus ?? 0,
                            custom_result: test.custom_result || '',
                          } as LabTest
                          const canEditResult =
                            !!test.lab_test &&
                            sampleDone &&
                            canEditLabTestResultForRow(resultStub, userRole)
                          const resultValue = getResultValue(test)
                          const formulaLine = formulaTargetForTest(test)
                          const isFormulaReadonly = Boolean(formulaLine?.readonly)
                          const isSaving = savingResultFor === test.lab_test
                          // Formula targets always show inline (calculated), even if template is Multiple.
                          // Multiple Results entry (button → external modal) is only offered when
                          // Healthcare Settings.have_multiresults_on_lab_test is enabled; otherwise
                          // every test is entered inline like a normal single-result lab test.
                          const singleLine =
                            Boolean(formulaLine) ||
                            isSingleResultType(test.result_type) ||
                            !multiResultsEnabled
                          return (
                            <tr key={test.template} className="border-b border-slate-100">
                              <td className="px-2.5 py-1.5 font-medium text-slate-800">{test.test_code}</td>
                              <td className="px-2.5 py-1.5 text-slate-700">{test.test_name}</td>
                              <td className="px-2.5 py-1.5 bg-emerald-50/80 tabular-nums text-slate-800">
                                {formatMoney(Number(test.price) || 0)}
                                {test.price_included_in_group ? (
                                  <span className="ml-1 text-[9px] text-slate-400">incl.</span>
                                ) : null}
                              </td>
                              <td className="px-2.5 py-1.5">
                                <ResultTypeCell value={test.result_type} />
                              </td>
                              <td className="px-2.5 py-1.5 text-slate-600">{test.uom || '—'}</td>
                              <td className="px-2.5 py-1.5 tabular-nums text-slate-600">
                                {test.min_value ?? '—'}
                              </td>
                              <td className="px-2.5 py-1.5 tabular-nums text-slate-600">
                                {test.max_value ?? '—'}
                              </td>
                              <td className="px-2.5 py-1.5">
                                {!sampleDone ? (
                                  hideChildCollectSample ? (
                                    <span
                                      className="text-[10px] text-slate-400"
                                      title="Collect sample from the group"
                                    >
                                      —
                                    </span>
                                  ) : (
                                  <ActionBtn
                                    variant="sample"
                                    disabled={!test.lab_test || (!canSample && !test.lab_test)}
                                    title={
                                      !test.lab_test
                                        ? 'No Lab Test linked yet'
                                        : canSample
                                          ? 'Collect sample for this test'
                                          : 'Open sample collection'
                                    }
                                    onClick={() => void openSampleForTest(test)}
                                  >
                                    <Droplet className="h-3 w-3" />
                                    Collect Sample
                                  </ActionBtn>
                                  )
                                ) : singleLine ? (
                                  <input
                                    type="text"
                                    data-lab-result-nav={test.lab_test || test.template}
                                    value={resultValue}
                                    disabled={!canEditResult || isSaving || isFormulaReadonly}
                                    placeholder={isFormulaReadonly ? 'Calculated…' : 'Enter result…'}
                                    title={
                                      isFormulaReadonly
                                        ? `Calculated: ${formulaLine?.formula || 'formula'}`
                                        : canEditResult
                                          ? 'Enter result. ↑/↓ move between fields; Enter or leave field to save'
                                          : 'Result locked for this test'
                                    }
                                    onChange={(e) => {
                                      if (isFormulaReadonly) return
                                      const name = test.lab_test
                                      if (!name) return
                                      const v = e.target.value
                                      setPendingResults((prev) => ({ ...prev, [name]: v }))
                                    }}
                                    onBlur={() => {
                                      if (isFormulaReadonly) return
                                      void saveInlineResult(test)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        ;(e.target as HTMLInputElement).blur()
                                        return
                                      }
                                      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                                      // Let caret move inside the value when text is partially selected only if...
                                      // Always navigate rows — result fields are short single values.
                                      e.preventDefault()
                                      const table = (e.currentTarget as HTMLElement).closest('table')
                                      if (!table) return
                                      const inputs = Array.from(
                                        table.querySelectorAll<HTMLInputElement>(
                                          'input[data-lab-result-nav]:not([disabled])',
                                        ),
                                      )
                                      const idx = inputs.indexOf(e.currentTarget as HTMLInputElement)
                                      if (idx < 0) return
                                      const next =
                                        e.key === 'ArrowDown' ? inputs[idx + 1] : inputs[idx - 1]
                                      if (!next) return
                                      next.focus()
                                      next.select()
                                    }}
                                    className="w-full min-w-[7rem] max-w-[12rem] rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                                  />
                                ) : (
                                  <span className="text-[10px] italic text-violet-600">— multiple —</span>
                                )}
                              </td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">
                                {test.lab_test_status ? (
                                  <StatusPill
                                    compact
                                    status={labLineStatusLabel(test.lab_test_status)}
                                    color={labLineStatusColors[test.lab_test_status] || 'default'}
                                  />
                                ) : (
                                  <span className="text-[10px] text-slate-300">—</span>
                                )}
                              </td>
                              <td className="px-2.5 py-1.5 text-right">
                                {singleLine ? (
                                  sampleDone ? (
                                    <ResultFlagIndicator
                                      resultValue={resultValue}
                                      minValue={test.min_value}
                                      maxValue={test.max_value}
                                      statusFlag={test.result_flag}
                                    />
                                  ) : (
                                    <span className="text-[10px] text-slate-300">—</span>
                                  )
                                ) : (
                                  <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                    {sampleDone && test.result_flag ? (
                                      <StatusFlagBadge flag={test.result_flag} />
                                    ) : null}
                                    <ActionBtn
                                      variant="primary"
                                      disabled={!test.lab_test || !sampleDone}
                                      title={
                                        !sampleDone
                                          ? 'Collect sample before entering results'
                                          : 'Enter multiple unit results'
                                      }
                                      onClick={() => handleEnterResults(test)}
                                    >
                                      <FlaskConical className="h-3 w-3" />
                                      Results
                                    </ActionBtn>
                                    {sampleDone && labTestLineHasResult(test) && test.lab_test ? (
                                      <>
                                        <button
                                          type="button"
                                          title="Print results"
                                          onClick={() => {
                                            if (!selectedGroup) return
                                            printGroup(selectedGroup)
                                          }}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-teal-300 bg-white text-teal-700 hover:bg-teal-50"
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                        </button>
                                        <PrintBarcodeBtn onClick={() => printBarcode()} />
                                      </>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        {!selectedGroup?.tests?.length && (
                          <tr>
                            <td colSpan={10} className="px-2.5 py-6 text-center text-xs text-slate-500">
                              Select a test group above.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold tabular-nums text-slate-700">
                      {detailCount}
                    </div>
                    <div className="rounded border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-sm font-semibold tabular-nums text-emerald-900">
                      Total Price&nbsp;&nbsp;{formatMoney(Number(detailTotal) || 0)}
                    </div>
                    <div className="rounded border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs text-teal-900 sm:text-sm">
                      Request total&nbsp;{formatMoney(Number(review.total_price) || 0)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {sampleModalLabTest && (
        <LabTestSampleCollectionModal
          labTest={sampleModalLabTest}
          groupChildren={sampleModalGroup?.children}
          groupLabel={sampleModalGroup?.label}
          groupServiceRequest={sampleModalGroup?.serviceRequest}
          groupLabTestGroup={sampleModalGroup?.labTestGroup}
          loading={sampleModalLoading}
          error={sampleModalError}
          onClose={() => {
            setSampleModalLabTest(null)
            setSampleModalGroup(null)
            setSampleModalError(null)
          }}
          onSaved={async () => {
            setSampleModalLabTest(null)
            setSampleModalGroup(null)
            reload()
            toast.success('Sample collection saved')
          }}
        />
      )}

      {enterResultsLabTest && (
        <LabTestEnterResultsModal
          labTestName={enterResultsLabTest}
          elevated
          onClose={() => setEnterResultsLabTest(null)}
          onSaved={() => {
            setEnterResultsLabTest(null)
            reload()
            toast.success('Results saved')
          }}
        />
      )}
    </>,
    document.body
  )
}
