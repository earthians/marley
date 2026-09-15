# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

from frappe.tests import UnitTestCase

from healthcare.healthcare.lab_test_result_rules import evaluate_formula

EXTRA_TEST_RECORD_DEPENDENCIES = []
IGNORE_TEST_RECORD_DEPENDENCIES = []


class TestLabTestResultRuleFormulas(UnitTestCase):
	def test_simple_subtraction_formula(self):
		values = {"TOTAL PROTEIN": 7.0, "Albumin": 4.0}
		result = evaluate_formula("TOTAL PROTEIN - Albumin", values)
		self.assertEqual(result, 3.0)

	def test_ldl_style_formula(self):
		values = {
			"T.Cholesterol": 200.0,
			"HDL-Cholesterol": 50.0,
			"Triglycerides": 100.0,
		}
		result = evaluate_formula(
			"T.Cholesterol - HDL-Cholesterol - (Triglycerides / 5)", values
		)
		self.assertEqual(result, 130.0)

	def test_egfr_style_formula_with_slash_after_operand(self):
		values = {"S.creatinine": 1.0}
		patient_context = {"@Age": 40.0, "@Kappa": 0.9, "@Alpha": -0.302}
		formula = (
			"142 * min(S.creatinine/@Kappa, 1)**@Alpha * max(S.creatinine/@Kappa, 1)**(-1.200) * (0.9938)**@Age"
		)
		result = evaluate_formula(formula, values, patient_context=patient_context)
		self.assertIsNotNone(result)
		self.assertAlmostEqual(result, 97.6, delta=0.5)

	def test_egfr_female_example(self):
		values = {"Scr": 1.2}
		patient_context = {"@Age": 50.0, "@Kappa": 0.7, "@Alpha": -0.241}
		formula = (
			"142 * min(Scr/@Kappa, 1)**@Alpha * max(Scr/@Kappa, 1)**(-1.200) * (0.9938)**@Age"
		)
		result = evaluate_formula(formula, values, patient_context=patient_context)
		self.assertIsNotNone(result)
		self.assertGreater(result, 50)
		self.assertLess(result, 120)

	def test_homa_ir_unicode_division(self):
		"""HOMA-IR style formula often uses ÷ pasted from Excel/Word."""
		values = {
			"Insulin (Fasting)": 12.0,
			"Glucose (FBS )": 5.0,
		}
		result = evaluate_formula(
			"Insulin (Fasting) * Glucose (FBS ) ÷ 405",
			values,
		)
		self.assertIsNotNone(result)
		self.assertAlmostEqual(result, 12.0 * 5.0 / 405.0, places=6)

	def test_homa_ir_whitespace_mismatch(self):
		"""Result labels may omit the odd trailing space inside parentheses."""
		values = {
			"Insulin (Fasting)": 12.0,
			"Glucose (FBS)": 5.0,
		}
		result = evaluate_formula(
			"Insulin (Fasting) * Glucose (FBS ) / 405",
			values,
		)
		self.assertIsNotNone(result)
		self.assertAlmostEqual(result, 12.0 * 5.0 / 405.0, places=6)
