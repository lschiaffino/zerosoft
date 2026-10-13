/**
 * Seed — Link (demo data).
 * Idempotent: wipes the demo user's links/clicks/keys and recreates them.
 * Run with: npm run seed
 */
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { ensureMigrated, getClient, getDb, txDb, upsertUser } from '../lib/db';
import { hashPassword } from '../lib/links';

const USER_ID = 'demo';
const EMAIL = 'demo@zerosoft.ai';
const GATE_PASSWORD = 'ceros';
const TOTAL_CLICKS = 450;

// Deterministic PRNG so re-seeds produce the same dataset.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

function pickWeighted<T>(pairs: Array<[T, number]>): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, weight] of pairs) {
    r -= weight;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

const REFERRERS: Array<[string, number]> = [
  ['direct', 0.4],
  ['twitter.com', 0.18],
  ['linkedin.com', 0.12],
  ['newsletter', 0.1],
  ['news.ycombinator.com', 0.1],
  ['reddit.com', 0.1],
];
const COUNTRIES: Array<[string, number]> = [
  ['US', 0.3],
  ['AR', 0.15],
  ['BR', 0.12],
  ['ES', 0.1],
  ['MX', 0.08],
  ['DE', 0.08],
  ['IN', 0.07],
  ['GB', 0.06],
  ['FR', 0.04],
];
const DEVICES: Array<[string, number]> = [
  ['desktop', 0.65],
  ['mobile', 0.32],
  ['tablet', 0.03],
];
const BROWSERS: Array<[string, number]> = [
  ['Chrome', 0.58],
  ['Safari', 0.24],
  ['Firefox', 0.1],
  ['Edge', 0.08],
];
const OSES: Array<[string, number]> = [
  ['macOS', 0.34],
  ['Windows', 0.3],
  ['iOS', 0.16],
  ['Android', 0.14],
  ['Linux', 0.06],
];

interface SeedLink {
  slug: string;
  url: string;
  title?: string;
  tags?: string[];
  share: number; // fraction of TOTAL_CLICKS
  createdDaysAgo: number;
  archived?: boolean;
  expired?: boolean;
  password?: boolean;
  utm?: { source: string; medium: string; campaign: string };
}

const LINKS: SeedLink[] = [
  { slug: 'launch', url: 'https://github.com/zerosoft/link/releases/tag/v1.0.0', title: 'v1.0 launch', tags: ['launch', 'product'], share: 0.25, createdDaysAgo: 45 },
  // NOTE: the brief's "docs"/"blog"/"demo" slugs collide with RESERVED_SLUGS and
  // "roadmap" hits a middleware matcher quirk (paths starting with "r" skip the
  // rewrite), so they were renamed to guide/updates/tryit/plan. middleware.ts and
  // lib/reserved.ts are off-limits.
  { slug: 'guide', url: 'https://github.com/zerosoft/link#readme', title: 'Documentation', tags: ['docs'], share: 0.12, createdDaysAgo: 40 },
  { slug: 'gh', url: 'https://github.com/zerosoft', title: 'GitHub org', share: 0.12, createdDaysAgo: 38 },
  { slug: 'updates', url: 'https://zerosoft.ai/en/blog', title: 'Blog', share: 0.08, createdDaysAgo: 35 },
  { slug: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Launch video', tags: ['launch'], share: 0.08, createdDaysAgo: 30 },
  { slug: 'plan', url: 'https://github.com/orgs/zerosoft/projects/1', title: 'Public roadmap (old)', share: 0.06, createdDaysAgo: 28, archived: true },
  { slug: 'pricing', url: 'https://zerosoft.ai/#model', title: 'Pricing = $0', share: 0.07, createdDaysAgo: 25 },
  { slug: 'twitter', url: 'https://twitter.com/zerosoft', title: 'Twitter / X', share: 0.06, createdDaysAgo: 22 },
  { slug: 'linkedin', url: 'https://www.linkedin.com/company/zerosoft', title: 'LinkedIn', share: 0.05, createdDaysAgo: 18 },
  {
    slug: 'newsletter',
    url: 'https://zerosoft.ai/?utm_source=newsletter&utm_medium=email&utm_campaign=launch',
    title: 'Newsletter #1',
    tags: ['newsletter', 'launch'],
    share: 0.05,
    createdDaysAgo: 15,
    utm: { source: 'newsletter', medium: 'email', campaign: 'launch' },
  },
  { slug: 'tryit', url: 'https://zerosoft.ai/en/app', title: 'Live demo (password: ceros)', share: 0.04, createdDaysAgo: 12, password: true },
  { slug: 'zero', url: 'https://zerosoft.ai/', title: 'Expired promo', share: 0.02, createdDaysAgo: 10, expired: true },
];

function utc(daysAgo: number, h: number, m: number, s: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(h)}:${pad(m)}:${pad(s)}`;
}

async function main() {
  const db = getDb();
  await upsertUser({ id: USER_ID, email: EMAIL, name: 'Demo User', image: null });

  // Wipe previous demo data (clicks cascade from links).
  await db.prepare('DELETE FROM links WHERE user_id = ?').run(USER_ID);
  await db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(USER_ID);

  let totalClicks = 0;

  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    const insertLink = tdb.prepare(
      `INSERT INTO links (id, user_id, slug, url, title, tags, password_hash, expires_at, max_clicks, archived, utm_source, utm_medium, utm_campaign, clicks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, ?)`,
    );
    const insertClick = tdb.prepare(
      'INSERT INTO clicks (link_id, ts, referrer, country, device, browser, os) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const syncCount = tdb.prepare(
      'UPDATE links SET clicks = (SELECT COUNT(*) FROM clicks WHERE clicks.link_id = links.id) WHERE id = ?',
    );

    for (const link of LINKS) {
      const id = crypto.randomUUID();
      const createdAt = utc(link.createdDaysAgo, 9, 30, 0);
      const expiresAt = link.expired ? new Date(Date.now() - 2 * 86_400_000).toISOString() : null;
      await insertLink.run(
        id,
        USER_ID,
        link.slug,
        link.url,
        link.title ?? null,
        JSON.stringify(link.tags ?? []),
        link.password ? await hashPassword(GATE_PASSWORD) : null,
        expiresAt,
        link.archived ? 1 : 0,
        link.utm?.source ?? null,
        link.utm?.medium ?? null,
        link.utm?.campaign ?? null,
        createdAt,
        createdAt,
      );

      // Distribute this link's clicks over the last 30 days (only days after creation),
      // on a rising curve with a spike ~12 days back for the "launch" link.
      const target = Math.round(link.share * TOTAL_CLICKS);
      const daysAvailable = Math.min(29, link.createdDaysAgo);
      const dayWeights: Array<[number, number]> = [];
      for (let daysAgo = daysAvailable; daysAgo >= 0; daysAgo--) {
        let w = 0.4 + ((29 - daysAgo) / 29) * 1.6;
        if (link.slug === 'launch' && daysAgo >= 11 && daysAgo <= 13) w *= 6;
        dayWeights.push([daysAgo, w]);
      }

      for (let i = 0; i < target; i++) {
        const daysAgo = pickWeighted(dayWeights);
        await insertClick.run(
          id,
          utc(daysAgo, Math.floor(rand() * 24), Math.floor(rand() * 60), Math.floor(rand() * 60)),
          pickWeighted(REFERRERS),
          pickWeighted(COUNTRIES),
          pickWeighted(DEVICES),
          pickWeighted(BROWSERS),
          pickWeighted(OSES),
        );
        totalClicks++;
      }
      await syncCount.run(id);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  // Demo API key — the full key is printed here, only its sha256 is stored.
  const demoKey = `zs_demo_${nanoid(32)}`;
  await db
    .prepare('INSERT INTO api_keys (id, user_id, name, prefix, key_hash) VALUES (?, ?, ?, ?, ?)')
    .run(
      crypto.randomUUID(),
      USER_ID,
      'Demo key',
      demoKey.slice(0, 10),
      createHash('sha256').update(demoKey).digest('hex'),
    );

  const linkCount = ((await db.prepare('SELECT COUNT(*) AS c FROM links WHERE user_id = ?').get(USER_ID)) as { c: number }).c;
  console.log(`\n0 — seed complete`);
  console.log(`    user:   ${EMAIL} (id=${USER_ID})`);
  console.log(`    links:  ${linkCount} (${totalClicks} clicks over the last 30 days)`);
  console.log(`    gate:   /tryit is password-protected → password "${GATE_PASSWORD}"`);
  console.log(`    api key (save it, shown once):\n\n      ${demoKey}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
