# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from healthcare.setup import create_lab_test_uom, create_vital_sign_observation_templates


def execute():
	create_lab_test_uom()
	create_vital_sign_observation_templates()
