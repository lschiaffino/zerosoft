import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aliasCandidates, coerceFlag, flagValue, parseArgs, schemaFields } from '../../cli/src/args.mjs';
import { baseUrlFrom, exitCodeForStatus } from '../../cli/src/client.mjs';
import { deleteCredentials, loadCredentials, saveCredentials, withRefreshLock } from '../../cli/src/credentials.mjs';
import { human, stripTerminal, table } from '../../cli/src/output.mjs';
import { refresh, revoke } from '../../cli/src/oauth.mjs';

describe('argumentos', () => {
  it('flags, posicionales y --json en sus dos formas', () => {
    expect(parseArgs(['crm', 'contacts', 'list', '--limit', '5'])).toEqual({ positional: ['crm', 'contacts', 'list'], flags: { limit: '5' } });
    expect(parseArgs(['whoami', '--json']).flags.json).toBe(true);
    expect(parseArgs(['call', 'x', '--json', '{"a":1}'])).toEqual({ positional: ['call', 'x'], flags: { json: '{"a":1}' } });
    expect(parseArgs(['--a=b', '--c']).flags).toEqual({ a: 'b', c: true });
    expect(parseArgs(['--confirm', 'x']).positional).toEqual(['x']);
    expect(parseArgs(['--', '--no-flag']).positional).toEqual(['--no-flag']);
    expect((parseArgs(['--file', 'a', '--file', 'b']).flags as unknown as Record<string, unknown>).file).toEqual(['a', 'b']);
    expect(parseArgs(['-h']).flags.help).toBe(true);
  });

  it('valores de flag', () => {
    expect(flagValue('5')).toBe(5);
    expect(flagValue('true')).toBe(true);
    expect(flagValue('null')).toBeNull();
    expect(flagValue('{"a":1}')).toEqual({ a: 1 });
    expect(flagValue('00123')).toBe('00123');
    expect(flagValue('+5491155')).toBe('+5491155');
    expect(flagValue('hola')).toBe('hola');
  });

  it('alias: del id más largo al más corto, con la v1 detrás', () => {
    const c = aliasCandidates(['crm', 'email-templates', 'get', 'abc']);
    expect(c[0]).toEqual({ id: 'crm.email_templates.get.abc', rest: [] });
    expect(c[2]).toEqual({ id: 'crm.email_templates.get', rest: ['abc'] });
    expect(c[3]).toEqual({ id: 'v1.crm.email_templates.get', rest: ['abc'] });
    expect(aliasCandidates(['cal', 'event-types', 'list'])[0].id).toBe('calendar.event_types.list');
    expect(aliasCandidates(['link', 'list'])[0].id).toBe('links.list');
    expect(aliasCandidates(['board', 'list'])[0].id).toBe('boards.list');
    // Un id conserva mayúsculas y signos en lo que sobra: es un parámetro, no parte del nombre.
    expect(aliasCandidates(['crm', 'deals', 'get', 'Ab-C']).find((x: { id: string }) => x.id === 'crm.deals.get')?.rest).toEqual(['Ab-C']);
  });
});

