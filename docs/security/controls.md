# Control matrix

Last reviewed: 2026-11-09 · Owner: security officer

One row per control, mapped to the SOC 2 Trust Services Criteria (2017, revised points of
focus 2022) and ISO/IEC 27001:2022 Annex A. Status: **Yes** = implemented and producing
evidence; **Partial** = implemented in the product, process side pending; **Owner** = depends
on an action only the owner can take; **N/A** = not applicable (with the reason). This file
doubles as the draft Statement of Applicability for ISO 27001.

## Governance and people (CC1, CC2, CC3, CC4, CC5)

| # | Control | SOC 2 | ISO 27001 | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Information security policy approved and reviewed yearly | CC1.1, CC2.1, CC5.3 | 5.1, 5.4 | Partial | [policies/information-security.md](policies/information-security.md) | Approve (sign and date in the internal repo); review yearly |
| G2 | Roles and responsibilities, security officer named | CC1.3 | 5.2, 5.3 | Partial | information-security.md › Roles | Name a backup person; segregate duties when hiring |
| G3 | Risk assessment and risk register | CC3.1–CC3.4, CC9.1 | 6.1, 8.2 (clauses), 5.7 | Partial | [policies/risk-assessment.md](policies/risk-assessment.md) | Fill the scored register in the internal repo; review quarterly |
| G4 | Management review and internal audit | CC4.1, CC4.2 | 9.2, 9.3 | Owner | - | Yearly internal audit (can be an external consultant) and management review minutes |
| G5 | Background checks, confidentiality agreements | CC1.4 | 6.1, 6.2, 6.6 | Owner | [policies/personnel.md](policies/personnel.md) | Run checks and keep signed NDAs for everyone with access |
| G6 | Security awareness training yearly | CC1.4, CC2.2 | 6.3 | Owner | personnel.md › Training | Run and record training (a compliance platform includes it) |
| G7 | Acceptable use acknowledged | CC1.1 | 5.10 | Owner | [policies/acceptable-use.md](policies/acceptable-use.md) | Collect acknowledgements |
| G8 | Disciplinary process | CC1.5 | 6.4 | Partial | information-security.md › Compliance | - |
| G9 | Customer-facing security and privacy commitments published | CC2.3 | 5.34 | Yes | /security, /privacy, /terms, /subprocessors, SECURITY.md | Keep in sync with this folder |
| G10 | Contact with authorities and vulnerability reporting channel | CC2.3 | 5.5, 5.6 | Yes | SECURITY.md, security@zerosoft.ai | Verify the mailbox is monitored |

## Access control (CC6.1–CC6.3)

| # | Control | SOC 2 | ISO 27001 | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Server-side authorization on every page and API, one rule set | CC6.1, CC6.3 | 5.15, 8.3 | Yes | `lib/roles.ts`, `lib/permissions.ts`, `lib/session.ts`, `tests/unit/permissions.test.ts`, docs/permissions.md | - |
| A2 | Workspace roles (owner/admin/member/guest), app and record access | CC6.1 | 5.15, 5.18 | Yes | Settings › Members and permissions; workspace_audit | - |
| A3 | Two-step verification (TOTP + recovery codes), enforceable per workspace | CC6.1 | 8.5 | Yes | `lib/account-security.ts`, Settings › Security, `tests/unit/account-security.test.ts`, `tests/e2e/account-security.spec.ts` | Turn it on for the zerosoft workspace itself |
| A4 | Server-side sessions: list, revoke one, revoke all; 30-day max; revoked on sign-out | CC6.1, CC6.2 | 8.5, 5.18 | Yes | `user_sessions`, Settings › Security › Sessions | - |
| A5 | Brute-force protection: rate limits on sign-in codes, two-step codes, public endpoints, API keys | CC6.1, CC6.6 | 8.5 | Yes | `lib/rate-limit.ts`, `lib/email-login.ts`, `app/api/auth/mfa` | - |
| A6 | API keys hashed, scoped, revocable; revoked when the creator leaves | CC6.1, CC6.2 | 5.17, 8.5 | Yes | `lib/api-auth.ts`, `lib/workspace-lifecycle.ts` | - |
| A7 | Offboarding in the product: removal cuts access at the next request and revokes keys, shares, hosts | CC6.2 | 5.18 | Yes | `lib/workspace-lifecycle.ts` | - |
| A8 | SSO / SAML for enterprise customers | CC6.1 | 5.16, 8.5 | Owner | - | Decide if enterprise demand justifies it (planned for `ee/`; Google sign-in covers Google Workspace customers today) |
| A9 | Internal production access least privilege, MFA on every provider | CC6.1, CC6.3 | 5.15, 5.17, 8.2 | Owner | [policies/access-control.md](policies/access-control.md) | Confirm MFA on Vercel, Turso, Railway, GitHub, Resend, Google Cloud, OpenRouter, registrar; screenshot as evidence |
| A10 | Quarterly access review | CC6.2, CC6.3 | 5.18 | Owner | access-control.md | Run and record each quarter |
| A11 | Customer data access by staff only for support/incidents, logged | CC6.1, C1.1 | 5.15, 8.15 | Owner | access-control.md rule 3 | Keep the internal access log |

