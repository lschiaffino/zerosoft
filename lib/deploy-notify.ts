/**
 * Mail de resumen de cada deploy de producción: los PRs (o commits sueltos) que entraron desde el deploy
 * anterior que se avisó. Lo manda la app misma desde el cron de cada minuto (/api/cron/minute), no un
 * workflow de GitHub: el cron corre en el deploy que está en producción, así que apenas un deploy nuevo
 * atiende, su primer minuto manda el mail. No depende de la cola de Actions.
 *
 * Un mail por deploy: la fila de `deploy_notifications` (clave: el sha) se toma antes de mandar. Si el envío
 * falla se reintenta a los 10 minutos, hasta 5 veces; Resend además no repite un mail con la misma clave.
 *
 * Variables: DEPLOY_NOTIFY_TO (destinatarios, separados por coma; sin ella no se manda nada),
 * RESEND_API_KEY, DEPLOY_NOTIFY_GITHUB_TOKEN (lectura del repo; sin ella la API de GitHub va sin
 * autenticar, con un límite bajo), DEPLOY_NOTIFY_FROM y DEPLOY_NOTIFY_REPO (opcionales). Server-only.
 */
import { getDb } from './db';
import { sendEmail } from './email';

const SITE = 'https://zerosoft.ai';
const RETRY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
type Send = typeof sendEmail;

export interface DeployNotifyDeps {
  env?: Env;
  fetch?: Fetch;
  send?: Send;
  now?: () => number;
}

export type DeployNotifyResult =
  | { state: 'off'; reason: string }
  | { state: 'done' }
  | { state: 'busy' }
  | { state: 'nothing-new'; sha: string }
  | { state: 'sent'; sha: string; changes: number; recipients: number }
  | { state: 'failed'; sha: string; error: string };

interface PrPart { n: number; title: string; url: string }
interface ChangelogEntry { title: string; items: { product: string; text: string }[] }
interface PrInfo {
  n: number; title: string; url: string; gist: string; parts: PrPart[];
  additions: number; deletions: number; files: number; author: string; entries: ChangelogEntry[];
}
interface LooseCommit { sha: string; subject: string }
export interface DeployMail { subject: string; html: string; text: string; changes: number }

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Primer párrafo útil del cuerpo de un PR (sin la firma). */
export function gist(body: unknown): string {
  const text = String(body || '')
    .replace(/🤖 Generated with[^\n]*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const para = text.split(/\n\s*\n/).find((p) => p.trim() && !/^#+\s/.test(p.trim())) || '';
  return para.replace(/\s+/g, ' ').slice(0, 400);
}

/** Lee un string entre comillas simples de TypeScript (con \' y \\ escapados). */
function unq(raw: string): string {
  return raw.replace(/\\(['"\\n])/g, (_, c) => (c === 'n' ? '\n' : c));
}

/** El título y los ítems en inglés de una entrada de content/changelog-entries/*.ts. */
export function parseChangelogEntry(src: string, n: number): ChangelogEntry | null {
  const title = /title:\s*\{[\s\S]*?\ben:\s*'((?:\\.|[^'\\])*)'/.exec(src);
  const itemsSrc = src.slice(src.indexOf('items:'));
  const items: ChangelogEntry['items'] = [];
  const re = /product:\s*'([a-z0-9-]+)'[\s\S]*?\ben:\s*'((?:\\.|[^'\\])*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(itemsSrc))) items.push({ product: m[1], text: unq(m[2]) });
  return title || items.length ? { title: title ? unq(title[1]) : `Update #${n}`, items } : null;
}

