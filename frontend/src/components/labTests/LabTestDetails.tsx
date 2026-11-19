import { Fragment, useState, useEffect } from 'react'
import { ClipboardCheck, Clock, Paperclip, UserCheck } from 'lucide-react'
import { fetchLabTest, type LabTest } from '../../services/labTests'
import { labResultFlag } from './labTestDisplayUtils'
import { resultFlagBadgeClass, simplifyResultFlagLabel } from './labTestReviewUtils'
import { SavedInclusionRows, type TotalInclusionLine } from './multipleResultEntry'
import { StatusPill } from '../ui/StatusPill'
import { LabTestReviewModal } from './LabTestReviewModal'
import { AttachLabTestDocumentModal } from './AttachLabTestDocumentModal'
import { canAttachLabTestDocument } from '../../config/permissions'
import { useCareContext } from '../../providers/CareContextProvider'

const statusColors: Record<string, string> = {
  Reviewed: 'success',
  Rejected: 'danger',
  Completed: 'success',
  Submitted: 'info',
  'Sample collection in progress': 'warning',
  'Sample collected': 'info',
  'Pending Review': 'warning',
  Cancelled: 'default',
  Draft: 'warning',
  Requested: 'info',
}

interface LabTestDetailsProps {
  labTestName: string
  onUpdate?: () => void
}

const Field = ({ label, value }: { label: string; value?: string | null }) => {
  if (value == null || value === '') return null
  return (
    <div>
      <span className="font-medium text-slate-700">{label}:</span>{' '}
      <span className="text-slate-600">{value}</span>
    </div>
  )
}

const SectionTitle = ({ title }: { title: string }) => (
  <h3 className="mb-2 border-b border-slate-100 pb-1 text-sm font-semibold text-slate-700">{title}</h3>
)

const EmeraldSectionTitle = ({ title }: { title: string }) => (
  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-900">
    <ClipboardCheck className="h-4 w-4 text-emerald-600" strokeWidth={2} />
    {title}
  </h3>
)

function stripHtmlToPlainText(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string') return ''
  const s = raw.trim()
  if (!s) return ''
  if (typeof document !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(s, 'text/html')
      const text = doc.body.textContent || ''
      return text.replace(/\s+/g, ' ').trim()
    } catch {
      /* ignore */
    }
  }
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseFollowUpActions(raw: string[] | string | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch {
    return []
  }
}

function hasDoctorReviewData(labTest: LabTest): boolean {
  return Boolean(
    labTest.review_result_indicator ||
    labTest.review_report_type ||
    labTest.doctor_reviewed_datetime ||
    labTest.review_comments ||
    labTest.review_prescription_message ||
    parseFollowUpActions(labTest.review_follow_up_actions).length ||
    labTest.review_follow_up_other
  )
}

function indicatorTone(indicator?: string): string {
  if (!indicator) return 'bg-emerald-100 text-emerald-800 ring-emerald-200/80'
  const lower = indicator.toLowerCase()
  if (lower.includes('abnormal') || lower.includes('positive') && !lower.includes('negative')) {
    return 'bg-amber-100 text-amber-900 ring-amber-200/80'
  }
  if (lower.includes('negative') || lower.includes('normal') || lower.includes('satisfactory')) {
    return 'bg-emerald-100 text-emerald-800 ring-emerald-200/80'
  }
  if (lower.includes('borderline')) {
    return 'bg-yellow-100 text-yellow-900 ring-yellow-200/80'
  }
  return 'bg-slate-100 text-slate-800 ring-slate-200/80'
}

function ResultValueBadge({ value }: { value?: string | null }) {
  const text = (value || '').trim()
  if (!text) return <span className="text-slate-400">—</span>
  const lower = text.toLowerCase()
  const tone =
    lower.includes('positive') && !lower.includes('negative')
      ? 'bg-amber-100 text-amber-900 ring-amber-200'
      : lower.includes('negative') || lower.includes('normal')
        ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
        : 'bg-slate-100 text-slate-800 ring-slate-200'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${tone}`}>
      {text}
    </span>
  )
}

function ResultFlagBadge({ flag }: { flag?: string | null }) {
  const stored = (flag || '').trim()
  if (!stored) return <span className="text-slate-300">—</span>
  const label = simplifyResultFlagLabel(stored) || stored
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${resultFlagBadgeClass(stored)}`}
      title={stored}
    >
      {label}
    </span>
  )
}

