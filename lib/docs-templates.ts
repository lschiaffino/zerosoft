/**
 * Docs — plantillas built-in. Viven en código (no en DB): cada una define
 * título, icono y bloques iniciales. Contenido localizado por idioma.
 */
import type { DocsBlock } from './docs-types';

export interface DocTemplate {
  key: string;
  title: string;
  /** Sin ícono: las páginas nuevas no traen emoji de fábrica (el árbol les pone un documento genérico). */
  icon: string | null;
  description: string;
  makeBlocks: () => DocsBlock[];
}

type BlockSeed = Pick<DocsBlock, 'type' | 'content'> & Partial<DocsBlock>;

function blocks(seeds: BlockSeed[]): DocsBlock[] {
  return seeds.map((seed) => ({
    id: crypto.randomUUID(),
    level: undefined,
    checked: undefined,
    language: undefined,
    rows: undefined,
    ...seed,
  }));
}

interface TemplateCopy {
  title: string;
  description: string;
  seeds: BlockSeed[];
}

const BLANK: Record<string, TemplateCopy> = {
  en: { title: '', description: 'Start from scratch.', seeds: [{ type: 'paragraph', content: '' }] },
  es: { title: '', description: 'Empezá desde cero.', seeds: [{ type: 'paragraph', content: '' }] },
  pt: { title: '', description: 'Comece do zero.', seeds: [{ type: 'paragraph', content: '' }] },
};

const MEETING: Record<string, TemplateCopy> = {
  en: {
    title: 'Meeting notes',
    description: 'Agenda, notes and action items.',
    seeds: [
      { type: 'heading', level: 2, content: 'Agenda' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Notes' },
      { type: 'paragraph', content: '' },
      { type: 'heading', level: 2, content: 'Action items' },
      { type: 'todo', content: '', checked: false },
    ],
  },
  es: {
    title: 'Notas de reunión',
    description: 'Agenda, notas y acciones.',
    seeds: [
      { type: 'heading', level: 2, content: 'Agenda' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Notas' },
      { type: 'paragraph', content: '' },
      { type: 'heading', level: 2, content: 'Acciones' },
      { type: 'todo', content: '', checked: false },
    ],
  },
  pt: {
    title: 'Notas de reunião',
    description: 'Pauta, notas e ações.',
    seeds: [
      { type: 'heading', level: 2, content: 'Pauta' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Notas' },
      { type: 'paragraph', content: '' },
      { type: 'heading', level: 2, content: 'Ações' },
      { type: 'todo', content: '', checked: false },
    ],
  },
};

const SPEC: Record<string, TemplateCopy> = {
  en: {
    title: 'Project spec',
    description: 'Problem, goals and plan.',
    seeds: [
      { type: 'heading', level: 2, content: 'Problem' },
      { type: 'paragraph', content: '' },
      { type: 'heading', level: 2, content: 'Goals' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Non-goals' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Plan' },
      { type: 'numbered_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Open questions' },
      { type: 'quote', content: '' },
    ],
  },
  es: {
    title: 'Spec de proyecto',
    description: 'Problema, objetivos y plan.',
    seeds: [
      { type: 'heading', level: 2, content: 'Problema' },
      { type: 'paragraph', content: '' },
      { type: 'heading', level: 2, content: 'Objetivos' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'No objetivos' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Plan' },
      { type: 'numbered_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Preguntas abiertas' },
      { type: 'quote', content: '' },
    ],
  },
  pt: {
    title: 'Spec de projeto',
    description: 'Problema, objetivos e plano.',
    seeds: [
      { type: 'heading', level: 2, content: 'Problema' },
      { type: 'paragraph', content: '' },
      { type: 'heading', level: 2, content: 'Objetivos' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Não objetivos' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Plano' },
      { type: 'numbered_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Perguntas abertas' },
      { type: 'quote', content: '' },
    ],
  },
};

const RETRO: Record<string, TemplateCopy> = {
  en: {
    title: 'Weekly retro',
    description: 'Went well, to improve, actions.',
    seeds: [
      { type: 'heading', level: 2, content: 'Went well' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'To improve' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Actions' },
      { type: 'todo', content: '', checked: false },
    ],
  },
  es: {
    title: 'Retro semanal',
    description: 'Lo que salió bien, a mejorar, acciones.',
    seeds: [
      { type: 'heading', level: 2, content: 'Salió bien' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'A mejorar' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Acciones' },
      { type: 'todo', content: '', checked: false },
    ],
  },
  pt: {
    title: 'Retro semanal',
    description: 'O que foi bem, a melhorar, ações.',
    seeds: [
      { type: 'heading', level: 2, content: 'Foi bem' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'A melhorar' },
      { type: 'bulleted_list_item', content: '' },
      { type: 'heading', level: 2, content: 'Ações' },
      { type: 'todo', content: '', checked: false },
    ],
  },
};

const TEMPLATE_DEFS: { key: string; icon: string | null; copy: Record<string, TemplateCopy> }[] = [
  { key: 'blank', icon: null, copy: BLANK },
  { key: 'meeting', icon: null, copy: MEETING },
  { key: 'spec', icon: null, copy: SPEC },
  { key: 'retro', icon: null, copy: RETRO },
];

function pick(copy: Record<string, TemplateCopy>, locale: string): TemplateCopy {
  return copy[locale] ?? copy.en ?? Object.values(copy)[0];
}

export function getDocTemplates(locale: string): DocTemplate[] {
  return TEMPLATE_DEFS.map((def) => {
    const copy = pick(def.copy, locale);
    return {
      key: def.key,
      icon: def.icon,
      title: copy.title,
      description: copy.description,
      makeBlocks: () => blocks(copy.seeds),
    };
  });
}

export function getDocTemplate(locale: string, key: string): DocTemplate | null {
  return getDocTemplates(locale).find((tpl) => tpl.key === key) ?? null;
}
