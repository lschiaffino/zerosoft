import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-voice-tour',
  date: '2026-11-21',
  title: {
    en: 'A guided tour of Voice the first time you open it',
    es: 'Un tour guiado de Voice la primera vez que lo abrís',
    pt: 'Um tour guiado do Voice na primeira vez que você abre',
  },
  items: [
    {
      product: 'voice',
      en: 'The first time you open Voice after signing up, a short tour highlights the main parts one at a time: starting a meeting, importing a recording, upcoming meetings from your calendar, asking across your meetings, folders, the list with its search, dictation and settings. On a phone it walks through the meetings page and skips the sidebar. You can go back, skip a step, leave with Esc or turn off all tours. Take it again from your account menu, and turn tours back on in Settings › Appearance.',
      es: 'La primera vez que abrís Voice después de crear tu cuenta, un tour corto resalta las partes principales de a una: empezar una reunión, importar una grabación, las próximas reuniones de tu calendario, preguntarle a tus reuniones, las carpetas, la lista con su búsqueda, el dictado y los ajustes. En el teléfono recorre la página de reuniones y saltea el lateral. Podés volver atrás, saltear un paso, salir con Esc o apagar todos los tours. Lo volvés a ver desde el menú de tu cuenta y los tours se vuelven a prender en Ajustes › Apariencia.',
      pt: 'Na primeira vez que você abre o Voice depois de criar a conta, um tour curto destaca as partes principais uma de cada vez: começar uma reunião, importar uma gravação, as próximas reuniões da sua agenda, perguntar às suas reuniões, as pastas, a lista com a busca, o ditado e as configurações. No celular ele percorre a página de reuniões e pula a barra lateral. Dá para voltar, pular uma etapa, sair com Esc ou desligar todos os tours. Refaça pelo menu da sua conta e ligue os tours de novo em Ajustes › Aparência.',
    },
  ],
} satisfies ChangelogEntry;
