import { describe, expect, it } from 'vitest';
import { shortProjectKey } from '@/lib/track-tasks';

describe('clave corta de un proyecto importado', () => {
  it('iniciales o las primeras letras, nunca el nombre entero', () => {
    expect(shortProjectKey('Gen Proj 0idt')).toBe('gp');
    expect(shortProjectKey('Website')).toBe('web');
    expect(shortProjectKey('acme/e2e')).toBe('ae');
    expect(shortProjectKey('Diseño de Producto Móvil Nuevo Extra')).toBe('ddpm');
    expect(shortProjectKey('2024')).toBe('202');
    expect(shortProjectKey('')).toBe('');
  });
});
