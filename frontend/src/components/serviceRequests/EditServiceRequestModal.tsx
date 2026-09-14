import { useState, useEffect, useMemo } from 'react'
import {
  searchPatients,
  fetchPatients,
  type PatientListItem
} from '../../services/patients'
import {
  fetchHealthcarePractitioners,
  fetchServiceRequestTemplateTypes,
  fetchServiceRequestTemplates,
  fetchPatientVisits,
  fetchInpatientAdmissions,
  type LinkFieldOption
} from '../../services/common'
import {
  fetchServiceRequest,
  getMultiLabRequestPricing,
  updateServiceRequest,
  type LabRequestItem,
  type MultiLabRequestPricing,
  type UpdateServiceRequestData
} from '../../services/serviceRequests'
import { fetchLabRequestActions } from '../../services/labRequestActions'
import { LabTestLineDiscountTable } from './LabTestLineDiscountTable'
import {
  isOtherServiceRequest,
  serviceRequestPractitionerLabel,
} from '../../utils/serviceRequestLabels'
import {
  defaultLineDiscount,
  extractLineDiscountsFromBasket,
  mergeDiscountsIntoBasket,
  parseLabRequestItems,
  serializeLabRequestItemsForSave,
  type LabLineDiscount,
} from '../../utils/labTestDiscounts'
import { toast } from '../../hooks/useToast'
import { ChevronDown, Trash2, X } from 'lucide-react'
import { DateFilterInput } from '../ui/DateFilterInput'

type SRTab = 'patient_order' | 'service_details' | 'billing_pricing'

interface EditServiceRequestModalProps {
  serviceRequestName: string
  onClose: () => void
  onSuccess: () => void
}

interface PricingRow {
  patient_category: string
  price: number | null
  multiplier?: number | null
  discount_pct?: number | null
  discount_amount?: number | null
  rate?: number | null
}

const defaultFormData = {
  template_dt: '',
  template_dn: '',
  practitioner: '',
  patient_visit: '',
  inpatient_record: '',
  order_date: '',
  order_time: '',
  department: '',
  status: '',
  priority: '',
  intent: '',
  quantity: 1,
  cost: '' as string | number,
  order_description: '',
  patient_instructions: '',
  expected_date: '',
  amount: '' as string | number,
  source: '',
  referring_practitioner: '',
  referred_to_practitioner: '',
  staff_role: '',
  patient_care_type: '',
  healthcare_service_unit_type: '',
  as_needed: false,
  occurrence_date: '',
  occurrence_time: '',
  dosage_form: '',
  dosage: '',
  period: '',
  order_group: '',
  order_reference_doctype: '',
  order_reference_name: '',
  reference_document_type: '',
  reference_document_name: '',
  patient_category: '',
  // discount_value (Select) stores the margin type label; discount (Percent) stores the % value
  discount_value: 'Percentage' as string,
  discount: 0,
  discount_amount: 0,
  grand_total: 0
}

