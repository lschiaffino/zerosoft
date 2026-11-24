import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-triage-time',
  date: '2026-11-23',
  title: {
    en: 'Track: triage time in Insights',
    es: 'Track: tiempo en triage en Insights',
    pt: 'Track: tempo na triagem nos Insights',
  },
  items: [
    {
      product: 'track',
      en: 'Insights has a new measure, Triage time, like Linear: how long issues waited in triage, from when they arrived until someone accepted, declined, marked them as duplicate or moved them to another team. It shows the median in days and can be sliced by team, priority, label or week like the other time measures. Issues count from today on: those that left triage before this change have no triage time.',
      es: 'Insights tiene una medida nueva, Tiempo en triage, como en Linear: cuánto esperaron los issues en triage, desde que llegaron hasta que alguien los aceptó, rechazó, marcó como duplicados o movió a otro team. Muestra la mediana en días y se puede cortar por team, prioridad, etiqueta o semana como las otras medidas de tiempo. Cuentan los issues desde hoy: los que salieron de triage antes de este cambio no tienen dato.',
      pt: 'Os Insights têm uma medida nova, Tempo na triagem, como no Linear: quanto tempo os issues esperaram na triagem, desde que chegaram até alguém aceitá-los, recusá-los, marcá-los como duplicados ou movê-los para outro team. Mostra a mediana em dias e pode ser dividida por team, prioridade, etiqueta ou semana como as outras medidas de tempo. Contam os issues a partir de hoje: os que saíram da triagem antes desta mudança não têm dado.',
    },
  ],
} satisfies ChangelogEntry;
