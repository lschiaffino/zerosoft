import { expect, test, type APIRequestContext } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Books, las páginas de presupuestos, lotes, bienes de uso, presupuestos
 * financieros, reglas bancarias, informes nuevos y los links públicos
 * (presupuesto y estado de cuenta): en los cinco aspectos a 390 (claro y
 * oscuro alternados) y en el aspecto por defecto a 1280, claro y oscuro, sin
 * scroll lateral, sin nada fuera de pantalla y sin errores del servidor.
 */

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

async function seed(request: APIRequestContext) {
  const { contact } = await ok<{ contact: { id: string } }>(request.post('/api/books/contacts', { data: { name: `Looks customer ${uid()}`, email: 'customer@example.com', syncCrm: false } }));
  for (const price of [125000, 43050]) {
    const { doc } = await ok<{ doc: { id: string } }>(request.post('/api/books/documents', { data: { docType: 'invoice', contactId: contact.id, lines: [{ description: 'Consulting services for the quarter', unitPrice: price }] } }));
    await ok(request.post(`/api/books/documents/${doc.id}/approve`));
  }
  const { quote } = await ok<{ quote: { id: string } }>(
    request.post('/api/books/quotes', { data: { contactId: contact.id, title: 'Website redesign and hosting for one year', expiryDate: '2099-01-01', lines: [{ description: 'Design', unitPrice: 250000 }, { description: 'Hosting', unitPrice: 12000, quantity: 12 }] } }),
  );
  const sent = await ok<{ quote: { publicToken: string } }>(request.post(`/api/books/quotes/${quote.id}/send`, { data: {} }));
  const { asset } = await ok<{ asset: { id: string } }>(request.post('/api/books/assets', { data: { name: 'Laptop for the design team', cost: 240000, method: 'straight_line', lifeMonths: 36 } }));
  const { budget } = await ok<{ budget: { id: string } }>(request.post('/api/books/budgets', { data: { name: `Budget ${uid()}`, startMonth: '2026-01', months: 12 } }));
  const portal = await ok<{ token: string }>(request.post(`/api/books/contacts/${contact.id}/portal`, { data: { action: 'enable' } }));
  return { contact: contact.id, quote: quote.id, quoteToken: sent.quote.publicToken, asset: asset.id, budget: budget.id, portal: portal.token };
}

test('Books: páginas nuevas en los cinco aspectos, claro y oscuro, 1280 y 390', async ({ browser, request, baseURL }) => {
  test.setTimeout(600_000);
  const s = await seed(request);
  const pages = [
    '/en/app/books/quotes',
    '/en/app/books/quotes/new',
    `/en/app/books/quotes/${s.quote}`,
    '/en/app/books/batch-payments',
    '/en/app/books/batch-payments/new?type=invoice',
    '/en/app/books/fixed-assets',
    '/en/app/books/fixed-assets/new',
    `/en/app/books/fixed-assets/${s.asset}`,
    '/en/app/books/budgets',
    `/en/app/books/budgets/${s.budget}`,
    '/en/app/books/banking/rules',
    '/en/app/books/journal/opening',
    `/en/app/books/contacts/${s.contact}`,
    '/en/app/books/reports/trial-balance',
    '/en/app/books/reports/general-ledger',
    '/en/app/books/reports/budget-variance',
    '/en/app/books/reports/pnl?compare=prev',
    '/en/app/books/settings?tab=tracking',
    `/en/quote/${s.quoteToken}`,
    `/en/statement/${s.portal}`,
  ];
  const combos: Array<{ look: (typeof LOOKS)[number]; theme: 'light' | 'dark'; phone: boolean }> = [
    { look: 'current', theme: 'light', phone: false },
    { look: 'current', theme: 'dark', phone: false },
    ...LOOKS.map((look, i) => ({ look, theme: i % 2 ? ('dark' as const) : ('light' as const), phone: true })),
  ];
  const errors: string[] = [];
  try {
    for (const { look, theme, phone } of combos) {
      await ok(request.put('/api/profile/look', { data: { look } }));
      const ctx = await browser.newContext({ baseURL, viewport: phone ? PHONE : { width: 1280, height: 860 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
      await setTheme(ctx, baseURL!, theme);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${page.url()} pageerror ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
      });
      for (const url of pages) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await settle(page);
        if (url.startsWith('/en/app/')) await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await check(page, `books ${look} ${theme} ${phone ? 390 : 1280} ${url}`, { tap: phone });
      }
      await ctx.close();
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
