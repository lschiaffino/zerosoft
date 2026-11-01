// Temporal: capturas para mirar a ojo. No se commitea.
import { mkdirSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { expect, test, type Page } from '@playwright/test';

const OUT = '/private/tmp/claude-501/-Users-lautamacmini1-AI-zerosoftware-ai/47e4112c-84db-417f-88d9-7e30941974e8/scratchpad/afc-look';
mkdirSync(OUT, { recursive: true });
const uid = () => Math.random().toString(36).slice(2, 8);
async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function webm(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    let f = 0;
    const id = setInterval(() => { g.fillStyle = `hsl(${(f++ * 25) % 360} 70% 50%)`; g.fillRect(0, 0, 320, 180); }, 66);
    rec.start(200);
    await new Promise((r) => setTimeout(r, 2200));
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    clearInterval(id);
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

const COMBOS = [
  ['light', 1280],
  ['light', 390],
  ['dark', 1280],
  ['dark', 390],
] as const;

test('capturas', async ({ page, context, baseURL, request }) => {
  test.setTimeout(900_000);
  const shot = (name: string, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  const failures: string[] = [];
  const attempt = async (label: string, fn: () => Promise<void>) => {
    if (!/^(notices|rec|bell)/.test(label)) return;
    try {
      await fn();
    } catch (e) {
      failures.push(`${label}: ${String(e).slice(0, 300)}`);
    }
  };

  // Datos
  const cred = `LOOK_${uid()}`;
  await request.post('/api/flow/credentials', { data: { name: cred, type: 'basic', data: { username: 'u', password: 'look-secret-pw' } } });
  const blockedRobot = (await (await request.post('/api/robots', { data: { name: 'Portal login', steps: [
    { type: 'goto', url: 'https://portal.example.com/login' },
    { type: 'fill', selector: '#pw', value: `{{credentials.${cred}.password}}`, origin: 'https://portal.example.com' },
  ] } })).json()) as { id: string };
  const now = new Date().toISOString();
  const blockedRun = `look-${uid()}`;
  await sql(
    "INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, error, logs, created_by, created_at, started_at, finished_at, duration_ms) VALUES (?, ?, 'demo', 'failed', 'manual', '2: credential_origin', ?, 'demo', ?, ?, ?, 1200)",
    [blockedRun, blockedRobot.id, JSON.stringify([{ step: '1', type: 'goto', status: 'success', ms: 500, detail: 'https://portal.example.com/login' }, { step: '2', type: 'fill', status: 'failed', ms: 400, error: 'credential_origin', detail: 'https://accounts.sso-provider.example.net ≠ https://portal.example.com' }]), now, now, now],
  );
  const noSiteRun = `look-${uid()}`;
  await sql(
    "INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, error, logs, created_by, created_at, started_at, finished_at, duration_ms) VALUES (?, ?, 'demo', 'failed', 'manual', '2: credential_no_site', ?, 'demo', ?, ?, ?, 1200)",
    [noSiteRun, blockedRobot.id, JSON.stringify([{ step: '2', type: 'fill', status: 'failed', ms: 400, error: 'credential_no_site', detail: 'https://own.example.com ≠ ?' }]), now, now, now],
  );
  const scriptRun = `look-${uid()}`;
  await sql(
    "INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, error, logs, created_by, created_at, started_at, finished_at, duration_ms) VALUES (?, ?, 'demo', 'failed', 'schedule', '3: credential_with_script', '[]', 'demo', ?, ?, ?, 0)",
    [scriptRun, blockedRobot.id, now, now, now],
  );
  const adopt = (await (await request.post('/api/robots', { data: { name: 'Member robot', steps: [
    { type: 'goto', url: 'https://portal.example.com/login' },
    { type: 'fill', selector: '#pw', value: `{{credentials.${cred}.password}}` },
  ] } })).json()) as { id: string };
  const creator = `look-creator-${uid()}`;
  await sql('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [creator, `${creator}@darwin-e2e.io`, 'Ana Creator']);
  await sql("INSERT INTO team_members (team_id, user_id, role) VALUES ((SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1), ?, 'member')", [creator]);
  await sql('UPDATE robots SET created_by = ? WHERE id = ?', [creator, adopt.id]);
  // Avisos reales en la bandeja
  for (const [title, body] of [
    ['Portal login: batch rows dropped', '1 row of a batch waited more than 45 days in the queue and was dropped without running. Queue it again to run it.'],
    ['Portal login: a step can read the login', 'Step 3 can read what was typed in a field, and this robot uses a login, so the robot stops before opening the browser. Remove that step (Run JavaScript, or reading the value attribute). Scheduled runs pause after 3 runs that fail like this. This robot will not send this notice again.'],
    ['Portal login: an admin took over this robot', 'Ada Admin took over the steps of this robot, so it now runs under their name. You no longer own it.'],
  ]) {
    await sql("INSERT INTO notifications (id, user_id, type, title, body, href, source_type, source_id, meta, created_at) VALUES (?, 'demo', 'robot_notice', ?, ?, ?, 'robot', ?, '{}', ?)", [`look-${uid()}`, title, body, `/app/robots/${blockedRobot.id}`, uid(), now]);
  }
  // Rec
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const body = await webm(page);
  const makeVideo = async (title: string) => {
    const { video } = (await (await request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm', hasAudio: false } })).json()) as { video: { id: string } };
    await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: body, headers: { 'content-type': 'application/octet-stream' } });
    await request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } });
    await request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec: 2 } });
    await request.patch(`/api/rec/videos/${video.id}`, { data: { title } });
    return video.id;
  };
  const people = await makeVideo(`People ${uid()}`);
  await request.patch(`/api/rec/videos/${people}`, { data: { privacy: 'people' } });
  // Talk
  const ch = (await (await request.post('/api/talk/channels', { data: { name: `look-${uid()}`, kind: 'public' } })).json()) as { id: string };
  for (let i = 0; i < 12; i++) await request.post(`/api/talk/channels/${ch.id}/bookmarks`, { data: { url: `https://example.com/${i}`, title: `Bookmark number ${i}` } });
  // CRM
  const instant = '2030-03-15T20:30:00.000Z';
  for (let i = 0; i < 4; i++) {
    const l = (await (await request.post('/api/crm/leads', { data: { name: `Lead ${i} long enough name ${uid()}` } })).json()) as { id: string };
    await sql('UPDATE crm_leads SET created_at = ? WHERE id = ?', [instant, l.id]);
  }
  const obj = (await (await request.post('/api/crm/objects', { data: { singular: 'Vehicle', plural: `Vehicles ${uid()}` } })).json()) as { id: string; slug: string };
  for (let i = 0; i < 3; i++) await request.post(`/api/crm/objects/${obj.id}/records`, { data: { name: `Vehicle ${i}` } }).catch(() => null);
  await request.post('/api/crm/dashboards', { data: { name: `Look panel ${uid()}` } });

  for (const [theme, width] of COMBOS) {
    const tag = `${theme}-${width}`;
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    await page.setViewportSize({ width, height: 844 });

    await attempt(`site ${tag}`, async () => {
      await page.goto(`/en/app/robots/${blockedRobot.id}?tab=steps`, { waitUntil: 'networkidle' });
      const label = page.getByText('Login site', { exact: true }).first();
      if (!(await label.isVisible().catch(() => false))) {
        await page.getByText(/Fill/).nth(1).click().catch(() => undefined);
      }
      await label.scrollIntoViewIfNeeded().catch(() => undefined);
      await shot(`site-${tag}`);
    });
    await attempt(`blocked ${tag}`, async () => {
      await page.goto(`/en/app/robots/${blockedRobot.id}?tab=runs&run=${blockedRun}`, { waitUntil: 'networkidle' });
      await shot(`blocked-${tag}`);
      await page.getByTestId('robots-use-site').first().click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shot(`use-site-dialog-${tag}`, false);
      await page.keyboard.press('Escape');
      await page.goto(`/en/app/robots/${blockedRobot.id}?tab=runs&run=${noSiteRun}`, { waitUntil: 'networkidle' });
      await shot(`nosite-${tag}`);
      await page.goto(`/en/app/robots/${blockedRobot.id}?tab=runs&run=${scriptRun}`, { waitUntil: 'networkidle' });
      await shot(`script-${tag}`);
    });
    await attempt(`takeover ${tag}`, async () => {
      await page.goto(`/en/app/robots/${adopt.id}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Run robot', exact: true }).first().click({ timeout: 5000 });
      await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(300);
      await shot(`takeover-${tag}`, false);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(300);
      await shot(`takeover-refused-${tag}`);
    });
    await attempt(`notices ${tag}`, async () => {
      await page.goto('/en/app/track/inbox', { waitUntil: 'networkidle' });
      await shot(`notices-${tag}`);
      const fit = await page.evaluate(() => {
        const row = document.querySelector('.track-inbox-item');
        const btn = document.querySelector('.track-inbox-item .track-inbox-snooze');
        return { row: row?.getBoundingClientRect().right, btn: btn?.getBoundingClientRect().right, win: window.innerWidth, scroll: document.documentElement.scrollWidth, rowScroll: row?.scrollWidth, rowClient: row?.clientWidth };
      });
      console.log('INBOX FIT', tag, JSON.stringify(fit));
    });
    await attempt(`bell ${tag}`, async () => {
      await page.getByRole('button', { name: /notification/i }).first().click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shot(`bell-${tag}`, false);
      await page.keyboard.press('Escape');
    });
    await attempt(`rec ${tag}`, async () => {
      await page.goto(`/en/app/rec/${people}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Move', exact: true }).first().click({ timeout: 5000 });
      const move = page.getByRole('dialog', { name: 'Move video' });
      await move.getByText('Workspace', { exact: true }).click();
      await page.waitForTimeout(200);
      await shot(`rec-notice-${tag}`, false);
      await move.getByTestId('rec-move-submit').click();
      await expect(move.getByTestId('rec-move-error')).toBeVisible();
      await shot(`rec-error-${tag}`, false);
      await page.keyboard.press('Escape');
    });
    await attempt(`panel ${tag}`, async () => {
      await page.goto('/en/app/crm/dashboards', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Delete dashboard' }).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shot(`panel-${tag}`, false);
      await page.keyboard.press('Escape');
    });
    await attempt(`talk ${tag}`, async () => {
      await page.goto(`/en/app/talk/${ch.id}`, { waitUntil: 'networkidle' });
      await page.getByTestId('talk-bookmark-overflow-btn').click({ timeout: 5000 });
      await page.waitForTimeout(200);
      await shot(`talk-more-${tag}`, false);
    });
    await attempt(`leads ${tag}`, async () => {
      await page.goto('/en/app/crm/leads', { waitUntil: 'networkidle' });
      await shot(`leads-${tag}`);
    });
    await attempt(`objects ${tag}`, async () => {
      await page.goto(`/en/app/crm/objects/${obj.slug}`, { waitUntil: 'networkidle' });
      await shot(`objects-${tag}`);
    });
  }
  console.log('LOOK FAILURES', JSON.stringify(failures, null, 1));
});
