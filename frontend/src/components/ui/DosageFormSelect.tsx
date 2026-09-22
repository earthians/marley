import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import {
  linkComboboxDropdownClass,
  linkComboboxInputWithClearClass,
  linkComboboxOptionClassCompact,
} from './linkComboboxStyles'

export interface DosageFormSelectOption {
  name: string
  label?: string
}

interface DosageFormSelectProps {
  value: string
  options: DosageFormSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** Input classes — pass the surrounding modal's combobox style to match it. */
  inputClassName?: string
  /** Dropdown panel classes — defaults to the shared link-combobox dropdown. */
  dropdownClassName?: string
  /** Option row classes — defaults to the shared link-combobox option. */
  optionClassName?: string
}

/**
 * Searchable single select for Dosage Form / Pharmaceutical Form.
 *
 * Same look and feel as the drug (link) combobox, but because the form list is a
 * static master list it filters locally — so the long list (~100 forms) stays
 * usable: click to see all, type to narrow down.
 */
export function DosageFormSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  inputClassName,
  dropdownClassName,
  optionClassName,
}: DosageFormSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel = useMemo(() => {
    const hit = options.find((opt) => opt.name === value)
    return hit ? hit.label || hit.name : value || ''
  }, [options, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(q) || (opt.label || '').toLowerCase().includes(q),
    )
  }, [options, query])

  // Close on any click outside. Capture phase: modal shells stop mousedown
  // propagation, so a bubble-phase listener would never fire inside them.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  /** Enter / blur: only commit text that matches an existing form (never free text). */
  const commitQuery = () => {
    const typed = query.trim()
    if (typed) {
      const hit = options.find((opt) => opt.name.toLowerCase() === typed.toLowerCase())
      if (hit && hit.name !== value) onChange(hit.name)
    }
    close()
  }

  const inputClass = `${inputClassName || linkComboboxInputWithClearClass}${
    disabled ? ' !bg-slate-100 !text-slate-500 cursor-not-allowed' : ''
  }`

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          type="text"
          value={open ? query : selectedLabel}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            if (disabled) return
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (disabled) return
            setQuery(selectedLabel)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Also stops the surrounding form from being submitted by Enter.
              e.preventDefault()
              commitQuery()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
          className={inputClass}
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value && !disabled ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onChange('')
                close()
              }}
              className="text-slate-400 hover:text-slate-600 transition-colors p-0.5"
              title="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
          <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {open && !disabled && (
        <div className={dropdownClassName || linkComboboxDropdownClass}>
          {filtered.length ? (
            filtered.map((opt) => (
              <button
                key={opt.name}
                type="button"
                className={optionClassName || linkComboboxOptionClassCompact}
                // Keep focus in the input so the dropdown stays open until commit.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(opt.name)
                  close()
                }}
              >
                {opt.label || opt.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">NO RESULTS FOUND</div>
          )}
        </div>
      )}
    </div>
  )
}
