# Vendor management policy

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly

## Before using a new vendor that touches customer data

1. Need: what data, which feature, could we avoid sending personal data.
2. Due diligence: the vendor's SOC 2 Type II report or ISO 27001 certificate (or a completed
   security questionnaire if neither exists), its DPA with Standard Contractual Clauses, data
   location, subprocessors, breach notification terms, and whether API data is used for
   training (must be no).
3. Sign or accept the vendor's DPA; store it in the internal repository (`vendors/<name>/`).
4. Add it to [../subprocessors.md](../subprocessors.md) and the public page 15 days before use.
5. Least privilege: separate API keys per environment, minimal scopes.

## Yearly review

For each vendor in the subprocessor list: download the current SOC 2 report / ISO certificate
(note period and any exceptions), check the DPA is current, check incidents during the year,
confirm the data and region have not changed. Record the review in the internal repository.

## Current critical vendors

| Vendor | Criticality | Assurance to collect | Status page |
| --- | --- | --- | --- |
| Vercel | Critical | SOC 2 Type II, ISO 27001 (Vercel Trust Center) | vercel-status.com |
| Turso | Critical | SOC 2 Type II (request from Turso) | status.turso.tech |
| Railway | High | SOC 2 Type II (Railway Trust Center) | status.railway.com |
| Resend | High | SOC 2 Type II (Resend security page) | resend-status.com |
| Google (Workspace APIs, OAuth) | High | ISO 27001, SOC 2 (Google compliance reports) | google.com/appsstatus |
| GitHub | High | SOC 2 Type II | githubstatus.com |
| AI providers via Vercel AI Gateway and OpenRouter | Medium | SOC 2 / zero data retention terms of each provider used | provider pages |

## Exit

Every critical vendor has a documented way out: data export format and how long it takes
(Turso: SQLite dump; Blob: list and download; Railway: redeploy the open-source Evolution image
elsewhere).
