# Feature Design Guide

`docs/FEATURE_LIST.md` is the active index. This directory holds version designs and historical released designs.

## Design lifecycle

1. Confirm the user outcome and current code evidence.
2. Check whether existing Space/KodaX capability already satisfies the need.
3. For SDK-backed work, identify the exact public export, event, DTO, capability flag, and minimum tested version.
4. Add the feature to the active list only after it has a target version and design entry.
5. Move `Planned -> InProgress -> Completed`; record other decisions in the reviewed-out table.
6. On release, update the design status, feature index, capability ledger, changelog, and human test guide together.

## Required sections

Every new active design must contain:

- Decision and user outcome
- Current evidence and gap
- SDK/capability contract
- UX and data flow
- Security and permission boundary
- Compatibility and migration
- Explicit non-goals
- Implementation slices
- Automated acceptance
- Human acceptance
- Rollout and rollback

## Upstream naming

- Space features: `F116`, `F117`, and so on.
- KodaX dependencies: `KX-F260`, `KX-F266`, and so on.
- Never use a version comparison alone as evidence that a capability exists. Prefer capability negotiation and a compatibility probe.

## Historical documents

Released version designs are historical records and should not be rewritten to describe later behavior. Add an explicit correction note or point to the current design when necessary. Unreleased documents may be replaced during a roadmap rebase, with the superseded decision recorded in `FEATURES_ARCHIVED.md`.
