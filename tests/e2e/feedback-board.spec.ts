import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

/**
 * Board público (DEMO_MODE: hay sesión). Proponer una idea, verla en la
 * lista, votar / quitar el voto, comentar y abrirla por el subdominio.
 */
test('board: proponer, votar, comentar y servir por feedback.<host>', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat/i.test(m.text())) errors.push(m.text());
  });

  const title = `Exportar reportes a PDF ${uid()}`;
  await page.goto('/es/feedback-board/new');
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Detalle (opcional)').fill('Para mandar a clientes');
  await page.getByRole('button', { name: 'Publicar idea' }).click();
  await page.waitForURL(/\/es\/feedback-board\/i\//);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

  // El autor ya votó su idea: alternar quita y vuelve a poner el voto.
  const vote = page.locator('.bp-detail-head .bp-vote');
  await expect(vote).toHaveAttribute('aria-pressed', 'true');
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed', 'false');
  await expect(vote.locator('.bp-vote-count')).toHaveText('0');
  await vote.click();
  await expect(vote.locator('.bp-vote-count')).toHaveText('1');

  await page.getByLabel('Contá tu caso: qué necesitás y para qué.').fill('Lo uso **todas** las semanas');
  await page.getByRole('button', { name: 'Comentar' }).click();
  await expect(page.locator('.bp-comment-body strong')).toHaveText('todas');

  // Lista con búsqueda.
  await page.goto(`/es/feedback-board?q=${encodeURIComponent(title)}`);
  await expect(page.locator('.bp-row-title')).toHaveText([title]);
  // Sin header de marketing en el board.
  await expect(page.locator('.site-header')).toHaveCount(0);

  // Subdominio: misma página, sin prefijo en la URL.
  const sub = await request.get('/es', { headers: { host: `feedback.localhost:${Number(process.env.E2E_PORT) || 3210}` } });
  expect(sub.status()).toBe(200);
  expect(await sub.text()).toContain(title);

  expect(errors).toEqual([]);
});

/**
 * Feedback desde la burbuja: queda en revisión (privado) y su autora lo ve
 * arriba del board, sin voto ni link.
 */
test('board: el feedback de la burbuja aparece en "tus pedidos en revisión"', async ({ page }) => {
  const message = `Quiero etiquetas de colores en Notes ${uid()}`;
  await page.goto('/es');
  await page.locator('.fl-button').click();
  await page.getByRole('tab', { name: 'Enviar' }).click();
  await page.locator('.fl-panel textarea').fill(message);
  await page.locator('.fl-panel').getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.locator('.fb-success-body')).toContainText('Lo revisamos y, si suma, aparece en el board');
  await page.locator('.fb-success').getByRole('link', { name: 'Ver en el board' }).click();
  await page.waitForURL(/\/es\/feedback-board$/);

  const group = page.locator('.bp-pending');
  // La clasificación corre después de responder: reintentar hasta que aparezca.
  await expect(async () => {
    await page.reload();
    await expect(group.locator('.bp-row-title', { hasText: message })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(group.getByRole('heading', { level: 2 })).toHaveText('Tus pedidos en revisión');
  const row = group.locator('.bp-row', { hasText: message });
  await expect(row.locator('.bp-status')).toHaveText('En revisión');
  await expect(row.locator('a, button')).toHaveCount(0);
  // No está en la lista pública.
  await expect(page.locator('main > .bp-list .bp-row-title', { hasText: message })).toHaveCount(0);

  const shots = process.env.BOARD_SHOTS_DIR;
  if (shots) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${shots}/board-pending-${scheme}.png` });
    }
  }
});
