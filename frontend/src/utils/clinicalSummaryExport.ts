import type { AdmissionClinicalBundle } from '../services/patientAdmissionClinical'
import { fetchAllAppointments } from '../services/appointments'
import { fetchClinicalNotes } from '../services/clinicalNotes'
import { fetchLabTests } from '../services/labTests'
import { fetchPatientVisitsFull } from '../services/patientVisits'
import { fetchPrescriptions } from '../services/prescriptions'
import { htmlToPlainText } from './htmlToPlainText'
import { toast } from '../hooks/useToast'
import { formatDoseAndUom } from './medicationOrderDisplayUtils'

export type ClinicalSummaryExportMode = 'pdf' | 'excel'

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(val?: string | null): string {
  if (!val) return ''
  try {
    return new Date(val).toLocaleString('en-GB')
  } catch {
    return String(val)
  }
}

function plain(val?: string | null): string {
  return htmlToPlainText(val || '')
}

function sectionHtml(title: string, body: string): string {
  if (!body.trim()) return ''
  return `<h3>${esc(title)}</h3>${body}`
}

function tableHtml(headers: string[], rows: string[][]): string {
  if (!rows.length) return ''
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

const DOC_CSS = `
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h3 { margin: 14px 0 6px; font-size: 12px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  .meta { color: #475569; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #333; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; }
  .block { margin-bottom: 8px; padding: 6px; border: 1px solid #e2e8f0; }
  .muted { color: #64748b; font-size: 10px; }
  .note { white-space: pre-wrap; margin-top: 4px; }
  @page { size: A4 portrait; margin: 10mm; }
`

export function openClinicalSummaryDocument(
  html: string,
  mode: ClinicalSummaryExportMode,
  filename: string,
): void {
  if (!html.trim()) {
    toast.error('Nothing to export — no clinical data on this summary')
    return
  }
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(filename)}</title><style>${DOC_CSS}</style></head><body>${html}</body></html>`
  if (mode === 'pdf') {
    const win = window.open('', '_blank')
    if (!win) {
      toast.error('Pop-up blocked — allow pop-ups to print PDF')
      return
    }
    win.document.write(doc + '<script>window.onload = () => window.print()</'.concat('script>'))
    win.document.close()
    return
  }
  const blob = new Blob([doc], { type: 'application/vnd.ms-excel' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${filename}.xls`
  a.click()
  URL.revokeObjectURL(a.href)
}

function letterhead(title: string, patient: string, subtitle?: string): string {
  return `<h1>${esc(title)}</h1>
    <p class="meta">Patient: ${esc(patient)}${subtitle ? ` · ${esc(subtitle)}` : ''}</p>`
}

