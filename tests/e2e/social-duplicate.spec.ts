import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Social: duplicar una publicación. La copia queda en borrador, sin fecha,
 * con el mismo texto y las mismas cuentas, y se abre para editarla; la
 * original sigue programada.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function facebookPage(request: APIRequestContext) {
  const res = await request.post('/api/social/connect', { data: { network: 'facebook' } });
  expect(res.ok()).toBe(true);
  await request.get(((await res.json()) as { url: string }).url);
  const { accounts } = (await (await request.get('/api/social/accounts')).json()) as { accounts: Array<{ id: string; name: string; network: string }> };
  return accounts.find((a) => a.network === 'facebook' && a.name === 'Fake Coffee Page')!;
}

test('duplicar una publicación programada abre una copia en borrador', async ({ page, request }) => {
  const account = await facebookPage(request);
  const tag = uid();
  const created = await request.post('/api/social/posts', {
    data: { text: `Original ${tag}`, accountIds: [account.id], overrides: { [account.id]: `Facebook ${tag}` }, action: 'schedule', scheduledAt: '2031-05-04T10:00:00.000Z' },
  });
  expect(created.ok()).toBe(true);
  const original = (await created.json()) as { id: string };

  await page.goto(`/app/social/posts/${original.id}`);
  await page.getByTestId('post-duplicate').click();
  await page.waitForURL(/\/app\/social\/posts\/(?!new)[^/?]+\?edit=1/);
  const copyId = new URL(page.url()).pathname.split('/').pop()!;
  expect(copyId).not.toBe(original.id);

  const copy = (await (await request.get(`/api/social/posts/${copyId}`)).json()) as {
    post: { text: string; status: string; scheduledAt: string | null; targets: Array<{ accountId: string; textOverride: string | null }> };
  };
  expect(copy.post.text).toBe(`Original ${tag}`);
  expect(copy.post.status).toBe('draft');
  expect(copy.post.scheduledAt).toBeNull();
  expect(copy.post.targets.map((t) => [t.accountId, t.textOverride])).toEqual([[account.id, `Facebook ${tag}`]]);

  const orig = (await (await request.get(`/api/social/posts/${original.id}`)).json()) as { post: { status: string } };
  expect(orig.post.status).toBe('scheduled');
});
