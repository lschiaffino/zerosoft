import { describe, expect, it } from 'vitest';
import en from '@/messages/en/crm.json';
import es from '@/messages/es/crm.json';
import pt from '@/messages/pt/crm.json';
import { ACTION_TYPES, TRIGGER_TYPES, createWorkflow, getWorkflow } from '@/lib/crm-workflows';
import {
  ACTION_GROUPS,
  TEMPLATE_KEYS,
  actionMissing,
  actionStepProblems,
  TRIGGER_GROUPS,
  buildTemplate,
  defaultActionConfig,
  isAdvancedAction,
  normalizeActionConfig,
  webhookHeadersValid,
  workflowProblems,
} from '@/lib/crm-workflow-catalog';
import { builderTabForError, fieldKeyFromLabel, localizedFormDefaults, slugFromName, uniqueFieldKey } from '@/lib/crm-forms-builder';
import { formCreateSchema } from '@/lib/crm-forms-schema';
import { CRM_SETTINGS_TABS, LEGACY_ANCHORS, crmSettingsTab } from '@/lib/crm-settings-tabs';
import { partySummary, runSummary } from '@/lib/crm-admin-format';
import { QUOTE_TONE, badgeClass } from '@/lib/crm-ui-tones';
import { QUOTE_STATUSES } from '@/lib/crm-constants';
import { makeUser } from './helpers';

const LOCALES = { en, es, pt } as Record<string, unknown>;
const get = (o: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((a, p) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[p] : undefined), o);

const COPY = { taskSubject: 'T', emailSubject: 'S', emailBody: 'B', notifyMessage: 'N', followUpSubject: 'F' };