## Encryption and data protection (CC6.1, CC6.7, C1)

| # | Control | SOC 2 | ISO 27001 | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | TLS 1.2+ for all traffic; HSTS; HTTP redirected | CC6.7 | 8.24, 8.20 | Yes | Vercel TLS, `next.config.mjs` headers | Run an SSL Labs test yearly and keep the report |
| E2 | Encryption at rest by providers (database, files, backups) | CC6.1 | 8.24 | Partial | [encryption.md](encryption.md) | Download provider attestations (Turso, Vercel, Railway) |
| E3 | Field-level envelope encryption of secrets with key ids and rotation | CC6.1 | 8.24, 5.17 | Yes | `lib/secret-box.ts`, `lib/key-ring.ts`, `scripts/rotate-encryption-keys.ts`, `tests/unit/encryption-keys.test.ts` | Set `ENCRYPTION_KEYS`, run the first rotation, then yearly |
| E4 | Private files encrypted by the app before upload | CC6.1 | 8.24 | Yes | `lib/private-files.ts`, `lib/books-files.ts` | - |
| E5 | Client-side encryption where the server never needs the data (locked notes) | C1.1 | 8.24 | Yes | `lib/notes-crypto.ts` | - |
| E6 | Data classification and handling | C1.1 | 5.12, 5.13 | Yes | [policies/data-classification.md](policies/data-classification.md) | - |
| E7 | Secure headers: HSTS, nosniff, referrer policy, anti-framing on the app | CC6.6 | 8.23, 8.26 | Yes | `next.config.mjs` | Full script CSP is a follow-up (see risk register) |
| E8 | Uploaded public files: random names, executable types rejected | CC6.1 | 8.26 | Partial | `lib/uploads.ts` | Public URLs are guessable only by brute force; private-by-default storage is a follow-up |

## Operations, logging and vulnerability management (CC7)

| # | Control | SOC 2 | ISO 27001 | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| O1 | Security audit log per workspace (sign-ins, two-step, sessions, keys, exports, deletions, member changes), exportable CSV, 1-year retention | CC7.2, CC7.3 | 8.15 | Yes | `security_events`, Settings › Security › Audit log | - |
| O2 | Logs without secrets or message bodies | CC7.2, C1.1 | 8.11, 8.15 | Partial | data-classification.md, `lib/mcp/scrub.ts` | Spot-check Vercel logs quarterly |
| O3 | Monitoring and alerting on errors and availability | CC7.2, A1.1 | 8.16 | Owner | /status, Vercel | Configure uptime alerts (e.g. Vercel monitoring or an external checker) and on-call contact |
| O4 | SAST on every PR (CodeQL security-extended) | CC7.1, CC8.1 | 8.28, 8.29 | Yes | `.github/workflows/codeql.yml`, Security › Code scanning | Triage alerts weekly |
| O5 | Secret scanning in CI (gitleaks) and on GitHub (push protection) | CC6.1, CC7.1 | 8.4, 8.28 | Yes | `.github/workflows/security.yml`, repository settings | - |
| O6 | Dependency scanning: Dependabot alerts and updates, `npm audit` blocks critical | CC7.1 | 8.8 | Yes | `.github/dependabot.yml`, security.yml | Fix high within 30 days; accepted exceptions in the risk register |
| O7 | Penetration test yearly | CC4.1, CC7.1 | 8.8, 8.29 | Owner | - | Commission one before the SOC 2 Type I |
| O8 | Incident response plan with 72-hour breach notification | CC7.3–CC7.5 | 5.24–5.28, 6.8 | Partial | [policies/incident-response.md](policies/incident-response.md) | Yearly tabletop; keep the breach log |
| O9 | Malware protection on endpoints | CC6.8 | 8.7 | Owner | asset-inventory.md | macOS XProtect/Gatekeeper on, record in inventory |
| O10 | Clock synchronization | CC7.2 | 8.17 | Yes | Provider-managed (Vercel, Turso) | - |

## Change management and development (CC8)

| # | Control | SOC 2 | ISO 27001 | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | All changes through PR with CI (types, lint, unit, e2e, build, Docker, CodeQL, gitleaks, audit) | CC8.1 | 8.25, 8.32 | Yes | [policies/change-management.md](policies/change-management.md), GitHub history | - |
| C2 | Branch protection on `main` (PR required, CI required, no force-push) | CC8.1 | 8.32 | Owner | - | Enable it in repository settings |
| C3 | Independent review of security-relevant changes | CC8.1 | 8.25 | Partial | PR conversations | Add a second human reviewer when possible |
| C4 | Separate environments, no production data in tests | CC8.1 | 8.31, 8.33 | Yes | `tests/`, fakes, `vercel.json` | - |
| C5 | Secure development lifecycle | CC8.1 | 8.25–8.29 | Yes | [policies/secure-development.md](policies/secure-development.md) | - |
| C6 | Database migrations versioned and forward-only | CC8.1 | 8.32 | Yes | `lib/schema/migrations.ts` | - |

