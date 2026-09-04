# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils.nestedset import get_ancestors_of

from healthcare.tests.utils import HealthcareTestSuite


class TestMedicationClass(HealthcareTestSuite):
	def test_ancestors_resolve_through_the_tree(self):
		root = create_medication_class("_Test Anticoagulants", is_group=1)
		middle = create_medication_class("_Test Vitamin K Antagonists", is_group=1, parent=root.name)
		leaf = create_medication_class("_Test Coumarins", parent=middle.name)

		self.assertEqual(set(get_ancestors_of("Medication Class", leaf.name)), {root.name, middle.name})

	def test_parent_must_be_a_group(self):
		leaf = create_medication_class("_Test Loop Diuretics")

		self.assertRaises(
			frappe.ValidationError, create_medication_class, "_Test Furosemides", parent=leaf.name
		)

	def test_group_with_children_cannot_become_a_leaf(self):
		group = create_medication_class("_Test NSAIDs", is_group=1)
		create_medication_class("_Test Propionic Acid Derivatives", parent=group.name)

		group.is_group = 0
		self.assertRaises(frappe.ValidationError, group.save)


def create_medication_class(medication_class, is_group=0, parent=None):
	return frappe.get_doc(
		{
			"doctype": "Medication Class",
			"medication_class": medication_class,
			"is_group": is_group,
			"parent_medication_class": parent,
		}
	).insert()
