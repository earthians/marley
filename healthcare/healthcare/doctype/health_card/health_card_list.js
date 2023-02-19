frappe.listview_settings['Health Card'] = {
	onload: function(listview) {
		listview.page.add_menu_item(__("Generate Health Cards"), function() {
            var dialog = new frappe.ui.Dialog({
            	title: 'Generate Health Cards',
                fields: [
                    {fieldtype: 'Link', label: 'Health Card Type', fieldname: 'health_card_type', options: 'Health Card Type', reqd: 1},
                    {fieldtype: 'Int', label: 'No. Of Cards', fieldname: 'no_of_cards', default: 1, reqd: 1}
                ],
                primary_action_label: __('Generate Cards'),
                primary_action : function() {
                    
                    var health_card_type = dialog.get_value('health_card_type');
                    var no_of_cards = dialog.get_value('no_of_cards');
                    
                    frappe.call({
                		method: 'healthcare.healthcare.doctype.health_card.health_card.generate_healthcards',
                		args: {
                		    'health_card_type': health_card_type,
                		    'no_of_cards': no_of_cards
                		},
                		callback: function(data) {
                		    if (!data.exc) {
                		        frappe.msgprint({
                                    title: __('Notification'),
                                    indicator: 'green',
                                    message: __('Health Cards Generated successfully')
                                });
                		    }
                		}
                    });
                    
        			dialog.hide();
        		}
    	    });
        	dialog.show();
		});
	}
};