export const LabTestDetails = ({ labTestName, onUpdate }: LabTestDetailsProps) => {
  const { userRole } = useCareContext()
  const [labTest, setLabTest] = useState<LabTest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [reviewModal, setReviewModal] = useState<'Reviewed' | 'Rejected' | null>(null)
  // Attachments are NOT behind result editing: reports/scans may arrive before sample
  // collection or after final approval, so this dialog is gated on
  // canAttachLabTestDocument() only (see the Documents section below).
  const [attachDocOpen, setAttachDocOpen] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchLabTest(labTestName)
      setLabTest(data)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch lab test details'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [labTestName])

  const showReviewActions =
    labTest?.status === 'Pending Review' ||
    labTest?.status === 'Submitted' ||
    labTest?.status === 'Completed'

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-emerald-800/70">Loading lab test details…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h3 className="mb-2 font-semibold text-red-800">Error Loading Lab Test</h3>
        <p className="mb-3 text-sm text-red-700">{error.message}</p>
        <button
          type="button"
          onClick={load}
          className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!labTest) {
    return <div className="p-8 text-center text-slate-500">Lab test not found</div>
  }

  const formatDate = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB') : undefined)
  const formatDatetime = (d?: string) => (d ? new Date(d).toLocaleString('en-GB') : undefined)
  const followUps = parseFollowUpActions(labTest.review_follow_up_actions)
  const reviewRecorded = hasDoctorReviewData(labTest)
  const isReviewFinal = labTest.status === 'Reviewed' || labTest.status === 'Rejected'
  // Legacy Oracle imports get submitted_date stamped when the ERPNext record is
  // submitted during the import, so it is not legacy data — don't show it.
  const isLegacyImport = Boolean(Number(labTest.is_legacy_import ?? 0))
  const resultLines = (labTest.lab_test_lines || []).filter(
    (line) => (line.lab_result_value || '').trim() || (line.lab_sub_num || '').trim()
  )
  const hasStructuredResults =
    resultLines.length > 0 ||
    Boolean(labTest.normal_test_items?.length) ||
    Boolean(labTest.sensitivity_test_items?.length) ||
    Boolean(labTest.descriptive_result || labTest.custom_result || labTest.lab_test_comment)
  const documents = Array.isArray(labTest.documents) ? labTest.documents : []
  const canAttachDocument = canAttachLabTestDocument(labTest, userRole)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100/80 bg-gradient-to-r from-emerald-50/60 via-white to-teal-50/40 px-4 py-3 ring-1 ring-emerald-100/50">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800/60">Lab Test</p>
          <h2 className="text-lg font-bold text-emerald-950">{labTest.name}</h2>
          {labTest.lab_test_name && (
            <p className="mt-0.5 text-sm text-emerald-900/70">{labTest.lab_test_name}</p>
          )}
        </div>
        {labTest.status && (
          <StatusPill status={labTest.status} color={statusColors[labTest.status] || 'default'} />
        )}
      </div>

      {/* Results first — primary content */}
      {hasStructuredResults ? (
        <section className="space-y-4 rounded-xl border border-emerald-200/80 bg-white p-4 shadow-sm ring-1 ring-emerald-100/70">
          <EmeraldSectionTitle title="Results" />

          {resultLines.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full table-fixed divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="w-[14%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Panel
                    </th>
                    <th className="w-[24%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Test Name
                    </th>
                    <th className="w-[18%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Test Code
                    </th>
                    <th className="w-[16%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Result
                    </th>
                    <th className="w-[16%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Range
                    </th>
                    <th className="w-[12%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Flag
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {resultLines.map((line, i) => {
                    const panel =
                      (line.group_name || '').trim() || (line.lab_group_num || '').trim() || '—'
                    const testName =
                      (line.lab_sub_template_name || '').trim() ||
                      (line.lab_sub_num || '').trim() ||
                      '—'
                    const testCode = (line.lab_sub_num || '').trim() || '—'
                    const range = (line.normal_range || '').trim() || '—'
                    const flag = labResultFlag(
                      line.lab_result_value,
                      line.range_min,
                      line.range_max,
                      line.normal_range,
                    )
                    return (
                      <tr key={`${line.sr_num || i}-${testCode}`} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2.5 align-top text-slate-700 break-words">{panel}</td>
                        <td className="px-3 py-2.5 align-top font-medium text-slate-900 break-words">
                          {testName}
                        </td>
                        <td className="px-3 py-2.5 align-top font-mono text-xs text-slate-500 break-all">
                          {testCode}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <ResultValueBadge value={line.lab_result_value} />
                        </td>
                        <td className="px-3 py-2.5 align-top whitespace-pre-line text-slate-600">
                          {range}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <ResultFlagBadge flag={flag} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {labTest.custom_speciment_type ? (
            <p className="text-sm text-slate-700">
              <span className="font-medium text-slate-500">Specimen type: </span>
              {labTest.custom_speciment_type}
            </p>
          ) : null}

          {labTest.normal_test_items && labTest.normal_test_items.length > 0 && (
            <div>
              {resultLines.length > 0 ? (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Normal test results
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Test Name
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Result
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Unit
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Normal Range
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {labTest.normal_test_items.map(
                      (
                        item: {
                          lab_test_name?: string
                          lab_test_event?: string
                          result_value?: string
                          result_status?: string
                          lab_test_uom?: string
                          normal_range?: string
                          abnormal?: boolean
                          collection_name?: string
                        },
                        i: number,
                        all: Array<{ collection_name?: string; result_value?: string }>
                      ) => (
                        <Fragment key={i}>
                        {(item.collection_name || '').trim() &&
                        (item.collection_name || '').trim() !==
                          (all[i - 1]?.collection_name || '').trim() ? (
                          <tr className="bg-teal-700 text-white">
                            <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">
                              {item.collection_name}
                            </td>
                          </tr>
                        ) : null}
                        <tr
                          key={i}
                          className={
                            item.result_status === 'Low' || item.result_status === 'Critically Low'
                              ? 'bg-yellow-50'
                              : item.abnormal ||
                                  item.result_status === 'High' ||
                                  item.result_status === 'Critically High'
                                ? 'bg-red-50'
                                : 'hover:bg-slate-50'
                          }
                        >
                          <td className="px-3 py-2.5 font-medium text-slate-900">
                            {item.lab_test_event || item.lab_test_name || '—'}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-medium ${
                              item.result_status === 'Low' || item.result_status === 'Critically Low'
                                ? 'text-yellow-800'
                                : item.abnormal ||
                                    item.result_status === 'High' ||
                                    item.result_status === 'Critically High'
                                  ? 'text-red-700'
                                  : 'text-slate-800'
                            }`}
                          >
                            {item.result_value || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{item.lab_test_uom || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-pre-line text-slate-600">
                            {item.normal_range || '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {item.result_status ? (
                              <span
                                className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                                  item.result_status === 'Low' || item.result_status === 'Critically Low'
                                    ? 'bg-yellow-100 text-yellow-900'
                                    : item.result_status === 'High' ||
                                        item.result_status === 'Critically High'
                                      ? 'bg-red-100 text-red-700'
                                      : item.result_status === 'Normal'
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-slate-100 text-slate-800'
                                }`}
                              >
                                {item.result_status}
                              </span>
                            ) : item.abnormal ? (
                              <span className="inline-flex rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                Abnormal
                              </span>
                            ) : (
                              <span className="inline-flex rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                Normal
                              </span>
                            )}
                          </td>
                        </tr>
                        {(item.collection_name || '').trim() !==
                        (all[i + 1]?.collection_name || '').trim()
                          ? (labTest.total_inclusions || [])
                              .filter(
                                (line) =>
                                  (line.collection || '').trim() === (item.collection_name || '').trim() &&
                                  (line.title || '').trim(),
                              )
                              .map((line) => (
                                <SavedInclusionRows
                                  key={`${item.collection_name}-${line.title}`}
                                  line={line as TotalInclusionLine}
                                  rows={all}
                                  sex={labTest.patient_sex || labTest.gender}
                                  colSpan={5}
                                />
                              ))
                          : null}
                        </Fragment>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {labTest.sensitivity_test_items && labTest.sensitivity_test_items.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Sensitivity
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Antibiotic
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Sensitivity
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {labTest.sensitivity_test_items.map(
                      (item: { antibiotic?: string; antibiotic_sensitivity?: string }, i: number) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-medium text-slate-900">{item.antibiotic}</td>
                          <td className="px-3 py-2.5 text-slate-700">{item.antibiotic_sensitivity}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Prefer structured lines; only show HTML custom_result when no lines */}
          {resultLines.length === 0 && labTest.custom_result ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Custom result
              </p>
              <div
                className="prose prose-sm max-w-none overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-600 [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-slate-800"
                dangerouslySetInnerHTML={{ __html: labTest.custom_result }}
              />
            </div>
          ) : null}

          {labTest.descriptive_result ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Descriptive result
              </p>
              <div
                className="prose prose-sm max-w-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
                dangerouslySetInnerHTML={{ __html: labTest.descriptive_result }}
              />
            </div>
          ) : null}

          {labTest.lab_test_comment ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Lab comments
              </p>
              <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {labTest.lab_test_comment}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Doctor review */}
      {(reviewRecorded || isReviewFinal || labTest.status === 'Pending Review') && (
        <section className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/50 p-4 shadow-sm ring-1 ring-emerald-100/70">
          <EmeraldSectionTitle title="Doctor review" />

          {reviewRecorded ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {labTest.review_report_type && (
                  <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">
                      Report type
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-emerald-950">
                      {labTest.review_report_type}
                    </p>
                  </div>
                )}
                {labTest.review_result_indicator && (
                  <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2 sm:col-span-2 lg:col-span-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">
                      Result indicator
                    </p>
                    <span
                      className={`mt-1.5 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${indicatorTone(labTest.review_result_indicator)}`}
                    >
                      {labTest.review_result_indicator}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="flex items-start gap-2 rounded-lg border border-emerald-100/80 bg-white/60 px-3 py-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <p className="text-xs font-medium text-emerald-800/70">Results entered</p>
                    <p className="font-medium text-emerald-950">
                      {formatDatetime(labTest.results_entered_datetime) || '—'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-emerald-100/80 bg-white/60 px-3 py-2">
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <p className="text-xs font-medium text-emerald-800/70">Reviewed by</p>
                    <p className="font-medium text-emerald-950">
                      {labTest.reviewed_by_name || labTest.reviewed_by || '—'}
                    </p>
                    {labTest.doctor_reviewed_datetime && (
                      <p className="mt-0.5 text-xs text-emerald-800/60">
                        {formatDatetime(labTest.doctor_reviewed_datetime)}
                      </p>
                    )}
                  </div>
                </div>
                {labTest.review_turnaround_hours != null && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-100/80 bg-white/60 px-3 py-2 sm:col-span-2">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div>
                      <p className="text-xs font-medium text-emerald-800/70">Review turnaround</p>
                      <p className="font-medium text-emerald-950">
                        {labTest.review_turnaround_hours} hours
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {followUps.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800/70">
                    Follow-up actions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {followUps.map((action) => (
                      <span
                        key={action}
                        className="inline-flex rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900"
                      >
                        {action}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {labTest.review_follow_up_other?.trim() && (
                <div className="rounded-lg border border-emerald-100 bg-white/70 px-3 py-2">
                  <p className="text-xs font-semibold text-emerald-800/70">Other follow-up</p>
                  <p className="mt-1 text-sm text-emerald-950 whitespace-pre-wrap">
                    {labTest.review_follow_up_other}
                  </p>
                </div>
              )}

              {labTest.review_comments?.trim() && (
                <div className="rounded-lg border border-emerald-100 bg-white/70 px-3 py-2">
                  <p className="text-xs font-semibold text-emerald-800/70">Comments / patient message</p>
                  <p className="mt-1 text-sm text-emerald-950 whitespace-pre-wrap">
                    {labTest.review_comments}
                  </p>
                </div>
              )}

              {labTest.review_prescription_message?.trim() && (
                <div className="rounded-lg border border-emerald-100 bg-white/70 px-3 py-2">
                  <p className="text-xs font-semibold text-emerald-800/70">
                    Message for next prescription
                  </p>
                  <p className="mt-1 text-sm text-emerald-950 whitespace-pre-wrap">
                    {labTest.review_prescription_message}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-emerald-100/80 pt-3">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    labTest.patient_informed_of_report
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {labTest.patient_informed_of_report ? '✓' : '○'} Patient informed
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    labTest.archive_report_on_review
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {labTest.archive_report_on_review ? '✓' : '○'} Archive report
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    labTest.create_task_on_review
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {labTest.create_task_on_review ? '✓' : '○'} Task created
                </span>
              </div>
            </div>
          ) : labTest.status === 'Pending Review' ? (
            <p className="text-sm text-amber-800/90">
              Results are saved and awaiting doctor review. Use the actions below to file the report.
            </p>
          ) : null}

          {showReviewActions && !isReviewFinal && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-emerald-100/80 pt-4">
              <button
                type="button"
                onClick={() => setReviewModal('Reviewed')}
                className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 hover:from-emerald-500 hover:to-teal-500"
              >
                Review result…
              </button>
              <button
                type="button"
                onClick={() => setReviewModal('Rejected')}
                className="rounded-lg border border-red-200/80 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50"
              >
                Reject result…
              </button>
            </div>
          )}
        </section>
      )}

      {/* Secondary details */}
      <section className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Patient & request details
        </h3>
        <div className="grid grid-cols-1 gap-5 text-sm md:grid-cols-2">
          <div>
            <SectionTitle title="Patient Information" />
            <div className="space-y-1">
              <Field label="Patient" value={labTest.patient_name || labTest.patient} />
              <Field label="Patient ID" value={labTest.patient} />
              <Field label="Age" value={labTest.patient_age} />
              <Field label="Gender" value={labTest.patient_sex} />
              <Field label="Email" value={labTest.email} />
              <Field label="Mobile" value={labTest.mobile} />
              <Field label="Report Preference" value={labTest.report_preference} />
              {(labTest.inpatient_admission || labTest.inpatient_record) && (
                <Field
                  label="Inpatient Admission"
                  value={labTest.inpatient_admission || labTest.inpatient_record}
                />
              )}
            </div>
          </div>

          <div>
            <SectionTitle title="Test Information" />
            <div className="space-y-1">
              <Field label="Test Name" value={labTest.lab_test_name} />
              <Field label="Template" value={labTest.template} />
              <Field label="Department" value={labTest.department} />
              <Field label="Service Unit" value={labTest.service_unit} />
              <Field label="Company" value={labTest.company} />
              <Field label="Is Outsourced" value={labTest.is_outsourced ? 'Yes' : undefined} />
            </div>
          </div>

          <div>
            <SectionTitle title="Requesting Details" />
            <div className="space-y-1">
              <Field label="Doctor Name" value={labTest.practitioner_name || labTest.practitioner} />
              <Field label="Requesting Department" value={labTest.requesting_department} />
              <Field label="Service Request" value={labTest.service_request} />
              <Field label="Reference" value={labTest.reference_document} />
            </div>
          </div>

          <div>
            <SectionTitle title="Lab Technician" />
            <div className="space-y-1">
              <Field
                label="Doctor Name"
                value={labTest.lab_technician_name || labTest.lab_technician}
              />
              <Field label="Employee (legacy)" value={labTest.employee_name || labTest.employee} />
              <Field label="Designation" value={labTest.employee_designation} />
            </div>
          </div>

          <div>
            <SectionTitle title="Dates & Timeline" />
            <div className="space-y-1">
              <Field label="Test Date" value={formatDate(labTest.date)} />
              {!isLegacyImport && (
                <Field label="Submitted" value={formatDatetime(labTest.submitted_date)} />
              )}
              <Field label="Result Date" value={formatDate(labTest.result_date)} />
              <Field label="Expected Result" value={formatDate(labTest.expected_result_date)} />
              <Field label="Printed On" value={formatDatetime(labTest.printed_on)} />
            </div>
          </div>

          <div>
            <SectionTitle title="Flags" />
            <div className="space-y-1">
              <Field label="Invoiced" value={labTest.invoiced ? 'Yes' : 'No'} />
              <Field label="Email Sent" value={labTest.email_sent ? 'Yes' : 'No'} />
              <Field label="SMS Sent" value={labTest.sms_sent ? 'Yes' : 'No'} />
              <Field label="Printed" value={labTest.printed ? 'Yes' : 'No'} />
              {labTest.amended_from && <Field label="Amended From" value={labTest.amended_from} />}
              {labTest.sample && <Field label="Sample ID" value={labTest.sample} />}
            </div>
          </div>
        </div>
      </section>

      {labTest.sample_instances && labTest.sample_instances.length > 0 && (
        <div>
          <SectionTitle title="Sample Collection" />
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Sample</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Qty</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Details</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Sample Collection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {labTest.sample_instances.map((row, idx) => (
                  <tr key={idx} className="bg-white">
                    <td className="px-3 py-2 text-slate-800">{row.sample || '-'}</td>
                    <td className="px-3 py-2 text-slate-800">{row.sample_qty ?? '-'}</td>
                    <td className="max-w-md px-3 py-2 align-top text-slate-700">
                      {row.sample_details ? (
                        <span className="block text-[13px] leading-snug" title={stripHtmlToPlainText(row.sample_details)}>
                          {stripHtmlToPlainText(row.sample_details)}
                        </span>
                      ) : (
                        <span className="italic text-slate-400">No details</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-800">
                      {row.sample_collection ? (
                        <a
                          href={`/app/sample-collection/${encodeURIComponent(row.sample_collection)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {row.sample_collection}
                        </a>
                      ) : (
                        <span className="italic text-slate-400">Not collected</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {labTest.remarks &&
        Array.isArray(labTest.remarks) &&
        labTest.remarks.length > 0 &&
        labTest.remarks.some((r: { rrmark?: string }) => (r.rrmark || '').trim()) && (
          <div className="space-y-2">
            <SectionTitle title="Doctor's Remarks" />
            <div className="space-y-2">
              {labTest.remarks.map((row: { rrmark?: string }, i: number) => {
                const text = (row.rrmark || '').trim()
                if (!text) return null
                return (
                  <div key={i} className="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
                    <p className="whitespace-pre-wrap text-sm text-slate-800">{text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      {(documents.length > 0 || canAttachDocument) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              Documents
              {documents.length > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {documents.length}
                </span>
              )}
            </h3>
            {canAttachDocument && (
              <button
                type="button"
                onClick={() => setAttachDocOpen(true)}
                title="Attach a report or scan to this lab test"
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-white px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Attach document
              </button>
            )}
          </div>
          {documents.length === 0 ? (
            <p className="text-xs italic text-slate-400">No documents attached yet.</p>
          ) : (
            <div className="space-y-2">
              {documents.map(
                (
                  doc: {
                    file_name?: string
                    document_type?: string
                    transaction_no?: string
                    upload_remarks?: string
                    document?: string
                  },
                  i: number
                ) => {
                  const docUrl = doc.document
                  const label = doc.file_name || doc.document_type || 'Document'
                  const base = typeof window !== 'undefined' ? window.location.origin : ''
                  const href = docUrl && (docUrl.startsWith('http') ? docUrl : `${base}${docUrl}`)
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">{label}</div>
                        {(doc.document_type || doc.transaction_no) && (
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                            {doc.document_type && <span>Type: {doc.document_type}</span>}
                            {doc.transaction_no && <span>Txn: {doc.transaction_no}</span>}
                          </div>
                        )}
                      </div>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center rounded-md border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
                        >
                          Open
                        </a>
                      )}
                    </div>
                  )
                }
              )}
            </div>
          )}
        </div>
      )}

      {attachDocOpen && (
        <AttachLabTestDocumentModal
          labTestName={labTestName}
          labTestLabel={labTest.lab_test_name || undefined}
          onClose={() => setAttachDocOpen(false)}
          onAttached={async () => {
            setAttachDocOpen(false)
            await load()
            onUpdate?.()
          }}
        />
      )}

      {reviewModal && (
        <LabTestReviewModal
          labTestName={labTestName}
          initialOutcome={reviewModal}
          onClose={() => setReviewModal(null)}
          onSuccess={async () => {
            setReviewModal(null)
            await load()
            onUpdate?.()
          }}
        />
      )}
    </div>
  )
}
