import { expect, test } from '@playwright/test';

/**
 * CSP de la app (lib/csp.ts): cada página de /app sale con su nonce, Next lo
 * pone en sus scripts y nada de lo que la página carga viola la política. En
 * todo el sitio, los headers base (object-src, base-uri, Permissions-Policy).
 */
test('CSP: nonce por request en la app y ninguna violación al cargar', async ({ page, request }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const w = window as unknown as { __csp?: string[] };
      w.__csp ??= [];
      w.__csp.push(`${e.effectiveDirective} ${e.blockedURI} ${location.pathname}`);
    });
  });

  const res = await page.goto('/en/app', { waitUntil: 'networkidle' });
  const policy = res!.headers()['content-security-policy-report-only'] ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
  expect(nonce, policy).toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");
  const withNonce = await page.evaluate((n) => Array.from(document.querySelectorAll('script')).filter((s) => s.nonce === n).length, nonce!);
  expect(withNonce).toBeGreaterThan(0);

  // Otra request, otro nonce.
  const again = await request.get('/en/app');
  expect(again.headers()['content-security-policy-report-only']).toBeTruthy();
  expect(again.headers()['content-security-policy-report-only']).not.toContain(`'nonce-${nonce}'`);

  const events: string[] = [];
  for (const path of ['/en/app', '/en/app/crm', '/en/app/docs', '/en/app/track', '/en/app/notes', '/en/app/board', '/en/app/lines', '/en/app/settings']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    events.push(...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])));
  }
  const all = [...violations, ...events];
  expect(all, all.join('\n')).toEqual([]);
});

test('CSP: headers base en el sitio y en la app', async ({ request }) => {
  const app = (await request.get('/en/app')).headers()['content-security-policy'];
  expect(app).toContain("frame-ancestors 'self'");
  expect(app).toContain("object-src 'none'");
  expect(app).toContain("base-uri 'self'");
  for (const path of ['/en', '/en/app']) {
    const h = (await request.get(path)).headers();
    expect(h['permissions-policy'], path).toContain('geolocation=()');
    expect(h['permissions-policy'], path).toContain('microphone=(self)');
    expect(h['x-content-type-options'], path).toBe('nosniff');
  }
  // El sitio sigue sin nonce (sale estático del CDN).
  expect((await request.get('/en')).headers()['content-security-policy-report-only']).toBeUndefined();
});

test('CSP: el endpoint de avisos responde 204', async ({ request }) => {
  const res = await request.post('/api/csp-report', {
    headers: { 'content-type': 'application/csp-report' },
    data: JSON.stringify({ 'csp-report': { 'document-uri': 'http://localhost/en/app', 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline' } }),
  });
  expect(res.status()).toBe(204);
});
