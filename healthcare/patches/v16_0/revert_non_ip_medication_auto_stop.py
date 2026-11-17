import frappe

from healthcare.api.medication_auto_stop import AUTO_STOP_REASON


def execute():
	"""Undo auto-stops that ran on OP/visit or non-new-system prescriptions.

	The first medication end-date job only excluded ``legacy``. It should have
	been limited to new-system Inpatient Admission medicines. Restore lines
	that still carry the automatic reason and are not IP + new_system.
	"""
	names = frappe.db.sql(
		"""
		SELECT e.name
		FROM `tabInpatient Medication Order Entry` e
		INNER JOIN `tabPatient Medication Order` p ON p.name = e.parent
		WHERE e.parenttype = 'Patient Medication Order'
		  AND e.reason_stopped = %s
		  AND (
			IFNULL(p.new_system, 0) = 0
			OR IFNULL(p.legacy, 0) = 1
			OR IFNULL(p.care_context, '') != 'Inpatient Admission'
		  )
		""",
		(AUTO_STOP_REASON,),
		pluck=True,
	)
	if not names:
		return

	chunk = 500
	for i in range(0, len(names), chunk):
		batch = names[i : i + chunk]
		frappe.db.sql(
			"""
			UPDATE `tabInpatient Medication Order Entry`
			SET
				stopped = 0,
				medication_status = '',
				reason_stopped = NULL,
				stopped_date = NULL,
				stop_by = NULL,
				stoped_by = NULL,
				stopped_by_name = NULL
			WHERE name IN ({})
			""".format(",".join(["%s"] * len(batch))),
			tuple(batch),
		)
		frappe.db.sql(
			"""
			DELETE FROM `tabMedication Status Log`
			WHERE reason = %s
			  AND medication_entry IN ({})
			""".format(",".join(["%s"] * len(batch))),
			(AUTO_STOP_REASON, *batch),
		)

	frappe.db.commit()
