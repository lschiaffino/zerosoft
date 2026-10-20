import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  buildWidgetPayload,
  parseFields,
  parseOfficeHours,
  isValidMinutes,
  widgetTab,
  type WidgetFormValues,
} from '@/components/chat/widget-form-model';
import { cannedPayload, emptyCannedForm, joinSummary, normalizeShortcut, parseCannedActions } from '@/components/chat/canned-model';
import { conversationIdFromPath, formatSlaAge, inboxQuery, parseSavedFilters } from '@/components/chat/inbox-model';

const root = join(__dirname, '..', '..');

const values: WidgetFormValues = {
  name: '  Soporte  ',
  color: '#e23d7f',
  position: 'bottom-left',
  welcomeMessage: '   ',
  botEnabled: true,
  botGreeting: ' Hola ',
  botSource: 'docs',
  helpEnabled: false,
  locale: 'es',
  offlineEmailMinutes: 30,
};

describe('editor de widget en pestañas', () => {
  it('cada pestaña guarda el widget entero: recorta textos y descarta campos sin nombre', () => {
    const payload = buildWidgetPayload(
      values,
      [
        { id: 'a', name: ' Empresa ', required: true, type: 'text' },
        { id: 'b', name: '   ', required: false, type: 'email' },
      ],
      { enabled: false, timezone: 'UTC', days: [] },
    );
    expect(payload.name).toBe('Soporte');
    expect(payload.welcomeMessage).toBeUndefined();
    expect(payload.locale).toBe('es');
    expect(payload.offlineEmailMinutes).toBe(30);
    expect(payload.botGreeting).toBe('Hola');
    expect(payload.fields).toEqual([{ id: 'a', name: 'Empresa', required: true, type: 'text' }]);
    expect(payload.officeHours).toBeNull();
    expect(payload.position).toBe('bottom-left');
  });

  it('el horario viaja con su zona; vacía cae a UTC', () => {
    const days = parseOfficeHours(null, 'UTC').days;
    const payload = buildWidgetPayload(values, [], { enabled: true, timezone: ' ', days });
    expect(payload.officeHours).toEqual({ timezone: 'UTC', days });
  });

  it('parsea horario y campos guardados, y tolera JSON roto', () => {
    expect(parseOfficeHours('{roto', 'America/Lima')).toMatchObject({ enabled: false, timezone: 'America/Lima' });
    const raw = JSON.stringify({ timezone: 'Europe/Madrid', days: Array.from({ length: 7 }, () => ({ enabled: true, start: '08:00', end: '16:00' })) });
    expect(parseOfficeHours(raw)).toMatchObject({ enabled: true, timezone: 'Europe/Madrid' });
    expect(parseFields('[{"id":"x","name":"Plan","type":"rara"}]')).toEqual([{ id: 'x', name: 'Plan', required: false, type: 'text' }]);
    expect(parseFields('nope')).toEqual([]);
  });

  it('?tab= desconocido vuelve a Apariencia', () => {
    expect(widgetTab('bot')).toBe('bot');
    expect(widgetTab('hours')).toBe('hours');
    expect(widgetTab('xss')).toBe('look');
    expect(widgetTab(null)).toBe('look');
  });
});

describe('respuestas guardadas', () => {
  it('el atajo se deriva del nombre, sin acentos ni espacios', () => {
    expect(normalizeShortcut('Saludo inicial')).toBe('/saludo-inicial');
    expect(normalizeShortcut('  /Reintegro en curso ')).toBe('/reintegro-en-curso');
    expect(normalizeShortcut('Facturación ¿urgente?')).toBe('/facturacion-urgente');
    expect(normalizeShortcut('   ')).toBe('');
  });

  it('sin atajo escrito usa el nombre; sin nombre, el título es el atajo', () => {
    const fromTitle = cannedPayload({ ...emptyCannedForm(), title: 'Revisar DNS', body: ' Hola ' });
    expect(fromTitle).toMatchObject({ shortcut: '/revisar-dns', title: 'Revisar DNS', body: 'Hola', actions: {} });
    const fromShortcut = cannedPayload({ ...emptyCannedForm(), shortcut: '/dns', shortcutTouched: true, body: 'x' });
    expect(fromShortcut).toMatchObject({ shortcut: '/dns', title: 'dns' });
  });

  it('las acciones automáticas (Avanzado) se arman igual que antes', () => {
    const p = cannedPayload({
      ...emptyCannedForm(),
      title: 'Cerrar',
      body: 'Listo',
      status: 'resolved',
      assignTo: '__none',
      tags: '#billing, urgent',
      snoozeHours: '',
    });
    expect(p.actions).toEqual({ status: 'resolved', assignTo: '', addTags: ['billing', 'urgent'] });
    expect(parseCannedActions('no-json')).toEqual({});
  });
});

