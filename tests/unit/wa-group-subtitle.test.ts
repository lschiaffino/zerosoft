import { describe, expect, it } from 'vitest';
import { groupSubtitle } from '@/lib/wa-group-subtitle';

// Nombres y teléfonos inventados.
const ana = { name: 'Ana', phone: '+1 555 000 0101' };
const beto = { name: 'Beto', phone: '+1 555 000 0102' };
const sinNombre = { name: '', phone: '+1 555 000 0103' };
const linea = { name: '', phone: '+1 555 000 0001', me: true };

describe('groupSubtitle', () => {
  it('pone "Vos" al final y nunca el número propio', () => {
    const out = groupSubtitle([linea, ana, beto], 'Vos');
    expect(out).toBe('Ana, Beto, Vos');
    expect(out).not.toContain('0001');
  });

  it('primero los que tienen nombre, después los teléfonos, sin cambiar su orden', () => {
    expect(groupSubtitle([sinNombre, beto, linea, ana], 'You')).toBe('Beto, Ana, +1 555 000 0103, You');
  });

  it('sin la cuenta en la lista no inventa "Vos"', () => {
    expect(groupSubtitle([ana, beto], 'Vos')).toBe('Ana, Beto');
  });

  it('corta con "…" si el grupo tiene más de los que se muestran', () => {
    expect(groupSubtitle([ana, beto, linea], 'Vos', 40)).toBe('Ana, Beto, Vos…');
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, phone: '' }));
    const out = groupSubtitle([...many, linea], 'Vos');
    expect(out.split(', ')).toHaveLength(12);
    expect(out.endsWith('Vos…')).toBe(true);
  });

  it('salta a quien no tiene nombre ni teléfono visible', () => {
    expect(groupSubtitle([{ name: '', phone: '' }, ana, linea], 'Vos')).toBe('Ana, Vos…');
  });

  it('vacío si no hay a quién nombrar', () => {
    expect(groupSubtitle([], 'Vos')).toBe('');
  });
});