export const EditServiceRequestModal = ({
  serviceRequestName,
  onClose,
  onSuccess
}: EditServiceRequestModalProps) => {
  const [activeTab, setActiveTab] = useState<SRTab>('patient_order')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [patientQuery, setPatientQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientListItem | null>(null)
  const [patients, setPatients] = useState<PatientListItem[]>([])
  const [patientOpen, setPatientOpen] = useState(false)
  const [loadingPatients, setLoadingPatients] = useState(false)

  const [templateTypes, setTemplateTypes] = useState<LinkFieldOption[]>([])
  const [templates, setTemplates] = useState<LinkFieldOption[]>([])
  const [practitioners, setPractitioners] = useState<LinkFieldOption[]>([])
  const [patientVisits, setPatientVisits] = useState<LinkFieldOption[]>([])
  const [admissions, setAdmissions] = useState<LinkFieldOption[]>([])
  const [practOpen, setPractOpen] = useState(false)
  const [practQuery, setPractQuery] = useState('')
  const [referringOpen, setReferringOpen] = useState(false)
  const [referringQuery, setReferringQuery] = useState('')
  const [referredToOpen, setReferredToOpen] = useState(false)
  const [referredToQuery, setReferredToQuery] = useState('')

  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null)
  /** True when catalog/list price is missing — cost stays editable even after a manual amount is entered. */
  const [allowManualCost, setAllowManualCost] = useState(false)
  const [patientCategory, setPatientCategory] = useState('')
  const [labBasket, setLabBasket] = useState<LabRequestItem[]>([])
  const [lineDiscounts, setLineDiscounts] = useState<Record<string, LabLineDiscount>>({})
  const [generalLabDiscount, setGeneralLabDiscount] = useState(0)
  const [basketPricing, setBasketPricing] = useState<MultiLabRequestPricing>({ lines: [], subtotal: 0 })
  const [expandedLabGroups, setExpandedLabGroups] = useState<Record<string, boolean>>({})
  const [startedWithMultiLab, setStartedWithMultiLab] = useState(false)

  const hasMultiLabItems = labBasket.length > 0
  const basketWithDiscounts = useMemo(
    () => mergeDiscountsIntoBasket(labBasket, lineDiscounts),
    [labBasket, lineDiscounts]
  )

  const handleLineDiscountChange = (template: string, patch: Partial<LabLineDiscount>) => {
    setLineDiscounts((prev) => ({
      ...prev,
      [template]: {
        ...(prev[template] || defaultLineDiscount()),
        ...patch,
        discount_type: 'Amount',
        discount_rate: 0,
      },
    }))
  }

  const [formData, setFormData] = useState(defaultFormData)
  const [readOnly, setReadOnly] = useState<Record<string, unknown>>({})
  const isLabRequest = formData.template_dt === 'Lab Test Template'
  const isOtherService = isOtherServiceRequest(formData.template_dt)
  const orderingClinicianLabel = serviceRequestPractitionerLabel(formData.template_dt)

  const labTemplateLabel = (template: string) => {
    const fromLine = basketPricing.lines?.find((l) => l.template === template)
    if (fromLine?.lab_test_name) return fromLine.lab_test_name
    return templates.find((t) => t.name === template)?.label || template
  }

  const removeBasketChild = (basketIndex: number, childTemplate: string) => {
    setLabBasket((prev) => {
      const next = [...prev]
      const item = next[basketIndex]
      if (!item || item.kind !== 'group') return prev
      const children = item.children.filter((c) => c !== childTemplate)
      if (children.length === 0) {
        setError('A group must keep at least one child test. Remove the whole group instead.')
        return prev
      }
      setError(null)
      const child_discounts = item.child_discounts ? { ...item.child_discounts } : undefined
      if (child_discounts) delete child_discounts[childTemplate]
      next[basketIndex] = {
        ...item,
        children,
        child_discounts:
          child_discounts && Object.keys(child_discounts).length ? child_discounts : undefined,
      }
      return next
    })
  }

  const removeBasketItem = (basketIndex: number) => {
    setLabBasket((prev) => prev.filter((_, i) => i !== basketIndex))
    setError(null)
  }

  /* ────────────── INITIAL LOAD ────────────── */

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [doc, types, practs] = await Promise.all([
          fetchServiceRequest(serviceRequestName),
          fetchServiceRequestTemplateTypes(),
          fetchHealthcarePractitioners()
        ])
        setTemplateTypes(types)
        setPractitioners(practs)

        const patient = (doc.patient as string) || ''
        const patientName = (doc.patient_name as string) || patient
        setPatientQuery(patientName)
        setSelectedPatient(patient ? { name: patient, patient_name: patientName } as PatientListItem : null)

        setFormData({
          template_dt: (doc.template_dt as string) || '',
          template_dn: (doc.template_dn as string) || '',
          practitioner: (doc.practitioner as string) || '',
          patient_visit: (doc.patient_visit as string) || '',
          inpatient_record: (doc.inpatient_record as string) || '',
          order_date: (doc.order_date as string) ? String(doc.order_date).slice(0, 10) : new Date().toISOString().split('T')[0],
          order_time: (doc.order_time as string) ? String(doc.order_time).slice(0, 5) : new Date().toTimeString().slice(0, 5),
          department: (doc.medical_department as string) || '',
          status: (doc.status as string) || '',
          priority: (doc.priority as string) || '',
          intent: (doc.intent as string) || '',
          quantity: typeof doc.quantity === 'number' ? doc.quantity : 1,
          order_description: (doc.order_description as string) || '',
          patient_instructions: (doc.patient_instructions as string) || '',
          expected_date: (doc.expected_date as string) ? String(doc.expected_date).slice(0, 10) : '',
          cost: (doc.cost as number) ?? '',
          amount: (doc.amount as number) ?? '',
          source: (doc.source as string) || '',
          referring_practitioner: (doc.referring_practitioner as string) || '',
          referred_to_practitioner: (doc.referred_to_practitioner as string) || '',
          staff_role: (doc.staff_role as string) || '',
          patient_care_type: (doc.patient_care_type as string) || '',
          healthcare_service_unit_type: (doc.healthcare_service_unit_type as string) || '',
          as_needed: !!doc.as_needed,
          occurrence_date: (doc.occurrence_date as string) ? String(doc.occurrence_date).slice(0, 10) : '',
          occurrence_time: (doc.occurrence_time as string) ? String(doc.occurrence_time).slice(0, 5) : '',
          dosage_form: (doc.dosage_form as string) || '',
          dosage: (doc.dosage as string) || '',
          period: (doc.period as string) || '',
          order_group: (doc.order_group as string) || '',
          order_reference_doctype: (doc.order_reference_doctype as string) || '',
          order_reference_name: (doc.order_reference_name as string) || '',
          reference_document_type: (doc.reference_document_type as string) || '',
          reference_document_name: (doc.reference_document_name as string) || '',
          patient_category: (doc.patient_category as string) || '',
          discount_value:
            (doc.template_dt as string) === 'Lab Test Template'
              ? 'Amount'
              : (doc.discount_value as string) || 'Percentage',
          discount: (doc.discount as number) || 0,
          discount_amount: (doc.discount_amount as number) || 0,
          grand_total: (doc.grand_total as number) ?? (doc.cost as number) ?? 0
        })
        
        setPractQuery((doc.practitioner_name as string) || (doc.practitioner as string) || '')
        setReferringQuery((doc.referring_practitioner as string) || '')
        setReferredToQuery((doc.referred_to_practitioner as string) || '')

        const initialCost = (doc.cost as number) ?? null
        setSelectedPrice(initialCost)
        setAllowManualCost(!(initialCost != null && initialCost > 0))

        const parsedLabItems = parseLabRequestItems(doc.lab_request_items)
        setLabBasket(parsedLabItems)
        setStartedWithMultiLab(parsedLabItems.length > 0)
        setLineDiscounts(extractLineDiscountsFromBasket(parsedLabItems))
        setGeneralLabDiscount(Number(doc.general_discount_amount || 0))
        if ((doc.template_dt as string) === 'Lab Test Template') {
          setActiveTab('patient_order')
          try {
            const actions = await fetchLabRequestActions(serviceRequestName)
            if (!actions.can_edit_lab_request) {
              toast.error('This lab request cannot be edited after sample collection.')
              onClose()
              return
            }
          } catch {
            toast.error('Unable to verify if this lab request can be edited.')
            onClose()
            return
          }
        }

        // Load patient category for pricing highlight
        const patientId = (doc.patient as string) || ''
        if (patientId) {
          try {
            const catRes = await fetch(`/api/resource/Patient/${encodeURIComponent(patientId)}?fields=["category"]`)
            const catData = await catRes.json()
            setPatientCategory(catData?.data?.category || '')
          } catch { /* ignore */ }
        }

        // Load Lab Test Template pricing if applicable
        if ((doc.template_dt as string) === 'Lab Test Template' && (doc.template_dn as string)) {
          try {
            const pRes = await fetch(
              `/api/method/healthcare.api.service_request.get_lab_test_template_pricing?template=${encodeURIComponent(doc.template_dn as string)}`
            )
            const pData = await pRes.json()
            const rows: PricingRow[] = pData?.message || []
            setPricing(rows)
          } catch { /* ignore */ }
        }

        setReadOnly({
          patient_accepted_cost: doc.patient_accepted_cost,
          booked: doc.booked,
          sample_collection_required: doc.sample_collection_required,
          qty_invoiced: doc.qty_invoiced,
          billing_status: doc.billing_status
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load service request')
        toast.error(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [serviceRequestName])

  useEffect(() => {
    if (!hasMultiLabItems || !selectedPatient) {
      setBasketPricing({ lines: [], subtotal: 0 })
      return
    }
    const careType = formData.patient_visit ? 'OP' : formData.inpatient_record ? 'IP' : undefined
    getMultiLabRequestPricing(basketWithDiscounts, selectedPatient.name, careType)
      .then((pricing) => {
        setBasketPricing(pricing)
        setLineDiscounts((prev) => {
          let changed = false
          const next = { ...prev }
          for (const line of pricing.lines || []) {
            const existing = prev[line.template]
            const applied = Number(line.discount_applied || 0)
            if ((!existing || Number(existing.discount) === 0) && applied !== 0) {
              next[line.template] = {
                discount_type: 'Amount',
                discount: applied,
                discount_rate: 0,
              }
              changed = true
            }
          }
          return changed ? next : prev
        })
      })
      .catch(() => setBasketPricing({ lines: [], subtotal: 0 }))
  }, [hasMultiLabItems, selectedPatient, basketWithDiscounts, formData.patient_visit, formData.inpatient_record])

  /* ────────────── TEMPLATE CHANGE ────────────── */

  useEffect(() => {
    if (!formData.template_dt) {
      setTemplates([])
      return
    }
    fetchServiceRequestTemplates(formData.template_dt)
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [formData.template_dt])

  /* ────────────── LOAD PRICING WHEN TEMPLATE CHANGES ────────────── */

  useEffect(() => {
    if (!formData.template_dt || !formData.template_dn) {
      setPricing([])
      return
    }
    const careType = formData.patient_visit ? 'OP' : formData.inpatient_record ? 'IP' : ''
    const load = async () => {
      try {
        const params = new URLSearchParams({
          template_dt: formData.template_dt,
          template_dn: formData.template_dn,
          patient_care_type: careType,
        })
        if (selectedPatient?.name) {
          params.set('patient', selectedPatient.name)
        }
        const res = await fetch(
          `/api/method/healthcare.api.service_request.get_service_request_template_pricing?${params}`
        )
        const resData = await res.json()
        const payload = resData?.message || {}
        const rows: PricingRow[] = Array.isArray(payload.pricing) ? payload.pricing : []
        setPricing(rows)

        let match: PricingRow | undefined
        if (rows.length > 0 && patientCategory) {
          match = rows.find((r) => r.patient_category === patientCategory && r.price != null)
        }
        if (!match) {
          match = rows.find((r) => r.price != null)
        }
        const catalogPrice = match?.price != null ? Number(match.price) : null
        const hasCatalogPrice = catalogPrice != null && catalogPrice > 0
        setAllowManualCost(!hasCatalogPrice)
        if (hasCatalogPrice) {
          setSelectedPrice(catalogPrice)
          const insPct = Number(match?.discount_pct || 0)
          const insAmt =
            match?.discount_amount != null && Number(match.discount_amount) > 0
              ? Number(match.discount_amount)
              : insPct > 0
                ? ((catalogPrice as number) * insPct) / 100
                : 0
          setFormData((prev) => {
            // Prefer saved discount; auto-fill insurance only when empty.
            const hasSavedDisc = Number(prev.discount) !== 0 || Number(prev.discount_amount) !== 0
            return {
              ...prev,
              cost: catalogPrice as number,
              ...(hasSavedDisc
                ? {}
                : {
                    discount: insPct,
                    discount_value: insPct > 0 ? 'Percentage' : prev.discount_value,
                    discount_amount: insAmt,
                  }),
            }
          })
        }
      } catch {
        setPricing([])
        setAllowManualCost(true)
      }
    }
    load()
  }, [formData.template_dt, formData.template_dn, patientCategory, formData.patient_visit, formData.inpatient_record, selectedPatient?.name])

  /* ────────────── LOAD VISITS + ADMISSIONS ────────────── */

  useEffect(() => {
    if (!selectedPatient) return
    fetchPatientVisits(selectedPatient.name).then(setPatientVisits).catch(() => setPatientVisits([]))
    fetchInpatientAdmissions(selectedPatient.name).then(setAdmissions).catch(() => setAdmissions([]))
  }, [selectedPatient])

  /* ────────────── PATIENT SEARCH ────────────── */

  useEffect(() => {
    if (!patientOpen) return
    const search = async () => {
      setLoadingPatients(true)
      try {
        const results = patientQuery.trim() === ''
          ? await fetchPatients(20, 0)
          : await searchPatients(patientQuery, 20)
        setPatients(results)
      } finally {
        setLoadingPatients(false)
      }
    }
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [patientQuery, patientOpen])

  /* ────────────── PRACTITIONER SEARCH ────────────── */

  useEffect(() => {
    if (!practOpen) return
    const t = setTimeout(() => {
      fetchHealthcarePractitioners(practQuery || undefined).then(setPractitioners)
    }, 300)
    return () => clearTimeout(t)
  }, [practQuery, practOpen])

  /* ────────────── RECALCULATE GRAND TOTAL ────────────── */

  useEffect(() => {
    if (hasMultiLabItems) return
    if (selectedPrice === null) {
      setFormData(prev => ({ ...prev, grand_total: 0, discount_amount: 0 }))
      return
    }

    let total = selectedPrice
    const isLab = formData.template_dt === 'Lab Test Template'
    const isPercentage =
      !isLab &&
      formData.discount_value !== 'Fixed Amount' &&
      formData.discount_value !== 'Amount'

    if (isPercentage && formData.discount !== 0) {
      const discAmt = (total * formData.discount) / 100
      setFormData(prev => ({ ...prev, discount_amount: discAmt }))
      total -= discAmt
    } else if (!isPercentage) {
      total -= formData.discount_amount
    } else {
      setFormData(prev => ({ ...prev, discount_amount: 0 }))
    }

    setFormData(prev => ({ ...prev, grand_total: total }))
  }, [selectedPrice, formData.discount_value, formData.discount, formData.discount_amount, formData.template_dt, hasMultiLabItems])

  useEffect(() => {
    if (!hasMultiLabItems) return
    const lineDiscountAmount = basketPricing.discount_amount || 0
    const lineGrandTotal = basketPricing.grand_total ?? basketPricing.subtotal
    setFormData((prev) => ({
      ...prev,
      cost: basketPricing.subtotal,
      discount_value: 'Amount',
      discount: 0,
      discount_amount: lineDiscountAmount + generalLabDiscount,
      grand_total: lineGrandTotal - generalLabDiscount,
    }))
  }, [hasMultiLabItems, basketPricing, generalLabDiscount])

  /* ────────────── SUBMIT ────────────── */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (!selectedPatient) {
      setError('Please select a patient')
      setActiveTab('patient_order')
      return
    }
    
    if (!formData.template_dt || !formData.template_dn) {
      setError('Please select template type and template')
      setActiveTab(isLabRequest ? 'patient_order' : 'service_details')
      return
    }

    if (
      allowManualCost &&
      !hasMultiLabItems &&
      !(selectedPrice != null && selectedPrice > 0) &&
      !isOtherService
    ) {
      setError('Enter an amount for this item/service (no price configured).')
      setActiveTab('billing_pricing')
      return
    }
    if (startedWithMultiLab && labBasket.length === 0) {
      setError('Keep at least one lab test in the request, or cancel instead.')
      setActiveTab('patient_order')
      return
    }
    if (
      hasMultiLabItems &&
      (basketPricing.grand_total ?? basketPricing.subtotal) - generalLabDiscount < 0
    ) {
      setError('General discount cannot be greater than the total after per-test discounts.')
      setActiveTab('billing_pricing')
      return
    }
    
    try {
      setSubmitting(true)
      const payload: UpdateServiceRequestData = {
        patient: selectedPatient.name,
        template_dt: formData.template_dt,
        template_dn: formData.template_dn,
        practitioner: formData.practitioner || undefined,
        patient_visit: formData.patient_visit || undefined,
        inpatient_record: formData.inpatient_record || undefined,
        order_date: formData.order_date,
        order_time: formData.order_time,
        department: formData.department || undefined,
        status: formData.status || undefined,
        priority: formData.priority || undefined,
        intent: formData.intent || undefined,
        quantity: formData.quantity,
        order_description: formData.order_description || undefined,
        patient_instructions: formData.patient_instructions || undefined,
        expected_date: formData.expected_date || undefined,
        cost: selectedPrice ?? undefined,
        amount: formData.amount === '' ? undefined : Number(formData.amount),
        source: formData.source || undefined,
        referring_practitioner: formData.referring_practitioner || undefined,
        referred_to_practitioner: formData.referred_to_practitioner || undefined,
        staff_role: formData.staff_role || undefined,
        patient_care_type: formData.patient_care_type || undefined,
        healthcare_service_unit_type: formData.healthcare_service_unit_type || undefined,
        as_needed: formData.as_needed,
        occurrence_date: formData.occurrence_date || undefined,
        occurrence_time: formData.occurrence_time || undefined,
        dosage_form: formData.dosage_form || undefined,
        dosage: formData.dosage || undefined,
        period: formData.period || undefined,
        order_group: formData.order_group || undefined,
        patient_category: formData.patient_category || undefined,
        discount_value: formData.discount_value || undefined,
        discount: formData.discount,
        discount_amount: formData.discount_amount,
        grand_total: formData.grand_total
      }

      if (hasMultiLabItems || startedWithMultiLab) {
        payload.lab_request_items = serializeLabRequestItemsForSave(basketWithDiscounts)
        payload.cost = basketPricing.subtotal
        payload.general_discount_amount = generalLabDiscount
        payload.discount_amount = (basketPricing.discount_amount || 0) + generalLabDiscount
        payload.grand_total =
          (basketPricing.grand_total ?? basketPricing.subtotal) - generalLabDiscount
        payload.discount = 0
        payload.discount_value = 'Amount'
      }
      
      const result = await updateServiceRequest(serviceRequestName, payload)
      if (isLabRequest && result.sales_order_recreated && result.sales_order) {
        const previous = result.previous_sales_order
          ? ` Previous order ${result.previous_sales_order} was cancelled.`
          : ''
        toast.success(
          `Lab request saved. Billing was updated — new Sales Order ${result.sales_order}.${previous}`
        )
      } else if (isLabRequest) {
        toast.success('Lab request saved successfully.')
      } else {
        toast.success('Service request updated')
      }
      onSuccess()
      onClose()
    } catch (err) {
      const msg =
        err instanceof Error && err.message.trim()
          ? err.message
          : isLabRequest
            ? 'Could not save the lab request. Please try again.'
            : 'Failed to update service request'
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const set = (field: keyof typeof formData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const displayReferring = referringOpen ? referringQuery : (practitioners.find(p => p.name === formData.referring_practitioner)?.label || formData.referring_practitioner || '')
  const displayReferredTo = referredToOpen ? referredToQuery : (practitioners.find(p => p.name === formData.referred_to_practitioner)?.label || formData.referred_to_practitioner || '')

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-8 text-center text-slate-600">
          Loading service request…
        </div>
      </div>
    )
  }

  const tabs: { id: SRTab; label: string }[] = isLabRequest
    ? [
        { id: 'patient_order', label: 'Patient & Tests' },
        { id: 'billing_pricing', label: 'Billing & Pricing' },
      ]
    : [
        { id: 'patient_order', label: 'Patient & Order' },
        { id: 'service_details', label: 'Service & Details' },
        { id: 'billing_pricing', label: 'Billing & Pricing' },
      ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        
        {/* HEADER */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {isLabRequest ? 'Edit Lab Request' : 'Edit Service Request'} — {serviceRequestName}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TABS */}
        <div className="flex border-b border-slate-200 px-6 flex-shrink-0 bg-slate-50">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">
          {error && (
            <div className="mx-6 mt-3 flex-shrink-0 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-4">
            
            {/* ═══════════ TAB 1: PATIENT & ORDER ═══════════ */}
            {activeTab === 'patient_order' && (
              <div className="space-y-4">
                
                {/* PATIENT */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Patient <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input
                      type="text"
                      value={selectedPatient ? (selectedPatient.patient_name || selectedPatient.name) : patientQuery}
                      onChange={(e) => {
                        setPatientQuery(e.target.value)
                        setSelectedPatient(null)
                        setPatientOpen(true)
                      }}
                      onFocus={() => setPatientOpen(true)}
                      placeholder="Search patient..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    {patientOpen && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {loadingPatients ? (
                          <div className="px-3 py-2 text-xs text-slate-500">Loading...</div>
                        ) : patients.length ? (
                          patients.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-slate-100 last:border-0 transition"
                              onClick={() => {
                                setSelectedPatient(p)
                                setPatientQuery(p.patient_name || p.name)
                                set('patient_category', (p as any).patient_category || (p as any).category || '')
                                setPatientOpen(false)
                              }}
                            >
                              <div className="font-medium text-slate-900">{p.patient_name || p.name}</div>
                              {p.file_number && <div className="text-xs text-slate-500">File: {p.file_number}</div>}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-xs text-slate-500">NO PATIENTS FOUND</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {isLabRequest ? (
                  hasMultiLabItems || startedWithMultiLab ? (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
                      <label className="mb-1 block text-sm font-semibold text-slate-900">
                        Lab tests in this request
                      </label>
                      <p className="mb-3 text-xs text-slate-600">
                        Expand a group to remove individual child tests. Saving updates the request
                        and deletes matching draft Lab Tests that are still in Requested status.
                      </p>
                      <ul className="space-y-2">
                        {labBasket.map((item, index) => {
                          const template = item.kind === 'single' ? item.template : item.parent
                          const itemKey = `${item.kind}-${template}-${index}`
                          const isExpanded = item.kind === 'group' && !!expandedLabGroups[itemKey]
                          return (
                            <li
                              key={itemKey}
                              className="rounded-xl border border-slate-200/90 bg-white px-3 py-2.5"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <button
                                  type="button"
                                  disabled={item.kind !== 'group'}
                                  onClick={() => {
                                    if (item.kind !== 'group') return
                                    setExpandedLabGroups((prev) => ({
                                      ...prev,
                                      [itemKey]: !prev[itemKey],
                                    }))
                                  }}
                                  className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
                                    item.kind === 'group' ? 'cursor-pointer' : 'cursor-default'
                                  }`}
                                  aria-expanded={item.kind === 'group' ? isExpanded : undefined}
                                >
                                  {item.kind === 'group' && (
                                    <ChevronDown
                                      className={`h-4 w-4 shrink-0 text-violet-600 transition-transform ${
                                        isExpanded ? 'rotate-180' : ''
                                      }`}
                                    />
                                  )}
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium text-slate-900">
                                      {labTemplateLabel(template)}
                                      {item.kind === 'group' ? ` (${item.children.length} tests)` : ''}
                                    </span>
                                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                                      ID: {template}
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeBasketItem(index)}
                                  className="shrink-0 text-xs font-semibold text-red-600 hover:text-red-800"
                                >
                                  Remove
                                </button>
                              </div>
                              {item.kind === 'group' && isExpanded && (
                                <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 pl-6">
                                  {item.children.map((child) => (
                                    <li
                                      key={child}
                                      className="flex items-center justify-between gap-2 rounded-lg bg-violet-50/60 px-3 py-2"
                                    >
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium text-slate-800">
                                          {labTemplateLabel(child)}
                                        </span>
                                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                                          ID: {child}
                                        </span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => removeBasketChild(index, child)}
                                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                                        title="Remove this child test from the group"
                                      >
                                        <Trash2 className="h-3 w-3" strokeWidth={2} />
                                        Remove
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                      No lab test lines on this request.
                    </div>
                  )
                ) : null}

                {!isLabRequest ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Patient Visit</label>
                    <select
                      value={formData.patient_visit}
                      onChange={(e) => set('patient_visit', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
                    >
                      <option value="">Select visit</option>
                      {patientVisits.map((v) => (
                        <option key={v.name} value={v.name}>{v.label || v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Inpatient Admission</label>
                    <select
                      value={formData.inpatient_record}
                      onChange={(e) => set('inpatient_record', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
                    >
                      <option value="">Select admission</option>
                      {admissions.map((a) => (
                        <option key={a.name} value={a.name}>{a.label || a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                ) : null}

                {!isLabRequest ? (
                <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Order Date <span className="text-red-500">*</span></label>
                    <DateFilterInput
                      value={formData.order_date}
                      onChange={(e) => set('order_date', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Order Time</label>
                    <input
                      type="time"
                      value={formData.order_time}
                      onChange={(e) => set('order_time', e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">
                    {isOtherService ? `Ordered by ${orderingClinicianLabel}` : 'Ordered by Doctor'}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={practQuery}
                      onChange={(e) => {
                        setPractQuery(e.target.value)
                        set('practitioner', '')
                        setPractOpen(true)
                      }}
                      onFocus={() => setPractOpen(true)}
                      placeholder={isOtherService ? 'Search nurse…' : 'Search doctor...'}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    {practOpen && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {practitioners.map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-slate-100 last:border-0 transition"
                            onClick={() => {
                              set('practitioner', p.name)
                              setPractQuery(p.label || p.name)
                              setPractOpen(false)
                            }}
                          >
                            <div className="font-medium">{p.label || p.name}</div>
                            <div className="text-xs text-slate-500">{p.name}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Medical Department</label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => set('department', e.target.value)}
                    placeholder="Medical department"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Source</label>
                  <select
                    value={formData.source}
                    onChange={(e) => set('source', e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
                  >
                    <option value="">—</option>
                    <option value="Direct">Direct</option>
                    <option value="Referral">Referral</option>
                    <option value="External Referral">External Referral</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Referring Doctor</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={displayReferring}
                      onChange={(e) => {
                        setReferringQuery(e.target.value)
                        set('referring_practitioner', '')
                        setReferringOpen(true)
                      }}
                      onFocus={() => setReferringOpen(true)}
                      placeholder="Search..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    {referringOpen && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {practitioners.filter(p => !referringQuery || (p.label || p.name).toLowerCase().includes(referringQuery.toLowerCase())).map((p) => (
                          <button key={p.name} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-slate-100 last:border-0 transition" onClick={() => { set('referring_practitioner', p.name); setReferringQuery(p.label || p.name); setReferringOpen(false) }}>
                            <div className="font-medium">{p.label || p.name}</div>
                            <div className="text-xs text-slate-500">{p.name}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Referred to Doctor</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={displayReferredTo}
                      onChange={(e) => {
                        setReferredToQuery(e.target.value)
                        set('referred_to_practitioner', '')
                        setReferredToOpen(true)
                      }}
                      onFocus={() => setReferredToOpen(true)}
                      placeholder="Search..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    {referredToOpen && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                        {practitioners.filter(p => !referredToQuery || (p.label || p.name).toLowerCase().includes(referredToQuery.toLowerCase())).map((p) => (
                          <button key={p.name} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-slate-100 last:border-0 transition" onClick={() => { set('referred_to_practitioner', p.name); setReferredToQuery(p.label || p.name); setReferredToOpen(false) }}>
                            <div className="font-medium">{p.label || p.name}</div>
                            <div className="text-xs text-slate-500">{p.name}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Expected Date</label>
                    <DateFilterInput value={formData.expected_date} onChange={(e) => set('expected_date', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Order Group</label>
                    <input type="text" value={formData.order_group} onChange={(e) => set('order_group', e.target.value)} placeholder="Optional" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                </div>
                </>
                ) : null}
              </div>
            )}

            {/* ═══════════ TAB 2: SERVICE & DETAILS ═══════════ */}
            {activeTab === 'service_details' && !isLabRequest && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Template Type <span className="text-red-500">*</span></label>
                    <select value={formData.template_dt} onChange={(e) => set('template_dt', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent bg-white">
                      <option value="">Select type</option>
                      {templateTypes.map((t) => <option key={t.name} value={t.name}>{t.label || t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Template <span className="text-red-500">*</span></label>
                    <select value={formData.template_dn} disabled={!formData.template_dt} onChange={(e) => set('template_dn', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent bg-white disabled:bg-slate-50">
                      <option value="">Select template</option>
                      {templates.map((t) => <option key={t.name} value={t.name}>{t.label || t.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Status</label>
                    <input type="text" value={formData.status} onChange={(e) => set('status', e.target.value)} placeholder="e.g. draft" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Priority</label>
                    <input type="text" value={formData.priority} onChange={(e) => set('priority', e.target.value)} placeholder="Optional" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Intent</label>
                    <input type="text" value={formData.intent} onChange={(e) => set('intent', e.target.value)} placeholder="Optional" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      value={formData.quantity}
                      onChange={(e) => set('quantity', parseInt(e.target.value, 10) || 1)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Cost</label>
                    <input
                      type="number"
                      step="any"
                      value={selectedPrice ?? ''}
                      readOnly={!allowManualCost}
                      onChange={(e) => {
                        if (!allowManualCost) return
                        const val = e.target.value === '' ? 0 : parseFloat(e.target.value)
                        setSelectedPrice(Number.isNaN(val) ? 0 : val)
                        set('cost', Number.isNaN(val) ? 0 : val)
                      }}
                      className={
                        allowManualCost
                          ? 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent bg-white'
                          : 'w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600'
                      }
                      placeholder={allowManualCost ? 'Enter amount (no price)' : undefined}
                    />
                    {allowManualCost && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        {isOtherService
                          ? 'No catalog price — leave blank if no payment is required, or enter an amount to charge.'
                          : 'No price on this item/service — enter the amount to charge.'}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Approved Amount</label>
                    <input
                      type="number"
                      step="any"
                      value={formData.amount}
                      onChange={(e) => set('amount', e.target.value === '' ? '' : e.target.value)}
                      placeholder="0"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Order Description</label>
                  <textarea value={formData.order_description} onChange={(e) => set('order_description', e.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Patient Instructions</label>
                  <textarea value={formData.patient_instructions} onChange={(e) => set('patient_instructions', e.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" placeholder="Optional" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Staff Role</label>
                    <input type="text" value={formData.staff_role} onChange={(e) => set('staff_role', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Patient Care Type</label>
                    <input type="text" value={formData.patient_care_type} onChange={(e) => set('patient_care_type', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Healthcare Service Unit Type</label>
                  <input type="text" value={formData.healthcare_service_unit_type} onChange={(e) => set('healthcare_service_unit_type', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="as_needed" checked={formData.as_needed} onChange={(e) => set('as_needed', e.target.checked)} className="rounded border-slate-300 text-primary focus:ring-primary" />
                  <label htmlFor="as_needed" className="text-sm font-medium text-slate-900">Occurrence As Needed</label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Occurrence Date</label>
                    <DateFilterInput value={formData.occurrence_date} onChange={(e) => set('occurrence_date', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Occurrence Time</label>
                    <input type="time" value={formData.occurrence_time} onChange={(e) => set('occurrence_time', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Dosage Form</label>
                    <input type="text" value={formData.dosage_form} onChange={(e) => set('dosage_form', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Dosage</label>
                    <input type="text" value={formData.dosage} onChange={(e) => set('dosage', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Period</label>
                    <input type="text" value={formData.period} onChange={(e) => set('period', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════ TAB 3: BILLING & PRICING ═══════════ */}
            {activeTab === 'billing_pricing' && (
              <div className="space-y-4">

                {/* PRICING TABLE */}
                {pricing.length > 0 && (
                  <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <label className="block text-sm font-semibold text-slate-900 mb-3">
                      Price by Patient Category
                    </label>
                    <div className="space-y-2">
                      {pricing.map((row, idx) => (
                        <label key={idx} className={`flex items-center gap-3 p-2 rounded cursor-pointer transition ${row.patient_category === patientCategory ? 'bg-green-50 border border-green-200' : 'hover:bg-white'}`}>
                          <input
                            type="radio"
                            name="edit_pricing"
                            checked={selectedPrice === row.price}
                            onChange={() => setSelectedPrice(row.price || null)}
                            className="w-4 h-4 text-primary focus:ring-primary border-slate-300"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-slate-900">{row.patient_category}</span>
                            {row.patient_category === patientCategory && (
                              <span className="ml-2 text-xs text-green-600 font-medium">(Patient's category)</span>
                            )}
                            {row.multiplier != null && (
                              <span className="ml-2 text-xs text-slate-500">× {row.multiplier}</span>
                            )}
                          </div>
                          <div className="text-sm font-semibold text-slate-900">{row.price?.toFixed(2) || 'N/A'}</div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* DISCOUNT SECTION */}
                {hasMultiLabItems && basketPricing.lines.length > 0 ? (
                  <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                    <label className="block text-sm font-semibold text-slate-900 mb-1">
                      Lab test discounts
                    </label>
                    <p className="text-xs text-slate-500 mb-4">
                      Set individual test discounts below, then optionally apply one general
                      discount to the whole request.
                    </p>
                    <div className="mb-4 rounded-xl border border-blue-200 bg-white p-3">
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        General discount amount
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={generalLabDiscount === 0 ? '' : generalLabDiscount}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            setGeneralLabDiscount(0)
                            return
                          }
                          const value = Number(raw)
                          if (!Number.isNaN(value)) setGeneralLabDiscount(value)
                        }}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-transparent focus:ring-2 focus:ring-primary"
                        placeholder="0"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Applied once to the request total—not once per test.
                      </p>
                    </div>
                    <LabTestLineDiscountTable
                      lines={basketPricing.lines}
                      lineDiscounts={lineDiscounts}
                      onChange={handleLineDiscountChange}
                    />
                    <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">List total</span>
                        <span className="font-medium tabular-nums">{basketPricing.subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">Per-test discounts</span>
                        <span className="font-medium tabular-nums">
                          −{(basketPricing.discount_amount || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">General discount</span>
                        <span className="font-medium tabular-nums">−{generalLabDiscount.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                        <span className="text-sm font-semibold text-slate-900">Grand Total</span>
                        <span className="text-lg font-bold tabular-nums text-primary">
                          {((basketPricing.grand_total ?? basketPricing.subtotal) - generalLabDiscount).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : selectedPrice !== null && (
                  <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                    <label className="block text-sm font-semibold text-slate-900 mb-1">
                      {isLabRequest ? 'Discount' : 'Discount Management'}
                    </label>
                    <p className="text-xs text-slate-500 mb-4">
                      Base price: <strong>{(selectedPrice || 0).toFixed(2)}</strong>
                      {' · '}Negative discount values add a surcharge.
                    </p>

                    <div className={`grid gap-4 mb-4 ${isLabRequest ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-3'}`}>
                      {!isLabRequest ? (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-2">
                          Discount Margin
                        </label>
                        <select
                          value={formData.discount_value}
                          onChange={(e) => set('discount_value', e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
                        >
                          <option value="Percentage">Percentage (%)</option>
                          <option value="Amount">Fixed Amount</option>
                          <option value="Fixed Amount">Fixed Amount (legacy)</option>
                        </select>
                      </div>
                      ) : null}

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-2">
                          {isLabRequest || formData.discount_value === 'Fixed Amount' || formData.discount_value === 'Amount'
                            ? 'Discount amount'
                            : 'Discount (%)'}
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={
                            isLabRequest || formData.discount_value === 'Fixed Amount' || formData.discount_value === 'Amount'
                              ? (formData.discount_amount === 0 ? '' : formData.discount_amount)
                              : (formData.discount === 0 ? '' : formData.discount)
                          }
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              if (isLabRequest || formData.discount_value === 'Fixed Amount' || formData.discount_value === 'Amount') {
                                set('discount_amount', 0)
                                if (isLabRequest) {
                                  set('discount', 0)
                                  set('discount_value', 'Amount')
                                }
                              } else {
                                set('discount', 0)
                              }
                              return
                            }
                            const val = Number(raw)
                            if (Number.isNaN(val)) return
                            if (isLabRequest || formData.discount_value === 'Fixed Amount' || formData.discount_value === 'Amount') {
                              set('discount_amount', val)
                              if (isLabRequest) {
                                set('discount', 0)
                                set('discount_value', 'Amount')
                              }
                            } else {
                              set('discount', val)
                            }
                          }}
                          placeholder="0"
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                      </div>

                      {!isLabRequest ? (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-2">
                          Calculated Discount
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={formData.discount_amount.toFixed(2)}
                          className="w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                        />
                      </div>
                      ) : null}
                    </div>

                    <div className="bg-white rounded-md border border-slate-200 p-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-900">Grand Total</span>
                      <span className="text-lg font-bold text-primary">{formData.grand_total.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {!isLabRequest ? (
                  <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Reference Document Type</label>
                    <input type="text" value={formData.reference_document_type} readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Reference Document Name</label>
                    <input type="text" value={formData.reference_document_name} readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Patient Accepted Cost</span>
                    <span className="font-medium">{readOnly.patient_accepted_cost ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Forwarded to Lab</span>
                    <span className="font-medium">{readOnly.booked ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Sample Collection Required</span>
                    <span className="font-medium">{readOnly.sample_collection_required ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Qty Invoiced</span>
                    <span className="font-medium">{String(readOnly.qty_invoiced ?? '—')}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Billing Status</span>
                    <span className="font-medium">{String(readOnly.billing_status ?? '—')}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Order Reference DocType</label>
                    <input type="text" value={formData.order_reference_doctype} readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Order Reference Name</label>
                    <input type="text" value={formData.order_reference_name} readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
                  </div>
                </div>
                  </>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 flex justify-end gap-3 p-6 border-t border-slate-200 bg-white">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition">
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}