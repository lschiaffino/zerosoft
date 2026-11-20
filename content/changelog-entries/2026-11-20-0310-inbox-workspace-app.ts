import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0310-inbox-workspace-app',
  date: '2026-11-20',
  title: {
    en: 'Inbox can be turned off and restricted in Workspace apps, like every other app',
    es: 'Inbox se puede apagar y restringir en Apps del workspace, como cualquier otra app',
    pt: 'O Inbox pode ser desligado e restrito em Apps do workspace, como qualquer outro app',
  },
  items: [
    {
      product: 'inbox',
      en: 'In Settings › Workspace apps the Inbox row was always on for everyone and only had the star. Now it has the same controls as the other apps: the On switch, who can use it (everyone, some people or teams, only admins) and per-person exceptions. It stays on for everyone unless an admin changes it. Turned off or not allowed for a person, Inbox leaves the app switcher, home, search and the assistant, its pages show the "turned off in this workspace" notice on home, and its API answers 403 like any app that is off. Messages keep arriving and stay saved, so nothing is lost when it is turned back on.',
      es: 'En Ajustes › Apps del workspace la fila de Inbox estaba siempre activada para todos y solo tenía la estrella. Ahora tiene los mismos controles que las demás apps: el interruptor, quién la usa (todos, algunas personas o equipos, solo admins) y las excepciones por persona. Sigue activada para todos salvo que un admin la cambie. Apagada o sin permiso para una persona, Inbox sale del menú de apps, el inicio, la búsqueda y el asistente, sus páginas muestran en el inicio el aviso de app apagada en el workspace y su API responde 403 como cualquier app apagada. Los mensajes siguen llegando y quedan guardados: al volver a prenderla no se perdió nada.',
      pt: 'Em Ajustes › Apps do workspace a linha do Inbox estava sempre ativada para todos e só tinha a estrela. Agora tem os mesmos controles que os outros apps: o interruptor, quem usa (todos, algumas pessoas ou equipes, só admins) e as exceções por pessoa. Continua ativado para todos a menos que um admin mude. Desligado ou sem permissão para uma pessoa, o Inbox sai do menu de apps, do início, da busca e do assistente, suas páginas mostram no início o aviso de app desligado no workspace e sua API responde 403 como qualquer app desligado. As mensagens continuam chegando e ficam salvas: ao ligar de novo nada se perdeu.',
    },
  ],
} satisfies ChangelogEntry;
