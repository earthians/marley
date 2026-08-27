# Quickstart: Clinic catalog APIs

**Feature**: `002-clinic-catalog-apis`

## Setup

From the bench:

```bash
cd /home/mahmoud-g-m/Frappe-Projetcs/Abuzahraptc_BackEnd/BackEnd
bench --site senlite.localhost migrate
python ../Helper_codes/Seeding/seed_clinic_catalog.py
```

## Calls

```bash
# Doctors (guest — no token required)
curl -sS -X POST http://senlite.localhost:8000/api/method/healthcare.healthcare.api.clinic_catalog.get_doctors \
  -H "Content-Type: application/json" -H "X-Frappe-Site-Name: senlite.localhost" -d '{}'

# Branches / services / payors
curl -sS -X POST http://senlite.localhost:8000/api/method/healthcare.healthcare.api.clinic_catalog.get_branches \
  -H "Content-Type: application/json" -H "X-Frappe-Site-Name: senlite.localhost" -d '{}'
curl -sS -X POST http://senlite.localhost:8000/api/method/healthcare.healthcare.api.clinic_catalog.get_insurance_payors \
  -H "Content-Type: application/json" -H "X-Frappe-Site-Name: senlite.localhost" -d '{}'
```

Expect JSON `message` arrays. Re-run the seed; counts must not double. Disable a Therapy Type in Desk; it must disappear from `get_services`. Clear **Show on Website** on a doctor; they must disappear from `get_doctors`. Add an Insurance Payor with **Show on Website**; it must appear on `get_insurance_payors`.
