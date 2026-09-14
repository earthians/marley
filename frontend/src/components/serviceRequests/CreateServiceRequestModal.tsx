import { useEffect, useMemo, useState } from 'react'
import { Calendar, ChevronDown, ClipboardList, Layers, Stethoscope, Trash2, User, Wallet } from 'lucide-react'
import { fetchPatients, searchPatients, type PatientListItem } from '../../services/patients'
import {
  fetchCostCenters,
  fetchHealthcarePractitioners,
  fetchInpatientAdmissions,
  fetchPatientVisits,
  fetchPractitionerLabReviewFlags,
  fetchServiceRequestTemplateTypes,
  fetchServiceRequestTemplates,
  syncCostCenterFromCareEpisode,
  type LinkFieldOption,
} from '../../services/common'
import {
  createServiceRequest,
  getMultiLabRequestPricing,
  type LabRequestItem,
  type MultiLabRequestPricing,
} from '../../services/serviceRequests'
import { LabTestLineDiscountTable } from './LabTestLineDiscountTable'
import {
  defaultLineDiscount,
  mergeDiscountsIntoBasket,
  type LabLineDiscount,
} from '../../utils/labTestDiscounts'
import { toast } from '../../hooks/useToast'
import {
  LOCKED_PRACTITIONER_INPUT_CLASS,
  useLockedLinkedPractitioner,
} from '../../hooks/useLockedLinkedPractitioner'
import { useCareContext } from '../../providers/CareContextProvider'
import { useBlockIfActiveCareClosed } from '../../hooks/useBlockIfActiveCareClosed'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import {
  linkComboboxDropdownClass,
  linkComboboxDropdownClassShort,
  linkComboboxInputClass as inputClass,
} from '../ui/linkComboboxStyles'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_BODY_GRADIENT,
  CREATE_MODAL_FOOTER_STICKY,
  CREATE_MODAL_OVERLAY,
  CreateModalHeader,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import {
  isOtherServiceRequest,
  serviceRequestPractitionerLabel,
} from '../../utils/serviceRequestLabels'
import { DateFilterInput } from '../ui/DateFilterInput'

type LabTemplateGroupFilter = 'all' | 'group' | 'single'

interface CreateServiceRequestModalProps {
  onClose: () => void
  onSuccess: () => void
  initialPatient?: string
  initialTemplate?: string
  defaultTemplateType?: string
  /**
   * Doctor, Lab page, and template list “request lab” flows: template type read-only as Lab Test Template,
   * searchable templates, and optional group/single filter (`is_group` on Lab Test Template).
   */
  labTestTemplateOnly?: boolean
  /** When creating Lab Requests as a nurse: only show By Nurse templates. */
  nurseLabTemplatesOnly?: boolean
  /** Override care context mode (e.g. create lab request from an IP admission panel). */
  forcedMode?: 'OP' | 'IP'
  /** Prefill / lock inpatient admission when creating from an admission context. */
  initialInpatientRecord?: string
  /** Prefill / lock patient visit when creating from a visit details panel. */
  initialPatientVisit?: string
}

interface PricingRow {
  patient_category: string
  multiplier?: number | null
  /** Inclusive / catalog list price (before insurance %) */
  price: number | null
  discount_pct?: number | null
  discount_amount?: number | null
  rate?: number | null
}

interface GroupTemplateRow {
  template_dn: string
  template_label: string
  pricing: PricingRow[]
  price_included_in_group?: number | boolean
}

interface PricingResponse {
  is_group?: boolean
  pricing?: PricingRow[]
  group_templates?: GroupTemplateRow[]
}

const selectClass = inputClass

const labelClass = 'mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500'

const sectionCard = 'rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5'
const sectionTitle = 'mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-900/90'