describe('servidor', () => {
  it('https, o http solo en localhost', () => {
    expect(baseUrlFrom('https://zerosoft.ai/')).toBe('https://zerosoft.ai');
    expect(baseUrlFrom('http://localhost:3000')).toBe('http://localhost:3000');
    expect(baseUrlFrom('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(() => baseUrlFrom('http://zerosoft.ai')).toThrow();
    expect(() => baseUrlFrom('nope')).toThrow();
  });

  it('códigos de salida', () => {
    expect(exitCodeForStatus(401)).toBe(3);
    expect(exitCodeForStatus(403)).toBe(4);
    expect(exitCodeForStatus(404)).toBe(4);
    expect(exitCodeForStatus(429)).toBe(5);
    expect(exitCodeForStatus(400)).toBe(2);
    expect(exitCodeForStatus(500)).toBe(1);
  });
});

describe('credenciales en archivo', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-cli-test-'));
    process.env.ZEROSOFT_CONFIG_DIR = dir;
    process.env.ZEROSOFT_NO_KEYCHAIN = '1';
  });
  afterEach(() => {
    delete process.env.ZEROSOFT_CONFIG_DIR;
    delete process.env.ZEROSOFT_NO_KEYCHAIN;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('queda 0600, se lee y se borra por servidor', () => {
    const where = saveCredentials('https://a.example', { accessToken: 'x' });
    expect(where).toContain('credentials.json');
    expect(fs.statSync(where).mode & 0o777).toBe(0o600);
    saveCredentials('https://b.example', { accessToken: 'y' });
    expect(loadCredentials('https://a.example')).toEqual({ accessToken: 'x' });
    deleteCredentials('https://a.example');
    expect(loadCredentials('https://a.example')).toBeNull();
    expect(loadCredentials('https://b.example')).toEqual({ accessToken: 'y' });
  });
});

describe('salida', () => {
  it('tabla y objeto legibles', () => {
    expect(table([{ id: '1', name: 'Ana' }])).toContain('Ana');
    expect(table([])).toBe('(nothing)');
    expect(human({ rows: [{ id: '1', name: 'Ana' }], total: 1 })).toContain('total: 1');
    expect(human({ a: 1 })).toContain('a  1');
    expect(human(null)).toBe('(empty)');
  });
});

describe('valores según el esquema', () => {
  it('un teléfono con solo dígitos sigue siendo texto', () => {
    expect(coerceFlag('5491155', { type: 'string' })).toBe('5491155');
    expect(coerceFlag('5491155', { type: ['string', 'null'] })).toBe('5491155');
    expect(coerceFlag('null', { type: ['string', 'null'] })).toBeNull();
    expect(coerceFlag('30', { type: 'integer' })).toBe(30);
    expect(coerceFlag('true', { type: 'boolean' })).toBe(true);
    expect(coerceFlag('a', { type: 'array', items: { type: 'string' } })).toEqual(['a']);
    expect(coerceFlag('5', undefined)).toBe(5);
  });

  it('junta los campos de path, query, body y sus alternativas', () => {
    const { fields, open } = schemaFields({
      properties: {
        path: { properties: { id: { type: 'string' } } },
        query: { properties: { q: { type: 'string' } } },
        body: { anyOf: [{ properties: { a: { type: 'string' } } }, { properties: { b: { type: 'number' } } }] },
      },
    });
    expect([...fields.keys()].sort()).toEqual(['a', 'b', 'id', 'q']);
    expect(open).toBe(false);
    expect(schemaFields({ properties: { body: { type: 'object', additionalProperties: true } } }).open).toBe(true);
  });
});

describe('sesión de la CLI', () => {
  const creds = { tokenEndpoint: 'https://z.example/token', revocationEndpoint: 'https://z.example/revoke', clientId: 'c', refreshToken: 'r' };
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('solo invalid_grant cierra la sesión', async () => {
    answer(400, { error: 'invalid_grant' });
    expect(await refresh(creds, 'x')).toBeNull();
    answer(429, { error: 'rate_limited' });
    await expect(refresh(creds, 'x')).rejects.toMatchObject({ exitCode: 5 });
    answer(503, {});
    await expect(refresh(creds, 'x')).rejects.toMatchObject({ exitCode: 1 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(refresh(creds, 'x')).rejects.toThrow(/still|reach/);
  });

  it('revoke dice si el servidor lo confirmó', async () => {
    answer(200, {});
    expect(await revoke(creds)).toBe(true);
    answer(500, {});
    expect(await revoke(creds)).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await revoke(creds)).toBe(false);
  });

  it('el lock de refresh deja pasar de a uno', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-lock-'));
    process.env.ZEROSOFT_CONFIG_DIR = dir;
    let inside = 0;
    let max = 0;
    await Promise.all(
      [1, 2, 3].map(() =>
        withRefreshLock(async () => {
          inside += 1;
          max = Math.max(max, inside);
          await new Promise((r) => setTimeout(r, 30));
          inside -= 1;
        }),
      ),
    );
    expect(max).toBe(1);
    delete process.env.ZEROSOFT_CONFIG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('terminal', () => {
  it('saca escapes y controles de lo que imprime', () => {
    const evil = '\x1b[2J\x1b]0;owned\x07Ana\x07\x08';
    expect(stripTerminal(evil)).toBe('Ana');
    expect(human({ name: evil })).not.toContain('\x1b');
    expect(table([{ name: evil }])).not.toContain('\x1b');
  });
});
