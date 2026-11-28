import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-track-inbox-panel-projects',
  date: '2026-11-28',
  title: {
    en: 'Track: projects and initiatives open next to the inbox',
    es: 'Track: projects e iniciativas se abren al lado de la bandeja',
    pt: 'Track: projects e iniciativas abrem ao lado da caixa de entrada',
  },
  items: [
    {
      product: 'track',
      en: 'Notifications about a project or an initiative (updates, reminders, comments and mentions) now open in the panel next to the inbox, like issue notifications: the list stays where it was, J and K move the panel along, and Esc or the close button go back. A link at the top opens the full page. On screens between 1024 and 1599 px, an issue opened in the panel shows its properties under the title instead of after the activity, and the inbox filter bar keeps Clear on one line.',
      es: 'Los avisos de un project o una iniciativa (updates, recordatorios, comentarios y menciones) ahora se abren en el panel al lado de la bandeja, como los de un issue: la lista queda donde estaba, J y K mueven el panel y Esc o la cruz vuelven. Arriba tenés un link a la página completa. En pantallas de 1024 a 1599 px, un issue abierto en el panel muestra sus propiedades debajo del título y no después de la actividad, y en la barra de filtros de la bandeja Limpiar queda en un renglón.',
      pt: 'Os avisos de um project ou de uma iniciativa (updates, lembretes, comentários e menções) agora abrem no painel ao lado da caixa de entrada, como os de um issue: a lista fica onde estava, J e K movem o painel e Esc ou o X voltam. No topo há um link para a página completa. Em telas de 1024 a 1599 px, um issue aberto no painel mostra as propriedades abaixo do título e não depois da atividade, e na barra de filtros da caixa de entrada Limpar fica em uma linha.',
    },
  ],
} satisfies ChangelogEntry;
