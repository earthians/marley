frappe.ui.form.on("Inpatient Record", {
    // console.log("Inpatient Record >>>>");
    
    // Add custom button for pain rating
    refresh: function (frm){
        console.log("Pain Rating Button Test")
        frappe.db
        .get_value(
            "Pain Rating Score",
            {inpatient_record: frm.doc.name},
            "name"
        )
        .then(({message})=>{
            if(message.name){
                frm.page
                .add_inner_button(__("Pain Rating Score"), function(){
                    frappe.set_route(
                        "Form", 
                        "Pain Rating Score",
                        message.name
                    );
                },
                __("Create"))
                .addClass("inner-group-button");
            } else {
                frm.page
                .add_inner_button(__("Add Pain Rating Score"), function(){
                    frm.trigger("create_pain_rating_score");
                },
                __("Create"))
                .addClass("inner-group-button");
            } 
        });

        frm.add_custom_button(__("Vital Signs"), function(){
            frappe.new_doc("Vital Signs", {
                patient: frm.doc.patient,   
            })
        },
        __("Create"));
    },

    create_pain_rating_score(frm){
        frappe.new_doc("Pain Rating Score", {
            patient: frm.doc.patient,

        })
    }
});