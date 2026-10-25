/**
 * Docs — plantillas built-in. Viven en código (no en DB): cada una define
 * título, icono y bloques iniciales. Contenido localizado por idioma.
 */
import type { DbProperty, DbViewConfig, DocsBlock, DocsDatabase } from './docs-types';
import { defaultStatusOptions, newDbId } from './docs-database';

/** Secciones de la galería de plantillas. */
export type DocTemplateCategory = 'basic' | 'personal' | 'work' | 'product' | 'engineering';
export const DOC_TEMPLATE_CATEGORIES: DocTemplateCategory[] = ['basic', 'personal', 'work', 'product', 'engineering'];

export interface DocTemplate {
  key: string;
  category: DocTemplateCategory;
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
  /** Una función cuando la plantilla trae una base (ids nuevos en cada uso). */
  seeds: BlockSeed[] | (() => BlockSeed[]);
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

// ---------- Galería (tanda D1) ----------

const h = (level: 1 | 2 | 3, content: string): BlockSeed => ({ type: 'heading', level, content });
const p = (content: string): BlockSeed => ({ type: 'paragraph', content });
const todo = (content = ''): BlockSeed => ({ type: 'todo', content, checked: false });
const li = (content = ''): BlockSeed => ({ type: 'bulleted_list_item', content });
const ol = (content = ''): BlockSeed => ({ type: 'numbered_list_item', content });
const callout = (content: string, icon = '💡'): BlockSeed => ({ type: 'callout', content, icon });
const toggle = (content: string): BlockSeed => ({ type: 'toggle', content });
const child = (seed: BlockSeed, indent = 1): BlockSeed => ({ ...seed, indent });
const divider: BlockSeed = { type: 'divider', content: '' };
const toc: BlockSeed = { type: 'toc', content: '' };
/** Dos columnas, cada una con sus bloques. */
function columns(...cols: BlockSeed[][]): BlockSeed[] {
  const out: BlockSeed[] = [{ type: 'columns', content: '' }];
  for (const c of cols) {
    out.push({ type: 'column', content: '', indent: 1, ratio: 1 });
    for (const b of c) out.push({ ...b, indent: 2 + (b.indent ?? 0) });
  }
  return out;
}

interface DbLabels {
  name: string;
  status: string;
  statuses: [string, string, string];
  extra: Array<{ name: string; type: DbProperty['type']; options?: string[] }>;
  view: DbViewConfig['type'];
  title?: string;
}

/** Base nueva para una plantilla (sin filas de ejemplo: la persona las carga). */
function makeDb(l: DbLabels): BlockSeed {
  const now = new Date().toISOString();
  const title: DbProperty = { id: newDbId(), name: l.name, type: 'title' };
  const status: DbProperty = {
    id: newDbId(),
    name: l.status,
    type: 'status',
    options: defaultStatusOptions({ notStarted: l.statuses[0], inProgress: l.statuses[1], done: l.statuses[2] }),
  };
  const extra: DbProperty[] = l.extra.map((x) => ({
    id: newDbId(),
    name: x.name,
    type: x.type,
    ...(x.options ? { options: x.options.map((name) => ({ id: newDbId(), name })) } : {}),
  }));
  const view: DbViewConfig = { id: newDbId(), name: '', type: l.view, ...(l.view === 'board' ? { group_by: status.id } : {}) };
  const db: DocsDatabase = {
    properties: [title, status, ...extra],
    rows: [{ id: newDbId(), values: {}, created_at: now, updated_at: now }],
    views: [view],
    active_view: view.id,
    ...(l.title ? { title: l.title } : {}),
  };
  return { type: 'database', content: '', db };
}

const TODO: Record<string, TemplateCopy> = {
  en: { title: 'To-do list', description: 'Today, this week and later.', seeds: [h(2, 'Today'), todo(), h(2, 'This week'), todo(), h(2, 'Later'), todo()] },
  es: { title: 'Lista de tareas', description: 'Hoy, esta semana y más adelante.', seeds: [h(2, 'Hoy'), todo(), h(2, 'Esta semana'), todo(), h(2, 'Más adelante'), todo()] },
  pt: { title: 'Lista de tarefas', description: 'Hoje, esta semana e depois.', seeds: [h(2, 'Hoje'), todo(), h(2, 'Esta semana'), todo(), h(2, 'Depois'), todo()] },
};

const WEEKLY: Record<string, TemplateCopy> = {
  en: { title: 'Weekly plan', description: 'Priorities, notes and one list per day.', seeds: [...columns([h(3, 'Priorities'), ol()], [h(3, 'Notes'), p('')]), divider, toggle('Monday'), child(todo()), toggle('Tuesday'), child(todo()), toggle('Wednesday'), child(todo()), toggle('Thursday'), child(todo()), toggle('Friday'), child(todo())] },
  es: { title: 'Plan semanal', description: 'Prioridades, notas y una lista por día.', seeds: [...columns([h(3, 'Prioridades'), ol()], [h(3, 'Notas'), p('')]), divider, toggle('Lunes'), child(todo()), toggle('Martes'), child(todo()), toggle('Miércoles'), child(todo()), toggle('Jueves'), child(todo()), toggle('Viernes'), child(todo())] },
  pt: { title: 'Plano semanal', description: 'Prioridades, notas e uma lista por dia.', seeds: [...columns([h(3, 'Prioridades'), ol()], [h(3, 'Notas'), p('')]), divider, toggle('Segunda'), child(todo()), toggle('Terça'), child(todo()), toggle('Quarta'), child(todo()), toggle('Quinta'), child(todo()), toggle('Sexta'), child(todo())] },
};

const JOURNAL: Record<string, TemplateCopy> = {
  en: { title: 'Journal', description: 'A daily entry: highlights, gratitude and tomorrow.', seeds: [h(2, 'Highlights'), li(), h(2, 'Grateful for'), li(), h(2, 'Tomorrow'), todo()] },
  es: { title: 'Diario', description: 'Una entrada por día: lo destacado, gratitud y mañana.', seeds: [h(2, 'Lo destacado'), li(), h(2, 'Agradezco'), li(), h(2, 'Mañana'), todo()] },
  pt: { title: 'Diário', description: 'Uma entrada por dia: destaques, gratidão e amanhã.', seeds: [h(2, 'Destaques'), li(), h(2, 'Sou grato por'), li(), h(2, 'Amanhã'), todo()] },
};

const READING: Record<string, TemplateCopy> = {
  en: { title: 'Reading list', description: 'Books and articles as a gallery.', seeds: () => [makeDb({ name: 'Title', status: 'Status', statuses: ['To read', 'Reading', 'Finished'], extra: [{ name: 'Author', type: 'text' }, { name: 'Link', type: 'url' }], view: 'gallery', title: 'Reading list' })] },
  es: { title: 'Lista de lectura', description: 'Libros y artículos en una galería.', seeds: () => [makeDb({ name: 'Título', status: 'Estado', statuses: ['Por leer', 'Leyendo', 'Terminado'], extra: [{ name: 'Autor', type: 'text' }, { name: 'Link', type: 'url' }], view: 'gallery', title: 'Lista de lectura' })] },
  pt: { title: 'Lista de leitura', description: 'Livros e artigos em uma galeria.', seeds: () => [makeDb({ name: 'Título', status: 'Status', statuses: ['Para ler', 'Lendo', 'Terminado'], extra: [{ name: 'Autor', type: 'text' }, { name: 'Link', type: 'url' }], view: 'gallery', title: 'Lista de leitura' })] },
};

const PROJECT: Record<string, TemplateCopy> = {
  en: { title: 'Project plan', description: 'Goals, milestones and a task database.', seeds: () => [callout('One sentence on what this project delivers and why.', '🎯'), toc, h(2, 'Goals'), li(), h(2, 'Milestones'), ol(), h(2, 'Tasks'), makeDb({ name: 'Task', status: 'Status', statuses: ['Not started', 'In progress', 'Done'], extra: [{ name: 'Owner', type: 'person' }, { name: 'Due', type: 'date' }], view: 'table', title: 'Tasks' }), h(2, 'Risks'), li()] },
  es: { title: 'Plan de proyecto', description: 'Objetivos, hitos y una base de tareas.', seeds: () => [callout('Una oración sobre qué entrega este proyecto y por qué.', '🎯'), toc, h(2, 'Objetivos'), li(), h(2, 'Hitos'), ol(), h(2, 'Tareas'), makeDb({ name: 'Tarea', status: 'Estado', statuses: ['Sin empezar', 'En curso', 'Hecho'], extra: [{ name: 'Responsable', type: 'person' }, { name: 'Vence', type: 'date' }], view: 'table', title: 'Tareas' }), h(2, 'Riesgos'), li()] },
  pt: { title: 'Plano de projeto', description: 'Objetivos, marcos e uma base de tarefas.', seeds: () => [callout('Uma frase sobre o que este projeto entrega e por quê.', '🎯'), toc, h(2, 'Objetivos'), li(), h(2, 'Marcos'), ol(), h(2, 'Tarefas'), makeDb({ name: 'Tarefa', status: 'Status', statuses: ['Não iniciado', 'Em andamento', 'Feito'], extra: [{ name: 'Responsável', type: 'person' }, { name: 'Prazo', type: 'date' }], view: 'table', title: 'Tarefas' }), h(2, 'Riscos'), li()] },
};

const WIKI: Record<string, TemplateCopy> = {
  en: { title: 'Team wiki', description: 'Home page for a team: contents, how we work and tools.', seeds: [callout('Start here. This page links to everything the team keeps up to date.', '👋'), toc, h(2, 'About the team'), p(''), h(2, 'How we work'), ...columns([h(3, 'Rituals'), li()], [h(3, 'Channels'), li()]), h(2, 'Tools'), li(), h(2, 'FAQ'), toggle('Question'), child(p(''))] },
  es: { title: 'Wiki del equipo', description: 'Página de inicio de un equipo: índice, cómo trabajamos y herramientas.', seeds: [callout('Empezá acá. Esta página enlaza todo lo que el equipo mantiene al día.', '👋'), toc, h(2, 'Sobre el equipo'), p(''), h(2, 'Cómo trabajamos'), ...columns([h(3, 'Rituales'), li()], [h(3, 'Canales'), li()]), h(2, 'Herramientas'), li(), h(2, 'Preguntas frecuentes'), toggle('Pregunta'), child(p(''))] },
  pt: { title: 'Wiki do time', description: 'Página inicial de um time: sumário, como trabalhamos e ferramentas.', seeds: [callout('Comece aqui. Esta página leva a tudo o que o time mantém atualizado.', '👋'), toc, h(2, 'Sobre o time'), p(''), h(2, 'Como trabalhamos'), ...columns([h(3, 'Rituais'), li()], [h(3, 'Canais'), li()]), h(2, 'Ferramentas'), li(), h(2, 'Perguntas frequentes'), toggle('Pergunta'), child(p(''))] },
};

const ONBOARDING: Record<string, TemplateCopy> = {
  en: { title: 'Onboarding checklist', description: 'First day, first week and first month.', seeds: [p('Welcome! Work through this list with your onboarding buddy.'), toggle('First day'), child(todo('Get access to email and chat')), child(todo('Meet the team')), toggle('First week'), child(todo('Read the team wiki')), child(todo('Ship a first small change')), toggle('First month'), child(todo('Own a project')), child(todo('Share feedback on onboarding'))] },
  es: { title: 'Checklist de onboarding', description: 'Primer día, primera semana y primer mes.', seeds: [p('¡Bienvenida! Recorré esta lista con tu compañero de onboarding.'), toggle('Primer día'), child(todo('Tener acceso al email y al chat')), child(todo('Conocer al equipo')), toggle('Primera semana'), child(todo('Leer la wiki del equipo')), child(todo('Entregar un primer cambio chico')), toggle('Primer mes'), child(todo('Hacerte cargo de un proyecto')), child(todo('Contar cómo fue el onboarding'))] },
  pt: { title: 'Checklist de onboarding', description: 'Primeiro dia, primeira semana e primeiro mês.', seeds: [p('Boas-vindas! Siga esta lista com sua dupla de onboarding.'), toggle('Primeiro dia'), child(todo('Ter acesso ao email e ao chat')), child(todo('Conhecer o time')), toggle('Primeira semana'), child(todo('Ler a wiki do time')), child(todo('Entregar uma primeira mudança pequena')), toggle('Primeiro mês'), child(todo('Assumir um projeto')), child(todo('Contar como foi o onboarding'))] },
};

const ONE_ON_ONE: Record<string, TemplateCopy> = {
  en: { title: '1:1 notes', description: 'Topics from both sides and next steps.', seeds: [...columns([h(3, 'Their topics'), li()], [h(3, 'My topics'), li()]), h(2, 'Notes'), p(''), h(2, 'Next steps'), todo()] },
  es: { title: 'Notas de 1:1', description: 'Temas de cada lado y próximos pasos.', seeds: [...columns([h(3, 'Sus temas'), li()], [h(3, 'Mis temas'), li()]), h(2, 'Notas'), p(''), h(2, 'Próximos pasos'), todo()] },
  pt: { title: 'Notas de 1:1', description: 'Assuntos de cada lado e próximos passos.', seeds: [...columns([h(3, 'Assuntos dele(a)'), li()], [h(3, 'Meus assuntos'), li()]), h(2, 'Notas'), p(''), h(2, 'Próximos passos'), todo()] },
};

const BRIEF: Record<string, TemplateCopy> = {
  en: { title: 'Product brief', description: 'Problem, users, goals and requirements.', seeds: [h(2, 'Problem'), p(''), h(2, 'Who has it'), li(), h(2, 'Goals'), li(), h(2, 'Non-goals'), li(), h(2, 'Requirements'), todo(), h(2, 'Open questions'), toggle('Question'), child(p(''))] },
  es: { title: 'Brief de producto', description: 'Problema, usuarios, objetivos y requisitos.', seeds: [h(2, 'Problema'), p(''), h(2, 'Quién lo tiene'), li(), h(2, 'Objetivos'), li(), h(2, 'Fuera de alcance'), li(), h(2, 'Requisitos'), todo(), h(2, 'Preguntas abiertas'), toggle('Pregunta'), child(p(''))] },
  pt: { title: 'Brief de produto', description: 'Problema, usuários, objetivos e requisitos.', seeds: [h(2, 'Problema'), p(''), h(2, 'Quem tem'), li(), h(2, 'Objetivos'), li(), h(2, 'Fora de escopo'), li(), h(2, 'Requisitos'), todo(), h(2, 'Perguntas em aberto'), toggle('Pergunta'), child(p(''))] },
};

const ROADMAP: Record<string, TemplateCopy> = {
  en: { title: 'Roadmap', description: 'A board of initiatives by status.', seeds: () => [p('Each card is an initiative. Open it to write the details.'), makeDb({ name: 'Initiative', status: 'Status', statuses: ['Planned', 'In progress', 'Shipped'], extra: [{ name: 'Quarter', type: 'select', options: ['Q1', 'Q2', 'Q3', 'Q4'] }, { name: 'Owner', type: 'person' }], view: 'board', title: 'Roadmap' })] },
  es: { title: 'Roadmap', description: 'Un tablero de iniciativas por estado.', seeds: () => [p('Cada tarjeta es una iniciativa. Abrila para escribir el detalle.'), makeDb({ name: 'Iniciativa', status: 'Estado', statuses: ['Planeado', 'En curso', 'Lanzado'], extra: [{ name: 'Trimestre', type: 'select', options: ['T1', 'T2', 'T3', 'T4'] }, { name: 'Responsable', type: 'person' }], view: 'board', title: 'Roadmap' })] },
  pt: { title: 'Roadmap', description: 'Um quadro de iniciativas por status.', seeds: () => [p('Cada cartão é uma iniciativa. Abra para escrever os detalhes.'), makeDb({ name: 'Iniciativa', status: 'Status', statuses: ['Planejado', 'Em andamento', 'Lançado'], extra: [{ name: 'Trimestre', type: 'select', options: ['T1', 'T2', 'T3', 'T4'] }, { name: 'Responsável', type: 'person' }], view: 'board', title: 'Roadmap' })] },
};

const BUG: Record<string, TemplateCopy> = {
  en: { title: 'Bug report', description: 'Steps to reproduce, expected and actual result.', seeds: [h(2, 'Summary'), p(''), h(2, 'Steps to reproduce'), ol(), h(2, 'Expected'), p(''), h(2, 'Actual'), p(''), h(2, 'Environment'), { type: 'table', content: '', rows: [['Browser', ''], ['Version', ''], ['Device', '']] }] },
  es: { title: 'Reporte de bug', description: 'Pasos para reproducir, resultado esperado y real.', seeds: [h(2, 'Resumen'), p(''), h(2, 'Pasos para reproducir'), ol(), h(2, 'Esperado'), p(''), h(2, 'Lo que pasa'), p(''), h(2, 'Entorno'), { type: 'table', content: '', rows: [['Navegador', ''], ['Versión', ''], ['Dispositivo', '']] }] },
  pt: { title: 'Relato de bug', description: 'Passos para reproduzir, resultado esperado e real.', seeds: [h(2, 'Resumo'), p(''), h(2, 'Passos para reproduzir'), ol(), h(2, 'Esperado'), p(''), h(2, 'O que acontece'), p(''), h(2, 'Ambiente'), { type: 'table', content: '', rows: [['Navegador', ''], ['Versão', ''], ['Dispositivo', '']] }] },
};

const DECISION: Record<string, TemplateCopy> = {
  en: { title: 'Decision record', description: 'Context, options, decision and consequences.', seeds: [callout('Status: proposed', '📝'), h(2, 'Context'), p(''), h(2, 'Options'), { type: 'table', content: '', rows: [['Option', 'Pros', 'Cons'], ['', '', ''], ['', '', '']] }, h(2, 'Decision'), p(''), h(2, 'Consequences'), li()] },
  es: { title: 'Registro de decisión', description: 'Contexto, opciones, decisión y consecuencias.', seeds: [callout('Estado: propuesta', '📝'), h(2, 'Contexto'), p(''), h(2, 'Opciones'), { type: 'table', content: '', rows: [['Opción', 'A favor', 'En contra'], ['', '', ''], ['', '', '']] }, h(2, 'Decisión'), p(''), h(2, 'Consecuencias'), li()] },
  pt: { title: 'Registro de decisão', description: 'Contexto, opções, decisão e consequências.', seeds: [callout('Status: proposta', '📝'), h(2, 'Contexto'), p(''), h(2, 'Opções'), { type: 'table', content: '', rows: [['Opção', 'Prós', 'Contras'], ['', '', ''], ['', '', '']] }, h(2, 'Decisão'), p(''), h(2, 'Consequências'), li()] },
};

const TEMPLATE_DEFS: { key: string; category: DocTemplateCategory; icon: string | null; copy: Record<string, TemplateCopy> }[] = [
  { key: 'blank', category: 'basic', icon: null, copy: BLANK },
  { key: 'todo', category: 'personal', icon: null, copy: TODO },
  { key: 'weekly', category: 'personal', icon: null, copy: WEEKLY },
  { key: 'journal', category: 'personal', icon: null, copy: JOURNAL },
  { key: 'reading', category: 'personal', icon: null, copy: READING },
  { key: 'meeting', category: 'work', icon: null, copy: MEETING },
  { key: 'oneOnOne', category: 'work', icon: null, copy: ONE_ON_ONE },
  { key: 'project', category: 'work', icon: null, copy: PROJECT },
  { key: 'wiki', category: 'work', icon: null, copy: WIKI },
  { key: 'onboarding', category: 'work', icon: null, copy: ONBOARDING },
  { key: 'retro', category: 'work', icon: null, copy: RETRO },
  { key: 'brief', category: 'product', icon: null, copy: BRIEF },
  { key: 'roadmap', category: 'product', icon: null, copy: ROADMAP },
  { key: 'spec', category: 'engineering', icon: null, copy: SPEC },
  { key: 'bug', category: 'engineering', icon: null, copy: BUG },
  { key: 'decision', category: 'engineering', icon: null, copy: DECISION },
];

function pick(copy: Record<string, TemplateCopy>, locale: string): TemplateCopy {
  return copy[locale] ?? copy.en ?? Object.values(copy)[0];
}

export function getDocTemplates(locale: string): DocTemplate[] {
  return TEMPLATE_DEFS.map((def) => {
    const copy = pick(def.copy, locale);
    return {
      key: def.key,
      category: def.category,
      icon: def.icon,
      title: copy.title,
      description: copy.description,
      makeBlocks: () => blocks(typeof copy.seeds === 'function' ? copy.seeds() : copy.seeds),
    };
  });
}

export function getDocTemplate(locale: string, key: string): DocTemplate | null {
  return getDocTemplates(locale).find((tpl) => tpl.key === key) ?? null;
}
