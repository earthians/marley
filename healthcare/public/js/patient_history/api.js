const methods = {
  getFeed: "healthcare.healthcare.page.patient_history.patient_history.get_feed",
  getFeedCount: "healthcare.healthcare.page.patient_history.patient_history.get_feed_count",
  getActivitySummary: "healthcare.healthcare.page.patient_history.patient_history.get_activity_summary",
  getActivityYears: "healthcare.healthcare.page.patient_history.patient_history.get_activity_years",
  getDoctypes: "healthcare.healthcare.page.patient_history.patient_history.get_patient_history_doctypes",
  getVitals: "healthcare.healthcare.utils.get_patient_vitals",
  getPatient: "frappe.client.get",
  getPatientDetail: "healthcare.healthcare.doctype.patient.patient.get_patient_detail",
  renderDocAsHtml: "healthcare.healthcare.utils.render_doc_as_html",
};

function call(method, args = {}) {
  return new Promise((resolve, reject) => frappe.call({
    method,
    args,
    callback: response => resolve(response?.message),
    error: error => reject(error || new Error(__("Request failed"))),
  }));
}

export const api = {
  getFeed: args => call(methods.getFeed, args),
  getFeedCount: args => call(methods.getFeedCount, args),
  getActivitySummary: args => call(methods.getActivitySummary, args),
  getActivityYears: patient => call(methods.getActivityYears, { patient }),
  getDoctypes: () => call(methods.getDoctypes),
  getVitals: patient => call(methods.getVitals, { patient }),
  getPatient: patient => call(methods.getPatient, { doctype: "Patient", name: patient }),
  getPatientDetail: patient => call(methods.getPatientDetail, { patient }),
  renderDocAsHtml: (doctype, docname) => call(methods.renderDocAsHtml, {
    doctype, docname, exclude_fields: ["patient", "patient_name", "patient_sex", "encounter_date", "naming_series"],
  }),
};
