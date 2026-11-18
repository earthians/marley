// services/nursingInventory.ts

import type { WarehouseContext } from '../components/nursingInventory/MiniWarehouseInventoryContext'
import { apiRequest } from './apiClient'

function withWarehouseContext(url: string, warehouseContext: WarehouseContext = 'nurse'): string {
  if (warehouseContext === 'nurse') return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}warehouse_context=${encodeURIComponent(warehouseContext)}`
}

export interface StockLedgerItem {
  item_code: string
  item_name: string
  category?: string
  item_group?: string
  current_stock: number
  actual_qty?: number
  reorder_level: number
  uom?: string
  unit_price: number
  valuation_rate?: number
  last_updated: string
  /** Mini warehouse used for this Stock Ledger row (branch nurse/lab warehouse) */
  warehouse?: string
  /** Qty in Pack UOM (when configured on the item) */
  pack_qty?: number | null
  pack_uom?: string | null
  /** Qty in Unit UOM — same UOM used when dispensing medicine */
  unit_qty?: number | null
  unit_uom?: string | null
  units_per_pack?: number | null
  /** 1 when the item's Item Group (or an ancestor) has Tracked By NHRA */
  tracked_by_nhra?: number
}

export interface MaterialRequestItem {
  item_code: string
  item_name: string
  quantity: number
  uom: string
  notes?: string
}

export type MaterialRequestPurpose =
  | 'Purchase'
  | 'Material Transfer'
  | 'Material Issue'
  | 'Manufacture'
  | 'Customer Provided'
  | 'Subcontracting'

export interface MaterialRequest {
  name: string
  cost_center: string
  warehouse?: string
  /** Target / final warehouse (ERPNext set_warehouse) */
  set_warehouse?: string
  /** Source warehouse when purpose is Material Transfer */
  set_from_warehouse?: string
  material_request_type?: MaterialRequestPurpose | string
  request_date: string
  /** ERPNext fulfillment status: Pending / Ordered / Transferred / … */
  status: string
  /** Workflow approval state when a Material Request workflow is active */
  workflow_state?: string | null
  items: MaterialRequestItem[]
  requested_by: string
  approved_by?: string
  notes?: string
  /** 1 = Medical, 0 = Consumable → Material Request.custom_is_medical */
  is_medical?: 0 | 1
}

export interface StockReconciliation {
  name: string
  cost_center: string
  warehouse?: string
  reconciliation_date: string
  notes?: string
  items: {
    item_code: string
    item_name: string
    system_quantity: number
    physical_quantity: number
    difference: number
    notes?: string
  }[]
  status: 'Draft' | 'Completed'
  reconciled_by: string
}

export interface MaterialReceipt {
  name: string
  cost_center: string
  warehouse?: string
  receipt_date: string
  notes?: string
  supplier?: string
  invoice_number?: string
  items: {
    item_code: string
    item_name: string
    quantity: number
    unit_price: number
    total_price: number
    batch_number?: string
    expiry_date?: string
  }[]
  total_amount: number
  received_by: string
  status: 'Draft' | 'Completed'
}

export interface StockTransferItem {
  item_code: string
  item_name: string
  quantity: number
  uom?: string
  batch_number?: string
  dispensing_lot?: string
}

export interface StockTransfer {
  name: string
  transfer_date: string
  from_warehouse: string
  to_warehouse: string
  total_amount?: number
  transferred_by: string
  notes?: string
  items: StockTransferItem[]
}

export interface MaterialIssueItem {
  item_code: string
  item_name: string
  quantity: number
  uom?: string
  batch_number?: string
  dispensing_lot?: string
}

export interface MaterialIssue {
  name: string
  issue_date: string
  from_warehouse: string
  total_amount?: number
  issued_by: string
  notes?: string
  items: MaterialIssueItem[]
}

// Fetch stock ledger for a branch
export async function fetchStockLedger(
  costCenter: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<StockLedgerItem[]> {
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_stock_ledger?cost_center=${encodeURIComponent(costCenter)}`,
      warehouseContext
    )
  )
  const data = await response.json()
  return data.message || []
}

