import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-pulse-tour',
  date: '2026-11-22',
  title: {
    en: 'A guided tour of Pulse the first time you open it',
    es: 'Un tour guiado de Pulse la primera vez que lo abrís',
    pt: 'Um tour guiado do Pulse na primeira vez que você abre',
  },
  items: [
    {
      product: 'pulse',
      en: 'The first time you open Pulse after signing up, a short tour highlights the main parts one at a time: creating your first project or installing the snippet, the web analytics numbers, live activity, insights and dashboards. You can go back, skip a step, leave with Esc or turn off all tours. Take it again from your account menu, and turn tours back on in Settings › Appearance.',
      es: 'La primera vez que abrís Pulse después de crear tu cuenta, un tour corto resalta las partes principales de a una: crear tu primer proyecto o instalar el snippet, los números de web analytics, la actividad en vivo, los insights y los tableros. Podés volver atrás, saltear un paso, salir con Esc o apagar todos los tours. Lo volvés a ver desde el menú de tu cuenta y los tours se vuelven a prender en Ajustes › Apariencia.',
      pt: 'Na primeira vez que você abre o Pulse depois de criar a conta, um tour curto destaca as partes principais uma de cada vez: criar seu primeiro projeto ou instalar o snippet, os números de web analytics, a atividade ao vivo, os insights e os painéis. Dá para voltar, pular uma etapa, sair com Esc ou desligar todos os tours. Refaça pelo menu da sua conta e ligue os tours de novo em Ajustes › Aparência.',
    },
  ],
} satisfies ChangelogEntry;
