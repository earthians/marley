import type { NurseBriefingLabTest } from '../services/nurseBriefing'

export type LabBriefingSelectPayload<T extends NurseBriefingLabTest = NurseBriefingLabTest> = {
  tests: T[]
  groupLabel?: string
}

export type LabBriefingDisplayRow<T extends NurseBriefingLabTest = NurseBriefingLabTest> =
  | {
      kind: 'group'
      key: string
      label: string
      tests: T[]
      representative: T
    }
  | { kind: 'standalone'; test: T }

/** Template / document IDs (e.g. HLT-0001, LAB_CBC) — not shown to doctors/nurses. */
export function looksLikeLabCode(value?: string | null): boolean {
  const v = (value || '').trim()
  if (!v) return true
  if (/^[A-Z]{2,}[-./_]\S*$/i.test(v)) return true
  if (/^[A-Z0-9][A-Z0-9._-]{2,}$/.test(v) && /\d/.test(v) && v === v.toUpperCase()) return true
  return false
}

export function labBriefingTestLabel(test: NurseBriefingLabTest): string {
  const name = (test.lab_test_name || '').trim()
  if (name && !looksLikeLabCode(name)) return name
  if (name) return name
  return 'Lab test'
}

export function labBriefingGroupKey(test: NurseBriefingLabTest): string | null {
  if (!Number(test.is_group_lab_test) || !test.service_request) return null
  const group = (test.lab_test_group || '').trim()
  return group ? `${test.service_request}::${group}` : test.service_request
}

export function labBriefingDisplayRows<T extends NurseBriefingLabTest>(
  labTests: T[]
): LabBriefingDisplayRow<T>[] {
  const groups = new Map<string, T[]>()
  const standalone: T[] = []

  for (const test of labTests) {
    const key = labBriefingGroupKey(test)
    if (!key) {
      standalone.push(test)
      continue
    }
    const arr = groups.get(key) || []
    arr.push(test)
    groups.set(key, arr)
  }

  const rows: LabBriefingDisplayRow<T>[] = []
  for (const [key, tests] of groups.entries()) {
    const representative = tests[0]
    const groupName = (representative.lab_test_group_name || '').trim()
    rows.push({
      kind: 'group',
      key,
      label: groupName && !looksLikeLabCode(groupName) ? groupName : 'Group',
      tests,
      representative,
    })
  }
  for (const test of standalone) {
    rows.push({ kind: 'standalone', test })
  }
  return rows
}

export function labBriefingPatientGroups<T extends NurseBriefingLabTest>(
  labTests: T[]
): { patient: string; patientName: string; isIp: boolean; tests: T[] }[] {
  const byPatient = new Map<string, T[]>()
  for (const test of labTests) {
    const key = test.patient || test.name
    const arr = byPatient.get(key) || []
    arr.push(test)
    byPatient.set(key, arr)
  }
  return [...byPatient.entries()].map(([patient, tests]) => ({
    patient,
    patientName: tests[0]?.patient_name || patient,
    isIp: tests.some((t) => Boolean(t.inpatient_record)),
    tests,
  }))
}

export function labBriefingChildPreview(tests: NurseBriefingLabTest[], max = 3): string {
  const names = tests
    .map((t) => labBriefingTestLabel(t))
    .filter((name) => name && name !== 'Lab test')
  if (!names.length) return ''
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} +${names.length - max}` : shown
}
