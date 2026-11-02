// Salida: JSON si hay pipe o --json, tablas legibles en una terminal.

/** Secuencias de terminal y caracteres de control: un dato de otra persona no maneja esta terminal. */
const CONTROL = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\\\)?|\x1b[@-Z\\\\^_]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

export function stripTerminal(text) {
  return String(text).replace(CONTROL, '');
}

export function wantsJson(flags) {
  return Boolean(flags.json === true || !process.stdout.isTTY);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const cell = (v) => stripTerminal(v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/\s+/g, ' ');

export function table(rows, columns) {
  if (!rows.length) return '(nothing)';
  const cols = columns ?? pickColumns(rows);
  const room = Math.max(40, process.stdout.columns || 120);
  const widths = cols.map((c) => Math.min(48, Math.max(c.length, ...rows.map((r) => cell(r[c]).length))));
  while (widths.reduce((a, b) => a + b + 2, 0) > room && Math.max(...widths) > 12) {
    widths[widths.indexOf(Math.max(...widths))] -= 1;
  }
  const clip = (s, w) => (s.length > w ? `${s.slice(0, Math.max(1, w - 1))}…` : s.padEnd(w));
  const head = cols.map((c, i) => clip(c.toUpperCase(), widths[i])).join('  ');
  const lines = rows.map((r) => cols.map((c, i) => clip(cell(r[c]), widths[i])).join('  ').trimEnd());
  return [head.trimEnd(), ...lines].join('\n');
}

function pickColumns(rows) {
  const seen = new Map();
  for (const r of rows.slice(0, 50)) {
    if (!r || typeof r !== 'object') continue;
    for (const [k, v] of Object.entries(r)) if (scalar(v) && !seen.has(k)) seen.set(k, true);
  }
  const keys = [...seen.keys()];
  const first = ['id', 'name', 'title', 'email', 'identifier', 'status'].filter((k) => keys.includes(k));
  return [...first, ...keys.filter((k) => !first.includes(k))].slice(0, 6);
}

/** Lo más legible de una respuesta: la lista más grande como tabla, un objeto como clave y valor. */
export function human(data) {
  if (data === null || data === undefined) return '(empty)';
  if (typeof data === 'string') return stripTerminal(data);
  if (Array.isArray(data)) {
    if (data.every((r) => r && typeof r === 'object')) return table(data);
    return data.map(cell).join('\n');
  }
  if (typeof data === 'object') {
    const lists = Object.entries(data).filter(([, v]) => Array.isArray(v));
    const big = lists.sort((a, b) => b[1].length - a[1].length)[0];
    const rest = Object.entries(data).filter(([, v]) => !Array.isArray(v));
    if (big && big[1].every((r) => r && typeof r === 'object')) {
      const extras = rest.filter(([, v]) => scalar(v)).map(([k, v]) => `${k}: ${cell(v)}`);
      return [table(big[1]), ...(extras.length ? ['', ...extras] : [])].join('\n');
    }
    const width = Math.max(...Object.keys(data).map((k) => k.length), 1);
    return Object.entries(data)
      .map(([k, v]) => `${k.padEnd(width)}  ${cell(v)}`)
      .join('\n');
  }
  return stripTerminal(data);
}
