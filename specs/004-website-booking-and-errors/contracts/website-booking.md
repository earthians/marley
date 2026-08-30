# Contract: Website booking write (website → Healthcare)

**Consumer**: Abu Zahra public website  
**Provider**: `healthcare.healthcare.api.website_booking.create_appointment`  
**Transport**: HTTPS JSON  
**Auth**: Guest. The website MUST NOT send `Authorization`. Token MAY still work.

Base: `{origin}/api/method/healthcare.healthcare.api.website_booking.create_appointment`

**Request** (POST JSON):

| Field | Required | Notes |
|-------|----------|--------|
| patient_name | yes | Full name |
| patient_phone | yes | |
| patient_sex | yes | `Male` or `Female` |
| condition | yes | |
| service | yes | |
| branch | yes | Display or clinic name |
| appointment_date | yes | `YYYY-MM-DD`; not Friday; not past |
| appointment_time | yes | e.g. `10:00 AM` or `10:00:00` |
| patient_email | no | |
| insurance_company | no | |
| notes | no | |
| language | no | `en` or `ar` |
| service_unit | no | Healthcare Service Unit id |
| source | no | Default `website` |

**Success `message`**:

| Field | Notes |
|-------|--------|
| name | Patient Appointment id |
| status | e.g. Open / Scheduled |
| appointment_datetime | Combined date and time |
| practitioner | May be auto-assigned |
| branch | Echo of branch |
| patient_name | Echo of name |

**Errors**:

| Kind | HTTP | Title |
|------|------|-------|
| validation | 417 (Frappe throw) | `validation` |
| rate_limit | 429 | (rate limiter) |
| server_error | 500 | `server_error` |

Do not return HTML stack traces. Empty catalog list methods remain `[]` on other endpoints.

**Rate limit**: 10 requests / 60 seconds.
