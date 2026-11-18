import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  CREATE_MODAL_OVERLAY,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import { useCareContext } from '../../providers/CareContextProvider'
import { fetchWarehouses } from '../../services/common'
import {
  createStockTransfer,
  fetchInventoryItems,
  fetchItemUomOptions,
  fetchStockTransferWarehouseOptions,
} from '../../services/nursingInventory'
import {
  fetchMedicineGivenDispensingLots,
  fetchMedicineGivenStockOptions,
  type MedicineGivenBatchOption,
  type MedicineGivenDispensingLotOption,
  type MedicineGivenStockOptions,
} from '../../services/medicineGiven'
import { useMiniWarehouseContext } from './MiniWarehouseInventoryContext'
import { InventoryBranchField, useInventoryBranch } from './InventoryBranchField'
import { toast } from '../../hooks/useToast'
import { X, Plus, Trash2, ArrowRightLeft } from 'lucide-react'

interface CreateStockTransferModalProps {
  onClose: () => void
  onSuccess: () => void
  costCenter?: string
  isFullAccess?: boolean
}

interface TransferItem {
  item_code: string
  item_name: string
  quantity: number
  uom: string
  notes: string
  batch_number: string
  dispensing_lot: string
}

interface RowStockState {
  loading: boolean
  options?: MedicineGivenStockOptions
  dispensingLots: MedicineGivenDispensingLotOption[]
}

function findBatchMeta(
  batches: MedicineGivenBatchOption[],
  selectedValue: string
): MedicineGivenBatchOption | undefined {
  return batches.find(
    (b) =>
      b.batch_name === selectedValue ||
      b.batch_id === selectedValue ||
      (b.batch_name || b.batch_id) === selectedValue
  )
}

function filterDispensingLotsByBatch(
  lots: MedicineGivenDispensingLotOption[],
  batchMeta: MedicineGivenBatchOption | undefined,
  batchValue: string
): MedicineGivenDispensingLotOption[] {
  if (!batchValue) return lots
  const keys = new Set(
    [batchMeta?.batch_name, batchMeta?.batch_id, batchValue].filter(Boolean) as string[]
  )
  return lots.filter((lot) => !lot.batch_no || keys.has(lot.batch_no))
}

const EMPTY_ITEM = (): TransferItem => ({
  item_code: '',
  item_name: '',
  quantity: 1,
  uom: '',
  notes: '',
  batch_number: '',
  dispensing_lot: '',
})

type TabId = 'details' | 'items'

const ITEM_DROPDOWN_MAX_HEIGHT = 224

type InventoryItemOption = { code: string; name: string; uom: string; price: number }

function TransferItemSearchCombobox({
  displayValue,
  options,
  onQueryChange,
  onOpen,
  onSelect,
}: {
  displayValue: string
  options: InventoryItemOption[]
  onQueryChange: (query: string) => void
  onOpen: () => void
  onSelect: (item: InventoryItemOption) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(displayValue)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(displayValue)
  }, [displayValue])

  const updateDropdownPosition = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow
    const maxHeight = Math.min(
      ITEM_DROPDOWN_MAX_HEIGHT,
      Math.max(openUp ? spaceAbove : spaceBelow, 120)
    )

    setDropdownStyle({
      position: 'fixed',
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      left: rect.left,
      width: Math.max(rect.width, 280),
      maxHeight,
      zIndex: 10000,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setDropdownStyle(null)
      return
    }
    const id = requestAnimationFrame(updateDropdownPosition)
    const onScrollOrResize = () => updateDropdownPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, options.length, updateDropdownPosition])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!wrapRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const dropdownPanel =
    open && dropdownStyle ? (
      <div
        ref={dropdownRef}
        style={dropdownStyle}
        className="overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-slate-900 shadow-xl"
      >
        {options.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-500">No items found</div>
        ) : (
          options.map((opt) => (
            <button
              key={opt.code}
              type="button"
              className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(opt)
                setQuery(opt.name)
                setOpen(false)
              }}
            >
              <div className="font-medium">{opt.name}</div>
              <div className="text-xs text-slate-500">Code: {opt.code}</div>
            </button>
          ))
        )}
      </div>
    ) : null

  return (
    <>
      <div ref={wrapRef} className="relative min-w-[200px]">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search item…"
          value={query}
          className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          onFocus={() => {
            setOpen(true)
            onOpen()
          }}
          onChange={(e) => {
            const q = e.target.value
            setQuery(q)
            onQueryChange(q)
            setOpen(true)
          }}
        />
      </div>
      {typeof document !== 'undefined' && dropdownPanel
        ? createPortal(dropdownPanel, document.body)
        : null}
    </>
  )
}

