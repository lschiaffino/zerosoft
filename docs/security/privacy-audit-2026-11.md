# Privacy audit: who sees what (November 2026)

Last reviewed: 2026-11-20

Scope: what one person can see of another person's data inside the same workspace
(team), and what a person can reach without a session. Encryption at rest is out of
scope (see [encryption.md](encryption.md)). This audit read the code; it did not touch
production data.

## The model

- A workspace is its owner's user id (`user.id` in the session). Each person acting in
  it is `user.actingUser` (`realUserId(user)`), with a role (owner, admin, member, guest).
- Workspace content (CRM records, Docs pages, Track issues, Lines chats...) is shared by
  default and narrowed by the app's own rules: CRM member visibility (`all`, `mine`,
  `team` in `lib/crm-visibility.ts`), Docs teamspaces, private Track teams, Lines
  access per line, Design sharing.
- Some content belongs to one person even though it lives in the workspace: Notes,
  Inbox (personal WhatsApp and email), Voice, the assistant's conversations, Fleet
  sessions, private designs, Flow variables, personal folders and saved views. Not even
  an admin sees it in the app.
- API keys and MCP act as the person who created the key (`auth.personId`), with that
  person's role and app access.

## 1. Every API route has a guard

`scripts/api-route-guards.mjs` (run by `tests/unit/api-route-guards.test.ts` in
`npm test`, so in the `check` job of CI) reads each `route.ts` under `app/api` and
`lib/routes`. Every exported handler has to reach a session or API-key guard, or be in
`scripts/api-public-routes.json` with the reason (signed webhook, cron secret, share
token, public page, widget visitor). Since this audit the check looks at each handler,
not only the file (#558): a guarded `GET` no longer covers an unguarded `DELETE`.

State on 2026-11-20: 1611 routes, 192 public files and 23 public handlers, each with a
reason; none outside the list.

## 2. Surfaces checked

| Surface | Private objects | Result |
| --- | --- | --- |
| Cmd+K (`app/api/search`) | Notes, Inbox, Docs, CRM, assistant chats, Fleet, Design, Lines, Talk, Voice, Track | Each source filters by the person or the app's rule. Inbox is skipped for tokens. |
| Assistant (`lib/assistant/**`) | Notes, Inbox, Docs, CRM, Lines, Cal, Voice, Track | Tools get `personId` from `toolCtx`; Inbox tools also need the person's consent. |
| MCP (`/api/mcp` and per-app MCP) | Same as the routes | Runs the real route handlers as the key's person. `/api/inbox/*` refuses delegated calls. |
| Public API v1 | Notes, Docs, CRM, Lines, Cal, Track | Scoped to the key's person. There is no Inbox API. |
| Exports | Notes, Lines, Track, Talk, CRM, Cal, Calls, account export | App exports reuse the app's list query. The account export narrows per-person tables (see fixes). |
| Home, notifications, webhooks, Flow | Recents, linked tasks, note events | Filtered. Note events only reach the author's own flows and webhooks. |
| Files | Inbox, Notes, Docs attachments | Inbox files are per person; Notes and Docs files are served through routes that check access again. |

Regression test for the two-person case: `tests/unit/privacy-who-sees-what.test.ts`
(Cmd+K and the assistant, a member against a teammate's note, Inbox chat, Fleet session
and private design). Older tests that cover the same ground: `tests/unit/notes-sync.test.ts`
(Cmd+K notes), `tests/unit/inbox.test.ts` (Inbox isolation), `tests/unit/member-privacy.test.ts`
and `tests/unit/member-privacy-paths.test.ts` (Lines, Track, Links, export).

## 3. Fixed in this audit

| Fix | Where | PR |
| --- | --- | --- |
| CRM sequences: enroll, unenroll, pause and the sequence detail follow member visibility; through the API only the owner or an admin can pick another person's mailbox as sender | `lib/routes/crm/sequences/**`, `lib/routes/v1/crm/sequences/**`, `lib/crm-sequences.ts` | #555 |
| Route guard check per handler | `scripts/api-route-guards.mjs` | #558 |
| Account export narrowed for Fleet, private designs and Design folders, Flow variables, Lines personal folders and unshared saved lists, unshared Chat views, personal Track dashboards | `lib/privacy.ts` (`PERSONAL_EXPORT`) | #559 |
| CRM documents and videos: a linked contact the person can't see shows no name or email, and can't be linked | `lib/crm-media.ts`, `lib/crm-media-http.ts` | #561 |
| CRM: Outlook events marked private or confidential don't become meetings on the shared contact timeline | `lib/crm-outlook-sync.ts` | #562 |

## 4. Open

- CRM tasks and activities under `mine` visibility: an activity shows when all the records
  it links to are visible, even if another person owns the activity
  (`activityScopeSql` in `lib/crm-visibility.ts`). This matches HubSpot's record-based
  access; change it only if the product decides activities are owned content.
- CRM search, lists and reports live in `lib/crm.ts`, which other work is rewriting
  (HubSpot parity). They were read and apply the scope; any new query there needs the
  same `scopeAnd`/`ownerScopeSql`.
- Admins see BI personal collections by design; documented here so it isn't mistaken
  for a leak.
- Encryption of personal content at rest: waiting on the owner.
- The realtime stream for Lines personal folders (`wa_live_events.person_id`) was added
  the same day as this audit and was not reviewed.
