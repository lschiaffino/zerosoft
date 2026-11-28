/**
 * CRM: las opciones de Lifecycle stage y Lead status del workspace para la IA
 * (asistente y propuestas tras una llamada), con los nombres en el idioma del
 * pedido: las de fábrica traducidas, las renombradas y las propias con su
 * nombre. Solo las activas se ofrecen; una archivada no se propone. Puro salvo
 * aiOptionHelpers (lee la base). Server-only.
 */
import en from '@/messages/en/crm.json';
import es from '@/messages/es/crm.json';
import pt from '@/messages/pt/crm.json';
import {
  BUILTIN_OPTIONS,
  listOptionSets,
  optionHelpers,
  type LabeledOption,
  type OptionHelpers,
  type OptionProperty,
} from './crm-property-options';

type Locale = 'en' | 'es' | 'pt';

const ENUMS: Record<Locale, Record<string, Record<string, string>>> = { en: en.enums, es: es.enums, pt: pt.enums };
const ARCHIVED: Record<Locale, string> = {
  en: en.propertyOptions.archivedName,
  es: es.propertyOptions.archivedName,
  pt: pt.propertyOptions.archivedName,
};

function pickLocale(locale: string | null | undefined): Locale {
  return locale === 'es' || locale === 'pt' ? locale : 'en';
}

/** Las opciones del workspace con sus nombres en ese idioma. */
export async function aiOptionHelpers(ws: string, locale: string | null | undefined): Promise<OptionHelpers> {
  const loc = pickLocale(locale);
  return optionHelpers(
    await listOptionSets(ws),
    (prop, v) => ENUMS[loc][prop]?.[v] ?? v,
    (label) => ARCHIVED[loc].replace('{name}', () => label),
  );
}

/** Opciones de fábrica (clave = nombre), para quien no tiene las del workspace a mano. */
export function builtinChoices(prop: OptionProperty): LabeledOption[] {
  return BUILTIN_OPTIONS[prop].map((value) => ({ value, label: value, archived: false }));
}

/**
 * La opción activa que nombra un texto del modelo: por clave o por nombre, sin
 * mayúsculas ni espacios de más. También "Nombre (clave)" o "(clave)", por si
 * el modelo copia la entrada entera de la lista. null si no es ninguna (o es
 * una archivada).
 */
export function matchChoice(choices: readonly LabeledOption[], raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  const active = choices.filter((c) => !c.archived);
  const byKey = (k: string) => active.find((c) => c.value.toLowerCase() === k);
  const hit = byKey(v) ?? active.find((c) => c.label.trim().toLowerCase() === v);
  if (hit) return hit.value;
  const paren = /\(\s*([a-z0-9_]{1,40})\s*\)\s*$/.exec(v);
  return paren ? (byKey(paren[1])?.value ?? null) : null;
}

/**
 * Las opciones activas para un prompt, como JSON (`[{"name":…,"key":…}]`): los
 * nombres los pone un admin y pueden llevar comas, barras o paréntesis; así no
 * rompen la lista ni se leen como instrucciones.
 */
export function choicesForPrompt(choices: readonly LabeledOption[]): string {
  return JSON.stringify(choices.filter((c) => !c.archived).map((c) => ({ name: c.label, key: c.value })));
}
