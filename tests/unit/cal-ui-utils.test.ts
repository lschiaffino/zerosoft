import { describe, expect, it } from 'vitest';
import {
  bookingRulesPayload,
  brandOr,
  contrast,
  fieldKeyFromLabel,
  formatTimezone,
  resolveBrand,
  slugify,
  textOn,
  usesDefaultLimits,
} from '@/components/calendar/cal-utils';

describe('Cal UI: slugs y claves derivadas', () => {
  it('saca la URL del título, sin acentos ni símbolos', () => {
    expect(slugify('Llamada inicial')).toBe('llamada-inicial');
    expect(slugify('  Demo · Producto (45′) ')).toBe('demo-producto-45');
    expect(slugify('Ñandú Ágil')).toBe('nandu-agil');
    expect(slugify('x'.repeat(80))).toHaveLength(60);
  });

  it('saca la clave de una pregunta de su etiqueta y empieza con letra', () => {
    expect(fieldKeyFromLabel('¿Cuál es tu empresa?')).toBe('cual_es_tu_empresa');
    expect(fieldKeyFromLabel('2 personas')).toBe('q_2_personas');
    expect(fieldKeyFromLabel('???')).toBe('pregunta');
    expect(fieldKeyFromLabel('¿Cuál es tu empresa?')).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('Nombre y Email en cualquier idioma pasan a name/email (pre-llenan la reserva)', () => {
    expect(fieldKeyFromLabel('Nombre')).toBe('name');
    expect(fieldKeyFromLabel('Nome')).toBe('name');
    expect(fieldKeyFromLabel('E-mail')).toBe('email');
    expect(fieldKeyFromLabel('Correo electrónico')).toBe('email');
  });

  it('no repite una clave que ya existe', () => {
    expect(fieldKeyFromLabel('Empresa', ['empresa'])).toBe('empresa_2');
    expect(fieldKeyFromLabel('Empresa', ['empresa', 'empresa_2'])).toBe('empresa_3');
  });
});

describe('Cal UI: color de marca', () => {
  it('elige blanco o tinta según contraste sobre el color de marca', () => {
    expect(textOn('#111111')).toBe('#ffffff');
    expect(textOn('#2f6bff')).toBe('#ffffff');
    expect(textOn('#e6b400')).toBe('#111111');
    expect(textOn('#00b8a9')).toBe('#111111');
    for (const c of ['#111111', '#2f6bff', '#e6b400', '#00b8a9', '#ffffff', '#7b4dff']) {
      // Siempre el de más contraste de los dos (los colores de línea quedan en ~4.5 o más).
      const other = textOn(c) === '#ffffff' ? '#111111' : '#ffffff';
      expect(contrast(c, textOn(c))).toBeGreaterThanOrEqual(contrast(c, other));
      expect(contrast(c, textOn(c))).toBeGreaterThan(4.4);
    }
  });

  it('usa el respaldo si el color no es un hex válido', () => {
    expect(brandOr('#ABCDEF', '#000000')).toBe('#ABCDEF');
    expect(brandOr('red', '#000000')).toBe('#000000');
    expect(brandOr(null, '#123456')).toBe('#123456');
  });
});

describe('Cal UI: límites por defecto del evento', () => {
  const limits = { bufferBeforeMin: 5, bufferAfterMin: 10, minNoticeHours: 2, maxFutureDays: 14 };

  it('un evento sin límites propios usa los del calendario', () => {
    expect(usesDefaultLimits({})).toBe(true);
    expect(usesDefaultLimits({ allowGuests: true })).toBe(true);
    expect(usesDefaultLimits({ minNoticeHours: 0 })).toBe(false);
  });

  it('con "usar valores por defecto" omite los límites y conserva lo demás', () => {
    const prev = { bufferBeforeMin: 30, allowGuests: true };
    expect(bookingRulesPayload(prev, true, limits)).toEqual({ allowGuests: true });
    expect(bookingRulesPayload(prev, false, limits)).toEqual({ allowGuests: true, ...limits });
  });
});

describe('resolveBrand', () => {
  const ws = { color: '#2f6bff', logoUrl: 'https://acme.test/logo.svg', name: 'Acme' };

  it('usa la marca del workspace si el evento no la cambia', () => {
    expect(resolveBrand(ws, { brand_color: null, logo_url: null })).toEqual({
      color: '#2f6bff',
      on: '#ffffff',
      logoUrl: 'https://acme.test/logo.svg',
      name: 'Acme',
    });
  });

  it('el color y el logo del evento reemplazan a los del workspace', () => {
    const b = resolveBrand(ws, { brand_color: '#e6b400', logo_url: '/otro.png' });
    expect(b.color).toBe('#e6b400');
    expect(b.on).toBe('#111111');
    expect(b.logoUrl).toBe('/otro.png');
  });

  it('sin color en ningún lado cae a tinta y descarta logos inválidos', () => {
    const b = resolveBrand({ color: null, logoUrl: 'javascript:alert(1)', name: 'X' });
    expect(b.color).toBe('#111111');
    expect(b.logoUrl).toBeNull();
  });
});

describe('formatTimezone', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  it('muestra la ciudad sin guiones bajos y el desfase', () => {
    expect(formatTimezone('America/Argentina/Buenos_Aires', 'es', winter)).toBe('Buenos Aires (GMT-3)');
  });
  it('UTC queda como UTC', () => {
    expect(formatTimezone('UTC', 'es', winter)).toBe('UTC');
  });
  it('una zona inválida devuelve el nombre legible', () => {
    expect(formatTimezone('Nada/Por_Aca', 'es', winter)).toBe('Por Aca');
  });
});