/** Arma el mail (en inglés): lo nuevo (el texto de cada entrada del changelog), lo interno y los números. */
export function buildDeployMail(o: { repo: string; sha: string; base: string | null; prs: PrInfo[]; direct: LooseCommit[]; deployUrl?: string; when: Date }): DeployMail {
  const { repo, sha, base, prs, direct, deployUrl } = o;
  const short = sha.slice(0, 8);
  const count = prs.reduce((a, p) => a + (p.parts.length || 1), 0) + direct.length;
  const entries = prs.flatMap((p) => p.entries.map((e) => ({ ...e, pr: p })));
  const internal = prs.filter((p) => !p.entries.length);
  const totals = prs.reduce((t, p) => ({ add: t.add + p.additions, del: t.del + p.deletions, files: t.files + p.files }), { add: 0, del: 0, files: 0 });
  const when = o.when.toUTCString().replace(' GMT', ' UTC');
  const subject =
    entries.length === 1 && count === 1
      ? `Live on zerosoft.ai: ${entries[0].title}`
      : entries.length
        ? `Live on zerosoft.ai: ${entries.length} ${entries.length === 1 ? 'update' : 'updates'}${internal.length + direct.length ? ` + ${internal.length + direct.length} internal` : ''} (${short})`
        : `Deployed ${short}: ${count} internal ${count === 1 ? 'change' : 'changes'}`;
  const productName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

  const h = (t: string) => `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#888;margin:28px 0 10px">${t}</h2>`;
  const entryHtml = (e: (typeof entries)[number]) =>
    `<div style="margin:0 0 22px"><div style="font-size:17px;font-weight:600;margin:0 0 6px">${esc(e.title)}</div>${e.items
      .map(
        (i) =>
          `<p style="margin:0 0 8px">${i.product ? `<span style="display:inline-block;font-size:12px;font-weight:600;color:#555;border:1px solid #ddd;border-radius:4px;padding:0 6px;margin-right:6px">${esc(productName(i.product))}</span>` : ''}${esc(i.text)}</p>`,
      )
      .join('')}<div style="font-size:13px;color:#888"><a href="${esc(e.pr.url)}" style="color:#888">PR #${e.pr.n}</a> · ${e.pr.files} files · +${e.pr.additions} −${e.pr.deletions}</div></div>`;
  const internalHtml = (p: PrInfo) =>
    `<li style="margin:0 0 12px"><a href="${esc(p.url)}" style="color:#111;font-weight:600">#${p.n} ${esc(p.title)}</a> <span style="color:#888;font-size:13px">· ${p.files} files · +${p.additions} −${p.deletions}</span>${
      p.gist ? `<div style="color:#555;margin-top:4px">${esc(p.gist)}</div>` : ''
    }${p.parts.length ? `<ul style="padding-left:18px;margin:6px 0 0;color:#333">${p.parts.map((x) => `<li style="margin:0 0 4px"><a href="${esc(x.url)}" style="color:#333">#${x.n}</a> ${esc(x.title)}</li>`).join('')}</ul>` : ''}</li>`;
  const links = [
    base ? `<a href="https://github.com/${repo}/compare/${base.slice(0, 12)}...${short}" style="color:#888">All changes</a>` : '',
    `<a href="${SITE}/en/changelog" style="color:#888">Changelog</a>`,
    `<a href="${SITE}/en/status" style="color:#888">Status</a>`,
    deployUrl ? `<a href="${esc(deployUrl)}" style="color:#888">Deployment</a>` : '',
  ].filter(Boolean);
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:640px">
<p style="margin:0 0 6px">A new version of <a href="${SITE}" style="color:#111">zerosoft.ai</a> is live in production.</p>
<p style="margin:0;color:#555;font-size:14px">Version <code>${short}</code> · ${esc(when)} · ${count} ${count === 1 ? 'change' : 'changes'} from ${prs.length} ${prs.length === 1 ? 'pull request' : 'pull requests'}${direct.length ? ` and ${direct.length} direct ${direct.length === 1 ? 'commit' : 'commits'}` : ''} · ${totals.files} files · +${totals.add} −${totals.del}</p>
${entries.length ? h("What's new") + entries.map(entryHtml).join('') : ''}
${internal.length || direct.length ? h(entries.length ? 'Also shipped (internal)' : 'What shipped (internal)') + `<ul style="padding-left:18px;margin:0">${internal.map(internalHtml).join('')}${direct
    .map((c) => `<li style="margin:0 0 10px"><a href="https://github.com/${repo}/commit/${c.sha}" style="color:#111">${esc(c.subject)}</a> <span style="color:#888">${c.sha.slice(0, 8)}</span></li>`)
    .join('')}</ul>` : ''}
${!entries.length && !internal.length && !direct.length ? '<p>No new code changes (redeploy).</p>' : ''}
<p style="color:#888;font-size:13px;margin:28px 0 0">${links.join(' · ')}</p>
</div>`;
  const text = [
    `A new version of zerosoft.ai is live in production.`,
    `Version ${short} · ${when} · ${count} ${count === 1 ? 'change' : 'changes'} · ${totals.files} files · +${totals.add} -${totals.del}`,
    ...(entries.length ? ['', "WHAT'S NEW", ...entries.flatMap((e) => ['', e.title, ...e.items.map((i) => `${i.product ? `[${productName(i.product)}] ` : ''}${i.text}`), `PR #${e.pr.n}: ${e.pr.url}`])] : []),
    ...(internal.length || direct.length
      ? ['', 'ALSO SHIPPED (INTERNAL)', ...internal.map((p) => `- #${p.n} ${p.title}${p.gist ? `\n  ${p.gist}` : ''}${p.parts.map((x) => `\n  · #${x.n} ${x.title}`).join('')}`), ...direct.map((c) => `- ${c.subject} (${c.sha.slice(0, 8)})`)]
      : []),
    '',
    `Changelog: ${SITE}/en/changelog · Status: ${SITE}/en/status${base ? ` · All changes: https://github.com/${repo}/compare/${base.slice(0, 12)}...${short}` : ''}`,
  ].join('\n');
  return { subject, html, text, changes: count };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas de la API de GitHub */
/** Junta de GitHub lo que entró entre `base` y `sha`. null: `sha` no trae nada nuevo respecto de `base`. */
export async function collectChanges(o: { repo: string; sha: string; base: string | null; token?: string; fetch: Fetch }): Promise<{ prs: PrInfo[]; direct: LooseCommit[]; base: string | null } | null> {
  const gh = async (path: string): Promise<any> => {
    const res = await o.fetch(`https://api.github.com/repos/${o.repo}${path}`, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'zerosoft-deploy-notify',
      },
    });
    if (!res.ok) throw new Error(`github ${res.status} ${path}`);
    return res.json();
  };

  // Sin un deploy avisado antes (la primera vez): el último deploy de producción anterior que terminó bien.
  let base = o.base;
  if (!base) {
    const list = await gh('/deployments?environment=Production&per_page=30');
    for (const d of list) {
      if (d.sha === o.sha) continue;
      const statuses = await gh(`/deployments/${d.id}/statuses?per_page=5`);
      if (statuses.some((s: any) => s.state === 'success')) {
        base = d.sha;
        break;
      }
    }
  }

  let commits: any[] = [];
  if (base) {
    const cmp = await gh(`/compare/${base}...${o.sha}`);
    if (cmp.status === 'behind' || cmp.status === 'identical') return null;
    commits = cmp.commits || [];
  } else {
    commits = [await gh(`/commits/${o.sha}`)];
  }

  const prNums: number[] = [];
  const loose: LooseCommit[] = [];
  for (const c of commits) {
    const subject = String(c.commit.message).split('\n')[0];
    const m = /^Merge pull request #(\d+)/.exec(subject);
    if (m) prNums.push(Number(m[1]));
    else if (c.parents?.length < 2 && !/^Merge (remote-tracking )?branch/.test(subject)) loose.push({ sha: c.sha, subject });
  }

  /** Las entradas del changelog que trae un PR, leídas de la versión desplegada. */
  const changelogEntries = async (n: number): Promise<ChangelogEntry[]> => {
    const out: ChangelogEntry[] = [];
    try {
      const files = await gh(`/pulls/${n}/files?per_page=100`);
      for (const f of files.filter((x: any) => /^content\/changelog-entries\/.+\.ts$/.test(x.filename) && x.status !== 'removed').slice(0, 5)) {
        try {
          const file = await gh(`/contents/${f.filename}?ref=${o.sha}`);
          const entry = parseChangelogEntry(Buffer.from(file.content || '', 'base64').toString('utf8'), n);
          if (entry) out.push(entry);
        } catch {}
      }
    } catch {}
    return out;
  };

  const prs: PrInfo[] = [];
  for (const n of [...new Set(prNums)]) {
    try {
      const pr = await gh(`/pulls/${n}`);
      // Una tanda (varias PRs juntas en una) lista cada PR que trae, con su título.
      const refs = [...new Set([...String(pr.body || '').matchAll(/#(\d{2,6})\b/g)].map((m) => Number(m[1])).filter((x) => x !== n))];
      const parts: PrPart[] = [];
      if (refs.length >= 2) {
        for (const r of refs.slice(0, 40)) {
          try {
            const sub = await gh(`/pulls/${r}`);
            parts.push({ n: r, title: sub.title, url: sub.html_url });
          } catch {}
        }
      }
      prs.push({
        n, title: pr.title, url: pr.html_url, gist: parts.length ? '' : gist(pr.body), parts,
        additions: pr.additions || 0, deletions: pr.deletions || 0, files: pr.changed_files || 0, author: pr.user?.login || '',
        entries: await changelogEntries(n),
      });
    } catch {
      prs.push({ n, title: `PR #${n}`, url: `https://github.com/${o.repo}/pull/${n}`, gist: '', parts: [], additions: 0, deletions: 0, files: 0, author: '', entries: [] });
    }
  }
  // Commits que entraron por PR no se repiten como sueltos.
  const prShas = new Set<string>();
  if (loose.length) {
    for (const n of prNums) {
      try {
        for (const c of await gh(`/pulls/${n}/commits?per_page=100`)) prShas.add(c.sha);
      } catch {}
    }
  }
  return { prs, direct: loose.filter((c) => !prShas.has(c.sha)), base };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** El sha que esta instancia ya vio avisado: después no vuelve a consultar la base en cada minuto. */
let settledSha = '';

/** Solo para tests. */
export function resetDeployNotifyCache(): void {
  settledSha = '';
}

/** Avisa por mail el deploy de producción que está corriendo, una sola vez. La llama el cron de cada minuto. */
export async function runDeployNotify(deps: DeployNotifyDeps = {}): Promise<DeployNotifyResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const sha = (env.VERCEL_GIT_COMMIT_SHA || '').trim();
  if (env.VERCEL_ENV !== 'production' || !sha) return { state: 'off', reason: 'not_a_production_deploy' };
  const to = (env.DEPLOY_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { state: 'off', reason: 'no_recipients' };
  if (!deps.send && !env.RESEND_API_KEY) return { state: 'off', reason: 'no_email_provider' };
  if (settledSha === sha) return { state: 'done' };

  const repo = (env.DEPLOY_NOTIFY_REPO || (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : '')).trim();
  if (!repo) return { state: 'off', reason: 'no_repo' };

  const db = getDb();
  // Se toma la fila del deploy: nueva, o una sin terminar cuyo intento anterior fue hace más de RETRY_MS.
  const t = now();
  const claim = await db
    .prepare(
      `INSERT INTO deploy_notifications (sha, claimed_at, attempts) VALUES (?, ?, 1)
       ON CONFLICT(sha) DO UPDATE SET claimed_at = excluded.claimed_at, attempts = deploy_notifications.attempts + 1
       WHERE deploy_notifications.done_at IS NULL AND deploy_notifications.claimed_at < ? AND deploy_notifications.attempts < ?`,
    )
    .run(sha, t, t - RETRY_MS, MAX_ATTEMPTS);
  if (!claim.changes) {
    const row = (await db.prepare('SELECT done_at FROM deploy_notifications WHERE sha = ?').get(sha)) as { done_at: number | null } | undefined;
    if (row?.done_at) {
      settledSha = sha;
      return { state: 'done' };
    }
    return { state: 'busy' };
  }

  const finish = async (mailed: boolean, base: string | null) => {
    await db.prepare('UPDATE deploy_notifications SET done_at = ?, mailed = ?, base_sha = ? WHERE sha = ?').run(now(), mailed ? 1 : 0, base, sha);
    settledSha = sha;
  };

  try {
    const last = (await db.prepare('SELECT sha FROM deploy_notifications WHERE mailed = 1 AND sha != ? ORDER BY done_at DESC LIMIT 1').get(sha)) as { sha: string } | undefined;
    const changes = await collectChanges({ repo, sha, base: last?.sha ?? null, token: env.DEPLOY_NOTIFY_GITHUB_TOKEN || env.GITHUB_TOKEN, fetch: deps.fetch ?? fetch });
    if (!changes) {
      // Un deploy más viejo que el último avisado (una promoción o una vuelta atrás): no hay nada nuevo que contar.
      await finish(false, last?.sha ?? null);
      return { state: 'nothing-new', sha };
    }
    const mail = buildDeployMail({ repo, sha, base: changes.base, prs: changes.prs, direct: changes.direct, deployUrl: env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined, when: new Date(now()) });
    const send = deps.send ?? sendEmail;
    const from = env.DEPLOY_NOTIFY_FROM || 'zerosoft deploys <notifications@zerosoft.ai>';
    for (const address of to) {
      // La clave por deploy y destinatario: un reintento no le repite el mail a quien ya lo recibió.
      const r = await send({ to: address, from, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `deploy-${sha}-${address}` });
      if (!r.ok) throw new Error(`email ${r.error ?? 'failed'}`);
    }
    await finish(true, changes.base);
    return { state: 'sent', sha, changes: mail.changes, recipients: to.length };
  } catch (err) {
    // La fila queda tomada y sin terminar: el cron reintenta cuando pasen RETRY_MS.
    const error = err instanceof Error ? err.message : 'error';
    console.error(`[deploy-notify] ${sha.slice(0, 8)} failed: ${error}`);
    return { state: 'failed', sha, error };
  }
}
