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