/** Build IP clinical summary HTML — only sections that have values. */
export function buildIpClinicalSummaryHtml(
  bundle: AdmissionClinicalBundle,
  patientLabel?: string,
): string {
  const adm = bundle.admission_doc
  if (!adm || !bundle.has_data) return ''

  const patient = patientLabel || adm.patient_name || adm.patient || bundle.patient
  const parts: string[] = [
    letterhead('Clinical Summary (IP)', patient, `${adm.name} · ${adm.status || ''}`),
  ]

  // Admission is always included when exporting an IP episode
  parts.push(
    sectionHtml(
      'Admission',
      tableHtml(
        ['Field', 'Value'],
        [
          ['Case no', esc(adm.name)],
          ['Status', esc(adm.status)],
          ['Admitted', esc(fmtDate(adm.admitted_datetime))],
          ['Discharged', esc(fmtDate(adm.discharge_datetime))],
          ...(adm.primary_practitioner_name
            ? [['Primary practitioner', esc(adm.primary_practitioner_name)]]
            : []),
          ...(adm.medical_department ? [['Department', esc(adm.medical_department)]] : []),
          ...(adm.bed_no ? [['Bed', esc(adm.bed_no)]] : []),
        ].filter((r) => r[1]),
      ),
    ),
  )

  const discharge = bundle.discharge
  const hasDischarge =
    Boolean(discharge) || Boolean(adm.discharge_note?.trim()) || Boolean(adm.discharge_instructions?.trim())
  if (hasDischarge) {
    const blocks: string[] = []
    if (discharge) {
      const rows: string[][] = []
      if (discharge.discharge_type) rows.push(['Type', esc(discharge.discharge_type)])
      if (discharge.display_discharge_date)
        rows.push(['Discharge date', esc(fmtDate(discharge.display_discharge_date))])
      if (rows.length) blocks.push(tableHtml(['Field', 'Value'], rows))
      for (const [label, val] of [
        ['Discharge diagnosis', discharge.discharge_diagnosis],
        ['Treatment plan', discharge.discharge_treatment_plan],
        ['Discharge instructions', discharge.discharge_instructions],
        ['Conditions on discharge', discharge.discharge_conditions],
        ['Discharge reason', discharge.discharge_reason],
      ] as const) {
        const text = plain(val)
        if (text) blocks.push(`<div class="block"><strong>${esc(label)}</strong><div class="note">${esc(text)}</div></div>`)
      }
      if (discharge.stopped_medications?.length) {
        blocks.push(
          `<div class="block"><strong>Stopped medications</strong><ul>${discharge.stopped_medications
            .map((med) => {
              const name = String(med.drug_name || med.medication || med.drug || 'Medication')
              const reason = med.reason ? ` — ${String(med.reason)}` : ''
              return `<li>${esc(name)}${esc(reason)}</li>`
            })
            .join('')}</ul></div>`,
        )
      }
    }
    const admNote = plain(adm.discharge_note)
    if (admNote)
      blocks.push(`<div class="block"><strong>Admission discharge note</strong><div class="note">${esc(admNote)}</div></div>`)
    const admInstr = plain(adm.discharge_instructions)
    if (admInstr)
      blocks.push(
        `<div class="block"><strong>Admission discharge instructions</strong><div class="note">${esc(admInstr)}</div></div>`,
      )
    parts.push(sectionHtml('Discharge summary', blocks.join('')))
  }

  const allergyLines = [
    adm.allergies,
    bundle.medical_history?.no_known_allergies
      ? 'No known drug allergies (NKDA)'
      : bundle.medical_history?.allergies,
  ].filter(Boolean)
  if (allergyLines.length || bundle.warnings.length) {
    const bits: string[] = []
    for (const line of allergyLines) {
      bits.push(`<div class="block">${esc(plain(String(line)))}</div>`)
    }
    if (bundle.warnings.length) {
      bits.push(
        `<ul>${bundle.warnings
          .map(
            (w) =>
              `<li>${esc(plain(w.warning))}${w.posting_date ? ` <span class="muted">(${esc(fmtDate(w.posting_date))})</span>` : ''}</li>`,
          )
          .join('')}</ul>`,
      )
    }
    parts.push(sectionHtml('Allergies & warnings', bits.join('')))
  }

  if (bundle.clinical_notes.length) {
    parts.push(
      sectionHtml(
        'Progress notes',
        bundle.clinical_notes
          .map(
            (note) => `<div class="block">
              <div class="muted">${esc([note.clinical_note_type || 'Clinical note', fmtDate(note.posting_date), note.practitioner_name].filter(Boolean).join(' · '))}</div>
              <div class="note">${esc(plain(note.note))}</div>
            </div>`,
          )
          .join(''),
      ),
    )
  }

  if (bundle.prescriptions.length) {
    parts.push(
      sectionHtml(
        'Prescriptions',
        bundle.prescriptions
          .map((rx) => {
            const meds = (rx.medications || [])
              .map((med) => {
                const drug = med.display_drug_name || med.drug_name || 'Medication'
                const dose = [
                  formatDoseAndUom(med.display_dosage || med.dosage, med.uom),
                  med.frequency,
                ]
                  .filter((v) => v && v !== '-')
                  .join(' · ')
                return `<li><strong>${esc(drug)}</strong>${dose ? ` — ${esc(dose)}` : ''}${
                  med.instructions ? `<div class="muted">${esc(med.instructions)}</div>` : ''
                }</li>`
              })
              .join('')
            return `<div class="block">
              <div class="muted">${esc(rx.name)}${rx.healthcare_practitioner_name ? ` · ${esc(rx.healthcare_practitioner_name)}` : ''}</div>
              ${meds ? `<ul>${meds}</ul>` : ''}
            </div>`
          })
          .join(''),
      ),
    )
  }

  const mhBlocks: string[] = []
  for (const [label, val] of [
    ['Medical history', adm.medical_history],
    ['Medication history', adm.medication_history],
    ['Surgical history', adm.surgical_history],
    ['Ongoing illness', bundle.medical_history?.other_ongoing_illness],
    ['Past medications', bundle.medical_history?.current_and_past_medications],
  ] as const) {
    const text = plain(val)
    if (text) mhBlocks.push(`<div class="block"><strong>${esc(label)}</strong><div class="note">${esc(text)}</div></div>`)
  }
  if (mhBlocks.length) parts.push(sectionHtml('Medical history', mhBlocks.join('')))

  if (bundle.diagnoses.length) {
    parts.push(
      sectionHtml(
        'Diagnosis',
        `<ul>${bundle.diagnoses
          .map((dx) => {
            const title = dx.diagnosis_name || dx.diagnosis || 'Diagnosis'
            const details = plain(dx.details)
            const meta = [dx.posting_date ? fmtDate(dx.posting_date) : '', dx.practitioner_name]
              .filter(Boolean)
              .join(' · ')
            return `<li><strong>${esc(title)}</strong>${details ? `<div class="note">${esc(details)}</div>` : ''}${
              meta ? `<div class="muted">${esc(meta)}</div>` : ''
            }</li>`
          })
          .join('')}</ul>`,
      ),
    )
  }

  if (bundle.history_form?.history_detail?.length) {
    parts.push(
      sectionHtml(
        'History form',
        bundle.history_form.history_detail
          .map((row) => {
            const bits = [plain(row.description), plain(row.field_1)].filter(Boolean)
            return `<div class="block"><strong>${esc(row.attribute || 'Section')}</strong>${
              bits.length ? `<div class="note">${esc(bits.join('\n'))}</div>` : ''
            }</div>`
          })
          .join(''),
      ),
    )
  }

  const eSignatures = (bundle.e_signatures || []).filter(
    (row) => row?.document || row?.file_name || row?.document_type,
  )
  if (bundle.signature || eSignatures.length) {
    const bits: string[] = []
    if (bundle.signature) bits.push(`<div class="block"><strong>Admission signature</strong> on file</div>`)
    for (const row of eSignatures) {
      bits.push(
        `<div class="block">${esc(row.document_type || 'Signature')}${
          row.signee_name ? ` — ${esc(row.signee_name)}` : ''
        }${row.file_name ? ` <span class="muted">(${esc(row.file_name)})</span>` : ''}</div>`,
      )
    }
    parts.push(sectionHtml('Signatures', bits.join('')))
  }

  // letterhead alone is not enough
  return parts.length > 1 ? parts.join('') : ''
}

