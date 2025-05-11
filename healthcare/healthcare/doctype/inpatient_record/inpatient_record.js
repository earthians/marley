// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Inpatient Record", {
  setup: function (frm) {
    frm.get_field("drug_prescription").grid.editable_fields = [
      { fieldname: "drug_code", columns: 2 },
      { fieldname: "drug_name", columns: 2 },
      { fieldname: "dosage", columns: 2 },
      { fieldname: "period", columns: 2 },
      { fieldname: "dosage_form", columns: 2 },
    ];
  },
  prescription_json: function (frm) {
    frm.prescription_renderer.prescription_json();
  },
  refresh: function (frm) {
    if (!frm.doc.__islocal) {
      frappe.require("pcareui.bundle.js").then(() => {
        frm.prescription_renderer = new pcare.ui.UIPrescriptionRender(
          frm,
          frm.doc.patient,
          frm.doc.name,
          "Inpatient Record",
          frm.doc.name
        );
        frm.prescription_renderer.display_prescription();
        frm.encounter_renderer = new pcare.ui.UIEncounterRender(
          frm,
          frm.doc.patient,
          frm.doc.name,
          "Inpatient Record",
          frm.doc.name,
          "initial_encounter_json",
          "initial_encounter_html"
        );
        frm.encounter_renderer.display_encounter();

        new pcare.ui.UIEncounterRender(
          frm,
          frm.doc.patient,
          frm.doc.name,
          "Inpatient Record",
          frm.doc.name,
          "discharge_summary_json",
          "discharge_summary_html"
        ).display_encounter();

        frm.trigger("add_notes");
      });
    }

    frm.set_query("admission_service_unit_type", function () {
      return {
        filters: {
          inpatient_occupancy: 1,
          allow_appointments: 0,
        },
      };
    });

    if (!frm.doc.__islocal) {
      if (frm.doc.status == "Admitted") {
        frm.add_custom_button(__("Schedule Discharge"), function () {
          schedule_discharge(frm);
        });
      } else if (frm.doc.status == "Admission Scheduled") {
        frm.add_custom_button(__("Cancel Admission"), function () {
          cancel_ip_order(frm);
        });
        frm.add_custom_button(__("Admit"), function () {
          admit_patient_dialog(frm);
        });
      } else if (frm.doc.status == "Discharge Scheduled") {
        frm.add_custom_button(__("Discharge"), function () {
          discharge_patient(frm);
        });
      }
    } else {
      frm.set_value("status", "Admission Scheduled");
    }
  },

  onload: function (frm) {
    if (frm.doc.patient) {
      renderVitalSignsCharts(frm);
    }
  },

  btn_transfer: function (frm) {
    transfer_patient_dialog(frm);
  },

  add_notes: function (frm) {
    const content = `
    <div class="row">
  <div class="col-3">
    <div class="nav flex-column nav-pills" id="v-pills-tab" role="tablist" aria-orientation="vertical">
      <button class="nav-link active" id="v-pills-important-tab" data-toggle="pill" data-target="#v-pills-important" type="button" role="tab" aria-controls="v-pills-important" aria-selected="true">Important</button>
      <button class="nav-link" id="v-pills-doctors-tab" data-toggle="pill" data-target="#v-pills-doctors" type="button" role="tab" aria-controls="v-pills-doctors" aria-selected="false">Doctor's Note</button>
      <button class="nav-link" id="v-pills-nurses-tab" data-toggle="pill" data-target="#v-pills-nurses" type="button" role="tab" aria-controls="v-pills-nurses" aria-selected="false">Nurse's Note</button>
    </div>
  </div>
  <div class="col-9">
    <div class="tab-content" id="v-pills-tabContent">
      <div class="tab-pane fade show active" id="v-pills-important" role="tabpanel" aria-labelledby="v-pills-important-tab"></div>
      <div class="tab-pane fade" id="v-pills-doctors" role="tabpanel" aria-labelledby="v-pills-doctors-tab"></div>
      <div class="tab-pane fade" id="v-pills-nurses" role="tabpanel" aria-labelledby="v-pills-nurses-tab"></div>
    </div>
  </div>
</div>
`;
    const $wrapper = $(frm.fields_dict["notes_html"].wrapper).empty();
    $wrapper.append(content);
    frm.trigger("add_important_notes");
    frm.trigger("add_doctors_notes");
    frm.trigger("add_nurses_notes");
  },

  add_important_notes: function (frm) {
    const fields = [
      {
        fieldtype: "Link",
        label: "Patient",
        fieldname: "patient",
        options: "Patient",
        default: frm.doc.patient,
        read_only: 1,
        reqd: 1,
      },
      {
        fieldtype: "Link",
        label: "Patient Name",
        fieldname: "patient_name",
        options: "Patient",
        default: frm.doc.patient_name,
        read_only: 1,
      },
      {
        fieldtype: "Text Editor",
        label: "Note",
        fieldname: "note",
        reqd: 1,
      },
    ];
    new pcare.ui.UIPCForm(
      frm,
      $("#v-pills-important"),
      "Inpatient Record",
      frm.doc.name,
      fields,
      "Important Notes"
    ).render_list();
  },
  add_doctors_notes: function (frm) {
    const fields = [
      {
        fieldtype: "Link",
        label: "Patient",
        fieldname: "patient",
        options: "Patient",
        default: frm.doc.patient,
        read_only: 1,
        reqd: 1,
      },
      {
        fieldtype: "Link",
        label: "Patient Name",
        fieldname: "patient_name",
        options: "Patient",
        default: frm.doc.patient_name,
        read_only: 1,
      },
      {
        fieldtype: "Link",
        label: "Reference Doctor",
        fieldname: "practitioner",
        options: "Healthcare Practitioner",
        // reqd: 1,
      },
      {
        fieldtype: "Text Editor",
        label: "Note",
        fieldname: "note",
        reqd: 1,
      },
    ];
    new pcare.ui.UIPCForm(
      frm,
      $("#v-pills-doctors"),
      "Inpatient Record",
      frm.doc.name,
      fields,
      "Doctors Encounter"
    ).render_list();
  },
  add_nurses_notes: function (frm) {
    const fields = [
      {
        fieldtype: "Link",
        label: "Patient",
        fieldname: "patient",
        options: "Patient",
        default: frm.doc.patient,
        read_only: 1,
        reqd: 1,
      },
      {
        fieldtype: "Link",
        label: "Patient Name",
        fieldname: "patient_name",
        options: "Patient",
        default: frm.doc.patient_name,
        read_only: 1,
      },
      {
        fieldtype: "Link",
        label: "Reference Doctor",
        fieldname: "practitioner",
        options: "Healthcare Practitioner",
        // reqd: 1,
      },
      {
        fieldtype: "Text Editor",
        label: "Note",
        fieldname: "note",
        reqd: 1,
      },
    ];
    new pcare.ui.UIPCForm(
      frm,
      $("#v-pills-nurses"),
      "Inpatient Record",
      frm.doc.name,
      fields,
      "Nurses Notes"
    ).render_list();
  },
});

