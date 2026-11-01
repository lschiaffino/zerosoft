// Parser de argumentos sin dependencias, y los alias `zerosoft crm contacts list`.

const BOOLEAN_FLAGS = new Set(['json', 'help', 'h', 'device', 'read-only', 'confirm', 'no-open', 'version']);

/** --a b, --a=b, --flag, -h; lo que no empieza con guion queda como posicional. "--" corta. */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const add = (k, v) => {
    if (k in flags) flags[k] = Array.isArray(flags[k]) ? [...flags[k], v] : [flags[k], v];
    else flags[k] = v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) add(a.slice(2, eq), a.slice(eq + 1));
      // --json a secas pide salida JSON; --json '{...}' es la entrada de la operación.
      else if (a === '--json' && /^\s*\{/.test(argv[i + 1] ?? '')) flags.json = argv[++i];
      else if (BOOLEAN_FLAGS.has(a.slice(2))) flags[a.slice(2)] = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) add(a.slice(2), argv[++i]);
      else flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

/** Un valor de flag: número, booleano, null o JSON si lo parece; si no, texto. */
export function flagValue(raw) {
  if (Array.isArray(raw)) return raw.map(flagValue);
  if (typeof raw !== 'string') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw) && String(Number(raw)) === raw) return Number(raw);
  if (/^[[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Nombre de la app en la CLI → primer segmento del id de las operaciones. */
const APP_ALIASES = { cal: 'calendar', calendar: 'calendar', link: 'links', links: 'links', board: 'boards', boards: 'boards' };

const normalize = (t) => String(t).replace(/-/g, '_').toLowerCase();

/**
 * Ids a probar para `crm deals get abc`, del más largo al más corto: los
 * tokens que sobran son parámetros de path. Con la versión v1 como segunda
 * opción (`track issues create` existe en v1, no como ruta interna plana).
 */
export function aliasCandidates(tokens) {
  const out = [];
  const parts = tokens.map(normalize);
  if (APP_ALIASES[parts[0]]) parts[0] = APP_ALIASES[parts[0]];
  for (let n = parts.length; n >= 1; n--) {
    const head = parts.slice(0, n).join('.');
    const rest = tokens.slice(n);
    out.push({ id: head, rest });
    out.push({ id: `v1.${head}`, rest });
  }
  return out;
}
