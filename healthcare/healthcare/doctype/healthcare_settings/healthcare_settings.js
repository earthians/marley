// Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Healthcare Settings', {
	refresh(frm) {
		if (!frappe.user.has_role('System Manager') && !frappe.user.has_role('Healthcare Administrator')) {
			return;
		}

		// Legacy import / analysis buttons stay in this file for reference but are
		// no longer rendered: Direct Upload, Migration Analysis and ECT are hidden.
		hide_legacy_setting_buttons(frm);

		// Patients: PATIENT_INFO_01 → Patient. Creates missing file numbers;
		// when a file number is already taken, matches on name + id number
		// before updating, and reports identity conflicts.
		frm.add_custom_button(
			__('Patients'),
			() => open_patient_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Insurance Patient Register from INSURANCE_00_01 patients (TRICARE).
		// Creates missing registers and marks patients insured.
		frm.add_custom_button(
			__('Insurance Register'),
			() => open_insurance_register_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Compare Oracle IP_ADMISSION_01 with Inpatient Admission and create only
		// the admissions Oracle has that ERPNext is still missing. The dialog
		// asks whether to read Oracle live or from an Excel export of the table.
		frm.add_custom_button(__('IP Admission'), () => {
			open_oracle_ip_admission(frm);
		}, __('Oracle -> ERPNext'));

		// Compare Oracle VISIT_00_01 with Patient Visit and create only the
		// visits Oracle has that ERPNext is still missing. Visits that exist
		// only in ERPNext are left alone.
		frm.add_custom_button(__('OP Visit'), () => {
			open_oracle_op_visit(frm);
		}, __('Oracle -> ERPNext'));

		// Daily Auto Visit setup: DAILY_PATIENTS_01 → Daily Patient Visit Setup
		// and DAILY_PATIENTS_02 → Patient Visit (Daily Auto Visit). Matches on
		// TRANS_NUM / INV_NUM and also patient + from/encounter date.
		frm.add_custom_button(
			__('Daily Patient Visit Setup'),
			() => open_daily_patient_visit_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Cleanup IP Admission'),
			() => open_ip_admission_cleanup(frm),
			__('Oracle -> ERPNext')
		);

		// One button for every prescription (OP + IP + HIS): it reads the legacy
		// prescriptions - live from Oracle or from the three uploaded Excel
		// exports - repairs what is missing and imports
		// PATIENT_VISIT_PRESCRIPTION_HIS as transactions (deduplicate lines kept
		// and flagged), in the background, for the whole site.
		frm.add_custom_button(
			__('Reconcile Prescriptions'),
			() => open_prescription_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// One button for the long-acting / depot register: it reads VISIT_00_04
		// (live or from its Excel export), appends the injections ERPNext is
		// missing, extends the end date and recalculates the next dose date, in
		// the background.
		frm.add_custom_button(
			__('Reconcile Long Acting Medicine'),
			() => open_long_acting_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Clinical Notes: Oracle OP diagnosis (VISIT_00_01), OP history
		// (VISIT_00_01_HISTORY) and IP notes (IP_ADMISSION_DIAGNOSES), read live
		// or from their Excel exports. Creates missing Doctor Progress Notes,
		// then merges duplicate OP visit notes left by earlier re-imports.
		frm.add_custom_button(
			__('Clinical Notes'),
			() => open_clinical_note_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// VISIT_00_01_HISTORY staging doctype: create only the history rows
		// Oracle has that ERPNext is still missing (same record key as the import).
		frm.add_custom_button(
			__('Visit History'),
			() => open_visit_history_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Nursing Notes: the IP shift notes (IP_NURSING), read live or from
		// their Excel export. Creates the Main Nursing Notes ERPNext is missing
		// - the tail the last workbook import never reached and the rows whose
		// trans number an app note of another admission took (created as
		// <trans>-N, so the live note is never touched).
		frm.add_custom_button(
			__('Nursing Notes'),
			() => open_nursing_note_reconcile(frm),
			__('Oracle -> ERPNext')
		);
		// Warning Messages: the legacy patient warnings / allergies
		// (PATIENT_WARNING_MESSAGES), read live or from their Excel export.
		// Creates the warnings ERPNext is missing - an app record that owns the
		// number is kept and the legacy row is created as <num>-W - fills the
		// blanks Oracle knows about and merges duplicate copies of a warning.
		frm.add_custom_button(
			__('Warning Messages'),
			() => open_warning_message_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Allergies: free-text on Patient (ALLERGIES_HISTORY) and Patient Visit
		// (VISIT_ALLERGIES_HISTORY) → Warning Message with is_allergy ticked.
		// Separate from Warning Messages (which only reads PATIENT_WARNING_MESSAGES).
		frm.add_custom_button(
			__('Allergies'),
			() => open_allergy_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Lab Tests: the legacy lab headers (LAB_00_03) and their result rows
		// (LAB_00_04), read live or from their Excel exports. Creates the lab
		// tests ERPNext is missing, fills the blanks Oracle knows about and
		// merges copies of the same lab order the app created on its own.
		frm.add_custom_button(
			__('Lab Tests'),
			() => open_lab_test_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Observations: IP_OBSERVATION_LEVEL → Observation. Creates missing rows,
		// fills blanks Oracle knows about, merges duplicate copies of the same order.
		frm.add_custom_button(
			__('Observations'),
			() => open_observation_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Vital Signs: IP_PATIENT_VITALS → Vital Signs. Creates only what ERPNext
		// is missing; same date + same readings on the admission are skipped
		// (double-entry from ~2 Jul onwards).
		frm.add_custom_button(
			__('Vital Signs'),
			() => open_vital_signs_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Physical Examination: IP_ADMISSION_PHY_EXAM → Physical Examination.
		// Same create-missing / skip same-content pattern as Nursing Notes.
		frm.add_custom_button(
			__('Physical Examination'),
			() => open_physical_examination_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('IP Grooming Chart'),
			() => open_grooming_chart_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('IP Mental State'),
			() => open_mental_state_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('IP Admission Transfer'),
			() => open_admission_transfer_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Medical Diagnosis Entry: VISIT_DIAGNOSES_01 only.
		// IP_ADMISSION_DIAGNOSES is a Clinical Note, not a diagnosis entry.
		frm.add_custom_button(
			__('Medical Diagnosis Entry'),
			() => open_medical_diagnosis_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Morse Fall Scale'),
			() => open_morse_fall_scale_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Patient Assessment'),
			() => open_patient_assessment_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Medicine Given'),
			() => open_medicine_given_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Pharmacy dispensed medicine (INV_00_01 + INV_00_02, SAL IP/OP only).
		frm.add_custom_button(
			__('Legacy Sales / Pharmacy Dispensed'),
			() => open_legacy_sales_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Appointments'),
			() => open_appointment_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// One folder of patient images. The file name starts with the file number.
		// SIGN is a signature, CPR FRONT / CPR BACK are the CPR photos. A photo
		// already on the patient is left as it is.
		frm.add_custom_button(
			__('CPR and Signatures'),
			() => open_patient_image_reconcile(),
			__('Oracle -> ERPNext')
		);

		// Patient documents from the nested Patient_Documents_PDF folder.
		// manifest_final.csv is the index. Old OCR Legacy Visit Documents are removed first.
		frm.add_custom_button(
			__('Patient Documents'),
			() => open_patient_document_manifest(),
			__('Oracle -> ERPNext')
		);

		// ECT Details: ECT_00_01 (+ ECT_00_02 attributes) → ECT Details.
		frm.add_custom_button(
			__('ECT Details'),
			() => open_ect_details_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Session Schedule: VISIT_00_05 → Session Schedule (OP sessions).
		frm.add_custom_button(
			__('Session Schedule'),
			() => open_session_schedule_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Patient History'),
			() => open_patient_history_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Discharge'),
			() => open_discharge_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		frm.add_custom_button(
			__('Insurance Claims'),
			() => open_insurance_claim_reconcile(frm),
			__('Oracle -> ERPNext')
		);

		// Legacy users (Oracle USR_00_01), read live or from its Excel export.
		// Every legacy table stores the person in CR_ID / UP_ID as USR_NUM - the
		// numbers, not the names - so importing this table is what lets a CR ID /
		// CUP ID be shown as the user's name.
		frm.add_custom_button(__('User'), () => open_oracle_user_upload(), __('Oracle -> ERPNext'));

		// Repeated backfills stored the same words on the same transaction under a new
		// trans number every time. This merges such copies into one note (every trans
		// number stays on the surviving note) and deletes the rest.
		frm.add_custom_button(
			__('Merge Duplicate Clinical Notes'),
			() => open_clinical_note_duplicates(frm),
			__('Data Maintenance')
		);

		frm.add_custom_button(__('Generate Doctors Stamp'), () => {
			frappe.call({
				method: 'healthcare.api.practitioner_stamp.preview_generate_doctors_stamps',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Generate a Doctors Stamp for every Healthcare Practitioner?\n\nPractitioners: {0}\nWith licence no: {1}\n\nEach stamp is Hospital, Name, Role, and License No. (same layout as the Serene practitioner stamps). Existing stamp attachments are replaced. Continue?',
							[counts.candidates || 0, counts.with_licence || 0]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.practitioner_stamp.generate_all_practitioner_stamps',
								freeze: true,
								freeze_message: __('Generating doctors stamps…'),
								callback(r) {
									const msg = r.message || {};
									frappe.msgprint({
										title: __('Doctors Stamp'),
										indicator: msg.errors ? 'orange' : 'green',
										message: msg.message || __('Done'),
									});
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Generate Discharge Stamp'), () => {
			frappe.confirm(
				__(
					'Generate the Discharge Stamp (red “DISCHARGED” rubber stamp) and attach it to Healthcare Settings → Discharge Stamp?\n\nAny existing discharge stamp attachment will be replaced. Continue?'
				),
				() => {
					frappe.call({
						method: 'healthcare.api.discharge_stamp.generate_discharge_stamp',
						freeze: true,
						freeze_message: __('Generating discharge stamp…'),
						callback(r) {
							const msg = r.message || {};
							frappe.msgprint({
								title: __('Discharge Stamp'),
								indicator: 'green',
								message: msg.message || __('Done'),
							});
							frm.reload_doc();
						},
					});
				}
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Migrate Patients (Category & Customer Group)'), () => {
			frappe.confirm(
				__(
					'Run in background: American Navy → Military, Royal → VIP, blank → Regular; All Customer Groups → Patient. Continue?'
				),
				() => run_migration_job(frm, 'start_patient_migration', 'patients')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Sync Customer Group from Category'), () => {
			frappe.confirm(
				__(
					'Run in background: for each Patient with a Category, set Customer Group to the same name (create the Customer Group if missing) and update the linked Customer. Patients without a category are skipped. Continue?'
				),
				() =>
					run_migration_job(
						frm,
						'start_patient_category_customer_group_sync',
						'patient_category_customer_group'
					)
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Sync Customer File No Field'), () => {
			frappe.call({
				method: 'healthcare.api.patient_customer_file_no_sync.preview_patient_customer_file_no_sync',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map(
							(row) =>
								`${row.patient} / Customer “${row.customer}”: “${row.from_value}” → “${row.to_value}”`
						)
						.join('\n');
					frappe.confirm(
						__(
							'Run in background: copy each Patient File No into the linked Customer field '
							+ '“Patient File No” (custom_patient_file_no). This does not rename the Customer ID.\n\n'
							+ 'Patients with customer: {0}\n'
							+ 'Customers to update: {1}\n'
							+ 'Already correct: {2}\n'
							+ 'Skipped (no File No): {3}\n\n'
							+ 'Sample:\n{4}\n\nContinue?',
							[
								counts.patients_with_customer || 0,
								counts.needs_update || 0,
								counts.skipped_ok || 0,
								counts.skipped_no_file_no || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.patient_customer_file_no_sync.start_patient_customer_file_no_sync',
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('patient_customer_file_no_sync');
									}
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Sync Customer ID to File No (merge)'), () => {
			frappe.call({
				method: 'healthcare.api.patient_customer_name_sync.preview_patient_customer_name_sync',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map(
							(row) =>
								`${row.action || 'rename'}: ${row.patient}: Customer ID “${row.from_id}” → “${row.to_id}”`
								+ (row.from_name && row.from_name !== row.from_id
									? ` (name was “${row.from_name}”)`
									: '')
						)
						.join('\n');
					frappe.confirm(
						__(
							'Run in background: rename each linked Customer document ID to the Patient File No '
							+ '(or ID Number if File No is empty). Customer Name is set to the same value, '
							+ 'and custom_patient_file_no is filled.\n\n'
							+ 'If a Customer with that File No already exists (and is not another patient’s), '
							+ 'ERPNext merge is used so invoices, orders, payments, and other links stay on the patient.\n\n'
							+ 'Patients with customer: {0}\n'
							+ 'Simple renames: {1}\n'
							+ 'Merges into existing File No customer: {2}\n'
							+ 'Name-only fixes: {3}\n'
							+ 'Skipped (no File No / ID): {4}\n'
							+ 'Skipped (File No used by another patient): {5}\n\n'
							+ 'Sample:\n{6}\n\nContinue?',
							[
								counts.patients_with_customer || 0,
								counts.needs_rename || 0,
								counts.needs_merge || 0,
								counts.needs_name_only || 0,
								counts.skipped_no_id || 0,
								counts.skipped_conflict || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.patient_customer_name_sync.start_patient_customer_name_sync',
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('patient_customer_name_sync');
									}
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Update Patient Nationality'), () => {
			frappe.call({
				method: 'healthcare.api.patient_nationality_sync.preview_patient_nationality_sync',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map((row) => `${row.patient}: code "${row.code}" → nationality "${row.to}"${row.from ? ` (was "${row.from}")` : ''}`)
						.join('\n');
					frappe.confirm(
						__(
							'Run in background: for each Patient with a pat_nationality code, match it against the Nationality doctype code and set the Patient nationality (link) field.\n\n'
							+ 'Patients with a code: {0}\nTo update: {1}\nAlready correct: {2}\nCode not found in Nationality: {3}\nNationality records with a code: {4}\n\n'
							+ 'Sample:\n{5}\n\nContinue?',
							[
								counts.patients_with_code || 0,
								counts.needs_update || 0,
								counts.skipped_already_ok || 0,
								counts.skipped_unmatched || 0,
								counts.nationality_count || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.patient_nationality_sync.start_patient_nationality_sync',
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('patient_nationality_sync');
									}
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Update Patient Category'), () => {
			frappe.call({
				method: 'healthcare.api.patient_category_from_major_type.preview_patient_category_from_major_type',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map((row) => `${row.patient}: Pat Major Type "${row.pat_major_type}" → Category "${row.to}"${row.from ? ` (was "${row.from}")` : ''}`)
						.join('\n');
					frappe.confirm(
						__(
							'Run in background: set Patient Category from Pat Major Type.\n\n'
							+ 'A → Military\nN → Regular\nR → VIP\n\n'
							+ 'Patients with Pat Major Type: {0}\n'
							+ 'A (Military): {1}\nN (Regular): {2}\nR (VIP): {3}\nOther / unknown: {4}\n\n'
							+ 'To update: {5}\nAlready correct: {6}\nUnmatched type: {7}\n\n'
							+ 'Sample:\n{8}\n\nContinue?',
							[
								counts.patients_with_code || 0,
								counts.count_A_military || 0,
								counts.count_N_regular || 0,
								counts.count_R_vip || 0,
								counts.count_other || 0,
								counts.needs_update || 0,
								counts.skipped_already_ok || 0,
								counts.skipped_unmatched || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.patient_category_from_major_type.start_patient_category_from_major_type',
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('patient_category_from_major_type');
									}
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Delete Legacy-Duplicate Lab Requests'), () => {
			frappe.call({
				method: 'healthcare.api.service_request.preview_delete_legacy_duplicate_lab_service_requests',
				args: { cutoff_date: '2026-11-01' },
				freeze: true,
				freeze_message: __('Scanning lab Service Requests…'),
				callback(preview) {
					const data = preview.message || {};
					const sample = (data.sample || [])
						.map((row) => {
							const labs = row.app_lab_tests ? ` → LT: ${row.app_lab_tests}` : '';
							const so = row.sales_order ? ` · SO: ${row.sales_order}` : '';
							return `${row.service_request} | ${row.order_date} | ${row.patient_name || '—'} | codes: ${row.overlapping_codes || '—'}${labs}${so}`;
						})
						.join('\n');
					frappe.confirm(
						__(
							'Delete non-legacy lab Service Requests that match a legacy Lab Test '
							+ '(same patient + same day + almost-same test codes).\n\n'
							+ 'For each match this will:\n'
							+ '• delete linked app Lab Tests (LT-…)\n'
							+ '• cancel/delete linked Sales Order\n'
							+ '• remove lab rows on Patient Visit (visit is kept)\n'
							+ '• delete the Service Request\n'
							+ 'Legacy LAB/… tests are NOT deleted.\n\n'
							+ 'Only order_date on or before {0}. Later dates are left for you.\n\n'
							+ 'Matched: {1}\n\n'
							+ 'Sample:\n{2}\n\nContinue?',
							[data.cutoff_date || '2026-11-01', data.count || 0, sample || __('(none)')]
						),
						() => {
							if (!(data.count > 0)) {
								frappe.show_alert({ message: __('Nothing to delete'), indicator: 'blue' });
								return;
							}
							frappe.call({
								method: 'healthcare.api.service_request.delete_legacy_duplicate_lab_service_requests',
								args: { cutoff_date: data.cutoff_date || '2026-11-01' },
								freeze: true,
								freeze_message: __('Deleting duplicate lab Service Requests…'),
								callback(r) {
									const result = r.message || {};
									const err_count = (result.errors || []).length;
									frappe.msgprint({
										title: __('Legacy-duplicate lab cleanup'),
										indicator: err_count ? 'orange' : 'green',
										message: __(
											'Matched: {0}<br>Deleted: {1}<br>Errors: {2}',
											[result.matched || 0, result.deleted_count || 0, err_count]
										),
									});
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Delete Duplicate Unlinked Customers'), () => {
			frappe.call({
				method: 'healthcare.api.patient_customer_dedupe.preview_patient_customer_dedupe',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map(
							(row) =>
								`Delete “${row.customer}” (${row.customer_name}) — keep “${row.keep_customer}” (Patient ${row.keep_patient})`
						)
						.join('\n');
					frappe.confirm(
						__(
							'Analyze Customers with the same full name. When at least one of those '
							+ 'Customers is linked to a Patient, delete the other(s) that are not linked '
							+ 'to any Patient. The patient-linked Customer is always kept.\n\n'
							+ 'Customers that are not duplicates of a patient-linked name '
							+ '(e.g. Default Customer) are left alone.\n'
							+ 'Customers with invoices / payments / other links are skipped, not force-deleted.\n\n'
							+ 'Duplicate name groups: {0}\n'
							+ 'Groups with a patient-linked Customer: {1}\n'
							+ 'Groups skipped (no patient link): {2}\n'
							+ 'Unlinked duplicates to delete: {3}\n'
							+ 'Patient-linked Customers kept: {4}\n\n'
							+ 'Sample:\n{5}\n\nContinue?',
							[
								counts.duplicate_name_groups || 0,
								counts.groups_with_patient_link || 0,
								counts.groups_skipped_no_patient_link || 0,
								counts.to_delete || 0,
								counts.kept_linked || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.patient_customer_dedupe.start_patient_customer_dedupe',
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('patient_customer_dedupe');
									}
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Update Session Schedule Price'), () => {
			frappe.call({
				method: 'healthcare.api.session_schedule.preview_update_session_schedule_prices',
				freeze: true,
				freeze_message: __('Scanning Session Schedules…'),
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map(
							(row) =>
								`${row.name}: ${row.session_type || '—'} (${row.care_type || '?'}) → ${row.amount}`
						)
						.join('\n');
					frappe.confirm(
						__(
							'Update Session Schedule amounts that are still 0.\n\n'
							+ 'Only Draft (not Completed) schedules with a Healthcare Service Template.\n'
							+ 'IP (admission) → template rate. OP (patient visit) → OP rate (else rate).\n\n'
							+ 'Draft with amount 0: {0}\n'
							+ 'Will update: {1}\n'
							+ 'Skipped (no IP/OP rate on template): {2}\n'
							+ 'Skipped (no care type / template): {3}\n\n'
							+ 'Sample:\n{4}\n\nContinue?',
							[
								counts.candidates || 0,
								counts.to_update || 0,
								counts.skipped_no_rate || 0,
								counts.skipped_other || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.session_schedule.update_session_schedule_prices',
								freeze: true,
								freeze_message: __('Updating Session Schedule prices…'),
								callback(r) {
									const m = r.message || {};
									frappe.msgprint({
										title: __('Session Schedule Prices'),
										indicator: m.updated ? 'green' : 'orange',
										message: (m.message || __('Done.')).replace(/\n/g, '<br>'),
									});
								},
							});
						}
					);
				},
			});
		}, __('Update'));

		frm.add_custom_button(__('Fix Legacy Lab Test Cost Center 10'), () => {
			frappe.call({
				method: 'healthcare.api.lab_test_cost_center_fix.preview_fix_legacy_lab_test_cost_center_10',
				freeze: true,
				freeze_message: __('Scanning legacy Lab Tests…'),
				callback(preview) {
					const data = preview.message || {};
					const sample = (data.sample || [])
						.map(
							(row) =>
								`${row.name} | ${row.date || '—'} | ${row.patient_name || '—'} | ${row.lab_test_name || '—'}`
						)
						.join('\n');
					frappe.confirm(
						__(
							'Some legacy Lab Tests still have cost center “{0}” '
							+ '(Oracle BRANCH_NUM) instead of “{1}”.\n\n'
							+ 'This will frappe.db.set_value cost_center on those legacy imports only.\n\n'
							+ 'Will update: {2}\n\n'
							+ 'Sample:\n{3}\n\nContinue?',
							[
								data.from_cost_center || '10',
								data.to_cost_center || 'British Medical Center W.L.L - SPH',
								data.count || 0,
								sample || __('(none)'),
							]
						),
						() => {
							if (!(data.count > 0)) {
								frappe.show_alert({ message: __('Nothing to update'), indicator: 'blue' });
								return;
							}
							frappe.call({
								method: 'healthcare.api.lab_test_cost_center_fix.fix_legacy_lab_test_cost_center_10',
								freeze: true,
								freeze_message: __('Updating Lab Test cost centres…'),
								callback(r) {
									const m = r.message || {};
									frappe.msgprint({
										title: __('Legacy Lab Test Cost Center'),
										indicator: m.updated_count ? 'green' : 'orange',
										message: (m.message || __('Done.')).replace(/\n/g, '<br>'),
									});
								},
							});
						}
					);
				},
			});
		}, __('Update'));

		frm.add_custom_button(__('Unlink Mismatched Customer Employees'), () => {
			frappe.call({
				method:
					'healthcare.api.customer_employee_cleanup.preview_cleanup_mismatched_customer_employees',
				freeze: true,
				freeze_message: __('Scanning Customers with Employee links…'),
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.rows || [])
						.slice(0, 20)
						.map((row) => {
							const patient = row.patient ? ` · Patient ${row.patient}` : '';
							return `${row.customer}: "${row.customer_name || ''}" ≠ Employee ${
								row.employee || '—'
							} ("${row.employee_name || ''}")${patient}`;
						})
						.join('\n');
					frappe.confirm(
						__(
							'Customers sometimes get an Employee link (custom_employee) even though they are only patients — e.g. the receptionist’s Employee was stamped by mistake.\n\n'
							+ 'This removes the Employee link when the Customer name does not match the Employee name (or the Employee no longer exists).\n'
							+ 'Matching Employee Customers (staff billing) are kept.\n\n'
							+ 'Customers with Employee set: {0}\n'
							+ 'Will unlink: {1}\n'
							+ 'Keep (names match): {2}\n'
							+ 'Errors: {3}\n\n'
							+ 'Sample:\n{4}\n\nContinue?',
							[
								counts.scanned || 0,
								counts.unlinked || 0,
								counts.kept || 0,
								counts.errors || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method:
									'healthcare.api.customer_employee_cleanup.cleanup_mismatched_customer_employees',
								args: { dry_run: 0 },
								freeze: true,
								freeze_message: __('Unlinking mismatched Employee links…'),
								callback(r) {
									const m = r.message || {};
									const doneSample = (m.rows || [])
										.slice(0, 15)
										.map(
											(row) =>
												`${row.customer}: cleared Employee ${row.employee || '—'}`
										)
										.join('<br>');
									frappe.msgprint({
										title: __('Customer Employees'),
										indicator: m.unlinked ? 'green' : 'orange',
										message: __(
											'Scanned {0}. Unlinked {1}. Kept {2}. Errors {3}.{4}',
											[
												m.scanned || 0,
												m.unlinked || 0,
												m.kept || 0,
												m.errors || 0,
												doneSample ? `<br><br>${doneSample}` : '',
											]
										),
									});
								},
							});
						}
					);
				},
			});
		}, __('Update'));

		frm.add_custom_button(__('Expire Long Acting Medicine (past End Date)'), () => {
			frappe.call({
				method: 'healthcare.api.long_acting_medicine_expire.preview_long_acting_medicine_expire',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map(
							(row) =>
								`${row.name}: ${row.patient || '—'} · status ${row.status} · end ${row.end_date}`
						)
						.join('\n');
					frappe.confirm(
						__(
							'Scan Long Acting Medicine records.\n\n'
							+ 'When End Date is set and today is after that End Date '
							+ '(End Date before {0}), set Status to Inactive '
							+ '(Draft / Active / Paused only; Completed stays Completed).\n\n'
							+ 'Records to update: {1}\n\n'
							+ 'Sample:\n{2}\n\nContinue?',
							[
								counts.as_of || '',
								counts.to_update || 0,
								sample || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.long_acting_medicine_expire.start_long_acting_medicine_expire',
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('long_acting_medicine_expire');
									}
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Fix Long Acting Frequency (Weekly → PMO)'), () => {
			const dialog = new frappe.ui.Dialog({
				title: __('Fix Long Acting Frequency'),
				fields: [
					{
						fieldtype: 'HTML',
						options:
							'<p class="text-muted">'
							+ __(
								'Find Long Acting Medicine records saved as Weekly in this date range '
								+ 'and set Frequency from the linked Patient Medication Order line '
								+ '(long acting frequency, or the prescription frequency on that line).'
							)
							+ '</p>',
					},
					{
						fieldname: 'from_date',
						label: __('From Date'),
						fieldtype: 'Date',
						reqd: 1,
					},
					{
						fieldname: 'to_date',
						label: __('To Date'),
						fieldtype: 'Date',
						reqd: 1,
					},
				],
				primary_action_label: __('Preview & Run'),
				primary_action(values) {
					if (values.from_date > values.to_date) {
						frappe.msgprint({
							title: __('Invalid date range'),
							message: __('From Date must be on or before To Date.'),
							indicator: 'orange',
						});
						return;
					}
					frappe.call({
						method: 'healthcare.api.long_acting_frequency_fix.preview_long_acting_frequency_fix',
						args: {
							from_date: values.from_date,
							to_date: values.to_date,
						},
						freeze: true,
						freeze_message: __('Checking Long Acting Medicine records…'),
						callback(preview) {
							const counts = preview.message || {};
							const sample = (counts.sample || [])
								.map(
									(row) =>
										`${row.name}: ${row.patient || '—'} · ${row.from_frequency} → ${row.to_frequency}`
										+ (row.pmo ? ` (PMO ${row.pmo})` : '')
										+ (row.match_via ? ` [${row.match_via}]` : '')
								)
								.join('\n');
							frappe.confirm(
								__(
									'Update Long Acting Medicine records dated {0} to {1} that were saved as Weekly.\n\n'
									+ 'Match order: (1) PMO line linked on the LAM medication row, '
									+ '(2) frequency on that LAM line, '
									+ '(3) same patient + same drug on a prescription, '
									+ '(4) same patient, closest date.\n'
									+ 'PMO text such as “every 2 weeks” / Q2W is stored as Biweekly.\n\n'
									+ 'Weekly in range: {2}\n'
									+ 'Will update: {3}\n'
									+ 'Skipped (no non-Weekly frequency on the prescription): {4}\n\n'
									+ 'Sample:\n{5}\n\nContinue? This updates immediately.',
									[
										counts.from_date,
										counts.to_date,
										counts.weekly_in_range || 0,
										counts.will_update || 0,
										counts.skipped_no_source || 0,
										sample || __('(none)'),
									]
								),
								() => {
									frappe.call({
										method:
											'healthcare.api.long_acting_frequency_fix.start_long_acting_frequency_fix',
										args: {
											from_date: values.from_date,
											to_date: values.to_date,
										},
										freeze: true,
										freeze_message: __('Updating Long Acting Medicine frequencies…'),
										callback(r) {
											const res = r.message || {};
											if (res.ok) {
												dialog.hide();
												frappe.msgprint({
													title: __('Long Acting Frequency Fix'),
													message: res.message || __('Done'),
													indicator: res.errors ? 'orange' : 'green',
												});
											}
										},
									});
								}
							);
						},
					});
				},
			});
			dialog.show();
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Discharge Scheduled Admissions'), () => {
			frappe.confirm(
				__(
					'Run in background: set all Inpatient Admissions with status “Admission Scheduled” to “Discharged”. This may take a long time for large datasets. Continue?'
				),
				() => run_migration_job(frm, 'start_admission_migration', 'admissions')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Submit All Draft Discharges'), () => {
			frappe.confirm(
				__(
					'Run in background: submit all draft Discharge documents. Each submit updates the linked Inpatient Admission to Discharged. Rows that fail validation (nursing checklist, billing, open service requests, etc.) are logged and skipped. Continue?'
				),
				() => run_migration_job(frm, 'start_discharge_submit_migration', 'discharges')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Submit Visits & Mark Completed'), () => {
			frappe.confirm(
				__(
					'Run in background: submit all draft Patient Visits, then set status to Completed. Already-submitted visits that are not Completed will also be marked Completed. Rows that fail validation are logged and skipped. Continue?'
				),
				() => run_migration_job(frm, 'start_patient_visit_migration', 'patient_visits')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Close All Appointments'), () => {
			frappe.confirm(
				__(
					'Run in background: set all Patient Appointments (except Cancelled) to Closed. Continue?'
				),
				() => run_migration_job(frm, 'start_appointment_close_migration', 'appointments')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Update Appointments from Oracle Excel'), () => {
			const uploader = new frappe.ui.FileUploader({
				dialog_title: __('Oracle Appointments Excel'),
				allow_multiple: false,
				restrictions: {
					allowed_file_types: ['.xlsx', '.xls'],
				},
				on_success(file) {
					frappe.call({
						method:
							'healthcare.api.patient_appointment_old_status_backfill.run_patient_appointment_old_status_backfill_preview',
						args: { file_url: file.file_url },
						freeze: true,
						freeze_message: __('Reading Excel (all sheets)…'),
						callback(preview) {
							const counts = preview.message || {};
							const docSample = (counts.sample_doc_code || [])
								.map(
									(row) =>
										`${row.app_num}: doc_code ${row.current_doc_code || '(empty)'} → ${row.target_doc_code}`
										+ (row.will_set_practitioner
											? `, practitioner → ${row.target_doc_code}`
											: '')
								)
								.join('\n');
							const statusSample = (counts.sample || [])
								.map(
									(row) =>
										`${row.name}: ${row.old_status} → ${row.target_status} (was ${row.current_status})`
								)
								.join('\n');
							frappe.confirm(
								__(
									'Run in background from Oracle appointments Excel (all sheets).\n\n'
									+ '1) Match APP_NUM to Patient Appointment trans_no\n'
									+ '2) Set doc_code from DOC_CODE\n'
									+ '3) Set practitioner only when empty (create Healthcare Practitioner with doctors_id = doc_code if missing)\n'
									+ '4) Set status from old_status / APP_STATUS:\n'
									+ '   V → Closed, S → Scheduled or No Show by date\n\n'
									+ 'Excel rows: {0}\n'
									+ 'Matched appointments: {1}\n'
									+ 'Doc code / practitioner to update: {2} ({3} doc_code, {4} practitioner)\n'
									+ 'Status to update: {5} ({6} Closed, {7} No Show, {8} Scheduled)\n\n'
									+ 'Doc code sample:\n{9}\n\n'
									+ 'Status sample:\n{10}\n\nContinue?',
									[
										counts.excel_rows || 0,
										counts.matched_appointments || 0,
										counts.pending_doc_code_updates || 0,
										counts.doc_code_to_set || 0,
										counts.practitioner_to_set || 0,
										counts.total_needing_update || 0,
										counts.to_closed || 0,
										counts.to_no_show || 0,
										counts.to_scheduled || 0,
										docSample || __('(none)'),
										statusSample || __('(none)'),
									]
								),
								() => {
									frappe.call({
										method:
											'healthcare.api.data_migration_jobs.start_appointment_old_status_migration',
										args: { file_url: file.file_url },
										freeze: true,
										freeze_message: __('Starting background job…'),
										callback(r) {
											if (r.message?.ok) {
												frappe.show_alert({
													message: r.message.message || __('Job started'),
													indicator: 'green',
												});
												poll_migration_status('appointment_old_status');
											}
										},
									});
								}
							);
						},
					});
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Complete All Medication Orders'), () => {
			frappe.confirm(
				__(
					'Run in background: submit all draft Patient Medication Orders, then set completed orders to total and mark status Completed. Rows that fail validation are logged and skipped. Continue?'
				),
				() => run_migration_job(frm, 'start_medication_order_complete_migration', 'medication_orders')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Sign Patient Medication Orders'), () => {
			frappe.call({
				method: 'healthcare.api.data_migration_jobs.preview_pmo_sign_migration',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Run in background: submit draft Patient Medication Orders if needed, attach a legacy migration signature, and set status to Signed.\n\nCandidates: {0}\n\nContinue?',
							[counts.candidates || 0]
						),
						() => run_migration_job(frm, 'start_pmo_sign_migration', 'pmo_sign')
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Complete Medication Orders by Date'), () => {
			const dialog = new frappe.ui.Dialog({
				title: __('Complete Medication Orders by Date'),
				fields: [
					{
						fieldname: 'from_date',
						label: __('From Date'),
						fieldtype: 'Date',
						reqd: 1,
					},
					{
						fieldname: 'to_date',
						label: __('To Date'),
						fieldtype: 'Date',
						reqd: 1,
					},
				],
				primary_action_label: __('Preview & Run'),
				primary_action(values) {
					if (values.from_date > values.to_date) {
						frappe.msgprint({
							title: __('Invalid date range'),
							message: __('From Date must be on or before To Date.'),
							indicator: 'orange',
						});
						return;
					}
					frappe.call({
						method: 'healthcare.api.data_migration_jobs.preview_pmo_complete_by_date',
						args: {
							from_date: values.from_date,
							to_date: values.to_date,
						},
						freeze: true,
						freeze_message: __('Counting medication orders…'),
						callback(preview) {
							const counts = preview.message || {};
							frappe.confirm(
								__(
									'Run in background: submit and complete Patient Medication Orders whose posting date (or start date when posting date is empty) is between {0} and {1}.\n\nCandidates: {2}\n\nContinue?',
									[counts.from_date, counts.to_date, counts.candidates || 0]
								),
								() => {
									frappe.call({
										method:
											'healthcare.api.data_migration_jobs.start_pmo_complete_by_date_migration',
										args: {
											from_date: values.from_date,
											to_date: values.to_date,
										},
										freeze: true,
										freeze_message: __('Starting background job…'),
										callback(r) {
											if (r.message?.ok) {
												dialog.hide();
												frappe.show_alert({
													message: r.message.message || __('Job started'),
													indicator: 'green',
												});
												poll_migration_status('pmo_complete_by_date');
											}
										},
									});
								}
							);
						},
					});
				},
			});
			dialog.show();
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Import Patient History from Staging'), () => {
			frappe.call({
				method: 'healthcare.api.patient_history_import.run_patient_history_import_preview',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Run in background: for each admission on Patient History Import, create or update one Patient History (Default History Form) and fill history_detail lines by Attrib Num. Import rows: {0}, admissions: {1}, rows without admission: {2}. Continue?',
							[
								counts.import_rows || 0,
								counts.admissions || 0,
								counts.unresolved_rows || 0,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_patient_history_import_migration',
								'patient_history_import'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Backfill Patient History Dates from Import'), () => {
			frappe.call({
				method: 'healthcare.api.patient_history_date_backfill.run_patient_history_date_backfill_preview',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Run in background: for each Patient History linked to an admission with no date, use Patient History Import CR Date when available; otherwise use the linked Inpatient Admission date (Admitted Datetime or Admission Date).\n\nWith admission: {0}\nMissing date: {1}\nSample can update: {2} / {3}\nSample from import CR Date: {4}\nSample from admission date: {5}\nSample with no date source: {6}\n\nContinue?',
							[
								counts.total_with_admission || 0,
								counts.missing_date || 0,
								counts.sample_can_update || 0,
								counts.sample_checked || 0,
								counts.sample_from_import || 0,
								counts.sample_from_admission || 0,
								counts.sample_no_date || 0,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_patient_history_date_backfill_migration',
								'patient_history_date_backfill'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Delete Orphaned Patient History'), () => {
			frappe.call({
				method: 'healthcare.api.patient_history_orphan_cleanup.run_patient_history_orphan_cleanup_preview',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || []).join(', ');
					const dupPhSample = (counts.sample_duplicate_patient_history || []).join(', ');
					const dupAdmSample = (counts.sample_duplicate_admission_case_nos || []).join(', ');
					frappe.confirm(
						__(
							'Run in background: clean Patient History and duplicate Inpatient Admissions.\n\n'
							+ '1) Orphan Patient History (no linked admission): {0}\n'
							+ '   Sample: {1}\n'
							+ '2) Duplicate Patient History (extra per admission): {2}\n'
							+ '   Sample: {3}\n'
							+ '3) Duplicate Inpatient Admissions ({4} group(s), {5} record(s) to remove)\n'
							+ '   Sample case nos: {6}\n\n'
							+ 'Keeps the best admission per duplicate group (prefers Admitted, linked history). '
							+ 'This cannot be undone. Continue?',
							[
								counts.orphaned_count || 0,
								sample || __('(none)'),
								counts.duplicate_patient_history_count || 0,
								dupPhSample || __('(none)'),
								counts.duplicate_admission_groups || 0,
								counts.duplicate_admissions_to_remove || 0,
								dupAdmSample || __('(none)'),
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_patient_history_orphan_cleanup_migration',
								'patient_history_orphan_cleanup'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Sync PMO Status by Admission'), () => {
			frappe.call({
				method: 'healthcare.api.data_migration_jobs.preview_pmo_sync_by_admission_status',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Run in background: for Patient Medication Orders linked to an Inpatient Admission,\n'
								+ 'set status to Signed when the admission is Admitted, and Completed when the admission is Discharged.\n\n'
								+ 'To sign (Admitted): {0}\n'
								+ 'To complete (Discharged): {1}\n\n'
								+ 'Draft PMOs are submitted first. Legacy migration signature is applied when missing.\n\nContinue?',
							[counts.sign_candidates || 0, counts.complete_candidates || 0]
						),
						() =>
							run_migration_job(
								frm,
								'start_pmo_sync_by_admission_status_migration',
								'pmo_sync_by_admission_status'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Backfill PMO Inpatient Admission from Written'), () => {
			frappe.call({
				method:
					'healthcare.api.patient_medication_order_admission_backfill.preview_pmo_written_admission_backfill',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Backfill Patient Medication Orders that have Written Inpatient Admission?\n\nOrders with written admission: {0}\nNeed update (sampled): {1}\nUnresolved admission (sampled): {2}\n\nSets Inpatient Admission (inpatient_record), patient, patient name/age/nationality, company, and practitioner from the linked admission. Submitted orders are updated via db_set. Continue?',
							[
								counts.candidates || 0,
								counts.needs_update_sampled || 0,
								counts.unresolved_sampled || 0,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_pmo_written_admission_backfill_migration',
								'pmo_admission_backfill'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Link IP Admission Medicine to PMO'), () => {
			frappe.confirm(
				__(
					'Run in background: group IP Admission Medicine by admission, create/update one Patient Medication Order per admission, and append medication lines with trans_num + legacy medicine fields (old code/name, stopped reason). Existing linked trans_num rows are skipped. Continue?'
				),
				() => run_migration_job(frm, 'start_ip_admission_medicine_link_migration', 'ip_admission_medicine_link')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Map Medicine Given/Missed from Sheet'), () => {
			frappe.confirm(
				__(
					'Run in background: map IP Admission Medicine Sheet rows to Admission Detail child tables (Given Y -> Medicine Given, Given N -> Missed Medicine), linking old medicine fields, IP medicine refs, and patient medication order. Existing mapped sheet rows are skipped. Continue?'
				),
				() => run_migration_job(frm, 'start_ip_admission_medicine_sheet_map_migration', 'ip_admission_medicine_sheet_map')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Map IP Patient Assessment to Patient Assessment'), () => {
			frappe.confirm(
				__(
					'Run in background: create Patient Assessment rows from IP Patient Assessment using template “Default Patient Evaluation”. Parameters are matched by Patient Assessment Parameter.parameter_abbrev against IP fields (e.g. ARRIVAL -> arrival). Value 1/Yes sets child row Yes; *_desc is copied to comments. Existing linked rows are skipped. Continue?'
				),
				() => run_migration_job(frm, 'start_ip_patient_assessment_map_migration', 'ip_patient_assessment_map')
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('OP Injection Prescription Upload'), () => {
			const uploader = new frappe.ui.FileUploader({
				dialog_title: __('OP Injection Prescription Upload'),
				allow_multiple: false,
				restrictions: {
					allowed_file_types: ['.xlsx', '.xls'],
				},
				on_success(file) {
					frappe.call({
						method: 'healthcare.api.op_injection_prescription_import.preview_op_injection_prescription_import',
						args: { file_url: file.file_url },
						freeze: true,
						freeze_message: __('Reading VISIT_00_04 Excel…'),
						callback(preview) {
							const counts = preview.message || {};
							frappe.confirm(
								__(
									'Import OP long-acting / injection prescriptions (VISIT_00_04)?\n\nFile rows: {0}\nPatient + medicine groups: {1}\nGive-out lines: {2}\nGroups linked to Patient records: {3}\nRows without ACTING_DATE (still imported): {4}\n\nPatient, medication, and acting date are all optional. Legacy PATIENT_NUM is stored on the prescription when no Patient link exists. Continue?',
									[
										counts.file_rows || 0,
										counts.medicine_groups || 0,
										counts.give_out_lines || 0,
										counts.patient_linked_groups || 0,
										counts.rows_without_acting_date || 0,
									]
								),
								() => {
									frappe.call({
										method:
											'healthcare.api.data_migration_jobs.start_op_injection_prescription_import_migration',
										args: { file_url: file.file_url },
										freeze: true,
										freeze_message: __('Starting background job…'),
										callback(r) {
											if (r.message?.ok) {
												frappe.show_alert({
													message: r.message.message || __('Job started'),
													indicator: 'green',
												});
												poll_migration_status('op_injection_prescription_import');
											}
										},
									});
								}
							);
						},
					});
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Import Discharge Checklist from Excel'), () => {
			const uploader = new frappe.ui.FileUploader({
				dialog_title: __('Import Discharge Checklist'),
				allow_multiple: false,
				restrictions: {
					allowed_file_types: ['.xlsx', '.xls'],
				},
				on_success(file) {
					frappe.call({
						method: 'healthcare.api.discharge_checklist_import.preview_discharge_checklist_import',
						args: { file_url: file.file_url },
						freeze: true,
						freeze_message: __('Reading Excel…'),
						callback(preview) {
							const counts = preview.message || {};
							frappe.confirm(
								__(
									'Import discharge checklist rows into existing Discharge records?\n\nExcel rows: {0}\nAdmissions in file: {1}\nCan match admission + Discharge: {2}\nRows without admission number: {3}\n\nEach admission gets Default Discharge Template (9 actions) filled from Oracle (SR_NUM, action, department, flags, CR/UP fields). Continue?',
									[
										counts.excel_rows || 0,
										counts.admissions || 0,
										counts.resolvable_admissions || 0,
										counts.unresolved_rows || 0,
									]
								),
								() => {
									frappe.call({
										method:
											'healthcare.api.data_migration_jobs.start_discharge_checklist_import_migration',
										args: { file_url: file.file_url },
										freeze: true,
										freeze_message: __('Starting background job…'),
										callback(r) {
											if (r.message?.ok) {
												frappe.show_alert({
													message: r.message.message || __('Job started'),
													indicator: 'green',
												});
												poll_migration_status('discharge_checklist_import');
											}
										},
									});
								}
							);
						},
					});
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Upload Legacy Lab Header Excel'), () => {
			new frappe.ui.FileUploader({
				dialog_title: __('Select Lab Header Excel (C LAB_00_03)'),
				allow_multiple: false,
				restrictions: {
					allowed_file_types: ['.xlsx', '.xls'],
				},
				on_success(file) {
					frm._legacy_lab_header_file_url = file.file_url;
					frappe.show_alert({
						message: __('Lab header file uploaded. Now upload the detail Excel.'),
						indicator: 'green',
					});
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Import Legacy Lab Detail Excel'), () => {
			if (!frm._legacy_lab_header_file_url) {
				frappe.msgprint({
					title: __('Header file required'),
					message: __(
						'Upload the lab header Excel first using “Upload Legacy Lab Header Excel” (C LAB_00_03), then upload the detail file here (C-I LAB_00_04).'
					),
					indicator: 'orange',
				});
				return;
			}

			new frappe.ui.FileUploader({
				dialog_title: __('Select Lab Detail Excel (C-I LAB_00_04)'),
				allow_multiple: false,
				restrictions: {
					allowed_file_types: ['.xlsx', '.xls'],
				},
				on_success(detailFile) {
					const headerFileUrl = frm._legacy_lab_header_file_url;
					frappe.call({
						method: 'healthcare.api.lab_test_legacy_import.preview_legacy_lab_import',
						args: {
							header_file_url: headerFileUrl,
							detail_file_url: detailFile.file_url,
						},
						freeze: true,
						freeze_message: __('Reading Excel files…'),
						callback(preview) {
							const counts = preview.message || {};
							frappe.confirm(
								__(
									'Import legacy lab tests into Lab Test records?\n\nHeader rows: {0}\nDetail rows: {1}\nTransactions: {2}\nWith header (003): {3}\nWith result lines: {4}\nExisting patient links: {5}\nWill create Patient from SUB_DR_GL_CODE: {6}\nMatching lab template: {7}\nStandalone (detail only, no 003 header): {8}\n\nMissing visit/admission/patient will not block import — Patient is created from SUB_DR_GL_CODE when needed. Standalone rows use TRANS_NUM only. No billing is created. Continue?',
									[
										counts.header_rows || 0,
										counts.detail_rows || 0,
										counts.transactions || 0,
										counts.transactions_with_header || counts.header_rows || 0,
										counts.transactions_with_results || 0,
										counts.resolvable_patient || 0,
										counts.will_create_patient_from_sub_dr || 0,
										counts.resolvable_template || 0,
										counts.standalone_transactions || counts.detail_without_header || 0,
									]
								),
								() => {
									frappe.call({
										method:
											'healthcare.api.data_migration_jobs.start_legacy_lab_import_migration',
										args: {
											header_file_url: headerFileUrl,
											detail_file_url: detailFile.file_url,
										},
										freeze: true,
										freeze_message: __('Starting background job…'),
										callback(r) {
											if (r.message?.ok) {
												frappe.show_alert({
													message: r.message.message || __('Job started'),
													indicator: 'green',
												});
												poll_migration_status('legacy_lab_import');
											}
										},
									});
								}
							);
						},
					});
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Import Nursing Checklist from Excel'), () => {
			const uploader = new frappe.ui.FileUploader({
				dialog_title: __('Import Nursing Checklist'),
				allow_multiple: false,
				restrictions: {
					allowed_file_types: ['.xlsx', '.xls'],
				},
				on_success(file) {
					frappe.call({
						method: 'healthcare.api.nursing_checklist_import.preview_nursing_checklist_import',
						args: { file_url: file.file_url },
						freeze: true,
						freeze_message: __('Reading Excel…'),
						callback(preview) {
							const counts = preview.message || {};
							frappe.confirm(
								__(
									'Import nursing checklist rows into existing Discharge records?\n\nExcel rows: {0}\nAdmissions in file: {1}\nCan match admission + Discharge: {2}\nRows without admission number: {3}\n\nEach admission gets Default Nursing Discharge Checklist tasks, then Oracle values are applied by SR Num / Action Required (action, description, cost center, CR/UP fields). Continue?',
									[
										counts.excel_rows || 0,
										counts.admissions || 0,
										counts.resolvable_admissions || 0,
										counts.unresolved_rows || 0,
									]
								),
								() => {
									frappe.call({
										method:
											'healthcare.api.data_migration_jobs.start_nursing_checklist_import_migration',
										args: { file_url: file.file_url },
										freeze: true,
										freeze_message: __('Starting background job…'),
										callback(r) {
											if (r.message?.ok) {
												frappe.show_alert({
													message: r.message.message || __('Job started'),
													indicator: 'green',
												});
												poll_migration_status('nursing_checklist_import');
											}
										},
									});
								}
							);
						},
					});
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Fix Comma Case No (1,415 → 1415)'), () => {
			frappe.call({
				method: 'healthcare.api.legacy_id_normalize.preview_comma_admission_ids',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Normalize Inpatient Admission Case No values with commas (e.g. 1,415 → 1415)?\n\nRecords to process: {0}\n\nCase No is the canonical ID (document name should match). Duplicate plain Case Nos are removed first, then Case No and linked Discharge rows are fixed. Continue?',
							[counts.count || 0]
						),
						() =>
							run_migration_job(
								frm,
								'start_comma_admission_id_migration',
								'comma_admission_ids'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Fix Comma Discharge Admission (1,415 → 1415)'), () => {
			frappe.call({
				method: 'healthcare.api.legacy_id_normalize.preview_comma_discharge_ids',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Normalize Discharge Admission links (Inpatient Case No) with commas (e.g. 1,415 → 1415)?\n\nRecords to process: {0}\n\nAdmission is the canonical ID (document name should match). Duplicate plain discharges are removed first (submitted ones cancelled), then Admission and name are aligned to the fixed Inpatient Admission Case No. Run after the Case No admission fix. Continue?',
							[counts.count || 0]
						),
						() =>
							run_migration_job(
								frm,
								'start_comma_discharge_id_migration',
								'comma_discharge_ids'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Map Clinical Note Types from Diagnosis Flag'), () => {
			frappe.confirm(
				__(
					'Run in background: set Clinical Note Type from diagnosis_flag — 1/DOC → Doctor Progress Note, 2/PSY → Psychologist Note, 3/NUT → Nutritionist Note, 4/OCC → General Note. IP rows with empty flag, inpatient admission, and Nurse medical role → Nursing Note only. Rows already matching are skipped. Continue?'
				),
				() =>
					run_migration_job(
						frm,
						'start_clinical_note_type_from_flag_migration',
						'clinical_note_type_from_flag'
					)
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Backfill Clinical Note Branch from Visit / Admission'), () => {
			frappe.call({
				method: 'healthcare.api.clinical_note_branch_backfill.preview_clinical_note_branch_backfill',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Backfill Clinical Note Branch from the linked Patient Visit or Inpatient Admission cost center?\n\nNotes without branch (with visit or admission): {0}\nSampled as updatable: {1}\nSampled with no cost center on visit/admission: {2}\n\nNew and edited notes already copy branch on save. This job only fills existing notes that are still empty. Continue?',
							[
								counts.candidates || 0,
								counts.needs_update_sampled || 0,
								counts.unresolved_sampled || 0,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_clinical_note_branch_backfill_migration',
								'clinical_note_branch_backfill'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Backfill Assessment Cost Center from Visit / Admission'), () => {
			frappe.call({
				method: 'healthcare.api.assessment_cost_center_backfill.preview_assessment_cost_center_backfill',
				callback(preview) {
					const counts = preview.message || {};
					const byDoctype = counts.by_doctype || {};
					const detail = Object.keys(byDoctype)
						.sort()
						.map((dt) => `${dt}: ${byDoctype[dt]}`)
						.join('\n');
					frappe.confirm(
						__(
							'Backfill Cost Center on assessments from the linked Patient Visit or Inpatient Admission?\n\nRecords without cost center (with visit or admission): {0}\n\n{1}\n\nNew and edited assessments already copy cost center on save. This job only fills existing records that are still empty. Continue?',
							[counts.candidates || 0, detail || __('None')]
						),
						() =>
							run_migration_job(
								frm,
								'start_assessment_cost_center_backfill_migration',
								'assessment_cost_center_backfill'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Backfill Patient Assessment Cost Center from Visit / Admission'), () => {
			frappe.call({
				method:
					'healthcare.api.assessment_cost_center_backfill.preview_patient_assessment_cost_center_backfill',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Iterate Patient Assessment records with no Cost Center and copy it from the linked Patient Visit (encounter) or Inpatient Admission (encounter / admission)?\n\nRecords without cost center (with visit or admission): {0}\nSampled as updatable: {1}\nSampled with no cost center on visit/admission: {2}\n\nContinue?',
							[
								counts.candidates || 0,
								counts.needs_update_sampled || 0,
								counts.unresolved_sampled || 0,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_patient_assessment_cost_center_backfill_migration',
								'patient_assessment_cost_center_backfill'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Backfill Physical Examination Cost Center from Visit / Admission'), () => {
			frappe.call({
				method:
					'healthcare.api.assessment_cost_center_backfill.preview_physical_examination_cost_center_backfill',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Iterate Physical Examination records with no Cost Center and copy it from the linked Patient Visit or Inpatient Admission?\n\nRecords without cost center (with visit or admission): {0}\nSampled as updatable: {1}\nSampled with no cost center on visit/admission: {2}\n\nNew exams already copy cost center on save. Continue?',
							[
								counts.candidates || 0,
								counts.needs_update_sampled || 0,
								counts.unresolved_sampled || 0,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_physical_examination_cost_center_backfill_migration',
								'physical_examination_cost_center_backfill'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Create Clinical Notes from Visit Encounter Comment'), () => {
			frappe.call({
				method:
					'healthcare.api.patient_visit_encounter_comment_clinical_note.preview_patient_visit_encounter_comment_clinical_note',
				callback(preview) {
					const counts = preview.message || {};
					if (!counts.migration_enabled) {
						frappe.msgprint({
							title: __('Visit Encounter Comment'),
							message: __(
								'Enable Active in Healthcare Settings before creating Clinical Notes from visit encounter comments.'
							),
							indicator: 'orange',
						});
						return;
					}
					const total = counts.total_with_comment || 0;
					if (!total) {
						frappe.msgprint({
							title: __('Visit Encounter Comment'),
							message: __('No Patient Visits with encounter_comment found.'),
							indicator: 'green',
						});
						return;
					}
					const duplicates =
						counts.already_duplicate != null
							? counts.already_duplicate
							: counts.already_linked || 0;
					frappe.confirm(
						__(
							'Run in background: for each Patient Visit with encounter_comment (Review Details), create a Doctor Progress Note?\n\n'
								+ 'Visits with comment: {0}\n'
								+ 'Already have note for same patient + visit (skipped): {1}\n'
								+ 'Notes to create: {2}\n\n'
								+ 'Note text = encounter_comment. Posting date = visit encounter date. '
								+ 'Practitioner, patient, cost center, and username (if on visit) are copied from the visit. '
								+ 'Visits that already have a Doctor Progress Note for the same patient and same visit are skipped (no duplicates). Continue?',
							[total, duplicates, counts.to_create || 0]
						),
						() =>
							run_migration_job(
								frm,
								'start_patient_visit_encounter_comment_clinical_note_migration',
								'patient_visit_encounter_comment_clinical_note'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Stop Clinical Notes from Visit Encounter Comment'), () => {
			frappe.confirm(
				__(
					'Stop the background job that creates Clinical Notes from Patient Visit encounter comments?\n\n'
						+ 'The current visit being processed will finish; no further visits or batches will run.'
				),
				() => {
					frappe.call({
						method:
							'healthcare.api.data_migration_jobs.stop_patient_visit_encounter_comment_clinical_note_migration',
						freeze: true,
						freeze_message: __('Requesting stop…'),
						callback(r) {
							const msg = r.message || {};
							frappe.show_alert({
								message: msg.message || __('Stop requested'),
								indicator: msg.ok ? 'orange' : 'red',
							});
							if (msg.ok) {
								poll_migration_status('patient_visit_encounter_comment_clinical_note');
							}
						},
					});
				}
			);
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Fix Patient Gender (1→Male, 2→Female)'), () => {
			frappe.call({
				method: 'healthcare.api.data_migration_jobs.preview_patient_legacy_gender_fix',
				callback(preview) {
					const counts = preview.message || {};
					const total = counts.patients_total || 0;
					const warnings = counts.warning_messages || 0;
					if (!total && !warnings) {
						frappe.msgprint({
							title: __('Patient Gender'),
							message: __('No patients or warning messages with legacy gender codes 1 / 2 found.'),
							indicator: 'green',
						});
						return;
					}
					frappe.confirm(
						__(
							'Run in background: update legacy gender codes?\n\n'
								+ 'Patients with sex 1 (→ Male): {0}\n'
								+ 'Patients with sex 2 (→ Female): {1}\n'
								+ 'Warning messages with gender 1 / 2: {2}\n\n'
								+ 'Rows already correct are skipped. Continue?',
							[
								counts.patients_sex_1 || 0,
								counts.patients_sex_2 || 0,
								warnings,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_patient_legacy_gender_fix_migration',
								'patient_legacy_gender_fix'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Backfill Morse Fall Scale Details'), () => {
			frappe.call({
				method: 'healthcare.api.morse_fall_scale_detail_import.preview_morse_fall_scale_detail_import',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Run in background: for each MORSE_FALL_SCALE_01 staging row with a matching patient and admission, replace Morse Fall Scale detail lines (text message + points from TEXT_MESSAGE_1–7 / GET_POINTS_1–7) and update total points. Staging rows: {0}, resolvable: {1}, unresolved: {2} (missing patient/admission: {3}, Morse not found: {4}). Continue?',
							[
								counts.staging_rows || 0,
								counts.resolvable || 0,
								counts.unresolved || 0,
								counts.missing_patient_or_admission || 0,
								counts.morse_not_found || 0,
							]
						),
						() =>
							run_migration_job(
								frm,
								'start_morse_fall_scale_detail_migration',
								'morse_fall_scale_detail'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Dedupe Morse Fall Scale Details'), () => {
			frappe.call({
				method: 'healthcare.api.morse_fall_scale_detail_dedupe.preview_morse_fall_scale_detail_dedupe',
				callback(preview) {
					const counts = preview.message || {};
					const rowsToDelete = counts.rows_to_delete || 0;
					if (!rowsToDelete) {
						frappe.msgprint({
							title: __('Morse Fall Scale Details'),
							message: __('No duplicate detail rows found.'),
							indicator: 'green',
						});
						return;
					}
					const samples = (counts.sample_parents || []).join(', ') || __('(none)');
					frappe.confirm(
						__(
							'Remove duplicate Morse Fall Scale detail rows in the background?\n\n'
								+ 'Scales affected: {0}\n'
								+ 'Duplicate rows to delete: {1}\n'
								+ 'Keeps the first row per text message (and points) on each scale; recalculates total points.\n\n'
								+ 'Sample scale(s): {2}\n\nContinue?',
							[counts.parents_affected || 0, rowsToDelete, samples]
						),
						() =>
							run_migration_job(
								frm,
								'start_morse_fall_scale_detail_dedupe_migration',
								'morse_fall_scale_detail_dedupe'
							)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Inpatient Pricing Structure (Word Doc)'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Import Inpatient Pricing Structure'),
				preview_method: 'healthcare.api.inpatient_pricing_import.preview_inpatient_pricing_import',
				import_method: 'healthcare.api.inpatient_pricing_import.import_inpatient_pricing_structure',
				allowed_file_types: ['.docx'],
				freeze_message: __('Reading pricing document…'),
				import_freeze_message: __('Creating Service Unit Types and Inpatient Packages…'),
				build_confirm_message: (counts) => {
					const rooms = (counts.room_types || [])
						.map((r) => `${r.name} × ${r.multiplier}`)
						.join('\n');
					const programs = (counts.programs || [])
						.map(
							(p) =>
								`${p.name}: ${p.days} day(s), base ${p.base_total} BD`
						)
						.join('\n');
					return __(
						'Import inpatient pricing from the uploaded document?\n\n'
							+ 'Company: {0}\n'
							+ 'Source: {1}\n\n'
							+ 'Room types (Service Unit Type): {2} new, {3} existing\n'
							+ '{4}\n\n'
							+ 'Programs (Inpatient Package): {5} new, {6} existing\n'
							+ '{7}\n\n'
							+ 'Formula: Final Price = Program Price × Room Multiplier\n\nContinue?',
						[
							counts.company || '',
							counts.source || 'docx',
							counts.new_service_unit_types || 0,
							counts.existing_service_unit_types || 0,
							rooms || __('(none)'),
							counts.new_packages || 0,
							counts.existing_packages || 0,
							programs || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Room types created: {0}\n'
							+ 'Room types updated: {1}\n'
							+ 'Packages created: {2}\n'
							+ 'Packages updated: {3}\n'
							+ 'Errors: {4}',
						[
							result.room_types_created || 0,
							result.room_types_updated || 0,
							result.packages_created || 0,
							result.packages_updated || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Apply May 2026 Inpatient Pricing Defaults'), () => {
			frappe.call({
				method: 'healthcare.api.inpatient_pricing_import.preview_inpatient_pricing_import',
				args: {},
				freeze: true,
				freeze_message: __('Preparing defaults…'),
				callback(preview) {
					const counts = preview.message || {};
					const rooms = (counts.room_types || [])
						.map((r) => `${r.name} × ${r.multiplier}`)
						.join('\n');
					const programs = (counts.programs || [])
						.map((p) => `${p.name}: ${p.days} day(s), base ${p.base_total} BD`)
						.join('\n');
					frappe.confirm(
						__(
							'Apply documented May 2026 inpatient pricing defaults (no file)?\n\n'
								+ 'Company: {0}\n\n'
								+ 'Room types:\n{1}\n\n'
								+ 'Programs:\n{2}\n\n'
								+ 'Creates/updates Healthcare Service Unit Types (multipliers) '
								+ 'and Inpatient Packages (programs). Continue?',
							[counts.company || '', rooms || __('(none)'), programs || __('(none)')]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.inpatient_pricing_import.import_inpatient_pricing_structure',
								args: {},
								freeze: true,
								freeze_message: __('Creating packages and room types…'),
								callback(r) {
									const result = r.message || {};
									frappe.msgprint({
										title: __('Import complete'),
										message: __(
											'Room types created: {0}\nRoom types updated: {1}\n'
												+ 'Packages created: {2}\nPackages updated: {3}\nErrors: {4}',
											[
												result.room_types_created || 0,
												result.room_types_updated || 0,
												result.packages_created || 0,
												result.packages_updated || 0,
												result.errors || 0,
											]
										),
										indicator: result.errors ? 'orange' : 'green',
									});
								},
							});
						}
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient — PATIENT_INFO_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Patient Upload (PATIENT_INFO_01)'),
				preview_method: 'healthcare.api.patient_info_import.preview_patient_info_import',
				start_method: 'healthcare.api.data_migration_jobs.start_patient_info_import_migration',
				job_key: 'patient_info_import',
				build_confirm_message: (counts) =>
					__(
						'Import patients from PATIENT_INFO_01 Excel?\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Patients with File No: {1}\n'
							+ 'New: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Rows with allergies (Warning Message will be created): {4}\n\n'
							+ 'Sample File Nos: {5}\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.patients || 0,
							counts.new_patients || 0,
							counts.existing_patients || 0,
							counts.with_allergies || 0,
							(counts.sample_file_nos || []).join(', ') || __('(none)'),
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient CPR Photos — Local Folder'), () => {
			open_patient_cpr_folder_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('Legacy Signatures — Local Folder'), () => {
			open_patient_legacy_signature_folder_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('Legacy Visit Documents — Local Folder'), () => {
			open_legacy_visit_document_folder_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient Allergies — PATIENT_INFO_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Patient Allergies (PATIENT_INFO_01)'),
				preview_method:
					'healthcare.api.patient_allergy_warning_import.preview_patient_allergy_warning_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_allergy_warning_import_migration',
				job_key: 'patient_allergy_warning_import',
				build_confirm_message: (counts) =>
					__(
						'Import patient allergies from PATIENT_INFO_01 Excel?\n\n'
							+ 'Only ALLERGIES_HISTORY is used — patients are not created or updated (except allergies field).\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Rows with allergy text: {1}\n'
							+ 'Patients found in system: {2}\n'
							+ 'Patients missing (skipped): {3}\n\n'
							+ 'Creates or updates Medical Warning Message (type Allergy) per patient.\n\n'
							+ 'Sample File Nos: {4}\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.with_allergies || 0,
							counts.patients_found || 0,
							counts.patients_missing || 0,
							(counts.sample_file_nos || []).join(', ') || __('(none)'),
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Update Patient Blacklist — PATIENT_INFO_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Update Patient Blacklist (PATIENT_INFO_01)'),
				preview_method: 'healthcare.api.patient_blacklist_sync.preview_patient_blacklist_sync',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_blacklist_sync_migration',
				job_key: 'patient_blacklist_sync',
				build_confirm_message: (counts) => {
					const sample = (counts.sample || [])
						.map(
							(row) =>
								`${row.file_no}: ${row.from} → ${row.to} (Excel ${row.excel})`
						)
						.join('\n');
					return __(
						'Update Patient is_black_list from PATIENT_INFO_01?\n\n'
							+ 'Oracle mapping: 1 = blacklisted, 2 = not blacklisted.\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Blacklisted in Excel (1): {1}\n'
							+ 'Not blacklisted in Excel (2): {2}\n'
							+ 'Patients found: {3}\n'
							+ 'Patients missing: {4}\n'
							+ 'Need update: {5}\n\n'
							+ 'Sample changes:\n{6}\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.excel_blacklisted || 0,
							counts.excel_not_blacklisted || 0,
							counts.patients_found || 0,
							counts.patients_missing || 0,
							counts.needs_update || 0,
							sample || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Warning Message — PATIENT_WARNING_MESSAGES'), () => {
			open_direct_excel_upload({
				dialog_title: __('Warning Message (PATIENT_WARNING_MESSAGES)'),
				preview_method:
					'healthcare.api.patient_warning_message_import.preview_patient_warning_message_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_warning_message_import_migration',
				job_key: 'patient_warning_message_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Warning Message rows from PATIENT_WARNING_MESSAGES?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique WARNING_MESSAGE_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Rows without WARNING_MESSAGE text (still imported): {5}\n'
							+ 'Patients resolved: {6}\n'
							+ 'Patients unresolved (imported as Organisation): {7}\n'
							+ 'Organisation rows (no PATIENT_NUM): {8}\n\n'
							+ 'Mapping: WARNING_MESSAGE_NUM → trans_id, PATIENT_NUM → Patient, '
							+ 'WARNING_MESSAGE → warning, HIGH_RISK_TEXT → high_risk_text, '
							+ 'WARNING_MESSAGE_TYPE / CLASS → same, BRANCH_NUM → Cost Center, '
							+ 'CR_DATE → posting_date, STA_FLG → sta_flg.\n\n'
							+ 'Sample trans_id keys: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_warnings || 0,
							counts.new_warnings || 0,
							counts.empty_warning_rows || 0,
							counts.resolved_patients || 0,
							counts.unresolved_patients || 0,
							counts.organisation_rows || 0,
							(counts.sample_trans_ids || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Admission Detail Given Medicine — IP_ADMISSION_MEDICINE_SHEET'), () => {
			open_direct_excel_upload({
				dialog_title: __('Admission Detail Given Medicine (IP_ADMISSION_MEDICINE_SHEET)'),
				preview_method:
					'healthcare.api.ip_admission_medicine_sheet_given_import.preview_ip_admission_medicine_sheet_given_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_medicine_sheet_given_import_migration',
				job_key: 'ip_admission_medicine_sheet_given_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import given medicine rows from IP_ADMISSION_MEDICINE_SHEET?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Admissions in file: {3}\n'
							+ 'Given rows (GIVEN_YN = Y): {4}\n'
							+ 'Not-given rows (skipped): {5}\n'
							+ 'Existing sheet rows (will update): {6}\n'
							+ 'New sheet rows: {7}\n\n'
							+ 'Creates one Admission Detail per admission when missing and appends many Given Medicine child rows. '
							+ 'MEDI_TRANS_NUM is stored as old medicine code/name from ITEM_00_01. '
							+ 'Rows already linked by sheet row are skipped on re-run.\n\n'
							+ 'Sample TRANS_NUM keys: {8}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.admissions || 0,
							counts.given_rows || 0,
							counts.not_given_rows || 0,
							counts.existing_rows || 0,
							counts.new_rows || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('IP Patient Relatives — IP_PATIENT_RELATIVES'), () => {
			open_direct_excel_upload({
				dialog_title: __('IP Patient Relatives (IP_PATIENT_RELATIVES)'),
				preview_method:
					'healthcare.api.ip_patient_relatives_import.preview_ip_patient_relatives_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_patient_relatives_import_migration',
				job_key: 'ip_patient_relatives_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import patient relatives into Inpatient Admission child tables?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Relative lines: {1}\n'
							+ 'Distinct admissions: {2}\n'
							+ 'Admissions resolved: {3}\n'
							+ 'Admissions unresolved: {4}\n\n'
							+ 'Rows are grouped by ADMISSION_NUM and appended to Patient Relatives '
							+ 'on each admission. Existing rows with the same TRANS_NUM are updated.\n\n'
							+ 'Mapping: TRANS_NUM → trans_no, ADMISSION_NUM → Inpatient Admission, '
							+ 'RELATIVE_RELATION → Relationship With Patient, RELATIVE_NAME → relative_name, '
							+ 'RELATIVE_ID_NUM → relative_id_no / CPR ID, ANY_REMARKS → any_remarks, '
							+ 'CR_DATE → entered_date.\n\n'
							+ 'Sample admissions: {5}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.relative_lines || counts.excel_rows || 0,
							counts.admissions || 0,
							counts.resolvable_admissions || 0,
							counts.unresolved_admissions || 0,
							(counts.sample_admissions || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('ADM Dis + Checklists'), () => {
			open_ip_admission_bundle_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('Insurance Claims — INSURANCE_00_01 + 02'), () => {
			open_insurance_claim_bundle_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('TRICARE Price Lists (June 16 2026)'), () => {
			open_tricare_price_update_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('Lab Test Template Prices (July 2026)'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Lab Test Template Prices (July 2026)'),
				preview_method:
					'healthcare.api.lab_test_template_price_update.preview_lab_test_template_price_update',
				import_method:
					'healthcare.api.lab_test_template_price_update.update_lab_test_template_prices_from_excel',
				freeze_message: __('Reading Lab Prices Excel…'),
				import_freeze_message: __('Updating Lab Test Template prices…'),
				build_confirm_message: (counts) => {
					const missingSample = (counts.samples_missing || []).join('\n') || __('(none)');
					const updateSample = (counts.samples_updates || []).join('\n') || __('(none)');
					return __(
						'Update Lab Test Template prices from this Excel now (not a background job)?\n\n'
							+ 'Mapping:\n'
							+ '  OP price → OP Rate (op_rate)\n'
							+ '  IP price → IP Rate (lab_test_rate)\n'
							+ '  Lab/group name → Lab Test Name (when different)\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Matched templates: {1}\n'
							+ 'Missing templates: {2}\n'
							+ 'Templates to update: {3}\n'
							+ '  OP rate changes: {4}\n'
							+ '  IP rate changes: {5}\n'
							+ '  Name changes: {6}\n'
							+ 'Already correct: {7}\n\n'
							+ 'Sample updates:\n{8}\n\n'
							+ 'Sample missing:\n{9}\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.matched || 0,
							counts.missing || 0,
							counts.templates_needing_update || 0,
							counts.would_update_op || 0,
							counts.would_update_ip || 0,
							counts.would_update_name || 0,
							counts.unchanged || 0,
							updateSample,
							missingSample,
						]
					);
				},
				build_result_message: (result) => {
					const missingSample = (result.samples_missing || []).join('\n') || __('(none)');
					return __(
						'Lab Test Template prices updated.\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Matched: {1}\n'
							+ 'Templates updated: {2}\n'
							+ '  OP rates: {3}\n'
							+ '  IP rates: {4}\n'
							+ '  Names: {5}\n'
							+ 'Unchanged: {6}\n'
							+ 'Missing templates: {7}\n'
							+ 'Errors: {8}\n\n'
							+ 'Sample missing:\n{9}',
						[
							result.excel_rows || 0,
							result.matched || 0,
							result.updated || 0,
							result.updated_op || 0,
							result.updated_ip || 0,
							result.updated_name || 0,
							result.unchanged || 0,
							result.missing || 0,
							result.errors || 0,
							missingSample,
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Single-Group Lab Children (July 2026)'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Single-Group Lab Children (July 2026)'),
				preview_method:
					'healthcare.api.lab_test_template_price_update.preview_single_group_lab_child_price_update',
				import_method:
					'healthcare.api.lab_test_template_price_update.update_single_group_lab_child_prices_from_excel',
				freeze_message: __('Reading single-group Lab Prices…'),
				import_freeze_message: __('Updating single-group lab children…'),
				build_confirm_message: (counts) => {
					const missingSample = (counts.samples_missing || []).join('\n') || __('(none)');
					const updateSample = (counts.samples_updates || []).join('\n') || __('(none)');
					return __(
						'Update single-group lab children from this Excel?\n\n'
							+ 'Only Excel parents with no children in the sheet (e.g. LAB-089, LAB-091).\n'
							+ 'Skips panels like LAB-001 / LAB-055-004.\n\n'
							+ 'For each: LAB-xxx → system child LAB-xxx-001\n'
							+ '  OP/IP prices from the Excel group row\n'
							+ '  lab_group = LAB-xxx if empty\n'
							+ '  Enable (disabled = 0)\n'
							+ '  Tick Price Included in Group\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Single-group rows: {1}\n'
							+ 'Matched children: {2}\n'
							+ 'Missing LAB-xxx-001: {3}\n'
							+ 'Children to update: {4}\n'
							+ '  OP: {5}  IP: {6}\n'
							+ '  Set lab_group: {7}\n'
							+ '  Enable: {8}\n'
							+ '  Price included: {9}\n'
							+ 'Already correct: {10}\n\n'
							+ 'Sample updates:\n{11}\n\n'
							+ 'Sample missing:\n{12}\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.single_group_rows || 0,
							counts.matched || 0,
							counts.missing || 0,
							counts.templates_needing_update || 0,
							counts.would_update_op || 0,
							counts.would_update_ip || 0,
							counts.would_set_lab_group || 0,
							counts.would_enable || 0,
							counts.would_include_in_group || 0,
							counts.unchanged || 0,
							updateSample,
							missingSample,
						]
					);
				},
				build_result_message: (result) => {
					const missingSample = (result.samples_missing || []).join('\n') || __('(none)');
					const updateSample = (result.samples_updates || []).join('\n') || __('(none)');
					return __(
						'Single-group lab children updated.\n\n'
							+ 'Single-group rows: {0}\n'
							+ 'Matched: {1}\n'
							+ 'Updated: {2}\n'
							+ '  OP: {3}  IP: {4}\n'
							+ '  lab_group: {5}\n'
							+ '  Enabled: {6}\n'
							+ '  Price included: {7}\n'
							+ 'Unchanged: {8}\n'
							+ 'Missing: {9}\n'
							+ 'Errors: {10}\n\n'
							+ 'Sample updates:\n{11}\n\n'
							+ 'Sample missing:\n{12}',
						[
							result.single_group_rows || 0,
							result.matched || 0,
							result.updated || 0,
							result.updated_op || 0,
							result.updated_ip || 0,
							result.updated_lab_group || 0,
							result.updated_enabled || 0,
							result.updated_price_included || 0,
							result.unchanged || 0,
							result.missing || 0,
							result.errors || 0,
							updateSample,
							missingSample,
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Admission Transfer - IP_ADMISSION_TRANSFER'), () => {
			open_direct_excel_upload({
				dialog_title: __('Admission Transfer (IP_ADMISSION_TRANSFER)'),
				preview_method:
					'healthcare.api.ip_admission_transfer_import.preview_ip_admission_transfer_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_transfer_import_migration',
				job_key: 'ip_admission_transfer_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Admission Transfer from IP_ADMISSION_TRANSFER?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing transfers (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'New admissions resolved: {5}\n'
							+ 'New admissions unresolved: {6}\n'
							+ 'Rows with missing patient: {7}\n'
							+ 'Rows with patient/admission mismatch: {8}\n'
							+ 'Rows with unmapped branch: {9}\n\n'
							+ 'OLD/NEW_ADMISSION_NUM → Transfer Admission Event; NEW admission → Inpatient Admission link. '
							+ 'FROM/TO_BRANCH_NUM → cost centers. NEW_ADMISSION_DATE + TIME → transfer datetime.\n'
							+ 'Sample TRANS_NUM: {10}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_transfers || 0,
							counts.new_transfers || 0,
							counts.resolved_new_admissions || 0,
							counts.unresolved_new_admissions || 0,
							counts.skip_no_patient || 0,
							counts.skip_patient_mismatch || 0,
							counts.skip_no_cost_center || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Admission Transfer Balance - IP_ADMISSION_TRANSFER_BAL'), () => {
			open_direct_excel_upload({
				dialog_title: __('Admission Transfer Balance (IP_ADMISSION_TRANSFER_BAL)'),
				preview_method:
					'healthcare.api.ip_admission_transfer_bal_import.preview_ip_admission_transfer_bal_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_transfer_bal_import_migration',
				job_key: 'ip_admission_transfer_bal_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Admission Transfer Balance from IP_ADMISSION_TRANSFER_BAL?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing records (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'New admissions resolved: {5}\n'
							+ 'New admissions unresolved: {6}\n'
							+ 'Rows with missing patient: {7}\n'
							+ 'Rows with patient/admission mismatch: {8}\n'
							+ 'Rows with unmapped branch: {9}\n'
							+ 'Rows missing TRANS_DATE: {10}\n\n'
							+ 'OLD/NEW admission + OLD/NEW branch → Admission Transfer Balance; BAL_AMT → balance amount. '
							+ 'Updates linked Inpatient Admission cost center.\n'
							+ 'Sample TRANS_NUM: {11}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_transfers || 0,
							counts.new_transfers || 0,
							counts.resolved_new_admissions || 0,
							counts.unresolved_new_admissions || 0,
							counts.skip_no_patient || 0,
							counts.skip_patient_mismatch || 0,
							counts.skip_no_cost_center || 0,
							counts.missing_trans_date || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Fall Risk Assessment - FALL_RISK_ASSESSMENT'), () => {
			open_direct_excel_upload({
				dialog_title: __('Fall Risk Assessment (FALL_RISK_ASSESSMENT)'),
				preview_method:
					'healthcare.api.fall_risk_assessment_import.preview_fall_risk_assessment_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_fall_risk_assessment_import_migration',
				job_key: 'fall_risk_assessment_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Fall Risk Assessment from FALL_RISK_ASSESSMENT?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing assessments (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Admissions unresolved: {6}\n'
							+ 'Rows missing TRANS_DATE: {7}\n\n'
							+ 'Risk fields (1–3) and remarks mapped directly; BRANCH_NUM → cost center.\n'
							+ 'Sample TRANS_NUM: {8}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_assessments || 0,
							counts.new_assessments || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.missing_trans_date || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('IP Risk Analysis'), () => {
			open_direct_excel_upload({
				dialog_title: __('IP Risk Analysis (IP_RISK_ANALYSIS)'),
				preview_method:
					'healthcare.api.ip_risk_analysis_import.preview_ip_risk_analysis_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_risk_analysis_import_migration',
				job_key: 'ip_risk_analysis_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import IP Risk Analysis from IP_RISK_ANALYSIS?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique admissions: {2}\n'
							+ 'Admissions resolved: {3}\n'
							+ 'Admissions unresolved: {4}\n'
							+ 'Existing analyses (will update): {5}\n'
							+ 'New: {6}\n\n'
							+ 'One IP Risk Analysis per admission. Risk toward self, toward others, '
							+ 'and from others fields mapped; RTO/RFO free-text rows go to child tables.\n'
							+ 'Sample admissions: {7}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.existing_analyses || 0,
							counts.new_analyses || 0,
							(counts.sample_admissions || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Admission Form Rules - IP_ADMISSION_FORM_RULES'), () => {
			open_direct_excel_upload({
				dialog_title: __('Admission Form Rules (IP_ADMISSION_FORM_RULES)'),
				preview_method:
					'healthcare.api.ip_admission_form_rules_import.preview_ip_admission_form_rules_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_form_rules_import_migration',
				job_key: 'ip_admission_form_rules_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Admission Form Rules from IP_ADMISSION_FORM_RULES?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing rules (will update): {3}\n'
							+ 'New: {4}\n\n'
							+ 'TRANS_NUM → trans_no; headers and details mapped directly.\n'
							+ 'Sample TRANS_NUM: {5}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_rules || 0,
							counts.new_rules || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Visit History — VISIT_00_01_HISTORY'), () => {
			open_direct_excel_upload({
				dialog_title: __('Visit History (VISIT_00_01_HISTORY)'),
				preview_method:
					'healthcare.api.visit_00_01_history_import.preview_visit_00_01_history_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_visit_00_01_history_import_migration',
				job_key: 'visit_00_01_history_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import visit diagnosis history from VISIT_00_01_HISTORY?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique history rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Patients resolved: {4}\n'
							+ 'Visits resolved: {5}\n'
							+ 'Rows with diagnosis text: {6}\n\n'
							+ 'Mapping: VISIT_NUM → visit_num, VISIT_DATE → visit_date, '
							+ 'VISIT_PATIENT_NUM → Patient, VISIT_DIAGNOSIS_DETAIL → visit_diagnosis_detail, '
							+ 'CR_ID/CR_DATE → audit fields. Each row keyed by visit_num + CR_DATE.\n\n'
							+ 'Sample record keys: {7}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolved_patients || 0,
							counts.resolved_visits || 0,
							counts.with_diagnosis || 0,
							(counts.sample_record_keys || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Lab Test — LAB_003 + LAB_004'), () => {
			open_lab_test_bundle_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient Visit — VISIT_00_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Patient Visit Upload (VISIT_00_01)'),
				preview_method: 'healthcare.api.patient_visit_import.preview_patient_visit_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_visit_import_migration',
				job_key: 'patient_visit_import',
				build_confirm_message: (counts) => {
					const createSamples = (counts.sample_patients_to_create || [])
						.map((row) => `${row.case_no} → ${row.patient}`)
						.join('\n');
					const createBlock =
						(counts.patients_to_create || 0) > 0
							? __(
									'Patients to auto-create: {0} ({1} unique File Nos)\n'
										+ 'Examples (Visit No → File No):\n{2}\n\n'
										+ 'A minimal Patient record will be created for each missing file number.\n\n',
									[
										counts.patients_to_create || 0,
										counts.unique_patients_to_create || 0,
										createSamples || __('(none)'),
									]
								)
							: '';
					return __(
						'Import Patient Visits from VISIT_00_01 (all sheets)?\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Visits (Visit No): {1}\n'
							+ 'Existing visits: {2}\n'
							+ '{3}'
							+ 'Visits are created with status Completed and submitted when possible.\n'
							+ 'Sample Visit Nos: {4}\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.visits || 0,
							counts.existing_visits || 0,
							createBlock,
							(counts.sample_case_nos || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Daily Patient Visit Setup — DAILY_PATIENTS_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Daily Patient Visit Setup Upload (DAILY_PATIENTS_01)'),
				preview_method:
					'healthcare.api.daily_patient_visit_setup_import.preview_daily_patient_visit_setup_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_daily_patient_visit_setup_import_migration',
				job_key: 'daily_patient_visit_setup_import',
				build_confirm_message: (counts) => {
					return __(
						'Import Daily Patient Visit Setup from DAILY_PATIENTS_01?\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Setups (TRANS_NUM): {1}\n'
							+ 'Existing setups: {2}\n'
							+ 'Patients to auto-create: {3}\n\n'
							+ 'Mapping: PATIENT_NUM → Patient, DOC_NUM → Practitioner, '
							+ 'START_DATE/END_DATE → from/to date, CR_DATE → entry/posting date, SERVICE_NUM/SERVICE_AMT (+ _2, _3) → services child table, '
							+ 'TRANS_NUM → trans_num (upsert key).\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.setups || 0,
							counts.existing_setups || 0,
							counts.patients_to_create || 0,
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Daily Auto Visit — DAILY_PATIENTS_02'), () => {
			open_direct_excel_upload({
				dialog_title: __('Daily Auto Visit Upload (DAILY_PATIENTS_02)'),
				preview_method: 'healthcare.api.daily_auto_visit_import.preview_daily_auto_visit_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_daily_auto_visit_import_migration',
				job_key: 'daily_auto_visit_import',
				build_confirm_message: (counts) => {
					return __(
						'Import Daily Auto Visits from DAILY_PATIENTS_02?\n\n'
							+ 'Excel rows: {0}\n'
							+ 'Visits: {1}\n'
							+ 'Existing visits: {2}\n'
							+ 'Patients to auto-create: {3}\n\n'
							+ 'Mapping: PATIENT_NUM → Patient, CR_DATE → encounter date (fallback YEAR_MONTH), '
							+ 'INV_NUM → case_no + inv_num, TRANS_NUM → old_trans_num, visit type Daily Auto Visit.\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.visits || 0,
							counts.existing_visits || 0,
							counts.patients_to_create || 0,
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Service Request — VISIT_00_02'), () => {
			open_direct_excel_upload({
				dialog_title: __('Service Request Upload (VISIT_00_02)'),
				preview_method:
					'healthcare.api.service_request_visit_import.preview_service_request_visit_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_service_request_visit_import_migration',
				job_key: 'service_request_visit_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const unmatched = counts.unmatched_serv_num_count
						? __('\nUnmatched SERV_NUM codes: {0} (e.g. {1})', [
							counts.unmatched_serv_num_count,
							(counts.unmatched_serv_nums || []).slice(0, 5).join(', ') || __('(none)'),
						])
						: '';
					const op0092 = counts.op_0092_resolved
						? __('OP-0092 → template {0}', [counts.op_0092_resolved])
						: __('OP-0092 → not found in Healthcare Service Template');
					return __(
						'Import Service Requests from VISIT_00_02 (all sheets)?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows (both sheets): {1}\n'
							+ 'Unique lines (after VISIT_NUM+SR_NUM dedup): {2}\n'
							+ 'Unique visits: {3}\n'
							+ 'Visits already in system: {4}\n'
							+ 'Visits to auto-create: {5}\n'
							+ 'Existing legacy service requests (will update): {6}\n'
							+ 'Unique SERV_NUM codes in Excel: {8}\n'
							+ 'Matched to Healthcare Service Template: {7} / {8}\n'
							+ 'Templates in database: {10}\n'
							+ '{11}\n'
							+ '{12}'
							+ '\n\nMapping: VISIT_NUM → Patient Visit, SERV_NUM → Order Template, '
							+ 'SERV_AMT_DISC → Discount, SERV_AMT_NET → Grand Total, '
							+ 'BRANCH_NUM → Cost Center (1=Serene Hospital, 2=Serene Center, 8=Jau Hospital), '
							+ 'CR_ID / CR_DATE preserved. Legacy ticked.\n'
							+ 'Service requests are submitted with status Completed.\n'
							+ 'Sample Visit Nos: {9}\n'
							+ 'Sample SERV_NUM codes: {13}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.service_requests || 0,
							counts.unique_visits || 0,
							counts.existing_visits || 0,
							counts.visits_to_create || 0,
							counts.existing_service_requests || 0,
							counts.matching_templates || 0,
							counts.unique_serv_nums || 0,
							(counts.sample_visit_nums || []).join(', ') || __('(none)'),
							counts.healthcare_service_templates_in_db || 0,
							op0092,
							unmatched,
							(counts.sample_serv_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Session Schedule — VISIT_00_05'), () => {
			open_direct_excel_upload({
				dialog_title: __('Session Schedule (VISIT_00_05)'),
				preview_method: 'healthcare.api.visit_00_05_import.preview_visit_00_05_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_visit_00_05_import_migration',
				job_key: 'visit_00_05_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const unmatched = counts.unmatched_template_count
						? __('\nUnmatched SERV_NUM codes: {0} (e.g. {1})', [
							counts.unmatched_template_count,
							(counts.sample_unmatched_templates || []).join(', ') || __('(none)'),
						])
						: '';
					return __(
						'Import OP session notes into Session Schedule from VISIT_00_05?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique session lines: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Patients resolved: {4}\n'
							+ 'Visits resolved: {5}\n'
							+ 'Templates matched: {6}\n'
							+ 'Rows with doc remarks: {7}\n'
							+ '{8}\n\n'
							+ 'Mapping: VISIT_NUM → Patient Visit, PATIENT_NUM → Patient, '
							+ 'SERV_NUM → Session Code (Healthcare Service Template), '
							+ 'DOC_REMARKS → doc_remarks, CR_DATE → date/from_time, '
							+ 'status → Completed, visit_00_05 checked.\n\n'
							+ 'Sample record keys: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolved_patients || 0,
							counts.resolved_visits || 0,
							counts.resolved_templates || 0,
							counts.with_doc_remarks || 0,
							unmatched,
							(counts.sample_record_keys || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('IP Service — SRV_00_03 — child 004'), () => {
			open_ip_service_bundle_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('IP Service 2 - IP_ADMISSION_03'), () => {
			open_direct_excel_upload({
				dialog_title: __('IP Service 2 (IP_ADMISSION_03)'),
				preview_method:
					'healthcare.api.ip_admission_03_import.preview_ip_admission_03_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_03_import_migration',
				job_key: 'ip_admission_03_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import IP Services from IP_ADMISSION_03?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM transactions: {2}\n'
							+ 'Existing IP Services (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Admissions unresolved: {6}\n'
							+ 'Rows missing patient: {7}\n'
							+ 'Patient/admission mismatches: {8}\n'
							+ 'Multi-line transactions: {9}\n\n'
							+ 'One IP Service per TRANS_NUM; service lines go in the Services child table. '
							+ 'PATIENT_NUM / ADMISSION_NUM commas stripped; BRANCH_NUM → cost center.\n'
							+ 'Sample TRANS_NUM: {10}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_services || 0,
							counts.new_services || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.skip_no_patient || 0,
							counts.skip_patient_mismatch || 0,
							counts.multi_line_transactions || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Prescription - IP_ADMISSION_MEDICINE'), () => {
			open_direct_excel_upload({
				dialog_title: __('Prescription - IP_ADMISSION_MEDICINE'),
				preview_method:
					'healthcare.api.patient_medication_order_import.preview_patient_medication_order_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_medication_order_import_migration',
				job_key: 'patient_medication_order_import',
				allowed_file_types: ['.csv', '.xlsx', '.xls'],
				freeze_message: __('Reading file (all worksheets)…'),
				build_confirm_message: (counts) =>
					__(
						'Import IP prescriptions into Patient Medication Order?\n\n'
							+ 'File rows: {0}\n'
							+ 'Distinct admissions: {1}\n'
							+ 'Medicine lines: {2}\n'
							+ 'Admissions matched in system: {3}\n'
							+ 'Rows with blank admission: {4}\n\n'
							+ 'Both Excel sheets are read. Rows with the same admission are grouped into one '
							+ 'prescription (multiple child medicines). Each order is submitted with Completed status.\n\nContinue?',
						[
							counts.file_rows || 0,
							counts.admissions || 0,
							counts.medicine_lines || 0,
							counts.resolvable_admissions || 0,
							counts.unresolved_rows || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Prescription — HIS Patient Visit'), () => {
			open_direct_excel_upload({
				dialog_title: __('Prescription — HIS Patient Visit (PATIENT_VISIT_PRESCRIPTION_HIS)'),
				preview_method:
					'healthcare.api.patient_visit_prescription_his_import.preview_patient_visit_prescription_his_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_visit_prescription_his_import_migration',
				job_key: 'patient_visit_prescription_his_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import OP visit prescriptions (HIS) into Patient Medication Order from PATIENT_VISIT_PRESCRIPTION_HIS?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw medicine rows: {1}\n'
							+ 'Rows without VISIT_CD (skipped): {7}\n'
							+ 'Distinct visits: {2}\n'
							+ 'Existing PMOs (will update): {3}\n'
							+ 'Visits with resolvable patient: {4}\n'
							+ 'Visits with resolvable Patient Visit: {5}\n\n'
							+ 'One PMO per visit with auto-generated trans_no and all medicines in '
							+ 'medication_orders. Legacy VISIT_CD stored on visit_cd. '
							+ 'MEDICINE_CD links to ITEM_00_01. FREQUENCY → Prescription Frequency. '
							+ 'Submitted with Completed status.\n\n'
							+ 'Sample visit CD keys: {6}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.excel_rows || counts.medicine_lines || 0,
							counts.visits || 0,
							counts.existing_records || 0,
							counts.resolvable_patients || 0,
							counts.resolvable_visits || 0,
							(counts.sample_visit_cds || []).join(', ') || __('(none)'),
							counts.skipped_rows || 0,
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Prescription — Patient Visit Prescription'), () => {
			open_direct_excel_upload({
				dialog_title: __('Prescription — Patient Visit Prescription (PATIENT_VISIT_PRESCRIPTION)'),
				preview_method:
					'healthcare.api.patient_visit_prescription_import.preview_patient_visit_prescription_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_visit_prescription_import_migration',
				job_key: 'patient_visit_prescription_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import OP visit prescriptions into Patient Medication Order from PATIENT_VISIT_PRESCRIPTION?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw medicine rows: {1}\n'
							+ 'Rows without VISIT_CD (skipped): {7}\n'
							+ 'Distinct visits: {2}\n'
							+ 'Existing PMOs (will update): {3}\n'
							+ 'Visits with resolvable patient: {4}\n'
							+ 'Visits with resolvable Patient Visit: {5}\n\n'
							+ 'One PMO per visit with auto-generated trans_no and medicines in medication_orders. '
							+ 'Legacy VISIT_CD stored on visit_cd for matching. '
							+ 'NOTE → instructions, FREQUENCY → Prescription Frequency. '
							+ 'Status set to Completed on upload.\n\n'
							+ 'Sample visit CD keys: {6}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.excel_rows || counts.medicine_lines || 0,
							counts.visits || 0,
							counts.existing_records || 0,
							counts.resolvable_patients || 0,
							counts.resolvable_visits || 0,
							(counts.sample_visit_cds || []).join(', ') || __('(none)'),
							counts.skipped_rows || 0,
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Repair OP Prescriptions'), () => {
			open_op_prescription_repair();
		}, __('Direct Upload'));

		frm.add_custom_button(__('IP Patient Short Leave — IP_PATIENT_SHORT_LEAVE'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('IP Patient Short Leave (IP_PATIENT_SHORT_LEAVE)'),
				preview_method:
					'healthcare.api.ip_patient_short_leave_import.preview_ip_patient_short_leave_import',
				import_method: 'healthcare.api.ip_patient_short_leave_import.run_ip_patient_short_leave_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import IP Patient Short Leave from IP_PATIENT_SHORT_LEAVE?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Rows with resolvable admission: {4}\n'
							+ 'Rows with resolvable patient: {5}\n\n'
							+ 'Mapping: TRANS_NUM → trans_num, ADMISSION_NUM → admission, PATIENT_NUM → patient_no, '
							+ 'DATE_FROM/TIME_FROM → date_from/time_from, DATE_TO/TIME_TO → date_to/time_to, '
							+ 'FINAL_COME_DATE → final_come_date, LEAVE_STATUS → leave_status, '
							+ 'BRANCH_NUM → branch (Cost Center).\n'
							+ 'Import runs immediately (no background job).\n\n'
							+ 'Sample TRANS_NUM keys: {6}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolvable_admissions || 0,
							counts.resolvable_patients || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Created: {1}\n'
							+ 'Updated: {2}\n'
							+ 'Skipped: {3}\n'
							+ 'Errors: {4}',
						[
							result.total || 0,
							result.created || 0,
							result.updated || 0,
							result.skipped || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('IP Grooming Chart'), () => {
			open_direct_excel_upload({
				dialog_title: __('IP Grooming Chart (IP_GROOMING_CHART)'),
				preview_method: 'healthcare.api.ip_grooming_chart_import.preview_ip_grooming_chart_import',
				start_method: 'healthcare.api.data_migration_jobs.start_ip_grooming_chart_import_migration',
				job_key: 'ip_grooming_chart_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import IP Grooming Chart from IP_GROOMING_CHART?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Rows with resolvable admission: {5}\n'
							+ 'Rows missing admission: {6}\n\n'
							+ 'Mapping: TRANS_NUM → trans_num, TRANS_DATE → date, ADMISSION_NUM/ADMISSION_NUM_OLD → admission, '
							+ 'grooming and meal flags → check fields, WEIGHT/LMP preserved, BRANCH_NUM → Cost Center.\n\n'
							+ 'Sample trans_num keys: {7}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.new_records || 0,
							counts.resolved_admissions || 0,
							counts.skip_no_admission || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Sleeping Pattern'), () => {
			open_direct_excel_upload({
				dialog_title: __('Sleeping Pattern (IP_SLEEPING_PATTERN)'),
				preview_method: 'healthcare.api.sleeping_pattern_import.preview_sleeping_pattern_import',
				start_method: 'healthcare.api.data_migration_jobs.start_sleeping_pattern_import_migration',
				job_key: 'sleeping_pattern_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Sleeping Pattern from IP_SLEEPING_PATTERN?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NO rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Rows with resolvable admission: {5}\n'
							+ 'Rows missing admission: {6}\n'
							+ 'Rows missing patient on admission: {7}\n\n'
							+ 'Mapping: TRANS_NO → standalone Sleeping Pattern.trans_no, TRANS_DATE → date, '
							+ 'ADMISSION_NUM/ADMISSION_NUM_OLD → admission_no, period columns → morning/evening/night datetimes, '
							+ 'BRANCH_NUM → Cost Center, CR/UP audit fields preserved.\n'
							+ 'This imports into the standalone Sleeping Pattern doctype, not Admission Detail.\n\n'
							+ 'Sample trans_no keys: {8}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.new_records || 0,
							counts.resolved_admissions || 0,
							counts.skip_no_admission || 0,
							counts.skip_no_patient || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Sick Leave — PATIENT_SICK_LEAVE_01'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Sick Leave (PATIENT_SICK_LEAVE_01)'),
				preview_method:
					'healthcare.api.patient_sick_leave_import.preview_patient_sick_leave_import',
				import_method: 'healthcare.api.patient_sick_leave_import.run_patient_sick_leave_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Sick Leave from PATIENT_SICK_LEAVE_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Rows with resolvable patient: {4}\n'
							+ 'Rows with resolvable admission: {5}\n'
							+ 'Rows with resolvable doctor: {6}\n\n'
							+ 'Mapping: TRANS_NUM → trans_no, SR_NUM → sr_no, PATIENT_NUM → patient, '
							+ 'ADMISSION_NUM → admission_no, IP_OP_SOURCE → source, FROM_DATE/TO_DATE → dates, '
							+ 'TOTAL_DAYS → days, DIAGNOSIS_DETAIL → diagnosis, DOC_NUM → doctor.\n'
							+ 'Sets from_sick_01 and legacy flags. Import runs immediately.\n\n'
							+ 'Sample trans_no keys: {7}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolvable_patients || 0,
							counts.resolvable_admissions || 0,
							counts.resolvable_doctors || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Created: {1}\n'
							+ 'Updated: {2}\n'
							+ 'Skipped: {3}\n'
							+ 'Errors: {4}',
						[
							result.total || 0,
							result.created || 0,
							result.updated || 0,
							result.skipped || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient Sick Leave — PATIENT_SICK_LEAVE'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Patient Sick Leave (PATIENT_SICK_LEAVE)'),
				preview_method:
					'healthcare.api.patient_sick_leave_record_import.preview_patient_sick_leave_record_import',
				import_method:
					'healthcare.api.patient_sick_leave_record_import.run_patient_sick_leave_record_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Patient Sick Leave from PATIENT_SICK_LEAVE?\n\n'
							+ 'Note: This is a separate legacy doctype from Sick Leave (PATIENT_SICK_LEAVE_01).\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique Trans No rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Rows with resolvable patient: {4}\n'
							+ 'Rows with resolvable admission: {5}\n'
							+ 'Rows with resolvable visit: {6}\n'
							+ 'Rows with resolvable practitioner: {7}\n\n'
							+ 'Mapping: Trans No → trans_no, PATIENT_FILE_NO → patient, '
							+ 'START_DATE/END_DATE → dates, DOCTOR_CD → practitioner, '
							+ 'TRANS_SOURCE → trans_source, ADMISSION_NUM/VISIT_NUM → links, '
							+ 'BRANCH_NUM → branch.\n'
							+ 'Import runs immediately.\n\n'
							+ 'Sample trans_no keys: {8}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolvable_patients || 0,
							counts.resolvable_admissions || 0,
							counts.resolvable_visits || 0,
							counts.resolvable_practitioners || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Created: {1}\n'
							+ 'Updated: {2}\n'
							+ 'Skipped: {3}\n'
							+ 'Errors: {4}',
						[
							result.total || 0,
							result.created || 0,
							result.updated || 0,
							result.skipped || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Legacy Sales — SALES_DATA_MASTER'), () => {
			open_direct_excel_upload({
				dialog_title: __('Legacy Sales Transactions (SALES_DATA_MASTER)'),
				preview_method: 'healthcare.api.legacy_sales_master_import.preview_legacy_sales_master_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_legacy_sales_master_import_migration',
				job_key: 'legacy_sales_master_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Legacy Sales Transactions from SALES_DATA_MASTER?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Sample resolve checks (first {5} rows):\n'
							+ '  Visits resolved: {6}\n'
							+ '  Patients from visit: {7}\n'
							+ '  Admissions resolved: {8}\n'
							+ '  Branches mapped: {9}\n\n'
							+ 'Mapping: TRANS_NUM → Trans No (ID), VISIT_NUM → Patient Visit '
							+ '(patient + patient name from visit), ADMISSION_NUM → Admission, '
							+ 'BRANCH_NUM → Cost Center (1=Serene Hospital, 2=Serene Center, 8=Jau Hospital), '
							+ 'CR_DATE → Date Created. Item lines are imported separately from DETAILS.\n'
							+ 'Sample TRANS_NUM: {10}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.new_records || 0,
							counts.sample_size || 0,
							counts.resolved_visits || 0,
							counts.resolved_patients || 0,
							counts.resolved_admissions || 0,
							counts.resolved_branches || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Legacy Sales Detail — SALES_DATA_DETAILS'), () => {
			open_direct_excel_upload({
				dialog_title: __('Legacy Sales Detail (SALES_DATA_DETAILS)'),
				preview_method:
					'healthcare.api.legacy_sales_detail_import.preview_legacy_sales_detail_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_legacy_sales_detail_import_migration',
				job_key: 'legacy_sales_detail_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Legacy Sales item lines from SALES_DATA_DETAILS?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Detail rows: {1}\n'
							+ 'Distinct TRANS_NUM: {2}\n'
							+ 'Parents already imported (master): {3}\n'
							+ 'Missing parents (will be auto-created as stubs): {4}\n'
							+ 'ITEM_NUM resolved to ITEM_00_01 (sample of {5}): {6}\n\n'
							+ 'Lines append to the Items child table by TRANS_NUM + SR_NUM. '
							+ 'If a parent is missing, it is created automatically so no lines are skipped. '
							+ 'ITEM_NUM links to legacy ITEM_00_01 (not ERP Item).\n'
							+ 'Sample TRANS_NUM: {7}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.excel_rows || 0,
							counts.transactions || 0,
							counts.linked_parents || 0,
							counts.missing_parents || 0,
							counts.sample_size || 0,
							counts.resolved_items || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Backfill Legacy Sales Item Links'), () => {
			frappe.call({
				method: 'healthcare.api.legacy_sales_item_link_backfill.preview_legacy_sales_item_link_backfill',
				callback(preview) {
					const counts = preview.message || {};
					const sample = (counts.sample || [])
						.map(
							(row) =>
								`${row.parent} line ${row.sr_num}: item_num “${row.item_num}” → ITEM_00_01 “${row.item}”`
								+ (row.item_name ? ` (${row.item_name})` : '')
						)
						.join('\n');
					const unmatched = (counts.unmatched_sample || [])
						.map(
							(row) =>
								`${row.parent} line ${row.sr_num}: item_num “${row.item_num}” (not in ITEM_00_01)`
						)
						.join('\n');
					if (!counts.candidates) {
						frappe.msgprint({
							title: __('Legacy Sales Item Links'),
							message: __('No Legacy Sales item lines with item_num and a blank Item link.'),
							indicator: 'green',
						});
						return;
					}
					frappe.confirm(
						__(
							'Run in background: on Legacy Sales Transaction Item lines that already have values, '
							+ 'have Item Num, and have a blank Item link, look up Item Num on ITEM_00_01 '
							+ 'and set the Item field when the code exists.\n\n'
							+ 'Lines with item_num and blank Item: {0}\n'
							+ 'Will set Item (ITEM_00_01 found){1}: {2}\n'
							+ 'Will skip (item_num not on ITEM_00_01){1}: {3}\n'
							+ 'ITEM_00_01 records: {4}\n\n'
							+ 'Sample to update:\n{5}\n\n'
							+ 'Sample unmatched:\n{6}\n\nContinue?',
							[
								counts.candidates || 0,
								counts.counts_are_estimate ? __(' (estimate)') : '',
								counts.needs_update || 0,
								counts.skipped_unmatched || 0,
								counts.item_00_01_count || 0,
								sample || __('(none)'),
								unmatched || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.legacy_sales_item_link_backfill.start_legacy_sales_item_link_backfill',
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('legacy_sales_item_link_backfill');
									}
								},
							});
						}
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('Patient Adjustment — PATIENT_ADJUSTMENT_01'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Patient Adjustment (PATIENT_ADJUSTMENT_01)'),
				preview_method: 'healthcare.api.patient_adjustment_import.preview_patient_adjustment_import',
				import_method: 'healthcare.api.patient_adjustment_import.run_patient_adjustment_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Patient Adjustment rows from PATIENT_ADJUSTMENT_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'From patients resolved: {4}\n'
							+ 'To patients resolved: {5}\n'
							+ 'From admissions resolved: {6}\n'
							+ 'To admissions resolved: {7}\n\n'
							+ 'Mapping: TRANS_NUM → trans_no (ID), FROM/TO patient & admission → Link fields, '
							+ 'BRANCH_NUM → branch (Cost Center), amounts and remarks preserved.\n'
							+ 'Import runs immediately (no background job).\n\n'
							+ 'Sample trans_no keys: {8}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolvable_from_patients || 0,
							counts.resolvable_to_patients || 0,
							counts.resolvable_from_admissions || 0,
							counts.resolvable_to_admissions || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Created: {1}\n'
							+ 'Updated: {2}\n'
							+ 'Skipped: {3}\n'
							+ 'Errors: {4}',
						[
							result.total || 0,
							result.created || 0,
							result.updated || 0,
							result.skipped || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('IP Service Return — SERVICE_RETURN_01 + 02'), () => {
			open_service_return_ip_service_upload();
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient Adjustment Detail — PATIENT_ADJUSTMENT_02'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Patient Adjustment Detail (PATIENT_ADJUSTMENT_02)'),
				preview_method:
					'healthcare.api.patient_adjustment_detail_import.preview_patient_adjustment_detail_import',
				import_method:
					'healthcare.api.patient_adjustment_detail_import.run_patient_adjustment_detail_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Patient Adjustment Detail lines from PATIENT_ADJUSTMENT_02?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique detail rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Adjustment headers in file: {4}\n'
							+ 'Lines linked to Patient Adjustment (01): {5}\n\n'
							+ 'Mapping: TRANS_NUM → adjustment_trans_no, SR_NUM → line number, '
							+ 'trans_no is built as adjustment trans no + SR_NUM (e.g. PJV/2021/00002-1). '
							+ 'INV_NUM and invoice amounts are preserved. '
							+ 'Links to Patient Adjustment when header exists.\n'
							+ 'Import runs immediately (no background job).\n\n'
							+ 'Sample trans_no keys: {6}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.adjustment_headers || 0,
							counts.linked_headers || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Created: {1}\n'
							+ 'Updated: {2}\n'
							+ 'Skipped: {3}\n'
							+ 'Linked to Patient Adjustment: {4}\n'
							+ 'Errors: {5}',
						[
							result.total || 0,
							result.created || 0,
							result.updated || 0,
							result.skipped || 0,
							result.linked_headers || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient Medical Report — PATIENT_MEDICAL_REPORT_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Patient Medical Report (PATIENT_MEDICAL_REPORT_01)'),
				preview_method:
					'healthcare.api.patient_medical_report_import.preview_patient_medical_report_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_medical_report_import_migration',
				job_key: 'patient_medical_report_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Patient Medical Report rows from PATIENT_MEDICAL_REPORT_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Patients resolved: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Visits resolved: {6}\n'
							+ 'Practitioners resolved: {7}\n'
							+ 'Rows with report text: {8}\n\n'
							+ 'Mapping: TRANS_NUM → trans_no, PATIENT_NUM → Patient, '
							+ 'ADMISSION_NUM → Inpatient Admission, VISIT_NUM → Patient Visit, '
							+ 'REFF_NUM → reference_no, DOCTOR_NUM → Practitioner, '
							+ 'REPORT_DATA_* → report text fields, BRANCH_NUM → Cost Center.\n\n'
							+ 'Sample trans_no keys: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolved_patients || 0,
							counts.resolved_admissions || 0,
							counts.resolved_visits || 0,
							counts.resolved_practitioners || 0,
							counts.with_report_text || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('ECT Details - ECT 001'), () => {
			open_direct_excel_upload({
				dialog_title: __('ECT Details (ECT_00_01)'),
				preview_method: 'healthcare.api.ect_details_import.preview_ect_details_import',
				start_method: 'healthcare.api.data_migration_jobs.start_ect_details_import_migration',
				job_key: 'ect_details_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import ECT Details from ECT_00_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'Patients resolved: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Visits resolved: {6}\n'
							+ 'Practitioners resolved: {7}\n'
							+ 'OP rows: {8}\n'
							+ 'IP rows: {9}\n\n'
							+ 'Mapping: TRANS_NUM → trans_num, TRANS_DATE/TIME → date/time, '
							+ 'PATIENT_NUM → patient, VISIT_NUM or ADMISSION_NUM → reference_doctype/reference_name, '
							+ 'CR_DATE kept on its own field, BRANCH_NUM → Cost Center. '
							+ 'Missing legacy columns are stored on ECT Details.\n\n'
							+ 'Sample trans_num keys: {10}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolved_patients || 0,
							counts.resolved_admissions || 0,
							counts.resolved_visits || 0,
							counts.resolved_practitioners || 0,
							counts.op_rows || 0,
							counts.ip_rows || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('ECT Details Attribute - ECT 002'), () => {
			open_direct_excel_upload({
				dialog_title: __('ECT Details Attribute (ECT_00_02)'),
				preview_method: 'healthcare.api.ect_details_attribute_import.preview_ect_details_attribute_import',
				start_method: 'healthcare.api.data_migration_jobs.start_ect_details_attribute_import_migration',
				job_key: 'ect_details_attribute_import',
				freeze_message: __('Reading Excel…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import ECT Details Attribute rows from ECT_00_02?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Parent TRANS_NUM groups: {2}\n'
							+ 'Existing ECT Details parents: {3}\n'
							+ 'Missing parent ECT Details: {4}\n'
							+ 'Rows matching template attrib_num: {5}\n\n'
							+ 'Mapping: TRANS_NUM → ECT Details.trans_num, ATTRIB_NUM → child attrib_num, '
							+ 'ORDER_OF_ATTRIB → order_of_attrib, ATT_NOTES → att_notes. '
							+ 'Parent template seeds the child rows first, then notes are filled by attrib_num.\n\n'
							+ 'Sample trans_num keys: {6}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.parents || 0,
							counts.existing_parents || 0,
							counts.missing_parents || 0,
							counts.matching_template_rows || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Transfer ECT Details → ECT Procedure'), () => {
			frappe.call({
				method: 'healthcare.api.ect_details_to_procedure.preview_ect_details_to_procedure_transfer',
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Transfer all ECT Details into ECT Procedure?<br><br>'
								+ 'ECT Details records: {0}<br>'
								+ 'With a Patient: {1}<br>'
								+ 'Already linked: {2}<br>'
								+ 'Pending create: {3}<br><br>'
								+ 'Each ECT Details row upserts one ECT Procedure (create or refresh matching fields). '
								+ 'New ECT Details saves already sync automatically; this backfills older rows. '
								+ 'Re-running never duplicates a record. This runs in the background.<br><br>Continue?',
							[
								counts.total_details || 0,
								counts.with_patient || 0,
								counts.already_transferred || 0,
								counts.pending || 0,
							]
						),
						() => run_migration_job(
							frm,
							'start_ect_details_to_procedure_transfer',
							'ect_details_to_procedure_transfer'
						)
					);
				},
			});
		}, __('Data Maintenance'));

		frm.add_custom_button(__('ECT Conversion'), () => {
			const dialog = new frappe.ui.Dialog({
				title: __('ECT Conversion'),
				fields: [
					{
						fieldname: 'from_date',
						label: __('From Encounter Date'),
						fieldtype: 'Date',
						reqd: 1,
					},
					{
						fieldname: 'to_date',
						label: __('To Encounter Date'),
						fieldtype: 'Date',
						reqd: 1,
					},
				],
				primary_action_label: __('Preview & Convert'),
				primary_action(values) {
					if (values.from_date > values.to_date) {
						frappe.msgprint({
							title: __('Invalid date range'),
							message: __('From Encounter Date must be on or before To Encounter Date.'),
							indicator: 'orange',
						});
						return;
					}
					frappe.call({
						method: 'healthcare.api.ect_conversion.preview_ect_conversion',
						args: {
							from_date: values.from_date,
							to_date: values.to_date,
						},
						freeze: true,
						freeze_message: __('Counting ECT request visits…'),
						callback(preview) {
							const counts = preview.message || {};
							if (!counts.pending) {
								frappe.msgprint({
									title: __('ECT Conversion'),
									indicator: 'green',
									message: __(
										'Nothing to convert: each of the {0} ECT-request Patient Visit(s) with an encounter date between {1} and {2} already has an ECT Service.',
										[
											counts.visits || 0,
											counts.from_date,
											counts.to_date,
										]
									),
								});
								return;
							}
							frappe.confirm(
								__(
									'Convert ECT requests into ECT Services?<br><br>'
										+ 'Patient Visit encounter dates: {0} → {1}<br>'
										+ 'ECT-request visits in range: {2} (OP {3}, IP {4})<br>'
										+ 'Already have an ECT Service: {5}<br>'
										+ '<b>To convert: {6}</b><br>'
										+ 'Visits without a practitioner: {7}<br><br>'
										+ 'Each visit gets the same draft ECT Service Request + ECT Service it would get when created, '
										+ 'using the default ECT OP service ({8}) and ECT IP service ({9}). '
										+ 'Every ECT Service is dated with its Patient Visit encounter date, not with today. '
										+ 'Visits that already have an ECT Service are skipped, so this can be re-run safely. '
										+ 'The conversion runs in the background.<br><br>Continue?',
									[
										counts.from_date,
										counts.to_date,
										counts.visits || 0,
										counts.op_visits || 0,
										counts.ip_visits || 0,
										counts.already_converted || 0,
										counts.pending || 0,
										counts.without_practitioner || 0,
										counts.default_op_service || __('not set'),
										counts.default_ip_service || __('not set'),
									]
								),
								() => {
									frappe.call({
										method: 'healthcare.api.ect_conversion.start_ect_conversion',
										args: {
											from_date: values.from_date,
											to_date: values.to_date,
										},
										freeze: true,
										freeze_message: __('Starting background job…'),
										callback(r) {
											if (r.message?.ok) {
												dialog.hide();
												frappe.show_alert({
													message: r.message.message || __('Job started'),
													indicator: 'green',
												});
												poll_migration_status('ect_conversion');
											}
										},
									});
								}
							);
						},
					});
				},
			});
			dialog.show();
		}, __('ECT'));

		frm.add_custom_button(__('Practitioner Unavailability - APPOINTMENTS_HOLD_01'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Practitioner Unavailability - APPOINTMENTS_HOLD_01'),
				preview_method:
					'healthcare.api.practitioner_unavailability_import.preview_practitioner_unavailability_import',
				import_method:
					'healthcare.api.practitioner_unavailability_import.run_practitioner_unavailability_import',
				build_confirm_message: (counts) =>
					__(
						'Import Practitioner Unavailability from APPOINTMENTS_HOLD_01?\n\n'
							+ 'Rows: {0}\n'
							+ 'Existing records (will update): {1}\n'
							+ 'Rows with resolvable practitioner (DOC_CODE): {2}\n'
							+ 'Unique doctor codes: {3}\n'
							+ 'Cancelled rows (IS_CANCEL=Y): {4}\n\n'
							+ 'Mapping: TRANS_NUM → Tran Num, DOC_CODE → Doctor ID, '
							+ 'START_DATE/END_DATE → dates, BRANCH_NUM → Branch (Cost Center), '
							+ 'IS_CANCEL → Is Cancel, ANY_REMARKS → remarks.\n'
							+ 'Import runs immediately (no background job).\n\nContinue?',
						[
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.resolvable_practitioners || 0,
							counts.unique_doc_codes || 0,
							counts.cancelled_rows || 0,
						]
					),
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Created: {1}\n'
							+ 'Updated: {2}\n'
							+ 'Practitioners auto-created: {3}\n'
							+ 'Skipped: {4}\n'
							+ 'Errors: {5}',
						[
							result.total || 0,
							result.created || 0,
							result.updated || 0,
							result.practitioners_created || 0,
							result.skipped || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Psychiatric Item Max Dose'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Psychiatric Item Max Dose'),
				preview_method:
					'healthcare.api.psychiatric_item_max_dose_import.preview_psychiatric_item_max_dose_import',
				import_method:
					'healthcare.api.psychiatric_item_max_dose_import.run_psychiatric_item_max_dose_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Update Item max-dose fields from psychiatric Excel?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Skipped duplicate rows: {2}\n'
							+ 'Unique item codes: {3}\n'
							+ 'Matched Items: {4}\n'
							+ 'Missing Items: {5}\n\n'
							+ 'Mapping: Item Code → Item lookup, Drug Category → custom_drug_category, '
							+ 'Max Dose - Per Single Dose → custom_max_dose_per_single_dose, '
							+ 'Max Dose - Per Day → custom_max_dose_per_day, High Alert? → custom_high_alert, '
							+ 'Clinical Notes → description.\n'
							+ 'Import runs immediately (no background job).\n\n'
							+ 'Sample item codes: {6}\n'
							+ 'Sample missing codes: {7}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.skipped_duplicate_rows || 0,
							counts.excel_rows || 0,
							counts.matched_items || 0,
							counts.missing_items || 0,
							(counts.sample_item_codes || []).join(', ') || __('(none)'),
							(counts.sample_missing_codes || []).join(', ') || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Updated: {1}\n'
							+ 'Not found: {2}\n'
							+ 'Skipped: {3}\n'
							+ 'Errors: {4}',
						[
							result.total || 0,
							result.updated || 0,
							result.not_found || 0,
							result.skipped || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Injection / Long-Acting Max Dose'), () => {
			open_direct_sync_excel_upload({
				dialog_title: __('Injection / Long-Acting Max Dose'),
				preview_method:
					'healthcare.api.injection_max_dose_import.preview_injection_max_dose_import',
				import_method:
					'healthcare.api.injection_max_dose_import.run_injection_max_dose_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Update Item dose fields from injection Excel?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Rows: {1}\n'
							+ 'Matched Items: {2}\n'
							+ 'Missing Items: {3}\n'
							+ 'Daily rows: {4}\n'
							+ 'Long-acting rows: {5}\n\n'
							+ 'Daily → Max Single Dose + Max Per Day.\n'
							+ 'Long-acting → Maximum Single Dose Long Acting, Dosing Period, '
							+ 'Max Within Period, Remarks (does NOT write depot totals into Max Per Day).\n\n'
							+ 'Sample codes: {6}\n'
							+ 'Sample missing: {7}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.excel_rows || 0,
							counts.matched_items || 0,
							counts.missing_items || 0,
							counts.daily_rows || 0,
							counts.long_acting_rows || 0,
							(counts.sample_item_codes || []).join(', ') || __('(none)'),
							(counts.sample_missing_codes || []).join(', ') || __('(none)'),
						]
					);
				},
				build_result_message: (result) =>
					__(
						'Import complete.\n\n'
							+ 'Total: {0}\n'
							+ 'Updated: {1} (daily {2}, long-acting {3})\n'
							+ 'Not found: {4}\n'
							+ 'Skipped: {5}\n'
							+ 'Errors: {6}',
						[
							result.total || 0,
							result.updated || 0,
							result.daily_updated || 0,
							result.long_acting_updated || 0,
							result.not_found || 0,
							result.skipped || 0,
							result.errors || 0,
						]
					),
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient appointment - APPOINTMENTS_INFO_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Patient Appointment (APPOINTMENTS_INFO_01)'),
				preview_method:
					'healthcare.api.patient_appointment_info_import.preview_patient_appointment_info_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_patient_appointment_info_import_migration',
				job_key: 'patient_appointment_info_import',
				freeze_message: __('Reading Excel (all sheets)…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const statusLines = Object.entries(counts.status_counts || {})
						.map(([code, n]) => `${code}: ${n}`)
						.join(', ');
					const patientSamples = (counts.sample_patients_to_create || []).join(', ');
					return __(
						'Import Patient Appointments from APPOINTMENTS_INFO_01 (all sheets)?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique appointments (APP_NUM): {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Walk-ins (no PATIENT_NUM): {5}\n'
							+ 'Patients to auto-create: {6}\n'
							+ 'Sample missing File Nos: {7}\n\n'
							+ 'Mapping: APP_NUM → Trans No, DOC_CODE → practitioner/doc_code, '
							+ 'APP_DATE → Date, APP_TIME → Old Time, PATIENT_NUM → Patient '
							+ '(create if missing), PATIENT_CONTACT_NUM → Temporary Mobile No, '
							+ 'APP_REMARKS → Remarks, APP_STATUS → Old Status + ERP status '
							+ '(V→Closed, S→Scheduled/No Show, C→Cancelled), BRANCH_NUM → Cost Center.\n'
							+ 'Oracle status counts: {8}\n\n'
							+ 'Sample APP_NUMs: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_appointments || 0,
							counts.new_appointments || 0,
							counts.walk_ins || 0,
							counts.patients_to_create || 0,
							patientSamples || __('(none)'),
							statusLines || __('(none)'),
							(counts.sample_app_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Analyze: Appointments not imported'), () => {
			open_patient_appointment_import_analysis();
		}, __('Migration Analysis'));

		frm.add_custom_button(__('Analyze: CPR Photos'), () => {
			open_patient_cpr_photo_analysis();
		}, __('Migration Analysis'));

		frm.add_custom_button(__('Analyze: Legacy Signatures'), () => {
			open_patient_legacy_signature_analysis();
		}, __('Migration Analysis'));

		frm.add_custom_button(__('Analyze: Legacy Visit Documents'), () => {
			open_legacy_visit_document_analysis();
		}, __('Migration Analysis'));

		frm.add_custom_button(__('Analyze: Legacy Sales Master'), () => {
			open_legacy_sales_master_analysis();
		}, __('Migration Analysis'));

		frm.add_custom_button(__('Analyze: Legacy Sales Detail'), () => {
			open_legacy_sales_detail_analysis();
		}, __('Migration Analysis'));

		frm.add_custom_button(__('Diagnosis OP - VISIT_DIAGNOSES_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Diagnosis OP (VISIT_DIAGNOSES_01)'),
				preview_method:
					'healthcare.api.visit_diagnoses_op_import.preview_visit_diagnoses_op_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_visit_diagnoses_op_import_migration',
				job_key: 'visit_diagnoses_op_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const sourceLines = Object.entries(counts.sources || {})
						.map(([code, n]) => `${code}: ${n}`)
						.join(', ');
					return __(
						'Import Medical Diagnosis Entry rows from VISIT_DIAGNOSES_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Rows: {1}\n'
							+ 'Existing (will update): {2}\n'
							+ 'New: {3}\n'
							+ 'Matched Diagnosis codes: {4}\n'
							+ 'Unresolved Diagnosis codes: {5} (e.g. {6})\n'
							+ 'Skipped (no Diagnosis in Excel): {7}\n'
							+ 'Patients to auto-create: {8}\n'
							+ 'With Patient Visit: {9} ({10} resolved)\n'
							+ 'With Inpatient Admission: {11} ({12} resolved)\n'
							+ 'Source: {13}\n\n'
							+ 'Mapping: Patient → Patient, SR No → SR No, Diagnosis → Diagnosis, '
							+ 'Details → Details, CD Date → CD Date + Posting Date, CR ID / UP ID / UP Date, '
							+ 'Patient Visit → Patient Visit, Cost Center (branch name or number), '
							+ 'Inpatient Admission, Group Code, Source (OP/IP).\n\n'
							+ 'Sample trans_num keys: {14}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.excel_rows || 0,
							counts.existing_entries || 0,
							counts.new_entries || 0,
							counts.matched_diagnosis || 0,
							counts.unresolved_diagnosis_count || 0,
							(counts.unresolved_diagnosis_codes || []).join(', ') || __('(none)'),
							counts.skip_no_diagnosis || 0,
							counts.patients_to_create || 0,
							counts.with_visit_num || 0,
							counts.resolved_visits || 0,
							counts.with_admission || 0,
							counts.resolved_admissions || 0,
							sourceLines || __('(none)'),
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('VISIT_POSITIVE_FINDING_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('VISIT_POSITIVE_FINDING_01'),
				preview_method:
					'healthcare.api.visit_positive_finding_import.preview_visit_positive_finding_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_visit_positive_finding_import_migration',
				job_key: 'visit_positive_finding_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Visit Positive Finding from VISIT_POSITIVE_FINDING_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Rows with unmapped BRANCH_NUM: {5}\n\n'
							+ 'VISIT_NUM → visit_num (commas stripped); SR_NUM, CODE_NUM, '
							+ 'CODE_MORE_DETAIL, BRANCH_NUM → cost centre.\n'
							+ 'Sample VISIT_NUM: {6}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_findings || 0,
							counts.new_findings || 0,
							counts.skip_no_cost_center || 0,
							(counts.sample_visit_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Visit Complain — VISIT_COMPLAIN_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Visit Complain (VISIT_COMPLAIN_01)'),
				preview_method:
					'healthcare.api.visit_complain_01_import.preview_visit_complain_01_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_visit_complain_01_import_migration',
				job_key: 'visit_complain_01_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Visit Complain from VISIT_COMPLAIN_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Rows with unmapped BRANCH_NUM: {5}\n\n'
							+ 'Mapping: VISIT_NUM → visit_num, SR_NUM, CODE_NUM, CODE_MORE_DETAIL, '
							+ 'CR_DATE → date, time, and cr_date (full legacy value), '
							+ 'BRANCH_NUM → branch (Cost Center).\n'
							+ 'Sample VISIT_NUM: {6}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_records || 0,
							counts.new_records || 0,
							counts.skip_no_cost_center || 0,
							(counts.sample_visit_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Diagnosis IP - IP_ADMISSION_DIAGNOSES'), () => {
			open_direct_excel_upload({
				dialog_title: __('Diagnosis IP (IP_ADMISSION_DIAGNOSES)'),
				preview_method:
					'healthcare.api.ip_admission_diagnoses_import.preview_ip_admission_diagnoses_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_diagnoses_import_migration',
				job_key: 'ip_admission_diagnoses_import',
				freeze_message: __('Reading Excel (all sheets)…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Medical Diagnosis Entry rows from IP_ADMISSION_DIAGNOSES (all sheets)?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Skipped (no DIAGNOSES_DESC): {5}\n'
							+ 'With ADMISSION_NUM: {6}\n'
							+ 'Admissions resolved: {7}\n'
							+ 'Admissions unresolved: {8}\n\n'
							+ 'Mapping: TRANS_NUM → trans_num (IPDX/…), ADMISSION_NUM → Inpatient Admission, '
							+ 'DIAGNOSES_FLAG → Diagnoses Flag, DIAGNOSES_DESC → Details, '
							+ 'Diagnosis Date / DIAGNOSES_DATE → Posting Date, '
							+ 'From Time / DIAGNOSES_TIME → Writing Diagnosis Time, '
							+ 'User Name → Practitioner Name, Cost Center / BRANCH_NUM → Cost Center '
							+ '(branch name or number), CR/UP fields, Source = IP.\n'
							+ 'Patient is set from the resolved admission.\n\n'
							+ 'Sample trans_num keys: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_entries || 0,
							counts.new_entries || 0,
							counts.skip_no_details || 0,
							counts.with_admission_num || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Clinical Note - IP_ADMISSION_DIAGNOSES'), () => {
			open_direct_excel_upload({
				dialog_title: __('Clinical Note (IP_ADMISSION_DIAGNOSES)'),
				preview_method:
					'healthcare.api.ip_admission_clinical_note_import.preview_ip_admission_clinical_note_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_clinical_note_import_migration',
				job_key: 'ip_admission_clinical_note_import',
				freeze_message: __('Reading Excel (all sheets)…'),
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const typeLines = Object.entries(counts.mapped_note_types || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join(', ');
					return __(
						'Import Clinical Note rows from IP_ADMISSION_DIAGNOSES (all sheets)?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Skipped (no DIAGNOSES_DESC): {5}\n'
							+ 'Admissions resolved: {6}\n'
							+ 'Admissions unresolved: {7}\n'
							+ 'Clinical Note Types (from Diagnosis Flag): {8}\n\n'
							+ 'Mapping: TRANS_NUM → trans_no, ADMISSION_NUM → Inpatient Admission, '
							+ 'DIAGNOSES_FLAG → Diagnosis Flag + Clinical Note Type, '
							+ 'DIAGNOSES_DESC → Note, DIAGNOSES_DATE → Posting Date, '
							+ 'DIAGNOSES_TIME / DIAGNOSES_TIME_TO → Diagnosis Time / To, '
							+ 'USER_NAME → UserName, BRANCH_NUM → Cost Center, CR/UP fields, '
							+ 'ADMISSION_NUM_OLD → Old Admission No.\n'
							+ 'Flag map: 1=Doctor Progress Note, 2=Psychologist, 3=Nutritionist, 4=General.\n\n'
							+ 'Sample trans_no keys: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_notes || 0,
							counts.new_notes || 0,
							counts.skip_no_note || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							typeLines || __('(none)'),
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Doctor Order - IP_DOCTOR_REQUEST_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Doctor Order (IP_DOCTOR_REQUEST_01)'),
				preview_method:
					'healthcare.api.ip_doctor_request_import.preview_ip_doctor_request_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_doctor_request_import_migration',
				job_key: 'ip_doctor_request_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const statusLines = Object.entries(counts.status_counts || {})
						.map(([code, n]) => `${code}: ${n}`)
						.join(', ');
					return __(
						'Import Doctor Order rows from IP_DOCTOR_REQUEST_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Rows: {1}\n'
							+ 'Will import: {2}\n'
							+ 'Empty DOC_ORDER_DESC (will use "-"): {3} (e.g. {4})\n'
							+ 'Existing (will update): {5}\n'
							+ 'Patients to auto-create: {6}\n'
							+ 'Admissions resolved: {7} / {8}\n'
							+ 'Doctors resolvable (DOC_NUM): {9}\n'
							+ 'Status counts: {10}\n\n'
							+ 'Mapping: TRANS_NUM → Trans No, TRANS_DATE → Trans Date, '
							+ 'DOC_ORDER_DESC → Order Description, ADMISSION_NUM → Inpatient Admission, '
							+ 'PATIENT_NUM → Patient (create if missing), DOC_NUM → Doctor, '
							+ 'DOC_DATE → Doctor Entry Date, JOB_STATUS → Status, '
							+ 'BRANCH_NUM → Cost Center (name or number), CR/UP fields, '
							+ 'REQUEST_TYPE → Request. Nurse columns skipped.\n\n'
							+ 'Sample Trans Nos: {11}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.excel_rows || 0,
							counts.importable_rows || 0,
							counts.empty_description || 0,
							(counts.sample_empty_description || []).join(', ') || __('(none)'),
							counts.existing_orders || 0,
							counts.patients_to_create || 0,
							counts.resolved_admissions || 0,
							counts.with_admission_num || 0,
							counts.resolved_doctors || 0,
							statusLines || __('(none)'),
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient Assessment - IP_PATIENT_ASSESSMENT'), () => {
			open_direct_excel_upload({
				dialog_title: __('Patient Assessment (IP_PATIENT_ASSESSMENT)'),
				preview_method:
					'healthcare.api.ip_patient_assessment_import.preview_ip_patient_assessment_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_patient_assessment_import_migration',
				job_key: 'ip_patient_assessment_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Patient Assessment directly from IP_PATIENT_ASSESSMENT?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique admissions (after dedup): {2}\n'
							+ 'Duplicate admission rows dropped: {3} ({4} admissions had multiple TRANS_NUM)\n'
							+ 'Template: {5}\n'
							+ 'Existing assessments (will update): {6}\n'
							+ 'New: {7}\n'
							+ 'Admissions resolved: {8}\n'
							+ 'Admissions unresolved: {9}\n\n'
							+ 'Creates one Patient Assessment per admission using template parameters '
							+ '(abbrev → Yes/No, *_DESC → comments), same logic as '
							+ '“Map IP Patient Assessment to Patient Assessment”.\n'
							+ 'Sample TRANS_NUM: {10}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.assessments || counts.excel_rows || 0,
							counts.duplicate_admission_rows || 0,
							counts.duplicate_admission_groups || 0,
							counts.assessment_template || __('Default Patient Evaluation'),
							counts.existing_assessments || 0,
							counts.new_assessments || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Vital Signs - IP_PATIENT_VITALS'), () => {
			open_direct_excel_upload({
				dialog_title: __('Vital Signs (IP_PATIENT_VITALS)'),
				preview_method:
					'healthcare.api.ip_patient_vitals_import.preview_ip_patient_vitals_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_patient_vitals_import_migration',
				job_key: 'ip_patient_vitals_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Vital Signs directly from IP_PATIENT_VITALS?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing vital signs (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Rows with admission: {5}\n'
							+ 'Admissions resolved: {6}\n'
							+ 'Admissions unresolved: {7}\n'
							+ 'Patients to auto-create: {8}\n\n'
							+ 'Maps RECORD_DATE → Date, RECORD_TIME (seconds) → Time, '
							+ 'branch → cost center, CR/UP audit fields preserved.\n'
							+ 'Sample TRANS_NUM: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_vitals || 0,
							counts.new_vitals || 0,
							counts.with_admission_num || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.patients_to_create || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Observation Level - IP_OBSERVATION_LEVEL'), () => {
			open_direct_excel_upload({
				dialog_title: __('Observation Level (IP_OBSERVATION_LEVEL)'),
				preview_method:
					'healthcare.api.ip_observation_level_import.preview_ip_observation_level_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_observation_level_import_migration',
				job_key: 'ip_observation_level_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const obsCodes = Object.entries(counts.obs_code_counts || {})
						.map(([code, n]) => `${code}: ${n}`)
						.join(', ');
					return __(
						'Import Observation records from IP_OBSERVATION_LEVEL?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing observations (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Admissions unresolved: {6}\n'
							+ 'OBS_CODE counts: {7}\n'
							+ 'Rows with blank/unmapped OBS_CODE (Observation Level left empty): {8}\n\n'
							+ 'OBS_CODE → Observation Level:\n'
							+ '1 General Observation, 2 Intermittent Observation,\n'
							+ '3 One to One (Within Eye Sight), 4 One to One (Within In Arm\'s Length).\n'
							+ 'Sample TRANS_NUM: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_observations || 0,
							counts.new_observations || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							obsCodes || __('(none)'),
							counts.unknown_obs_code_rows || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Morse Fall Scale - MORSE_FALL_SCALE_01'), () => {
			open_direct_excel_upload({
				dialog_title: __('Morse Fall Scale (MORSE_FALL_SCALE_01)'),
				preview_method:
					'healthcare.api.morse_fall_scale_import.preview_morse_fall_scale_excel_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_morse_fall_scale_excel_import_migration',
				job_key: 'morse_fall_scale_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Morse Fall Scale directly from MORSE_FALL_SCALE_01?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing scales (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Admissions unresolved: {6}\n'
							+ 'Patients to auto-create: {7}\n'
							+ 'Rows with no detail lines: {8}\n\n'
							+ 'TEXT_MESSAGE_1–7 / GET_POINTS_1–7 → Morse Fall Scale Detail child rows.\n'
							+ 'Sample TRANS_NUM: {9}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_scales || 0,
							counts.new_scales || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.patients_to_create || 0,
							counts.empty_detail_rows || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Patient History - IP_ADMISSION_02'), () => {
			open_direct_excel_upload({
				dialog_title: __('Patient History (IP_ADMISSION_02)'),
				preview_method:
					'healthcare.api.ip_admission_02_import.preview_ip_admission_02_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_02_import_migration',
				job_key: 'ip_admission_02_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Patient History from IP_ADMISSION_02?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Attribute rows: {1}\n'
							+ 'Distinct admissions: {2}\n'
							+ 'Admissions resolved: {3}\n'
							+ 'Admissions unresolved: {4}\n'
							+ 'Existing Patient History (will update): {5}\n'
							+ 'New: {6}\n'
							+ 'Rows matching template ATTRIB_NUM: {7}\n'
							+ 'Rows with unknown ATTRIB_NUM: {8}\n'
							+ 'Template: {9}\n\n'
							+ 'One Patient History per admission. Child history_detail lines are seeded '
							+ 'from the template; ATT_NOTES / FIELD1 / ATT_NOTES2 fill matching attributes '
							+ 'by ATTRIB_NUM. CR_DATE sets Patient History date when blank.\n'
							+ 'Use Data Maintenance → Backfill Patient History Dates or Delete Orphaned '
							+ 'Patient History if needed after import.\n'
							+ 'Sample admissions: {10}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.excel_rows || 0,
							counts.admissions || 0,
							counts.resolvable_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.existing_histories || 0,
							counts.new_histories || 0,
							counts.matching_attrib_rows || 0,
							counts.unknown_attrib_rows || 0,
							counts.template || __('Default History Form'),
							(counts.sample_admissions || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Nursing Note'), () => {
			open_direct_excel_upload({
				dialog_title: __('Nursing Note (nursing)'),
				preview_method:
					'healthcare.api.main_nursing_note_import.preview_main_nursing_note_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_main_nursing_note_import_migration',
				job_key: 'main_nursing_note_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Main Nursing Note from nursing Excel?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NUM rows: {2}\n'
							+ 'Existing notes (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Admissions unresolved: {6}\n'
							+ 'Rows missing nursing description: {7}\n\n'
							+ 'TRANS_NUM → trans_no; NURSING_DESC → nursing notes; '
							+ 'NURSING_DATE / NURSING_TIME → date / start time; '
							+ 'SHIFT_CODE (MOR/EVE/NGT) → Morning/Evening/Night.\n'
							+ 'Sample TRANS_NUM: {8}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_notes || 0,
							counts.new_notes || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.skip_no_notes || 0,
							(counts.sample_trans_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Physical Examination - IP_ADMISSION_PHY_EXAM'), () => {
			open_direct_excel_upload({
				dialog_title: __('Physical Examination (IP_ADMISSION_PHY_EXAM)'),
				preview_method:
					'healthcare.api.ip_admission_phy_exam_import.preview_ip_admission_phy_exam_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_ip_admission_phy_exam_import_migration',
				job_key: 'ip_admission_phy_exam_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					return __(
						'Import Physical Examination from IP_ADMISSION_PHY_EXAM?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw Excel rows: {1}\n'
							+ 'Unique TRANS_NO rows: {2}\n'
							+ 'Existing examinations (will update): {3}\n'
							+ 'New: {4}\n'
							+ 'Admissions resolved: {5}\n'
							+ 'Admissions unresolved: {6}\n'
							+ 'Patients to auto-create: {7}\n\n'
							+ 'PHYS_SIGNS → Skin/Hair/Nail/Gait/Surface/Abnormalities; '
							+ 'CVS_RESP, CNS, GIT, OTHERS mapped directly.\n'
							+ 'Sample TRANS_NO: {8}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.excel_rows || 0,
							counts.existing_examinations || 0,
							counts.new_examinations || 0,
							counts.resolved_admissions || 0,
							counts.unresolved_admissions || 0,
							counts.patients_to_create || 0,
							(counts.sample_trans_nos || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

		frm.add_custom_button(__('Lab Test Patient Visit — VISIT_00_03'), () => {
			open_direct_excel_upload({
				dialog_title: __('Lab Test Patient Visit (VISIT_00_03)'),
				preview_method: 'healthcare.api.lab_test_visit_import.preview_lab_test_visit_import',
				start_method:
					'healthcare.api.data_migration_jobs.start_lab_test_visit_import_migration',
				job_key: 'lab_test_visit_import',
				build_confirm_message: (counts) => {
					const sheetLines = Object.entries(counts.sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const unmatched = counts.unmatched_row_count
						? __('\nUnmatched lab template codes: {0} (e.g. {1})', [
							counts.unmatched_row_count,
							(counts.unmatched_codes || []).slice(0, 5).join(', ') || __('(none)'),
						])
						: '';
					return __(
						'Import Lab Tests from VISIT_00_03 (all sheets)?\n\n'
							+ 'Sheets read:\n{0}\n'
							+ 'Raw rows: {1}\n'
							+ 'Unique lines (VISIT_NUM+SR_NUM): {2}\n'
							+ 'Unique visits: {3}\n'
							+ 'Visits already in system: {4}\n'
							+ 'Visits to auto-create: {5}\n'
							+ 'Existing legacy lab tests (will update): {6}\n'
							+ 'Rows with matching Lab Test Template: {7} / {2}\n'
							+ 'Lab templates in database: {8}\n'
							+ '{9}\n\n'
							+ 'One Lab Test per row. LAB_GROUP_NUM → Template, LAB_SUB_NUM stored on child line. '
							+ 'BRANCH_NUM → Cost Center. is_legacy_import ticked. Status Completed and submitted.\n'
							+ 'Sample Visit Nos: {10}\n'
							+ 'Sample LAB_SUB_NUM: {11}\n\nContinue?',
						[
							sheetLines || __('(none)'),
							counts.raw_excel_rows || counts.excel_rows || 0,
							counts.lab_tests || 0,
							counts.unique_visits || 0,
							counts.existing_visits || 0,
							counts.visits_to_create || 0,
							counts.existing_lab_tests || 0,
							counts.matching_templates || 0,
							counts.lab_test_templates_in_db || 0,
							unmatched,
							(counts.sample_visit_nums || []).join(', ') || __('(none)'),
							(counts.sample_lab_sub_nums || []).join(', ') || __('(none)'),
						]
					);
				},
			});
		}, __('Direct Upload'));

	},

	onload: function(frm) {
		// Keep Healthcare workspace sidebar visible when viewing Settings (e.g. after refresh)
		if (frappe.boot.workspace_sidebar_item && frappe.boot.workspace_sidebar_item.healthcare) {
			frappe.app.sidebar && frappe.app.sidebar.setup('Healthcare');
		}
	},
	setup: function(frm) {
		frm.set_query('default_google_calendar', function(doc) {
			return {
				filters: {
					'enable': true
				}
			};
		});
		frm.set_query('account', 'receivable_account', function(doc, cdt, cdn) {
			var d  = locals[cdt][cdn];
			return {
				filters: {
					'account_type': 'Receivable',
					'company': d.company,
					'is_group': 0
				}
			};
		});
		frm.set_query('account', 'income_account', function(doc, cdt, cdn) {
			var d  = locals[cdt][cdn];
			return {
				filters: {
					'root_type': 'Income',
					'company': d.company,
					'is_group': 0
				}
			};
		});
		frm.set_query('default_code_system', function(doc) {
			return {
				filters: {
					'is_fhir_defined': false
				}
			};
		});
		frm.set_query('default_priority', function () {
			return {
				filters: {
					code_system: 'Priority'
				}
			};
		});

		frm.set_query('default_intent', function () {
			return {
				filters: {
					code_system: 'Intent'
				}
			};
		});

		set_query_service_item(frm, 'inpatient_visit_charge_item');
		set_query_service_item(frm, 'op_consulting_charge_item');
		set_query_service_item(frm, 'clinical_procedure_consumable_item');
		set_query_service_item(frm, 'registration_item');
	}
});

function run_migration_job(frm, method, jobKey, args = {}) {
	frappe.call({
		method: `healthcare.api.data_migration_jobs.${method}`,
		args,
		freeze: true,
		freeze_message: __('Starting background job…'),
		callback(r) {
			if (r.message?.ok) {
				frappe.show_alert({
					message: r.message.message || __('Job started'),
					indicator: 'green',
				});
				poll_migration_status(jobKey);
			}
		},
	});
}

function open_patient_appointment_import_analysis() {
	new frappe.ui.FileUploader({
		dialog_title: __('Analyze Appointment Import (APPOINTMENTS_INFO_01)'),
		allow_multiple: false,
		restrictions: { allowed_file_types: ['.xlsx', '.xls'] },
		on_success(file) {
			frappe.call({
				method: 'healthcare.api.patient_appointment_info_import.analyze_patient_appointment_info_import',
				args: { file_url: file.file_url },
				freeze: true,
				freeze_message: __('Analyzing appointments (reading all sheets)…'),
				callback(r) {
					show_patient_appointment_import_analysis(r.message || {}, file.file_url);
				},
			});
		},
	});
}

function create_missing_patient_appointments(file_url, res, parent_dialog) {
	// Close the analysis dialog first so the confirmation is not hidden behind it.
	if (parent_dialog) {
		parent_dialog.hide();
	}
	frappe.confirm(
		__(
			'Create the {0} appointment(s) that were not imported?<br><br>'
				+ 'Rows without APP_DATE will use their creation date (CR_DATE), '
				+ 'then UP_DATE, then today as a fallback so they can be saved.',
			[res.not_imported || 0]
		),
		() => {
			frappe.call({
				method: 'healthcare.api.patient_appointment_info_import.import_missing_patient_appointment_info_rows',
				args: { file_url },
				freeze: true,
				freeze_message: __('Creating missing appointments…'),
				callback(r) {
					const out = r.message || {};
					frappe.msgprint({
						title: __('Missing appointments created'),
						indicator: out.errors ? 'orange' : 'green',
						message: __(
							'Created: {0}<br>Updated: {1}<br>Used fallback date: {2}<br>Errors: {3}',
							[out.created || 0, out.updated || 0, out.fallback_date_used || 0, out.errors || 0]
						),
					});
				},
			});
		}
	);
}

function show_patient_appointment_import_analysis(res, file_url) {
	const esc = frappe.utils.escape_html;
	const reasonLabels = res.reason_labels || {};
	const reasonCounts = res.reason_counts || {};
	const samples = res.samples || {};

	const sheetRows = Object.entries(res.sheet_row_counts || {})
		.map(([name, n]) => `<li>${esc(name)}: ${frappe.format(n, { fieldtype: 'Int' })}</li>`)
		.join('');

	const reasonRows = Object.keys(reasonLabels)
		.map((key) => {
			const count = reasonCounts[key] || 0;
			const sampleList = (samples[key] || []).join(', ');
			return `
				<tr>
					<td><strong>${frappe.format(count, { fieldtype: 'Int' })}</strong></td>
					<td>${esc(reasonLabels[key])}</td>
					<td class="text-muted small">${esc(sampleList) || '&mdash;'}</td>
				</tr>`;
		})
		.join('');

	const downloadLink = res.csv_file_url
		? `<a href="${esc(res.csv_file_url)}" target="_blank" class="btn btn-sm btn-default">
				${__('Download full list (CSV)')}
			</a>`
		: `<span class="text-muted">${__('Every transaction in the file was imported.')}</span>`;

	const createBtn = (res.not_imported || 0) > 0
		? `<button class="btn btn-sm btn-primary" data-create-missing-appointments style="margin-left:8px;">
				${__('Create missing appointments')}
			</button>`
		: '';

	const html = `
		<div class="appointment-import-analysis">
			<div class="row">
				<div class="col-sm-4"><div class="text-muted small">${__('Unique transactions (APP_NUM)')}</div>
					<div class="h4">${frappe.format(res.excel_unique_app_nums || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-4"><div class="text-muted small">${__('Imported')}</div>
					<div class="h4 text-success">${frappe.format(res.imported || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-4"><div class="text-muted small">${__('Not imported')}</div>
					<div class="h4 text-danger">${frappe.format(res.not_imported || 0, { fieldtype: 'Int' })}</div></div>
			</div>
			<hr>
			<div class="text-muted small">
				${__('Raw rows across sheets')}: ${frappe.format(res.raw_excel_rows || 0, { fieldtype: 'Int' })}
				&nbsp;&middot;&nbsp;
				${__('Duplicate rows in file')}: ${frappe.format(res.duplicate_rows_in_file || 0, { fieldtype: 'Int' })}
			</div>
			<ul class="small text-muted" style="margin-top:6px;">${sheetRows}</ul>
			<hr>
			<h5>${__('Why transactions were not imported')}</h5>
			<table class="table table-bordered table-sm" style="margin-bottom:10px;">
				<thead><tr>
					<th style="width:80px;">${__('Count')}</th>
					<th>${__('Reason')}</th>
					<th>${__('Sample APP_NUMs')}</th>
				</tr></thead>
				<tbody>${reasonRows}</tbody>
			</table>
			<div>${downloadLink}${createBtn}</div>
		</div>`;

	const dialog = frappe.msgprint({
		title: __('Appointment Import Analysis'),
		message: html,
		wide: true,
		indicator: (res.not_imported || 0) > 0 ? 'orange' : 'green',
	});

	if ((res.not_imported || 0) > 0 && dialog && dialog.$wrapper) {
		dialog.$wrapper
			.find('[data-create-missing-appointments]')
			.on('click', () => create_missing_patient_appointments(file_url, res, dialog));
	}
}

function _pick_local_image_filenames(use_folder, on_files) {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = true;
	input.accept = 'image/*';
	if (use_folder) {
		input.setAttribute('webkitdirectory', '');
		input.setAttribute('directory', '');
	}
	input.onchange = () => {
		const files = Array.from(input.files || []);
		on_files(files);
	};
	input.click();
}

function open_patient_cpr_photo_analysis() {
	const dialog = new frappe.ui.Dialog({
		title: __('Analyze CPR Photos'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select the same CPR folder/files used for Direct Upload. Analysis checks which images were attached, which are missing, wrong-side placement (e.g. BACK file in CPR Front), and broken File links. You can also run a DB-only scan without selecting files.')
					+ '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'preview_html',
				options: '<p class="text-muted">' + __('No files selected — click “Scan patients only” for DB checks, or pick a folder.') + '</p>',
			},
		],
		primary_action_label: __('Run Analysis'),
		primary_action() {
			run_patient_cpr_photo_analysis(dialog, dialog._cpr_analysis_filenames || []);
		},
	});

	dialog._cpr_analysis_filenames = [];

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Pick Folder'))
			.on('click', () => {
				_pick_local_image_filenames(true, (files) => {
					preview_cpr_analysis_filenames(dialog, files);
				});
			})
	);
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Pick Files'))
			.on('click', () => {
				_pick_local_image_filenames(false, (files) => {
					preview_cpr_analysis_filenames(dialog, files);
				});
			})
	);
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Scan patients only'))
			.on('click', () => {
				dialog._cpr_analysis_filenames = [];
				dialog.get_field('preview_html').$wrapper.html(
					'<p class="text-muted">' + __('DB-only scan (no folder). Click Run Analysis.') + '</p>'
				);
			})
	);

	dialog.show();
}

function preview_cpr_analysis_filenames(dialog, files) {
	const names = (files || []).map((f) => f.name).filter(Boolean);
	dialog._cpr_analysis_filenames = names;
	frappe.call({
		method: 'healthcare.api.patient_cpr_photo_import.preview_patient_cpr_photo_filenames',
		args: { filenames: names },
		freeze: true,
		freeze_message: __('Reading filenames…'),
		callback(r) {
			const counts = r.message || {};
			dialog.get_field('preview_html').$wrapper.html(
				'<div class="small">'
					+ '<p><strong>' + __('Files selected') + ':</strong> ' + names.length + '</p>'
					+ '<p><strong>' + __('CPR front') + ':</strong> ' + (counts.front_images || 0)
					+ ' &nbsp;·&nbsp; <strong>' + __('CPR back') + ':</strong> ' + (counts.back_images || 0) + '</p>'
					+ '<p><strong>' + __('Patients found') + ':</strong> ' + (counts.patients_found || 0)
					+ ' &nbsp;·&nbsp; <strong>' + __('Patients missing') + ':</strong> ' + (counts.patients_missing || 0) + '</p>'
					+ '<p class="text-muted">' + __('Click Run Analysis to compare against Patient CPR fields.') + '</p>'
					+ '</div>'
			);
		},
	});
}

function run_patient_cpr_photo_analysis(dialog, filenames) {
	frappe.call({
		method: 'healthcare.api.patient_cpr_photo_import.analyze_patient_cpr_photos',
		args: { filenames: filenames || [] },
		freeze: true,
		freeze_message: __('Analyzing CPR photos…'),
		callback(r) {
			if (dialog) dialog.hide();
			show_patient_cpr_photo_analysis(r.message || {});
		},
	});
}

function show_patient_cpr_photo_analysis(res) {
	const esc = frappe.utils.escape_html;
	const samples = res.samples || {};
	const list = (arr) => esc((arr || []).join(', ')) || '&mdash;';
	const downloadIssues = res.csv_file_url
		? `<a href="${esc(res.csv_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download issues CSV')}</a>`
		: `<span class="text-muted">${__('No issues to download.')}</span>`;
	const downloadOk = res.csv_ok_file_url
		? ` <a href="${esc(res.csv_ok_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download OK CSV')}</a>`
		: '';

	const html = `
		<div class="cpr-photo-analysis">
			<div class="row">
				<div class="col-sm-3"><div class="text-muted small">${__('Folder valid images')}</div>
					<div class="h4">${frappe.format(res.folder_valid || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Uploaded OK')}</div>
					<div class="h4 text-success">${frappe.format(res.uploaded_ok || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Not uploaded')}</div>
					<div class="h4 text-danger">${frappe.format(res.not_uploaded || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Wrong side (DB)')}</div>
					<div class="h4 text-warning">${frappe.format(res.db_wrong_side || 0, { fieldtype: 'Int' })}</div></div>
			</div>
			<hr>
			<div class="small text-muted">
				${__('Patients with front')}: ${frappe.format(res.db_patients_with_front || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('with back')}: ${frappe.format(res.db_patients_with_back || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('with both')}: ${frappe.format(res.db_patients_with_both || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Broken files (DB)')}: ${frappe.format(res.db_broken_file || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('No patient for folder file')}: ${frappe.format(res.no_patient || 0, { fieldtype: 'Int' })}
			</div>
			<hr>
			<h5>${__('Samples')}</h5>
			<table class="table table-bordered table-sm">
				<thead><tr><th>${__('Issue')}</th><th>${__('Samples')}</th></tr></thead>
				<tbody>
					<tr><td>${__('Not uploaded')}</td><td class="small text-muted">${list(samples.not_uploaded)}</td></tr>
					<tr><td>${__('Wrong side')}</td><td class="small text-muted">${list(samples.wrong_side)}</td></tr>
					<tr><td>${__('Broken file')}</td><td class="small text-muted">${list(samples.broken_file)}</td></tr>
					<tr><td>${__('No patient')}</td><td class="small text-muted">${list(samples.no_patient)}</td></tr>
				</tbody>
			</table>
			<div>${downloadIssues}${downloadOk}</div>
		</div>`;

	frappe.msgprint({
		title: __('CPR Photo Analysis'),
		message: html,
		wide: true,
		indicator: (res.not_uploaded || res.db_wrong_side || res.db_broken_file) ? 'orange' : 'green',
	});
}

function open_patient_legacy_signature_analysis() {
	const dialog = new frappe.ui.Dialog({
		title: __('Analyze Legacy Signatures'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select the same signature folder/files used for Direct Upload. Finds signatures not attached to admission e-Signatures or Patient documents, and signature Files that exist but were never linked. You can also scan Files only without selecting a folder.')
					+ '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'preview_html',
				options: '<p class="text-muted">' + __('No files selected — click “Scan Files only” or pick a folder.') + '</p>',
			},
		],
		primary_action_label: __('Run Analysis'),
		primary_action() {
			run_patient_legacy_signature_analysis(dialog, dialog._sig_analysis_filenames || []);
		},
	});

	dialog._sig_analysis_filenames = [];

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Pick Folder'))
			.on('click', () => {
				_pick_local_image_filenames(true, (files) => {
					preview_signature_analysis_filenames(dialog, files);
				});
			})
	);
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Pick Files'))
			.on('click', () => {
				_pick_local_image_filenames(false, (files) => {
					preview_signature_analysis_filenames(dialog, files);
				});
			})
	);
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Scan Files only'))
			.on('click', () => {
				dialog._sig_analysis_filenames = [];
				dialog.get_field('preview_html').$wrapper.html(
					'<p class="text-muted">' + __('Will scan File records for unlinked legacy signatures. Click Run Analysis.') + '</p>'
				);
			})
	);

	dialog.show();
}

function preview_signature_analysis_filenames(dialog, files) {
	const names = (files || []).map((f) => f.name).filter(Boolean);
	dialog._sig_analysis_filenames = names;
	frappe.call({
		method: 'healthcare.api.patient_legacy_signature_import.preview_patient_legacy_signature_filenames',
		args: { filenames: names },
		freeze: true,
		freeze_message: __('Reading filenames…'),
		callback(r) {
			const counts = r.message || {};
			dialog.get_field('preview_html').$wrapper.html(
				'<div class="small">'
					+ '<p><strong>' + __('Files selected') + ':</strong> ' + names.length + '</p>'
					+ '<p><strong>' + __('Valid signatures') + ':</strong> ' + (counts.valid_signatures || 0) + '</p>'
					+ '<p><strong>' + __('Patients found') + ':</strong> ' + (counts.patients_found || 0)
					+ ' &nbsp;·&nbsp; <strong>' + __('Admissions found') + ':</strong> ' + (counts.admissions_found || 0) + '</p>'
					+ '<p class="text-muted">' + __('Click Run Analysis to compare against Patient / Admission documents.') + '</p>'
					+ '</div>'
			);
		},
	});
}

function run_patient_legacy_signature_analysis(dialog, filenames) {
	frappe.call({
		method: 'healthcare.api.patient_legacy_signature_import.analyze_patient_legacy_signatures',
		args: { filenames: filenames || [] },
		freeze: true,
		freeze_message: __('Analyzing legacy signatures…'),
		callback(r) {
			if (dialog) dialog.hide();
			show_patient_legacy_signature_analysis(r.message || {});
		},
	});
}

function show_patient_legacy_signature_analysis(res) {
	const esc = frappe.utils.escape_html;
	const samples = res.samples || {};
	const list = (arr) => esc((arr || []).join(', ')) || '&mdash;';
	const downloadIssues = res.csv_file_url
		? `<a href="${esc(res.csv_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download issues CSV')}</a>`
		: `<span class="text-muted">${__('No issues to download.')}</span>`;
	const downloadOk = res.csv_ok_file_url
		? ` <a href="${esc(res.csv_ok_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download OK CSV')}</a>`
		: '';

	const html = `
		<div class="legacy-signature-analysis">
			<div class="row">
				<div class="col-sm-3"><div class="text-muted small">${__('Folder valid images')}</div>
					<div class="h4">${frappe.format(res.folder_valid || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Uploaded OK')}</div>
					<div class="h4 text-success">${frappe.format(res.uploaded_ok || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Not uploaded')}</div>
					<div class="h4 text-danger">${frappe.format(res.not_uploaded || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('File present, not linked')}</div>
					<div class="h4 text-warning">${frappe.format(res.file_present_not_linked || 0, { fieldtype: 'Int' })}</div></div>
			</div>
			<hr>
			<div class="small text-muted">
				${__('No patient')}: ${frappe.format(res.no_patient || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Broken file')}: ${frappe.format(res.broken_file || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Patients with signature file not linked')}: ${frappe.format(res.patients_with_signature_file_not_linked || 0, { fieldtype: 'Int' })}
			</div>
			<hr>
			<h5>${__('Samples')}</h5>
			<table class="table table-bordered table-sm">
				<thead><tr><th>${__('Issue')}</th><th>${__('Samples')}</th></tr></thead>
				<tbody>
					<tr><td>${__('Not uploaded')}</td><td class="small text-muted">${list(samples.not_uploaded)}</td></tr>
					<tr><td>${__('File present, not linked')}</td><td class="small text-muted">${list(samples.file_present_not_linked)}</td></tr>
					<tr><td>${__('Patients (file not linked)')}</td><td class="small text-muted">${list(samples.patients_with_signature_file_not_linked)}</td></tr>
					<tr><td>${__('No patient')}</td><td class="small text-muted">${list(samples.no_patient)}</td></tr>
					<tr><td>${__('Broken file')}</td><td class="small text-muted">${list(samples.broken_file)}</td></tr>
				</tbody>
			</table>
			<div>${downloadIssues}${downloadOk}</div>
		</div>`;

	frappe.msgprint({
		title: __('Legacy Signature Analysis'),
		message: html,
		wide: true,
		indicator: (res.not_uploaded || res.file_present_not_linked || res.broken_file) ? 'orange' : 'green',
	});
}

function open_legacy_sales_master_analysis() {
	new frappe.ui.FileUploader({
		dialog_title: __('Analyze Legacy Sales Master (SALES_DATA_MASTER)'),
		allow_multiple: false,
		restrictions: { allowed_file_types: ['.xlsx', '.xls'] },
		on_success(file) {
			frappe.call({
				method: 'healthcare.api.legacy_sales_master_import.analyze_legacy_sales_master_import',
				args: { file_url: file.file_url },
				freeze: true,
				freeze_message: __('Analyzing Legacy Sales Master (all sheets)…'),
				callback(r) {
					show_legacy_sales_master_analysis(r.message || {});
				},
			});
		},
	});
}

function show_legacy_sales_master_analysis(res) {
	const esc = frappe.utils.escape_html;
	const samples = res.samples || {};
	const list = (arr) => esc((arr || []).join(', ')) || '&mdash;';
	const sheetRows = Object.entries(res.sheet_row_counts || {})
		.map(([name, n]) => `<li>${esc(name)}: ${frappe.format(n, { fieldtype: 'Int' })}</li>`)
		.join('');
	const downloadIssues = res.csv_file_url
		? `<a href="${esc(res.csv_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download issues CSV')}</a>`
		: `<span class="text-muted">${__('No issues to download.')}</span>`;
	const downloadOk = res.csv_ok_file_url
		? ` <a href="${esc(res.csv_ok_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download OK CSV')}</a>`
		: '';

	const html = `
		<div class="legacy-sales-master-analysis">
			<div class="row">
				<div class="col-sm-3"><div class="text-muted small">${__('Unique TRANS_NUM')}</div>
					<div class="h4">${frappe.format(res.excel_unique_trans_nos || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Imported')}</div>
					<div class="h4 text-success">${frappe.format(res.imported || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Not imported')}</div>
					<div class="h4 text-danger">${frappe.format(res.not_imported || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Imported, no items')}</div>
					<div class="h4 text-warning">${frappe.format(res.imported_no_items || 0, { fieldtype: 'Int' })}</div></div>
			</div>
			<hr>
			<div class="small text-muted">
				${__('Raw rows')}: ${frappe.format(res.raw_excel_rows || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Duplicates in file')}: ${frappe.format(res.duplicate_rows_in_file || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Visit unresolved')}: ${frappe.format(res.visit_unresolved || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Admission unresolved')}: ${frappe.format(res.admission_unresolved || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Branch unresolved')}: ${frappe.format(res.branch_unresolved || 0, { fieldtype: 'Int' })}
			</div>
			<ul class="small text-muted" style="margin-top:6px;">${sheetRows}</ul>
			<hr>
			<h5>${__('Samples')}</h5>
			<table class="table table-bordered table-sm">
				<thead><tr><th>${__('Issue')}</th><th>${__('Sample TRANS_NUM')}</th></tr></thead>
				<tbody>
					<tr><td>${__('Not imported')}</td><td class="small text-muted">${list(samples.not_imported)}</td></tr>
					<tr><td>${__('Imported, no items')}</td><td class="small text-muted">${list(samples.imported_no_items)}</td></tr>
					<tr><td>${__('Visit unresolved')}</td><td class="small text-muted">${list(samples.visit_unresolved)}</td></tr>
					<tr><td>${__('Admission unresolved')}</td><td class="small text-muted">${list(samples.admission_unresolved)}</td></tr>
					<tr><td>${__('Branch unresolved')}</td><td class="small text-muted">${list(samples.branch_unresolved)}</td></tr>
				</tbody>
			</table>
			<div>${downloadIssues}${downloadOk}</div>
		</div>`;

	frappe.msgprint({
		title: __('Legacy Sales Master Analysis'),
		message: html,
		wide: true,
		indicator: (res.not_imported || res.imported_no_items) ? 'orange' : 'green',
	});
}

function open_legacy_sales_detail_analysis() {
	new frappe.ui.FileUploader({
		dialog_title: __('Analyze Legacy Sales Detail (SALES_DATA_DETAILS)'),
		allow_multiple: false,
		restrictions: { allowed_file_types: ['.xlsx', '.xls'] },
		on_success(file) {
			frappe.call({
				method: 'healthcare.api.legacy_sales_detail_import.analyze_legacy_sales_detail_import',
				args: { file_url: file.file_url },
				freeze: true,
				freeze_message: __('Analyzing Legacy Sales Detail…'),
				callback(r) {
					show_legacy_sales_detail_analysis(r.message || {});
				},
			});
		},
	});
}

function show_legacy_sales_detail_analysis(res) {
	const esc = frappe.utils.escape_html;
	const samples = res.samples || {};
	const list = (arr) => esc((arr || []).join(', ')) || '&mdash;';
	const sheetRows = Object.entries(res.sheet_row_counts || {})
		.map(([name, n]) => `<li>${esc(name)}: ${frappe.format(n, { fieldtype: 'Int' })}</li>`)
		.join('');
	const downloadIssues = res.csv_file_url
		? `<a href="${esc(res.csv_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download issues CSV')}</a>`
		: `<span class="text-muted">${__('No issues to download.')}</span>`;
	const downloadOk = res.csv_ok_file_url
		? ` <a href="${esc(res.csv_ok_file_url)}" target="_blank" class="btn btn-sm btn-default">${__('Download OK CSV')}</a>`
		: '';

	const html = `
		<div class="legacy-sales-detail-analysis">
			<div class="row">
				<div class="col-sm-3"><div class="text-muted small">${__('Detail rows')}</div>
					<div class="h4">${frappe.format(res.excel_detail_rows || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Lines imported')}</div>
					<div class="h4 text-success">${frappe.format(res.lines_imported || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Lines not imported')}</div>
					<div class="h4 text-danger">${frappe.format(res.lines_not_imported || 0, { fieldtype: 'Int' })}</div></div>
				<div class="col-sm-3"><div class="text-muted small">${__('Parent missing (lines)')}</div>
					<div class="h4 text-warning">${frappe.format(res.parent_missing_lines || 0, { fieldtype: 'Int' })}</div></div>
			</div>
			<hr>
			<div class="small text-muted">
				${__('Excel TRANSs')}: ${frappe.format(res.excel_transactions || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Parents found')}: ${frappe.format(res.parents_found || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Parents missing')}: ${frappe.format(res.parents_missing || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('ITEM unresolved')}: ${frappe.format(res.item_unresolved || 0, { fieldtype: 'Int' })}
				&nbsp;·&nbsp; ${__('Line count mismatch')}: ${frappe.format(res.line_count_mismatch || 0, { fieldtype: 'Int' })}
			</div>
			<ul class="small text-muted" style="margin-top:6px;">${sheetRows}</ul>
			<hr>
			<h5>${__('Samples')}</h5>
			<table class="table table-bordered table-sm">
				<thead><tr><th>${__('Issue')}</th><th>${__('Samples')}</th></tr></thead>
				<tbody>
					<tr><td>${__('Parent missing')}</td><td class="small text-muted">${list(samples.parent_missing)}</td></tr>
					<tr><td>${__('Line not imported')} (TRANS/SR)</td><td class="small text-muted">${list(samples.line_not_imported)}</td></tr>
					<tr><td>${__('ITEM unresolved')}</td><td class="small text-muted">${list(samples.item_unresolved)}</td></tr>
					<tr><td>${__('Line count mismatch')}</td><td class="small text-muted">${list(samples.line_count_mismatch)}</td></tr>
				</tbody>
			</table>
			<div>${downloadIssues}${downloadOk}</div>
		</div>`;

	frappe.msgprint({
		title: __('Legacy Sales Detail Analysis'),
		message: html,
		wide: true,
		indicator: (res.lines_not_imported || res.parent_missing_lines || res.item_unresolved) ? 'orange' : 'green',
	});
}

function open_patient_image_reconcile() {
	const dialog = new frappe.ui.Dialog({
		title: __('CPR and Signatures'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select the folder that now holds every patient image. The file name starts with the patient file number. SIGN is the signature, CPR FRONT is the front photo, and CPR BACK is the back photo. jpg, png and tiff are treated the same. If that image is already on the patient, the file is skipped and nothing is replaced.')
					+ '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'preview_html',
				options: '<p class="text-muted">' + __('No folder selected yet.') + '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'progress_html',
				options: '',
			},
		],
		primary_action_label: __('Attach missing images'),
		primary_action() {
			const items = dialog._image_upload_items || [];
			if (!items.length) {
				frappe.msgprint({
					title: __('Nothing to attach'),
					message: __('Every CPR photo and signature in this folder is already on the patient, or the folder has not been read yet.'),
					indicator: 'orange',
				});
				return;
			}
			frappe.call({
				method: 'healthcare.api.patient_image_reconcile.start_patient_image_reconcile',
				args: { items },
				freeze: true,
				freeze_message: __('Starting…'),
				callback(r) {
					if (r.message && r.message.queued) {
						poll_patient_image_reconcile(dialog);
					} else if (r.message && r.message.message) {
						frappe.msgprint(r.message.message);
					}
				},
			});
		},
	});

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Folder'))
			.on('click', () => pick_patient_image_folder(dialog))
	);
	dialog.show();
	dialog.get_primary_btn().prop('disabled', true);
}

function pick_patient_image_folder(dialog) {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = true;
	input.accept = 'image/*,.tif,.tiff,.tff';
	input.setAttribute('webkitdirectory', '');
	input.setAttribute('directory', '');
	input.onchange = () => {
		const files = Array.from(input.files || []);
		if (!files.length) {
			return;
		}
		preview_patient_image_folder(dialog, files);
	};
	input.click();
}

function patient_image_basename(file) {
	return (file.webkitRelativePath || file.name || '').replace(/\\/g, '/').split('/').pop();
}

function preview_patient_image_folder(dialog, files) {
	const filenames = files.map(patient_image_basename);
	dialog._image_upload_items = [];
	dialog.get_primary_btn().prop('disabled', true);
	dialog.fields_dict.preview_html.$wrapper.html(
		'<p class="text-muted">' + __('Comparing the folder with patient images…') + '</p>'
	);
	dialog.fields_dict.progress_html.$wrapper.html('');
	frappe.call({
		method: 'healthcare.api.patient_image_reconcile.preview_patient_image_filenames',
		args: { filenames },
		freeze: true,
		freeze_message: __('Comparing images…'),
		callback(r) {
			const counts = r.message || {};
			const folder = counts.folder || {};
			const already = counts.already || {};
			const missing = counts.missing || {};
			const row = (label, key) =>
				'<tr><td>' + label + '</td><td>' + (folder[key] || 0)
				+ '</td><td>' + (already[key] || 0)
				+ '</td><td><b>' + (missing[key] || 0) + '</b></td></tr>';
			dialog.fields_dict.preview_html.$wrapper.html(
				'<table class="table table-bordered small"><thead><tr><th></th><th>'
				+ __('In folder') + '</th><th>' + __('Already on patient') + '</th><th>'
				+ __('Missing') + '</th></tr></thead><tbody>'
				+ row(__('CPR front'), 'cpr_front')
				+ row(__('CPR back'), 'cpr_back')
				+ row(__('Signature'), 'signature')
				+ '</tbody></table>'
				+ '<p class="text-muted small">'
				+ __('Other files ignored: {0}. Repeated files for the same image: {1}. Patients not found: {2}.', [
					counts.ignored || 0,
					counts.duplicate_files || 0,
					counts.patients_missing || 0,
				])
				+ '</p>'
			);
			const wanted = new Set(counts.upload_filenames || []);
			const pending = files.filter((file) => wanted.has(patient_image_basename(file)));
			if (!pending.length) {
				dialog.fields_dict.progress_html.$wrapper.html(
					'<p class="text-muted small">' + __('Nothing new to attach.') + '</p>'
				);
				return;
			}
			upload_missing_patient_images(dialog, pending);
		},
	});
}

function upload_missing_patient_images(dialog, files) {
	const items = [];
	let index = 0;
	const step = () => {
		dialog.fields_dict.progress_html.$wrapper.html(
			'<p class="small text-muted">'
			+ __('Uploading {0} of {1} missing images…', [index, files.length])
			+ '</p>'
		);
		if (index >= files.length) {
			dialog._image_upload_items = items;
			dialog.get_primary_btn().prop('disabled', !items.length);
			dialog.fields_dict.progress_html.$wrapper.html(
				'<p class="text-success small">'
				+ __('{0} missing image(s) are ready. Attach them to the patients who do not have them yet.', [items.length])
				+ '</p>'
			);
			return;
		}
		const file = files[index];
		const filename = patient_image_basename(file);
		upload_patient_cpr_file(file)
			.then((file_url) => {
				items.push({ file_url, filename });
			})
			.catch(() => {
				frappe.show_alert({
					message: __('Failed to upload {0}', [filename]),
					indicator: 'red',
				}, 5);
			})
			.finally(() => {
				index += 1;
				step();
			});
	};
	step();
}

function open_patient_document_manifest() {
	const dialog = new frappe.ui.Dialog({
		title: __('Patient Documents'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select the main folder. Every PDF in the nested folders is imported. manifest_final.csv supplies the patient file number when the file is listed. A PDF that is not in the manifest is still uploaded and marked Not Patient Document. A PDF whose patient is not in ERPNext is still uploaded. The old OCR Legacy Visit Documents are deleted first.')
					+ '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'preview_html',
				options: '<p class="text-muted">' + __('No folder selected yet.') + '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'progress_html',
				options: '',
			},
		],
		primary_action_label: __('Replace documents'),
		primary_action() {
			const items = dialog._document_upload_items || [];
			if (!items.length) {
				frappe.msgprint({
					title: __('Nothing to attach'),
					message: __('Select the folder and wait until the manifest files have uploaded.'),
					indicator: 'orange',
				});
				return;
			}
			const existing = dialog._document_existing_count || 0;
			frappe.confirm(
				__('Delete {0} existing Legacy Visit Documents, then attach {1} documents from the manifest?', [
					existing,
					items.length,
				]),
				() => {
					frappe.call({
						method: 'healthcare.api.patient_document_manifest.start_patient_document_manifest',
						args: { items },
						freeze: true,
						freeze_message: __('Starting…'),
						callback(r) {
							if (r.message && r.message.queued) {
								poll_patient_document_manifest(dialog);
							} else if (r.message && r.message.message) {
								frappe.msgprint(r.message.message);
							}
						},
					});
				}
			);
		},
	});
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Folder'))
			.on('click', () => pick_patient_document_folder(dialog))
	);
	dialog.show();
	dialog.get_primary_btn().prop('disabled', true);
}

function pick_patient_document_folder(dialog) {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = true;
	input.setAttribute('webkitdirectory', '');
	input.setAttribute('directory', '');
	input.onchange = () => {
		const files = Array.from(input.files || []);
		if (files.length) {
			preview_patient_document_folder(dialog, files);
		}
	};
	input.click();
}

function patient_document_relative_path(file) {
	return (file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
}

function read_manifest_text(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(reader.error);
		reader.readAsText(file);
	});
}

function patient_document_outside_manifest_html(outside) {
	if (!outside.length) {
		return (
			'<p class="text-muted small mt-2">'
			+ __('Every PDF in the folder is listed in the manifest.')
			+ '</p>'
		);
	}
	const options = outside
		.map((row, index) => {
			const label = row.file_name || row.relative_path || row.path || '';
			const title = row.relative_path || row.path || label;
			return (
				'<option value="'
				+ index
				+ '" title="'
				+ frappe.utils.escape_html(title)
				+ '">'
				+ frappe.utils.escape_html(label)
				+ '</option>'
			);
		})
		.join('');
	return (
		'<div class="mt-3 patient-document-outside-manifest">'
		+ '<label class="control-label">'
		+ __('PDFs not listed in the manifest')
		+ ' ('
		+ outside.length
		+ ')</label>'
		+ '<div class="flex align-items-center" style="gap:8px;">'
		+ '<select class="form-control patient-document-outside-select" style="flex:1;">'
		+ options
		+ '</select>'
		+ '<button type="button" class="btn btn-default btn-sm patient-document-outside-download">'
		+ __('Download')
		+ '</button>'
		+ '<button type="button" class="btn btn-default btn-sm patient-document-outside-download-all">'
		+ __('Download all names')
		+ '</button>'
		+ '</div>'
		+ '<p class="text-muted small mt-1 patient-document-outside-path"></p>'
		+ '</div>'
	);
}

function bind_patient_document_outside_manifest(dialog) {
	const $wrap = dialog.fields_dict.preview_html.$wrapper;
	const $select = $wrap.find('.patient-document-outside-select');
	const $path = $wrap.find('.patient-document-outside-path');
	const outside = dialog._document_outside_manifest || [];
	if (!$select.length) {
		return;
	}
	const show_path = () => {
		const row = outside[cint($select.val())];
		$path.text(row ? row.relative_path || row.path || '' : '');
	};
	show_path();
	$select.off('change.patient_document_outside').on('change.patient_document_outside', show_path);
	$wrap
		.find('.patient-document-outside-download')
		.off('click.patient_document_outside')
		.on('click.patient_document_outside', () => {
			download_patient_document_outside_file(dialog, cint($select.val()));
		});
	$wrap
		.find('.patient-document-outside-download-all')
		.off('click.patient_document_outside')
		.on('click.patient_document_outside', () => {
			download_patient_document_outside_names(dialog);
		});
}

function download_patient_document_outside_file(dialog, index) {
	const outside = dialog._document_outside_manifest || [];
	const row = outside[index];
	if (!row) {
		frappe.msgprint(__('Select a PDF that is not in the manifest.'));
		return;
	}
	const path = row.path || '';
	const file = (dialog._document_folder_files || []).find(
		(item) => patient_document_relative_path(item) === path
	);
	if (!file) {
		frappe.msgprint(__('That PDF is no longer available from the selected folder. Select the folder again.'));
		return;
	}
	const url = URL.createObjectURL(file);
	const link = document.createElement('a');
	link.href = url;
	link.download = row.file_name || patient_image_basename(file) || 'document.pdf';
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download_patient_document_outside_names(dialog) {
	const outside = dialog._document_outside_manifest || [];
	if (!outside.length) {
		frappe.msgprint(__('There are no PDFs outside the manifest.'));
		return;
	}
	const lines = outside.map((row) => {
		const name = (row.file_name || '').trim();
		if (name) {
			return name;
		}
		return String(row.path || row.relative_path || '').replace(/\\/g, '/').split('/').pop();
	});
	const blob = new Blob([lines.filter(Boolean).join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = 'pdfs_not_in_manifest.txt';
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function preview_patient_document_folder(dialog, files) {
	const manifests = files.filter((file) => patient_image_basename(file).toLowerCase() === 'manifest_final.csv');
	if (!manifests.length) {
		frappe.msgprint({
			title: __('Manifest not found'),
			message: __('The selected folder has no manifest_final.csv.'),
			indicator: 'orange',
		});
		return;
	}
	manifests.sort((a, b) => patient_document_relative_path(a).length - patient_document_relative_path(b).length);
	dialog._document_upload_items = [];
	dialog.get_primary_btn().prop('disabled', true);
	dialog.fields_dict.preview_html.$wrapper.html(
		'<p class="text-muted">' + __('Reading the manifest…') + '</p>'
	);
	read_manifest_text(manifests[0]).then((manifest) => {
		const paths = files.map(patient_document_relative_path);
		frappe.call({
			method: 'healthcare.api.patient_document_manifest.preview_patient_document_manifest',
			args: { manifest, paths },
			freeze: true,
			freeze_message: __('Comparing the manifest with the folder…'),
			callback(r) {
				const counts = r.message || {};
				dialog._document_existing_count = counts.existing_documents || 0;
				dialog._document_imports = {};
				(counts.imports || []).forEach((row) => {
					dialog._document_imports[row.path] = row;
				});
				const missing = (counts.sample_missing_file_nos || []).join(', ') || __('(none)');
				const outside = counts.outside_manifest_files || [];
				dialog._document_folder_files = files;
				dialog._document_outside_manifest = outside;
				dialog.fields_dict.preview_html.$wrapper.html(
					'<table class="table table-bordered small"><tbody>'
					+ '<tr><td>' + __('Rows in the manifest') + '</td><td><b>' + (counts.manifest_rows || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('FILE_EXISTS says yes') + '</td><td><b>' + (counts.file_exists || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('FILE_EXISTS says no') + '</td><td><b>' + (counts.file_missing || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('PDFs that will be imported') + '</td><td><b>' + (counts.matched_files || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('PDFs not listed in the manifest') + '</td><td><b>' + (counts.outside_manifest || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('In the manifest but not in the folder') + '</td><td><b>' + (counts.not_in_folder || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('Patients found') + '</td><td><b>' + (counts.patients_found || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('Patients not found') + '</td><td><b>' + (counts.patients_missing || 0) + '</b></td></tr>'
					+ '<tr><td>' + __('Old Legacy Visit Documents to delete') + '</td><td><b>' + (counts.existing_documents || 0) + '</b></td></tr>'
					+ '</tbody></table>'
					+ '<p class="text-muted small">' + __('Sample missing file numbers: {0}', [frappe.utils.escape_html(missing)]) + '</p>'
					+ patient_document_outside_manifest_html(outside)
				);
				bind_patient_document_outside_manifest(dialog);
				const wanted = new Set(counts.upload_paths || []);
				const pending = files.filter((file) => wanted.has(patient_document_relative_path(file)));
				if (!pending.length) {
					dialog.fields_dict.progress_html.$wrapper.html(
						'<p class="text-muted small">' + __('None of the manifest files were found in this folder.') + '</p>'
					);
					return;
				}
				upload_patient_document_files(dialog, pending);
			},
		});
	}).catch(() => {
		frappe.msgprint(__('Could not read manifest_final.csv.'));
	});
}

function upload_patient_document_files(dialog, files) {
	const items = [];
	let index = 0;
	const step = () => {
		dialog.fields_dict.progress_html.$wrapper.html(
			'<p class="small text-muted">'
			+ __('Uploading {0} of {1} documents…', [index, files.length])
			+ '</p>'
		);
		if (index >= files.length) {
			dialog._document_upload_items = items;
			dialog.get_primary_btn().prop('disabled', !items.length);
			dialog.fields_dict.progress_html.$wrapper.html(
				'<p class="text-success small">'
				+ __('{0} document(s) are ready. Replace will delete the old Legacy Visit Documents first.', [items.length])
				+ '</p>'
			);
			return;
		}
		const file = files[index];
		const path = patient_document_relative_path(file);
		const meta = (dialog._document_imports || {})[path] || {};
		upload_patient_cpr_file(file)
			.then((file_url) => {
				items.push(Object.assign({}, meta, { file_url, path }));
			})
			.catch(() => {
				frappe.show_alert({
					message: __('Failed to upload {0}', [patient_image_basename(file)]),
					indicator: 'red',
				}, 5);
			})
			.finally(() => {
				index += 1;
				step();
			});
	};
	step();
}

function poll_patient_document_manifest(dialog) {
	const poll = () => {
		frappe.call({
			method: 'healthcare.api.patient_document_manifest.get_patient_document_manifest_status',
			callback(r) {
				const status = r.message || {};
				dialog.fields_dict.progress_html.$wrapper.html(
					'<p class="small">' + frappe.utils.escape_html(status.message || status.state || '') + '</p>'
				);
				if (status.state === 'finished' || status.state === 'failed') {
					dialog.get_primary_btn().prop('disabled', true);
					return;
				}
				setTimeout(poll, 2000);
			},
		});
	};
	poll();
}

function poll_patient_image_reconcile(dialog) {
	const poll = () => {
		frappe.call({
			method: 'healthcare.api.patient_image_reconcile.get_patient_image_reconcile_status',
			callback(r) {
				const status = r.message || {};
				dialog.fields_dict.progress_html.$wrapper.html(
					'<p class="small">' + frappe.utils.escape_html(status.message || status.state || '') + '</p>'
				);
				if (status.state === 'finished' || status.state === 'failed') {
					dialog.get_primary_btn().prop('disabled', true);
					return;
				}
				setTimeout(poll, 2000);
			},
		});
	};
	poll();
}

function open_patient_cpr_folder_upload() {
	const dialog = new frappe.ui.Dialog({
		title: __('Import Patient CPR Photos'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select a folder or multiple image files from your computer. '
						+ 'Filenames must include the patient File No and CPR side, e.g. '
						+ '<code>861343-PHOTO_CPR_FRONT.jpg</code> and '
						+ '<code>861343-PHOTO_CPR_BACK.jpg</code>.')
					+ '</p>',
			},
			{
				fieldtype: 'Check',
				fieldname: 'replace_existing',
				label: __('Replace existing CPR images on patient records'),
				default: 1,
			},
			{
				fieldtype: 'HTML',
				fieldname: 'preview_html',
				options: '<p class="text-muted">' + __('No files selected yet.') + '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'progress_html',
				options: '',
			},
		],
		primary_action_label: __('Import'),
		primary_action() {
			if (!dialog._cpr_upload_items || !dialog._cpr_upload_items.length) {
				frappe.msgprint({
					title: __('No files'),
					message: __('Select a folder or files first.'),
					indicator: 'orange',
				});
				return;
			}
			const replace_existing = dialog.get_value('replace_existing') ? 1 : 0;
			frappe.confirm(
				__(
					'Import {0} CPR image(s) to patient records?\n\n'
						+ 'Front: {1}\n'
						+ 'Back: {2}\n'
						+ 'Patients found: {3}\n'
						+ 'Patients missing: {4}\n\nContinue?',
					[
						dialog._cpr_upload_items.length,
						dialog._cpr_preview_counts?.front_images || 0,
						dialog._cpr_preview_counts?.back_images || 0,
						dialog._cpr_preview_counts?.patients_found || 0,
						dialog._cpr_preview_counts?.patients_missing || 0,
					]
				),
				() => start_patient_cpr_photo_import(dialog, replace_existing)
			);
		},
	});

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Folder'))
			.on('click', () => pick_patient_cpr_files(dialog, true))
	);
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Files'))
			.on('click', () => pick_patient_cpr_files(dialog, false))
	);

	dialog.show();
	dialog.get_primary_btn().prop('disabled', true);
}

function pick_patient_cpr_files(dialog, use_folder) {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = true;
	input.accept = 'image/*';
	if (use_folder) {
		input.setAttribute('webkitdirectory', '');
		input.setAttribute('directory', '');
	}
	input.onchange = () => {
		const files = Array.from(input.files || []);
		if (!files.length) {
			return;
		}
		preview_and_upload_patient_cpr_files(dialog, files);
	};
	input.click();
}

function preview_and_upload_patient_cpr_files(dialog, files) {
	const filenames = files.map((file) => {
		const path = file.webkitRelativePath || file.name || '';
		return path.replace(/\\/g, '/').split('/').pop();
	});

	dialog.fields_dict.preview_html.$wrapper.html(
		'<p class="text-muted">' + __('Checking filenames…') + '</p>'
	);
	dialog.fields_dict.progress_html.$wrapper.html('');
	dialog.get_primary_btn().prop('disabled', true);
	dialog._cpr_upload_items = null;
	dialog._cpr_preview_counts = null;

	frappe.call({
		method: 'healthcare.api.patient_cpr_photo_import.preview_patient_cpr_photo_filenames',
		args: { filenames },
		freeze: true,
		freeze_message: __('Analyzing filenames…'),
		callback(r) {
			const counts = r.message || {};
			dialog._cpr_preview_counts = counts;
			const missing = (counts.sample_missing_file_nos || []).join(', ') || __('(none)');
			dialog.fields_dict.preview_html.$wrapper.html(
				'<div class="small">'
					+ '<p><strong>' + __('Files selected') + ':</strong> ' + files.length + '</p>'
					+ '<p><strong>' + __('CPR front images') + ':</strong> ' + (counts.front_images || 0) + '</p>'
					+ '<p><strong>' + __('CPR back images') + ':</strong> ' + (counts.back_images || 0) + '</p>'
					+ '<p><strong>' + __('Invalid / skipped filenames') + ':</strong> ' + (counts.invalid_filenames || 0) + '</p>'
					+ '<p><strong>' + __('Patients found') + ':</strong> ' + (counts.patients_found || 0) + '</p>'
					+ '<p><strong>' + __('Patients missing') + ':</strong> ' + (counts.patients_missing || 0) + '</p>'
					+ '<p class="text-muted"><strong>' + __('Sample missing File Nos') + ':</strong> ' + frappe.utils.escape_html(missing) + '</p>'
					+ '</div>'
			);

			if (!counts.front_images && !counts.back_images) {
				frappe.msgprint({
					title: __('No CPR images found'),
					message: __('No filenames matched the expected pattern (e.g. 861343-PHOTO_CPR_FRONT.jpg).'),
					indicator: 'orange',
				});
				return;
			}

			upload_patient_cpr_files_sequential(dialog, files);
		},
	});
}

function upload_patient_cpr_files_sequential(dialog, files) {
	const valid_files = files.filter((file) => {
		const name = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/').split('/').pop().toUpperCase();
		return name.includes('CPR') && (name.includes('FRONT') || name.includes('BACK'));
	});

	if (!valid_files.length) {
		frappe.msgprint({
			title: __('No CPR images'),
			message: __('No image files matched CPR FRONT/BACK naming.'),
			indicator: 'orange',
		});
		return;
	}

	const items = [];
	const failed = [];
	let index = 0;

	const render_progress = () => {
		const pct = Math.round((index / valid_files.length) * 100);
		dialog.fields_dict.progress_html.$wrapper.html(
			'<p class="small text-muted">'
				+ __('Uploading {0} of {1} ({2}%)…', [index, valid_files.length, pct])
				+ '</p>'
		);
	};

	const render_upload_summary = () => {
		dialog._cpr_upload_items = items;
		const failed_list = failed
			.map((entry) => {
				const sizeInfo = entry.before ? ` (${frappe.utils.escape_html(entry.before)})` : '';
				const reason = entry.reason
					? ` - ${frappe.utils.escape_html(entry.reason)}`
					: '';
				return `${frappe.utils.escape_html(entry.filename)}${sizeInfo}${reason}`;
			})
			.join('<br>');
		let html = '';
		if (failed.length) {
			html += '<p class="text-orange small"><strong>'
				+ __('{0} of {1} uploaded. {2} failed — those patients will not be updated unless you retry.', [
					items.length,
					valid_files.length,
					failed.length,
				])
				+ '</strong></p>';
			html += '<p class="small text-muted"><strong>' + __('Failed files') + ':</strong><br>' + failed_list + '</p>';
		} else {
			html += '<p class="text-success small">' + __('All {0} file(s) uploaded. Click Import to attach images to patients.', [items.length]) + '</p>';
		}
		dialog.fields_dict.progress_html.$wrapper.html(html);
		dialog.get_primary_btn().prop('disabled', !items.length);
	};

	const upload_next = () => {
		if (index >= valid_files.length) {
			render_upload_summary();
			return;
		}

		const file = valid_files[index];
		const filename = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/').split('/').pop();
		render_progress();

		upload_patient_cpr_file(file)
			.then((file_url) => {
				items.push({ file_url, filename });
			})
			.catch((err) => {
				const reason = err instanceof Error ? err.message : String(err || '');
				failed.push({
					filename,
					before: format_bytes(file.size),
					reason,
				});
				frappe.show_alert({
					message: __('Failed to upload {0}', [filename]),
					indicator: 'red',
				}, 5);
				console.error('CPR upload failed:', {
					filename,
					reason,
					sizeBytes: file.size,
					size: format_bytes(file.size),
				});
			})
			.finally(() => {
				index += 1;
				upload_next();
			});
	};

	render_progress();
	upload_next();
}

function format_bytes(bytes) {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}
	return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function upload_patient_cpr_file(file, retries = 3) {
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const is_transient_upload_error = (err) => {
		const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
		return (
			msg.includes('failed to fetch') ||
			msg.includes('networkerror') ||
			msg.includes('network request failed') ||
			msg.includes('load failed') ||
			msg.includes('the network connection was lost')
		);
	};

	const attempt = (remaining) =>
		new Promise((resolve, reject) => {
			const form = new FormData();
			form.append('file', file);
			form.append('is_private', '0');
			form.append('folder', 'Home/Attachments');

			fetch('/api/method/upload_file', {
				method: 'POST',
				headers: {
					'X-Frappe-CSRF-Token': frappe.csrf_token,
					Accept: 'application/json',
				},
				body: form,
				credentials: 'include',
			})
				.then(async (response) => {
					const data = await response.json().catch(() => ({}));
					if (!response.ok || data.exc) {
						let reason = '';
						try {
							const msgs = JSON.parse(data._server_messages || '[]');
							const first = JSON.parse(msgs[0] || '{}');
							reason = first.message || data.message || '';
						} catch (e) {
							reason = data.message || '';
						}
						reject(new Error(reason || `HTTP ${response.status}`));
						return;
					}
					const doc = data.message;
					const file_url =
						(doc && typeof doc === 'object' && doc.file_url) ||
						(typeof doc === 'string' ? doc : null);
					if (!file_url) {
						reject(new Error('No file URL returned'));
						return;
					}
					resolve(file_url);
				})
				.catch(reject);
		}).catch(async (err) => {
			if (remaining > 0 && is_transient_upload_error(err)) {
				const attempt_no = retries - remaining + 1;
				await sleep(500 * attempt_no);
				return attempt(remaining - 1);
			}
			throw err;
		});

	return attempt(retries);
}

function start_patient_cpr_photo_import(dialog, replace_existing) {
	frappe.call({
		method: 'healthcare.api.data_migration_jobs.start_patient_cpr_photo_import_migration',
		args: {
			items: dialog._cpr_upload_items,
			replace_existing,
		},
		freeze: true,
		freeze_message: __('Starting background import…'),
		callback(r) {
			if (r.message?.ok) {
				dialog.hide();
				frappe.show_alert({
					message: r.message.message || __('CPR photo import started'),
					indicator: 'green',
				});
				poll_migration_status('patient_cpr_photo_import');
			}
		},
	});
}

function open_patient_legacy_signature_folder_upload() {
	const dialog = new frappe.ui.Dialog({
		title: __('Import Legacy Signatures'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select a folder or multiple image files. Filenames must match '
						+ '<code>{FileNo}-{Admission}-SIGNATURE_{nn}.jpg</code>, e.g. '
						+ '<code>190791-2249-SIGNATURE_01.jpg</code>. '
						+ 'When the admission exists, signatures are stored on Inpatient Admission e-Signatures; '
						+ 'otherwise on Patient Documents. Document Type: Legacy Signature.')
					+ '</p>',
			},
			{
				fieldtype: 'Check',
				fieldname: 'replace_existing',
				label: __('Replace existing matching signature rows'),
				default: 1,
			},
			{
				fieldtype: 'HTML',
				fieldname: 'preview_html',
				options: '<p class="text-muted">' + __('No files selected yet.') + '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'progress_html',
				options: '',
			},
		],
		primary_action_label: __('Import'),
		primary_action() {
			if (!dialog._sig_upload_items || !dialog._sig_upload_items.length) {
				frappe.msgprint({
					title: __('No files'),
					message: __('Select a folder or files first.'),
					indicator: 'orange',
				});
				return;
			}
			const replace_existing = dialog.get_value('replace_existing') ? 1 : 0;
			frappe.confirm(
				__(
					'Import {0} signature image(s)?\n\n'
						+ 'Valid signatures: {1}\n'
						+ 'Patients found: {2}\n'
						+ 'Patients missing: {3}\n'
						+ 'Admissions found: {4}\n'
						+ 'Admissions missing (will attach to Patient): {5}\n\nContinue?',
					[
						dialog._sig_upload_items.length,
						dialog._sig_preview_counts?.valid_signatures || 0,
						dialog._sig_preview_counts?.patients_found || 0,
						dialog._sig_preview_counts?.patients_missing || 0,
						dialog._sig_preview_counts?.admissions_found || 0,
						dialog._sig_preview_counts?.admissions_missing || 0,
					]
				),
				() => start_patient_legacy_signature_import(dialog, replace_existing)
			);
		},
	});

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Folder'))
			.on('click', () => pick_patient_legacy_signature_files(dialog, true))
	);
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Files'))
			.on('click', () => pick_patient_legacy_signature_files(dialog, false))
	);

	dialog.show();
	dialog.get_primary_btn().prop('disabled', true);
}

function pick_patient_legacy_signature_files(dialog, use_folder) {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = true;
	input.accept = 'image/*';
	if (use_folder) {
		input.setAttribute('webkitdirectory', '');
		input.setAttribute('directory', '');
	}
	input.onchange = () => {
		const files = Array.from(input.files || []);
		if (!files.length) {
			return;
		}
		preview_and_upload_patient_legacy_signature_files(dialog, files);
	};
	input.click();
}

function is_legacy_signature_filename(name) {
	const upper = (name || '').toUpperCase();
	return /^\d+\-[A-Z0-9]+\-SIGNATURE[_\-]?\d+/i.test(upper.replace(/\.[^.]+$/, ''));
}

function preview_and_upload_patient_legacy_signature_files(dialog, files) {
	const filenames = files.map((file) => {
		const path = file.webkitRelativePath || file.name || '';
		return path.replace(/\\/g, '/').split('/').pop();
	});

	dialog.fields_dict.preview_html.$wrapper.html(
		'<p class="text-muted">' + __('Checking filenames…') + '</p>'
	);
	dialog.fields_dict.progress_html.$wrapper.html('');
	dialog.get_primary_btn().prop('disabled', true);
	dialog._sig_upload_items = null;
	dialog._sig_preview_counts = null;

	frappe.call({
		method: 'healthcare.api.patient_legacy_signature_import.preview_patient_legacy_signature_filenames',
		args: { filenames },
		freeze: true,
		freeze_message: __('Analyzing filenames…'),
		callback(r) {
			const counts = r.message || {};
			dialog._sig_preview_counts = counts;
			const missingPatients = (counts.sample_missing_file_nos || []).join(', ') || __('(none)');
			const missingAdms = (counts.sample_missing_admissions || []).join(', ') || __('(none)');
			dialog.fields_dict.preview_html.$wrapper.html(
				'<div class="small">'
					+ '<p><strong>' + __('Files selected') + ':</strong> ' + files.length + '</p>'
					+ '<p><strong>' + __('Valid signature images') + ':</strong> ' + (counts.valid_signatures || 0) + '</p>'
					+ '<p><strong>' + __('Invalid / skipped filenames') + ':</strong> ' + (counts.invalid_filenames || 0) + '</p>'
					+ '<p><strong>' + __('Patients found') + ':</strong> ' + (counts.patients_found || 0) + '</p>'
					+ '<p><strong>' + __('Patients missing') + ':</strong> ' + (counts.patients_missing || 0) + '</p>'
					+ '<p><strong>' + __('Admissions found') + ':</strong> ' + (counts.admissions_found || 0) + '</p>'
					+ '<p><strong>' + __('Admissions missing') + ':</strong> ' + (counts.admissions_missing || 0) + '</p>'
					+ '<p class="text-muted"><strong>' + __('Sample missing File Nos') + ':</strong> '
					+ frappe.utils.escape_html(missingPatients) + '</p>'
					+ '<p class="text-muted"><strong>' + __('Sample missing admissions') + ':</strong> '
					+ frappe.utils.escape_html(missingAdms) + '</p>'
					+ '</div>'
			);

			if (!counts.valid_signatures) {
				frappe.msgprint({
					title: __('No signature images found'),
					message: __('No filenames matched the expected pattern (e.g. 190791-2249-SIGNATURE_01.jpg).'),
					indicator: 'orange',
				});
				return;
			}

			upload_patient_legacy_signature_files_sequential(dialog, files);
		},
	});
}

function upload_patient_legacy_signature_files_sequential(dialog, files) {
	const valid_files = files.filter((file) => {
		const name = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/').split('/').pop();
		return is_legacy_signature_filename(name);
	});

	if (!valid_files.length) {
		frappe.msgprint({
			title: __('No signature images'),
			message: __('No image files matched the SIGNATURE naming pattern.'),
			indicator: 'orange',
		});
		return;
	}

	const items = [];
	const failed = [];
	let index = 0;

	const render_progress = () => {
		const pct = Math.round((index / valid_files.length) * 100);
		dialog.fields_dict.progress_html.$wrapper.html(
			'<p class="small text-muted">'
				+ __('Uploading {0} of {1} ({2}%)…', [index, valid_files.length, pct])
				+ '</p>'
		);
	};

	const render_upload_summary = () => {
		dialog._sig_upload_items = items;
		const failed_list = failed
			.map((entry) => {
				const sizeInfo = entry.before ? ` (${frappe.utils.escape_html(entry.before)})` : '';
				const reason = entry.reason
					? ` - ${frappe.utils.escape_html(entry.reason)}`
					: '';
				return `${frappe.utils.escape_html(entry.filename)}${sizeInfo}${reason}`;
			})
			.join('<br>');
		let html = '';
		if (failed.length) {
			html += '<p class="text-orange small"><strong>'
				+ __('{0} of {1} uploaded. {2} failed — those will not be imported unless you retry.', [
					items.length,
					valid_files.length,
					failed.length,
				])
				+ '</strong></p>';
			html += '<p class="small text-muted"><strong>' + __('Failed files') + ':</strong><br>' + failed_list + '</p>';
		} else {
			html += '<p class="text-success small">'
				+ __('All {0} file(s) uploaded. Click Import to attach signatures.', [items.length])
				+ '</p>';
		}
		dialog.fields_dict.progress_html.$wrapper.html(html);
		dialog.get_primary_btn().prop('disabled', !items.length);
	};

	const upload_next = () => {
		if (index >= valid_files.length) {
			render_upload_summary();
			return;
		}

		const file = valid_files[index];
		const filename = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/').split('/').pop();
		render_progress();

		upload_patient_cpr_file(file)
			.then((file_url) => {
				items.push({ file_url, filename });
			})
			.catch((err) => {
				const reason = err instanceof Error ? err.message : String(err || '');
				failed.push({
					filename,
					before: format_bytes(file.size),
					reason,
				});
				frappe.show_alert({
					message: __('Failed to upload {0}', [filename]),
					indicator: 'red',
				}, 5);
				console.error('Legacy signature upload failed:', {
					filename,
					reason,
					sizeBytes: file.size,
					size: format_bytes(file.size),
				});
			})
			.finally(() => {
				index += 1;
				upload_next();
			});
	};

	render_progress();
	upload_next();
}

function start_patient_legacy_signature_import(dialog, replace_existing) {
	frappe.call({
		method: 'healthcare.api.data_migration_jobs.start_patient_legacy_signature_import_migration',
		args: {
			items: dialog._sig_upload_items,
			replace_existing,
		},
		freeze: true,
		freeze_message: __('Starting background import…'),
		callback(r) {
			if (r.message?.ok) {
				dialog.hide();
				frappe.show_alert({
					message: r.message.message || __('Legacy signature import started'),
					indicator: 'green',
				});
				poll_migration_status('patient_legacy_signature_import');
			}
		},
	});
}

// ── Legacy Visit Documents (Patient Documentation PDFs) ──────────────────────

function open_legacy_visit_document_folder_upload() {
	const dialog = new frappe.ui.Dialog({
		title: __('Import Legacy Visit Documents'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select a folder or multiple PDF/image files. Filenames must match '
						+ '<code>DOC_{LegacyVisit}_{Code}.pdf</code> (or <code>.jpg</code> / <code>.png</code>), e.g. '
						+ '<code>DOC_4762_ZF7BEVVCW44W9930.pdf</code> or <code>DOC_2617_75Y0F0YII37Z.jpg</code>. '
						+ 'Creates <strong>Legacy Visit Document</strong> rows. '
						+ 'Legacy Visit is taken from the filename. Date / patient file no / document type '
						+ 'are extracted from the PDF when readable. Scanned image-only PDFs are OCR’d '
						+ '(e.g. Arabic medical reports — رقم الملف). '
						+ 'Patient Visit link is left blank for a later backfill.')
					+ '</p>',
			},
			{
				fieldtype: 'Link',
				fieldname: 'default_document_type',
				label: __('Default Document Type (fallback)'),
				options: 'Document Type',
				default: 'Patient Documentation',
				description: __(
					'Used when the PDF does not clearly indicate a type (National ID, CPR ID, Discharge, etc.). '
						+ 'You can create new Document Types from the link field.'
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'replace_existing',
				label: __('Replace existing matching Legacy Visit Document rows'),
				default: 1,
			},
			{
				fieldtype: 'HTML',
				fieldname: 'preview_html',
				options: '<p class="text-muted">' + __('No files selected yet.') + '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'progress_html',
				options: '',
			},
		],
		primary_action_label: __('Import'),
		primary_action() {
			if (!dialog._lvd_upload_items || !dialog._lvd_upload_items.length) {
				frappe.msgprint({
					title: __('No files'),
					message: __('Select a folder or files first.'),
					indicator: 'orange',
				});
				return;
			}
			const replace_existing = dialog.get_value('replace_existing') ? 1 : 0;
			const default_document_type =
				dialog.get_value('default_document_type') || 'Patient Documentation';
			frappe.confirm(
				__(
					'Import {0} visit document PDF(s) into Legacy Visit Document?\n\n'
						+ 'Valid documents: {1}\n'
						+ 'Unique legacy visits: {2}\n'
						+ 'Invalid / skipped: {3}\n'
						+ 'Default Document Type: {4}\n\nContinue?',
					[
						dialog._lvd_upload_items.length,
						dialog._lvd_preview_counts?.valid_documents || 0,
						dialog._lvd_preview_counts?.unique_legacy_visits || 0,
						dialog._lvd_preview_counts?.invalid_filenames || 0,
						default_document_type,
					]
				),
				() => start_legacy_visit_document_import(dialog, replace_existing, default_document_type)
			);
		},
	});

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Folder'))
			.on('click', () => pick_legacy_visit_document_files(dialog, true))
	);
	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Files'))
			.on('click', () => pick_legacy_visit_document_files(dialog, false))
	);

	dialog.show();
	dialog.get_primary_btn().prop('disabled', true);

	// Seed common Document Types so the Link picker has useful options
	frappe.call({
		method: 'healthcare.api.legacy_visit_document_import.seed_document_types',
		callback() {
			dialog.set_value('default_document_type', 'Patient Documentation');
		},
	});
}

function pick_legacy_visit_document_files(dialog, use_folder) {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = true;
	input.accept = 'application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff';
	if (use_folder) {
		input.setAttribute('webkitdirectory', '');
		input.setAttribute('directory', '');
	}
	input.onchange = () => {
		const files = Array.from(input.files || []);
		if (!files.length) {
			return;
		}
		preview_and_upload_legacy_visit_document_files(dialog, files);
	};
	input.click();
}

function is_legacy_visit_document_filename(name) {
	const stem = (name || '').replace(/\.[^.]+$/, '');
	return /^DOC[_\-]\d+[_\-][A-Z0-9]+/i.test(stem);
}

function is_legacy_visit_document_file(name) {
	return is_legacy_visit_document_filename(name)
		&& /\.(pdf|jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name || '');
}

function preview_and_upload_legacy_visit_document_files(dialog, files) {
	const filenames = files.map((file) => {
		const path = file.webkitRelativePath || file.name || '';
		return path.replace(/\\/g, '/').split('/').pop();
	});
	const default_document_type =
		dialog.get_value('default_document_type') || 'Patient Documentation';

	dialog.fields_dict.preview_html.$wrapper.html(
		'<p class="text-muted">' + __('Checking filenames…') + '</p>'
	);
	dialog.fields_dict.progress_html.$wrapper.html('');
	dialog.get_primary_btn().prop('disabled', true);
	dialog._lvd_upload_items = null;
	dialog._lvd_preview_counts = null;

	frappe.call({
		method: 'healthcare.api.legacy_visit_document_import.preview_legacy_visit_document_filenames',
		args: { filenames, default_document_type },
		freeze: true,
		freeze_message: __('Analyzing filenames…'),
		callback(r) {
			const counts = r.message || {};
			dialog._lvd_preview_counts = counts;
			const sampleVisits = (counts.sample_legacy_visits || []).join(', ') || __('(none)');
			const sampleInvalid = (counts.sample_invalid_filenames || []).join(', ') || __('(none)');
			dialog.fields_dict.preview_html.$wrapper.html(
				'<div class="small">'
					+ '<p><strong>' + __('Files selected') + ':</strong> ' + files.length + '</p>'
					+ '<p><strong>' + __('Valid DOC_ files') + ':</strong> ' + (counts.valid_documents || 0) + '</p>'
					+ '<p><strong>' + __('Invalid / skipped filenames') + ':</strong> ' + (counts.invalid_filenames || 0) + '</p>'
					+ '<p><strong>' + __('Unique legacy visits') + ':</strong> ' + (counts.unique_legacy_visits || 0) + '</p>'
					+ '<p><strong>' + __('Default Document Type') + ':</strong> '
					+ frappe.utils.escape_html(counts.default_document_type || default_document_type) + '</p>'
					+ '<p class="text-muted"><strong>' + __('Sample legacy visits') + ':</strong> '
					+ frappe.utils.escape_html(sampleVisits) + '</p>'
					+ '<p class="text-muted"><strong>' + __('Sample invalid') + ':</strong> '
					+ frappe.utils.escape_html(sampleInvalid) + '</p>'
					+ '</div>'
			);

			if (!counts.valid_documents) {
				frappe.msgprint({
					title: __('No visit documents found'),
					message: __(
						'No filenames matched the expected pattern '
							+ '(e.g. DOC_4762_ZF7BEVVCW44W9930.pdf or DOC_2617_75Y0F0YII37Z.jpg).'
					),
					indicator: 'orange',
				});
				return;
			}

			upload_legacy_visit_document_files_sequential(dialog, files);
		},
	});
}

function upload_legacy_visit_document_files_sequential(dialog, files) {
	const valid_files = files.filter((file) => {
		const name = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/').split('/').pop();
		return is_legacy_visit_document_file(name);
	});

	if (!valid_files.length) {
		frappe.msgprint({
			title: __('No visit documents'),
			message: __('No PDF/image files matched the DOC_{visit}_{code} naming pattern.'),
			indicator: 'orange',
		});
		return;
	}

	const items = [];
	const failed = [];
	let index = 0;

	const render_progress = () => {
		const pct = Math.round((index / valid_files.length) * 100);
		dialog.fields_dict.progress_html.$wrapper.html(
			'<p class="small text-muted">'
				+ __('Uploading {0} of {1} ({2}%)…', [index, valid_files.length, pct])
				+ '</p>'
		);
	};

	const render_upload_summary = () => {
		dialog._lvd_upload_items = items;
		const failed_list = failed
			.map((entry) => {
				const sizeInfo = entry.before ? ` (${frappe.utils.escape_html(entry.before)})` : '';
				const reason = entry.reason
					? ` - ${frappe.utils.escape_html(entry.reason)}`
					: '';
				return `${frappe.utils.escape_html(entry.filename)}${sizeInfo}${reason}`;
			})
			.join('<br>');
		let html = '';
		if (failed.length) {
			html += '<p class="text-orange small"><strong>'
				+ __('{0} of {1} uploaded. {2} failed — those will not be imported unless you retry.', [
					items.length,
					valid_files.length,
					failed.length,
				])
				+ '</strong></p>';
			html += '<p class="small text-muted"><strong>' + __('Failed files') + ':</strong><br>' + failed_list + '</p>';
		} else {
			html += '<p class="text-success small">'
				+ __('All {0} file(s) uploaded. Click Import to create Legacy Visit Document records.', [items.length])
				+ '</p>';
		}
		dialog.fields_dict.progress_html.$wrapper.html(html);
		dialog.get_primary_btn().prop('disabled', !items.length);
	};

	const upload_next = () => {
		if (index >= valid_files.length) {
			render_upload_summary();
			return;
		}

		const file = valid_files[index];
		const filename = (file.webkitRelativePath || file.name || '').replace(/\\/g, '/').split('/').pop();
		render_progress();

		upload_patient_cpr_file(file)
			.then((file_url) => {
				items.push({ file_url, filename });
			})
			.catch((err) => {
				const reason = err instanceof Error ? err.message : String(err || '');
				failed.push({
					filename,
					before: format_bytes(file.size),
					reason,
				});
				frappe.show_alert({
					message: __('Failed to upload {0}', [filename]),
					indicator: 'red',
				}, 5);
				console.error('Legacy visit document upload failed:', {
					filename,
					reason,
					sizeBytes: file.size,
					size: format_bytes(file.size),
				});
			})
			.finally(() => {
				index += 1;
				upload_next();
			});
	};

	render_progress();
	upload_next();
}

function start_legacy_visit_document_import(dialog, replace_existing, default_document_type) {
	frappe.call({
		method: 'healthcare.api.data_migration_jobs.start_legacy_visit_document_import_migration',
		args: {
			items: dialog._lvd_upload_items,
			replace_existing,
			default_document_type: default_document_type || 'Patient Documentation',
		},
		freeze: true,
		freeze_message: __('Starting background import…'),
		callback(r) {
			if (r.message?.ok) {
				dialog.hide();
				frappe.show_alert({
					message: r.message.message || __('Legacy visit document import started'),
					indicator: 'green',
				});
				poll_migration_status('legacy_visit_document_import');
			}
		},
	});
}

function open_legacy_visit_document_analysis() {
	const dialog = new frappe.ui.Dialog({
		title: __('Analyze Legacy Visit Documents'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __('Select the same DOC_ PDF/image folder/files used for Direct Upload. '
						+ 'Analysis checks which documents already have a Legacy Visit Document row.')
					+ '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'result_html',
				options: '<p class="text-muted">' + __('No analysis run yet.') + '</p>',
			},
		],
		primary_action_label: __('Analyze Selected'),
		primary_action() {
			if (!dialog._lvd_analyze_filenames || !dialog._lvd_analyze_filenames.length) {
				frappe.msgprint({
					title: __('No files'),
					message: __('Select a folder or files first.'),
					indicator: 'orange',
				});
				return;
			}
			run_legacy_visit_document_analysis(dialog, dialog._lvd_analyze_filenames);
		},
	});

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Select Folder'))
			.on('click', () => {
				const input = document.createElement('input');
				input.type = 'file';
				input.multiple = true;
				input.accept = 'application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff';
				input.setAttribute('webkitdirectory', '');
				input.setAttribute('directory', '');
				input.onchange = () => {
					dialog._lvd_analyze_filenames = Array.from(input.files || []).map((file) => {
						const path = file.webkitRelativePath || file.name || '';
						return path.replace(/\\/g, '/').split('/').pop();
					});
					dialog.fields_dict.result_html.$wrapper.html(
						'<p class="small">'
							+ __('Selected {0} file(s). Click Analyze Selected.', [
								dialog._lvd_analyze_filenames.length,
							])
							+ '</p>'
					);
				};
				input.click();
			})
	);

	dialog.show();
}

function run_legacy_visit_document_analysis(dialog, filenames) {
	frappe.call({
		method: 'healthcare.api.legacy_visit_document_import.analyze_legacy_visit_documents',
		args: { filenames },
		freeze: true,
		freeze_message: __('Analyzing…'),
		callback(r) {
			const counts = r.message || {};
			const samplesMissing = (counts.samples?.not_uploaded || []).join('<br>') || __('(none)');
			dialog.fields_dict.result_html.$wrapper.html(
				'<div class="small">'
					+ '<p><strong>' + __('Folder filenames') + ':</strong> ' + (counts.folder_filenames || 0) + '</p>'
					+ '<p><strong>' + __('Valid DOC_ labels') + ':</strong> ' + (counts.folder_valid || 0) + '</p>'
					+ '<p><strong>' + __('Already uploaded') + ':</strong> ' + (counts.uploaded_ok || 0) + '</p>'
					+ '<p><strong>' + __('Not uploaded') + ':</strong> ' + (counts.not_uploaded || 0) + '</p>'
					+ '<p><strong>' + __('Invalid') + ':</strong> ' + (counts.folder_invalid || 0) + '</p>'
					+ '<p class="text-muted"><strong>' + __('Sample missing') + ':</strong><br>'
					+ samplesMissing + '</p>'
					+ '</div>'
			);
		},
	});
}

function open_direct_excel_upload({
	dialog_title,
	preview_method,
	start_method,
	job_key,
	build_confirm_message,
	allowed_file_types = ['.xlsx', '.xls'],
	freeze_message = __('Reading Excel…'),
}) {
	const uploader = new frappe.ui.FileUploader({
		dialog_title,
		allow_multiple: false,
		restrictions: {
			allowed_file_types,
		},
		on_success(file) {
			frappe.call({
				method: preview_method,
				args: { file_url: file.file_url },
				freeze: true,
				freeze_message,
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(build_confirm_message(counts), () => {
						frappe.call({
							method: start_method,
							args: { file_url: file.file_url },
							freeze: true,
							freeze_message: __('Starting background job…'),
							callback(r) {
								if (r.message?.ok) {
									frappe.show_alert({
										message: r.message.message || __('Job started'),
										indicator: 'green',
									});
									poll_migration_status(job_key);
								}
							},
						});
					});
				},
			});
		},
	});
}

function open_direct_sync_excel_upload({
	dialog_title,
	preview_method,
	import_method,
	build_confirm_message,
	build_result_message,
	allowed_file_types = ['.xlsx', '.xls'],
	freeze_message = __('Reading Excel…'),
	import_freeze_message = __('Importing…'),
}) {
	const uploader = new frappe.ui.FileUploader({
		dialog_title,
		allow_multiple: false,
		restrictions: {
			allowed_file_types,
		},
		on_success(file) {
			frappe.call({
				method: preview_method,
				args: { file_url: file.file_url },
				freeze: true,
				freeze_message,
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(build_confirm_message(counts), () => {
						frappe.call({
							method: import_method,
							args: { file_url: file.file_url },
							freeze: true,
							freeze_message: import_freeze_message,
							callback(r) {
								const result = r.message || {};
								frappe.msgprint({
									title: __('Import complete'),
									message: build_result_message(result),
									indicator: result.errors ? 'orange' : 'green',
								});
							},
						});
					});
				},
			});
		},
	});
}

function open_ip_admission_bundle_upload() {
	const files = {
		admission: null,
		nursing: null,
		discharge_checklist: null,
	};

	function pickFile(label, onDone) {
		new frappe.ui.FileUploader({
			dialog_title: label,
			allow_multiple: false,
			restrictions: {
				allowed_file_types: ['.xlsx', '.xls'],
			},
			on_success(file) {
				onDone(file.file_url);
			},
		});
	}

	function fileLabel(url) {
		if (!url) {
			return `<span class="text-muted">${__('Not uploaded')}</span>`;
		}
		const name = url.split('/').pop();
		return `<span class="text-success">✓ ${frappe.utils.escape_html(name)}</span>`;
	}

	function refreshStatus($wrapper) {
		$wrapper.html(`
			<p>${__(
				'Upload all three Excel files. Admissions and discharges are created first; checklist rows are applied to each Discharge in the same job.'
			)}</p>
			<table class="table table-bordered table-condensed" style="margin-bottom:0">
				<tbody>
					<tr>
						<td><strong>1.</strong> ${__('IP_ADMISSION_01')} (${__('admissions + discharges')})</td>
						<td class="bundle-adm-status">${fileLabel(files.admission)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-adm">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>2.</strong> ${__('IP_ADMISSION_04_NUR_CHECK_LIST')} (${__('nursing checklist')})</td>
						<td class="bundle-nur-status">${fileLabel(files.nursing)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-nur">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>3.</strong> ${__('IP_ADMISSION_04 Discharge Checklist')}</td>
						<td class="bundle-dc-status">${fileLabel(files.discharge_checklist)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-dc">${__('Upload')}</button></td>
					</tr>
				</tbody>
			</table>
			<p class="text-muted small" style="margin-top:8px">${__(
				'Import patients (PATIENT_INFO_01) before running this job.'
			)}</p>
		`);

		$wrapper.find('.btn-pick-adm').on('click', () => {
			pickFile(__('IP_ADMISSION_01 Excel'), (url) => {
				files.admission = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-nur').on('click', () => {
			pickFile(__('Nursing Checklist Excel'), (url) => {
				files.nursing = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-dc').on('click', () => {
			pickFile(__('Discharge Checklist Excel'), (url) => {
				files.discharge_checklist = url;
				refreshStatus($wrapper);
			});
		});
	}

	const dialog = new frappe.ui.Dialog({
		title: __('ADM Dis + Checklists'),
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'bundle_status',
				options: '<div class="ip-admission-bundle-status"></div>',
			},
		],
		primary_action_label: __('Preview & Import'),
		primary_action() {
			if (!files.admission) {
				frappe.msgprint({
					title: __('Admission file required'),
					message: __('Please upload the IP_ADMISSION_01 Excel file.'),
					indicator: 'orange',
				});
				return;
			}
			if (!files.nursing || !files.discharge_checklist) {
				frappe.msgprint({
					title: __('Checklist files required'),
					message: __(
						'Please upload both the nursing checklist and discharge checklist Excel files.'
					),
					indicator: 'orange',
				});
				return;
			}

			frappe.call({
				method:
					'healthcare.api.ip_admission_discharge_import.preview_ip_admission_discharge_bundle_import',
				args: {
					admission_file_url: files.admission,
					nursing_file_url: files.nursing,
					discharge_checklist_file_url: files.discharge_checklist,
				},
				freeze: true,
				freeze_message: __('Reading Excel files…'),
				callback(preview) {
					const counts = preview.message || {};
					const missingSamples = (counts.sample_missing_patients || [])
						.map((row) => `${row.case_no} → ${row.patient}`)
						.join('\n');
					const missingBlock =
						(counts.missing_patients || 0) > 0
							? __(
									'Rows with missing Patient: {0} ({1} unique File Nos not in system)\n'
										+ 'Examples (Case No → File No):\n{2}\n\n'
										+ 'Import these patients via PATIENT_INFO_01 first, then re-run admissions.\n\n',
									[
										counts.missing_patients || 0,
										counts.unique_missing_file_nos || 0,
										missingSamples || __('(none)'),
									]
								)
							: '';
					frappe.confirm(
						__(
							'Import IP Admissions, Discharges, and both checklists?\n\n'
								+ 'Admission Excel rows: {0}\n'
								+ 'Admissions (Case No): {1}\n'
								+ 'Discharged rows: {2}\n'
								+ 'Admitted rows (no Discharge): {3}\n'
								+ '{4}'
								+ 'Nursing checklist: {5} admissions ({6} rows)\n'
								+ 'Discharge checklist: {7} admissions ({8} rows)\n\n'
								+ 'Sample Case Nos: {9}\n\nContinue?',
							[
								counts.excel_rows || 0,
								counts.admissions || 0,
								counts.discharged_rows || 0,
								counts.admitted_rows || 0,
								missingBlock,
								counts.nursing_admissions || 0,
								counts.nursing_rows || 0,
								counts.discharge_checklist_admissions || 0,
								counts.discharge_checklist_rows || 0,
								(counts.sample_case_nos || []).join(', ') || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method:
									'healthcare.api.data_migration_jobs.start_ip_admission_discharge_import_migration',
								args: {
									file_url: files.admission,
									nursing_file_url: files.nursing,
									discharge_checklist_file_url: files.discharge_checklist,
								},
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										dialog.hide();
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('ip_admission_discharge_import');
									}
								},
							});
						}
					);
				},
			});
		},
	});

	dialog.show();
	refreshStatus(dialog.fields_dict.bundle_status.$wrapper.find('.ip-admission-bundle-status'));
}

/**
 * Healthcare Settings → Direct Upload → Repair OP Prescriptions.
 *
 * The first OP prescription import lost its cached work queue mid-run and reported success
 * with part of the workbook unprocessed. This dialog re-imports only the visits that still
 * have no Patient Medication Order and removes the duplicate HIS prescription created for
 * visits that already have a PATIENT_VISIT_PRESCRIPTION prescription.
 *
 * Both workbooks are optional: when nothing is uploaded the most recent copy stored in the
 * site files (PATIENT_VISIT_PRESCRIPTION.xlsx / _HIS.xlsx) is used.
 */
function open_op_prescription_repair() {
	const files = {
		visit: null,
		his: null,
	};

	function pickFile(label, onDone) {
		new frappe.ui.FileUploader({
			dialog_title: label,
			allow_multiple: false,
			restrictions: {
				allowed_file_types: ['.xlsx', '.xls'],
			},
			on_success(file) {
				onDone(file.file_url);
			},
		});
	}

	function fileLabel(url) {
		if (!url) {
			return `<span class="text-muted">${__('Use the latest file stored on the server')}</span>`;
		}
		const name = url.split('/').pop();
		return `<span class="text-success">✓ ${frappe.utils.escape_html(name)}</span>`;
	}

	function refreshStatus($wrapper) {
		$wrapper.html(`
			<table class="table table-bordered table-condensed" style="margin-bottom:0">
				<tbody>
					<tr>
						<td><strong>1.</strong> ${__('PATIENT_VISIT_PRESCRIPTION')} (${__(
							'missing visit prescriptions'
						)})</td>
						<td class="repair-visit-status">${fileLabel(files.visit)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-visit">${__(
							'Upload'
						)}</button></td>
					</tr>
					<tr>
						<td><strong>2.</strong> ${__('PATIENT_VISIT_PRESCRIPTION_HIS')} (${__(
							'missing HIS visits'
						)})</td>
						<td class="repair-his-status">${fileLabel(files.his)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-his">${__(
							'Upload'
						)}</button></td>
					</tr>
				</tbody>
			</table>
			<p class="text-muted small" style="margin-top:8px">${__(
				'The scan is read-only. Only visits without an existing OP prescription are imported, so the repair is idempotent.'
			)}</p>
		`);

		$wrapper.find('.btn-pick-visit').on('click', () => {
			pickFile(__('PATIENT_VISIT_PRESCRIPTION Excel'), (url) => {
				files.visit = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-his').on('click', () => {
			pickFile(__('PATIENT_VISIT_PRESCRIPTION_HIS Excel'), (url) => {
				files.his = url;
				refreshStatus($wrapper);
			});
		});
	}


	function buildConfirmMessage(plan) {
		const visit = plan.visit_source || {};
		const his = plan.his_source || {};
		const dupes = plan.duplicates || {};
		const keepLabel =
			plan.keep_rule === 'richer'
				? __('the prescription with more medicine lines')
				: __('the PATIENT_VISIT_PRESCRIPTION record');

		const rows = [__('Repair OP visit prescriptions?'), ''];
		if (plan.visit_file_url) {
			rows.push(
				__(
					'PATIENT_VISIT_PRESCRIPTION: {0} visits in the workbook, {1} already in ERP, {2} missing ({3} medicine lines) will be imported.',
					[
						visit.visits || 0,
						(visit.visits || 0) - (visit.missing_visits || 0),
						visit.missing_visits || 0,
						visit.missing_lines || 0,
					]
				)
			);
		}
		if (plan.his_file_url) {
			rows.push(
				__(
					'PATIENT_VISIT_PRESCRIPTION_HIS: {0} visits in the workbook, {1} missing ({2} medicine lines) will be imported, {3} already covered by the visit import.',
					[
						his.visits || 0,
						his.missing_visits || 0,
						his.missing_lines || 0,
						his.covered_by_visit_import || 0,
					]
				)
			);
		}
		rows.push(
			__(
				'Duplicate prescriptions: {0} visit(s) hold both a visit and a HIS prescription. {1} record(s) / {2} medicine line(s) will be cancelled and deleted, keeping {3}.',
				[dupes.visits || 0, dupes.visits || 0, dupes.lines_removed || 0, keepLabel]
			)
		);
		const repeated = plan.line_duplicates || {};
		if (repeated.visits) {
			rows.push(
				__(
					'Repeated medicine lines: {0} prescription(s) store the same medicine more than once ({1} of {2} line(s) are exact repeats). One copy of each line is kept and {3} line(s) removed.',
					[
						repeated.visits || 0,
						repeated.repeated_lines || 0,
						repeated.total_lines || 0,
						repeated.repeated_lines || 0,
					]
				)
			);
		}

		const skippedRows = (visit.skipped_rows || 0) + (his.skipped_rows || 0);
		if (skippedRows) {
			rows.push(
				__(
					'Warning: {0} row(s) in the workbooks have no VISIT_CD and cannot be imported.',
					[skippedRows]
				)
			);
		}
		rows.push('');
		rows.push(
			__(
				'Both jobs run in the background and can be re-run safely without duplicating data. Continue?'
			)
		);
		return rows.join('\n');
	}

	const dialog = new frappe.ui.Dialog({
		title: __('Repair OP Prescriptions'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'repair_files',
				options: '<div class="op-prescription-repair-files"></div>',
			},
			{
				fieldtype: 'Check',
				fieldname: 'import_missing',
				label: __('Import missing visit prescriptions'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'remove_duplicates',
				label: __('Remove duplicate prescriptions (same visit imported by both jobs)'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dedupe_lines',
				label: __(
					'Remove repeated medicine lines inside each prescription (the Oracle export repeats a visit up to ~20 times)'
				),
				default: 1,
			},
			{
				fieldtype: 'Select',
				fieldname: 'keep_rule',
				label: __('Duplicate: which prescription to keep'),
				options: [
					{ value: 'source', label: __('PATIENT_VISIT_PRESCRIPTION (recommended)') },
					{ value: 'richer', label: __('The one with more medicine lines') },
				],
				default: 'source',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'repair_note',
				options: `<p class="text-muted small">${__(
					'Duplicate prescriptions are cancelled and deleted (they remain in Deleted Document, so they can be restored).'
				)}</p>`,
			},
		],
		primary_action_label: __('Scan & Repair'),
		primary_action(values) {
			frappe.call({
				method: 'healthcare.api.op_prescription_repair.preview_op_prescription_repair',
				args: {
					visit_file_url: files.visit,
					his_file_url: files.his,
					keep_rule: values.keep_rule,
				},
				freeze: true,
				freeze_message: __('Scanning workbooks and ERP prescriptions…'),
				callback(preview) {
					const plan = preview.message || {};
					frappe.confirm(buildConfirmMessage(plan), () => {
						frappe.call({
							method: 'healthcare.api.op_prescription_repair.start_op_prescription_repair',
							args: {
								visit_file_url: files.visit,
								his_file_url: files.his,
								keep_rule: values.keep_rule,
								import_missing: values.import_missing ? 1 : 0,
								remove_duplicates: values.remove_duplicates ? 1 : 0,
								dedupe_lines: values.dedupe_lines ? 1 : 0,
							},
							freeze: true,
							freeze_message: __('Queueing the repair jobs…'),
							callback(r) {
								const result = r.message || {};
								if (!result.ok) {
									return;
								}
								dialog.hide();
								frappe.show_alert({
									message: result.message || __('Repair started'),
									indicator: result.nothing_to_do ? 'blue' : 'green',
								});
								(result.started || []).forEach((job) => {
									if (job.job) {
										poll_migration_status(job.job);
									}
								});
							},
						});
					});
				},
			});
		},
	});

	dialog.show();
	refreshStatus(
		dialog.fields_dict.repair_files.$wrapper.find('.op-prescription-repair-files')
	);
}


/**
 * Oracle -> ERPNext buttons: where does the legacy data come from?
 *
 * A live SQL*Plus login is not always available (VPN, a locked account, the
 * Oracle container down), so every Oracle button first asks how to read the
 * legacy tables:
 *
 *   Direct connection - the button reads CLINIC2 live, exactly as before.
 *   Excel export      - the user exports the Oracle table(s) from SQL Developer
 *                       and uploads them; the server answers every query from
 *                       the workbook instead of Oracle.
 *
 * The table names come from the server
 * (healthcare.api.oracle_excel_source.get_oracle_sources), so the dialog and
 * the import code can never disagree about which table a button needs.
 */
const ORACLE_SOURCES_PROMISE = { current: null };

function get_oracle_sources() {
	if (!ORACLE_SOURCES_PROMISE.current) {
		ORACLE_SOURCES_PROMISE.current = new Promise((resolve) => {
			frappe.call({
				method: 'healthcare.api.oracle_excel_source.get_oracle_sources',
				callback: (r) => resolve(r.message || {}),
				error: () => resolve({}),
			});
		});
	}
	return ORACLE_SOURCES_PROMISE.current;
}

function ask_oracle_source({ title, entity, intro, on_direct, on_excel }) {
	get_oracle_sources().then((sources) => {
		const spec = sources[entity] || { tables: [] };
		const tables = spec.tables || [];
		const files = {};
		const upload_key = (table) => table.upload_id || table.table;

		const status_html = (key) => {
			const url = files[key];
			if (!url) {
				return `<span class="text-muted">${__('Not uploaded')}</span>`;
			}
			return `<span class="text-success">✓ ${oracle_sync_escape(url.split('/').pop())}</span>`;
		};

		const dialog = new frappe.ui.Dialog({
			title: title,
			size: 'large',
			fields: [
				{ fieldtype: 'HTML', fieldname: 'intro', options: intro || '' },
				{
					fieldtype: 'Select',
					fieldname: 'mode',
					label: __('Read the Oracle data from'),
					options: [
						{ value: 'direct', label: __('Direct connection (live Oracle)') },
						{ value: 'excel', label: __('Excel export (upload the Oracle table)') },
					],
					default: 'direct',
					reqd: 1,
					onchange() {
						toggle_mode(dialog.get_value('mode'));
					},
				},
				{ fieldtype: 'HTML', fieldname: 'upload_html' },
			],
			primary_action_label: __('Continue'),
			primary_action(values) {
				if ((values.mode || 'direct') === 'direct') {
					dialog.hide();
					if (on_direct) {
						on_direct();
					}
					return;
				}

				const missing = tables
					.filter((table) => !table.optional && !files[upload_key(table)])
					.map((table) => table.label || table.table);
				if (missing.length) {
					frappe.msgprint({
						title: __('Excel export missing'),
						indicator: 'orange',
						message: __('Upload the Excel export of: {0}', [missing.join(', ')]),
					});
					return;
				}

				const uploaded = tables.filter((table) => files[upload_key(table)]);
				if (tables.length && !uploaded.length) {
					frappe.msgprint({
						title: __('Excel export missing'),
						indicator: 'orange',
						message: __('Upload the Excel export of: {0}', [
							tables.map((table) => table.label || table.table).join(' or '),
						]),
					});
					return;
				}

				dialog.hide();
				if (on_excel) {
					on_excel(
						tables
							.filter((table) => files[upload_key(table)])
							.map((table) => ({
								table: table.table,
								file_url: files[upload_key(table)],
							}))
					);
				}
			},
		});

		function toggle_mode(mode) {
			dialog.fields_dict.upload_html.$wrapper.toggle((mode || 'direct') === 'excel');
		}

		function render_upload() {
			const $wrapper = dialog.fields_dict.upload_html.$wrapper;
			if (!tables.length) {
				$wrapper.html('');
				return;
			}

			const rows = tables
				.map((table) => {
					const key = upload_key(table);
					return `<tr>
						<td>
							<b>${oracle_sync_escape(table.table)}</b><br>
							<span class="text-muted small">${oracle_sync_escape(table.label)}</span>
						</td>
						<td class="small text-muted"><code>${oracle_sync_escape(table.hint)}</code></td>
						<td>${status_html(key)}</td>
						<td class="text-right">
							<button type="button" class="btn btn-xs btn-default oracle-upload-pick"
								data-upload-id="${oracle_sync_escape(key)}">${__('Upload')}</button>
						</td>
					</tr>`;
				})
				.join('');

			$wrapper.html(`
				<div class="alert alert-info small">
					${__(
						'In SQL Developer run the SELECT of each table below, save the result as Excel (.xlsx) and upload it here. Keep the Oracle column names; a single workbook with one sheet per table works too when the sheet is named after the table. Large tables may be split into part1 / part2 files — upload both slots when shown.'
					)}
				</div>
				<table class="table table-bordered table-condensed" style="margin-bottom:0">
					<thead>
						<tr>
							<th style="width:26%">${__('Oracle table')}</th>
							<th>${__('Export')}</th>
							<th style="width:24%">${__('Excel file')}</th>
							<th style="width:12%"></th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			`);

			$wrapper.find('.oracle-upload-pick').on('click', function () {
				const key = $(this).attr('data-upload-id');
				new frappe.ui.FileUploader({
					dialog_title: __('{0} Excel export', [key]),
					allow_multiple: false,
					restrictions: { allowed_file_types: ['.xlsx'] },
					on_success(file) {
						files[key] = file.file_url;
						render_upload();
					},
				});
			});
		}

		dialog.show();
		render_upload();
		toggle_mode('direct');
	});
}


/**
 * Legacy users: Oracle USR_00_01 -> Oracle User.
 *
 * Every legacy table keeps the person who created / changed a row in CR_ID and
 * UP_ID, and those columns hold USR_00_01.USR_NUM (numbers, not names). Read
 * USR_00_01 once - straight from Oracle or from its Excel export - and the
 * Oracle User doctype maps those numbers back to the user's name.
 */
function open_oracle_user_upload() {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: User'),
		entity: 'user',
		intro: `<p class="text-muted small">${__(
			'CR ID / CUP ID (UP_ID) on the legacy tables are USR_NUM values and the name of each one is read from USR_00_01. Existing Oracle User records are updated, new ones are created, and the legacy password column (PSWD) is never imported.'
		)}</p>`,
		on_direct: () => preview_oracle_users(null),
		on_excel: (files) => preview_oracle_users((files[0] || {}).file_url),
	});
}

function preview_oracle_users(file_url) {
	const args = {};
	if (file_url) {
		args.file_url = file_url;
	}

	frappe.call({
		method: 'healthcare.api.usr_00_01_import.preview_user_00_01_import',
		args: args,
		freeze: true,
		freeze_message: file_url
			? __('Reading Oracle users (all sheets)…')
			: __('Reading USR_00_01 from Oracle…'),
		callback(preview) {
			const counts = preview.message || {};
			const sample = (counts.sample || [])
				.map(
					(row) =>
						`${row.user_num}: ${row.display_name || row.user_name || row.login_name || '(no name)'}`
						+ (row.user_group ? ` — ${row.user_group}` : '')
						+ (row.is_active ? '' : ' (inactive)')
				)
				.join('\n');

			frappe.confirm(
				__(
					'Import legacy Oracle users (USR_00_01) into Oracle User?\n\n'
						+ 'Read from: {0}\n'
						+ 'Sheets read: {1}\n'
						+ 'Rows: {2}\n'
						+ 'Users: {3} ({4} new, {5} existing)\n'
						+ 'Rows without user num (skipped): {6}\n'
						+ 'Repeated user num rows (merged): {7}\n'
						+ 'Unmapped columns (ignored): {8}\n\n'
						+ 'Sample:\n{9}\n\nContinue?',
					[
						counts.oracle_table || '',
						(counts.sheets || []).join(', ') || __('(none)'),
						counts.excel_rows || 0,
						counts.valid_rows || 0,
						counts.to_create || 0,
						counts.to_update || 0,
						counts.skipped_without_user_num || 0,
						counts.duplicate_rows || 0,
						(counts.unmapped_columns || []).join(', ') || __('(none)'),
						sample || __('(none)'),
					]
				),
				() => {
					frappe.call({
						method: 'healthcare.api.usr_00_01_import.import_user_00_01',
						args: args,
						freeze: true,
						freeze_message: __('Importing Oracle users…'),
						callback(r) {
							const result = r.message || {};
							let details = result.message || __('Import complete.');
							if ((result.error_samples || []).length) {
								details +=
									'<br><br>'
									+ result.error_samples.map(frappe.utils.escape_html).join('<br>');
							}
							frappe.msgprint({
								title: __('Oracle Users Imported'),
								message: details,
								indicator: result.errors ? 'orange' : 'green',
							});
						},
					});
				}
			);
		},
	});
}

function open_tricare_price_update_upload() {
	const files = {
		lab: null,
		ip: null,
		iop: null,
		op: null,
	};

	function pickFile(label, onDone) {
		new frappe.ui.FileUploader({
			dialog_title: label,
			allow_multiple: false,
			restrictions: {
				allowed_file_types: ['.xlsx', '.xls'],
			},
			on_success(file) {
				onDone(file.file_url);
			},
		});
	}

	function fileLabel(url) {
		if (!url) {
			return `<span class="text-muted">${__('Not uploaded')}</span>`;
		}
		const name = url.split('/').pop();
		return `<span class="text-success">✓ ${frappe.utils.escape_html(name)}</span>`;
	}

	function refreshStatus($wrapper) {
		$wrapper.html(`
			<p>${__(
				'Upload TRICARE price lists. New prices (Effective June 16 2026 – Dec 31 2027) update Inclusive Items on Health Insurance TRICARE (price, %). Older Excel period prices are saved as Insurance History Prices. Lab: 1% inpatient / 6% outpatient. IP: 3% on both. OP: 20% outpatient / 0% inpatient. IOP: 0% on both (Discount Apply off). Lab → Test Code; IP → Services Code; IOP → IOP column as IOP-{name} (e.g. MEDICAL REPORT → IOP-MEDICAL REPORT); OP → OUT column (e.g. ECG → OP-ECG).'
			)}</p>
			<table class="table table-bordered table-condensed" style="margin-bottom:0">
				<tbody>
					<tr>
						<td><strong>1.</strong> ${__('Lab Tests')}</td>
						<td class="bundle-tri-lab-status">${fileLabel(files.lab)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-tri-lab">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>2.</strong> ${__('In Patient')}</td>
						<td class="bundle-tri-ip-status">${fileLabel(files.ip)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-tri-ip">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>3.</strong> ${__('IOP')}</td>
						<td class="bundle-tri-iop-status">${fileLabel(files.iop)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-tri-iop">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>4.</strong> ${__('Out Patient')}</td>
						<td class="bundle-tri-op-status">${fileLabel(files.op)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-tri-op">${__('Upload')}</button></td>
					</tr>
				</tbody>
			</table>
		`);

		$wrapper.find('.btn-pick-tri-lab').on('click', () => {
			pickFile(__('Lab Tests Price List Excel'), (url) => {
				files.lab = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-tri-ip').on('click', () => {
			pickFile(__('In Patient Price List Excel'), (url) => {
				files.ip = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-tri-iop').on('click', () => {
			pickFile(__('IOP Price List Excel'), (url) => {
				files.iop = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-tri-op').on('click', () => {
			pickFile(__('Out Patient Price List Excel'), (url) => {
				files.op = url;
				refreshStatus($wrapper);
			});
		});
	}

	const dialog = new frappe.ui.Dialog({
		title: __('TRICARE Price Lists — June 16 2026'),
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'bundle_status',
				options: '<div class="tricare-price-bundle-status"></div>',
			},
		],
		primary_action_label: __('Preview & Update'),
		primary_action() {
			if (!files.lab && !files.ip && !files.iop && !files.op) {
				frappe.msgprint({
					title: __('File required'),
					message: __('Upload at least one TRICARE price list Excel file.'),
					indicator: 'orange',
				});
				return;
			}

			const args = {
				lab_file_url: files.lab || null,
				ip_file_url: files.ip || null,
				iop_file_url: files.iop || null,
				op_file_url: files.op || null,
			};

			frappe.call({
				method: 'healthcare.api.tricare_price_update.preview_tricare_price_update',
				args,
				freeze: true,
				freeze_message: __('Reading TRICARE price lists…'),
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Update TRICARE inclusive item prices and archive older Excel prices?\n\n'
								+ 'Insurance: {0}\n'
								+ 'New period: {1} → {2}\n\n'
								+ 'New inclusive rows to apply: lab {3}, IP {4}, IOP {5}, OP {6}\n'
								+ 'History price rows: {7}\n'
								+ 'Unmatched sample count: {8}\n\nContinue?',
							[
								counts.insurance || 'TRICARE',
								counts.new_from || '',
								counts.new_to || '',
								counts.lab_current || 0,
								counts.ip_current || 0,
								counts.iop_current || 0,
								counts.op_current || 0,
								counts.history_rows || 0,
								counts.missing_count || 0,
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.tricare_price_update.update_tricare_prices_from_excel',
								args,
								freeze: true,
								freeze_message: __('Updating TRICARE prices…'),
								callback(r) {
									const m = r.message || {};
									dialog.hide();
									let details = (m.message || __('Update complete.')).replace(/\n/g, '<br>');
									if (m.missing_count) {
										const sample = (m.missing_sample || []).join('<br>');
										details += `<br><br>${__('Unmatched')}: ${m.missing_count}`;
										if (sample) {
											details += `<br>${sample}`;
										}
									}
									frappe.msgprint({
										title: __('TRICARE Prices Updated'),
										message: details,
										indicator: m.missing_count ? 'orange' : 'green',
									});
								},
							});
						}
					);
				},
			});
		},
	});

	dialog.show();
	refreshStatus(dialog.fields_dict.bundle_status.$wrapper.find('.tricare-price-bundle-status'));
}

function open_insurance_claim_bundle_upload() {
	const files = {
		master: null,
		services: null,
	};

	function pickFile(label, onDone) {
		new frappe.ui.FileUploader({
			dialog_title: label,
			allow_multiple: false,
			restrictions: {
				allowed_file_types: ['.xlsx', '.xls'],
			},
			on_success(file) {
				onDone(file.file_url);
			},
		});
	}

	function fileLabel(url) {
		if (!url) {
			return `<span class="text-muted">${__('Not uploaded')}</span>`;
		}
		const name = url.split('/').pop();
		return `<span class="text-success">✓ ${frappe.utils.escape_html(name)}</span>`;
	}

	function refreshStatus($wrapper) {
		$wrapper.html(`
			<p>${__(
				'Upload the insurance claim files. INSURANCE_00_01 creates one Insurance Claim per TRANS_NUM (as TRICARE, tagged Legacy); INSURANCE_00_02 service lines are attached by TRANS_NUM. Each patient is marked insured (TRICARE) and gets an Insurance Patient Register if missing. Existing claims (same Trans No) are skipped.'
			)}</p>
			<table class="table table-bordered table-condensed" style="margin-bottom:0">
				<tbody>
					<tr>
						<td><strong>1.</strong> ${__('INSURANCE_00_01')} (${__('master claims')})</td>
						<td class="bundle-ins-master-status">${fileLabel(files.master)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-ins-master">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>2.</strong> ${__('INSURANCE_00_02')} (${__('claim services — optional')})</td>
						<td class="bundle-ins-services-status">${fileLabel(files.services)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-ins-services">${__('Upload')}</button></td>
					</tr>
				</tbody>
			</table>
		`);

		$wrapper.find('.btn-pick-ins-master').on('click', () => {
			pickFile(__('INSURANCE_00_01 Excel'), (url) => {
				files.master = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-ins-services').on('click', () => {
			pickFile(__('INSURANCE_00_02 Excel'), (url) => {
				files.services = url;
				refreshStatus($wrapper);
			});
		});
	}

	const dialog = new frappe.ui.Dialog({
		title: __('Insurance Claims — INSURANCE_00_01 + 02'),
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'bundle_status',
				options: '<div class="insurance-claim-bundle-status"></div>',
			},
		],
		primary_action_label: __('Import Claims'),
		primary_action() {
			if (!files.master) {
				frappe.msgprint({
					title: __('Master file required'),
					message: __('Please upload the INSURANCE_00_01 master Excel file.'),
					indicator: 'orange',
				});
				return;
			}

			frappe.confirm(
				__(
					'Import insurance claims as TRICARE (tagged Legacy)? Large files can take a minute. Continue?'
				),
				() => {
					frappe.call({
						method: 'healthcare.healthcare.api.insurance_claim.import_insurance_claims',
						args: {
							master_file_url: files.master,
							child_file_url: files.services,
						},
						freeze: true,
						freeze_message: __('Importing insurance claims…'),
						callback(r) {
							const m = r.message || {};
							dialog.hide();
							frappe.msgprint({
								title: __('Insurance Claim Import Complete'),
								indicator: m.error_count ? 'orange' : 'green',
								message: __(
									'Master rows: {0}<br>Created: {1}<br>Updated (existing drafts): {2}<br>Submitted: {3}<br>Skipped (already submitted/blank): {4}<br>Patients insured (TRICARE): {5}<br>Registers created: {6}<br>New patients created: {7}<br>Errors: {8}',
									[
										m.total_master_rows || 0,
										m.created || 0,
										m.updated || 0,
										m.submitted || 0,
										m.skipped || 0,
										m.patients_insured || 0,
										m.registers_created || 0,
										m.patients_created || 0,
										m.error_count || 0,
									]
								),
							});
						},
					});
				}
			);
		},
	});

	dialog.show();
	refreshStatus(dialog.fields_dict.bundle_status.$wrapper.find('.insurance-claim-bundle-status'));
}

function open_lab_test_bundle_upload() {
	const files = {
		header: null,
		detail: null,
	};

	function pickFile(label, onDone) {
		new frappe.ui.FileUploader({
			dialog_title: label,
			allow_multiple: false,
			restrictions: {
				allowed_file_types: ['.xlsx', '.xls'],
			},
			on_success(file) {
				onDone(file.file_url);
			},
		});
	}

	function fileLabel(url) {
		if (!url) {
			return `<span class="text-muted">${__('Not uploaded')}</span>`;
		}
		const name = url.split('/').pop();
		return `<span class="text-success">✓ ${frappe.utils.escape_html(name)}</span>`;
	}

	function refreshStatus($wrapper) {
		$wrapper.html(`
			<p>${__(
				'Upload both lab Excel files. LAB_00_03 creates the parent Lab Test; LAB_00_04 lines (all sheets) become child rows in lab_test_lines. is_legacy_import is set on each record.'
			)}</p>
			<table class="table table-bordered table-condensed" style="margin-bottom:0">
				<tbody>
					<tr>
						<td><strong>1.</strong> ${__('C LAB_00_03')} (${__('header / parent')})</td>
						<td class="bundle-lab-header-status">${fileLabel(files.header)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-lab-header">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>2.</strong> ${__('C-I LAB_00_04')} (${__('detail lines — both sheets')})</td>
						<td class="bundle-lab-detail-status">${fileLabel(files.detail)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-lab-detail">${__('Upload')}</button></td>
					</tr>
				</tbody>
			</table>
		`);

		$wrapper.find('.btn-pick-lab-header').on('click', () => {
			pickFile(__('C LAB_00_03 Excel'), (url) => {
				files.header = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-lab-detail').on('click', () => {
			pickFile(__('C-I LAB_00_04 Excel'), (url) => {
				files.detail = url;
				refreshStatus($wrapper);
			});
		});
	}

	const dialog = new frappe.ui.Dialog({
		title: __('Lab Test — LAB_003 + LAB_004'),
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'bundle_status',
				options: '<div class="lab-test-bundle-status"></div>',
			},
		],
		primary_action_label: __('Preview & Import'),
		primary_action() {
			if (!files.header) {
				frappe.msgprint({
					title: __('Header file required'),
					message: __('Please upload the C LAB_00_03 Excel file.'),
					indicator: 'orange',
				});
				return;
			}
			if (!files.detail) {
				frappe.msgprint({
					title: __('Detail file required'),
					message: __('Please upload the C-I LAB_00_04 Excel file (both sheets are read).'),
					indicator: 'orange',
				});
				return;
			}

			frappe.call({
				method: 'healthcare.api.lab_test_legacy_import.preview_legacy_lab_import',
				args: {
					header_file_url: files.header,
					detail_file_url: files.detail,
				},
				freeze: true,
				freeze_message: __('Reading Excel files…'),
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Import legacy lab tests?\n\n'
								+ 'Header rows (LAB_00_03): {0}\n'
								+ 'Detail rows (LAB_00_04, all sheets): {1}\n'
								+ 'Transactions: {2}\n'
								+ 'With header (003): {3}\n'
								+ 'With result lines: {4}\n'
								+ 'Existing patient links: {5}\n'
								+ 'Will create Patient from SUB_DR_GL_CODE: {6}\n'
								+ 'Matching lab template: {7}\n'
								+ 'Standalone (004 only, no 003 header): {8}\n\n'
								+ 'Missing visit/admission/patient will not block import — Patient is created from SUB_DR_GL_CODE when needed. Parent = Lab Test; children = lab_test_lines. No billing is created.\n\nContinue?',
							[
								counts.header_rows || 0,
								counts.detail_rows || 0,
								counts.transactions || 0,
								counts.transactions_with_header || 0,
								counts.transactions_with_results || 0,
								counts.resolvable_patient || 0,
								counts.will_create_patient_from_sub_dr || 0,
								counts.resolvable_template || 0,
								counts.standalone_transactions || counts.detail_without_header || 0,
							]
						),
						() => {
							frappe.call({
								method:
									'healthcare.api.data_migration_jobs.start_legacy_lab_import_migration',
								args: {
									header_file_url: files.header,
									detail_file_url: files.detail,
								},
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										dialog.hide();
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('legacy_lab_import');
									}
								},
							});
						}
					);
				},
			});
		},
	});

	dialog.show();
	refreshStatus(dialog.fields_dict.bundle_status.$wrapper.find('.lab-test-bundle-status'));
}

function open_ip_service_bundle_upload() {
	const files = {
		header: null,
		detail: null,
	};

	function pickFile(label, onDone) {
		new frappe.ui.FileUploader({
			dialog_title: label,
			allow_multiple: false,
			restrictions: {
				allowed_file_types: ['.xlsx', '.xls'],
			},
			on_success(file) {
				onDone(file.file_url);
			},
		});
	}

	function fileLabel(url) {
		if (!url) {
			return `<span class="text-muted">${__('Not uploaded')}</span>`;
		}
		const name = url.split('/').pop();
		return `<span class="text-success">✓ ${frappe.utils.escape_html(name)}</span>`;
	}

	function refreshStatus($wrapper) {
		$wrapper.html(`
			<p>${__(
				'Upload both IP Service Excel files. SRV_00_03 creates the parent IP Service; SRV_00_04 lines (all sheets) become child rows in Services. Missing Patient Visits are auto-created. Visit numbers with commas are normalized (e.g. 1,415 → 1415).'
			)}</p>
			<table class="table table-bordered table-condensed" style="margin-bottom:0">
				<tbody>
					<tr>
						<td><strong>1.</strong> ${__('C-I SRV_00_03')} (${__('header / parent')})</td>
						<td class="bundle-ip-header-status">${fileLabel(files.header)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-ip-header">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>2.</strong> ${__('C-I SRV_00_04')} (${__('detail lines — both sheets')})</td>
						<td class="bundle-ip-detail-status">${fileLabel(files.detail)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-ip-detail">${__('Upload')}</button></td>
					</tr>
				</tbody>
			</table>
		`);

		$wrapper.find('.btn-pick-ip-header').on('click', () => {
			pickFile(__('C-I SRV_00_03 Excel'), (url) => {
				files.header = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-ip-detail').on('click', () => {
			pickFile(__('C-I SRV_00_04 Excel'), (url) => {
				files.detail = url;
				refreshStatus($wrapper);
			});
		});
	}

	const dialog = new frappe.ui.Dialog({
		title: __('IP Service — SRV_00_03 — child 004'),
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'bundle_status',
				options: '<div class="ip-service-bundle-status"></div>',
			},
		],
		primary_action_label: __('Preview & Import'),
		primary_action() {
			if (!files.header) {
				frappe.msgprint({
					title: __('Header file required'),
					message: __('Please upload the C-I SRV_00_03 Excel file.'),
					indicator: 'orange',
				});
				return;
			}
			if (!files.detail) {
				frappe.msgprint({
					title: __('Detail file required'),
					message: __('Please upload the C-I SRV_00_04 Excel file (both sheets are read).'),
					indicator: 'orange',
				});
				return;
			}

			frappe.call({
				method: 'healthcare.api.ip_service_legacy_import.preview_legacy_ip_service_import',
				args: {
					header_file_url: files.header,
					detail_file_url: files.detail,
				},
				freeze: true,
				freeze_message: __('Reading Excel files…'),
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							'Import legacy IP Services?\n\n'
								+ 'Header rows (SRV_00_03): {0}\n'
								+ 'Detail rows (SRV_00_04, all sheets): {1}\n'
								+ 'Transactions: {2}\n'
								+ 'With header (003): {3}\n'
								+ 'With service lines: {4}\n'
								+ 'Visits already in system: {5}\n'
								+ 'Visits to auto-create: {6}\n'
								+ 'Transactions with matching template: {7}\n'
								+ 'Standalone (004 only, no 003 header): {8}\n\n'
								+ 'Parent = IP Service header; children = Services table. '
								+ 'SRV_SUB_NUM → Service Type (Healthcare Service Template). '
								+ 'SRV_GROUP_NUM → Service Group. '
								+ 'BRANCH_NUM → Cost Center (1=Serene Hospital, 2=Serene Center, 8=Jau Hospital). '
								+ 'Records are submitted. No billing is created.\n\nContinue?',
							[
								counts.header_rows || 0,
								counts.detail_rows || 0,
								counts.transactions || 0,
								counts.transactions_with_header || 0,
								counts.transactions_with_service_lines || 0,
								counts.resolvable_visits || 0,
								counts.visits_to_create || 0,
								counts.matching_templates || 0,
								counts.standalone_transactions || counts.detail_without_header || 0,
							]
						),
						() => {
							frappe.call({
								method:
									'healthcare.api.data_migration_jobs.start_legacy_ip_service_import_migration',
								args: {
									header_file_url: files.header,
									detail_file_url: files.detail,
								},
								freeze: true,
								freeze_message: __('Starting background job…'),
								callback(r) {
									if (r.message?.ok) {
										dialog.hide();
										frappe.show_alert({
											message: r.message.message || __('Job started'),
											indicator: 'green',
										});
										poll_migration_status('legacy_ip_service_import');
									}
								},
							});
						}
					);
				},
			});
		},
	});

	dialog.show();
	refreshStatus(dialog.fields_dict.bundle_status.$wrapper.find('.ip-service-bundle-status'));
}

function open_service_return_ip_service_upload() {
	const files = {
		header: null,
		detail: null,
	};

	function pickFile(label, onDone) {
		new frappe.ui.FileUploader({
			dialog_title: label,
			allow_multiple: false,
			restrictions: {
				allowed_file_types: ['.xlsx', '.xls'],
			},
			on_success(file) {
				onDone(file.file_url);
			},
		});
	}

	function fileLabel(url) {
		if (!url) {
			return `<span class="text-muted">${__('Not uploaded')}</span>`;
		}
		const name = url.split('/').pop();
		return `<span class="text-success">✓ ${frappe.utils.escape_html(name)}</span>`;
	}

	function refreshStatus($wrapper) {
		$wrapper.html(`
			<p>${__(
				'Upload both Service Return Excel files. SERVICE_RETURN_01 creates the parent IP Service return record; SERVICE_RETURN_02 lines become child rows in Services. The import ticks Return and keeps INV_NUM on each child line.'
			)}</p>
			<table class="table table-bordered table-condensed" style="margin-bottom:0">
				<tbody>
					<tr>
						<td><strong>1.</strong> ${__('SERVICE_RETURN_01')} (${__('header / parent')})</td>
						<td class="bundle-sr-header-status">${fileLabel(files.header)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-sr-header">${__('Upload')}</button></td>
					</tr>
					<tr>
						<td><strong>2.</strong> ${__('SERVICE_RETURN_02')} (${__('detail / child rows')})</td>
						<td class="bundle-sr-detail-status">${fileLabel(files.detail)}</td>
						<td><button type="button" class="btn btn-xs btn-default btn-pick-sr-detail">${__('Upload')}</button></td>
					</tr>
				</tbody>
			</table>
		`);

		$wrapper.find('.btn-pick-sr-header').on('click', () => {
			pickFile(__('SERVICE_RETURN_01 Excel'), (url) => {
				files.header = url;
				refreshStatus($wrapper);
			});
		});
		$wrapper.find('.btn-pick-sr-detail').on('click', () => {
			pickFile(__('SERVICE_RETURN_02 Excel'), (url) => {
				files.detail = url;
				refreshStatus($wrapper);
			});
		});
	}

	const dialog = new frappe.ui.Dialog({
		title: __('IP Service Return — SERVICE_RETURN_01 + 02'),
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'bundle_status',
				options: '<div class="service-return-bundle-status"></div>',
			},
		],
		primary_action_label: __('Preview & Import'),
		primary_action() {
			if (!files.header) {
				frappe.msgprint({
					title: __('Header file required'),
					message: __('Please upload the SERVICE_RETURN_01 Excel file.'),
					indicator: 'orange',
				});
				return;
			}
			if (!files.detail) {
				frappe.msgprint({
					title: __('Detail file required'),
					message: __('Please upload the SERVICE_RETURN_02 Excel file.'),
					indicator: 'orange',
				});
				return;
			}

			frappe.call({
				method: 'healthcare.api.service_return_import.preview_service_return_import',
				args: {
					header_file_url: files.header,
					detail_file_url: files.detail,
				},
				freeze: true,
				freeze_message: __('Reading Excel files…'),
				callback(preview) {
					const counts = preview.message || {};
					const headerLines = Object.entries(counts.header_sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					const detailLines = Object.entries(counts.detail_sheet_row_counts || {})
						.map(([name, n]) => `${name}: ${n}`)
						.join('\n');
					frappe.confirm(
						__(
							'Import Service Return into IP Service?\n\n'
								+ 'Header rows (SERVICE_RETURN_01): {0}\n'
								+ 'Header sheets:\n{1}\n\n'
								+ 'Detail rows (SERVICE_RETURN_02): {2}\n'
								+ 'Detail sheets:\n{3}\n\n'
								+ 'Transactions: {4}\n'
								+ 'Existing IP Service returns (will update): {5}\n'
								+ 'New: {6}\n'
								+ 'Patients resolved: {7}\n'
								+ 'Transactions with detail lines: {8}\n'
								+ 'Single linked return_ip_service: {9}\n'
								+ 'Multiple return invoices: {10}\n'
								+ 'Detail without header: {11}\n\n'
								+ 'Mapping: SERVICE_RETURN_01 → IP Service parent, SERVICE_RETURN_02 → Services child table. '
								+ 'INV_NUM is stored on child invoice_num and used for parent return_ip_service when there is a single source invoice. '
								+ 'Return is ticked automatically. Import runs immediately.\n\n'
								+ 'Sample trans_no keys: {12}\n\nContinue?',
							[
								counts.header_rows || 0,
								headerLines || __('(none)'),
								counts.detail_rows || 0,
								detailLines || __('(none)'),
								counts.transactions || 0,
								counts.existing_records || 0,
								counts.new_records || 0,
								counts.resolvable_patients || 0,
								counts.transactions_with_detail_lines || 0,
								counts.transactions_with_linked_return_ip_service || 0,
								counts.transactions_with_multiple_return_invoices || 0,
								counts.detail_without_header || 0,
								(counts.sample_trans_nos || []).join(', ') || __('(none)'),
							]
						),
						() => {
							frappe.call({
								method: 'healthcare.api.service_return_import.run_service_return_import',
								args: {
									header_file_url: files.header,
									detail_file_url: files.detail,
								},
								freeze: true,
								freeze_message: __('Importing service returns…'),
								callback(r) {
									const result = r.message || {};
									dialog.hide();
									frappe.msgprint({
										title: __('Import complete'),
										message: __(
											'Total: {0}\nCreated: {1}\nUpdated: {2}\nSkipped: {3}\nLinked return_ip_service: {4}\nMultiple return invoices: {5}\nErrors: {6}',
											[
												result.total || 0,
												result.created || 0,
												result.updated || 0,
												result.skipped || 0,
												result.linked_return_ip_service || 0,
												result.multi_return_invoices || 0,
												result.errors || 0,
											]
										),
										indicator: result.errors ? 'orange' : 'green',
									});
								},
							});
						}
					);
				},
			});
		},
	});

	dialog.show();
	refreshStatus(dialog.fields_dict.bundle_status.$wrapper.find('.service-return-bundle-status'));
}

function poll_migration_status(jobKey) {
	const poll = () => {
		frappe.call({
			method: 'healthcare.api.data_migration_jobs.get_migration_job_status',
			args: { job: jobKey },
			callback(r) {
				const s = r.message || {};
				if (s.running && !s.done) {
					if (
						jobKey === 'patient_visit_encounter_comment_clinical_note' &&
						s.stop_requested
					) {
						frappe.show_alert({
							message: __(
								'{0}: stop requested — finishing current visit, then halting… ({1} processed)',
								[jobKey, s.processed || 0]
							),
							indicator: 'orange',
						});
					} else if (s.processed) {
						frappe.show_alert({
							message: __('{0}: {1} records processed so far…', [jobKey, s.processed]),
							indicator: 'blue',
						});
					}
					setTimeout(poll, 15000);
				} else if (s.done && !s.error) {
					const missing = s.missing_from_database || 0;
					const ok = s.ok != null ? s.ok : s.processed;
					const errN = s.errors || 0;
					const skipped =
						(s.skip_no_patient || 0) +
						(s.skip_no_header || 0) +
						(s.skip_existing_non_legacy || 0) +
						(s.skip_no_name || 0) +
						(s.skip_no_gender || 0) +
						(s.skip_no_patient || 0);
					let msg;
					if (jobKey === 'patient_info_import') {
						msg = __('{0} finished: {1} created, {2} updated, {3} skipped, {4} errors. Allergy warnings: {5} created, {6} updated.', [
							jobKey,
							s.created || 0,
							s.updated || 0,
							skipped,
							errN,
							s.allergy_warnings_created || 0,
							s.allergy_warnings_updated || 0,
						]);
					} else if (jobKey === 'patient_allergy_warning_import') {
						msg = __(
							'{0} finished: {1} allergy warnings created, {2} updated, {3} unchanged, {4} skipped (no patient), {5} skipped (no allergy text), {6} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_unchanged || 0,
								s.skip_no_patient || 0,
								s.skip_empty_allergy || 0,
								errN,
							]
						);
					} else if (jobKey === 'patient_blacklist_sync') {
						msg = __(
							'{0} finished: {1} set blacklisted, {2} cleared, {3} unchanged, {4} skipped (no patient), {5} errors.',
							[
								jobKey,
								s.set_blacklisted || 0,
								s.cleared || 0,
								s.skip_unchanged || 0,
								s.skip_no_patient || 0,
								errN,
							]
						);
					} else if (jobKey === 'pmo_sync_by_admission_status') {
						msg = __(
							'{0} finished: {1} signed (Admitted), {2} completed (Discharged), {3} submitted, {4} errors.',
							[jobKey, s.signed || 0, s.completed || 0, s.submitted || 0, errN]
						);
					} else if (jobKey === 'ip_admission_discharge_import') {
						msg = __(
							'{0} finished: {1} admissions created, {2} updated, {3} skipped (no patient), {4} errors. Discharges: {5} created, {6} updated, {7} submitted. Nursing checklist: {8} OK, {9} skipped. Discharge checklist: {10} OK, {11} skipped.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_patient || 0,
								errN,
								s.discharges_created || 0,
								s.discharges_updated || 0,
								s.discharges_submitted || 0,
								s.nursing_ok || 0,
								s.nursing_skip || 0,
								s.discharge_cl_ok || 0,
								s.discharge_cl_skip || 0,
							]
						);
					} else if (jobKey === 'patient_visit_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} patients auto-created, {4} skipped (no patient), {5} skipped (no date), {6} submitted, {7} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.patients_created || 0,
								s.skip_no_patient || 0,
								s.skip_no_date || 0,
								s.submitted || 0,
								errN,
							]
						);
					} else if (jobKey === 'daily_patient_visit_setup_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped, {4} errors.',
							[jobKey, s.created || 0, s.updated || 0, s.skipped || 0, errN]
						);
					} else if (jobKey === 'daily_auto_visit_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} submitted, {4} skipped, {5} skipped (no patient), {6} skipped (no date), {7} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.submitted || 0,
								s.skipped || 0,
								s.skip_no_patient || 0,
								s.skip_no_date || 0,
								errN,
							]
						);
					} else if (jobKey === 'service_request_visit_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} submitted, {4} visits auto-created, {5} patients auto-created, {6} skipped (no visit), {7} skipped (no template), {8} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.submitted || 0,
								s.visits_created || 0,
								s.patients_created || 0,
								s.skip_no_visit || 0,
								s.skip_no_template || 0,
								errN,
							]
						);
					} else if (jobKey === 'legacy_ip_service_import') {
						msg = __(
							'{0} finished: {1} OK ({2} created, {3} updated), {4} submitted, {5} standalone, {6} visits auto-created, {7} patients auto-created, {8} skipped (no template), {9} skipped (no lines), {10} errors.',
							[
								jobKey,
								s.ok || 0,
								s.created || 0,
								s.updated || 0,
								s.submitted || 0,
								s.standalone_ok || 0,
								s.visits_created || 0,
								s.patients_created || 0,
								s.skip_no_template || 0,
								s.skip_no_lines || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_admission_03_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} submitted, {4} skipped (no admission), {5} skipped (no patient), {6} skipped (patient mismatch), {7} skipped (no lines), {8} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.submitted || 0,
								s.skip_no_admission || 0,
								s.skip_no_patient || 0,
								s.skip_patient_mismatch || 0,
								s.skip_no_lines || 0,
								errN,
							]
						);
					} else if (jobKey === 'lab_test_visit_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} submitted, {4} visits auto-created, {5} patients auto-created, {6} skipped (no visit), {7} skipped (existing non-legacy), {8} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.submitted || 0,
								s.visits_created || 0,
								s.patients_created || 0,
								s.skip_no_visit || 0,
								s.skip_existing_non_legacy || 0,
								errN,
							]
						);
					} else if (jobKey === 'patient_appointment_info_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} patients auto-created, {4} practitioners auto-created, {5} skipped (no date), {6} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.patients_created || 0,
								s.practitioners_created || 0,
								s.skip_no_date || 0,
								errN,
							]
						);
					} else if (jobKey === 'visit_diagnoses_op_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} patients auto-created, {4} skipped (no diagnosis), {5} skipped (unresolved diagnosis), {6} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.patients_created || 0,
								s.skip_no_diagnosis || 0,
								s.skip_unresolved_diagnosis || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_admission_diagnoses_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} admissions resolved, {4} skipped (no details), {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.admissions_resolved || 0,
								s.skip_no_details || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_admission_clinical_note_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} admissions resolved, {4} skipped (no note), {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.admissions_resolved || 0,
								s.skip_no_note || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_doctor_request_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} with placeholder description "-", {4} patients auto-created, {5} doctors auto-created, {6} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.placeholder_description || 0,
								s.patients_created || 0,
								s.practitioners_created || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_patient_assessment_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no admission), {4} skipped (no patient), {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_admission || 0,
								s.skip_no_patient || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_patient_vitals_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} submitted, {4} skipped (no admission), {5} skipped (no patient), {6} patients auto-created, {7} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.submitted || 0,
								s.skip_no_admission || 0,
								s.skip_no_patient || 0,
								s.patients_created || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_observation_level_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} submitted, {4} skipped (no admission), {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.submitted || 0,
								s.skip_no_admission || 0,
								errN,
							]
						);
					} else if (jobKey === 'morse_fall_scale_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no admission), {4} skipped (no patient), {5} skipped (empty details), {6} patients auto-created, {7} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_admission || 0,
								s.skip_no_patient || 0,
								s.skip_empty_details || 0,
								s.patients_created || 0,
								errN,
							]
						);
					} else if (jobKey === 'morse_fall_scale_detail_dedupe') {
						msg = __(
							'{0} finished: {1} scale(s) cleaned, {2} duplicate row(s) deleted, {3} total point(s) recalculated, {4} errors.',
							[
								jobKey,
								s.parents_processed || 0,
								s.rows_deleted || 0,
								s.parents_total_updated || 0,
								errN,
							]
						);
					} else if (jobKey === 'clinical_note_duplicate_cleanup') {
						const skippedDuplicates =
							(s.skipped_inpatient_legacy || 0) +
							(s.skipped_locked || 0) +
							(s.skipped_attachment || 0) +
							(s.skipped_variance || 0) +
							(s.skipped_submitted || 0);
						msg = __(
							'{0} finished: {1} group(s) merged, {2} duplicate note(s) deleted, {3} skipped, {4} errors.',
							[jobKey, s.groups_merged || 0, s.notes_deleted || 0, skippedDuplicates, errN]
						);
						if (s.groups_remaining != null) {
							msg += __(' {0} duplicate group(s) remaining.', [s.groups_remaining]);
						}
					} else if (jobKey === 'ip_admission_02_import') {
						const phStats = s.stats || {};
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} attribute lines skipped, {4} unresolved admissions, {5} dates set, {6} errors.',
							[
								jobKey,
								phStats.created || 0,
								phStats.updated || 0,
								phStats.skipped_lines || 0,
								phStats.unresolved_groups || 0,
								phStats.dates_set || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_admission_phy_exam_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no admission), {4} skipped (no patient), {5} patients auto-created, {6} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_admission || 0,
								s.skip_no_patient || 0,
								s.patients_created || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_admission_transfer_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no patient), {4} skipped (no new admission), {5} skipped (patient mismatch), {6} skipped (unmapped branch), {7} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_patient || 0,
								s.skip_no_new_admission || 0,
								s.skip_patient_mismatch || 0,
								s.skip_no_cost_center || 0,
								errN,
							]
						);
					} else if (jobKey === 'fall_risk_assessment_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no admission), {4} skipped (no trans date), {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_admission || 0,
								s.skip_no_trans_date || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_risk_analysis_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no admission), {4} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_admission || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_grooming_chart_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped, {4} skipped (no admission), {5} skipped (no patient), {6} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skipped || 0,
								s.skip_no_admission || 0,
								s.skip_no_patient || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_admission_transfer_bal_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no patient), {4} skipped (no new admission), {5} skipped (patient mismatch), {6} skipped (unmapped branch), {7} skipped (no trans date), {8} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_patient || 0,
								s.skip_no_new_admission || 0,
								s.skip_patient_mismatch || 0,
								s.skip_no_cost_center || 0,
								s.skip_no_trans_date || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_admission_form_rules_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} errors.',
							[jobKey, s.created || 0, s.updated || 0, errN]
						);
					} else if (jobKey === 'visit_positive_finding_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} errors.',
							[jobKey, s.created || 0, s.updated || 0, errN]
						);
					} else if (jobKey === 'patient_warning_message_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} errors.',
							[jobKey, s.created || 0, s.updated || 0, errN]
						);
					} else if (jobKey === 'patient_medical_report_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} errors.',
							[jobKey, s.created || 0, s.updated || 0, errN]
						);
					} else if (jobKey === 'ect_details_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped, {4} errors.',
							[jobKey, s.created || 0, s.updated || 0, s.skipped || 0, errN]
						);
					} else if (jobKey === 'ect_details_attribute_import') {
						msg = __(
							'{0} finished: {1} parent record(s) updated, {2} child row(s) appended, {3} child row(s) filled, {4} skipped, {5} errors.',
							[
								jobKey,
								s.updated || 0,
								s.appended_rows || 0,
								s.updated_rows || 0,
								s.skipped || 0,
								errN,
							]
						);
					} else if (jobKey === 'ect_details_to_procedure_transfer') {
						msg = __(
							'{0} finished: {1} ECT Procedure(s) created, {2} updated, {3} skipped, {4} errors.',
							[jobKey, s.created || 0, s.updated || 0, s.skipped || 0, errN]
						);
					} else if (jobKey === 'ect_conversion') {
						msg = __(
							'{0} finished: {1} ECT Service(s) created, {2} already had an ECT Service, {3} skipped (no practitioner), {4} skipped (no default ECT service), {5} skipped (no patient), {6} could not be raised, {7} errors.',
							[
								jobKey,
								s.created || 0,
								s.skipped_existing || 0,
								s.skipped_no_practitioner || 0,
								s.skipped_no_default_service || 0,
								s.skipped_no_patient || 0,
								s.failed || 0,
								errN,
							]
						);
						const samples = (s.samples || []).join(', ');
						if (samples) {
							msg += ' ' + __('Visits needing attention: {0}.', [samples]);
						}
					} else if (jobKey === 'patient_visit_prescription_his_import') {
						msg = __(
							'{0} finished: {1} Patient Medication Order(s) created, {2} updated, {3} medicine line(s), {4} skipped, {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.lines_imported || 0,
								s.skipped || 0,
								errN,
							]
						);
						if (s.verified_visited) {
							msg += __(' Verified: all {0} queued visits have a prescription.', [
								s.verified_visited,
							]);
						}
					} else if (jobKey === 'patient_visit_prescription_import') {
						msg = __(
							'{0} finished: {1} Patient Medication Order(s) created, {2} updated, {3} medicine line(s), {4} skipped, {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.lines_imported || 0,
								s.skipped || 0,
								errN,
							]
						);
						if (s.verified_visited) {
							msg += __(' Verified: all {0} queued visits have a prescription.', [
								s.verified_visited,
							]);
						}
					} else if (jobKey === 'op_prescription_duplicate_cleanup') {
						msg = __(
							'{0} finished: {1} duplicate prescription(s) removed, {2} skipped, {3} errors.',
							[jobKey, s.removed || 0, s.skipped || 0, errN]
						);
						if (s.duplicates_remaining != null) {
							msg += __(' {0} duplicate visit(s) remaining.', [
								s.duplicates_remaining,
							]);
						}
					} else if (jobKey === 'op_prescription_line_cleanup') {
						msg = __(
							'{0} finished: {1} line(s) removed from {2} prescription(s), {3} skipped, {4} errors.',
							[
								jobKey,
								s.lines_removed || 0,
								s.visits_cleaned || 0,
								s.skipped || 0,
								errN,
							]
						);
						if (s.line_duplicates_remaining != null) {
							msg += __(' {0} repeated line(s) remaining.', [
								s.line_duplicates_remaining,
							]);
						}
					} else if (jobKey === 'ip_admission_medicine_sheet_given_import') {
						msg = __(
							'{0} finished: {1} given medicine row(s) created, {2} admission detail row(s) auto-created, {3} sheet row(s) created, {4} sheet row(s) updated, {5} skipped (not given), {6} skipped (no admission detail), {7} skipped (already mapped), {8} errors.',
							[
								jobKey,
								s.created_given || 0,
								s.created_admission_detail || 0,
								s.staging_created || 0,
								s.staging_updated || 0,
								s.skip_not_given || 0,
								s.skip_no_admission_detail || 0,
								s.skip_already_mapped || 0,
								errN,
							]
						);
					} else if (jobKey === 'ip_patient_relatives_import') {
						msg = __(
							'{0} finished: {1} admissions updated, {2} relatives added, {3} relatives updated, {4} skipped (no admission), {5} errors.',
							[
								jobKey,
								s.ok || 0,
								s.relatives_added || 0,
								s.relatives_updated || 0,
								s.skip_no_admission || 0,
								errN,
							]
						);
					} else if (jobKey === 'main_nursing_note_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} skipped (no admission), {4} skipped (no notes), {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_no_admission || 0,
								s.skip_no_notes || 0,
								errN,
							]
						);
					} else if (jobKey === 'patient_legacy_gender_fix') {
						msg = __(
							'{0} finished: {1} patients updated, {2} warning messages updated, {3} skipped, {4} errors.',
							[
								jobKey,
								s.updated || 0,
								s.warning_messages_updated || 0,
								s.skipped_unchanged || 0,
								s.skipped_errors || 0,
							]
						);
					} else if (jobKey === 'patient_visit_encounter_comment_clinical_note') {
						if (s.stopped) {
							msg = __(
								'{0} stopped: {1} created, {2} duplicate visit+note, {3} no patient, {4} errors, {5} visits processed.',
								[
									jobKey,
									s.created || 0,
									s.skipped_existing || 0,
									s.skipped_no_patient || 0,
									s.errors || 0,
									s.processed || 0,
								]
							);
						} else {
							msg = __(
								'{0} finished: {1} created, {2} duplicate visit+note, {3} no patient, {4} errors.',
								[
									jobKey,
									s.created || 0,
									s.skipped_existing || 0,
									s.skipped_no_patient || 0,
									s.errors || 0,
								]
							);
						}
					} else if (jobKey === 'patient_cpr_photo_import') {
						msg = __(
							'{0} finished: {1} front uploaded, {2} back uploaded, {3} invalid, {4} patient not found, {5} skipped (existing), {6} errors.',
							[
								jobKey,
								s.uploaded_front || 0,
								s.uploaded_back || 0,
								s.skip_invalid || 0,
								s.skip_no_patient || 0,
								s.skip_existing || 0,
								errN,
							]
						);
					} else if (jobKey === 'patient_legacy_signature_import') {
						msg = __(
							'{0} finished: {1} on admissions, {2} on patients, {3} invalid, {4} patient not found, {5} skipped (existing), {6} errors.',
							[
								jobKey,
								s.uploaded_admission || 0,
								s.uploaded_patient || 0,
								s.skip_invalid || 0,
								s.skip_no_patient || 0,
								s.skip_existing || 0,
								errN,
							]
						);
					} else if (jobKey === 'legacy_visit_document_import') {
						msg = __(
							'{0} finished: {1} created, {2} updated, {3} invalid, {4} skipped (existing), {5} errors.',
							[
								jobKey,
								s.created || 0,
								s.updated || 0,
								s.skip_invalid || 0,
								s.skip_existing || 0,
								errN,
							]
						);
					} else if (jobKey === 'patient_customer_name_sync') {
						msg = __(
							'{0} finished: {1} renamed, {2} merged, {3} name-only updates, {4} already correct, {5} no File No/ID, {6} ID conflicts, {7} errors (scanned {8}).',
							[
								jobKey,
								s.renamed || 0,
								s.merged || 0,
								s.updated_name || 0,
								s.skipped_already_ok || 0,
								s.skipped_no_id || 0,
								s.skipped_conflict || 0,
								s.errors || 0,
								s.processed || 0,
							]
						);
					} else if (jobKey === 'patient_customer_file_no_sync') {
						msg = __(
							'{0} finished: {1} updated custom_patient_file_no, {2} already correct, {3} no customer, {4} no File No, {5} errors (scanned {6}).',
							[
								jobKey,
								s.updated || 0,
								s.skipped_ok || 0,
								s.skipped_no_customer || 0,
								s.skipped_no_file_no || 0,
								s.errors || 0,
								s.processed || 0,
							]
						);
					} else if (jobKey === 'patient_category_from_major_type') {
						msg = __(
							'{0} finished: {1} updated Category from Pat Major Type, {2} already correct, {3} unmatched type, {4} no type, {5} errors (scanned {6}).',
							[
								jobKey,
								s.updated || 0,
								s.skipped_already_ok || 0,
								s.skipped_unmatched || 0,
								s.skipped_no_code || 0,
								s.errors || 0,
								s.processed || 0,
							]
						);
					} else if (jobKey === 'patient_customer_dedupe') {
						msg = __(
							'{0} finished: {1} deleted, {2} skipped (has transactions), {3} skipped (still linked / missing), {4} errors (of {5} candidates).',
							[
								jobKey,
								s.deleted || 0,
								s.skipped_has_links || 0,
								(s.skipped_linked || 0) + (s.skipped_missing || 0),
								s.errors || 0,
								s.total || s.processed || 0,
							]
						);
					} else if (jobKey === 'long_acting_medicine_expire') {
						msg = __(
							'{0} finished: {1} set to Inactive, {2} errors (scanned {3}).',
							[jobKey, s.updated || 0, s.errors || 0, s.processed || 0]
						);
					} else if (jobKey === 'long_acting_frequency_fix') {
						msg = __(
							'{0} finished: {1} frequencies updated from Patient Medication Order, {2} skipped, {3} errors (scanned {4}).',
							[jobKey, s.updated || 0, s.skipped || 0, s.errors || 0, s.processed || 0]
						);
					} else if (jobKey === 'legacy_sales_item_link_backfill') {
						msg = __(
							'{0} finished: {1} Item links set from ITEM_00_01, {2} unmatched item_num, {3} errors (scanned {4} of {5}).',
							[
								jobKey,
								s.updated || 0,
								s.skipped_unmatched || 0,
								s.errors || 0,
								s.processed || 0,
								s.total || 0,
							]
						);
					} else if (jobKey === 'clinical_note_branch_backfill') {
						msg = __(
							'{0} finished: {1} updated, {2} skipped, {3} errors (scanned {4} of {5}).',
							[
								jobKey,
								s.ok || 0,
								s.skip || 0,
								s.errors || 0,
								s.processed || 0,
								s.total_notes || 0,
							]
						);
					} else if (jobKey === 'assessment_cost_center_backfill') {
						msg = __(
							'{0} finished: {1} updated, {2} skipped, {3} errors (scanned {4} of {5}).',
							[
								jobKey,
								s.ok || 0,
								s.skip || 0,
								s.errors || 0,
								s.processed || 0,
								s.total_notes || 0,
							]
						);
					} else if (jobKey === 'patient_assessment_cost_center_backfill') {
						msg = __(
							'{0} finished: {1} Patient Assessments updated, {2} skipped, {3} errors (scanned {4} of {5}).',
							[
								jobKey,
								s.ok || 0,
								s.skip || 0,
								s.errors || 0,
								s.processed || 0,
								s.total_notes || 0,
							]
						);
					} else if (jobKey === 'physical_examination_cost_center_backfill') {
						msg = __(
							'{0} finished: {1} Physical Examinations updated, {2} skipped, {3} errors (scanned {4} of {5}).',
							[
								jobKey,
								s.ok || 0,
								s.skip || 0,
								s.errors || 0,
								s.processed || 0,
								s.total_notes || 0,
							]
						);
					} else {
						msg = __('{0} finished: {1} OK, {2} skipped, {3} errors', [
							jobKey,
							ok,
							skipped,
							errN,
						]);
					}
					if (s.in_database != null) {
						msg += __('. {0} legacy Lab Tests in database.', [s.in_database]);
					}
					if (missing > 0) {
						msg += __(
							' {0} Excel TRANS_NUM still missing — search Error Log for "Legacy lab import".',
							[missing]
						);
					} else {
						msg += __(' See Error Log for the full summary.');
					}
					frappe.show_alert({
						message: msg,
						indicator: missing > 0 ? 'orange' : 'green',
					});
				} else if (s.error) {
					const detail = String(s.error || '')
						.split('\n')
						.filter((line) => line.trim())
						.slice(-6)
						.join('\n');
					frappe.msgprint({
						title: __('Job failed'),
						indicator: 'red',
						message:
							`<pre style="white-space:pre-wrap;max-height:280px;overflow:auto">${frappe.utils.escape_html(
								detail || s.error
							)}</pre>` +
							`<p class="text-muted small">${__(
								'Full details are in Error Log.'
							)}</p>`,
					});
				}
			},
		});
	};
	setTimeout(poll, 5000);
}

/**
 * Healthcare Settings → Cleanup → Cleanup IP Admission.
 * Opens a dialog first so the latest IP_ADMISSION_01 sheet can be uploaded; when no sheet
 * is picked the IP_ADMISSION_01 file already stored on the server is used.
 * Re-applies branch (legacy BRANCH_NUM), admission date and admission time from the
 * IP_ADMISSION_01 Excel. admitted_datetime (the real start of the stay) is never touched.
 */
function open_ip_admission_cleanup(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __('Cleanup IP Admission'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __(
						'Restores the legacy branch (BRANCH_NUM), admission date and admission time of Inpatient Admissions from the IP_ADMISSION_01 sheet. admitted_datetime (the real start of the stay) is never changed. Upload the latest sheet if the one already imported is out of date.'
					)
					+ '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'source_html',
			},
		],
		primary_action_label: __('Preview'),
		primary_action() {
			preview_ip_admission_cleanup(frm, dialog._file_url, dialog);
		},
	});

	dialog._file_url = null;
	dialog._file_label = null;
	render_ip_admission_cleanup_source(dialog);

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Upload Latest IP Admission Sheet…'))
			.on('click', () => {
				open_ip_admission_cleanup_upload(frm, dialog);
			})
	);

	dialog.show();
}

function render_ip_admission_cleanup_source(dialog) {
	const label = dialog._file_label
		? __('Sheet to use: {0}', [frappe.utils.escape_html(dialog._file_label)])
		: __('No sheet picked here — the IP_ADMISSION_01 file already stored on the server is used.');
	dialog
		.get_field('source_html')
		.$wrapper.html(
			'<p class="'
			+ (dialog._file_label ? 'text-success' : 'text-muted')
			+ ' small">'
			+ label
			+ '</p>'
		);
}

function preview_ip_admission_cleanup(frm, file_url, dialog) {
	frappe.call({
		method: 'healthcare.api.ip_admission_cleanup.preview_ip_admission_cleanup',
		args: { file_url: file_url || null },
		freeze: true,
		freeze_message: __('Reading IP_ADMISSION_01 Excel…'),
		callback(preview) {
			const counts = preview.message || {};
			if (!counts.ok) {
				if (counts.needs_file) {
					frappe.msgprint({
						title: __('IP_ADMISSION_01 file required'),
						indicator: 'orange',
						message: counts.message || __('Upload the IP_ADMISSION_01 Excel.'),
					});
					open_ip_admission_cleanup_upload(frm, dialog);
					return;
				}
				frappe.msgprint({
					title: __('Cleanup IP Admission'),
					indicator: 'red',
					message: counts.message || __('Preview failed.'),
				});
				return;
			}

			if (dialog) {
				dialog._file_url = counts.file_url || file_url || null;
				dialog._file_label = dialog._file_url;
				render_ip_admission_cleanup_source(dialog);
				dialog.hide();
			}

			const samples = (counts.samples || []).join('\n') || __('(none)');
			frappe.confirm(
				__(
					'Restore Inpatient Admission branch, admission date and admission time from IP_ADMISSION_01?\n\n'
						+ 'Sheet: {9}\n\n'
						+ 'Excel rows: {0}\nMatched admissions: {1}\nAdmissions to update: {2}\n\n'
						+ 'Branch missing (will set): {3}\nBranch wrong (will restore): {4}\n'
						+ 'Branch from a later transfer: {5}\nAdmission date to restore: {6}\n'
						+ 'Admission time to restore: {7}\n\n'
						+ 'admitted_datetime (real stay start) is never changed.\n\n'
						+ 'Sample changes:\n{8}\n\nContinue?',
					[
						counts.excel_rows || 0,
						counts.matched_admissions || 0,
						counts.total_changes || 0,
						counts.missing_branch || 0,
						counts.branch_drift || 0,
						counts.branch_from_later_transfer || 0,
						counts.admission_date_drift || 0,
						counts.admission_time_drift || 0,
						samples,
						counts.file_url || __('(server file)'),
					]
				),
				() => {
					frappe.call({
						method: 'healthcare.api.ip_admission_cleanup.run_ip_admission_cleanup',
						args: { file_url: counts.file_url || file_url || null },
						freeze: true,
						freeze_message: __('Cleaning up Inpatient Admissions…'),
						callback(r) {
							const result = r.message || {};
							frappe.msgprint({
								title: __('Cleanup IP Admission'),
								indicator: result.ok ? 'green' : 'red',
								message: result.message || __('Done'),
							});
							frm.reload_doc();
						},
					});
				}
			);
		},
	});
}

function open_ip_admission_cleanup_upload(frm, dialog) {
	new frappe.ui.FileUploader({
		dialog_title: __('Select IP_ADMISSION_01 Excel'),
		allow_multiple: false,
		restrictions: {
			allowed_file_types: ['.xlsx', '.xls'],
		},
		on_success(file) {
			if (dialog) {
				dialog._file_url = file.file_url;
				dialog._file_label = file.file_name || file.file_url;
				render_ip_admission_cleanup_source(dialog);
				return;
			}
			preview_ip_admission_cleanup(frm, file.file_url);
		},
	});
}

/**
 * Healthcare Settings → Cleanup → Create Missing Medication Orders.
 * Compares IP_ADMISSION_MEDICINE with the Patient Medication Orders already in ERP and
 * creates (or completes) the prescription of any admission whose lines never imported —
 * e.g. admission 2210 (patient 860640), created in ERP while the import was running.
 * Nothing is deleted and already imported lines are never duplicated.
 *
 * NOTE: not rendered any more - the Excel/upload flow of this dialog (and of
 * open_op_prescription_cleanup below) is covered by the single "Reconcile
 * Prescriptions" button, which reads Oracle directly. Kept for manual use.
 */
function open_ip_medication_cleanup(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __('Create Missing Medication Orders'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __(
						'Compares IP_ADMISSION_MEDICINE with the Patient Medication Orders already in ERP. Admissions with no prescription, or with fewer lines than the sheet, are created / completed. Nothing is deleted and imported lines are never duplicated. Unsigned prescriptions are left as they are.'
					)
					+ '</p>',
			},
			{
				fieldtype: 'HTML',
				fieldname: 'source_html',
			},
		],
		primary_action_label: __('Preview'),
		primary_action() {
			preview_ip_medication_cleanup(frm, dialog._file_url, dialog);
		},
	});

	dialog._file_url = null;
	dialog._file_label = null;
	render_ip_medication_cleanup_source(dialog);

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Upload Latest IP_ADMISSION_MEDICINE…'))
			.on('click', () => {
				open_ip_medication_cleanup_upload(frm, dialog);
			})
	);

	dialog.show();
}

function render_ip_medication_cleanup_source(dialog) {
	const label = dialog._file_label
		? __('Sheet to use: {0}', [frappe.utils.escape_html(dialog._file_label)])
		: __('No sheet picked here — the IP_ADMISSION_MEDICINE file already stored on the server is used.');
	dialog
		.get_field('source_html')
		.$wrapper.html(
			'<p class="'
			+ (dialog._file_label ? 'text-success' : 'text-muted')
			+ ' small">'
			+ label
			+ '</p>'
		);
}

function preview_ip_medication_cleanup(frm, file_url, dialog) {
	frappe.call({
		method: 'healthcare.api.ip_medication_cleanup.preview_ip_medication_cleanup',
		args: { file_url: file_url || null },
		freeze: true,
		freeze_message: __('Reading IP_ADMISSION_MEDICINE and comparing prescriptions…'),
		callback(preview) {
			const counts = preview.message || {};
			if (!counts.ok) {
				if (counts.needs_file) {
					frappe.msgprint({
						title: __('IP_ADMISSION_MEDICINE file required'),
						indicator: 'orange',
						message: counts.message || __('Upload the IP_ADMISSION_MEDICINE Excel.'),
					});
					open_ip_medication_cleanup_upload(frm, dialog);
					return;
				}
				frappe.msgprint({
					title: __('Create Missing Medication Orders'),
					indicator: 'red',
					message: counts.message || __('Preview failed.'),
				});
				return;
			}

			if (dialog) {
				dialog._file_url = counts.file_url || file_url || null;
				dialog._file_label = dialog._file_url;
				render_ip_medication_cleanup_source(dialog);
				dialog.hide();
			}

			if (!counts.gaps) {
				frappe.msgprint({
					title: __('Create Missing Medication Orders'),
					indicator: 'green',
					message: __(
						'Nothing to create. {0} admissions and {1} medicine lines in the sheet already match the prescriptions in ERP.',
						[counts.resolved_admissions || 0, counts.medicine_lines || 0]
					),
				});
				return;
			}

			const samples = (counts.samples || []).join('\n') || __('(none)');
			const longActingSamples = (counts.long_acting_samples || []).join('\n') || __('(none)');
			frappe.confirm(
				__(
					'Create the missing medication orders from IP_ADMISSION_MEDICINE?\n\n'
						+ 'Sheet: {8}\n\n'
						+ 'Medicine lines in sheet: {0}\nAdmissions in sheet: {1}\n'
						+ 'Admissions already complete: {2}\nAdmissions with a gap: {3}\n'
						+ 'Medicine lines to create: {4}\n'
						+ 'Long-acting (depot) lines to flag: {9}\n'
						+ 'Long Acting Medicine already linked: {10}\n\n'
						+ 'Admissions not resolved: {5}\nRows without admission: {6}\n\n'
						+ 'New prescriptions are submitted as Completed; existing prescriptions are only '
						+ 'extended. Long-acting lines get a Long Acting Medicine record. '
						+ 'Nothing is deleted.\n\n'
						+ 'Sample gaps:\n{7}\n\nLong-acting samples:\n{11}\n\nContinue?',
					[
						counts.medicine_lines || 0,
						counts.admissions_in_file || 0,
						counts.complete_admissions || 0,
						counts.gaps || 0,
						counts.missing_lines || 0,
						counts.unresolved_admissions || 0,
						counts.rows_without_admission || 0,
						samples,
						counts.file_url || __('(server file)'),
						counts.long_acting_lines || 0,
						counts.long_acting_medicines_existing || 0,
						longActingSamples,
					]
				),
				() => {
					frappe.call({
						method: 'healthcare.api.ip_medication_cleanup.run_ip_medication_cleanup',
						args: { file_url: counts.file_url || file_url || null },
						freeze: true,
						freeze_message: __('Creating the missing medication orders…'),
						callback(r) {
							const result = r.message || {};
							frappe.msgprint({
								title: __('Create Missing Medication Orders'),
								indicator: result.ok ? 'green' : 'orange',
								message: result.message || __('Done'),
							});
						},
					});
				}
			);
		},
	});
}

function open_ip_medication_cleanup_upload(frm, dialog) {
	new frappe.ui.FileUploader({
		dialog_title: __('Select IP_ADMISSION_MEDICINE Excel'),
		allow_multiple: false,
		restrictions: {
			allowed_file_types: ['.xlsx', '.xls', '.csv'],
		},
		on_success(file) {
			if (dialog) {
				dialog._file_url = file.file_url;
				dialog._file_label = file.file_name || file.file_url;
				render_ip_medication_cleanup_source(dialog);
				return;
			}
			preview_ip_medication_cleanup(frm, file.file_url);
		},
	});
}

/**
 * Healthcare Settings → Cleanup → Reconcile OP Prescriptions.
 * Compares PATIENT_VISIT_PRESCRIPTION with the Patient Medication Orders already in ERP: visits
 * with no prescription (or with fewer lines than the sheet) are created / completed, and the
 * duplicated PATIENT_VISIT_PRESCRIPTION_HIS lines (the same PRESCIP_ID imported 2-9 times) are
 * removed. Nothing is deleted unless the line can be rebuilt from the sheet or is still present
 * on a normal OP line; prescriptions are never duplicated.
 * Leave Patient empty to reconcile every patient in the sheet.
 *
 * NOTE: not rendered any more - see "Reconcile Prescriptions" above.
 */
function open_op_prescription_cleanup(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __('Reconcile OP Prescriptions'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __(
						'Compares PATIENT_VISIT_PRESCRIPTION with the Patient Medication Orders already in ERP. Visits with no prescription, or with fewer lines than the sheet, are created / completed. Duplicated PVP_HIS lines (the same PRESCIP_ID imported several times) are removed and the leftover HIS prescription is cancelled. Nothing is deleted unless the line can be rebuilt.'
					)
					+ '</p>',
			},
			{
				fieldtype: 'Link',
				fieldname: 'patient',
				label: __('Patient'),
				options: 'Patient',
				description: __('Leave empty to reconcile every patient in the sheet.'),
			},
			{
				fieldtype: 'HTML',
				fieldname: 'source_html',
			},
		],
		primary_action_label: __('Preview'),
		primary_action() {
			preview_op_prescription_cleanup(frm, dialog._file_url, dialog);
		},
	});

	dialog._file_url = null;
	dialog._file_label = null;
	render_op_prescription_cleanup_source(dialog);

	dialog.$wrapper.find('.modal-footer').prepend(
		$('<button type="button" class="btn btn-default btn-sm mr-2">')
			.text(__('Upload Latest PATIENT_VISIT_PRESCRIPTION…'))
			.on('click', () => {
				open_op_prescription_cleanup_upload(frm, dialog);
			})
	);

	dialog.show();
}

function render_op_prescription_cleanup_source(dialog) {
	const label = dialog._file_label
		? __('Sheet to use: {0}', [frappe.utils.escape_html(dialog._file_label)])
		: __('No sheet picked here — the PATIENT_VISIT_PRESCRIPTION file already stored on the server is used.');
	dialog
		.get_field('source_html')
		.$wrapper.html(
			'<p class="'
			+ (dialog._file_label ? 'text-success' : 'text-muted')
			+ ' small">'
			+ label
			+ '</p>'
		);
}

function preview_op_prescription_cleanup(frm, file_url, dialog) {
	frappe.call({
		method: 'healthcare.api.op_prescription_cleanup.preview_op_prescription_cleanup',
		args: {
			file_url: file_url || null,
			patient: (dialog && dialog.get_value('patient')) || null,
		},
		freeze: true,
		freeze_message: __('Reading PATIENT_VISIT_PRESCRIPTION and comparing prescriptions…'),
		callback(preview) {
			const counts = preview.message || {};
			if (!counts.ok) {
				if (counts.needs_file) {
					frappe.msgprint({
						title: __('PATIENT_VISIT_PRESCRIPTION file required'),
						indicator: 'orange',
						message: counts.message || __('Upload the PATIENT_VISIT_PRESCRIPTION Excel.'),
					});
					open_op_prescription_cleanup_upload(frm, dialog);
					return;
				}
				frappe.msgprint({
					title: __('Reconcile OP Prescriptions'),
					indicator: 'red',
					message: counts.message || __('Preview failed.'),
				});
				return;
			}

			if (dialog) {
				dialog._file_url = counts.file_url || file_url || null;
				dialog._file_label = dialog._file_url;
				render_op_prescription_cleanup_source(dialog);
				dialog.hide();
			}

			if (!counts.visits_to_import && !counts.his_duplicate_lines) {
				frappe.msgprint({
					title: __('Reconcile OP Prescriptions'),
					indicator: 'green',
					message: __(
						'Nothing to repair. {0} visits and {1} prescription lines in the sheet already match ERP, and no duplicate PVP_HIS lines were found.',
						[counts.source_visits || 0, counts.source_lines || 0]
					),
				});
				return;
			}

			const samples = (counts.samples || []).join('\n') || __('(none)');
			frappe.confirm(
				__(
					'Repair the OP prescriptions from PATIENT_VISIT_PRESCRIPTION?\n\n'
						+ 'Sheet: {0}\nScope: {10}\n\n'
						+ 'Visits in scope: {1}\nVisits already complete: {2}\n'
						+ 'Visits with no prescription: {3} ({4} lines)\n'
						+ '  of which covered only by PVP_HIS: {13}\n'
						+ 'Visits with missing lines: {5} ({6} lines)\n\n'
						+ 'Duplicate PVP_HIS lines to delete: {7}\n'
						+ 'PVP_HIS prescriptions to cancel: {8}\n'
						+ 'PVP_HIS lines kept (cannot be rebuilt): {9}\n'
						+ 'Visits without a patient (will be skipped): {11}\n\n'
						+ 'New prescriptions are submitted as Completed; existing prescriptions are only extended. '
						+ 'Nothing else is deleted.\n\n'
						+ 'Sample repairs:\n{12}\n\nContinue?',
					[
						counts.file_url || __('(server file)'),
						counts.source_visits || 0,
						counts.complete_visits || 0,
						counts.missing_visits || 0,
						counts.missing_lines || 0,
						counts.partial_visits || 0,
						counts.partial_lines || 0,
						counts.his_duplicate_lines || 0,
						counts.his_pmos_to_cancel || 0,
						counts.his_lines_kept || 0,
						counts.scope_patient || __('all patients'),
						counts.unresolved_visits || 0,
						samples,
						counts.his_only_visits || 0,
					]
				),
				() => {
					frappe.call({
						method: 'healthcare.api.op_prescription_cleanup.run_op_prescription_cleanup',
						args: {
							file_url: counts.file_url || file_url || null,
							patient: counts.scope_patient || null,
							dry_run: 0,
							fix_missing: 1,
							drop_his_duplicates: 1,
							limit: 500,
						},
						freeze: true,
						freeze_message: __('Repairing the OP prescriptions…'),
						callback(r) {
							const result = r.message || {};
							frappe.msgprint({
								title: __('Reconcile OP Prescriptions'),
								indicator: result.ok ? 'green' : 'orange',
								message: result.message || __('Done'),
							});
						},
					});
				}
			);
		},
	});
}

function open_op_prescription_cleanup_upload(frm, dialog) {
	new frappe.ui.FileUploader({
		dialog_title: __('Select PATIENT_VISIT_PRESCRIPTION Excel'),
		allow_multiple: false,
		restrictions: {
			allowed_file_types: ['.xlsx', '.xls'],
		},
		on_success(file) {
			if (dialog) {
				dialog._file_url = file.file_url;
				dialog._file_label = file.file_name || file.file_url;
				render_op_prescription_cleanup_source(dialog);
				return;
			}
			preview_op_prescription_cleanup(frm, file.file_url);
		},
	});
}



var set_query_service_item = function(frm, service_item_field) {
	frm.set_query(service_item_field, function() {
		return {
			filters: {
				'is_sales_item': 1,
				'is_stock_item': 0
			}
		};
	});
};

frappe.tour['Healthcare Settings'] = [
	{
		fieldname: 'link_customer_to_patient',
		title: __('Link Customer to Patient'),
		description: __('If checked, a customer will be created for every Patient. Patient Invoices will be created against this Customer. You can also select existing Customer while creating a Patient. This field is checked by default.')
	},
	{
		fieldname: 'default_code_system',
		title: __('Default Code System'),
		description: __('Will be set as the default Code System selected in the Codification Table')
	},
	{
		fieldname: 'default_google_calendar',
		title: __('Default Google Calendar'),
		description: __('While booking tele-consultation appointments via Google Meet, this Google Calendar will be used. You can also configure separate Google Calender for each Practitioner if required')
	},
	{
		fieldname: 'collect_registration_fee',
		title: __('Collect Registration Fee'),
		description: __('If your Healthcare facility bills registrations of Patients, you can check this and set the Registration Fee in the field below. Checking this will create new Patients with a Disabled status by default and will only be enabled after invoicing the Registration Fee.')
	},
	{
		fieldname: 'show_payment_popup',
		title: __('Show Payment Popup'),
		description: __('Checking this will popup to invoice appointment')
	},
	{
		fieldname: 'validate_nursing_checklists',
		title: __('validate_nursing_checklists'),
		description: __('Validates all mandatory tasks in nursing checklist to be Completed before a Patient transactional event. For example, if any of the tasks as part of the Discharge Checklist is not in status Completed, system will alert the user while trying to Discharge the Patient from inpatient facility')
	},
	{
		fieldname: 'inpatient_visit_charge_item',
		title: __('Healthcare Service Items'),
		description: __('You can create a service item for Inpatient Visit Charge and set it here. Similarly, you can set up other Healthcare Service Items for billing in this section. Click ') + "<a href='https://frappehealth.com/docs/v13/user/manual/en/healthcare/healthcare_settings#2-default-healthcare-service-items' target='_blank'>here</a>" + __(' to know more')
	},
	{
		fieldname: 'income_account',
		title: __('Set up default Accounts for the Healthcare Facility'),
		description: __('If you wish to override default accounts settings and configure the Income and Receivable accounts for Healthcare, you can do so here.')

	},
	{
		fieldname: 'send_registration_msg',
		title: __('Out Patient SMS alerts'),
		description: __('If you want to send SMS alert on Patient Registration, you can enable this option. Similary, you can set up Out Patient SMS alerts for other functionalities in this section. Click ') + "<a href='https://frappehealth.com/docs/v13/user/manual/en/healthcare/healthcare_settings#4-out-patient-sms-alerts' target='_blank'>here</a>" + __(' to know more')
	}
];

// ---------------------------------------------------------------------------
// Oracle -> ERPNext sync (Healthcare Settings)
//
// Legacy migration buttons are kept in this file for reference but are no
// longer rendered on the form. Remove a group from this list to bring its
// buttons back - no backend change is needed.
// ---------------------------------------------------------------------------
const ORACLE_SYNC_HIDDEN_GROUPS = ['Direct Upload', 'Migration Analysis', 'ECT'];
const ORACLE_SYNC_HIDDEN_LABELS = [];
const ORACLE_SYNC_POLL_INTERVAL = 2000;
const ORACLE_SYNC_POLL_LIMIT = 150;
// The prescription reconciliation walks the whole site, so the dialog polls for
// up to 10 minutes and then leaves the job running in the background.
const PRESCRIPTION_RECONCILE_POLL_LIMIT = 300;
// Same idea for the long-acting / depot register (a few hundred groups at most).
const LONG_ACTING_RECONCILE_POLL_LIMIT = 300;
// The doctor progress note reconciliation can walk every patient in Oracle, so
// the dialog polls for up to 10 minutes and then leaves the job running.
const CLINICAL_NOTE_RECONCILE_POLL_LIMIT = 300;
// The nursing note reconciliation compares two ~425k-row registers, so it gets
// the same 10-minute polling window.
const NURSING_NOTE_RECONCILE_POLL_LIMIT = 300;
// Warning Messages (PATIENT_WARNING_MESSAGES) poll budget: 300 * 2s = 10 minutes.
const WARNING_MESSAGE_RECONCILE_POLL_LIMIT = 300;
const ALLERGY_RECONCILE_POLL_LIMIT = 300;
// Lab Tests (LAB_00_03 headers + LAB_00_04 results) walk a 13k / 137k register,
// so they get the same 10-minute polling window.
const LAB_TEST_RECONCILE_POLL_LIMIT = 300;
const OBSERVATION_RECONCILE_POLL_LIMIT = 300;
const VITAL_SIGNS_RECONCILE_POLL_LIMIT = 300;
const PHYSICAL_EXAMINATION_RECONCILE_POLL_LIMIT = 300;
const ECT_DETAILS_RECONCILE_POLL_LIMIT = 300;
const SESSION_SCHEDULE_RECONCILE_POLL_LIMIT = 300;
const PATIENT_HISTORY_RECONCILE_POLL_LIMIT = 300;
const DISCHARGE_RECONCILE_POLL_LIMIT = 300;
const INSURANCE_CLAIM_RECONCILE_POLL_LIMIT = 300;
const PATIENT_RECONCILE_POLL_LIMIT = 300;
const INSURANCE_REGISTER_RECONCILE_POLL_LIMIT = 300;
const VISIT_HISTORY_RECONCILE_POLL_LIMIT = 300;

function hide_legacy_setting_buttons(frm) {
	if (frm.__legacy_setting_buttons_hidden) {
		return;
	}
	frm.__legacy_setting_buttons_hidden = true;

	const hidden_groups = ORACLE_SYNC_HIDDEN_GROUPS.map((group) => __(group));
	const hidden_labels = ORACLE_SYNC_HIDDEN_LABELS.map((label) => __(label));
	const original_add_custom_button = frm.add_custom_button.bind(frm);

	frm.add_custom_button = function (label, action, group) {
		const group_label = typeof group === 'string' ? group : '';
		if (hidden_labels.includes(label) || hidden_groups.includes(group_label)) {
			return;
		}
		return original_add_custom_button(label, action, group);
	};
}

function oracle_sync_escape(value) {
	return frappe.utils.escape_html(value === undefined || value === null ? '' : String(value));
}

/**
 * One button for every prescription: Oracle -> ERPNext.
 *
 * Reads PATIENT_VISIT_PRESCRIPTION, PATIENT_VISIT_PRESCRIPTION_HIS and
 * IP_ADMISSION_MEDICINE straight from the Oracle database configured on the site
 * (no Excel upload, no patient picker), repairs the missing Patient Medication
 * Orders / lines, and imports every PATIENT_VISIT_PRESCRIPTION_HIS row as its
 * own transaction (patient_visit_prescription_his). HIS lines that also exist on
 * PATIENT_VISIT_PRESCRIPTION are kept and flagged Is Deduplicate on the child
 * (Hide Deduplicate Prescription on Healthcare Settings hides them on the UI).
 * Leave Patient empty for the whole site, or pick one patient. Runs in the background.
 */
function open_prescription_reconcile(frm) {
	ask_oracle_source({
		title: __('Reconcile Prescriptions'),
		entity: 'prescriptions',
		intro: `<p class="text-muted small">${__(
			'Reads the legacy OP, HIS and IP prescriptions and repairs the Patient Medication Orders in ERPNext: creates the prescription of every visit that never imported, adds the medicine lines missing on an existing prescription, imports every PATIENT_VISIT_PRESCRIPTION_HIS row as a transaction and creates the missing inpatient lines. Leave Patient empty for the whole site, or pick one patient.'
		)}</p>`,
		on_direct: () => show_prescription_reconcile_help(frm),
		on_excel: (files) => show_prescription_reconcile_help(frm, files),
	});
}

function show_prescription_reconcile_help(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Reconcile Prescriptions'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __(
						'Reads the legacy prescriptions from {0} and repairs the Patient Medication Orders in ERPNext:',
						[files ? __('the uploaded Excel export') : __('Oracle')]
					)
					+ '</p><ul class="text-muted small">'
					+ '<li>'
					+ __('creates the prescription of every outpatient visit that never imported')
					+ '</li><li>'
					+ __('adds the medicine lines missing on an existing prescription')
					+ '</li><li>'
					+ __(
						'imports every PATIENT_VISIT_PRESCRIPTION_HIS row as a Patient Medication Order (patient_visit_prescription_his) transaction'
					)
					+ '</li><li>'
					+ __(
						'keeps HIS lines that also exist on PATIENT_VISIT_PRESCRIPTION and ticks Is Deduplicate on those child lines (hidden on the UI when Hide Deduplicate Prescription is enabled)'
					)
					+ '</li><li>'
					+ __('creates the missing inpatient medicine lines, long-acting depots included')
					+ '</li></ul>'
					+ '<p class="text-muted small">'
					+ __(
						'Leave Patient empty to compare the whole site in the background. Pick a patient to repair only that patient. HIS duplicates are no longer deleted. Running it again only finds what is still missing.'
					)
					+ '</p>',
			},
			{
				fieldtype: 'Link',
				fieldname: 'patient',
				label: __('Patient'),
				options: 'Patient',
				description: __('Leave empty to reconcile every patient.'),
			},
		],
		primary_action_label: __('Start'),
		primary_action() {
			const patient = dialog.get_value('patient') || '';
			dialog.hide();
			start_prescription_reconcile(frm, files, patient);
		},
	});
	dialog.show();
}

function start_prescription_reconcile(frm, files, patient) {
	const args = {};
	if (files) {
		args.files = JSON.stringify(files);
	}
	if (patient) {
		args.patient = patient;
	}
	frappe.call({
		method: 'healthcare.api.prescription_sync.start_prescription_reconcile',
		args: args,
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_prescription_reconcile(frm, patient);
				return;
			}
			frappe.msgprint({
				title: __('Reconcile Prescriptions'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_prescription_reconcile(frm, patient) {
	let polls = 0;
	const title = patient
		? __('Reconciling prescriptions for {0}', [patient])
		: __('Reconciling prescriptions from Oracle');
	frappe.show_progress(title, 0, 100, __('Reading Oracle…'));

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.prescription_sync.get_prescription_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total) || 0;
				const processed = cint(status.processed) || 0;
				frappe.show_progress(
					title,
					total ? processed : Math.min(polls, 95),
					total || 100,
					total
						? __('{0} of {1} records', [processed, total])
						: __('Reading Oracle…')
				);
				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: __('Reconcile Prescriptions'),
						indicator: status.state === 'finished' ? 'green' : 'red',
						wide: true,
						message: frappe.utils.escape_html(status.message || __('Done')).replace(
							/\n/g,
							'<br>'
						),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= PRESCRIPTION_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Reconcile Prescriptions again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


/**
 * Long-acting / depot register: Oracle -> ERPNext.
 *
 * Reads CLINIC2.VISIT_00_04 (one row per injection that was actually given),
 * shows how far ERPNext has drifted from it, and repairs the Long Acting
 * Medicine records in the background: missing give-outs are appended, the
 * start / end date follow the real history and the next dose date is
 * recalculated, so a depot that is still being given is not left behind as
 * Inactive with a dose date months in the past.
 */
function open_long_acting_reconcile(frm) {
	ask_oracle_source({
		title: __('Reconcile Long Acting Medicine'),
		entity: 'long_acting',
		intro: `<p class="text-muted small">${__(
			'Reads the long-acting / depot injections Oracle recorded and repairs the Long Acting Medicine records in ERPNext: missing give-outs are appended, the start / end date follow the real history and the next dose date is recalculated.'
		)}</p>`,
		on_direct: () => run_long_acting_reconcile_preview(frm),
		on_excel: (files) => run_long_acting_reconcile_preview(frm, files),
	});
}

function run_long_acting_reconcile_preview(frm, files) {
	frappe.dom.freeze(
		files
			? __('Comparing Long Acting Medicine with the uploaded VISIT_00_04 export…')
			: __('Comparing Long Acting Medicine with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.long_acting_reconcile.preview_long_acting_reconcile',
		args: files ? { files: JSON.stringify(files) } : {},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_long_acting_reconcile_dialog(frm, r.message, files);
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function long_acting_reconcile_table_html(data) {
	const rows = [
		[__('Oracle table'), data.oracle_table],
		[__('Injections in Oracle'), data.oracle_rows],
		[__('Patient / medication groups'), data.oracle_groups],
		[__('Long Acting Medicine records'), data.lam_total],
		[__('Records matched'), data.lam_matched],
		[__('Injections missing in ERPNext'), data.missing_give_outs],
		[__('Groups with no Long Acting Medicine'), data.missing_groups],
		[__('Duplicate records (left for review)'), data.duplicate_groups],
		[__('Give-out rows without a parent (removed)'), data.orphan_give_outs],
	];

	const body = rows
		.map(
			([label, value]) =>
				`<tr><td style="width:55%">${oracle_sync_escape(label)}</td><td><b>${oracle_sync_escape(
					value
				)}</b></td></tr>`
		)
		.join('');

	const hint = data.in_sync
		? `<div class="alert alert-success">${__(
				'ERPNext already has every injection Oracle recorded. Running it again only refreshes the dates and the next dose.'
		  )}</div>`
		: `<div class="alert alert-warning">${__(
				'ERPNext is missing injections that Oracle recorded. Running the reconciliation appends them and recalculates the next dose.'
		  )}</div>`;

	return `${hint}<table class="table table-bordered" style="margin-bottom:12px">${body}</table>`;
}

function long_acting_reconcile_sample_html(title, values) {
	if (!values || !values.length) {
		return '';
	}
	const items = values.map((value) => `<li>${oracle_sync_escape(value)}</li>`).join('');
	return `<p class="text-muted small" style="margin-bottom:4px"><b>${oracle_sync_escape(
		title
	)}</b></p><ul class="text-muted small">${items}</ul>`;
}

function show_long_acting_reconcile_dialog(frm, data, files) {
	const samples =
		long_acting_reconcile_sample_html(__('Groups to create'), data.missing_group_sample) +
		long_acting_reconcile_sample_html(__('Duplicates to review'), data.duplicate_group_sample) +
		long_acting_reconcile_sample_html(__('Matched by medicine name'), data.similar_group_sample);

	const dialog = new frappe.ui.Dialog({
		title: __('Reconcile Long Acting Medicine'),
		size: 'large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'summary',
				options:
					long_acting_reconcile_table_html(data) +
					'<p class="text-muted small">' +
					__(
						'Only missing give-outs are appended, dates and the next dose are refreshed from the Oracle history, and nothing is deleted except give-out rows whose record no longer exists.'
					) +
					'</p>' +
					samples,
			},
		],
		primary_action_label: __('Start'),
		primary_action() {
			dialog.hide();
			start_long_acting_reconcile(frm, files);
		},
	});
	dialog.show();
}

function start_long_acting_reconcile(frm, files) {
	frappe.call({
		method: 'healthcare.api.long_acting_reconcile.start_long_acting_reconcile',
		args: files ? { files: JSON.stringify(files) } : {},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_long_acting_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Reconcile Long Acting Medicine'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_long_acting_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling Long Acting Medicine from Oracle');
	frappe.show_progress(title, 0, 100, __('Reading Oracle…'));

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.long_acting_reconcile.get_long_acting_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total) || 0;
				const processed = cint(status.processed) || 0;
				frappe.show_progress(
					title,
					total ? processed : Math.min(polls, 95),
					total || 100,
					total
						? __('{0} of {1} patient/medication groups', [processed, total])
						: __('Reading Oracle…')
				);
				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: __('Reconcile Long Acting Medicine'),
						indicator: status.state === 'finished' ? 'green' : 'red',
						wide: true,
						message: frappe.utils.escape_html(status.message || __('Done')).replace(
							/\n/g,
							'<br>'
						),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= LONG_ACTING_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Reconcile Long Acting Medicine again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


/**
 * Doctor progress notes: Oracle -> ERPNext.
 *
 * Oracle counts a patient's progress notes in three tables - the current OP
 * diagnosis (VISIT_00_01), every earlier version of it
 * (VISIT_00_01_HISTORY) and the IP notes (IP_ADMISSION_DIAGNOSES). ERPNext only
 * ever wrote the first and the third, so the OP diagnosis history is missing.
 * This compares all three and creates only the notes that are missing.
 */
function open_clinical_note_reconcile(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: Clinical Notes'),
		entity: 'clinical_notes',
		intro: `<p class="text-muted small">${__(
			'Reads three legacy sources - the OP visit diagnosis (VISIT_00_01), every earlier version of it (VISIT_00_01_HISTORY) and the IP doctor notes (IP_ADMISSION_DIAGNOSES) - and creates only the Doctor Progress Notes that are missing.'
		)}</p>`,
		on_direct: () => open_clinical_note_reconcile_options(frm),
		on_excel: (files) => open_clinical_note_reconcile_options(frm, files),
	});
}

function open_clinical_note_reconcile_options(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Clinical Notes'),
		fields: [
			{
				fieldtype: 'Data',
				fieldname: 'patient',
				label: __('Patient (optional)'),
				description: __(
					'Leave empty to compare every patient in Oracle. A patient number gives the note-by-note breakdown for that patient.'
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'skip_duplicate_text',
				label: __('Skip history rows that only repeat the current diagnosis'),
				default: 0,
			},
			{
				fieldtype: 'Check',
				fieldname: 'remove_duplicates',
				label: __('Merge duplicate OP visit clinical notes after reconcile'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: 0,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_clinical_note_reconcile(frm, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_clinical_note_reconcile(frm, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(
		files
			? __('Comparing doctor progress notes with the uploaded Excel export…')
			: __('Comparing doctor progress notes with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.clinical_note_reconcile.preview_clinical_note_reconcile',
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_clinical_note_reconcile_dialog(frm, r.message, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function clinical_note_reconcile_sources_html(data) {
	const is_patient = data.mode === 'patient';
	const head = is_patient
		? `<tr><th>${__('Oracle source')}</th><th class="text-right">${__(
				'In Oracle'
		  )}</th><th class="text-right">${__('In ERPNext')}</th><th class="text-right">${__(
				'Missing'
		  )}</th></tr>`
		: `<tr><th>${__('Oracle source')}</th><th class="text-right">${__('In Oracle')}</th></tr>`;

	const body = (data.sources || [])
		.map((source) => {
			if (!is_patient) {
				return `<tr><td>${oracle_sync_escape(source.label)}</td><td class="text-right"><b>${oracle_sync_escape(
					source.oracle_count
				)}</b></td></tr>`;
			}
			return `<tr><td>${oracle_sync_escape(source.label)}</td>
				<td class="text-right">${oracle_sync_escape(source.oracle_count)}</td>
				<td class="text-right">${oracle_sync_escape(source.erpnext_count)}</td>
				<td class="text-right"><b>${oracle_sync_escape(source.missing_count)}</b></td></tr>`;
		})
		.join('');

	const totals = data.totals || {};
	const footer = is_patient
		? `<tr><th>${__('Total')}</th><th class="text-right">${oracle_sync_escape(
				totals.oracle
		  )}</th><th class="text-right">${oracle_sync_escape(
				totals.erpnext
		  )}</th><th class="text-right">${oracle_sync_escape(totals.missing)}</th></tr>`
		: '';

	return `<table class="table table-bordered" style="margin-bottom:12px"><thead>${head}</thead><tbody>${body}${footer}</tbody></table>`;
}

function clinical_note_reconcile_samples_html(samples) {
	if (!samples || !samples.length) {
		return '';
	}
	const items = samples
		.map(
			(sample) =>
				`<li>${oracle_sync_escape(sample.key)}${
					sample.posting_date ? ` — ${oracle_sync_escape(sample.posting_date)}` : ''
				}<br><span class="text-muted">${oracle_sync_escape(sample.text)}</span></li>`
		)
		.join('');
	return `<p class="text-muted small" style="margin-bottom:4px"><b>${__(
		'Missing notes (first {0})',
		[samples.length]
	)}</b></p><ul class="text-muted small">${items}</ul>`;
}

function clinical_note_reconcile_patients_html(rows) {
	if (!rows || !rows.length) {
		return '';
	}
	const head = `<tr><th>${__('Patient')}</th><th>${__('Name')}</th><th class="text-right">${__(
		'OP'
	)}</th><th class="text-right">${__('History')}</th><th class="text-right">${__(
		'IP'
	)}</th><th class="text-right">${__('In Oracle')}</th><th class="text-right">${__(
		'Clinical Notes'
	)}</th></tr>`;
	const body = rows
		.map(
			(row) => `<tr>
				<td>${oracle_sync_escape(row.patient)}${
				row.patient_exists
					? ''
					: ` <span class="indicator-pill red">${__('missing patient')}</span>`
			}</td>
				<td>${oracle_sync_escape(row.patient_name)}</td>
				<td class="text-right">${oracle_sync_escape(row.op)}</td>
				<td class="text-right">${oracle_sync_escape(row.history)}</td>
				<td class="text-right">${oracle_sync_escape(row.ip)}</td>
				<td class="text-right"><b>${oracle_sync_escape(row.total)}</b></td>
				<td class="text-right">${oracle_sync_escape(row.erpnext_notes)}</td>
			</tr>`
		)
		.join('');
	return `<table class="table table-bordered" style="margin-bottom:12px"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function show_clinical_note_reconcile_dialog(frm, data, values) {
	const is_patient = data.mode === 'patient';
	const erpnext = data.erpnext || {};
	const totals = data.totals || {};
	const missing = cint(totals.missing);

	let hint;
	if (is_patient) {
		hint = missing
			? `<div class="alert alert-warning">${__(
					'ERPNext is missing {0} note(s) of this patient. Running the reconciliation creates only those.',
					[missing]
			  )}</div>`
			: `<div class="alert alert-success">${__(
					'ERPNext already has every progress note Oracle recorded for this patient.'
			  )}</div>`;
		if (cint(data.duplicate_history_rows)) {
			hint += `<div class="text-muted small">${__(
				'{0} history row(s) only repeat the diagnosis of their own visit, so tick “Skip history rows that only repeat the current diagnosis” if you do not want them as separate notes.',
				[cint(data.duplicate_history_rows)]
			)}</div>`;
		}
		if (cint(data.ip_fresh_name_count)) {
			hint += `<div class="text-muted small">${__(
				'{0} IP row(s) keep their Oracle trans number but take a fresh Clinical Note name, because that number is already the name of another patient’s note. The other note is never touched.',
				[cint(data.ip_fresh_name_count)]
			)}</div>`;
		}
	} else {
		hint = `<div class="alert alert-info">${__(
			'Oracle has {0} progress note(s) for {1} patient(s); ERPNext holds {2} Clinical Note(s) in total, {3} of them Doctor Progress Notes.',
			[
				cint(totals.oracle),
				cint(data.patients_in_oracle),
				cint(erpnext.clinical_notes),
				cint(erpnext.doctor_progress_notes),
			]
		)}</div>`;
	}

	const body = [
		hint,
		clinical_note_reconcile_sources_html(data),
		is_patient
			? `<p class="text-muted small">${__(
					'Clinical Notes for this patient: {0} ({1} Doctor Progress Notes) over {2} Patient Visit(s).',
					[
						cint(erpnext.clinical_notes),
						cint(erpnext.doctor_progress_notes),
						cint(data.patient_visits),
					]
			  )}</p>`
			: clinical_note_reconcile_patients_html(data.rows) +
			  (data.truncated
					? `<div class="text-muted small" style="margin-top:-8px">${__(
							'Showing the busiest patients only.'
					  )}</div>`
					: ''),
		is_patient ? clinical_note_reconcile_samples_html(data.samples) : '',
		`<p class="text-muted small">${__(
			'Missing Clinical Notes are created (as “Doctor Progress Note”, keyed by trans_no). After that, duplicate OP visit notes from re-imports are merged into one note (all trans numbers kept on the survivor).'
		)}</p>`,
	]
		.filter(Boolean)
		.join('');

	const dialog = new frappe.ui.Dialog({
		title: is_patient
			? __('Oracle -> ERPNext: Clinical Notes — {0}', [data.patient])
			: __('Oracle -> ERPNext: Clinical Notes'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'skip_duplicate_text',
				label: __('Skip history rows that only repeat the current diagnosis'),
				default: cint(values && values.skip_duplicate_text),
			},
			{
				fieldtype: 'Check',
				fieldname: 'remove_duplicates',
				label: __('Merge duplicate OP visit clinical notes after reconcile'),
				default:
					values && values.remove_duplicates != null
						? cint(values.remove_duplicates)
						: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: cint(values && values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_clinical_note_reconcile(frm, {
				patient: data.patient || '',
				skip_duplicate_text: cint(dialog_values.skip_duplicate_text),
				remove_duplicates: cint(dialog_values.remove_duplicates),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}

function start_clinical_note_reconcile(frm, values) {
	frappe.call({
		method: 'healthcare.api.clinical_note_reconcile.start_clinical_note_reconcile',
		args: {
			patient: (values && values.patient) || '',
			skip_duplicate_text: cint(values && values.skip_duplicate_text),
			remove_duplicates: cint(values && values.remove_duplicates != null ? values.remove_duplicates : 1),
			dry_run: cint(values && values.dry_run),
			files: values && values.files ? JSON.stringify(values.files) : '',
		},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_clinical_note_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Oracle -> ERPNext: Clinical Notes'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_clinical_note_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling clinical notes from Oracle');
	frappe.show_progress(title, 0, 100, __('Reading Oracle…'));

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.clinical_note_reconcile.get_clinical_note_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total) || 0;
				const processed = cint(status.processed) || 0;
				frappe.show_progress(
					title,
					total ? processed : Math.min(polls, 95),
					total || 100,
					total ? __('{0} of {1} patients', [processed, total]) : __('Reading Oracle…')
				);
				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: __('Oracle -> ERPNext: Clinical Notes'),
						indicator: status.state === 'finished' ? 'green' : 'red',
						wide: true,
						message: frappe.utils.escape_html(status.message || __('Done')).replace(
							/\n/g,
							'<br>'
						),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= CLINICAL_NOTE_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Clinical Notes again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


function open_nursing_note_reconcile(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: Nursing Notes'),
		entity: 'nursing_notes',
		intro: `<p class="text-muted small">${__(
			'Reads the legacy IP nursing notes (IP_NURSING) and creates only the Main Nursing Notes those rows are missing. A row whose trans number is already the name of another admission’s note is created as <trans>-N, so the live note is never renamed or deleted; a row whose words are already on the admission’s shift note is skipped.'
		)}</p>`,
		on_direct: () => open_nursing_note_reconcile_options(frm),
		on_excel: (files) => open_nursing_note_reconcile_options(frm, files),
	});
}

function open_nursing_note_reconcile_options(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Nursing Notes'),
		fields: [
			{
				fieldtype: 'Data',
				fieldname: 'patient',
				label: __('Patient (optional)'),
				description: __(
					'Leave empty to compare every admission in Oracle. A patient number gives the note-by-note breakdown for that patient.'
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __('Import rows whose trans number another admission already uses (as <trans>-N)'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: 0,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_nursing_note_reconcile(frm, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_nursing_note_reconcile(frm, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(
		files
			? __('Comparing nursing notes with the uploaded Excel export…')
			: __('Comparing nursing notes with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.main_nursing_note_reconcile.preview_main_nursing_note_reconcile',
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_nursing_note_reconcile_dialog(frm, r.message, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function nursing_note_reconcile_samples_html(samples) {
	if (!samples || !samples.length) {
		return '';
	}
	const items = samples
		.map(
			(sample) =>
				`<li>${oracle_sync_escape(sample.number)}${
					sample.admission ? ` · ${__('admission')} ${oracle_sync_escape(sample.admission)}` : ''
				}${sample.date ? ` — ${oracle_sync_escape(sample.date)}` : ''}<br><span class="text-muted">${oracle_sync_escape(
					sample.text
				)}</span></li>`
		)
		.join('');
	return `<p class="text-muted small" style="margin-bottom:4px"><b>${__(
		'Missing notes (first {0})',
		[samples.length]
	)}</b></p><ul class="text-muted small">${items}</ul>`;
}

function nursing_note_reconcile_blocked_html(rows) {
	if (!rows || !rows.length) {
		return '';
	}
	const items = rows
		.map(
			(row) =>
				`<li>${oracle_sync_escape(row[0])} — ${__('Oracle admission')} ${oracle_sync_escape(
					row[1]
				)}, ${__('trans number already on admission')} ${oracle_sync_escape(row[2])}</li>`
		)
		.join('');
	return `<p class="text-muted small" style="margin-bottom:4px"><b>${__(
		'Rows whose trans number another admission already uses (first {0})',
		[rows.length]
	)}</b></p><ul class="text-muted small">${items}</ul>`;
}
function show_nursing_note_reconcile_dialog(frm, data, values) {
	const missing = cint(data.missing_total);
	const free = cint(data.missing_free);
	const blocked = cint(data.missing_blocked);
	const is_admission = data.mode === 'admission';
	const is_patient = data.mode === 'patient';

	const rows = [
		[
			__('Oracle nursing notes'),
			`<b>${format_number(cint(data.oracle_rows_with_text))}</b> ${__(
				'with text'
			)} <span class="text-muted">(${format_number(cint(data.oracle_rows))} ${__(
				'rows'
			)}, ${format_number(cint(data.oracle_admissions))} ${__('admissions')})</span>`,
		],
		[
			__('Main Nursing Notes in ERPNext'),
			`<b>${format_number(cint(data.erpnext_notes))}</b>`,
		],
		[
			__('Already imported'),
			`<b>${format_number(cint(data.matched_notes))}</b> <span class="text-muted">${__(
				'matched by trans number'
			)}</span>`,
		],
		[__('Missing in ERPNext'), `<b>${format_number(missing)}</b>`],
		[
			__('of which the trans number is free'),
			`<b class="text-success">${format_number(free)}</b>`,
		],
		[
			__('of which the trans number is taken'),
			`<b class="${blocked ? 'text-warning' : ''}">${format_number(blocked)}</b>`,
		],
		[
			__('Notes in ERPNext without an Oracle row'),
			`${format_number(cint(data.extra_notes))} <span class="text-muted">${__(
				'(kept as they are)'
			)}</span>`,
		],
	];

	const scope = is_admission ? __('Admission') : is_patient ? __('Patient') : __('Whole site');
	const sentence = missing
		? __(
				'ERPNext is missing {0} nursing note(s) that Oracle recorded{1}.',
				[
					format_number(missing),
					data.admissions_with_missing
						? ` ${__('across {0} admission(s)', [
								format_number(cint(data.admissions_with_missing)),
						  ])}`
						: '',
				]
		  )
		: __('Every nursing note Oracle recorded is already in ERPNext.');

	const body = `
		<div class="alert alert-${missing ? 'warning' : 'success'}" style="margin-bottom:12px">
			<b>${scope}</b><br>${sentence}
		</div>
		<table class="table table-condensed" style="margin-bottom:8px">
			<tbody>
				${rows
					.map((row) => `<tr><td style="width:45%">${row[0]}</td><td>${row[1]}</td></tr>`)
					.join('')}
			</tbody>
		</table>
		${
			blocked && cint(values && values.suffix_conflicts)
				? `<p class="text-muted small">${__(
						'{0} of these rows share a trans number with a note of another admission. They are created as <code>&lt;trans&gt;-N</code>, so the existing note is never renamed or deleted.',
						[format_number(blocked)]
				  )}</p>`
				: ''
		}
		${nursing_note_reconcile_blocked_html(data.blocked_sample)}
		${nursing_note_reconcile_samples_html(data.samples)}
		<p class="text-muted small">${__('Source: {0}', [
			oracle_sync_escape(data.oracle_table || ''),
		])}</p>
	`;

	const dialog = new frappe.ui.Dialog({
		title: is_patient
			? __('Oracle -> ERPNext: Nursing Notes — {0}', [values.patient || data.patient])
			: __('Oracle -> ERPNext: Nursing Notes'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __(
					'Import rows whose trans number another admission already uses (as <trans>-N)'
				),
				default: cint(
					values && values.suffix_conflicts != null ? values.suffix_conflicts : 1
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: cint(values && values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_nursing_note_reconcile(frm, {
				patient: (values && values.patient) || '',
				suffix_conflicts: cint(dialog_values.suffix_conflicts),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}

function start_nursing_note_reconcile(frm, values) {
	frappe.call({
		method: 'healthcare.api.main_nursing_note_reconcile.start_main_nursing_note_reconcile',
		args: {
			patient: (values && values.patient) || '',
			suffix_conflicts: cint(
				values && values.suffix_conflicts != null ? values.suffix_conflicts : 1
			),
			dry_run: cint(values && values.dry_run),
			files: values && values.files ? JSON.stringify(values.files) : '',
		},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_nursing_note_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Oracle -> ERPNext: Nursing Notes'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_nursing_note_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling nursing notes from Oracle');
	frappe.show_progress(title, 0, 100, __('Comparing the two registers…'));

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.main_nursing_note_reconcile.get_main_nursing_note_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total);
				const processed = cint(status.processed);
				const percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
				frappe.show_progress(
					title,
					percent,
					100,
					status.message || __('{0} of {1}', [processed, total])
				);

				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: __('Oracle -> ERPNext: Nursing Notes'),
						indicator: status.state === 'failed' ? 'red' : 'green',
						wide: true,
						message: frappe.utils
							.escape_html(status.message || __('Done'))
							.replace(/\n/g, '<br>'),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= NURSING_NOTE_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Nursing Notes again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


function open_warning_message_reconcile(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: Warning Messages'),
		entity: 'warning_messages',
		intro: `<p class="text-muted small">${__(
			'Reads the legacy patient warnings (PATIENT_WARNING_MESSAGES) and repairs the Warning Message register: creates the warnings ERPNext is missing (a row whose number an app record already owns becomes <num>-W, so the live record is never renamed), completes the blanks Oracle knows about, and merges duplicate copies of the same warning. Values that are already there are never overwritten.'
		)}</p>`,
		on_direct: () => open_warning_message_reconcile_options(frm),
		on_excel: (files) => open_warning_message_reconcile_options(frm, files),
	});
}

function open_warning_message_reconcile_options(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Warning Messages'),
		fields: [
			{
				fieldtype: 'Data',
				fieldname: 'patient',
				label: __('Patient (optional)'),
				description: __(
					'Leave empty to reconcile every patient. A patient number limits the missing warnings to that patient.'
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __(
					'Import rows whose trans number another patient already uses (as <num>-W)'
				),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'fill_missing',
				label: __('Fill the blanks of existing warnings from Oracle'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'clean_duplicates',
				label: __('Merge duplicate copies of the same warning'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, write nothing)'),
				default: 0,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_warning_message_reconcile(frm, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_warning_message_reconcile(frm, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(
		files
			? __('Comparing warning messages with the uploaded Excel export…')
			: __('Comparing warning messages with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.warning_message_reconcile.preview_warning_message_reconcile',
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_warning_message_reconcile_dialog(frm, r.message, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function warning_message_reconcile_list_html(items, title, render) {
	if (!items || !items.length) {
		return '';
	}
	const list = items.map((item) => `<li>${render(item)}</li>`).join('');
	return `<p class="text-muted small" style="margin-bottom:4px"><b>${oracle_sync_escape(
		title
	)}</b></p><ul class="text-muted small">${list}</ul>`;
}

function show_warning_message_reconcile_dialog(frm, data, values) {
	const missing = cint(data.missing_total);
	const blocked = cint(data.missing_blocked);
	const fills = cint(data.fill_total);
	const duplicates = cint(data.duplicate_total);
	const skipped = cint(data.skipped_duplicates);

	const rows = [
		[
			__('Oracle warnings'),
			`<b>${format_number(cint(data.oracle_rows_with_text))}</b> ${__(
				'with text'
			)} <span class="text-muted">(${format_number(cint(data.oracle_rows))} ${__(
				'rows'
			)}, ${format_number(cint(data.oracle_patients))} ${__('patients')})</span>`,
		],
		[
			__('Warning Messages in ERPNext'),
			`<b>${format_number(cint(data.erpnext_rows))}</b> <span class="text-muted">(${format_number(
				cint(data.matched)
			)} ${__('match Oracle')}, ${format_number(cint(data.extra_rows))} ${__(
				'only in ERPNext'
			)})</span>`,
		],
		[
			__('Missing warnings'),
			`<b class="${missing ? 'text-danger' : 'text-success'}">${format_number(
				missing
			)}</b> <span class="text-muted">(${format_number(blocked)} ${__(
				'whose number an app record owns'
			)})</span>`,
		],
		[
			__('Warnings with blanks'),
			`<b>${format_number(fills)}</b> <span class="text-muted">${__(
				'can be completed from Oracle'
			)}</span>`,
		],
		[
			__('Duplicate copies'),
			`<b>${format_number(duplicates)}</b> <span class="text-muted">(${format_number(
				skipped
			)} ${__('kept: phone warning, attachment or extra data')})</span>`,
		],
	];

	const body = `
		<table class="table table-sm" style="margin-bottom:8px">${rows
			.map(
				([label, value]) =>
					`<tr><td class="text-muted" style="width:45%">${oracle_sync_escape(
						label
					)}</td><td>${value}</td></tr>`
			)
			.join('')}</table>
		${
			cint(data.differs_total)
				? `<p class="text-muted small">${__(
						'{0} warnings hold values that differ from Oracle. They are reported and never overwritten.',
						[format_number(cint(data.differs_total))]
				  )}</p>`
				: ''
		}
		${
			blocked && cint(values && values.suffix_conflicts)
				? `<p class="text-muted small">${__(
						'{0} of these rows share a number with a record of another patient. They are created as <code>&lt;num&gt;-W</code>, so the existing record is never renamed or deleted.',
						[format_number(blocked)]
				  )}</p>`
				: ''
		}
		${
			cint(data.register_missing_total) > cint(data.missing_total)
				? `<p class="text-muted small">${__(
						'{0} more missing warnings belong to other patients (register total: {1}).',
						[
							format_number(
								cint(data.register_missing_total) - cint(data.missing_total)
							),
							format_number(cint(data.register_missing_total)),
						]
				  )}</p>`
				: ''
		}
		${warning_message_reconcile_list_html(
			data.fill_sample,
			__('Warnings to complete (first {0})', [(data.fill_sample || []).length]),
			(row) =>
				`${oracle_sync_escape(row.name)}${
					row.patient ? ` · ${__('patient')} ${oracle_sync_escape(row.patient)}` : ''
				} — <span class="text-muted">${oracle_sync_escape((row.fields || []).join(', '))}</span>`
		)}
		${warning_message_reconcile_list_html(
			data.samples,
			__('Missing warnings (first {0})', [(data.samples || []).length]),
			(row) =>
				`${oracle_sync_escape(row.number)}${
					row.patient ? ` · ${__('patient')} ${oracle_sync_escape(row.patient)}` : ''
				}<br><span class="text-muted">${oracle_sync_escape(row.text || __('(no text)'))}</span>`
		)}
		${warning_message_reconcile_list_html(
			data.duplicate_sample,
			__('Duplicate copies to merge (first {0})', [(data.duplicate_sample || []).length]),
			(row) =>
				`${oracle_sync_escape(row.remove)} — ${__('same warning as')} ${oracle_sync_escape(
					row.keeper
				)}`
		)}
		<p class="text-muted small">${__('Source: {0}', [
			oracle_sync_escape(data.oracle_table || 'CLINIC2.PATIENT_WARNING_MESSAGES'),
		])}</p>
	`;

	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Warning Messages'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __(
					'Import rows whose trans number another patient already uses (as <num>-W)'
				),
				default: cint(
					values && values.suffix_conflicts != null ? values.suffix_conflicts : 1
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'fill_missing',
				label: __('Fill the blanks of existing warnings from Oracle'),
				default: cint(values && values.fill_missing != null ? values.fill_missing : 1),
			},
			{
				fieldtype: 'Check',
				fieldname: 'clean_duplicates',
				label: __('Merge duplicate copies of the same warning'),
				default: cint(
					values && values.clean_duplicates != null ? values.clean_duplicates : 1
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, write nothing)'),
				default: cint(values && values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_warning_message_reconcile(frm, {
				patient: (values && values.patient) || '',
				suffix_conflicts: cint(dialog_values.suffix_conflicts),
				fill_missing: cint(dialog_values.fill_missing),
				clean_duplicates: cint(dialog_values.clean_duplicates),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}



function start_warning_message_reconcile(frm, values) {
	frappe.call({
		method: 'healthcare.api.warning_message_reconcile.start_warning_message_reconcile',
		args: {
			patient: (values && values.patient) || '',
			suffix_conflicts: cint(
				values && values.suffix_conflicts != null ? values.suffix_conflicts : 1
			),
			fill_missing: cint(values && values.fill_missing != null ? values.fill_missing : 1),
			clean_duplicates: cint(
				values && values.clean_duplicates != null ? values.clean_duplicates : 1
			),
			dry_run: cint(values && values.dry_run),
			files: values && values.files ? JSON.stringify(values.files) : '',
		},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_warning_message_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Oracle -> ERPNext: Warning Messages'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_warning_message_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling warning messages from Oracle');
	frappe.show_progress(title, 0, 100, __('Comparing the two registers…'));

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.warning_message_reconcile.get_warning_message_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total);
				const processed = cint(status.processed);
				const percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
				frappe.show_progress(
					title,
					percent,
					100,
					status.message || __('{0} of {1}', [processed, total])
				);

				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					const summary =
						status.state === 'failed'
							? frappe.utils.escape_html(status.message || __('Failed'))
							: frappe.utils.escape_html(status.message || __('Done'));
					frappe.msgprint({
						title: __('Oracle -> ERPNext: Warning Messages'),
						indicator: status.state === 'failed' ? 'red' : 'green',
						wide: true,
						message: summary.replace(/\n/g, '<br>'),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= WARNING_MESSAGE_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Warning Messages again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


function open_lab_test_reconcile(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: Lab Tests'),
		entity: 'lab_tests',
		intro: `<p class="text-muted small">${__(
			'Reads the legacy lab orders (LAB_00_03) and their result rows (LAB_00_04) and repairs the Lab Test register: creates the lab tests ERPNext is missing, fills the blanks Oracle knows about (test name, result table, remarks, cost centre) and merges copies of the same lab order that the app created under its own name. Values that are already there are never overwritten.'
		)}</p>`,
		on_direct: () => open_lab_test_reconcile_options(frm),
		on_excel: (files) => open_lab_test_reconcile_options(frm, files),
	});
}

function open_lab_test_reconcile_options(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Lab Tests'),
		fields: [
			{
				fieldtype: 'Data',
				fieldname: 'patient',
				label: __('Patient (optional)'),
				description: __(
					'Leave empty to reconcile every patient. A patient number limits the missing lab tests and the blanks to that patient.'
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'fill_missing',
				label: __('Fill the blanks of existing lab tests from Oracle'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'clean_duplicates',
				label: __('Merge duplicate copies of the same lab order'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, write nothing)'),
				default: 0,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_lab_test_reconcile(frm, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_lab_test_reconcile(frm, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(
		files
			? __('Comparing lab tests with the uploaded Excel exports…')
			: __('Comparing lab tests with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.lab_test_reconcile.preview_lab_test_reconcile',
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_lab_test_reconcile_dialog(frm, r.message, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function lab_test_reconcile_list_html(items, title, render) {
	if (!items || !items.length) {
		return '';
	}
	const list = items.map((item) => `<li>${render(item)}</li>`).join('');
	return `<p class="text-muted small" style="margin-bottom:4px"><b>${oracle_sync_escape(
		title
	)}</b></p><ul class="text-muted small">${list}</ul>`;
}


function show_lab_test_reconcile_dialog(frm, data, values) {
	const missing = cint(data.missing_total);
	const fills = cint(data.fill_total);
	const duplicates = cint(data.duplicate_total);
	const skipped = cint(data.skipped_duplicates);

	const rows = [
		[
			__('Oracle lab orders'),
			`<b>${format_number(cint(data.oracle_rows))}</b> <span class="text-muted">(${format_number(
				cint(data.oracle_patients)
			)} ${__('patients')})</span>`,
		],
		[
			__('Lab Tests in ERPNext'),
			`<b>${format_number(cint(data.erpnext_rows))}</b> <span class="text-muted">(${format_number(
				cint(data.matched)
			)} ${__('match Oracle')}, ${format_number(cint(data.extra_rows))} ${__(
				'legacy rows Oracle no longer has'
			)})</span>`,
		],
		[
			__('Missing lab tests'),
			`<b class="${missing ? 'text-danger' : 'text-success'}">${format_number(missing)}</b>`,
		],
		[
			__('Lab tests with blanks'),
			`<b>${format_number(fills)}</b> <span class="text-muted">${__(
				'can be completed from Oracle'
			)}</span>`,
		],
		[
			__('Duplicate copies'),
			`<b>${format_number(duplicates)}</b> <span class="text-muted">(${format_number(
				skipped
			)} ${__('kept: invoiced, request, review, attachment or extra data')})</span>`,
		],
	];

	const body = `
		<table class="table table-sm" style="margin-bottom:8px">${rows
			.map(
				([label, value]) =>
					`<tr><td class="text-muted" style="width:45%">${oracle_sync_escape(
						label
					)}</td><td>${value}</td></tr>`
			)
			.join('')}</table>
		${
			cint(data.differs_total)
				? `<p class="text-muted small">${__(
						'{0} lab tests hold values that differ from Oracle. They are reported and never overwritten.',
						[format_number(cint(data.differs_total))]
				  )}</p>`
				: ''
		}
		${
			cint(data.register_missing_total) > cint(data.missing_total)
				? `<p class="text-muted small">${__(
						'{0} more missing lab tests belong to other patients (register total: {1}).',
						[
							format_number(
								cint(data.register_missing_total) - cint(data.missing_total)
							),
							format_number(cint(data.register_missing_total)),
						]
				  )}</p>`
				: ''
		}
		${
			cint(data.extra_rows)
				? `<p class="text-muted small">${__(
						'{0} legacy lab tests have no row in Oracle any more. They are not touched.',
						[format_number(cint(data.extra_rows))]
				  )}</p>`
				: ''
		}
		${lab_test_reconcile_list_html(
			data.fill_sample,
			__('Lab tests to complete (first {0})', [(data.fill_sample || []).length]),
			(row) =>
				`${oracle_sync_escape(row.name)}${
					row.patient ? ` · ${__('patient')} ${oracle_sync_escape(row.patient)}` : ''
				} — <span class="text-muted">${oracle_sync_escape((row.fields || []).join(', '))}</span>`
		)}
		${lab_test_reconcile_list_html(
			data.samples,
			__('Missing lab tests (first {0})', [(data.samples || []).length]),
			(row) =>
				`${oracle_sync_escape(row.trans_num)}${
					row.patient ? ` · ${__('patient')} ${oracle_sync_escape(row.patient)}` : ''
				}<br><span class="text-muted">${oracle_sync_escape(
					String(row.date || '').split(' ')[0] || __('(no date)')
				)}</span>`
		)}
		${lab_test_reconcile_list_html(
			data.duplicate_sample,
			__('Duplicate copies to merge (first {0})', [(data.duplicate_sample || []).length]),
			(row) =>
				`${oracle_sync_escape(row.remove)} — ${__('same lab order as')} ${oracle_sync_escape(
					row.keeper
				)}`
		)}
		<p class="text-muted small">${__('Source: {0}', [
			oracle_sync_escape(data.oracle_table || 'CLINIC2.LAB_00_03 + CLINIC2.LAB_00_04'),
		])}</p>
	`;

	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Lab Tests'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'fill_missing',
				label: __('Fill the blanks of existing lab tests from Oracle'),
				default: cint(values && values.fill_missing != null ? values.fill_missing : 1),
			},
			{
				fieldtype: 'Check',
				fieldname: 'clean_duplicates',
				label: __('Merge duplicate copies of the same lab order'),
				default: cint(
					values && values.clean_duplicates != null ? values.clean_duplicates : 1
				),
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, write nothing)'),
				default: cint(values && values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_lab_test_reconcile(frm, {
				patient: (values && values.patient) || '',
				fill_missing: cint(dialog_values.fill_missing),
				clean_duplicates: cint(dialog_values.clean_duplicates),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}


function start_lab_test_reconcile(frm, values) {
	frappe.call({
		method: 'healthcare.api.lab_test_reconcile.start_lab_test_reconcile',
		args: {
			patient: (values && values.patient) || '',
			fill_missing: cint(values && values.fill_missing != null ? values.fill_missing : 1),
			clean_duplicates: cint(
				values && values.clean_duplicates != null ? values.clean_duplicates : 1
			),
			dry_run: cint(values && values.dry_run),
			files: values && values.files ? JSON.stringify(values.files) : '',
		},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_lab_test_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Oracle -> ERPNext: Lab Tests'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_lab_test_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling lab tests from Oracle');
	frappe.show_progress(title, 0, 100, __('Comparing the two registers…'));

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.lab_test_reconcile.get_lab_test_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total);
				const processed = cint(status.processed);
				const percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
				frappe.show_progress(
					title,
					percent,
					100,
					status.message || __('{0} of {1}', [processed, total])
				);

				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					const summary =
						status.state === 'failed'
							? frappe.utils.escape_html(status.message || __('Failed'))
							: frappe.utils.escape_html(status.message || __('Done'));
					frappe.msgprint({
						title: __('Oracle -> ERPNext: Lab Tests'),
						indicator: status.state === 'failed' ? 'red' : 'green',
						wide: true,
						message: summary.replace(/\n/g, '<br>'),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= LAB_TEST_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Lab Tests again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


// ---------------------------------------------------------------------------
// Observations (IP_OBSERVATION_LEVEL)
// ---------------------------------------------------------------------------

function open_observation_reconcile(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: Observations'),
		entity: 'observations',
		intro: `<p class="text-muted small">${__(
			'Reads IP_OBSERVATION_LEVEL and repairs the Observation register: creates missing orders, fills blanks Oracle knows about, and merges duplicate copies of the same order. Values already on an Observation are never overwritten.'
		)}</p>`,
		on_direct: () => open_observation_reconcile_options(frm),
		on_excel: (files) => open_observation_reconcile_options(frm, files),
	});
}

function open_observation_reconcile_options(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Observations'),
		fields: [
			{
				fieldtype: 'Data',
				fieldname: 'patient',
				label: __('Patient (optional)'),
				description: __('Leave empty to reconcile every patient.'),
			},
			{
				fieldtype: 'Check',
				fieldname: 'fill_missing',
				label: __('Fill the blanks of existing observations from Oracle'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'clean_duplicates',
				label: __('Merge duplicate copies of the same observation order'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, write nothing)'),
				default: 0,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_observation_reconcile(frm, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_observation_reconcile(frm, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(
		files
			? __('Comparing observations with the uploaded Excel export…')
			: __('Comparing observations with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.observation_reconcile.preview_observation_reconcile',
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_observation_reconcile_dialog(frm, r.message, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function show_observation_reconcile_dialog(frm, data, values) {
	const missing = cint(data.missing_total);
	const fills = cint(data.fill_total);
	const duplicates = cint(data.duplicate_total);
	const body = `
		<table class="table table-sm" style="margin-bottom:8px">
			<tr><td class="text-muted" style="width:45%">${__('Oracle observation orders')}</td>
				<td><b>${format_number(cint(data.oracle_rows))}</b></td></tr>
			<tr><td class="text-muted">${__('Observations in ERPNext')}</td>
				<td><b>${format_number(cint(data.erpnext_rows))}</b>
					<span class="text-muted">(${format_number(cint(data.matched))} ${__('match Oracle')})</span></td></tr>
			<tr><td class="text-muted">${__('Missing')}</td>
				<td><b class="${missing ? 'text-danger' : 'text-success'}">${format_number(missing)}</b></td></tr>
			<tr><td class="text-muted">${__('With blanks to fill')}</td>
				<td><b>${format_number(fills)}</b></td></tr>
			<tr><td class="text-muted">${__('Duplicate copies')}</td>
				<td><b>${format_number(duplicates)}</b></td></tr>
		</table>
		${lab_test_reconcile_list_html(
			data.samples,
			__('Missing observations (first {0})', [(data.samples || []).length]),
			(row) =>
				`${oracle_sync_escape(row.trans_num)}${
					row.patient ? ` · ${__('patient')} ${oracle_sync_escape(row.patient)}` : ''
				}${row.date ? ` — ${oracle_sync_escape(String(row.date).split(' ')[0])}` : ''}`
		)}
		<p class="text-muted small">${__('Source: {0}', [
			oracle_sync_escape(data.oracle_table || 'CLINIC2.IP_OBSERVATION_LEVEL'),
		])}</p>
	`;
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Observations'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'fill_missing',
				label: __('Fill the blanks of existing observations from Oracle'),
				default: cint(values && values.fill_missing != null ? values.fill_missing : 1),
			},
			{
				fieldtype: 'Check',
				fieldname: 'clean_duplicates',
				label: __('Merge duplicate copies of the same observation order'),
				default: cint(values && values.clean_duplicates != null ? values.clean_duplicates : 1),
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, write nothing)'),
				default: cint(values && values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_observation_reconcile(frm, {
				patient: (values && values.patient) || '',
				fill_missing: cint(dialog_values.fill_missing),
				clean_duplicates: cint(dialog_values.clean_duplicates),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}

function start_observation_reconcile(frm, values) {
	frappe.call({
		method: 'healthcare.api.observation_reconcile.start_observation_reconcile',
		args: {
			patient: (values && values.patient) || '',
			fill_missing: cint(values && values.fill_missing != null ? values.fill_missing : 1),
			clean_duplicates: cint(
				values && values.clean_duplicates != null ? values.clean_duplicates : 1
			),
			dry_run: cint(values && values.dry_run),
			files: values && values.files ? JSON.stringify(values.files) : '',
		},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_observation_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Oracle -> ERPNext: Observations'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_observation_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling observations from Oracle');
	frappe.show_progress(title, 0, 100, __('Comparing the two registers…'));
	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.observation_reconcile.get_observation_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total);
				const processed = cint(status.processed);
				const percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
				frappe.show_progress(
					title,
					percent,
					100,
					status.message || __('{0} of {1}', [processed, total])
				);
				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: __('Oracle -> ERPNext: Observations'),
						indicator: status.state === 'failed' ? 'red' : 'green',
						wide: true,
						message: frappe.utils
							.escape_html(status.message || __('Done'))
							.replace(/\n/g, '<br>'),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= OBSERVATION_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Observations again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


// ---------------------------------------------------------------------------
// Vital Signs (IP_PATIENT_VITALS) — create missing only
// ---------------------------------------------------------------------------

function open_vital_signs_reconcile(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: Vital Signs'),
		entity: 'vital_signs',
		intro: `<p class="text-muted small">${__(
			'Reads IP_PATIENT_VITALS and creates only the Vital Signs ERPNext is missing. A row whose date and readings already exist on the admission is skipped (double-entry after ~2 Jul). Existing Vital Signs are never edited.'
		)}</p>`,
		on_direct: () => open_vital_signs_reconcile_options(frm),
		on_excel: (files) => open_vital_signs_reconcile_options(frm, files),
	});
}

function open_vital_signs_reconcile_options(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Vital Signs'),
		fields: [
			{
				fieldtype: 'Data',
				fieldname: 'patient',
				label: __('Patient (optional)'),
			},
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __('Import rows whose trans number is already used (as <trans>-V)'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: 0,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_vital_signs_reconcile(frm, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_vital_signs_reconcile(frm, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(
		files
			? __('Comparing vital signs with the uploaded Excel export…')
			: __('Comparing vital signs with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.vital_signs_reconcile.preview_vital_signs_reconcile',
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_vital_signs_reconcile_dialog(frm, r.message, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function show_vital_signs_reconcile_dialog(frm, data, values) {
	const missing = cint(data.missing_total);
	const body = `
		<table class="table table-sm" style="margin-bottom:8px">
			<tr><td class="text-muted" style="width:45%">${__('Oracle vital rows')}</td>
				<td><b>${format_number(cint(data.oracle_rows))}</b></td></tr>
			<tr><td class="text-muted">${__('Vital Signs in ERPNext')}</td>
				<td><b>${format_number(cint(data.erpnext_notes || data.erpnext_rows))}</b>
					<span class="text-muted">(${format_number(
						cint(data.matched_notes || data.matched)
					)} ${__('matched')})</span></td></tr>
			<tr><td class="text-muted">${__('Missing to create')}</td>
				<td><b class="${missing ? 'text-danger' : 'text-success'}">${format_number(
					missing
				)}</b></td></tr>
		</table>
		${nursing_note_reconcile_samples_html(data.samples)}
		<p class="text-muted small">${__('Source: {0}', [
			oracle_sync_escape(data.oracle_table || 'CLINIC2.IP_PATIENT_VITALS'),
		])}</p>
	`;
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Vital Signs'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __('Import rows whose trans number is already used (as <trans>-V)'),
				default: cint(values && values.suffix_conflicts != null ? values.suffix_conflicts : 1),
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: cint(values && values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_vital_signs_reconcile(frm, {
				patient: (values && values.patient) || '',
				suffix_conflicts: cint(dialog_values.suffix_conflicts),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}

function start_vital_signs_reconcile(frm, values) {
	frappe.call({
		method: 'healthcare.api.vital_signs_reconcile.start_vital_signs_reconcile',
		args: {
			patient: (values && values.patient) || '',
			suffix_conflicts: cint(
				values && values.suffix_conflicts != null ? values.suffix_conflicts : 1
			),
			dry_run: cint(values && values.dry_run),
			files: values && values.files ? JSON.stringify(values.files) : '',
		},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_vital_signs_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Oracle -> ERPNext: Vital Signs'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_vital_signs_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling vital signs from Oracle');
	frappe.show_progress(title, 0, 100, __('Comparing…'));
	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.vital_signs_reconcile.get_vital_signs_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total);
				const processed = cint(status.processed);
				frappe.show_progress(
					title,
					total ? Math.min(100, Math.round((processed / total) * 100)) : 0,
					100,
					status.message || __('{0} of {1}', [processed, total])
				);
				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: __('Oracle -> ERPNext: Vital Signs'),
						indicator: status.state === 'failed' ? 'red' : 'green',
						wide: true,
						message: frappe.utils
							.escape_html(status.message || __('Done'))
							.replace(/\n/g, '<br>'),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= VITAL_SIGNS_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Vital Signs again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


// ---------------------------------------------------------------------------
// Physical Examination (IP_ADMISSION_PHY_EXAM) — create missing only
// ---------------------------------------------------------------------------

function open_physical_examination_reconcile(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: Physical Examination'),
		entity: 'physical_examination',
		intro: `<p class="text-muted small">${__(
			'Reads IP_ADMISSION_PHY_EXAM and creates only the Physical Examinations ERPNext is missing. Same date + same exam content on the admission is skipped. Existing exams are never edited.'
		)}</p>`,
		on_direct: () => open_physical_examination_reconcile_options(frm),
		on_excel: (files) => open_physical_examination_reconcile_options(frm, files),
	});
}

function open_physical_examination_reconcile_options(frm, files) {
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Physical Examination'),
		fields: [
			{
				fieldtype: 'Data',
				fieldname: 'patient',
				label: __('Patient (optional)'),
			},
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __('Import rows whose trans number is already used (as <trans>-P)'),
				default: 1,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: 0,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_physical_examination_reconcile(frm, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_physical_examination_reconcile(frm, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(
		files
			? __('Comparing physical examinations with the uploaded Excel export…')
			: __('Comparing physical examinations with Oracle…')
	);
	frappe.call({
		method: 'healthcare.api.physical_examination_reconcile.preview_physical_examination_reconcile',
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_physical_examination_reconcile_dialog(frm, r.message, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function show_physical_examination_reconcile_dialog(frm, data, values) {
	const missing = cint(data.missing_total);
	const body = `
		<table class="table table-sm" style="margin-bottom:8px">
			<tr><td class="text-muted" style="width:45%">${__('Oracle exam rows')}</td>
				<td><b>${format_number(cint(data.oracle_rows))}</b></td></tr>
			<tr><td class="text-muted">${__('Physical Examinations in ERPNext')}</td>
				<td><b>${format_number(cint(data.erpnext_notes || data.erpnext_rows))}</b>
					<span class="text-muted">(${format_number(
						cint(data.matched_notes || data.matched)
					)} ${__('matched')})</span></td></tr>
			<tr><td class="text-muted">${__('Missing to create')}</td>
				<td><b class="${missing ? 'text-danger' : 'text-success'}">${format_number(
					missing
				)}</b></td></tr>
		</table>
		${nursing_note_reconcile_samples_html(data.samples)}
		<p class="text-muted small">${__('Source: {0}', [
			oracle_sync_escape(data.oracle_table || 'CLINIC2.IP_ADMISSION_PHY_EXAM'),
		])}</p>
	`;
	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: Physical Examination'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'suffix_conflicts',
				label: __('Import rows whose trans number is already used (as <trans>-P)'),
				default: cint(values && values.suffix_conflicts != null ? values.suffix_conflicts : 1),
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, create nothing)'),
				default: cint(values && values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_physical_examination_reconcile(frm, {
				patient: (values && values.patient) || '',
				suffix_conflicts: cint(dialog_values.suffix_conflicts),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}

function start_physical_examination_reconcile(frm, values) {
	frappe.call({
		method: 'healthcare.api.physical_examination_reconcile.start_physical_examination_reconcile',
		args: {
			patient: (values && values.patient) || '',
			suffix_conflicts: cint(
				values && values.suffix_conflicts != null ? values.suffix_conflicts : 1
			),
			dry_run: cint(values && values.dry_run),
			files: values && values.files ? JSON.stringify(values.files) : '',
		},
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_physical_examination_reconcile(frm);
				return;
			}
			frappe.msgprint({
				title: __('Oracle -> ERPNext: Physical Examination'),
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_physical_examination_reconcile(frm) {
	let polls = 0;
	const title = __('Reconciling physical examinations from Oracle');
	frappe.show_progress(title, 0, 100, __('Comparing…'));
	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method:
				'healthcare.api.physical_examination_reconcile.get_physical_examination_reconcile_status',
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total);
				const processed = cint(status.processed);
				frappe.show_progress(
					title,
					total ? Math.min(100, Math.round((processed / total) * 100)) : 0,
					100,
					status.message || __('{0} of {1}', [processed, total])
				);
				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: __('Oracle -> ERPNext: Physical Examination'),
						indicator: status.state === 'failed' ? 'red' : 'green',
						wide: true,
						message: frappe.utils
							.escape_html(status.message || __('Done'))
							.replace(/\n/g, '<br>'),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= PHYSICAL_EXAMINATION_RECONCILE_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open Physical Examination again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


/**
 * Shared UI for create-missing reconciles (Vital Signs-style): ask source →
 * options → preview → start → poll. Spec keys: title, entity, intro, api_prefix,
 * poll_limit, suffix_label (optional), erp_count_key (optional).
 */
function open_create_missing_reconcile(frm, spec) {
	ask_oracle_source({
		title: spec.title,
		entity: spec.entity,
		intro: `<p class="text-muted small">${spec.intro}</p>`,
		on_direct: () => open_create_missing_reconcile_options(frm, spec),
		on_excel: (files) => open_create_missing_reconcile_options(frm, spec, files),
	});
}

function open_create_missing_reconcile_options(frm, spec, files) {
	const fields = [
		{
			fieldtype: 'Data',
			fieldname: 'patient',
			label: __('Patient (optional)'),
		},
	];
	if (spec.suffix_label) {
		fields.push({
			fieldtype: 'Check',
			fieldname: 'suffix_conflicts',
			label: spec.suffix_label,
			default: 1,
		});
	}
	fields.push({
		fieldtype: 'Check',
		fieldname: 'dry_run',
		label: __('Dry run (report only, create nothing)'),
		default: 0,
	});
	const dialog = new frappe.ui.Dialog({
		title: spec.title,
		fields: fields,
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_create_missing_reconcile(frm, spec, { ...(values || {}), files: files });
		},
	});
	dialog.show();
}

function preview_create_missing_reconcile(frm, spec, values) {
	const files = (values && values.files) || null;
	frappe.dom.freeze(__('Comparing with Oracle…'));
	frappe.call({
		method: `${spec.api_prefix}.preview_${spec.method_suffix}`,
		args: {
			patient: (values && values.patient) || '',
			files: files ? JSON.stringify(files) : '',
		},
		callback(r) {
			frappe.dom.unfreeze();
			const msg = r.message || {};
			// Heavy compares (e.g. Legacy Sales) enqueue and must be polled.
			if (msg.queued || msg.async || msg.running) {
				poll_create_missing_reconcile_preview(frm, spec, values || {});
				return;
			}
			if (!r.message) {
				return;
			}
			show_create_missing_reconcile_dialog(frm, spec, msg, values || {});
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function poll_create_missing_reconcile_preview(frm, spec, values) {
	let polls = 0;
	const title = spec.progress_title || spec.title;
	const status_method =
		spec.preview_status_method ||
		`${spec.api_prefix}.get_${spec.method_suffix}_preview_status`;
	frappe.show_progress(title, 0, 100, __('Comparing with Oracle…'));
	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: status_method,
			callback(r) {
				const status = r.message || {};
				frappe.show_progress(
					title,
					status.state === 'finished' ? 100 : Math.min(90, polls * 2),
					100,
					status.message || __('Comparing with Oracle…')
				);
				if (status.state === 'finished') {
					clearInterval(timer);
					frappe.hide_progress();
					show_create_missing_reconcile_dialog(frm, spec, status, values || {});
				} else if (status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: spec.title,
						indicator: 'red',
						wide: true,
						message: frappe.utils
							.escape_html(status.message || __('Comparison failed'))
							.replace(/\n/g, '<br>'),
					});
				} else if (polls >= (spec.poll_limit || 300)) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The comparison is still running in the background. Open the button again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}

function create_missing_reconcile_count(data, keys) {
	for (let i = 0; i < keys.length; i++) {
		if (data[keys[i]] != null) {
			return cint(data[keys[i]]);
		}
	}
	return 0;
}

function create_missing_reconcile_samples_html(samples) {
	if (!samples || !samples.length) {
		return '';
	}
	const items = samples
		.map((sample) => {
			if (typeof sample === 'string') {
				return `<li>${oracle_sync_escape(sample)}</li>`;
			}
			const label =
				sample.number ||
				sample.trans_no ||
				sample.sr_num ||
				sample.key ||
				sample.admission ||
				sample.visit ||
				'';
			const bits = [];
			if (sample.admission && sample.admission !== label) {
				bits.push(`${__('admission')} ${oracle_sync_escape(sample.admission)}`);
			}
			if (sample.patient) {
				bits.push(`${__('patient')} ${oracle_sync_escape(sample.patient)}`);
			}
			if (sample.visit && sample.visit !== label) {
				bits.push(`${__('visit')} ${oracle_sync_escape(sample.visit)}`);
			}
			if (sample.date) {
				bits.push(oracle_sync_escape(sample.date));
			}
			if (sample.filled_lines != null) {
				bits.push(__('{0} lines', [cint(sample.filled_lines)]));
			}
			const detail = sample.text || sample.serv_num || '';
			return `<li>${oracle_sync_escape(label)}${
				bits.length ? ` · ${bits.join(' · ')}` : ''
			}${
				detail
					? `<br><span class="text-muted">${oracle_sync_escape(detail)}</span>`
					: ''
			}</li>`;
		})
		.join('');
	return `<p class="text-muted small" style="margin-bottom:4px"><b>${__(
		'Missing (first {0})',
		[samples.length]
	)}</b></p><ul class="text-muted small">${items}</ul>`;
}

function show_create_missing_reconcile_dialog(frm, spec, data, values) {
	const missing = create_missing_reconcile_count(data, [
		'missing_total',
		'missing_discharges',
		'missing_claims',
		'missing_admissions',
		'missing_patients',
		'missing_registers',
	]);
	const erp = create_missing_reconcile_count(data, [
		'erpnext_notes',
		'erpnext_rows',
		'erpnext_ect',
		'erpnext_schedules',
		'erpnext_histories',
		'erpnext_discharges',
		'erpnext_claims',
		'erpnext_allergy_warnings',
		'erpnext_patients',
		'erpnext_registers',
	]);
	const matched = create_missing_reconcile_count(data, [
		'matched_notes',
		'matched',
		'matched_ect',
		'matched_schedules',
		'matched_histories',
		'matched_discharges',
		'matched_claims',
		'matched_patients',
		'matched_registers',
	]);
	const oracle_rows = create_missing_reconcile_count(data, [
		'oracle_rows',
		'allergy_texts',
		'oracle_discharged',
		'oracle_claims',
		'oracle_admissions',
		'oracle_patients',
		'oracle_insured',
	]);
	const body = `
		<table class="table table-sm" style="margin-bottom:8px">
			<tr><td class="text-muted" style="width:45%">${__('Oracle rows')}</td>
				<td><b>${format_number(oracle_rows)}</b></td></tr>
			<tr><td class="text-muted">${__('Already in ERPNext')}</td>
				<td><b>${format_number(erp)}</b>
					<span class="text-muted">(${format_number(matched)} ${__('matched')})</span></td></tr>
			<tr><td class="text-muted">${__('Missing to create')}</td>
				<td><b class="${missing ? 'text-danger' : 'text-success'}">${format_number(
					missing
				)}</b></td></tr>
			${
				data.update_total != null
					? `<tr><td class="text-muted">${__('Existing to update')}</td>
				<td><b>${format_number(cint(data.update_total))}</b></td></tr>`
					: ''
			}
			${
				data.duplicates != null
					? `<tr><td class="text-muted">${__('Duplicates to remove')}</td>
				<td><b>${format_number(cint(data.duplicates))}</b></td></tr>`
					: ''
			}
			${
				data.matched_by_id != null
					? `<tr><td class="text-muted">${__(
							'Same or similar CPR / id, different file no'
					  )}</td><td><b>${format_number(cint(data.matched_by_id))}</b></td></tr>`
					: ''
			}
			${
				data.matched_by_name_phone != null
					? `<tr><td class="text-muted">${__(
							'Same name and phone, different file no'
					  )}</td><td><b>${format_number(cint(data.matched_by_name_phone))}</b></td></tr>`
					: ''
			}
		</table>
		${create_missing_reconcile_samples_html(data.samples)}
		<p class="text-muted small">${__('Source: {0}', [
			oracle_sync_escape(data.oracle_table || ''),
		])}</p>
	`;
	const fields = [{ fieldtype: 'HTML', fieldname: 'summary' }];
	if (spec.suffix_label) {
		fields.push({
			fieldtype: 'Check',
			fieldname: 'suffix_conflicts',
			label: spec.suffix_label,
			default: cint(values && values.suffix_conflicts != null ? values.suffix_conflicts : 1),
		});
	}
	fields.push({
		fieldtype: 'Check',
		fieldname: 'dry_run',
		label: __('Dry run (report only, create nothing)'),
		default: cint(values && values.dry_run),
	});
	const dialog = new frappe.ui.Dialog({
		title: spec.title,
		size: 'large',
		fields: fields,
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			start_create_missing_reconcile(frm, spec, {
				patient: (values && values.patient) || '',
				suffix_conflicts: cint(
					dialog_values.suffix_conflicts != null ? dialog_values.suffix_conflicts : 1
				),
				dry_run: cint(dialog_values.dry_run),
				files: (values && values.files) || null,
			});
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}

function start_create_missing_reconcile(frm, spec, values) {
	const args = {
		patient: (values && values.patient) || '',
		dry_run: cint(values && values.dry_run),
		files: values && values.files ? JSON.stringify(values.files) : '',
	};
	if (spec.suffix_label) {
		args.suffix_conflicts = cint(
			values && values.suffix_conflicts != null ? values.suffix_conflicts : 1
		);
	}
	frappe.call({
		method: `${spec.api_prefix}.start_${spec.method_suffix}`,
		args: args,
		callback(r) {
			const result = r.message || {};
			if (result.queued || result.running) {
				track_create_missing_reconcile(frm, spec);
				return;
			}
			frappe.msgprint({
				title: spec.title,
				indicator: 'orange',
				message: result.message || __('The reconciliation could not be started.'),
			});
		},
	});
}

function track_create_missing_reconcile(frm, spec) {
	let polls = 0;
	const title = spec.progress_title || spec.title;
	frappe.show_progress(title, 0, 100, __('Comparing…'));
	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: `${spec.api_prefix}.get_${spec.method_suffix}_status`,
			callback(r) {
				const status = r.message || {};
				const total = cint(status.total);
				const processed = cint(status.processed);
				frappe.show_progress(
					title,
					total ? Math.min(100, Math.round((processed / total) * 100)) : 0,
					100,
					status.message || __('{0} of {1}', [processed, total])
				);
				if (status.state === 'finished' || status.state === 'failed') {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint({
						title: spec.title,
						indicator: status.state === 'failed' ? 'red' : 'green',
						wide: true,
						message: frappe.utils
							.escape_html(status.message || __('Done'))
							.replace(/\n/g, '<br>'),
					});
					if (frm && frm.refresh) {
						frm.refresh();
					}
				} else if (polls >= (spec.poll_limit || 300)) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The reconciliation is still running in the background. Open the button again in a few minutes to see the result.'
						)
					);
				}
			},
			error() {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}

function open_allergy_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Allergies'),
		entity: 'allergies',
		intro: __(
			'Reads allergy text from Patient Visit (visit_allergies_history), Patient (allergies / PATIENT_INFO_01), and optionally live Oracle / Excel for those tables. Creates only the Warning Messages ERPNext is missing, with is_allergy ticked. Same words already on a warning are skipped (the flag is turned on if it was off). Non-allergy warnings are never overwritten.'
		),
		api_prefix: 'healthcare.api.allergy_reconcile',
		method_suffix: 'allergy_reconcile',
		poll_limit: ALLERGY_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling allergies from visits and Oracle'),
	});
}

function open_morse_fall_scale_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Morse Fall Scale'),
		entity: 'morse_fall_scale',
		intro: __(
			'Reads MORSE_FALL_SCALE_01 and creates only the Morse Fall Scale rows ERPNext is missing (by TRANS_NUM). Scales already stored are left as they are.'
		),
		api_prefix: 'healthcare.api.care_record_reconcile',
		method_suffix: 'morse_fall_scale_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling Morse Fall Scale from Oracle'),
	});
}

function open_patient_assessment_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Patient Assessment'),
		entity: 'patient_assessment',
		intro: __(
			'Reads IP_PATIENT_ASSESSMENT. One Patient Assessment is kept per admission (the latest Oracle TRANS_NUM). Extra assessments for that admission are removed, and an assessment is created only when the admission does not have one.'
		),
		api_prefix: 'healthcare.api.care_record_reconcile',
		method_suffix: 'patient_assessment_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling patient assessments from Oracle'),
	});
}

function open_medicine_given_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Medicine Given'),
		entity: 'medicine_given',
		intro: __(
			'Reads IP_ADMISSION_MEDICINE_SHEET and IP_ADMISSION_MEDICINE_SHEET_23. Only rows marked Given (GIVEN_YN = Y) become Medicine Given. A dose from IP_ADMISSION_MEDICINE_SHEET_23 has that checkbox ticked on the Medicine Given row. Doses already recorded are left as they are, and a repeated dose for the same sheet number is removed.'
		),
		api_prefix: 'healthcare.api.care_record_reconcile',
		method_suffix: 'medicine_given_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling medicine given from Oracle'),
	});
}

function open_legacy_sales_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Legacy Sales / Pharmacy Dispensed'),
		entity: 'legacy_sales',
		intro: __(
			'Reads INV_00_01 (headers) and INV_00_02 (lines) for hospital pharmacy SAL documents with TRANS_SOURCE IP or OP. EMP staff purchases and Rose retail sales are excluded. Uses NET_BILL_AMOUNT as the charged amount and ITEM_SMALL_QTY as quantity; pink prescription columns are kept. Missing Legacy Sales Transactions headers are created and empty headers get their item lines. Export SQL: healthcare/api/sql/pharmacy_dispensed_extraction.sql (expect about 43,709 OP + 73,321 IP headers). Comparison runs in the background so large INV uploads do not time out.'
		),
		api_prefix: 'healthcare.api.legacy_sales_reconcile',
		method_suffix: 'legacy_sales_reconcile',
		poll_limit: 600,
		progress_title: __('Reconciling pharmacy dispensed sales from Oracle'),
	});
}

function open_appointment_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Appointments'),
		entity: 'appointments',
		intro: __(
			'Reads APPOINTMENTS_INFO_01. A Patient Appointment matches on the patient, the doctor, and the date. The time must also match when both sides have one. APP_NUM is not the match, because that number may already belong to a different appointment. Only missing appointments are created, and an existing appointment is left as it is.'
		),
		api_prefix: 'healthcare.api.care_record_reconcile',
		method_suffix: 'appointment_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling appointments from Oracle'),
	});
}

function open_medical_diagnosis_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Medical Diagnosis Entry'),
		entity: 'medical_diagnosis',
		intro: __(
			'Reads VISIT_DIAGNOSES_01 only. IP_ADMISSION_DIAGNOSES stays on Clinical Notes. Repeated Medical Diagnosis Entry rows with the same visit-diagnosis number are removed, and only visit diagnoses ERPNext does not already have are created.'
		),
		api_prefix: 'healthcare.api.medical_diagnosis_reconcile',
		method_suffix: 'medical_diagnosis_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling medical diagnosis entries from Oracle'),
	});
}

function open_grooming_chart_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: IP Grooming Chart'),
		entity: 'grooming_chart',
		intro: __(
			'Reads IP_GROOMING_CHART and creates only the grooming charts ERPNext is missing (by TRANS_NUM). Charts already stored are left as they are.'
		),
		api_prefix: 'healthcare.api.ip_chart_reconcile',
		method_suffix: 'grooming_chart_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling IP grooming charts from Oracle'),
	});
}

function open_mental_state_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: IP Mental State'),
		entity: 'mental_state',
		intro: __(
			'Reads IP_MENTAL_STATE and creates only the mental state rows ERPNext is missing (by TRANS_NO). Rows already imported under that number are left as they are.'
		),
		api_prefix: 'healthcare.api.ip_chart_reconcile',
		method_suffix: 'mental_state_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling IP mental state from Oracle'),
	});
}

function open_admission_transfer_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: IP Admission Transfer'),
		entity: 'admission_transfer',
		intro: __(
			'Reads IP_ADMISSION_TRANSFER and creates only the Transfer Admission Events ERPNext is missing (by TRANS_NUM). Transfers already stored are left as they are.'
		),
		api_prefix: 'healthcare.api.ip_chart_reconcile',
		method_suffix: 'admission_transfer_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling IP admission transfers from Oracle'),
	});
}

function open_ect_details_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: ECT Details'),
		entity: 'ect_details',
		intro: __(
			'Reads ECT_00_01 (and ECT_00_02 attributes) and creates only the ECT Details ERPNext is missing. Same-date / same-measure rows already on the admission are skipped.'
		),
		api_prefix: 'healthcare.api.ect_details_reconcile',
		method_suffix: 'ect_details_reconcile',
		suffix_label: __('Import rows whose trans number is already used (as <trans>-E)'),
		poll_limit: ECT_DETAILS_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling ECT Details from Oracle'),
	});
}

function open_session_schedule_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Session Schedule'),
		entity: 'session_schedule',
		intro: __(
			'Reads VISIT_00_05 and creates only the Session Schedule rows ERPNext is missing. Same date + same content on the visit is skipped.'
		),
		api_prefix: 'healthcare.api.session_schedule_reconcile',
		method_suffix: 'session_schedule_reconcile',
		suffix_label: __('Import rows whose sr number is already used (as <sr>-S)'),
		poll_limit: SESSION_SCHEDULE_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling session schedules from Oracle'),
	});
}

function open_daily_patient_visit_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Daily Patient Visit Setup'),
		entity: 'daily_patient_visit',
		intro: __(
			'Reads DAILY_PATIENTS_01 (Daily Patient Visit Setup) and DAILY_PATIENTS_02 (Daily Auto Visit). Creates missing setups/visits and updates existing ones. Matching uses TRANS_NUM / INV_NUM and also patient + from date / encounter date — not trans number alone.'
		),
		api_prefix: 'healthcare.api.daily_patient_visit_reconcile',
		method_suffix: 'daily_patient_visit_reconcile',
		poll_limit: 300,
		progress_title: __('Reconciling Daily Patient Visit Setup / Auto Visits'),
	});
}

function open_patient_history_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Patient History'),
		entity: 'patient_history',
		intro: __(
			'Reads IP_ADMISSION_02 and creates Patient History only for admissions that still lack an equivalent history. Existing histories are never edited.'
		),
		api_prefix: 'healthcare.api.patient_history_reconcile',
		method_suffix: 'patient_history_reconcile',
		poll_limit: PATIENT_HISTORY_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling patient history from Oracle'),
	});
}

function open_discharge_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Discharge'),
		entity: 'discharge',
		intro: __(
			'Reads discharged admissions from IP_ADMISSION_01 and creates Discharge documents ERPNext is still missing. Existing discharges are never overwritten.'
		),
		api_prefix: 'healthcare.api.discharge_reconcile',
		method_suffix: 'discharge_reconcile',
		poll_limit: DISCHARGE_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling discharges from Oracle'),
	});
}

function open_insurance_claim_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Insurance Claims'),
		entity: 'insurance_claims',
		intro: __(
			'Reads INSURANCE_00_01 (+ INSURANCE_00_02 lines) and creates only the Insurance Claims ERPNext is missing (by TRANS_NUM). Also ensures Insurance Patient Register where needed.'
		),
		api_prefix: 'healthcare.api.insurance_claim_reconcile',
		method_suffix: 'insurance_claim_reconcile',
		poll_limit: INSURANCE_CLAIM_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling insurance claims from Oracle'),
	});
}

function open_visit_history_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Visit History'),
		entity: 'visit_history',
		intro: __(
			'Reads VISIT_00_01_HISTORY and creates only the Visit History rows ERPNext is missing. The record key is the visit number plus CR date (same as the Excel import). Existing rows are left alone.'
		),
		api_prefix: 'healthcare.api.visit_history_reconcile',
		method_suffix: 'visit_history_reconcile',
		poll_limit: VISIT_HISTORY_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling visit history from Oracle'),
	});
}

function open_patient_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Patients'),
		entity: 'patients',
		intro: __(
			'Reads PATIENT_INFO_01 and creates missing Patients by file number. A patient already saved under another file number is not created again when the name and phone match, or when the CPR / id number is the same or one digit off. The stored CPR is not overwritten when the numbers are not exactly the same.'
		),
		api_prefix: 'healthcare.api.patient_reconcile',
		method_suffix: 'patient_reconcile',
		poll_limit: PATIENT_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling patients from Oracle'),
	});
}

function open_insurance_register_reconcile(frm) {
	open_create_missing_reconcile(frm, {
		title: __('Oracle -> ERPNext: Insurance Register'),
		entity: 'insurance_register',
		intro: __(
			'Reads INSURANCE_00_01. Each patient on a claim header is marked insured (TRICARE) and gets an Insurance Patient Register when they still have none. INSURANCE_00_02 is claim lines and has no patient. PATIENT_INFO_01 is not used.'
		),
		api_prefix: 'healthcare.api.insurance_register_reconcile',
		method_suffix: 'insurance_register_reconcile',
		poll_limit: INSURANCE_REGISTER_RECONCILE_POLL_LIMIT,
		progress_title: __('Reconciling insurance registers from Oracle'),
	});
}


function open_clinical_note_duplicates(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __('Merge Duplicate Clinical Notes'),
		fields: [
			{
				fieldtype: 'Select',
				fieldname: 'scope',
				label: __('Scope'),
				options: [
					{ value: 'visits', label: __('OP visit notes (VISIT_00_01)') },


					{ value: 'inpatient', label: __('IP notes (IP_ADMISSION_DIAGNOSES)') },
					{ value: 'all', label: __('Everything') },
				],
				default: 'visits',
			},
			{
				fieldtype: 'Check',
				fieldname: 'include_legacy_inpatient',
				label: __(
					'Also merge repeated legacy IP notes (their Oracle trans numbers stay on the surviving note)'
				),
				default: 0,
			},
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, delete nothing)'),
				default: 1,
			},
		],
		primary_action_label: __('Preview'),
		primary_action(values) {
			dialog.hide();
			preview_clinical_note_duplicates(frm, values || {});
		},
	});
	dialog.show();
}

function preview_clinical_note_duplicates(frm, values) {
	frappe.dom.freeze(__('Looking for duplicate Clinical Notes…'));
	frappe.call({
		method: 'healthcare.api.clinical_note_duplicate_cleanup.preview_clinical_note_duplicates',
		args: { scope: values.scope || 'visits', sample_limit: 5 },
		callback(r) {
			frappe.dom.unfreeze();
			show_clinical_note_duplicates_dialog(frm, r.message || {}, values);
		},
		error() {
			frappe.dom.unfreeze();
		},
	});
}

function clinical_note_duplicates_sample_html(sample) {
	if (!sample || !sample.length) {
		return '';
	}
	const head = `<tr><th>${__('Patient')}</th><th>${__('Transaction')}</th><th>${__(
		'Posting date'
	)}</th><th class="text-right">${__('Copies')}</th><th>${__('Keeping')}</th><th>${__(
		'All Trans Nos'
	)}</th></tr>`;
	const body = sample
		.map(
			(row) => `<tr>
				<td>${oracle_sync_escape(row.patient)}</td>
				<td>${oracle_sync_escape(row.reference)}</td>
				<td>${oracle_sync_escape(row.posting_date)}</td>
				<td class="text-right">${oracle_sync_escape(row.copies)}</td>
				<td>${oracle_sync_escape(row.keep)}</td>
				<td>${oracle_sync_escape(row.merged_trans_nos || '')}</td>
			</tr>`
		)
		.join('');
	return `<table class="table table-bordered" style="margin-bottom:12px"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function show_clinical_note_duplicates_dialog(frm, data, values) {
	const groups = cint(data.duplicate_groups);
	const copies = cint(data.extra_copies);
	if (!groups || !copies) {
		frappe.msgprint({
			title: __('Merge Duplicate Clinical Notes'),
			message: __('No duplicate notes found.'),
			indicator: 'green',
		});
		return;
	}

	const scope_labels = {
		visits: __('OP visit notes'),
		inpatient: __('IP notes'),
		all: __('All notes'),
	};
	const body = [
		`<div class="alert alert-warning">${__(
			'Notes that are word for word the same on the same transaction (same patient, same visit/admission, same day) are one note: the oldest one is kept, it receives every trans number in “All Trans Nos” and the number of copies in “Repeat Count”, and the other copies are deleted.'
		)}</div>`,
		`<p class="text-muted small">${__('Scope')}: ${oracle_sync_escape(
			scope_labels[values.scope] || values.scope
		)} · ${__('Duplicate groups')}: <b>${groups}</b> · ${__('Copies to delete')}: <b>${copies}</b></p>`,
		clinical_note_duplicates_sample_html(data.sample),
	]
		.filter(Boolean)
		.join('');

	const dialog = new frappe.ui.Dialog({
		title: __('Merge Duplicate Clinical Notes'),
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'summary' },
			{
				fieldtype: 'Check',
				fieldname: 'dry_run',
				label: __('Dry run (report only, delete nothing)'),
				default: cint(values.dry_run),
			},
		],
		primary_action_label: __('Start'),
		primary_action(dialog_values) {
			dialog.hide();
			run_migration_job(
				frm,
				'start_clinical_note_duplicate_cleanup_migration',
				'clinical_note_duplicate_cleanup',
				{
					scope: values.scope || 'visits',
					include_legacy_inpatient: cint(values.include_legacy_inpatient),
					match_posting_time: 1,
					dry_run: cint(dialog_values.dry_run),
				}
			);
		},
	});
	dialog.fields_dict.summary.$wrapper.html(body);
	dialog.show();
}

function open_oracle_ip_admission(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: IP Admission'),
		entity: 'ip_admission',
		intro: `<p class="text-muted small">${__(
			'Compares Oracle IP_ADMISSION_01 with Inpatient Admission and creates only the admissions that exist in Oracle and are missing in ERPNext. Existing ERPNext admissions are never updated or deleted.'
		)}</p>`,
		on_direct: () => run_oracle_ip_admission_comparison(frm),
		on_excel: (files) => run_oracle_ip_admission_comparison(frm, files),
	});
}

function run_oracle_ip_admission_comparison(frm, files) {
	frappe.dom.freeze(
		files
			? __('Comparing the uploaded IP_ADMISSION_01 export with Inpatient Admission…')
			: __('Comparing Oracle IP_ADMISSION_01 with Inpatient Admission…')
	);
	frappe.call({
		method: 'healthcare.api.oracle_sync.compare_ip_admissions',
		args: files ? { files: JSON.stringify(files) } : {},
		callback: (r) => {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_oracle_ip_admission_report(frm, r.message, files);
		},
		error: () => {
			frappe.dom.unfreeze();
		},
	});
}

function oracle_sync_summary_html(data) {
	const rows = [
		[__('Oracle table'), data.oracle_table],
		[__('ERPNext doctype'), data.doctype],
		[__('Match key'), data.match_note || `${data.oracle_key} ↔ ${data.frappe_key}`],
		[__('Rows in Oracle'), data.source_count],
		[__('Rows in ERPNext'), data.target_count],
		[__('Missing in ERPNext'), data.missing_count],
	];
	if (data.matched_by_identity != null) {
		rows.push([
			__('Same visit, different case no (patient, date and visit type)'),
			data.matched_by_identity,
		]);
	}
	rows.push([__('Only in ERPNext (left untouched)'), data.extra_count]);

	const body = rows
		.map(
			([label, value]) =>
				`<tr><td style="width:45%">${oracle_sync_escape(label)}</td><td><b>${oracle_sync_escape(
					value
				)}</b></td></tr>`
		)
		.join('');

	return `<table class="table table-bordered" style="margin-bottom:12px">${body}</table>`;
}

function oracle_sync_missing_table_html(data) {
	const rows = data.missing || [];
	if (!rows.length) {
		return `<div class="alert alert-success">${__(
			'Nothing is missing: ERPNext already has every Oracle admission.'
		)}</div>`;
	}

	const head = [
		__('Case No'),
		__('Patient'),
		__('Patient Name'),
		__('Admission Date'),
		__('Discharge Date'),
		__('Status'),
		__('Bed'),
	];

	const body = rows
		.map(
			(row) => `<tr>
				<td>${oracle_sync_escape(row.case_no)}</td>
				<td>${oracle_sync_escape(row.patient)}</td>
				<td>${oracle_sync_escape(row.patient_name)}${
					row.patient_exists
						? ''
						: ` <span class="indicator-pill red">${__('missing patient')}</span>`
				}</td>
				<td>${oracle_sync_escape(row.admission_date)}</td>
				<td>${oracle_sync_escape(row.discharge_date)}</td>
				<td>${oracle_sync_escape(row.status)}</td>
				<td>${oracle_sync_escape(row.bed_num)}</td>
			</tr>`
		)
		.join('');

	const footer = data.sample_limited
		? `<div class="text-muted small" style="margin-top:6px">${__(
				'Showing the first {0} of {1} missing rows.',
				[rows.length, data.missing_count]
		  )}</div>`
		: '';

	return `<table class="table table-bordered table-condensed">
		<thead><tr>${head.map((label) => `<th>${oracle_sync_escape(label)}</th>`).join('')}</tr></thead>
		<tbody>${body}</tbody>
	</table>${footer}`;
}

function show_oracle_ip_admission_report(frm, data, files) {
	const has_missing = cint(data.missing_count) > 0;

	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: IP Admission'),
		size: 'extra-large',
		fields: [{ fieldtype: 'HTML', fieldname: 'report_html' }],
		primary_action_label: has_missing
			? __('Import {0} Missing', [data.missing_count])
			: __('Close'),
		primary_action() {
			if (!has_missing) {
				dialog.hide();
				return;
			}
			confirm_oracle_ip_admission_import(frm, dialog, data, files);
		},
	});

	dialog.fields_dict.report_html.$wrapper.html(
		oracle_sync_summary_html(data) + (has_missing ? oracle_sync_missing_table_html(data) : '')
	);
	dialog.show();
}

function confirm_oracle_ip_admission_import(frm, dialog, data, files) {
	frappe.confirm(
		__(
			'Import {0} missing admission(s) from {1} into ERPNext?<br><br>Only missing records are created — existing ERPNext admissions are never updated or deleted.',
			[data.missing_count, files ? __('the Excel export') : __('Oracle')]
		),
		() => {
			frappe.dom.freeze(__('Importing missing admissions from Oracle…'));
			frappe.call({
				method: 'healthcare.api.oracle_sync.import_ip_admissions',
				args: files ? { dry_run: 0, files: JSON.stringify(files) } : { dry_run: 0 },
				callback: (r) => {
					frappe.dom.unfreeze();
					const message = r.message || {};
					dialog.hide();
					if (message.queued) {
						track_oracle_ip_admission_import(frm, message.total || data.missing_count);
						return;
					}
					show_oracle_ip_admission_result(frm, message.result || {});
				},
				error: () => {
					frappe.dom.unfreeze();
				},
			});
		}
	);
}


function show_oracle_ip_admission_result(frm, result, allow_blocker_retry, files) {
	const created = cint(result.created);
	const skipped = result.skipped || [];
	const blocked = result.blocked || [];
	const errors = result.errors || [];

	const created_list = (result.rows || [])
		.map((row) => __('{0} -> {1}', [row.case_no, row.action]))
		.join('<br>');

	const skipped_list = skipped.map((row) => __('{0} - {1}', [row.case_no, row.reason])).join('<br>');
	const blocked_list = blocked
		.map((row) =>
			__('{0} - blocked by {1} ({2})', [
				row.case_no,
				row.blocking_admission,
				row.blocking_status,
			])
		)
		.join('<br>');
	const error_list = errors.map((row) => __('{0} - {1}', [row.case_no, row.error])).join('<br>');

	frappe.msgprint({
		title: __('Oracle -> ERPNext: IP Admission'),
		indicator: errors.length || blocked.length ? 'orange' : 'green',
		message: [
			__('Created: {0}', [created]),
			blocked.length ? __('Blocked: {0}', [blocked.length]) : '',
			skipped.length ? __('Skipped: {0}', [skipped.length]) : '',
			errors.length ? __('Errors: {0}', [errors.length]) : '',
			created_list ? `<hr><b>${__('Created')}</b><br>${created_list}` : '',
			blocked_list ? `<hr><b>${__('Blocked')}</b><br>${blocked_list}` : '',
			skipped_list ? `<hr><b>${__('Skipped')}</b><br>${skipped_list}` : '',
			error_list ? `<hr><b>${__('Errors')}</b><br>${error_list}` : '',
		]
			.filter(Boolean)
			.join('<br>'),
	});

	if (created && typeof cur_list !== 'undefined' && cur_list && cur_list.refresh) {
		cur_list.refresh();
	}

	if (blocked.length && allow_blocker_retry !== false) {
		prompt_resolve_oracle_blockers(frm, blocked, files);
	}
}

function prompt_resolve_oracle_blockers(frm, blocked, files) {
	frappe.confirm(
		__(
			'{0} admission(s) are blocked by an ERPNext admission that Oracle already shows as discharged.<br><br>Refresh those blocking admissions from Oracle and import again?',
			[blocked.length]
		),
		() => {
			frappe.dom.freeze(__('Refreshing blocking admissions from Oracle…'));
			frappe.call({
				method: 'healthcare.api.oracle_sync.import_ip_admissions',
				args: files
					? { dry_run: 0, resolve_blockers: 1, files: JSON.stringify(files) }
					: { dry_run: 0, resolve_blockers: 1 },
				callback: (r) => {
					frappe.dom.unfreeze();
					const message = r.message || {};
					if (message.queued) {
						track_oracle_ip_admission_import(frm, message.total || blocked.length);
						return;
					}
					show_oracle_ip_admission_result(frm, message.result || {}, false, files);
				},
				error: () => {
					frappe.dom.unfreeze();
				},
			});
		}
	);
}

function track_oracle_ip_admission_import(frm, total) {
	let polls = 0;
	const progress_title = __('Importing from Oracle');
	frappe.show_progress(progress_title, 0, total || 1);

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.oracle_sync.get_import_status',
			args: { job_key: 'ip_admission' },
			callback: (r) => {
				const status = r.message || {};
				frappe.show_progress(progress_title, cint(status.processed) || 0, total || 1);
				if (status.state === 'finished') {
					clearInterval(timer);
					frappe.hide_progress();
					show_oracle_ip_admission_result(frm, status.result || {});
				} else if (polls >= ORACLE_SYNC_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The import is still running in the background. Re-open the comparison in a few minutes.'
						)
					);
				}
			},
			error: () => {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}


/**
 * OP Visit: Oracle VISIT_00_01 -> Patient Visit.
 *
 * Compares VISIT_NUM with Patient Visit.case_no. When the visit number differs,
 * the same patient, encounter date and visit type still count as the same visit.
 * Only visits that exist in Oracle and are missing in ERPNext are created.
 * Visits that exist only in ERPNext are left alone (staff-created / newer data).
 */
function open_oracle_op_visit(frm) {
	ask_oracle_source({
		title: __('Oracle -> ERPNext: OP Visit'),
		entity: 'op_visit',
		intro: `<p class="text-muted small">${__(
			'Compares Oracle VISIT_00_01 with Patient Visit and creates only the visits that exist in Oracle and are missing in ERPNext. A different visit number still counts as the same visit when the patient, date and visit type match — visits opened in ERPNext after the 2 July import often have a new case number. Visits that exist only in ERPNext are left untouched; patients that do not exist yet are created as minimal Patient records.'
		)}</p>`,
		on_direct: () => run_oracle_op_visit_comparison(frm),
		on_excel: (files) => run_oracle_op_visit_comparison(frm, files),
	});
}

function run_oracle_op_visit_comparison(frm, files) {
	frappe.dom.freeze(
		files
			? __('Comparing the uploaded VISIT_00_01 export with Patient Visit…')
			: __('Comparing Oracle VISIT_00_01 with Patient Visit…')
	);
	frappe.call({
		method: 'healthcare.api.oracle_sync.compare_op_visits',
		args: files ? { files: JSON.stringify(files) } : {},
		callback: (r) => {
			frappe.dom.unfreeze();
			if (!r.message) {
				return;
			}
			show_oracle_op_visit_report(frm, r.message, files);
		},
		error: () => {
			frappe.dom.unfreeze();
		},
	});
}

function oracle_op_visit_missing_table_html(data) {
	const rows = data.missing || [];
	if (!rows.length) {
		return `<div class="alert alert-success">${__(
			'Nothing is missing: ERPNext already has every Oracle visit.'
		)}</div>`;
	}

	const head = [
		__('Visit No'),
		__('Patient'),
		__('Patient Name'),
		__('Encounter Date'),
		__('Visit Type'),
		__('Doctor'),
		__('Branch'),
	];

	const body = rows
		.map(
			(row) => `<tr>
				<td>${oracle_sync_escape(row.case_no)}</td>
				<td>${oracle_sync_escape(row.patient)}</td>
				<td>${oracle_sync_escape(row.patient_name)}${
					row.patient_exists
						? ''
						: ` <span class="indicator-pill orange">${__('will create patient')}</span>`
				}</td>
				<td>${oracle_sync_escape(row.encounter_date)}</td>
				<td>${oracle_sync_escape(row.visit_type)}</td>
				<td>${oracle_sync_escape(row.doctor)}</td>
				<td>${oracle_sync_escape(row.branch)}</td>
			</tr>`
		)
		.join('');

	const footer = data.sample_limited
		? `<div class="text-muted small" style="margin-top:6px">${__(
				'Showing the first {0} of {1} missing rows.',
				[rows.length, data.missing_count]
		  )}</div>`
		: '';

	return `<table class="table table-bordered table-condensed">
		<thead><tr>${head.map((label) => `<th>${oracle_sync_escape(label)}</th>`).join('')}</tr></thead>
		<tbody>${body}</tbody>
	</table>${footer}`;
}

function show_oracle_op_visit_report(frm, data, files) {
	const has_missing = cint(data.missing_count) > 0;

	const dialog = new frappe.ui.Dialog({
		title: __('Oracle -> ERPNext: OP Visit'),
		size: 'extra-large',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'help',
				options:
					'<p class="text-muted small">'
					+ __(
						'Compares Oracle VISIT_00_01 with Patient Visit. Only visits that exist in Oracle and are missing in ERPNext will be created. A visit already in ERPNext for the same patient, date and visit type is not imported again, even when the case number differs. Visits that exist only in ERPNext are left untouched.'
					)
					+ '</p>',
			},
			{ fieldtype: 'HTML', fieldname: 'report_html' },
		],
		primary_action_label: has_missing
			? __('Import {0} Missing', [data.missing_count])
			: __('Close'),
		primary_action() {
			if (!has_missing) {
				dialog.hide();
				return;
			}
			confirm_oracle_op_visit_import(frm, dialog, data, files);
		},
	});

	dialog.fields_dict.report_html.$wrapper.html(
		oracle_sync_summary_html(data) + (has_missing ? oracle_op_visit_missing_table_html(data) : '')
	);
	dialog.show();
}

function confirm_oracle_op_visit_import(frm, dialog, data, files) {
	frappe.confirm(
		__(
			'Import {0} missing visit(s) from {1} into ERPNext?<br><br>Only missing records are created — existing ERPNext visits are never updated or deleted. Patients that do not exist yet are created as minimal Patient records.',
			[data.missing_count, files ? __('the Excel export') : __('Oracle')]
		),
		() => {
			frappe.dom.freeze(__('Importing missing visits from Oracle…'));
			frappe.call({
				method: 'healthcare.api.oracle_sync.import_op_visits',
				args: files ? { dry_run: 0, files: JSON.stringify(files) } : { dry_run: 0 },
				callback: (r) => {
					frappe.dom.unfreeze();
					const message = r.message || {};
					dialog.hide();
					if (message.queued) {
						track_oracle_op_visit_import(frm, message.total || data.missing_count);
						return;
					}
					show_oracle_op_visit_result(frm, message.result || {});
				},
				error: () => {
					frappe.dom.unfreeze();
				},
			});
		}
	);
}

function show_oracle_op_visit_result(frm, result) {
	const created = cint(result.created);
	const updated = cint(result.updated);
	const skipped = result.skipped || [];
	const errors = result.errors || [];

	const created_list = (result.rows || [])
		.map((row) => __('{0} -> {1}', [row.case_no, row.action]))
		.join('<br>');
	const skipped_list = skipped.map((row) => __('{0} - {1}', [row.case_no, row.reason])).join('<br>');
	const error_list = errors.map((row) => __('{0} - {1}', [row.case_no, row.error])).join('<br>');

	frappe.msgprint({
		title: __('Oracle -> ERPNext: OP Visit'),
		indicator: errors.length ? 'orange' : 'green',
		message: [
			__('Created: {0}', [created]),
			updated ? __('Updated: {0}', [updated]) : '',
			skipped.length ? __('Skipped: {0}', [skipped.length]) : '',
			errors.length ? __('Errors: {0}', [errors.length]) : '',
			created_list ? `<hr><b>${__('Created / Updated')}</b><br>${created_list}` : '',
			skipped_list ? `<hr><b>${__('Skipped')}</b><br>${skipped_list}` : '',
			error_list ? `<hr><b>${__('Errors')}</b><br>${error_list}` : '',
		]
			.filter(Boolean)
			.join('<br>'),
	});
}

function track_oracle_op_visit_import(frm, total) {
	let polls = 0;
	const progress_title = __('Importing OP visits from Oracle');
	frappe.show_progress(progress_title, 0, total || 1);

	const timer = setInterval(() => {
		polls += 1;
		frappe.call({
			method: 'healthcare.api.oracle_sync.get_import_status',
			args: { job_key: 'op_visit' },
			callback: (r) => {
				const status = r.message || {};
				frappe.show_progress(progress_title, cint(status.processed) || 0, total || 1);
				if (status.state === 'finished') {
					clearInterval(timer);
					frappe.hide_progress();
					show_oracle_op_visit_result(frm, status.result || {});
				} else if (polls >= ORACLE_SYNC_POLL_LIMIT) {
					clearInterval(timer);
					frappe.hide_progress();
					frappe.msgprint(
						__(
							'The import is still running in the background. Open OP Visit again in a few minutes to see the result.'
						)
					);
				}
			},
			error: () => {
				clearInterval(timer);
				frappe.hide_progress();
			},
		});
	}, ORACLE_SYNC_POLL_INTERVAL);
}

