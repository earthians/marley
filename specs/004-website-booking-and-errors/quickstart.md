# Quickstart: Website booking write and public errors

**Feature**: `004-website-booking-and-errors`  
**Spec**: [spec.md](./spec.md) · **Contract**: [contracts/website-booking.md](./contracts/website-booking.md)

## Prerequisites

- Bench site `senlite.localhost`
- Existing Appointment Type, active Healthcare Practitioner, Company, Gender Male/Female

## Guest create (no Authorization)

Use a **future non-Friday** date.

```bash
curl -sS -X POST "http://senlite.localhost:8000/api/method/healthcare.healthcare.api.website_booking.create_appointment" \
  -H "Content-Type: application/json" \
  -H "X-Frappe-Site-Name: senlite.localhost" \
  -d '{"patient_name":"Test Visitor","patient_phone":"01000999001","patient_sex":"Male","condition":"Back Pain","service":"Manual Therapy","branch":"Mohandeseen","appointment_date":"2026-08-30","appointment_time":"10:00 AM","language":"en"}'
```

Expect `message.name` like `HLC-APP-...`.

## Validation

Omit `patient_phone`. Expect title `validation` and no new Appointment.

Use a Friday date. Expect validation and no insert.

## Desk

Open Patient Appointment list. Confirm notes include condition, service, and branch.
