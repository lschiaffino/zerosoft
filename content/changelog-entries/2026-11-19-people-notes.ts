import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-people-notes',
  date: '2026-11-19',
  title: {
    en: 'People: private notes on a profile for HR and managers',
    es: 'People: notas privadas en la ficha para HR y managers',
    pt: 'People: notas privadas no perfil para o RH e os gestores',
  },
  items: [
    {
      product: 'people',
      en: 'A new Notes tab on each profile keeps agreements, talks and anything HR needs to remember about a person. HR and the person\'s managers read and write them; the person never sees the tab. Each note shows who wrote it and when. Its author can edit it, and the author or HR can delete it. Ctrl+Enter or Cmd+Enter saves. Reading and changing notes goes to the access log, and deleting the profile deletes its notes.',
      es: 'Una pestaña Notas nueva en cada ficha guarda acuerdos, charlas y lo que HR tenga que recordar de una persona. Las leen y escriben HR y los managers de esa persona; ella nunca ve la pestaña. Cada nota muestra quién la escribió y cuándo. Su autor la puede editar, y la puede borrar su autor o HR. Ctrl+Enter o Cmd+Enter guarda. Leer y cambiar notas queda en el registro de accesos, y borrar la ficha borra sus notas.',
      pt: 'Uma nova aba Notas em cada perfil guarda acordos, conversas e o que o RH precisa lembrar sobre uma pessoa. O RH e os gestores da pessoa leem e escrevem; ela nunca vê a aba. Cada nota mostra quem a escreveu e quando. O autor pode editá-la, e o autor ou o RH podem excluí-la. Ctrl+Enter ou Cmd+Enter salva. Ler e alterar notas fica no registro de acessos, e excluir o perfil exclui as notas.',
    },
  ],
} satisfies ChangelogEntry;
