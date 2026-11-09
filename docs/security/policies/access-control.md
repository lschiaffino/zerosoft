# Access control policy

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly

## Customer access (in the product)

- Sign-in with Google (verified email only) or a one-time email code; optional two-step
  verification (TOTP authenticator app plus single-use recovery codes). Workspace owners can
  require two-step verification for every member.
- Sessions: signed httpOnly cookies, 30 days maximum. Each sign-in is a server-side session
  that can be listed and revoked from Settings › Security (one device or all others).
- Roles per workspace: owner, admin, member, guest, plus app-level and record-level access.
  One rule set (`lib/roles.ts`, `lib/permissions.ts`) is enforced on the server for every page
  and API (`lib/session.ts`); see [../../permissions.md](../../permissions.md).
- API keys and MCP/OAuth tokens: scoped, hashed at rest, revocable; revoked automatically when
  their creator leaves the workspace.
- Brute-force protection: rate limits on sign-in codes, two-step codes, public endpoints and
  API keys (`lib/rate-limit.ts`).
- Security-relevant actions are recorded in the workspace audit log, visible and exportable by
  owners and admins.

## Internal access (production)

| System | Who has access | How | MFA |
| --- | --- | --- | --- |
| Vercel team | Founder | SSO with GitHub/Google | Required |
| Turso | Founder | Turso account | Required |
| Railway | Founder | Railway account | Required |
| GitHub (repo admin) | Founder | GitHub account | Required (GitHub enforces 2FA for contributors) |
| Resend, Google Cloud console, OpenRouter | Founder | Provider accounts | Required |
| Domain registrar and DNS | Founder | Registrar account | Required |

Rules:

1. Access is granted by the security officer, on a ticket in the internal repository that
   says who, what, why and until when.
2. Production secrets live only in Vercel/Railway environment variables (marked sensitive),
   never in the repository, chats or laptops. Local development uses separate keys.
3. Nobody reads customer data in production except to answer a support request the customer
   made, to investigate an incident, or when the law requires it. Each such access is noted in
   the internal access log (date, who, why, what was accessed).
4. Contractors and agents get repository access through pull requests only; they do not get
   production credentials.
5. **Quarterly access review:** the security officer lists every account with access to the
   systems above, removes what is not needed, and records the review (date, reviewer,
   changes) in the internal repository.
6. Offboarding removes all access the same day ([personnel.md](personnel.md)).
