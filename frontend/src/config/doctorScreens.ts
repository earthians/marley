// // doctorScreens.ts

// // Original flat doctor screens (kept for backward compatibility)
// export const doctorScreens = [
//   { id: 'mh', title: 'Medical History (Allergies)', desc: 'View allergies, past medical/surgical history.' },
//   // { id: 'pi', title: 'Patient Information', desc: 'Demographics and contact details.' },
//   { id: 'dpn', title: 'Doctor Progress Note', desc: 'Daily progress notes.' },
//   { id: 'dos', title: 'Doctors Order Sheet', desc: 'Orders for labs, meds, procedures.' },
//   // { id: 'dn', title: 'Doctors Note', desc: 'Free-text notes.' },
//   { id: 'dmc', title: 'Doctor Medication Chart', desc: 'Medication chart overview.' },
//   { id: 'admission', title: 'Admission', desc: 'View and manage inpatient admissions.' },
//   { id: 'df', title: 'Discharge Form', desc: 'Discharge summary and instructions.' },
//   // { id: 'med', title: 'Medication', desc: 'Active medication list.' },
//   // { id: 'mr', title: 'Medical Report', desc: 'Formal reports and letters.' },
//   { id: 'gm', title: 'Given Medicines', desc: 'Administration history.' },
//   { id: 'rx', title: 'Doctors Prescriptions', desc: 'Prescribed items.' },
//   // { id: 'dx', title: 'Diagnoses', desc: 'Current diagnoses.' },
//   { id: 'warn', title: 'Warning Messages', desc: 'Allergies and critical flags.' },
//   { id: 'psy-o', title: 'Psychologist Order', desc: 'Orders from psychologist.' },
//   { id: 'psy-n', title: 'Psychologists Notes', desc: 'Notes from psychologist.' },
//   { id: 'nut', title: 'Nutritionist Notes', desc: 'Dietary notes and plans.' },
//   { id: 'ther', title: 'Therapist Notes', desc: 'Therapy notes.' },
//   { id: 'nurse', title: 'Nursing Notes', desc: 'Nursing documentation.' },
//   { id: 'lab', title: 'Laboratory', desc: 'Lab requests and results.' },
//   {id: 'patients', title: 'Patients List', desc: 'List of all patients.'},
//   // { id: 'op', title: 'OP Visit', desc: 'Outpatient visits.' },
//   { id: 'tpr', title: 'TPR/Vital Signs', desc: 'Vitals and charts.' },
//   { id: 'fall', title: 'Morse Fall Scale', desc: 'Fall risk assessment.' },
//   { id: 'ect', title: 'ECT', desc: 'ECT details.' },
//   { id: 'obs', title: 'Observation Level', desc: 'Observation level tracking.' },
//   { id: 'env', title: 'Environmental Checklist', desc: 'Environmental safety checklist.' },
//   { id: 'sleep', title: 'Sleeping Pattern', desc: 'Sleeping pattern tracking.' },
//   { id: 'iop', title: 'IOP Dashboard', desc: 'Intensive outpatient scheduling and enrollment.' },
//   { id: 'sl', title: 'Sick Leave', desc: 'Leave requests.' },
//   // { id: 'ipm', title: 'IP Medication', desc: 'Inpatient medications.' },
//   { id: 'pvh', title: 'Patient Visit History', desc: 'Prior encounters.' },
//   { id: 'pkg', title: 'Package Detail', desc: 'Package info.' },
//   { id: 'nurse-tasks', title: 'Nursing Task Assignment', desc: 'Assign and view nursing tasks.' },
//   { id: 'd-long-acting-meds', title: 'Long Acting Medicine', desc: 'View and manage long acting medicine.' },
//   { id: 'physical-exam', title: 'Physical Examination', desc: 'Document physical examination findings by body system.' },
//   { id: 'patient-history', title: 'Patient History', desc: 'Structured patient history with template-driven detail items.' }
// ].sort((a, b) => a.title.localeCompare(b.title))

import type { CareMode } from '../providers/CareContextProvider'
import { filterDoctorScreenGroups, careScopeFromCostCenterField, type CostCenterCareScope } from './costCenterCareScope'

export interface ScreenItem {
  id: string
  title: string
}

export interface ScreenGroup {
  groupTitle: string
  screens: ScreenItem[]
  /** When set, clicking the folder title navigates to this screen (chevron still expands/collapses). */
  hubScreenId?: string
}

