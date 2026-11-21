/**
 * Social: sugerencias de #hashtags y @menciones para el compositor, sacadas de
 * lo que el equipo ya escribió (las publicaciones que la persona ve, con sus
 * textos por red y primeros comentarios) y de los grupos de hashtags de la
 * biblioteca. Sin llamar a ninguna red: no busca cuentas en la red.
 */
import { listLibrary, listPosts, type SocialActor } from './social';
import { countTags, type SocialTagSuggestions } from './social-tag-match';

export type { SocialTagSuggestions };

export async function socialTagSuggestions(actor: SocialActor): Promise<SocialTagSuggestions> {
  const [posts, sets] = await Promise.all([listPosts(actor, { limit: 500 }), listLibrary(actor, 'hashtags')]);
  const texts: string[] = [];
  for (const p of posts) {
    texts.push(p.text);
    if (p.firstComment) texts.push(p.firstComment);
    for (const t of p.targets) if (t.textOverride) texts.push(t.textOverride);
  }
  for (const s of sets) texts.push(s.body);
  return countTags(texts);
}
