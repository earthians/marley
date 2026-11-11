// What the user does to a case on the board: change it through the server (ot_booking/
// scheduling.py), with a reason when the server needs one, from its menu. A case's menu and its
// preview never show together, and neither opens over the reason dialog. Only a drag and drop
// sounds (`dropped`); a change from a menu is silent.
import { ref } from "vue";

import { caseMenu, statusParams } from "../case_menu.js";
import { post, showError, toastError, toastSuccess } from "../api.js";
import { playDropSound } from "../sounds.js";

export function useCaseActions({ canEdit, reload, open }) {
	const reasonFor = ref(null);
	const reason = ref("");
	const menuFor = ref(null);
	const previewFor = ref(null);

	async function change(method, params, dropped = false) {
		let result;
		try {
			result = await post(`scheduling.${method}`, params);
			if (dropped) playDropSound("placed");
		} catch (error) {
			showError(error);
			if (dropped) playDropSound("refused");
		}
		reload();
		return result;
	}

	// A change the server will refuse without a reason waits here for one
	function askReason(method, params, action, dropped = false) {
		reason.value = "";
		reasonFor.value = { method, params, action, dropped };
		menuFor.value = null;
		previewFor.value = null;
	}

	// The reason is asked for only when the server says the change would otherwise go through
	async function askIfPossible(method, params, action, dropped = false) {
		try {
			const refusal = await post("scheduling.check_drop", {
				method,
				params: JSON.stringify(params),
			});
			if (!refusal) return askReason(method, params, action, dropped);
			toastError(refusal);
		} catch (error) {
			showError(error);
		}
		if (dropped) playDropSound("refused");
	}

	// Back to the To schedule pane, keeping the booking for a new day. A published case needs a
	// reason; a Tentative one goes straight back.
	function reschedule(booking, dropped = false) {
		const params = statusParams(booking, "Postponed");
		if (booking.needs_reason)
			return askIfPossible("set_status", params, "Reschedule", dropped);
		change("set_status", params, dropped);
	}

	function changeWithReason({ close }) {
		if (!reason.value.trim()) return;
		const { method, params, dropped } = reasonFor.value;
		change(method, { ...params, reason: reason.value }, dropped);
		close();
	}

	async function createProcedures(booking) {
		const created = await change("create_procedures", { name: booking.name });
		if (created?.length)
			toastSuccess(`Created ${created.length} Clinical Procedure(s)`);
	}

	function menuOf(booking) {
		const actions = { open, createProcedures, reschedule, change, askReason };
		return caseMenu(booking, { canEdit: canEdit.value, ...actions });
	}

	function menuOpened(booking, isOpen) {
		menuFor.value = isOpen && !reasonFor.value ? booking.name : null;
		if (isOpen) previewFor.value = null;
	}

	function previewOpened(item, isOpen) {
		previewFor.value =
			isOpen && !menuFor.value && !reasonFor.value ? item.name : null;
	}

	return {
		reasonFor,
		reason,
		menuFor,
		previewFor,
		change,
		askIfPossible,
		reschedule,
		changeWithReason,
		menuOf,
		menuOpened,
		previewOpened,
	};
}
