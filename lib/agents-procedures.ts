/**
 * Agents — procedimientos de varios pasos (como Fin Procedures). El motor es
 * determinista y no habla con el modelo: los pasos corren en orden, en
 * secuencia, y solo se frena en un paso que espera al visitante.
 *
 * Pasos:
 * - message: dice un texto (con {{variable}}).
 * - ask: pregunta y espera; valida la respuesta (email, teléfono, número u
 *   opción de los botones) y la guarda en `field`. Una respuesta inválida
 *   vuelve a preguntar; a la tercera se sale del procedimiento.
 * - form: muestra un formulario del agente y espera los valores.
 * - branch: si la condición se cumple salta a `goto`, si no sigue.
 * - action: corre una herramienta del agente (con sus aprobaciones, su
 *   registro y la simulación del playground) y guarda el resultado.
 * - handoff: deriva a una persona. end: termina (con un mensaje opcional).
 *
 * El estado (procedimiento, paso, variables) vive en
 * agent_conversations.procedure_state. Si el visitante escribe "cancelar" (o
 * stop, salir…) el procedimiento termina y el agente sigue normalmente.
 * Sin dependencias de base: el que llama pasa `callTool`.
 */
import type {
  AgentForm,
  AgentProcedure,
  AgentProcedureStep,
  AgentReplyUi,
} from './agents-config';
import { buttonsUi, formUi, parseFormText, validateFormSubmission } from './agents-ui-blocks';

export interface AgentProcedureState {
  procedureId: string;
  stepId: string;
  /** El paso actual ya preguntó y espera la respuesta del visitante. */
  awaiting: boolean;
  vars: Record<string, unknown>;
  retries: number;
  startedAt: string;
}

export interface ProcedureTurnInput {
  procedure: AgentProcedure;
  forms: AgentForm[];
  /** null = empieza desde el primer paso. */
  state: AgentProcedureState | null;
  /** Lo que escribió el visitante (la respuesta al paso que esperaba). */
  text: string;
  /** Valores de un formulario enviado (si el visitante envió uno). */
  formValues?: Record<string, string> | null;
  callTool: (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  now?: Date;
}

export interface ProcedureTurnResult {
  /** null = el procedimiento terminó (o se canceló). */
  state: AgentProcedureState | null;
  messages: string[];
  ui: AgentReplyUi | null;
  handoff: string | null;
  /** El visitante canceló: el agente responde ese mensaje como siempre. */
  cancelled: boolean;
  /** Pasos ejecutados en este turno (para el registro de la corrida). */
  steps: number;
}

const MAX_STEPS_PER_TURN = 40;
/** Acciones (herramientas) por turno: un procedimiento no dispara una ráfaga de llamadas. */
export const MAX_ACTIONS_PER_TURN = 5;
const MAX_RETRIES = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANCEL_RE = /^\s*(cancel|cancelar|cancela|stop|salir|sair|parar|quit|exit)\s*[.!]*\s*$/i;

export function isCancelMessage(text: string): boolean {
  return CANCEL_RE.test(text);
}

export function parseProcedureState(raw: string | null | undefined): AgentProcedureState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AgentProcedureState>;
    if (typeof v?.procedureId !== 'string' || typeof v.stepId !== 'string') return null;
    return {
      procedureId: v.procedureId,
      stepId: v.stepId,
      awaiting: v.awaiting === true,
      vars: v.vars && typeof v.vars === 'object' ? (v.vars as Record<string, unknown>) : {},
      retries: Number(v.retries) || 0,
      startedAt: typeof v.startedAt === 'string' ? v.startedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Valor de una variable, con camino por puntos dentro de un resultado ("order.status"). */
export function readVar(vars: Record<string, unknown>, path: string): unknown {
  let cur: unknown = vars;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Reemplaza {{variable}} (y {{resultado.campo}}) por su valor. */
export function renderTemplate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]{0,80})\s*\}\}/g, (_m, path: string) => asText(readVar(vars, path)).slice(0, 2000));
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').trim().toLowerCase();
}

export function evalCondition(cond: NonNullable<AgentProcedureStep['condition']>, vars: Record<string, unknown>): boolean {
  const raw = readVar(vars, cond.field);
  const value = asText(raw);
  const target = renderTemplate(cond.value, vars);
  switch (cond.op) {
    case 'exists':
      return value.trim() !== '' && raw !== false && raw !== null;
    case 'missing':
      return value.trim() === '' || raw === null || raw === undefined;
    case 'equals':
      return norm(value) === norm(target);
    case 'not_equals':
      return norm(value) !== norm(target);
    case 'contains':
      return norm(value).includes(norm(target));
    case 'gt':
    case 'lt': {
      const a = Number(value.replace(',', '.'));
      const b = Number(target.replace(',', '.'));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return cond.op === 'gt' ? a > b : a < b;
    }
  }
}

