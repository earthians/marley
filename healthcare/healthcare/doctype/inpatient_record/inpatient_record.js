// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt
frappe.provide("pcare.utils");
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
    if (frm.doc.patient_name) {
      $("[id='page-Inpatient Record']")
        .find(".page-head-content")
        .css({ height: "90px" });

      $("#inp-patient-name").remove();
      $("#inp-room").remove();

      $("[id='page-Inpatient Record']")
        .find("h3")
        .parent()
        .parent()
        .append(`<div id="inp-patient-name">${frm.doc.patient_name}</div>`);

      pcare.utils.get_room(frm.doc.name).then((r) => {
        if (r) {
          $("[id='page-Inpatient Record']")
            .find("h3")
            .parent()
            .parent()
            .append(
              `<div id="inp-room" class="border-black text-center rounded border border-dark"><small><strong>${r}</strong></small></div>`
            );
          if (frm.doc.status !== "Discharged") {
            frm.set_value("healthcare_service_unit", r);
          }
        }
      });
    }

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
          "initial_encounter_html",
          {
            show_prescription: false,
          }
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

        new pcare.ui.UIHistoryRender(
          frm,
          frm.doc.patient,
          "Inpatient Record",
          frm.doc.name,
          "history_html"
        ).setup_app();
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
        frm.add_custom_button(__("Create Medical Certificate"), function () {
          create_medical_certificate(frm);
        });
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
        if (
          frappe.user.has_role("Administrator") ||
          frappe.user.has_role("Billing Role")
        ) {
          frm.add_custom_button(__("Discharge"), function () {
            discharge_patient(frm);
          });
        }
      } else if (frm.doc.status == "Discharged") {
        if (
          frappe.user.has_role("Administrator") ||
          frappe.user.has_role("Billing Role")
        ) {
          frm.add_custom_button(__("Re-Admission"), function () {
            readmit_patient(frm);
          });
        }
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

let readmit_patient = function (frm) {
  frappe.call({
    doc: frm.doc,
    method: "readmit",
    callback: function (data) {
      if (!data.exc) {
        frm.reload_doc();
      }
    },
    freeze: true,
    freeze_message: __("Processing Inpatient Readmission"),
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

function fetch_and_render_notes(
  frm,
  note_type,
  target_field,
  editable = false
) {
  let currentPage = 1; // Track the current page
  const notesPerPage = 5; // Number of notes to display per page
  let allNotes = []; // Store all notes

  // Fetch all notes from the backend
  frappe.call({
    method:
      "healthcare.healthcare.doctype.inpatient_record.inpatient_record.get_clinical_notes",
    args: { patient: frm.doc.patient, note_type },
    callback: function (response) {
      if (response.message && response.message.length > 0) {
        allNotes = response.message; // Store all notes
        renderNotes(); // Render the first page
      } else {
        $(frm.fields_dict[target_field].wrapper).html(
          "<p>No clinical notes found for this patient.</p>"
        );
      }
    },
  });

  // Function to render notes for the current page
  function renderNotes() {
    let html = `<h4>Existing ${note_type}</h4><ul>`;
    const start = (currentPage - 1) * notesPerPage;
    const end = Math.min(start + notesPerPage, allNotes.length);
    // Render notes for the current page
    for (let i = start; i < end; i++) {
      const note = allNotes[i];
      html += `
        <li class="border rounded p-3 mb-3">
          <strong>Date</strong> - ${frappe.datetime.str_to_user(
            note.posting_date
          )}<br>
              <div class="mb-1"><strong>Practitioner:</strong> ${
                note.practitioner || " "
              }<br></div>
              
          
          <div class="mb-1"><strong>Employee:</strong> ${
            note.employee || "N/A"
          }<br></div>
          <div class="mb-2 border rounded p-3 mb-3">${
            note.note ? stripHtml(note.note) : "<em>No content</em>"
          }<br></div>
          ${
            editable
              ? `
                <div class="text-end">
                  <button class="btn btn-secondary btn-sm edit-note" data-name="${note.name}" data-note="${note.note}" data-practitioner="${note.practitioner}">Edit</button>
                  <button class="btn btn-danger btn-sm delete-note" data-name="${note.name}">
                    <i class="bi bi-trash"></i> Delete
                  </button>
                </div>`
              : ""
          }
        </li>`;
    }
    html += `</ul>`;

    // Add pagination controls
    html += `
      <div class="text-center">
        <button class="btn btn-sm btn-primary prev-page" ${
          currentPage === 1 ? "disabled" : ""
        }>Previous</button>
        <button class="btn btn-sm btn-primary next-page" ${
          end >= allNotes.length ? "disabled" : ""
        }>Next</button>
      </div>
    `;

    $(frm.fields_dict[target_field].wrapper).html(html);

    // Attach event listeners for Edit and Delete buttons
    if (editable) {
      $(frm.fields_dict[target_field].wrapper)
        .find(".edit-note")
        .on("click", function () {
          open_edit_note_dialog(
            frm,
            $(this).data("name"),
            $(this).data("note"),
            $(this).data("practitioner")
          );
        });

      $(frm.fields_dict[target_field].wrapper)
        .find(".delete-note")
        .on("click", function () {
          delete_clinical_note(frm, $(this).data("name"));
        });
    }

    // Attach event listeners for pagination buttons
    $(frm.fields_dict[target_field].wrapper)
      .find(".prev-page")
      .on("click", function () {
        if (currentPage > 1) {
          currentPage--;
          renderNotes();
        }
      });

    $(frm.fields_dict[target_field].wrapper)
      .find(".next-page")
      .on("click", function () {
        if (end < allNotes.length) {
          currentPage++;
          renderNotes();
        }
      });
  }
}

function stripHtml(html) {
  let div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function open_clinical_note_dialog(frm, note_type) {
  let dialog = new frappe.ui.Dialog({
    title: `Add ${note_type}`,
    fields: [
      {
        fieldtype: "Link",
        label: "Patient",
        fieldname: "patient",
        options: "Patient",
        default: frm.doc.patient,
        read_only: 1,
      },
      {
        fieldtype: "Link",
        label: "Practitioner",
        fieldname: "practitioner",
        options: "Healthcare Practitioner",
      },
      {
        fieldtype: "Link",
        label: "Employee",
        fieldname: "employee",
        options: "Employee",
        reqd: 1,
      },
      {
        fieldtype: "Small Text",
        label: "Note",
        fieldname: "note",
        reqd: 1,
      },
    ],
    primary_action_label: "Save",
    primary_action: function (data) {
      if (!data.note) {
        frappe.msgprint(__("Please enter a note."));
        return;
      }

      // Save the clinical note using frappe.call
      frappe.call({
        method:
          "healthcare.healthcare.doctype.inpatient_record.inpatient_record.add_clinical_note",
        args: {
          note: data.note,
          note_type: note_type,
          patient: frm.doc.patient,
          practitioner: data.practitioner,
          employee: data.employee,
          reference_doc: "Inpatient Record",
          reference_name: frm.doc.name,
        },
        callback: function (response) {
          if (!response.exc) {
            frappe.msgprint(__("Clinical Note added successfully."));
            dialog.hide();

            // Refresh the notes section
            frm.reload_doc();
          }
        },
        freeze: true,
        freeze_message: __("Saving Clinical Note..."),
      });
    },
  });

  dialog.show();
}

function open_edit_note_dialog(
  frm,
  noteName,
  noteContent,
  practitioner,
  employee
) {
  let dialog = new frappe.ui.Dialog({
    title: "Edit Clinical Note",
    fields: [
      {
        fieldtype: "Link",
        label: "Practitioner",
        fieldname: "practitioner",
        options: "Healthcare Practitioner",
        default: practitioner,
      },
      {
        fieldtype: "Link",
        label: "Employee",
        fieldname: "employee",
        options: "Employee",
        default: employee,
        reqd: 1,
      },
      {
        fieldtype: "Small Text",
        label: "Note",
        fieldname: "note",
        default: noteContent,
        reqd: 1,
      },
    ],
    primary_action_label: "Save",
    primary_action: function (data) {
      if (!data.note) {
        frappe.msgprint(__("Please enter a note."));
        return;
      }

      // Update the clinical note using frappe.call
      frappe.call({
        method:
          "healthcare.healthcare.doctype.inpatient_record.inpatient_record.update_clinical_note",
        args: {
          name: noteName,
          note: data.note,
          practitioner: data.practitioner,
          employee: data.employee,
        },
        callback: function (response) {
          if (!response.exc) {
            frappe.msgprint(__("Clinical Note updated successfully."));
            dialog.hide();

            // Refresh the notes section
            frm.reload_doc();
          }
        },
        freeze: true,
        freeze_message: __("Updating Clinical Note..."),
      });
    },
  });

  dialog.show();
}

function delete_clinical_note(frm, noteName) {
  frappe.confirm(
    __("Are you sure you want to delete this clinical note?"),
    function () {
      frappe.call({
        method:
          "healthcare.healthcare.doctype.inpatient_record.inpatient_record.delete_clinical_note",
        args: {
          name: noteName,
        },
        callback: function (response) {
          if (!response.exc) {
            frappe.msgprint(__("Clinical Note deleted successfully."));

            // Refresh the notes section
            frm.reload_doc();
          }
        },
        freeze: true,
        freeze_message: __("Deleting Clinical Note..."),
      });
    }
  );
}

function create_medical_certificate(frm) {
  // Get patient information
  let patient_data = {
    name: frm.doc.patient,
    patient_name: frm.doc.patient_name,
    sex: frm.doc.gender || "Male",
    gender: frm.doc.gender || "Male",
    encounter_name: frm.doc.name,
  };

  // Load the medical certificate bundle and create dialog
  frappe.require("medical_certificate.bundle.js").then(() => {
    if (window.createMedicalCertificateDialog) {
      window.createMedicalCertificateDialog(patient_data);
    } else {
      frappe.msgprint(__("Medical Certificate component not loaded properly."));
    }
  });
}
