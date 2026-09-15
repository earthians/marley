import { useEffect, useMemo, useState } from 'react'
import { Activity, ClipboardList, Pencil, Stethoscope, Trash2, Zap } from 'lucide-react'
import { fetchECTDetail, type ECTDetail } from '../../services/ectDetails'
import { deleteDoctypeRow } from '../../services/doctypeResource'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'
import { CreateECTDetailModal } from './CreateECTDetailModal'
import {
  canMutateEctForm,
  ECT_FORM_EDIT_LOCKED_MESSAGE,
  ECT_FORM_MUTATE_HINT,
} from './ectForm24h'
import {
  DataTile,
  MetaFooter,
  NoteBlock,
  VitalTile,
  displayValue,
  formatDate,
  formatDateTime,
  formatTime,
  hasValue,
} from './ectDetailUi'

interface ECTDetailsDetailPanelProps {
  name: string
  onClose: () => void
  onChanged?: () => void
}

export function ECTDetailsDetailPanel({ name, onClose, onChanged }: ECTDetailsDetailPanelProps) {
  const { lockEditingData, guardClinicalEdit } = useCareContext()
  const [ect, setEct] = useState<ECTDetail | null>(null)
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
    fetchECTDetail(name)
      .then((data) => {
        if (!cancelled) setEct(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load ECT Details')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [name, reloadKey])

  const canMutate = canMutateEctForm(ect?.creation ? String(ect.creation) : null, lockEditingData)

  const headerSubtitle = useMemo(() => {
    if (!ect) return name
    const parts = [
      ect.patient_name || ect.patient,
      ect.energy ? `Energy ${ect.energy}` : null,
      ect.success ? String(ect.success) : null,
    ].filter(Boolean)
    return parts.join(' · ') || name
  }, [ect, name])

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
      await deleteDoctypeRow('ECT Details', name)
      toast.success('ECT Details deleted')
      setShowDelete(false)
      onChanged?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete ECT Details')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <DetailSlideOver
        title="ECT Details"
        subtitle={headerSubtitle}
        icon={<Zap className="h-5 w-5 text-blue-700" strokeWidth={2} />}
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
              doctype="ECT Details"
              docName={name}
              noLetterhead={0}
              triggerPrint={1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-200/80 bg-white/80 text-blue-700 shadow-sm transition hover:bg-blue-50"
            />
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">
            Loading ECT details…
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        {ect && !loading && !error ? (
          <div className="flex flex-col gap-5 pb-2">
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>
                <Activity className="h-4 w-4 text-blue-600" strokeWidth={2} />
                Procedure outcome
              </h3>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {hasValue(ect.energy) ? <VitalTile label="Energy" value={displayValue(ect.energy)} /> : null}
                {hasValue(ect.duration) ? (
                  <VitalTile label="Duration" value={displayValue(ect.duration)} />
                ) : null}
                {hasValue(ect.success) ? (
                  <VitalTile label="Success" value={displayValue(ect.success)} />
                ) : null}
                {hasValue(ect.repeated) ? (
                  <VitalTile label="Repeated" value={displayValue(ect.repeated)} />
                ) : null}
                {hasValue(ect._age) ? <DataTile label="% Age" value={displayValue(ect._age)} /> : null}
                {hasValue(ect.vitals) ? <DataTile label="Vitals" value={displayValue(ect.vitals)} /> : null}
                {hasValue(ect.ecg) ? <DataTile label="ECG" value={displayValue(ect.ecg)} /> : null}
                {hasValue(ect.source) ? <DataTile label="Source" value={displayValue(ect.source)} /> : null}
              </div>
            </section>

            {(hasValue(ect.bp_1) ||
              hasValue(ect.bp_2) ||
              hasValue(ect.max_bp_1) ||
              hasValue(ect.max_bp2)) && (
              <section className={MODAL_SECTION_CLASS}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>Blood pressure</h3>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {hasValue(ect.bp_1) ? <VitalTile label="BP 1" value={displayValue(ect.bp_1)} /> : null}
                  {hasValue(ect.bp_2) ? <VitalTile label="BP 2" value={displayValue(ect.bp_2)} /> : null}
                  {hasValue(ect.max_bp_1) ? (
                    <VitalTile label="Max BP 1" value={displayValue(ect.max_bp_1)} />
                  ) : null}
                  {hasValue(ect.max_bp2) ? (
                    <VitalTile label="Max BP 2" value={displayValue(ect.max_bp2)} />
                  ) : null}
                </div>
              </section>
            )}

            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>
                <Stethoscope className="h-4 w-4 text-blue-600" strokeWidth={2} />
                Care team
              </h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {hasValue(ect.doctors_name || ect.psychiatrist) ? (
                  <DataTile
                    label="Doctor"
                    value={displayValue(ect.doctors_name || ect.psychiatrist)}
                  />
                ) : null}
                {hasValue(ect.anathesiologist || ect.anaesthetic_doctor) ? (
                  <DataTile
                    label="Anesthesiologist"
                    value={displayValue(ect.anathesiologist || ect.anaesthetic_doctor)}
                  />
                ) : null}
                {hasValue(ect.assist_doctor) ? (
                  <DataTile label="Assist doctor" value={displayValue(ect.assist_doctor)} />
                ) : null}
                {hasValue(ect.psychology_doctor) ? (
                  <DataTile label="Psychology doctor" value={displayValue(ect.psychology_doctor)} />
                ) : null}
                {hasValue(ect.nurse_name || ect.nurse) ? (
                  <DataTile label="Nurse" value={displayValue(ect.nurse_name || ect.nurse)} />
                ) : null}
              </div>
            </section>

            {(hasValue(ect.propofol_detail) || hasValue(ect.succinycholine_detail)) && (
              <section className={MODAL_SECTION_CLASS}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>
                  <ClipboardList className="h-4 w-4 text-blue-600" strokeWidth={2} />
                  Medications
                </h3>
                <div className="space-y-2.5">
                  {hasValue(ect.propofol_detail) ? (
                    <NoteBlock label="Propofol" value={String(ect.propofol_detail)} />
                  ) : null}
                  {hasValue(ect.succinycholine_detail) ? (
                    <NoteBlock label="Succinylcholine" value={String(ect.succinycholine_detail)} />
                  ) : null}
                </div>
              </section>
            )}

            {(hasValue(ect.ect_doctors_notes) || hasValue(ect.ect_nurse_notes)) && (
              <section className={MODAL_SECTION_CLASS}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>Notes</h3>
                <div className="space-y-2.5">
                  {hasValue(ect.ect_doctors_notes) ? (
                    <NoteBlock label="Doctor notes" value={String(ect.ect_doctors_notes)} />
                  ) : null}
                  {hasValue(ect.ect_nurse_notes) ? (
                    <NoteBlock label="Nurse notes" value={String(ect.ect_nurse_notes)} />
                  ) : null}
                </div>
              </section>
            )}

            <MetaFooter>
              <DataTile label="Patient" value={displayValue(ect.patient_name || ect.patient)} />
              <DataTile label="Record ID" value={displayValue(ect.name)} />
              {hasValue(ect.cost_center) ? (
                <DataTile label="Branch" value={displayValue(ect.cost_center)} />
              ) : null}
              {hasValue(ect.date) ? (
                <DataTile
                  label="Date / time"
                  value={`${formatDate(ect.date)}${hasValue(ect.time) ? ` ${formatTime(ect.time)}` : ''}`}
                />
              ) : null}
              {hasValue(ect.date_and_time) ? (
                <DataTile label="Doctor signed" value={formatDateTime(ect.date_and_time)} />
              ) : null}
              {hasValue(ect.n_date_and_time) ? (
                <DataTile label="Nurse signed" value={formatDateTime(ect.n_date_and_time)} />
              ) : null}
              {hasValue(ect.reference_doctype) ? (
                <DataTile
                  label="Reference"
                  value={`${ect.reference_doctype}${ect.reference_name ? ` · ${ect.reference_name}` : ''}`}
                />
              ) : null}
              {hasValue(ect.creation) ? (
                <DataTile label="Created" value={formatDateTime(ect.creation)} />
              ) : null}
            </MetaFooter>
            {!canMutate && ect.creation ? (
              <p className="text-[11px] text-slate-500">{ECT_FORM_MUTATE_HINT}</p>
            ) : null}
          </div>
        ) : null}
      </DetailSlideOver>

      {showEdit && ect ? (
        <CreateECTDetailModal
          editName={name}
          initialPatient={ect.patient}
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
          title="Delete ECT Details?"
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
