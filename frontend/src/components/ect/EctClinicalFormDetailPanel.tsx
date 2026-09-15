import { useEffect, useMemo, useState } from 'react'
import { Activity, ClipboardList, Pencil, Stethoscope, Trash2 } from 'lucide-react'
import { fetchDoc } from '../../services/common'
import { deleteDoctypeRow } from '../../services/doctypeResource'
import { useCareContext } from '../../providers/CareContextProvider'
import { toast } from '../../hooks/useToast'
import { DetailSlideOver } from '../ui/DetailSlideOver'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { MODAL_SECTION_CLASS, MODAL_SECTION_TITLE_CLASS } from '../ui/CreateModalChrome'
import { RecoveryRoomRecordModal } from '../admissions/RecoveryRoomRecordModal'
import { AnesthesiaRecordModal } from '../admissions/AnesthesiaRecordModal'
import { ModifiedAldereteScoreModal } from '../admissions/ModifiedAldereteScoreModal'
import { TimeOutProcedureModal } from '../admissions/TimeOutProcedureModal'
import { PreEctChecklistModal } from '../admissions/PreEctChecklistModal'
import { ECTProcedureConsentModal } from './ECTProcedureConsentModal'
import { ECTPatientHealthHistoryModal } from './ECTPatientHealthHistoryModal'
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
  SimpleTable,
  VitalTile,
  checkedLabels,
  displayValue,
  isChecked,
  formatDate,
  formatDateTime,
  formatTime,
  hasValue,
  type DocRecord,
} from './ectDetailUi'

interface EctClinicalFormDetailPanelProps {
  doctype: string
  doctypeLabel: string
  name: string
  onClose: () => void
  onChanged?: () => void
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]
}

function AnesthesiaRecordBody({ doc }: { doc: DocRecord }) {
  const vitals = [
    { key: 'bp', label: 'BP' },
    { key: 'hr', label: 'HR' },
    { key: 'rr', label: 'RR' },
    { key: 'spo2', label: 'SpO₂' },
  ].filter((f) => hasValue(doc[f.key]))

  const postEct = checkedLabels(doc, [
    { key: 'awakearousable', label: 'Awake / Arousable' },
    { key: 'responds_to_command', label: 'Responds to command' },
    { key: 'sustained_head_lift', label: 'Sustained head lift' },
    { key: 'normal_breathing_pattern', label: 'Normal breathing pattern' },
    { key: 'confused', label: 'Confused' },
    { key: 'unrespoonsive', label: 'Unresponsive' },
  ])

  return (
    <>
      {vitals.length > 0 ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>
            <Activity className="h-4 w-4 text-violet-600" strokeWidth={2} />
            Vitals
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {vitals.map((f) => (
              <VitalTile key={f.key} label={f.label} value={displayValue(doc[f.key])} />
            ))}
          </div>
        </section>
      ) : null}

      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <Stethoscope className="h-4 w-4 text-violet-600" strokeWidth={2} />
          Anesthesia
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {hasValue(doc.ect_done) ? <DataTile label="ECT done" value={displayValue(doc.ect_done)} /> : null}
          {hasValue(doc.preanesthesia_stages) ? (
            <DataTile label="Pre-anesthesia stages" value={displayValue(doc.preanesthesia_stages)} />
          ) : null}
          {hasValue(doc.anesthesia_type) ? (
            <DataTile label="Anesthesia type" value={displayValue(doc.anesthesia_type)} />
          ) : null}
          {hasValue(doc.oxygen_support) ? (
            <DataTile label="Oxygen support" value={displayValue(doc.oxygen_support)} />
          ) : null}
          {hasValue(doc.full_name || doc.anesthetist) ? (
            <DataTile label="Anesthetist" value={displayValue(doc.full_name || doc.anesthetist)} />
          ) : null}
          {hasValue(doc.psychiatrist__assistant || doc.psychiatrist__assistant_doctor) ? (
            <DataTile
              label="Psychiatrist / Assistant"
              value={displayValue(doc.psychiatrist__assistant || doc.psychiatrist__assistant_doctor)}
            />
          ) : null}
        </div>
      </section>

      {postEct.length > 0 ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>Post ECT</h3>
          <ChipList items={postEct} />
        </section>
      ) : null}

      {hasValue(doc.post_ect_orders) ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>
            <ClipboardList className="h-4 w-4 text-violet-600" strokeWidth={2} />
            Post ECT orders
          </h3>
          <NoteBlock label="Orders" value={String(doc.post_ect_orders)} />
        </section>
      ) : null}

      <AttachBlock label="Doctor signature and stamp" path={doc.doctor_signature_and_stamp} />
    </>
  )
}

