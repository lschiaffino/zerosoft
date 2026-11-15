import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-ai-write-fallback',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: writing with AI works again',
    es: 'Inbox y Lines: escribir con IA vuelve a andar',
    pt: 'Inbox e Lines: escrever com IA volta a funcionar',
  },
  items: [
    {
      product: 'inbox',
      en: '"Describe your message" and "Suggest a reply" were failing with "AI couldn\'t write this": the model spent its whole answer thinking and returned nothing. It now answers directly, and if a model still fails, another one takes over without you noticing.',
      es: '"Describí tu mensaje" y "Sugerir una respuesta" fallaban con "La IA no pudo escribir esto": el modelo se gastaba la respuesta pensando y no devolvía nada. Ahora responde directo, y si un modelo igual falla, sigue otro sin que lo notes.',
      pt: '"Descreva sua mensagem" e "Sugerir uma resposta" falhavam com "A IA não conseguiu escrever isto": o modelo gastava a resposta pensando e não devolvia nada. Agora responde direto, e se um modelo ainda falhar, outro assume sem você perceber.',
    },
    {
      product: 'groups',
      en: 'The same fix applies to writing with AI in Lines.',
      es: 'Lo mismo al escribir con IA en Lines.',
      pt: 'O mesmo vale para escrever com IA no Lines.',
    },
  ],
} satisfies ChangelogEntry;