// Doctor screens organized into groups. Groups with an empty groupTitle render as
// direct sidebar items (no folder). Cards already on the dashboard (warnings,
// prescriptions, appointments, visits) have no sidebar duplicates.
export const doctorScreenGroups: ScreenGroup[] = [
  {
    groupTitle: 'Patient Overview',
    screens: [
      { id: 'patient-history', title: 'Patient History Form' },
      { id: 'homicide-risk', title: 'Risk Assessment' },
      { id: 'clinical-suicide-risk', title: 'Suicidal Risk Assessment' },
      { id: 'physical-exam', title: 'Physical Examination' },
      { id: 'mh', title: 'Past Medical History' },
    ],
  },
  {
    groupTitle: 'Documentation',
    screens: [
      { id: 'dpn', title: 'Patient Progress Note' },
      { id: 'dos', title: 'Doctors Orders' },
      { id: 'dx', title: 'Diagnoses Detail' },
      { id: 'psy-n', title: 'Psychology Notes' },
      { id: 'psy-o', title: 'Psychology Orders' },
      { id: 'nut', title: 'Nutrition Notes' },
      { id: 'ther', title: 'Occupational Therapy Notes' },
    ],
  },
  {
    groupTitle: 'Patient Medication',
    screens: [
      { id: 'single-prescription', title: 'Prescription' },
      { id: 'd-daily-med', title: 'Daily Medication Chart' },
      { id: 'd-med-sheet', title: 'Medication Sheet' },
      { id: 'd-long-acting-meds', title: 'Long-Acting Medicine' },
      { id: 'gm', title: 'Given Medicine' },
    ],
  },
  {
    groupTitle: 'Nursing',
    screens: [
      { id: 'nurse', title: 'Nurses Notes' },
      { id: 'fall', title: 'Morse Fall Scale' },
      { id: 'd-nursing-assess', title: 'Nursing Assessment' },
      { id: 'env', title: 'Environmental Checklist' },
      { id: 'd-grooming', title: 'Grooming' },
      { id: 'd-mse', title: 'Mental State' },
      { id: 'sleep', title: 'Sleeping Pattern' },
    ],
  },
  {
    groupTitle: 'Scales',
    screens: [
      { id: 'adhd', title: 'ADHD Assessment' },
      { id: 'depression', title: 'Depression Assessment' },
      { id: 'mood', title: 'Mood Disorder Assessment' },
      { id: 'gad7', title: 'GAD7 Assessment' },
      { id: 'phq9', title: 'PHQ9 Assessment' },
      { id: 'ybocs', title: 'YBOCS Assessment' },
      { id: 'ymrs', title: 'YMRS Assessment' },
      { id: 'panss', title: 'PANSS Assessment' },
    ],
  },
  {
    groupTitle: 'Lab',
    hubScreenId: 'lab',
    screens: [
      { id: 'lab', title: 'Laboratory' },
      { id: 'd-pending-lab-review', title: 'Pending Lab Review' },
    ],
  },
  {
    groupTitle: 'Medical Report',
    hubScreenId: 'd-ip-medical-report',
    screens: [
      { id: 'd-ip-medical-report', title: 'Medical Report' },
      { id: 'd-report-requests', title: 'Report Request' },
    ],
  },
  {
    groupTitle: '',
    screens: [{ id: 'tpr', title: 'Vital Sign' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'obs', title: 'Observation Level' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'd-ect-service', title: 'ECT' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'df', title: 'Discharge Form' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'd-overdue-actions', title: 'Overdue Clinical Actions' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'pvh', title: 'Patients History' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'd-sick-leave', title: 'Sick Leave' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'iop', title: 'IOP Dashboard' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'd-session', title: 'Session Scheduler' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'sticky-notes', title: 'Sticky Notes' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'ect', title: 'ECT Forms' }],
  },
  {
    groupTitle: '',
    screens: [{ id: 'd-ip-warnings', title: 'Current IP Warnings & Allergies' }],
  },
]

// Psychologists run the standard assessments — shown in their sidebar, not the doctor's.
export const assessmentScreens: ScreenItem[] = [
  { id: 'adhd', title: 'ADHD Assessment' },
  { id: 'depression', title: 'Depression Assessment' },
  { id: 'mood', title: 'Mood Disorder Assessment' },
  { id: 'gad7', title: 'GAD7 Assessment' },
  { id: 'phq9', title: 'PHQ9 Assessment' },
  { id: 'homicide-risk', title: 'Homicide Risk Assessment' },
  { id: 'ybocs', title: 'YBOCS Assessment' },
  { id: 'ymrs', title: 'YMRS Assessment' },
  { id: 'panss', title: 'PANSS Assessment' },
  { id: 'suicide', title: 'Suicide Assessment' },
]


export const getDoctorScreenGroups = (
  selectedPatient?: string,
  scope: CostCenterCareScope = 'both',
  mode?: CareMode
): ScreenGroup[] => {
  const base = doctorScreenGroups
    .map((group) => ({
      ...group,
      screens: group.screens.filter(
        (screen) => !(screen.id === 'patients' && selectedPatient)
      ),
    }))
    .filter((group) => group.screens.length > 0)
  return filterDoctorScreenGroups(base, scope, mode)
}

export { careScopeFromCostCenterField }