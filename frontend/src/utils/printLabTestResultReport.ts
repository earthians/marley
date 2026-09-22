import { fetchLabRequestReview } from '../services/serviceRequests'

/**
 * Open the "Lab Test Print" (Laboratory Report) print view for a Lab Test.
 *
 * The format renders every Lab Test on the parent Service Request — all groups
 * and child tests — so opening it with any member of a Lab Request prints the
 * whole request report (same output as Print inside the Lab Request review modal).
 */
export function openLabTestResultReportPrint(labTestName: string): void {
  const name = (labTestName || '').trim()
  if (!name) return
  const params = new URLSearchParams({
    doctype: 'Lab Test',
    name,
    format: 'Lab Test Print',
    trigger_print: '1',
    no_letterhead: '0',
  })
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  window.open(`${base}/printview?${params.toString()}`, '_blank', 'noopener,noreferrer')
}

/**
 * Print the Laboratory Report for a whole Lab Request (used from listing rows).
 *
 * Resolves one linked Lab Test first — the print format then expands to the full
 * request — so the output matches printing from the Lab Request review modal.
 * Returns the Lab Test name used, or ``null`` when the request has no linked test.
 */
export async function openLabRequestResultReportPrint(
  serviceRequestName: string,
): Promise<string | null> {
  const review = await fetchLabRequestReview(serviceRequestName)
  const labTestName =
    (review.lab_tests || []).map((lt) => (lt.name || '').trim()).find(Boolean) ||
    (review.groups || [])
      .flatMap((g) => g.tests || [])
      .map((t) => (t.lab_test || '').trim())
      .find(Boolean) ||
    ''
  if (!labTestName) return null
  openLabTestResultReportPrint(labTestName)
  return labTestName
}
