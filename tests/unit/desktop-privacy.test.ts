import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_PRIVACY as F, factsLocale, sourceUrl } from '@/lib/desktop-privacy';

/**
 * desktop/privacy-facts.json es la única lista de lo que la app de escritorio lee, guarda y
 * manda: la usan la página /download/privacy y Ajustes › Privacidad y datos de la app. Acá se
 * revisa su forma y que nombre lo mismo que el código de la app (los tests de Rust de
 * desktop/src-tauri/src/privacy.rs comparan además los límites y las etiquetas).
 */
const root = join(__dirname, '..', '..');
const rust = (file: string) => readFileSync(join(root, 'desktop', 'src-tauri', 'src', file), 'utf8');
const LOCALES = ['en', 'es', 'pt'] as const;
const SECTIONS = ['permissions', 'stores', 'network', 'never', 'system', 'indicators', 'events', 'controls', 'security', 'open'] as const;

interface Literal {
  start: number;
  end: number;
  value: string;
}

/**
 * Rust "enmascarado": comentarios (de línea y de bloque), contenido de strings, raw strings y
 * literales de carácter pasan a espacios (mismas posiciones), y los módulos #[cfg(test)] se sacan.
 * Devuelve ese código y los strings que quedan, con su posición.
 */
export function scanRust(src: string): { code: string; literals: Literal[] } {
  const out = src.split('');
  const literals: Literal[] = [];
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      blank(i, end);
      i = end;
    } else if (two === '/*') {
      let depth = 0;
      let k = i;
      do {
        if (src.slice(k, k + 2) === '/*') {
          depth++;
          k += 2;
        } else if (src.slice(k, k + 2) === '*/') {
          depth--;
          k += 2;
        } else k++;
      } while (depth > 0 && k < src.length);
      blank(i, k);
      i = k;
    } else if (c === '"' || ((c === 'r' || c === 'b') && /^(?:b?r#*"|b")/.test(src.slice(i, i + 4)) && !/[A-Za-z0-9_]/.test(src[i - 1] ?? ''))) {
      const m = /^(b?)(r?)(#*)"/.exec(src.slice(i))!;
      const raw = m[2] === 'r';
      const close = `"${m[3]}`;
      const open = i + m[0].length;
      let k = open;
      while (k < src.length && src.slice(k, k + close.length) !== close) k += !raw && src[k] === '\\' ? 2 : 1;
      literals.push({ start: open, end: k, value: src.slice(open, k) });
      blank(open, k);
      i = k + close.length;
    } else if (c === "'" && /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/.test(src.slice(i, i + 12))) {
      const m = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/.exec(src.slice(i, i + 12))!;
      blank(i + 1, i + m[0].length - 1);
      i += m[0].length;
    } else i++;
  }
  let code = out.join('');
  // Módulos de test: desde #[cfg(test)] hasta su llave de cierre (con strings ya enmascarados).
  for (let t = code.indexOf('#[cfg(test)]'); t >= 0; t = code.indexOf('#[cfg(test)]', t + 1)) {
    const open = code.indexOf('{', t);
    const semi = code.indexOf(';', t);
    if (open < 0 || (semi >= 0 && semi < open)) continue;
    let depth = 0;
    let k = open;
    for (; k < code.length; k++) {
      if (code[k] === '{') depth++;
      if (code[k] === '}' && --depth === 0) break;
    }
    code = code.slice(0, t) + code.slice(t, k + 1).replace(/[^\n]/g, ' ') + code.slice(k + 1);
    for (let n = literals.length - 1; n >= 0; n--) if (literals[n].start > t && literals[n].end <= k) literals.splice(n, 1);
  }
  return { code, literals };
}

const VERB = /(?:Method::(GET|POST|PUT|PATCH|DELETE|HEAD)\b|(?:\.|::)(get|post|put|patch|delete|head)\()/g;

/** El método HTTP de un string con una ruta: el verbo de la misma sentencia, o el de la variable
 * que la guarda (`let url = format!(…); … http.post(url)`). BROWSER = se abre en el navegador. */
function methodFor(code: string, lit: Literal): string {
  const before = code.slice(0, lit.start);
  const stmtStart = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1;
  const verbs = [...code.slice(stmtStart, lit.start).matchAll(VERB)];
  if (verbs.length) {
    const v = verbs[verbs.length - 1];
    return (v[1] ?? v[2]).toUpperCase();
  }
  const lets = [...before.slice(Math.max(0, lit.start - 400)).matchAll(/\blet\s+(?:mut\s+)?([a-z_][a-z0-9_]*)\s*=/g)];
  const name = lets.length ? lets[lets.length - 1][1] : null;
  if (!name) return '?';
  const after = code.slice(lit.end, lit.end + 1500);
  const candidates = [
    { re: new RegExp(`(?:\\.|::)(get|post|put|patch|delete|head)\\(\\s*(?:[\\w&]+\\s*,\\s*)?&?${name}\\b`), m: (x: RegExpExecArray) => x[1].toUpperCase() },
    { re: /updater_builder\(/, m: () => 'GET' },
    { re: new RegExp(`open_url\\(\\s*&?${name}\\b`), m: () => 'BROWSER' },
  ]
    .map((c) => ({ x: c.re.exec(after), m: c.m }))
    .filter((c): c is { x: RegExpExecArray; m: (x: RegExpExecArray) => string } => c.x !== null)
    .sort((a, b) => a.x.index - b.x.index);
  return candidates.length ? candidates[0].m(candidates[0].x) : '?';
}

/** Cada pedido al servidor que hace la parte nativa: "MÉTODO /ruta" (sin query; "/ruta" sola si
 * se abre en el navegador). Strings con /api/ que no son pedidos: `ignore`. */
export function nativeEndpoints(src: string, ignore: string[] = []): string[] {
  const { code, literals } = scanRust(src);
  const found = new Set<string>();
  for (const lit of literals) {
    for (const e of lit.value.matchAll(/\/(?:api\/[A-Za-z0-9_.{}/-]*|robots\.txt)/g)) {
      if (ignore.includes(e[0])) continue;
      const method = methodFor(code, lit);
      found.add(method === 'BROWSER' ? e[0] : `${method} ${e[0]}`);
    }
  }
  return [...found];
}

function rustFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? rustFiles(join(dir, d.name)) : d.name.endsWith('.rs') ? [join(dir, d.name)] : []));
}

