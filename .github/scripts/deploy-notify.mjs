// Mail de resumen de un deploy de producción: PRs (o commits sueltos) entre el
// deploy anterior que salió bien y este. Lo corre .github/workflows/deploy-notify.yml.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, RESEND_API_KEY, DEPLOY_NOTIFY_TO, DEPLOYMENT_ID, DEPLOY_SHA, DEPLOY_URL } = process.env;
const FROM = process.env.DEPLOY_NOTIFY_FROM || 'zerosoft deploys <notifications@zerosoft.ai>';
const SITE = 'https://zerosoft.ai';

const to = (DEPLOY_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!RESEND_API_KEY || !to.length) {
  console.log('deploy-notify: sin RESEND_API_KEY o DEPLOY_NOTIFY_TO, no se manda nada');
  if (!process.env.DRY_RUN) process.exit(0);
}

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`github ${res.status} ${path}`);
  return res.json();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Sha del último deploy de producción anterior a este que terminó bien. */
async function previousSha() {
  const list = await gh('/deployments?environment=Production&per_page=30');
  for (const d of list) {
    if (String(d.id) === String(DEPLOYMENT_ID) || d.sha === DEPLOY_SHA) continue;
    if (new Date(d.created_at) > new Date()) continue;
    const statuses = await gh(`/deployments/${d.id}/statuses?per_page=5`);
    if (statuses.some((s) => s.state === 'success')) return d.sha;
  }
  return null;
}

/** Primer párrafo útil del cuerpo de un PR (sin la firma). */
function gist(body) {
  const text = String(body || '')
    .replace(/🤖 Generated with[^\n]*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const para = text.split(/\n\s*\n/).find((p) => p.trim() && !/^#+\s/.test(p.trim())) || '';
  return para.replace(/\s+/g, ' ').slice(0, 400);
}

/** Lee un string entre comillas simples de TypeScript (con \' y \\ escapados). */
function unq(raw) {
  return raw.replace(/\\(['"\\n])/g, (_, c) => (c === 'n' ? '\n' : c));
}

/**
 * Las entradas del changelog que trae un PR (content/changelog-entries/*.ts), con su texto en inglés: el título y,
 * por cada ítem, el producto y el texto. El archivo se lee de la versión desplegada.
 */
async function changelogEntries(n) {
  const out = [];
  try {
    const files = await gh(`/pulls/${n}/files?per_page=100`);
    for (const f of files.filter((x) => /^content\/changelog-entries\/.+\.ts$/.test(x.filename) && x.status !== 'removed').slice(0, 5)) {
      try {
        const file = await gh(`/contents/${f.filename}?ref=${DEPLOY_SHA}`);
        const src = Buffer.from(file.content || '', 'base64').toString('utf8');
        const title = /title:\s*\{[\s\S]*?\ben:\s*'((?:\\.|[^'\\])*)'/.exec(src);
        const itemsSrc = src.slice(src.indexOf('items:'));
        const items = [];
        const re = /product:\s*'([a-z0-9-]+)'[\s\S]*?\ben:\s*'((?:\\.|[^'\\])*)'/g;
        let m;
        while ((m = re.exec(itemsSrc))) items.push({ product: m[1], text: unq(m[2]) });
        if (title || items.length) out.push({ title: title ? unq(title[1]) : `Update #${n}`, items });
      } catch {}
    }
  } catch {}
  return out;
}

const base = await previousSha();
let commits = [];
if (base) {
  const cmp = await gh(`/compare/${base}...${DEPLOY_SHA}`);
  if (cmp.status === 'behind' || cmp.status === 'identical') {
    console.log(`deploy-notify: ${cmp.status} respecto del deploy anterior, no hay nada nuevo`);
    process.exit(0);
  }
  commits = cmp.commits || [];
} else {
  commits = [await gh(`/commits/${DEPLOY_SHA}`)];
}