describe('catálogo de workflows', () => {
  it('cada trigger y cada acción del motor está en exactamente un grupo', () => {
    const triggers = TRIGGER_GROUPS.flatMap((g) => g.types);
    const actions = ACTION_GROUPS.flatMap((g) => g.types);
    expect([...triggers].sort()).toEqual([...TRIGGER_TYPES].sort());
    expect([...actions].sort()).toEqual([...ACTION_TYPES].sort());
    expect(new Set(triggers).size).toBe(triggers.length);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('webhook, Flow y si/si no van en Avanzado', () => {
    expect(['webhook', 'run_flow', 'branch'].every(isAdvancedAction)).toBe(true);
    expect(isAdvancedAction('create_task')).toBe(false);
  });

  it('las plantillas arman un workflow que el motor guarda tal cual', async () => {
    const ws = await makeUser('tpl');
    for (const key of TEMPLATE_KEYS) {
      const tpl = buildTemplate(key, COPY);
      expect(workflowProblems({ name: key, triggers: [{ type: tpl.trigger }], actions: tpl.actions })).toEqual([]);
      const wf = await createWorkflow(ws.id, { name: key, triggers: [{ type: tpl.trigger }], actions: tpl.actions });
      const saved = await getWorkflow(ws.id, wf.id);
      expect(saved?.triggers[0].type).toBe(tpl.trigger);
      expect(saved?.actions.map((a) => a.type)).toEqual(tpl.actions.map((a) => a.type));
    }
  });

  it('los headers del webhook se guardan como objeto (antes quedaban como texto y se ignoraban)', () => {
    expect(normalizeActionConfig('webhook', { url: 'https://x.test', headers: '{"authorization":"Bearer a"}' })).toEqual({
      url: 'https://x.test',
      headers: { authorization: 'Bearer a' },
    });
    expect(normalizeActionConfig('webhook', { headers: '  ' })).toEqual({});
    expect(webhookHeadersValid('[1]')).toBe(false);
    expect(webhookHeadersValid('no json')).toBe(false);
    expect(webhookHeadersValid({ a: 'b' })).toBe(true);
    expect(webhookHeadersValid('')).toBe(true);
  });

  it('marca qué falta antes de guardar', () => {
    expect(workflowProblems({ name: ' ', triggers: [], actions: [] })).toEqual(['name', 'trigger', 'action']);
    expect(
      workflowProblems({
        name: 'x',
        triggers: [{ type: 'manual' }],
        actions: [{ type: 'webhook', config: { url: 'https://x.test', headers: 'nope' } }],
      }),
    ).toEqual(['headers']);
    expect(defaultActionConfig('send_email')).toEqual({ to: 'contact', subject: '', body: '' });
  });

  it('una acción con campos obligatorios vacíos no pasa a Revisar ni se guarda', () => {
    // Antes una tarea sin título se guardaba igual (el submit se colaba desde Acciones).
    const blank = [{ type: 'create_task' as const, config: defaultActionConfig('create_task') }];
    expect(actionMissing('create_task', defaultActionConfig('create_task'))).toEqual(['subject']);
    expect(actionStepProblems(blank)).toEqual(['fields']);
    expect(workflowProblems({ name: 'x', triggers: [{ type: 'manual' }], actions: blank })).toEqual(['fields']);
    expect(actionMissing('send_email', { to: 'contact', subject: 'Hola', body: '  ' })).toEqual(['body']);
    expect(actionMissing('send_email', { to: '', subject: 'Hola', body: 'x' })).toEqual(['to']);
    expect(actionMissing('add_to_list', {})).toEqual(['listId']);
    expect(actionMissing('webhook', { method: 'POST' })).toEqual(['url']);
    expect(actionMissing('create_activity', { type: 'note' })).toEqual([]);
    expect(actionStepProblems([])).toEqual(['action']);
  });

  it('cada trigger, acción, grupo y plantilla tiene texto en en, es y pt', () => {
    const keys = [
      ...TRIGGER_TYPES.map((x) => `workflows.triggerTypes.${x}`),
      ...ACTION_TYPES.map((x) => `workflows.actionTypes.${x}`),
      ...TRIGGER_GROUPS.map((g) => `workflows.triggerGroups.${g.key}`),
      ...ACTION_GROUPS.map((g) => `workflows.actionGroups.${g.key}`),
      ...TEMPLATE_KEYS.flatMap((k) => [`workflows.templates.${k}.title`, `workflows.templates.${k}.desc`]),
      ...['name', 'trigger', 'action', 'fields', 'required', 'headers', 'save'].map((p) => `workflows.problems.${p}`),
      ...['submit', 'success', 'email', 'firstName', 'lastName', 'emailPlaceholder'].map((k) => `forms.defaults.${k}`),
      'importP.stepsLabel',
      ...CRM_SETTINGS_TABS.map((tab) => `settings.tabs.${tab}`),
      ...['fields', 'design', 'after', 'crm'].map((tab) => `forms.builder.tabs.${tab}`),
    ];
    for (const [loc, msgs] of Object.entries(LOCALES)) {
      for (const k of keys) expect(typeof get(msgs, k), `${loc}: ${k}`).toBe('string');
    }
  });
});

describe('builder de formularios', () => {
  it('deriva la clave del campo desde la etiqueta, sin tildes y sin repetir', () => {
    expect(fieldKeyFromLabel('Teléfono móvil')).toBe('telefono_movil');
    expect(fieldKeyFromLabel('  ')).toBe('field');
    expect(uniqueFieldKey([{ id: 'email' }, { id: 'email_2' }], 'Email')).toBe('email_3');
  });

  it('un form nuevo nace con los textos en el idioma de quien lo crea', () => {
    const d = es.forms.defaults;
    const body = { name: 'Contacto', ...localizedFormDefaults(d) };
    expect(formCreateSchema.safeParse(body).success).toBe(true);
    expect(body.fields.map((f) => f.label)).toEqual(['Email', 'Nombre', 'Apellido']);
    expect(body.settings.submitText).toBe('Enviar');
  });

  it('sugiere la URL propia desde el nombre', () => {
    expect(slugFromName('Contacto web (2026)')).toBe('contacto-web-2026');
    expect(slugFromName('¿Hablamos?')).toBe('hablamos');
  });

  it('cada error de la API abre la pestaña donde está el campo', () => {
    expect(builderTabForError('slug_taken')).toBe('design');
    expect(builderTabForError('missing_options')).toBe('fields');
    expect(builderTabForError('invalid_list')).toBe('crm');
    expect(builderTabForError('invalid_url')).toBe('after');
    expect(builderTabForError('generic')).toBeNull();
  });
});

describe('ajustes del CRM en pestañas', () => {
  it('elige la pestaña: válida, la de Gmail al volver del OAuth, o la primera', () => {
    expect(crmSettingsTab('sales')).toBe('sales');
    expect(crmSettingsTab('nope')).toBe('team');
    expect(crmSettingsTab(undefined, 'connected')).toBe('integrations');
    expect(crmSettingsTab('data', 'connected')).toBe('data');
  });

  it('las anclas viejas apuntan a pestañas que existen', () => {
    for (const tab of Object.values(LEGACY_ANCHORS)) expect(CRM_SETTINGS_TABS).toContain(tab);
    expect(LEGACY_ANCHORS.quotas).toBe('sales');
  });
});

describe('formatos', () => {
  it('resume una corrida y tolera salidas rotas', () => {
    expect(runSummary(JSON.stringify({ results: [{ ok: true }, { ok: false }, { ok: true }] }))).toEqual({ ok: 2, total: 3 });
    expect(runSummary('{')).toBeNull();
    expect(runSummary(null)).toBeNull();
  });

  it('resume remitente y destinatario de una cotización', () => {
    expect(partySummary('Ana', 'Acme', 'ana@acme.com')).toBe('Ana · Acme');
    expect(partySummary('', '', 'ana@acme.com')).toBe('ana@acme.com');
    expect(partySummary('', '', '')).toBe('');
  });

  it('cada estado de cotización tiene su badge', () => {
    for (const s of QUOTE_STATUSES) expect(s in QUOTE_TONE).toBe(true);
    expect(badgeClass(QUOTE_TONE, 'accepted')).toBe('badge badge-ok');
    expect(badgeClass(QUOTE_TONE, 'draft')).toBe('badge');
  });
});
