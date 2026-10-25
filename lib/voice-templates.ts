/**
 * Plantillas de fábrica para las notas de reunión (como las de Granola):
 * qué secciones arma la IA. El nombre visible vive en messages/<locale>/voice.json
 * (templates.builtin.<key>); acá van las secciones que se le piden al modelo,
 * que las escribe en el idioma de la reunión.
 */
import { VOICE_BUILTIN_TEMPLATES, type VoiceBuiltinTemplate } from './voice-types';

export const BUILTIN_TEMPLATE_SECTIONS: Record<VoiceBuiltinTemplate, string[]> = {
  general: ['Overview', 'Discussion', 'Open questions'],
  sales: ['Context and pain', 'Requirements', 'Budget and pricing', 'Decision process and timeline', 'Objections', 'Next steps'],
  one_on_one: ['Wins', 'Blockers', 'Feedback', 'Growth and goals', 'Follow-ups'],
  standup: ['Done since last time', 'Working on next', 'Blockers'],
  interview: ['Candidate background', 'Strengths', 'Concerns', 'Answers to key questions', 'Recommendation'],
  customer: ['How they use the product', 'Problems raised', 'Feature requests', 'Sentiment', 'Follow-ups'],
};

export function isBuiltinTemplate(key: string): key is VoiceBuiltinTemplate {
  return (VOICE_BUILTIN_TEMPLATES as readonly string[]).includes(key);
}

/** Instrucciones de la plantilla para el prompt. */
export function builtinTemplateInstructions(key: VoiceBuiltinTemplate): string {
  return `Organize the notes under these headings, in this order (skip a heading only if nothing in the meeting fits it): ${BUILTIN_TEMPLATE_SECTIONS[key].join('; ')}.`;
}
