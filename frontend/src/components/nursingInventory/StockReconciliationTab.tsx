// tabs/StockReconciliationTab.tsx
import { useState, useEffect, useMemo } from 'react'
import { useCareContext } from '../../providers/CareContextProvider'
import { getStockReconciliations } from '../../services/nursingInventory'
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
import { toast } from '../../hooks/useToast'
import { Eye, CheckCircle } from 'lucide-react'

interface StockReconciliationTabProps {
  onSuccess: () => void
  refreshKey?: number
  costCenter?: string
  isFullAccess?: boolean
}

export const StockReconciliationTab = ({
  onSuccess: _onSuccess,
  refreshKey: _refreshKey,
  costCenter: _costCenter,
  isFullAccess: _isFullAccess,
}: StockReconciliationTabProps) => {
  const warehouseContext = useMiniWarehouseContext()
  const { userCostCenter } = useCareContext()
  const effectiveCostCenter = _costCenter || userCostCenter
  const [reconciliations, setReconciliations] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedReconciliation, setSelectedReconciliation] = useState<any | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterItem, setFilterItem] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')

  const warehouseOptions = useMemo(
    () => collectUniqueStrings(reconciliations.flatMap((rec) => [rec.warehouse, ...(rec.items || []).map((item: any) => item.warehouse)])),
    [reconciliations],
  )

  const filteredReconciliations = useMemo(() => {
    return reconciliations.filter((rec) => {
      const recDate = rec.posting_date || rec.reconciliation_date
      const matchesSearch =
        matchesTextQuery(rec.name, filterSearch) ||
        matchesTextQuery(rec.owner, filterSearch) ||
        matchesTextQuery(rec.reconciled_by, filterSearch)
      const matchesDate = matchesDateRange(recDate, filterDateFrom, filterDateTo)
      const matchesItem = matchesAnyItemQuery(rec.items, filterItem)
      const matchesWarehouse = !filterWarehouse || rec.warehouse === filterWarehouse || (rec.items || []).some((item: any) => item.warehouse === filterWarehouse)
      return matchesSearch && matchesDate && matchesItem && matchesWarehouse
    })
  }, [reconciliations, filterSearch, filterDateFrom, filterDateTo, filterItem, filterWarehouse])

  const hasActiveFilters = Boolean(filterSearch || filterDateFrom || filterDateTo || filterItem || filterWarehouse)

  const clearFilters = () => {
    setFilterSearch('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterItem('')
    setFilterWarehouse('')
  }

  useEffect(() => {
    if (effectiveCostCenter) {
      loadReconciliations()
    }
  }, [effectiveCostCenter, _refreshKey, warehouseContext])

  const loadReconciliations = async () => {
    if (!effectiveCostCenter) return
    setLoading(true)
    try {
      const data = await getStockReconciliations(effectiveCostCenter, warehouseContext)
      setReconciliations(data || [])
    } catch (error) {
      console.error('Failed to load reconciliations:', error)
      toast.error('Failed to load stock reconciliations')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Stock Reconciliation</h2>
        <FilterToggleButton active={showFilters} onClick={() => setShowFilters((prev) => !prev)} />
      </div>

      {showFilters && (
        <InventoryFilterBar onClear={clearFilters} hasActiveFilters={hasActiveFilters}>
          <FilterSearchInput
            value={filterSearch}
            onChange={setFilterSearch}
            placeholder="Search reconciliation ID or user..."
          />
          <FilterSearchInput
            value={filterItem}
            onChange={setFilterItem}
            placeholder="Filter by item name or code..."
            className="relative min-w-[180px] flex-1"
          />
          <FilterDateField label="Date from" value={filterDateFrom} onChange={setFilterDateFrom} />
          <FilterDateField label="Date to" value={filterDateTo} onChange={setFilterDateTo} />
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
          <h3 className="text-sm font-semibold text-slate-900">Reconciliation History</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : filteredReconciliations.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-500">
              {reconciliations.length === 0 ? 'NO RECONCILIATION RECORDS FOUND' : 'NO RECORDS MATCH YOUR FILTERS'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredReconciliations.map((rec) => (
              <div key={rec.name} className="p-4 hover:bg-slate-50 transition">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{rec.name}</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3" />
                        {rec.status || 'Completed'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Reconciled on: {rec.posting_date || rec.reconciliation_date} | By: {rec.owner || rec.reconciled_by}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedReconciliation(rec)}
                    className="text-primary hover:text-primary/80 text-sm inline-flex items-center gap-1"
                  >
                    <Eye className="w-4 h-4" />
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedReconciliation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900">Reconciliation Details</h3>
              <button onClick={() => setSelectedReconciliation(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500">Reconciliation ID</label>
                    <p className="text-sm font-medium">{selectedReconciliation.name}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Date</label>
                    <p className="text-sm">{selectedReconciliation.posting_date || selectedReconciliation.reconciliation_date}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Reconciled By</label>
                    <p className="text-sm">{selectedReconciliation.owner || selectedReconciliation.reconciled_by}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Warehouse</label>
                    <p className="text-sm">{selectedReconciliation.warehouse}</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-500 mb-2 block">Adjusted Items</label>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-right">Current Qty</th>
                          <th className="px-3 py-2 text-right">New Qty</th>
                          <th className="px-3 py-2 text-right">Difference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {selectedReconciliation.items?.map((item: any, idx: number) => (
                          <tr key={idx}>
                            <td className="px-3 py-2">
                              <div className="font-medium">{item.item_name || item.item_code}</div>
                              <div className="text-xs text-slate-500">{item.item_code}</div>
                            </td>
                            <td className="px-3 py-2 text-right">{item.current_qty || item.current_quantity || 0}</td>
                            <td className="px-3 py-2 text-right">{item.qty || item.new_quantity || 0}</td>
                            <td className={`px-3 py-2 text-right font-medium ${(item.qty || item.new_quantity || 0) - (item.current_qty || item.current_quantity || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {((item.qty || item.new_quantity || 0) - (item.current_qty || item.current_quantity || 0)) > 0
                                ? `+${(item.qty || item.new_quantity || 0) - (item.current_qty || item.current_quantity || 0)}`
                                : (item.qty || item.new_quantity || 0) - (item.current_qty || item.current_quantity || 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
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