function RecoveryRoomBody({ doc }: { doc: DocRecord }) {
  const events = asRows(doc.events)
  return (
    <>
      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <Activity className="h-4 w-4 text-teal-600" strokeWidth={2} />
          Recovery status
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {hasValue(doc.level_of_conciousness) ? (
            <DataTile label="Level of consciousness" value={displayValue(doc.level_of_conciousness)} />
          ) : null}
          {hasValue(doc.respiration) ? (
            <DataTile label="Respiration" value={displayValue(doc.respiration)} />
          ) : null}
          {hasValue(doc.oxygen_support) ? (
            <DataTile label="Oxygen support" value={displayValue(doc.oxygen_support)} />
          ) : null}
          {hasValue(doc.oxygen) ? (
            <DataTile label="Oxygen (L/min)" value={displayValue(doc.oxygen)} />
          ) : null}
        </div>
      </section>

      {events.length > 0 ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>Recovery room events</h3>
          <SimpleTable
            rows={events}
            columns={[
              { key: 'time', label: 'Time' },
              { key: 'bp', label: 'BP' },
              { key: 'pulse', label: 'Pulse' },
              { key: 'rr', label: 'RR' },
              { key: 'temp', label: 'Temp' },
              { key: 'spo2', label: 'SpO₂' },
            ].filter((c) => events.some((r) => hasValue(r[c.key])))}
          />
        </section>
      ) : null}

      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <ClipboardList className="h-4 w-4 text-teal-600" strokeWidth={2} />
          Notes
        </h3>
        <div className="space-y-2.5">
          {hasValue(doc.special_notes_remarks) ? (
            <NoteBlock label="Special notes & remarks" value={String(doc.special_notes_remarks)} />
          ) : null}
          {hasValue(doc.pos_anesthesia_visit) ? (
            <NoteBlock label="Post anesthesia visit" value={String(doc.pos_anesthesia_visit)} />
          ) : null}
          {hasValue(doc.nurse_notes) ? (
            <NoteBlock label="Nurse notes on discharge" value={String(doc.nurse_notes)} />
          ) : null}
        </div>
      </section>
    </>
  )
}

function AldereteBody({ doc }: { doc: DocRecord }) {
  const rows = asRows(doc.alderete_score)
  return (
    <>
      {hasValue(doc.total_score) ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>
            <Activity className="h-4 w-4 text-green-600" strokeWidth={2} />
            Total score
          </h3>
          <VitalTile label="Total" value={displayValue(doc.total_score)} />
        </section>
      ) : null}
      {rows.length > 0 ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>Score detail</h3>
          <SimpleTable
            rows={rows}
            columns={[
              { key: 'attribute', label: 'Attribute' },
              { key: 'option_0', label: '0' },
              { key: 'option_1', label: '1' },
              { key: 'option_2', label: '2' },
              { key: 'selected_score', label: 'Selected' },
              { key: 'score', label: 'Score' },
            ].filter((c) => rows.some((r) => hasValue(r[c.key])))}
          />
        </section>
      ) : null}
      {hasValue(doc.template) ? <DataTile label="Template" value={displayValue(doc.template)} /> : null}
    </>
  )
}

