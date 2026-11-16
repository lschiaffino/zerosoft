/**
 * Texto plano de un mensaje ICU sin argumentos, para quien lee los JSON de
 * messages/ sin pasar por next-intl (por ejemplo la spec OpenAPI). En ICU
 * `{`, `}`, `<` y `>` se escriben entre apóstrofos ('{{name}}', '<key>') y
 * `''` es un apóstrofo; un apóstrofo suelto ("it's") queda como está.
 */
export function icuPlainText(message: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch !== "'") {
      out += ch;
      continue;
    }
    const next = message[i + 1];
    if (next === "'") {
      out += "'";
      i++;
    } else if (quoted) {
      quoted = false;
    } else if (next === '{' || next === '}' || next === '<' || next === '>') {
      quoted = true;
    } else {
      out += "'";
    }
  }
  return out;
}
