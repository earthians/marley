// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Clinical Note", {
	refresh(frm) {

	},
    terms_and_conditions: function(frm) {
        set_terms_and_conditions(frm)
    }
});

var set_terms_and_conditions = function(frm, terms_and_conditions=''){
    console.log(frm.doc.terms_and_conditions)
    if (frm.doc.terms_and_conditions) {
      return frappe.call({
        method: 'erpnext.setup.doctype.terms_and_conditions.terms_and_conditions.get_terms_and_conditions',
        args: {
          template_name: frm.doc.terms_and_conditions || terms_and_conditions,
          doc: frm.doc
        },
        callback: function (r) {
          frm.set_value('note', r.message)
        }
      });
    } else {
      frm.set_value('note', '')
    }
  }