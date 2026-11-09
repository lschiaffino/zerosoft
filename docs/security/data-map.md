# Data map and records of processing (GDPR art. 30)

Last reviewed: 2026-11-09. Owner: Lautaro Schiaffino (controller contact: privacy@zerosoft.ai).

zerosoft is the **controller** for account data and its own communications, and the
**processor** for the content customers put in their workspaces (art. 30(1) and 30(2)).

## Where data lives

| Store | What | Encryption |
| --- | --- | --- |
| Turso (libsql) | Every table: users, workspaces, members, and the data of every app | Provider at rest; secrets also field-encrypted (see encryption.md) |
| Vercel Blob | Uploaded files (attachments, images, recordings, documents) | Provider at rest; private files (Hiring CVs, Sign PDFs) also encrypted by the app |
| Railway (Evolution) | WhatsApp session of each connected number, message cache and media | Provider at rest |
| Vercel logs | Request and function logs (IP, path, status) | Provider; short retention |
| Browser | Session cookie, language, UI preferences, offline cache (service worker) | Cookie signed and httpOnly; offline cache cleared on sign-out |

## Records of processing as controller (art. 30(1))

| Activity | Data subjects | Personal data | Purpose | Legal basis | Recipients | Retention |
| --- | --- | --- | --- | --- | --- | --- |
| Accounts and sign-in | Users | Name, email, picture, sign-in codes (hashed), sessions (IP, user agent), MFA secret (encrypted) | Provide and secure the account | Contract; legitimate interest (security) | Vercel, Turso, Google (if used), Resend (codes) | Account life; sessions 90 days after they end |
| Security audit log | Users | Actor, action, IP, user agent | Detect and investigate misuse; customer audit trail | Legitimate interest; legal obligation | Vercel, Turso | 365 days |
| Service and lifecycle emails | Users | Email, usage signals (which apps were used) | Onboarding, service notices | Contract (service); legitimate interest (lifecycle, with unsubscribe) | Resend | Until unsubscribe or account deletion |
| Support and feedback | Users, visitors | Email, message, page, user agent | Answer and improve | Legitimate interest | Vercel, Turso, Resend | Until the account is deleted, or on request |
| Site rate limiting and abuse | Visitors | IP (hashed key, minutes) | Security | Legitimate interest | Vercel, Turso | At most 10 minutes |
| Billing (when paid plans launch) | Customers | Name, email, billing details | Charge | Contract; legal obligation | Payment processor (to be named) | As tax law requires |

## Records of processing as processor (art. 30(2))

Categories of processing done for each customer (controller) under the DPA:

| App | Data subjects | Typical personal data |
| --- | --- | --- |
| CRM, Link, Forms, Calendar | Customer's contacts, leads, form respondents, booking guests | Name, email, phone, company, notes, answers, click metadata without IP |
| Chat, Inbox, Lines, Talk, Social | Customer's visitors, correspondents, WhatsApp contacts, team members | Messages, attachments, phone numbers, email addresses |
| Docs, Notes, Board, Track, Design, Send, Sign | Team members, guests, document recipients | Content, comments, viewer events, signatures |
| People, Hiring | Employees, candidates | HR records, time off, CVs, evaluations |
| Voice, Rec, Pulse | Meeting participants, site visitors | Recordings, transcripts, session replays (with masking) |
| Agents, Flow, Robots, Assistant | Whatever the customer routes through them | Prompts, workflow payloads |

Categories of recipients: the subprocessors in [subprocessors.md](subprocessors.md) and the
destinations the customer configures. Transfers outside the EEA rely on the providers'
Standard Contractual Clauses and the EU-US Data Privacy Framework where certified.
Technical and organizational measures: [controls.md](controls.md).

## Data subject requests

| Right | How |
| --- | --- |
| Access and portability | Settings › Profile › Your data › Download my data (JSON, machine-readable); the export covers the workspace they own; per-app exports |
| Erasure | Settings › Profile › Your data › Delete account (30-day grace, then erased, including files); workspace deletion for owners in Settings › Workspace |
| Rectification | Profile and each app's editing |
| Objection to lifecycle email | Unsubscribe link in each email; Settings › Notifications |
| Requests from a customer's contacts | Forwarded to the customer (controller); we assist within 10 days |

Requests to privacy@zerosoft.ai are logged in the internal repository with date received,
identity check, action and date closed. Deadline: one month (GDPR), 10 calendar days for
access under Ley 25.326, 15 days under LGPD.
