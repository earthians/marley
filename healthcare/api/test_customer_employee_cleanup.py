# Copyright (c) 2026, Healthcare contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from healthcare.api.customer_employee_cleanup import (
	EMPLOYEE_FIELD,
	EMPLOYEE_NAME_FIELD,
	NAME_MISMATCH,
	NAMES_MATCH,
	names_look_same,
	normalize_name,
	unlink_mismatched_employee_on_validate,
)


class _FakeMeta:
	"""Only the fields used by the Customer validate hook exist here."""

	def has_field(self, fieldname):
		return fieldname in ("customer_name", EMPLOYEE_FIELD, EMPLOYEE_NAME_FIELD)


class _FakeCustomer:
	"""Minimal Document stand-in so the validate hook can be tested without a DB."""

	def __init__(self, **values):
		self.meta = _FakeMeta()
		self.flags = frappe._dict(in_import=0, in_patch=0, in_migrate=0)
		self.__dict__.update(values)

	def get(self, fieldname):
		return self.__dict__.get(fieldname)

	def set(self, fieldname, value):
		self.__dict__[fieldname] = value


class TestEmployeeNameComparison(IntegrationTestCase):
	def test_normalize_ignores_case_accents_and_punctuation(self):
		self.assertEqual(normalize_name("  Robert   TYLER-Burns "), "robert tyler burns")
		self.assertEqual(normalize_name("José  AL-Hassan"), "jose al hassan")

	def test_normalize_keeps_arabic_letters(self):
		self.assertEqual(normalize_name("محمد  مصطفى"), "محمد مصطفى")

	def test_same_name_matches(self):
		self.assertTrue(names_look_same("Robert Tyler Burns", "ROBERT TYLER BURNS"))

	def test_extra_words_in_either_name_still_match(self):
		self.assertTrue(
			names_look_same("AHMED SALEH IBRAHIM AL OBAILANI", "Ahmed Saleh Al Obailani")
		)
		self.assertTrue(
			names_look_same("Ahmed Saleh", "AHMED SALEH IBRAHIM AL OBAILANI")
		)

	def test_different_people_do_not_match(self):
		self.assertFalse(
			names_look_same("ROBERT TYLER BURNS", "MOHAMED MOUSTAFA AHMED KHALIL")
		)
		self.assertFalse(names_look_same("UMER BIN SAJJAD", "ABDUL RAHMAN"))

	def test_missing_names_never_match(self):
		self.assertFalse(names_look_same("", "ROBERT TYLER BURNS"))
		self.assertFalse(names_look_same("ROBERT TYLER BURNS", None))


class TestUnlinkOnValidate(IntegrationTestCase):
	def test_mismatched_employee_is_cleared_on_save(self):
		doc = _FakeCustomer(
			customer_name="ROBERT TYLER BURNS",
			**{
				EMPLOYEE_FIELD: "EMP-073",
				EMPLOYEE_NAME_FIELD: "MOHAMED MOUSTAFA AHMED KHALIL",
			},
		)
		doc.flags.in_import = 1

		unlink_mismatched_employee_on_validate(doc)

		self.assertIsNone(doc.get(EMPLOYEE_FIELD))
		self.assertIsNone(doc.get(EMPLOYEE_NAME_FIELD))

	def test_matching_employee_is_kept(self):
		doc = _FakeCustomer(
			customer_name="Ahmed Saleh Al Obailani",
			**{
				EMPLOYEE_FIELD: "EMP-010",
				EMPLOYEE_NAME_FIELD: "AHMED SALEH IBRAHIM AL OBAILANI",
			},
		)

		unlink_mismatched_employee_on_validate(doc)

		self.assertEqual(doc.get(EMPLOYEE_FIELD), "EMP-010")

	def test_customer_without_employee_is_untouched(self):
		doc = _FakeCustomer(customer_name="ROBERT TYLER BURNS")
		doc.flags.in_import = 1

		unlink_mismatched_employee_on_validate(doc)

		self.assertIsNone(doc.get(EMPLOYEE_FIELD))

	def test_reasons_are_exposed(self):
		self.assertNotEqual(NAME_MISMATCH, NAMES_MATCH)
