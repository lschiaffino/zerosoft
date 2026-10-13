import { describe, expect, it } from 'vitest';
import { gateToken, hashPassword, isValidGateToken, verifyPassword } from '@/lib/links';

describe('links: contraseñas y gate', () => {
  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const stored = await hashPassword('ceros');
    expect(await verifyPassword('ceros', stored)).toBe(true);
    expect(await verifyPassword('otra', stored)).toBe(false);
    expect(await verifyPassword('ceros', 'basura')).toBe(false);
  });

  it('el token del gate depende del slug y del hash', () => {
    const t = gateToken('abc', 'h1');
    expect(isValidGateToken('abc', 'h1', t)).toBe(true);
    expect(isValidGateToken('abd', 'h1', t)).toBe(false);
    expect(isValidGateToken('abc', 'h2', t)).toBe(false);
    expect(isValidGateToken('abc', 'h1', undefined)).toBe(false);
  });
});

import { isValidUrl, normalizeUrl } from '@/lib/utils';

describe('links: normalización de URLs', () => {
  it.each([
    ['example.com/x', 'https://example.com/x', true],
    ['example.com:8080/x', 'https://example.com:8080/x', true],
    ['http://a.com', 'http://a.com', true],
    ['ftp://files.com', 'ftp://files.com', false],
    ['javascript:alert(1)', 'javascript:alert(1)', false],
    ['data:text/html,hi', 'data:text/html,hi', false],
  ])('%s', (input, normalized, valid) => {
    expect(normalizeUrl(input)).toBe(normalized);
    expect(isValidUrl(normalizeUrl(input))).toBe(valid);
  });
});

describe('links: edición compartida (app y API v1)', () => {
  it('aplica cambios, valida la URL y no deja tomar un slug ocupado', async () => {
    const { applyLinkPatch, createLink, getUserLink, linkPatchSchema } = await import('@/lib/links');
    const { makeUser } = await import('./helpers');
    const u = await makeUser('lp');
    const a = await createLink(u.id, { url: 'https://example.com/a', slug: `a${crypto.randomUUID().slice(0, 6)}` });
    const b = await createLink(u.id, { url: 'https://example.com/b', slug: `b${crypto.randomUUID().slice(0, 6)}` });
    if (!a.ok || !b.ok) throw new Error('setup');
    const linkA = (await getUserLink(u.id, a.link.id))!;

    expect(await applyLinkPatch(linkA, linkPatchSchema.parse({ title: 'Nuevo', tags: ['x'] }))).toBeNull();
    expect((await getUserLink(u.id, a.link.id))?.title).toBe('Nuevo');
    expect(await applyLinkPatch(linkA, linkPatchSchema.parse({ url: 'no es url' }))).toEqual({ error: 'invalid_url', status: 400 });
    expect(await applyLinkPatch(linkA, linkPatchSchema.parse({ slug: b.link.slug }))).toEqual({ error: 'slug_taken', status: 409 });
  });
});
