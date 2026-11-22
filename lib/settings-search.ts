/**
 * Búsqueda de Ajustes (como la de Ajustes del Mac): tipeás palabras de un
 * ajuste y te lleva a la página, baja hasta el ajuste y lo marca un momento.
 *
 * Este archivo es puro (sin React ni servidor): los tipos del índice que llega
 * al navegador, el matcher y el agrupado. El registro de ajustes está en
 * lib/settings-registry.ts y el índice por persona (textos en los tres idiomas,
 * filtrado por rol y apps) lo arma lib/settings-search-server.ts.
 */

/** Prefijo del hash que pide marcar un ajuste: /app/settings/appearance#setting-appearance-theme. */
export const SETTING_HASH_PREFIX = '#setting-';
/** Evento de window para marcar un ajuste cuando la navegación no cambia la ruta (mismo ?tab=). */
export const SETTING_FOCUS_EVENT = 'zs:setting-focus';

export function settingHref(href: string, anchor: string | null): string {
  return anchor ? `${href}${SETTING_HASH_PREFIX}${anchor}` : href;
}

/** El ancla de un hash (#setting-appearance-theme → appearance-theme), o null. */
export function anchorFromHash(hash: string): string | null {
  if (!hash.startsWith(SETTING_HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(SETTING_HASH_PREFIX.length));
  return /^[a-z0-9-]+$/.test(id) ? id : null;
}

/** Un ajuste del índice, ya en el idioma de la persona (más las palabras de los otros dos). */
export interface SettingsSearchItem {
  id: string;
  /** Ruta sin locale, con su ?tab= si hace falta. */
  href: string;
  /** Valor de `data-setting` en la página, o null si el resultado es la página entera. */
  anchor: string | null;
  title: string;
  desc?: string;
  /** Migas: área › página (el título va aparte). */
  crumbs: string[];
  /** Área para agrupar ("platform" o la app). */
  area: string;
  areaLabel: string;
  product?: string;
  /** Textos para buscar, en minúsculas y sin tildes. */
  terms: SearchTerms;
}

export interface SearchTerms {
  /** Título en el idioma de la persona. */
  title: string;
  /** Título en los otros idiomas. */
  titleOther: string[];
  /** Palabras clave (sinónimos) en el idioma de la persona. */
  kw: string;
  /** Palabras clave en los otros idiomas. */
  kwOther: string;
  desc: string;
  crumbs: string;
}

/** Minúsculas y sin tildes: "Contraseña" encuentra "contrasena". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function words(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean);
}

/** Distancia de edición con transposiciones (Damerau, versión restringida), cortando en `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** Errores tolerados según el largo de la palabra tipeada: ninguno bajo 4 letras, uno hasta 7, dos desde 8. */
function typoBudget(len: number): number {
  return len < 4 ? 0 : len < 8 ? 1 : 2;
}

/**
 * Qué tan bien una palabra tipeada encuentra un texto: 1 palabra exacta, 0.9
 * comienzo de palabra, 0.55 dentro de una palabra (desde 3 letras), 0.5 con un
 * error de tipeo (contra la palabra entera o su comienzo), 0 nada.
 */
export function tokenScore(token: string, text: string): number {
  if (!text) return 0;
  const ws = words(text);
  let best = 0;
  for (const w of ws) {
    if (w === token) return 1;
    if (w.startsWith(token)) best = Math.max(best, 0.9);
    else if (token.length >= 3 && w.includes(token)) best = Math.max(best, 0.55);
  }
  if (best > 0) return best;
  const budget = typoBudget(token.length);
  if (!budget) return 0;
  for (const w of ws) {
    if (w.length < 3) continue;
    if (editDistance(token, w, budget) <= budget) return 0.5;
    // "apariencai" contra el comienzo de "apariencia": mismo largo.
    if (w.length > token.length && editDistance(token, w.slice(0, token.length), budget) <= budget) return 0.45;
  }
  return 0;
}

/** Peso de cada campo: título > palabras clave > migas > descripción; el idioma de la persona primero. */
const FIELD_WEIGHTS: Array<[keyof SearchTerms, number]> = [
  ['title', 4],
  ['kw', 3],
  ['titleOther', 2.6],
  ['kwOther', 2.2],
  ['crumbs', 1.5],
  ['desc', 1],
];

/** Puntaje de un ajuste para la búsqueda (0 si alguna palabra no aparece en ningún lado). */
export function scoreItem(item: Pick<SettingsSearchItem, 'terms'>, query: string): number {
  const tokens = words(query);
  if (!tokens.length) return 0;
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [field, weight] of FIELD_WEIGHTS) {
      const value = item.terms[field];
      const texts = Array.isArray(value) ? value : [value];
      for (const text of texts) best = Math.max(best, tokenScore(token, text) * weight);
    }
    if (best === 0) return 0;
    total += best;
  }
  // La frase entera al comienzo del título (o de una palabra clave) sube arriba de todo.
  const phrase = tokens.join(' ');
  const title = words(item.terms.title).join(' ');
  if (title.startsWith(phrase)) total += 3;
  else if (title.includes(phrase)) total += 1.5;
  const kw = item.terms.kw.split(',').map((k) => words(k).join(' '));
  if (kw.some((k) => k.startsWith(phrase))) total += 1.5;
  else if (item.terms.kwOther.split(',').some((k) => words(k).join(' ').startsWith(phrase))) total += 1;
  // Un ajuste puntual le gana a la página que lo contiene cuando empatan.
  return total;
}

