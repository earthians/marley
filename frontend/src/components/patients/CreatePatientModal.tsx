import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_FOOTER_STICKY,
  CREATE_MODAL_OVERLAY,
  CreateModalHeader,
  createModalShellClass,
  createModalTabButtonClass,
} from '../ui/CreateModalChrome'
import {
  checkPatientDuplicate,
  createPatient,
  uploadPatientFile,
  fetchNextPatientFileNo,
  fetchFileNoChargePreview,
  type PatientDocumentRow,
  type FileNoChargePreview,
} from '../../services/patients'
import { fetchLeadSources, fetchNationalities, fetchCountries, fetchDocumentTypes, fetchHealthcareInsurance, fetchSalutations, fetchInsurancePatientRegisters, fetchPatientCategories, type LinkFieldOption, type InsurancePatientRegisterRow } from '../../services/common'
import { CreateLeadSourceModal } from './CreateLeadSourceModal'
import { CreateNationalityModal } from './CreateNationalityModal'
import { PatientDobAgeHint } from './PatientDobAgeHint'
import { DocumentTypeSelect } from '../ui/DocumentTypeSelect'
import { toast } from '../../hooks/useToast'
import { useFormatMoney } from '../../hooks/useFormatMoney'
import { digitsOnlyPhone, firstInvalidPatientPhone, isNumericPhone } from '../../utils/phoneInput'
import { isValidEmail } from '../../utils/emailInput'
import { PenLine, Trash2, Check, Upload, Download, RefreshCw, Loader2 } from 'lucide-react'
import { DateFilterInput } from '../ui/DateFilterInput'

// ─── Signature Pad Component ────────────────────────────────────────────────

interface SignaturePadProps {
  onSave: (file: File) => void
  onClear?: () => void
  existingUrl?: string
  uploading?: boolean
}

