import { useEffect, useMemo, useState } from 'react'
import { FileSignature, Pencil, Shield, Trash2, Users } from 'lucide-react'
import { fetchDoc } from '../../services/common'
import { deleteDoctypeRow } from '../../services/doctypeResource'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'
import { ECTAnesthesiaConsentModal } from './ECTAnesthesiaConsentModal'
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
  displayValue,
  formatDate,
  formatDateTime,
  formatTime,
  hasValue,
  type DocRecord,
} from './ectDetailUi'

interface ECTAnesthesiaConsentDetailPanelProps {
  name: string
  subtitle?: string
  onClose: () => void
  onChanged?: () => void
}

export function ECTAnesthesiaConsentDetailPanel({
  name,
  subtitle,
  onClose,
  onChanged,
}: ECTAnesthesiaConsentDetailPanelProps) {
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
    fetchDoc('ECT Anesthesia Consent', name)
      .then((data) => {
        if (!cancelled) setDoc(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Anesthesia Consent')
        }
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
      await deleteDoctypeRow('ECT Anesthesia Consent', name)
      toast.success('Anesthesia Consent deleted')
      setShowDelete(false)
      onChanged?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete Anesthesia Consent')
    } finally {
      setDeleting(false)
    }
  }

  const headerSubtitle = useMemo(() => {
    if (!doc) return subtitle ?? name
    const parts = [
      displayValue(doc.patient_name || doc.patient),
      hasValue(doc.anesthesiologit_name || doc.anesthesiologist)
        ? displayValue(doc.anesthesiologit_name || doc.anesthesiologist)
        : null,
    ].filter(Boolean)
    return parts.join(' · ') || subtitle || name
  }, [doc, subtitle, name])

  const admissionNo = String(doc?.inpatient_admission || '')
  const patientId = String(doc?.patient || '')
  const patientName = String(doc?.patient_name || '')

  return (
    <>
    <DetailSlideOver
      title="Anesthesia Consent"
      subtitle={headerSubtitle}
      icon={<FileSignature className="h-5 w-5 text-indigo-700" strokeWidth={2} />}
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
            doctype="ECT Anesthesia Consent"
            docName={name}
            noLetterhead={0}
            triggerPrint={1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-200/80 bg-white/80 text-indigo-700 shadow-sm transition hover:bg-indigo-50"
          />
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-500">
          Loading consent…
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {doc && !loading && !error ? (
        <div className="flex flex-col gap-5 pb-2">
          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_SECTION_TITLE_CLASS}>
              <Shield className="h-4 w-4 text-indigo-600" strokeWidth={2} />
              Anesthesiologist
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {hasValue(doc.anesthesiologit_name || doc.anesthesiologist) ? (
                <DataTile
                  label="Anesthesiologist"
                  value={displayValue(doc.anesthesiologit_name || doc.anesthesiologist)}
                />
              ) : null}
              <AttachBlock label="Anesthesiologist signature" path={doc.signature} />
            </div>
          </section>

          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_SECTION_TITLE_CLASS}>
              <Users className="h-4 w-4 text-indigo-600" strokeWidth={2} />
              Patient &amp; guardian
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {hasValue(doc.cpr_no) ? <DataTile label="Patient CPR" value={displayValue(doc.cpr_no)} /> : null}
              <AttachBlock label="Patient signature" path={doc.signature_of_the_patient} />
              {hasValue(doc.patients_legal_guardian) ? (
                <DataTile label="Legal guardian" value={displayValue(doc.patients_legal_guardian)} />
              ) : null}
              {hasValue(doc.relation_to_patient) ? (
                <DataTile label="Relation" value={displayValue(doc.relation_to_patient)} />
              ) : null}
              {hasValue(doc.guardian_cpr_no) ? (
                <DataTile label="Guardian CPR" value={displayValue(doc.guardian_cpr_no)} />
              ) : null}
              <AttachBlock label="Guardian signature" path={doc.guardian_signature} />
            </div>
          </section>

          {(hasValue(doc.witness_name) || hasValue(doc.witness_signature)) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>Witness</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {hasValue(doc.witness_name) ? (
                  <DataTile label="Witness" value={displayValue(doc.witness_name)} />
                ) : null}
                {hasValue(doc.witness_cpr_no) ? (
                  <DataTile label="Witness CPR" value={displayValue(doc.witness_cpr_no)} />
                ) : null}
                <AttachBlock label="Witness signature" path={doc.witness_signature} />
              </div>
            </section>
          )}

          {(hasValue(doc.conscious_sedation_consent_form) || hasValue(doc.conscious)) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>Consent terms</h3>
              <div className="space-y-2.5">
                {hasValue(doc.termsenglish) ? (
                  <DataTile label="Terms (English)" value={displayValue(doc.termsenglish)} />
                ) : null}
                {hasValue(doc.conscious_sedation_consent_form) ? (
                  <NoteBlock
                    label="Consent form (English)"
                    value={String(doc.conscious_sedation_consent_form)}
                  />
                ) : null}
                {hasValue(doc.termsarabic) ? (
                  <DataTile label="Terms (Arabic)" value={displayValue(doc.termsarabic)} />
                ) : null}
                {hasValue(doc.conscious) ? (
                  <NoteBlock label="Consent form (Arabic)" value={String(doc.conscious)} />
                ) : null}
              </div>
            </section>
          )}

          <MetaFooter>
            <DataTile label="Patient" value={displayValue(doc.patient_name || doc.patient)} />
            <DataTile label="Record ID" value={displayValue(doc.name)} />
            {hasValue(doc.inpatient_admission) ? (
              <DataTile label="Admission" value={displayValue(doc.inpatient_admission)} />
            ) : null}
            {hasValue(doc.patient_visit) ? (
              <DataTile label="Visit" value={displayValue(doc.patient_visit)} />
            ) : null}
            {hasValue(doc.date) ? <DataTile label="Date" value={formatDate(doc.date)} /> : null}
            {hasValue(doc.time) ? <DataTile label="Time" value={formatTime(doc.time)} /> : null}
            {hasValue(doc.guardian_sign_date) ? (
              <DataTile
                label="Guardian signed"
                value={`${formatDate(doc.guardian_sign_date)}${hasValue(doc.guardian_sign_time) ? ` ${formatTime(doc.guardian_sign_time)}` : ''}`}
              />
            ) : null}
            {hasValue(doc.witness_sign_date) ? (
              <DataTile
                label="Witness signed"
                value={`${formatDate(doc.witness_sign_date)}${hasValue(doc.witness_sign_time) ? ` ${formatTime(doc.witness_sign_time)}` : ''}`}
              />
            ) : null}
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
      <ECTAnesthesiaConsentModal
        editName={name}
        admissionNo={admissionNo}
        patient={patientId}
        patientName={patientName}
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
        title="Delete Anesthesia Consent?"
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
