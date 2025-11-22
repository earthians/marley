#!/usr/bin/env python3
"""
Generate minimal doctype stub files (__init__.py and <doctype>.py)
for the frappe_dwf app. Run this from the repository root.

This script will create files only if they do not already exist.
"""
import os

doctype_dirs = [
    "ae_entry",
    "ian_destination",
    "instance_availability_notification",
    "order",
    "performed_procedure_step",
    "prefetch_job",
    "report",
    "requested_procedure",
    "scheduled_procedure_step",
    "sopinstance",
    "unified_procedure_step",
    "worklist_item",
    "worklist_manager_config",
]

base = os.path.join("healthcare", "healthcare", "doctype")

def to_class_name(name: str) -> str:
    parts = name.split("_")
    return "".join(p.capitalize() for p in parts)

def ensure_dir(path: str):
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)

def write_file_if_missing(path: str, contents: str):
    if os.path.exists(path):
        print(f"Skipped (exists): {path}")
        return
    with open(path, "w", encoding="utf-8") as f:
        f.write(contents)
    print(f"Created: {path}")

def main():
    ensure_dir(base)
    for d in doctype_dirs:
        path = os.path.join(base, d)
        ensure_dir(path)
        init_py = os.path.join(path, "__init__.py")
        controller_py = os.path.join(path, f"{d}.py")
        write_file_if_missing(init_py, "# package marker - keep empty\n")
        class_name = to_class_name(d)
        controller_contents = (
            "from frappe.model.document import Document\n\n"
            f"class {class_name}(Document):\n"
            f"    \"\"\"Minimal controller for {class_name} doctype.\"\"\"\n"
            "    pass\n"
        )
        write_file_if_missing(controller_py, controller_contents)

if __name__ == '__main__':
    main()