function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(texts);
  return [];
}

describe('hechos de privacidad del escritorio', () => {
  it('cada hecho está en los tres idiomas, con texto y con su archivo de código', () => {
    for (const section of SECTIONS) {
      const ids = new Set<string>();
      for (const item of F[section]) {
        expect(ids.has(item.id), `${section}.${item.id} repetido`).toBe(false);
        ids.add(item.id);
        expect(item.code.length, `${section}.${item.id}: sin código`).toBeGreaterThan(0);
        for (const file of item.code) expect(existsSync(join(root, file)), `${section}.${item.id}: ${file}`).toBe(true);
        const shape = JSON.stringify(Object.keys(item.en as object).sort());
        for (const l of LOCALES) {
          const all = texts(item[l]);
          expect(all.length, `${section}.${item.id}.${l}`).toBeGreaterThan(0);
          for (const t of all) expect(t.trim().length, `${section}.${item.id}.${l}`).toBeGreaterThan(2);
          if (typeof item.en === 'object') expect(JSON.stringify(Object.keys(item[l] as object).sort()), `${section}.${item.id}.${l}`).toBe(shape);
        }
      }
    }
    for (const l of LOCALES) expect(Object.keys(F.page[l]).sort()).toEqual(Object.keys(F.page.en).sort());
    for (const [tag, t] of Object.entries(F.tags)) for (const l of LOCALES) expect(t[l], `tags.${tag}.${l}`).toBeTruthy();
  });

  it('sigue las reglas de copy: sin guion largo ni frases de marketing', () => {
    const banned = [/—/, /take[s]? (your )?privacy seriously/i, /nos tomamos .* en serio/i, /levamos .* a sério/i, /military[- ]grade/i, /bank[- ]level/i, /100% (secure|seguro)/i];
    for (const t of texts(JSON.parse(readFileSync(join(root, 'desktop', 'privacy-facts.json'), 'utf8')))) {
      for (const re of banned) expect(re.test(t), `${re}: ${t.slice(0, 80)}`).toBe(false);
    }
  });

  it('nombra lo mismo que el código de la app', () => {
    const privacy = rust('privacy.rs');
    const list = (name: string) => new RegExp(`${name}: \\[&str; \\d+\\] = \\[([^\\]]+)\\]`).exec(privacy)?.[1].match(/"([a-z_]+)"/g)?.map((x) => x.slice(1, -1));
    // Lo guardado en disco: los mismos ids, en el mismo orden, que el inventario de la app.
    expect(F.stores.map((s) => s.id)).toEqual(list('STORE_IDS'));
    expect(F.stores.filter((s) => s.delete).map((s) => s.id)).toEqual(list('DELETABLE'));
    // Los eventos del registro: las variantes de `Kind`.
    const kinds = /pub enum Kind \{([\s\S]*?)\n\}/.exec(privacy)?.[1].match(/^\s{4}([A-Z][A-Za-z]+),/gm)?.map((v) => v.trim().slice(0, -1).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
    expect(F.events.map((e) => e.id)).toEqual(kinds);
    // Los permisos con "último uso".
    for (const cap of list('CAPABILITIES') ?? ['?']) expect(F.permissions.map((p) => p.id)).toContain(cap);
    // Cada llave es un ajuste que la app lee de verdad.
    const config = rust('config.rs');
    for (const c of F.controls) {
      if (c.id === 'restoreTabs') expect(rust('session.rs')).toContain('raw.get("restore")');
      else if (c.id === 'openAtLogin') expect(rust('commands.rs')).toContain('input.get("openAtLogin")');
      else expect(config, c.id).toContain(`input.get("${c.id}")`);
    }
    // Los valores por defecto que se dicen son los del código.
    for (const c of F.controls.filter((x) => !['restoreTabs', 'openAtLogin'].includes(x.id))) {
      expect(config, c.id).toContain(`raw.get("${c.id}").and_then(Value::as_bool) != Some(false)`);
      expect(c.default, c.id).toBe(true);
    }
    // La página que abre la app es esta.
    expect(privacy).toContain(`DOCS_PATH: &str = "${F.path}"`);
    expect(existsSync(join(root, 'app', '[locale]', ...F.path.split('/').filter(Boolean), 'page.tsx'))).toBe(true);
  });

  it('la lista de lo que sale es completa: cada pedido del código (método y ruta) está en los hechos, y al revés', () => {
    // Strings con /api/ que no son pedidos: prefijos que nav.rs compara y el callback del login de
    // Google al que vuelve el navegador (nav.rs).
    const ignore = ['/api/', '/api/auth/', '/api/auth/callback/google'];
    const inCode = new Set(rustFiles(join(root, 'desktop', 'src-tauri', 'src')).flatMap((f) => nativeEndpoints(readFileSync(f, 'utf8'), ignore)));
    expect([...inCode].filter((e) => e.startsWith('?')), 'pedidos sin método reconocible').toEqual([]);
    const inFacts = new Set(F.network.flatMap((n) => n.endpoints));
    expect([...inCode].sort()).toEqual([...inFacts].sort());
    for (const e of ['POST /api/voice/dictate', 'HEAD /robots.txt', 'GET /api/auth/csrf', 'POST /api/auth/signout', 'GET /api/desktop/update/latest.json', '/api/desktop/login', 'DELETE /api/voice/dictionary/{id}', 'PATCH /api/voice/settings']) {
      expect(inCode.has(e), e).toBe(true);
    }
  });

  it('el extractor de pedidos no se confunde', () => {
    const sample = [
      "fn a() { let q = '\"'; let x = b'}'; api::get(app, \"/api/si?x=1\"); }",
      '// GET /api/comentario',
      '/* bloque "/api/bloque" /* anidado */ sigue */',
      'fn b() { let url = format!("{}/api/var", s);',
      '  let c = 1;',
      '  http.post(url).send(); }',
      'fn c() { api::send_json(&app, reqwest::Method::PATCH, "/api/patch", &v); }',
      'fn d() { let feed = format!("{}/api/feed", s); let b = app.updater_builder(); }',
      'fn e() { let mut url = Url::parse(&format!("{s}/api/browser")); app.opener().open_url(url.as_str(), None); }',
      "fn f<'a>(x: &'a str) { http.delete(format!(\"{x}/api/borrar/{id}\")); }",
      '#[cfg(test)]',
      'mod tests { fn t() { api::get(app, "/api/test"); let r = r#"}"#; } }',
      'fn g() { http.head(format!("{}/robots.txt", s)); }',
    ].join('\n');
    expect(nativeEndpoints(sample).sort()).toEqual(['/api/browser', 'DELETE /api/borrar/{id}', 'GET /api/feed', 'GET /api/si', 'HEAD /robots.txt', 'PATCH /api/patch', 'POST /api/var'].sort());
  });

  it('los números que se dicen son los del código', () => {
    const remote = JSON.parse(readFileSync(join(root, 'desktop', 'src-tauri', 'capabilities', 'remote.json'), 'utf8')) as { permissions: string[] };
    const bridge = F.security.find((s) => s.id === 'bridge')!;
    for (const l of LOCALES) expect(bridge[l]).toContain(String(remote.permissions.length));
    expect(rust('privacy.rs')).toContain(`MAX_EVENTS: usize = ${F.limits.activityEvents}`);
    expect(rust('privacy.rs')).toContain(`MAX_AGE_MS: u64 = ${F.limits.activityDays} * 86_400_000`);
    expect(rust('retry.rs')).toContain(`PENDING_MAX: usize = ${F.limits.pendingMax}`);
    expect(rust('retry.rs')).toContain(`PENDING_MAX_AGE_MS: u64 = ${F.limits.pendingDays} * 86_400_000`);
    expect(rust('badge.rs')).toContain(`POLL_SECS: u64 = ${F.limits.badgeSeconds}`);
    expect(rust('updater.rs')).toContain(`CHECK_EVERY_SECS: u64 = ${F.limits.updateHours} * 3600`);
    expect(rust('system_audio.rs')).toContain(`IDLE_STOP_MS: u64 = ${F.limits.systemAudioIdleSeconds}_000`);
    // Y los textos usan esos números.
    const store = (id: string) => F.stores.find((s) => s.id === id)!;
    expect(store('pending').en.kept).toContain(`${F.limits.pendingMax}`);
    expect(store('pending').en.kept).toContain(`${F.limits.pendingDays} days`);
    expect(store('activity').en.kept).toContain(`${F.limits.activityEvents} events`);
    expect(F.network.find((n) => n.id === 'badge')!.en.when).toContain(`${F.limits.badgeSeconds} seconds`);
    expect(F.network.find((n) => n.id === 'updates')!.en.when).toContain(`${F.limits.updateHours} hours`);
    expect(F.permissions.find((p) => p.id === 'clipboard')!.en.why).toContain(`${F.limits.clipboardRestoreMs} ms`);
  });

  it('la página de descarga y la app enlazan a la página pública', () => {
    expect(readFileSync(join(root, 'app', '[locale]', 'download', 'page.tsx'), 'utf8')).toContain(`href="${F.path}"`);
    expect(sourceUrl('desktop/src-tauri/src/privacy.rs')).toBe('https://github.com/lschiaffino/zerosoft/blob/main/desktop/src-tauri/src/privacy.rs');
    expect(factsLocale('es')).toBe('es');
    expect(factsLocale('fr')).toBe('en');
    const strings = JSON.parse(readFileSync(join(root, 'desktop', 'strings.json'), 'utf8'));
    for (const l of LOCALES) expect(strings[l].privReadMore).toBeTruthy();
  });
});
