/**
 * Groups: máscara de teléfonos (puro, lo usan el servidor y los tests).
 * Deja el código de país y los dos últimos dígitos: "+54 ••• 00".
 */
export function maskPhone(raw: string): string {
  const d = String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 4) return '•••';
  return `+${d.slice(0, 2)} ••• ${d.slice(-2)}`;
}

/** Secuencias que pueden ser un teléfono: 8 o más dígitos con +, espacios o guiones. */
const PHONE_RUN = /\+?\d[\d\s-]{6,}\d(@[\w.]+)?/g;

/** Enmascara las secuencias de 8 o más dígitos (con +, espacios o guiones) dentro de un texto. */
export function maskPhoneText(text: string): string {
  return String(text ?? '').replace(PHONE_RUN, (m) => (m.replace(/\D/g, '').length >= 8 ? maskPhone(m) : m));
}

/**
 * Lo que guarda alguien que ve los teléfonos enmascarados: el texto que editó
 * llega con "+54 ••• 00" donde el original tenía el número. Cada teléfono
 * enmascarado que sigue en el texto vuelve a su número original (en orden);
 * lo demás queda como lo escribió. Así editar una nota no borra los números
 * que esa persona no ve, y tampoco se los muestra.
 */
export function unmaskEdit(original: string, edited: string): string {
  const out = String(edited ?? '');
  if (!out.includes('•••')) return out;
  const byMask = new Map<string, string[]>();
  for (const m of String(original ?? '').match(PHONE_RUN) ?? []) {
    if (m.replace(/\D/g, '').length < 8) continue;
    const k = maskPhone(m);
    byMask.set(k, [...(byMask.get(k) ?? []), m]);
  }
  let text = out;
  for (const [k, originals] of byMask) {
    const parts = text.split(k);
    text = parts[0];
    for (let i = 1; i < parts.length; i++) text += (originals[i - 1] ?? k) + parts[i];
  }
  return text;
}
