import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { mkdtemp, rm } from 'fs/promises';
import { getDb } from '@/lib/db';
import { createDocPage, updateDocPage } from '@/lib/docs';
import { createTeamspace, removeTeamspaceMember, setTeamspaceMember } from '@/lib/docs-access';
import { addMember, createTeam } from '@/lib/teams';
import { clearDraft, forgetOtherOfflineData, loadDraft, offlinePages, saveDraft, setOfflinePage } from '@/lib/docs-offline';
import { needsUnicodeFont } from '@/lib/docs-pdf';
import { collectExportPages, exportSinglePage, exportTree, PdfUnicodeError } from '@/lib/docs-export';
import { sanitizeDocsHtml } from '@/lib/docs-sanitize';
import { duplicableSource, duplicatePublished } from '@/lib/docs-public-duplicate';
import { pageAnalytics, recordPageView, updatePagePublishSettings } from '@/lib/docs-site';
import { createImportJob, getImportJob, type ImportJobView } from '@/lib/import-jobs';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import { appendLocalChunk, localZipRef } from '@/lib/docs-notion-import';
import { bufferSource, listZipEntries, readZipEntry } from '@/lib/zip-reader';
import { buildZip } from '@/lib/zip-writer';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

/** Re-QA de D5: offline por persona, PDF con otros alfabetos, links privados, import y analítica. */

const para = (id: string, content: string, indent = 0): DocsBlock => ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}) });

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'zs-d5r-'));
  process.env.IMPORTS_DIR = dir;
});
afterAll(async () => {
  delete process.env.IMPORTS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('Borradores y páginas sin conexión: de una persona en un workspace', () => {
  it('Bob no ve ni guarda lo que escribió Olivia; cerrar sesión borra todo', () => {
    const g = globalThis as unknown as { localStorage?: MemoryStorage };
    const store = new MemoryStorage();
    g.localStorage = store;
    try {
      const olivia = 'olivia:ws1';
      const bob = 'bob:ws1';
      const base = { updated_at: 'x', title: 't', content: [] };
      expect(saveDraft(olivia, 'p1', { content: [para('a', 'de Olivia')] }, base)).toBe(true);
      expect(loadDraft(olivia, 'p1')?.patch.content?.[0].content).toBe('de Olivia');
      expect(loadDraft(bob, 'p1')).toBeNull();
      // Una clave de Olivia con el dueño cambiado a mano tampoco sirve para Bob.
      const key = store.keys().find((k) => k.includes('p1'))!;
      store.setItem(key.replace(olivia, bob), store.getItem(key)!);
      expect(loadDraft(bob, 'p1')).toBeNull();
      expect(loadDraft('', 'p1')).toBeNull();
      setOfflinePage(olivia, 'p1', true);
      expect(offlinePages(olivia)).toEqual(['p1']);
      expect(offlinePages(bob)).toEqual([]);
      // Entra Bob en el mismo equipo: lo de Olivia se va.
      saveDraft(bob, 'p2', { title: 'de Bob' }, base);
      forgetOtherOfflineData(bob);
      expect(store.keys().some((k) => k.includes(olivia))).toBe(false);
      expect(loadDraft(bob, 'p2')?.patch.title).toBe('de Bob');
      clearDraft(bob, 'p2');
      expect(loadDraft(bob, 'p2')).toBeNull();
      // Cerrar sesión (clearOfflineData) borra todo lo de Docs.
      saveDraft(bob, 'p3', { title: 'x' }, base);
      store.setItem('otra-cosa', '1');
      forgetOtherOfflineData(null);
      expect(store.keys()).toEqual(['otra-cosa']);
    } finally {
      delete g.localStorage;
    }
  });
});

/** Cache Storage en memoria para correr public/sw.js en un sandbox. */
function memoryCaches() {
  const all = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!all.has(name)) all.set(name, new Map());
    const c = all.get(name)!;
    return {
      put: async (k: string, r: Response) => void c.set(typeof k === 'string' ? k : String(k), r),
      match: async (k: string) => c.get(typeof k === 'string' ? k : String(k))?.clone(),
      delete: async (k: string) => c.delete(k),
    };
  };
  return { all, api: { open, keys: async () => [...all.keys()], delete: async (k: string) => all.delete(k) } };
}