export interface StockLedgerExportRow {
  item_code: string
  item_name: string
  item_group?: string
  /** Total qty in units (dispense UOM) when available */
  qty: number
  uom?: string
  pack_qty?: number | null
  pack_uom?: string
  unit_qty?: number | null
  unit_uom?: string
  units_per_pack?: number | null
  stock_qty?: number | null
  stock_uom?: string
  reorder_level?: number
  unit_price?: number
  warehouse?: string
}

export async function fetchStockLedgerExport(
  costCenter: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<{ warehouse: string; rows: StockLedgerExportRow[] }> {
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_stock_ledger_export?cost_center=${encodeURIComponent(costCenter)}`,
      warehouseContext
    )
  )
  const data = await response.json()
  if (data?.exc) {
    throw new Error(typeof data.exc === 'string' ? data.exc : 'Failed to load stock export')
  }
  const message = data?.message || {}
  return {
    warehouse: message.warehouse || '',
    rows: Array.isArray(message.rows) ? message.rows : [],
  }
}

// Fetch item groups for filtering
export async function fetchItemGroups(
  search?: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<{ name: string; label: string }[]> {
  let url = withWarehouseContext('/api/method/healthcare.api.nursing_inventory.get_item_groups', warehouseContext)
  if (search) url += `${url.includes('?') ? '&' : '?'}search=${encodeURIComponent(search)}`
  const response = await fetch(url)
  const data = await response.json()
  return data.message || []
}

// Create material request
export async function createMaterialRequest(
  data: Omit<MaterialRequest, 'name' | 'status'> & { warehouse_context?: WarehouseContext; status?: string }
): Promise<{ name: string; status?: string }> {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.create_material_request', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// Fetch material requests for a branch
export async function fetchMaterialRequests(
  costCenter: string,
  status?: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<MaterialRequest[]> {
  let url = withWarehouseContext(
    `/api/method/healthcare.api.nursing_inventory.get_material_requests?cost_center=${encodeURIComponent(costCenter)}`,
    warehouseContext
  )
  if (status) url += `&status=${status}`
  const response = await fetch(url)
  const data = await response.json()

  console.log("Fetched material requests:", data.message)
  return data.message || []
}

// Create stock reconciliation
export async function createStockReconciliation(
  data: Omit<StockReconciliation, 'name'> & { warehouse_context?: WarehouseContext; custom_notes?: string }
): Promise<{ name: string }> {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.create_stock_reconciliation', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// Fetch stock reconciliations
export async function getStockReconciliations(
  costCenter: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<StockReconciliation[]> {
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_stock_reconciliations?cost_center=${encodeURIComponent(costCenter)}`,
      warehouseContext
    )
  )
  const data = await response.json()
  return data.message || []
}

// Create material receipt
export async function createMaterialReceipt(
  data: Omit<MaterialReceipt, 'name'> & { warehouse_context?: WarehouseContext; custom_notes?: string }
): Promise<{ name: string }> {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.create_material_receipt', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function fetchSuppliers(search?: string): Promise<{ name: string; label: string }[]> {
  let url = '/api/method/healthcare.api.nursing_inventory.get_suppliers'
  if (search) url += `?search=${encodeURIComponent(search)}`
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch suppliers')
  return data.message || []
}

// Fetch items for dropdown
export async function fetchInventoryItems(
  search?: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<{ code: string; name: string; uom: string; price: number }[]> {
  let url = withWarehouseContext('/api/method/healthcare.api.nursing_inventory.get_inventory_items', warehouseContext)
  if (search) url += `${url.includes('?') ? '&' : '?'}search=${encodeURIComponent(search)}`
  const response = await fetch(url)
  const data = await response.json()
  return data.message || []
}

export async function fetchItemUomOptions(itemCode: string): Promise<{ name: string; label: string }[]> {
  const response = await fetch(
    `/api/method/healthcare.api.nursing_inventory.get_item_uom_options?item_code=${encodeURIComponent(itemCode)}`
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch item units')
  return data.message || []
}

// Fetch branches for the user
export async function fetchUserCostCenters(): Promise<{ name: string; label: string }[]> {
  const response = await fetch('/api/method/healthcare.api.nursing_inventory.get_user_cost_centers')
  const data = await response.json()
  return data.message || []
}

// Add to services/nursingInventory.ts

export async function getWarehousesForCostCenter(
  costCenter: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<{ name: string; label: string }[]> {
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_warehouses_for_cost_center?cost_center=${encodeURIComponent(costCenter)}`,
      warehouseContext
    )
  )
  const data = await response.json()
  return data.message || []
}


export async function getAllCostCenters(
  warehouseContext: WarehouseContext = 'nurse'
): Promise<{ name: string; label: string }[]> {
  const response = await fetch(
    withWarehouseContext('/api/method/healthcare.api.nursing_inventory.get_all_cost_centers', warehouseContext)
  )
  const data = await response.json()
  console.log("Cost centers:", data.message)
  return data.message || []
}

export async function fetchMaterialReceipts(
  costCenter: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<MaterialReceipt[]> {
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_material_receipts?cost_center=${encodeURIComponent(costCenter)}`,
      warehouseContext
    )
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch material receipts')
  return data.message || []
}

export async function getItemBatches(itemCode: string, warehouse: string) {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.get_item_batches', {
    method: 'POST',
    body: JSON.stringify({ item_code: itemCode, warehouse }),
  })
}

