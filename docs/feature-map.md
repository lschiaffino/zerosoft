# Feature map

What each zerosoft app does today, where it lives in the UI, which API backs it, how it compares
with the incumbent, and which test covers it. Built on 2026-10-13 by walking every screen on a
`DEMO_MODE` dev server with seed data (desktop 1440×900 and mobile 390×844) and running the main
create/edit/delete flows with Playwright. Updated on 2026-10-18 against the code for Link, Cal, Chat,
Docs and Track (rows added since the walk cite the unit test that covers them).

**Status:** `works` = verified end to end · `partial` = exists but limited vs the incumbent ·
`broken` = exists but fails · `missing` = the incumbent has it, we don't.

**Tests:** `flows.spec` = `tests/e2e/flows.spec.ts`, `screens.spec` = `tests/e2e/screens.spec.ts`,
other `*.spec` files are in `tests/e2e/`, `*.test.ts` files are in `tests/unit/`. "manual" means
it was checked in the Playwright walk but has no automated test yet.

**Shared across apps:** `components/app/QuickModal.tsx` (quick create/edit modal: Esc closes,
⌘↵ submits, focus trap) and `useKeyShortcut` (single-key `C` to create, ignored while typing or
when a dialog is open). Link, Cal, Chat, Docs and CRM all use them for their main create action.