const prNums = [];
const loose = [];
for (const c of commits) {
  const subject = c.commit.message.split('\n')[0];
  const m = /^Merge pull request #(\d+)/.exec(subject);
  if (m) prNums.push(Number(m[1]));
  else if (c.parents?.length < 2 && !/^Merge (remote-tracking )?branch/.test(subject)) loose.push({ sha: c.sha, subject });
}
const prs = [];
for (const n of [...new Set(prNums)]) {
  try {
    const pr = await gh(`/pulls/${n}`);
    // Una tanda (varias PRs juntas en una) lista cada PR que trae, con su título.
    const refs = [...new Set([...String(pr.body || '').matchAll(/#(\d{2,6})\b/g)].map((m) => Number(m[1])).filter((x) => x !== n))];
    const parts = [];
    if (refs.length >= 2) {
      for (const r of refs.slice(0, 40)) {
        try {
          const sub = await gh(`/pulls/${r}`);
          parts.push({ n: r, title: sub.title, url: sub.html_url });
        } catch {}
      }
    }
    prs.push({
      n,
      title: pr.title,
      url: pr.html_url,
      gist: parts.length ? '' : gist(pr.body),
      parts,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      files: pr.changed_files || 0,
      author: pr.user?.login || '',
      entries: await changelogEntries(n),
    });
  } catch {
    prs.push({ n, title: `PR #${n}`, url: `https://github.com/${GITHUB_REPOSITORY}/pull/${n}`, gist: '', parts: [], additions: 0, deletions: 0, files: 0, author: '', entries: [] });
  }
}
// Commits que entraron por PR no se repiten como sueltos.
const prShas = new Set();
for (const n of prNums) {
  try {
    for (const c of await gh(`/pulls/${n}/commits?per_page=100`)) prShas.add(c.sha);
  } catch {}
}
const direct = loose.filter((c) => !prShas.has(c.sha));

// ---- El mail, en inglés: lo nuevo (texto en inglés de cada entrada del changelog), lo interno y los números. ----
const short = DEPLOY_SHA.slice(0, 8);
const count = prs.reduce((a, p) => a + (p.parts.length || 1), 0) + direct.length;
const entries = prs.flatMap((p) => p.entries.map((e) => ({ ...e, pr: p })));
const internal = prs.filter((p) => !p.entries.length);
const totals = prs.reduce((t, p) => ({ add: t.add + p.additions, del: t.del + p.deletions, files: t.files + p.files }), { add: 0, del: 0, files: 0 });
const when = new Date().toUTCString().replace(' GMT', ' UTC');
const subject =
  entries.length === 1 && count === 1
    ? `Live on zerosoft.ai: ${entries[0].title}`
    : entries.length
      ? `Live on zerosoft.ai: ${entries.length} ${entries.length === 1 ? 'update' : 'updates'}${internal.length + direct.length ? ` + ${internal.length + direct.length} internal` : ''} (${short})`
      : `Deployed ${short}: ${count} internal ${count === 1 ? 'change' : 'changes'}`;
const productName = (p) => p.charAt(0).toUpperCase() + p.slice(1);

const h = (t) => `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#888;margin:28px 0 10px">${t}</h2>`;
const entryHtml = (e) =>
  `<div style="margin:0 0 22px"><div style="font-size:17px;font-weight:600;margin:0 0 6px">${esc(e.title)}</div>${e.items
    .map(
      (i) =>
        `<p style="margin:0 0 8px">${i.product ? `<span style="display:inline-block;font-size:12px;font-weight:600;color:#555;border:1px solid #ddd;border-radius:4px;padding:0 6px;margin-right:6px">${esc(productName(i.product))}</span>` : ''}${esc(i.text)}</p>`,
    )
    .join('')}<div style="font-size:13px;color:#888"><a href="${esc(e.pr.url)}" style="color:#888">PR #${e.pr.n}</a> · ${e.pr.files} files · +${e.pr.additions} −${e.pr.deletions}</div></div>`;
const internalHtml = (p) =>
  `<li style="margin:0 0 12px"><a href="${esc(p.url)}" style="color:#111;font-weight:600">#${p.n} ${esc(p.title)}</a> <span style="color:#888;font-size:13px">· ${p.files} files · +${p.additions} −${p.deletions}</span>${
    p.gist ? `<div style="color:#555;margin-top:4px">${esc(p.gist)}</div>` : ''
  }${p.parts.length ? `<ul style="padding-left:18px;margin:6px 0 0;color:#333">${p.parts.map((x) => `<li style="margin:0 0 4px"><a href="${esc(x.url)}" style="color:#333">#${x.n}</a> ${esc(x.title)}</li>`).join('')}</ul>` : ''}</li>`;
const links = [
  base ? `<a href="https://github.com/${GITHUB_REPOSITORY}/compare/${base.slice(0, 12)}...${short}" style="color:#888">All changes</a>` : '',
  `<a href="${SITE}/en/changelog" style="color:#888">Changelog</a>`,
  `<a href="${SITE}/en/status" style="color:#888">Status</a>`,
  DEPLOY_URL ? `<a href="${esc(DEPLOY_URL)}" style="color:#888">Deployment</a>` : '',
].filter(Boolean);
const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:640px">
<p style="margin:0 0 6px">A new version of <a href="${SITE}" style="color:#111">zerosoft.ai</a> is live in production.</p>
<p style="margin:0;color:#555;font-size:14px">Version <code>${short}</code> · ${esc(when)} · ${count} ${count === 1 ? 'change' : 'changes'} from ${prs.length} ${prs.length === 1 ? 'pull request' : 'pull requests'}${direct.length ? ` and ${direct.length} direct ${direct.length === 1 ? 'commit' : 'commits'}` : ''} · ${totals.files} files · +${totals.add} −${totals.del}</p>
${entries.length ? h("What's new") + entries.map(entryHtml).join('') : ''}
${internal.length || direct.length ? h(entries.length ? 'Also shipped (internal)' : 'What shipped (internal)') + `<ul style="padding-left:18px;margin:0">${internal.map(internalHtml).join('')}${direct
  .map((c) => `<li style="margin:0 0 10px"><a href="https://github.com/${GITHUB_REPOSITORY}/commit/${c.sha}" style="color:#111">${esc(c.subject)}</a> <span style="color:#888">${c.sha.slice(0, 8)}</span></li>`)
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
  `Changelog: ${SITE}/en/changelog · Status: ${SITE}/en/status${base ? ` · All changes: https://github.com/${GITHUB_REPOSITORY}/compare/${base.slice(0, 12)}...${short}` : ''}`,
].join('\n');

if (process.env.DRY_RUN) {
  console.log(subject + '\n\n' + text);
  process.exit(0);
}
const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `deploy-${DEPLOYMENT_ID}` },
  body: JSON.stringify({ from: FROM, to, subject, html, text }),
});
if (!res.ok) {
  console.error(`deploy-notify: resend respondió ${res.status}`);
  process.exit(1);
}
console.log(`deploy-notify: mail enviado (${count} cambios) a ${to.length} destinatarios`);
