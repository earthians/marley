import { isEditableWithin24hFromCreation, DAILY_ROUTINE_EDIT_LOCKED_MESSAGE } from '../../constants/nursingShift'

/** Always enforce a 24-hour create window for ECT clinical forms (like IP Medical Report). */
export function canMutateEctForm(
  creation?: string | null,
  lockEditingData: boolean = false,
): boolean {
  return (
    Boolean(creation) &&
    isEditableWithin24hFromCreation(String(creation || ''), true) &&
    !lockEditingData
  )
}

export const ECT_FORM_EDIT_LOCKED_MESSAGE = DAILY_ROUTINE_EDIT_LOCKED_MESSAGE

export const ECT_FORM_MUTATE_HINT =
  'Edit and delete are available for 24 hours after creation.'
