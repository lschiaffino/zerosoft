import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-talk-tour',
  date: '2026-11-21',
  title: {
    en: 'A guided tour of Talk the first time you open it',
    es: 'Un tour guiado de Talk la primera vez que lo abrís',
    pt: 'Um tour guiado do Talk na primeira vez que você abre',
  },
  items: [
    {
      product: 'talk',
      en: 'The first time you open Talk after signing up, a short tour highlights the main parts one at a time: channels, direct messages, the message box, threads and search. On a phone it walks through the list and skips the message box. You can go back, skip a step, leave with Esc or turn off all tours. Take it again from your account menu, and turn tours back on in Settings › Appearance.',
      es: 'La primera vez que abrís Talk después de crear tu cuenta, un tour corto resalta las partes principales de a una: los canales, los mensajes directos, el cuadro para escribir, los hilos y la búsqueda. En el teléfono recorre la lista y saltea el cuadro para escribir. Podés volver atrás, saltear un paso, salir con Esc o apagar todos los tours. Lo volvés a ver desde el menú de tu cuenta y los tours se vuelven a prender en Ajustes › Apariencia.',
      pt: 'Na primeira vez que você abre o Talk depois de criar a conta, um tour curto destaca as partes principais uma de cada vez: os canais, as mensagens diretas, a caixa de mensagem, as threads e a busca. No celular ele percorre a lista e pula a caixa de mensagem. Dá para voltar, pular uma etapa, sair com Esc ou desligar todos os tours. Refaça pelo menu da sua conta e ligue os tours de novo em Ajustes › Aparência.',
    },
  ],
} satisfies ChangelogEntry;
