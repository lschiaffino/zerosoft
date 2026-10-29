import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Track como Linear (ronda 3, planning y ajustes): escala de estimación por
 * team, cycles por clave del team con "New cycle" y J/K, labels de un
 * project creados en línea, auto-cierre del padre firmado por Track en una
 * sola línea, Triage › Duplicate con recientes y colores de estado.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

async function team(request: APIRequestContext) {
  const name = `Plan3 ${uid()}`;
  const p = await ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name } }));
  const statuses = await ok<{ rows: Array<{ id: string; category: string; color: string }> }>(request.get(`/api/track/projects/${p.id}/statuses`));
  return { id: p.id, key: p.slug.toUpperCase(), name, statuses: statuses.rows, status: (c: string) => statuses.rows.find((s) => s.category === c)!.id };
}

test('Estimates del team: elegir talles se guarda', async ({ page, request }) => {
  const t = await team(request);
  await page.goto(`/en/app/track/team/${t.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('track-project-settings').click();
  await page.getByTestId('track-settings-tab-estimates').click();
  await page.getByTestId('track-estimate-scale-tshirt').check();
  await expect.poll(async () => ((await (await request.get(`/api/track/projects/${t.id}`)).json()) as { estimate_scale: string }).estimate_scale).toBe('tshirt');
});

test('Workflow: auto-cierre se tilda en el cuadrado y el padre se cierra firmado por Track', async ({ page, request }) => {
  const t = await team(request);
  await page.goto(`/en/app/track/team/${t.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('track-project-settings').click();
  await page.getByTestId('track-settings-tab-statuses').click();
  const box = page.getByTestId('track-auto-close-parent');
  await box.click();
  await expect(box).toBeChecked();
  await expect.poll(async () => ((await (await request.get(`/api/track/projects/${t.id}`)).json()) as { auto_close_parent: number }).auto_close_parent).toBe(1);

  const parent = await ok<{ id: string }>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Padre', statusId: t.status('in_progress') } }));
  const child = await ok<{ id: string }>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Hijo', parentId: parent.id } }));
  await ok(request.patch(`/api/track/issues/${child.id}`, { data: { statusId: t.status('done') } }));
  await page.goto(`/en/app/track/issues/${parent.id}`, { waitUntil: 'networkidle' });
  const activity = page.locator('.track-activity');
  await expect(activity).toContainText('Track');
  // Una sola línea de cierre (no una por sub-issue ni a nombre de quien cerró el hijo).
  await expect(activity.getByText(/Track .*closed/)).toHaveCount(1);
});

test('Cycles: /team/KEY/cycles lleva a la vista del team, New cycle crea y J/K recorren', async ({ page, request }) => {
  const t = await team(request);
  await page.goto(`/en/app/track/team/${t.key}/cycles`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(new RegExp(`/app/track/cycles\\?team=${t.key}`));
  await page.getByTestId('tp-new-cycle').click();
  await expect(page).toHaveURL(/\/app\/track\/cycles\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('tp-cycle-detail')).toContainText('Cycle 1');
  await page.goto(`/en/app/track/cycles?team=${t.key}`, { waitUntil: 'networkidle' });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('j');
  await expect(page.locator('[data-testid="tp-cycles"] .tp-row-link').first()).toBeFocused();
});

test('Project: labels con picker, crear en línea', async ({ page, request }) => {
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Labels ${uid()}` } }));
  await page.goto(`/en/app/track/projects/${plan.id}`, { waitUntil: 'networkidle' });
  const name = `q-${uid()}`;
  await page.getByTestId('tp-prop-labels').click();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tp-prop-labels')).toContainText(name);
  await expect
    .poll(async () => (((await (await request.get(`/api/track/plans/${plan.id}`)).json()) as { plan: { labels: Array<{ name: string }> } }).plan.labels ?? []).map((l) => l.name))
    .toContain(name);
});

test('Project: chips separados, tarjetas con aire y controles de hito del mismo alto', async ({ page, request }) => {
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Layout ${uid()}` } }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/en/app/track/projects/${plan.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('tp-chips')).toBeVisible();
    const layout = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('[data-testid="tp-chips"] .tp-chip')].map((el) => el.getBoundingClientRect());
      // Dos chips en la misma fila nunca se pisan ni se tocan.
      let minGap = Infinity;
      for (let i = 1; i < chips.length; i++) {
        if (Math.abs(chips[i].top - chips[i - 1].top) < 2) minGap = Math.min(minGap, chips[i].left - chips[i - 1].right);
      }
      const card = getComputedStyle(document.querySelector('.tp-card')!);
      const form = [...document.querySelectorAll('.tp-inline-form .input, .tp-inline-form .tp-chip, .tp-inline-form .btn')].map((el) => Math.round(el.getBoundingClientRect().height));
      return { minGap, padTop: parseFloat(card.paddingTop), form, scroll: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(layout.minGap).toBeGreaterThanOrEqual(4);
    expect(layout.padTop).toBeGreaterThanOrEqual(12);
    expect(new Set(layout.form).size).toBe(1);
    expect(layout.scroll).toBeLessThanOrEqual(0);
  }
});

test('Triage › Duplicate sin sugeridos muestra los recientes del team', async ({ page, request }) => {
  const t = await team(request);
  await ok(request.patch(`/api/track/projects/${t.id}`, { data: { triageEnabled: true } }));
  const recent = await ok<{ identifier: string }>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Nada que ver ${uid()}` } }));
  const key = (await ok<{ key: string }>(request.post('/api/keys', { data: { name: `tp3 ${uid()}` } }))).key;
  await ok(
    request.post('/api/v1/track/requests', {
      headers: { authorization: `Bearer ${key}` },
      data: { projectId: t.id, title: `Zzz ${uid()} totalmente distinto`, body: 'x', customer: { email: `ana${uid()}@acme.io`, name: 'Ana' }, source: 'email' },
    }),
  );
  await page.goto(`/en/app/track/team/${t.id}?tab=triage`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-triage-item')).toHaveCount(1);
  await page.keyboard.press('3');
  const menu = page.getByTestId('track-triage-dup-picker-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(recent.identifier);
  await expect(menu).toContainText('Recent');
});