let discharge_patient = function (frm) {
  frappe.call({
    doc: frm.doc,
    method: "discharge",
    callback: function (data) {
      if (!data.exc) {
        frm.reload_doc();
      }
    },
    freeze: true,
    freeze_message: __("Processing Inpatient Discharge"),
  });
};

let admit_patient_dialog = function (frm) {
  let dialog = new frappe.ui.Dialog({
    title: "Admit Patient",
    width: 100,
    fields: [
      {
        fieldtype: "Link",
        label: "Service Unit Type",
        fieldname: "service_unit_type",
        options: "Healthcare Service Unit Type",
        default: frm.doc.admission_service_unit_type,
      },
      {
        fieldtype: "Link",
        label: "Service Unit",
        fieldname: "service_unit",
        options: "Healthcare Service Unit",
        reqd: 1,
      },
      {
        fieldtype: "Datetime",
        label: "Admission Datetime",
        fieldname: "check_in",
        reqd: 1,
        default: frappe.datetime.now_datetime(),
      },
      {
        fieldtype: "Date",
        label: "Expected Discharge",
        fieldname: "expected_discharge",
        default: frm.doc.expected_length_of_stay
          ? frappe.datetime.add_days(
              frappe.datetime.now_datetime(),
              frm.doc.expected_length_of_stay
            )
          : "",
      },
    ],
    primary_action_label: __("Admit"),
    primary_action: function () {
      let service_unit = dialog.get_value("service_unit");
      let check_in = dialog.get_value("check_in");
      let expected_discharge = null;
      if (dialog.get_value("expected_discharge")) {
        expected_discharge = dialog.get_value("expected_discharge");
      }
      if (!service_unit && !check_in) {
        return;
      }
      frappe.call({
        doc: frm.doc,
        method: "admit",
        args: {
          service_unit: service_unit,
          check_in: check_in,
          expected_discharge: expected_discharge,
        },
        callback: function (data) {
          if (!data.exc) {
            frm.reload_doc();
          }
        },
        freeze: true,
        freeze_message: __("Processing Patient Admission"),
      });
      frm.refresh_fields();
      dialog.hide();
    },
  });

  dialog.fields_dict["service_unit_type"].get_query = function () {
    return {
      filters: {
        inpatient_occupancy: 1,
        allow_appointments: 0,
      },
    };
  };
  dialog.fields_dict["service_unit"].get_query = function () {
    return {
      filters: {
        is_group: 0,
        company: frm.doc.company,
        service_unit_type: dialog.get_value("service_unit_type"),
        occupancy_status: "Vacant",
      },
    };
  };

  dialog.show();
};

