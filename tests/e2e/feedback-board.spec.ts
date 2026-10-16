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
  const sub = await request.get('/es', { headers: { host: 'feedback.localhost:3210' } });
  expect(sub.status()).toBe(200);
  expect(await sub.text()).toContain(title);

  expect(errors).toEqual([]);
});
