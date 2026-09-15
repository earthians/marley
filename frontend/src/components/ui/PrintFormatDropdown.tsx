import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { fetchPrintFormats } from '../../services/common'

interface PrintFormatDropdownProps {
  doctype: string
  docName: string
  noLetterhead?: number
  triggerPrint?: number
  className?: string
  ariaLabel?: string
  title?: string
}

const defaultPrintSvg = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
  </svg>
)

export function PrintFormatDropdown({
  doctype,
  docName,
  noLetterhead = 0,
  triggerPrint = 1,
  className = 'inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-primary hover:bg-slate-50 hover:text-slate-800 transition-colors',
  ariaLabel = 'Print',
  title = 'Print',
}: PrintFormatDropdownProps) {
  const [open, setOpen] = useState(false)
  const [formats, setFormats] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open || !doctype) return
    setLoading(true)
    fetchPrintFormats(doctype)
      .then(setFormats)
      .catch(() =>
        setFormats(
          doctype === 'Clinical Note' || doctype === 'Main Nursing Note' ? [] : ['Standard'],
        ),
      )
      .finally(() => setLoading(false))
  }, [open, doctype])

  const updatePosition = () => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setPosition({
      top: rect.bottom + 4,
      right: typeof window !== 'undefined' ? window.innerWidth - rect.right : 0,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    updatePosition()
    const onScrollOrResize = () => updatePosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const inButton = containerRef.current?.contains(target)
      const inMenu = target.closest('[data-print-format-dropdown-menu]')
      if (!inButton && !inMenu) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleSelectFormat = (format: string) => {
    const params = new URLSearchParams()
    params.set('doctype', doctype)
    params.set('name', docName)
    params.set('format', format)
    params.set('trigger_print', String(triggerPrint))
    params.set('no_letterhead', String(noLetterhead))
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${base}/printview?${params.toString()}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  const menuEl =
    open && position && typeof document !== 'undefined' ? (
      <div
        data-print-format-dropdown-menu
        className="fixed z-[9999] min-w-[160px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        style={{
          top: position.top,
          right: position.right,
          left: 'auto',
        }}
      >
        <div className="px-3 py-1.5 text-xs font-medium text-slate-500 border-b border-slate-100">
          Print format
        </div>
        {loading ? (
          <div className="px-3 py-2 text-sm text-slate-500">Loading…</div>
        ) : formats.length === 0 ? (
          <div className="px-3 py-2 text-sm text-slate-500">No print formats</div>
        ) : (
          formats.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => handleSelectFormat(format)}
              className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
            >
              {format}
            </button>
          ))
        )}
      </div>
    ) : null

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={className}
        aria-label={ariaLabel}
        title={title}
      >
        {defaultPrintSvg}
      </button>
      {typeof document !== 'undefined' && menuEl && createPortal(menuEl, document.body)}
    </div>
  )
}
