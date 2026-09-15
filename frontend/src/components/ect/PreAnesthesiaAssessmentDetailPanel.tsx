import { useEffect, useMemo, useState } from 'react'
import { Activity, ClipboardCheck, Pencil, Stethoscope, Trash2 } from 'lucide-react'
import { fetchDoc } from '../../services/common'
import { deleteDoctypeRow } from '../../services/doctypeResource'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'
import { PreAnesthesiaAssessmentModal } from './PreAnesthesiaAssessmentModal'
import {
  canMutateEctForm,
  ECT_FORM_EDIT_LOCKED_MESSAGE,
  ECT_FORM_MUTATE_HINT,
} from './ectForm24h'
import {
  AttachBlock,
  ChipList,
  DataTile,
  MetaFooter,
  NoteBlock,
  checkedLabels,
  displayValue,
  formatDate,
  formatDateTime,
  formatTime,
  hasValue,
  type DocRecord,
} from './ectDetailUi'

interface PreAnesthesiaAssessmentDetailPanelProps {
  name: string
  subtitle?: string
  onClose: () => void
  onChanged?: () => void
}

const SYSTEM_SECTIONS: Array<{
  title: string
  findings: Array<{ key: string; label: string }>
  notesKey?: string
}> = [
  {
    title: 'Cardiovascular',
    findings: [
      { key: 'cv_normal', label: 'No cardiovascular disease' },
      { key: 'hypertension_dysrhythmia', label: 'Hypertension / Dysrhythmia' },
      { key: 'angina_mi', label: 'Angina / MI' },
      { key: 'ccf', label: 'Congestive cardiac failure' },
      { key: 'vascular_valvular', label: 'Vascular / Valvular disease' },
      { key: 'pacemaker', label: 'Pacemaker' },
    ],
    notesKey: 'cv_notes',
  },
  {
    title: 'Pulmonary',
    findings: [
      { key: 'resp_normal', label: 'No respiratory disease' },
      { key: 'smoker', label: 'Smoker' },
      { key: 'chronic_cough', label: 'Chronic cough' },
      { key: 'sob', label: 'Shortness of breath' },
      { key: 'copd_emphysema', label: 'COPD / Emphysema' },
      { key: 'asthma_bronchitis', label: 'Asthma / Bronchitis' },
      { key: 'urti_tb', label: 'URTI / Pneumonia / TB' },
    ],
    notesKey: 'resp_notes',
  },
  {
    title: 'Hepatic',
    findings: [
      { key: 'jaundice_hepatitis', label: 'Jaundice / Hepatitis / HBsAg' },
      { key: 'cirrhosis', label: 'Cirrhosis' },
      { key: 'gall_bladder', label: 'Gall bladder disease' },
    ],
    notesKey: 'hepatic_notes',
  },
  {
    title: 'Renal',
    findings: [
      { key: 'renal_failure', label: 'Insufficiency / Failure' },
      { key: 'dialysis', label: 'Dialysis' },
      { key: 'renal_calculi', label: 'Calculi' },
      { key: 'recent_uti', label: 'Recent UTI' },
    ],
    notesKey: 'renal_notes',
  },
  {
    title: 'Endocrine',
    findings: [
      { key: 'diabetes', label: 'Diabetes' },
      { key: 'diet_control', label: 'Diet control' },
      { key: 'oral_agent', label: 'Oral agent' },
      { key: 'insulin', label: 'Insulin' },
      { key: 'dm_complications', label: 'DM complications' },
      { key: 'thyroid', label: 'Thyroid disease' },
    ],
    notesKey: 'endocrine_notes',
  },
  {
    title: 'Hematology',
    findings: [
      { key: 'coagulopathy', label: 'Coagulopathy / Family history' },
      { key: 'anemia', label: 'Anemia' },
      { key: 'sickle_cell', label: 'Sickle cell' },
      { key: 'g6pd', label: 'G6PD deficiency' },
      { key: 'anticoagulation', label: 'On anticoagulation' },
      { key: 'blood_transfusion', label: 'Previous transfusion' },
    ],
    notesKey: 'hematology_notes',
  },
  {
    title: 'Neurology',
    findings: [
      { key: 'seizure', label: 'Seizure disorder' },
      { key: 'stroke_tia', label: 'Stroke / TIA' },
      { key: 'head_injury', label: 'Head injury' },
      { key: 'paraesthesia', label: 'Paraesthesia / Paralysis' },
      { key: 'mental_status', label: 'Psychiatric / Mental status' },
      { key: 'pregnancy_lmp', label: 'Pregnancy LMP' },
    ],
    notesKey: 'neurology_notes',
  },
  {
    title: 'Gastrointestinal',
    findings: [
      { key: 'reflux', label: 'Hiatal hernia / Reflux' },
      { key: 'nausea_vomiting', label: 'Nausea / Vomiting' },
      { key: 'ulcer', label: 'Ulcer disease' },
    ],
    notesKey: 'gi_notes',
  },
  {
    title: 'Miscellaneous',
    findings: [
      { key: 'congenital', label: 'Congenital abnormality' },
      { key: 'hiv_hbsag', label: 'HIV / HBsAg positive' },
      { key: 'drug_allergy', label: 'Drug intake / Allergies' },
      { key: 'exercise_tolerance', label: 'Exercise tolerance' },
      { key: 'etoh_consumption', label: 'ETOH consumption' },
      { key: 'chemical_substances', label: 'Chemical substances' },
      { key: 'illness_and_pregnancy', label: 'Illness and pregnancy' },
    ],
    notesKey: 'miscellaneous_notes',
  },
]

