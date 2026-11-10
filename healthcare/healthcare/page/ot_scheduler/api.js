// Calls to the OT Booking API. A read is a GET; a change is a POST with desk's CSRF token.
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

// A change that went through but is worth knowing about, such as a patient's second case of
// the day, comes back as an orange server message
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

// The first server message is the toast; any others go beneath it. A refusal of several
// messages at once (frappe.throw with as_list) arrives as one list among them.
export function showError(error) {
	const messages = (error?.messages || []).flat().filter(Boolean);
	const [first, ...rest] = messages.length
		? messages
		: [error?.message || String(error)];
	toastError(first, rest.join(" "));
}

// The board's toasts stay longer than frappe-ui's 4 seconds: a refusal says why, and needs reading
export function toastError(message, description) {
	toast.error(message, { description: description || undefined, duration: 10000 });
}

export function toastSuccess(message) {
	toast.success(message, { duration: 6000 });
}
