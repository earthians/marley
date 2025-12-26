Migration helper: create_imaging_doctypes
======================================

Purpose
-------
This helper creates the lightweight custom DocTypes used by the Imaging Orders feature when
executed inside a Frappe/Bench environment.

How to run (inside a Frappe bench)
---------------------------------
Run the script with Bench's `execute` command:

```bash
bench execute healthcare.patches.create_imaging_doctypes.apply
```

Expected output
---------------
The script will print which DocTypes were created or skipped if they already exist:

```
Created DocType: Imaging Order
Created DocType: Radiology Procedure
Created DocType: Procedure Step
Created DocType: Radiology Procedure Template
```

Creating a sample `Radiology Procedure Template` record (bench)
-------------------------------------------------------------
You can create a record from the fixture with a small Python snippet via `bench execute`:

```bash
bench execute --kwargs '{"path": "healthcare/fixtures/radiology_procedure_template/sample_chest_ct.json"}' "import json\nfrom frappe import get_doc\nfrom pathlib import Path\npath=kwargs.get('path')\nif path:\n  data=json.loads(Path(path).read_text())\n  doc=get_doc({'doctype': 'Radiology Procedure Template', **data})\n  doc.insert()\n  print('Inserted template:', doc.name)"
```

Notes for non-bench / local development
--------------------------------------
- If `frappe` is not importable the patch prints a short message and exits. The code is
  intentionally safe to include in the repo without a running bench.
- Fixtures are in `healthcare/fixtures/radiology_procedure_template/`.
- DocType JSON lives at `healthcare/doctype/radiology_procedure_template/radiology_procedure_template.json`.

Troubleshooting
---------------
- If a DocType already exists the helper skips it and prints a message.
- Use Frappe's UI (Developer > DocType) to inspect the created DocTypes if needed.
