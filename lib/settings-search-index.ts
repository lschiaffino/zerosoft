/**
 * Arma el índice de la búsqueda de Ajustes a partir del registro y de los
 * mensajes de los tres idiomas. Puro (los mensajes llegan como objetos): lo
 * usan el servidor (lib/settings-search-server.ts) y los tests.
 */
import { PRODUCT_CONFIG } from './products';
import { anchorOf, type MsgRef, type SettingDef, type SettingsLocale } from './settings-registry';
import { fold, type SettingsSearchItem } from './settings-search';

export const SETTINGS_LOCALES: SettingsLocale[] = ['en', 'es', 'pt'];

/** messages[locale][archivo] = el JSON de messages/<locale>/<archivo>.json. */
export type MessagesByLocale = Record<SettingsLocale, Record<string, unknown>>;

/** Archivos de mensajes que usa el registro. */
export function registryFiles(defs: SettingDef[]): string[] {
  const files = new Set<string>(['settings']);
  for (const d of defs) for (const ref of [d.title, d.desc, d.page, d.kwRef]) if (ref) files.add(ref.split(':')[0]);
  return [...files];
}

/** El texto crudo de una clave, o undefined si no existe (o no es un texto). */
export function rawMessage(messages: Record<string, unknown>, ref: MsgRef): string | undefined {
  const [file, path] = ref.split(':') as [string, string];
  let cur: unknown = messages[file];
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * ICU mínimo para un rótulo: `{x}` toma el parámetro (o se borra), un plural
 * o select toma su rama `other`, y se sacan las etiquetas (`<code>`) y los
 * paréntesis que quedaron vacíos: "Members ({count})" → "Members".
 */
export function plainMessage(text: string, params: Record<string, string> = {}): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '{') {
      out += ch;
      i++;
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    const inner = text.slice(i + 1, j);
    const [name, kind] = inner.split(',').map((x) => x.trim());
    if (kind === 'plural' || kind === 'select' || kind === 'selectordinal') {
      const m = /other\s*\{/.exec(inner);
      if (m) {
        let d = 0;
        let k = m.index + m[0].length - 1;
        const start = k + 1;
        for (; k < inner.length; k++) {
          if (inner[k] === '{') d++;
          else if (inner[k] === '}' && --d === 0) break;
        }
        out += plainMessage(inner.slice(start, k), params).replace(/#/g, '');
      }
    } else {
      out += params[name] ?? '';
    }
    i = j + 1;
  }
  return out
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,:;])/g, '$1')
    .trim();
}

export interface IndexContext {
  locale: SettingsLocale;
  messages: MessagesByLocale;
  /** Nombre del workspace para los rótulos que lo nombran ("Invite people to {workspace}"). */
  workspace?: string;
}

function text(ctx: IndexContext, locale: SettingsLocale, ref: MsgRef | undefined, params: Record<string, string> = {}): string {
  if (!ref) return '';
  const raw = rawMessage(ctx.messages[locale], ref);
  return raw === undefined ? '' : plainMessage(raw, { workspace: ctx.workspace ?? '', ...params });
}

/** Un ajuste del registro, con sus textos en el idioma de la persona y las palabras de los otros idiomas. */
export function indexItem(def: SettingDef, ctx: IndexContext): SettingsSearchItem {
  const { locale } = ctx;
  const others = SETTINGS_LOCALES.filter((l) => l !== locale);
  const title = text(ctx, locale, def.title, def.params);
  const desc = text(ctx, locale, def.desc, def.params) || undefined;
  const settingsWord = text(ctx, locale, 'settings:title');
  const product = def.area === 'platform' ? undefined : def.area;
  const areaLabel = product ? PRODUCT_CONFIG[product].name : settingsWord;
  const crumbs = [areaLabel];
  if (product && !def.id.startsWith('product-')) crumbs.push(settingsWord);
  const page = text(ctx, locale, def.page);
  if (page && page !== title) crumbs.push(page);
  const kwFor = (l: SettingsLocale) => [def.kw?.[l], def.kwRef ? text(ctx, l, def.kwRef) : ''].filter(Boolean).join(', ');
  return {
    id: def.id,
    href: def.href,
    anchor: anchorOf(def),
    title,
    desc,
    crumbs,
    area: def.area,
    areaLabel,
    product,
    terms: {
      title: fold(title),
      titleOther: others.map((l) => fold(text(ctx, l, def.title, def.params))),
      kw: fold(kwFor(locale)),
      kwOther: fold(others.map(kwFor).join(', ')),
      desc: fold(desc ?? ''),
      crumbs: fold(crumbs.join(' ')),
    },
  };
}

/**
 * El índice de una lista de ajustes. Una página entera que se llama igual que
 * un ajuste de esa misma página (Perfil › "Perfil") no se repite: queda el
 * ajuste, que además se marca al llegar.
 */
export function buildSettingsIndex(defs: SettingDef[], ctx: IndexContext): SettingsSearchItem[] {
  const items = defs.map((d) => indexItem(d, ctx)).filter((i) => i.title);
  const anchored = new Set(items.filter((i) => i.anchor).map((i) => `${i.href}\n${i.terms.title}`));
  return items.filter((i) => i.anchor || !anchored.has(`${i.href}\n${i.terms.title}`));
}
