// tabs/MaterialRequestTab.tsx
import { useState, useEffect, useMemo } from 'react'
import { useCareContext } from '../../providers/CareContextProvider'
import { fetchMaterialRequests, type MaterialRequest } from '../../services/nursingInventory'
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
import { Eye, CheckCircle, XCircle, Package, ExternalLink } from 'lucide-react'

interface MaterialRequestTabProps {
  onSuccess: () => void
  refreshKey?: number
  costCenter?: string
  isFullAccess?: boolean
}

export const MaterialRequestTab = ({ onSuccess: _onSuccess, refreshKey: _refreshKey, costCenter: _costCenter, isFullAccess: _isFullAccess }: MaterialRequestTabProps) => {
  const warehouseContext = useMiniWarehouseContext()
  const { userCostCenter } = useCareContext()
  const effectiveCostCenter = _costCenter || userCostCenter
  const [requests, setRequests] = useState<MaterialRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | null>(null)

  const [showFilters, setShowFilters] = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterItem, setFilterItem] = useState('')

  const statusOptions = useMemo(
    () => collectUniqueStrings(requests.map((request) => request.status)),
    [requests],
  )

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      const matchesSearch =
        matchesTextQuery(request.name, filterSearch) ||
        matchesTextQuery(request.requested_by, filterSearch) ||
        matchesTextQuery(request.notes, filterSearch)
      const matchesDate = matchesDateRange(request.request_date, filterDateFrom, filterDateTo)
      const matchesStatus = !filterStatus || request.status === filterStatus
      const matchesItem = matchesAnyItemQuery(request.items, filterItem)
      return matchesSearch && matchesDate && matchesStatus && matchesItem
    })
  }, [requests, filterSearch, filterDateFrom, filterDateTo, filterStatus, filterItem])

  const hasActiveFilters = Boolean(filterSearch || filterDateFrom || filterDateTo || filterStatus || filterItem)

  const clearFilters = () => {
    setFilterSearch('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterStatus('')
    setFilterItem('')
  }

  useEffect(() => {
    if (effectiveCostCenter) {
      loadRequests()
    }
  }, [effectiveCostCenter, _refreshKey, warehouseContext])

  const loadRequests = async () => {
    if (!effectiveCostCenter) return
    setLoading(true)
    try {
      const data = await fetchMaterialRequests(effectiveCostCenter, undefined, warehouseContext)
      // Dedupe by name — cost_center on child items can otherwise surface the same MR twice.
      const seen = new Set<string>()
      const unique = data.filter((request) => {
        if (!request?.name || seen.has(request.name)) return false
        seen.add(request.name)
        return true
      })
      setRequests(unique)
    } catch (error) {
      console.error('Failed to load requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const deskMaterialRequestUrl = (name: string) =>
    `${window.location.origin}/app/material-request/${encodeURIComponent(name)}`

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-amber-100 text-amber-800'
      case 'Draft': return 'bg-slate-100 text-slate-700'
      case 'Submitted': return 'bg-blue-100 text-blue-800'
      case 'Partially Ordered': return 'bg-cyan-100 text-cyan-800'
      case 'Ordered': return 'bg-indigo-100 text-indigo-800'
      case 'Partially Received': return 'bg-teal-100 text-teal-800'
      case 'Received':
      case 'Transferred':
      case 'Issued': return 'bg-green-100 text-green-800'
      case 'Stopped':
      case 'Cancelled': return 'bg-red-100 text-red-800'
      default: return 'bg-slate-100 text-slate-800'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Received':
      case 'Transferred':
      case 'Issued':
      case 'Ordered': return <CheckCircle className="w-4 h-4" />
      case 'Stopped':
      case 'Cancelled': return <XCircle className="w-4 h-4" />
      default: return <Package className="w-4 h-4" />
    }
  }

  /** Fulfillment label — avoid bare "Pending" colliding with approval "Pending". */
  const supplyStatusLabel = (status: string) => {
    if (status === 'Pending') return 'Awaiting stock'
    return status
  }

  const getWorkflowColor = (state: string) => {
    const s = state.toLowerCase()
    if (s.includes('approv') && !s.includes('pending') && !s.includes('await')) {
      return 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
    }
    if (s.includes('reject') || s.includes('cancel')) {
      return 'bg-red-50 text-red-800 ring-1 ring-red-200'
    }
    if (s.includes('pending') || s.includes('review') || s.includes('draft')) {
      return 'bg-violet-50 text-violet-800 ring-1 ring-violet-200'
    }
    return 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
  }

  const renderStatusPair = (status: string, workflowState?: string | null, size: 'sm' | 'md' = 'md') => {
    const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
    const wf = (workflowState || '').trim()
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {wf ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full font-medium ${pad} ${getWorkflowColor(wf)}`}
            title="Workflow approval"
          >
            <span className="opacity-70 font-normal">Approval</span>
            {wf}
          </span>
        ) : null}
        <span
          className={`inline-flex items-center gap-1 rounded-full font-medium ${pad} ${getStatusColor(status)}`}
          title="Stock / supply progress"
        >
          {getStatusIcon(status)}
          <span className="opacity-70 font-normal">Supply</span>
          {supplyStatusLabel(status)}
        </span>
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Material Requests</h2>
        <FilterToggleButton active={showFilters} onClick={() => setShowFilters((prev) => !prev)} />
      </div>

      {showFilters && (
        <InventoryFilterBar onClear={clearFilters} hasActiveFilters={hasActiveFilters}>
          <FilterSearchInput
            value={filterSearch}
            onChange={setFilterSearch}
            placeholder="Search request ID, requester, notes..."
          />
          <FilterSearchInput
            value={filterItem}
            onChange={setFilterItem}
            placeholder="Filter by item name or code..."
            className="relative min-w-[180px] flex-1"
          />
          <FilterDateField label="Date from" value={filterDateFrom} onChange={setFilterDateFrom} />
          <FilterDateField label="Date to" value={filterDateTo} onChange={setFilterDateTo} />
          <FilterSelectField
            label="Status"
            value={filterStatus}
            onChange={setFilterStatus}
            options={statusOptions}
          />
        </InventoryFilterBar>
      )}

      {/* Requests List */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-8 text-center">
            <Package className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-500">
              {requests.length === 0 ? 'NO MATERIAL REQUESTS FOUND' : 'NO REQUESTS MATCH YOUR FILTERS'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredRequests.map((request) => (
              <div key={request.name} className="p-4 hover:bg-slate-50 transition">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900">{request.name}</span>
                      {renderStatusPair(request.status, request.workflow_state)}
                      {request.is_medical != null ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            request.is_medical
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {request.is_medical ? 'Medical' : 'Consumable'}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Requested on: {request.request_date} | Items: {request.items.length}
                      {request.set_warehouse || request.warehouse
                        ? ` | Warehouse: ${request.set_warehouse || request.warehouse}`
                        : ''}
                      {request.material_request_type ? ` | Purpose: ${request.material_request_type}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedRequest(request)}
                      className="text-primary hover:text-primary/80 text-sm inline-flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      View Details
                    </button>
                    <a
                      href={deskMaterialRequestUrl(request.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-600 hover:text-slate-900 text-xs inline-flex items-center gap-1"
                      title="Open To Review/Approve"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open To Review/Approve
                    </a>
                  </div>
                </div>

                {request.items.length > 0 && (
                  <div className="mt-2 text-sm text-slate-600">
                    {request.items.slice(0, 2).map((item, itemIdx) => (
                      <div key={`${request.name}-${item.item_code}-${itemIdx}`} className="flex justify-between text-xs">
                        <span>{item.item_name}</span>
                        <span>Qty: {item.quantity} {item.uom || 'unit'}</span>
                      </div>
                    ))}
                    {request.items.length > 2 && (
                      <div className="text-xs text-slate-400 mt-1">+{request.items.length - 2} more items</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Request Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900">Request Details</h3>
              <button onClick={() => setSelectedRequest(null)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500">Request ID</label>
                    <p className="text-sm font-medium">{selectedRequest.name}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Status</label>
                    <div className="mt-1">
                      {renderStatusPair(selectedRequest.status, selectedRequest.workflow_state)}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Approval = workflow · Supply = transfer / purchase progress
                    </p>
                  </div>
                  {selectedRequest.material_request_type ? (
                    <div>
                      <label className="text-xs text-slate-500">Purpose</label>
                      <p className="text-sm">{selectedRequest.material_request_type}</p>
                    </div>
                  ) : null}
                  {(selectedRequest.set_warehouse || selectedRequest.warehouse) ? (
                    <div>
                      <label className="text-xs text-slate-500">Target Warehouse</label>
                      <p className="text-sm">{selectedRequest.set_warehouse || selectedRequest.warehouse}</p>
                    </div>
                  ) : null}
                  {selectedRequest.set_from_warehouse ? (
                    <div>
                      <label className="text-xs text-slate-500">Source Warehouse</label>
                      <p className="text-sm">{selectedRequest.set_from_warehouse}</p>
                    </div>
                  ) : null}
                  {selectedRequest.is_medical != null ? (
                    <div>
                      <label className="text-xs text-slate-500">Category</label>
                      <p
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          selectedRequest.is_medical
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {selectedRequest.is_medical ? 'Medical' : 'Consumable'}
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <label className="text-xs text-slate-500">Request Date</label>
                    <p className="text-sm">{selectedRequest.request_date}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Requested By</label>
                    <p className="text-sm">{selectedRequest.requested_by}</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-500 mb-2 block">Items</label>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-right">Quantity</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                          <th className="px-3 py-2 text-left">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {selectedRequest.items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2">{item.item_name}</td>
                            <td className="px-3 py-2 text-right">{item.quantity}</td>
                            <td className="px-3 py-2">{item.uom}</td>
                            <td className="px-3 py-2 text-slate-500">{item.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedRequest.notes && (
                  <div>
                    <label className="text-xs text-slate-500">Notes</label>
                    <p className="text-sm mt-1">{selectedRequest.notes}</p>
                  </div>
                )}

                {selectedRequest.approved_by && (
                  <div>
                    <label className="text-xs text-slate-500">Approved By</label>
                    <p className="text-sm">{selectedRequest.approved_by}</p>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100">
                  <a
                    href={deskMaterialRequestUrl(selectedRequest.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open To Review/Approve
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
