import type { LabRequestItem } from '../services/serviceRequests'

export type DiscountType = 'Amount'

export interface LabLineDiscount {
  discount_type: DiscountType
  discount_rate: number
  discount: number
}

export const defaultLineDiscount = (): LabLineDiscount => ({
  discount_type: 'Amount',
  discount_rate: 0,
  discount: 0,
})

export function computeLineNet(
  amount: number,
  d: LabLineDiscount
): { net: number; applied: number } {
  const gross = amount || 0
  // Negative discount is allowed (surcharge / markup).
  const applied = d.discount || 0
  return { net: gross - applied, applied }
}

export function mergeDiscountsIntoBasket(
  items: LabRequestItem[],
  lineDiscounts: Record<string, LabLineDiscount>
): LabRequestItem[] {
  return items.map((item) => {
    if (item.kind === 'single') {
      const d = lineDiscounts[item.template]
      if (!d || Number(d.discount) === 0) {
        const { discount: _d, discount_rate: _r, discount_type: _t, ...rest } = item
        return rest as LabRequestItem
      }
      return {
        ...item,
        discount_type: 'Amount',
        discount_rate: 0,
        discount: d.discount,
      }
    }
    // Group charge lines bill on the parent template; child discounts are separate.
    const child_discounts: Record<string, LabLineDiscount> = {}
    for (const tpl of item.children) {
      const d = lineDiscounts[tpl]
      if (d && Number(d.discount) !== 0) {
        child_discounts[tpl] = {
          discount_type: 'Amount',
          discount_rate: 0,
          discount: d.discount,
        }
      }
    }
    const parentD = lineDiscounts[item.parent]
    const hasParentDisc = Boolean(parentD && Number(parentD.discount) !== 0)
    const next: LabRequestItem = {
      kind: 'group',
      parent: item.parent,
      children: [...item.children],
    }
    if (Object.keys(child_discounts).length) {
      next.child_discounts = child_discounts
    }
    if (hasParentDisc && parentD) {
      next.discount_type = 'Amount'
      next.discount_rate = 0
      next.discount = parentD.discount
    }
    return next
  })
}

export function extractLineDiscountsFromBasket(
  items: LabRequestItem[]
): Record<string, LabLineDiscount> {
  const out: Record<string, LabLineDiscount> = {}
  for (const item of items) {
    if (item.kind === 'single') {
      out[item.template] = {
        discount_type: 'Amount',
        discount_rate: 0,
        discount: item.discount || 0,
      }
    } else if (item.kind === 'group') {
      out[item.parent] = {
        discount_type: 'Amount',
        discount_rate: 0,
        discount: item.discount || 0,
      }
      for (const tpl of item.children) {
        const d = item.child_discounts?.[tpl]
        out[tpl] = d
          ? {
              discount_type: 'Amount',
              discount_rate: 0,
              discount: d.discount || 0,
            }
          : defaultLineDiscount()
      }
    }
  }
  return out
}

export function parseLabRequestItems(raw: unknown): LabRequestItem[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as LabRequestItem[]) : []
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? (raw as LabRequestItem[]) : []
}

/** Strip UI-only labels before saving lab_request_items JSON. */
export function serializeLabRequestItemsForSave(items: LabRequestItem[]): LabRequestItem[] {
  return items.map((item) => {
    if (item.kind === 'single') {
      const row: LabRequestItem = { kind: 'single', template: item.template }
      if (item.discount_type) row.discount_type = item.discount_type
      if (item.discount_rate != null) row.discount_rate = item.discount_rate
      if (item.discount != null) row.discount = item.discount
      return row
    }
    const row: LabRequestItem = {
      kind: 'group',
      parent: item.parent,
      children: [...item.children],
    }
    if (item.discount_type) row.discount_type = item.discount_type
    if (item.discount_rate != null) row.discount_rate = item.discount_rate
    if (item.discount != null) row.discount = item.discount
    if (item.child_discounts && Object.keys(item.child_discounts).length) {
      row.child_discounts = { ...item.child_discounts }
    }
    return row
  })
}
