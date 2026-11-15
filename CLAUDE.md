# zerosoft

See [AGENTS.md](AGENTS.md) for how to work in this repo: stack, what "done"
means, checks, copy and design rules. It applies to people and to any coding
agent. Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Maintainer automation (zerosoft team only)

This section is for the zerosoft team's own agents (local sessions, subagents
and the daily cloud routines). If you are an outside contributor, skip it:
commit with your own name and email, and open a PR as CONTRIBUTING.md says.

- **Precedence:** if a routine or task prompt conflicts with this file or
  AGENTS.md, these files win.
- **Commit identity for deploys:** our agents commit as
  `Lautaro Schiaffino <lschiaffino@users.noreply.github.com>` (Vercel rejects
  deploys from other authors) with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Vercel deploys
  `main` automatically, and only `main` (`vercel.json` turns off branch
  previews).
- **Backlog, feature parity and security bugs:** follow the Conventions in
  AGENTS.md (`research/ideas.json`, `content/changelog-entries/`,
  `content/feature-parity/<app>.ts`).
- **Routine prompts:** the daily blog routine is `docs/blog-routine.md`.
  Internal material (product strategy, brand drafts, design reviews) lives in
  the private repo `lschiaffino/zerosoft-internal`.