export const CreateServiceRequestModal = ({
  onClose,
  onSuccess,
  initialPatient,
  initialTemplate,
  defaultTemplateType,
  labTestTemplateOnly = false,
  nurseLabTemplatesOnly = false,
  forcedMode,
  initialInpatientRecord,
  initialPatientVisit,
}: CreateServiceRequestModalProps) => {
  const { mode: contextMode, activeVisit, activeAdmission, selectedPatient: contextPatient } = useCareContext()
  const mode = forcedMode || contextMode
  const blockIfActiveCareClosed = useBlockIfActiveCareClosed()
  const formatMoney = useFormatMoney()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [templateTypes, setTemplateTypes] = useState<LinkFieldOption[]>([])
  const [templates, setTemplates] = useState<LinkFieldOption[]>([])
  const [labTemplateLabels, setLabTemplateLabels] = useState<Record<string, string>>({})
  const [expandedLabGroups, setExpandedLabGroups] = useState<Record<string, boolean>>({})
  const [templateSearchQuery, setTemplateSearchQuery] = useState('')
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false)
  const [labTemplateFilter, setLabTemplateFilter] = useState<LabTemplateGroupFilter>('all')
  const [practitionerOptions, setPractitionerOptions] = useState<LinkFieldOption[]>([])
  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState('')
  const [practitionerDropdownOpen, setPractitionerDropdownOpen] = useState(false)
  const {
    locked: practitionerLocked,
    practitionerId: linkedPractitionerId,
    practitionerLabel: linkedPractitionerLabel,
  } = useLockedLinkedPractitioner()
  const [consultantOptions, setConsultantOptions] = useState<LinkFieldOption[]>([])
  const [consultantSearchQuery, setConsultantSearchQuery] = useState('')
  const [consultantDropdownOpen, setConsultantDropdownOpen] = useState(false)
  const [ordererFlags, setOrdererFlags] = useState<{
    gp_doctor: boolean
    consultants: boolean
    loaded: boolean
  }>({ gp_doctor: false, consultants: false, loaded: false })
  const [costCenterOptions, setCostCenterOptions] = useState<LinkFieldOption[]>([])
  const [costCenterSearchQuery, setCostCenterSearchQuery] = useState('')
  const [costCenterDropdownOpen, setCostCenterDropdownOpen] = useState(false)
  const [patientVisits, setPatientVisits] = useState<LinkFieldOption[]>([])
  const [admissions, setAdmissions] = useState<LinkFieldOption[]>([])

  const [patientQuery, setPatientQuery] = useState(initialPatient || contextPatient || '')
  const [patientOptions, setPatientOptions] = useState<PatientListItem[]>([])
  /** Loaded for internal best-price picking only — not shown on the clinician ordering UI */
  const [patientCategory, setPatientCategory] = useState('')
  const [patientOpen, setPatientOpen] = useState(false)

  const [pricingRows, setPricingRows] = useState<PricingRow[]>([])
  const [groupRows, setGroupRows] = useState<GroupTemplateRow[]>([])
  const [selectedGroupTemplates, setSelectedGroupTemplates] = useState<string[]>([])
  /** Discount amount shown in the UI (auto-filled from insurance % when applicable) */
  const [discountPct, setDiscountPct] = useState(0)
  /** Insurance discount % from pricing API — persisted on Service Request.discount */
  const [insuranceDiscountPct, setInsuranceDiscountPct] = useState(0)
  const [manualCost, setManualCost] = useState(0)
  const [lineDiscounts, setLineDiscounts] = useState<Record<string, LabLineDiscount>>({})
  const [generalLabDiscount, setGeneralLabDiscount] = useState(0)

  /** Multi-test lab basket (lab request flow only) */
  const [labBasket, setLabBasket] = useState<LabRequestItem[]>([])
  const [pendingTemplateDn, setPendingTemplateDn] = useState('')
  const [basketPricing, setBasketPricing] = useState<MultiLabRequestPricing>({ lines: [], subtotal: 0 })

  const [form, setForm] = useState({
    patient: initialPatient || contextPatient || '',
    template_dt: '',
    template_dn: '',
    practitioner: '',
    assigned_healthcare_practioner: '',
    patient_visit:
      mode === 'OP' ? (initialPatientVisit || activeVisit || '') : '',
    inpatient_record:
      mode === 'IP' ? (initialInpatientRecord || activeAdmission || '') : '',
    cost_center: '',
    order_date: new Date().toISOString().slice(0, 10),
    order_time: new Date().toTimeString().slice(0, 5),
  })

  const isGroupTemplate = groupRows.length > 0
  const useLabBasket = labTestTemplateOnly
  const isLabRequest = labTestTemplateOnly
  const isOtherService = isOtherServiceRequest(form.template_dt)
  const orderingClinicianLabel = serviceRequestPractitionerLabel(form.template_dt)

  const getBestPricingRow = (rows: PricingRow[]) => {
    if (!rows.length) return null
    if (patientCategory) {
      const match = rows.find((r) => r.patient_category === patientCategory && r.price != null)
      if (match) return match
    }
    return rows.find((r) => r.price != null) || null
  }

  const getBestPrice = (rows: PricingRow[]) => {
    const row = getBestPricingRow(rows)
    return row?.price != null ? Number(row.price) : null
  }

  const groupTotal = useMemo(() => {
    if (!isGroupTemplate) return 0
    // Group price + only children that are NOT marked price_included_in_group.
    const parentAmount = getBestPrice(pricingRows) || 0
    const extraChildren = selectedGroupTemplates.reduce((total, templateDn) => {
      const row = groupRows.find((entry) => entry.template_dn === templateDn)
      if (!row || row.price_included_in_group) return total
      return total + (getBestPrice(row.pricing) || 0)
    }, 0)
    return parentAmount + extraChildren
  }, [groupRows, isGroupTemplate, patientCategory, selectedGroupTemplates, pricingRows])

  const nonGroupListSubtotal = useMemo(() => {
    if (isGroupTemplate) return 0
    return getBestPrice(pricingRows) || 0
  }, [isGroupTemplate, pricingRows, patientCategory])

  const catalogListSubtotal = useLabBasket
    ? basketPricing.subtotal
    : isGroupTemplate
      ? groupTotal
      : nonGroupListSubtotal

  const priceMissing = !useLabBasket && catalogListSubtotal <= 0
  const listSubtotalBeforeDiscount = priceMissing ? manualCost : catalogListSubtotal

  const orderDiscountAmount = discountPct
  const estimatedTotalAfterDiscount = useLabBasket
    ? (basketPricing.grand_total ?? basketPricing.subtotal) - generalLabDiscount
    : listSubtotalBeforeDiscount - orderDiscountAmount

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

  const labTemplateLabel = (template: string) =>
    labTemplateLabels[template] || templates.find((row) => row.name === template)?.label || template

  const addPendingToBasket = () => {
    if (!pendingTemplateDn) return
    if (isGroupTemplate) {
      if (selectedGroupTemplates.length === 0) {
        setError('Select at least one child test for this group.')
        return
      }
      setLabBasket((prev) => [
        ...prev,
        { kind: 'group', parent: pendingTemplateDn, children: [...selectedGroupTemplates] },
      ])
    } else {
      setLabBasket((prev) => [...prev, { kind: 'single', template: pendingTemplateDn }])
    }
    setPendingTemplateDn('')
    setTemplateSearchQuery('')
    setForm((prev) => ({ ...prev, template_dn: '' }))
    setPricingRows([])
    setGroupRows([])
    setSelectedGroupTemplates([])
    setError(null)
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

  useEffect(() => {
    if (!useLabBasket || !form.patient || labBasket.length === 0) {
      setBasketPricing({ lines: [], subtotal: 0 })
      return
    }
    getMultiLabRequestPricing(basketWithDiscounts, form.patient, mode === 'OP' ? 'OP' : mode === 'IP' ? 'IP' : undefined)
      .then((pricing) => {
        setBasketPricing(pricing)
        // Prefill per-test discount amounts from insurance so they are visible/editable.
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
  }, [useLabBasket, form.patient, labBasket.length, basketWithDiscounts, mode])

  useEffect(() => {
    const load = async () => {
      const types = await fetchServiceRequestTemplateTypes()
      setTemplateTypes(types)

      if (labTestTemplateOnly) {
        setForm((prev) => ({ ...prev, template_dt: 'Lab Test Template' }))
        return
      }

      const initialIsType = !!initialTemplate && types.some((t) => t.name === initialTemplate)
      const templateType = initialIsType
        ? initialTemplate || ''
        : defaultTemplateType || (initialTemplate ? 'Lab Test Template' : '')

      if (templateType) {
        setForm((prev) => ({ ...prev, template_dt: templateType }))
      }
    }
    load().catch(() => {})
  }, [defaultTemplateType, initialTemplate, labTestTemplateOnly])

  useEffect(() => {
    if (!form.template_dt) {
      setTemplates([])
      return
    }
    const isGroupParam =
      form.template_dt === 'Lab Test Template' && labTemplateFilter !== 'all'
        ? labTemplateFilter === 'group'
          ? 1
          : 0
        : undefined

    const run = () => {
      fetchServiceRequestTemplates(
        form.template_dt,
        templateSearchQuery.trim() || undefined,
        undefined,
        isGroupParam,
        nurseLabTemplatesOnly || undefined,
      )
        .then((rows) => {
          setTemplates(rows)
          const initialIsType = !!initialTemplate && templateTypes.some((t) => t.name === initialTemplate)
          if (initialTemplate && !initialIsType && !form.template_dn) {
            const matched = rows.find((r) => r.name === initialTemplate || r.label === initialTemplate)
            if (matched) {
              setForm((prev) => ({ ...prev, template_dn: matched.name }))
              setTemplateSearchQuery(matched.label || matched.name)
            }
          }
        })
        .catch(() => setTemplates([]))
    }

    const delay = templateSearchQuery.trim() ? 280 : 0
    const t = setTimeout(run, delay)
    return () => clearTimeout(t)
  }, [form.template_dt, templateSearchQuery, labTemplateFilter, initialTemplate, templateTypes, nurseLabTemplatesOnly])

  useEffect(() => {
    if (!form.patient) return
    fetchPatientVisits(form.patient).then(setPatientVisits).catch(() => setPatientVisits([]))
    fetchInpatientAdmissions(form.patient).then(setAdmissions).catch(() => setAdmissions([]))
    fetch(`/api/resource/Patient/${encodeURIComponent(form.patient)}?fields=["category"]`)
      .then((r) => r.json())
      .then((data) => setPatientCategory(data?.data?.category || ''))
      .catch(() => setPatientCategory(''))
  }, [form.patient])

  useEffect(() => {
    if (!practitionerDropdownOpen) return
    const run = () => {
      fetchHealthcarePractitioners(practitionerSearchQuery.trim() || undefined)
        .then(setPractitionerOptions)
        .catch(() => setPractitionerOptions([]))
    }
    const delay = practitionerSearchQuery.trim() ? 280 : 0
    const t = setTimeout(run, delay)
    return () => clearTimeout(t)
  }, [practitionerDropdownOpen, practitionerSearchQuery])

  useEffect(() => {
    if (!form.practitioner) {
      setOrdererFlags({ gp_doctor: false, consultants: false, loaded: false })
      return
    }
    let cancelled = false
    fetchPractitionerLabReviewFlags(form.practitioner)
      .then((flags) => {
        if (!cancelled) {
          setOrdererFlags({
            gp_doctor: flags.gp_doctor,
            consultants: flags.consultants,
            loaded: true,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setOrdererFlags({ gp_doctor: false, consultants: false, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [form.practitioner])

  const needsAssignedConsultant =
    isLabRequest &&
    mode === 'OP' &&
    ordererFlags.loaded &&
    !ordererFlags.gp_doctor &&
    !ordererFlags.consultants

  useEffect(() => {
    if (!needsAssignedConsultant) {
      setForm((prev) =>
        prev.assigned_healthcare_practioner
          ? { ...prev, assigned_healthcare_practioner: '' }
          : prev,
      )
      setConsultantSearchQuery('')
    }
  }, [needsAssignedConsultant])

  useEffect(() => {
    if (!consultantDropdownOpen || !needsAssignedConsultant) return
    const run = () => {
      fetchHealthcarePractitioners(consultantSearchQuery.trim() || undefined, undefined, {
        consultantsOnly: true,
      })
        .then(setConsultantOptions)
        .catch(() => setConsultantOptions([]))
    }
    const delay = consultantSearchQuery.trim() ? 280 : 0
    const t = setTimeout(run, delay)
    return () => clearTimeout(t)
  }, [consultantDropdownOpen, consultantSearchQuery, needsAssignedConsultant])

  // Auto-fill current user's practitioner; lock for doctors (not admins).
  useEffect(() => {
    if (!linkedPractitionerId) return
    setForm((prev) => (prev.practitioner === '' ? { ...prev, practitioner: linkedPractitionerId } : prev))
    setPractitionerSearchQuery((q) =>
      q.trim() === '' ? linkedPractitionerLabel || linkedPractitionerId : q,
    )
  }, [linkedPractitionerId, linkedPractitionerLabel])

  useEffect(() => {
    if (mode !== 'OP' || !form.patient || patientVisits.length === 0) return
    setForm((prev) => {
      if (
        initialPatientVisit &&
        patientVisits.some((v) => v.name === initialPatientVisit)
      ) {
        return { ...prev, patient_visit: initialPatientVisit }
      }
      if (activeVisit && patientVisits.some((v) => v.name === activeVisit))
        return { ...prev, patient_visit: activeVisit }
      const first = patientVisits[0]?.name
      if (!first) return prev
      const currentOk = prev.patient_visit && patientVisits.some((v) => v.name === prev.patient_visit)
      return currentOk ? prev : { ...prev, patient_visit: first }
    })
  }, [mode, form.patient, activeVisit, patientVisits, initialPatientVisit])

  useEffect(() => {
    if (mode !== 'IP' || !form.patient || admissions.length === 0) return
    setForm((prev) => {
      if (
        initialInpatientRecord &&
        admissions.some((a) => a.name === initialInpatientRecord)
      ) {
        return { ...prev, inpatient_record: initialInpatientRecord }
      }
      if (activeAdmission && admissions.some((a) => a.name === activeAdmission))
        return { ...prev, inpatient_record: activeAdmission }
      const first = admissions[0]?.name
      if (!first) return prev
      const currentOk = prev.inpatient_record && admissions.some((a) => a.name === prev.inpatient_record)
      return currentOk ? prev : { ...prev, inpatient_record: first }
    })
  }, [mode, form.patient, activeAdmission, admissions, initialInpatientRecord])

  useEffect(() => {
    const patientVisit = mode === 'OP' ? form.patient_visit : undefined
    const inpatientRecord = mode === 'IP' ? form.inpatient_record : undefined
    if (!patientVisit && !inpatientRecord) return
    if (mode !== 'OP' && mode !== 'IP') return

    let cancelled = false
    void syncCostCenterFromCareEpisode(mode, {
      patientVisit,
      inpatientRecord,
      visits: patientVisits,
      admissions,
    }).then((cc) => {
      if (cancelled || !cc) return
      setForm((prev) => ({ ...prev, cost_center: cc }))
      setCostCenterSearchQuery(cc)
    })
    return () => {
      cancelled = true
    }
  }, [mode, form.patient_visit, form.inpatient_record, patientVisits, admissions])

  useEffect(() => {
    if (!costCenterDropdownOpen) return
    const run = () => {
      fetchCostCenters(undefined, costCenterSearchQuery.trim() || undefined)
        .then(setCostCenterOptions)
        .catch(() => setCostCenterOptions([]))
    }
    const delay = costCenterSearchQuery.trim() ? 280 : 0
    const t = setTimeout(run, delay)
    return () => clearTimeout(t)
  }, [costCenterDropdownOpen, costCenterSearchQuery])

  useEffect(() => {
    const templateDn = useLabBasket ? pendingTemplateDn : form.template_dn
    if (!form.template_dt || !templateDn) {
      if (!useLabBasket || !pendingTemplateDn) {
        setPricingRows([])
        setGroupRows([])
        setSelectedGroupTemplates([])
      }
      return
    }
    const careType = mode === 'OP' ? 'OP' : mode === 'IP' ? 'IP' : undefined
    const params = new URLSearchParams({
      template_dt: form.template_dt,
      template_dn: templateDn,
    })
    if (careType) {
      params.set('patient_care_type', careType)
    }
    if (form.patient) {
      params.set('patient', form.patient)
    }
    fetch(`/api/method/healthcare.api.service_request.get_service_request_template_pricing?${params}`)
      .then((res) => res.json())
      .then((data) => {
        const payload: PricingResponse = data?.message || {}
        const rows = Array.isArray(payload.pricing) ? payload.pricing : []
        const groups = Array.isArray(payload.group_templates) ? payload.group_templates : []
        setPricingRows(rows)
        setGroupRows(groups)
        if (groups.length > 0) {
          setLabTemplateLabels((prev) => {
            const next = { ...prev }
            for (const group of groups) {
              next[group.template_dn] = group.template_label || group.template_dn
            }
            return next
          })
        }
        if (groups.length > 0) {
          setSelectedGroupTemplates(groups.map((row) => row.template_dn))
        } else {
          setSelectedGroupTemplates([])
        }
        const best = getBestPricingRow(rows)
        const insPct = Number(best?.discount_pct || 0)
        const list = best?.price != null ? Number(best.price) : 0
        const insAmt =
          best?.discount_amount != null && Number(best.discount_amount) > 0
            ? Number(best.discount_amount)
            : insPct > 0 && list > 0
              ? (list * insPct) / 100
              : 0
        setInsuranceDiscountPct(insPct)
        setDiscountPct(insAmt)
        setManualCost(0)
      })
      .catch(() => {
        setPricingRows([])
        setGroupRows([])
        setSelectedGroupTemplates([])
        setInsuranceDiscountPct(0)
        setDiscountPct(0)
        setManualCost(0)
      })
  }, [form.template_dt, form.template_dn, pendingTemplateDn, patientCategory, useLabBasket, mode, form.patient])

  useEffect(() => {
    if (!patientOpen) return
    const timer = setTimeout(async () => {
      const rows = patientQuery.trim() ? await searchPatients(patientQuery, 20) : await fetchPatients(20, 0)
      setPatientOptions(rows)
    }, 300)
    return () => clearTimeout(timer)
  }, [patientOpen, patientQuery])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      blockIfActiveCareClosed()
    } catch {
      return
    }
    if (!form.patient || !form.template_dt) {
      setError('Patient and Template Type are required.')
      return
    }
    if (useLabBasket) {
      if (labBasket.length === 0) {
        setError('Add at least one lab test or group to the request.')
        return
      }
      if (
        (basketPricing.grand_total ?? basketPricing.subtotal) - generalLabDiscount < 0
      ) {
        setError('General discount cannot be greater than the total after per-test discounts.')
        return
      }
    } else if (!form.template_dn) {
      setError('Patient, Template Type and Template are required.')
      return
    }
    if (mode === 'OP' && !form.patient_visit?.trim()) {
      setError('Select a patient visit for this outpatient request.')
      return
    }
    if (mode === 'IP' && !form.inpatient_record?.trim()) {
      setError('Select an inpatient admission for this inpatient request.')
      return
    }
    if (!form.practitioner?.trim()) {
      setError(
        isLabRequest
          ? 'Please select a practitioner for this lab request.'
          : isOtherService
            ? 'Please select a nurse for this service request.'
            : 'Please select a practitioner for this service request.'
      )
      return
    }
    if (!form.cost_center?.trim()) {
      setError(isLabRequest ? 'Please select a branch for this lab request.' : 'Please select a branch for this service request.')
      return
    }
    if (!useLabBasket && isGroupTemplate && selectedGroupTemplates.length === 0) {
      setError('Select at least one child template for grouped lab tests.')
      return
    }

    try {
      setSubmitting(true)
      const primaryDn =
        useLabBasket && labBasket.length > 0
          ? labBasket[0].kind === 'single'
            ? labBasket[0].template
            : labBasket[0].parent
          : form.template_dn

      let created: Awaited<ReturnType<typeof createServiceRequest>> | undefined

      if (useLabBasket) {
        created = await createServiceRequest({
          patient: form.patient,
          template_dt: form.template_dt,
          template_dn: primaryDn,
          lab_request_items: basketWithDiscounts,
          practitioner: form.practitioner || undefined,
          assigned_healthcare_practioner: form.assigned_healthcare_practioner || undefined,
          patient_visit: form.patient_visit || undefined,
          inpatient_record: form.inpatient_record || undefined,
          patient_care_type: mode === 'OP' ? 'OP' : mode === 'IP' ? 'IP' : undefined,
          order_date: form.order_date,
          order_time: form.order_time,
          cost_center: form.cost_center || undefined,
          cost: basketPricing.subtotal,
          general_discount_amount: generalLabDiscount,
          discount_amount: (basketPricing.discount_amount || 0) + generalLabDiscount,
          grand_total:
            (basketPricing.grand_total ?? basketPricing.subtotal) - generalLabDiscount,
        })
      } else {
        const listAmount = listSubtotalBeforeDiscount
        // Other Services (nursing): amount/payment is optional — some services are free.
        if (priceMissing && listAmount <= 0 && !isOtherService) {
          setError('Enter an amount for this item/service (no price configured).')
          return
        }
        const discountAmount = orderDiscountAmount
        const afterDiscount = listAmount - discountAmount
        const expectedInsAmt =
          insuranceDiscountPct > 0 && listAmount > 0
            ? (listAmount * insuranceDiscountPct) / 100
            : 0
        const usingInsurancePct =
          insuranceDiscountPct > 0 && Math.abs(discountAmount - expectedInsAmt) < 0.01
        created = await createServiceRequest({
          patient: form.patient,
          template_dt: form.template_dt,
          template_dn: primaryDn,
          practitioner: form.practitioner || undefined,
          assigned_healthcare_practioner: form.assigned_healthcare_practioner || undefined,
          patient_visit: form.patient_visit || undefined,
          inpatient_record: form.inpatient_record || undefined,
          patient_care_type: mode === 'OP' ? 'OP' : mode === 'IP' ? 'IP' : undefined,
          order_date: form.order_date,
          order_time: form.order_time,
          cost_center: form.cost_center || undefined,
          cost: listAmount,
          discount: usingInsurancePct ? insuranceDiscountPct : 0,
          discount_margin: usingInsurancePct ? 'Percentage' : discountAmount !== 0 ? 'Amount' : '',
          discount_amount: discountAmount,
          grand_total: afterDiscount,
          selected_group_templates: isGroupTemplate ? selectedGroupTemplates : undefined,
        })
      }

      if (created?.auto_booked && isLabRequest) {
        const n = created.lab_tests_count ?? created.lab_tests?.length ?? 0
        toast.success(
          n > 0
            ? `Lab request created — payment confirmed and ${n} test${n === 1 ? '' : 's'} booked to the lab`
            : 'Lab request created — payment confirmed and booked to the lab',
        )
      } else if (created?.auto_book_error && isLabRequest) {
        toast.success('Lab request created')
        toast.error(created.auto_book_error)
      } else {
        toast.success(isLabRequest ? 'Lab request created' : 'Service Request created')
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : isLabRequest ? 'Failed to create lab request' : 'Failed to create service request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-3xl max-h-[92vh] overflow-hidden')}>
        <CreateModalHeader
          title={isLabRequest ? 'Create Lab Request' : 'Create Service Request'}
          onClose={onClose}
          icon={<ClipboardList className="h-5 w-5 text-emerald-700" strokeWidth={2} />}
          alert={error}
        />

        <form onSubmit={handleSubmit} className={`${CREATE_MODAL_BODY_GRADIENT} min-h-0 flex-1`}>
          <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
            {/* Patient & practitioner */}
            <div className={sectionCard}>
              <div className={sectionTitle}>
                <User className="h-4 w-4 text-emerald-600" />
                {isOtherService ? 'Patient & nurse' : 'Patient & ordering clinician'}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="relative md:col-span-1">
                  <label className={labelClass}>
                    <span className="text-red-500">*</span> Patient
                  </label>
                  <input
                    value={patientQuery}
                    onChange={(e) => {
                      setPatientQuery(e.target.value)
                      setPatientOpen(true)
                    }}
                    onFocus={() => setPatientOpen(true)}
                    className={inputClass}
                    placeholder="Search by name or ID…"
                  />
                  {patientOpen && (
                    <div className={linkComboboxDropdownClassShort}>
                      {patientOptions.map((patient) => (
                        <button
                          key={patient.name}
                          type="button"
                          className="block w-full px-3 py-2.5 text-left text-sm text-slate-800 transition hover:bg-emerald-50"
                          onMouseDown={() => {
                            setForm((prev) => ({ ...prev, patient: patient.name }))
                            setPatientQuery(patient.patient_name || patient.name)
                            setPatientOpen(false)
                          }}
                        >
                          <span className="font-medium">{patient.patient_name || patient.name}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{patient.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <label className={labelClass}>
                    <Stethoscope className="h-3.5 w-3.5 text-emerald-500" />
                    {orderingClinicianLabel}
                  </label>
                  <input
                    type="text"
                    value={practitionerSearchQuery}
                    readOnly={practitionerLocked}
                    onChange={(e) => {
                      if (practitionerLocked) return
                      setPractitionerSearchQuery(e.target.value)
                      setForm((prev) => ({ ...prev, practitioner: '' }))
                      setPractitionerDropdownOpen(true)
                    }}
                    onFocus={() => {
                      if (!practitionerLocked) setPractitionerDropdownOpen(true)
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setPractitionerDropdownOpen(false), 180)
                    }}
                    placeholder={isOtherService ? 'Search nurse name…' : 'Search doctor name…'}
                    title={
                      practitionerLocked ? 'Locked to your linked practitioner' : undefined
                    }
                    className={practitionerLocked ? LOCKED_PRACTITIONER_INPUT_CLASS : inputClass}
                  />
                  {practitionerDropdownOpen && !practitionerLocked && (
                    <div className={linkComboboxDropdownClass}>
                      {practitionerOptions.length === 0 ? (
                        <div className="px-3 py-2.5 text-xs text-slate-500">
                          {isOtherService
                            ? 'No nurses match. Try another search.'
                            : 'No practitioners match. Try another search.'}
                        </div>
                      ) : (
                        practitionerOptions.map((item) => (
                          <button
                            key={item.name}
                            type="button"
                            className="block w-full border-b border-slate-50 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-emerald-50/80"
                            onMouseDown={() => {
                              setForm((prev) => ({ ...prev, practitioner: item.name }))
                              setPractitionerSearchQuery(item.label || item.name)
                              setPractitionerDropdownOpen(false)
                            }}
                          >
                            <span className="font-medium text-slate-900">{item.label || item.name}</span>
                            {item.department ? (
                              <span className="mt-0.5 block text-xs text-slate-500">{item.department}</span>
                            ) : null}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {isOtherService
                      ? 'Defaults to your linked nurse; type to search and change.'
                      : 'Defaults to your linked practitioner; type to search and change.'}
                  </p>
                </div>
                {needsAssignedConsultant ? (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Assigned to consultant{' '}
                      <span className="font-normal normal-case text-slate-400">(optional)</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        className={inputClass}
                        value={consultantSearchQuery}
                        onChange={(e) => {
                          setConsultantSearchQuery(e.target.value)
                          setForm((prev) => ({ ...prev, assigned_healthcare_practioner: '' }))
                        }}
                        onFocus={() => setConsultantDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setConsultantDropdownOpen(false), 180)}
                        placeholder="Search consultant…"
                      />
                      {consultantDropdownOpen && (
                        <div className={linkComboboxDropdownClass}>
                          {consultantOptions.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-slate-500">
                              No consultants match. Tick Consultants on Medical Role for the reviewer.
                            </p>
                          ) : (
                            consultantOptions.map((item) => (
                              <button
                                key={item.name}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setForm((prev) => ({
                                    ...prev,
                                    assigned_healthcare_practioner: item.name,
                                  }))
                                  setConsultantSearchQuery(item.label || item.name)
                                  setConsultantDropdownOpen(false)
                                }}
                              >
                                <span className="font-medium text-slate-900">{item.label || item.name}</span>
                                {item.department ? (
                                  <span className="mt-0.5 block text-xs text-slate-500">{item.department}</span>
                                ) : null}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Optional. You can assign a consultant for review later if needed.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Template */}
            <div className={sectionCard}>
              <div className={sectionTitle}>
                <Layers className="h-4 w-4 text-emerald-600" />
                {isLabRequest ? 'Lab tests' : 'Service template'}
              </div>
              {form.template_dt === 'Lab Test Template' && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Show</span>
                  {(
                    [
                      { key: 'all' as const, label: 'All' },
                      { key: 'group' as const, label: 'Group tests' },
                      { key: 'single' as const, label: 'Single tests' },
                    ] as const
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setLabTemplateFilter(key)
                        setForm((prev) => ({ ...prev, template_dn: '' }))
                        setTemplateSearchQuery('')
                      }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        labTemplateFilter === key
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    <span className="text-red-500">*</span> Template type
                  </label>
                  {labTestTemplateOnly ? (
                    <select
                      disabled
                      value="Lab Test Template"
                      aria-readonly
                      className={`${selectClass} cursor-not-allowed bg-emerald-50/70 text-slate-800 opacity-100`}
                    >
                      <option value="Lab Test Template">Lab Test Template</option>
                    </select>
                  ) : (
                    <select
                      value={form.template_dt}
                      onChange={(e) => {
                        const v = e.target.value
                        setForm((prev) => ({ ...prev, template_dt: v, template_dn: '' }))
                        setTemplateSearchQuery('')
                        setLabTemplateFilter('all')
                      }}
                      className={selectClass}
                    >
                      <option value="">Select type…</option>
                      {templateTypes.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.label || item.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className={labelClass}>
                    <span className="text-red-500">*</span>{' '}
                    {isLabRequest ? 'Lab test' : labTestTemplateOnly || form.template_dt === 'Lab Test Template' ? 'Lab test template' : 'Template'}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={templateSearchQuery}
                      onChange={(e) => {
                        setTemplateSearchQuery(e.target.value)
                        setForm((prev) => ({ ...prev, template_dn: '' }))
                        setTemplateDropdownOpen(true)
                      }}
                      onFocus={() => setTemplateDropdownOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setTemplateDropdownOpen(false), 180)
                      }}
                      disabled={!form.template_dt}
                      placeholder={form.template_dt ? 'Search template name…' : 'Choose template type first…'}
                      className={inputClass}
                    />
                    {templateDropdownOpen && form.template_dt && (
                      <div className={linkComboboxDropdownClass}>
                        {templates.length === 0 ? (
                          <div className="px-3 py-2.5 text-xs text-slate-500">NO TEMPLATES MATCH. TRY ANOTHER SEARCH OR FILTER.</div>
                        ) : (
                          templates.map((item) => {
                            const group = Number(item.is_group) === 1
                            return (
                              <button
                                key={item.name}
                                type="button"
                                className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-emerald-50/80"
                                onMouseDown={() => {
                                  if (form.template_dt === 'Lab Test Template') {
                                    setLabTemplateLabels((prev) => ({
                                      ...prev,
                                      [item.name]: item.label || item.name,
                                    }))
                                  }
                                  if (useLabBasket) {
                                    setPendingTemplateDn(item.name)
                                    setTemplateSearchQuery(item.label || item.name)
                                  } else {
                                    setForm((prev) => ({ ...prev, template_dn: item.name }))
                                    setTemplateSearchQuery(item.label || item.name)
                                  }
                                  setTemplateDropdownOpen(false)
                                }}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-slate-900">
                                    {item.label || item.name}
                                  </span>
                                  {form.template_dt === 'Lab Test Template' && (
                                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                                      ID: {item.name}
                                    </span>
                                  )}
                                </span>
                                {form.template_dt === 'Lab Test Template' && (
                                  <span
                                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                                      group ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {group ? 'Group' : 'Single'}
                                  </span>
                                )}
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {useLabBasket
                      ? 'Search and pick a test, configure group children if needed, then add to the request. Repeat for more tests.'
                      : 'Type to search; pick a row to select. Group templates include multiple child tests.'}
                  </p>
                  {useLabBasket && pendingTemplateDn && (
                    <button
                      type="button"
                      onClick={addPendingToBasket}
                      className="mt-3 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                    >
                      Add to lab request
                    </button>
                  )}
                </div>
              </div>
            </div>

            {useLabBasket && labBasket.length > 0 && (
              <div className={sectionCard}>
                <div className={sectionTitle}>
                  <ClipboardList className="h-4 w-4 text-emerald-600" />
                  Tests on this request ({labBasket.length})
                </div>
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
                              setExpandedLabGroups((prev) => ({ ...prev, [itemKey]: !prev[itemKey] }))
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
                            onClick={() => setLabBasket((prev) => prev.filter((_, i) => i !== index))}
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
            )}

            {/* Context & billing */}
            <div className={sectionCard}>
              <div className={sectionTitle}>
                <Calendar className="h-4 w-4 text-emerald-600" />
                Visit, admission & schedule
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {mode === 'OP' && (
                  <div>
                    <label className={labelClass}>Patient visit (OP)</label>
                    <select
                      value={form.patient_visit}
                      onChange={(e) => setForm((prev) => ({ ...prev, patient_visit: e.target.value }))}
                      className={selectClass}
                    >
                      <option value="">None / select visit…</option>
                      {patientVisits.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.label || item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {mode === 'IP' && (
                  <div>
                    <label className={labelClass}>Inpatient admission (IP)</label>
                    <select
                      value={form.inpatient_record}
                      onChange={(e) => setForm((prev) => ({ ...prev, inpatient_record: e.target.value }))}
                      className={selectClass}
                    >
                      <option value="">None / select admission…</option>
                      {admissions.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.label || item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="relative">
                  <label className={labelClass}>Branch</label>
                  <input
                    type="text"
                    value={costCenterSearchQuery}
                    onChange={(e) => {
                      setCostCenterSearchQuery(e.target.value)
                      setForm((prev) => ({ ...prev, cost_center: '' }))
                      setCostCenterDropdownOpen(true)
                    }}
                    onFocus={() => setCostCenterDropdownOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setCostCenterDropdownOpen(false), 180)
                    }}
                    placeholder="Search branch…"
                    className={inputClass}
                  />
                  {costCenterDropdownOpen && (
                    <div className={linkComboboxDropdownClass}>
                      {costCenterOptions.length === 0 ? (
                        <div className="px-3 py-2.5 text-xs text-slate-500">No branches match. Try another search.</div>
                      ) : (
                        costCenterOptions.map((item) => (
                          <button
                            key={item.name}
                            type="button"
                            className="block w-full border-b border-slate-50 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-emerald-50/80"
                            onMouseDown={() => {
                              setForm((prev) => ({ ...prev, cost_center: item.name }))
                              setCostCenterSearchQuery(item.label || item.name)
                              setCostCenterDropdownOpen(false)
                            }}
                          >
                            <span className="font-medium text-slate-900">{item.label || item.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Filled from the selected {mode === 'IP' ? 'admission' : 'visit'} branch; type to search and change if needed.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Order date</label>
                    <DateFilterInput
                      value={form.order_date}
                      onChange={(e) => setForm((prev) => ({ ...prev, order_date: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Order time</label>
                    <input
                      type="time"
                      value={form.order_time}
                      onChange={(e) => setForm((prev) => ({ ...prev, order_time: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Group templates */}
            {(useLabBasket ? pendingTemplateDn && isGroupTemplate : isGroupTemplate) && (
              <div className={`${sectionCard} border-emerald-200/90 bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/40`}>
                <div className={sectionTitle}>
                  <Layers className="h-4 w-4 text-emerald-600" />
                  Tests in this group
                </div>
                <p className="mb-3 text-xs text-slate-600">
                  Untick or remove child lab tests you do not want in this request. Tests marked
                  “included in group” are covered by the group price; other children add their own
                  price on top.
                </p>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGroupTemplates(groupRows.map((r) => r.template_dn))}
                    className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedGroupTemplates([])}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-2.5">
                  {groupRows.map((row) => {
                    const checked = selectedGroupTemplates.includes(row.template_dn)
                    const included = Boolean(row.price_included_in_group)
                    const price = included ? 0 : getBestPrice(row.pricing) || 0
                    return (
                      <div
                        key={row.template_dn}
                        className={`flex flex-col gap-2 rounded-xl border px-3 py-3 transition sm:flex-row sm:items-center sm:justify-between ${
                          checked
                            ? 'border-emerald-400 bg-emerald-50/80 ring-2 ring-emerald-400/30'
                            : 'border-slate-200/90 bg-white hover:border-emerald-200'
                        }`}
                      >
                        <label className="flex min-w-0 cursor-pointer items-start gap-3 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedGroupTemplates((prev) =>
                                e.target.checked
                                  ? [...prev, row.template_dn]
                                  : prev.filter((name) => name !== row.template_dn)
                              )
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="min-w-0">
                            <span className="font-medium text-slate-900">{row.template_label}</span>
                            {included ? (
                              <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                                Price included in group
                              </span>
                            ) : null}
                          </span>
                        </label>
                        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                          <span className="rounded-lg bg-emerald-100/80 px-3 py-1.5 text-right text-sm font-semibold tabular-nums text-emerald-900">
                            {included ? 'Included' : formatMoney(price)}
                          </span>
                          {checked ? (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedGroupTemplates((prev) =>
                                  prev.filter((name) => name !== row.template_dn)
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                              title="Remove this child test"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2} />
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {(getBestPrice(pricingRows) || 0) > 0 ? (
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-emerald-100 pt-3 text-sm">
                    <span className="text-slate-600">Group price</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {formatMoney(getBestPrice(pricingRows) || 0)}
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            {(useLabBasket ? labBasket.length > 0 : form.template_dn) && (
              <div className={sectionCard}>
                <div className={sectionTitle}>
                  <Wallet className="h-4 w-4 text-emerald-600" />
                  Pricing
                </div>
                <p className="mb-3 text-xs text-slate-600">
                  {useLabBasket
                    ? 'Set individual test discounts, then optionally apply one general discount to the whole request.'
                    : 'Reference amount before discount (reception finalises billing). Enter a discount amount if applicable — negative values are allowed.'}
                </p>
                {priceMissing ? (
                  <div className="mb-3 flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">
                      Amount
                      {!isOtherService ? <span className="text-red-500"> *</span> : null}
                      {isOtherService ? (
                        <span className="ml-1 font-normal text-slate-400">(optional)</span>
                      ) : null}
                    </label>
                    <input
                      type="number"
                      step={0.01}
                      value={manualCost === 0 ? '' : manualCost}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') {
                          setManualCost(0)
                          return
                        }
                        const n = Number(raw)
                        if (!Number.isNaN(n)) setManualCost(n)
                      }}
                      className={inputClass}
                      placeholder={
                        isOtherService
                          ? 'Leave blank if no payment required'
                          : 'Enter amount (no price on item)'
                      }
                    />
                    <p className={`text-[11px] ${isOtherService ? 'text-slate-500' : 'text-amber-700'}`}>
                      {isOtherService
                        ? 'No catalog price. Leave blank for free / no-payment services, or enter an amount to charge.'
                        : 'This item/service has no price configured. Enter the amount to charge.'}
                    </p>
                  </div>
                ) : listSubtotalBeforeDiscount !== 0 ? (
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="text-slate-600">List amount</span>
                    <span className="font-semibold tabular-nums text-slate-900">{formatMoney(listSubtotalBeforeDiscount)}</span>
                  </div>
                ) : null}
                {useLabBasket && basketPricing.lines.length > 0 ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
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
                        className={inputClass}
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
                  </div>
                ) : !useLabBasket ? (
                  <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-500">Discount amount</label>
                      <input
                        type="number"
                        step={0.01}
                        value={discountPct === 0 ? '' : discountPct}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            setDiscountPct(0)
                            return
                          }
                          const n = Number(raw)
                          if (!Number.isNaN(n)) setDiscountPct(n)
                        }}
                        className={inputClass}
                        placeholder="0"
                      />
                    </div>
                  </div>
                ) : null}
                {!useLabBasket && orderDiscountAmount !== 0 && (
                  <p className="mb-3 text-xs text-slate-500">
                    {orderDiscountAmount > 0 ? '−' : '+'}
                    {formatMoney(Math.abs(orderDiscountAmount))}
                  </p>
                )}
                {useLabBasket &&
                  ((basketPricing.discount_amount || 0) !== 0 || generalLabDiscount !== 0) && (
                  <p className="mt-3 text-xs text-slate-500">
                    Total discount:{' '}
                    {(basketPricing.discount_amount || 0) + generalLabDiscount > 0 ? '−' : '+'}
                    {formatMoney(
                      Math.abs((basketPricing.discount_amount || 0) + generalLabDiscount)
                    )}
                  </p>
                )}
              </div>
            )}

            {(useLabBasket ? labBasket.length > 0 : form.template_dn) && (
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-300/70 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 px-4 py-4 text-white shadow-md shadow-emerald-600/25 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex flex-col gap-0.5 text-sm text-emerald-50">
                <span className="flex items-center gap-2 font-medium">
                  <Wallet className="h-4 w-4 text-white/90" />
                  Estimated patient total
                </span>
                {useLabBasket &&
                ((basketPricing.discount_amount || 0) !== 0 || generalLabDiscount !== 0) ? (
                  <span className="text-xs text-emerald-100/90">
                    Per-test and general discounts applied
                  </span>
                ) : !useLabBasket && orderDiscountAmount !== 0 ? (
                  <span className="text-xs text-emerald-100/90">
                    {orderDiscountAmount > 0 ? 'Discount' : 'Surcharge'} applied
                  </span>
                ) : null}
              </div>
              <div className="text-2xl font-bold tabular-nums tracking-tight text-white drop-shadow-sm">{formatMoney(estimatedTotalAfterDiscount)}</div>
            </div>
            )}
          </div>

          <div className={`${CREATE_MODAL_FOOTER_STICKY} justify-end`}>
            <button type="button" onClick={onClose} className={CM_BTN_CANCEL}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} className={CM_BTN_PRIMARY}>
              {submitting ? 'Creating…' : isLabRequest ? 'Create lab request' : 'Create request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
