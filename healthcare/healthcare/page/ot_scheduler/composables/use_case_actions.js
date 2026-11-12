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

	function askReason(method, params, action, dropped = false) {
		reason.value = "";
		reasonFor.value = { method, params, action, dropped };
		menuFor.value = null;
		previewFor.value = null;
	}

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
