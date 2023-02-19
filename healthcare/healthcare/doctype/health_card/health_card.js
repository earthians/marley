// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on('Health Card', {
	refresh(frm) {
		frm.set_query('patient', function() {
			return {
				filters: {'status': 'Active'}
			};
		});

		if (frm.doc.status == "Active" && frm.doc.patient) {
			frm.toggle_enable(['patient', 'health_card_type'], 0);
		}
		
		if (frm.doc.status == "New" && frm.doc.patient) {
            frm.add_custom_button(__('Activate Health Card'), function() {
				activate_renew_health_card(frm, 0);
			});
        }

		if (frm.doc.status == "Expired") {
            frm.add_custom_button(__('Renew Health Card'), function() {
				activate_renew_health_card(frm, 1);
			});
        }
        
        if (frm.doc.status == "Active" && !frm.doc.invoiced) {
		    frm.add_custom_button(__('Invoice Health Card'), function() {
				invoice_health_card(frm);
			});			
		}		
	}
});

var activate_renew_health_card = function (frm, renewal) {
    var dialog = new frappe.ui.Dialog({
		title: 'Activate Health Card',
		fields: [
			{fieldtype: 'Date', label: 'Activation Start Date', fieldname: 'from', default: 'Today', reqd: 1}
		],
		primary_action_label: __('Activate Card'),
		primary_action : function() {
			var args = {
				health_card: frm.doc.name,
				from_date: dialog.get_value('from'),
				renewal: renewal
			};
			frappe.call({
				method: 'healthcare.healthcare.doctype.health_card.health_card.activate_renew_health_card',
				args: {
					args: args
				},
				callback: function(data) {
					if (!data.exc) {
						frm.reload_doc();
					}
				},
				freeze: true,
				freeze_message: __('Activating/Renewing Health Card')
			});
			frm.refresh_fields();
			dialog.hide();
		}
	});
	
	dialog.show();
};

var invoice_health_card = function (frm) {
    var dialog = new frappe.ui.Dialog({
		title: 'Invoice Health Card',
		fields: [
			{fieldtype: 'Link', label: 'Mode of Payment', fieldname: 'mode_of_payment', options: 'Mode of Payment', default: 'Cash', reqd: 1},
			{fieldtype: 'Currency', label: 'Paid Amount', fieldname: 'paid_amount', default: 0.0, reqd: 1}
		],
		primary_action_label: __('Create Invoice'),
		primary_action : function() {
			var args = {
			    health_card: frm.doc.name,
			    patient: frm.doc.patient,
				health_card_type: frm.doc.health_card_type,
				mode_of_payment: dialog.get_value('mode_of_payment'),
				paid_amount: dialog.get_value('paid_amount')
			};
			frappe.call({
				method: 'healthcare.healthcare.doctype.health_card.health_card.invoice_health_card',
				args: {
					args: args
				},
				callback: function(data) {
					if (!data.exc) {
						frm.reload_doc();
					}
				},
				freeze: true,
				freeze_message: __('Creating Invoice')
			});
			frm.refresh_fields();
			dialog.hide();
		}
	});
	
	frappe.db.get_value('Health Card Type', frm.doc.health_card_type, 'rate', (r) => {
		if (r && r.rate) {
            dialog.set_values({
                'paid_amount': r.rate
            });
		}
	});
    
	dialog.show();
	dialog.$wrapper.find('.modal-dialog').css('width', '800px');
};
