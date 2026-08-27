# Quickstart: Website enquiry API

**Feature**: `003-website-enquiry-api`  
**Spec**: [spec.md](./spec.md) · **Contract**: [contracts/website-enquiry.md](./contracts/website-enquiry.md)

## Prerequisites

- Bench site `senlite.localhost`
- Seed: `cd BackEnd && ./env/bin/python ../Helper_codes/Seeding/seed_website_enquiry.py`

## Guest create (no Authorization)

```bash
curl -sS -X POST "http://senlite.localhost:8000/api/method/healthcare.healthcare.api.website_enquiry.create_enquiry" \
  -H "Content-Type: application/json" \
  -H "X-Frappe-Site-Name: senlite.localhost" \
  -d '{"source":"website-contact","lead_name":"Test Visitor","mobile_no":"01000000000","notes":"hello"}'
```

Expect `message.name` like `CRM-LEAD-...` and `source` `website-contact`.

Medical tourism:

```bash
curl -sS -X POST "http://senlite.localhost:8000/api/method/healthcare.healthcare.api.website_enquiry.create_enquiry" \
  -H "Content-Type: application/json" \
  -H "X-Frappe-Site-Name: senlite.localhost" \
  -d '{"source":"website-medical-tourism","lead_name":"GCC Visitor","mobile_no":"+971500000000","country":"United Arab Emirates","condition":"ACL","dates":"October"}'
```

## Validation

Omit `mobile_no`. Expect an error and no new Lead.

## Desk

Open Lead list. Filter or inspect UTM Source **Website Contact** vs **Website Medical Tourism**.
