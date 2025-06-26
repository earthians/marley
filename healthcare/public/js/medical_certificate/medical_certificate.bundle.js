import { createApp } from 'vue';
import MedicalCertificate from './MedicalCertificate.vue';

// Global function to create medical certificate dialog
window.createMedicalCertificateDialog = function(patient_data) {
  const dialog = new frappe.ui.Dialog({
    title: __("Create Medical Certificate"),
    fields: [
      {
        fieldname: "mc_vue_wrapper",
        fieldtype: "HTML",
        options: '<div id="mc-vue-app"></div>'
      }
    ],
    size: 'large',
    primary_action_label: __("Close"),
    primary_action: function() {
      dialog.hide();
    }
  });

  dialog.show();

  // Mount Vue component after dialog is shown
  setTimeout(() => {
    const wrapper = dialog.fields_dict.mc_vue_wrapper.$wrapper.find('#mc-vue-app')[0];
    
    if (wrapper) {
      const app = createApp(MedicalCertificate, {
        patient: patient_data,
        onClose: () => dialog.hide()
      });
      
      app.mount(wrapper);
      
      // Store app instance for cleanup
      dialog.vue_app = app;
      
      // Cleanup when dialog is hidden
      dialog.$wrapper.on('hidden.bs.modal', function() {
        if (dialog.vue_app) {
          dialog.vue_app.unmount();
        }
      });
    }
  }, 100);

  return dialog;
};

// Export for module use
export { MedicalCertificate };