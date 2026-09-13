import { useState, useEffect, useRef } from 'react'
import {
  deleteClinicalNote,
  fetchClinicalNotes,
  fetchPendingDoctorProgressEncounters,
  type ClinicalNote,
  type PendingDoctorProgressEncounter,
} from '../../services/clinicalNotes'
import { fetchHealthcarePractitioners, getCurrentUserPractitioner, type LinkFieldOption } from '../../services/common'
import { ClinicalNoteDetailPanel } from './ClinicalNoteDetailPanel'
import { EditClinicalNoteModal } from './EditClinicalNoteModal'
import { PrintFormatDropdown } from '../ui/PrintFormatDropdown'
import { PortalActionsMenu } from '../ui/PortalActionsMenu'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useCareContext } from '../../providers/CareContextProvider'
import { useCardFilters, useDashboardCompactClinical } from '../../contexts/CardFilterContext'
import { CardRowMetaHint, dashboardCardRowHoverClass } from '../ui/dashboardCardListing'
import { ClearFiltersButton } from '../ui/ClearFiltersButton'
import { DateFilterInput } from '../ui/DateFilterInput'
import {
  CLINICAL_NOTE_EDIT_LOCKED_MESSAGE,
  isClinicalNoteEditableWithin24h,
} from '../../constants/nursingShift'
import { toast } from '../../hooks/useToast'
import { MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-react'
import { PaginationControls, DEFAULT_PAGE_SIZE, type PageSize } from '../ui/PaginationControls'
import { useSlideOverListNav } from '../../hooks/useSlideOverListNav'
import { formatLinkedVisitClinicalNoteDate } from '../../utils/formatDate'

// Helper function to strip HTML tags and decode HTML entities
const stripHtml = (html: string): string => {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent || tmp.innerText || ''
}

interface ClinicalNotesListProps {
  patient?: string
  /** Filter and scope the list by Clinical Note Type (preferred over medical role). */
  clinicalNoteType?: string
  noteType?: string
  hideTypes?: boolean
  onPatientClick?: (patient: string) => void
  title?: string
  onAdd?: () => void
  addButtonTitle?: string
  /** Show ⋮ Edit for notes still within 24h of creation (therapy notes). */
  allowEditWithin24h?: boolean
  /** Rows per page on first load. Patient Progress Notes listing uses 500. */
  defaultPageSize?: PageSize
}

function clinicalNoteTypeDisplayLabel(clinicalNoteType?: string): string {
  if (!clinicalNoteType) return 'Clinical Note'
  if (clinicalNoteType === 'Doctor Progress Note') return 'Patient Progress Note'
  return clinicalNoteType
}

function resolveListTitle(clinicalNoteType?: string, title?: string): string {
  if (title) return title
  if (!clinicalNoteType) return 'Clinical Notes'
  const displayType = clinicalNoteTypeDisplayLabel(clinicalNoteType)
  if (displayType.endsWith(' Note')) {
    return displayType.replace(/ Note$/, ' Notes')
  }
  if (displayType.endsWith(' Order')) {
    return displayType.replace(/ Order$/, ' Orders')
  }
  return clinicalNoteType
}

function clinicalNotePractitionerLabel(note: ClinicalNote): string {
  return note.practitioner_name || note.practitioner || note.user || '—'
}

/** Doctor Progress Note listing: practitioner name, else username when no practitioner. */
function doctorProgressNoteAuthorLabel(note: ClinicalNote): string {
  if (note.practitioner) {
    return note.practitioner_name || note.practitioner
  }
  if (note.username?.trim()) return note.username.trim()
  return note.user || '—'
}

function clinicalNoteDateLabel(note: ClinicalNote): string {
  return formatLinkedVisitClinicalNoteDate(note.posting_date, note.visit_encounter_date) || '-'
}

function clinicalNoteAuthorLabel(note: ClinicalNote, clinicalNoteType?: string): string {
  if (clinicalNoteType === 'Doctor Progress Note') {
    return doctorProgressNoteAuthorLabel(note)
  }
  return clinicalNotePractitionerLabel(note)
}

export const ClinicalNotesList = ({
  patient,
  clinicalNoteType,
  noteType,
  hideTypes = false,
  onPatientClick,
  title,
  onAdd,
  addButtonTitle,
  allowEditWithin24h = false,
  defaultPageSize = DEFAULT_PAGE_SIZE,
}: ClinicalNotesListProps) => {
  const listTitle = resolveListTitle(clinicalNoteType, title)
  const resolvedAddTitle = addButtonTitle ?? `Add ${clinicalNoteType || 'Clinical Note'}`
  const { mode, activeVisit, activeAdmission, isIOPVisit, guardClinicalEdit, therapyNoteUneditableIn24Hour } = useCareContext()
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNote[]>([])
  const [pendingEncounters, setPendingEncounters] = useState<PendingDoctorProgressEncounter[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [editNote, setEditNote] = useState<ClinicalNote | null>(null)
  const [deleteNote, setDeleteNote] = useState<ClinicalNote | null>(null)
  const [deletingNote, setDeletingNote] = useState(false)
  const [openActionRow, setOpenActionRow] = useState<string | null>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize)
  const [totalCount, setTotalCount] = useState(0)

  const cardFilters = useCardFilters()
  const [showFiltersInternal, setShowFiltersInternal] = useState(false)
  const showFilters = cardFilters !== undefined ? cardFilters : showFiltersInternal
  const inDashboardCard = cardFilters !== undefined
  const compactClinical = useDashboardCompactClinical()

  const [postingDateFrom, setPostingDateFrom] = useState('')
  const [postingDateTo, setPostingDateTo] = useState('')
  const [notePractitionerFilter, setNotePractitionerFilter] = useState('')
  const [practitionerQuery, setPractitionerQuery] = useState('')
  const [practitionerOpen, setPractitionerOpen] = useState(false)
  const [practitionerOptions, setPractitionerOptions] = useState<LinkFieldOption[]>([])
  const [practitionerInitDone, setPractitionerInitDone] = useState(false)

  /** Any typed note/order list: default practitioner filter to logged-in user's practitioner. */
  const applyDefaultPractitionerFilter = Boolean(clinicalNoteType?.trim())

  /** Without a patient: Doctor Progress Note aggregate list (pending encounters banner). */
  const hasRefContext = Boolean(
    (mode === 'OP' && activeVisit) || (mode === 'IP' && activeAdmission),
  )
  const useDoctorProgressMineOnly =
    clinicalNoteType === 'Doctor Progress Note' && !patient && !hasRefContext

  const showAdvancedNoteFilters =
    (showFilters && (Boolean(patient) || applyDefaultPractitionerFilter)) ||
    useDoctorProgressMineOnly
  const showPractitionerPicker =
    showAdvancedNoteFilters && (Boolean(patient) || applyDefaultPractitionerFilter || useDoctorProgressMineOnly)

  // Other note lists stay unfiltered. Patient Progress Notes with no patient
  // defaults the visible Doctor field to the logged-in practitioner so it can be cleared.
  useEffect(() => {
    if (!useDoctorProgressMineOnly) {
      setPractitionerInitDone(true)
      return
    }
    let cancelled = false
    ;(async () => {
      const practId = await getCurrentUserPractitioner()
      if (cancelled) return
      if (practId) {
        setNotePractitionerFilter(practId)
        try {
          const options = await fetchHealthcarePractitioners()
          const match = options.find((p) => p.name === practId)
          setPractitionerQuery(match?.label || practId)
          setPractitionerOptions(options)
        } catch {
          setPractitionerQuery(practId)
        }
      }
      setPractitionerInitDone(true)
    })()
    return () => {
      cancelled = true
    }
  }, [useDoctorProgressMineOnly])

  useEffect(() => {
    if (!practitionerOpen || !showPractitionerPicker) return
    const t = setTimeout(() => {
      fetchHealthcarePractitioners(practitionerQuery || undefined)
        .then(setPractitionerOptions)
        .catch(() => setPractitionerOptions([]))
    }, practitionerQuery.trim() === '' ? 0 : 300)
    return () => clearTimeout(t)
  }, [practitionerOpen, practitionerQuery, showPractitionerPicker])

  useEffect(() => {
    if (!practitionerInitDone) return

    const loadClinicalNotes = async () => {
      try {
        setLoading(true)
        setError(null)
        
        let referenceDoctype: string | undefined
        let referenceDocument: string | undefined
        let inpatientAdmission: string | undefined

        // Care context: IP uses inpatient_admission link; OP uses Patient Visit references.
        if (mode === 'OP' && activeVisit) {
          referenceDoctype = 'Patient Visit'
          referenceDocument = activeVisit
        } else if (mode === 'OP' && patient) {
          // OP mode without a specific visit: still limit to this patient's visit notes only.
          referenceDoctype = 'Patient Visit'
        } else if (mode === 'IP' && activeAdmission) {
          inpatientAdmission = activeAdmission
        }

        const practitionerForApi = notePractitionerFilter || undefined
        
        const response = await fetchClinicalNotes(
          pageSize,
          (page - 1) * pageSize,
          patient,
          undefined,
          clinicalNoteType,
          noteType,
          referenceDoctype,
          referenceDocument,
          inpatientAdmission,
          undefined,
          practitionerForApi,
          postingDateFrom || undefined,
          postingDateTo || undefined,
        )
        
        setClinicalNotes(response.data)
        setTotalCount(response.total_count)
      } catch (err) {
        console.error('Error loading clinical notes:', err)
        setError(err instanceof Error ? err : new Error('Failed to fetch clinical notes'))
      } finally {
        setLoading(false)
      }
    }

    loadClinicalNotes()
  }, [
    patient,
    clinicalNoteType,
    noteType,
    mode,
    activeVisit,
    activeAdmission,
    postingDateFrom,
    postingDateTo,
    notePractitionerFilter,
    practitionerInitDone,
    listRefreshKey,
    page,
    pageSize,
  ])

  const { hasPrev, hasNext, navLabel, goPrev, goNext } = useSlideOverListNav({
    items: clinicalNotes,
    loading,
    getKey: (note) => note.name,
    selectedKey: detailName,
    onSelect: (note) => setDetailName(note.name),
    page,
    setPage,
    pageSize,
    totalCount,
  })

  useEffect(() => {
    setPage(1)
  }, [
    patient,
    clinicalNoteType,
    noteType,
    mode,
    activeVisit,
    activeAdmission,
    postingDateFrom,
    postingDateTo,
    notePractitionerFilter,
  ])

  useEffect(() => {
    if (!useDoctorProgressMineOnly || !clinicalNoteType) {
      setPendingEncounters([])
      return
    }
    let cancelled = false
    const loadPending = async () => {
      setPendingLoading(true)
      try {
        const rows = await fetchPendingDoctorProgressEncounters(clinicalNoteType)
        if (!cancelled) setPendingEncounters(rows)
      } catch (e) {
        console.error(e)
        if (!cancelled) setPendingEncounters([])
      } finally {
        if (!cancelled) setPendingLoading(false)
      }
    }
    loadPending()
    return () => {
      cancelled = true
    }
  }, [useDoctorProgressMineOnly, clinicalNoteType])

  const noteReferenceLabel = (note: ClinicalNote) => {
    if (note.inpatient_admission) {
      return `Inpatient Admission: ${note.inpatient_admission}`
    }
    if (note.reference_doctype && note.reference_document) {
      return `${note.reference_doctype}: ${note.reference_document}`
    }
    return ''
  }

  const getContextLabel = () => {
    if (mode === 'OP' && activeVisit && isIOPVisit) {
      return `Showing notes for IOP Visit: ${activeVisit}`
    }
    if (mode === 'OP' && activeVisit) {
      return `Showing notes for OP Visit: ${activeVisit}`
    }
    if (mode === 'OP' && patient) {
      return 'Showing Patient Visit notes for this patient'
    }
    if (mode === 'IP' && activeAdmission) {
      return `Showing notes for IP Admission: ${activeAdmission}`
    }
    return null
  }

  const contextLabel = getContextLabel()
  const aggregateDoctorProgressLayout = useDoctorProgressMineOnly

  /** Read left-to-right: date/time → note → patient (if aggregate) → metadata → actions */
  const tableColumnOrderDoctorFirst = clinicalNoteType === 'Doctor Progress Note'
  /** Dashboard cards: date and note only; full listing keeps all columns. */
  const cardCompactLayout = compactClinical
  /** When the screen is already titled by note type, hide redundant type columns. */
  const hideTypeColumns = hideTypes || Boolean(clinicalNoteType?.trim())
  const authorColumnLabel =
    clinicalNoteType === 'Doctor Progress Note' ? 'Username' : 'Practitioner'
  const clinicalNoteTypeLabel = (note: ClinicalNote) =>
    note.clinical_note_type_name || note.clinical_note_type || '-'

  if (error && !loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl w-full">
          <h3 className="text-red-800 font-semibold mb-2">Error Loading Clinical Notes</h3>
          <p className="text-red-700 text-sm mb-2">{error.message}</p>
        </div>
      </div>
    )
  }

  if (loading && !aggregateDoctorProgressLayout && !detailName) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-600">Loading clinical notes...</div>
      </div>
    )
  }

  const notePreview = (note: ClinicalNote, maxLen: number) => {
    if (!note.note) return '-'
    const plainText = stripHtml(note.note)
    return plainText.length > maxLen ? `${plainText.substring(0, maxLen)}…` : plainText
  }

  const canEditNote = (note: ClinicalNote) =>
    allowEditWithin24h &&
    !note.note_locked &&
    isClinicalNoteEditableWithin24h(note.creation, therapyNoteUneditableIn24Hour)

  const openEditNote = (note: ClinicalNote) => {
    if (!canEditNote(note)) {
      toast.error(
        note.note_locked
          ? 'This clinical note is locked and cannot be edited or deleted.'
          : CLINICAL_NOTE_EDIT_LOCKED_MESSAGE
      )
      return
    }
    guardClinicalEdit(() => setEditNote(note))
  }

  const handleDeleteNote = (note: ClinicalNote) => {
    if (!canEditNote(note)) {
      toast.error(
        note.note_locked
          ? 'This clinical note is locked and cannot be edited or deleted.'
          : CLINICAL_NOTE_EDIT_LOCKED_MESSAGE
      )
      return
    }
    guardClinicalEdit(() => {
      setOpenActionRow(null)
      setDeleteNote(note)
    })
  }

  const confirmDeleteNote = async () => {
    if (!deleteNote) return
    const label = clinicalNoteTypeDisplayLabel(clinicalNoteType)
    setDeletingNote(true)
    try {
      await deleteClinicalNote(deleteNote.name)
      toast.success(`${label} deleted`)
      if (detailName === deleteNote.name) setDetailName(null)
      if (editNote?.name === deleteNote.name) setEditNote(null)
      setDeleteNote(null)
      setListRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to delete ${label.toLowerCase()}`)
    } finally {
      setDeletingNote(false)
    }
  }

  const renderNoteActions = (note: ClinicalNote) => {
    return (
      <div className="inline-flex items-center justify-center gap-1">
        <div className="relative" ref={openActionRow === note.name ? actionMenuRef : undefined}>
          <button
            type="button"
            aria-label="Actions"
            onClick={(e) => {
              e.stopPropagation()
              setOpenActionRow((prev) => (prev === note.name ? null : note.name))
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          <PortalActionsMenu
            open={openActionRow === note.name}
            onClose={() => setOpenActionRow(null)}
            triggerRef={actionMenuRef}
            minWidth={160}
          >
            <button
              type="button"
              onClick={() => {
                setOpenActionRow(null)
                setDetailName(note.name)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            >
              <Eye className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              View
            </button>
            {allowEditWithin24h && canEditNote(note) ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenActionRow(null)
                    openEditNote(note)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteNote(note)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
                  Delete
                </button>
              </>
            ) : null}
          </PortalActionsMenu>
        </div>
        <PrintFormatDropdown
          doctype="Clinical Note"
          docName={note.name}
          noLetterhead={0}
          triggerPrint={1}
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-primary hover:bg-slate-50"
        />
      </div>
    )
  }

  const notesTable = cardCompactLayout ? (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap w-[28%]">
              Date
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
              Note
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {clinicalNotes.map((note) => {
            const metaFields = [
              ['Note ID', note.name],
              [authorColumnLabel, clinicalNoteAuthorLabel(note, clinicalNoteType)],
              ['Clinical note type', clinicalNoteTypeLabel(note)],
              ['Reference', noteReferenceLabel(note)],
            ] as const
            return (
              <tr
                key={note.name}
                className={dashboardCardRowHoverClass}
                onClick={() => setDetailName(note.name)}
              >
                <td className="px-3 py-2.5 text-xs text-slate-700 whitespace-nowrap align-top">
                  <span className="text-primary font-medium">
                    {clinicalNoteDateLabel(note)}
                  </span>
                  <CardRowMetaHint fields={metaFields} />
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-700 align-top">
                  <div className="line-clamp-4" title={note.note ? stripHtml(note.note) : ''}>
                    {notePreview(note, 280)}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {tableColumnOrderDoctorFirst ? (
              <>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase min-w-[260px]">
                  Note
                </th>
                {!patient && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                    Patient
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                  {authorColumnLabel}
                </th>
                {!hideTypeColumns && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                    Clinical Note Type
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Visit / reference</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Actions</th>
              </>
            ) : (
              <>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">
                  Date
                </th>
                {!patient && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Patient</th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                  {authorColumnLabel}
                </th>
                {!hideTypeColumns && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                    Clinical Note Type
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Note</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Actions</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {clinicalNotes.map((note) => (
            <tr key={note.name} className="hover:bg-slate-50">
              {tableColumnOrderDoctorFirst ? (
                <>
                  <td
                    className="px-4 py-3 text-sm text-slate-700 cursor-pointer whitespace-nowrap"
                    onClick={() => setDetailName(note.name)}
                  >
                    <span className="text-primary hover:underline">
                      {clinicalNoteDateLabel(note)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 align-top max-w-xl">
                    <div className="line-clamp-4" title={note.note ? stripHtml(note.note) : ''}>
                      {notePreview(note, 220)}
                    </div>
                  </td>
                  {!patient && (
                    <td
                      className="px-4 py-3 text-sm text-slate-700 cursor-pointer"
                      onClick={() => note.patient && onPatientClick?.(note.patient)}
                    >
                      <span className="font-medium text-primary hover:underline">
                        {note.patient_name || note.patient || '-'}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {clinicalNoteAuthorLabel(note, clinicalNoteType)}
                  </td>
                  {!hideTypeColumns && (
                    <td className="px-4 py-3 text-sm text-slate-700">{clinicalNoteTypeLabel(note)}</td>
                  )}
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {noteReferenceLabel(note) ? (
                      <span className="text-xs text-slate-600">{noteReferenceLabel(note)}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 text-center align-middle">
                    {renderNoteActions(note)}
                  </td>
                </>
              ) : (
                <>
                  <td
                    className="px-4 py-3 text-sm text-slate-700 cursor-pointer whitespace-nowrap"
                    onClick={() => setDetailName(note.name)}
                  >
                    <span className="text-primary hover:underline">
                      {clinicalNoteDateLabel(note)}
                    </span>
                  </td>
                  {!patient && (
                    <td
                      className="px-4 py-3 text-sm text-slate-700 cursor-pointer"
                      onClick={() => note.patient && onPatientClick?.(note.patient)}
                    >
                      <span className="font-medium text-primary hover:underline">
                        {note.patient_name || note.patient || '-'}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {clinicalNoteAuthorLabel(note, clinicalNoteType)}
                  </td>
                  {!hideTypeColumns && (
                    <td className="px-4 py-3 text-sm text-slate-700">{clinicalNoteTypeLabel(note)}</td>
                  )}
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {noteReferenceLabel(note) ? (
                      <span className="text-xs text-slate-600">{noteReferenceLabel(note)}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 max-w-md">
                    <div className="truncate" title={note.note ? stripHtml(note.note) : ''}>
                      {notePreview(note, 100)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 text-center align-middle">
                    {renderNoteActions(note)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="min-w-full flex flex-col flex-1 min-h-0 h-full">
      {!inDashboardCard && (
        <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
          <h2 className="text-xl font-semibold text-slate-900">{listTitle}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {(Boolean(patient) || applyDefaultPractitionerFilter) && (
              <button
                type="button"
                onClick={() => setShowFiltersInternal((p) => !p)}
                className={`p-1.5 rounded-md border transition-colors ${showFilters ? 'bg-primary/10 border-primary text-primary' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}
                title={showFilters ? 'Hide filters' : 'Show filters'}
                aria-label={showFilters ? 'Hide filters' : 'Show filters'}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                </svg>
              </button>
            )}
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-lg font-bold flex-shrink-0"
                title={resolvedAddTitle}
              >
                +
              </button>
            )}
          </div>
        </div>
      )}

      {contextLabel && (
        <div className="mb-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
          {contextLabel}
        </div>
      )}

      {showAdvancedNoteFilters && (
        <div className="card-filter-bar flex flex-wrap items-end gap-3 mb-3 px-1 flex-shrink-0">
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-xs font-medium text-slate-500">From Date</label>
            <DateFilterInput
              value={postingDateFrom}
              onChange={(e) => setPostingDateFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-xs font-medium text-slate-500">To Date</label>
            <DateFilterInput
              value={postingDateTo}
              onChange={(e) => setPostingDateTo(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          {showPractitionerPicker && (
            <div className="flex flex-col gap-1 min-w-[180px] relative">
              <label className="text-xs font-medium text-slate-500">Doctor</label>
              <div className="relative">
                <input
                  type="text"
                  value={
                    notePractitionerFilter
                      ? practitionerOptions.find((p) => p.name === notePractitionerFilter)?.label || practitionerQuery
                      : practitionerQuery
                  }
                  onChange={(e) => {
                    setPractitionerQuery(e.target.value)
                    setNotePractitionerFilter('')
                    setPractitionerOpen(true)
                  }}
                  onFocus={() => setPractitionerOpen(true)}
                  placeholder="All doctors"
                  className="rounded-md border border-slate-300 px-2 py-1.5 pr-8 text-sm w-full"
                />
                {(notePractitionerFilter || practitionerQuery) ? (
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-slate-400 hover:text-slate-700"
                    title="Show all doctors"
                    onClick={() => {
                      setNotePractitionerFilter('')
                      setPractitionerQuery('')
                      setPractitionerOpen(false)
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {practitionerOpen && practitionerOptions.length > 0 && (
                <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {practitionerOptions.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={() => {
                        setNotePractitionerFilter(p.name)
                        setPractitionerQuery(p.label || p.name)
                        setPractitionerOpen(false)
                      }}
                    >
                      {p.label || p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {(postingDateFrom || postingDateTo || notePractitionerFilter) ? (
            <ClearFiltersButton
              onClick={() => {
                setPostingDateFrom('')
                setPostingDateTo('')
                setNotePractitionerFilter('')
                setPractitionerQuery('')
              }}
            />
          ) : null}
        </div>
      )}

      {aggregateDoctorProgressLayout && (
        <div className="mb-6 border border-amber-200 rounded-lg bg-amber-50/60 overflow-hidden">
          <div className="px-4 py-2 border-b border-amber-200 bg-amber-50">
            <h3 className="text-sm font-semibold text-slate-800">
              Admitted or today&apos;s visits — no Patient Progress Note yet
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Shown until any practitioner adds a Patient Progress Note for that admission or visit. Click a patient to open their file.
            </p>
          </div>
          {pendingLoading ? (
            <div className="px-4 py-3 text-sm text-slate-600">Loading pending encounters…</div>
          ) : pendingEncounters.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">None at the moment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-amber-100/80 border-b border-amber-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Patient
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Context
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Reference
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {pendingEncounters.map((row) => (
                    <tr key={`${row.reference_doctype}:${row.reference_document}`} className="hover:bg-white/80">
                      <td
                        className="px-4 py-2 text-sm cursor-pointer text-primary font-medium hover:underline"
                        onClick={() => row.patient && onPatientClick?.(row.patient)}
                      >
                        {row.patient_name || row.patient}
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-700">
                        {row.context_label}
                        {row.encounter_date ? (
                          <span className="text-slate-500"> · {row.encounter_date}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-700">
                        {row.context_status || '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600 font-mono">
                        {row.reference_document}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {aggregateDoctorProgressLayout && (
        <p className="text-xs text-slate-500 mb-2 px-1">
          Progress notes below are filtered to the Doctor field (defaults to you). Clear Doctor to see every practitioner, or open a patient file.
        </p>
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
      {loading && aggregateDoctorProgressLayout ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-slate-600">Loading clinical notes…</div>
        </div>
      ) : clinicalNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8">
          <div className="text-slate-500 text-center">
            <p>NO CLINICAL NOTES FOUND</p>
          </div>
        </div>
      ) : (
        notesTable
      )}
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
        />
      </div>

      {detailName ? (
        <ClinicalNoteDetailPanel
          name={detailName}
          title={clinicalNoteTypeDisplayLabel(clinicalNoteType)}
          preview={clinicalNotes.find((n) => n.name === detailName)}
          onClose={() => setDetailName(null)}
          onPatientClick={onPatientClick}
          onPrev={goPrev}
          onNext={goNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
          navLabel={navLabel}
        />
      ) : null}

      {editNote ? (
        <EditClinicalNoteModal
          note={editNote}
          title={
            clinicalNoteType === 'Therapist Note' ? 'Edit Therapy Note' : 'Edit Clinical Note'
          }
          onClose={() => setEditNote(null)}
          onSuccess={() => {
            setEditNote(null)
            setListRefreshKey((k) => k + 1)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteNote)}
        variant="danger"
        title={`Delete ${clinicalNoteTypeDisplayLabel(clinicalNoteType)}`}
        message={
          deleteNote
            ? `Are you sure you want to delete ${clinicalNoteTypeDisplayLabel(clinicalNoteType)} ${deleteNote.name}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deletingNote}
        onConfirm={() => void confirmDeleteNote()}
        onCancel={() => {
          if (!deletingNote) setDeleteNote(null)
        }}
      />
    </div>
  )
}