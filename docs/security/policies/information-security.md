# Information security policy

Last reviewed: 2026-11-09 · Owner: Lautaro Schiaffino (founder, acting security officer) ·
Approved by: owner · Review: yearly

## Purpose and scope

Protect the confidentiality, integrity and availability of customer data and of the systems
that run zerosoft cloud: the web app (Vercel), the database (Turso), file storage (Vercel
Blob), the services on Railway, the desktop and mobile apps, the source repository and CI,
and the laptops and accounts of everyone with access. Self-hosted instances are out of scope:
their operators run them.

## Principles

1. **Least privilege.** People and services get the minimum access they need, removed when
   no longer needed ([access-control.md](access-control.md)).
2. **Everything through code review and CI.** No manual changes to production other than
   documented emergency steps ([change-management.md](change-management.md)).
3. **Encrypt in transit and at rest; field-encrypt secrets** ([../encryption.md](../encryption.md)).
4. **Collect the minimum, keep it no longer than needed** ([../retention.md](../retention.md)).
5. **Assume breach.** Logs, audit trail and an incident plan that is rehearsed
   ([incident-response.md](incident-response.md)).
6. **Open source as a control.** The core is public; anyone can read and report.

## Roles

| Role | Who | Responsibilities |
| --- | --- | --- |
| Security officer | Founder | Owns this program, risk register, incidents, vendor reviews, approvals |
| Privacy contact | Founder (privacy@zerosoft.ai) | Data subject requests, DPAs, breach notifications |
| Engineers and contractors | Everyone with repository or production access | Follow these policies; report incidents immediately |
| Coding agents | Automated agents working in the repository | Same rules as engineers: branches, PRs, CI; never hold production credentials beyond what CI uses |

When the team grows, the security officer and DPO roles are reassigned in writing and this
table is updated.

## Management commitment and objectives

Yearly objectives (tracked in the internal repository): no critical vulnerability open more
than 7 days, high ones within 30; 100% of people with production access using MFA; one
restore test and one incident tabletop per year; all subprocessors reviewed yearly.

## Compliance

Breaking these policies may lead to removal of access and contract termination. Exceptions
need written approval from the security officer, with an expiry date, recorded in the risk
register.
