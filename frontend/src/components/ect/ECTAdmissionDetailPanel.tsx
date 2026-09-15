import { useEffect, useMemo, useState } from 'react'
import { Activity, ClipboardList, FileHeart, Pencil, Stethoscope, Trash2 } from 'lucide-react'
import { fetchDoc } from '../../services/common'
import { deleteDoctypeRow } from '../../services/doctypeResource'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'
import { CreateECTAdmissionModal } from './CreateECTAdmissionModal'
import {
  canMutateEctForm,
  ECT_FORM_EDIT_LOCKED_MESSAGE,
  ECT_FORM_MUTATE_HINT,
} from './ectForm24h'
import {
  AttachBlock,
  DataTile,
  MetaFooter,
  NoteBlock,
  VitalTile,
  displayValue,
  formatDate,
  formatDateTime,
  hasValue,
  type DocRecord,
} from './ectDetailUi'

interface ECTAdmissionDetailPanelProps {
  name: string
  subtitle?: string
  onClose: () => void
  onChanged?: () => void
}

export function ECTAdmissionDetailPanel({
  name,
  subtitle,
  onClose,
  onChanged,
}: ECTAdmissionDetailPanelProps) {
  const { lockEditingData, guardClinicalEdit } = useCareContext()
  const [doc, setDoc] = useState<DocRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchDoc('ECT Admission', name)
      .then((data) => {
        if (!cancelled) setDoc(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load ECT Admission')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [name, reloadKey])

  const canMutate = canMutateEctForm(doc?.creation ? String(doc.creation) : null, lockEditingData)

  const openEdit = () => {
    if (!canMutate) {
      toast.error(lockEditingData ? 'Editing is locked in Healthcare Settings.' : ECT_FORM_EDIT_LOCKED_MESSAGE)
      return
    }
    guardClinicalEdit(() => setShowEdit(true))
  }

  const openDelete = () => {
    if (!canMutate) {
      toast.error(lockEditingData ? 'Editing is locked in Healthcare Settings.' : ECT_FORM_EDIT_LOCKED_MESSAGE)
      return
    }
    guardClinicalEdit(() => setShowDelete(true))
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await deleteDoctypeRow('ECT Admission', name)
      toast.success('ECT Admission deleted')
      setShowDelete(false)
      onChanged?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete ECT Admission')
    } finally {
      setDeleting(false)
    }
  }

  const headerSubtitle = useMemo(() => {
    if (!doc) return subtitle ?? name
    const parts = [
      displayValue(doc.patient_name || doc.patient),
      hasValue(doc.date) ? formatDate(doc.date) : null,
    ].filter(Boolean)
    return parts.join(' · ') || subtitle || name
  }, [doc, subtitle, name])

  const vitals = [
    { key: 'bp', label: 'BP' },
    { key: 'hr', label: 'HR' },
    { key: 'resp_rate', label: 'Resp' },
    { key: 'spo2', label: 'SpO₂' },
  ].filter((f) => doc && hasValue(doc[f.key]))

  return (
    <>
    <DetailSlideOver
      title="ECT Admission"
      subtitle={headerSubtitle}
      icon={<FileHeart className="h-5 w-5 text-cyan-700" strokeWidth={2} />}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      headerActions={
        <div className="flex items-center gap-1.5">
          {canMutate ? (
            <>
              <button
                type="button"
                onClick={openEdit}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-emerald-200/80 bg-white/80 px-2.5 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50"
                title="Edit (within 24 hours of creation)"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                Edit
              </button>
              <button
                type="button"
                onClick={openDelete}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-200 bg-white/80 px-2.5 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50"
                title="Delete (within 24 hours of creation)"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                Delete
              </button>
            </>
          ) : null}
          <PrintFormatDropdown
            doctype="ECT Admission"
            docName={name}
            noLetterhead={0}
            triggerPrint={1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-200/80 bg-white/80 text-cyan-700 shadow-sm transition hover:bg-cyan-50"
          />
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-500">
          Loading admission…
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {doc && !loading && !error ? (
        <div className="flex flex-col gap-5 pb-2">
          {vitals.length > 0 ? (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>
                <Activity className="h-4 w-4 text-cyan-600" strokeWidth={2} />
                Vitals on admission
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {vitals.map((f) => (
                  <VitalTile key={f.key} label={f.label} value={displayValue(doc[f.key])} />
                ))}
              </div>
            </section>
          ) : null}

          {(hasValue(doc.psychiatric_diagnosis) ||
            hasValue(doc.medical_history) ||
            hasValue(doc.patient_allergy_history) ||
            hasValue(doc.other_complications) ||
            hasValue(doc.instructions)) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>
                <ClipboardList className="h-4 w-4 text-cyan-600" strokeWidth={2} />
                Clinical history
              </h3>
              <div className="space-y-2.5">
                {hasValue(doc.psychiatric_diagnosis) ? (
                  <NoteBlock label="Psychiatric diagnosis" value={String(doc.psychiatric_diagnosis)} />
                ) : null}
                {hasValue(doc.medical_history) ? (
                  <NoteBlock label="Medical history" value={String(doc.medical_history)} />
                ) : null}
                {hasValue(doc.patient_allergy_history) ? (
                  <NoteBlock label="Allergy history" value={String(doc.patient_allergy_history)} />
                ) : null}
                {hasValue(doc.other_complications) ? (
                  <NoteBlock
                    label="Other complications / contradictions"
                    value={String(doc.other_complications)}
                  />
                ) : null}
                {hasValue(doc.instructions) ? (
                  <NoteBlock label="Instructions" value={String(doc.instructions)} />
                ) : null}
              </div>
            </section>
          )}

          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_SECTION_TITLE_CLASS}>
              <Stethoscope className="h-4 w-4 text-cyan-600" strokeWidth={2} />
              Doctor
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {hasValue(doc.doctors_name || doc.doctor) ? (
                <DataTile label="Doctor" value={displayValue(doc.doctors_name || doc.doctor)} />
              ) : null}
              <AttachBlock label="Doctor signature" path={doc.doctor_signature} />
            </div>
          </section>

          <MetaFooter>
            <DataTile label="Patient" value={displayValue(doc.patient_name || doc.patient)} />
            <DataTile label="Record ID" value={displayValue(doc.name)} />
            {hasValue(doc.date) ? <DataTile label="Date" value={formatDate(doc.date)} /> : null}
            {hasValue(doc.creation) ? (
              <DataTile label="Created" value={formatDateTime(doc.creation)} />
            ) : null}
          </MetaFooter>
          {!canMutate && doc.creation ? (
            <p className="text-[11px] text-slate-500">{ECT_FORM_MUTATE_HINT}</p>
          ) : null}
        </div>
      ) : null}
    </DetailSlideOver>

    {showEdit && doc ? (
      <CreateECTAdmissionModal
        editName={name}
        initialPatient={String(doc.patient || '')}
        onClose={() => setShowEdit(false)}
        onSuccess={() => {
          setShowEdit(false)
          setReloadKey((k) => k + 1)
          onChanged?.()
        }}
      />
    ) : null}

    {showDelete ? (
      <ConfirmDialog
        open
        title="Delete ECT Admission?"
        message={`Delete ${name}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onCancel={() => setShowDelete(false)}
        onConfirm={confirmDelete}
      />
    ) : null}
    </>
  )
}
