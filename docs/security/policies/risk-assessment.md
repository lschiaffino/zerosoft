# Risk assessment methodology

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly, and after major changes or incidents

## Method

1. **Identify** risks per asset ([asset-inventory.md](asset-inventory.md)): threats (external
   attacker, malicious insider, provider failure, human error, legal change) against
   vulnerabilities.
2. **Score** likelihood (1 rare – 5 almost certain) × impact (1 negligible – 5 severe: data of
   many customers exposed, multi-day outage, regulatory fine). Score 1–25.
3. **Treat**: 15–25 must be mitigated within 30 days; 8–14 mitigate or formally accept within
   90 days; 1–7 accept and monitor. Options: mitigate, transfer (insurance, contract), avoid,
   accept (security officer signs, with expiry).
4. **Record** in the risk register in the internal repository: id, description, asset, owner,
   likelihood, impact, score, treatment, controls (link to [../controls.md](../controls.md)),
   residual score, review date.
5. **Review** every quarter with the access review, and yearly in full. The yearly review is
   the input to the ISO 27001 management review (clause 9.3).

## Risk categories always considered

- Tenant isolation failures (one workspace seeing another's data).
- Credential leaks (production env vars, OAuth secrets, API keys) and key compromise.
- Vulnerable dependencies and supply chain.
- Single-person dependency (bus factor) for production access.
- Provider outage or account loss (Vercel, Turso, Railway).
- AI features sending more data than needed to model providers; prompt injection through
  customer content.
- Data retained longer than promised; deletion not reaching files or backups.
- Regulatory: international transfers, data subject request deadlines.

The scored register itself is internal (it describes weaknesses) and is never published here.
