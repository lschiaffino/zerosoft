# Asset inventory

Last reviewed: 2026-11-09 · Owner: security officer · Review: quarterly (with the access review)

## Information assets

| Asset | Classification | Location | Owner |
| --- | --- | --- | --- |
| Customer workspace data | Confidential (customer) | Turso, Vercel Blob, Railway | Security officer |
| Account data (users, sessions, MFA) | Confidential | Turso | Security officer |
| Secrets (env vars, encryption keys, OAuth client secrets) | Restricted | Vercel and Railway env (sensitive), password manager | Security officer |
| Source code | Public (core) / Internal (ee license keys, internal repo) | GitHub | Security officer |
| Logs | Confidential | Vercel, Railway | Security officer |
| Policies and evidence | Internal | This folder (public) and the internal repository | Security officer |

## Systems and services

| System | Purpose | Admin access |
| --- | --- | --- |
| Vercel project `zerosoftware.ai` | Hosting, functions, crons, Blob, AI Gateway | Founder |
| Turso database (production) | Primary data | Founder |
| Railway project (Evolution and services) | WhatsApp gateway | Founder |
| Resend | Email | Founder |
| Google Cloud project | OAuth client, Google APIs | Founder |
| GitHub `lschiaffino/zerosoft`, `lschiaffino/zerosoft-internal` | Code, CI, releases | Founder |
| Domain registrar and DNS for zerosoft.ai | Domains, email routing | Founder |
| OpenRouter | AI models | Founder |

## Endpoints

| Device | User | Requirements |
| --- | --- | --- |
| Founder's Mac(s) | Founder | FileVault on, automatic updates, screen lock ≤ 5 min, firewall on, password manager |

Every new laptop or account with production access is added here before it gets access, and
removed when retired (with a wipe).

Software inventory: `package.json` / `package-lock.json`, `desktop/`, `desktop/src-tauri/Cargo.lock`
are the authoritative dependency list; Dependabot watches them.
