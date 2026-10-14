import { createApp, reactive } from "vue";
import PatientHistory from "./PatientHistory.vue";
import { api } from "./api";
import { auditPatientHistoryOverflow } from "./utils/audit-overflow";
import "../../../../healthcare/healthcare/page/patient_history/patient_history.css";
import "./styles.css";

let app;
let context;
if (import.meta.env.DEV) window.auditPatientHistoryOverflow = auditPatientHistoryOverflow;
window.mountPatientHistory = function mountPatientHistory(target, initial = {}) {
  app?.unmount();
  context = reactive({ patient: initial.patient || "", currentUser: initial.currentUser || "", api });
  app = createApp(PatientHistory);
  app.config.globalProperties.__ = (...args) => window.__(...args);
  app.config.globalProperties.moment = window.moment;
  app.config.globalProperties.frappe = window.frappe;
  app.provide("patientHistory", context);
  app.mount(target);
  return {
    setPatient(patient) { if (context) context.patient = patient || ""; },
    unmount() { app?.unmount(); app = null; context = null; },
  };
};
