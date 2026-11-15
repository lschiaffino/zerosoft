import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { cleanLinkButton, MAX_BUTTON_LABEL, SendError } from '@/lib/send/types';
import { linkSchema } from '@/lib/send/schema';
import migration from '@/lib/schema/migration-files/20261115_1338_send_link_button';
import type { Client } from '@libsql/client';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof SendError ? err.code : 'other';
  }
  return null;
};

describe('Send: botón propio del link', () => {
  it('los dos vacíos es sin botón', () => {
    expect(cleanLinkButton('', '')).toEqual({ label: '', url: '' });
    expect(cleanLinkButton('   ', ' ')).toEqual({ label: '', url: '' });
    expect(cleanLinkButton(undefined, null)).toEqual({ label: '', url: '' });
  });

  it('texto y URL web, con los espacios ordenados', () => {
    expect(cleanLinkButton('  Agendar   una llamada ', 'https://cal.acme.com/demo')).toEqual({ label: 'Agendar una llamada', url: 'https://cal.acme.com/demo' });
    expect(cleanLinkButton('Demo', 'http://acme.com')).toEqual({ label: 'Demo', url: 'http://acme.com/' });
  });

  it('sin esquema se toma como https', () => {
    expect(cleanLinkButton('Demo', 'acme.com/demo')).toEqual({ label: 'Demo', url: 'https://acme.com/demo' });
  });

  it('van los dos o ninguno', () => {
    expect(code(() => cleanLinkButton('Demo', ''))).toBe('invalid_button_url');
    expect(code(() => cleanLinkButton('', 'https://acme.com'))).toBe('invalid_button_label');
  });

  it('solo http y https: nada de javascript:, data:, mailto: ni archivos', () => {
    for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'mailto:a@b.com', 'ftp://acme.com', 'https://']) {
      expect(code(() => cleanLinkButton('Demo', url))).toBe('invalid_button_url');
    }
  });

  it('el texto tiene tope', () => {
    expect(cleanLinkButton('x'.repeat(MAX_BUTTON_LABEL), 'https://acme.com').label).toHaveLength(MAX_BUTTON_LABEL);
    expect(code(() => cleanLinkButton('x'.repeat(MAX_BUTTON_LABEL + 1), 'https://acme.com'))).toBe('invalid_button_label');
    expect(code(() => cleanLinkButton('Demo', `https://acme.com/${'a'.repeat(2000)}`))).toBe('invalid_button_url');
  });

  it('el esquema del pedido acepta los campos y corta lo enorme', () => {
    expect(linkSchema.safeParse({ buttonLabel: 'Demo', buttonUrl: 'https://acme.com' }).success).toBe(true);
    expect(linkSchema.safeParse({ buttonUrl: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('la migración suma las columnas y se puede correr dos veces', async () => {
    const client = createClient({ url: ':memory:' });
    await client.execute('CREATE TABLE send_links (id TEXT PRIMARY KEY, name TEXT)');
    await client.execute("INSERT INTO send_links (id, name) VALUES ('sl_1', 'Acme')");
    await migration.up(client as unknown as Client);
    await migration.up(client as unknown as Client);
    const cols = (await client.execute('PRAGMA table_info(send_links)')).rows.map((r) => String(r.name));
    expect(cols).toEqual(expect.arrayContaining(['button_label', 'button_url']));
    const row = (await client.execute("SELECT button_label, button_url FROM send_links WHERE id = 'sl_1'")).rows[0];
    expect(row.button_label).toBe('');
    expect(row.button_url).toBe('');
  });
});
