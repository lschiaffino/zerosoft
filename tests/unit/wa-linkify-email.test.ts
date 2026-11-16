import { describe, expect, it } from 'vitest';
import { linkify } from '@/components/groups/wa/format';

describe('linkify como WhatsApp', () => {
  it('un mail es un link mailto', () => {
    expect(linkify('ana@example.com es mi mail')).toEqual([{ text: 'ana@example.com', href: 'mailto:ana@example.com' }, { text: ' es mi mail' }]);
  });
  it('el punto final de la oración no entra en el mail', () => {
    const parts = linkify('Escribime a ana.perez@mail.example.ar.');
    expect(parts[1]).toEqual({ text: 'ana.perez@mail.example.ar', href: 'mailto:ana.perez@mail.example.ar' });
    expect(parts[2]).toEqual({ text: '.' });
  });
  it('www. sin http va con https', () => {
    expect(linkify('mirá www.example.com/x, dale')[1]).toEqual({ text: 'www.example.com/x', href: 'https://www.example.com/x' });
  });
  it('una mención o una arroba sola no es un mail', () => {
    expect(linkify('hola @Ana y @ también').every((p) => !p.href)).toBe(true);
  });
  it('los links con http siguen igual', () => {
    expect(linkify('ver https://example.com/a?b=1.')[1]).toEqual({ text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' });
  });
});