function TimeOutBody({ doc }: { doc: DocRecord }) {
  const rows = asRows(doc.procedures)
  return (
    <>
      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <Stethoscope className="h-4 w-4 text-amber-600" strokeWidth={2} />
          Procedure timing
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {hasValue(doc.time_out_time) ? (
            <DataTile label="Time out" value={formatDateTime(doc.time_out_time)} />
          ) : null}
          {hasValue(doc.procedure_start_time) ? (
            <DataTile label="Procedure start" value={formatTime(doc.procedure_start_time)} />
          ) : null}
          {hasValue(doc.nurse_name || doc.nurse) ? (
            <DataTile label="Nurse" value={displayValue(doc.nurse_name || doc.nurse)} />
          ) : null}
          {hasValue(doc.template) ? <DataTile label="Template" value={displayValue(doc.template)} /> : null}
        </div>
        <div className="mt-2.5">
          <AttachBlock label="Signature" path={doc.signature} />
        </div>
      </section>
      {rows.length > 0 ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>Checklist</h3>
          <SimpleTable
            rows={rows}
            columns={[
              { key: 'criteria', label: 'Criteria' },
              { key: 'selection', label: 'Selection' },
            ].filter((c) => rows.some((r) => hasValue(r[c.key])))}
          />
        </section>
      ) : null}
    </>
  )
}

