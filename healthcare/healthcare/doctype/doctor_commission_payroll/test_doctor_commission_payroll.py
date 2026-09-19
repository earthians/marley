# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

from frappe.tests import IntegrationTestCase

from healthcare.api.doctor_commission import payment_mode_shares
from healthcare.api.doctor_commission_statement import classify_payment_mode


class IntegrationTestDoctorCommissionPayroll(IntegrationTestCase):
	"""Payment-mode split: the mode charge comes off the collection, not the commission."""

	def test_card_charge_is_taken_off_the_collected_amount(self):
		"""1.650% of the 35 collected by card is 0.578, leaving 34.422 net paid."""
		share = payment_mode_shares(
			[{"mode_of_payment": "Credit Card", "percent": 100, "deduction_percent": 1.65}],
			service_amount=35,
			qty=1,
			commission_amount=17.5,
		)[0]
		self.assertEqual(share["deduction_amount"], 0.578)
		self.assertEqual(share["net_service_amount"], 34.422)
		# 50% commission on the net paid amount — already final, no later deduction.
		self.assertEqual(share["net_commission_amount"], 17.211)

	def test_commission_follows_net_paid_amount(self):
		shares = payment_mode_shares(
			[
				{"mode_of_payment": "Credit Card", "percent": 30, "deduction_percent": 1.65},
				{"mode_of_payment": "Cash", "percent": 15, "deduction_percent": 0},
			],
			service_amount=45,
			qty=1,
			commission_amount=9,
		)
		# 30 of 45 by card, less the 1.650% charge, is 29.505 received; 15 in cash, no charge.
		self.assertEqual(
			[
				(share["service_amount"], share["deduction_amount"], share["net_service_amount"])
				for share in shares
			],
			[(30.0, 0.495, 29.505), (15.0, 0.0, 15.0)],
		)
		self.assertEqual(round(sum(share["service_amount"] for share in shares), 2), 45.0)
		self.assertEqual(round(sum(share["net_service_amount"] for share in shares), 3), 44.505)
		self.assertEqual(round(sum(share["commission_amount"] for share in shares), 3), 9.0)
		# The doctor earns on the net paid amounts only.
		self.assertEqual(round(sum(share["net_commission_amount"] for share in shares), 3), 8.901)

	def test_modes_without_deduction_are_unchanged(self):
		shares = payment_mode_shares(
			[{"mode_of_payment": "Cash", "percent": 2}, {"mode_of_payment": "Credit Card", "percent": 1}],
			service_amount=40,
			qty=1,
			commission_amount=8,
		)
		self.assertEqual(
			[(share["service_amount"], share["commission_amount"]) for share in shares],
			[(26.667, 5.333), (13.333, 2.667)],
		)
		self.assertEqual([share["deduction_amount"] for share in shares], [0.0, 0.0])
		self.assertEqual(
			[share["net_service_amount"] for share in shares],
			[share["service_amount"] for share in shares],
		)
		self.assertEqual(
			[share["net_commission_amount"] for share in shares],
			[share["commission_amount"] for share in shares],
		)

	def test_service_without_payment_modes_stays_on_one_row(self):
		shares = payment_mode_shares([], service_amount=100, qty=1, commission_amount=20)
		self.assertEqual(len(shares), 1)
		self.assertIsNone(shares[0]["mode_of_payment"])
		self.assertEqual(shares[0]["net_service_amount"], 100.0)
		self.assertEqual(shares[0]["net_commission_amount"], 20.0)

	def test_money_is_kept_at_three_decimals_for_bhd(self):
		"""Bahraini Dinar is quoted in fils, so splits keep three decimals."""
		shares = payment_mode_shares(
			[{"mode_of_payment": "Cash", "percent": 1}, {"mode_of_payment": "Credit Card", "percent": 1}],
			service_amount=10,
			qty=1,
			commission_amount=3,
		)
		self.assertEqual(
			[(share["service_amount"], share["commission_amount"]) for share in shares],
			[(5.0, 1.5), (5.0, 1.5)],
		)
		odd = payment_mode_shares(
			[{"mode_of_payment": "Cash", "percent": 1}, {"mode_of_payment": "Credit Card", "percent": 1}],
			service_amount=10,
			qty=1,
			commission_amount=5,
		)
		self.assertEqual([share["service_amount"] for share in odd], [5.0, 5.0])
		self.assertEqual([share["commission_amount"] for share in odd], [2.5, 2.5])
		thirds = payment_mode_shares(
			[{"mode_of_payment": "Cash", "percent": 2}, {"mode_of_payment": "Credit Card", "percent": 1}],
			service_amount=1,
			qty=1,
			commission_amount=1,
		)
		self.assertEqual([share["service_amount"] for share in thirds], [0.667, 0.333])

	def test_statement_columns_classify_card_modes(self):
		self.assertEqual(classify_payment_mode("Credit Card"), "Card")
		self.assertEqual(classify_payment_mode("Credit Card Machine - AFS"), "Card")
		self.assertEqual(classify_payment_mode("Cash"), "Cash / Online")
		self.assertEqual(classify_payment_mode("Bank Transfer"), "Cash / Online")
		self.assertEqual(classify_payment_mode("Benefit Pay"), "Cash / Online")
		self.assertEqual(classify_payment_mode(None), "Cash / Online")
