import { useEffect, useMemo, useState } from 'react'
import { Activity, ClipboardList, Pencil, Stethoscope, Trash2, Zap } from 'lucide-react'
import { fetchDoc } from '../../services/common'
import { deleteDoctypeRow } from '../../services/doctypeResource'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'
import { CreateECTProcedureModal } from './CreateECTProcedureModal'
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

interface ECTProcedureDetailPanelProps {
  name: string
  subtitle?: string
  onClose: () => void
  onChanged?: () => void
}

export function ECTProcedureDetailPanel({
  name,
  subtitle,
  onClose,
  onChanged,
}: ECTProcedureDetailPanelProps) {
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
    fetchDoc('ECT Procedure', name)
      .then((data) => {
        if (!cancelled) setDoc(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load ECT Procedure')
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
      await deleteDoctypeRow('ECT Procedure', name)
      toast.success('ECT Procedure deleted')
      setShowDelete(false)
      onChanged?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete ECT Procedure')
    } finally {
      setDeleting(false)
    }
  }

  const headerSubtitle = useMemo(() => {
    if (!doc) return subtitle ?? name
    const parts = [
      displayValue(doc.patient_name || doc.patient),
      hasValue(doc.date_of_session) ? `Session ${formatDate(doc.date_of_session)}` : null,
      hasValue(doc.no_of_session) ? `#${doc.no_of_session}` : null,
    ].filter(Boolean)
    return parts.join(' · ') || subtitle || name
  }, [doc, subtitle, name])

  const beforeVitals = [
    { key: 'bp', label: 'BP' },
    { key: 'hr', label: 'HR' },
    { key: 'temp', label: 'Temp' },
    { key: 'resp_rate', label: 'Resp' },
    { key: 'spo2', label: 'SpO₂' },
  ].filter((f) => doc && hasValue(doc[f.key]))

  const afterVitals = [
    { key: 'bp_after', label: 'BP' },
    { key: 'hr_after', label: 'HR' },
    { key: 'resp_rate_after', label: 'Resp' },
    { key: 'spo2_after', label: 'SpO₂' },
  ].filter((f) => doc && hasValue(doc[f.key]))

  return (
    <>
    <DetailSlideOver
      title="ECT Procedure"
      subtitle={headerSubtitle}
      icon={<Zap className="h-5 w-5 text-sky-700" strokeWidth={2} />}
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
            doctype="ECT Procedure"
            docName={name}
            noLetterhead={0}
            triggerPrint={1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200/80 bg-white/80 text-sky-700 shadow-sm transition hover:bg-sky-50"
          />
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-500">
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          Loading procedure…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {doc && !loading && !error ? (
        <div className="flex flex-col gap-5 pb-2">
          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_SECTION_TITLE_CLASS}>
              <ClipboardList className="h-4 w-4 text-sky-600" strokeWidth={2} />
              Session
            </h3>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {hasValue(doc.energy) ? <VitalTile label="Energy" value={displayValue(doc.energy)} /> : null}
              {hasValue(doc.gtcs_for) ? <VitalTile label="GTCs for" value={displayValue(doc.gtcs_for)} /> : null}
              {hasValue(doc.no_of_session) ? (
                <VitalTile label="Session #" value={displayValue(doc.no_of_session)} />
              ) : null}
              {hasValue(doc.type_of_anaesthesia) ? (
                <DataTile label="Anaesthesia" value={displayValue(doc.type_of_anaesthesia)} />
              ) : null}
              {hasValue(doc.npo_since) ? (
                <DataTile label="NPO since" value={formatDate(doc.npo_since)} />
              ) : null}
            </div>
          </section>

          {(beforeVitals.length > 0 || afterVitals.length > 0) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>
                <Activity className="h-4 w-4 text-sky-600" strokeWidth={2} />
                Stats
              </h3>
              {beforeVitals.length > 0 ? (
                <div className="mb-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Before session
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {beforeVitals.map((f) => (
                      <VitalTile key={f.key} label={f.label} value={displayValue(doc[f.key])} />
                    ))}
                  </div>
                </div>
              ) : null}
              {afterVitals.length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    After session
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {afterVitals.map((f) => (
                      <VitalTile key={f.key} label={f.label} value={displayValue(doc[f.key])} />
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          )}

          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_SECTION_TITLE_CLASS}>
              <Stethoscope className="h-4 w-4 text-sky-600" strokeWidth={2} />
              Care team
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {hasValue(doc.consultant_doctors_name || doc.consultant_doctor) ? (
                <DataTile
                  label="Consultant"
                  value={displayValue(doc.consultant_doctors_name || doc.consultant_doctor)}
                />
              ) : null}
              {hasValue(doc.assistant_doctor_name || doc.assistant_doctor) ? (
                <DataTile
                  label="Assistant doctor"
                  value={displayValue(doc.assistant_doctor_name || doc.assistant_doctor)}
                />
              ) : null}
              {hasValue(doc.anaesthetist_name || doc.anaesthetist) ? (
                <DataTile
                  label="Anaesthetist"
                  value={displayValue(doc.anaesthetist_name || doc.anaesthetist)}
                />
              ) : null}
            </div>
          </section>

          {(hasValue(doc.progress_plan) || hasValue(doc.other_complications)) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>
                <ClipboardList className="h-4 w-4 text-sky-600" strokeWidth={2} />
                Notes
              </h3>
              <div className="space-y-2.5">
                {hasValue(doc.progress_plan) ? (
                  <NoteBlock label="Notes" value={String(doc.progress_plan)} />
                ) : null}
                {hasValue(doc.other_complications) ? (
                  <NoteBlock
                    label="Other complications / contradictions"
                    value={String(doc.other_complications)}
                  />
                ) : null}
              </div>
            </section>
          )}

          {(hasValue(doc.doctor_signature) || hasValue(doc.consultant_signature)) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>Signatures</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <AttachBlock label="Assistant doctor signature" path={doc.doctor_signature} />
                <AttachBlock label="Consultant signature" path={doc.consultant_signature} />
              </div>
            </section>
          )}

          <MetaFooter>
            <DataTile label="Patient" value={displayValue(doc.patient_name || doc.patient)} />
            <DataTile label="Record ID" value={displayValue(doc.name)} />
            {hasValue(doc.date_of_session) ? (
              <DataTile label="Date of session" value={formatDate(doc.date_of_session)} />
            ) : null}
            {hasValue(doc.date) ? <DataTile label="Date" value={formatDate(doc.date)} /> : null}
            {hasValue(doc.sign_date) ? (
              <DataTile label="Sign date" value={formatDate(doc.sign_date)} />
            ) : null}
            {hasValue(doc.consultant_sign_date) ? (
              <DataTile label="Consultant sign date" value={formatDate(doc.consultant_sign_date)} />
            ) : null}
            {hasValue(doc.creation) ? (
              <DataTile label="Created" value={formatDateTime(doc.creation)} />
            ) : null}
            {hasValue(doc.modified) ? (
              <DataTile label="Modified" value={formatDateTime(doc.modified)} />
            ) : null}
          </MetaFooter>
          {!canMutate && doc.creation ? (
            <p className="text-[11px] text-slate-500">{ECT_FORM_MUTATE_HINT}</p>
          ) : null}
        </div>
      ) : null}
    </DetailSlideOver>

    {showEdit && doc ? (
      <CreateECTProcedureModal
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
        title="Delete ECT Procedure?"
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
