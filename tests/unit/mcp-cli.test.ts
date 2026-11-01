import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aliasCandidates, flagValue, parseArgs } from '../../cli/src/args.mjs';
import { baseUrlFrom, exitCodeForStatus } from '../../cli/src/client.mjs';
import { deleteCredentials, loadCredentials, saveCredentials } from '../../cli/src/credentials.mjs';
import { human, table } from '../../cli/src/output.mjs';

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
