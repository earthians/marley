// Customer: the Employee link (custom_employee, klik_pos) belongs on the Customer
// that stands in for an employee. Receptionists sometimes leave the Employee of the
// user who registered the patient on a patient's Customer, so the link is dropped
// when the Customer name and the Employee name do not look the same.
const HEALTHCARE_EMPLOYEE_FIELD = "custom_employee";

function healthcare_normalize_name(value) {
	return (value || "")
		.toString()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function healthcare_names_look_same(customer_name, employee_name) {
	const left = healthcare_normalize_name(customer_name);
	const right = healthcare_normalize_name(employee_name);
	if (!left || !right) return false;
	if (left === right) return true;

	const left_tokens = new Set(left.split(" "));
	const right_tokens = new Set(right.split(" "));
	const subset = (a, b) => [...a].every((token) => b.has(token));
	return subset(left_tokens, right_tokens) || subset(right_tokens, left_tokens);
}

function healthcare_clear_employee(frm, message) {
	frm.set_value(HEALTHCARE_EMPLOYEE_FIELD, "");
	if (frm.fields_dict.custom_employee_name) {
		frm.set_value("custom_employee_name", "");
	}
	frm.refresh_field(HEALTHCARE_EMPLOYEE_FIELD);
	if (message) {
		frappe.show_alert({ message: message, indicator: "orange" }, 7);
	}
}

function healthcare_check_employee_link(frm) {
	const employee = frm.doc[HEALTHCARE_EMPLOYEE_FIELD];
	if (!employee) return;

	const employee_name = frm.doc.custom_employee_name;
	if (healthcare_names_look_same(frm.doc.customer_name, employee_name)) return;

	healthcare_clear_employee(
		frm,
		__("Employee {0} unlinked: the Employee name does not match the Customer name.", [
			employee,
		])
	);
}

frappe.ui.form.on("Customer", {
	refresh(frm) {
		frm.remove_custom_button(__("Unlink Employee"), __("Actions"));
		frm.remove_custom_button(__("Unlink Employee"));
		if (frm.is_new() || !frm.doc[HEALTHCARE_EMPLOYEE_FIELD]) return;
		if (frm.perm && frm.perm[0] && !frm.perm[0].write) return;

		frappe
			.call({
				method: "healthcare.api.customer_employee_cleanup.get_customer_employee_status",
				args: { customer: frm.doc.name },
			})
			.then((r) => {
				const status = r.message || {};
				if (!status.needs_unlink) return;

				frm.dashboard.set_headline(
					__(
						"Employee {0} ({1}) is linked but the Customer name does not match the Employee name.",
						[status.employee || "", status.employee_name || __("name not found")]
					),
					"orange"
				);

				frm.add_custom_button(
					__("Unlink Employee"),
					() => {
						frappe.confirm(
							__("Remove the Employee link {0} from Customer {1}?", [
								status.employee || "",
								frm.doc.name,
							]),
							() => {
								frappe
									.call({
										method: "healthcare.api.customer_employee_cleanup.unlink_mismatched_employee",
										args: { customer: frm.doc.name },
										freeze: true,
										freeze_message: __("Unlinking Employee..."),
									})
									.then((res) => {
										const result = res.message || {};
										if (result.unlinked) {
											frm.reload_doc();
											frappe.show_alert(
												{ message: result.message, indicator: "green" },
												7
											);
										} else {
											frappe.msgprint(
												result.message || __("Nothing to unlink.")
											);
										}
									});
							}
						);
					},
					__("Actions")
				);
			})
			.catch(() => {});
	},

	custom_employee(frm) {
		healthcare_check_employee_link(frm);
	},

	custom_employee_name(frm) {
		healthcare_check_employee_link(frm);
	},

	validate(frm) {
		healthcare_check_employee_link(frm);
	},
});
