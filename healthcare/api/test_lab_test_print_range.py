# Copyright (c) 2026, healthcare contributors

import unittest

from healthcare.api.lab_test_print import _break_range_legend, _range_html, _range_text

LEGEND = "Deficiency <10 Insufficiency 10 - 30 Sufficiency 30 – 100 Toxicity >100"
SEROLOGY = "0 - 0.8 Negative: < 0.80 Equivocal: 0.80 - 0.90 Positive : > 0.90"


class TestLabTestPrintRange(unittest.TestCase):
	def test_same_min_max_legend_shown_once_and_broken(self):
		text = _range_text(LEGEND, LEGEND)
		self.assertEqual(
			text,
			"Deficiency <10\nInsufficiency 10 - 30\nSufficiency 30 – 100\nToxicity >100",
		)
		html = _range_html(text)
		self.assertNotIn(LEGEND + " - " + LEGEND, html)
		self.assertEqual(html.count("<br>"), 3)
		self.assertIn("Deficiency &lt;10", html)

	def test_serology_negative_equivocal_positive_broken(self):
		text = _range_text(SEROLOGY, SEROLOGY)
		self.assertEqual(
			text,
			"0 - 0.8\nNegative: < 0.80\nEquivocal: 0.80 - 0.90\nPositive : > 0.90",
		)
		html = _range_html(text)
		self.assertEqual(html.count("<br>"), 3)
		self.assertIn("Equivocal: 0.80 - 0.90", html)

	def test_numeric_pair_unchanged(self):
		self.assertEqual(_range_text(15, 100), "15 - 100")
		self.assertEqual(_range_text("15.0", "100.0"), "15 - 100")

	def test_existing_newlines_preserved(self):
		raw = "Deficiency <10\nInsufficiency 10 - 30"
		self.assertEqual(_break_range_legend(raw), raw)

	def test_legend_bands_split_inside_existing_newlines(self):
		raw = "0 - 0.8\nNegative: < 0.80 Equivocal: 0.80 - 0.90 Positive : > 0.90"
		self.assertEqual(
			_break_range_legend(raw),
			"0 - 0.8\nNegative: < 0.80\nEquivocal: 0.80 - 0.90\nPositive : > 0.90",
		)
