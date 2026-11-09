# Subprocessors

Last reviewed: 2026-11-09. Public version: https://zerosoft.ai/en/subprocessors (same list).

Service providers that process personal data on behalf of zerosoft cloud customers. Self-hosted
instances use none of these unless the operator configures them.

## Infrastructure (always used)

| Provider | Purpose | Data | Location |
| --- | --- | --- | --- |
| Vercel Inc. | Hosting, serverless functions, scheduled jobs, file storage (Vercel Blob), request logs, AI Gateway | All customer data in transit; uploaded files; request logs with IP addresses | United States (functions run in the default US region) |
| Turso (ChiselStrike Inc.) | Primary database and its backups | All account and workspace data | Region of the production database (to be confirmed by the owner; see note) |
| Railway Corp. | Runs the WhatsApp gateway (Evolution) used by Groups and Inbox | WhatsApp messages, contacts and media of connected numbers; session keys of the connected device | United States (Railway region of the service) |
| Resend Inc. | Transactional and lifecycle email delivery | Recipient email address, email content, delivery events | United States |
| GitHub Inc. (Microsoft) | Source code, CI, desktop app releases | No customer data (only code and build artifacts) | United States |

## Features (used only when the feature is used)

| Provider | Purpose | Data | Location |
| --- | --- | --- | --- |
| Google LLC | Sign in with Google; Gmail and Google Calendar integrations a user connects | Name, email, profile picture; emails and events the integration syncs | United States |
| Vercel AI Gateway, routing to the model provider selected (Anthropic by default) | AI features (assistant, agents, summaries, drafting) | The prompt and the content the user sends to the AI feature | United States |
| OpenRouter Inc., routing to the model provider selected | AI assistant models | The prompt and the content the user sends to the AI feature | United States |

AI providers are used through their APIs under terms that do not allow training on API
inputs. Content is never used to train models by zerosoft.

## Customer-chosen destinations (not subprocessors)

Integrations a workspace connects with its own account (Slack, Microsoft 365, Stripe, Twilio,
Meta, GitHub App, Notion, webhooks, the API, MCP clients) receive data because the customer
instructs it. They act under the customer's own contract with that provider.

## Changes

New subprocessors are announced on this page at least 15 days before they start processing
personal data. Customers with a signed DPA can subscribe to notifications by writing to
privacy@zerosoft.ai and can object within that period.

## Note for the owner

Confirm and record: the Turso database region (`turso db show <db>`), the Vercel function
region (Project › Settings › Functions), the Railway region of the Evolution service, and
which AI providers are enabled in AI Gateway and OpenRouter. Update the "Location" column
and the public page if anything differs.