export type OpClinicalExportData = {
  patient: string
  patientName?: string
  visits: Array<{
    value: string
    encounter_date?: string | null
    practitioner_name?: string
    status?: string
    visit_type?: string
  }>
  progressNotes: Array<{
    name: string
    posting_date?: string
    practitioner_name?: string
    note?: string
    clinical_note_type?: string
  }>
  prescriptions: Array<{
    name: string
    posting_date?: string
    status?: string
    healthcare_practitioner_name?: string
    practitioner?: string
  }>
  appointments: Array<{
    name: string
    appointment_date?: string
    appointment_time?: string
    practitioner_name?: string
    status?: string
  }>
  labTests: Array<{
    name: string
    template?: string
    lab_test_name?: string
    status?: string
    date?: string
    result_date?: string
  }>
}

export async function loadOpClinicalExportData(patient: string): Promise<OpClinicalExportData> {
  const [visitsRes, notesRes, prescriptions, apptsRes, labsRes] = await Promise.all([
    fetchPatientVisitsFull(patient, undefined, undefined, undefined, undefined, undefined, undefined, 100, 0),
    fetchClinicalNotes(100, 0, patient, undefined, 'Doctor Progress Note'),
    fetchPrescriptions(100, 0, { patient }),
    fetchAllAppointments(100, 0, undefined, patient),
    fetchLabTests(100, 0, patient),
  ])

  return {
    patient,
    patientName: visitsRes.data[0]?.patient_name,
    visits: visitsRes.data,
    progressNotes: notesRes.data,
    prescriptions,
    appointments: apptsRes.data as OpClinicalExportData['appointments'],
    labTests: labsRes.data as OpClinicalExportData['labTests'],
  }
}

/** Build OP clinical summary HTML — only sections that have values. */
export function buildOpClinicalSummaryHtml(data: OpClinicalExportData): string {
  const patient = data.patientName || data.patient
  const parts: string[] = [letterhead('Clinical Summary (OP)', patient)]

  if (data.visits.length) {
    parts.push(
      sectionHtml(
        'Patient Visits',
        tableHtml(
          ['Visit', 'Date', 'Practitioner', 'Type', 'Status'],
          data.visits.map((v) => [
            esc(v.value),
            esc(fmtDate(v.encounter_date)),
            esc(v.practitioner_name),
            esc(v.visit_type),
            esc(v.status),
          ]),
        ),
      ),
    )
  }

  if (data.progressNotes.length) {
    parts.push(
      sectionHtml(
        'Patient Progress Notes',
        data.progressNotes
          .map(
            (note) => `<div class="block">
              <div class="muted">${esc([note.clinical_note_type || 'Progress note', fmtDate(note.posting_date), note.practitioner_name].filter(Boolean).join(' · '))}</div>
              <div class="note">${esc(plain(note.note))}</div>
            </div>`,
          )
          .join(''),
      ),
    )
  }

  if (data.prescriptions.length) {
    parts.push(
      sectionHtml(
        'Prescriptions',
        tableHtml(
          ['Prescription', 'Date', 'Practitioner', 'Status'],
          data.prescriptions.map((rx) => [
            esc(rx.name),
            esc(fmtDate(rx.posting_date)),
            esc(rx.healthcare_practitioner_name || rx.practitioner),
            esc(rx.status),
          ]),
        ),
      ),
    )
  }

  if (data.appointments.length) {
    parts.push(
      sectionHtml(
        'Appointments',
        tableHtml(
          ['Appointment', 'Date', 'Time', 'Practitioner', 'Status'],
          data.appointments.map((a) => [
            esc(a.name),
            esc(a.appointment_date),
            esc(a.appointment_time),
            esc(a.practitioner_name),
            esc(a.status),
          ]),
        ),
      ),
    )
  }

  if (data.labTests.length) {
    parts.push(
      sectionHtml(
        'Lab Tests',
        tableHtml(
          ['Lab Test', 'Test', 'Date', 'Status'],
          data.labTests.map((lt) => [
            esc(lt.name),
            esc(lt.lab_test_name || lt.template),
            esc(fmtDate(lt.result_date || lt.date)),
            esc(lt.status),
          ]),
        ),
      ),
    )
  }

  return parts.length > 1 ? parts.join('') : ''
}

