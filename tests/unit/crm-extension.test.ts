import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { buildZip, crc32 } from '@/lib/zip-writer';
import { bufferSource, listZipEntries, readZipEntry } from '@/lib/zip-reader';
import { createActivity, createContact } from '@/lib/crm';
import { getDb } from '@/lib/db';
import {
  extensionGmailId,
  extensionSidebar,
  logExtensionEmail,
  normalizeEmail,
  trackExtensionEmail,
} from '@/lib/crm-extension';
import { makeUser } from './helpers';

const require = createRequire(import.meta.url);
const shared = require('../../extensions/chrome/shared.js') as {
  normalizeBaseUrl(raw: unknown): string | null;
  isBuiltinOrigin(origin: string): boolean;
  originPattern(origin: string): string;
  isValidToken(token: unknown): boolean;
  parseEmails(text: string): string[];
  splitName(name: string): { firstName: string; lastName: string };
  pixelHtml(url: string): string;
  formatDue(iso: string | null, locale: string, now?: Date): { label: string; overdue: boolean };
  appUrl(origin: string, path: string): string;
};

describe('zip writer', () => {
  it('crc32 conocido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('el zip se lee con lib/zip-reader', async () => {
    const zip = buildZip([
      { name: 'zerosoft-crm/manifest.json', data: '{"manifest_version":3}' },
      { name: 'zerosoft-crm/icons/icon.png', data: new Uint8Array([137, 80, 78, 71, 0, 255]) },
      { name: 'zerosoft-crm/_locales/es/messages.json', data: '{"a":"ñandú"}' },
    ]);
    const src = bufferSource(zip);
    const entries = await listZipEntries(src);
    expect(entries.map((e) => e.name)).toEqual([
      'zerosoft-crm/manifest.json',
      'zerosoft-crm/icons/icon.png',
      'zerosoft-crm/_locales/es/messages.json',
    ]);
    expect((await readZipEntry(src, entries[0], 1000)).toString('utf8')).toBe('{"manifest_version":3}');
    expect([...(await readZipEntry(src, entries[1], 1000))]).toEqual([137, 80, 78, 71, 0, 255]);
    expect((await readZipEntry(src, entries[2], 1000)).toString('utf8')).toBe('{"a":"ñandú"}');
  });

  it('rechaza nombres repetidos o con ..', () => {
    expect(() => buildZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }])).toThrow();
    expect(() => buildZip([{ name: '../x', data: '1' }])).toThrow();
  });
});

describe('extensión: manifest y textos', () => {
  const root = path.join(process.cwd(), 'extensions', 'chrome');
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const en = JSON.parse(readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));

  it('MV3 con service worker, Gmail y opciones', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.content_scripts[0].matches).toEqual(['https://mail.google.com/*']);
    expect(manifest.host_permissions).toContain('http://localhost/*');
    expect(manifest.options_page).toBe('options.html');
  });

  it('los tres idiomas tienen las mismas claves y las que usa el código', () => {
    for (const l of ['es', 'pt']) {
      const other = JSON.parse(readFileSync(path.join(root, `_locales/${l}/messages.json`), 'utf8'));
      expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    }
    const code = ['content.js', 'options.js'].map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n');
    const html = readFileSync(path.join(root, 'options.html'), 'utf8');
    const used = new Set([
      ...[...code.matchAll(/\bt\('([A-Za-z]+)'/g)].map((m) => m[1]),
      ...[...html.matchAll(/data-i18n="([A-Za-z]+)"/g)].map((m) => m[1]),
    ]);
    for (const k of used) expect(en[k], k).toBeTruthy();
  });
});