const SignaturePad = ({ onSave, onClear, existingUrl, uploading }: SignaturePadProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [mode, setMode] = useState<'idle' | 'drawing' | 'done'>(existingUrl ? 'done' : 'idle')

  const initCtx = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    return ctx
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = initCtx()
    if (!ctx) return
    isDrawing.current = true
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = initCtx()
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasStrokes(true)
  }

  const endDraw = () => { isDrawing.current = false }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    onClear?.()
  }

  const saveSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `signature_${Date.now()}.png`, { type: 'image/png' })
      onSave(file)
      setMode('done')
    }, 'image/png')
  }

  useEffect(() => {
    if (mode !== 'drawing') return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * window.devicePixelRatio
    canvas.height = rect.height * window.devicePixelRatio
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    setHasStrokes(false)
  }, [mode])

  if (mode === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setMode('drawing')}
        className="w-full h-full min-h-[96px] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all group"
      >
        <PenLine className="w-5 h-5 group-hover:scale-110 transition-transform" />
        <span className="text-xs font-medium">Add Signature</span>
      </button>
    )
  }

  if (mode === 'done' && existingUrl) {
    return (
      <div className="w-full h-full min-h-[96px] flex flex-col items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 p-2">
        <img src={existingUrl} alt="Signature" className="max-h-16 object-contain" />
        <button
          type="button"
          onClick={() => { setMode('drawing'); clearCanvas() }}
          className="text-xs text-slate-500 hover:text-red-500 flex items-center gap-1 transition-colors"
        >
          <Trash2 className="w-3 h-3" /> Re-sign
        </button>
      </div>
    )
  }

  return (
    <div className="w-full rounded-lg border border-slate-300 bg-white overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
          <PenLine className="w-3 h-3" /> Draw signature
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clearCanvas}
            disabled={!hasStrokes}
            className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-30 flex items-center gap-0.5 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
          <button
            type="button"
            onClick={() => { setMode('idle'); clearCanvas() }}
            className="text-xs text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="relative" style={{ touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '96px', display: 'block', cursor: 'crosshair' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 pointer-events-none select-none">
            Sign here
          </span>
        )}
      </div>

      <div className="px-2.5 py-2 border-t border-slate-100 flex justify-end">
        <button
          type="button"
          onClick={saveSignature}
          disabled={!hasStrokes || uploading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Saving…
            </span>
          ) : (
            <>
              <Check className="w-3 h-3" /> Save Signature
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ─── Main Modal ──────────────────────────────────────────────────────────────

interface CreatePatientModalProps {
  onClose: () => void
  onSuccess?: (patientName: string) => void
  /** Pre-fill patient name (Full Name) */
  initialName?: string
  /** Pre-fill mobile number */
  initialMobile?: string
  /** Pre-fill ID / CPR number */
  initialNationalId?: string
  /** Pre-fill insurance provider (Health Insurance docname) — will auto-set insurance tab */
  initialInsurance?: string
  /** Pre-fill insurance register (Insurance Patient Register docname) */
  initialInsuranceRegister?: string
}

type Tab = 'details' | 'relations' | 'insurance' | 'documents' | 'cpr'

export const CreatePatientModal = ({ onClose, onSuccess, initialName, initialMobile, initialNationalId, initialInsurance, initialInsuranceRegister }: CreatePatientModalProps) => {
  const formatMoney = useFormatMoney()
  const [activeTab, setActiveTab] = useState<Tab>(initialInsurance ? 'insurance' : 'details')

  const [formData, setFormData] = useState({
    patient_name: initialName || '',
    title: '',
    file_no: '',
    sex: '',
    dob: '',
    blood_group: '',
    mobile: digitsOnlyPhone(initialMobile || ''),
    mobile_no_owner: '',
    alternative_mobile_no_1: '',
    alternative_mobile_no_2: '',
    phone: '',
    email: '',
    id_number: initialNationalId || '',
    nationality: '',
    category: '',
    source: '',
    marital_status: '',
    emergency_contact_name: '',
    emergency_contact_relation: '',
    emergency_contact_phone: '',
    is_black_list: false,
    blacklist_reason: '',
    remarks: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    country: '',
    pincode: '',
    next_of_kin: '',
    full_name: '',
    relation: '',
    mobile_no: '',
    has_insurance: !!initialInsurance,
    insurance: initialInsurance || '',
    insurance_type: '',
    insurance_company_no: '',
    insurance_policy: '',
    ref_no: '',
    job_title: '',
    job_company: '',
    insurance_register: initialInsuranceRegister || '',
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chargeFileNo, setChargeFileNo] = useState(true)
  const [fileNoCharge, setFileNoCharge] = useState<FileNoChargePreview>({ configured: false, rate: 0 })

  // Source dropdown state
  const [sourceOptions, setSourceOptions] = useState<LinkFieldOption[]>([])
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceQuery, setSourceQuery] = useState('')
  const [selectedSource, setSelectedSource] = useState<LinkFieldOption | null>(null)
  const [showCreateSource, setShowCreateSource] = useState(false)

  const [categoryOptions, setCategoryOptions] = useState<LinkFieldOption[]>([])
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categoryQuery, setCategoryQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<LinkFieldOption | null>(null)

  // Insurance dropdown — pre-filled when coming from Insurance Patient Register
  const [insuranceOptions, setInsuranceOptions] = useState<LinkFieldOption[]>([])
  const [insuranceOpen, setInsuranceOpen] = useState(false)
  const [insuranceQuery, setInsuranceQuery] = useState(initialInsurance || '')
  const [selectedInsurance, setSelectedInsurance] = useState<LinkFieldOption | null>(
    initialInsurance ? { name: initialInsurance, label: initialInsurance } : null
  )

  // Nationality dropdown state
  const [nationalityOptions, setNationalityOptions] = useState<LinkFieldOption[]>([])
  const [nationalityOpen, setNationalityOpen] = useState(false)
  const [nationalityQuery, setNationalityQuery] = useState('')
  const [selectedNationality, setSelectedNationality] = useState<LinkFieldOption | null>(null)
  const [showCreateNationality, setShowCreateNationality] = useState(false)
  const [countries, setCountries] = useState<{ name: string }[]>([])
  const [documentTypes, setDocumentTypes] = useState<{ name: string; document_name?: string }[]>([])
  const [documents, setDocuments] = useState<PatientDocumentRow[]>([])
  const [cprPhoto, setCprPhoto] = useState('')
  const [cprPhotoBack, setCprPhotoBack] = useState('')
  const [cprUploading, setCprUploading] = useState<'front' | 'back' | null>(null)
  const [documentUploading, setDocumentUploading] = useState<number | null>(null)
  const [signatureUploading, setSignatureUploading] = useState<number | null>(null)

  // Salutation dropdown
  const [salutationOptions, setSalutationOptions] = useState<LinkFieldOption[]>([])
  const [salutationOpen, setSalutationOpen] = useState(false)
  const [salutationQuery, setSalutationQuery] = useState('')
  const [selectedSalutation, setSelectedSalutation] = useState<LinkFieldOption | null>(null)

  // Insurance Patient Register dropdown
  const [iprOptions, setIprOptions] = useState<InsurancePatientRegisterRow[]>([])

  // Explicit Yes/No choice for Has Insurance — pre-set to Yes when insurance prefill is provided
  const [hasInsuranceChoice, setHasInsuranceChoice] = useState<'Yes' | 'No' | ''>(initialInsurance ? 'Yes' : '')

  const PATIENT_RELATION_OPTIONS = ['Father', 'Mother', 'Spouse', 'Siblings', 'Family', 'Other'] as const

  const [relations, setRelations] = useState<{
    full_name: string
    relation: string
    mobile_no: string
    email: string
    description?: string
    is_next_of_kin: boolean
  }[]>([])

  const addRelationRow = () => {
    setRelations((prev) => [...prev, { full_name: '', relation: '', mobile_no: '', email: '', is_next_of_kin: false }])
  }
  const removeRelationRow = (idx: number) => {
    setRelations((prev) => prev.filter((_, i) => i !== idx))
  }
  const updateRelationRow = (
    idx: number,
    field: 'full_name' | 'relation' | 'mobile_no' | 'email' | 'description' | 'is_next_of_kin',
    value: string | boolean
  ) => {
    const nextValue = field === 'mobile_no' && typeof value === 'string' ? digitsOnlyPhone(value) : value
    setRelations((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: nextValue }
      return next
    })
  }

  const addDocumentRow = () => {
    setDocuments((prev) => [...prev, { file_name: '', document_type: '', transaction_no: '', upload_remarks: '' }])
  }
  const removeDocumentRow = (idx: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== idx))
  }
  const updateDocumentRow = (idx: number, field: keyof PatientDocumentRow, value: string) => {
    setDocuments((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const handleDocumentFile = async (idx: number, file: File | null) => {
    if (!file) return
    setDocumentUploading(idx)
    try {
      const file_url = await uploadPatientFile(file)
      if (!file_url) throw new Error('No URL returned from upload')
      setDocuments((prev) => {
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          document: file_url,
          file_name: next[idx].file_name?.trim() || file.name,
        }
        return next
      })
      toast.success('File uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File upload failed')
    } finally {
      setDocumentUploading(null)
    }
  }

  const handleCprFile = async (side: 'front' | 'back', file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('CPR must be an image file')
      return
    }
    setCprUploading(side)
    try {
      const file_url = await uploadPatientFile(file)
      if (!file_url) throw new Error('No URL returned from upload')
      if (side === 'front') setCprPhoto(file_url)
      else setCprPhotoBack(file_url)
      toast.success(side === 'front' ? 'CPR front image attached' : 'CPR back image attached')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CPR upload failed')
    } finally {
      setCprUploading(null)
    }
  }

  const handleSignatureFile = async (idx: number, file: File) => {
    setSignatureUploading(idx)
    try {
      const file_url = await uploadPatientFile(file)
      if (!file_url) throw new Error('No URL returned from signature upload')
      setDocuments((prev) => {
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          document: file_url,
          file_name: next[idx].file_name?.trim() || `Signature ${idx + 1}`,
        }
        return next
      })
      toast.success('Signature saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signature upload failed')
    } finally {
      setSignatureUploading(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.patient_name || !formData.sex) {
      setError('Full Name and Gender are required')
      setActiveTab('details')
      return
    }
    if (!formData.mobile && !formData.phone) {
      setError('At least one Contact No. (Mobile or Phone) is required')
      setActiveTab('details')
      return
    }
    const invalidPhone = firstInvalidPatientPhone({
      mobile: formData.mobile,
      phone: formData.phone,
      alternative_mobile_no_1: formData.alternative_mobile_no_1,
      alternative_mobile_no_2: formData.alternative_mobile_no_2,
      emergency_contact_phone: formData.emergency_contact_phone,
    })
    if (invalidPhone) {
      setError(`${invalidPhone} must contain numbers only`)
      setActiveTab('details')
      return
    }
    const invalidRelative = relations.find((r) => !isNumericPhone(r.mobile_no))
    if (invalidRelative) {
      setError('Relative Mobile No must contain numbers only')
      setActiveTab('relations')
      return
    }
    if (!isValidEmail(formData.email)) {
      setError('Email must be a valid email address')
      setActiveTab('details')
      return
    }
    if (relations.some((r) => !isValidEmail(r.email))) {
      setError('Relative Email must be a valid email address')
      setActiveTab('relations')
      return
    }
    if (!formData.address_line1) {
      setError('Address (Line 1) is required')
      setActiveTab('details')
      return
    }
    if (!formData.source) {
      setError('Patient Referral or Source is required')
      setActiveTab('details')
      return
    }
    if (!formData.category) {
      setError('Patient category is required')
      setActiveTab('details')
      return
    }
    if (formData.is_black_list && !(formData.blacklist_reason || '').trim()) {
      setError('Enter a reason when blacklisting a patient')
      setActiveTab('details')
      return
    }

    // Require explicit Yes/No selection for Has Insurance
    if (!hasInsuranceChoice) {
      setError('Please select Yes or No for Has Insurance')
      setActiveTab('insurance')
      return
    }
    // An insured patient needs a payer: the Insurance Patient Register is created from it.
    if (hasInsuranceChoice === 'Yes' && !formData.insurance) {
      setError('Select an insurance provider, or choose No for Has Insurance')
      setActiveTab('insurance')
      return
    }

    try {
      setLoading(true)
      setError(null)

      // A failed duplicate check (network/500) must not block registering a genuinely new
      // patient — warn and proceed rather than aborting.
      let dupCheck: Awaited<ReturnType<typeof checkPatientDuplicate>> | null = null
      try {
        dupCheck = await checkPatientDuplicate(
          (formData.patient_name || '').trim(),
          formData.mobile,
          formData.phone,
          formData.dob,
        )
      } catch (dupErr) {
        console.warn('Duplicate check failed; proceeding with registration:', dupErr)
      }
      if (dupCheck?.duplicate && dupCheck.patient) {
        const label = dupCheck.patient.patient_name || dupCheck.patient.name
        const fileNo = dupCheck.patient.file_no || dupCheck.patient.name
        setError(
          `A patient already exists with the same full name and mobile number: ${label} (File No: ${fileNo}). Open that record instead of creating a duplicate.`,
        )
        setActiveTab('details')
        return
      }

      const payload = {
        // Map full name into both patient_name and first_name for compatibility
        ...formData,
        charge_file_no: chargeFileNo && fileNoCharge.configured,
        patient_name: (formData.patient_name || '').trim(),
        first_name: (formData.patient_name || '').trim(),
        middle_name: undefined,
        last_name: undefined,
        is_black_list: formData.is_black_list,
        blacklist_reason: formData.is_black_list ? formData.blacklist_reason || undefined : undefined,
        remarks: formData.remarks || undefined,
        insurance_register: formData.insurance_register || undefined,
        patient_relation: relations
          .filter((r) => (r.full_name || r.relation || r.mobile_no || r.email || '').trim())
          .map((r) => ({
            full_name: (r.full_name || '').trim() || undefined,
            relation: (r.relation || '').trim() || undefined,
            mobile_no: (r.mobile_no || '').trim() || undefined,
            email: (r.email || '').trim() || undefined,
            description: (r.description || '').trim() || undefined,
            is_next_of_kin: r.is_next_of_kin,
          })),
        cpr_photo: cprPhoto || undefined,
        cpr_photo_back: cprPhotoBack || undefined,
        patient_document: documents
          .filter((r) => (r.file_name || '').trim() || (r.document || '').trim())
          .map((r) => ({
            file_name: (r.file_name || '').trim() || undefined,
            document_type: (r.document_type || '').trim() || undefined,
            transaction_no: (r.transaction_no || '').trim() || undefined,
            upload_remarks: (r.upload_remarks || '').trim() || undefined,
            document: (r.document || '').trim() || undefined,
          })),
      }
      const patient = await createPatient(payload)
      let successMsg = patient.server_message || 'Patient created'
      if (patient.insurance_register && patient.insurance_register !== initialInsuranceRegister) {
        successMsg += ` · Insurance Patient Register ${patient.insurance_register} created`
      }
      if (patient.sales_order) {
        successMsg += ` · File no charge order ${patient.sales_order} created`
      } else if (patient.file_no_charge_error) {
        successMsg += ` · ${patient.file_no_charge_error}`
      }
      toast.success(successMsg)
      if (patient.insurance_register && patient.insurance_register !== initialInsuranceRegister) {
        toast.warning(
          `Register ${patient.insurance_register} has no validity dates — the Insurance team must add Valid From and Valid To.`,
        )
      }
      if (onSuccess) {
        onSuccess(patient.name || patient.patient_name || '')
      }
      onClose()
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Failed to create patient'
      setError(
        raw.replace(/full name, patient category, and mobile number/gi, 'full name and mobile number'),
      )
    } finally {
      setLoading(false)
    }
  }

  const PATIENT_PHONE_FIELDS = new Set([
    'mobile',
    'phone',
    'alternative_mobile_no_1',
    'alternative_mobile_no_2',
    'emergency_contact_phone',
  ])

  const handleChange = (field: string, value: string | boolean) => {
    const next =
      typeof value === 'string' && PATIENT_PHONE_FIELDS.has(field) ? digitsOnlyPhone(value) : value
    setFormData((prev) => ({ ...prev, [field]: next }))
  }

  const handleInsuranceSelect = (ins: any) => {
    setSelectedInsurance(ins)
    setFormData(prev => ({
      ...prev,
      insurance: ins.name,
      insurance_type: ins.insurance_type,
      insurance_company_no: ins.insurance_company,
      insurance_policy: ins.policy_no,
    }))
    setInsuranceOpen(false)
    setInsuranceQuery('')
  }

  useEffect(() => {
    if (!salutationOpen) return
    const search = async () => {
      try {
        const results = await fetchSalutations(salutationQuery)
        setSalutationOptions(results)
      } catch (err) {
        console.error('Failed to search salutations:', err)
        setSalutationOptions([])
      }
    }
    const t = setTimeout(search, salutationQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [salutationQuery, salutationOpen])

  useEffect(() => {
    if (!insuranceOpen) return
    const search = async () => {
      const results = await fetchHealthcareInsurance(insuranceQuery)
      setInsuranceOptions(results)
    }
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [insuranceQuery, insuranceOpen])

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [sources, nationalities, countryList, docTypes, categories, nextFileNo, chargePreview, iprList] = await Promise.all([
          fetchLeadSources(),
          fetchNationalities(),
          fetchCountries(),
          fetchDocumentTypes(),
          fetchPatientCategories(),
          fetchNextPatientFileNo(),
          fetchFileNoChargePreview(),
          fetchInsurancePatientRegisters(),
        ])
        setSourceOptions(sources)
        setNationalityOptions(nationalities)
        setCountries(countryList)
        setDocumentTypes(docTypes)
        setCategoryOptions(categories)
        setIprOptions(iprList)
        setFileNoCharge(chargePreview)
        if (nextFileNo) {
          setFormData(prev => prev.file_no === '' ? { ...prev, file_no: nextFileNo } : prev)
        }
      } catch (err) {
        console.error('Failed to load options:', err)
      }
    }
    loadOptions()
  }, [])

  useEffect(() => {
    if (!sourceOpen) return
    const search = async () => {
      try {
        const results = await fetchLeadSources(sourceQuery)
        setSourceOptions(results)
      } catch (err) {
        console.error('Failed to search sources:', err)
        setSourceOptions([])
      }
    }
    const timeoutId = setTimeout(() => { search() }, sourceQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(timeoutId)
  }, [sourceQuery, sourceOpen])

  const handleSourceSelect = (source: LinkFieldOption) => {
    setSelectedSource(source)
    setFormData(prev => ({ ...prev, source: source.name }))
    setSourceOpen(false)
    setSourceQuery('')
  }

  useEffect(() => {
    if (!categoryOpen) return
    const search = async () => {
      try {
        const results = await fetchPatientCategories(categoryQuery)
        setCategoryOptions(results)
      } catch (err) {
        console.error('Failed to search patient categories:', err)
        setCategoryOptions([])
      }
    }
    const timeoutId = setTimeout(() => {
      search()
    }, categoryQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(timeoutId)
  }, [categoryQuery, categoryOpen])

  const handleCategorySelect = (cat: LinkFieldOption) => {
    setSelectedCategory(cat)
    setFormData((prev) => ({ ...prev, category: cat.name }))
    setCategoryOpen(false)
    setCategoryQuery('')
  }

  useEffect(() => {
    if (!nationalityOpen) return
    const search = async () => {
      try {
        const results = await fetchNationalities(nationalityQuery)
        setNationalityOptions(results)
      } catch (err) {
        console.error('Failed to search nationalities:', err)
        setNationalityOptions([])
      }
    }
    const timeoutId = setTimeout(() => { search() }, nationalityQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(timeoutId)
  }, [nationalityQuery, nationalityOpen])

  const handleNationalitySelect = (nat: LinkFieldOption) => {
    setSelectedNationality(nat)
    setFormData((prev) => ({ ...prev, nationality: nat.name }))
    setNationalityOpen(false)
    setNationalityQuery('')
  }

  const handleSalutationSelect = (sal: LinkFieldOption) => {
    setSelectedSalutation(sal)
    setFormData(prev => ({ ...prev, title: sal.name }))
    setSalutationOpen(false)
    setSalutationQuery('')
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'details', label: 'Patient Details' },
    { id: 'relations', label: 'Next of Kin', badge: relations.length || undefined },
    { id: 'insurance', label: 'Insurance' },
    { id: 'documents', label: 'Documents', badge: documents.length || undefined },
    { id: 'cpr', label: 'Attach CPR', badge: (cprPhoto ? 1 : 0) + (cprPhotoBack ? 1 : 0) || undefined },
  ]

  return (
    <div className={CREATE_MODAL_OVERLAY}>
      <div className={createModalShellClass('max-w-2xl w-full max-h-[90vh]')}>
        <CreateModalHeader title="Create New Patient" onClose={onClose}>
          <div className="-mb-px mt-4 flex border-b border-emerald-100/80">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={createModalTabButtonClass(activeTab === tab.id)}
              >
                {tab.label}
                {tab.badge !== undefined ? (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      activeTab === tab.id ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </CreateModalHeader>

        {error && (
          <div
            className="shrink-0 px-6 py-3 bg-red-50 border-b border-red-200"
            role="alert"
          >
            <p className="text-sm font-medium text-red-800">{error}</p>
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 min-h-0"
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT' && !target.closest('.absolute')) {
              setSourceOpen(false)
              setNationalityOpen(false)
            }
          }}
        >
          <div className="overflow-y-auto p-6 space-y-4 text-slate-900" style={{ height: "520px" }}>

            {/* ── TAB: Patient Details ── */}
            {activeTab === 'details' && (
              <>
                {/* Basic Information */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3 mt-2">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={selectedSalutation ? selectedSalutation.label : salutationQuery}
                          onChange={(e) => { setSalutationQuery(e.target.value); setSalutationOpen(true) }}
                          onFocus={() => setSalutationOpen(true)}
                          placeholder="Search title..."
                          className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {salutationOpen && salutationOptions.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white text-slate-900 border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {salutationOptions.map((sal) => (
                              <button key={sal.name} type="button" onClick={() => handleSalutationSelect(sal)}
                                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-100">
                                {sal.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        File No <span className="text-red-500">*</span>
                      </label>
                      <input type="text" value={formData.file_no} onChange={(e) => handleChange('file_no', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" required />
                      {fileNoCharge.configured ? (
                        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                              checked={chargeFileNo}
                              onChange={(e) => setChargeFileNo(e.target.checked)}
                            />
                            <span className="text-sm text-slate-700">
                              <span className="font-medium">Charge file number</span>
                              <span className="block text-xs text-slate-500 mt-0.5">
                                {fileNoCharge.service_name || 'File number fee'}
                                {fileNoCharge.item_name ? ` · ${fileNoCharge.item_name}` : ''}
                                {' · '}
                                <span className="font-semibold text-slate-800">
                                  {formatMoney(fileNoCharge.rate || 0)}
                                </span>
                              </span>
                            </span>
                          </label>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-amber-700">
                          File number charge is not configured in Healthcare Settings.
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.patient_name}
                        onChange={(e) => handleChange('patient_name', e.target.value)}
                        placeholder="Enter full name"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Gender <span className="text-red-500">*</span>
                      </label>
                      <select value={formData.sex} onChange={(e) => handleChange('sex', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" required>
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Date of Birth</label>
                      <DateFilterInput value={formData.dob} onChange={(e) => handleChange('dob', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                      <PatientDobAgeHint dob={formData.dob} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Blood Group</label>
                      <select value={formData.blood_group} onChange={(e) => handleChange('blood_group', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                        <option value="">Select Blood Group</option>
                        <option value="A Positive">A Positive</option>
                        <option value="A Negative">A Negative</option>
                        <option value="AB Positive">AB Positive</option>
                        <option value="AB Negative">AB Negative</option>
                        <option value="B Positive">B Positive</option>
                        <option value="B Negative">B Negative</option>
                        <option value="O Positive">O Positive</option>
                        <option value="O Negative">O Negative</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3 mt-2">Contact Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Mobile <span className="text-red-500">*</span>
                      </label>
                      <input type="tel" inputMode="numeric" pattern="[0-9]*" value={formData.mobile} onChange={(e) => handleChange('mobile', e.target.value)} required
                        placeholder="Numbers only"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Mobile Number Owner</label>
                      <input type="text" value={formData.mobile_no_owner} onChange={(e) => handleChange('mobile_no_owner', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                      <input type="tel" inputMode="numeric" pattern="[0-9]*" value={formData.phone} onChange={(e) => handleChange('phone', e.target.value)}
                        placeholder="Numbers only"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                      <input type="email" value={formData.email} onChange={(e) => handleChange('email', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Alternative Mobile No</label>
                      <input type="tel" inputMode="numeric" pattern="[0-9]*" value={formData.alternative_mobile_no_1} onChange={(e) => handleChange('alternative_mobile_no_1', e.target.value)}
                        placeholder="Numbers only"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Alternative Mobile No 2</label>
                      <input type="tel" inputMode="numeric" pattern="[0-9]*" value={formData.alternative_mobile_no_2} onChange={(e) => handleChange('alternative_mobile_no_2', e.target.value)}
                        placeholder="Numbers only"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                  </div>
                </div>

                {/* Identification */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3 mt-2">Identification</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">CPR / ID / Passport No.</label>
                      <input type="text" value={formData.id_number} onChange={(e) => handleChange('id_number', e.target.value)}
                        placeholder="CPR / ID / Passport (unlimited digits)"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Nationality</label>
                      <div className="relative flex items-center">
                        <input type="text"
                          value={selectedNationality ? selectedNationality.label : nationalityQuery}
                          onChange={(e) => { setNationalityQuery(e.target.value); setNationalityOpen(true) }}
                          onFocus={() => setNationalityOpen(true)}
                          placeholder="Search nationality..."
                          className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                        <button type="button" onClick={(e) => { e.stopPropagation(); setShowCreateNationality(true) }}
                          className="absolute right-2 p-1 text-primary hover:text-primary/80 rounded" title="Create New Nationality">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                        {nationalityOpen && nationalityOptions.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white text-slate-900 border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
                            {nationalityOptions.map((nat) => (
                              <button key={nat.name} type="button" onClick={() => handleNationalitySelect(nat)}
                                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none">
                                <div className="font-medium">{nat.label}</div>
                                {nat.country && <div className="text-xs text-slate-500">{nat.country}</div>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Category <span className="text-red-500">*</span>
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          value={selectedCategory ? selectedCategory.label : categoryQuery}
                          onChange={(e) => {
                            setCategoryQuery(e.target.value)
                            setSelectedCategory(null)
                            setFormData((prev) => ({ ...prev, category: '' }))
                            setCategoryOpen(true)
                          }}
                          onFocus={() => setCategoryOpen(true)}
                          placeholder="Search patient category..."
                          className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          required
                        />
                        {categoryOpen && categoryOptions.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 top-full bg-white text-slate-900 border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {categoryOptions.map((cat) => (
                              <button
                                key={cat.name}
                                type="button"
                                onClick={() => handleCategorySelect(cat)}
                                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
                              >
                                {cat.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Patient Referral or Source <span className="text-red-500">*</span>
                      </label>
                      <div className="relative flex items-center">
                        <input type="text"
                          value={selectedSource ? selectedSource.label : sourceQuery}
                          onChange={(e) => { setSourceQuery(e.target.value); setSourceOpen(true) }}
                          onFocus={() => setSourceOpen(true)}
                          placeholder="Search source..."
                          className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary" required />
                        <button type="button" onClick={(e) => { e.stopPropagation(); setShowCreateSource(true) }}
                          className="absolute right-2 p-1 text-primary hover:text-primary/80 rounded" title="Create New Source">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                        {sourceOpen && sourceOptions.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white text-slate-900 border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto top-full">
                            {sourceOptions.map((source) => (
                              <button key={source.name} type="button" onClick={() => handleSourceSelect(source)}
                                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none">
                                {source.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Marital Status</label>
                      <select value={formData.marital_status} onChange={(e) => handleChange('marital_status', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                        <option value="">Select Marital Status</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Divorced">Divorced</option>
                        <option value="Widow">Widow</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact Name</label>
                      <input type="text" value={formData.emergency_contact_name} onChange={(e) => handleChange('emergency_contact_name', e.target.value)}
                        placeholder="Next of kin / emergency contact"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact Relation</label>
                      <input type="text" value={formData.emergency_contact_relation} onChange={(e) => handleChange('emergency_contact_relation', e.target.value)}
                        placeholder="e.g. Father, Spouse"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact Phone</label>
                      <input type="tel" inputMode="numeric" pattern="[0-9]*" value={formData.emergency_contact_phone} onChange={(e) => handleChange('emergency_contact_phone', e.target.value)}
                        placeholder="Numbers only"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                  </div>
                </div>

                {/* Job Details */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3 mt-2">
                    Job Details
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Job Title
                      </label>
                      <input
                        type="text"
                        value={formData.job_title}
                        onChange={(e) => handleChange('job_title', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="e.g. Nurse, Engineer, Teacher"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Job Company
                      </label>
                      <input
                        type="text"
                        value={formData.job_company}
                        onChange={(e) => handleChange('job_company', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Company / Organization"
                      />
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3 mt-2">Address</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Address Line 1 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.address_line1}
                        onChange={(e) => handleChange('address_line1', e.target.value)}
                        placeholder="Street address, P.O. box, company name"
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        required
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Address Line 2</label>
                      <input
                        type="text"
                        value={formData.address_line2}
                        onChange={(e) => handleChange('address_line2', e.target.value)}
                        placeholder="Apartment, suite, unit, building, floor, etc."
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Country</label>
                      <select
                        value={formData.country}
                        onChange={(e) => handleChange('country', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select country</option>
                        {countries.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Pincode/ZIP</label>
                      <input
                        type="text"
                        value={formData.pincode}
                        onChange={(e) => handleChange('pincode', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>

                {/* Other Information */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3 mt-2">Other Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id="is_black_list" checked={formData.is_black_list}
                        onChange={(e) => handleChange('is_black_list', e.target.checked)}
                        className="rounded border-slate-300 text-primary focus:ring-primary" />
                      <label htmlFor="is_black_list" className="text-sm font-medium text-slate-700">Is Black List?</label>
                    </div>
                    {formData.is_black_list && (
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Blacklist reason <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          value={formData.blacklist_reason}
                          onChange={(e) => handleChange('blacklist_reason', e.target.value)}
                          rows={2}
                          placeholder="Why is this patient being blacklisted?"
                          className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Any Other Information / Remarks</label>
                      <textarea value={formData.remarks} onChange={(e) => handleChange('remarks', e.target.value)} rows={2}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── TAB: Insurance ── */}
            {activeTab === 'insurance' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">
                    Has Insurance <span className="text-red-500">*</span>
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="radio"
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      checked={hasInsuranceChoice === 'Yes'}
                      onChange={() => {
                        setHasInsuranceChoice('Yes')
                        handleChange('has_insurance', true)
                      }}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="radio"
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      checked={hasInsuranceChoice === 'No'}
                      onChange={() => {
                        setHasInsuranceChoice('No')
                        handleChange('has_insurance', false)
                      }}
                    />
                    No
                  </label>
                </div>
                {hasInsuranceChoice === 'Yes' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2 flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Insurance</label>
                      <div className="relative">
                        <input type="text"
                          value={selectedInsurance ? selectedInsurance.label : insuranceQuery}
                          onChange={(e) => { setInsuranceQuery(e.target.value); setInsuranceOpen(true) }}
                          onFocus={() => setInsuranceOpen(true)}
                          placeholder="Search Healthcare Insurance..."
                          className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
                        {insuranceOpen && insuranceOptions.length > 0 && (
                          <div className="absolute z-10 w-full bg-white text-slate-900 border border-slate-200 rounded-md shadow max-h-60 overflow-y-auto">
                            {insuranceOptions.map((ins) => (
                              <button key={ins.name} type="button" onClick={() => handleInsuranceSelect(ins)}
                                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-100">
                                {ins.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Insurance Type</label>
                      <input value={formData.insurance_type || ''} onChange={(e) => handleChange('insurance_type', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Insurance Company No</label>
                      <input value={formData.insurance_company_no || ''} onChange={(e) => handleChange('insurance_company_no', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Policy No</label>
                      <input value={formData.insurance_policy || ''} onChange={(e) => handleChange('insurance_policy', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Reference No</label>
                      <input value={formData.ref_no || ''} onChange={(e) => handleChange('ref_no', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
                    </div>
                    <div className="md:col-span-2 flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">Insurance Patient Register</label>
                      <select
                        value={formData.insurance_register}
                        onChange={(e) => handleChange('insurance_register', e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                      >
                        <option value="">Select insurance register</option>
                        {iprOptions
                          .filter((reg) => !reg.patient || reg.name === formData.insurance_register)
                          .map((reg) => (
                            <option key={reg.name} value={reg.name}>
                              {reg.name}
                              {reg.full_name ? ` — ${reg.full_name}` : ''}
                              {reg.status ? ` (${reg.status})` : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TAB: Next of Kin ── */}
            {activeTab === 'relations' && (
              <div>
                <p className="text-sm text-slate-500 mb-4">
                  Add family members, emergency contacts, and other relations for this patient.
                </p>
                <div className="space-y-3">
                  {relations.length === 0 && (
                    <div className="text-center py-10 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-sm">
                      No relations added yet. Click below to add one.
                    </div>
                  )}
                  {relations.map((row, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 p-4 bg-slate-50/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Relation #{idx + 1}</span>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input type="checkbox" checked={row.is_next_of_kin}
                              onChange={(e) => updateRelationRow(idx, 'is_next_of_kin', e.target.checked)}
                              className="rounded border-slate-300 text-primary focus:ring-primary" />
                            <span className="text-xs font-medium text-slate-700">Next of Kin</span>
                          </label>
                          <button type="button" onClick={() => removeRelationRow(idx)}
                            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Remove">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">Full Name</label>
                          <input type="text" value={row.full_name || ''} onChange={(e) => updateRelationRow(idx, 'full_name', e.target.value)}
                            placeholder="Full name"
                            className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">Relation</label>
                          <select value={row.relation || ''} onChange={(e) => updateRelationRow(idx, 'relation', e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                            <option value="">Select relation</option>
                            {PATIENT_RELATION_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">Mobile No</label>
                          <input type="tel" inputMode="numeric" pattern="[0-9]*" value={row.mobile_no || ''} onChange={(e) => updateRelationRow(idx, 'mobile_no', e.target.value)}
                            placeholder="Numbers only"
                            className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-0.5">Email</label>
                          <input type="email" value={row.email || ''} onChange={(e) => updateRelationRow(idx, 'email', e.target.value)}
                            placeholder="Email address"
                            className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addRelationRow}
                    className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Next of Kin / relative
                  </button>
                </div>
              </div>
            )}

            {/* ── TAB: Documents ── */}
            {activeTab === 'documents' && (
              <div>
                <p className="text-sm text-slate-500 mb-4">
                  Attach identification documents, reports, or other files. You can upload a file <em>or</em> draw a digital signature directly on-screen.
                </p>
                <div className="space-y-4">
                  {documents.length === 0 && (
                    <div className="text-center py-10 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-sm">
                      No documents added yet. Click below to add one.
                    </div>
                  )}

                  {documents.map((row, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
                      {/* Card header */}
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Document #{idx + 1}
                        </span>
                        <button type="button" onClick={() => removeDocumentRow(idx)}
                          className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Remove row">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {/* Two-column layout: metadata left, signature right */}
                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] divide-y lg:divide-y-0 lg:divide-x divide-slate-200">

                        {/* Left: metadata + file upload */}
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">File Name</label>
                            <input value={row.file_name} onChange={(e) => updateDocumentRow(idx, 'file_name', e.target.value)}
                              placeholder="File name"
                              className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">Document Type</label>
                            <DocumentTypeSelect
                              value={row.document_type || ''}
                              onChange={(v) => updateDocumentRow(idx, 'document_type', v)}
                              types={documentTypes}
                              onTypesUpdated={setDocumentTypes}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">Transaction No</label>
                            <input value={row.transaction_no || ''} onChange={(e) => updateDocumentRow(idx, 'transaction_no', e.target.value)}
                              placeholder="Transaction number"
                              className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">Upload Remarks</label>
                            <input value={row.upload_remarks || ''} onChange={(e) => updateDocumentRow(idx, 'upload_remarks', e.target.value)}
                              placeholder="Remarks"
                              className="w-full rounded border border-slate-300 bg-white text-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-slate-600 mb-0.5">
                              File Attachment
                              <span className="ml-1 font-normal text-slate-400">(photo, PDF, etc.)</span>
                            </label>
                            <input type="file" disabled={documentUploading === idx}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDocumentFile(idx, f); e.target.value = '' }}
                              className="w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-white file:text-sm" />
                            {documentUploading === idx && (
                              <span className="text-xs text-slate-500 mt-0.5 block">Uploading...</span>
                            )}
                            {row.document && documentUploading !== idx && signatureUploading !== idx && (
                              <a href={row.document} target="_blank" rel="noreferrer" className="text-xs text-green-600 mt-0.5 block truncate hover:underline" title={row.document}>
                                ✓ File attached — click to open
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Right: digital signature pad */}
                        <div className="p-4 flex flex-col gap-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <PenLine className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs font-medium text-slate-600">Digital Signature</span>
                            <span className="text-xs text-slate-400 ml-1">— draw &amp; save as file</span>
                          </div>
                          <div className="flex-1">
                            <SignaturePad
                              onSave={(file) => handleSignatureFile(idx, file)}
                              existingUrl={row.document?.includes('signature_') ? row.document : undefined}
                              uploading={signatureUploading === idx}
                            />
                          </div>
                          {signatureUploading === idx && (
                            <p className="text-xs text-slate-500 text-center">Uploading signature...</p>
                          )}
                          <p className="text-xs text-slate-400 leading-relaxed">
                            Draw your signature above, then tap <strong>Save Signature</strong> — stored as a PNG attached to this row.
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={addDocumentRow}
                    className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add document
                  </button>
                </div>
              </div>
            )}
          </div>

            {/* ── TAB: Attach CPR front & back (image only) ── */}
            {activeTab === 'cpr' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {([
                  { side: 'front' as const, label: 'CPR Front', value: cprPhoto, setValue: setCprPhoto },
                  { side: 'back' as const, label: 'CPR Back', value: cprPhotoBack, setValue: setCprPhotoBack },
                ]).map(({ side, label, value, setValue }) => (
                  <div key={side} className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-800">{label}</h4>
                    <div className="flex items-center gap-3">
                        <label
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-md cursor-pointer transition-colors ${
                            cprUploading === side
                              ? 'bg-slate-200 text-slate-500'
                              : 'bg-primary text-white hover:bg-primary/90'
                          }`}
                          title={cprUploading === side ? 'Uploading…' : value ? `Replace ${label}` : `Attach ${label}`}
                        >
                          {cprUploading === side ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : value ? (
                            <RefreshCw className="w-4 h-4" />
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            disabled={cprUploading !== null}
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (f) handleCprFile(side, f)
                              e.target.value = ''
                            }}
                            className="hidden"
                          />
                        </label>
                        {value && (
                          <>
                            <a
                              href={value}
                              download
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              title={`Download ${label}`}
                            >
                              <Download className="w-4 h-4" />
                            </a>
                            <button
                              type="button"
                              onClick={() => setValue('')}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-red-500 hover:bg-red-50"
                              title={`Remove ${label}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                    </div>
                    {value ? (
                      <a href={value} target="_blank" rel="noreferrer" title="Click to open full size" className="block rounded-lg border border-slate-200 bg-white p-2 hover:ring-2 hover:ring-primary/40">
                        <img src={value} alt={label} className="mx-auto max-h-56 object-contain" />
                      </a>
                    ) : (
                      <div className="rounded-lg border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                        Attach the patient's CPR {side} image (image files only).
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          {/* Footer */}
          <div className={`${CREATE_MODAL_FOOTER_STICKY} items-center justify-between`}>
            <div className="flex gap-2">
              {activeTab !== 'details' && (
                <button type="button"
                  onClick={() => setActiveTab(activeTab === 'cpr' ? 'documents' : activeTab === 'documents' ? 'relations' : 'details')}
                  className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
              )}
              {activeTab !== 'cpr' && (
                <button type="button"
                  onClick={() => setActiveTab(activeTab === 'details' ? 'relations' : activeTab === 'documents' ? 'cpr' : 'documents')}
                  className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 flex items-center gap-1">
                  Next
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className={CM_BTN_CANCEL}>
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className={CM_BTN_PRIMARY}>
                {loading ? 'Creating...' : 'Create Patient'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {showCreateSource && (
        <CreateLeadSourceModal
          onClose={() => setShowCreateSource(false)}
          onSuccess={(created) => {
            const option: LinkFieldOption = { name: created.name, label: created.source }
            setSourceOptions((prev) => [option, ...prev])
            setSelectedSource(option)
            setFormData((prev) => ({ ...prev, source: created.name }))
            setSourceQuery('')
            setSourceOpen(false)
            setShowCreateSource(false)
          }}
        />
      )}
      {showCreateNationality && (
        <CreateNationalityModal
          onClose={() => setShowCreateNationality(false)}
          onSuccess={(created) => {
            const option: LinkFieldOption = { name: created.name, label: created.nationality, country: created.country }
            setNationalityOptions((prev) => [option, ...prev])
            setSelectedNationality(option)
            setFormData((prev) => ({ ...prev, nationality: created.name }))
            setNationalityQuery('')
            setNationalityOpen(false)
            setShowCreateNationality(false)
          }}
        />
      )}
    </div>
  )
}