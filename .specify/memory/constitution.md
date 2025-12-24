<!--
Sync Impact Report

- Version change: template -> 1.0.0
- Modified principles: (added) "Patient Privacy & Data Protection"; "Clinical Safety & Accuracy"; "Test-First Quality"; "Interoperability & Standards"; "Observability & Simplicity"
- Added sections: "Additional Constraints (Security & Compliance)"; "Development Workflow"
- Removed sections: none
- Templates requiring updates: ✅ .specify/templates/plan-template.md
															✅ .specify/templates/spec-template.md
															✅ .specify/templates/tasks-template.md
- Follow-up TODOs: TODO(RATIFICATION_DATE): supply original ratification date if known
-->

# Marley Health Constitution

## Core Principles

### Patient Privacy & Data Protection (MUST)
All handling of personal health information (PHI) and user data MUST follow least-privilege access,
data minimization, and strong encryption in transit and at rest. Access to PHI MUST be auditable and
logged. Data retention periods MUST be explicit and justified; deletion and export requests MUST be
supported. Rationale: protecting patient data is a legal and ethical requirement for healthcare software.

### Clinical Safety & Accuracy (MUST)
Changes that affect clinical content, decision-support, or patient-facing outputs MUST be reviewed by a
clinical domain reviewer and validated with acceptance tests that cover correctness and safety
boundaries. Rationale: incorrect clinical behavior risks patient harm and is non-negotiable.

### Test-First Quality (MUST)
New functionality and bug fixes MUST be accompanied by automated tests. Where feasible, tests are
written before implementation (TDD). All work MUST include unit tests and appropriate integration or
contract tests. CI gates MUST prevent merging code that reduces test coverage on critical paths.
Rationale: tests preserve safety, maintainability, and enable safe refactoring.

### Interoperability & Standards (MUST)
APIs and data models that cross system boundaries MUST follow established healthcare standards (e.g.,
FHIR/HL7 where applicable) and use stable, versioned contracts. Breaking changes to public contracts
MUST follow the semantic versioning policy defined in Governance and include migration guidance.
Rationale: interoperability reduces integration risk for healthcare providers.

### Observability & Simplicity (SHOULD)
Systems SHOULD emit structured logs, metrics, and tracing for key flows (auth, patient access, orders,
results). Favor simple, auditable designs over premature optimization. Rationale: observability aids
diagnosis and simplicity lowers cognitive overhead for maintainers and clinicians.

## Additional Constraints (Security & Compliance)
- Encryption: TLS for all network transport; encryption at rest for PHI-capable stores.
- Authentication & Authorization: Role-based access control (RBAC) with principle of least privilege;
	privileged operations MUST require explicit elevated roles.
- Dependencies: Third-party libraries that handle PHI MUST be reviewed for security and license
	compatibility before inclusion.
- Compliance: Projects touching PHI MUST document compliance considerations (GDPR, local laws) and
	include retention/consent rationale in the spec.

## Development Workflow
- Code Reviews: All production changes MUST be reviewed by at least one peer and one maintainer for
	non-trivial changes; clinical-impacting changes MUST include a clinical reviewer.
- CI: Every PR MUST run automated tests and linting. Release artifacts MUST be reproducible from the
	repository state and tagged in git.
- Releases: Use semantic versioning for releases. Breaking changes to runtime behavior or public
	contracts MUST include a migration plan in the PR.

## Governance
- Amendments: Changes to this constitution MUST be made via a documented PR. Amendments that add or
	materially change principles require public discussion for a minimum of 7 days and approval by at
	least two project maintainers; amendments affecting clinical safety REQUIRE an approving clinical
	reviewer.
- Versioning Policy: Use semantic versioning for the constitution itself:
	- MAJOR: Backward-incompatible governance or principle removals/redefinitions.
	- MINOR: Addition of a new principle/section or material expansion of guidance.
	- PATCH: Clarifications, wording fixes, or non-semantic refinements.
- Compliance Reviews: A high-level compliance review against this constitution SHOULD occur at least
	annually or after any major release.
- Enforcement: CI checks and PR templates SHOULD include explicit checks against the principles where
	applicable (e.g., tests present for critical paths, security checklist completed).

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE) | **Last Amended**: 2025-12-24