export interface SettingsSearchHit {
  item: SettingsSearchItem;
  score: number;
}

/** Ajustes que encuentran la búsqueda, del mejor al peor (empates: el orden del registro). */
export function searchSettings(items: SettingsSearchItem[], query: string, limit = 40): SettingsSearchHit[] {
  if (!words(query).length) return [];
  return items
    .map((item, i) => ({ item, score: scoreItem(item, query), i }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.item.anchor !== null) - Number(a.item.anchor !== null) || a.i - b.i)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}

export interface SettingsSearchGroup {
  area: string;
  label: string;
  product?: string;
  hits: SettingsSearchHit[];
}

/** Agrupa por área en el orden del mejor resultado de cada una (como Ajustes del Mac). */
export function groupHits(hits: SettingsSearchHit[]): SettingsSearchGroup[] {
  const groups: SettingsSearchGroup[] = [];
  for (const hit of hits) {
    let g = groups.find((x) => x.area === hit.item.area);
    if (!g) {
      g = { area: hit.item.area, label: hit.item.areaLabel, product: hit.item.product, hits: [] };
      groups.push(g);
    }
    g.hits.push(hit);
  }
  return groups;
}

/** Migas para mostrar: "Lines › Tickets". */
export function crumbText(item: Pick<SettingsSearchItem, 'crumbs'>): string {
  return item.crumbs.join(' › ');
}

/** Ruta actual sin el locale, con su query (/app/lines/settings?tab=tickets). */
function currentAppPath(): string {
  return `${window.location.pathname.replace(/^\/(en|es|pt)(?=\/|$)/, '')}${window.location.search}`;
}

/**
 * Navega a un ajuste (href con #setting-<ancla>) y pide marcarlo. Si la ruta
 * cambia, lo marca SettingHighlighter al terminar de cargar la página nueva
 * (lee el hash); si es la misma página, el evento lo marca ya.
 */
export function navigateToSetting(push: (href: string, scroll: boolean) => void, href: string): void {
  const at = href.indexOf('#');
  // Con un ajuste, el scroll lo hace SettingHighlighter: el de Next (scrollIntoView del segmento o del
  // hash) también movía contenedores con overflow oculto del marco y dejaba un hueco arriba de la banda.
  push(href, at < 0);
  const target = at < 0 ? href : href.slice(0, at);
  if (target !== currentAppPath()) {
    // Red de seguridad (como SettingsTabs): el router de Next a veces descarta la navegación suave en
    // páginas dinámicas pesadas; si no llegó, se navega de verdad (el hash sigue y marca el ajuste al cargar).
    const locale = /^\/(en|es|pt)(?=\/|$)/.exec(window.location.pathname)?.[1];
    window.setTimeout(() => {
      if (currentAppPath() !== target) window.location.assign(`${locale ? `/${locale}` : ''}${href}`);
    }, 3000);
  }
  if (at < 0) return;
  const anchor = anchorFromHash(href.slice(at));
  if (!anchor || target !== currentAppPath()) return;
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(SETTING_FOCUS_EVENT, { detail: { anchor } })), 0);
}
