import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Social: escribir con IA en el compositor contra el modelo falso
 * (SOCIAL_AI_FAKE=1, lib/social-ai.ts) y redes simuladas (SOCIAL_FAKE=1).
 * Una idea arma el texto sin mandar el formulario, los cambios se deshacen,
 * Esc cierra la caja y devuelve el foco, y sin IA se ve el error.
 */

type Account = { id: string; name: string; network: string };

async function connect(request: APIRequestContext, network: string): Promise<Account[]> {
  const res = await request.post('/api/social/connect', { data: { network } });
  expect(res.ok()).toBe(true);
  const { url } = (await res.json()) as { url: string };
  const back = new URL(url);
  await request.get(`${back.pathname}${back.search}`, { maxRedirects: 0 });
  return ((await (await request.get('/api/social/accounts')).json()) as { accounts: Account[] }).accounts;
}

test('escribir con IA: idea, cambiar, deshacer y Esc', async ({ page, request }) => {
  const accounts = await connect(request, 'x');
  const x = accounts.find((a) => a.network === 'x')!;
  await page.goto(`/en/app/social/posts/new?account=${x.id}`, { waitUntil: 'networkidle' });

  const open = page.getByTestId('compose-ai-open');
  const text = page.getByTestId('compose-text');
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const idea = page.getByTestId('compose-ai-idea');
  await expect(idea).toBeFocused();

  // Enter escribe con la IA y no programa la publicación.
  await idea.fill('new opening hours from monday');
  await idea.press('Enter');
  await expect(text).toHaveValue(/New opening hours from monday/);
  await expect(page).toHaveURL(/\/app\/social\/posts\/new/);
  const written = await text.inputValue();
  // Entra en el límite de X: sin aviso de largo.
  await expect(page.getByTestId('counter-x')).toHaveAttribute('data-over', 'false');

  // Cambiar el texto y deshacer.
  await page.getByTestId('compose-ai-shorter').click();
  await expect(text).not.toHaveValue(written);
  await page.getByTestId('compose-ai-undo').click();
  await expect(text).toHaveValue(written);

  // Esc cierra la caja y el foco vuelve al botón.
  await page.getByTestId('compose-ai-shorter').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('compose-ai')).toHaveCount(0);
  await expect(open).toBeFocused();

  // Sin IA: el error se muestra y el texto no cambia.
  await page.context().addCookies([{ name: 'social_ai_fake', value: 'off', url: new URL(page.url()).origin }]);
  await open.click();
  await page.getByTestId('compose-ai-shorter').click();
  await expect(page.getByTestId('compose-ai').getByRole('alert')).toBeVisible();
  await expect(text).toHaveValue(written);
  await page.context().clearCookies({ name: 'social_ai_fake' });
});
