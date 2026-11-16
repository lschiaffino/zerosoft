import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { buildDeployMail, gist, parseChangelogEntry, resetDeployNotifyCache, runDeployNotify } from '@/lib/deploy-notify';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const ENTRY = `export default {
  id: '2026-11-15-x',
  title: { en: 'Send: it\\'s faster', es: 'Send: más rápido', pt: 'Send: mais rápido' },
  items: [{ product: 'send', text: { en: 'Links open at once.', es: 'x', pt: 'x' } }],
} satisfies ChangelogEntry;`;

/** Una API de GitHub falsa: el compare trae el merge del PR #12, que suma una entrada del changelog. */
function fakeGithub(opts: { compareStatus?: string; fail?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.replace('https://api.github.com/repos/acme/app', '');
    calls.push(path);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (opts.fail) return json({ message: 'boom' }, 500);
    if (path.startsWith('/deployments?')) return json([{ id: 2, sha: SHA_B }, { id: 1, sha: SHA_A }]);
    if (path.startsWith('/deployments/')) return json([{ state: 'success' }]);
    if (path.startsWith('/compare/')) {
      return json({
        status: opts.compareStatus ?? 'ahead',
        commits: [
          { sha: 'f'.repeat(40), parents: [{}], commit: { message: 'feature commit' } },
          { sha: 'e'.repeat(40), parents: [{}, {}], commit: { message: 'Merge pull request #12 from acme/x\n\nSend' } },
        ],
      });
    }
    if (path === '/pulls/12') return json({ title: 'Send: faster links', html_url: 'https://github.com/acme/app/pull/12', body: 'Opens links at once.\n\n🤖 Generated with X', additions: 10, deletions: 2, changed_files: 3, user: { login: 'dev' } });
    if (path.startsWith('/pulls/12/files')) return json([{ filename: 'content/changelog-entries/2026-11-15-x.ts', status: 'added' }]);
    if (path.startsWith('/pulls/12/commits')) return json([{ sha: 'f'.repeat(40) }]);
    if (path.startsWith('/contents/')) return json({ content: Buffer.from(ENTRY).toString('base64') });
    return json({}, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function mailer(fail = false) {
  const sent: { to: string; subject: string; text: string; idempotencyKey?: string }[] = [];
  const send = (async (o: { to: string; subject: string; text: string; idempotencyKey?: string }) => {
    if (fail) return { ok: false, error: 'resend_500' };
    sent.push(o);
    return { ok: true, provider: 'test' };
  }) as unknown as NonNullable<Parameters<typeof runDeployNotify>[0]>['send'];
  return { send, sent };
}

const env = (sha: string, extra: Record<string, string> = {}) => ({
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: sha,
  VERCEL_GIT_REPO_OWNER: 'acme',
  VERCEL_GIT_REPO_SLUG: 'app',
  DEPLOY_NOTIFY_TO: 'a@example.com, b@example.com',
  ...extra,
});

beforeEach(async () => {
  resetDeployNotifyCache();
  await getDb().prepare('DELETE FROM deploy_notifications').run();
});

describe('mail de cada deploy de producción (lib/deploy-notify.ts)', () => {
  it('manda un mail por destinatario con lo que entró, y una sola vez por deploy', async () => {
    const gh = fakeGithub();
    const m = mailer();
    const deps = { env: env(SHA_C), fetch: gh.fetchImpl, send: m.send };
    const first = await runDeployNotify(deps);
    expect(first).toEqual({ state: 'sent', sha: SHA_C, changes: 1, recipients: 2 });
    expect(m.sent.map((s) => s.to)).toEqual(['a@example.com', 'b@example.com']);
    expect(m.sent[0].subject).toBe("Live on zerosoft.ai: Send: it's faster");
    expect(m.sent[0].text).toContain('[Send] Links open at once.');
    expect(m.sent[0].idempotencyKey).toBe(`deploy-${SHA_C}-a@example.com`);
    // Sin un deploy avisado antes, la base es el último deploy de producción que salió bien.
    expect(gh.calls.some((c) => c.startsWith(`/compare/${SHA_B}...${SHA_C}`))).toBe(true);

    // El minuto siguiente, la misma instancia y otra (sin la memoria de la primera): nada más.
    expect(await runDeployNotify(deps)).toEqual({ state: 'done' });
    resetDeployNotifyCache();
    expect(await runDeployNotify(deps)).toEqual({ state: 'done' });
    expect(m.sent).toHaveLength(2);
  });

  it('dos crons a la vez: uno solo manda', async () => {
    const m = mailer();
    const deps = { env: env(SHA_C), fetch: fakeGithub().fetchImpl, send: m.send };
    const results = await Promise.all([runDeployNotify(deps), runDeployNotify(deps)]);
    expect(results.map((r) => r.state).sort()).toEqual(['busy', 'sent']);
    expect(m.sent).toHaveLength(2);
  });

  it('el deploy siguiente cuenta desde el último avisado', async () => {
    const m = mailer();
    await runDeployNotify({ env: env(SHA_B), fetch: fakeGithub().fetchImpl, send: m.send });
    resetDeployNotifyCache();
    const gh = fakeGithub();
    await runDeployNotify({ env: env(SHA_C), fetch: gh.fetchImpl, send: m.send });
    expect(gh.calls.some((c) => c.startsWith('/deployments'))).toBe(false);
    expect(gh.calls).toContain(`/compare/${SHA_B}...${SHA_C}`);
  });

  it('un deploy más viejo que el último avisado se cierra sin mail y no pasa a ser la base', async () => {
    const m = mailer();
    await runDeployNotify({ env: env(SHA_B), fetch: fakeGithub().fetchImpl, send: m.send });
    resetDeployNotifyCache();
    const old = await runDeployNotify({ env: env(SHA_A), fetch: fakeGithub({ compareStatus: 'behind' }).fetchImpl, send: m.send });
    expect(old).toEqual({ state: 'nothing-new', sha: SHA_A });
    expect(m.sent).toHaveLength(2);
    resetDeployNotifyCache();
    const gh = fakeGithub();
    await runDeployNotify({ env: env(SHA_C), fetch: gh.fetchImpl, send: m.send });
    expect(gh.calls).toContain(`/compare/${SHA_B}...${SHA_C}`);
  });

  it('si falla, reintenta a los 10 minutos y hasta 5 veces', async () => {
    let t = 1_000_000;
    const now = () => t;
    const bad = { env: env(SHA_C), fetch: fakeGithub({ fail: true }).fetchImpl, send: mailer().send, now };
    expect((await runDeployNotify(bad)).state).toBe('failed');
    t += 60_000;
    expect((await runDeployNotify(bad)).state).toBe('busy');
    t += 10 * 60_000;
    const m = mailer();
    expect((await runDeployNotify({ ...bad, fetch: fakeGithub().fetchImpl, send: m.send })).state).toBe('sent');
    expect(m.sent).toHaveLength(2);

    await getDb().prepare('DELETE FROM deploy_notifications').run();
    resetDeployNotifyCache();
    for (let i = 0; i < 5; i++) {
      expect((await runDeployNotify(bad)).state).toBe('failed');
      t += 11 * 60_000;
    }
    expect((await runDeployNotify(bad)).state).toBe('busy');
  });

  it('un envío que falla deja el deploy sin cerrar', async () => {
    const r = await runDeployNotify({ env: env(SHA_C), fetch: fakeGithub().fetchImpl, send: mailer(true).send });
    expect(r).toMatchObject({ state: 'failed', error: 'email resend_500' });
    const row = (await getDb().prepare('SELECT done_at FROM deploy_notifications WHERE sha = ?').get(SHA_C)) as { done_at: number | null };
    expect(row.done_at).toBeNull();
  });

  it('no hace nada fuera de producción, sin destinatarios o sin proveedor de email', async () => {
    const gh = fakeGithub();
    const m = mailer();
    expect(await runDeployNotify({ env: { ...env(SHA_C), VERCEL_ENV: 'preview' }, fetch: gh.fetchImpl, send: m.send })).toEqual({ state: 'off', reason: 'not_a_production_deploy' });
    expect(await runDeployNotify({ env: { ...env(SHA_C), VERCEL_GIT_COMMIT_SHA: '' }, fetch: gh.fetchImpl, send: m.send })).toMatchObject({ state: 'off' });
    expect(await runDeployNotify({ env: { ...env(SHA_C), DEPLOY_NOTIFY_TO: ' ' }, fetch: gh.fetchImpl, send: m.send })).toEqual({ state: 'off', reason: 'no_recipients' });
    expect(await runDeployNotify({ env: env(SHA_C), fetch: gh.fetchImpl })).toEqual({ state: 'off', reason: 'no_email_provider' });
    expect(gh.calls).toHaveLength(0);
    expect(m.sent).toHaveLength(0);
  });

  it('el texto: primer párrafo del PR, entrada del changelog y asunto de un deploy interno', () => {
    expect(gist('## Title\n\nFirst   paragraph.\n\nSecond.\n\n🤖 Generated with [Claude Code](x)')).toBe('First paragraph.');
    expect(parseChangelogEntry(ENTRY, 12)).toEqual({ title: "Send: it's faster", items: [{ product: 'send', text: 'Links open at once.' }] });
    expect(parseChangelogEntry('export default {}', 12)).toBeNull();
    const mail = buildDeployMail({
      repo: 'acme/app', sha: SHA_C, base: SHA_B, when: new Date(Date.UTC(2026, 10, 15, 17, 0)),
      prs: [{ n: 7, title: 'CI <fix>', url: 'https://github.com/acme/app/pull/7', gist: 'Why.', parts: [], additions: 1, deletions: 1, files: 1, author: 'dev', entries: [] }],
      direct: [],
    });
    expect(mail.subject).toBe('Deployed cccccccc: 1 internal change');
    expect(mail.html).toContain('#7 CI &lt;fix&gt;');
    expect(mail.text).toContain('- #7 CI <fix>\n  Why.');
  });
});