/** Valida y normaliza la respuesta a un paso "ask". null = no sirve. */
export function validateAnswer(step: AgentProcedureStep, text: string): string | null {
  const v = text.replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!v) return null;
  switch (step.answerType) {
    case 'email': {
      const m = /[^\s@<>()[\]{},;:"']+@[^\s@<>()[\]{},;:"']+\.[^\s@<>()[\]{},;:"'.]+/.exec(v);
      const email = m?.[0]?.toLowerCase() ?? '';
      return EMAIL_RE.test(email) ? email : null;
    }
    case 'phone': {
      const m = /\+?\d[\d\s().-]{5,20}\d/.exec(v);
      if (!m) return null;
      const digits = m[0].replace(/[^\d+]/g, '');
      return digits.replace(/\D/g, '').length >= 6 ? digits : null;
    }
    case 'number': {
      const m = /-?\d+(?:[.,]\d+)?/.exec(v);
      return m ? m[0].replace(',', '.') : null;
    }
    case 'choice': {
      if (step.options.length === 0) return v;
      const n = /^(\d{1,2})[).]?$/.exec(v);
      if (n && step.options[Number(n[1]) - 1]) return step.options[Number(n[1]) - 1];
      return step.options.find((o) => norm(o) === norm(v)) ?? null;
    }
    default:
      return v;
  }
}

/** Frase para volver a preguntar, en el idioma más probable del visitante. */
function retryPrefix(text: string): string {
  const t = norm(text);
  if (/\b(ola|obrigad|voce|nao|quero)\b/.test(t)) return 'Não entendi. ';
  if (/\b(hola|gracias|quiero|necesito|tengo|si|no)\b/.test(t) || /[ñ¿¡]/.test(text)) return 'No lo entendí. ';
  return 'Sorry, I didn’t get that. ';
}

function indexOfStep(p: AgentProcedure, id: string): number {
  return p.steps.findIndex((s) => s.id === id);
}

/**
 * Corre un turno del procedimiento: consume la respuesta que se esperaba (si
 * había) y ejecuta pasos hasta el próximo que espera al visitante, una
 * derivación o el final.
 */
export async function runProcedureTurn(input: ProcedureTurnInput): Promise<ProcedureTurnResult> {
  const { procedure: p } = input;
  const now = (input.now ?? new Date()).toISOString();
  const messages: string[] = [];
  let ui: AgentReplyUi | null = null;
  let steps = 0;
  const done = (state: AgentProcedureState | null, extra: Partial<ProcedureTurnResult> = {}): ProcedureTurnResult => ({
    state,
    messages,
    ui,
    handoff: null,
    cancelled: false,
    steps,
    ...extra,
  });

  let state: AgentProcedureState = input.state ?? {
    procedureId: p.id,
    stepId: p.steps[0]?.id ?? '',
    awaiting: false,
    vars: {},
    retries: 0,
    startedAt: now,
  };
  let i = indexOfStep(p, state.stepId);
  // El paso ya no existe (editaron el procedimiento): se sale y el agente sigue normalmente.
  if (i < 0) return done(null, { cancelled: true });

  // Respuesta a lo que se preguntó.
  if (input.state?.awaiting) {
    if (isCancelMessage(input.text) && !input.formValues) return done(null, { cancelled: true });
    const step = p.steps[i];
    let answer: string | null = null;
    let formValues: Record<string, string> | null = null;
    if (step.kind === 'ask') {
      answer = validateAnswer(step, input.text);
    } else if (step.kind === 'form') {
      const form = input.forms.find((f) => f.id === step.formId);
      // Enviado desde el formulario, o escrito como "Campo: valor" (canales de solo texto, widget de Chat).
      const sub = validateFormSubmission(form, input.formValues ?? parseFormText(form, input.text));
      if (sub.ok) {
        formValues = sub.values;
        answer = sub.text;
      }
    }
    if (answer === null) {
      if (state.retries >= MAX_RETRIES) return done(null, { cancelled: true });
      state = { ...state, retries: state.retries + 1 };
      const question = step.kind === 'ask' ? renderTemplate(step.text, state.vars) : renderTemplate(step.text || '', state.vars);
      messages.push(`${retryPrefix(input.text)}${question}`.trim());
      if (step.kind === 'ask' && step.options.length) ui = buttonsUi(step.options);
      if (step.kind === 'form') {
        const form = input.forms.find((f) => f.id === step.formId);
        if (form) ui = formUi(form);
      }
      return done(state);
    }
    const vars = { ...state.vars };
    if (step.kind === 'form' && formValues) {
      if (step.field) vars[step.field] = formValues;
      Object.assign(vars, formValues);
    } else if (step.field) {
      vars[step.field] = answer;
    }
    state = { ...state, vars, awaiting: false, retries: 0 };
    i += 1;
  }

  let actions = 0;
  // Un ciclo sin pasos que esperen al visitante: se corta y deriva (sin mandar los mensajes repetidos).
  const loop = () => {
    messages.length = 0;
    ui = null;
    return done(null, { handoff: 'procedure_loop' });
  };
  while (i < p.steps.length) {
    if (++steps > MAX_STEPS_PER_TURN) return loop();
    const step = p.steps[i];
    state = { ...state, stepId: step.id };
    switch (step.kind) {
      case 'message': {
        const text = renderTemplate(step.text, state.vars).trim();
        if (text) messages.push(text);
        i += 1;
        break;
      }
      case 'ask': {
        const text = renderTemplate(step.text, state.vars).trim();
        if (text) messages.push(text);
        if (step.options.length) ui = buttonsUi(step.options);
        return done({ ...state, awaiting: true, retries: 0 });
      }
      case 'form': {
        const form = input.forms.find((f) => f.id === step.formId);
        if (!form) {
          i += 1;
          break;
        }
        const text = renderTemplate(step.text, state.vars).trim();
        if (text) messages.push(text);
        ui = formUi(form);
        return done({ ...state, awaiting: true, retries: 0 });
      }
      case 'branch': {
        const target = step.condition && step.goto && evalCondition(step.condition, state.vars) ? indexOfStep(p, step.goto) : -1;
        i = target >= 0 ? target : i + 1;
        break;
      }
      case 'action': {
        if (++actions > MAX_ACTIONS_PER_TURN) return loop();
        if (step.tool) {
          const args: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(step.args)) {
            const rendered = renderTemplate(v, state.vars);
            // Un argumento que es solo {{x}} pasa el valor tal cual (número, objeto).
            const whole = /^\{\{\s*([a-zA-Z][a-zA-Z0-9_.]{0,80})\s*\}\}$/.exec(v.trim());
            args[k] = whole ? (readVar(state.vars, whole[1]) ?? rendered) : rendered;
          }
          let out: Record<string, unknown>;
          try {
            out = await input.callTool(step.tool, args);
          } catch {
            out = { error: 'tool_failed' };
          }
          const vars = { ...state.vars };
          if (step.field) vars[step.field] = out;
          vars.lastError = typeof out?.error === 'string' ? out.error : '';
          state = { ...state, vars };
        }
        i += 1;
        break;
      }
      case 'handoff': {
        const text = renderTemplate(step.text, state.vars).trim();
        return done(null, { handoff: text || `procedure: ${p.name}` });
      }
      case 'end': {
        const text = renderTemplate(step.text, state.vars).trim();
        if (text) messages.push(text);
        return done(null);
      }
    }
  }
  return done(null);
}

