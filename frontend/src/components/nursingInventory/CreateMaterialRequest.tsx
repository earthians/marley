// CreateMaterialRequestModal.tsx
import { useState, useEffect } from 'react'
import {
  CREATE_MODAL_OVERLAY,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { useCareContext } from '../../providers/CareContextProvider'
import {
  createMaterialRequest,
  fetchInventoryItems,
  fetchItemUomOptions,
  getWarehousesForCostCenter,
  type MaterialRequestPurpose,
} from '../../services/nursingInventory'
import { fetchWarehouses } from '../../services/common'
import { useMiniWarehouseContext } from './MiniWarehouseInventoryContext'
import { toast } from '../../hooks/useToast'
import { X, Plus, Trash2, Send, Package } from 'lucide-react'
import {
  IsMedicalSelect,
  isMedicalChoiceRequired,
  isMedicalPayload,
  type IsMedicalChoice,
} from '../ui/IsMedicalSelect'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DateFilterInput } from '../ui/DateFilterInput'

interface CreateMaterialRequestModalProps {
  onClose: () => void
  onSuccess: () => void
  costCenter?: string
  isFullAccess?: boolean
}

interface RequestItem {
  item_code: string
  item_name: string
  quantity: number
  uom: string
  notes: string
}

type TabId = 'details' | 'items'

const MATERIAL_REQUEST_PURPOSES: MaterialRequestPurpose[] = [
  'Purchase',
  'Material Transfer',
  'Material Issue',
  'Manufacture',
  'Customer Provided',
  'Subcontracting',
]