export const CreateStockTransferModal = ({
  onClose,
  onSuccess,
  costCenter,
  isFullAccess,
}: CreateStockTransferModalProps) => {
  const warehouseContext = useMiniWarehouseContext()
  const { costCenterCompany } = useCareContext()
  const { selectedBranch, setSelectedBranch } = useInventoryBranch(costCenter, isFullAccess)
  const effectiveCostCenter = selectedBranch

  const [activeTab, setActiveTab] = useState<TabId>('details')
  const [fromWarehouse, setFromWarehouse] = useState('')
  const [toWarehouse, setToWarehouse] = useState('')
  const [purpose, setPurpose] = useState('Material Transfer')
  const [sourceWarehouses, setSourceWarehouses] = useState<{ name: string; label: string }[]>([])
  const [destinationWarehouses, setDestinationWarehouses] = useState<{ name: string; label: string }[]>([])
  const [loadingWarehouses, setLoadingWarehouses] = useState(false)
  const [notes, setNotes] = useState('')

  const [items, setItems] = useState<TransferItem[]>([EMPTY_ITEM()])
  const [submitting, setSubmitting] = useState(false)
  const [itemSearch, setItemSearch] = useState<Record<number, string>>({})
  const [itemOptions, setItemOptions] = useState<Record<number, InventoryItemOption[]>>({})
  const [itemUomOptions, setItemUomOptions] = useState<Record<number, { name: string; label: string }[]>>({})
  const [rowStock, setRowStock] = useState<Record<number, RowStockState>>({})

  useEffect(() => {
    if (effectiveCostCenter) {
      void loadWarehouseOptions()
    }
  }, [effectiveCostCenter, warehouseContext])

  useEffect(() => {
    if (effectiveCostCenter && fromWarehouse) {
      void loadDestinationOptions(fromWarehouse)
    }
  }, [effectiveCostCenter, fromWarehouse, warehouseContext])

  useEffect(() => {
    if (!fromWarehouse) {
      setRowStock({})
      return
    }
    items.forEach((item, idx) => {
      if (item.item_code) {
        void loadRowStock(idx, item.item_code)
      }
    })
  }, [fromWarehouse])

  const loadRowStock = async (index: number, itemCode: string) => {
    if (!fromWarehouse || !itemCode) return
    setRowStock((prev) => ({
      ...prev,
      [index]: { loading: true, dispensingLots: prev[index]?.dispensingLots || [] },
    }))
    try {
      const opts = await fetchMedicineGivenStockOptions('', itemCode, fromWarehouse)
      setRowStock((prev) => ({
        ...prev,
        [index]: {
          loading: false,
          options: opts,
          dispensingLots: opts.dispensing_lots || [],
        },
      }))
    } catch (error) {
      console.error('Failed to load batch/lot options:', error)
      setRowStock((prev) => ({
        ...prev,
        [index]: { loading: false, dispensingLots: [] },
      }))
    }
  }

  const handleBatchChange = async (index: number, batchValue: string) => {
    const itemCode = items[index]?.item_code
    const stock = rowStock[index]?.options
    const batchMeta = findBatchMeta(stock?.batches || [], batchValue)
    const batchDocName = batchMeta?.batch_name || batchValue

    const updatedItems = [...items]
    updatedItems[index] = {
      ...updatedItems[index],
      batch_number: batchDocName,
      dispensing_lot: '',
    }
    setItems(updatedItems)

    if (!itemCode || !fromWarehouse || !stock?.requires_dispensing_lot) return

    try {
      const lots = await fetchMedicineGivenDispensingLots(
        '',
        itemCode,
        batchDocName || undefined,
        fromWarehouse
      )
      setRowStock((prev) => ({
        ...prev,
        [index]: {
          ...prev[index],
          loading: false,
          dispensingLots: lots,
        },
      }))
    } catch (error) {
      console.error('Failed to load dispensing lots:', error)
    }
  }

  const applyWarehouseFallback = async (
    sources: { name: string; label: string }[],
    destinations: { name: string; label: string }[],
    source: string
  ) => {
    let nextSources = sources
    let nextDestinations = destinations

    if (!nextSources.length || !nextDestinations.length) {
      try {
        const all = await fetchWarehouses(costCenterCompany)
        if (!nextSources.length && all.length) {
          nextSources = all.map((w) => ({ name: w.name, label: w.label || w.name }))
        }
        const activeSource = source || nextSources[0]?.name || ''
        if (!nextDestinations.length && all.length) {
          nextDestinations = all
            .filter((w) => w.name !== activeSource)
            .map((w) => ({ name: w.name, label: w.label || w.name }))
        }
      } catch (error) {
        console.error('Warehouse fallback failed:', error)
      }
    }

    return { nextSources, nextDestinations }
  }

  const loadWarehouseOptions = async () => {
    if (!effectiveCostCenter) return
    setLoadingWarehouses(true)
    try {
      const options = await fetchStockTransferWarehouseOptions(
        effectiveCostCenter,
        undefined,
        undefined,
        warehouseContext
      )
      const { nextSources, nextDestinations } = await applyWarehouseFallback(
        options.source_warehouses || [],
        options.destination_warehouses || [],
        options.default_source || ''
      )

      setSourceWarehouses(nextSources)
      setDestinationWarehouses(nextDestinations)

      const defaultSource = options.default_source || nextSources[0]?.name || ''
      setFromWarehouse(defaultSource)

      const defaultDest =
        nextDestinations.find((w) => w.name !== defaultSource)?.name ||
        nextDestinations[0]?.name ||
        ''
      setToWarehouse(defaultDest)

      if (!nextSources.length) {
        toast.error('No source warehouse found for this branch. Check Healthcare Settings or ERPNext warehouses.')
      }
      if (!nextDestinations.length) {
        toast.error('No destination warehouse found. Add warehouses in ERPNext or pick another company.')
      }
    } catch (error) {
      console.error('Failed to load transfer warehouses:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to load warehouses')
    } finally {
      setLoadingWarehouses(false)
    }
  }

  const loadDestinationOptions = async (source: string) => {
    if (!effectiveCostCenter || !source) return
    try {
      const options = await fetchStockTransferWarehouseOptions(
        effectiveCostCenter,
        source,
        undefined,
        warehouseContext
      )
      let destinations = options.destination_warehouses || []
      if (!destinations.length) {
        const all = await fetchWarehouses(costCenterCompany)
        destinations = all
          .filter((w) => w.name !== source)
          .map((w) => ({ name: w.name, label: w.label || w.name }))
      }
      setDestinationWarehouses(destinations)
      setToWarehouse((prev) => {
        if (prev && destinations.some((w) => w.name === prev)) return prev
        return destinations[0]?.name || ''
      })
    } catch (error) {
      console.error('Failed to load destination warehouses:', error)
    }
  }

  const searchItems = async (index: number, search: string) => {
    if (!search.trim()) {
      setItemOptions((prev) => ({ ...prev, [index]: [] }))
      return
    }
    const results = await fetchInventoryItems(search, warehouseContext)
    setItemOptions((prev) => ({ ...prev, [index]: results }))
  }

  const selectItem = async (index: number, item: InventoryItemOption) => {
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
      quantity: updatedItems[index].quantity || 1,
    }
    setItems(updatedItems)
    setItemUomOptions((prev) => ({
      ...prev,
      [index]: uoms.length ? uoms : defaultUom ? [{ name: defaultUom, label: defaultUom }] : [],
    }))
    setItemSearch((prev) => ({ ...prev, [index]: item.name }))
    setItemOptions((prev) => ({ ...prev, [index]: [] }))
    if (fromWarehouse) {
      void loadRowStock(index, item.code)
    }
  }

  const handleItemSearchChange = (index: number, value: string) => {
    setItemSearch((prev) => ({ ...prev, [index]: value }))
    const updatedItems = [...items]
    updatedItems[index] = { ...updatedItems[index], item_code: '', item_name: '', uom: '', batch_number: '', dispensing_lot: '' }
    setItems(updatedItems)
    setItemUomOptions((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
    setRowStock((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
    void searchItems(index, value)
  }

  const addItem = () => {
    setItems([...items, EMPTY_ITEM()])
  }

  const removeItem = (index: number) => {
    if (items.length === 1) {
      setItems([EMPTY_ITEM()])
      setItemSearch({})
      setItemOptions({})
      setItemUomOptions({})
      setRowStock({})
      return
    }
    setItems(items.filter((_, i) => i !== index))
    setRowStock((prev) => {
      const next: Record<number, RowStockState> = {}
      Object.entries(prev).forEach(([key, val]) => {
        const i = Number(key)
        if (i < index) next[i] = val
        else if (i > index) next[i - 1] = val
      })
      return next
    })
  }

  const updateItem = (index: number, field: keyof TransferItem, value: string | number) => {
    const updatedItems = [...items]
    updatedItems[index] = { ...updatedItems[index], [field]: value }
    setItems(updatedItems)
  }

  const validItems = items.filter((item) => item.item_code && item.quantity > 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveCostCenter) {
      toast.error('Branch is required')
      return
    }
    if (!fromWarehouse) {
      toast.error('Source warehouse is required')
      return
    }
    if (!toWarehouse) {
      toast.error('Destination warehouse is required')
      return
    }
    if (fromWarehouse === toWarehouse) {
      toast.error('Destination must differ from source warehouse')
      return
    }
    if (validItems.length === 0) {
      toast.error('Add at least one item')
      return
    }

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]
      if (!item.item_code || item.quantity <= 0) continue
      const stockOpts = rowStock[idx]?.options
      if (!stockOpts) continue

      const showBatchPicker = Boolean(
        (stockOpts.has_batch_no || stockOpts.requires_dispensing_lot) && stockOpts.batches.length > 0
      )
      if (showBatchPicker && !item.batch_number?.trim()) {
        toast.error(`Please select a batch for ${item.item_name || item.item_code}`)
        return
      }

      if (stockOpts.requires_dispensing_lot) {
        const availableLots =
          (rowStock[idx]?.dispensingLots?.length
            ? rowStock[idx].dispensingLots
            : stockOpts.dispensing_lots) || []
        const filteredLots = item.batch_number
          ? filterDispensingLotsByBatch(
              availableLots,
              findBatchMeta(stockOpts.batches, item.batch_number),
              item.batch_number
            )
          : availableLots
        if (filteredLots.length > 0 && !item.dispensing_lot?.trim()) {
          toast.error(`Please select a dispensing lot for ${item.item_name || item.item_code}`)
          return
        }
      }
    }

    setSubmitting(true)
    try {
      await createStockTransfer({
        cost_center: effectiveCostCenter,
        from_warehouse: fromWarehouse,
        to_warehouse: toWarehouse,
        purpose,
        transfer_date: new Date().toISOString().split('T')[0],
        items: validItems.map((item) => ({
          item_code: item.item_code,
          item_name: item.item_name,
          quantity: item.quantity,
          uom: item.uom || undefined,
          batch_number: item.batch_number || undefined,
          dispensing_lot: item.dispensing_lot || undefined,
        })),
        notes: notes || undefined,
        warehouse_context: warehouseContext,
      })
      toast.success(`Stock transfer created. ${validItems.length} item(s) transferred.`)
      onSuccess()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create stock transfer')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-5xl w-full max-h-[min(90dvh,calc(100vh-1.5rem))] overflow-hidden')}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 rounded-t-xl">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Stock Transfer</h2>
            <p className="text-xs text-slate-500 mt-0.5">Move stock out of mini warehouse — {effectiveCostCenter}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6">
            {activeTab === 'details' && (
              <div className="space-y-5">
                <div>
                  <InventoryBranchField
                    costCenter={costCenter}
                    isFullAccess={isFullAccess}
                    value={selectedBranch}
                    onChange={(branch) => {
                      setSelectedBranch(branch)
                      setFromWarehouse('')
                      setToWarehouse('')
                      setItems((prev) =>
                        prev.map((row) => ({ ...row, batch_number: '', dispensing_lot: '' }))
                      )
                    }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Purpose <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  >
                    <option value="Material Transfer">Material Transfer</option>
                    <option value="Material Transfer for Manufacture">Material Transfer for Manufacture</option>
                    <option value="Send to Subcontractor">Send to Subcontractor</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Stock Entry purpose for this transfer</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      From warehouse <span className="text-red-500">*</span>
                    </label>
                    {loadingWarehouses ? (
                      <div className="text-sm text-slate-500 py-2">Loading…</div>
                    ) : (
                      <select
                        value={fromWarehouse}
                        onChange={(e) => {
                          const next = e.target.value
                          setFromWarehouse(next)
                          setToWarehouse('')
                          setItems((prev) =>
                            prev.map((row) => ({ ...row, batch_number: '', dispensing_lot: '' }))
                          )
                          void loadDestinationOptions(next)
                        }}
                        disabled={sourceWarehouses.length === 0}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-slate-50"
                      >
                        {sourceWarehouses.length === 0 ? (
                          <option value="">No source warehouse configured</option>
                        ) : null}
                        {sourceWarehouses.map((wh) => (
                          <option key={wh.name} value={wh.name}>
                            {wh.label || wh.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      To warehouse <span className="text-red-500">*</span>
                    </label>
                      <select
                        value={toWarehouse}
                        onChange={(e) => setToWarehouse(e.target.value)}
                        disabled={!fromWarehouse || destinationWarehouses.length === 0}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-slate-50"
                      >
                        <option value="">
                          {destinationWarehouses.length ? 'Select destination…' : 'No destinations available'}
                        </option>
                      {destinationWarehouses.map((wh) => (
                        <option key={wh.name} value={wh.name}>
                          {wh.label || wh.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Optional notes for this transfer"
                  />
                </div>
              </div>
            )}

            {activeTab === 'items' && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-700">Items to transfer</label>
                  <button
                    type="button"
                    onClick={addItem}
                    className="text-sm text-primary hover:text-primary/80 inline-flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add item
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg">
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-right w-24">Qty</th>
                        <th className="px-3 py-2 text-left w-28">UOM</th>
                        <th className="px-3 py-2 text-left min-w-[140px]">Batch</th>
                        <th className="px-3 py-2 text-left min-w-[160px]">Dispensing lot</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {items.map((item, idx) => {
                        const stockState = rowStock[idx]
                        const stockOpts = stockState?.options
                        const showBatchPicker = Boolean(
                          item.item_code &&
                            stockOpts &&
                            (stockOpts.has_batch_no || stockOpts.requires_dispensing_lot) &&
                            stockOpts.batches.length > 0
                        )
                        const showDispensingLot = Boolean(
                          item.item_code && stockOpts?.requires_dispensing_lot
                        )
                        const dispensingLots = showDispensingLot
                          ? filterDispensingLotsByBatch(
                              stockState?.dispensingLots?.length
                                ? stockState.dispensingLots
                                : stockOpts?.dispensing_lots || [],
                              findBatchMeta(stockOpts?.batches || [], item.batch_number),
                              item.batch_number
                            )
                          : []

                        return (
                        <tr key={idx}>
                          <td className="px-3 py-2 align-top">
                            <TransferItemSearchCombobox
                              displayValue={itemSearch[idx] ?? item.item_name}
                              options={itemOptions[idx] || []}
                              onQueryChange={(q) => handleItemSearchChange(idx, q)}
                              onOpen={() => {
                                void searchItems(idx, itemSearch[idx] ?? item.item_name ?? '')
                              }}
                              onSelect={(opt) => void selectItem(idx, opt)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)
                              }
                              className="w-full text-right px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={item.uom}
                              onChange={(e) => updateItem(idx, 'uom', e.target.value)}
                              className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                            >
                              <option value="">—</option>
                              {(itemUomOptions[idx] || []).map((u) => (
                                <option key={u.name} value={u.name}>
                                  {u.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {!item.item_code ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : stockState?.loading ? (
                              <span className="text-xs text-slate-500">Loading…</span>
                            ) : showBatchPicker ? (
                              <select
                                value={item.batch_number}
                                onChange={(e) => void handleBatchChange(idx, e.target.value)}
                                className="w-full min-w-[130px] px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                              >
                                <option value="">Select batch…</option>
                                {stockOpts!.batches.map((batch) => {
                                  const value = batch.batch_name || batch.batch_id
                                  const label = [
                                    batch.batch_id || batch.batch_name,
                                    batch.qty != null ? `Qty: ${batch.qty}` : '',
                                    batch.expiry_date ? `Exp: ${batch.expiry_date}` : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')
                                  return (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  )
                                })}
                              </select>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {!showDispensingLot ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : stockState?.loading ? (
                              <span className="text-xs text-slate-500">Loading…</span>
                            ) : dispensingLots.length > 0 ? (
                              <select
                                value={item.dispensing_lot}
                                onChange={(e) => updateItem(idx, 'dispensing_lot', e.target.value)}
                                disabled={showBatchPicker && !item.batch_number}
                                className="w-full min-w-[150px] px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-slate-50"
                              >
                                <option value="">
                                  {showBatchPicker && !item.batch_number
                                    ? 'Select batch first…'
                                    : 'Select lot…'}
                                </option>
                                {dispensingLots.map((lot) => (
                                  <option key={lot.name} value={lot.name}>
                                    {lot.label || lot.serial_no || lot.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-amber-700">No lots available</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 px-6 py-4 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              <ArrowRightLeft className="w-4 h-4" />
              {submitting ? 'Transferring…' : 'Transfer stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
