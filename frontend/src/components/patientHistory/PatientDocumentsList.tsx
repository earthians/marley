import { useEffect, useMemo, useState } from 'react'
import { fetchPatientDocuments, type PatientDocumentEntry } from '../../services/patientDocuments'
import {
  PatientDocumentAttachmentPreview,
  viewPatientDocument,
} from '../ui/PatientDocumentAttachmentPreview'

interface PatientDocumentsListProps {
  patient?: string
  /** Table for Patient History (default) or stacked cards. */
  layout?: 'table' | 'cards'
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB')
}

const isSignature = (doc: PatientDocumentEntry): boolean =>
  Boolean(doc.is_signature) ||
  /signature|signee/i.test(`${doc.document_type || ''} ${doc.field_label || ''}`)

const DOCUMENT_TH =
  'px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 whitespace-nowrap'

/**
 * The patient's own documents / signatures, whichever doctype stores them:
 * patient visits, admissions (e-signatures), discharges, lab tests, signed
 * consents and directly attached patient files. Doctor / staff signatures are
 * excluded, and legacy scans live in the separate "Legacy Documents" section.
 */
export const PatientDocumentsList = ({ patient, layout = 'table' }: PatientDocumentsListProps) => {
  const [documents, setDocuments] = useState<PatientDocumentEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [source, setSource] = useState('all')

  useEffect(() => {
    if (!patient) {
      setDocuments([])
      setLoading(false)
      setError(null)
      setSource('all')
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const rows = await fetchPatientDocuments(patient)
        if (!cancelled) setDocuments(rows)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to fetch patient documents'))
          setDocuments([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [patient])

  const sources = useMemo(() => {
    const counts = new Map<string, number>()
    for (const doc of documents) counts.set(doc.source, (counts.get(doc.source) || 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [documents])

  const visible = useMemo(
    () => (source === 'all' ? documents : documents.filter((doc) => doc.source === source)),
    [documents, source]
  )

  if (!patient) {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="text-sm text-slate-500">Select a patient to view documents.</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Loading documents…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="mb-1 text-sm font-semibold text-red-800">Error Loading Documents</h3>
          <p className="text-sm text-red-700">{error.message}</p>
        </div>
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="text-sm text-slate-500">No documents found for this patient.</div>
      </div>
    )
  }

  const signatureCount = visible.filter(isSignature).length

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
      <div className="text-xs text-slate-600">
        <span className="font-semibold text-slate-800">{visible.length}</span> document(s)
        {signatureCount ? ` · ${signatureCount} signature(s)` : ''}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Source
        </label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All sources ({documents.length})</option>
          {sources.map(([name, count]) => (
            <option key={name} value={name}>
              {name} ({count})
            </option>
          ))}
        </select>
      </div>
    </div>
  )
  if (layout === 'cards') {
    return (
      <div className="space-y-3">
        {toolbar}
        {visible.map((doc) => (
          <div key={doc.name} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {doc.document_type || doc.field_label || 'Document'}
                  {doc.reference ? (
                    <span className="font-normal text-slate-500"> · {doc.reference}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Source: {doc.source}</span>
                  {doc.date ? <span>Date: {formatDate(doc.date)}</span> : null}
                  {doc.file_name ? (
                    <span className="max-w-[240px] truncate">{doc.file_name}</span>
                  ) : null}
                  {isSignature(doc) ? (
                    <span className="font-semibold text-amber-700">Signature</span>
                  ) : null}
                </div>
                {doc.upload_remarks ? (
                  <div className="line-clamp-2 text-xs text-slate-500">{doc.upload_remarks}</div>
                ) : null}
              </div>
              {doc.document ? (
                <button
                  type="button"
                  onClick={() => viewPatientDocument(doc.document)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open
                </button>
              ) : null}
            </div>
            {doc.document ? (
              <div className="px-4 py-3">
                <PatientDocumentAttachmentPreview
                  url={doc.document}
                  fileName={doc.file_name || doc.document_name}
                  compact
                />
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-slate-500">No file attached.</div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {toolbar}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className={DOCUMENT_TH}>Date</th>
              <th className={DOCUMENT_TH}>Source</th>
              <th className={DOCUMENT_TH}>Type</th>
              <th className={DOCUMENT_TH}>Document</th>
              <th className={DOCUMENT_TH}>Preview</th>
              <th className={DOCUMENT_TH}>Reference</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((doc) => (
              <tr key={doc.name} className="border-b border-slate-100 align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-700">
                  {formatDate(doc.date)}
                </td>
                <td className="px-3 py-2.5 text-sm text-slate-700">{doc.source}</td>
                <td className="px-3 py-2.5 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{doc.document_type || doc.field_label || '—'}</span>
                    {isSignature(doc) ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Signature
                      </span>
                    ) : null}
                  </div>
                  {doc.field_label && doc.document_type ? (
                    <div className="text-[11px] text-slate-500">{doc.field_label}</div>
                  ) : null}
                </td>
                <td className="max-w-[220px] px-3 py-2.5 text-sm text-slate-600">
                  <div className="truncate" title={doc.file_name || doc.document}>
                    {doc.file_name || doc.document}
                  </div>
                  {doc.document ? (
                    <button
                      type="button"
                      onClick={() => viewPatientDocument(doc.document)}
                      className="mt-1 text-xs font-medium text-primary hover:underline"
                    >
                      Open
                    </button>
                  ) : null}
                </td>
                <td className="min-w-[170px] px-3 py-2.5">
                  {doc.document ? (
                    <PatientDocumentAttachmentPreview
                      url={doc.document}
                      fileName={doc.file_name || doc.document_name}
                      compact
                    />
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
                </td>
                <td
                  className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600"
                  title={doc.source_doctype}
                >
                  {doc.reference || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

