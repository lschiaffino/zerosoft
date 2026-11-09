# Personnel security: onboarding, offboarding and training

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly

## Before joining

- Background check proportional to the role and allowed by local law (identity, references;
  criminal record where lawful for roles with production access).
- Signed contract with confidentiality clause, the [acceptable-use.md](acceptable-use.md)
  acknowledgement and, for contractors, a data processing clause.

## Onboarding checklist (recorded per person in the internal repository)

1. Accounts created with MFA on: email, GitHub, and only the providers the role needs.
2. Access ticket per [access-control.md](access-control.md) (least privilege, with end date for
   contractors).
3. Device meets [asset-inventory.md](asset-inventory.md) requirements; added to the inventory.
4. Security and privacy training completed (below) within the first week.

## Training

- On joining and yearly: this program's policies, phishing, handling customer data, GDPR basics
  (what personal data is, data subject requests, breach reporting in 72 hours), secure coding
  for engineers (OWASP Top 10, secrets, dependency hygiene).
- Record date, content and completion per person.

## Offboarding checklist (same day)

1. Remove from GitHub organization/repos, Vercel team, Turso, Railway, Resend, Google Cloud,
   OpenRouter, domain registrar, password manager shares.
2. Rotate any shared secret the person could see (see [../encryption.md](../encryption.md) for
   the encryption key; `CRON_SECRET`, provider tokens).
3. Revoke personal API keys and sessions in zerosoft.
4. Recover or wipe devices; remove from the asset inventory.
5. Record date and who performed each step.
