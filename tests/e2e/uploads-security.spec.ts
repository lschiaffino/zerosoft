import { expect, test } from '@playwright/test';
import { createClient } from '@libsql/client';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';

/**
 * Subidas locales (sin Blob): solo tipos de la lista permitida, nunca se
 * sirven como estáticos desde public/, y lo privado pasa por la ruta con
 * permisos. "Reinicio simulado": un archivo que una versión anterior dejó en
 * public/uploads (y que `next start` serviría como estático) sale igual por
 * la ruta con headers seguros, o da 404 si es de una carpeta privada.
 */

const XHT = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><script>window.__pwned=1</script></body></html>';

test('Uploads: .xht se rechaza; lo privado no sale por /uploads ni sin acceso', async ({ request, page }) => {
  const doc = (await (await request.post('/api/docs/pages', { data: { title: `Seguridad ${Date.now()}` } })).json()) as { id: string };

  for (const name of ['evil.xht', 'evil.xhtm', 'evil.rdf', 'evil.mht', 'evil.svg']) {
    const res = await request.post(`/api/docs/pages/${doc.id}/files`, {
      multipart: { file: { name, mimeType: 'application/octet-stream', buffer: Buffer.from(XHT) } },
    });
    expect(res.status(), name).toBe(415);
  }

  const up = await request.post(`/api/docs/pages/${doc.id}/files`, {
    multipart: { file: { name: 'privado.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') } },
  });
  expect(up.status()).toBe(201);
  const { url } = (await up.json()) as { url: string };
  expect(url).toMatch(/^\/uploads\/docs\//);

  // La URL del storage no sirve nada: Docs solo sale por /api/docs/files.
  expect((await request.get(url)).status()).toBe(404);

  await request.patch(`/api/docs/pages/${doc.id}`, {
    data: { content: [{ id: 'f1', type: 'file', content: '', url, name: 'privado.pdf', size: 15, mime: 'application/pdf' }] },
  });
  const ok = await request.get(`/api/docs/files/${doc.id}/f1?download=1`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['x-content-type-options']).toBe('nosniff');
  expect(ok.headers()['content-disposition']).toMatch(/^attachment/);

  // Sin acceso a la página (es de otra persona): 404.
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const other = `otra-${Date.now()}`;
  await db.execute({ sql: "INSERT INTO users (id, email, name) VALUES (?, ?, 'Otra')", args: [other, `${other}@e2e.test`] });
  await db.execute({ sql: 'UPDATE docs_pages SET user_id = ? WHERE id = ?', args: [other, doc.id] });
  db.close();
  expect((await request.get(`/api/docs/files/${doc.id}/f1`)).status()).toBe(404);

  // Archivos viejos en public/uploads (como tras actualizar y reiniciar).
  const legacy = path.join(process.cwd(), 'public', 'uploads');
  const chatName = `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}-evil.xht`;
  await mkdir(path.join(legacy, 'chat'), { recursive: true });
  await mkdir(path.join(legacy, 'docs'), { recursive: true });
  await writeFile(path.join(legacy, 'chat', chatName), XHT);
  await writeFile(path.join(legacy, 'docs', 'legacy-privado.pdf'), '%PDF-1.4');
  try {
    expect((await request.get('/uploads/docs/legacy-privado.pdf')).status()).toBe(404);
    const res = await request.get(`/uploads/chat/${chatName}`);
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['content-type']).toBe('application/octet-stream');
    expect(h['content-disposition']).toMatch(/^attachment/);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['content-security-policy']).toContain('sandbox');

    // Abierto en el navegador: se descarga o queda aislado, el script nunca corre.
    await page.goto('/en');
    const pwned = await page.evaluate(async (u) => {
      const f = document.createElement('iframe');
      f.src = u;
      document.body.appendChild(f);
      await new Promise((r) => setTimeout(r, 1500));
      try {
        return (f.contentWindow as unknown as { __pwned?: number }).__pwned ?? null;
      } catch {
        return null;
      }
    }, `/uploads/chat/${chatName}`);
    expect(pwned).toBeNull();
  } finally {
    await rm(path.join(legacy, 'chat', chatName), { force: true });
    await rm(path.join(legacy, 'docs', 'legacy-privado.pdf'), { force: true });
  }
});