function ECTProcedureConsentBody({ doc }: { doc: DocRecord }) {
  const signatureRows = asRows(doc.signature)
  const childGuardian = signatureRows.length > 0 ? signatureRows[0] : null

  return (
    <>
      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}><ClipboardList className="h-4 w-4 text-indigo-600" strokeWidth={2} /> Patient</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <DataTile label="Patient" value={displayValue(doc.patient_name || doc.patient)} />
          {hasValue(doc.inpatient_admission) ? <DataTile label="Admission" value={displayValue(doc.inpatient_admission)} /> : null}
          {hasValue(doc.patient_visit) ? <DataTile label="Visit" value={displayValue(doc.patient_visit)} /> : null}
          {hasValue(doc.terms) ? <DataTile label="Terms" value={displayValue(doc.terms)} /> : null}
        </div>
      </section>

      {hasValue(doc.terms_and_conditions) ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}><Stethoscope className="h-4 w-4 text-indigo-600" strokeWidth={2} /> Terms & Conditions</h3>
          <NoteBlock label="English" value={String(doc.terms_and_conditions)} />
          {hasValue(doc.terms_and_conditionsarabic) ? <div className="mt-2.5"><NoteBlock label="Arabic" value={String(doc.terms_and_conditionsarabic)} /></div> : null}
          {hasValue(doc.terms_accepted) ? (
            <div className="mt-2.5">
              <span className="inline-flex items-center rounded-md bg-green-50 border border-green-200 px-2.5 py-1 text-xs font-semibold text-green-700">
                {isChecked(doc.terms_accepted) ? 'Terms Accepted' : 'Terms Not Accepted'}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}><Activity className="h-4 w-4 text-indigo-600" strokeWidth={2} /> Signatures</h3>

        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Patient Signature</p>
          <AttachBlock label="Patient Signature" path={doc.signature_of_patient} />
        </div>

        {(hasValue(doc.patients_legal_guardian) || hasValue(doc.relation_to_patient) || hasValue(doc.guardian_cpr) || hasValue(doc.guardian_signature) || childGuardian) ? (
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Guardian</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {hasValue(doc.patients_legal_guardian) ? <DataTile label="Guardian" value={displayValue(doc.patients_legal_guardian)} /> : null}
              {childGuardian && hasValue(childGuardian.relative_name) ? <DataTile label="Guardian" value={displayValue(childGuardian.relative_name)} /> : null}
              {hasValue(doc.relation_to_patient) ? <DataTile label="Relation" value={displayValue(doc.relation_to_patient)} /> : null}
              {childGuardian && hasValue(childGuardian.relationship_with_patient) ? <DataTile label="Relation" value={displayValue(childGuardian.relationship_with_patient)} /> : null}
              {hasValue(doc.guardian_cpr) ? <DataTile label="CPR" value={displayValue(doc.guardian_cpr)} /> : null}
              {childGuardian && hasValue(childGuardian.cpr__id_no) ? <DataTile label="CPR" value={displayValue(childGuardian.cpr__id_no)} /> : null}
            </div>
            <div className="mt-2"><AttachBlock label="Guardian Signature" path={doc.guardian_signature} /></div>
            {childGuardian && hasValue(childGuardian.signature) ? <div className="mt-2"><AttachBlock label="Guardian Signature" path={childGuardian.signature} /></div> : null}
            {(hasValue(doc.guardian_sign_date) || hasValue(doc.guardian_sign_time)) ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {hasValue(doc.guardian_sign_date) ? <DataTile label="Sign Date" value={formatDate(doc.guardian_sign_date)} /> : null}
                {hasValue(doc.guardian_sign_time) ? <DataTile label="Sign Time" value={formatTime(doc.guardian_sign_time)} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {(hasValue(doc.witness_name) || hasValue(doc.witness_signature)) ? (
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Witness</p>
            {(hasValue(doc.witness_name) || hasValue(doc.witness_cpr)) ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {hasValue(doc.witness_name) ? <DataTile label="Name" value={displayValue(doc.witness_name)} /> : null}
                {hasValue(doc.witness_cpr) ? <DataTile label="CPR" value={displayValue(doc.witness_cpr)} /> : null}
              </div>
            ) : null}
            <div className="mt-2"><AttachBlock label="Witness Signature" path={doc.witness_signature} /></div>
          </div>
        ) : null}

        {(hasValue(doc.psychiatrist_name) || hasValue(doc.psychiatrist_signature)) ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Psychiatrist</p>
            {(hasValue(doc.psychiatrist_name) || hasValue(doc.psychiatrist)) ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {hasValue(doc.psychiatrist_name) ? <DataTile label="Name" value={displayValue(doc.psychiatrist_name)} /> : null}
                {hasValue(doc.psychiatrist) ? <DataTile label="Practitioner ID" value={displayValue(doc.psychiatrist)} /> : null}
              </div>
            ) : null}
            <div className="mt-2"><AttachBlock label="Psychiatrist Signature" path={doc.psychiatrist_signature} /></div>
          </div>
        ) : null}
      </section>
    </>
  )
}

function PatientHealthHistoryBody({ doc }: { doc: DocRecord }) {
  const rows = asRows(doc.template_feedback)
  const [practitionerName, setPractitionerName] = useState<string | null>(null)
  const [patientDisplayName, setPatientDisplayName] = useState<string | null>(null)

  // Resolve the linked Patient to its display name (doc.patient is a Link field = patient ID).
  // Uses doc.patient_name when populated, otherwise fetches the Patient doc for its name.
  useEffect(() => {
    let cancelled = false
    const patientRef = doc.patient
    const savedName = doc.patient_name
    ;(async () => {
      if (typeof savedName === 'string' && savedName.trim() !== '') {
        if (!cancelled) setPatientDisplayName(savedName.trim())
        return
      }
      if (!patientRef || typeof patientRef !== 'string' || patientRef.trim() === '') {
        if (!cancelled) setPatientDisplayName(null)
        return
      }
      const raw = patientRef.trim()
      try {
        const res = await fetch(`/api/resource/Patient/${encodeURIComponent(raw)}`)
        const data = await res.json()
        if (cancelled) return
        const docData = data?.data
        const name =
          docData?.patient_name ||
          docData?.full_name ||
          docData?.first_name ||
          docData?.name ||
          raw
        if (!cancelled) setPatientDisplayName(String(name))
      } catch {
        if (!cancelled) setPatientDisplayName(raw)
      }
    })()
    return () => { cancelled = true }
  }, [doc.patient, doc.patient_name])

  // Resolve the linked Healthcare Practitioner to its display name
  // (doc.username is a Link field = practitioner ID). Falls back to full_name then raw ID.
  useEffect(() => {
    let cancelled = false
    const username = doc.username
    ;(async () => {
      if (!username || typeof username !== 'string' || username.trim() === '') {
        if (!cancelled) setPractitionerName(null)
        return
      }
      const raw = username.trim()
      // Already a human-readable name (contains a space or non-ASCII) → show directly
      if (raw.includes(' ')) {
        if (!cancelled) setPractitionerName(raw)
        return
      }
      try {
        const res = await fetch(`/api/resource/Healthcare%20Practitioner/${encodeURIComponent(raw)}`)
        const data = await res.json()
        if (cancelled) return
        const docData = data?.data
        const name =
          docData?.practitioner_name ||
          docData?.full_name ||
          docData?.employee_name ||
          docData?.name ||
          raw
        if (!cancelled) setPractitionerName(String(name))
      } catch {
        if (!cancelled) setPractitionerName(raw)
      }
    })()
    return () => { cancelled = true }
  }, [doc.username])

  return (
    <>
      {/* Top: Patient info */}
      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <ClipboardList className="h-4 w-4 text-rose-600" strokeWidth={2} />
          Patient
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <DataTile label="Patient" value={displayValue(patientDisplayName || doc.patient_name || doc.patient)} />
          {hasValue(doc.inpatient_admission) ? (
            <DataTile label="Admission / Patient Visit" value={displayValue(doc.inpatient_admission)} />
          ) : null}
          {hasValue(doc.patient_visit) ? (
            <DataTile label="Visit" value={displayValue(doc.patient_visit)} />
          ) : null}
          {practitionerName ? (
            <DataTile label="Username" value={displayValue(practitionerName)} />
          ) : hasValue(doc.username) ? (
            <DataTile label="Username" value={displayValue(doc.username)} />
          ) : null}
        </div>
      </section>

      {/* Middle: History items — type/specify shown under each item, not as columns */}
      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <Activity className="h-4 w-4 text-rose-600" strokeWidth={2} />
          Health History Items
        </h3>
        {rows.length > 0 ? (
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={idx} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[10px] font-semibold text-rose-600">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm font-medium text-slate-900">{displayValue(row.history)}</span>
                  {isChecked(row.yes) ? (
                    <span className="inline-flex items-center rounded-md bg-green-50 border border-green-200 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                      Yes
                    </span>
                  ) : null}
                </div>
                {hasValue(row.type) ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 w-24">Diabetic Type</span>
                    <span className="text-xs font-medium text-slate-800">{displayValue(row.type)}</span>
                  </div>
                ) : null}
                {hasValue(row.speficication) ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 w-24">Specification</span>
                    <span className="text-xs font-medium text-slate-800">{displayValue(row.speficication)}</span>
                  </div>
                ) : null}
                {hasValue(row.remarks) ? (
                  <div className="mt-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Remarks</span>
                    <p className="mt-0.5 text-xs text-slate-700">{displayValue(row.remarks)}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No history items</p>
        )}
      </section>

      {/* Bottom: Date/Time/Height/Weight */}
      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <Stethoscope className="h-4 w-4 text-rose-600" strokeWidth={2} />
          Measurements
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {hasValue(doc.date) ? <DataTile label="Date" value={formatDate(doc.date)} /> : null}
          {hasValue(doc.time) ? <DataTile label="Time" value={formatTime(doc.time)} /> : null}
          {hasValue(doc.height) ? <DataTile label="Height" value={displayValue(doc.height)} /> : null}
          {hasValue(doc.weight) ? <DataTile label="Weight" value={displayValue(doc.weight)} /> : null}
        </div>
      </section>
    </>
  )
}

function PreEctBody({ doc }: { doc: DocRecord }) {
  const rows = asRows(doc.checklist)
  return (
    <>
      <section className={MODAL_SECTION_CLASS}>
        <h3 className={MODAL_SECTION_TITLE_CLASS}>
          <Stethoscope className="h-4 w-4 text-orange-600" strokeWidth={2} />
          Staff
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {hasValue(doc.nurse_name || doc.staff_nurse) ? (
            <DataTile label="Staff nurse" value={displayValue(doc.nurse_name || doc.staff_nurse)} />
          ) : null}
          <AttachBlock label="Signature" path={doc.signature} />
        </div>
      </section>
      {rows.length > 0 ? (
        <section className={MODAL_SECTION_CLASS}>
          <h3 className={MODAL_SECTION_TITLE_CLASS}>Checklist</h3>
          <SimpleTable
            rows={rows}
            columns={[
              { key: 'checklist', label: 'Checklist' },
              { key: 'answer', label: 'Answer' },
              { key: 'remarks', label: 'Remarks' },
            ].filter((c) => rows.some((r) => hasValue(r[c.key])))}
          />
        </section>
      ) : null}
    </>
  )
}

export function EctClinicalFormDetailPanel({
  doctype,
  doctypeLabel,
  name,
  onClose,
  onChanged,
}: EctClinicalFormDetailPanelProps) {
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
    fetchDoc(doctype, name)
      .then((data) => {
        if (!cancelled) setDoc(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : `Failed to load ${doctypeLabel}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [doctype, doctypeLabel, name, reloadKey])

  const canMutate = canMutateEctForm(doc?.creation ? String(doc.creation) : null, lockEditingData)

  const headerSubtitle = useMemo(() => {
    if (!doc) return name
    const parts = [
      displayValue(doc.patient_name || doc.patient),
      hasValue(doc.date) ? formatDate(doc.date) : null,
    ].filter(Boolean)
    return parts.join(' · ') || name
  }, [doc, name])

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
      await deleteDoctypeRow(doctype, name)
      toast.success(`${doctypeLabel} deleted`)
      setShowDelete(false)
      onChanged?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to delete ${doctypeLabel}`)
    } finally {
      setDeleting(false)
    }
  }

  const admissionNo = String(doc?.inpatient_admission || doc?.admission || '')
  const patientId = String(doc?.patient || '')
  const patientName = String(doc?.patient_name || '')

  const editModal =
    showEdit && doc ? (
      doctype === 'Recovery Room Record' ? (
        <RecoveryRoomRecordModal
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
      ) : doctype === 'Anesthesia Record' ? (
        <AnesthesiaRecordModal
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
      ) : doctype === 'Modified Alderete Score' ? (
        <ModifiedAldereteScoreModal
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
      ) : doctype === 'Time Out Procedure' ? (
        <TimeOutProcedureModal
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
      ) : doctype === 'Pre-ECT Checklist' ? (
        <PreEctChecklistModal
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
      ) : doctype === 'ECT Procedure Consent' ? (
        <ECTProcedureConsentModal
          editName={name}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false)
            setReloadKey((k) => k + 1)
            onChanged?.()
          }}
        />
      ) : doctype === 'Patient Health History' ? (
        <ECTPatientHealthHistoryModal
          editName={name}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false)
            setReloadKey((k) => k + 1)
            onChanged?.()
          }}
        />
      ) : null
    ) : null

  return (
    <>
      <DetailSlideOver
        title={doctypeLabel}
        subtitle={headerSubtitle}
        icon={<ClipboardList className="h-5 w-5 text-slate-700" strokeWidth={2} />}
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
              doctype={doctype}
              docName={name}
              noLetterhead={0}
              triggerPrint={1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-slate-700 shadow-sm transition hover:bg-slate-50"
            />
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">Loading…</div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        {doc && !loading && !error ? (
          <div className="flex flex-col gap-5 pb-2">
            {doctype === 'Anesthesia Record' ? <AnesthesiaRecordBody doc={doc} /> : null}
            {doctype === 'Recovery Room Record' ? <RecoveryRoomBody doc={doc} /> : null}
            {doctype === 'Modified Alderete Score' ? <AldereteBody doc={doc} /> : null}
            {doctype === 'Time Out Procedure' ? <TimeOutBody doc={doc} /> : null}
            {doctype === 'Pre-ECT Checklist' ? <PreEctBody doc={doc} /> : null}
            {doctype === 'Patient Health History' ? <PatientHealthHistoryBody doc={doc} /> : null}
            {doctype === 'ECT Procedure Consent' ? <ECTProcedureConsentBody doc={doc} /> : null}

            <MetaFooter>
              <DataTile label="Patient" value={displayValue(doc.patient_name || doc.patient)} />
              <DataTile label="Record ID" value={displayValue(doc.name)} />
              {hasValue(doc.inpatient_admission || doc.admission) ? (
                <DataTile
                  label="Admission"
                  value={displayValue(doc.inpatient_admission || doc.admission)}
                />
              ) : null}
              {hasValue(doc.patient_visit) ? (
                <DataTile label="Visit" value={displayValue(doc.patient_visit)} />
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

      {editModal}

      {showDelete ? (
        <ConfirmDialog
          open
          title={`Delete ${doctypeLabel}?`}
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