describe('extensión: helpers puros (shared.js)', () => {
  it('URL de la app', () => {
    expect(shared.normalizeBaseUrl('zerosoft.ai/app/crm')).toBe('https://zerosoft.ai');
    expect(shared.normalizeBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(shared.normalizeBaseUrl('ftp://x.com')).toBeNull();
    expect(shared.normalizeBaseUrl('')).toBeNull();
    expect(shared.isBuiltinOrigin('https://zerosoft.ai')).toBe(true);
    expect(shared.isBuiltinOrigin('http://localhost:3370')).toBe(true);
    expect(shared.isBuiltinOrigin('https://crm.miempresa.com')).toBe(false);
    expect(shared.originPattern('http://localhost:3370')).toBe('http://localhost/*');
    expect(shared.appUrl('https://zerosoft.ai', '/app/crm')).toBe('https://zerosoft.ai/app/crm');
  });

  it('token, emails, nombres y pixel', () => {
    expect(shared.isValidToken('zs_abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(shared.isValidToken('abc')).toBe(false);
    expect(shared.parseEmails('Ana <Ana@Acme.com>, bob@y.io, ana@acme.com')).toEqual(['ana@acme.com', 'bob@y.io']);
    expect(shared.splitName('Ana María Pérez')).toEqual({ firstName: 'Ana María', lastName: 'Pérez' });
    expect(shared.splitName('Ana')).toEqual({ firstName: 'Ana', lastName: '' });
    expect(shared.pixelHtml('https://x.ai/p.gif?a=1&b="2"')).toBe(
      '<img src="https://x.ai/p.gif?a=1&amp;b=&quot;2&quot;" width="1" height="1" alt="" border="0" data-zs-pixel="1">',
    );
  });

  it('vencimiento', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    expect(shared.formatDue('2026-10-20 10:00:00', 'en', now).overdue).toBe(true);
    expect(shared.formatDue('2026-10-30', 'en', now).overdue).toBe(false);
    expect(shared.formatDue(null, 'en', now).label).toBe('');
  });
});

describe('extensión: backend', () => {
  it('normalizeEmail y gmail_id', () => {
    expect(normalizeEmail(' Ana <ANA@acme.com> ')).toBe('ana@acme.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(extensionGmailId('18C2F0A1B2C3D4E5')).toBe('18c2f0a1b2c3d4e5');
    expect(extensionGmailId('#msg-f:123')).toBe('ext:#msg-f:123');
  });

  it('sidebar: contacto con deals y tareas; respeta la visibilidad', async () => {
    const owner = await makeUser('ext');
    const contact = await createContact(owner.id, { firstName: 'Ana', lastName: 'Pérez', email: 'Ana@Acme.com', jobTitle: 'CTO' });
    await createActivity(owner.id, { type: 'task', subject: 'Mandar propuesta', contactId: contact.id, dueAt: '2026-11-01' });
    const actor = { workspaceId: owner.id, personId: owner.id, scope: undefined };
    const res = await extensionSidebar(actor, 'ana@acme.com');
    expect(res.contact?.name).toBe('Ana Pérez');
    expect(res.contact?.url).toBe(`/app/crm/contacts/${contact.id}`);
    expect(res.tasks.map((t) => t.subject)).toEqual(['Mandar propuesta']);
    expect(res.deals).toEqual([]);

    const none = await extensionSidebar(actor, 'nadie@acme.com');
    expect(none.contact).toBeNull();
    // Un scope que no incluye al dueño no ve el contacto.
    const hidden = await extensionSidebar({ ...actor, scope: ['otra-persona'] }, 'ana@acme.com');
    expect(hidden.contact).toBeNull();
  });

  it('log-email: registra una vez, con actividad, y sin contacto no guarda', async () => {
    const owner = await makeUser('ext');
    const contact = await createContact(owner.id, { firstName: 'Bea', email: 'bea@cliente.com' });
    const actor = { workspaceId: owner.id, personId: owner.id, scope: undefined };
    const input = {
      messageId: '18c2f0a1b2c3d4e5',
      from: 'Bea <bea@cliente.com>',
      to: owner.email,
      subject: 'Precio',
      body: 'Hola, ¿cuánto sale?',
    };
    const first = await logExtensionEmail(actor, input);
    expect(first.ok && !first.duplicate).toBe(true);
    const again = await logExtensionEmail(actor, input);
    expect(again.ok && again.duplicate).toBe(true);
    const rows = (await getDb()
      .prepare("SELECT * FROM crm_emails WHERE user_id = ? AND source = 'extension'")
      .all(owner.id)) as Array<{ contact_id: string; direction: string; gmail_id: string; activity_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contact_id: contact.id, direction: 'in', gmail_id: '18c2f0a1b2c3d4e5' });
    expect(rows[0].activity_id).toBeTruthy();

    const orphan = await logExtensionEmail(actor, { ...input, messageId: 'aaaaaaaaaaaaaaaa', from: 'x@desconocido.com' });
    expect(orphan).toEqual({ ok: false, error: 'no_contact' });
  });

  it('track: crea el contacto si no existe y devuelve el pixel con token', async () => {
    const owner = await makeUser('ext');
    const actor = { workspaceId: owner.id, personId: owner.id, scope: undefined };
    const res = await trackExtensionEmail(actor, { to: 'Nuevo <nuevo@prospecto.com>', subject: 'Hola', body: 'Te escribo' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.createdContact).toBe(true);
    expect(res.pixelUrl).toMatch(/\/api\/crm\/t\/o\/[a-f0-9]{32}\.gif$/);
    const row = (await getDb()
      .prepare('SELECT direction, tracking_token, to_emails FROM crm_emails WHERE id = ?')
      .get(res.emailId)) as { direction: string; tracking_token: string; to_emails: string };
    expect(row.direction).toBe('out');
    expect(res.pixelUrl).toContain(row.tracking_token);

    expect(await trackExtensionEmail(actor, { to: owner.email })).toEqual({ ok: false, error: 'missing_recipient' });
  });
});
