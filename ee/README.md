# /ee — Zerosoft Enterprise

Everything in this folder is source-available under the [Zerosoft Enterprise License](./LICENSE),
not AGPL. Everything **outside** `/ee` is AGPLv3 and always will be: every core feature of
every product is free to self-host.

What lives here (as it gets built):

- SSO / SAML and SCIM provisioning
- Audit logs
- Custom roles and granular permissions
- White-label (remove Zerosoft branding from booking pages and the chat widget)

## Rules for contributors

- Core code must never import from `/ee` except through `ee/lib/license.ts` (`isEnterprise()` / `hasFeature()`).
- An enterprise feature must degrade cleanly: without a license the core keeps working.

## License keys

Keys are verified **offline** (no phone-home): an Ed25519 signature over a small JSON payload.

- Runtime: set `ZEROSOFT_LICENSE_KEY` (and `ZEROSOFT_LICENSE_PUBLIC_KEY` until the official public key ships in code).
- Issuing: `npx tsx scripts/ee-license.ts keygen` once (keep the private key secret, never commit it), then
  `ZEROSOFT_LICENSE_PRIVATE_KEY=… npx tsx scripts/ee-license.ts issue "Acme Inc" 2027-12-31 sso,audit,roles,whitelabel`.
