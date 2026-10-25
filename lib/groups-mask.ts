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

/** Enmascara las secuencias de 8 o más dígitos (con +, espacios o guiones) dentro de un texto. */
export function maskPhoneText(text: string): string {
  return String(text ?? '').replace(/\+?\d[\d\s-]{6,}\d(@[\w.]+)?/g, (m) => (m.replace(/\D/g, '').length >= 8 ? maskPhone(m) : m));
}
