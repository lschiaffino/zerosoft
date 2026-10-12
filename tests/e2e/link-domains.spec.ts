import { createClient } from '@libsql/client';
import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

/** Simula que el DNS ya apunta acá (en la vida real lo hace "Verificar"). */
async function markVerified(id: string) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  await db.execute({ sql: 'UPDATE link_domains SET verified = 1 WHERE id = ?', args: [id] });
  db.close();
}

test('Link: dominio propio con slugs independientes, raíz y gate', async ({ request }) => {
  const hostname = `go-${uid()}.example.com`;
  const added = await request.post('/api/links/domains', { data: { hostname } });
  expect(added.status(), await added.text()).toBe(201);
  const domain = await added.json();
  expect(domain.dns[0].type).toBe('CNAME');

  // Sin verificar, no se puede usar.
  const early = await request.post('/api/links', { data: { url: 'https://example.com/a', slug: 'promo', domainId: domain.id } });
  expect(early.status()).toBe(400);
  expect((await early.json()).error).toBe('invalid_domain');

  await markVerified(domain.id);

  const slug = `promo${uid()}`;
  const onDomain = await request.post('/api/links', { data: { url: 'https://example.com/en-mi-dominio', slug, domainId: domain.id } });
  expect(onDomain.status()).toBe(201);
  expect((await onDomain.json()).short_url).toBe(`https://${hostname}/${slug}`);
  // El mismo slug en el dominio por defecto es otro link.
  const onDefault = await request.post('/api/links', { data: { url: 'https://example.com/en-zerosoft', slug } });
  expect(onDefault.status()).toBe(201);

  const viaDomain = await request.get(`/${slug}`, { headers: { host: hostname }, maxRedirects: 0 });
  expect(viaDomain.headers()['location']).toBe('https://example.com/en-mi-dominio');
  const viaApp = await request.get(`/${slug}`, { maxRedirects: 0 });
  expect(viaApp.headers()['location']).toBe('https://example.com/en-zerosoft');

  // En un dominio propio no hay palabras reservadas: /blog es un link.
  await request.post('/api/links', { data: { url: 'https://example.com/blog-propio', slug: 'blog', domainId: domain.id } });
  const blog = await request.get('/blog', { headers: { host: hostname }, maxRedirects: 0 });
  expect(blog.headers()['location']).toBe('https://example.com/blog-propio');

  // Raíz del dominio: redirect configurable.
  await request.patch(`/api/links/domains/${domain.id}`, { data: { rootUrl: 'https://example.com/home' } });
  const root = await request.get('/', { headers: { host: hostname }, maxRedirects: 0 });
  expect(root.headers()['location']).toBe('https://example.com/home');

  // Un host desconocido no resuelve links de nadie.
  const unknown = await request.get(`/${slug}`, { headers: { host: 'otro-dominio.example.org' }, maxRedirects: 0 });
  expect(unknown.headers()['location'] ?? '').toContain('/gone');

  // Gate con contraseña dentro del dominio propio (cookie y página en ese host).
  const secret = `vip${uid()}`;
  await request.post('/api/links', { data: { url: 'https://example.com/vip', slug: secret, password: 'ceros', domainId: domain.id } });
  const gated = await request.get(`/${secret}`, { headers: { host: hostname }, maxRedirects: 0 });
  expect(gated.headers()['location']).toContain(`${hostname}/en/gate/${secret}`);
  const gatePage = await request.get(`/en/gate/${secret}`, { headers: { host: hostname } });
  expect(gatePage.status()).toBe(200);
  const unlock = await request.post('/api/gate', { headers: { host: hostname }, data: { slug: secret, password: 'ceros' } });
  expect(unlock.ok()).toBeTruthy();
  // En el dominio por defecto ese slug no existe.
  expect((await request.post('/api/gate', { data: { slug: secret, password: 'ceros' } })).status()).toBe(404);

  // Con links, el dominio no se puede borrar.
  expect((await request.delete(`/api/links/domains/${domain.id}`)).status()).toBe(409);
});

test('Link: importar un CSV de Bitly', async ({ request }) => {
  const a = `imp${uid()}`;
  const csv = `Title,Bitlink,Long URL,Tags\nUno,https://bit.ly/${a},https://example.com/uno,campaña\nDos,https://bit.ly/zz,ftp://nope,\n`;
  const res = await request.post('/api/links/import', {
    multipart: { file: { name: 'bitly.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const report = await res.json();
  expect(report.imported).toBe(1);
  expect(report.skipped).toHaveLength(1);
  const go = await request.get(`/${a}`, { maxRedirects: 0 });
  expect(go.headers()['location']).toBe('https://example.com/uno');

  const exported = await request.get('/api/links/export?format=json');
  const body = await exported.json();
  expect(body.links.some((l: { slug: string }) => l.slug === a)).toBe(true);
});
