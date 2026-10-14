frappe.provide("frappe.pages");
frappe.pages["patient_history"].on_page_load = function(wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Patient History"),
        single_column: true,
    });
    const page = wrapper.page;
    const state = (wrapper.patientHistoryState = {
        patient: "",
        app: null,
        loading: false,
        bundleLoaded: false,
        visible: false,
        destroyed: false,
    });
    const root = document.createElement("div");
    state.root = root;
    root.id = "patient-history-vue";
    page.main[0].replaceChildren(root);

    if (!document.getElementById("patient-history-vue-css")) {
        const stylesheet = document.createElement("link");
        stylesheet.id = "patient-history-vue-css";
        stylesheet.rel = "stylesheet";
        stylesheet.href =
            "/assets/healthcare/patient_history/patient_history.css?v=20261014-14";
        document.head.appendChild(stylesheet);
    }

    const patientField = page.add_field({
        fieldtype: "Link",
        options: "Patient",
        fieldname: "patient",
        label: __("Patient"),
        change() {
            state.patient = patientField.get_value() || "";
            state.app?.setPatient(state.patient);
        },
    });
    state.patientField = patientField;
    page.set_primary_action(__("Open Patient"), () => {
        if (state.patient) frappe.set_route("Form", "Patient", state.patient);
    });
    page.add_menu_item(__("Print"), () => window.print());
};

frappe.pages["patient_history"].on_page_show = function(wrapper) {
    const state = wrapper.patientHistoryState;
    if (!state || state.destroyed) return;
    state.visible = true;
    const routed = frappe.route_options?.patient;
    if (routed) {
        state.patient = routed;
        state.patientField.set_value(routed);
        delete frappe.route_options.patient;
    }

    function mount() {
        if (
            state.visible &&
            !state.destroyed &&
            !state.app &&
            window.mountPatientHistory
        ) {
            state.app = window.mountPatientHistory(state.root, {
                patient: state.patient,
                currentUser: frappe.session.user,
            });
        }
    }
    if (state.bundleLoaded) {
        mount();
        return;
    }
    if (state.loading) return;
    state.loading = true;
    frappe.require("/assets/healthcare/patient_history/patient_history.js", () => {
        state.loading = false;
        state.bundleLoaded = true;
        mount();
    });
};

frappe.pages["patient_history"].on_page_hide = function(wrapper) {
    if (wrapper.patientHistoryState) wrapper.patientHistoryState.visible = false;
    wrapper.patientHistoryState?.app?.unmount();
    if (wrapper.patientHistoryState) wrapper.patientHistoryState.app = null;
};

frappe.pages["patient_history"].on_page_destroy = function(wrapper) {
    const state = wrapper.patientHistoryState;
    if (!state) return;
    state.destroyed = true;
    state.app?.unmount();
    state.app = null;
};
