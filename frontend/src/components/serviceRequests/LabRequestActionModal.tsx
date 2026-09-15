import type { ReactNode } from 'react'
import { AlertTriangle, FlaskConical, Trash2, X } from 'lucide-react'
import {
  CM_BTN_CANCEL,
  CM_BTN_PRIMARY,
  CREATE_MODAL_OVERLAY_STACK,
  createModalShellClass,
} from '../ui/CreateModalChrome'
import type { ServiceRequest } from '../../services/serviceRequests'

export type LabRequestModalAction = 'delete' | 'cancel' | 'settlement' | 'sample_handling'

export interface LabRequestActionModalProps {
  action: LabRequestModalAction
  serviceRequest: ServiceRequest
  loading?: boolean
  onClose: () => void
  onDeleteConfirm: () => void
  onSampleHandlingConfirm: () => void
  onCancelConfirm: () => void
  onSettlementChoice: (mode: 'refund' | 'patient_credit') => void
}

function ModalShell({
  title,
  subtitle,
  icon,
  tone,
  loading = false,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  icon: ReactNode
  tone: 'danger' | 'warning' | 'primary'
  loading?: boolean
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}) {
  const toneClasses = {
    danger: {
      header: 'from-red-100 via-rose-50 to-orange-50 border-red-100/60',
      ring: 'border-red-200/60 ring-red-100/80 shadow-red-600/10',
      icon: 'bg-red-500/15 ring-red-400/40 text-red-700',
      title: 'text-red-950',
      subtitle: 'text-red-800/80',
    },
    warning: {
      header: 'from-amber-100 via-orange-50 to-yellow-50 border-amber-100/60',
      ring: 'border-amber-200/60 ring-amber-100/80 shadow-amber-600/10',
      icon: 'bg-amber-500/15 ring-amber-400/40 text-amber-800',
      title: 'text-amber-950',
      subtitle: 'text-amber-900/80',
    },
    primary: {
      header: 'from-emerald-100 via-teal-50 to-sky-100 border-emerald-100/60',
      ring: 'border-emerald-200/60 ring-emerald-100/80 shadow-emerald-600/10',
      icon: 'bg-emerald-500/20 ring-emerald-400/40 text-emerald-700',
      title: 'text-emerald-950',
      subtitle: 'text-emerald-800/80',
    },
  }[tone]

  return (
    <div
      className={CREATE_MODAL_OVERLAY_STACK}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={createModalShellClass(`max-w-md overflow-hidden ${toneClasses.ring}`)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`relative border-b bg-gradient-to-r px-5 py-4 sm:px-6 ${toneClasses.header}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${toneClasses.icon}`}
              >
                {icon}
              </div>
              <div className="min-w-0">
                <h2 className={`text-lg font-semibold tracking-tight ${toneClasses.title}`}>{title}</h2>
                {subtitle ? <p className={`mt-1 text-sm ${toneClasses.subtitle}`}>{subtitle}</p> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-black/5 hover:text-slate-800 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6">{children}</div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-6">
          {footer}
        </div>
      </div>
    </div>
  )
}

export function LabRequestActionModal({
  action,
  serviceRequest,
  loading = false,
  onClose,
  onDeleteConfirm,
  onSampleHandlingConfirm,
  onCancelConfirm,
  onSettlementChoice,
}: LabRequestActionModalProps) {
  const srLabel = serviceRequest.name
  const patientLabel = serviceRequest.patient_name || serviceRequest.patient || 'Patient'
  const templateLabel = serviceRequest.template_name || serviceRequest.template_dn || 'Lab request'

  if (action === 'delete') {
    return (
      <ModalShell
        tone="danger"
        title="Delete lab request?"
        subtitle="This draft request will be permanently removed."
        icon={<Trash2 className="h-5 w-5" />}
        loading={loading}
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose} disabled={loading} className={CM_BTN_CANCEL}>
              Keep request
            </button>
            <button
              type="button"
              onClick={onDeleteConfirm}
              disabled={loading}
              className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-600/25 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <div className="rounded-xl border border-red-200/80 bg-red-50/80 px-4 py-3 text-sm text-red-900">
          You are about to delete <span className="font-semibold">{srLabel}</span>. This cannot be undone.
        </div>
        <dl className="grid grid-cols-1 gap-2 text-sm text-slate-700">
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Patient</dt>
            <dd className="font-medium text-right">{patientLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Tests</dt>
            <dd className="font-medium text-right">{templateLabel}</dd>
          </div>
        </dl>
      </ModalShell>
    )
  }

  if (action === 'sample_handling') {
    return (
      <ModalShell
        tone="warning"
        title="Cancel sample handling?"
        subtitle="Sample collection records will be reversed only."
        icon={<AlertTriangle className="h-5 w-5" />}
        loading={loading}
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose} disabled={loading} className={CM_BTN_CANCEL}>
              Keep samples
            </button>
            <button
              type="button"
              onClick={onSampleHandlingConfirm}
              disabled={loading}
              className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-600/25 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Cancelling…' : 'Cancel sample handling'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-700">
          For <span className="font-semibold">{srLabel}</span>, linked sample collection documents will be
          cancelled or removed and lab tests will return to awaiting sample collection.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Lab tests are <strong>not</strong> deleted</li>
          <li>Results and review data are <strong>not</strong> affected if already entered</li>
        </ul>
      </ModalShell>
    )
  }

  if (action === 'cancel') {
    return (
      <ModalShell
        tone="primary"
        title="Cancel lab request?"
        subtitle="Linked lab tests will be removed before sample collection."
        icon={<FlaskConical className="h-5 w-5" />}
        loading={loading}
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose} disabled={loading} className={CM_BTN_CANCEL}>
              Keep request
            </button>
            <button
              type="button"
              onClick={onCancelConfirm}
              disabled={loading}
              className={`${CM_BTN_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {loading ? 'Cancelling…' : 'Cancel lab request'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-700">
          Cancel <span className="font-semibold">{srLabel}</span> for{' '}
          <span className="font-medium">{patientLabel}</span>. Linked billing that is not a paid sales
          invoice will be removed with the request.
        </p>
        <dl className="grid grid-cols-1 gap-2 text-sm text-slate-700">
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Patient</dt>
            <dd className="font-medium text-right">{patientLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Tests</dt>
            <dd className="font-medium text-right">{templateLabel}</dd>
          </div>
        </dl>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      tone="primary"
      title="Cancel lab request?"
      subtitle="Linked lab tests will be removed before sample collection."
      icon={<FlaskConical className="h-5 w-5" />}
      loading={loading}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} disabled={loading} className={CM_BTN_CANCEL}>
          Back
        </button>
      }
    >
      <p className="text-sm leading-relaxed text-slate-700">
        Cancel <span className="font-semibold">{srLabel}</span> for{' '}
        <span className="font-medium">{patientLabel}</span>. This request has a paid sales invoice.
        Choose how to settle payment:
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onSettlementChoice('patient_credit')}
          disabled={loading}
          className={`${CM_BTN_PRIMARY} w-full text-left`}
        >
          {loading ? 'Processing…' : 'Patient credit (advance on account)'}
        </button>
        <button
          type="button"
          onClick={() => onSettlementChoice('refund')}
          disabled={loading}
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          Refund (cancel sales order; refund cash at desk)
        </button>
      </div>
    </ModalShell>
  )
}
