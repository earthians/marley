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
    const existingRoot = page.main[0].querySelector("#patient-history-vue");
    if (existingRoot) existingRoot.remove();
    page.main[0].appendChild(root);

    if (!document.getElementById("patient-history-vue-css")) {
        const stylesheet = document.createElement("link");
        stylesheet.id = "patient-history-vue-css";
        stylesheet.rel = "stylesheet";
        stylesheet.href = "/assets/healthcare/patient_history/patient_history.css?v=20261028-1";
        document.head.appendChild(stylesheet);
    }

    const patientField = page.add_field({
        fieldtype: "Link",
        options: "Patient",
        fieldname: "patient",
        label: __("Patient"),
        placeholder: __("Search patient by name or ID"),
        change() {
            state.patient = patientField.get_value() || "";
            if (state.app) state.app.setPatient(state.patient);
            toggleClearButton();
        },
    });
    state.patientField = patientField;

    const clearButton = $(
        `<button type="button" class="ph-patient-clear hide" title="${__("Clear")}" aria-label="${__(
			"Clear patient"
		)}">${frappe.utils.icon("x", "sm")}</button>`
    ).appendTo(patientField.$input.parent());
    const toggleClearButton = () => clearButton.toggleClass("hide", !patientField.$input.val());
    state.toggleClearButton = toggleClearButton;
    patientField.$input.on("input change blur awesomplete-selectcomplete", toggleClearButton);
    clearButton.on("click", () => {
        patientField.set_value("");
        patientField.$input.val("").trigger("focus");
        toggleClearButton();
    });
    page.set_primary_action(__("Open Patient"), () => {
        if (state.patient) frappe.set_route("Form", "Patient", state.patient);
    });
    page.add_menu_item(__("Print"), () => window.print());
};

frappe.pages["patient_history"].on_page_show = function(wrapper) {
    const state = wrapper.patientHistoryState;
    if (!state || state.destroyed) return;
    state.visible = true;
    const routed = frappe.route_options && frappe.route_options.patient;
    if (routed) {
        state.patient = routed;
        state.patientField.set_value(routed).then(state.toggleClearButton);
        delete frappe.route_options.patient;
    }

    function mount() {
        if (state.visible && !state.destroyed && !state.app && window.mountPatientHistory) {
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
    const state = wrapper.patientHistoryState;
    if (!state) return;
    state.visible = false;
    if (state.app) state.app.unmount();
    state.app = null;
};

frappe.pages["patient_history"].on_page_destroy = function(wrapper) {
    const state = wrapper.patientHistoryState;
    if (!state) return;
    state.destroyed = true;
    if (state.app) state.app.unmount();
    state.app = null;
};