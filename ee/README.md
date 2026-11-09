<!-- SPDX-License-Identifier: LicenseRef-Zerosoft-EE -->

# ee/: Zerosoft Enterprise

Everything in this folder is source-available under the
[Zerosoft Enterprise License](./LICENSE), not AGPL. Everything outside `ee/`
is AGPLv3: every feature of every app stays open source and free to self-host.

## What goes here

Only features that large organizations need to run zerosoft at scale:

- SSO / SAML
- SCIM user provisioning
- Audit log export and long retention
- Custom roles and granular permissions
- White-label and custom domain: your branding instead of zerosoft's, and
  the app served on your own domain (custom domains for short links and Docs
  sites stay in the core)
- Multi-workspace administration

Nothing else. A feature that one team needs to do its daily work (in CRM,
Track, Docs, Cal or any other app) belongs in the AGPL core, not here.

Managed services that we run for you, like the hosted WhatsApp server for
Lines or the AI quota, are not in `ee/`. They are billed on Zerosoft Cloud,
and self-hosters bring their own server or API key through the settings in
`.env.example`.

## License in short

The [LICENSE](./LICENSE) text is what counts. In short:

- **Development and testing are free.** Read, copy, modify and run this code in
  non-production environments without a subscription.
- **Production use needs a subscription** covering your scope of use.
- **No redistribution, resale as a service, or bypassing license checks.**
  Forks of the repository are fine as long as `ee/` keeps this license and its
  notices.
- **Changes to `ee/` belong to the company.** We don't accept pull requests to
  `ee/` from outside contributors.
- The license is a **draft pending legal review**. Questions: hola@zerosoft.ai.

## Rules for code in this folder

- Every file starts with `SPDX-License-Identifier: LicenseRef-Zerosoft-EE`.
  CI fails without it (`scripts/check-ee-boundary.ts`).
- Core code never imports from `ee/` except `ee/lib/license.ts`
  (`isEnterprise()` / `hasFeature()`). CI fails on any other import.
- An enterprise feature degrades cleanly: without a license the core keeps
  working.

## License keys

Keys are verified offline (no phone-home): an Ed25519 signature over a small
JSON payload.

- Runtime: set `ZEROSOFT_LICENSE_KEY` (and `ZEROSOFT_LICENSE_PUBLIC_KEY` until
  the official public key ships in code).
- Issuing: `npx tsx scripts/ee-license.ts keygen` once (keep the private key
  secret, never commit it), then
  `ZEROSOFT_LICENSE_PRIVATE_KEY=… npx tsx scripts/ee-license.ts issue "Acme Inc" 2027-12-31 sso,scim,audit,roles,whitelabel,multiworkspace`.
