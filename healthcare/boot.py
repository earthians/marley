def narrow_shared_module_sidebar_workspaces(bootinfo):
	"""Scope each Healthcare sidebar's `workspaces` to only the workspaces its own rows link to.

	Frappe's `resolve_sidebar` attributes every workspace of a module to every sidebar
	(`Sidebar` document) that module owns, on the assumption a module normally ships exactly
	one sidebar. Healthcare ships several sidebars under its one module (Diagnostics,
	Inpatient, Insurance, ...), so without this every one of them claims every workspace, and
	the desk's workspace-route resolver (`module_for_workspace` in sidebar.js) picks whichever
	sidebar it finds first - the wrong icon highlights, and the URL gets prefixed with the
	wrong shell.

	Scoped to the Healthcare module only, so sidebars belonging to other apps/modules are
	never touched by this.
	"""
	sidebars = bootinfo.get("module_sidebars") or {}
	healthcare_sidebars = [sidebar for sidebar in sidebars.values() if sidebar.get("module") == "Healthcare"]

	if len(healthcare_sidebars) <= 1:
		return

	for sidebar in healthcare_sidebars:
		own_workspaces = [
			item.get("link_to")
			for item in sidebar.get("items") or []
			if item.get("link_type") == "Workspace" and item.get("link_to")
		]
		if own_workspaces:
			sidebar["workspaces"] = own_workspaces
