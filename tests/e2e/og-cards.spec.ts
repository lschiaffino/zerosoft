import { spawn } from 'child_process';
import { expect, test } from '@playwright/test';

/**
 * Las tarjetas para compartir (lib/og): cada página del sitemap tiene su
 * og:image PNG (ancha y cuadrada) que responde 200 y mide lo que declara.
 * Corre scripts/og-check.mjs contra el servidor de la suite.
 */
test('cada página del sitemap tiene su tarjeta para compartir', async ({ baseURL }) => {
  test.setTimeout(15 * 60_000);
  const out = await new Promise<string>((resolve, reject) => {
    // En CI el primer render de cada tarjeta es en frío: el presupuesto es holgado.
    const child = spawn(process.execPath, ['scripts/og-check.mjs', baseURL!, '--budget', '20000', '--json'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (d) => (buf += d));
    child.on('error', reject);
    child.on('close', () => resolve(buf));
  });
  const result = JSON.parse(out) as { pages: number; images: number; p50: number; p95: number; errors: string[] };
  console.log(`og-check: ${result.pages} páginas, ${result.images} imágenes, p50 ${result.p50} ms, p95 ${result.p95} ms`);
  expect(result.errors).toEqual([]);
  expect(result.pages).toBeGreaterThan(100);
  // Ancha y cuadrada por página (muchas comparten la del blog o la del home).
  expect(result.images).toBeGreaterThan(result.pages / 2);
});

test('la tarjeta del home: inmutable con versión, cuadrada con f=sq', async ({ request }) => {
  const html = await (await request.get('/pt')).text();
  const og = [...html.matchAll(/property="og:image" content="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&')));
  expect(og.map((u) => u.pathname)).toEqual(['/api/og/home/pt', '/api/og/home/pt']);
  const wide = await request.get(og[0].pathname + og[0].search);
  expect(wide.headers()['cache-control']).toContain('immutable');
  const sq = await (await request.get(og[1].pathname + og[1].search)).body();
  expect([sq.readUInt32BE(16), sq.readUInt32BE(20)]).toEqual([1200, 1200]);
  // Sin versión, cache corto (la URL no cambia cuando cambia el contenido).
  expect((await request.get('/api/og/home/pt')).headers()['cache-control']).not.toContain('immutable');
});
