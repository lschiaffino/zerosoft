/** Dictado (puro): contexto según la app de destino. */

export type DictationContext = 'email' | 'chat' | 'note' | 'other';

/** Contexto para la limpieza del texto según la app que tiene el foco. */
export function contextForApp(appName: string | null | undefined): DictationContext {
  const n = String(appName ?? '').toLowerCase();
  if (!n) return 'other';
  if (/\b(mail|outlook|gmail|spark|superhuman|thunderbird|airmail|hey)\b/.test(n)) return 'email';
  if (/\b(slack|discord|teams|whatsapp|telegram|messages|signal|messenger|zoom|wechat|line)\b/.test(n)) return 'chat';
  if (/\b(notes|notion|obsidian|bear|word|pages|docs|evernote|craft|logseq|textedit|notepad)\b/.test(n)) return 'note';
  return 'other';
}
