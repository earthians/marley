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
                .add_inner_button("Pain Rating Score", function(){
                    frappe.set_route(
                        "Form", 
                        "Pain Rating Score",
                        message.name
                    );
                })
                .addClass("inner-group-button");
            } else {
                frm.page
                .add_inner_button("Add Pain Rating Score", function(){
                    frm.trigger("create_pain_rating_score");
                })
                .addClass("inner-group-button");
            } 
        });
    },

    create_pain_rating_score(frm){

        let not_left_service_unit = null;
        for (let inpatient_occupancy in frm.doc.inpatient_occupancies) {
          if (frm.doc.inpatient_occupancies[inpatient_occupancy].left != 1) {
            not_left_service_unit =
              frm.doc.inpatient_occupancies[inpatient_occupancy].service_unit;
          }
        }
        
        frappe.model.open_mapped_doc({
                method:"pcare.pcare.doctype.pain_rating_score.pain_rating_score.create_and_open_pain_rating_doc",
                frm,
                args: JSON.stringify({
                    "doctype_to_map_to": "Inpatient Record",
                    "service_unit": not_left_service_unit,
                }),
                freeze_message: __("Creating a Pain Rating Record... Please wait !")
            });
        
        console.log(not_left_service_unit);
    }

    // If pain rating score is available then show the button view pain rating
    // Button routes to existing doc

    // If pain rating score is not available then show button add pain rating
    // Create and map to new doc 
});