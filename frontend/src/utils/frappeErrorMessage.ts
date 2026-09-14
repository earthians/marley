/** Human-readable labels for common Frappe mandatory field names */
const MANDATORY_FIELD_LABELS: Record<string, string> = {
  cost_center: 'Branch',
  practitioner: 'Practitioner',
  patient: 'Patient',
  patient_visit: 'Patient visit',
  inpatient_record: 'Inpatient admission',
  template_dt: 'Template type',
  template_dn: 'Template',
  order_date: 'Order date',
  order_time: 'Order time',
}

function labelForField(field: string): string {
  const key = field.trim()
  return (
    MANDATORY_FIELD_LABELS[key] ||
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Unwrap Frappe payloads that put a traceback string inside a JSON array. */
function unwrapTracePayload(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw !== 'string') {
    try {
      return unwrapTracePayload(JSON.stringify(raw))
    } catch {
      return String(raw)
    }
  }
  let text = raw.trim()
  if (!text) return ''
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (Array.isArray(parsed)) {
        text = parsed.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n')
      } else if (parsed && typeof parsed === 'object' && typeof (parsed as { message?: string }).message === 'string') {
        text = (parsed as { message: string }).message
      }
    } catch {
      /* keep text */
    }
  }
  return text
}

function friendlyPhoneError(msg: string): string | null {
  const m =
    msg.match(/InvalidPhoneNumberError:\s*(.+?)(?:\n|$)/i) ||
    msg.match(/Phone Number\s+(.+?)\s+set in field\s+(.+?)\s+is not valid/i) ||
    msg.match(/^(.+?)\s+is not a valid Phone Number/i)
  if (!m) return null
  if (m[2]) {
    const phone = stripHtml(m[1] || '').replace(/^["']|["']$/g, '')
    const field = stripHtml(m[2] || '').replace(/^["']|["']$/g, '')
    return `Invalid phone number “${phone}” in ${field}. Enter digits only (optional +/country code)—no names or relation text.`
  }
  const phone = stripHtml(m[1] || '').replace(/^["']|["']$/g, '')
  if (!phone || phone.toLowerCase().includes('traceback')) return null
  return `Invalid phone number “${phone}”. Enter digits only (optional +/country code)—no names or relation text. Check Relatives and contact phone fields.`
}

function messageFromMandatoryExc(exc: string): string | null {
  const match = exc.match(/MandatoryError:\s*\[[^\]]+\]:\s*([^\n]+)/)
  if (!match) return null
  const fields = match[1].split(',').map((f) => f.trim()).filter(Boolean)
  if (!fields.length) return null
  return `Please provide: ${fields.map(labelForField).join(', ')}.`
}

function messageFromExceptionString(exc: string): string | null {
  const text = unwrapTracePayload(exc)
  const phone = friendlyPhoneError(text)
  if (phone) return phone

  const mandatory = messageFromMandatoryExc(text)
  if (mandatory) return mandatory

  const linkExists = text.match(
    /Cannot delete or cancel because\s+(.+?)\s+is linked with\s+(.+?)(?:\n|$)/i
  )
  if (linkExists?.[1] && linkExists?.[2]) {
    const source = stripHtml(linkExists[1]).trim()
    const target = stripHtml(linkExists[2]).trim()
    if (/sales order/i.test(source) && /service request/i.test(target)) {
      return `Could not replace the Sales Order because it is still linked to ${target}. Unlink it from the lab request and try again.`
    }
    return `Cannot cancel ${source} because it is still linked to ${target}.`
  }

  const patterns = [
    /ValidationError:\s*(.+?)(?:\n|$)/s,
    /frappe\.exceptions\.ValidationError:\s*(.+?)(?:\n|$)/s,
    /frappe\.exceptions\.\w+:\s*(.+?)(?:\n|$)/s,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const msg = stripHtml(m[1]).trim()
      if (msg && !msg.includes('Traceback') && msg.length < 500) {
        return friendlyPhoneError(msg) || msg
      }
    }
  }
  return null
}

function parseServerMessages(raw: unknown): string | null {
  if (!raw) return null
  try {
    const arr = typeof raw === 'string' ? (JSON.parse(raw) as unknown[]) : raw
    if (!Array.isArray(arr)) return null
    for (const item of arr) {
      let parsed: { message?: string } | null = null
      if (typeof item === 'string') {
        try {
          parsed = JSON.parse(item) as { message?: string }
        } catch {
          const trimmed = item.trim()
          if (trimmed && !trimmed.startsWith('[') && !trimmed.includes('Traceback')) {
            return friendlyPhoneError(trimmed) || trimmed
          }
          const fromExc = messageFromExceptionString(trimmed)
          if (fromExc) return fromExc
        }
      } else if (item && typeof item === 'object') {
        parsed = item as { message?: string }
      }
      const msg = parsed?.message ? stripHtml(String(parsed.message)).trim() : ''
      if (msg && !msg.includes('Traceback')) return friendlyPhoneError(msg) || msg
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Extract a short user-facing message from a Frappe `/api/method` JSON response.
 * Avoids showing full Python tracebacks in the UI.
 */
export function frappeErrorMessage(
  out: Record<string, unknown>,
  fallback = 'Something went wrong. Please try again.'
): string {
  const fromServer = parseServerMessages(out._server_messages)
  if (fromServer) return fromServer

  const msg = out.message
  if (typeof msg === 'string' && msg.trim()) {
    const unwrapped = unwrapTracePayload(msg)
    if (unwrapped.includes('Traceback') || unwrapped.includes('File "')) {
      const fromExc = messageFromExceptionString(unwrapped)
      if (fromExc) return fromExc
    } else if (!unwrapped.trim().startsWith('[')) {
      return friendlyPhoneError(unwrapped) || stripHtml(unwrapped)
    }
  }
  if (msg && typeof msg === 'object' && typeof (msg as { message?: string }).message === 'string') {
    const inner = stripHtml((msg as { message: string }).message).trim()
    if (inner && !inner.includes('Traceback')) return friendlyPhoneError(inner) || inner
  }

  if (typeof out.exc === 'string' && out.exc.trim()) {
    const fromExc = messageFromExceptionString(out.exc)
    if (fromExc) return fromExc
    if (!out.exc.includes('Traceback')) {
      const last = out.exc.split('\n').filter(Boolean).pop()?.trim()
      if (last && last.length < 300) return friendlyPhoneError(last) || last
    }
  }

  if (typeof out.exception === 'string' && out.exception.trim()) {
    const fromExc = messageFromExceptionString(out.exception)
    if (fromExc) return fromExc
  }

  if (typeof out.exc_type === 'string' && out.exc_type === 'MandatoryError') {
    return 'Please fill in all required fields before saving.'
  }
  if (typeof out.exc_type === 'string' && out.exc_type === 'InvalidPhoneNumberError') {
    return 'One of the phone numbers is invalid. Enter digits only (optional +/country code)—no names or relation text.'
  }

  return fallback
}
