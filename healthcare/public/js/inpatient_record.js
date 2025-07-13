frappe.ui.form.on("Inpatient Record", {
  // console.log("Inpatient Record >>>>");

  // Add custom button for pain rating
  onload: function (frm) {
    if (frm.doc.initial_encounter_json) {
      const initialEncounter = JSON.parse(frm.doc.initial_encounter_json);
      const allergies = initialEncounter.allergies;
      if (allergies) {
        frappe.msgprint({
          title: __("Allergies"),
          message: __(allergies),
          indicator: "red",
        });
      }
    }
  },
  refresh: function (frm) {
    if (!frm.is_dirty() && !frm.doc.__islocal) {
      let $wrapper = $(frm.fields_dict.initial_encounter_print_html?.wrapper);
      if ($wrapper.length) {
        $wrapper.empty();
        $wrapper.append(
          `<div id="initial-encounter-print-container" class="d-flex justify-content-center"></div>`
        );
        frm.trigger("initial_encounter_print");
      }
    }

    frappe.db
      .get_value(
        "Pain Rating Score",
        { inpatient_record: frm.doc.name },
        "name"
      )
      .then(({ message }) => {
        if (message.name) {
          frm.page
            .add_inner_button(
              __("Pain Rating Score"),
              function () {
                frappe.set_route("Form", "Pain Rating Score", message.name);
              },
              __("Create")
            )
            .addClass("inner-group-button");
        } else {
          frm.page
            .add_inner_button(
              __("Add Pain Rating Score"),
              function () {
                frm.trigger("create_pain_rating_score");
              },
              __("Create")
            )
            .addClass("inner-group-button");
        }
      });

    frappe.db
      .get_value("Insurance MR", { patient: frm.doc.name }, "name")
      .then(({ message }) => {
        if (message.name) {
          frm.page
            .add_inner_button(__("Insurance MR"), function () {
              frappe.set_route("Form", "Insurance MR", message.name);
            })
            .addClass("inner-group-button");
        } else {
          frm.page
            .add_inner_button(__("Add Insurance MR"), function () {
              frappe.new_doc("Insurance MR");
            })
            .addClass("inner-group-button");
        }
      });

    frappe.db
      .get_value("Fluid Intake Output Chart", { patient: frm.doc.name }, "name")
      .then(({ message }) => {
        if (message.name) {
          frm.page
            .add_inner_button(__("Fluid Intake Output Chart"), function () {
              frappe.set_route(
                "Form",
                "Fluid Intake Output Chart",
                message.name
              );
            })
            .addClass("inner-group-button");
        } else {
          frm.page
            .add_inner_button(
              __("Fluid Intake Output Chart"),
              function () {
                frappe.new_doc("Fluid Intake Output Chart", {
                  patient: frm.doc.patient,
                });
              },
              __("Create")
            )
            .addClass("inner-group-button");
        }
      });

    frm.add_custom_button(
      __("Vital Signs"),
      function () {
        frappe.new_doc("Vital Signs", {
          patient: frm.doc.patient,
        });
      },
      __("Create")
    );

    // frm.add_custom_button(
    //   __("Medical Record"),
    //   function () {
    //     frappe.new_doc("Patient Medical Record", {
    //       patient: frm.doc.patient,
    //       reference_doctype: "Inpatient Record",
    //       reference_docname: frm.doc.name,
    //     });
    //   },
    //   __("Create")
    // );

    // frm.add_custom_button(__("Fluid Intake Output Chart"), function(){
    //     frappe.new_doc("Fluid Intake Output Chart",{
    //         patient: frm.doc.patient
    //     })
    // },
    // __("Create"));

    frm.add_custom_button(
      __("Consent Form Admission"),
      function () {
        frappe.new_doc("Consent Form Admission", {
          patient: frm.doc.patient,
        });
      },
      __("Create")
    );

    frm.add_custom_button(
      __("Diabetic Chart"),
      function () {
        frappe.new_doc("Diabetic Chart", {
          patient: frm.doc.patient,
          inpatient_record: frm.doc.name,
        });
      },
      __("Create")
    );
    frm.add_custom_button(
      __("Drug Administration"),
      function () {
        frappe.new_doc("Drug Administration", {
          ref_dn: frm.doc.name,
          ref_dt: "Inpatient Record",
        });
      },
      __("Create")
    );
  },

  create_pain_rating_score(frm) {
    frappe.new_doc("Pain Rating Score", {
      patient: frm.doc.patient,
    });
  },

  initial_encounter_print(frm) {
    if (frm.doc.initial_encounter_json) {
      const print_container = $("#initial-encounter-print-container");
      const btn = $(
        '<button class="btn btn-primary">Print Initial Encounter</button>'
      );
      print_container.append(btn);
      btn.on("click", function () {
        window.open(
          "/printview?doctype=" +
            "Inpatient Record" +
            "&name=" +
            frm.doc.name +
            "&format=" +
            "PC Initial Encounter",
          "_blank"
        );
      });
    }
  },
});
