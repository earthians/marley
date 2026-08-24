# Quickstart

```
cd BackEnd
bench --site senlite.localhost execute healthcare.healthcare.api.booking_catalog.get_conditions
python ../Helper_codes/Seeding/seed_booking_catalog.py
```

Guest-allowed, rate-limited methods: `get_conditions`, `get_services`, `get_branches`.
Curl against `http://senlite.localhost:8000/api/method/healthcare.healthcare.api.booking_catalog.get_conditions`.
