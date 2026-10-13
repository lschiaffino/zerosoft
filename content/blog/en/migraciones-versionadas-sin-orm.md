---
title: "Versioned migrations without an ORM: a baseline, a list and one table"
description: "How Zerosoft evolves its SQLite/libSQL schema with numbered migrations in plain TypeScript, why every one must survive running twice at once, and the SQLite trap that can delete your data."
date: "2026-09-25"
author: "Zerosoftware"
tags: ["engineering", "sqlite", "architecture"]
---

Every app with a database eventually needs to change its schema while real data is sitting in it. ORMs solve this with generated migration files, a CLI and a lot of conventions. Zerosoft doesn't use an ORM — it talks to libSQL with plain SQL through a thin wrapper — so we had to solve it ourselves.

The result fits in one file, `lib/schema/migrations.ts`, and about 30 lines of runner. Here's how it works and the rules that keep it from hurting anyone.

## Where we started

For a long time the schema was one big block of `CREATE TABLE IF NOT EXISTS` plus a list of `ALTER TABLE ... ADD COLUMN` statements that ran on every boot, ignoring "duplicate column" errors. Idempotent, simple, and fine — until you need something that isn't just "add a column": backfilling data, changing a uniqueness constraint, fixing a bug in how rows were attributed. Those need to run **exactly once**, in order, on every database out there: ours on Turso, and every self-hosted SQLite file.

## Step one: freeze the past

We took that whole block — DDL, historical ALTERs, a couple of old table rebuilds — and turned it into migration number one:

```ts
export const MIGRATIONS: Migration[] = [
  { id: '001_baseline', up: baseline },
  { id: '002_track_project_owner', async up(client) { /* ... */ } },
  { id: '003_rate_limits', async up(client) { /* ... */ } },
  // ...
  { id: '012_crm_task_due_fired', async up(client) { /* ... */ } },
];
```

`baseline.ts` carries a comment in capital letters: do not edit. Because everything in it is idempotent, running it against a database that already existed before migrations is safe. A fresh install and a two-year-old instance converge on the same schema.

## Step two: a table that remembers

```ts
export async function runMigrations(client: Client, migrations = MIGRATIONS) {
  await client.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const done = new Set((await client.execute('SELECT id FROM schema_migrations')).rows.map((r) => String(r.id)));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await m.up(client);
    await client.execute({ sql: 'INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)', args: [m.id] });
  }
}
```

That's the runner. Each migration is an `id` and an async `up(client)` function — plain TypeScript, so it can run SQL, read rows, compute things in JS and write them back. No down migrations: we only go forward. Rolling back means restoring a backup, which is why the [self-hosting guide](/blog/self-hosting-con-docker-paso-a-paso) says to back up before updating.

## When it runs: lazily, before the first query

There's no `migrate` command to remember. In `lib/db.ts`, `ensureMigrated()` creates a single promise per process that runs the pending migrations. Every query the app makes awaits that promise before executing, so no query can ever hit a table that doesn't exist yet. If migrating fails, the promise is reset and the next request tries again.

This is what makes the same code work for a self-hosted container (one process, starts once) and for serverless (many instances, cold-starting whenever they feel like it).

## Rule 1: never edit or reorder a published migration

Once a migration has shipped, some database somewhere has recorded its id as done. If you change its body, that database will never run the new version. Need to fix something? Add migration 013.

## Rule 2: every migration must survive running twice, at the same time

Here's the part people miss. Serverless instances boot in parallel. Two of them can read `schema_migrations`, both see that `005` is pending, and both run it. There's no lock — on purpose, because a lock table on a remote database brings its own failure modes (who releases a lock held by an instance that got killed?).

Instead, every migration is idempotent:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Columns go through an `addColumn` helper that swallows "duplicate column" errors.
- Backfills only touch rows that still need it: `UPDATE ... WHERE handle IS NULL`, not a blanket `UPDATE`.
- The bookkeeping insert is `INSERT OR IGNORE`.

And it's tested. `tests/unit/migrations.test.ts` runs all migrations on an empty database (then checks a second run applies nothing), and runs two `runMigrations` calls concurrently against the same database to make sure they both finish and the result is correct.

## Rule 3: rebuild tables with foreign keys off

SQLite's `ALTER TABLE` can add and rename columns, but it can't change a `UNIQUE` or `CHECK` constraint. The official recipe is: create a new table, copy the rows, drop the old one, rename the new one.

The trap: with `PRAGMA foreign_keys = ON` (which we use), `DROP TABLE links` behaves like a `DELETE` of every row — and every child table with `ON DELETE CASCADE` loses its rows too. Rebuild your links table that way and every click ever recorded disappears.

Migration `009_link_domains` is exactly this case: link slugs went from globally unique to unique per custom domain. It uses libSQL's `client.migrate([...])`, which runs the batch with foreign keys turned off:

```ts
await client.migrate([
  `CREATE TABLE links_new ( ... domain_id TEXT REFERENCES link_domains(id), slug TEXT NOT NULL, ... )`,
  `INSERT INTO links_new (${cols}) SELECT ${cols} FROM links`,
  'DROP TABLE links',
  'ALTER TABLE links_new RENAME TO links',
]);
```

And because of rule 2, it only rebuilds if the table still has the old shape — it reads the table's SQL from `sqlite_master` and skips the rebuild if `domain_id` is already there.

## Migrations that think about the data

Some of the most useful migrations aren't about schema at all:

- `002_track_project_owner` added an owner to Track projects and backfilled it: team projects get the team owner, personal ones get the creator of the first issue, and anything that can't be attributed stays hidden instead of becoming visible to everyone.
- `005_user_handles` generated a unique public handle for every existing user, in JS, avoiding collisions.
- `012_crm_task_due_fired` moved the "task due" workflow trigger to the cron job — and marked every already-overdue task as fired, so the first tick after deploying didn't unleash a flood of automations.

That last one is the real argument for code-based migrations. Thinking about what the first run will do to existing data is the job.

## What we gave up

Being honest about the costs:

- **No schema diffing.** Nothing generates migrations from a model. You write the SQL.
- **Hand-written types.** Row types live in `lib/schema/types.ts` and are kept in sync by discipline and review, not by codegen.
- **No transaction around a migration.** If one fails halfway, what's already done stays done — which is one more reason every step has to be idempotent, so the retry finishes the job.
- **The first request pays.** A slow migration runs on the cold start that triggers it.

For a codebase that wants to run identically on a single SQLite file and on [a remote Turso database](/blog/un-codigo-sqlite-local-o-turso), we'll take that trade. The entire migration system is a list, a table and a loop — and you can read all of it before your coffee gets cold.