/** Procedimiento que arranca por palabra clave en el mensaje (sin pasar por el modelo). */
export function procedureByKeyword(procedures: AgentProcedure[], text: string): AgentProcedure | null {
  const t = norm(text);
  if (!t) return null;
  return procedures.find((p) => p.keywords.some((k) => t.includes(norm(k)))) ?? null;
}

export type ProcedureIssueCode = 'bad_goto' | 'ask_needs_field' | 'tool_off' | 'form_missing' | 'branch_needs_condition' | 'duplicate_id' | 'loop';

/**
 * Problemas de un procedimiento que el editor muestra antes de guardar: saltos
 * a pasos que no existen, preguntas sin variable, acciones sin herramienta
 * activa, formularios que no existen.
 */
export function procedureIssues(
  p: AgentProcedure,
  ctx: { enabledTools: string[]; formIds: string[] },
): Array<{ stepId: string; code: ProcedureIssueCode }> {
  const out: Array<{ stepId: string; code: ProcedureIssueCode }> = [];
  const ids = new Set<string>();
  for (const s of p.steps) {
    if (ids.has(s.id)) out.push({ stepId: s.id, code: 'duplicate_id' });
    ids.add(s.id);
  }
  for (const s of p.steps) {
    if (s.kind === 'ask' && !s.field) out.push({ stepId: s.id, code: 'ask_needs_field' });
    if (s.kind === 'branch' && (!s.condition || !s.goto)) out.push({ stepId: s.id, code: 'branch_needs_condition' });
    if (s.kind === 'branch' && s.goto && !ids.has(s.goto)) out.push({ stepId: s.id, code: 'bad_goto' });
    if (s.kind === 'action' && (!s.tool || !ctx.enabledTools.includes(s.tool))) out.push({ stepId: s.id, code: 'tool_off' });
    if (s.kind === 'form' && (!s.formId || !ctx.formIds.includes(s.formId))) out.push({ stepId: s.id, code: 'form_missing' });
  }
  // Un salto hacia atrás sin un paso que espere al visitante en el medio da vueltas sin fin.
  p.steps.forEach((s, i) => {
    if (s.kind !== 'branch' || !s.goto) return;
    const j = p.steps.findIndex((x) => x.id === s.goto);
    if (j < 0 || j > i) return;
    const waits = p.steps.slice(j, i + 1).some((x) => x.kind === 'ask' || x.kind === 'form');
    if (!waits) out.push({ stepId: s.id, code: 'loop' });
  });
  return out;
}