describe('bandeja de tres columnas', () => {
  it('estado y asignación son filtros independientes', () => {
    expect(inboxQuery({ status: 'pending', assignee: 'mine', q: '', tag: '' }, ['w1', 'w2'], 'u1')).toEqual({
      widgetIds: 'w1,w2',
      status: 'pending',
      assignedTo: 'u1',
    });
    expect(inboxQuery({ status: 'all', assignee: 'unassigned', q: 'ana', tag: 'vip' }, [], 'u1')).toEqual({
      assignedTo: 'unassigned',
      q: 'ana',
      tag: 'vip',
    });
  });

  it('recupera filtros guardados y descarta valores raros', () => {
    expect(parseSavedFilters('{"status":"resolved","assignee":"mine"}')).toEqual({ status: 'resolved', assignee: 'mine' });
    expect(parseSavedFilters('{"status":"x","assignee":"y"}')).toEqual({ status: 'open', assignee: 'any' });
    expect(parseSavedFilters('{')).toBeNull();
    expect(parseSavedFilters(null)).toBeNull();
  });

  it('sabe qué conversación está abierta por la ruta', () => {
    expect(conversationIdFromPath('/app/chat/inbox/abc123')).toBe('abc123');
    expect(conversationIdFromPath('/app/chat/inbox')).toBeUndefined();
  });

  it('la lista vive en el layout de la bandeja y la conversación no trae su propia lista', () => {
    const layout = join(root, 'app', '[locale]', 'app', 'chat', 'inbox', 'layout.tsx');
    expect(existsSync(layout)).toBe(true);
    expect(readFileSync(layout, 'utf8')).toMatch(/InboxShell/);
    const conv = readFileSync(join(root, 'components', 'chat', 'ConversationClient.tsx'), 'utf8');
    expect(conv).not.toMatch(/ConversationList/);
    expect(conv).toMatch(/useInbox\(\)/);
  });
});

describe('SLA y rutas', () => {
  it('minutos enteros entre 1 y 30 días', () => {
    expect(isValidMinutes('60', false)).toBe(true);
    expect(isValidMinutes('', true)).toBe(true);
    expect(isValidMinutes('', false)).toBe(false);
    expect(isValidMinutes('1.5', false)).toBe(false);
    expect(isValidMinutes('43201', false)).toBe(false);
  });

  it('/widgets/new usa el modal mínimo, no el formulario completo', () => {
    const page = readFileSync(join(root, 'app', '[locale]', 'app', 'chat', 'widgets', 'new', 'page.tsx'), 'utf8');
    expect(page).toMatch(/openNew/);
    expect(existsSync(join(root, 'components', 'chat', 'WidgetForm.tsx'))).toBe(false);
  });

  it('"Ajustes" de Chat se llama Widgets en los tres idiomas y no quedan em dashes', () => {
    for (const locale of ['es', 'en', 'pt']) {
      const raw = readFileSync(join(root, 'messages', locale, 'chat.json'), 'utf8');
      expect(JSON.parse(raw).sidebar.settings).toBe('Widgets');
      expect(raw).not.toMatch(/—/);
    }
  });
});

describe('textos cortos de Chat', () => {
  it('el resumen de acciones solo capitaliza la primera palabra', () => {
    expect(joinSummary(['pospone 4 h', 'asigna a quien la usa', '#facturacion'])).toBe(
      'Pospone 4 h, asigna a quien la usa, #facturacion',
    );
    expect(joinSummary([])).toBe('');
  });

  it('la antigüedad del SLA vencido se escribe en m, h o d', () => {
    expect(formatSlaAge(12)).toBe('12m');
    expect(formatSlaAge(125)).toBe('2h');
    expect(formatSlaAge(3000)).toBe('2d');
  });
});