let transfer_patient_dialog = function (frm) {
  let dialog = new frappe.ui.Dialog({
    title: "Transfer Patient",
    width: 100,
    fields: [
      {
        fieldtype: "Link",
        label: "Leave From",
        fieldname: "leave_from",
        options: "Healthcare Service Unit",
        reqd: 1,
        read_only: 1,
      },
      {
        fieldtype: "Link",
        label: "Service Unit Type",
        fieldname: "service_unit_type",
        options: "Healthcare Service Unit Type",
      },
      {
        fieldtype: "Link",
        label: "Transfer To",
        fieldname: "service_unit",
        options: "Healthcare Service Unit",
        reqd: 1,
      },
      {
        fieldtype: "Datetime",
        label: "Check In",
        fieldname: "check_in",
        reqd: 1,
        default: frappe.datetime.now_datetime(),
      },
    ],
    primary_action_label: __("Transfer"),
    primary_action: function () {
      let service_unit = null;
      let check_in = dialog.get_value("check_in");
      let leave_from = null;
      if (dialog.get_value("leave_from")) {
        leave_from = dialog.get_value("leave_from");
      }
      if (dialog.get_value("service_unit")) {
        service_unit = dialog.get_value("service_unit");
      }
      if (check_in > frappe.datetime.now_datetime()) {
        frappe.msgprint({
          title: __("Not Allowed"),
          message: __("Check-in time cannot be greater than the current time"),
          indicator: "red",
        });
        return;
      }
      frappe.call({
        doc: frm.doc,
        method: "transfer",
        args: {
          service_unit: service_unit,
          check_in: check_in,
          leave_from: leave_from,
        },
        callback: function (data) {
          if (!data.exc) {
            frm.reload_doc();
          }
        },
        freeze: true,
        freeze_message: __("Process Transfer"),
      });
      frm.refresh_fields();
      dialog.hide();
    },
  });

  dialog.fields_dict["leave_from"].get_query = function () {
    return {
      query:
        "healthcare.healthcare.doctype.inpatient_record.inpatient_record.get_leave_from",
      filters: { docname: frm.doc.name },
    };
  };
  dialog.fields_dict["service_unit_type"].get_query = function () {
    return {
      filters: {
        inpatient_occupancy: 1,
        allow_appointments: 0,
      },
    };
  };
  dialog.fields_dict["service_unit"].get_query = function () {
    return {
      filters: {
        is_group: 0,
        service_unit_type: dialog.get_value("service_unit_type"),
        occupancy_status: "Vacant",
      },
    };
  };

  dialog.show();

  let not_left_service_unit = null;
  for (let inpatient_occupancy in frm.doc.inpatient_occupancies) {
    if (frm.doc.inpatient_occupancies[inpatient_occupancy].left != 1) {
      not_left_service_unit =
        frm.doc.inpatient_occupancies[inpatient_occupancy].service_unit;
    }
  }
  dialog.set_values({
    leave_from: not_left_service_unit,
  });
};