/** Visit-aligned OP export: only episodes that have note and/or prescription. */
export function buildOpClinicalSummaryHtmlFromTimeline(timeline: {
  patient: string
  patient_name?: string
  episodes: Array<{
    visit: string | null
    visit_history?: string | null
    visit_num?: string | null
    encounter_date?: string | null
    practitioner_name?: string | null
    visit_type?: string | null
    status?: string | null
    is_legacy?: boolean
    legacy?: boolean
    progress_notes?: Array<{
      posting_date?: string
      practitioner_name?: string
      practitioner?: string
      note?: string
      clinical_note_type?: string
    }>
    prescriptions?: Array<{
      name: string
      healthcare_practitioner_name?: string
      status?: string
      medications?: Array<{
        drug_name?: string
        drug?: string
        dosage?: string
        uom?: string
        frequency?: string
        instructions?: string
      }>
    }>
    has_clinical?: boolean
  }>
}): string {
  const patient = timeline.patient_name || timeline.patient
  const clinicalEpisodes = (timeline.episodes || []).filter(
    (ep) =>
      ep.has_clinical ||
      (ep.progress_notes?.length || 0) > 0 ||
      (ep.prescriptions?.length || 0) > 0,
  )
  if (!clinicalEpisodes.length) return ''

  const parts: string[] = [
    letterhead(
      'Clinical Summary (OP)',
      patient,
      `${clinicalEpisodes.length} visit episode(s) with clinical data`,
    ),
  ]

  for (const ep of clinicalEpisodes) {
    const legacy = Boolean(ep.is_legacy || ep.legacy)
    const title = [
      fmtDate(ep.encounter_date) || 'Date unknown',
      ep.visit || (legacy ? ep.visit_num || ep.visit_history || 'Visit History' : 'Unlinked'),
      legacy ? 'Legacy' : null,
      ep.practitioner_name,
      legacy ? 'Visit History' : ep.visit_type,
    ]
      .filter(Boolean)
      .join(' · ')

    const noteBlocks = (ep.progress_notes || [])
      .map((note) => {
        const meta = [note.practitioner_name || note.practitioner, fmtDate(note.posting_date)]
          .filter(Boolean)
          .join(' · ')
        return `<div class="block"><div class="muted">${esc(meta)}</div><div class="note">${esc(plain(note.note))}</div></div>`
      })
      .join('')

    const rxBlocks = (ep.prescriptions || [])
      .map((rx) => {
        const meds = (rx.medications || [])
          .map((med) => {
            const drug = med.drug_name || med.drug || 'Medication'
            const dose = [formatDoseAndUom(med.dosage, med.uom), med.frequency]
              .filter((v) => v && v !== '-')
              .join(' · ')
            return `<li><strong>${esc(drug)}</strong>${dose ? ` — ${esc(dose)}` : ''}${
              med.instructions ? `<div class="muted">${esc(plain(med.instructions))}</div>` : ''
            }</li>`
          })
          .join('')
        return `<div class="block">
          <div class="muted">${esc(rx.name)}${rx.healthcare_practitioner_name ? ` · ${esc(rx.healthcare_practitioner_name)}` : ''}${rx.status ? ` · ${esc(rx.status)}` : ''}</div>
          ${meds ? `<ul>${meds}</ul>` : '<div class="muted">No medication lines</div>'}
        </div>`
      })
      .join('')

    const body = `<table><thead><tr><th style="width:50%">Progress note</th><th style="width:50%">Prescription</th></tr></thead>
      <tbody><tr>
        <td>${noteBlocks || '<span class="muted">None</span>'}</td>
        <td>${rxBlocks || '<span class="muted">None</span>'}</td>
      </tr></tbody></table>`

    parts.push(sectionHtml(title, body))
  }

  return parts.join('')
}
