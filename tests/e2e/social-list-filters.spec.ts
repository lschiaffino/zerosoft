import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lista de publicaciones de Social: filtrar por red y por cuenta (redes
 * simuladas, SOCIAL_FAKE=1). Los filtros quedan en la URL, se mantienen al
 * cambiar de pestaña y "Quitar filtros" vuelve a la lista entera.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

type Account = { id: string; name: string; network: string };

async function connect(request: APIRequestContext, network: string): Promise<Account[]> {
  const res = await request.post('/api/social/connect', { data: { network } });
  expect(res.ok()).toBe(true);
  const { url } = (await res.json()) as { url: string };
  // El callback falso vuelve a esta misma app: se pide relativo al baseURL.
  const back = new URL(url);
  await request.get(`${back.pathname}${back.search}`, { maxRedirects: 0 });
  return ((await (await request.get('/api/social/accounts')).json()) as { accounts: Account[] }).accounts;
}

async function draft(request: APIRequestContext, text: string, accountIds: string[]): Promise<string> {
  const res = await request.post('/api/social/posts', { data: { text, accountIds, action: 'draft' } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

test('filtrar la lista por red y por cuenta', async ({ page, request }) => {
  await connect(request, 'linkedin');
  const accounts = await connect(request, 'facebook');
  const fb = accounts.find((a) => a.network === 'facebook')!;
  const li = accounts.find((a) => a.network === 'linkedin')!;
  const tag = `flt${uid()}`;
  const fbId = await draft(request, `${tag} facebook only`, [fb.id]);
  const liId = await draft(request, `${tag} linkedin only`, [li.id]);
  const item = (id: string) => page.locator(`a[href$="/app/social/posts/${id}"]`);

  await page.goto(`/en/app/social/posts?q=${tag}`, { waitUntil: 'networkidle' });
  await expect(item(fbId)).toBeVisible();
  await expect(item(liId)).toBeVisible();

  // Red: solo LinkedIn.
  await page.getByTestId('posts-filter-network').selectOption('linkedin');
  await expect(page).toHaveURL(/network=linkedin/);
  await expect(item(liId)).toBeVisible();
  await expect(item(fbId)).toHaveCount(0);
  // La búsqueda se mantiene.
  await expect(page.getByRole('search').getByRole('searchbox')).toHaveValue(tag);

  // Cuenta: solo ofrece las de la red elegida.
  const accountFilter = page.getByTestId('posts-filter-account');
  await expect(accountFilter.locator(`option[value="${fb.id}"]`)).toHaveCount(0);
  await accountFilter.selectOption(li.id);
  await expect(page).toHaveURL(new RegExp(`account=${li.id}`));
  await expect(item(liId)).toBeVisible();

  // Pestaña Borradores: los filtros siguen puestos.
  await page.getByTestId('posts-tabs').getByRole('link').nth(1).click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(page).toHaveURL(/network=linkedin/);

  // Sin coincidencias: "Quitar filtros" vuelve a la pestaña sin filtros.
  await page.goto(`/en/app/social/posts?network=facebook&account=${li.id}&q=${tag}-none`, { waitUntil: 'networkidle' });
  await page.getByTestId('posts-clear-filters').click();
  await expect(page).toHaveURL(/\/en\/app\/social\/posts$/);
});
