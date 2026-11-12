// Mail de resumen de un deploy de producción: PRs (o commits sueltos) entre el
// deploy anterior que salió bien y este. Lo corre .github/workflows/deploy-notify.yml.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, RESEND_API_KEY, DEPLOY_NOTIFY_TO, DEPLOYMENT_ID, DEPLOY_SHA, DEPLOY_URL } = process.env;
const FROM = process.env.DEPLOY_NOTIFY_FROM || 'zerosoft deploys <notifications@zerosoft.ai>';
const SITE = 'https://zerosoft.ai';

const to = (DEPLOY_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!RESEND_API_KEY || !to.length) {
  console.log('deploy-notify: sin RESEND_API_KEY o DEPLOY_NOTIFY_TO, no se manda nada');
  process.exit(0);
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
    prs.push({ n, title: pr.title, url: pr.html_url, gist: parts.length ? '' : gist(pr.body), parts });
  } catch {
    prs.push({ n, title: `PR #${n}`, url: `https://github.com/${GITHUB_REPOSITORY}/pull/${n}`, gist: '', parts: [] });
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

const short = DEPLOY_SHA.slice(0, 8);
const count = prs.reduce((a, p) => a + (p.parts.length || 1), 0) + direct.length;
const subject = prs.length === 1 && !prs[0].parts.length && !direct.length ? `Deploy: ${prs[0].title}` : `Deploy ${short}: ${count} ${count === 1 ? 'cambio' : 'cambios'}`;

const items = [
  ...prs.map(
    (p) =>
      `<li style="margin:0 0 14px"><a href="${esc(p.url)}" style="color:#111;font-weight:600">#${p.n} ${esc(p.title)}</a>${p.gist ? `<div style="color:#555;margin-top:4px">${esc(p.gist)}</div>` : ''}${
        p.parts.length ? `<ul style="padding-left:18px;margin:6px 0 0;color:#333">${p.parts.map((x) => `<li style="margin:0 0 4px"><a href="${esc(x.url)}" style="color:#333">#${x.n}</a> ${esc(x.title)}</li>`).join('')}</ul>` : ''
      }</li>`,
  ),
  ...direct.map((c) => `<li style="margin:0 0 10px"><a href="https://github.com/${GITHUB_REPOSITORY}/commit/${c.sha}" style="color:#111">${esc(c.subject)}</a> <span style="color:#888">${c.sha.slice(0, 8)}</span></li>`),
];
const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:640px">
<p style="margin:0 0 16px">Ya está en producción <a href="${SITE}" style="color:#111">zerosoft.ai</a> (versión <code>${short}</code>).</p>
${items.length ? `<ul style="padding-left:18px;margin:0 0 16px">${items.join('')}</ul>` : '<p>Sin cambios de código nuevos (redeploy).</p>'}
<p style="color:#888;font-size:13px;margin:16px 0 0">${base ? `<a href="https://github.com/${GITHUB_REPOSITORY}/compare/${base.slice(0, 12)}...${short}" style="color:#888">Ver todos los cambios</a> · ` : ''}<a href="https://github.com/${GITHUB_REPOSITORY}/blob/main/content/changelog.ts" style="color:#888">Changelog</a>${DEPLOY_URL ? ` · <a href="${esc(DEPLOY_URL)}" style="color:#888">Deploy</a>` : ''}</p>
</div>`;
const text = [
  `Ya está en producción zerosoft.ai (versión ${short}).`,
  '',
  ...prs.map((p) => `- #${p.n} ${p.title}${p.gist ? `\n  ${p.gist}` : ''}${p.parts.map((x) => `\n  · #${x.n} ${x.title}`).join('')}`),
  ...direct.map((c) => `- ${c.subject} (${c.sha.slice(0, 8)})`),
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
