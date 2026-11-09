# Incident response and breach notification

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly, and after every incident

## What counts

A **security incident** is any event that may compromise the confidentiality, integrity or
availability of customer data or of our systems: leaked credentials, unauthorized access,
a vulnerability being exploited, data sent to the wrong place, loss of a device with access,
a provider breach that affects us, or a long outage.

A **personal data breach** (GDPR art. 4(12)) is an incident that leads to accidental or
unlawful destruction, loss, alteration, unauthorized disclosure of, or access to personal data.

## Report

Anyone (staff, contractor, customer, researcher) reports to security@zerosoft.ai. Staff also
message the security officer directly. Never discuss details in public channels, public
issues, commit messages or pull requests: the repository is public.

## Severity

| Level | Example | Response |
| --- | --- | --- |
| SEV1 | Confirmed access to customer data; production secrets exposed; full outage | Start immediately, any hour |
| SEV2 | Exploitable vulnerability without evidence of use; partial outage; one customer affected | Same business day |
| SEV3 | Hardening gap, low-impact bug | Normal backlog, within 30 days |

## Steps

1. **Open a record** in the internal repository (`incidents/YYYY-MM-DD-short-name.md`): time
   detected, who reported, what is known. Every later step is appended with a timestamp.
2. **Contain.** Revoke or rotate exposed credentials (Vercel env, Turso tokens, OAuth client
   secrets, `ENCRYPTION_KEYS` per [../encryption.md](../encryption.md)); revoke user sessions
   (Settings › Security, or `revoked_at` on `user_sessions`); disable the affected feature or
   roll back the deployment in Vercel; block abusive IPs with the Vercel firewall.
3. **Preserve evidence.** Export Vercel logs for the window, the workspace audit logs
   (`security_events`), the GitHub audit log and provider logs before they rotate.
4. **Assess.** What data, whose, how many people, since when, is it still happening.
   Decide whether it is a personal data breach.
5. **Eradicate and recover.** Fix the root cause through the normal PR flow (emergency path if
   needed); restore data from backups if needed ([business-continuity.md](business-continuity.md)).
6. **Notify** (below).
7. **Post-incident review** within 5 business days for SEV1/SEV2: timeline, root cause, what
   worked, actions with owners and dates. Actions go into the risk register.

## Breach notification (72 hours)

The clock starts when we become **aware** of a personal data breach.

| Who | When | How |
| --- | --- | --- |
| Customers (as controllers) whose data is affected | Without undue delay, target within 48 hours, so they can meet their own 72-hour duty | Email to workspace owners; DPA notice contents below |
| Supervisory authority (where zerosoft is controller: account data) | Within 72 hours unless the breach is unlikely to result in a risk; late notices explain the delay | The lead authority's online form (EEA), ICO (UK), ANPD (Brazil, 3 business days), AAIP (Argentina) |
| Affected individuals (where zerosoft is controller) | Without undue delay when the risk is high | Email |

Notice contents (art. 33(3)): nature of the breach, categories and approximate number of people
and records, contact point, likely consequences, measures taken and proposed. Information can
be given in phases.

Every breach, notified or not, is documented in the internal breach log (art. 33(5)).

## Status page and comms

Outages and incidents that affect customers are posted on /status. Messages are factual: what
happened, what is affected, what to do, when the next update comes.

## Testing

A tabletop exercise once a year (for example: leaked Turso token; a customer reports seeing
another workspace's data). Record date, scenario, participants and lessons in the internal
repository.
