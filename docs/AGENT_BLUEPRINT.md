# Project Documentation Blueprint

This is the project-specific version of the reusable agent blueprint. It is a
maintenance checklist for future AI sessions, not a source of consignment
business rules. `AGENTS.md` remains the active instruction file.

## Documentation set

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Active coding, safety, deployment, and verification rules. |
| `README.md` | Current production scope, setup, limitations, and deployment boundary. |
| `DATA_MODEL.md` | Google Sheets, columns, identifiers, relationships, and derived data. |
| `BUSINESS_RULES.md` | Authentication, validation, lifecycle, quantity, and cleanup rules. |
| `UI_DESIGN.md` | Current pages, worker interactions, devices, and language. |
| `TEST_PLAN.md` | Regression scenarios and release acceptance checks. |
| `DECISIONS.md` | Architectural decisions that future agents must not accidentally reverse. |
| `NEXT_MIGRATION.md` | Explicit future work, including the planned consignment module. |
| `project-log/` | Daily history when the owner asks for `SUMMARIZE`. |

## Future-session interview

Before changing an undocumented area, ask the project owner:

### Scope

- Is this behavior already active in the workplace or still planned?
- Is the request a bug fix, a production-hardening change, or a new module?
- What existing behavior must not change?

### Data

- Which sheet, table, or API response is the source of truth?
- What is the exact header row and column spelling?
- What identifies one record uniquely?
- Which fields are user input, backend-resolved, formula-derived, or historical?
- Which records must never be physically deleted?

### Workflow and safety

- Which statuses exist and which transitions are allowed?
- What happens on duplicate submission or an uncertain network retry?
- Does the operation require a lock or idempotency key?
- Who may perform the action?
- What audit information must be preserved?

### Authentication

- Does the feature use the existing one-time internal session?
- Does it require a new role or permission, or should all currently authorized
  internal users continue to use it?
- What should happen when the session expires?

### UI and devices

- Which page and worker action are affected?
- Is the primary device Android Chrome, desktop, or both?
- Is camera access, keyboard-scanner input, or numeric keypad input required?
- What Thai labels and error states should workers see?

### Deployment and testing

- Is the change frontend-only or does it cross the Apps Script boundary?
- Which commands synchronize it?
- What is the smallest safe production test?
- What evidence is required before release?

## Documentation rules

- Describe the current system as-built before proposing improvements.
- Do not invent missing data; use `TBD` or `UNKNOWN` and ask the owner.
- Do not copy project-specific data from another project.
- Do not put credentials, tokens, private URLs, or secret IDs in documentation.
- Update the relevant document in the same change as a business-rule or data-model change.
- Put ideas that are not approved for implementation in `NEXT_MIGRATION.md`.
- Use `docs/project-log/wh-location3D_YYYY_MM_DD.md` for requested daily summaries.
