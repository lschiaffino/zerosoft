/**
 * Identificador de un team como Linear: tres letras derivadas del nombre
 * ("Mobile App" → MOB, "Design" → DES) que prefijan los IDs (MOB-12). Si ya
 * existe, se prueban otras letras del nombre y después un dígito. En la base
 * va en minúsculas (track_projects.slug).
 */

function letters(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();
}

/** Claves candidatas en orden de preferencia (todas de 2 a 5 caracteres, [a-z0-9]). */
export function teamKeyCandidates(name: string): string[] {
  const clean = letters(name);
  const words = clean.split(/\s+/).filter(Boolean);
  const flat = words.join('');
  if (!flat) return ['team', 'tea', 'tm'];
  const out: string[] = [];
  const add = (k: string) => {
    if (k.length >= 2 && k.length <= 5 && /^[a-z0-9]+$/.test(k) && !out.includes(k)) out.push(k);
  };
  add(flat.slice(0, 3));
  // Iniciales de las palabras ("Customer Success Team" → CST).
  if (words.length >= 2) add(words.map((w) => w[0]).join('').slice(0, 3));
  // Primera letra y otras consonantes/letras del nombre: MBL, MOL…
  const rest = flat.slice(1);
  for (let i = 0; i < rest.length && out.length < 8; i++) {
    for (let j = i + 1; j < rest.length && out.length < 8; j++) add(`${flat[0]}${rest[i]}${rest[j]}`);
  }
  if (flat.length < 3) add(flat);
  add(flat.slice(0, 4));
  for (let d = 2; d <= 9; d++) add(`${flat.slice(0, 3)}${d}`);
  return out;
}

/** Normaliza lo que tipea la persona (mob, MOB, "mo b") a la forma guardada. Null si no sirve. */
export function normalizeTeamKey(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/\s+/g, '');
  return /^[a-z0-9]{1,5}$/.test(k) ? k : null;
}
