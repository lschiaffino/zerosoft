# PostHog capability benchmark for the Analytics parity table

Reference list of what PostHog offers, taken from PostHog's own docs and changelog in 2026-11. It exists so `content/feature-parity/analytics.ts` can be audited against the reference product. It records what PostHog has, not what zerosoft has.

How to read a line: `[row-id] Capability: what it does (doc URL)`. A row id that already exists in `analytics.ts` means that row covers exactly this capability. Every other id is a proposal. `(unverified)` means the evidence is thin, such as a search snippet or an undocumented schema field. `(beta)`, `(alpha)` and plan names are PostHog's own labels.

## Sources

Read date for everything below: 2026-11.

### Limits of this research

- Pages were read through WebFetch, which returns a model-written digest of the page and not the raw text. A digest can miss details, so a missing capability here does not prove PostHog lacks it.
- Docs only. Nothing was checked against the live PostHog app.
- YouTube: no video was watched and no YouTube page was read. One web search found third-party aggregator pages for walkthrough videos, but no official channel page. Nothing in this list comes from video.
- `https://posthog.com/llms.txt` was used to find pages. Its API reference section was read only as groups of resource names, not endpoint by endpoint.
- About 400 per-vendor source pages, per-framework install guides and per-provider AI install guides were not read one by one.

### Failed or unusable

- `https://posthog.com/docs/product-analytics/changelog.md`: returned only the placeholder "Loading changelog..."
- `https://posthog.com/feature-matrix`: returned navigation only
- `https://posthog.com/funnels`: returned navigation only
- `https://posthog.com/docs/product-tours`: returned navigation only
- `https://posthog.com/docs/product-tours/button-actions`: returned navigation only
- `https://posthog.com/docs/product-tours/customization`: returned navigation only
- `https://posthog.com/docs/data-pipelines/sources.md`: first chunk had headings without body text and cut off the source list at "Shippo"; the second chunk (offset 100000) supplied the body text, but the remaining source names were not listed
- `https://posthog.com/docs/libraries`: the last 2,179 characters were not read
- `https://posthog.com/docs/error-tracking/references.md`: fetched, but it is only a list of reference links, so no capability came from it

Ten fetches first failed with `write EPIPE` and succeeded on retry, so they appear in the read list below: customizing-destinations, customizing-transformations, batch-exports, sources, file-download-exports, drop-events, data-warehouse surfaces/web-app, views, views/materialize, join.

### Known only from search snippets (never fetched)

Lines that rely on these are marked `(unverified)`.

- `https://posthog.com/docs/references/posthog-js/types/ProductTourType`, `ProductTourStep`, `ProductTourBannerConfig` (same path prefix)
- `https://posthog.com/docs/cdp/transformations`
- `https://posthog.com/tutorials/cookieless-tracking`, `https://posthog.com/tutorials/nextjs-cookie-banner`, `https://posthog.com/tutorials/vue-cookie-banner`

### Read

Index and overview
- https://posthog.com/llms.txt (offsets 0, 100000, 200000, 300000, 400000)
- https://posthog.com/platform.md
- https://posthog.com/changelog/2026 (offsets 0, 100000, 200000, 300000; covers 2026-10-30 back to 2025-11-07)
- https://posthog.com/changelog.md (offset 0)

Product analytics
- https://posthog.com/docs/product-analytics.md
- https://posthog.com/docs/product-analytics/surfaces/web-app.md
- https://posthog.com/docs/product-analytics/insights.md
- https://posthog.com/docs/product-analytics/trends/overview
- https://posthog.com/docs/product-analytics/trends/charts
- https://posthog.com/docs/product-analytics/trends/aggregations
- https://posthog.com/docs/product-analytics/trends/formulas
- https://posthog.com/docs/product-analytics/trends/breakdowns
- https://posthog.com/docs/product-analytics/trends/filters.md
- https://posthog.com/docs/product-analytics/trends/statistical-analysis.md
- https://posthog.com/docs/product-analytics/trends/tips.md
- https://posthog.com/docs/product-analytics/funnels
- https://posthog.com/docs/product-analytics/correlation.md
- https://posthog.com/docs/product-analytics/retention
- https://posthog.com/docs/product-analytics/paths
- https://posthog.com/docs/product-analytics/stickiness
- https://posthog.com/docs/product-analytics/lifecycle
- https://posthog.com/docs/product-analytics/sql
- https://posthog.com/docs/product-analytics/dashboards
- https://posthog.com/docs/product-analytics/sharing.md
- https://posthog.com/docs/product-analytics/subscriptions.md
- https://posthog.com/docs/product-analytics/color-themes.md
- https://posthog.com/docs/product-analytics/schema-management.md
- https://posthog.com/docs/product-analytics/autocapture.md
- https://posthog.com/docs/product-analytics/group-analytics
- https://posthog.com/docs/product-analytics/identify.md
- https://posthog.com/docs/product-analytics/person-properties.md
- https://posthog.com/docs/product-analytics/privacy.md
- https://posthog.com/docs/alerts.md
- https://posthog.com/docs/notebooks.md

Data management
- https://posthog.com/docs/data.md
- https://posthog.com/docs/data/annotations.md
- https://posthog.com/docs/data/actions.md
- https://posthog.com/docs/data/cohorts.md
- https://posthog.com/docs/data/realtime-cohorts.md
- https://posthog.com/docs/data/persons.md
- https://posthog.com/docs/data/events.md
- https://posthog.com/docs/data/sessions.md
- https://posthog.com/docs/data/property-filters.md
- https://posthog.com/docs/data/channel-type.md
- https://posthog.com/docs/data/event-filtering.md
- https://posthog.com/docs/data/test-accounts.md
- https://posthog.com/docs/data/ingestion-warnings.md
- https://posthog.com/docs/data/comments.md
- https://posthog.com/docs/data/query-log.md
- https://posthog.com/docs/data/anonymous-vs-identified-events.md
- https://posthog.com/docs/data/events-retention.md
- https://posthog.com/docs/data/embedded-analytics-projects.md
- https://posthog.com/docs/data/utm-segmentation.md
- https://posthog.com/docs/activity.md

Web analytics
- https://posthog.com/docs/web-analytics/start-here.md
- https://posthog.com/docs/web-analytics/dashboard.md
- https://posthog.com/docs/web-analytics/surfaces/web-app.md
- https://posthog.com/docs/web-analytics/conversion-goals.md
- https://posthog.com/docs/web-analytics/web-vitals.md
- https://posthog.com/docs/web-analytics/live.md
- https://posthog.com/docs/web-analytics/bot-detection.md
- https://posthog.com/docs/web-analytics/managing-bot-traffic.md
- https://posthog.com/docs/web-analytics/marketing-analytics.md
- https://posthog.com/docs/web-analytics/path-cleaning.md
- https://posthog.com/docs/web-analytics/sending-http-logs.md

Feature flags
- https://posthog.com/docs/feature-flags/creating-feature-flags.md
- https://posthog.com/docs/feature-flags/surfaces/web-app.md
- https://posthog.com/docs/feature-flags/user-and-group-targeting.md
- https://posthog.com/docs/feature-flags/local-evaluation.md
- https://posthog.com/docs/feature-flags/bootstrapping.md
- https://posthog.com/docs/feature-flags/dependencies.md
- https://posthog.com/docs/feature-flags/early-access-feature-management.md
- https://posthog.com/docs/feature-flags/remote-config.md
- https://posthog.com/docs/feature-flags/scheduled-flag-changes.md
- https://posthog.com/docs/feature-flags/evaluation-contexts.md
- https://posthog.com/docs/feature-flags/project-wide-settings.md
- https://posthog.com/docs/feature-flags/cleaning-up-stale-flags.md
- https://posthog.com/docs/feature-flags/device-bucketing.md
- https://posthog.com/docs/feature-flags/multi-project-feature-flags.md
- https://posthog.com/docs/feature-flags/property-overrides.md
- https://posthog.com/docs/feature-flags/testing.md
- https://posthog.com/docs/feature-flags/phased-rollout.md
- https://posthog.com/docs/feature-flags/canary-release.md

Experiments
- https://posthog.com/docs/experiments/creating-an-experiment.md
- https://posthog.com/docs/experiments/metrics.md
- https://posthog.com/docs/experiments/analyzing-results.md
- https://posthog.com/docs/experiments/statistics-bayesian.md
- https://posthog.com/docs/experiments/statistics-frequentist.md
- https://posthog.com/docs/experiments/cuped.md
- https://posthog.com/docs/experiments/holdouts.md
- https://posthog.com/docs/experiments/exposures.md
- https://posthog.com/docs/experiments/no-code-web-experiments.md
- https://posthog.com/docs/experiments/managing-lifecycle.md
- https://posthog.com/docs/experiments/sample-size-running-time.md
- https://posthog.com/docs/experiments/traffic-allocation.md
- https://posthog.com/docs/experiments/data-warehouse.md
- https://posthog.com/docs/experiments/llm-prompt-experiments.md
- https://posthog.com/docs/experiments/surfaces/web-app.md
- https://posthog.com/docs/experiments/running-experiments-without-feature-flags.md
- https://posthog.com/docs/experiments/testing-and-launching.md

Session replay
- https://posthog.com/docs/session-replay/start-here.md
- https://posthog.com/docs/session-replay/how-to-watch-recordings.md
- https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md
- https://posthog.com/docs/session-replay/surfaces/web-app.md
- https://posthog.com/docs/session-replay/console-log-recording.md
- https://posthog.com/docs/session-replay/network-recording.md
- https://posthog.com/docs/session-replay/privacy.md
- https://posthog.com/docs/session-replay/mobile.md
- https://posthog.com/docs/session-replay/sharing.md
- https://posthog.com/docs/session-replay/canvas-recording.md
- https://posthog.com/docs/session-replay/iframes.md
- https://posthog.com/docs/session-replay/integrations.md
- https://posthog.com/docs/session-replay/recording-retention.md
- https://posthog.com/docs/session-replay/snapshot-api.md
- https://posthog.com/docs/session-replay/find-replays-ai.md
- https://posthog.com/docs/replay-vision.md

Surveys
- https://posthog.com/docs/surveys/creating-surveys.md
- https://posthog.com/docs/surveys/conditional-questions.md
- https://posthog.com/docs/surveys/viewing-results.md
- https://posthog.com/docs/surveys/surfaces/web-app.md
- https://posthog.com/docs/surveys/sdk-feature-support.md
- https://posthog.com/docs/surveys/implementing-custom-surveys.md
- https://posthog.com/docs/surveys/destinations.md
- https://posthog.com/docs/surveys/summarize-responses-ai.md
- https://posthog.com/docs/surveys/create-surveys-ai.md

Error tracking
- https://posthog.com/docs/error-tracking/surfaces/web-app.md
- https://posthog.com/docs/error-tracking/managing-issues.md
- https://posthog.com/docs/error-tracking/assigning-issues.md
- https://posthog.com/docs/error-tracking/grouping-issues.md
- https://posthog.com/docs/error-tracking/fingerprints.md
- https://posthog.com/docs/error-tracking/alerts.md
- https://posthog.com/docs/error-tracking/spikes.md
- https://posthog.com/docs/error-tracking/stack-traces.md
- https://posthog.com/docs/error-tracking/upload-source-maps.md
- https://posthog.com/docs/error-tracking/releases.md
- https://posthog.com/docs/error-tracking/monitoring.md
- https://posthog.com/docs/error-tracking/integrations.md
- https://posthog.com/docs/error-tracking/rate-limiting.md
- https://posthog.com/docs/error-tracking/capture.md
- https://posthog.com/docs/error-tracking/code-variables.md
- https://posthog.com/docs/error-tracking/references.md
- https://posthog.com/docs/error-tracking/issues-and-exceptions.md

AI observability (the requested "LLM analytics")
- https://posthog.com/docs/ai-observability/surfaces/web-app.md
- https://posthog.com/docs/ai-observability/dashboard.md
- https://posthog.com/docs/ai-observability/traces.md
- https://posthog.com/docs/ai-observability/generations.md
- https://posthog.com/docs/ai-observability/playground.md
- https://posthog.com/docs/ai-observability/clusters.md
- https://posthog.com/docs/ai-observability/calculating-costs.md
- https://posthog.com/docs/ai-observability/privacy-mode.md
- https://posthog.com/docs/ai-evals.md
- https://posthog.com/docs/prompt-management.md

Data pipelines and warehouse
- https://posthog.com/docs/data-pipelines.md
- https://posthog.com/docs/data-pipelines/surfaces/web-app.md
- https://posthog.com/docs/data-pipelines/destinations/customizing-destinations.md
- https://posthog.com/docs/data-pipelines/destinations/brevo.md
- https://posthog.com/docs/data-pipelines/destinations/elt-destinations.md
- https://posthog.com/docs/data-pipelines/transformations/customizing-transformations.md
- https://posthog.com/docs/data-pipelines/transformations/drop-events.md
- https://posthog.com/docs/data-pipelines/batch-exports.md
- https://posthog.com/docs/data-pipelines/sources.md (offsets 0, 100000)
- https://posthog.com/docs/data-pipelines/sources/incoming-webhooks.md
- https://posthog.com/docs/data-pipelines/file-download-exports.md
- https://posthog.com/docs/data-warehouse/surfaces/web-app.md
- https://posthog.com/docs/data-warehouse/views.md
- https://posthog.com/docs/data-warehouse/views/materialize.md
- https://posthog.com/docs/data-warehouse/join.md
- https://posthog.com/docs/data-warehouse/sql.md
- https://posthog.com/docs/data-warehouse/sql/variables.md
- https://posthog.com/docs/data-warehouse/query.md
- https://posthog.com/docs/data-warehouse/data-quality.md
- https://posthog.com/docs/data-warehouse/data-quality/check-types.md
- https://posthog.com/docs/data-warehouse/insights.md
- https://posthog.com/docs/data-warehouse/warehouse-properties.md
- https://posthog.com/docs/data-warehouse/warehouse-native.md

Toolbar and heatmaps
- https://posthog.com/docs/toolbar.md
- https://posthog.com/docs/toolbar/heatmaps.md
- https://posthog.com/docs/toolbar/create-toolbar-actions.md
- https://posthog.com/docs/toolbar/override-feature-flags.md

Identity, privacy, SDKs
- https://posthog.com/docs/privacy.md
- https://posthog.com/docs/privacy/data-collection.md
- https://posthog.com/docs/privacy/data-storage.md
- https://posthog.com/docs/privacy/gdpr-compliance.md
- https://posthog.com/docs/advanced/proxy.md
- https://posthog.com/docs/libraries
- https://posthog.com/docs/libraries/js/config

Platform
- https://posthog.com/docs/settings/access-control.md
- https://posthog.com/docs/settings/activity-logs.md
- https://posthog.com/docs/settings/approvals.md
- https://posthog.com/docs/settings/property-access-control.md
- https://posthog.com/docs/settings/warehouse-access-control.md
- https://posthog.com/docs/settings/organizations.md
- https://posthog.com/docs/settings/projects.md
- https://posthog.com/docs/settings/authentication/sso.md
- https://posthog.com/docs/settings/account-settings.md
- https://posthog.com/docs/api.md
- https://posthog.com/docs/api/queries.md
- https://posthog.com/docs/api/capture.md
- https://posthog.com/docs/model-context-protocol.md
- https://posthog.com/docs/model-context-protocol/tools.md
- https://posthog.com/docs/posthog-ai.md
- https://posthog.com/docs/posthog-ai/modes.md
- https://posthog.com/docs/posthog-ai/tools.md
- https://posthog.com/docs/posthog-ai/context-and-commands.md
- https://posthog.com/docs/posthog-ai/edit-memory.md
- https://posthog.com/docs/cmd-k.md
- https://posthog.com/docs/cli.md
- https://posthog.com/docs/advanced/infra-as-code.md
- https://posthog.com/docs/billing/limits-alerts.md
- https://posthog.com/docs/health-checks.md

Revenue, logs, workflows, other products
- https://posthog.com/docs/revenue-analytics/start-here.md
- https://posthog.com/docs/revenue-analytics/revenue-metrics.md
- https://posthog.com/docs/revenue-analytics/capture-revenue-events.md
- https://posthog.com/docs/revenue-analytics/connect-to-customers.md
- https://posthog.com/docs/revenue-analytics/deferred-revenue.md
- https://posthog.com/docs/logs/surfaces/web-app.md
- https://posthog.com/docs/logs/search.md
- https://posthog.com/docs/logs/alerts.md
- https://posthog.com/docs/logs/patterns.md
- https://posthog.com/docs/logs/logs-config.md
- https://posthog.com/docs/logs/pii-scrubbing.md
- https://posthog.com/docs/logs/basics.md
- https://posthog.com/docs/logs/metrics.md
- https://posthog.com/docs/workflows/workflow-builder.md
- https://posthog.com/docs/workflows/surfaces/web-app.md
- https://posthog.com/docs/workflows/broadcasts.md
- https://posthog.com/docs/workflows/configure-channels.md
- https://posthog.com/docs/endpoints.md
- https://posthog.com/docs/customer-analytics/start-here.md
- https://posthog.com/docs/customer-analytics/customer-journeys.md
- https://posthog.com/docs/customer-analytics/customer-profiles.md
- https://posthog.com/docs/semantic-layer.md
- https://posthog.com/docs/self-driving.md

## Capture and SDKs

