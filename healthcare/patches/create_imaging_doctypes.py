"""Migration helper: register new DocTypes when executed inside Frappe bench.

Run with:
  bench execute healthcare.patches.create_imaging_doctypes.apply

This script is safe to include in the repository; if executed outside a Frappe
context it will print instructions instead of failing.
"""
def apply():
    try:
        import frappe
    except Exception:
        print("frappe module not available. Run this script inside a bench with: bench execute healthcare.patches.create_imaging_doctypes.apply")
        return

    from frappe.model.document import Document

    doctypes = [
        {
            "name": "Imaging Order",
            "module": "Healthcare",
            "custom": 1,
            "fields": [
                {"fieldname": "patient_id", "label": "Patient ID", "fieldtype": "Data", "reqd": 1},
                {"fieldname": "ordering_actor_id", "label": "Ordering Actor ID", "fieldtype": "Data"},
                {"fieldname": "procedures", "label": "Procedures", "fieldtype": "Table", "options": "Radiology Procedure"},
                {"fieldname": "created_at", "label": "Created At", "fieldtype": "Datetime"},
            ],
        },
        {
            "name": "Radiology Procedure",
            "module": "Healthcare",
            "custom": 1,
            "fields": [
                {"fieldname": "code", "label": "Code", "fieldtype": "Data"},
                {"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
                {"fieldname": "priority", "label": "Priority", "fieldtype": "Select", "options": "routine\nurgent\nstat"},
                {"fieldname": "steps", "label": "Steps", "fieldtype": "Table", "options": "Procedure Step"},
            ],
        },
        {
            "name": "Procedure Step",
            "module": "Healthcare",
            "custom": 1,
            "fields": [
                {"fieldname": "title", "label": "Title", "fieldtype": "Data"},
                {"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
                {"fieldname": "scheduled_datetime", "label": "Scheduled DateTime", "fieldtype": "Datetime"},
                {"fieldname": "assigned_resource_id", "label": "Assigned Resource ID", "fieldtype": "Data"},
                {"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "pending\nscheduled\nin-progress\nperformed\ncancelled"},
            ],
        },
        {
            "name": "Radiology Procedure Template",
            "module": "Healthcare",
            "custom": 1,
            "fields": [
                {"fieldname": "template", "label": "Template Name", "fieldtype": "Data", "reqd": 1, "unique": 1},
                {"fieldname": "modality", "label": "Modality", "fieldtype": "Select", "options": "XRAY\nCT\nMRI\nULTRASOUND\nPET"},
                {"fieldname": "body_part", "label": "Body Part", "fieldtype": "Data"},
                {"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
                {"fieldname": "steps", "label": "Procedure Steps", "fieldtype": "Table", "options": "Procedure Step"},
                {"fieldname": "is_billable", "label": "Is Billable", "fieldtype": "Check", "default": "0"},
                {"fieldname": "rate", "label": "Rate", "fieldtype": "Float"},
                {"fieldname": "disabled", "label": "Disabled", "fieldtype": "Check", "default": "0"},
            ],
        },
    ]

    for dt in doctypes:
        existing = frappe.get_all("DocType", filters={"name": dt["name"]})
        if existing:
            print(f"DocType '{dt['name']}' already exists, skipping")
            continue

        doc = frappe.new_doc("DocType")
        doc.name = dt["name"]
        doc.module = dt["module"]
        doc.custom = dt.get("custom", 1)
        doc.fields = []
        for f in dt["fields"]:
            doc.append("fields", f)

        doc.insert()
        doc.save()
        print(f"Created DocType: {dt['name']}")

    # Create a simple Desk Page (Page) for the scheduler if the HTML file exists
    try:
        scheduler_path = frappe.get_pymodule_path('healthcare', 'www', 'scheduler.html')
    except Exception:
        # fallback to relative path inside app
        import os
        scheduler_path = os.path.join(os.path.dirname(__file__), '..', 'www', 'scheduler.html')

    try:
        import os
        if os.path.exists(scheduler_path):
            page_exists = frappe.get_all('Page', filters={'page_name': 'scheduler'})
            if page_exists:
                print('Page "scheduler" already exists, skipping')
            else:
                with open(scheduler_path, 'r', encoding='utf-8') as fh:
                    content = fh.read()
                page = frappe.new_doc('Page')
                page.page_name = 'scheduler'
                page.title = 'Scheduler'
                page.content = content
                page.module = 'Healthcare'
                page.insert()
                page.save()
                print('Created Page: scheduler')
    except Exception as e:
        print('Could not create scheduler page:', e)
