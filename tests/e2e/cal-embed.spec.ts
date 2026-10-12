import { expect, test } from '@playwright/test';

// El "sitio del cliente" es un origen público simulado y el server corre en
// localhost: Chrome bloquearía público→loopback (Private Network Access). En
// producción el embed se sirve desde zerosoft.ai, así que no aplica.
test.use({
  launchOptions: {
    args: ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks'],
  },
});

test('Cal: embed inline en un sitio de terceros', async ({ page, request, baseURL }) => {
  const slug = `emb-${Math.random().toString(36).slice(2, 8)}`;
  const et = await (await request.post('/api/calendar/event-types', { data: { slug, title: 'Embedded intro', durationMin: 30, active: true } })).json();
  const rules = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));
  await request.post(`/api/calendar/event-types/${et.id}/availability`, { data: { rules } });
  const { handle } = await (await request.get('/api/calendar/config')).json();
  const url = `${baseURL}/en/book/${handle}/${slug}`;

  const script = await request.get('/api/calendar/embed.js');
  expect(script.headers()['content-type']).toContain('javascript');

  // "Sitio del cliente": una página en otro origen que incluye el script.
  await page.route('http://cliente.example/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><h1>Mi sitio</h1><script src="${baseURL}/api/calendar/embed.js" data-url="${url}"></script></body></html>`,
    }),
  );
  await page.goto('http://cliente.example/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByText('Embedded intro')).toBeVisible();
  await expect(frame.getByText('Powered by zerosoft')).toBeVisible();
  // El alto se ajusta al contenido (mensaje zs-cal:height).
  await expect.poll(async () => (await page.locator('iframe').boundingBox())?.height ?? 0).not.toBe(720);
});
