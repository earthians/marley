import { Fragment, useMemo } from 'react'
import type { LabTest } from '../../services/labTests'
import { StatusPill } from '../ui/StatusPill'
import { stripHtmlToText } from '../ui/dashboardCardListing'
import {
  displayResultFlag,
  labTestResultPreview,
  resultFlagBadgeClass,
} from './labTestReviewUtils'

const statusColors: Record<string, string> = {
  Draft: 'default',
  'Pending Review': 'warning',
  Reviewed: 'success',
  Rejected: 'danger',
  Submitted: 'info',
  Completed: 'success',
}

type NestedResultRow = {
  key: string
  name: string
  value: string
  flag?: string
  range?: string
}

function nestedRowsForTest(test: LabTest): NestedResultRow[] {
  const items = test.normal_test_items || []
  if (items.length > 0) {
    const rows = items
      .map((item, i) => ({
        key: `${test.name}-n-${i}`,
        name: (item.lab_test_event || item.lab_test_name || '').trim() || '—',
        value: (item.result_value || '').trim() || '—',
        flag: (item.result_status || '').trim(),
        range: (item.normal_range || '').trim(),
      }))
      .filter((row) => row.value !== '—' || row.name !== '—')
    if (rows.length > 1 || (rows.length === 1 && rows[0].value !== '—')) {
      return rows
    }
  }

  const lines = (test.lab_test_lines || []).filter(
    (line) => (line.lab_result_value || '').trim() || (line.lab_sub_num || '').trim()
  )
  if (lines.length > 0) {
    return lines.map((line, i) => ({
      key: `${test.name}-l-${line.sr_num || i}`,
      name:
        (line.lab_sub_template_name || '').trim() ||
        (line.lab_sub_num || '').trim() ||
        (line.group_name || '').trim() ||
        '—',
      value: (line.lab_result_value || '').trim() || '—',
      range: (line.normal_range || '').trim(),
    }))
  }

  return []
}

function flatResultForTest(test: LabTest): string {
  const items = test.normal_test_items || []
  if (items.length === 1) {
    const value = (items[0].result_value || '').trim()
    if (value) return value
  }

  const lines = (test.lab_test_lines || []).filter((line) => (line.lab_result_value || '').trim())
  if (lines.length === 1) {
    const value = (lines[0].lab_result_value || '').trim()
    if (value) return value
  }

  if (typeof test.custom_result === 'string' && test.custom_result.includes('<')) {
    return stripHtmlToText(test.custom_result)
  }

  const preview = labTestResultPreview(test)
  return preview === '—' ? '' : preview
}

function FlagBadge({ flag }: { flag?: string | null }) {
  const label = displayResultFlag({ result_flag: flag } as LabTest) || (flag || '').trim()
  if (!label) return <span className="text-slate-300">—</span>
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${resultFlagBadgeClass(
        flag || label
      )}`}
    >
      {label}
    </span>
  )
}

/** Results table for doctor review — always expanded so values are visible first. */
export function LabTestReviewResultsPanel({ tests }: { tests: LabTest[] }) {
  const rows = useMemo(
    () =>
      tests.map((test) => ({
        test,
        nested: nestedRowsForTest(test),
        flat: flatResultForTest(test),
      })),
    [tests]
  )

  if (!rows.length) return null

  const title =
    rows.length === 1
      ? 'Results'
      : `Results · ${rows.length} test${rows.length === 1 ? '' : 's'}`

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-200/80 bg-white/80 shadow-sm">
      <div className="border-b border-emerald-100 px-4 py-2.5">
        <span className="text-sm font-semibold text-emerald-950">{title}</span>
      </div>

      <div className="max-h-[min(50vh,28rem)] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-emerald-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Test</th>
              <th className="px-3 py-2 text-left">Result</th>
              <th className="px-3 py-2 text-left">Flag</th>
              {rows.length > 1 ? <th className="px-3 py-2 text-left">Status</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ test, nested, flat }) => {
              const label = test.lab_test_name || test.template || test.name
              if (nested.length > 1) {
                return (
                  <Fragment key={test.name}>
                    <tr className="bg-emerald-50/40">
                      <td
                        className="px-3 py-2 font-semibold text-slate-800"
                        colSpan={rows.length > 1 ? 3 : 2}
                      >
                        {label}
                        <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                          {nested.length} values
                        </span>
                      </td>
                      {rows.length > 1 ? (
                        <td className="px-3 py-2">
                          <StatusPill
                            status={test.status || 'Draft'}
                            color={statusColors[test.status || 'Draft'] || 'default'}
                          />
                        </td>
                      ) : null}
                    </tr>
                    {nested.map((row) => (
                      <tr key={row.key}>
                        <td className="px-3 py-1.5 pl-6 text-slate-600">{row.name}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">
                          {row.value}
                          {row.range ? (
                            <span className="ml-2 text-xs font-normal text-slate-400">{row.range}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5">
                          <FlagBadge flag={row.flag || test.result_flag} />
                        </td>
                        {rows.length > 1 ? <td className="px-3 py-1.5" /> : null}
                      </tr>
                    ))}
                  </Fragment>
                )
              }

              const value = nested.length === 1 ? nested[0].value : flat
              const range = nested.length === 1 ? nested[0].range : ''
              const flag = nested.length === 1 ? nested[0].flag || test.result_flag : test.result_flag
              return (
                <tr key={test.name} className="align-top">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {nested.length === 1 && nested[0].name !== '—' && nested[0].name !== label
                      ? `${label} · ${nested[0].name}`
                      : label}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {value ? (
                      <span className="whitespace-pre-wrap">
                        {value}
                        {range ? (
                          <span className="ml-2 text-xs font-normal text-slate-400">{range}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <FlagBadge flag={flag} />
                  </td>
                  {rows.length > 1 ? (
                    <td className="px-3 py-2">
                      <StatusPill
                        status={test.status || 'Draft'}
                        color={statusColors[test.status || 'Draft'] || 'default'}
                      />
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
