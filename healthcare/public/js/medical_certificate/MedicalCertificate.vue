<template>
  <div>
    <div ref="printableContent" class="medical-certificate-content" style="padding: 20px; font-family: Arial, sans-serif;">
      <div class="header" style="text-align: center; margin-bottom: 30px;">
        <h2>Medical Certificate</h2>
        <p><strong>Date:</strong> {{ currentDate }}</p>
      </div>
      
      <div class="certificate-body" v-html="certificateContent"></div>
      
      <div class="signature-section" style="margin-top: 50px;">
        <p>Doctor's Signature: _________________</p>
        <p>Date: {{ currentDate }}</p>
      </div>
    </div>

    <div class="form-section" style="margin-top: 30px; padding: 20px; border-top: 1px solid #ddd;">
      <div class="form-group" style="margin-bottom: 15px;">
        <label><input type="checkbox" v-model="forLeave"> For leave purposes</label>
      </div>

      <div class="form-group" style="margin-bottom: 15px;">
        <label>Suffering from:</label>
        <input type="text" v-model="MC.suffering" class="form-control" style="width: 100%; padding: 8px; margin-top: 5px;">
      </div>

      <div class="form-group" v-if="!forLeave" style="margin-bottom: 15px;">
        <label>Present condition:</label>
        <input type="text" v-model="MC.present" class="form-control" style="width: 100%; padding: 8px; margin-top: 5px;">
      </div>

      <div class="form-group" style="margin-bottom: 15px;">
        <label>Medical opinion:</label>
        <input type="text" v-model="MC.opinion" class="form-control" style="width: 100%; padding: 8px; margin-top: 5px;">
      </div>

      <div class="form-group" v-if="forLeave" style="margin-bottom: 15px;">
        <label>As from (date):</label>
        <input type="date" v-model="MC.asFrom" class="form-control" style="width: 100%; padding: 8px; margin-top: 5px;">
      </div>

      <div class="form-group" v-if="forLeave" style="margin-bottom: 15px;">
        <label>Duration:</label>
        <input type="text" v-model="MC.duration" placeholder="e.g. 3 days, 1 week" class="form-control" style="width: 100%; padding: 8px; margin-top: 5px;">
      </div>

      <div class="form-group" style="margin-bottom: 15px;">
        <label>Certificate Date:</label>
        <input type="date" v-model="MC.certificateDate" class="form-control" style="width: 100%; padding: 8px; margin-top: 5px;">
      </div>

      <div class="form-actions" style="text-align: right; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" @click="$emit('close')" style="margin-right: 10px;">Cancel</button>
        <button type="button" class="btn btn-primary" @click="saveMedicalCertificate" :disabled="saving">
          {{ saving ? 'Saving...' : 'Save Medical Certificate' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'MedicalCertificate',
  props: {
    patient: {
      type: Object,
      default: () => ({})
    }
  },
  emits: ['close'],
  data() {
    return {
      MC: {
        suffering: '',
        present: '',
        opinion: '',
        asFrom: new Date().toISOString().split('T')[0],
        duration: '',
        certificateDate: new Date().toISOString().split('T')[0]
      },
      forLeave: false,
      saving: false
    }
  },
  computed: {
    currentDate() {
      return new Date(this.MC.certificateDate).toLocaleDateString()
    },
    patientName() {
      return this.patient?.patient_name || this.patient?.name || 'Patient Name'
    },
    patientGender() {
      return this.patient?.sex || this.patient?.gender || 'Male'
    },
    title() {
      return this.patientGender === 'Male' ? 'Mr.' : 'Mrs.'
    },
    pronoun() {
      return this.patientGender === 'Male' ? 'he' : 'she'
    },
    possessive() {
      return this.patientGender === 'Male' ? 'his' : 'her'
    },
    certificateContent() {
      const top = `This is to certify that I have examined <strong>${this.title} ${this.patientName}</strong> and found that ${this.pronoun} is ill, suffering from <strong>${this.MC.suffering}</strong>.<br><br>`
      
      const noLeave = `<span style="text-transform: capitalize;">${this.pronoun}</span> is at present <strong>${this.MC.present}</strong> and in my opinion <strong>${this.MC.opinion}</strong>.`
      
      const leave = `<span style="text-transform: capitalize;">${this.pronoun}</span> is at present unfit to resume work/school and requires in my opinion <strong>${this.MC.opinion}</strong> as from <strong>${this.MC.asFrom}</strong> of rest/treatment to recover from ${this.possessive} health.`
      
      const bottom = this.forLeave ? leave : noLeave
      return top + bottom
    }
  },
  methods: {
    async saveMedicalCertificate() {
      if (!this.MC.suffering || !this.MC.opinion) {
        frappe.msgprint(__('Please fill in all required fields (Suffering from and Medical opinion).'));
        return;
      }

      this.saving = true;

      try {
        // Get the actual patient ID from the inpatient record
        const patientId = this.patient?.name; // This should be the Patient doctype ID
        
        // Debug logging
        console.log('Patient data:', this.patient);
        console.log('Patient ID:', patientId);
        
        if (!patientId) {
          frappe.msgprint(__('Patient information is missing. Please try again.'));
          this.saving = false;
          return;
        }
        
        // Get practitioner - need to find Healthcare Practitioner linked to current user
        let practitioner = null;
        try {
          const practitionerResp = await frappe.call({
            method: 'frappe.client.get_list',
            args: {
              doctype: 'Healthcare Practitioner',
              filters: {
                user_id: frappe.session.user
              },
              fields: ['name']
            }
          });
          if (practitionerResp.message && practitionerResp.message.length > 0) {
            practitioner = practitionerResp.message[0].name;
          }
        } catch (e) {
          console.log('No Healthcare Practitioner found for current user');
        }

        console.log('Practitioner found:', practitioner);

        // Prepare data for Medical Certificate doctype
        const medicalCertificateData = {
          for_leave: this.forLeave ? 1 : 0,
          suffering_from: this.MC.suffering,
          present: this.MC.present,
          opinion: this.MC.opinion,
          as_from: this.forLeave ? this.MC.asFrom : null,
          duration: this.forLeave ? this.MC.duration : null,
          patient: patientId,
          practitioner: practitioner, // Only set if Healthcare Practitioner exists
          date: this.MC.certificateDate,
          consultation: null // Don't link to Inpatient Record directly since it's not a Patient Encounter
        };

        console.log('Medical Certificate data to save:', medicalCertificateData);

        // Create Medical Certificate using Frappe API
        const response = await frappe.call({
          method: 'frappe.client.insert',
          args: {
            doc: {
              doctype: 'Medical Certificate',
              ...medicalCertificateData
            }
          }
        });

        if (response.message) {
          frappe.show_alert({
            message: __('Medical Certificate saved'),
            indicator: 'green'
          });
          
          // Close the dialog
          this.$emit('close');
        }
      } catch (error) {
        console.error('Error saving Medical Certificate:', error);
        frappe.msgprint(__('Error saving Medical Certificate. Please try again.'));
      } finally {
        this.saving = false;
      }
    },

    printCertificate() {
      const printWindow = window.open('', '_blank')
      const printContent = this.$refs.printableContent.outerHTML
      
      printWindow.document.write(`
        <html>
          <head>
            <title>Medical Certificate - ${this.patientName}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              .medical-certificate-content { max-width: 800px; margin: 0 auto; }
              h2 { color: #333; }
              .form-section { display: none; }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
        </html>
      `)
      
      printWindow.document.close()
      printWindow.print()
      printWindow.close()
    }
  }
}
</script>

<style scoped>
.medical-certificate-content {
  border: 1px solid #ddd;
  border-radius: 8px;
  background: white;
}

.form-group label {
  font-weight: bold;
  display: block;
  margin-bottom: 5px;
}

.form-control {
  border: 1px solid #ddd;
  border-radius: 4px;
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
}

.btn-primary {
  background-color: #007bff;
  color: white;
}

.btn-secondary {
  background-color: #6c757d;
  color: white;
}

.btn:hover {
  opacity: 0.9;
}
</style>