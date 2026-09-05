// Copyright (c) 2022, healthcare and contributors
// For license information, please see license.txt
{% include "healthcare/healthcare/service_request.js" %}

frappe.ui.form.on('Medication Request', {
	medication: function (frm) {
		healthcare.medication_safety.show_for_medication(frm, frm.doc.medication);
	},

    refresh: function(frm) {
        frm.set_query("status", function () {
			return {
				"filters": {
					"code_system": "Medication Request Status",
				}
			};
		});
	},

})