var schedule_discharge = function (frm) {
  var dialog = new frappe.ui.Dialog({
    title: "Inpatient Discharge",
    fields: [
      {
        fieldtype: "Link",
        label: "Discharge Practitioner",
        fieldname: "discharge_practitioner",
        options: "Healthcare Practitioner",
      },
      {
        fieldtype: "Datetime",
        label: "Discharge Ordered DateTime",
        fieldname: "discharge_ordered_datetime",
        default: frappe.datetime.now_datetime(),
      },
      {
        fieldtype: "Date",
        label: "Followup Date",
        fieldname: "followup_date",
      },
      // {
      //   fieldtype: "Column Break",
      // },
      // {
      //   fieldtype: "Small Text",
      //   label: "Discharge Instructions",
      //   fieldname: "discharge_instructions",
      // },
      // {
      //   fieldtype: "Section Break",
      //   label: "Discharge Summary",
      // },
      // {
      //   fieldtype: "Long Text",
      //   label: "Discharge Note",
      //   fieldname: "discharge_note",
      // },
    ],
    primary_action_label: __("Order Discharge"),
    primary_action: function () {
      var args = {
        patient: frm.doc.patient,
        discharge_practitioner: dialog.get_value("discharge_practitioner"),
        discharge_ordered_datetime: dialog.get_value(
          "discharge_ordered_datetime"
        ),
        followup_date: dialog.get_value("followup_date"),
        discharge_instructions: dialog.get_value("discharge_instructions"),
        discharge_note: dialog.get_value("discharge_note"),
      };
      frappe.call({
        method:
          "healthcare.healthcare.doctype.inpatient_record.inpatient_record.schedule_discharge",
        args: { args },
        callback: function (data) {
          if (!data.exc) {
            frm.reload_doc();
          }
        },
        freeze: true,
        freeze_message: "Scheduling Inpatient Discharge",
      });
      frm.refresh_fields();
      dialog.hide();
    },
  });

  dialog.show();
  dialog.$wrapper.find(".modal-dialog").css("width", "800px");
};

let cancel_ip_order = function (frm) {
  frappe.prompt(
    [
      {
        fieldname: "reason_for_cancellation",
        label: __("Reason for Cancellation"),
        fieldtype: "Small Text",
        reqd: 1,
      },
    ],
    function (data) {
      frappe.call({
        method:
          "healthcare.healthcare.doctype.inpatient_record.inpatient_record.set_ip_order_cancelled",
        async: false,
        freeze: true,
        args: {
          inpatient_record: frm.doc.name,
          reason: data.reason_for_cancellation,
        },
        callback: function (r) {
          if (!r.exc) frm.reload_doc();
        },
      });
    },
    __("Reason for Cancellation"),
    __("Submit")
  );
};

function renderVitalSignsCharts(frm) {
  let $wrapper = $(frm.fields_dict.vital_signs.wrapper).empty();

  frappe
    .require("vital_signs_charts.bundle.js")
    .then(() => {
      frappe.vital_signs_charts = new frappe.ui.VitalSignsCharts({
        wrapper: $wrapper,
        patientId: frm.doc.patient,
        inpatientRecordId: frm.doc.name,
      });
    })
    .catch((err) => {
      console.error("Error loading vital signs charts bundle:", err);
      $wrapper.html(`
            <div class="alert alert-danger">
                <p>Error loading vital signs charts. Please check console for details.</p>
            </div>
        `);
    });
}

function stripHtml(html) {
  let div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}
