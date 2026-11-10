/**
 * Calls: metodologías de venta para el scorecard. Cada criterio tiene una clave
 * estable y una guía para el modelo (en inglés: es el prompt). Las etiquetas
 * que ve la persona salen de messages/<locale>/calls.json (methodology.<clave>).
 */
import type { Methodology } from './types';

export interface Criterion {
  key: string;
  /** Nombre corto en inglés (prompt y export). */
  name: string;
  guide: string;
}

export const METHODOLOGY_CRITERIA: Record<Exclude<Methodology, 'custom'>, Criterion[]> = {
  spiced: [
    { key: 'situation', name: 'Situation', guide: 'Did the rep learn the customer context: team, current process, tools, numbers?' },
    { key: 'pain', name: 'Pain', guide: 'Did the rep uncover a concrete problem and why it matters now?' },
    { key: 'impact', name: 'Impact', guide: 'Was the business impact quantified (money, time, risk) or at least described?' },
    { key: 'critical_event', name: 'Critical event', guide: 'Is there a date or event that forces a decision (renewal, launch, deadline)?' },
    { key: 'decision', name: 'Decision', guide: 'Did the rep learn who decides, how, with which criteria and steps?' },
  ],
  meddic: [
    { key: 'metrics', name: 'Metrics', guide: 'Quantified gains the customer expects.' },
    { key: 'economic_buyer', name: 'Economic buyer', guide: 'Was the person with budget authority identified or present?' },
    { key: 'decision_criteria', name: 'Decision criteria', guide: 'What the customer will judge vendors on.' },
    { key: 'decision_process', name: 'Decision process', guide: 'Steps, people and dates until signature.' },
    { key: 'identify_pain', name: 'Identify pain', guide: 'A clear pain tied to a business outcome.' },
    { key: 'champion', name: 'Champion', guide: 'Someone inside who sells for us and has influence.' },
  ],
  bant: [
    { key: 'budget', name: 'Budget', guide: 'Is there budget, or a way to get it?' },
    { key: 'authority', name: 'Authority', guide: 'Who signs, and are they involved?' },
    { key: 'need', name: 'Need', guide: 'Is the need clear and urgent?' },
    { key: 'timeline', name: 'Timeline', guide: 'When do they want to decide and start?' },
  ],
};

export function criteriaFor(methodology: Methodology, custom: string[]): Criterion[] {
  if (methodology !== 'custom') return METHODOLOGY_CRITERIA[methodology];
  return custom
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((name, i) => ({ key: `c${i + 1}`, name: name.slice(0, 80), guide: `How well did the rep cover: ${name.slice(0, 200)}?` }));
}