export const CreateMaterialRequestModal = ({ onClose, onSuccess, costCenter }: CreateMaterialRequestModalProps) => {
  const warehouseContext = useMiniWarehouseContext()
  const { userCostCenter, user, costCenterCompany } = useCareContext()
  const effectiveCostCenter = costCenter || userCostCenter
  
  const [activeTab, setActiveTab] = useState<TabId>('details')
  const [purpose, setPurpose] = useState<MaterialRequestPurpose>('Purchase')
  /** Target / final warehouse (ERPNext set_warehouse). */
  const [setWarehouse, setSetWarehouse] = useState('')
  /** Source warehouse when purpose is Material Transfer. */
  const [setFromWarehouse, setSetFromWarehouse] = useState('')
  const [warehouses, setWarehouses] = useState<{ name: string; label: string }[]>([])
  const [sourceWarehouses, setSourceWarehouses] = useState<{ name: string; label: string }[]>([])
  const [loadingWarehouses, setLoadingWarehouses] = useState(false)
  const [notes, setNotes] = useState('')
  const [isMedical, setIsMedical] = useState<IsMedicalChoice>('')
  
  const [items, setItems] = useState<RequestItem[]>([{ item_code: '', item_name: '', quantity: 1, uom: '', notes: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [confirmPurposeOpen, setConfirmPurposeOpen] = useState(false)
  const [itemSearch, setItemSearch] = useState<{ [key: number]: string }>({})
  const [itemOptions, setItemOptions] = useState<{ [key: number]: any[] }>({})
  const [itemUomOptions, setItemUomOptions] = useState<{ [key: number]: { name: string; label: string }[] }>({})
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)

  const isMaterialTransfer = purpose === 'Material Transfer'

  // Load target warehouses (mini warehouse for this branch)
  useEffect(() => {
    if (effectiveCostCenter) {
      void loadWarehouses()
    }
  }, [effectiveCostCenter, warehouseContext])

  // Broader source list for Material Transfer (stores / other warehouses)
  useEffect(() => {
    if (!isMaterialTransfer) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchWarehouses(costCenterCompany || undefined)
        if (cancelled) return
        const mapped = rows.map((r) => ({
          name: r.name,
          label: r.label || r.name,
        }))
        setSourceWarehouses(mapped.length ? mapped : warehouses)
      } catch {
        if (!cancelled) setSourceWarehouses(warehouses)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isMaterialTransfer, costCenterCompany, warehouses])

  const loadWarehouses = async () => {
    if (!effectiveCostCenter) return
    setLoadingWarehouses(true)
    try {
      const data = await getWarehousesForCostCenter(effectiveCostCenter, warehouseContext)
      setWarehouses(data)
      if (data.length > 0) {
        setSetWarehouse((prev) => prev || data[0].name)
      }
    } catch (error) {
      console.error('Failed to load warehouses:', error)
    } finally {
      setLoadingWarehouses(false)
    }
  }

  const searchItems = async (index: number, search: string) => {
    if (!search.trim()) {
      setItemOptions(prev => ({ ...prev, [index]: [] }))
      return
    }
    const results = await fetchInventoryItems(search, warehouseContext)
    setItemOptions(prev => ({ ...prev, [index]: results }))
  }

  const selectItem = async (index: number, item: any) => {
    let uoms: { name: string; label: string }[] = []
    try {
      uoms = await fetchItemUomOptions(item.code)
    } catch (error) {
      console.error('Failed to load item units:', error)
    }
    const defaultUom = item.uom || uoms[0]?.name || ''
    const updatedItems = [...items]
    updatedItems[index] = {
      ...updatedItems[index],
      item_code: item.code,
      item_name: item.name,
      uom: defaultUom,
      quantity: updatedItems[index].quantity || 1
    }
    setItems(updatedItems)
    setItemUomOptions(prev => ({ ...prev, [index]: uoms.length ? uoms : defaultUom ? [{ name: defaultUom, label: defaultUom }] : [] }))
    setItemSearch(prev => ({ ...prev, [index]: item.name }))
    setItemOptions(prev => ({ ...prev, [index]: [] }))
    setOpenDropdown(null)
  }

  const handleItemSearchChange = (index: number, value: string) => {
    setItemSearch(prev => ({ ...prev, [index]: value }))
    setOpenDropdown(index)
    const updatedItems = [...items]
    updatedItems[index] = {
      ...updatedItems[index],
      item_code: '',
      item_name: '',
      uom: '',
    }
    setItems(updatedItems)
    setItemUomOptions(prev => {
      const next = { ...prev }
      delete next[index]
      return next
    })
    searchItems(index, value)
  }

  const addItem = () => {
    setItems([...items, { item_code: '', item_name: '', quantity: 1, uom: '', notes: '' }])
  }

  const removeItem = (index: number) => {
    if (items.length === 1) {
      setItems([{ item_code: '', item_name: '', quantity: 1, uom: '', notes: '' }])
      setItemSearch({})
      setItemOptions({})
      setItemUomOptions({})
      return
    }
    setItems(items.filter((_, i) => i !== index))
    setItemSearch(prev => {
      const next = { ...prev }
      delete next[index]
      return next
    })
    setItemOptions(prev => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  const updateItem = (index: number, field: keyof RequestItem, value: any) => {
    const updatedItems = [...items]
    updatedItems[index] = { ...updatedItems[index], [field]: value }
    setItems(updatedItems)
  }

  const validItems = items.filter(item => item.item_code && item.quantity > 0 && item.uom)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!effectiveCostCenter) {
      toast.error('No branch assigned')
      return
    }

    if (!setWarehouse) {
      toast.error('Please select Set Target Warehouse (final warehouse)')
      setActiveTab('details')
      return
    }

    if (isMaterialTransfer && setFromWarehouse && setFromWarehouse === setWarehouse) {
      toast.error('Source and target warehouses must be different')
      setActiveTab('details')
      return
    }

    if (!isMedicalChoiceRequired(isMedical)) {
      toast.error('Please select a category (Medical or Consumable)')
      setActiveTab('items')
      return
    }

    if (validItems.length === 0) {
      toast.error('Please add at least one valid item')
      setActiveTab('items')
      return
    }

    setConfirmPurposeOpen(true)
  }

  const submitMaterialRequest = async () => {
    if (!effectiveCostCenter || !setWarehouse) return

    setSubmitting(true)
    try {
      await createMaterialRequest({
        cost_center: effectiveCostCenter,
        material_request_type: purpose,
        warehouse: setWarehouse,
        set_warehouse: setWarehouse,
        set_from_warehouse: isMaterialTransfer && setFromWarehouse ? setFromWarehouse : undefined,
        request_date: new Date().toISOString().split('T')[0],
        items: validItems,
        requested_by: user?.name || '',
        notes: notes || undefined,
        warehouse_context: warehouseContext,
        is_medical: isMedicalPayload(isMedical),
      })
      setConfirmPurposeOpen(false)
      toast.success('Material request created successfully')
      onSuccess()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-4xl w-full max-h-[90vh]')}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 rounded-t-xl">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-emerald-950">Create Material Request</h2>
            <p className="text-xs text-slate-500 mt-0.5">Request materials from stores for {effectiveCostCenter}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 shrink-0 bg-slate-50">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-primary text-primary bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('items')}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'items'
                ? 'border-primary text-primary bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            Items ({validItems.length})
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6">
            {/* Details Tab */}
            {activeTab === 'details' && (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Branch <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={effectiveCostCenter}
                    readOnly
                    disabled
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                  />
                  <p className="text-xs text-slate-400 mt-1">Uses the global branch filter from the top navbar.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Purpose <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={purpose}
                    onChange={(e) => {
                      const next = e.target.value as MaterialRequestPurpose
                      setPurpose(next)
                      if (next !== 'Material Transfer') setSetFromWarehouse('')
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  >
                    {MATERIAL_REQUEST_PURPOSES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Material Request type (Purchase, Material Transfer, …)
                  </p>
                </div>

                {isMaterialTransfer ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Set Source Warehouse
                    </label>
                    <select
                      value={setFromWarehouse}
                      onChange={(e) => setSetFromWarehouse(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      <option value="">Select source warehouse</option>
                      {(sourceWarehouses.length ? sourceWarehouses : warehouses).map((w) => (
                        <option key={w.name} value={w.name}>
                          {w.label || w.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">Optional — warehouse stock will be transferred from</p>
                  </div>
                ) : null}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Set Target Warehouse <span className="text-red-500">*</span>
                  </label>
                  {loadingWarehouses ? (
                    <div className="flex items-center gap-2 py-2">
                      <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                      <span className="text-sm text-slate-500">Loading warehouses...</span>
                    </div>
                  ) : (
                    <select
                      value={setWarehouse}
                      onChange={(e) => setSetWarehouse(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      <option value="">Select target warehouse</option>
                      {warehouses.map(w => (
                        <option key={w.name} value={w.name}>{w.label || w.name}</option>
                      ))}
                    </select>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    Final warehouse where materials should land (ERPNext Set Target Warehouse)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Request Date
                  </label>
                  <DateFilterInput
                    value={new Date().toISOString().split('T')[0]}
                    readOnly
                    disabled
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Additional Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    placeholder="Any special instructions or notes..."
                  />
                </div>
              </div>
            )}

            {/* Items Tab */}
            {activeTab === 'items' && (
              <div className="space-y-4">
                <IsMedicalSelect value={isMedical} onChange={setIsMedical} />

                <div className="flex justify-between items-center">
                  <p className="text-sm text-slate-500">
                    Add the items you want to request from stores.
                  </p>
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-md hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add Item
                  </button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
                      <div className="flex gap-3 items-start">
                        <div className="flex-1 relative">
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Item <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="Search for an item..."
                            value={itemSearch[idx] ?? item.item_name ?? ''}
                            onChange={(e) => handleItemSearchChange(idx, e.target.value)}
                            onFocus={() => setOpenDropdown(idx)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                          {openDropdown === idx && itemOptions[idx] && itemOptions[idx].length > 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto">
                              {itemOptions[idx].map(opt => (
                                <button
                                  key={opt.code}
                                  type="button"
                                  onClick={() => selectItem(idx, opt)}
                                  className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                                >
                                  <div className="font-medium text-slate-900">{opt.name}</div>
                                  <div className="text-xs text-slate-500">Code: {opt.code} | UOM: {opt.uom}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="w-28">
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Quantity <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={item.quantity > 0 ? item.quantity : ''}
                            onChange={(e) => {
                              const raw = e.target.value
                              if (raw === '') {
                                updateItem(idx, 'quantity', 0)
                                return
                              }
                              const num = parseInt(raw, 10)
                              if (!isNaN(num)) updateItem(idx, 'quantity', num)
                            }}
                            onBlur={() => {
                              if (!item.quantity || item.quantity < 1) {
                                updateItem(idx, 'quantity', 1)
                              }
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary text-right"
                          />
                        </div>

                        <div className="w-28">
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Unit
                          </label>
                          <select
                            value={item.uom}
                            onChange={(e) => updateItem(idx, 'uom', e.target.value)}
                            disabled={!item.item_code}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            <option value="">Select unit</option>
                            {(itemUomOptions[idx] || (item.uom ? [{ name: item.uom, label: item.uom }] : [])).map(uom => (
                              <option key={uom.name} value={uom.name}>{uom.label}</option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="mt-6 p-2 text-red-500 hover:text-red-700 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Notes (Optional)
                        </label>
                        <input
                          type="text"
                          value={item.notes}
                          onChange={(e) => updateItem(idx, 'notes', e.target.value)}
                          placeholder="Any specific instructions for this item..."
                          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>
                  ))}

                  {items.length === 0 && (
                    <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                      <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">NO ITEMS ADDED YET</p>
                      <button
                        type="button"
                        onClick={addItem}
                        className="mt-3 text-sm text-primary hover:underline"
                      >
                        Add first item
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 px-6 py-4 border-t border-slate-200 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !setWarehouse || validItems.length === 0 || !isMedicalChoiceRequired(isMedical)}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Creating...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmPurposeOpen}
        variant="warning"
        title="Confirm purpose"
        message={`You are about to submit this Material Request with purpose “${purpose}”. Please confirm this is the correct purpose before continuing.`}
        confirmLabel="Yes, submit"
        cancelLabel="Go back"
        loading={submitting}
        onConfirm={() => void submitMaterialRequest()}
        onCancel={() => {
          if (!submitting) {
            setConfirmPurposeOpen(false)
            setActiveTab('details')
          }
        }}
      />
    </div>
  )
}