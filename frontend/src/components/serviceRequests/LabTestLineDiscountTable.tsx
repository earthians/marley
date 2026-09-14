import { useFormatMoney } from '../../hooks/useFormatMoney'
import type { MultiLabPricingLine } from '../../services/serviceRequests'
import {
  computeLineNet,
  defaultLineDiscount,
  type LabLineDiscount,
} from '../../utils/labTestDiscounts'
import { linkComboboxInputClass as inputClass } from '../ui/linkComboboxStyles'

interface LabTestLineDiscountTableProps {
  lines: MultiLabPricingLine[]
  lineDiscounts: Record<string, LabLineDiscount>
  onChange: (template: string, patch: Partial<LabLineDiscount>) => void
  readOnly?: boolean
}

export function LabTestLineDiscountTable({
  lines,
  lineDiscounts,
  onChange,
  readOnly = false,
}: LabTestLineDiscountTableProps) {
  const formatMoney = useFormatMoney()

  if (!lines.length) return null

  return (
      <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <th className="px-3 py-2.5">Test</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5 text-right">Discount</th>
              <th className="px-3 py-2.5 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const d = lineDiscounts[line.template] || defaultLineDiscount()
              // Prefer live input discount so Net updates before pricing refetch.
              const { net, applied } = computeLineNet(line.amount || 0, d)
              // Included-in-group children are covered by the group charge line.
              if (line.price_included_in_group && !(line.amount > 0)) {
                return null
              }
              return (
                <tr
                  key={`${line.template}-${line.billed_from_parent_group || 0}-${line.billing_only || 0}`}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-900">{line.lab_test_name || line.template}</div>
                    {line.parent_group && !line.billed_from_parent_group ? (
                      <div className="text-xs text-slate-500">
                        Group: {line.parent_group_name || line.parent_group}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                    {formatMoney(line.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {readOnly ? (
                      <span className="tabular-nums text-slate-600">{formatMoney(d.discount)}</span>
                    ) : (
                      <input
                        type="number"
                        step={0.01}
                        value={d.discount === 0 ? '' : d.discount}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            onChange(line.template, {
                              discount_type: 'Amount',
                              discount: 0,
                              discount_rate: 0,
                            })
                            return
                          }
                          const n = Number(raw)
                          if (Number.isNaN(n)) return
                          onChange(line.template, {
                            discount_type: 'Amount',
                            discount: n,
                            discount_rate: 0,
                          })
                        }}
                        className={`${inputClass} py-1.5 text-right text-xs tabular-nums`}
                        placeholder="0"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="font-semibold tabular-nums text-emerald-800">{formatMoney(net)}</div>
                    {applied !== 0 ? (
                      <div className="text-xs tabular-nums text-slate-500">
                        {applied > 0 ? '−' : '+'}
                        {formatMoney(Math.abs(applied))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
    </div>
  )
}
