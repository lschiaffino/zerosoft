import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-hiring-tour',
  date: '2026-11-22',
  title: {
    en: 'A guided tour of Hiring the first time you open it',
    es: 'Un tour guiado de Hiring la primera vez que lo abrís',
    pt: 'Um tour guiado do Hiring na primeira vez que você abre',
  },
  items: [
    {
      product: 'hiring',
      en: 'The first time you open Hiring after signing up, a short tour highlights the main parts one at a time: creating a job, open jobs and their pipeline (adding candidates and moving them between stages), your pending scorecards, the latest candidates, the candidates list, reports, templates and Hiring settings. Creating a job shows up only for those who can, scorecards only in a team and settings only for admins. You can go back, skip a step, leave with Esc or turn off all tours. Take it again from your account menu, and turn tours back on in Settings › Appearance.',
      es: 'La primera vez que abrís Hiring después de crear tu cuenta, un tour corto resalta las partes principales de a una: crear un puesto, los puestos abiertos y su pipeline (sumar candidatos y moverlos de etapa), tus scorecards pendientes, el último movimiento, la lista de candidatos, los reportes, las plantillas y los ajustes de Hiring. Crear un puesto aparece solo para quien puede, las scorecards solo en equipo y los ajustes solo para quien administra. Podés volver atrás, saltear un paso, salir con Esc o apagar todos los tours. Lo volvés a ver desde el menú de tu cuenta y los tours se vuelven a prender en Ajustes › Apariencia.',
      pt: 'Na primeira vez que você abre o Hiring depois de criar a conta, um tour curto destaca as partes principais uma de cada vez: criar uma vaga, as vagas abertas e o pipeline (adicionar candidatos e movê-los de etapa), seus scorecards pendentes, o último movimento, a lista de candidatos, os relatórios, os modelos e os ajustes do Hiring. Criar uma vaga aparece só para quem pode, os scorecards só em equipe e os ajustes só para quem administra. Dá para voltar, pular uma etapa, sair com Esc ou desligar todos os tours. Refaça pelo menu da sua conta e ligue os tours de novo em Ajustes › Aparência.',
    },
  ],
} satisfies ChangelogEntry;
