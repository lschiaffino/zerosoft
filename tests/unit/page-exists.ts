import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const appDir = join(__dirname, '..', '..', 'app', '[locale]');

/** ¿Hay page.tsx para la ruta (ej. /app/design/brand)? Los grupos de Next (`(nombre)`) no cuentan en la URL. */
export function pageExists(href: string): boolean {
  const segs = href.split(/[?#]/)[0].replace(/^\//, '').split('/').filter(Boolean);
  const groups = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((d) => /^\(.+\)$/.test(d)).map((d) => join(dir, d)) : []);
  const find = (dir: string, rest: string[]): boolean => {
    if (!rest.length) return existsSync(join(dir, 'page.tsx')) || groups(dir).some((g) => find(g, rest));
    const [seg, ...more] = rest;
    return (existsSync(join(dir, seg)) && find(join(dir, seg), more)) || groups(dir).some((g) => find(g, rest));
  };
  return find(appDir, segs);
}
