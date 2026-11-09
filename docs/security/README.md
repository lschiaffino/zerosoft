# Security and compliance program

This folder is the source of truth for how zerosoft runs security and privacy. It is
written for three readers: the team (what to do), customers filling in security
questionnaires (what we do), and an external auditor (where the evidence is).

Written in English because SOC 2 and ISO 27001 auditors and most customer questionnaires
work in English. Product docs elsewhere in `docs/` stay in Spanish.

## Status (honest)

- **SOC 2:** no report. The controls below are designed to meet the Trust Services
  Criteria (Security, Availability, Confidentiality, Privacy). A SOC 2 report can only be
  issued by an independent CPA firm: Type I (design at a point in time), then Type II
  (operating effectiveness over a 3 to 12 month observation window).
- **ISO/IEC 27001:2022:** not certified. The ISMS documents below cover clauses 4 to 10 and
  the Annex A controls that apply; certification requires a Stage 1 and Stage 2 audit by an
  accredited certification body, then yearly surveillance audits.
- **GDPR / UK GDPR / LGPD / Ley 25.326:** legal obligations, not certifications. Product
  features (export, erasure, retention, consent) are in place; the owner actions in
  [controls.md](controls.md) close the process side.

Code cannot "guarantee" an attestation. It can make the controls real and produce the
evidence; the rest is process the owner runs and an auditor tests.

## Documents

| Document | ISO 27001 | SOC 2 |
| --- | --- | --- |
| [controls.md](controls.md): control matrix, evidence and owner actions | Statement of Applicability | All CC, A1, C1, PI1, P |
| [policies/information-security.md](policies/information-security.md) | 5.1, 5.2, 5.4 | CC1, CC2, CC5 |
| [policies/access-control.md](policies/access-control.md) | 5.15–5.18, 8.2, 8.5 | CC6.1–CC6.3 |
| [policies/change-management.md](policies/change-management.md) | 8.25–8.33 | CC8.1 |
| [policies/secure-development.md](policies/secure-development.md) | 8.25, 8.26, 8.28, 8.29 | CC8.1, CC7.1 |
| [policies/incident-response.md](policies/incident-response.md) | 5.24–5.28, 6.8 | CC7.3–CC7.5, P6 |
| [policies/business-continuity.md](policies/business-continuity.md) | 5.29, 5.30, 8.13, 8.14 | A1.1–A1.3, CC9.1 |
| [policies/vendor-management.md](policies/vendor-management.md) | 5.19–5.23 | CC9.2 |
| [policies/risk-assessment.md](policies/risk-assessment.md) | 6.1, 8.2 (clause) | CC3.1–CC3.4 |
| [policies/asset-inventory.md](policies/asset-inventory.md) | 5.9–5.11 | CC6.1 |
| [policies/data-classification.md](policies/data-classification.md) | 5.12–5.14 | C1.1, C1.2 |
| [policies/acceptable-use.md](policies/acceptable-use.md) | 5.10, 6.7, 8.1 | CC1.1, CC2.2 |
| [policies/personnel.md](policies/personnel.md): onboarding, offboarding, training | 6.1–6.6 | CC1.4, CC2.2, CC6.2 |
| [data-map.md](data-map.md): records of processing (GDPR art. 30) | 5.34 | P1–P8 |
| [subprocessors.md](subprocessors.md) | 5.19–5.22 | CC9.2, P6.1 |
| [retention.md](retention.md) | 8.10 | C1.2, P4.2 |
| [encryption.md](encryption.md) | 8.24 | CC6.1, CC6.7 |
| [dpa-template.md](dpa-template.md): data processing agreement for customers | 5.34 | P6 |

Internal-only material (the scored risk register, vendor contracts and DPAs as signed,
access reviews, incident records, training records) lives in the private
`zerosoft-internal` repository, never here: this repository is public.

## Review

Every document carries a "Last reviewed" date. The owner reviews all of them at least once
a year and whenever the product or the infrastructure changes in a way they describe.
