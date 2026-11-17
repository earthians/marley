# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import IntegrationTestCase

from healthcare.api import billing

COMPANY = "Test Company"
RECEIVABLE = "Debtors - TC"
MOP_BANK = "Credit Card Machine - TC"
MOP_CASH = "Main Cash - TC"


BRANCH_RECEIVABLE = "01-02-03-0001 - PATIENT RECEIVABLE - SPH"


def _invoice(**kwargs):
	"""A submitted Sales Invoice stand-in; nothing is written to the database."""
	values = {
		"docstatus": 1,
		"outstanding_amount": 100.0,
		"grand_total": 100.0,
		"company": COMPANY,
		"customer": "PAT-0001",
		"customer_name": "Test Patient",
		"debit_to": BRANCH_RECEIVABLE,
	}
	values.update(kwargs)
	invoice = SimpleNamespace(**values)
	invoice.reload = lambda: None
	return invoice


class TestReceptionPaymentEntryAccounts(IntegrationTestCase):
	"""Reception payments use invoice debit_to + Mode of Payment cash/bank account.

	Company default receivable is only a fallback when there is no invoice debit_to.
	Company Cash/Bank defaults are only a fallback for modes with no mapped account.
	"""

	def _create(self, payment_modes, accounts, invoice_kwargs=None):
		payment_entry = MagicMock()
		payment_entry.name = "PE-0001"
		company = SimpleNamespace(
			default_currency="BHD",
			default_receivable_account=RECEIVABLE,
			default_cash_account="Company Default Cash - TC",
			default_bank_account="Company Default Bank - TC",
		)
		invoice = _invoice(**(invoice_kwargs or {}))
		real_get_doc = frappe.get_doc

		def fake_get_doc(doctype, *args, **kwargs):
			if doctype == "Sales Invoice":
				return invoice
			if doctype == "Company":
				return company
			return real_get_doc(doctype, *args, **kwargs)

		def resolve(company_name, mode, party_account=None):
			paid_from, paid_to = accounts[mode]
			return (party_account or paid_from, paid_to)

		with (
			patch.object(billing.frappe, "get_doc", side_effect=fake_get_doc),
			patch.object(billing.frappe, "new_doc", return_value=payment_entry),
			patch(
				"healthcare.api.payment_entry._resolve_accounts",
				side_effect=resolve,
			) as resolve_accounts,
			patch("healthcare.api.receptionist_shift.stamp_receptionist_shift_on_doc"),
		):
			result = billing.create_payment_entry(
				invoice_name="SINV-0001", payment_modes=payment_modes
			)

		return result, payment_entry, resolve_accounts

	def test_bank_mode_posts_to_mode_of_payment_account(self):
		result, payment_entry, resolve_accounts = self._create(
			[{"mode_of_payment": "Credit Card", "amount": 100}],
			{"Credit Card": (RECEIVABLE, MOP_BANK)},
		)

		self.assertTrue(result.get("success"))
		resolve_accounts.assert_called_once_with(
			COMPANY, "Credit Card", party_account=BRANCH_RECEIVABLE
		)
		self.assertEqual(payment_entry.mode_of_payment, "Credit Card")
		self.assertEqual(payment_entry.paid_from, BRANCH_RECEIVABLE)
		self.assertEqual(payment_entry.paid_to, MOP_BANK)

	def test_uses_invoice_debit_to_not_company_default_receivable(self):
		result, payment_entry, resolve_accounts = self._create(
			[{"mode_of_payment": "Cash", "amount": 100}],
			{"Cash": (RECEIVABLE, MOP_CASH)},
		)
		self.assertTrue(result.get("success"))
		self.assertEqual(
			resolve_accounts.call_args.kwargs.get("party_account")
			or resolve_accounts.call_args[1].get("party_account"),
			BRANCH_RECEIVABLE,
		)
		self.assertEqual(payment_entry.paid_from, BRANCH_RECEIVABLE)
		self.assertNotEqual(payment_entry.paid_from, RECEIVABLE)

	def test_each_mode_resolves_its_own_account(self):
		_, payment_entry, resolve_accounts = self._create(
			[
				{"mode_of_payment": "Credit Card", "amount": 60},
				{"mode_of_payment": "Cash", "amount": 40},
			],
			{
				"Credit Card": (RECEIVABLE, MOP_BANK),
				"Cash": (RECEIVABLE, MOP_CASH),
			},
		)

		self.assertEqual(
			[
				(COMPANY, "Credit Card", BRANCH_RECEIVABLE),
				(COMPANY, "Cash", BRANCH_RECEIVABLE),
			],
			[
				(call.args[0], call.args[1], call.kwargs.get("party_account"))
				for call in resolve_accounts.call_args_list
			],
		)
		# The last submitted entry is the cash leg; it must not fall back to the
		# company default bank/cash account.
		self.assertEqual(payment_entry.paid_to, MOP_CASH)
