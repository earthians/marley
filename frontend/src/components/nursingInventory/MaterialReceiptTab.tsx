// tabs/MaterialReceiptTab.tsx
import { useState, useEffect, useMemo } from 'react'
import { useCareContext } from '../../providers/CareContextProvider'
import { fetchMaterialReceipts, type MaterialReceipt } from '../../services/nursingInventory'
import { useMiniWarehouseContext } from './MiniWarehouseInventoryContext'
import {
  FilterToggleButton,
  InventoryFilterBar,
  FilterSearchInput,
  FilterDateField,
  FilterSelectField,
  collectUniqueStrings,
  matchesAnyItemQuery,
  matchesDateRange,
  matchesTextQuery,
} from './InventoryListFilters'
import { Eye, Package, CheckCircle } from 'lucide-react'

interface MaterialReceiptTabProps {
  onSuccess: () => void
  refreshKey?: number
  costCenter?: string
  isFullAccess?: boolean
}

export const MaterialReceiptTab = ({
  onSuccess: _onSuccess,
  refreshKey: _refreshKey,
  costCenter: _costCenter,
  isFullAccess: _isFullAccess,
}: MaterialReceiptTabProps) => {
  const warehouseContext = useMiniWarehouseContext()
  const { userCostCenter } = useCareContext()
  const effectiveCostCenter = _costCenter || userCostCenter
  const [receipts, setReceipts] = useState<MaterialReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<MaterialReceipt | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterItem, setFilterItem] = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')

  const supplierOptions = useMemo(
    () => collectUniqueStrings(receipts.map((receipt) => receipt.supplier)),
    [receipts],
  )

  const warehouseOptions = useMemo(
    () => collectUniqueStrings(receipts.map((receipt) => receipt.warehouse)),
    [receipts],
  )

  const filteredReceipts = useMemo(() => {
    return receipts.filter((receipt) => {
      const matchesSearch =
        matchesTextQuery(receipt.name, filterSearch) ||
        matchesTextQuery(receipt.invoice_number, filterSearch) ||
        matchesTextQuery(receipt.received_by, filterSearch)
      const matchesDate = matchesDateRange(receipt.receipt_date, filterDateFrom, filterDateTo)
      const matchesItem = matchesAnyItemQuery(receipt.items, filterItem)
      const matchesSupplier = !filterSupplier || receipt.supplier === filterSupplier
      const matchesWarehouse = !filterWarehouse || receipt.warehouse === filterWarehouse
      return matchesSearch && matchesDate && matchesItem && matchesSupplier && matchesWarehouse
    })
  }, [receipts, filterSearch, filterDateFrom, filterDateTo, filterItem, filterSupplier, filterWarehouse])

  const hasActiveFilters = Boolean(
    filterSearch || filterDateFrom || filterDateTo || filterItem || filterSupplier || filterWarehouse,
  )

  const clearFilters = () => {
    setFilterSearch('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterItem('')
    setFilterSupplier('')
    setFilterWarehouse('')
  }

  useEffect(() => {
    if (effectiveCostCenter) {
      loadReceipts()
    }
  }, [effectiveCostCenter, _refreshKey, warehouseContext])

  const loadReceipts = async () => {
    if (!effectiveCostCenter) return
    setLoading(true)
    try {
      const data = await fetchMaterialReceipts(effectiveCostCenter, warehouseContext)
      setReceipts(data)
    } catch (error) {
      console.error('Failed to load receipts:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Material Receipts</h2>
        <FilterToggleButton active={showFilters} onClick={() => setShowFilters((prev) => !prev)} />
      </div>

      {showFilters && (
        <InventoryFilterBar onClear={clearFilters} hasActiveFilters={hasActiveFilters}>
          <FilterSearchInput
            value={filterSearch}
            onChange={setFilterSearch}
            placeholder="Search receipt ID, invoice, receiver..."
          />
          <FilterSearchInput
            value={filterItem}
            onChange={setFilterItem}
            placeholder="Filter by item name or code..."
            className="relative min-w-[180px] flex-1"
          />
          <FilterDateField label="Date from" value={filterDateFrom} onChange={setFilterDateFrom} />
          <FilterDateField label="Date to" value={filterDateTo} onChange={setFilterDateTo} />
          {supplierOptions.length > 0 ? (
            <FilterSelectField
              label="Supplier"
              value={filterSupplier}
              onChange={setFilterSupplier}
              options={supplierOptions}
            />
          ) : null}
          {warehouseOptions.length > 0 ? (
            <FilterSelectField
              label="Warehouse"
              value={filterWarehouse}
              onChange={setFilterWarehouse}
              options={warehouseOptions}
            />
          ) : null}
        </InventoryFilterBar>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Receipt History</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : filteredReceipts.length === 0 ? (
          <div className="p-8 text-center">
            <Package className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-500">
              {receipts.length === 0 ? 'NO MATERIAL RECEIPTS FOUND' : 'NO RECEIPTS MATCH YOUR FILTERS'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredReceipts.map((receipt) => (
              <div key={receipt.name} className="p-4 hover:bg-slate-50 transition">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900">{receipt.name}</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3" />
                        {receipt.status}
                      </span>
                      {receipt.invoice_number && (
                        <span className="text-xs text-slate-500">Invoice: {receipt.invoice_number}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Received on: {receipt.receipt_date} | By: {receipt.received_by}
                      {receipt.supplier && ` | Supplier: ${receipt.supplier}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-bold text-primary">{receipt.total_amount.toLocaleString()}</div>
                      <div className="text-xs text-slate-500">{receipt.items.length} items</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedReceipt(receipt)}
                      className="text-primary hover:text-primary/80 text-sm inline-flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      View
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedReceipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900">Receipt Details</h3>
              <button onClick={() => setSelectedReceipt(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500">Receipt ID</label>
                    <p className="text-sm font-medium">{selectedReceipt.name}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Date</label>
                    <p className="text-sm">{selectedReceipt.receipt_date}</p>
                  </div>
                  {selectedReceipt.supplier && (
                    <div>
                      <label className="text-xs text-slate-500">Supplier</label>
                      <p className="text-sm">{selectedReceipt.supplier}</p>
                    </div>
                  )}
                  {selectedReceipt.invoice_number && (
                    <div>
                      <label className="text-xs text-slate-500">Invoice Number</label>
                      <p className="text-sm">{selectedReceipt.invoice_number}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-slate-500">Received By</label>
                    <p className="text-sm">{selectedReceipt.received_by}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Branch</label>
                    <p className="text-sm">{selectedReceipt.cost_center}</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-500 mb-2 block">Items Received</label>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-right">Quantity</th>
                          <th className="px-3 py-2 text-right">Unit Price</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-left">Batch/Lot</th>
                          <th className="px-3 py-2 text-left">Expiry Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {selectedReceipt.items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2">
                              <div className="font-medium">{item.item_name}</div>
                              <div className="text-xs text-slate-500">{item.item_code}</div>
                            </td>
                            <td className="px-3 py-2 text-right">{item.quantity}</td>
                            <td className="px-3 py-2 text-right">{item.unit_price.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-medium">{item.total_price.toFixed(2)}</td>
                            <td className="px-3 py-2 text-slate-500">{item.batch_number || '-'}</td>
                            <td className="px-3 py-2 text-slate-500">{item.expiry_date || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t border-slate-200">
                        <tr>
                          <td colSpan={3} className="px-3 py-2 text-right font-medium">Total Amount:</td>
                          <td className="px-3 py-2 text-right font-bold text-primary">{selectedReceipt.total_amount.toFixed(2)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