describe('Service worker: las vistas guardadas son de quien está en la sesión', () => {
  it('sin persona no guarda nada; al cambiar de persona (o cerrar sesión) se borran las vistas', async () => {
    const code = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
    const caches = memoryCaches();
    const self: Record<string, unknown> = { addEventListener: () => undefined, location: { origin: 'https://app.test' } };
    vm.runInNewContext(code, { self, URL, Response, console, caches: caches.api });
    const sw = self.__zsOffline as {
      setUser: (id: string | null) => Promise<void>;
      getUser: () => Promise<string | null>;
      pagesCache: () => Promise<{ put: (k: string, r: Response) => Promise<void> } | null>;
    };
    expect(await sw.pagesCache()).toBeNull();
    await sw.setUser('olivia:ws1');
    const mine = await sw.pagesCache();
    await mine!.put('https://app.test/es/app/docs/p1', new Response('privado de Olivia'));
    const pageCaches = () => [...caches.all.keys()].filter((k) => k.includes('-pages'));
    expect(pageCaches()).toHaveLength(1);
    expect(pageCaches()[0]).toContain(encodeURIComponent('olivia:ws1'));
    // Mismo usuario: nada cambia.
    await sw.setUser('olivia:ws1');
    expect(pageCaches()).toHaveLength(1);
    // Entra Bob: lo de Olivia se borra antes de guardar nada de él.
    await sw.setUser('bob:ws1');
    expect(pageCaches()).toHaveLength(0);
    expect(await sw.getUser()).toBe('bob:ws1');
    await (await sw.pagesCache())!.put('https://app.test/es/app/docs/p2', new Response('de Bob'));
    // Cerrar sesión: nadie y nada guardado.
    await sw.setUser(null);
    expect(pageCaches()).toHaveLength(0);
    expect(await sw.pagesCache()).toBeNull();
  });
});

describe('PDF con otros alfabetos', () => {
  it('detecta lo que las fuentes estándar no muestran (los emoji no cuentan)', () => {
    expect(needsUnicodeFont('Título', [para('a', 'ñandú — “hola” 🚀 €')])).toBe(false);
    expect(needsUnicodeFont('Отчёт', [])).toBe(true);
    expect(needsUnicodeFont('x', [para('a', '<strong>日本語</strong>')])).toBe(true);
    expect(needsUnicodeFont('x', [{ id: 't', type: 'table', content: '', rows: [['a', 'ελληνικά']] }])).toBe(true);
  });

  it('una página así no sale como PDF con "???": error para usar Imprimir; en un zip va en HTML', async () => {
    const u = await makeUser('uni');
    const p = await createDocPage(u.id, { title: 'Отчёт' });
    await updateDocPage(u.id, p.id, { content: [para('a', 'Привет мир')] }, { actorId: u.id });
    const latin = await createDocPage(u.id, { title: 'Latin', parent_id: p.id });
    await updateDocPage(u.id, latin.id, { content: [para('a', 'hola')] }, { actorId: u.id });
    const actor = { id: u.id, email: u.email } as never;
    const ctx = { actor, origin: 'https://app', format: 'pdf' as const, locale: 'en', footer: '' };
    const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(p.id)) as never;
    await expect(exportSinglePage(row, ctx)).rejects.toBeInstanceOf(PdfUnicodeError);
    const out = await exportTree(await collectExportPages(actor, p.id, true), ctx, 'x');
    expect(out.htmlFallback).toBe(1);
    const src = bufferSource(out.body);
    const names = (await listZipEntries(src)).map((e) => e.name);
    expect(names.some((n) => n.endsWith('.html') && n.startsWith('Отчёт'))).toBe(true);
    expect(names.some((n) => n.endsWith('.pdf') && n.includes('Latin'))).toBe(true);
    const html = (await listZipEntries(src)).find((e) => e.name.endsWith('.html'))!;
    expect((await readZipEntry(src, html, 1e6)).toString('utf8')).toContain('Привет мир');
  });
});

describe('Sanitizado de links', () => {
  it('data:, javascript: y vbscript: quedan como texto, sin <a> vacío', () => {
    for (const bad of ['data:text/html;base64,PHNjcmlwdD4=', 'javascript:alert(1)', 'vbscript:x', ' JavaScript:alert(1)']) {
      const out = sanitizeDocsHtml(`ver <a href="${bad}">esto</a>`);
      expect(out).not.toMatch(/<a\b/);
      expect(out).toContain('esto');
    }
    expect(sanitizeDocsHtml('<a href="https://x.y">ok</a>')).toContain('href="https://x.y"');
    expect(sanitizeDocsHtml('<a href="/app/docs">rel</a>')).toContain('href="/app/docs"');
  });
});

