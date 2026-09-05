# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe

from healthcare.healthcare.doctype.medication.test_medication import (
	create_classed_medication as create_medication,
)
from healthcare.healthcare.doctype.medication_alert_log.medication_alert_log import (
	check,
	get_allergy_flagged,
)
from healthcare.tests.utils import HealthcareTestSuite

PATIENT = "_Test Patient"


class MedicationSafetyCase(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		# frappe rolls back once the class finishes, not between tests, and the site may
		# carry sample rules, so each test starts from a table it fully controls
		frappe.db.delete("Medication Interaction")
		frappe.db.delete("Patient Allergy", {"patient": PATIENT})
		frappe.db.delete("Medication Alert Log", {"patient": PATIENT})
		set_actions()
		self.amoxicillin = create_medication("_Test Amoxicillin", "Amoxicillin")
		self.warfarin = create_medication("_Test Warfarin", "Warfarin")
		self.ibuprofen = create_medication("_Test Ibuprofen", "Ibuprofen")


class TestAllergyAlerts(MedicationSafetyCase):
	def test_an_allergy_fires_through_an_ancestor_class(self):
		record_allergy("_Test Penicillin Allergy", severity="Severe")

		alerts = check(PATIENT, [self.amoxicillin])

		self.assertEqual(len(alerts), 1)
		self.assertEqual(alerts[0].kind, "Allergy")
		self.assertEqual(alerts[0].severity, "Contraindicated")
		self.assertEqual(alerts[0].action, "Block")

	def test_allergy_severity_follows_the_configured_actions(self):
		record_allergy("_Test Penicillin Allergy", severity="Mild")

		self.assertEqual(check(PATIENT, [self.amoxicillin])[0].severity, "Minor")

	def test_an_inactive_allergy_is_ignored(self):
		record_allergy("_Test Dormant Allergy", status="Inactive")

		self.assertEqual(check(PATIENT, [self.amoxicillin]), [])

	def test_an_allergen_without_a_substance_never_fires(self):
		record_allergy("_Test Peanut Allergen", substance=None, category="Food")

		self.assertEqual(check(PATIENT, [self.amoxicillin]), [])

	def test_only_the_allergic_medication_is_flagged_in_search(self):
		record_allergy("_Test Penicillin Allergy")

		self.assertEqual(get_allergy_flagged(PATIENT, [self.amoxicillin, self.warfarin]), {self.amoxicillin})


class TestInteractionAlerts(MedicationSafetyCase):
	def test_an_interaction_fires_between_two_ancestor_classes(self):
		create_interaction("Non-Steroidal Anti-Inflammatory Drugs", "Vitamin K Antagonists", "Major")

		alerts = check(PATIENT, [self.ibuprofen, self.warfarin])

		self.assertEqual(len(alerts), 1)
		self.assertEqual(alerts[0].action, "Warn")

	def test_the_most_severe_rule_wins_for_a_pair(self):
		create_interaction("Non-Steroidal Anti-Inflammatory Drugs", "Vitamin K Antagonists", "Minor")
		create_interaction("Ibuprofen", "Warfarin", "Contraindicated")

		alerts = check(PATIENT, [self.ibuprofen, self.warfarin])

		self.assertEqual(len(alerts), 1)
		self.assertEqual(alerts[0].severity, "Contraindicated")

	def test_a_single_medication_raises_no_interaction(self):
		create_interaction("Non-Steroidal Anti-Inflammatory Drugs", "Vitamin K Antagonists", "Major")

		self.assertEqual(check(PATIENT, [self.ibuprofen]), [])

	def test_a_disabled_rule_is_ignored(self):
		interaction = create_interaction("Ibuprofen", "Warfarin", "Major")
		frappe.db.set_value("Medication Interaction", interaction, "disabled", 1)

		self.assertEqual(check(PATIENT, [self.ibuprofen, self.warfarin]), [])


class TestAlertActions(MedicationSafetyCase):
	def test_nothing_fires_while_the_feature_is_disabled(self):
		set_actions(enabled=0)
		create_interaction("Ibuprofen", "Warfarin", "Contraindicated")

		self.assertEqual(check(PATIENT, [self.ibuprofen, self.warfarin]), [])

	def test_a_blocked_alert_refuses_the_order(self):
		create_interaction("Ibuprofen", "Warfarin", "Contraindicated")
		encounter = build_encounter([self.ibuprofen, self.warfarin])

		self.assertRaises(frappe.ValidationError, encounter.insert)

	def test_a_warned_alert_lets_the_order_through(self):
		create_interaction("Ibuprofen", "Warfarin", "Major")

		self.assertIsNotNone(build_encounter([self.ibuprofen, self.warfarin]).insert().name)

	def test_a_site_can_block_on_a_minor_interaction(self):
		save_actions("Block", "Block", "Block")
		create_interaction("Ibuprofen", "Warfarin", "Minor")
		encounter = build_encounter([self.ibuprofen, self.warfarin])

		self.assertRaises(frappe.ValidationError, encounter.insert)

	def test_a_site_can_downgrade_a_contraindication_to_a_notice(self):
		save_actions("Notify", "Notify", "Notify")
		create_interaction("Ibuprofen", "Warfarin", "Contraindicated")

		self.assertIsNotNone(build_encounter([self.ibuprofen, self.warfarin]).insert().name)


class TestAlertLogging(MedicationSafetyCase):
	def test_a_contraindicated_alert_is_logged(self):
		save_actions("Warn", "Warn", "Notify")
		create_interaction("Ibuprofen", "Warfarin", "Contraindicated")
		encounter = build_encounter([self.ibuprofen, self.warfarin]).insert()

		logged = frappe.get_all(
			"Medication Alert Log",
			filters={"reference_name": encounter.name},
			fields=["severity", "action", "kind"],
		)
		self.assertEqual(len(logged), 1)
		self.assertEqual(logged[0].severity, "Contraindicated")
		self.assertEqual(logged[0].action, "Warn")

	def test_a_major_alert_is_not_logged_by_default(self):
		create_interaction("Ibuprofen", "Warfarin", "Major")
		encounter = build_encounter([self.ibuprofen, self.warfarin]).insert()

		self.assertFalse(frappe.db.exists("Medication Alert Log", {"reference_name": encounter.name}))

	def test_lowering_the_recording_threshold_logs_a_major_alert(self):
		set_actions(record_from="Major")
		create_interaction("Ibuprofen", "Warfarin", "Major")
		encounter = build_encounter([self.ibuprofen, self.warfarin]).insert()

		self.assertTrue(frappe.db.exists("Medication Alert Log", {"reference_name": encounter.name}))

	def test_nothing_is_logged_without_an_alert(self):
		encounter = build_encounter([self.amoxicillin]).insert()

		self.assertFalse(frappe.db.exists("Medication Alert Log", {"reference_name": encounter.name}))


class TestAlertSettings(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		set_actions()

	def test_the_defaults_escalate(self):
		self.assertIsNotNone(save_actions("Block", "Warn", "Notify"))

	def test_equal_actions_across_severities_are_allowed(self):
		self.assertIsNotNone(save_actions("Warn", "Warn", "Warn"))

	def test_a_minor_may_not_act_more_strongly_than_a_contraindication(self):
		self.assertRaises(frappe.ValidationError, save_actions, "Notify", "Notify", "Block")

	def test_a_blank_action_is_refused_while_enabled(self):
		self.assertRaises(frappe.ValidationError, save_actions, None, "Warn", "Notify")

	def test_a_blank_action_is_allowed_while_disabled(self):
		settings = frappe.get_doc("Healthcare Settings")
		settings.enable_medication_alerts = 0
		settings.contraindicated_alert_action = None

		self.assertIsNotNone(settings.save())


def set_actions(enabled=1, record_from="Contraindicated"):
	"""Restore every alert setting, so one test cannot configure the next one"""
	settings = {
		"enable_medication_alerts": enabled,
		"contraindicated_alert_action": "Block",
		"major_alert_action": "Warn",
		"minor_alert_action": "Notify",
		"record_alerts_from": record_from,
	}
	for fieldname, value in settings.items():
		frappe.db.set_single_value("Healthcare Settings", fieldname, value)


def save_actions(contraindicated, major, minor):
	"""Go through the document, so a test only ever configures a reachable state"""
	settings = frappe.get_doc("Healthcare Settings")
	settings.enable_medication_alerts = 1
	settings.contraindicated_alert_action = contraindicated
	settings.major_alert_action = major
	settings.minor_alert_action = minor

	return settings.save()


def record_allergy(
	allergy_name, substance="Penicillins", category="Medication", status="Active", severity="Moderate"
):
	allergen = (
		frappe.db.exists("Allergy", allergy_name)
		or frappe.get_doc(
			{
				"doctype": "Allergy",
				"allergy_name": allergy_name,
				"category": category,
				"substance_type": "Medication Class" if substance else None,
				"substance": substance,
			}
		)
		.insert()
		.name
	)

	return frappe.get_doc(
		{
			"doctype": "Patient Allergy",
			"patient": PATIENT,
			"allergy": allergen,
			"status": status,
			"severity": severity,
		}
	).insert()


def create_interaction(first, second, severity):
	return (
		frappe.get_doc(
			{
				"doctype": "Medication Interaction",
				"interactant_a_type": "Medication Class",
				"interactant_a": first,
				"interactant_b_type": "Medication Class",
				"interactant_b": second,
				"severity": severity,
				"advice": "Sample advice",
			}
		)
		.insert()
		.name
	)


def build_encounter(medications):
	encounter = frappe.new_doc("Patient Encounter")
	encounter.patient = PATIENT
	encounter.practitioner = frappe.db.get_value("Healthcare Practitioner", {}, "name")
	encounter.encounter_date = frappe.utils.nowdate()
	encounter.company = "_Test Company"
	encounter.appointment_type = frappe.db.get_value("Appointment Type", {}, "name")

	for medication in medications:
		encounter.append("drug_prescription", drug_row(medication))

	return encounter


def drug_row(medication):
	return {
		"medication": medication,
		"drug_code": frappe.db.get_value("Item", {"item_name": "Paracetamol"}) or "Paracetamol",
		"dosage": frappe.db.get_value("Prescription Dosage", {}, "name"),
		"period": frappe.db.get_value("Prescription Duration", {}, "name"),
	}


class TestAlertLoggingDisabled(MedicationSafetyCase):
	def test_a_blank_recording_setting_logs_nothing(self):
		set_actions(record_from=None)
		create_interaction("Ibuprofen", "Warfarin", "Contraindicated")
		save_actions("Warn", "Warn", "Notify")
		encounter = build_encounter([self.ibuprofen, self.warfarin]).insert()

		self.assertFalse(frappe.db.exists("Medication Alert Log", {"reference_name": encounter.name}))


class TestAlertLogIsReadOnly(MedicationSafetyCase):
	def setUp(self):
		super().setUp()
		create_interaction("Ibuprofen", "Warfarin", "Contraindicated")
		save_actions("Warn", "Warn", "Notify")
		encounter = build_encounter([self.ibuprofen, self.warfarin]).insert()
		self.log = frappe.get_last_doc("Medication Alert Log", {"reference_name": encounter.name})

	def test_a_log_cannot_be_changed(self):
		self.log.severity = "Minor"

		self.assertRaises(frappe.ValidationError, self.log.save, ignore_permissions=True)

	def test_a_log_cannot_be_deleted(self):
		self.assertRaises(
			frappe.ValidationError, frappe.delete_doc, self.log.doctype, self.log.name, force=True
		)

	def test_no_role_may_write_to_it(self):
		writable = [
			perm.role
			for perm in frappe.get_meta("Medication Alert Log").permissions
			if perm.write or perm.delete or perm.create
		]

		self.assertEqual(writable, [])
