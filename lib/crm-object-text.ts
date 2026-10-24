/**
 * Nombre de un objeto propio en medio de una frase ("No vehicles yet",
 * "Todavía no hay vehículos"): primera letra en minúscula, salvo siglas o
 * nombres que ya traen mayúsculas adentro ("API keys", "SKUs", "iPhones").
 */
export function midSentence(word: string, locale = 'en'): string {
  const w = word.trim();
  if (w.length < 2) return w;
  const first = w.split(/\s+/)[0];
  if (/\p{Lu}/u.test(first.slice(1))) return w;
  return w.charAt(0).toLocaleLowerCase(locale) + w.slice(1);
}
