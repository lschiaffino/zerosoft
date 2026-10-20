/**
 * Agents — temas de las conversaciones sin pasar por un modelo. Cada
 * conversación aporta sus palabras clave (sin stopwords en en/es/pt, sin
 * tildes y con el plural simple plegado); se arma de a un tema por vez con la
 * palabra que aparece en más conversaciones todavía sin tema (greedy, como
 * un clustering por keyword). Puro: lo usa la pestaña Analítica.
 */

const STOPWORDS = new Set(
  `a about after again all also am an and any are as at be because been before being but by can could did do does doing
  done for from get got had has have having he her here hers him his how i if in into is it its just know like me more
  most my need no not now of off on once only or other our out over please really same she should so some still such
  than that the their them then there these they this those through to too under until up us very want was way we were
  what when where which while who why will with would yes you your hi hello hey thanks thank ok okay good morning
  afternoon evening day help question ask asking tell

  al algo algun alguna alguno algunos ante antes aqui asi aun bien buen buena buenas buenos cada como con cual cuando
  de del desde donde el ella ellas ellos en entre era eres es esa ese eso esta estan estar este esto estos estoy fue
  gracias ha hacer hay hola la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o otra otro para pero
  poco por porque puedo puede pueden que quiero quisiera saber se sea ser si sin sobre solo son soy su sus tambien
  tengo tiene tienen todo todos tu tus un una uno unos usted ustedes ya favor consulta pregunta necesito dia tarde
  noche

  ao aos as com da das de dele dela do dos ela ele eles em essa esse isso esta estou eu foi ha mais mas meu minha muito
  na nao nas no nos num numa obrigado obrigada oi ola ou para pela pelo pode por porque posso preciso qual quando que
  quero se sem ser seu sua tem tenho tudo um uma voce voces bom boa dia`
    .split(/\s+/)
    .filter(Boolean),
);

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Raíz simple: "precios" → "precio", "prices" → "price" (solo la s final). */
function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Palabras clave de un texto: raíz → forma en que apareció. */
export function topicKeywords(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    const root = stem(raw);
    if (STOPWORDS.has(root)) continue;
    if (!out.has(root)) out.set(root, raw);
  }
  return out;
}

export interface TopicDoc {
  text: string;
  handedOff: boolean;
}

export interface Topic {
  /** Palabra que define el tema (la forma más usada). */
  keyword: string;
  count: number;
  handoffs: number;
  /** Hasta tres textos de ejemplo. */
  examples: string[];
}

export interface TopicClusters {
  topics: Topic[];
  /** Conversaciones sin tema (texto vacío o palabras que no se repiten). */
  other: number;
}

export function clusterTopics(docs: TopicDoc[], opts: { max?: number; minCount?: number } = {}): TopicClusters {
  const max = opts.max ?? 8;
  const minCount = Math.max(1, opts.minCount ?? 2);
  const keyed = docs.map((d) => ({ doc: d, words: topicKeywords(d.text) }));
  let remaining = keyed.filter((k) => k.words.size > 0);
  let other = keyed.length - remaining.length;
  const topics: Topic[] = [];

  while (topics.length < max && remaining.length > 0) {
    const df = new Map<string, number>();
    for (const r of remaining) for (const root of r.words.keys()) df.set(root, (df.get(root) ?? 0) + 1);
    let best: string | null = null;
    let bestCount = 0;
    for (const [root, n] of df) {
      if (n > bestCount || (n === bestCount && best !== null && root < best)) {
        best = root;
        bestCount = n;
      }
    }
    if (!best || bestCount < minCount) break;
    const members = remaining.filter((r) => r.words.has(best));
    const forms = new Map<string, number>();
    for (const m of members) {
      const form = m.words.get(best) as string;
      forms.set(form, (forms.get(form) ?? 0) + 1);
    }
    const keyword = [...forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    topics.push({
      keyword,
      count: members.length,
      handoffs: members.filter((m) => m.doc.handedOff).length,
      examples: members.slice(0, 3).map((m) => m.doc.text.replace(/\s+/g, ' ').trim().slice(0, 80)),
    });
    remaining = remaining.filter((r) => !r.words.has(best));
  }
  other += remaining.length;
  return { topics, other };
}