- [Link](#link-vs-bitly--dub) · [Cal](#cal-vs-calendly) · [Chat](#chat-vs-intercom) · [Docs](#docs-vs-notion) · [Track](#track-vs-linear) · [CRM](#crm-vs-hubspot)

## Link (vs Bitly / Dub)

| Feature | What it does | Where in the UI | API | Status | Test |
|---|---|---|---|---|---|
| Quick-create | Shorten a URL without leaving the list; `C` opens it, pasting a URL anywhere on the page opens it prefilled; copies the short link on create | Links › "+ New link" (modal) | `POST /api/links` | works | e2e `flows.spec` "Link: quick-create desde la lista" |
| Full create form | Slug + availability, title, tags, UTM builder, 301/302, expiry, max clicks, password, OG preview | Links › New link (`/app/links/new`, "More options" in the modal) | `POST /api/links`, `GET /api/links/check-slug` | works | e2e `flows.spec` "Link: crear, redirigir y contar el click"; unit `links.test.ts` |
| Redirect + click tracking | Short URL redirects and records the click (country, referrer, device, browser, OS) | public `/<slug>` | — | works | e2e `flows.spec` "crear, redirigir y contar el click" |
| List, search, tag filter, archived filter, sort | Find links | Links | `GET /api/links` | works | e2e `screens.spec` (`/en/app/links`) |
| Row actions | Copy, QR, edit, archive/unarchive, delete with confirmation | Links table (show on hover; always visible on mobile) | `PATCH/DELETE /api/links/:id` | works | manual (Playwright walk) |
| Bulk create | Up to 200 URLs at once, common tag + UTM | Links › "Bulk create" | `POST /api/links/bulk` | works | manual |
| Import from Bitly (CSV) | Bring existing links | Settings › Import | `POST /api/links/import` | works | e2e `link-domains.spec` "importar un CSV de Bitly"; unit `bitly-import.test.ts` |
| Export | CSV of links, CSV of clicks per link | Settings › Export; link detail › Click log › Export CSV | `GET /api/links/export`, `GET /api/links/:id/export.csv` | works | manual |
| Analytics | Totals, today, range vs previous range, chart, referrers, countries, devices, browsers, OS | Link detail | `GET /api/links/:id/analytics` | works | manual |
| Click log | Paginated raw clicks, country filter (applies when you change it) | Link detail › Click log | `GET /api/links/:id/clicks` | works | manual |
| QR code | SVG/PNG download | Link detail › QR (header button jumps there) | `GET /api/links/:id/qr` | works | manual |
| Edit link | Destination, slug, title, tags, redirect type, expiry, max clicks, password, OG | Link detail › Edit (header button) | `PATCH /api/links/:id` | works (form at the bottom of the page, not inline) | manual |
| Password gate | Password-protected redirect, brute-force limit | public `/gate/<slug>` | `POST /api/gate` | works | e2e `flows.spec` gate tests |
| Expiry / click limit | Link stops redirecting (gone page) | — | — | works | unit `links.test.ts` |
| Custom domains | Own domain with independent slugs + DNS verification | Settings › Domains | `/api/links/domains` | works | e2e `link-domains.spec` |
| Link-in-bio | Public `/@handle` page with chosen links, ordered | Bio page | `PUT /api/links/bio` | works (no live preview) | e2e `link-domains.spec` "página bio pública" |
| API keys + REST API | Programmatic access | Settings › API | `/api/keys`, `/api/v1/*` | works | unit `roles-and-secrets.test.ts` |
| Webhooks | Click/link events to an URL | Settings › Webhooks | `/api/webhooks` | works | manual |
| Bulk select / bulk actions in the table | Select many links, then archive, unarchive, tag or delete them (delete is admin only; ids from other workspaces are ignored) | Links table (checkboxes + bulk bar) | `POST /api/links/batch` | works | unit `link-bulk.test.ts` |
| Geo/device targeting, A/B destinations | Rules by country and device (first match wins, up to 20), then weighted A/B destinations (up to 5), sticky per visitor via the `zs_vid` cookie. Clicks record which rule or variant served them | Link detail › Targeting | `PATCH /api/links/:id` (`targeting`) | works | unit `link-targeting.test.ts` |
| Deep links (iOS / Android) | App URL per platform (custom scheme or universal link) with a fallback (store or web) if the app doesn't open | Link detail › Targeting | `PATCH /api/links/:id` (`targeting.ios` / `targeting.android`) | works (no deferred deep linking after install) | unit `link-targeting.test.ts` |
| Branded QR | Foreground/background colors with a contrast check, dot shape (square, rounded, dots), centered logo; SVG/PNG. Scans (`?qr=1`) are counted apart from clicks | Link detail › QR | `GET/PUT /api/links/:id/qr` | works (no frames or templates) | unit `link-analytics.test.ts` (scans) |
| Workspace analytics | Clicks and QR scans across all links for a range (max 366 days) vs the previous range: by day, top links, referrers, countries, devices, browsers; CSV export | Links › Analytics | `GET /api/links/analytics`, `GET /api/links/analytics/export.csv`, `GET /api/v1/links/analytics` | works (no tag, domain or link filters) | unit `link-analytics.test.ts` |
| Folders / per-folder permissions | Group links, share with view/edit per folder | — | — | missing | — |
| Analytics filters | Filter workspace analytics by tag, domain, link, country or device; choose the timezone | — | — | missing | — |
| Query parameter forwarding | Pass `?utm_…` from the short link to the destination | — | — | missing | — |

### Top gaps (Link)
1. No folders or per-folder sharing; every member of the workspace sees every link.
2. Workspace analytics can't be filtered by tag, domain or link, and there's no shareable read-only analytics page.
3. Edit is a long form at the bottom of the detail page. It should be a side panel or modal.
4. Bio page editor has no live preview and doesn't let you add a link that isn't already a short link.
5. Query parameters on the short link aren't forwarded to the destination, and expired or missing links can't redirect to a custom URL.

## Cal (vs Calendly)

Verified against a DEMO_MODE dev server on desktop (1440×900) and mobile (390×844), plus the API.

| Feature | What it does | Where in the UI | API endpoint | Status | Test |
| --- | --- | --- | --- | --- | --- |
| Quick-create event type | Modal with name, auto slug, duration (15/30/45/60/custom) and location. Starts active with Mon–Fri 9–17 hours. Opens with `C`, the button, sidebar "New" or Cmd+K | Cal › Overview / Event types (`?new=1`). `/event-types/new` redirects here | `POST /api/calendar/event-types` + `POST …/{id}/availability` | works | e2e `flows.spec.ts` › "Cal: crear event type desde el modal rápido…", "Cal: /event-types/new abre el modal…" |
| Event type list actions | Inline on/off switch, copy link, open booking page, delete | Overview, Event types | `PATCH/DELETE /api/calendar/event-types/{id}` | works | e2e "Cal: crear event type desde el modal rápido…" |
| Edit event type | Title, slug, duration, color, location, description, branding (color, logo, welcome), buffers, notice, horizon, guests, single-use link, custom questions, host pool. Sticky Save shows "Saved ✓" | Event type detail | `PATCH /api/calendar/event-types/{id}` | works | e2e `cal-api.spec.ts` (API) |
| Delete event type | Delete from the detail header or the list. The confirm says bookings are deleted too | Event type detail / list | `DELETE /api/calendar/event-types/{id}` | works (was missing from the UI) | e2e "Cal: crear event type desde el modal rápido…" |
| Availability schedules | Reusable schedules (name, timezone, weekly hours) assigned to event types, plus date overrides (day off or different hours on a date). One is the default | Cal › Availability; Event type detail › Availability | `/api/calendar/schedules`, `/api/calendar/schedules/{id}` | works | unit `cal-schedules.test.ts` |
| Blocked slots | One-off busy ranges across all event types | Overview › Blocked slots | `/api/calendar/blocked-slots` | works | unit `calendar-slots.test.ts` ("excluye bookings confirmados y bloqueos") |
| Public booking page | Month calendar (available days highlighted), slots in the guest's timezone, form with custom questions | `/{locale}/book/{handle}/{slug}` | `GET …/slots`, `POST /api/calendar/bookings` | works | e2e `flows.spec.ts` › "Cal: crear evento, ver slots y reservar" |
| Public profile | Lists the user's active event types | `/{locale}/book/{handle}` | — | works | e2e "Cal: cambiar el handle…" |
| Handle and global defaults | Handle, timezone, week start, buffers, notice, horizon | Cal › Settings | `GET/POST /api/calendar/config` | works | e2e "Cal: cambiar el handle actualiza el link público" |
| Guest reschedule / cancel | Link in the confirmation email | `/manage/{token}` | `/api/calendar/bookings/manage` | works | e2e `cal-guest.spec.ts` |
| Bookings admin | Search, status filter (confirmed, pending, cancelled, no-show), date range, details, host cancel, mark as no-show, host-side reschedule to a free slot | Cal › Bookings | `GET /api/calendar/bookings?q=&status=&from=&to=`, `PATCH /api/calendar/bookings/{id}`, `POST /api/calendar/bookings/{id}/reschedule` | works | unit `cal-admin.test.ts` |
| Emails + .ics + reminders | Confirmation in the guest's language with .ics; cron reminders | — | `/api/calendar/reminders/due` | works | unit `cal-emails.test.ts` |
| Google Calendar | Busy times block slots; creates the event with Meet | Settings › Google Calendar | `/api/integrations/google-calendar/*` | partial: needs OAuth env vars; no Outlook/iCloud | unit `google-calendar.test.ts` |
| Round-robin / team hosts | Host pool per event type; assigns a free host | Event type detail › Hosts (with a team) | event-types `hostIds` | works (no collective events) | unit `calendar-slots.test.ts` (round-robin) |
| Single-use links | Link expires after one booking | Event type detail › Booking rules | event-types `singleUse` | works | — |
| Routing forms | Questions → rules → event type. Quick-create modal opens the editor; delete from the header | Cal › Routing forms | `/api/calendar/routing/*` | works | e2e "Cal: routing form rápido abre el editor y se borra…" |
| Embed | Inline / popup script for third-party sites | Event type detail › Embed | `/api/calendar/embed.js` | works | e2e `cal-embed.spec.ts` |
| Public API v1 + webhooks | Signed booking webhooks | Settings (API keys / webhooks) | `/api/v1/*` | works | e2e `cal-api.spec.ts` |
| Payments (Stripe) | Price per event type, charged through Stripe Checkout with the workspace's own Stripe key (encrypted). The slot is held 35 min while the guest pays; the Stripe webhook confirms it. Cancelling a paid booking refunds it in full | Cal › Settings (Stripe key); Event type detail (price) | `/api/calendar/payments`, `POST /api/calendar/payments/webhook/{token}` | works | unit `cal-payments.test.ts` |
| Workflows (email steps) | Up to 10 steps per event type: an email to the guest or the host, X minutes before or after the start, with its own subject, body and variables. Steps replace the default 24 h reminder; a no-show stops later steps | Event type detail › Workflows | `/api/calendar/event-types/{id}/workflows` | works (email only; sent by the hourly cron, so up to an hour late) | unit `cal-workflows.test.ts` |
| SMS / WhatsApp reminders | — | — | — | missing | — |
| Group / collective events, seats | Several invitees per slot, all hosts required | — | — | missing | — |
| Analytics | Bookings over time, conversion | — | — | missing (only "bookings this week") | — |

### Top gaps (Cal)
1. Calendar sync is Google only: no Outlook or iCloud, and there is no conflict check across several calendars.
2. No group or collective events (seats, all hosts required).
3. Reminders are email only, and they go out from the hourly cron, so an "X minutes before" step can arrive up to an hour late.
4. No analytics beyond the weekly count (created, cancelled, no-show, popular times).
5. Locations are a free-text field: no structured Zoom/Teams/phone options for the guest to pick.

## Chat (vs Intercom)

Verified on a DEMO_MODE dev server (desktop 1440×900 and mobile 390×844), exercising the flows with Playwright.

| Feature | What it does | Where in the UI | API endpoint | Status | Covering test |
|---|---|---|---|---|---|
| Widgets: create | Name + color in a quick modal (`C` shortcut), then lands on the widget config with the embed snippet | Chat › Overview › "New widget" (also `/app/chat/widgets/new`) | `POST /api/chat/widgets` | works | e2e `flows.spec.ts` "Chat: crear widget desde el overview con "C"…"; "Chat: el widget manda un mensaje…" (API) |
| Widgets: configure | Name, color, position, welcome message, pre-chat fields, AI bot, office hours | Chat › widget › Widget tab | `PATCH /api/chat/widgets/:id` | works | — (manual) |
| Widgets: delete | Delete with a named confirmation, list refreshes in place | Overview / Settings › widget row › Delete | `DELETE /api/chat/widgets/:id` | works | — (manual, Playwright walk) |
| Embed snippet | Script tag to paste on the site | Chat › widget › Widget tab (side) | `GET /api/chat/widget.js` | partial — snippet host differs between SSR and client (hydration warning, owned by the embed work) | `cal-embed.spec.ts` covers Cal only |
| Visitor messaging (widget) | Visitors send messages cross-origin (CORS), threads persist | Embedded widget | `POST/GET /api/chat/messages`, `/api/chat/messages/upload`, `/api/chat/typing`, `/api/chat/read`, `/api/chat/identify` | works | e2e "Chat: el widget manda un mensaje y aparece en el inbox" |
| Inbox | Tabs Open/Pending/Snoozed/Resolved/All/Unassigned/Mine, search (`/` focuses), load more, auto-refresh every 10 s | Chat › Inbox | `GET /api/chat/conversations` | works | `screens.spec.ts` (`/en/app/chat`), Playwright walk |
| Conversation: reply | Enter sends, Shift+Enter new line, `/` opens canned-response picker (↑/↓/Enter) | Inbox › conversation | `POST /api/chat/conversations/:id/messages` | works | e2e "Chat: responder con Enter (y "/" inserta…) y resolver" |
| Conversation: status / priority / assignee / snooze | Inline selects in the thread header; Resolve/Reopen primary button | Inbox › conversation header | `PATCH /api/chat/conversations/:id` | works | e2e "…y resolver" |
| Conversation navigation | `J` / `K` next/previous conversation; side list spans all widgets | Inbox › conversation | — | works | — (manual) |
| Attachments | Upload files/images/audio from the composer | Composer ⊕ | `POST /api/chat/conversations/:id/attachments` | works (not re-verified with real Blob storage) | — |
| Typing indicator / read receipts | "Visitor is typing…", "Read" on agent messages | Thread | `/api/chat/conversations/:id/typing`, `/read` | works | — |
| SLA | Per-priority first-response/resolution targets, "Reply in Nm" and breach badges | Widget › SLA policies; inbox badges | `GET/PUT /api/chat/widgets/:id/sla` | works | — (unit coverage of SLA math: none found) |
| Assignment rules | Keyword / time range / catch-all / round-robin, ordered, toggle active, quick modal create/edit | Widget › Assignment rules | `/api/chat/widgets/:id/rules`, `/api/chat/rules/:id`, `/api/chat/rules/:id/reorder` | works | e2e "Chat: respuestas guardadas y reglas se crean en un modal…" |
| Canned responses | Shortcut + body (title optional), quick modal create/edit, click row to edit | Widget › Canned responses | `/api/chat/widgets/:id/canned`, `/api/chat/canned/:id` | works | e2e "Chat: respuestas guardadas y reglas…" |
| People | Visitor list with search; detail with conversations and auto-saving notes | Chat › People | `GET /api/chat/visitors`, `PATCH /api/chat/visitors/:id` | works | Playwright walk |
| CRM link | Create CRM contact / log conversation to the contact timeline (needs visitor email) | Conversation › visitor panel | `POST /api/chat/conversations/:id/crm` | works | — (manual) |
| AI / keyword bot | Answers until a human replies, hands off as high priority | Widget › AI bot | (server side, `lib/chat-bot-ai.ts`) | works with `AI_GATEWAY_API_KEY`; keyword fallback otherwise | unit `chat-bot-ai.test.ts` |
| CSAT | 1–5 rating after resolve, average in reports | Chat › Settings | `POST /api/chat/csat` | works | — |
| Reports | Conversations, avg first response, avg resolution, resolved count and CSAT for a date range (default last 30 days), in total and per assigned agent; CSV export | Chat › Reports | `GET /api/chat/reports?from=&to=` | works (no per-widget breakdown) | unit `chat-inbox.test.ts` |
| Internal notes | Agent messages marked as a note; the visitor never sees them. `@` mentions a teammate and sends a notification | Conversation composer (Reply / Note toggle) | `POST /api/chat/conversations/:id/messages` (`note`, `mentions`) | works (with @mentions that notify the agent; notes can't be edited or deleted) | unit `chat-inbox.test.ts` |
| Conversation tags | Add/remove normalized tags per conversation; workspace tag list with counts | Conversation header | `/api/chat/conversations/:id/tags`, `GET /api/chat/tags` | works | unit `chat-inbox.test.ts` |
| Macros | A canned response can also set status, assign, snooze or add tags when inserted | Widget › Canned responses | `/api/chat/canned/:id` (`actions`) | works | unit `chat-inbox.test.ts` |
| Help center + widget Help tab | Published Docs pages form a public help center at `/h/<handle>` (collections, BM25 search, "Was this helpful?" vote). With help enabled, the widget shows a Help tab that lists and searches those articles | Widget tab (Help toggle); Docs › Share › Publish | `GET /api/chat/help`, `POST /api/docs/help/feedback` | works (no custom domain on Cloud) | unit `docs-help.test.ts` |
| Office hours / away message | Widget shows away state outside hours | Widget tab | — | works | — |
| Email / WhatsApp / social channels | — | — | — | missing (Intercom: omnichannel inbox) | — |
| Proactive messages / outbound campaigns | — | — | — | missing | — |
| Public API / webhooks for chat events, transcript export | — | — | — | missing | — |
| Bulk actions in the inbox, real-time push | — | — | — | missing (inbox refreshes every 10 s) | — |

### Top gaps (Chat)

1. Single channel (web widget). No email inbound/outbound replies when the visitor leaves the page.
2. No public API or webhooks for chat events, and no transcript export.
3. Notes and agent messages can't be edited or deleted, and there are no AI tools for agents (summarize, rephrase, translate).
4. No proactive/outbound messages, and no bulk select in the inbox.
5. Topbar breadcrumb says "Overview" on widget sub-pages (app shell, not Chat code); embed snippet host causes a hydration warning on the widget page (embed work in progress).

## Docs (vs Notion)

Verified on DEMO_MODE (desktop 1440×900 and mobile 390×844) by driving the UI with Playwright.

| Feature | What it does | Where in UI | API endpoint | Status | Covering test |
|---|---|---|---|---|---|
| Page tree | Nested pages with collapsible branches (state remembered per browser); the current page's ancestors are always expanded | Docs sidebar (landing + editor); on mobile it folds into a "Pages (n)" toggle | `GET /api/docs/pages` | works | e2e `Docs: "C" crea una página…`, `Docs: en mobile el árbol se pliega…`; `screens.spec` `/en/app/docs` |
| New page (one click + shortcut) | Creates a blank page, opens it and focuses the title | Sidebar "+", sidebar footer "New page", landing primary button, `C` key | server action `createDocPageAction` (`POST /api/docs/pages` for API) | works | e2e `Docs: "C" crea una página…` |
| New subpage | Creates a child page in one click | Hover "+" on any tree row (always visible on mobile) | `POST /api/docs/pages` (`parent_id`) | works | e2e `Docs: subpágina desde el árbol…` |
| Move and reorder pages | Drag a row onto another row to nest it, or above/below it to reorder among siblings; "Move up" / "Move down" in the row menu as the keyboard alternative | Sidebar tree | server actions `moveDocPageAction`, `reorderDocPageAction`, `moveDocPageStepAction` | works | unit `docs-tree.test.ts` |
| Inline title editing | Edit the title in place; it autosaves and shows in the breadcrumb and tree | Editor title | `PATCH /api/docs/pages/:id` | works | e2e `Docs: "C" crea una página…` |
| Autosave | Saves 600 ms after the last edit. The status reads "Saving…" while there are unsaved changes. Pending edits are sent when you leave the page | Editor top bar status | `PATCH /api/docs/pages/:id` | works | e2e `Docs: "C" crea una página…` |
| Blocks | Text, H1–H3, bulleted/numbered lists, to-do, quote, code, divider, table; `/` menu; markdown shortcuts; drag to reorder; block menu (turn into, duplicate, delete, move) | Editor | `PATCH /api/docs/pages/:id` (`content`) | works | unit `docs-sanitize.test.ts`; manual walk |
| Rich text | Bold, italic, underline, strikethrough, inline code, links | Selection toolbar, ⌘B/⌘I/⌘U | — | works | unit `docs-sanitize.test.ts` |
| Database block | Inline table with text/select/date/number columns and a table/gallery toggle | `/database` | stored in `content` | partial (no filter/sort/group, no full-page database, no relations) | manual walk (`/database` inserted and rendered) |
| Page links and @mentions | `[[` links another page; `@` mentions a workspace member | Editor | `GET /api/docs/search`, `GET /api/docs/members`, `POST /api/docs/pages/:id/mentions` | works | — (manual) |
| Icon (emoji) | Pick a page emoji | Click the page icon | `PATCH` (`icon`) | works (search matches emoji names) | manual walk |
| Cover | Cover image from a pasted URL or one of 4 presets | "Add cover" under the title | `PATCH` (`cover_url`) | partial (no upload) | — |
| Comments | Page comments and per-block threads; resolve, reopen, delete; open count shown on the button | "Comments" in the top bar, the per-block comment icon, or "Add comment" | `GET/POST /api/docs/pages/:id/comments`, `PATCH/DELETE …/comments/:commentId` | works | e2e `Docs: Share y Comments se abren a demanda…` |
| Share | "Anyone signed in with the link" (view only); share with a team or a member with a view or edit role; copy link. View shares open a read-only page in the app (with print/PDF), edit shares open the editor | "Share" in the top bar | `POST /api/docs/pages/:id/share`, `DELETE …/share/:shareId` | works (inside the workspace every member can edit; no per-page read-only for members; sharing isn't inherited by subpages) | unit `docs-share-versions.test.ts`; e2e `Docs: Share y Comments se abren a demanda…` |
| Trash | "Move to trash" archives the page and its subpages. Restore brings back the whole branch. "Delete forever" lives in the trash. A page that's in the trash shows a banner with Restore | Page "···" menu → Move to trash; landing "Trash (n)" section; sidebar "Trash" link | `PATCH` (`archived`), `DELETE /api/docs/pages/:id` | works | e2e `Docs: subpágina desde el árbol y papelera…` |
| Duplicate page | Copies the page and its subpages | "···" → Duplicate | `POST /api/docs/pages/:id/duplicate` | works | — (manual) |
| Templates | Untitled, meeting notes, project spec, weekly retro | Landing, "Start from a template" | server action `createDocPageFromTemplateAction` | works (4 templates; Notion has a gallery) | — |
| Recent pages | Last 10 edited pages with localized "Edited <date>" | Landing | — | works | `screens.spec` |
| Global search | Docs pages appear in ⌘K | App ⌘K | `GET /api/search` | works | — |
| Page options | Copy link, copy contents, small text, full width | "···" menu | — | works (small text and full width aren't persisted) | — |
| Version history / restore | Automatic snapshot at most every 5 min while editing, manual "Save version", up to 50 per page. Restore saves the current state first | Version history panel (editor and read-only view) | `GET/POST /api/docs/pages/:id/versions`, `GET …/versions/:versionId`, `POST …/versions/:versionId/restore` | works (no diff highlighting) | unit `docs-share-versions.test.ts` |
| Real-time collaboration | — | — | — | missing (optimistic concurrency: a stale save gets a 409 and the editor offers "Load the new version" or "Overwrite with my changes") | — |
| Export | One page to Markdown (`.md` download) or PDF through the print dialog | Page "···" menu | `GET /api/docs/pages/:id/export?format=md` | partial (one page at a time; no workspace export, no HTML) | — (manual) |
| Import (Markdown, .docx, Notion) | — | — | — | missing | — |
| Help center (public web publishing) | Published pages become a public help center at `/h/<handle>`: collections from top-level published pages, BM25 search, per-article "Was this helpful?" votes (counts in the Share panel). The Chat widget can show it in a Help tab | Share › Publish; public `/h/<handle>/<slug>` | `PATCH /api/docs/pages/:id` (`published`), `POST /api/docs/help/feedback` | works (no custom domain on Cloud; no images or video blocks; no search analytics) | unit `docs-help.test.ts` |

### Top gaps (Docs)
1. **No real-time collaboration.** A second editor gets a conflict warning instead of a merge, and there's no live presence.
2. **Databases are basic.** There are no filters, sorts, grouping, board/calendar views, full-page databases or relations.
3. **No import and no workspace export.** Export is one page at a time (Markdown or PDF); there's no Notion, Markdown or .docx import, and covers can't be uploaded.
4. **Search is title only** in the app (the help center searches content), and there are no custom templates or backlinks.
5. **Help center** has no custom domain on Cloud and articles can't hold images or video.
6. **Sharing isn't inherited** by subpages, and members of the workspace always have edit access.

## Track (vs Linear)

Checked against the code on 2026-10-18 (routes, components and unit tests); not re-walked in the browser.

| Feature | What it does | Where in the UI | API endpoint | Status | Covering test |
|---|---|---|---|---|---|
| Projects | Each project owns its issues, statuses, cycles, members and saved views; identifiers come from the slug (`APP-1`) | Track › Projects | `/api/track/projects`, `/api/track/projects/:id` | works | e2e `flows.spec` "Track: crear proyecto e issue" |
| Issues | Title, description, status, priority, assignee, labels (up to 10), start/due date, estimate, cycle; sub-issues; relations `blocks` / `related` / `duplicates` shown from both ends; comments with @mentions; attachments up to 10 MB; activity log | Project page, issue detail | `/api/track/issues/:id`, `…/children`, `…/relations`, `…/comments`, `…/attachments`, `…/activities` | works (description is plain text; authors can't edit their comments) | unit `track-gauntlet-r2.test.ts`, `track-issues-access.test.ts` |
| Views | List, board (drag a card to another column), calendar by due date, Gantt (drag bars) | Project page › view switcher | `/api/track/projects/:id/issues` | works | e2e `flows.spec` |
| Saved views | Named view + filters + sort, one default per project | Project page › Saved views | `/api/track/projects/:id/views`, `/api/track/views/:id`, `…/default` | works (personal only; not shared with the team) | — |
| Statuses | Add, rename, recolor, reorder and delete statuses (delete reassigns the issues), each mapped to backlog / todo / in progress / done / cancelled | Project › Settings › Statuses | `/api/track/projects/:id/statuses`, `…/statuses/reorder`, `/api/track/statuses/:id` | works | unit `track-cycles.test.ts` "borrar con reasignación" |
| Cycles | Create (next number and dates suggested, overlap check), edit, delete; progress done/total; "Complete" moves unfinished issues to the next cycle (or to a chosen one / none) | Project › Settings › Cycles | `/api/track/projects/:id/cycles`, `/api/track/cycles/:id`, `POST /api/track/cycles/:id/complete` | works (no velocity or burndown; cycles aren't created on a cadence) | unit `track-cycles.test.ts`, `track-gauntlet-r3.test.ts` |
| Triage | Issues from API, Chat, Flow, GitHub or Agents wait in a queue when the project has triage on: accept (pick status), decline, or mark duplicate | Project › Triage; banner on the issue | `/api/track/projects/:id/triage`, `/api/track/issues/:id/triage` | works | unit `track-gauntlet-r4.test.ts`, `track-gauntlet-r5.test.ts` |
| GitHub integration | Per-workspace webhook with its own secret (encrypted) and repo list. PRs and commits naming an issue (`APP-12`) in branch, title, body or message get linked; optionally PR opened → in progress, merged → done. Suggested branch name per issue | Track › Settings; issue detail › GitHub | `/api/track/github`, `POST /api/track/github/webhook/:hookId`, `/api/track/issues/:id/github` | works (GitHub only, no GitLab; no installable GitHub App) | unit `track-github.test.ts` |
| Keyboard shortcuts | `C` new issue, `J`/`K` move through issue rows, `Enter` opens, `X` selects, `Esc` clears the selection | Everywhere under /app/track | — | works (no command palette, no property shortcuts) | — (manual) |
| Bulk edit | Select up to 200 issues and change status, priority, assignee, cycle or labels | Lists (checkbox, shift-click, `X`) | `POST /api/track/issues/bulk` | works | unit `track-labels-bulk.test.ts`, `track-gauntlet-r4.test.ts` |
| Inbox, My tasks | Notifications for mentions, assignments, status changes and comments; issues assigned to you across projects | Track › Inbox, My tasks | — | works (no email notifications or digest) | — |
| Public API / webhooks | — | — | — | missing (internal session routes only; Flow can create issues) | — |
| Real-time sync | — | — | — | missing (refresh to see a teammate's change) | — |
| Import (Linear, Jira) | — | — | — | missing | — |
| Issue templates, recurring issues, milestones | — | — | — | missing | — |

### Top gaps (Track)
1. No public API or webhooks (`/api/v1` covers Link, CRM, Cal and Agents only).
2. No real-time updates and no command palette.
3. Cycles have no velocity or burndown and aren't created on a cadence; completing a cycle doesn't log activity on the moved issues.
4. Descriptions and comments are plain text; no issue templates, recurring issues or milestones.
5. No importer from Linear or Jira, and saved views can't be shared with the team.

## CRM (vs HubSpot)

Verified on 2026-10-13 against a DEMO_MODE dev server with seed data (desktop 1440×900 + mobile 390×844), driving the flows through Playwright. "flows.spec" means `tests/e2e/flows.spec.ts`, "screens.spec" means `tests/e2e/screens.spec.ts`, and "crm.test" means `tests/unit/crm.test.ts`.

| Feature | What it does | Where in the UI | API endpoint | Status | Covering test |
|---|---|---|---|---|---|
| Contacts list | Searchable, sortable table with lifecycle, lead status and owner filters, saved views, column toggle, bulk actions | Contacts | `GET /api/crm/contacts`, `/views`, `/contacts/bulk` | works | screens.spec; flows.spec "CRM: contacto, deal y nota…" |
| Quick-create contact | Modal over the list (name, email, phone, company, lifecycle). Opens with the `C` key or `?new=1`. "Create more" stays open, "All fields" opens the full form | Contacts › New contact | `POST /api/crm/contacts` | works (new) | flows.spec "alta rápida de contacto con la tecla C" |
| Quick-create company | Modal (name, domain, industry). `/companies/new` opens it on the list | Companies › New company | `POST /api/crm/companies` | works (new) | flows.spec "/new abre el modal…" |
| Quick-create deal | Modal (name, pipeline, stage, amount, close date). Defaults to the pipeline shown on the board | Deals › New deal | `POST /api/crm/deals` | works (new) | flows.spec "deal rápido desde el board" |
| Full create forms | All properties and custom fields | `/crm/{contacts,companies,deals}/new?full=1` | same | works | manual |
| Inline cell edit | Edit name, email, phone, company, lifecycle and stage from the table | Contacts / Companies / Deals tables | `PATCH /api/crm/{entity}/[id]` | works (rendered; not re-exercised this pass) | — |
| Record detail | Properties rail, timeline and associations (company, deals, lists), duplicates, history, danger zone. Uses hairlines instead of stacked cards | `/crm/contacts/[id]`, `/companies/[id]`, `/deals/[id]` | `GET/PATCH/DELETE /api/crm/{entity}/[id]` | works | flows.spec |
| Activity timeline | One tab row (All, Notes, Tasks, Calls, Meetings, Emails, with counts). The selected tab picks the composer type. Pin, edit and delete actions appear on hover | Record detail › Timeline | `POST/PATCH/DELETE /api/crm/activities` | works (fixed: double tabs) | flows.spec "una sola fila de tabs" |
| Email from timeline | Sends as the user through their Gmail (gmail.send), or through the system sender if Gmail is not connected. Template and snippet pickers, variable preview with missing-variable warning, "Draft with AI" (only when AI is enabled), per-email tracking toggle, reply inside a thread | Timeline › Email | `POST /api/crm/emails`, `/api/crm/email-templates/preview`, `/api/crm/emails/draft` | works (Gmail send needs OAuth client + re-consent) | crm-email.test |
| Gmail sync | Automatic incremental sync per mailbox (Gmail history API, stored historyId, full 30-day fallback when it expires), from the hourly cron (bounded, row lock) and "Sync now". Stores body (text + sanitized HTML, capped), thread, In-Reply-To; links each email to every workspace contact in from/to/cc. Timeline groups emails into threads (expand/collapse) on contacts, companies and deals | Settings › Integrations | `/api/integrations/gmail/*` | works (needs OAuth client) | crm-email.test "Gmail sync" |
| Open/click tracking | Pixel `/api/crm/t/o/<token>.gif` + HMAC-signed click redirect `/api/crm/t/c/<token>?u=&s=` (no open redirect). Bot/scanner user agents, GoogleImageProxy first hit within 2 min and hits within 5 s of sending are ignored; repeats within 1 min are deduped. Timeline shows "Opened 3× · clicked …", the owner gets a notification, Flow gets `email.opened` / `email.clicked`, workflows get `email_opened` / `email_clicked`. Workspace setting + per-email toggle | Timeline, Settings › Integrations | `/api/crm/t/*`, `/api/crm/email-settings` | works | crm-email.test "Tracking" |
| Email templates & snippets | Shared per workspace, variables `{{contact.first_name}}`, `{{contact.company}}`, `{{deal.name}}`, `{{owner.first_name}}`, `{{contact.custom.x}}`, fallback `{{var \| default}}`. Members use them, admins or the creator edit. Preview with a contact | Templates | `/api/crm/email-templates*`, `GET /api/v1/crm/email-templates` | works (new) | crm-email.test "Templates" |
| Sequences | Ordered steps (email from template or custom, sent as a reply in the same thread; task; wait N days), business days, send window + time zone. Enroll from the contact page, contacts bulk bar, workflow action `enroll_in_sequence`, Flow node "CRM: enroll in sequence" or API. Auto-exit on reply (Gmail sync), Cal booking or unsubscribe (signed link + List-Unsubscribe). Per-step sent/opened/clicked/replied. Runs from the hourly cron, so steps go out within an hour of being due | Sequences | `/api/crm/sequences*`, `/api/v1/crm/sequences*` | works (new; needs Gmail with send scope) | crm-email.test "Secuencias" |
| Deals board | Kanban per pipeline with drag between stages, won/lost with reason, rotting indicator, totals | Deals (Board) | `POST /api/crm/deals/[id]/move` | works (board rendered; drag not re-exercised) | flows.spec (board renders) |
| Deals table | Table view with filters and inline stage | Deals (Table) | `GET /api/crm/deals` | works | screens.spec |
| Pipelines & stages | Create and rename pipelines, add, reorder and delete stages, set probability and won/lost flags | Settings › Pipelines (inline-editable rows) | `/api/crm/pipelines`, `/stages` | works | manual |
| Custom fields | Text/number/select/date fields per entity | Settings › Custom fields | `/api/crm/custom-fields` | works | manual |
| Import / export CSV | Paste or upload CSV, map columns, then import contacts, companies or deals (pipeline/stage by name, amount, currency, close date). Owners by email or name, custom fields, associations (company by name/domain, contacts by email), saved mapping presets and a built-in "HubSpot export" preset. Export as CSV or JSON | Settings › Import / Export | `/api/crm/import`, `/api/crm/import/presets`, `/api/crm/export` | works | crm-import.test |
| Team / workspaces | Create a team, invite members, set roles, switch workspace | Settings › Team | `/api/teams/*` | works | crm.test (owner must be member) |
| Tasks | Overdue, Today, Upcoming and Done buckets. Owner and project filters, quick-create modal (`C`), projects | Tasks | `/api/crm/activities`, `/api/crm/tasks/projects` | works (fixed: CTA placement, modal) | flows.spec "tarea rápida con la tecla C"; crm.test task_due |
| Lists | Static and dynamic lists with a real member count | Lists | `/api/crm/lists`, `/lists/[id]/members` | works | crm.test "listas dinámicas" |
| Duplicates & merge | Find likely duplicates and merge them, moving deals, activities and emails | Contact detail › Possible duplicates | `/api/crm/contacts/duplicates`, `/merge` | works | crm.test "merge de contactos" |
| Workflows | Triggers (record created/changed, task due, email received/opened/clicked, meeting booked, quote accepted, form submitted, score changed) and actions (create task, update field, send email, webhook, enroll in sequence, run a Flow). If/else: a branch action on a property, later actions run on yes / no. Delays live in Flow | Workflows | `/api/crm/workflows/*` | works | crm.test "workflows"; crm-forms.test "workflows v2" |
| Reports | Overview, funnel, forecast, sources, owners, activity and conversion. Range, bucket and filters. Saved reports | Reports | `GET /api/crm/reports` | works (fixed: compact save, tabs, duplicate "other" rows) | flows.spec "guardar un reporte"; crm.test "reportes por fuente" |
| Dashboards | Multiple dashboards with drag/resize widgets (KPI, funnel, forecast, charts) | Dashboards | `/api/crm/dashboards/*` | works (fixed: widgets overlapped/stretched) | flows.spec "widgets del dashboard no se superponen" |
| Book meeting | Book a Cal meeting from a contact or deal. Bookings create the contact and a meeting activity | Record header › Book meeting | `/api/crm/meeting-links` | works | crm-integrations.test "Cal → CRM" |
| Chat → CRM | Chat visitors with an email become contacts, and the conversation is logged | automatic | — | works | crm-integrations.test "Chat → CRM" |
| Global search | Search records from ⌘K | Sidebar search | `/api/crm/search` | works | manual |
| Record history | Audit log of property changes | Record detail › History | `/api/crm/history` | works | manual |
| Associations | Contact ↔ companies (many, with labels: employee, decision maker, billing, champion, influencer, former employee; one primary that `company_id` mirrors), deal ↔ companies (many, one primary), deal ↔ contacts. Add, remove, make primary and relabel from the record side panels | Record detail › side panels | `/api/crm/associations`, `GET/POST/DELETE /api/v1/crm/associations` | works (new) | crm-model.test "asociaciones" |
| Company hierarchy | Parent company picker, child companies list, breadcrumb of parents, rolled-up deal value (own vs. whole tree, open and won, base currency). Cycles are rejected | Company detail | `PATCH /api/crm/companies/[id]` (`parentCompanyId`) | works (new) | crm-model.test "jerarquía" |
| Products | Catalog with SKU, price, currency, recurring (none/monthly/yearly), tax %, active/archived. Quick-create modal (`C`) | Products | `/api/crm/products`, `/api/v1/crm/products` | works (new) | crm-model.test "dinero" |
| Line items | Product or custom lines on a deal (qty, unit price, discount %, tax %), rounded per line to the currency's minor unit. The deal amount follows the net total unless it's set by hand (override toggle) | Deal detail › Line items | `/api/crm/deals/[id]/line-items`, `/api/v1/crm/deals/{id}/line-items` | works (new) | crm-model.test "dinero" |
| Quotes | Created from a deal (snapshot of its line items, terms, notes, expiration, sender and recipient). Draft → sent → accepted / declined / expired. Public page `/q/<token>` with typed-name + checkbox acceptance (stores time and IP hash), decline with reason, print/PDF. Accepting logs a deal activity, notifies the owner, fires the `quote_accepted` workflow trigger and the Flow event `quote.accepted`, and can move the deal to the won stage (setting) | Quotes, Deal detail › Quotes | `/api/crm/quotes`, `/api/v1/crm/quotes` | works (new) | crm-model.test "quotes" |
| Tags | Workspace tags with a product-accent color on contacts, companies and deals. Filter lists by tag, bulk add/remove from the bulk bar, edit on the record header. Shown as a square dot + text | Lists, record headers, Settings › Tags | `/api/crm/tags*`, `/api/v1/crm/tags*` | works (new) | crm-model.test "tags" |
| Multi-currency | Workspace base currency and manual exchange rates. Deals, products and quotes keep their currency; reports, dashboards, board totals and company roll-ups convert to the base (missing rates count 1:1 and are listed) | Settings › Currency | `/api/crm/settings`, `/api/crm/exchange-rates` | works (new) | crm-model.test "multi-moneda" |
| Forms / lead capture | Builder with text/email/phone/dropdown/checkbox/long text/hidden fields mapped to contact or company properties (custom fields too), required flags, consent checkbox, button text, thank-you message or redirect. Per form: lifecycle, lead status, source, fixed owner (or round-robin), list, tags, sequence, notify owner/emails, dedupe by email. Hosted page `/f/<slug|token>` and embed script (iframe, auto-height, passes UTM/gclid/fbclid and the page URL; hidden fields can read any URL param). Anti-spam: honeypot, minimum time to submit, rate limit per IP (5/min per form, 30/h total). Each submission creates/updates the contact, logs "Form submitted" on the timeline, fires the `form_submitted` workflow trigger and the Flow event `form.submitted`. Submissions table with detail and CSV export | Forms (`C` creates one), form › Build / Submissions / Share & embed | `/api/crm/forms*`, `POST /api/crm/forms/submit/<key>`, `/api/crm/forms/embed.js`, `GET /api/v1/crm/forms`, `GET /api/v1/crm/forms/{id}/submissions` | works (new) | crm-forms.test |
| Lead scoring | Rules on properties (equals / contains / greater than / is set…, custom fields included) and on activity in the last N days (emails opened/clicked/replied, meetings booked, form submissions, calls, notes) with positive or negative points. Recalculated on every relevant event and once a day from the cron. Score column (sortable, filterable in the advanced filter) and a "why" breakdown on the contact page. Workflow trigger `score_changed` with an optional threshold (up/down/either) and Flow event `contact.score_changed` | Settings › Lead scoring, Contacts, contact page | `/api/crm/scoring/*` | works (new) | crm-forms.test "lead scoring" |
| Record visibility & sales teams | Workspace setting for members: all records / only their own / their own + their sales teams'. Owners and admins see everything. Applied to lists, boards, record pages (404), associations, tags, quotes, ⌘K search, exports, reports, dashboards, quotas and the v1 API (a key acts as the person who created it). Sales teams CRUD | Settings › Access & teams | `/api/crm/visibility`, `/api/crm/sales-teams*` | works (new) | crm-teams.test "visibilidad" |
| API key scopes | crm:read/write, links:read/write, cal:read/write, agents:run chosen at creation (write implies read). Existing keys keep all scopes. 403 `insufficient_scope` | Settings › API keys | `/api/keys`, every `/api/v1/*` route | works (new) | crm-teams.test "scopes" |
| Lead assignment (round-robin) | Per-workspace rule: sources (forms, chat, Cal bookings, CSV import, API), ordered pool, persistent cursor (same approach as Cal hosts), out-of-office toggle skips people, assignment history and a notification to the new owner | Settings › Lead assignment | `/api/crm/assignment*` | works (new) | crm-teams.test "round-robin" |
| Quotas | Monthly or quarterly targets per owner for won value (base currency), deals won and meetings booked, with progress vs. expected pace | CRM overview, Reports, Settings › Quotas | `/api/crm/quotas*` | works (new) | crm-teams.test "cuotas" |
| Mobile | Lists, detail, settings and reports usable at 390 px without page-level horizontal overflow (tables scroll inside their wrapper) | all | — | partial (tables scroll sideways; no card layout) | manual |

### Top gaps (CRM)

1. Phone-width tables only scroll sideways, and row actions sit off-screen. HubSpot switches to a card or list layout on mobile.
2. Sequences, templates and tracking now exist, but sending as the user needs a Google OAuth client verified for `gmail.readonly` (restricted scope: Google security assessment) and `gmail.send` (sensitive). Until the app is verified, only test users can connect Gmail. Sequence steps run at hourly cron granularity.
3. Quotes have no e-signature provider, PDF attachment by email or payment collection (HubSpot quotes can take payments). Exchange rates are manual (no daily feed).
4. Forms have no multi-step pages, conditional fields, file uploads or CAPTCHA (honeypot + timing + rate limit only). There is no field-level permission yet.
5. Reports: the "By owner → Activities" column shows 0 while 200+ activities exist (activities without an owner aren't attributed). The funnel shows >100% conversion on closed stages (8 won after 4 in negotiation shows "200%").
6. The sidebar "New" menu and ⌘K still point at `/new`. That now opens the modal via redirect, but it costs a server round-trip. Deep-link the menu to `?new=1` (AppSidebar/CommandSearch were left untouched to avoid conflicts).
7. The seed creates a second "Sales" pipeline when `npm run seed` runs twice (duplicate pipelines show up in Settings and Reports).
