import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-flow-tour',
  date: '2026-11-22',
  title: {
    en: 'A guided tour of Flow the first time you open it',
    es: 'Un tour guiado de Flow la primera vez que lo abrís',
    pt: 'Um tour guiado do Flow na primeira vez que você abre',
  },
  items: [
    {
      product: 'flow',
      en: 'The first time you open Flow after signing up, a short tour highlights the main parts one at a time: creating a flow, the templates, the run history and your credentials. If you already have a flow, open it and the tour continues in the editor with the trigger, adding steps and testing it. You can go back, skip a step, leave with Esc or turn off all tours. Take it again from your account menu, and turn tours back on in Settings › Appearance.',
      es: 'La primera vez que abrís Flow después de crear tu cuenta, un tour corto resalta las partes principales de a una: crear un flow, las plantillas, el historial y tus credenciales. Si ya tenés un flow, lo abrís y el tour sigue en el editor con el disparador, cómo sumar pasos y cómo probarlo. Podés volver atrás, saltear un paso, salir con Esc o apagar todos los tours. Lo volvés a ver desde el menú de tu cuenta y los tours se vuelven a prender en Ajustes › Apariencia.',
      pt: 'Na primeira vez que você abre o Flow depois de criar a conta, um tour curto destaca as partes principais uma de cada vez: criar um flow, os modelos, o histórico e suas credenciais. Se você já tem um flow, abra e o tour continua no editor com o gatilho, como adicionar passos e como testar. Dá para voltar, pular uma etapa, sair com Esc ou desligar todos os tours. Refaça pelo menu da sua conta e ligue os tours de novo em Ajustes › Aparência.',
    },
  ],
} satisfies ChangelogEntry;
