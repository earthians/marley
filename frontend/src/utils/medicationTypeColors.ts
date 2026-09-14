/** Medication type color coding (matches prescription UI). */

import type { CSSProperties } from 'react'
import { normalizePrescriptionType } from './prescriptionType'

export const MEDICATION_TYPES = [
  { key: 'STAT', label: 'STAT', color: '#fe80c0' },
  { key: 'PRN', label: 'PRN', color: '#fefebf' },
  { key: 'Regular - Psy (Active)', label: 'Reg Psy Active', color: '#00ff02' },
  { key: 'Regular - Med (Active)', label: 'Reg Med Active', color: '#4080e1' },
  { key: 'Regular - Psy (Inactive)', label: 'Reg Psy Inactive', color: '#94a3b8' },
  { key: 'Regular - Med (Inactive)', label: 'Reg Med Inactive', color: '#94a3b8' },
  { key: 'Long Acting Medicine', label: 'Long Acting', color: '#0d9488' },
  { key: 'Future Plan', label: 'Future Plan', color: '#6366f1' },
] as const

export const isHexColor = (color: string) => color.startsWith('#')

export function getMedicationTypeColor(medicationType?: string | null): string {
  const normalized = normalizePrescriptionType(medicationType)
  const typeDef = MEDICATION_TYPES.find((t) => t.key === normalized)
  return typeDef?.color ?? '#94a3b8'
}

/** Short label for inline type chips (e.g. Reg Psy Active). */
export function getMedicationTypeLabel(
  medicationType?: string | null,
  fallbackPrn?: boolean | 0 | 1 | null,
): string {
  const normalized = normalizePrescriptionType(medicationType)
  if (normalized) {
    return MEDICATION_TYPES.find((t) => t.key === normalized)?.label || normalized
  }
  if (fallbackPrn === true || fallbackPrn === 1) return 'PRN'
  return ''
}

/** Resolve type used for color/label when medication_type may be empty but is_prn is set. */
export function resolveMedicationTypeForDisplay(
  medicationType?: string | null,
  isPrn?: boolean | 0 | 1 | null,
): string {
  const normalized = normalizePrescriptionType(medicationType)
  if (normalized) return normalized
  if (isPrn === true || isPrn === 1) return 'PRN'
  return ''
}

export function medicationTypeBadgeStyle(medicationType?: string | null): CSSProperties | undefined {
  const color = getMedicationTypeColor(medicationType)
  if (!isHexColor(color)) return undefined
  return {
    backgroundColor: color,
    color: '#1e293b',
  }
}

export function medicationRowStyle(medicationType?: string | null, isPink?: boolean): CSSProperties {
  if (isPink) {
    return { backgroundColor: 'rgba(253, 242, 248, 0.85)' }
  }
  const color = getMedicationTypeColor(medicationType)
  if (isHexColor(color)) {
    return { backgroundColor: `${color}22`, borderColor: `${color}55` }
  }
  return {}
}
