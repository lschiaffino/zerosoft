import { describe, expect, it } from 'vitest';
import { isAllowedUpload } from '@/lib/uploads';

describe('uploads: tipos permitidos', () => {
  it.each([
    ['foto.png', 'image/png'],
    ['doc.pdf', 'application/pdf'],
    ['planilla.csv', 'text/csv'],
    ['archivo.zip', 'application/zip'],
  ])('permite %s', (name, mime) => expect(isAllowedUpload(name, mime)).toBe(true));

  it.each([
    ['x.html', 'text/html'],
    ['x.svg', 'image/svg+xml'],
    ['x.png', 'text/html'],
    ['x.HTM', 'application/octet-stream'],
    ['x.js', 'text/javascript'],
    ['x.xml', 'application/xml'],
  ])('bloquea %s (%s)', (name, mime) => expect(isAllowedUpload(name, mime)).toBe(false));
});
