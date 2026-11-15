import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Vitest corre sin JSX: se revisa el componente como texto.
const src = readFileSync(path.join(__dirname, '../../components/groups/wa/RichText.tsx'), 'utf8');
const css = readFileSync(path.join(__dirname, '../../styles/groups-wa.css'), 'utf8');

describe('viñetas de WhatsApp', () => {
  it('el texto de cada ítem va en un solo bloque, así las negritas no lo parten en columnas', () => {
    const items = src.split('\n').filter((l) => l.includes('className="wa-li"'));
    expect(items).toHaveLength(2);
    for (const l of items) expect(l).toMatch(/<\/span><span className="wa-li-body">\{renderNodes\([^)]*\)[^}]*\}<\/span><\/span>/);
    expect(css).toMatch(/\.wa-li-body\s*\{[^}]*min-width:\s*0/);
  });
});