- [projects] Projects with tokens: each project has its own write-only token and isolated data, grouped under one organization (https://posthog.com/docs/settings/projects.md)
- [js-snippet] JavaScript web SDK and snippet: capture from the browser by script or package (https://posthog.com/docs/libraries)
- [pageviews] Automatic page views: captures `$pageview`, including single-page apps through `history_change` (https://posthog.com/docs/product-analytics/autocapture.md)
- [pageleave-capture] Page leave capture: captures `$pageleave`, which bounce rate and scroll depth depend on (https://posthog.com/docs/product-analytics/autocapture.md)
- [autocapture] Autocapture: clicks, form submits, form changes and contenteditable changes on standard elements (https://posthog.com/docs/product-analytics/autocapture.md)
- [autocapture-url-lists] Autocapture URL allowlist and ignorelist: turn autocapture on or off by URL (https://posthog.com/docs/product-analytics/autocapture.md)
- [autocapture-dom-element-lists] Autocapture DOM event and element allowlists: limit capture to chosen DOM events and tags (https://posthog.com/docs/product-analytics/autocapture.md)
- [autocapture-css-lists] Autocapture CSS selector allowlist and ignorelist: include or exclude by selector, with `.ph-no-autocapture` as default exclusion (https://posthog.com/docs/product-analytics/autocapture.md)
- [autocapture-attribute-ignorelist] Attribute ignorelist: strips named attributes such as `aria-label` from captured events (https://posthog.com/docs/product-analytics/autocapture.md)
- [autocapture-custom-attributes] Custom properties from markup: `data-ph-capture-attribute-<key>` attaches a property to an element's events (https://posthog.com/docs/product-analytics/autocapture.md)
- [rage-clicks] Rage click events: fires `$rageclick` after three close clicks, with configurable thresholds and ignore lists (https://posthog.com/docs/product-analytics/autocapture.md)
- [dead-clicks] Dead click capture: captures clicks that change nothing, enabled in settings or code (https://posthog.com/docs/product-analytics/autocapture.md)
- [dead-swipes] Dead swipe capture: records swipes with no visible change as `$dead_swipe` (https://posthog.com/changelog/2026)
- [clipboard-capture] Clipboard autocapture: captures copied or cut text as `$selected_content` when enabled (https://posthog.com/docs/product-analytics/autocapture.md)
- [mobile-lifecycle-capture] Mobile lifecycle and screen capture: app installed, updated, opened, backgrounded and `$screen` events (https://posthog.com/docs/product-analytics/autocapture.md)
- [mobile-interaction-capture] Mobile interaction autocapture: touch and gesture capture on iOS and React Native, plus Android taps and rage or dead taps (https://posthog.com/changelog/2026)
- [web-vitals-capture] Web vitals autocapture: captures `$web_vitals` with per-metric toggles and a sampling option (https://posthog.com/docs/web-analytics/web-vitals.md)
- [event-context] UTM, referrer, device and geo properties: default event properties including browser, OS, device type, URL, UTM, ad click IDs and IP (https://posthog.com/docs/data/events.md)
- [utm-five-levels] UTM stored at several levels: on the event, latest on the person, first-touch `$initial_*` and session entry (https://posthog.com/docs/data/utm-segmentation.md)
- [custom-campaign-params] Custom campaign parameters: `custom_campaign_params` captures query params beyond the standard five (https://posthog.com/docs/data/utm-segmentation.md)
- [ad-click-ids] Ad click IDs on sessions: `$entry_gclid` and `$entry_gad_source` stored for attribution (https://posthog.com/docs/data/sessions.md)
- [geoip-enrichment] GeoIP enrichment: city, country, continent, subdivisions, postal code, coordinates and timezone added by default (https://posthog.com/docs/product-analytics/person-properties.md)
- [sessions] Session id and timeout: new session after 30 idle minutes (configurable) or 24 hours (https://posthog.com/docs/data/sessions.md)
- [session-cross-tab] Sessions across tabs with window id: sessions span tabs, and `$window_id` identifies the sending tab (https://posthog.com/docs/data/sessions.md)
- [session-properties] Session properties: duration, entry and exit URL, entry UTM, pageview count, autocapture count, channel and bounce flag (https://posthog.com/docs/data/sessions.md)
- [session-entry-on-events] Session entry properties on events: `$session_entry_*` values let you query without joining sessions (https://posthog.com/docs/data/sessions.md)
- [server-session-linking] Backend events tied to browser sessions: tracing headers and manual `$session_id`, with UUIDv7 rules for custom IDs (https://posthog.com/docs/data/sessions.md)
- [batch-api] Batch capture API: `/batch/` sends many events in a request with a 20 MB default body limit (https://posthog.com/docs/api/capture.md)
- [single-capture-api] Single event capture API: `/i/v0/e/` takes token, event, distinct id, properties and timestamp (https://posthog.com/docs/api/capture.md)
- [historical-migration] Historical migration flag: `historical_migration` processes imported events in order without spike detection (https://posthog.com/docs/api/capture.md)
- [event-dedup-upsert] Event dedup and upsert: matching uuid, name, timestamp and distinct id dedupes, and re-sending replaces the original (https://posthog.com/docs/data/events.md)
- [sdks] SDK coverage: 23 libraries listed including Android, iOS, Flutter, React Native, Node, Python, Go, Ruby, PHP, Java, .NET, Rust, Elixir, Unity, Godot and Roblox (https://posthog.com/docs/libraries)
- [python-async-client] Async Python client: asyncio-native capture that does not block the event loop (https://posthog.com/changelog/2026)
- [sdk-defaults-versioning] Dated SDK defaults: `defaults` opts in to behavior changes introduced on a given date (https://posthog.com/docs/libraries/js/config)
- [client-rate-limiting] Client rate limiting: `rate_limiting` caps events per second with a burst limit (https://posthog.com/docs/libraries/js/config)
- [one-click-installs] One-click installs: Webflow, Framer, Shopify, WordPress and GTM (https://posthog.com/docs/web-analytics/start-here.md)
- [ai-install-wizard] AI install wizard: `npx @posthog/wizard` detects the framework and configures the SDK (https://posthog.com/docs/web-analytics/start-here.md)
- [reverse-proxy] Reverse proxy guides: self-hosted guides for 15 platforms including CloudFront, Cloudflare, Next.js, nginx and Vercel (https://posthog.com/docs/advanced/proxy.md)
- [managed-reverse-proxy] Managed reverse proxy: free CNAME-based proxy with status lifecycle and SSL handled by PostHog (https://posthog.com/docs/advanced/proxy.md)
- [proxy-diagnostics] Proxy diagnostics: checks CNAME, certificate, CAA, HTTP-01 reachability, a live event probe and expiry (https://posthog.com/docs/advanced/proxy.md)
- [typed-capture-codegen] Typed capture code generation: CLI pulls the schema and generates TypeScript, Go and Python capture code (experimental) (https://posthog.com/docs/product-analytics/schema-management.md)
- [sdk-health] SDK health check: flags SDKs far behind the latest release (https://posthog.com/docs/health-checks.md)
- [webmcp-analytics] WebMCP tool-call analytics: captures browser WebMCP tool calls tied to user and session (https://posthog.com/changelog.md)

## Insights: shared across types

- [live-events] Live events: streams events as captured with active user count, filter and pause (https://posthog.com/docs/activity.md)
- [events-explorer] Activity event list: filter by date, event and properties, and expand each to properties, metadata, raw JSON and flags (https://posthog.com/docs/activity.md)
- [events-custom-columns] Activity custom columns: add property, flag or SQL columns, reorder, and save as project default (https://posthog.com/docs/activity.md)
- [events-saved-views] Activity views: PostHog default, project default, event count and live (https://posthog.com/docs/activity.md)
- [events-jump-to-timestamp] Jump to timestamp: `J` then `T` goes to events around a time (https://posthog.com/docs/activity.md)
- [events-relative-absolute-time] Relative or absolute time toggle: switch date columns in the column menu (https://posthog.com/docs/activity.md)
- [live-events-cli] Terminal live events: `posthog-live` streams events in the terminal with filters and shortcuts (https://posthog.com/docs/activity.md)
- [insight-library] Saved insights list: browse saved insights from Product analytics (https://posthog.com/docs/product-analytics/trends/overview)
- [insight-name-description] Insight name and Markdown description: editable name with Markdown description (https://posthog.com/docs/product-analytics/trends/overview)
- [insight-ai-titles] AI insight titles: AI-generated insights include titles and descriptions (https://posthog.com/changelog/2026)
- [insight-type-tabs] Switch insight type: tabs at the top change the type (https://posthog.com/docs/product-analytics/insights.md)
- [insight-copy-to-project] Copy insight to another project: choose copy or reuse for dependencies (https://posthog.com/docs/product-analytics/insights.md)
- [insight-multi-dashboard] Insight on several dashboards: one insight belongs to many, shown under Manage dashboards (https://posthog.com/docs/product-analytics/trends/overview)
- [insight-export-png] Export insight as PNG: from the insight menu (https://posthog.com/docs/product-analytics/trends/overview)
- [insight-view-source] View insight source (beta): `{}` shows and edits the insight configuration (https://posthog.com/docs/product-analytics/trends/tips.md)
- [insight-dive-deeper] Dive deeper recommendations: related insights suggested below an insight (https://posthog.com/changelog/2026)
- [actors-modal] Persons modal drill-down: clicking a data point lists people, with replays, properties, cohort save and CSV export (https://posthog.com/docs/product-analytics/trends/tips.md)
- [filter-event-properties] Filter by event property: any event property as an inline filter (https://posthog.com/docs/product-analytics/trends/filters.md)
- [filter-sources] Filter sources: event, person, group, session, cohort and HTML element properties (https://posthog.com/docs/product-analytics/trends/filters.md)
- [filter-unseen-properties] Show unseen properties: lists properties not yet seen with the event (https://posthog.com/docs/product-analytics/trends/filters.md)
- [filter-groups-and-or] Filter groups with AND and OR: several groups combined within and across (https://posthog.com/docs/product-analytics/trends/filters.md)
- [filter-operators-string] String operators: exact, contains, starts with, ends with, regex and their negations (https://posthog.com/docs/data/property-filters.md)
- [filter-operators-numeric] Numeric operators: comparisons, between, not between, minimum and maximum (https://posthog.com/docs/data/property-filters.md)
- [filter-operators-presence] Presence operators: is set and is not set (https://posthog.com/docs/data/property-filters.md)
- [filter-operators-date] Date operators: is date before and is date after (https://posthog.com/docs/data/property-filters.md)
- [filter-operators-semver] Semver operators: comparisons, tilde, caret and wildcard on version strings (https://posthog.com/docs/data/property-filters.md)
- [filter-operators-cohort] Cohort operators: in and not in (https://posthog.com/docs/data/property-filters.md)
- [filter-multi-value] Multiple values per filter: match if any listed value matches (https://posthog.com/docs/product-analytics/trends/filters.md)
- [filter-sql-expression] SQL expression filters: filters written as SQL (https://posthog.com/docs/product-analytics/trends/filters.md)
- [filter-recent-tab] Recent filters: reuse recent events and property filters with values restored (https://posthog.com/changelog/2026)
- [filter-suggested] Suggested filters: common filters such as URL and email are proposed (https://posthog.com/changelog/2026)
- [test-account-definition] Internal user definition: project admins define internal traffic by person, event or cohort filters (https://posthog.com/docs/data/test-accounts.md)
- [test-account-toggle] Filter internal and test users per insight: toggle on each insight (https://posthog.com/docs/data/test-accounts.md)
- [test-account-default] Filter internal users by default: project setting for new insights (https://posthog.com/docs/data/test-accounts.md)
- [test-account-bulk] Bulk apply test account filter: turn it on or off across insights, with a change summary and API endpoint (https://posthog.com/docs/data/test-accounts.md)
- [color-themes] Custom color themes (Teams or Enterprise): named palettes with a project default and per-insight override (https://posthog.com/docs/product-analytics/color-themes.md)
- [result-color-override] Manual result colors: assign a color from the results table on trends and funnels (https://posthog.com/docs/product-analytics/color-themes.md)
- [path-cleaning] Path cleaning rules: regex and alias rules normalize URLs across web and product analytics (https://posthog.com/docs/web-analytics/path-cleaning.md)
- [path-cleaning-capture-groups] Path cleaning capture groups: aliases reuse `\1` to `\9` and `\0`, validated at save (https://posthog.com/docs/web-analytics/path-cleaning.md)

## Insights: trends

- [trends] Trends: plots events, actions and properties over time, default last 7 days (https://posthog.com/docs/product-analytics/trends/overview)
- [trends-interval-units] Interval units: second, minute, hour, day, week or month (https://posthog.com/docs/product-analytics/trends/overview)
- [trends-multi-series] Multiple series: add or duplicate series to compare (https://posthog.com/docs/product-analytics/trends/overview)
- [trends-inline-event-or] Combine events inline: several events become one series with OR, no action needed (https://posthog.com/docs/product-analytics/trends/overview)
- [trends-first-occurrence] First occurrence per series: first-ever, or first matching the filters (https://posthog.com/docs/product-analytics/trends/filters.md)
- [trends-incomplete-period] Dotted line for incomplete periods: marks periods still collecting (https://posthog.com/docs/product-analytics/trends/overview)
- [trends-hide-weekends] Hide weekend data: removes Saturday and Sunday on daily charts, with a badge (https://posthog.com/docs/product-analytics/trends/tips.md)
- [trends-smoothing] Smoothing: 7 or 28 day rolling average, available by day (overview page) or by day, hour or minute (charts page) (https://posthog.com/docs/product-analytics/trends/charts)
- [compare-period] Compare to previous period: shows a change on number charts and a column in tables, and renders the full previous period (https://posthog.com/docs/product-analytics/trends/charts)
- [trends-confidence-intervals] Confidence intervals: shaded band at 95% default, toggled in Options (https://posthog.com/docs/product-analytics/trends/statistical-analysis.md)
- [trends-goal-lines] Goal lines: add reference lines from Advanced Options (https://posthog.com/docs/product-analytics/trends/tips.md)
- [trends-y-axis-range] Custom Y-axis range: set axis bounds on trend charts (https://posthog.com/changelog/2026)
- [trends-axis-labels] Custom axis labels: label the chart axes (https://posthog.com/changelog/2026)
- [trends-units] Value units: duration, percentage, currency and short number (https://posthog.com/docs/product-analytics/trends/tips.md)
- [trends-prefix-suffix] Custom prefix and postfix: for example a `$` prefix (https://posthog.com/docs/product-analytics/trends/tips.md)
- [trends-show-values] Values on series: data labels on the chart (https://posthog.com/docs/product-analytics/trends/tips.md)
- [trends-legend] Legend: optional series legend (https://posthog.com/docs/product-analytics/trends/tips.md)
- [trends-series-toggle] Series visibility and isolate: checkbox per series, plus hide others, show all and hide all (https://posthog.com/docs/product-analytics/trends/tips.md)

### Math types

- [math-total] Total count: all events in the period (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-count-per-user] Count per user: average, min, max, median and p75, p90, p95, p99 of per-user counts (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-unique-users] Unique users: distinct people per period, labeled as daily active users on the overview page (https://posthog.com/docs/product-analytics/trends/overview)
- [math-wau] Weekly active users: unique users in the trailing 7 days (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-mau] Monthly active users: unique users in the trailing 30 days (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-unique-sessions] Unique sessions: distinct sessions per period (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-unique-groups] Unique groups: distinct groups per period (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-property-basic] Property average, sum, min, max: aggregates over a numeric property (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-property-percentiles] Property median and percentiles: median and p75, p90, p95, p99 (https://posthog.com/docs/product-analytics/trends/aggregations)
- [math-sql] SQL aggregation: custom aggregation as a SQL expression (https://posthog.com/docs/product-analytics/trends/aggregations)

### Formulas

- [formulas] Formula mode: arithmetic over series letters (A, B, C), computed at each point (https://posthog.com/docs/product-analytics/trends/formulas)
- [formulas-multiple] Multiple formulas: each one is its own series (https://posthog.com/docs/product-analytics/trends/formulas)

### Display types

- [chart-line] Line chart: each series or value over time (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-cumulative] Cumulative line: running total per series (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-bar-time] Bar chart over time: bars side by side at each interval (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-stacked-bar] Stacked bar: series stacked to show share of total (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-area] Area chart: stacked areas drawn as lines (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-box-plot] Box plot: min, Q1, median, mean, Q3 and max of a numeric property, with outlier clipping and a results table (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-slope] Slope graph: start to end value per series over the range (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-number] Number: one value, with headline total, average or latest (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-bar-total] Total value bar: each series total over the range, with optional stacked breakdowns (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-table] Table: raw values over the range (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-pie] Pie: distribution with slice content, value format and total options (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-donut] Donut: pie drawn as a ring (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-proportion-bar] Proportion bar: one bar split into segments with percentages in the legend (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-world-map] World map: values by country code (https://posthog.com/docs/product-analytics/trends/charts)
- [chart-calendar-heatmap] Calendar heatmap (opt-in beta): by hour of day and day of week with totals (https://posthog.com/docs/product-analytics/trends/charts)

### Breakdowns

- [breakdown] Breakdown by property: event, session, person or flag property, one series per value (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-multi] Multiple breakdowns: up to 3 on trends, 1 on other types (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-load-more] Load more values: first 25 load, with a button for more (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-group-property] Breakdown by group property: requires group analytics (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-cohort] Breakdown by cohort: one or several cohorts compared (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-elements] Breakdown by element: element text, tag name or href on trends and funnels (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-sql] SQL breakdown: expressions such as browser and OS combined, with a label alias (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-numeric-bins] Numeric bins: group numeric values into ranges, covering all values (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-stack-values] Stack breakdown values: combine values into stacked bars by series (https://posthog.com/docs/product-analytics/trends/breakdowns)
- [breakdown-pinned-columns] Pinned breakdown columns: columns stay visible while scrolling (https://posthog.com/changelog/2026)

## Insights: funnels

- [funnels] Funnels: conversion between steps with drop-off counts (https://posthog.com/docs/product-analytics/funnels)
- [funnel-step-inline-or] Combine events into one step: several events with OR (https://posthog.com/docs/product-analytics/funnels)
- [funnel-repeat-steps] Repeated steps: the same event twice must be triggered twice (https://posthog.com/docs/product-analytics/funnels)
- [funnel-step-filters] Per-step filters: event, person, group, element or SQL (https://posthog.com/docs/product-analytics/funnels)
- [funnel-global-filters] Whole-funnel filters: apply filters to all steps (https://posthog.com/docs/product-analytics/funnels)
- [funnel-order-sequential] Sequential order (default): any events may occur between steps (https://posthog.com/docs/product-analytics/funnels)
- [funnel-order-strict] Strict order: next step must follow directly (https://posthog.com/docs/product-analytics/funnels)
- [funnel-order-any] Any order: steps in any sequence (https://posthog.com/docs/product-analytics/funnels)
- [funnel-exclusions] Exclusion steps: removes users who did an event between two steps from the whole funnel (https://posthog.com/docs/product-analytics/funnels)
- [funnel-rate-overall] Conversion relative to first step: overall rate (https://posthog.com/docs/product-analytics/funnels)
- [funnel-rate-previous] Conversion relative to previous step: step-by-step rate (https://posthog.com/docs/product-analytics/funnels)
- [funnel-conversion-window] Conversion window limit: time to finish after the first step, default 14 days (https://posthog.com/docs/product-analytics/paths)
- [funnel-window-units] Conversion window units: the funnel doc does not list them and the API doc only names "window intervals" (unverified) (https://posthog.com/docs/product-analytics/funnels)
- [funnel-optional-steps] Optional funnel steps: a search snippet shows an `optionalInFunnel` schema field, and the funnel doc gives no feature description (unverified) (https://posthog.com/docs/product-analytics/funnels)
- [funnel-breakdown] Funnel breakdown: event, person, element or one cohort, following path cleaning rules (https://posthog.com/docs/product-analytics/funnels)
- [funnel-attribution-first] Attribution first touchpoint: first value seen, one per person (https://posthog.com/docs/product-analytics/funnels)
- [funnel-attribution-last] Attribution last touchpoint: last value seen, one per person (https://posthog.com/docs/product-analytics/funnels)
- [funnel-attribution-all] Attribution all steps: a person counts in every value seen in step order (https://posthog.com/docs/product-analytics/funnels)
- [funnel-attribution-step] Attribution specific step: value at a chosen step, labeled Any step on unordered funnels (https://posthog.com/docs/product-analytics/funnels)
- [funnel-first-occurrence] First occurrence per step: first-ever, or first matching filters (https://posthog.com/docs/product-analytics/funnels)
- [funnel-graph-steps] Conversion steps graph: drop-off and counts between steps (https://posthog.com/docs/product-analytics/funnels)
- [funnel-graph-time-to-convert] Time to convert graph: how long steps take (https://posthog.com/docs/product-analytics/funnels)
- [funnel-graph-historical] Historical trends graph: conversion over time by entry date, with hide incomplete periods (https://posthog.com/docs/product-analytics/funnels)
- [funnel-actors] Converted and dropped users: click to list them per step (https://posthog.com/docs/product-analytics/funnels)
- [funnel-save-cohort] Save funnel users as cohort: from the users list (https://posthog.com/docs/product-analytics/funnels)
- [funnel-paths-links] Explore paths from a step: leading to, between, after, after drop off and before drop off (https://posthog.com/docs/product-analytics/funnels)
- [funnel-group-aggregation] Aggregate funnel by group: Aggregating by a group type, with groups that dropped (https://posthog.com/docs/product-analytics/group-analytics)
- [funnel-session-aggregation] Session funnels: view converting and dropped users per step in session funnels (https://posthog.com/changelog/2026)
- [correlation] Funnel correlation: finds events and properties that raise or lower conversion (https://posthog.com/docs/product-analytics/correlation.md)
- [correlation-multipliers] Correlation likelihood multipliers: shows "1.3x more likely" (https://posthog.com/docs/product-analytics/correlation.md)
- [correlation-save-cohort] Correlation to cohort: save completed or dropped people (https://posthog.com/docs/product-analytics/correlation.md)
- [correlation-exclude] Correlation exclude: exclude an event or property from the project's results (https://posthog.com/docs/product-analytics/correlation.md)

## Insights: retention

- [retention] Retention: start event and return event, on events or actions (https://posthog.com/docs/product-analytics/retention)
- [retention-units] Retention periods: hours, days, weeks or months (https://posthog.com/docs/product-analytics/retention)
- [retention-custom-brackets] Custom time brackets: custom intervals and selected periods (https://posthog.com/changelog/2026)
- [retention-group-aggregation] Retention by group: aggregate by users or groups (https://posthog.com/docs/product-analytics/retention)
- [retention-filters] Retention filters: event, person, flag or cohort (https://posthog.com/docs/product-analytics/retention)
- [retention-type-recurring] Recurring type: any start event in the period counts (https://posthog.com/docs/product-analytics/retention)
- [retention-type-first] First time type: first start event in the date range (https://posthog.com/docs/product-analytics/retention)
- [retention-type-first-ever] First ever type: first-ever start event falls in the cohort period (https://posthog.com/docs/product-analytics/retention)
- [retention-graph-table] Graph and table: line or bar graph and cohort table, with graph only, table only or both (https://posthog.com/docs/product-analytics/retention)
- [retention-cell-actors] Cell drill-down: clicking a cell lists retained users (https://posthog.com/docs/product-analytics/retention)
- [retention-reference] Retention reference: relative to period 0 or previous period (https://posthog.com/docs/product-analytics/retention)
- [retention-relative-basis] Percentage basis: starting cohort size or previous period (https://posthog.com/docs/product-analytics/retention)
- [retention-cumulative] Returning criteria: On, or On or after (cumulative) (https://posthog.com/docs/product-analytics/retention)
- [retention-mean] Mean calculation: weighted or simple (https://posthog.com/docs/product-analytics/retention)
- [retention-label-index] Cohort labels start index: start at 0 or 1, display only (https://posthog.com/docs/product-analytics/retention)
- [retention-breakdown] Retention breakdown: event, person, flag, group, cohort or SQL, with mean per value, expandable rows and value dropdown (https://posthog.com/docs/product-analytics/retention)

## Insights: paths

- [paths] User paths: flow diagram of steps with user counts (https://posthog.com/docs/product-analytics/paths)
- [paths-sankey] Interactive diagram: hover highlights upstream and downstream links and shows conversion and average time (https://posthog.com/docs/product-analytics/paths)
- [paths-set-start] Set path start: from a step's menu (https://posthog.com/docs/product-analytics/paths)
- [paths-set-end] Set path end: from a step's menu, with middle steps collapsed (https://posthog.com/docs/product-analytics/paths)
- [paths-exclude-item] Exclude path item: removes events from the diagram (https://posthog.com/docs/product-analytics/paths)
- [paths-view-funnel] View funnel from a step: opens a funnel with that event first (https://posthog.com/docs/product-analytics/paths)
- [paths-copy-item] Copy path item name: copies to clipboard (https://posthog.com/docs/product-analytics/paths)
- [paths-actors] Users per step: list users, save as cohort or view recordings (https://posthog.com/docs/product-analytics/paths)
- [paths-event-pageviews] Paths from page views: `$pageview` by current URL, across domains (https://posthog.com/docs/product-analytics/paths)
- [paths-event-screens] Paths from screen views: `$screen` by screen name (https://posthog.com/docs/product-analytics/paths)
- [paths-event-custom] Paths from custom events: custom events by name (https://posthog.com/docs/product-analytics/paths)
- [paths-event-sql] Paths from SQL expression: custom logic for steps (https://posthog.com/docs/product-analytics/paths)
- [paths-wildcards] Wildcard groups: `/product/*` merges values into one step (https://posthog.com/docs/product-analytics/paths)
- [paths-cleaning-toggle] Path cleaning toggle: apply or skip global URL cleaning (https://posthog.com/docs/product-analytics/paths)
- [paths-people-per-path] People per path: min and max users for a path to show (https://posthog.com/docs/product-analytics/paths)
- [paths-steps-selector] Number of steps: selector above the graph, default 5 (https://posthog.com/docs/product-analytics/paths)

## Insights: stickiness and lifecycle

- [stickiness-lifecycle] Stickiness and lifecycle insights: the combined existing row; sub-capabilities below (https://posthog.com/docs/product-analytics/insights.md)
- [stickiness] Stickiness: users grouped by how many periods they did an event (https://posthog.com/docs/product-analytics/stickiness)
- [stickiness-actors] Stickiness drill-down: list users per point and save as cohort (https://posthog.com/docs/product-analytics/stickiness)
- [stickiness-warehouse] Stickiness on warehouse tables: tables as series, no actors click-through (https://posthog.com/docs/product-analytics/stickiness)
- [stickiness-group] Stickiness by group: y-axis counts users or groups (https://posthog.com/docs/product-analytics/stickiness)
- [lifecycle] Lifecycle: new, returning, resurrecting and dormant per period (https://posthog.com/docs/product-analytics/lifecycle)
- [lifecycle-intervals] Lifecycle intervals: hour, day, week or month (https://posthog.com/docs/product-analytics/lifecycle)
- [lifecycle-show-values] Lifecycle values and percentages: show counts, percent or both on series (https://posthog.com/docs/product-analytics/lifecycle)
- [lifecycle-actors] Lifecycle drill-down: users per section, then events, replays or cohort (https://posthog.com/docs/product-analytics/lifecycle)
- [lifecycle-group-conflict] Lifecycle by group: the lifecycle page says groups are supported, the group analytics page says not (unverified) (https://posthog.com/docs/product-analytics/group-analytics)

## Insights: SQL

- [sql] SQL queries: HogQL over events, persons, groups, replay metadata and warehouse tables (https://posthog.com/docs/product-analytics/sql)
- [sql-joins-subqueries] Joins and subqueries: INNER, LEFT, RIGHT, FULL and subqueries in FROM (https://posthog.com/docs/product-analytics/sql)
- [sql-cte] CTEs: WITH clauses (https://posthog.com/docs/product-analytics/sql)
- [sql-window-functions] Window functions: WINDOW with PARTITION BY, ORDER BY and frames (https://posthog.com/docs/product-analytics/sql)
- [sql-with-fill] Time series fill: ORDER BY WITH FILL and INTERPOLATE (https://posthog.com/docs/product-analytics/sql)
- [sql-property-access] Dot-notation property access: such as `properties.$browser` (https://posthog.com/docs/product-analytics/sql)
- [sql-filters-placeholder] `{filters}` placeholder: applies insight or dashboard date range and filters (https://posthog.com/docs/data-warehouse/sql/variables.md)
- [sql-filter-binding] Filter column binding: `{filters(column AS timestamp, ...)}` maps filters to any table (https://posthog.com/docs/data-warehouse/sql/variables.md)
- [sql-interval-breakdown-vars] Interval, breakdown and date range placeholders: `{filters.interval}`, `{filters.breakdown(...)}`, `{filters.dateRange.from}` (https://posthog.com/docs/data-warehouse/sql/variables.md)
- [sql-variables] SQL variables: project-wide typed variables through `{variables.name}`, set from dashboards (https://posthog.com/docs/data-warehouse/sql/variables.md)
- [sql-saved-filter-edit] Filters on saved SQL insights: adjust without saving, with Edit carrying changes into the editor (https://posthog.com/docs/product-analytics/sql)
- [sql-multi-query-tab] Multiple queries per tab: run the query under the cursor or the selection (https://posthog.com/docs/data-warehouse/query.md)
- [sql-run-subquery] Run subquery at cursor: tests the innermost subquery, with a warning underline if it may fail (https://posthog.com/docs/data-warehouse/query.md)
- [sql-schema-sidebar] Schema browser: search tables and views, with materialization status filter (https://posthog.com/docs/data-warehouse/query.md)
- [sql-execution-stats] Execution details: memory, data read, CPU time and duration (https://posthog.com/docs/data-warehouse/query.md)
- [sql-to-insight] Query to insight: turn a query into a saved insight (https://posthog.com/docs/data-warehouse/query.md)
- [sql-viz-auto] Automatic visualization: picks a chart from the result (https://posthog.com/docs/data-warehouse/query.md)
- [sql-viz-types] SQL charts: table, big number, line, bar, stacked bar, area and 2D heatmap (https://posthog.com/docs/data-warehouse/query.md)
- [sql-viz-scatter] SQL scatter plot: two numeric columns with optional least-squares trend line (https://posthog.com/changelog/2026)
- [sql-viz-config] SQL chart configuration: axes, legend, scale and goal lines (https://posthog.com/docs/data-warehouse/query.md)
- [sql-number-formats] SQL series formatting: number format, prefix, suffix and decimals per series (https://posthog.com/docs/data-warehouse/query.md)
- [sql-conditional-formatting] Table conditional formatting: highlight cells by value (https://posthog.com/docs/data-warehouse/query.md)
- [sql-copy-markdown] Copy results as Markdown: for pasting elsewhere (https://posthog.com/changelog/2026)
- [sql-view-folders] View folders: organize saved views in folders (https://posthog.com/changelog/2026)
- [sql-query-log] Query log: `query_log` table with duration, CPU, memory, bytes, status, error and API key details (https://posthog.com/docs/data/query-log.md)
- [sql-ai-fix] AI SQL help: write, adjust and repair queries using the real schema (https://posthog.com/docs/data-warehouse/surfaces/web-app.md)

## Insights: annotations and actions

- [annotations] Annotations: note on a date or time on insights and dashboards (https://posthog.com/docs/data/annotations.md)
- [annotations-scope] Annotation scope: current chart or all charts, with chart filter by scope (https://posthog.com/docs/data/annotations.md)
- [annotations-list] Annotations page: list all under data management (https://posthog.com/docs/data/annotations.md)
- [annotations-emoji] Annotation emoji: optional emoji in table, card and chart badge (https://posthog.com/docs/data/annotations.md)
- [annotations-toggle] Show annotations toggle: per insight, on by default for trends and funnel trends (https://posthog.com/docs/data/annotations.md)
- [annotations-mcp] Annotations through MCP: create, list, update and delete, such as for deploys (https://posthog.com/docs/data/annotations.md)
- [actions] Actions: named combination of events usable in insights, retroactive (https://posthog.com/docs/data/actions.md)
- [action-autocapture-match] Action autocapture matching: by text, URL contains or CSS selector, all combined with AND (https://posthog.com/docs/data/actions.md)
- [action-pageview-match] Action pageview matching: URL contains, exact or regex (https://posthog.com/docs/data/actions.md)
- [action-screen-match] Action screen matching: screen name contains, exact or regex (https://posthog.com/docs/data/actions.md)
- [action-custom-event] Action from custom events: custom events as a source (https://posthog.com/docs/data/actions.md)
- [action-filters] Action property filters: event, person, flag, cohort and element (https://posthog.com/docs/data/actions.md)
- [action-from-toolbar] Create actions from toolbar: tag elements on the page (https://posthog.com/docs/toolbar/create-toolbar-actions.md)
- [action-webhook] Actions with webhooks: the actions list has a webhook status column, and setup is not documented on this page (unverified) (https://posthog.com/docs/data.md)
- [action-copy-project] Copy action to project: with dependency resolution (https://posthog.com/docs/data/actions.md)

## Dashboards

- [dashboards] Dashboards: group insights on a page (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-templates-builtin] Built-in templates: website, product health and LLM metrics (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-templates-custom] Save as template: name, description, tags, with team or organization visibility (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-templates-browse] Template browser: filter by Official, Team or Organization, plus search (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-ai-starter] AI starter prompts: blank dashboards open PostHog AI to build insights (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-folders] Dashboard folders: file from list or sidebar, with folder column and URL filter (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-bulk-delete] Bulk delete: up to 100 dashboards, optionally removing orphan insights (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-copy-project] Copy dashboard to project: with choices per dependency (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-duplicate] Duplicate dashboard: copy to compare filter sets (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-date-override] Dashboard date range override: forces insights to one range (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-filters] Dashboard filters: event, person, flag, group and cohort (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-test-account-control] Dashboard test account filter: override at dashboard level (https://posthog.com/changelog/2026)
- [dashboard-tile-overrides] Tile overrides: date range, interval, properties and breakdown per tile (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-tile-ignore-filters] Tile ignores dashboard filters: with an indicator on the card (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-variables] Dashboard variables: set values applied to all SQL queries on it (https://posthog.com/docs/data-warehouse/sql/variables.md)
- [dashboard-resize-tiles] Resize tiles: direct and diagonal resizing (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-edit-layout] Edit layout mode: keyboard shortcuts E, Escape, F, Z and a collapsed view (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-mobile-layout] Single-column on small screens: stacked layout (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-tile-display] Per-insight display options: smoothing, axis scale, legend, values and annotations from the tile (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-move-tile] Move or copy tiles: insight and text cards between dashboards (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-text-cards] Text cards: rich text editor with images (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-button-tiles] Button tiles: internal or external links, with style and alignment (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-widgets] Widgets (early access): activity, error tracking, replay, logs, experiments, experiment results, survey results and support (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-remove-vs-delete] Remove or delete insight: from one dashboard or everywhere, with undo and affected list (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-refresh] Manual refresh: full or per tile, with last computed time and rate limits (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-auto-refresh] Auto refresh: chosen interval, active tab only (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-ai-refresh-analysis] AI refresh analysis: summarizes drops, spikes and reversals, with feedback (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-edit-access] Dashboard edit restriction: limit edit access to members (https://posthog.com/docs/product-analytics/dashboards)
- [dashboard-pin] Pin dashboards: the web-app page mentions pinning key metrics (unverified) (https://posthog.com/docs/product-analytics/surfaces/web-app.md)
- [dashboard-terraform] Terraform export: dashboards, insights and layouts as Terraform (https://posthog.com/docs/product-analytics/dashboards)
- [sharing] Public sharing and embeds: public link and iframe for insights and dashboards, no sign-in (https://posthog.com/docs/product-analytics/sharing.md)
- [sharing-display-options] Share display options: toggle PostHog branding and legend (https://posthog.com/docs/product-analytics/sharing.md)
- [sharing-theme] Share theme: light, dark or system (https://posthog.com/docs/product-analytics/sharing.md)
- [sharing-refresh-param] Embed refresh on load: `?refresh=true` on the iframe URL (https://posthog.com/docs/product-analytics/sharing.md)
- [sharing-auto-resize] Embed auto-resize: `posthog:dimensions` message event sets iframe height (https://posthog.com/docs/product-analytics/sharing.md)
- [sharing-auto-refresh] Shared auto-refresh: every 30 minutes, plus one refresh if stale (https://posthog.com/docs/product-analytics/sharing.md)
- [sharing-password] Password protection (Boost and up): several passwords with notes, 24-hour access and revoke (https://posthog.com/docs/product-analytics/sharing.md)
- [sharing-audit] Share audit log: sharing changes and token refreshes logged (https://posthog.com/docs/product-analytics/sharing.md)
- [subscriptions] Subscriptions: scheduled delivery of insights and dashboards (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-email] Email delivery: several recipients inside or outside the team, with a message (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-slack] Slack delivery: native formatting with chart images, split when large (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-teams] Microsoft Teams delivery: Adaptive Cards (https://posthog.com/changelog/2026)
- [subscriptions-schedule] Schedule options: daily, weekly, monthly, custom intervals, delivery time and monthly weekday rules (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-select-insights] Choose insights: up to 20 per dashboard subscription (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-page] Subscriptions page: tabs, search, filter by channel and creator, sort and delete with undo (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-test] Test delivery: sends immediately (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-ai-summary] AI summary: optional summary comparing to the previous snapshot, with context field (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-prompt] Prompt subscriptions: recurring report from a free-text prompt with analysis windows (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-slack-replies] Slack follow-up: mention @PostHog in the delivered thread (https://posthog.com/docs/product-analytics/subscriptions.md)
- [subscriptions-auto-disable] Subscription auto-disable: disabled on lost Slack access, with email and revalidation (https://posthog.com/docs/product-analytics/subscriptions.md)

## Alerts

- [alerts] Alerts on insights: on trends, funnels (steps and trends) and SQL (https://posthog.com/docs/alerts.md)
- [alert-threshold-absolute] Absolute threshold: more than and/or less than a bound (https://posthog.com/docs/alerts.md)
- [alert-threshold-relative] Relative change: increases or decreases by, with optional percent (https://posthog.com/docs/alerts.md)
- [alert-series-target] Alert target: series, funnel step or overall rate (https://posthog.com/docs/alerts.md)
- [alert-sql-target] SQL alert target: value column, label column, and last, first or any row (https://posthog.com/docs/alerts.md)
- [alert-frequency] Check frequency: real time (Scale and up), 15 minutes (Boost and up), hourly with chosen minute, daily, weekly, monthly (https://posthog.com/docs/alerts.md)
- [alert-anomaly-statistical] Statistical detectors: Z-score, MAD, IQR and threshold (https://posthog.com/docs/alerts.md)
- [alert-anomaly-ml] ML detectors: Isolation Forest, KNN, LOF, ECOD, COPOD, HBOS, PCA and OCSVM (https://posthog.com/docs/alerts.md)
- [alert-anomaly-ensemble] Detector ensembles: two or more detectors with AND or OR (https://posthog.com/docs/alerts.md)
- [alert-anomaly-ai] AI judgment: model verdict with confidence, where enabled (https://posthog.com/docs/alerts.md)
- [alert-anomaly-settings] Anomaly settings: sensitivity, window, differencing and lagging (https://posthog.com/docs/alerts.md)
- [alert-simulation] Alert simulation: chart with scores, flagged points and stats before saving (https://posthog.com/docs/alerts.md)
- [alert-notify-inapp] In-app alert notification: subscribed users, click opens insight (https://posthog.com/docs/alerts.md)
- [alert-notify-channels] Alert destinations: email, Slack, Discord, Teams and generic webhook, up to five (https://posthog.com/docs/alerts.md)
- [alert-skip-weekends] Skip weekend checks: for real-time to daily alerts (https://posthog.com/docs/alerts.md)
- [alert-quiet-hours] Quiet hours: up to five blocked windows in project timezone (https://posthog.com/docs/alerts.md)
- [alert-ongoing-period] Check ongoing period: evaluate the unfinished period (https://posthog.com/docs/alerts.md)
- [alert-breakdowns] Breakdown alerts: fires when any value breaches (https://posthog.com/docs/alerts.md)
- [alert-auto-disable] Alert auto-disable: invalid configs disabled, with email and manual re-enable (https://posthog.com/docs/alerts.md)
- [alert-history] Alert delivery history: records notifications accepted per destination (https://posthog.com/changelog/2026)
- [alert-check-failure] Alert check failure notice: notifies when an alert first fails to run (https://posthog.com/changelog/2026)
- [alert-from-dashboard] Alerts from dashboard: manage an insight's alerts from the tile (https://posthog.com/changelog/2026)
- [alert-mcp-ai] Create alerts with AI: MCP and PostHog AI create, list, disable and delete (https://posthog.com/docs/alerts.md)

## People and cohorts

- [persons] Persons with properties and timeline: profile with properties and events (https://posthog.com/docs/data/persons.md)
- [persons-list-columns] People list columns: sortable list with configurable columns (https://posthog.com/docs/data/persons.md)
- [persons-record-counts] People list counts: totals and filtered counts (https://posthog.com/changelog/2026)
- [persons-last-seen] Last seen (opt-in): sortable column updated hourly, skippable per event (https://posthog.com/docs/data/persons.md)
- [person-tab-events] Person events tab: search and filter a person's events (https://posthog.com/docs/data/persons.md)
- [person-tab-recordings] Person recordings tab: their replays (https://posthog.com/docs/data/persons.md)
- [person-tab-logs] Person logs tab: logs tied to the person (https://posthog.com/docs/data/persons.md)
- [person-tab-cohorts] Person cohorts tab: cohorts they belong to (https://posthog.com/docs/data/persons.md)
- [person-tab-groups] Person related groups tab: associated groups over 90 days (https://posthog.com/docs/data/persons.md)
- [person-tab-flags] Person feature flags tab: flags enabled for them (https://posthog.com/docs/data/persons.md)
- [person-tab-history] Person history tab: manual profile changes (https://posthog.com/docs/data/persons.md)
- [person-tab-surveys] Person surveys tab: their survey responses (https://posthog.com/changelog/2026)
- [person-profile-tiles] Profile tile customization: toggle tiles on person and group profiles (https://posthog.com/changelog/2026)
- [person-edit-properties] View and edit person properties: under Persons & Groups (https://posthog.com/docs/product-analytics/person-properties.md)
- [person-display-name] Person display name: configurable in project settings (https://posthog.com/docs/product-analytics/person-properties.md)
- [person-split-ids] Split IDs: separates a person's merged IDs (https://posthog.com/docs/data/persons.md)
- [delete-person-reset] Reset deleted person: lets a deleted distinct id create a new profile (https://posthog.com/docs/data/persons.md)
- [person-search] Find a person: lookup by unique ID, and Cmd+K by name or ID (https://posthog.com/docs/cmd-k.md)
- [group-analytics] Group analytics (paid add-on): group types and properties, up to 5 types per project (https://posthog.com/docs/product-analytics/group-analytics)
- [group-insight-aggregation] Insights by group: Unique counts groups, in trends, funnels, retention and stickiness (https://posthog.com/docs/product-analytics/group-analytics)
- [group-list-page] Group list: People tab lists types, with `name` or key shown (https://posthog.com/docs/product-analytics/group-analytics)
- [group-related-people] Related people and groups tab: last 90 days (https://posthog.com/docs/product-analytics/group-analytics)
- [group-type-manage] Rename and delete group types: in settings (https://posthog.com/docs/product-analytics/group-analytics)
- [group-event-level] Per-event group: `$groups` on one event (https://posthog.com/docs/product-analytics/group-analytics)
- [group-warehouse-props] Warehouse group properties: map table columns to group properties (https://posthog.com/docs/product-analytics/group-analytics)
- [group-revenue] Revenue on group profiles: MRR and LTV shown (https://posthog.com/changelog/2026)
- [cohorts] Cohorts: lists of users, usable as filter or breakdown across products (https://posthog.com/docs/data/cohorts.md)
- [cohort-from-insight] Save cohort from insight: from the persons modal (https://posthog.com/docs/data/cohorts.md)
- [cohort-static] Static cohorts: fixed list from insights, CSV, manual selection, duplicate or snapshot (https://posthog.com/docs/data/cohorts.md)
- [cohort-csv] CSV upload: distinct IDs, person IDs or emails, up to 20 MB and 1,000,000 rows, additive (https://posthog.com/docs/data/cohorts.md)
- [cohort-snapshot] One-time snapshot: criteria evaluated at save, then locked (https://posthog.com/docs/data/cohorts.md)
- [cohort-duplicate-static] Duplicate dynamic as static: copy for flag targeting (https://posthog.com/docs/data/cohorts.md)
- [cohort-dynamic] Dynamic cohorts: refreshed every 24 hours (https://posthog.com/docs/data/cohorts.md)
- [cohort-nesting] Nested cohorts: build on other cohorts (https://posthog.com/docs/data/cohorts.md)
- [cohort-behavior-event] Behavior: completed or not completed an event or action, with day, week, month or year ranges (https://posthog.com/docs/data/cohorts.md)
- [cohort-behavior-multiple] Behavior: completed multiple times (https://posthog.com/docs/data/cohorts.md)
- [cohort-behavior-sequence] Behavior: completed or not completed a sequence (https://posthog.com/docs/data/cohorts.md)
- [cohort-lifecycle-criteria] Lifecycle criteria: first time, regularly, stopped and started again (https://posthog.com/docs/data/cohorts.md)
- [cohort-person-operators] Person property criteria: full operators including regex, between and is set (https://posthog.com/docs/data/cohorts.md)
- [cohort-realtime] Realtime cohorts (early beta): updated as events arrive, for flag targeting (https://posthog.com/docs/data/realtime-cohorts.md)
- [cohort-replay-vision] Cohort from Replay Vision: saves scanner results as a snapshot (https://posthog.com/docs/data/cohorts.md)
- [cohort-copy-project] Copy cohort to project: with dependency resolution (https://posthog.com/docs/data/cohorts.md)
- [cohort-history] Cohort history tab: changes and manual membership edits (https://posthog.com/docs/data/cohorts.md)
- [cohort-mcp] Cohorts through MCP: create, update, delete, and add or remove static persons by UUID (https://posthog.com/docs/data/cohorts.md)

## Data management

- [data-events-list] Events list: sort by name, last seen and type, with top properties (https://posthog.com/docs/data.md)
- [data-event-detail] Event definition detail: editable description, first and last seen and matching events (https://posthog.com/docs/data.md)
- [data-event-status] Event status: visible, verified with a checkmark, or hidden from search (https://posthog.com/docs/data/events.md)
- [data-event-tags] Event tags: edit and bulk add, remove or replace (https://posthog.com/docs/data/events.md)
- [data-event-preview-image] Event image preview: shown on hover in the selector (https://posthog.com/docs/data/events.md)
- [data-event-define-first] Create event definitions in advance: with description, owner and tags (https://posthog.com/docs/product-analytics/schema-management.md)
- [data-properties-list] Properties list: event, person and group properties with type and tags (https://posthog.com/docs/data.md)
- [data-property-type-override] Property type detection and correction: auto-detected, manually fixable (https://posthog.com/docs/data/events.md)
- [data-property-verified] Property verification: tags and verification on properties (https://posthog.com/docs/data/events.md)
- [data-property-groups] Property groups: reusable typed schemas with required flags, attachable to events (https://posthog.com/docs/product-analytics/schema-management.md)
- [data-history] Data management history: changes to descriptions, tags, verification and deletions (https://posthog.com/docs/data.md)
- [data-ingestion-warnings] Ingestion warnings: about 16 ingestion and several validation warning types, sampled (https://posthog.com/docs/data/ingestion-warnings.md)
- [data-event-filtering] Event ingestion filtering: drop events at ingestion by name and distinct id (https://posthog.com/docs/data/event-filtering.md)
- [data-event-filter-modes] Filter modes: disabled, dry run or live (https://posthog.com/docs/data/event-filtering.md)
- [data-event-filter-logic] Filter logic: AND, OR and NOT groups, five levels and 20 conditions (https://posthog.com/docs/data/event-filtering.md)
- [data-event-filter-tests] Filter test cases: expected drop or ingest, run in the browser (https://posthog.com/docs/data/event-filtering.md)
- [data-event-filter-metrics] Filter metrics: dropped and would be dropped (https://posthog.com/docs/data/event-filtering.md)
- [data-comments-page] Comments page: browse comments and tasks, filter by kind and status (https://posthog.com/docs/data/comments.md)
- [health-checks] Health checks: daily checks with severity and automatic resolution (https://posthog.com/docs/health-checks.md)
- [health-check-types] Check types: SDK, ingestion, no live events, proxy, authorized URLs, pageleave, vitals, scroll depth, views and sync failures (https://posthog.com/docs/health-checks.md)
- [health-check-notify] Health notifications: `$health_check_issue_firing` and resolved events to destinations (https://posthog.com/docs/health-checks.md)

## Notebooks

- [notebooks] Notebooks: documents mixing text and live product data, free (https://posthog.com/docs/notebooks.md)
- [notebook-text] Rich text: Markdown, headings, lists, checklists and inline code (https://posthog.com/docs/notebooks.md)
- [notebook-block-titles] Block titles: custom titles on blocks (https://posthog.com/docs/notebooks.md)
- [notebook-insights] Insight blocks: all insight types, customizable inline (https://posthog.com/docs/notebooks.md)
- [notebook-saved-insights] Add saved insights: with the `/` command (https://posthog.com/changelog/2026)
- [notebook-data-nodes] Data blocks: events, persons, groups and cohorts (https://posthog.com/docs/notebooks.md)
- [notebook-replay] Replay blocks: replays and playlists with timestamped comments (https://posthog.com/docs/notebooks.md)
- [notebook-flags-surveys] Flag and survey blocks: status, conditions and results (https://posthog.com/docs/notebooks.md)
- [notebook-experiments] Experiment block: exposures, results and significance (https://posthog.com/changelog/2026)
- [notebook-images] Images: by slash command or drag and drop (https://posthog.com/docs/notebooks.md)
- [notebook-latex] LaTeX: math block or inline (https://posthog.com/docs/notebooks.md)
- [notebook-tables] Tables: `/table`, with paste from spreadsheets (https://posthog.com/docs/notebooks.md)
- [notebook-mermaid] Mermaid diagrams: fenced blocks render in view mode (https://posthog.com/docs/notebooks.md)
- [notebook-slash-commands] Slash commands and drag: `/`, + icon, drag reordering and link drop (https://posthog.com/docs/notebooks.md)
- [notebook-popover] Notebook sidebar popover: open or drag into from anywhere (https://posthog.com/docs/notebooks.md)
- [notebook-share-org] Share with organization: link for members, conflict warning on save, no realtime multiplayer (https://posthog.com/docs/notebooks.md)
- [notebook-canvas] Canvas: entire contents kept in the URL (https://posthog.com/docs/notebooks.md)
- [notebook-kernel] Notebook kernel schema browser: lists live kernel dataframes, tables and views (unverified) (https://posthog.com/changelog/2026)

## Feature flags

- [flags-basic] Boolean and multivariate flags: toggle or variant keys with per-variant rollout (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-presets] Creation presets: Boolean, Multivariate, Remote config or Experiment (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-limits] Flag limits: 2,000 flags per team and 512 KB per filter (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-payloads] Payloads: JSON per flag or per variant (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-targeting] Release conditions: property and rollout condition sets (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-multi-condition] Multiple condition sets: passing any set counts (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-stop-at-first] Stop at first matching set: optional early exit (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-target-group] Target by group: bucket by group key (https://posthog.com/docs/feature-flags/user-and-group-targeting.md)
- [flags-device-bucketing] Device bucketing: stable by device ID across login (https://posthog.com/docs/feature-flags/device-bucketing.md)
- [flags-geoip-target] GeoIP targeting: location as release condition (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-cohort-target] Cohort targeting: non-behavioral or realtime cohorts (https://posthog.com/docs/data/cohorts.md)
- [flags-warehouse-target] Warehouse property targeting: mapped warehouse data as a condition (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-distinct-id-target] Distinct id targeting: searchable by name, email or ID (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-semver-target] Semver targeting: version operators (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-prefix-suffix] Starts with and ends with conditions: case-insensitive, with local evaluation on several SDKs (https://posthog.com/changelog/2026)
- [flags-decimal-rollout] Decimal rollout: down to 0.01%, with slider ticks (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-variant-override] Variant overrides: force people into a variant (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-dependencies] Flag dependencies: gate on another flag, with chains and variant match (https://posthog.com/docs/feature-flags/dependencies.md)
- [flags-persist-auth] Persist across authentication: keeps value through login, with tradeoffs (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-runtime] Evaluation runtime: client, server or both (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-eval-contexts] Evaluation contexts: labels restrict where a flag evaluates, up to 50 per flag (https://posthog.com/docs/feature-flags/evaluation-contexts.md)
- [flags-tags] Flag tags: organizational labels (https://posthog.com/docs/feature-flags/creating-feature-flags.md)
- [flags-decide] Flags endpoint and SDK helpers: public `/flags` with project token (https://posthog.com/docs/api.md)
- [flags-local-eval] Local evaluation: server SDKs poll definitions and evaluate in process (https://posthog.com/docs/feature-flags/local-evaluation.md)
- [flags-local-only] Only evaluate locally: blocks remote fallback (https://posthog.com/docs/feature-flags/local-evaluation.md)
- [flags-shared-cache] Shared definition cache: external cache across instances (https://posthog.com/docs/feature-flags/local-evaluation.md)
- [flags-bootstrapping] Bootstrapping: seed flag values, payloads and identity at init (https://posthog.com/docs/feature-flags/bootstrapping.md)
- [flags-property-overrides] Property overrides: pass properties at evaluation, without creating a profile (https://posthog.com/docs/feature-flags/property-overrides.md)
- [flags-remote-config] Remote config: one fixed payload for all callers (https://posthog.com/docs/feature-flags/remote-config.md)
- [flags-encrypted-payloads] Encrypted payloads: stored encrypted, server-only (https://posthog.com/docs/feature-flags/remote-config.md)
- [flags-early-access] Early access management: features with lifecycle stages linked to flags (https://posthog.com/docs/feature-flags/early-access-feature-management.md)
- [flags-early-access-stages] Early access stages: draft, concept, alpha, beta and GA, with enrollment condition (https://posthog.com/docs/feature-flags/early-access-feature-management.md)
- [flags-early-access-optin] Early access opt-in: admin opt-in, public widget and custom UI API (https://posthog.com/docs/feature-flags/early-access-feature-management.md)
- [flags-early-access-ga] Promote to GA: optionally override opt-outs (https://posthog.com/docs/feature-flags/early-access-feature-management.md)
- [flags-scheduled] Scheduled changes: status, add condition or update variants at a time (https://posthog.com/docs/feature-flags/scheduled-flag-changes.md)
- [flags-scheduled-recurring] Recurring schedules: presets, custom cron, business hours pairs and end date (https://posthog.com/docs/feature-flags/scheduled-flag-changes.md)
- [flags-scheduled-history] Schedule list: active, upcoming and history, editable (https://posthog.com/docs/feature-flags/scheduled-flag-changes.md)
- [flags-usage-tab] Usage tab: call volume by value and unique users, with event list and dashboard (https://posthog.com/docs/feature-flags/surfaces/web-app.md)
- [flags-feature-events] Feature view and interaction events: enriched analytics charts on Usage tab (https://posthog.com/docs/feature-flags/surfaces/web-app.md)
- [flags-testing-tab] Testing tab: evaluate for a person, with groups, past timestamp and condition results (https://posthog.com/docs/feature-flags/testing.md)
- [flags-blast-radius] Blast radius: see who a condition reaches before widening (https://posthog.com/docs/feature-flags/surfaces/web-app.md)
- [flags-activity-log] Flag activity log: review changes (https://posthog.com/docs/feature-flags/surfaces/web-app.md)
- [flags-code-snippets] Per-SDK code snippets: copy code to read the flag (https://posthog.com/docs/feature-flags/surfaces/web-app.md)
- [flags-stale] Stale flags: list filter, with 30-day rules and AI cleanup (https://posthog.com/docs/feature-flags/cleaning-up-stale-flags.md)
- [flags-bulk-delete] Bulk flag deletion: delete several at once (https://posthog.com/changelog/2026)
- [flags-copy-project] Copy flag to project: with cohorts and pending schedules (https://posthog.com/docs/feature-flags/multi-project-feature-flags.md)
- [flags-settings-persist-default] Default persistence: new flags persist by default (https://posthog.com/docs/feature-flags/project-wide-settings.md)
- [flags-settings-confirm] Change confirmation: modal with custom message on edit (https://posthog.com/docs/feature-flags/project-wide-settings.md)
- [flags-settings-default-conditions] Default release conditions: pre-fill new flags (https://posthog.com/docs/feature-flags/project-wide-settings.md)
- [flags-secret-keys] Project secret keys: `feature_flag:read`, up to 50 per project (https://posthog.com/docs/feature-flags/remote-config.md)
- [flags-toolbar-override] Toolbar overrides: browser-only toggle, and view as another user (https://posthog.com/docs/toolbar/override-feature-flags.md)
- [flags-code-override] Code overrides: `overrideFeatureFlags` in web and React Native (https://posthog.com/docs/feature-flags/testing.md)
- [flags-approvals] Flag approvals: gated changes through change requests (https://posthog.com/docs/settings/approvals.md)
- [flags-openfeature] OpenFeature providers: JVM and Elixir (https://posthog.com/changelog/2026)
- [flags-eval-timestamp] Evaluation timestamp: flag responses include a time (https://posthog.com/changelog/2026)
- [flags-ai] Flags with AI: create or update, and ask about stale flags (https://posthog.com/docs/feature-flags/surfaces/web-app.md)

## Experiments

- [experiments] Experiments: A/B analysis on a backing flag, created by a three-step wizard (https://posthog.com/docs/experiments/creating-an-experiment.md)
- [exp-hypothesis] Hypothesis field: recorded on the experiment (https://posthog.com/docs/experiments/creating-an-experiment.md)
- [exp-existing-flag] Use existing flag: multivariate with 2 to 20 variants (https://posthog.com/docs/experiments/creating-an-experiment.md)
- [exp-variants] Up to 20 variants: with traffic split and read-only preview (https://posthog.com/docs/experiments/creating-an-experiment.md)
- [exp-rollout] Rollout percent: share of users included, editable when running (https://posthog.com/docs/experiments/traffic-allocation.md)
- [exp-group-participants] Group-level participants: group-targeted experiments (https://posthog.com/docs/experiments/creating-an-experiment.md)
- [exp-release-conditions] Experiment release conditions: including warehouse properties (https://posthog.com/docs/experiments/creating-an-experiment.md)
- [exp-exposure-default] Default exposure: `$feature_flag_called` (https://posthog.com/docs/experiments/exposures.md)
- [exp-exposure-custom] Custom exposure event: chosen event with filters and `$feature/<key>` (https://posthog.com/docs/experiments/exposures.md)
- [exp-multi-variant-handling] Multiple exposure handling: exclude or use first seen (https://posthog.com/docs/experiments/exposures.md)
- [exp-exposure-chart] Exposure view: daily cumulative per variant, with totals and split (https://posthog.com/docs/experiments/exposures.md)
- [exp-srm] Sample ratio mismatch: chi-squared check after 100 exposures, flagged at p < 0.001 (https://posthog.com/docs/experiments/exposures.md)
- [exp-filter-test-accounts] Filter test accounts: exposure criteria toggle (https://posthog.com/docs/experiments/exposures.md)
- [exp-no-metric-launch] Launch without metrics: add later (https://posthog.com/docs/experiments/creating-an-experiment.md)
- [exp-metric-funnel] Funnel metric: ordered or unordered post-exposure steps (https://posthog.com/docs/experiments/metrics.md)
- [exp-metric-mean] Mean metric: count, sum, avg, min, max, unique count or HogQL per user (https://posthog.com/docs/experiments/metrics.md)
- [exp-metric-ratio] Ratio metric: numerator and denominator, delta method (https://posthog.com/docs/experiments/metrics.md)
- [exp-metric-retention] Retention metric: completion within window after start (https://posthog.com/docs/experiments/metrics.md)
- [exp-winsorization] Outlier handling: winsorize by percentile, per metric, optional ignore zeros (https://posthog.com/docs/experiments/metrics.md)
- [exp-conversion-window] Metric conversion window: limit events after first exposure (https://posthog.com/docs/experiments/metrics.md)
- [exp-primary-secondary] Primary and secondary metrics: organizational labels (https://posthog.com/docs/experiments/metrics.md)
- [exp-shared-metrics] Shared metrics: reusable across experiments, with tags and duplicate (https://posthog.com/docs/experiments/metrics.md)
- [exp-metric-breakdown] Metric breakdowns: up to three properties (https://posthog.com/changelog/2026)
- [exp-warehouse-metrics] Warehouse metrics: tables as metric source with join keys (https://posthog.com/docs/experiments/data-warehouse.md)
- [exp-stats-bayesian] Bayesian engine: chance to win and 95% credible intervals (https://posthog.com/docs/experiments/statistics-bayesian.md)
- [exp-stats-frequentist] Frequentist engine: Welch's t-tests and confidence intervals (https://posthog.com/docs/experiments/statistics-frequentist.md)
- [exp-sequential-testing] Sequential testing: always-valid p-values, with tuning (https://posthog.com/docs/experiments/statistics-frequentist.md)
- [exp-confidence-level] Confidence level: 90, 95 or 99, project default and per experiment (https://posthog.com/docs/experiments/statistics-bayesian.md)
- [exp-cuped] CUPED: variance reduction with lookback of 1 to 30 days (https://posthog.com/docs/experiments/cuped.md)
- [exp-validation-rules] Result validity rules: minimum 50 exposures, 5 conversions, non-zero control mean (https://posthog.com/docs/experiments/statistics-bayesian.md)
- [exp-results-delta] Delta chart: per metric, color and arrows, with intervals (https://posthog.com/docs/experiments/analyzing-results.md)
- [exp-results-detail] Variant detail: hover and panel with stats and View recordings (https://posthog.com/docs/experiments/analyzing-results.md)
- [exp-results-timeseries] Results over time: daily change with narrowing bounds (https://posthog.com/docs/experiments/analyzing-results.md)
- [exp-results-funnel-steps] Funnel results by step: per variant (https://posthog.com/docs/experiments/analyzing-results.md)
- [exp-baseline-select] Baseline selector: choose the variant (https://posthog.com/docs/experiments/analyzing-results.md)
- [exp-replay-metric-filter] Filter replays to metric events: with seekbar markers (https://posthog.com/changelog/2026)
- [exp-replay-summary] Experiment replay summaries: summarize related replays (https://posthog.com/changelog/2026)
- [exp-sample-size-auto] Running time automatic: estimate from live data (https://posthog.com/docs/experiments/sample-size-running-time.md)
- [exp-sample-size-manual] Running time manual: baseline, MDE and exposures before launch (https://posthog.com/docs/experiments/sample-size-running-time.md)
- [exp-mde-default] MDE setting: default 30%, with organization default (https://posthog.com/docs/experiments/sample-size-running-time.md)
- [exp-lifecycle-pause] Pause and resume: stops collection without ending (https://posthog.com/docs/experiments/managing-lifecycle.md)
- [exp-lifecycle-freeze] Freeze exposure: stops new enrollment, keeping variants (https://posthog.com/docs/experiments/managing-lifecycle.md)
- [exp-lifecycle-end-ship] End and ship: serve chosen variant at 100% (https://posthog.com/docs/experiments/managing-lifecycle.md)
- [exp-lifecycle-reset] Reset analysis: clears results, back to draft (https://posthog.com/docs/experiments/managing-lifecycle.md)
- [exp-duplicate-copy] Duplicate and copy to project: new draft with flag handling (https://posthog.com/docs/experiments/managing-lifecycle.md)
- [exp-archive] Archive experiment: finished tests (https://posthog.com/docs/experiments/surfaces/web-app.md)
- [exp-holdouts] Holdouts: exclude a share from experiments, deterministic, created in a tab (https://posthog.com/docs/experiments/holdouts.md)
- [exp-holdout-priority] Holdout priority: checked first, `holdout-{id}` variant value (https://posthog.com/docs/experiments/holdouts.md)
- [exp-no-code] No-code web experiments: toolbar editor changes text, CSS or HTML (https://posthog.com/docs/experiments/no-code-web-experiments.md)
- [exp-no-code-preview] No-code preview and screenshots: per variant (https://posthog.com/docs/experiments/no-code-web-experiments.md)
- [exp-without-flags] Without PostHog flags: third-party flags with custom exposure (https://posthog.com/docs/experiments/running-experiments-without-feature-flags.md)
- [exp-test-override] Test override: assign your team to a variant before launch (https://posthog.com/docs/experiments/testing-and-launching.md)
- [exp-llm-prompts] Prompt experiments: two to ten prompt versions with cost, latency and eval metrics (https://posthog.com/docs/experiments/llm-prompt-experiments.md)
- [exp-approvals] Experiment approvals: launch, pause and update policies (https://posthog.com/docs/settings/approvals.md)
- [exp-ai] Experiments with AI: create, summarize and compare in natural language (https://posthog.com/docs/experiments/surfaces/web-app.md)

## Session replay

### Recording and controls

- [session-replay] Session replay: DVR-style playback with synced devtools (https://posthog.com/docs/session-replay/start-here.md)
- [replay-trigger-groups] Trigger groups: ANY or ALL match per group, any group records (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-sampling] Sampling: deterministic percentage per group (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-trigger-url] URL triggers: regex on full URL (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-trigger-event] Event triggers: start on named event, including exceptions (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-trigger-flag] Flag triggers: record people with a linked flag (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-min-duration] Minimum duration: discard short sessions, strict or legacy mode (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-trigger-buffer] Pre-trigger buffer: about a minute kept in memory (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-programmatic] Programmatic start and stop: with overrides on web (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-project-toggle] Project recording toggle: and authorized domains on older projects (https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record.md)
- [replay-canvas] Canvas recording: 2D and WebGL, opt-in, with FPS and quality settings (https://posthog.com/docs/session-replay/canvas-recording.md)
- [replay-canvas-masking] Canvas masking: mask regions callback (https://posthog.com/docs/session-replay/canvas-recording.md)
- [replay-iframes] Iframe recording: same-origin, and cross-origin by option (https://posthog.com/docs/session-replay/iframes.md)
- [replay-retention] Recording retention: setting by plan, 30 days up to 5 years, new recordings only (https://posthog.com/docs/session-replay/recording-retention.md)
- [replay-console-capture] Console capture: logs, info, warnings and errors, opt-in, 2,000-character truncation (https://posthog.com/docs/session-replay/console-log-recording.md)
- [replay-network-capture] Network capture: URL and timing, opt-in (https://posthog.com/docs/session-replay/network-recording.md)
- [replay-network-payloads] Network headers and bodies: optional, 1 MB truncation, header deny-list and auto-redaction (https://posthog.com/docs/session-replay/network-recording.md)
- [replay-network-mask-fn] Network mask callback: drop or rewrite requests (https://posthog.com/docs/session-replay/network-recording.md)

### Masking

- [replay-mask-inputs] Mask all inputs: on by default, with input-type options and callback (https://posthog.com/docs/session-replay/privacy.md)
- [replay-mask-text] Mask text: selector and callback, `*` masks all (https://posthog.com/docs/session-replay/privacy.md)
- [replay-block-element] Block element: `ph-no-capture` swaps it for a same-sized block (https://posthog.com/docs/session-replay/privacy.md)
- [replay-crypto-shred] Crypto-shredded deletion: per-session keys destroyed (https://posthog.com/docs/session-replay/privacy.md)

### Mobile

- [replay-mobile-platforms] Mobile replay: Android, iOS, React Native and Flutter (https://posthog.com/docs/session-replay/mobile.md)
- [replay-mobile-wireframe] Wireframe mode: view hierarchy rendered, native SDKs (https://posthog.com/docs/session-replay/mobile.md)
- [replay-mobile-screenshot] Screenshot mode: actual screenshots (https://posthog.com/docs/session-replay/mobile.md)
- [replay-mobile-masking] Mobile masking: per-view mask and unmask, with automatic secure fields (https://posthog.com/docs/session-replay/privacy.md)
- [replay-mobile-touch] Touch capture control: omit touch coordinates (https://posthog.com/changelog/2026)

### Player

- [replay-player-speed] Playback speed: adjustable (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-skip-inactivity] Skip inactivity: from the more menu (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-seek] Play, pause, seek: Alt for 1 ms steps (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-timestamp-format] Timestamp display: relative, UTC or project timezone (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-controls-layout] Controls layout: floating or pinned, persisted (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-window-select] Window selector: follow user or one tab, with badges (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-activity-panel] Activity panel: all events with tab badges (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-network-waterfall] Network waterfall: with page performance score and asset breakdown (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-console-panel] Console inspector: search with fuzzy, exact, prefix, suffix and inverse patterns (https://posthog.com/docs/session-replay/console-log-recording.md)
- [replay-inspect-dom] Inspect DOM: near-accurate page snapshot (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-view-heatmap] View heatmap from replay: with clickmap overlay (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-comments] Comments at timestamp: `c` key, with text, images and emoji (https://posthog.com/docs/data/comments.md)
- [replay-reactions] Emoji reactions: `e` key (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-tasks] Tasks on replay: comments checked off from timeline (https://posthog.com/docs/data/comments.md)
- [replay-screenshot] Screenshot: `s` key, with text and drawing annotations (https://posthog.com/docs/session-replay/sharing.md)
- [replay-clip] Clip: `x` key, 5, 10 or 15 seconds as GIF or MP4 (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-play-next] Play next and autoplay: off, next newest or next oldest (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-cinema-fullscreen] Cinema and fullscreen: `t` and `f` keys (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-resizable-player] Resizable player: drag to resize (https://posthog.com/changelog/2026)
- [replay-tab-aware] Tab-aware playback: resumes position on return (https://posthog.com/changelog/2026)
- [replay-kiosk] Kiosk mode: loops recordings with bookmarkable URL params (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-person-context] Person and flag context: person record, properties and flags alongside (https://posthog.com/docs/session-replay/start-here.md)

### Finding and organizing

- [replay-filters] Filter panel: date, active duration, activity counts, events, properties, console logs and flags (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-filter-activity-counts] Activity count filters: clicks, key presses and mouse activity (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-filter-watched] Watched filter: hide watched by you or others (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-filter-frustration] Filter frustration: rage clicks, dead clicks and exceptions (https://posthog.com/docs/session-replay/surfaces/web-app.md)
- [replay-quick-filters] Quick filters: email, user ID, path and URL shortcuts (https://posthog.com/changelog/2026)
- [replay-sort] Sort: by timestamp, activity, errors and more (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-saved-filters] Saved filters: shared across project and renamable (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-collections] Collections: group replays and share page (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-builtin-collections] Built-in collections: watch history, with comments, shared, exported, expiring soon and frustration (https://posthog.com/docs/session-replay/how-to-watch-recordings.md)
- [replay-links-from-products] Jump in from other tools: funnel step, flag variant or error issue (https://posthog.com/docs/session-replay/surfaces/web-app.md)
- [replay-ai-search] AI search: natural language becomes filters (https://posthog.com/docs/session-replay/find-replays-ai.md)
- [replay-ai-summary] AI summaries: per session and across sessions (https://posthog.com/docs/session-replay/find-replays-ai.md)

### Sharing and export

- [replay-share-private] Private link: teammates only, at a timestamp (https://posthog.com/docs/session-replay/sharing.md)
- [replay-share-public] Public link: with optional password (https://posthog.com/docs/session-replay/sharing.md)
- [replay-embed] Iframe embed: public replay, events hidden (https://posthog.com/docs/session-replay/sharing.md)
- [replay-chat-integration] Intercom and Crisp: send replay and person URLs to the widget (https://posthog.com/docs/session-replay/sharing.md)
- [replay-share-api] API sharing: token for embed iframe (https://posthog.com/docs/session-replay/sharing.md)
- [replay-export-mp4] Export MP4: full recording, background render, kept 12 months, monthly limits (https://posthog.com/docs/session-replay/sharing.md)
- [replay-export-json] Export JSON: re-import for playback after expiry (https://posthog.com/docs/session-replay/recording-retention.md)
- [replay-issue-trackers] Issue trackers: Linear, GitHub, GitLab and Jira (https://posthog.com/docs/session-replay/integrations.md)
- [replay-snapshot-api] Snapshot API: blob retrieval, not designed for public use (https://posthog.com/docs/session-replay/snapshot-api.md)

### Replay Vision

- [replay-vision] Replay Vision: AI scanners with prompt, type, filters, sampling and model (https://posthog.com/docs/replay-vision.md)
- [replay-vision-observations] Observations: per-recording result, key moment and worth-watching rating, emitted as event (https://posthog.com/docs/replay-vision.md)
- [replay-vision-what-to-watch] What to watch: ranked observations with filters (https://posthog.com/docs/replay-vision.md)
- [replay-vision-search] Observation search: plain language (https://posthog.com/docs/replay-vision.md)
- [replay-vision-calibration] Calibration: thumbs and notes teach later scans (https://posthog.com/docs/replay-vision.md)
- [replay-vision-alerts] Vision alerts: Slack or webhook (https://posthog.com/docs/replay-vision.md)
- [replay-vision-usage] Vision usage tab: spend per scanner and projection (https://posthog.com/docs/replay-vision.md)
- [replay-vision-workflow-step] Vision workflow step: scan and branch on the result (https://posthog.com/docs/replay-vision.md)
- [replay-vision-pii-check] Vision PII check: results checked before saving (https://posthog.com/docs/replay-vision.md)

## Surveys

- [surveys] Surveys: in-product and hosted questionnaires (https://posthog.com/docs/surveys/surfaces/web-app.md)
- [survey-type-popover] Popover: prebuilt bottom-corner UI (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-type-api] API survey: your UI, PostHog logic (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-type-feedback-button] Feedback button: custom button or prebuilt tab (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-type-hosted] Hosted: shareable URL or iframe, for email, social or QR (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-hosted-prefill] Hosted URL params: distinct id, custom properties, prefill and auto-advance (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-inline-render] Inline rendering: `displaySurvey` in an element (https://posthog.com/docs/surveys/implementing-custom-surveys.md)
- [survey-q-freeform] Question: freeform text (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-q-link] Question: link or notification (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-q-rating-emoji] Question: emoji rating (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-q-rating-number] Question: number rating (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-q-single] Question: single choice (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-q-multi] Question: multiple choice (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-q-thumbs] Question: thumbs up or down (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-q-html-desc] Description with HTML: per question, with button text (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-response-length] Response length validation: on open text, web and React Native (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-intro-screen] Intro screen: before first question (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-back-button] Back button: opt-in for multi-question flows (https://posthog.com/changelog/2026)
- [survey-branch-simple] Branching to question or end: after any question (https://posthog.com/docs/surveys/conditional-questions.md)
- [survey-branch-choice] Branch by choice: next step by answer (https://posthog.com/docs/surveys/conditional-questions.md)
- [survey-branch-rating] Branch by rating bucket: negative, neutral or positive (https://posthog.com/docs/surveys/conditional-questions.md)
- [survey-flow-diagram] Flow diagram: visualizes branching logic (https://posthog.com/changelog/2026)
- [survey-templates] Templates: NPS, PMF, churn and open feedback (https://posthog.com/docs/surveys/surfaces/web-app.md)
- [survey-preview] Preview: before launch, without interactive branch testing (https://posthog.com/docs/surveys/surfaces/web-app.md)
- [survey-appearance] Popover styling: background, border, button, text colors, position, placeholder and branding (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-font] Custom font: selection (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-shuffle] Shuffle: questions and choices (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-delay] Delay popup: before appearing (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-auto-dismiss] Auto-dismiss confirmation: after 5 seconds (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-auto-submit] Auto-submit on selection: rating and single choice (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-target-flag] Target linked flag: including a specific variant (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-target-url] Target URL: contains, exact or regex (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-target-device] Target device: contains, exact or regex (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-target-selector] Target CSS selector: class or ID present (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-target-properties] Target person and group properties: with percentage rollout (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-target-event] Target event: fired in session, with property filters (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-target-action] Target action: web only (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-cancel-event] Cancellation events: event cancels a pending survey (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-wait-period] Wait period: hide if saw any survey within X days (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-response-limit] Response limit: stop at a target, approximate (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-repeat-event] Repeat on event: every time or once per user (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-repeat-schedule] Repeat schedule: N cycles of X days, with iteration properties and auto-close (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-repeat-condition] Repeat whenever conditions match: optional wait period (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-reach-estimate] Reach estimate: full editor for URL targeting (https://posthog.com/changelog/2026)
- [survey-partial] Partial responses: per answer with submission id, and `survey abandoned` (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-copy-project] Copy to project: with dependencies (https://posthog.com/docs/surveys/creating-surveys.md)
- [survey-from-breakdown] Survey from web breakdown: target a Web Analytics segment (https://posthog.com/changelog/2026)
- [survey-results-funnel] Results counts: saw, dismissed, responded and skipped (https://posthog.com/docs/surveys/viewing-results.md)
- [survey-results-charts] Results charts: by question type with click-to-filter (https://posthog.com/docs/surveys/viewing-results.md)
- [survey-results-filters] Results filters: date, answer, event, person, flag, cohort and HogQL (https://posthog.com/docs/surveys/viewing-results.md)
- [survey-results-archive] Response archiving: archive and show archived (https://posthog.com/docs/surveys/viewing-results.md)
- [survey-results-insight] Open as insight: from rating and NPS trends, with response key copy (https://posthog.com/docs/surveys/viewing-results.md)
- [survey-results-widget] Dashboard widget: status, performance and recent responses (https://posthog.com/docs/surveys/viewing-results.md)
- [survey-results-sql] SQL response function: `getSurveyResponse` (https://posthog.com/docs/surveys/viewing-results.md)
- [survey-response-replay] Response to replay: each response linked to its session (https://posthog.com/docs/surveys/surfaces/web-app.md)
- [survey-notifications] Response notifications: Slack, Discord, Teams or webhook, with template inserts and partial toggle (https://posthog.com/docs/surveys/destinations.md)
- [survey-ai-create] AI create: from a description, with targeting and branching (https://posthog.com/docs/surveys/create-surveys-ai.md)
- [survey-ai-summary] AI summary: themes, sentiment, segments and NPS reasons (https://posthog.com/docs/surveys/summarize-responses-ai.md)
- [survey-mobile] Mobile surveys: React Native, iOS, Android and Flutter, by feature (https://posthog.com/docs/surveys/sdk-feature-support.md)
- [survey-translations] Translations: not covered by the page read (unverified) (https://posthog.com/docs/surveys/creating-surveys.md)

## Error tracking

- [error-tracking] Error tracking: exceptions grouped into issues (https://posthog.com/docs/error-tracking/surfaces/web-app.md)
- [err-autocapture] Exception autocapture: unhandled errors, rejections and optional console errors (https://posthog.com/docs/error-tracking/capture.md)
- [err-autocapture-controls] Autocapture controls: enable by URL, trigger, flag or sample (https://posthog.com/changelog/2026)
- [err-manual-capture] Manual capture: `captureException` with custom properties (https://posthog.com/docs/error-tracking/capture.md)
- [err-steps] Exception steps: breadcrumbs attached to the next exception (https://posthog.com/docs/error-tracking/capture.md)
- [err-error-boundary] Error boundaries: React and React Native (https://posthog.com/docs/error-tracking/capture.md)
- [err-native-crashes] Native crash capture: Android NDK, iOS OOM, React Native render and fatal, and Java (https://posthog.com/changelog/2026)
- [err-code-variables] Code variables: local variable capture per frame, with masking (https://posthog.com/docs/error-tracking/code-variables.md)
- [err-before-send] Client filtering: `before_send` drops or edits (https://posthog.com/docs/error-tracking/capture.md)
- [err-burst-protection] Burst protection: client-side limit per exception type (https://posthog.com/docs/error-tracking/capture.md)
- [err-suppression-rules] Suppression rules: drop future exceptions by type and message (https://posthog.com/docs/error-tracking/capture.md)
- [err-suppress-similar] Suppress similar: suggests rules with preview (https://posthog.com/changelog/2026)
- [err-rate-limit-project] Project rate limit: cap on total volume (https://posthog.com/docs/error-tracking/rate-limiting.md)
- [err-rate-limit-issue] Per-issue rate limit: per issue cap (https://posthog.com/docs/error-tracking/rate-limiting.md)
- [err-rate-limit-bypass] Bypass rules: exempt matching exceptions (https://posthog.com/docs/error-tracking/rate-limiting.md)
- [err-rate-limit-history] Rate limit history: ingested, limited and bypassed over time (https://posthog.com/docs/error-tracking/rate-limiting.md)
- [err-pause-ingestion] Pause ingestion: per environment (https://posthog.com/changelog/2026)
- [err-fingerprint] Automatic fingerprint: type, message and frames (https://posthog.com/docs/error-tracking/fingerprints.md)
- [err-custom-fingerprint] Custom fingerprint: `$exception_fingerprint` (https://posthog.com/docs/error-tracking/fingerprints.md)
- [err-custom-issue-name] Custom issue name: `$issue_name` and description (https://posthog.com/docs/error-tracking/grouping-issues.md)
- [err-grouping-rules] Grouping rules: by property, ordered and testable (https://posthog.com/docs/error-tracking/grouping-issues.md)
- [err-merge] Merge issues: into a primary (https://posthog.com/docs/error-tracking/grouping-issues.md)
- [err-status] Issue status: active, resolved with auto-reopen, or suppressed (https://posthog.com/docs/error-tracking/managing-issues.md)
- [err-bulk-actions] Bulk actions: open, merge, mark, assign, unassign and hide (https://posthog.com/docs/error-tracking/managing-issues.md)
- [err-list-columns] Issues list: status, assignee, first and last seen and occurrences (https://posthog.com/docs/error-tracking/surfaces/web-app.md)
- [err-sort] Sort issues: last seen, first seen, occurrences, users or sessions (https://posthog.com/docs/error-tracking/monitoring.md)
- [err-search] Search: freeform on type, message, functions and paths, plus property filters (https://posthog.com/docs/error-tracking/monitoring.md)
- [err-saved-views] Saved views: filter sets (https://posthog.com/docs/error-tracking/surfaces/web-app.md)
- [err-timeline-drag] Time-range drag: drag timeline to filter (https://posthog.com/changelog/2026)
- [err-assign-manual] Assign issues: user or role (https://posthog.com/docs/error-tracking/assigning-issues.md)
- [err-assign-rules] Assignment rules: automatic, ordered, testable on 7 days (https://posthog.com/docs/error-tracking/assigning-issues.md)
- [err-stack-traces] Stack traces and code context: on issue details (https://posthog.com/docs/error-tracking/stack-traces.md)
- [err-source-maps] Source maps: upload by package, CLI or GitHub Action, for 18 listed targets (https://posthog.com/docs/error-tracking/upload-source-maps.md)
- [err-source-map-autofetch] Automatic symbol fetch: public maps by `sourceMappingUrl` (https://posthog.com/docs/error-tracking/stack-traces.md)
- [err-symbol-sets] Symbol set management: view, missing reasons and replace (https://posthog.com/docs/error-tracking/stack-traces.md)
- [err-releases] Releases: auto-created, with version, build and Git metadata (https://posthog.com/docs/error-tracking/releases.md)
- [err-releases-tab] Releases tab: issues by release, and filter (https://posthog.com/changelog/2026)
- [err-source-linking] Source linking: View commit to file and line (https://posthog.com/docs/error-tracking/stack-traces.md)
- [err-occurrences] Occurrences list: per issue with filter, and by recording (https://posthog.com/docs/error-tracking/monitoring.md)
- [err-replay-link] Replay link: session tab and view recording (https://posthog.com/docs/error-tracking/managing-issues.md)
- [err-logs-link] Related logs: same-session errors in Logs (https://posthog.com/docs/error-tracking/managing-issues.md)
- [err-alert-new] New or reopened alerts: Slack, Discord, Teams or webhook, filterable (https://posthog.com/docs/error-tracking/alerts.md)
- [err-alert-spike] Spike detection: per-issue baseline, multiplier, threshold and snooze (https://posthog.com/docs/error-tracking/spikes.md)
- [err-alert-trend] Trend alerts on exceptions: insight alert on `$exception` (https://posthog.com/docs/error-tracking/alerts.md)
- [err-integrations] Issue trackers: GitHub, GitLab, Linear and Jira (https://posthog.com/docs/error-tracking/integrations.md)
- [err-insights-tab] Insights tab: with release breakdowns (https://posthog.com/changelog/2026)
- [err-digest] Weekly digest: per-organization email (https://posthog.com/changelog/2026)
- [err-ai] AI debug and fix prompts: explain or fix, sent to AI, or deeplinked to coding tools (https://posthog.com/docs/error-tracking/surfaces/web-app.md)

## LLM analytics (now AI observability)

- [llm-observability] AI observability: monitors LLM usage; the docs use this name, while some API resources are still named `llm_analytics` (https://posthog.com/docs/ai-observability/surfaces/web-app.md)
- [llm-dashboard] Dashboard: users, traces, costs, generations and latency, customizable (https://posthog.com/docs/ai-observability/dashboard.md)
- [llm-tabs] Tabs: traces, sessions, users, tools and errors (https://posthog.com/docs/ai-observability/surfaces/web-app.md)
- [llm-traces] Traces: tree of generations and spans with cost and latency (https://posthog.com/docs/ai-observability/traces.md)
- [llm-waterfall] Waterfall timeline: color-coded, lanes, and full screen (https://posthog.com/docs/ai-observability/traces.md)
- [llm-conversation-display] Conversation view: three expand modes (https://posthog.com/docs/ai-observability/traces.md)
- [llm-tool-tags] Tool call tags: list tags and Tools tab (https://posthog.com/docs/ai-observability/generations.md)
- [llm-pseudo-traces] Pseudo-traces: parent trace created automatically (https://posthog.com/docs/ai-observability/traces.md)
- [llm-sessions] AI sessions: group traces by session id (https://posthog.com/docs/ai-observability/traces.md)
- [llm-generations] Generations: list with previews, filter, and raw JSON (https://posthog.com/docs/ai-observability/generations.md)
- [llm-cost-auto] Automatic cost: model and token matching (https://posthog.com/docs/ai-observability/calculating-costs.md)
- [llm-cost-custom] Custom pricing: per token, or pre-calculated, with precedence (https://posthog.com/docs/ai-observability/calculating-costs.md)
- [llm-cost-cache-reasoning] Cache and reasoning pricing: exclusive or inclusive detection (https://posthog.com/docs/ai-observability/calculating-costs.md)
- [llm-playground] Playground: system prompt, messages, tools and parameters, streamed (https://posthog.com/docs/ai-observability/playground.md)
- [llm-playground-byok] Bring your own key: major providers or OpenAI-compatible (https://posthog.com/docs/ai-observability/playground.md)
- [llm-playground-compare] Side-by-side: parallel prompt columns (https://posthog.com/docs/ai-observability/playground.md)
- [llm-playground-trace-replay] Trace replay: reproduce production generations (https://posthog.com/docs/ai-observability/playground.md)
- [llm-clusters] Clusters: groups similar traces, AI titles, daily jobs and scatter plot (https://posthog.com/docs/ai-observability/clusters.md)
- [llm-sentiment] Sentiment: local model labels user messages (https://posthog.com/docs/ai-observability/traces.md)
- [llm-summaries] Summaries: written summary and flow diagram of runs (https://posthog.com/docs/ai-observability/surfaces/web-app.md)
- [llm-replay-error-links] Replay and error links: trace to replay and exception (https://posthog.com/docs/ai-observability/surfaces/web-app.md)
- [llm-otel-link] Distributed tracing link: `$ai_trace_id` to OpenTelemetry (https://posthog.com/docs/ai-observability/traces.md)
- [llm-privacy-mode] Privacy mode: client or request level, content excluded (https://posthog.com/docs/ai-observability/privacy-mode.md)
- [llm-evals-judge] LLM-as-a-judge evals: with templates and reasoning level (https://posthog.com/docs/ai-evals.md)
- [llm-evals-code] Code evals: Hog code at no LLM cost (https://posthog.com/docs/ai-evals.md)
- [llm-evals-scope] Eval scope: generation, trace or session (https://posthog.com/docs/ai-evals.md)
- [llm-evals-output] Eval output: boolean, numeric or categorical, with pass rules and N/A (https://posthog.com/docs/ai-evals.md)
- [llm-evals-sampling] Eval sampling: rate and property filters (https://posthog.com/docs/ai-evals.md)
- [llm-evals-backfill] Eval backfills: up to 30 days (https://posthog.com/docs/ai-evals.md)
- [llm-evals-reports] Eval reports: summaries by email or Slack (https://posthog.com/docs/ai-evals.md)
- [llm-evals-offline] Offline evals: test before production (https://posthog.com/docs/ai-evals.md)
- [llm-prompts] Prompt management: `{{variable}}` prompts with immutable versions (https://posthog.com/docs/prompt-management.md)
- [llm-prompt-diff] Prompt diff: compare versions (https://posthog.com/docs/prompt-management.md)
- [llm-prompt-labels] Prompt labels: release or roll back without code (https://posthog.com/docs/prompt-management.md)
- [llm-prompt-references] Prompt references: embed another prompt (https://posthog.com/docs/prompt-management.md)
- [llm-prompt-config] Prompt config: JSON versioned with content (https://posthog.com/docs/prompt-management.md)
- [llm-prompt-usage] Prompt usage tab: fetch trends and logs (https://posthog.com/docs/prompt-management.md)

## Data pipelines

- [pipelines] CDP destinations and pipelines: sources, transformations and destinations (https://posthog.com/docs/data-pipelines.md)
- [dest-realtime] Realtime destinations: Hog functions such as Slack, HubSpot, Intercom and webhooks (https://posthog.com/docs/data-pipelines.md)
- [dest-templating] Destination templating: curly brace and Liquid over event, person and project (https://posthog.com/docs/data-pipelines/destinations/customizing-destinations.md)
- [dest-source-edit] Edit destination source: Hog code with up to 5 fetch calls (https://posthog.com/docs/data-pipelines/destinations/customizing-destinations.md)
- [dest-secret-inputs] Secret inputs: encrypted and hidden (https://posthog.com/docs/data-pipelines/destinations/customizing-destinations.md)
- [dest-filters] Destination filters: limit triggering events (https://posthog.com/docs/data-pipelines/destinations/customizing-destinations.md)
- [dest-test] Test invocation: shows the request without delivering, or sends sample (https://posthog.com/docs/data-pipelines/surfaces/web-app.md)
- [dest-logs-metrics] Function logs and metrics: successes, failures and filtered (https://posthog.com/docs/data-pipelines/surfaces/web-app.md)
- [dest-error-notifications] Error notifications: thresholds, with mute per destination (https://posthog.com/changelog/2026)
- [dest-ai-create] Generate with AI: Hog code, inputs and filters (https://posthog.com/docs/data-pipelines/surfaces/web-app.md)
- [dest-elt] ELT destinations: write synced tables to Postgres, Snowflake, BigQuery, Redshift, Databricks, S3 or Azure (https://posthog.com/docs/data-pipelines/destinations/elt-destinations.md)
- [dest-elt-override] ELT per-table override: and row monitoring (https://posthog.com/docs/data-pipelines/destinations/elt-destinations.md)
- [transform-realtime] Realtime transformations: during ingestion, no person data or HTTP (https://posthog.com/docs/data-pipelines/transformations/customizing-transformations.md)
- [transform-custom] Custom Hog transformation: return modified or null (https://posthog.com/docs/data-pipelines/transformations/customizing-transformations.md)
- [transform-test] Transformation test: example, random real or custom JSON (https://posthog.com/docs/data-pipelines/transformations/customizing-transformations.md)
- [transform-reorder] Reorder transformations: from the web app (https://posthog.com/docs/data-pipelines/surfaces/web-app.md)
- [transform-drop-events] Drop events: by name and property conditions (https://posthog.com/docs/data-pipelines/transformations/drop-events.md)
- [transform-filter-bots] Filter bot events: stops storage by UA and IP (https://posthog.com/docs/web-analytics/bot-detection.md)
- [transform-ip-hash-geo] Privacy transformations: hash PII, disable GeoIP and anonymize IP (https://posthog.com/docs/privacy/data-storage.md)
- [transform-templates-other] Other templates: SemVer flattener, hash properties, URL parameter masking and URL normalization (unverified) (https://posthog.com/docs/cdp/transformations)
- [batch-exports] Batch exports: Azure Blob, BigQuery, Databricks, S3, Snowflake, Postgres and Redshift (https://posthog.com/docs/data-pipelines/batch-exports.md)
- [batch-frequency] Export frequency: 5 minute, 15 minute, hourly, daily and weekly noted (https://posthog.com/docs/data-pipelines/batch-exports.md)
- [batch-models] Export models: events, persons, sessions and SQL query (closed beta) (https://posthog.com/docs/data-pipelines/batch-exports.md)
- [batch-backfills] Backfills: date range with row estimate, cancel (https://posthog.com/docs/data-pipelines/batch-exports.md)
- [batch-retries] Retries and manual retry: and cancel runs, filter by status (https://posthog.com/docs/data-pipelines/batch-exports.md)
- [batch-test] Export test: checks credentials (https://posthog.com/docs/data-pipelines/batch-exports.md)
- [batch-failure-alerts] Export failure alerts: Slack (https://posthog.com/changelog/2026)
- [file-exports] File download exports: Parquet or JSON Lines through API, up to a week, kept a week (https://posthog.com/docs/data-pipelines/file-download-exports.md)
- [source-managed] Managed sources: hundreds of vendors synced to warehouse, about 400 pages in the docs index (https://posthog.com/docs/data-pipelines/sources.md)
- [source-sync-webhook] Webhook sync: freshest for supported sources (https://posthog.com/docs/data-pipelines/sources.md)
- [source-sync-incremental] Incremental sync: with replication key and lookback (https://posthog.com/docs/data-pipelines/sources.md)
- [source-sync-append-full] Append and full table: other sync methods (https://posthog.com/docs/data-pipelines/sources.md)
- [source-sync-cdc] CDC and xmin: Postgres, down to 1 minute for CDC (https://posthog.com/docs/data-pipelines/sources.md)
- [source-row-filters] Row filters: up to 20 per table on SQL sources (https://posthog.com/docs/data-pipelines/sources.md)
- [source-schedule] Sync frequency and anchor time: 5-minute minimum outside CDC (https://posthog.com/docs/data-pipelines/sources.md)
- [source-schema-actions] Schema actions: pull, sync all and bulk actions (https://posthog.com/docs/data-pipelines/sources.md)
- [source-files] Self-managed sources: CSV, JSON, Parquet, and S3, GCS, R2 or Azure links (https://posthog.com/docs/data-pipelines/sources.md)
- [source-custom-rest] Custom REST source (beta): configurable API source (https://posthog.com/changelog/2026)
- [source-incoming-webhook] Incoming webhooks (feature preview): Hog templating into events, 500 KB limit (https://posthog.com/docs/data-pipelines/sources/incoming-webhooks.md)

## Data warehouse

- [data-warehouse] Data warehouse: synced sources queried with HogQL (https://posthog.com/docs/data-warehouse/surfaces/web-app.md)
- [dw-views] Saved views: named, aliased and nestable (https://posthog.com/docs/data-warehouse/views.md)
- [dw-view-link] View links to PostHog tables: join keys for direct access (https://posthog.com/docs/data-warehouse/views.md)
- [dw-materialize] Materialized views: from never through 15 minutes to monthly (https://posthog.com/docs/data-warehouse/views/materialize.md)
- [dw-materialize-deps] Dependency-ordered refresh: upstream first (https://posthog.com/docs/data-warehouse/views/materialize.md)
- [dw-materialize-incremental] Incremental materialization (beta): column, key and lookback (https://posthog.com/docs/data-warehouse/views/materialize.md)
- [dw-materialize-monitoring] Materialization panel: status, rows and errors (https://posthog.com/docs/data-warehouse/views/materialize.md)
- [dw-model-suspend] Suspend failing models: with Resume (https://posthog.com/changelog/2026)
- [dw-lineage] Lineage: dependencies and blocking deletions (https://posthog.com/changelog/2026)
- [dw-joins] Saved joins: applied when origin is queried (https://posthog.com/docs/data-warehouse/join.md)
- [dw-person-joins] Person joins: extended person properties in filters (https://posthog.com/docs/data-warehouse/join.md)
- [dw-warehouse-properties] Warehouse properties: map columns onto persons or groups, with history and backfill (https://posthog.com/docs/data-warehouse/warehouse-properties.md)
- [dw-insight-series] Warehouse tables in insights: trends, funnels, lifecycle and stickiness (https://posthog.com/docs/data-warehouse/insights.md)
- [dw-field-mapping] Field mapping: ID, distinct ID, timestamp and aggregation target (https://posthog.com/docs/data-warehouse/insights.md)
- [dw-data-quality] Data quality (beta): checks with severity and health status (https://posthog.com/docs/data-warehouse/data-quality.md)
- [dw-quality-types] Check types: not null, unique, accepted values, relationships, row count, freshness and custom SQL (https://posthog.com/docs/data-warehouse/data-quality/check-types.md)
- [dw-quality-block] Block on failed checks: stops materialization (https://posthog.com/docs/data-warehouse/views/materialize.md)
- [dw-live-query] Live query against sources: such as ClickHouse (https://posthog.com/changelog/2026)
- [dw-external-warehouse] External warehouse as source: Snowflake, BigQuery and Databricks (https://posthog.com/docs/data-warehouse/warehouse-native.md)
- [dw-access-control] Warehouse access control: source, table or view (https://posthog.com/docs/settings/warehouse-access-control.md)
- [semantic-layer] Semantic layer: governed metrics, certifications and relationships in a catalog (https://posthog.com/docs/semantic-layer.md)
- [endpoints] Endpoints: API routes from insights or SQL, versioned and materialized (https://posthog.com/docs/endpoints.md)

## Web analytics

- [web-overview] Web analytics overview: visitors, views, sessions, duration and bounce with previous-period change (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-bounce-setting] Bounce rule: one pageview, no autocapture, under 10 seconds, with adjustable threshold (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-paths-table] Top paths: views, visitors, bounce and scroll depth, click to filter (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-entry-end-paths] Entry and end paths: first and last pageviews (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-outbound-clicks] Outbound clicks: tab under paths (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-time-on-page] Average time on page: in Pages reports (https://posthog.com/changelog/2026)
- [web-referrers] Top referrers: tile (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-channels] Channels: 20 automatic channel types including AI (https://posthog.com/docs/data/channel-type.md)
- [web-custom-channels] Custom channel rules: first match wins, over defaults (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-attribution-explorer] Session attribution explorer: counts per channel, referrer and UTM with example URLs and SQL (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-utm-tiles] UTM tiles: source, medium, campaign, content and term (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-world-map] World map: countries, regions, cities, timezones and languages (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-devices] Device tile: top devices on the dashboard (https://posthog.com/docs/web-analytics/start-here.md)
- [web-retention-tile] Retention tile: weekly return cohort (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-active-hours] Active hours: heatmap with users or pageviews toggle (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-goals-tile] Goals tile: pinned or recent actions with counts (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-filters] Dashboard filters: browser, path, device, country, UTM, event and person (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-click-filter] Click row to filter: with jump to replays (https://posthog.com/docs/web-analytics/surfaces/web-app.md)
- [web-copy-data] Copy tile data: CSV, JSON or XLS (https://posthog.com/changelog/2026)
- [web-conversion-goal] Conversion goals: event or action, with conversions and rate (https://posthog.com/docs/web-analytics/conversion-goals.md)
- [web-vitals] Web vitals tab: FCP, LCP, INP and CLS over time (https://posthog.com/docs/web-analytics/web-vitals.md)
- [web-vitals-percentiles] Vitals percentiles: p75, p90 and p99 (https://posthog.com/docs/web-analytics/web-vitals.md)
- [web-vitals-pages] Vitals by page: good, needs improvement and poor (https://posthog.com/docs/web-analytics/web-vitals.md)
- [web-lcp-tile] LCP score tile: p75 first pageview, rated (https://posthog.com/docs/web-analytics/dashboard.md)
- [web-live] Live tab (alpha): realtime feed with stream filters, users chart and world map (https://posthog.com/docs/web-analytics/live.md)
- [web-health-tab] Health tab: setup gaps affecting accuracy (https://posthog.com/changelog/2026)
- [web-email-digest] Weekly digest: opt-in email (https://posthog.com/changelog/2026)
- [web-marketing] Marketing analytics (beta): cost, clicks, CPC and ROAS per campaign (https://posthog.com/docs/web-analytics/surfaces/web-app.md)
- [web-marketing-platforms] Ad platforms: Google, LinkedIn, Meta, Pinterest, TikTok, Reddit, Bing and Snapchat (https://posthog.com/docs/web-analytics/marketing-analytics.md)
- [web-marketing-mapping] Campaign mapping: name or ID, manual UTM map and source allowlist (https://posthog.com/docs/web-analytics/marketing-analytics.md)
- [web-marketing-goals] Marketing conversion goals: events, actions or warehouse tables (https://posthog.com/docs/web-analytics/marketing-analytics.md)
- [web-marketing-table] Campaign table: cost, clicks, impressions, CPC, CTR and cost per conversion (https://posthog.com/docs/web-analytics/marketing-analytics.md)
- [bot-classification] Bot detection: UA patterns and published crawler IP ranges (https://posthog.com/docs/web-analytics/bot-detection.md)
- [bot-traffic-categories] Traffic types: regular, AI agent, bot and automation, with subcategories (https://posthog.com/docs/web-analytics/bot-detection.md)
- [bot-virtual-properties] Bot virtual properties: filters and breakdowns such as `$virt_is_bot` (https://posthog.com/docs/web-analytics/bot-detection.md)
- [bot-sql-functions] Bot SQL functions: `isLikelyBot`, `getTrafficType` and others (https://posthog.com/docs/web-analytics/bot-detection.md)
- [bot-custom-rules] Custom bot rules: conditions, order and retroactive, up to 50 (https://posthog.com/docs/web-analytics/bot-detection.md)
- [bot-sdk-block] SDK bot blocking: before sending, with custom UA list and opt-out (https://posthog.com/docs/libraries/js/config)
- [bot-tab] Bots tab (alpha): requests over time, crawlers and most crawled paths (https://posthog.com/docs/web-analytics/managing-bot-traffic.md)
- [bot-http-logs] Server-side HTTP logs: `$http_log` events, with Vercel source (https://posthog.com/docs/web-analytics/sending-http-logs.md)

## Heatmaps and toolbar

- [heatmaps] Heatmaps: mouse movement, clicks, dead clicks and rage clicks (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-scrollmap] Scrollmap: scroll depth from pageview and pageleave (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-clickmap] Clickmap: element overlay with 7-day clicks and rage clicks (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-clickmap-load-all] Clickmap options: load all, match links by URL and create action (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-aggregation] Aggregation: event count or unique users (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-viewport] Viewport accuracy: tolerance across screen sizes (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-palette] Color palette: gradient or single color (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-fixed-position] Fixed positioning: scroll with page or hide (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-click-events] Click to view events: modal with timestamps, users and recordings (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-wildcards] Wildcards and URL lists: combine similar pages, with capture list (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-in-app] In-app heatmaps: display URL and data URL fields (https://posthog.com/docs/toolbar/heatmaps.md)
- [heatmap-saved] Saved heatmaps: save, filter and PNG export (https://posthog.com/changelog/2026)
- [toolbar] Toolbar on your site: launched on your site (https://posthog.com/docs/toolbar.md)
- [toolbar-inspect] Inspect: click elements to create actions with filters (https://posthog.com/docs/toolbar.md)
- [toolbar-actions] Actions panel: highlight, edit and delete with badges (https://posthog.com/docs/toolbar/create-toolbar-actions.md)
- [toolbar-flags] Flags panel: search, toggle and view as user (https://posthog.com/docs/toolbar/override-feature-flags.md)
- [toolbar-screenshot] Screenshot: attach page image to event definition (https://posthog.com/docs/toolbar.md)
- [toolbar-event-debugger] Event debugger: realtime with search, filters, pause, pin and export (https://posthog.com/docs/toolbar.md)
- [toolbar-vitals] Web vitals in toolbar: current and historic for page (https://posthog.com/docs/web-analytics/web-vitals.md)
- [toolbar-access] Toolbar access control: per role or member (https://posthog.com/docs/toolbar.md)
- [toolbar-streamer-mode] Streamer mode: hides PII while recording (https://posthog.com/changelog/2026)

## Identity and privacy

- [identify] Identify: links anonymous and known histories, frontend or backend (https://posthog.com/docs/product-analytics/identify.md)
- [alias] Alias: link several distinct IDs (https://posthog.com/docs/product-analytics/identify.md)
- [merge-dangerously] Forced merge: `$merge_dangerously`, irreversible (https://posthog.com/docs/product-analytics/identify.md)
- [reset] Reset: unlink on logout, optional device reset (https://posthog.com/docs/product-analytics/identify.md)
- [identity-validation] Identity validation: reserved IDs refused, with warning (https://posthog.com/docs/product-analytics/identify.md)
- [person-profiles-mode] Person profiles mode: identified only, always or never (https://posthog.com/docs/data/anonymous-vs-identified-events.md)
- [process-person-profile] Anonymous event flag: `$process_person_profile` false (https://posthog.com/docs/data/anonymous-vs-identified-events.md)
- [person-set] Set person properties: `$set`, `$set_once` and `$unset` (https://posthog.com/docs/product-analytics/person-properties.md)
- [first-touch-properties] First-touch person properties: `$initial_*` (https://posthog.com/docs/product-analytics/person-properties.md)
- [persistence-config] Persistence options: `localStorage+cookie` by default, cookie expiration, cross-subdomain cookie and `disable_persistence` (https://posthog.com/docs/libraries/js/config)
- [cookieless-always] Cookieless always: server-side hash, project setting required (https://posthog.com/docs/privacy/data-collection.md)
- [cookieless-on-reject] Cookieless on reject: no storage before consent, decliners counted by hash (https://posthog.com/docs/privacy/data-collection.md)
- [consent-opt-out] Opt-out and opt-in: `opt_out_capturing`, with status check (https://posthog.com/docs/privacy/data-collection.md)
- [consent-default-out] Default opt-out: nothing until consent (https://posthog.com/docs/privacy/data-collection.md)
- [consent-cross-subdomain] Shared consent: across subdomains by cookie (https://posthog.com/docs/privacy/data-collection.md)
- [consent-status] Consent status: `get_explicit_consent_status` pending state (unverified) (https://posthog.com/tutorials/nextjs-cookie-banner)
- [ip-anonymize] IP capture settings: organization default, project override, discard (https://posthog.com/docs/privacy/data-collection.md)
- [property-denylist] Property denylist: never sent (https://posthog.com/docs/libraries/js/config)
- [before-send] `before_send`: edit or reject events (https://posthog.com/docs/privacy/data-collection.md)
- [mask-autocapture] Mask autocapture: text and attributes (https://posthog.com/docs/libraries/js/config)
- [no-capture-class] `ph-no-capture`: exclude an element (https://posthog.com/docs/privacy/data-collection.md)
- [autocapture-input-safety] Input safety: only name, id and class from inputs (https://posthog.com/docs/product-analytics/privacy.md)
- [delete-person] Delete person: UI or API, with events and recordings option (https://posthog.com/docs/data/persons.md)
- [delete-events-status] Event deletion: asynchronous with status endpoint (https://posthog.com/docs/privacy/data-storage.md)
- [delete-project-org] Delete project or organization: removes all data (https://posthog.com/docs/privacy/data-storage.md)
- [retention-setting] Event retention: 1 year free and 7 years paid, set by plan and not a deletion tool (https://posthog.com/docs/data/events-retention.md)
- [retention-banner] Out-of-range banner: insights past the window (https://posthog.com/docs/data/events-retention.md)
- [eu-cloud] EU Cloud: Frankfurt hosting (https://posthog.com/docs/privacy/gdpr-compliance.md)
- [legal-dpa-baa] DPA and BAA: generated on legal page (https://posthog.com/docs/privacy.md)
- [allowed-domains] Authorized domains: for toolbar and replay, with health check (https://posthog.com/docs/health-checks.md)
- [ingest-limits] Ingest limits: 20 MB body, 1 MB event, distinct id 200 chars, and 512 KB person (https://posthog.com/docs/api.md)

## Platform

- [org-levels] Organization levels: member, admin and owner (https://posthog.com/docs/settings/access-control.md)
- [project-access] Project access: no access, member or admin, with overrides (https://posthog.com/docs/settings/access-control.md)
- [resource-access] Resource access: none, viewer, editor and manager, per object or type (https://posthog.com/docs/settings/access-control.md)
- [roles] Roles (Enterprise): group users for permissions (https://posthog.com/docs/settings/access-control.md)
- [property-access-control] Property access (Enterprise): hide properties, null in SQL (https://posthog.com/docs/settings/property-access-control.md)
- [access-terraform] Access rules via Terraform: exported and locked (https://posthog.com/changelog/2026)
- [invites] Invites: three days, with member toggle (https://posthog.com/docs/settings/organizations.md)
- [member-visibility] Member list visibility: limit who sees members (https://posthog.com/docs/settings/organizations.md)
- [project-groups] Project switcher, groups and logo: organize projects (https://posthog.com/docs/settings/projects.md)
- [project-move] Move project between organizations: self-serve same region (https://posthog.com/docs/settings/projects.md)
- [token-rotation] Regenerate project token: revokes old immediately (https://posthog.com/docs/settings/projects.md)
- [timezone] Project timezone: used by subscriptions, alerts and heatmaps, UTC by default (https://posthog.com/docs/product-analytics/subscriptions.md)
- [sso] SSO: GitHub, GitLab, Google and SAML, with enforcement (https://posthog.com/docs/settings/authentication/sso.md)
- [jit-provisioning] Just-in-time provisioning: by verified domain (https://posthog.com/docs/settings/authentication/sso.md)
- [scim] SCIM: provisioning on verified domains (https://posthog.com/docs/settings/authentication/sso.md)
- [2fa] Two-factor auth: with backup codes (https://posthog.com/docs/settings/account-settings.md)
- [session-security] Session security: review signed-in sessions (https://posthog.com/docs/settings/account-settings.md)
- [account-reminders] Personal reminders: one-off, repeating or cron (https://posthog.com/docs/settings/account-settings.md)
- [account-homepage] Homepage choice: launchpad, search or dashboard (https://posthog.com/docs/settings/account-settings.md)
- [activity-log] Activity log: actor, action, target, before and after, IP (https://posthog.com/docs/settings/activity-logs.md)
- [activity-side-panel] Activity side panel: context-aware feed (https://posthog.com/docs/settings/activity-logs.md)
- [activity-filters] Activity filters: date, user, scope, project, type, client and IP (https://posthog.com/docs/settings/activity-logs.md)
- [activity-notifications] Activity notifications: to Slack or webhook, filtered (https://posthog.com/docs/settings/activity-logs.md)
- [activity-export] Activity export: CSV or Excel (https://posthog.com/docs/settings/activity-logs.md)
- [activity-siem] SIEM feed: OCSF format (https://posthog.com/docs/settings/activity-logs.md)
- [activity-sql] Activity SQL: `system.activity_logs` (https://posthog.com/docs/settings/activity-logs.md)
- [approvals] Approvals: change requests with policies, quorum and staleness guard (https://posthog.com/docs/settings/approvals.md)
- [api-scopes] API access with scoped keys: personal, project secret and OAuth (https://posthog.com/docs/api.md)
- [api-secret-scanning] Secret scanning: leaked keys rolled or revoked (https://posthog.com/docs/api.md)
- [api-rate-limits] API rate limits: by resource (https://posthog.com/docs/api.md)
- [api-query] Query API: HogQL and insight query types, with cache modes (https://posthog.com/docs/api/queries.md)
- [api-query-async] Async queries: poll status and cancel (https://posthog.com/docs/api/queries.md)
- [api-query-budget] Query budgets: hourly bytes with headers (https://posthog.com/docs/api/queries.md)
- [api-openapi] OpenAPI spec: with Swagger and Redoc (https://posthog.com/docs/api.md)
- [mcp-server] MCP server: hosted with OAuth login, US and EU (https://posthog.com/docs/model-context-protocol.md)
- [mcp-tool-coverage] MCP tool catalog: about 80 categories across products (https://posthog.com/docs/model-context-protocol/tools.md)
- [ai-assistant] PostHog AI: answers questions by querying, building insights and SQL (https://posthog.com/docs/posthog-ai.md)
- [ai-object-creation] AI creates objects: dashboards, surveys, alerts, flags, experiments and notebooks (https://posthog.com/docs/posthog-ai/tools.md)
- [ai-modes] AI modes: seven product modes, plus plan and research modes (https://posthog.com/docs/posthog-ai/modes.md)
- [ai-context] AI context: page-aware, with @ attach (https://posthog.com/docs/posthog-ai/context-and-commands.md)
- [ai-memory] AI memory: 10,000 characters, with `/init` and `/remember` (https://posthog.com/docs/posthog-ai/edit-memory.md)
- [ai-usage-command] AI credit usage: `/usage` (https://posthog.com/docs/posthog-ai/context-and-commands.md)
- [ai-slack] AI in Slack (beta): mention or DM (https://posthog.com/docs/posthog-ai.md)
- [ai-coding-tasks] AI coding tasks: pull request on a connected repo (https://posthog.com/docs/posthog-ai.md)
- [self-driving] Self-driving: signals to reports to pull requests, with inbox (https://posthog.com/docs/self-driving.md)
- [scouts] Scouts: scheduled agents watching data (https://posthog.com/docs/self-driving.md)
- [cmdk] Command palette: recents, apps, persons, settings and create (https://posthog.com/docs/cmd-k.md)
- [keyboard-shortcuts] Global shortcuts: sidebar, theme and switchers (https://posthog.com/docs/cmd-k.md)
- [sidebar-customization] Sidebar customization: starred products and shortcuts (https://posthog.com/docs/settings/account-settings.md)
- [zen-mode] Zen mode: hides UI (https://posthog.com/changelog/2026)
- [cli] CLI: API, source maps, schema and tasks (https://posthog.com/docs/cli.md)
- [iac-definitions] Code definitions (alpha): TypeScript resources with apply, pull and prune (https://posthog.com/docs/advanced/infra-as-code.md)
- [billing-limits] Billing limits: dollar cap per product with 80% and 100% emails (https://posthog.com/docs/billing/limits-alerts.md)
- [embedded-analytics] Embedded analytics options: project per customer, filtered, or provisioned accounts (https://posthog.com/docs/data/embedded-analytics-projects.md)

## Revenue analytics

- [revenue-stripe] Payment platform link: Stripe now, others listed as coming soon (https://posthog.com/docs/revenue-analytics/start-here.md)
- [revenue-events] Revenue events: revenue, currency, product, coupon and subscription properties (https://posthog.com/docs/revenue-analytics/capture-revenue-events.md)
- [revenue-event-mapping] Custom event mapping: in the Revenue tab (https://posthog.com/docs/revenue-analytics/capture-revenue-events.md)
- [revenue-churn-config] Churn configuration: dropoff period for event subscriptions (https://posthog.com/docs/revenue-analytics/capture-revenue-events.md)
- [revenue-currency] Currency conversion: to a reporting currency, with zero-decimal handling (https://posthog.com/docs/revenue-analytics/start-here.md)
- [revenue-mrr-arr] MRR and ARR: end-of-month MRR and run rate (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-mrr-components] MRR components: new, expansion, contraction and churn (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-gross] Gross revenue: including refunds (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-customers] Subscriptions and customers: active, new and churned (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-churn-rate] Churn rate: churned over total (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-arpu-ltv] ARPU and LTV: per user and lifetime (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-top-customers] Top customers: ranked by revenue (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-breakdowns] Revenue breakdowns: product, coupon, customer, country, amount and MRR component (https://posthog.com/docs/revenue-analytics/revenue-metrics.md)
- [revenue-managed-views] Managed views: revenue views in SQL (https://posthog.com/docs/revenue-analytics/start-here.md)
- [revenue-deferred] Deferred revenue: split across service period (Stripe) (https://posthog.com/docs/revenue-analytics/deferred-revenue.md)
- [revenue-customer-link] Customer linking: automatic for events, metadata for Stripe (https://posthog.com/docs/revenue-analytics/connect-to-customers.md)
- [revenue-person-group-tables] Revenue tables: per person or group (https://posthog.com/docs/revenue-analytics/connect-to-customers.md)
- [revenue-ai] Revenue with AI: build analyses (https://posthog.com/docs/revenue-analytics/start-here.md)

## Logs

- [logs-otlp] OTLP ingestion: standard OpenTelemetry (https://posthog.com/docs/logs/basics.md)
- [logs-facets] Facet rail: level, service and resource attributes, tri-state (https://posthog.com/docs/logs/search.md)
- [logs-filter-bar] Filter bar: severity, trace, span and attributes (https://posthog.com/docs/logs/search.md)
- [logs-fulltext] Message search: exact, contains and RE2 regex (https://posthog.com/docs/logs/search.md)
- [logs-saved-views] Saved views: filter combinations (https://posthog.com/docs/logs/surfaces/web-app.md)
- [logs-query-history] Query history: last 10 queries (https://posthog.com/changelog/2026)
- [logs-sql-tab] SQL tab: custom HogQL (https://posthog.com/changelog/2026)
- [logs-csv-export] CSV export: up to 10,000 logs (https://posthog.com/changelog/2026)
- [logs-patterns] Patterns: deterministic templates with trend, count and share (https://posthog.com/docs/logs/patterns.md)
- [logs-pattern-pivot] Pattern to logs: filtered view (https://posthog.com/docs/logs/patterns.md)
- [logs-alerts] Log alerts: threshold over 5 to 60 minutes, with simulation (https://posthog.com/docs/logs/alerts.md)
- [logs-alert-noise] Alert noise reduction: N of M checks, cooldown, snooze and states (https://posthog.com/docs/logs/alerts.md)
- [logs-metrics] Log-based metrics: counters and distributions from rules (https://posthog.com/docs/logs/metrics.md)
- [logs-ai-explain] AI explain: severity, causes and next steps (https://posthog.com/docs/logs/surfaces/web-app.md)
- [logs-links] Pivot to replay, person or error: from a log (https://posthog.com/docs/logs/surfaces/web-app.md)
- [logs-linking-keys] Linking attribute keys: distinct and session id config (https://posthog.com/docs/logs/logs-config.md)
- [logs-json-parse] JSON parse: flatten body or attribute (https://posthog.com/docs/logs/logs-config.md)
- [logs-pii] PII scrubbing: patterns and sensitive keys (https://posthog.com/docs/logs/pii-scrubbing.md)
- [logs-sampling-drop] Sampling and drop rules: control retained volume (https://posthog.com/docs/logs/surfaces/web-app.md)
- [logs-retention] Custom retention: billed per GB-month (https://posthog.com/docs/logs/basics.md)

## Product tours

PostHog announced that this product stops working on 2026-09-26, offering a replacement agent skill (changelog entry dated 2026-08-27). Treat it as removed from the reference product, not as a gap. The product pages themselves could not be read.

- [product-tours-removed] Product tours: removed by PostHog on 2026-09-26 per its changelog (https://posthog.com/changelog/2026)
- [product-tours-types] Tour types: tour, announcement and banner, before removal (unverified) (https://posthog.com/docs/references/posthog-js/types/ProductTourType)
- [product-tours-steps] Step types: element, modal, survey and banner, before removal (unverified) (https://posthog.com/docs/references/posthog-js/types/ProductTourStep)

## Workflows

- [workflow-builder] Workflow builder: drag and drop, draft until enabled (https://posthog.com/docs/workflows/surfaces/web-app.md)
- [workflow-trigger-event] Event trigger: with property filters (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-trigger-webhook] Webhook trigger: with idempotency key (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-trigger-manual] Manual trigger: button (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-trigger-schedule] Schedule trigger: once or recurring (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-trigger-batch] Batch trigger: once per person in an audience (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-trigger-pixel] Tracking pixel trigger: 1x1 image (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-trigger-slack] Slack message trigger: with filters (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-frequency] Entry frequency limit: per person (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-conversion-goal] Conversion goals: metric and optional exit (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-dispatch] Dispatch steps: email, Slack, push, webhook and CDP (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-sms] SMS channel: Twilio (https://posthog.com/docs/workflows/configure-channels.md)
- [workflow-push] Push channel (open beta): FCM and APNs with identity verification (https://posthog.com/docs/workflows/configure-channels.md)
- [workflow-email-domain] Email sender verification: SPF and DKIM (https://posthog.com/docs/workflows/configure-channels.md)
- [workflow-templates] Message templates: reusable library with variables (https://posthog.com/docs/workflows/configure-channels.md)
- [workflow-posthog-actions] PostHog actions: capture event and update person (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-delays] Delays: fixed, until condition with timeout, or time window (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-branches] Branches: conditional and random (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-variables] Output variables: pick from response (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-invocations] Invocations tab: cancel in-flight runs (https://posthog.com/docs/workflows/workflow-builder.md)
- [workflow-opt-outs] Opt-outs: categories, preferences and suppression list (https://posthog.com/docs/workflows/surfaces/web-app.md)
- [workflow-metrics] Workflow monitoring: entered, position and sent (https://posthog.com/docs/workflows/surfaces/web-app.md)
- [workflow-tags] Tags: inline, filter and search (https://posthog.com/docs/workflows/surfaces/web-app.md)
- [broadcasts] Broadcasts: one-off or recurring email in a guided editor (https://posthog.com/docs/workflows/broadcasts.md)
- [broadcast-audience] Broadcast audience: filters with estimate and dedupe (https://posthog.com/docs/workflows/broadcasts.md)
- [broadcast-test-review] Broadcast review: test email and batch limit check (https://posthog.com/docs/workflows/broadcasts.md)
- [broadcast-metrics] Broadcast metrics: sent, delivered, opened, clicked and converted (https://posthog.com/docs/workflows/broadcasts.md)

## Customer analytics

- [customer-dashboard] Customer dashboard (beta): active users, signups, conversions and engagement (https://posthog.com/docs/customer-analytics/start-here.md)
- [customer-usage-metrics] Usage metrics: per-customer activity on profiles (https://posthog.com/docs/customer-analytics/start-here.md)
- [customer-profiles] Customer profiles: events, errors, LLM traces and Zendesk tickets (https://posthog.com/docs/customer-analytics/customer-profiles.md)
- [customer-journeys] Customer journeys: funnel flow graphs with path nodes and builder (https://posthog.com/docs/customer-analytics/customer-journeys.md)
- [customer-journey-node] Journey node on profiles: completed, incomplete and optional steps (https://posthog.com/docs/customer-analytics/customer-journeys.md)

## Existing rows with no direct evidence

- `dnt`: no page read describes a Do Not Track or Global Privacy Control setting. PostHog's documented controls are opt-out, cookieless mode and `before_send`. Unconfirmed either way.
- `scale`: a statement about zerosoft's own limits, with no PostHog capability to compare. The closest documented figures are the query API limits and `api-query-budget`.
- `retention-setting`: zerosoft offers a per-project retention setting, while PostHog documents plan-based retention that cannot be shortened to remove data. The rows are not the same capability.
- `flags-decide`: PostHog's documented public endpoint is `/flags`; "decide" was not seen in the pages read.
- `llm-observability`: the docs now name this product AI observability, with evals and prompt management as separate doc sections.
