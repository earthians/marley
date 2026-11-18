import { frappeRequest, toast } from "frappe-ui";

const API = "healthcare.healthcare.doctype.ot_booking";

export function get(method, params = {}) {
	return frappeRequest({ url: `${API}.${method}`, params, method: "GET" });
}

export function post(method, params) {
	const headers = { "X-Frappe-CSRF-Token": window.frappe?.csrf_token };
	return frappeRequest({
		url: `${API}.${method}`,
		params,
		method: "POST",
		headers,
		onServerMessages: toastWarnings,
	});
}

function toastWarnings(messages) {
	for (const entry of messages) {
		const message = JSON.parse(entry);
		if (!["orange", "yellow"].includes(message.indicator)) continue;
		toast.warning(message.title || __("Note"), {
			description: String(message.message),
			duration: 10000,
		});
	}
}

export function showError(error) {
	const messages = (error?.messages || []).flat().filter(Boolean);
	const [first, ...rest] = messages.length
		? messages
		: [error?.message || String(error)];
	toastError(first, rest.join(" "));
}

export function toastError(message, description) {
	toast.error(message, { description: description || undefined, duration: 10000 });
}

export async function frozen(message, work) {
	const spinner = '<span class="es-spinner" data-track="true" role="status"></span>';
	window.frappe?.dom?.freeze(
		`${spinner} ${window.frappe.utils.escape_html(message)}`,
	);
	try {
		return await work();
	} catch (error) {
		showError(error);
		return null;
	} finally {
		window.frappe?.dom?.unfreeze();
	}
}

export function toastSuccess(message) {
	toast.success(message, { duration: 6000 });
}
