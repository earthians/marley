# Contract: Healthcare booking catalog

**Auth**: `Authorization: token {API_KEY}:{API_SECRET}`
**Base**: `http://senlite.localhost:8000/api/method/{method}`

| Method | DocType | Filter |
|--------|---------|--------|
| `healthcare.healthcare.api.booking_catalog.get_conditions` | Complaint | all |
| `healthcare.healthcare.api.booking_catalog.get_services` | Therapy Type | `disabled=0` |
| `healthcare.healthcare.api.booking_catalog.get_branches` | Healthcare Service Unit | `is_group=1` and parent set |

Success `message`: `[{ "id": string, "label": string }]`
Unauthenticated: non-2xx, no rows.