export function PreAnesthesiaAssessmentDetailPanel({
  name,
  subtitle,
  onClose,
  onChanged,
}: PreAnesthesiaAssessmentDetailPanelProps) {
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
    fetchDoc('Pre Anesthesia Assessment', name)
      .then((data) => {
        if (!cancelled) setDoc(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Pre-Anesthesia Assessment')
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
      await deleteDoctypeRow('Pre Anesthesia Assessment', name)
      toast.success('Pre-Anesthesia Assessment deleted')
      setShowDelete(false)
      onChanged?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete Pre-Anesthesia Assessment')
    } finally {
      setDeleting(false)
    }
  }

  const headerSubtitle = useMemo(() => {
    if (!doc) return subtitle ?? name
    const parts = [
      displayValue(doc.patient_name || doc.patient),
      hasValue(doc.asa_class) ? `ASA ${displayValue(doc.asa_class)}` : null,
      hasValue(doc.fit_for_anesthesia) ? displayValue(doc.fit_for_anesthesia) : null,
    ].filter(Boolean)
    return parts.join(' · ') || subtitle || name
  }, [doc, subtitle, name])

  const admissionNo = String(doc?.inpatient_admission || '')
  const patientId = String(doc?.patient || '')
  const patientName = String(doc?.patient_name || '')

  return (
    <>
    <DetailSlideOver
      title="Pre-Anesthesia Assessment"
      subtitle={headerSubtitle}
      icon={<ClipboardCheck className="h-5 w-5 text-purple-700" strokeWidth={2} />}
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
            doctype="Pre Anesthesia Assessment"
            docName={name}
            noLetterhead={0}
            triggerPrint={1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-purple-200/80 bg-white/80 text-purple-700 shadow-sm transition hover:bg-purple-50"
          />
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-500">
          Loading assessment…
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {doc && !loading && !error ? (
        <div className="flex flex-col gap-5 pb-2">
          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_SECTION_TITLE_CLASS}>
              <Activity className="h-4 w-4 text-purple-600" strokeWidth={2} />
              Final assessment
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {hasValue(doc.asa_class) ? (
                <DataTile label="ASA classification" value={displayValue(doc.asa_class)} />
              ) : null}
              {hasValue(doc.fit_for_anesthesia) ? (
                <DataTile label="Fit for anesthesia" value={displayValue(doc.fit_for_anesthesia)} />
              ) : null}
              {hasValue(doc.risk_level) ? (
                <DataTile label="Risk level" value={displayValue(doc.risk_level)} />
              ) : null}
            </div>
            <div className="mt-2.5 space-y-2.5">
              {hasValue(doc.allergies) ? (
                <NoteBlock label="Known allergies" value={String(doc.allergies)} />
              ) : null}
              {hasValue(doc.current_medications) ? (
                <NoteBlock label="Current medications" value={String(doc.current_medications)} />
              ) : null}
              {hasValue(doc.remarks) ? (
                <NoteBlock label="Remarks / recommendations" value={String(doc.remarks)} />
              ) : null}
            </div>
          </section>

          {(hasValue(doc.surgical_history) ||
            hasValue(doc.anesthesia_history) ||
            hasValue(doc.anesthesia_complications) ||
            hasValue(doc.previous_anesthesia_complications)) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>
                <Stethoscope className="h-4 w-4 text-purple-600" strokeWidth={2} />
                History
              </h3>
              <div className="space-y-2.5">
                {hasValue(doc.surgical_history) ? (
                  <NoteBlock label="Surgical history" value={String(doc.surgical_history)} />
                ) : null}
                {hasValue(doc.anesthesia_history) ? (
                  <NoteBlock label="Anesthesia history" value={String(doc.anesthesia_history)} />
                ) : null}
                {hasValue(doc.anesthesia_complications || doc.previous_anesthesia_complications) ? (
                  <NoteBlock
                    label="Previous anesthesia complications"
                    value={String(
                      doc.previous_anesthesia_complications || doc.anesthesia_complications
                    )}
                  />
                ) : null}
              </div>
            </section>
          )}

          {SYSTEM_SECTIONS.map((section) => {
            const chips = checkedLabels(doc, section.findings)
            const notes = section.notesKey ? doc[section.notesKey] : null
            const smokingYears =
              section.title === 'Pulmonary' && hasValue(doc.smoking_years)
                ? displayValue(doc.smoking_years)
                : null
            if (!chips.length && !hasValue(notes) && !smokingYears) return null
            return (
              <section key={section.title} className={MODAL_SECTION_CLASS}>
                <h3 className={MODAL_SECTION_TITLE_CLASS}>{section.title}</h3>
                <ChipList items={chips} />
                {smokingYears ? (
                  <div className="mt-2">
                    <DataTile label="Smoking years (quit)" value={smokingYears} />
                  </div>
                ) : null}
                {hasValue(notes) ? (
                  <div className="mt-2.5">
                    <NoteBlock label="Notes" value={String(notes)} />
                  </div>
                ) : null}
              </section>
            )
          })}

          {(hasValue(doc.anesthesiologist_name || doc.anesthesiologist) || hasValue(doc.sign)) && (
            <section className={MODAL_SECTION_CLASS}>
              <h3 className={MODAL_SECTION_TITLE_CLASS}>Anesthesiologist</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {hasValue(doc.anesthesiologist_name || doc.anesthesiologist) ? (
                  <DataTile
                    label="Anesthesiologist"
                    value={displayValue(doc.anesthesiologist_name || doc.anesthesiologist)}
                  />
                ) : null}
                <AttachBlock label="Signature" path={doc.sign} />
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
            {hasValue(doc.assessment_date) ? (
              <DataTile label="Assessment date" value={formatDateTime(doc.assessment_date)} />
            ) : null}
            {hasValue(doc.date) ? <DataTile label="Date" value={formatDate(doc.date)} /> : null}
            {hasValue(doc.time) ? <DataTile label="Time" value={formatTime(doc.time)} /> : null}
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
      <PreAnesthesiaAssessmentModal
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
        title="Delete Pre-Anesthesia Assessment?"
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
