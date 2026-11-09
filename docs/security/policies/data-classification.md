# Data classification and handling

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly

| Level | Examples | Handling |
| --- | --- | --- |
| **Restricted** | Encryption keys, `NEXTAUTH_SECRET`, database tokens, OAuth client secrets, customers' integration tokens and credentials, MFA secrets | Only in environment variables marked sensitive or field-encrypted in the database; never logged, never in tickets or chats; rotated on exposure |
| **Confidential** | Customer workspace content, contacts, messages, recordings, HR records; account data; logs with IP addresses | Access only per [access-control.md](access-control.md); encrypted in transit and at rest; never copied to laptops or non-production environments; deleted per [../retention.md](../retention.md) |
| **Internal** | Risk register, vendor contracts, incident records, roadmap drafts | Private repository; shared on a need-to-know basis |
| **Public** | Open-source code, docs, marketing site, this folder | Reviewed before publishing; no security weaknesses or customer data |

Rules that follow from the table:

- Personal data in logs: application logs record ids, never message bodies, tokens or full
  email contents. `lib/mcp/scrub.ts` and the redaction helpers remove secrets before logging.
- Screenshots and exports with customer data are not shared outside the support request they
  belong to, and are deleted when it closes.
- Test data is synthetic.
