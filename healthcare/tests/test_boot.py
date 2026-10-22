# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import unittest

from healthcare.boot import narrow_shared_module_sidebar_workspaces


def sidebar(module, items=None, workspaces=None):
	return {
		"module": module,
		"items": items or [],
		"workspaces": workspaces or [],
	}


def workspace_item(link_to):
	return {"link_type": "Workspace", "link_to": link_to}


class TestNarrowSharedModuleSidebarWorkspaces(unittest.TestCase):
	"""Each Healthcare sidebar should see only the workspaces its own rows link to."""

	def test_two_healthcare_sidebars_get_separate_workspaces(self):
		bootinfo = {
			"module_sidebars": {
				"Diagnostics": sidebar(
					"Healthcare",
					items=[workspace_item("Diagnostics")],
					workspaces=["Diagnostics", "Inpatient", "Insurance"],
				),
				"Inpatient": sidebar(
					"Healthcare",
					items=[workspace_item("Inpatient")],
					workspaces=["Diagnostics", "Inpatient", "Insurance"],
				),
			}
		}

		narrow_shared_module_sidebar_workspaces(bootinfo)

		self.assertEqual(bootinfo["module_sidebars"]["Diagnostics"]["workspaces"], ["Diagnostics"])
		self.assertEqual(bootinfo["module_sidebars"]["Inpatient"]["workspaces"], ["Inpatient"])

	def test_another_module_sharing_the_boot_is_left_untouched(self):
		"""Narrowing triggers on the shared Healthcare module but must never
		touch a sidebar belonging to a different module, even one present
		in the same bootinfo."""
		bootinfo = {
			"module_sidebars": {
				"Diagnostics": sidebar(
					"Healthcare",
					items=[workspace_item("Diagnostics")],
					workspaces=["Diagnostics", "Inpatient"],
				),
				"Inpatient": sidebar(
					"Healthcare", items=[workspace_item("Inpatient")], workspaces=["Diagnostics", "Inpatient"]
				),
				"Other App": sidebar(
					"Other Module", items=[workspace_item("Other Workspace")], workspaces=["Other Workspace"]
				),
			}
		}

		narrow_shared_module_sidebar_workspaces(bootinfo)

		self.assertEqual(bootinfo["module_sidebars"]["Other App"]["workspaces"], ["Other Workspace"])

	def test_a_single_healthcare_sidebar_is_not_narrowed(self):
		"""One module, one sidebar: Frappe's own resolution is already correct,
		so this must be left exactly as it came in."""
		bootinfo = {
			"module_sidebars": {
				"Healthcare": sidebar(
					"Healthcare", items=[workspace_item("Healthcare")], workspaces=["Healthcare", "Setup"]
				),
			}
		}

		narrow_shared_module_sidebar_workspaces(bootinfo)

		self.assertEqual(bootinfo["module_sidebars"]["Healthcare"]["workspaces"], ["Healthcare", "Setup"])

	def test_a_sidebar_with_no_workspace_items_keeps_its_existing_list(self):
		"""A sidebar with no Workspace-type rows has nothing of its own to narrow
		to; it must keep whatever workspaces it already carried rather than being
		wiped to an empty list."""
		bootinfo = {
			"module_sidebars": {
				"Diagnostics": sidebar(
					"Healthcare",
					items=[workspace_item("Diagnostics")],
					workspaces=["Diagnostics", "Inpatient"],
				),
				"Reports Only": sidebar("Healthcare", items=[], workspaces=["Diagnostics", "Inpatient"]),
			}
		}

		narrow_shared_module_sidebar_workspaces(bootinfo)

		self.assertEqual(
			bootinfo["module_sidebars"]["Reports Only"]["workspaces"], ["Diagnostics", "Inpatient"]
		)

	def test_missing_module_sidebars_does_not_raise(self):
		narrow_shared_module_sidebar_workspaces({})

	def test_non_workspace_items_are_ignored(self):
		"""A sidebar item linking to a Report or a Page must not count as a workspace."""
		bootinfo = {
			"module_sidebars": {
				"Diagnostics": sidebar(
					"Healthcare",
					items=[
						workspace_item("Diagnostics"),
						{"link_type": "Report", "link_to": "Diagnostic Report"},
					],
					workspaces=["Diagnostics", "Inpatient"],
				),
				"Inpatient": sidebar(
					"Healthcare", items=[workspace_item("Inpatient")], workspaces=["Diagnostics", "Inpatient"]
				),
			}
		}

		narrow_shared_module_sidebar_workspaces(bootinfo)

		self.assertEqual(bootinfo["module_sidebars"]["Diagnostics"]["workspaces"], ["Diagnostics"])
