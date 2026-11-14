import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-robots-check',
  date: '2026-11-14',
  title: {
    en: 'Robots: a step to check or uncheck boxes',
    es: 'Robots: un paso para marcar o desmarcar casillas',
    pt: 'Robôs: um passo para marcar ou desmarcar caixas',
  },
  items: [
    {
      product: 'robots',
      en: 'The new Check or uncheck step leaves a checkbox or radio button in the state you choose, so a robot that fills a form no longer needs a click that flips it by accident when it is already set.',
      es: 'El nuevo paso Marcar o desmarcar deja una casilla o un radio en el estado que elijas, así un robot que completa un formulario ya no necesita un clic que la invierte por error cuando ya estaba como queríamos.',
      pt: 'O novo passo Marcar ou desmarcar deixa uma caixa ou um rádio no estado que você escolher, então um robô que preenche um formulário não precisa mais de um clique que inverte o campo por engano quando ele já está como queremos.',
    },
  ],
} satisfies ChangelogEntry;
