# Implementation Plan: Booking Catalog APIs

**Branch**: `001-booking-catalog-apis` | **Date**: 2026-08-24 | **Spec**: [spec.md](./spec.md)

## Summary

Add three authenticated whitelist methods in the Healthcare app that return `{id, label}` arrays from Complaint, enabled Therapy Type, and parented Healthcare Service Unit groups. Seed site data separately so `/book` is not empty.

## Technical Context

**Language/Version**: Python 3 / Frappe
**Primary Dependencies**: Healthcare DocTypes already on `senlite.localhost`
**Storage**: Existing DocTypes only
**Testing**: `bench execute` and token curl
**Target Platform**: Frappe site `senlite.localhost`
**Project Type**: Frappe app (Healthcare)
**Constraints**: No custom app; no `allow_guest`; `ignore_permissions=True`
**Scale/Scope**: Three list methods

## Project Structure

```text
BackEnd/apps/healthcare/healthcare/healthcare/api/booking_catalog.py
specs/001-booking-catalog-apis/
```
