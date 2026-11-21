import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-1230-social-duplicate-post',
  date: '2026-11-21',
  title: {
    en: 'Social: duplicate a post',
    es: 'Social: duplicar una publicación',
    pt: 'Social: duplicar uma publicação',
  },
  items: [
    {
      product: 'social',
      en: 'A post now has a Duplicate button. It creates a draft with the same text, media, first comment, link and per-network texts, without a date, and opens it for editing. The original stays as it was. Accounts you no longer have access to are left out of the copy.',
      es: 'Ahora una publicación tiene el botón Duplicar. Crea un borrador con el mismo texto, medios, primer comentario, link y textos por red, sin fecha, y lo abre para editarlo. La original queda como estaba. Las cuentas a las que ya no tenés acceso no entran en la copia.',
      pt: 'Agora uma publicação tem o botão Duplicar. Ele cria um rascunho com o mesmo texto, mídia, primeiro comentário, link e textos por rede, sem data, e o abre para edição. A original continua como estava. Contas às quais você não tem mais acesso ficam fora da cópia.',
    },
  ],
} satisfies ChangelogEntry;
