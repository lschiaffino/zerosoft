import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-send-tour',
  date: '2026-11-21',
  title: {
    en: 'A guided tour of Send the first time you open it',
    es: 'Un tour guiado de Send la primera vez que lo abrís',
    pt: 'Um tour guiado do Send na primeira vez que você abre',
  },
  items: [
    {
      product: 'send',
      en: 'The first time you open Send after signing up, a short tour highlights the main parts one at a time: uploading a document, spaces, analytics, and then, inside a document, making a link to share it and seeing who read it and for how long. With a team it also shows who in the workspace sees the document. You can go back, skip a step, leave with Esc or turn off all tours. Take it again from your account menu, and turn tours back on in Settings › Appearance.',
      es: 'La primera vez que abrís Send después de crear tu cuenta, un tour corto resalta las partes principales de a una: subir un documento, los espacios, la analítica y, ya dentro de un documento, armar un link para compartirlo y ver quién lo leyó y cuánto tiempo. Con un equipo muestra también quién del workspace ve el documento. Podés volver atrás, saltear un paso, salir con Esc o apagar todos los tours. Lo volvés a ver desde el menú de tu cuenta y los tours se vuelven a prender en Ajustes › Apariencia.',
      pt: 'Na primeira vez que você abre o Send depois de criar a conta, um tour curto destaca as partes principais uma de cada vez: enviar um documento, os espaços, as análises e, já dentro de um documento, criar um link para compartilhar e ver quem leu e por quanto tempo. Com uma equipe mostra também quem do workspace vê o documento. Dá para voltar, pular uma etapa, sair com Esc ou desligar todos os tours. Refaça pelo menu da sua conta e ligue os tours de novo em Ajustes › Aparência.',
    },
  ],
} satisfies ChangelogEntry;
