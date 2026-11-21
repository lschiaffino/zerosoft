import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Social: el compositor sugiere #hashtags y @menciones que el equipo ya usó
 * (redes simuladas, SOCIAL_FAKE=1). Con el teclado: ↓ y Enter insertan, Esc
 * cierra sin tocar el texto; con el mouse, un clic inserta. Enter con la
 * lista abierta no manda el formulario.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

type Account = { id: string; name: string; network: string };

async function connect(request: APIRequestContext, network: string): Promise<Account[]> {
  const res = await request.post('/api/social/connect', { data: { network } });
  expect(res.ok()).toBe(true);
  const { url } = (await res.json()) as { url: string };
  const back = new URL(url);
  await request.get(`${back.pathname}${back.search}`, { maxRedirects: 0 });
  return ((await (await request.get('/api/social/accounts')).json()) as { accounts: Account[] }).accounts;
}

test('sugerir hashtags y menciones ya usados al escribir', async ({ page, request }) => {
  const accounts = await connect(request, 'linkedin');
  const li = accounts.find((a) => a.network === 'linkedin')!;
  const tag = `launch${uid()}`;
  const handle = `partner${uid()}`;
  const res = await request.post('/api/social/posts', { data: { text: `Old post #${tag} with @${handle}`, accountIds: [li.id], action: 'draft' } });
  expect(res.ok()).toBe(true);

  await page.goto(`/en/app/social/posts/new?account=${li.id}`, { waitUntil: 'networkidle' });
  const text = page.getByTestId('compose-text');
  const list = page.getByTestId('tag-suggest');

  // Teclado: #launchXXXX… sugiere el tag; Enter lo inserta con un espacio.
  await text.click();
  await text.pressSequentially(`New one #${tag.slice(0, -1)}`);
  await expect(list).toBeVisible();
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await text.press('Enter');
  await expect(text).toHaveValue(`New one #${tag} `);
  await expect(list).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/social\/posts\/new/);

  // Esc cierra la lista y deja el texto como está.
  await text.pressSequentially(`@${handle.slice(0, -1)}`);
  await expect(list).toBeVisible();
  await text.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(text).toHaveValue(`New one #${tag} @${handle.slice(0, -1)}`);

  // Mouse: en un tag nuevo, un clic en la opción la inserta.
  await text.pressSequentially(` @${handle.slice(0, 4)}`);
  await list.getByRole('option', { name: new RegExp(`@${handle}`) }).click();
  await expect(text).toHaveValue(`New one #${tag} @${handle.slice(0, -1)} @${handle} `);
  await expect(text).toBeFocused();
});
