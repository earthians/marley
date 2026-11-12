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
		toast.warning(message.title || "Note", {
			description: String(message.message).replace(/<[^>]+>/g, ""),
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

export function toastSuccess(message) {
	toast.success(message, { duration: 6000 });
}