describe('Links a páginas privadas en export, duplicar y analítica', () => {
  it('el export de Bob y la copia pública muestran "Private page", no el título', async () => {
    const owner = await makeUser('lp');
    const bob = await makeUser('lpbob');
    const team = await createTeam(owner.id, 'E');
    await addMember(team.id, bob.id, 'member');
    const priv = await createTeamspace(owner.id, owner.id, { name: 'Priv', access: 'private' });
    const secret = await createDocPage(owner.id, { title: 'ZQTITULO secreto', teamspace_id: priv.id });
    const host = await createDocPage(owner.id, { title: 'Pública' });
    await updateDocPage(owner.id, host.id, { content: [para('a', `ver <a href="/app/docs/${secret.id}" data-page="${secret.id}">ZQTITULO secreto</a>`)], published: true }, { actorId: owner.id });
    const asBob = { id: owner.id, email: owner.email, actingUser: { id: bob.id, email: bob.email }, role: 'member', team } as never;
    const out = await exportTree(await collectExportPages(asBob, null, true), { actor: asBob, origin: 'https://app', format: 'md', locale: 'en', footer: '' }, 'ws');
    const src = bufferSource(out.body);
    let all = '';
    for (const e of await listZipEntries(src)) all += (await readZipEntry(src, e, 1e6)).toString('utf8');
    expect(all).not.toContain('ZQTITULO');
    expect(all).toContain('Private page');
    await updatePagePublishSettings(host.id, { allow_duplicate: true });
    const slug = ((await getDb().prepare('SELECT slug FROM docs_pages WHERE id = ?').get(host.id)) as { slug: string }).slug;
    const other = await makeUser('lpother');
    await duplicatePublished((await duplicableSource(owner.id, slug))!, other.id, null);
    const copy = (await getDb().prepare('SELECT content FROM docs_pages WHERE user_id = ?').get(other.id)) as { content: string };
    expect(copy.content).not.toContain('ZQTITULO');
    expect(copy.content).toContain('Private page');
  });

  it('"Quién la vio" es de los últimos 30 días y sin emails', async () => {
    const u = await makeUser('pv30');
    const old = await makeUser('pvold');
    const page = await createDocPage(u.id, { title: 'x' });
    await recordPageView(page.id, u.id);
    await getDb().prepare("INSERT INTO docs_page_views (page_id, viewer_id, day, views, last_at) VALUES (?, ?, '2020-01-01', 3, '2020-01-01T00:00:00.000Z')").run(page.id, old.id);
    const a = await pageAnalytics(page.id);
    expect(a.people.map((p) => p.id)).toEqual([u.id]);
    expect(JSON.stringify(a)).not.toContain('@');
  });
});

async function runToEnd(id: string): Promise<ImportJobView> {
  for (let i = 0; i < 40; i++) {
    const v = (await runImportJob(id, 5_000))!;
    if (!['fetching', 'importing'].includes(v.status)) return v;
  }
  throw new Error('stuck');
}

describe('Import: teamspace revalidado, archivos enormes y reimportar', () => {
  it('si quien importa salió del teamspace privado antes de escribir, falla con forbidden', async () => {
    const owner = await makeUser('imo');
    const bob = await makeUser('imb');
    const team = await createTeam(owner.id, 'E');
    await addMember(team.id, bob.id, 'member');
    const ts = await createTeamspace(owner.id, owner.id, { name: 'Priv', access: 'private' });
    await setTeamspaceMember(ts.id, bob.id, 'member');
    const zip = buildZip([{ name: 'Nota.md', data: '# Nota\n\nHola' }]);
    const job = await createImportJob({ workspaceId: owner.id, teamId: team.id, userId: bob.id, app: 'docs', source: 'files', status: 'fetching', options: { teamspace_id: ts.id } });
    await getDb().prepare('UPDATE import_jobs SET payload = ? WHERE id = ?').run(localZipRef(job.id), job.id);
    await appendLocalChunk(job.id, 0, zip);
    expect((await runToEnd(job.id)).status).toBe('preview');
    await removeTeamspaceMember(ts.id, bob.id);
    await startImportJob((await getImportJob(job.id))!);
    expect(await runToEnd(job.id)).toMatchObject({ status: 'failed', error: 'forbidden' });
    expect(await getDb().prepare('SELECT 1 AS x FROM docs_pages WHERE user_id = ? AND title = ?').get(owner.id, 'Nota')).toBeUndefined();
  });

  it('un .md más grande que el tope entra vacío y se avisa; reimportar avisa lo omitido', async () => {
    const u = await makeUser('imbig');
    const big = `# Grande\n\n${'x'.repeat(8 * 1024 * 1024 + 10)}`;
    const zip = buildZip([
      { name: 'Grande.md', data: big, deflate: true },
      { name: 'Chica.md', data: '# Chica\n\nok' },
    ]);
    const run = async () => {
      const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'files', status: 'fetching' });
      await getDb().prepare('UPDATE import_jobs SET payload = ? WHERE id = ?').run(localZipRef(job.id), job.id);
      await appendLocalChunk(job.id, 0, zip);
      await runToEnd(job.id);
      await startImportJob((await getImportJob(job.id))!);
      return runToEnd(job.id);
    };
    const done = await run();
    expect(done.report).toMatchObject({ pages: 2, tooLarge: 1 });
    expect((await run()).report).toMatchObject({ skipped: 2 });
  });
});