## Availability and continuity (A1, CC9.1)

| # | Control | SOC 2 | ISO 27001 | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Backups with point-in-time recovery | A1.2 | 8.13 | Partial | Turso PITR | Confirm and record the retention window |
| B2 | Off-provider weekly backup | A1.2 | 8.13 | Owner | business-continuity.md | Set up the weekly encrypted dump |
| B3 | Restore test twice a year | A1.3 | 8.13, 5.30 | Owner | business-continuity.md procedure | Run and record |
| B4 | RTO/RPO defined, DR scenarios | A1.2, CC9.1 | 5.29, 5.30, 8.14 | Partial | [policies/business-continuity.md](policies/business-continuity.md) | Break-glass access for a second person |
| B5 | Capacity and rate limits | A1.1 | 8.6 | Yes | Rate limits, quotas, Vercel autoscaling | - |

## Vendors (CC9.2)

| # | Control | SOC 2 | ISO 27001 | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| V1 | Subprocessor list, public, 15-day change notice | CC9.2, P6.1 | 5.19–5.22 | Yes | [subprocessors.md](subprocessors.md), /subprocessors | Confirm regions (see the note in the file) |
| V2 | DPAs signed with every subprocessor | CC9.2 | 5.20 | Owner | vendor-management.md | Accept/sign DPAs of Vercel, Turso, Railway, Resend, Google, OpenRouter; store copies |
| V3 | Yearly vendor review with SOC 2/ISO reports | CC9.2 | 5.22 | Owner | vendor-management.md | Run and record |

## Privacy (P1–P8) and GDPR

| # | Control | SOC 2 | ISO 27001 / GDPR | Status | Evidence | Owner action |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Privacy notice accurate and complete | P1.1 | 5.34 / art. 13–14 | Yes | /privacy | Lawyer review once |
| P2 | Records of processing | P1.1 | 5.34 / art. 30 | Yes | [data-map.md](data-map.md) | Keep updated |
| P3 | Data export (account and workspace, machine-readable) | P5.1 | art. 15, 20 | Yes | Settings › Profile › Your data, `lib/privacy.ts` | - |
| P4 | Account and workspace deletion with real erasure (rows, files, WhatsApp instances) and 30-day grace | P4.3 | 8.10 / art. 17 | Yes | Settings › Profile and Settings › Workspace, `lib/privacy.ts`, `tests/unit/privacy.test.ts` | - |
| P5 | Retention schedule with automated purge jobs | P4.2, C1.2 | 8.10 / art. 5(1)(e) | Yes | [retention.md](retention.md), `/api/cron/tick` | - |
| P6 | Consent and opt-out for non-essential email | P2.1 | art. 6, 7, 21 | Yes | Lifecycle emails with unsubscribe; no marketing emails | - |
| P7 | Cookies: only strictly necessary and preference cookies, no banner needed | P2.1 | ePrivacy art. 5(3) | Yes | /privacy › Cookies | Revisit if analytics or ads are added to the site |
| P8 | DPA template for customers | P6.1 | art. 28 | Partial | [dpa-template.md](dpa-template.md) | Lawyer review; fill legal entity |
| P9 | Breach notification within 72 hours | P6.6 | art. 33, 34 | Partial | incident-response.md | - |
| P10 | International transfer safeguards (SCCs, DPF) | P6.1 | art. 44–49 | Owner | subprocessors.md | Confirm each vendor's SCCs/DPF in their DPA |
| P11 | DPO appointment | - | art. 37 | Owner | - | Probably not mandatory (no large-scale monitoring or special categories as core activity); record that assessment. Appoint an EU representative (art. 27) if you actively target EU customers without an EU establishment |
| P12 | DPIA for high-risk processing (session replay, AI on customer content, recordings) | P1.1 | art. 35 | Owner | - | Write short DPIAs for Pulse replay, Voice/Rec recordings and AI features |

## Not applicable (Statement of Applicability)

| ISO 27001 control | Reason |
| --- | --- |
| 7.1–7.14 Physical controls (perimeters, entry, offices, equipment siting) | No offices or data centers; infrastructure is fully managed by cloud providers whose attestations cover it. 7.7 (clear desk/screen) and 7.9/7.10 (devices and media off-premises) apply through acceptable-use.md |
| 8.19 Installation of software on operational systems | Serverless and managed platforms; only CI-built artifacts are deployed |
| 8.30 Outsourced development | Applies only when contractors are engaged; covered by change-management.md then |