export async function getItemSerials(itemCode: string, warehouse: string) {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.get_item_serials', {
    method: 'POST',
    body: JSON.stringify({ item_code: itemCode, warehouse }),
  })
}

export async function getBatchSerials(batchNo: string, warehouse: string) {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.get_batch_details_with_serials', {
    method: 'POST',
    body: JSON.stringify({ batch_no: batchNo, warehouse }),
  })
}

export async function fetchStockTransferDestinations(
  costCenter: string,
  sourceWarehouse?: string,
  search?: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<{ name: string; label: string }[]> {
  const params = new URLSearchParams()
  params.append('cost_center', costCenter)
  if (sourceWarehouse) params.append('source_warehouse', sourceWarehouse)
  if (search) params.append('search', search)
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_stock_transfer_destination_warehouses?${params.toString()}`,
      warehouseContext
    )
  )
  const data = await response.json()
  if (data?.exc_type) {
    throw new Error(
      typeof data.message === 'string' ? data.message : 'Failed to load destination warehouses'
    )
  }
  return data.message || []
}

export interface StockTransferWarehouseOptions {
  source_warehouses: { name: string; label: string }[]
  default_source?: string
  destination_warehouses: { name: string; label: string }[]
}

export async function fetchStockTransferWarehouseOptions(
  costCenter: string,
  sourceWarehouse?: string,
  search?: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<StockTransferWarehouseOptions> {
  const params = new URLSearchParams()
  params.append('cost_center', costCenter)
  if (sourceWarehouse) params.append('source_warehouse', sourceWarehouse)
  if (search) params.append('search', search)
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_stock_transfer_warehouse_options?${params.toString()}`,
      warehouseContext
    )
  )
  const data = await response.json()
  if (data?.exc_type) {
    throw new Error(
      typeof data.message === 'string' ? data.message : 'Failed to load transfer warehouses'
    )
  }
  return (data.message || {
    source_warehouses: [],
    destination_warehouses: [],
  }) as StockTransferWarehouseOptions
}

export async function createStockTransfer(data: {
  cost_center: string
  from_warehouse?: string
  to_warehouse: string
  /** Stock Entry purpose / type (default Material Transfer) */
  purpose?: string
  transfer_date?: string
  items: StockTransferItem[]
  notes?: string
  warehouse_context?: WarehouseContext
}): Promise<{ name: string }> {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.create_stock_transfer', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function fetchStockTransfers(
  costCenter: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<StockTransfer[]> {
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_stock_transfers?cost_center=${encodeURIComponent(costCenter)}`,
      warehouseContext
    )
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch stock transfers')
  return data.message || []
}

export async function createMaterialIssue(data: {
  cost_center: string
  from_warehouse?: string
  issue_date?: string
  items: MaterialIssueItem[]
  notes?: string
  warehouse_context?: WarehouseContext
}): Promise<{ name: string }> {
  return apiRequest('/api/method/healthcare.api.nursing_inventory.create_material_issue', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function fetchMaterialIssues(
  costCenter: string,
  warehouseContext: WarehouseContext = 'nurse'
): Promise<MaterialIssue[]> {
  const response = await fetch(
    withWarehouseContext(
      `/api/method/healthcare.api.nursing_inventory.get_material_issues?cost_center=${encodeURIComponent(costCenter)}`,
      warehouseContext
    )
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to fetch material issues')
  return data.message || []
}