/**
 * Notes — plantillas de fábrica (client-safe): un subconjunto de las de Docs
 * que tiene sentido para notas personales. Se arman en el navegador con ids
 * nuevos en cada uso.
 */
import { getDocTemplates, type DocTemplate } from './docs-templates';

export const NOTE_BUILTIN_TEMPLATE_KEYS = ['meeting', 'oneOnOne', 'todo', 'journal', 'weekly', 'reading', 'brief', 'decision', 'bug'] as const;

export function getNoteBuiltinTemplates(locale: string): DocTemplate[] {
  const all = getDocTemplates(locale);
  return NOTE_BUILTIN_TEMPLATE_KEYS.map((k) => all.find((t) => t.key === k)).filter((t): t is DocTemplate => Boolean(t));
}

export function getNoteBuiltinTemplate(locale: string, key: string): DocTemplate | null {
  return getNoteBuiltinTemplates(locale).find((t) => t.key === key) ?? null;
}
