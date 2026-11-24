/**
 * Registro de la búsqueda de Ajustes: cada ajuste que se encuentra, a qué
 * página lleva y qué elemento marca. Datos puros, sin textos: los títulos y
 * descripciones son claves de messages/<locale>/<archivo>.json (las mismas que
 * pinta la página), así que cambiar un rótulo cambia lo que se busca.
 *
 * - `id`: único. `anchor` (por defecto el id) es el `data-setting` del
 *   elemento en la página (`<FormSection setting="…">` o `data-setting="…"`);
 *   `anchor: false` es un resultado de página entera (sin marcar nada).
 * - `title`/`desc`/`page`: "archivo:clave" (`settings:appearance.title`).
 * - `kw`: sinónimos que no están en la página ("dark mode", "2FA"), por idioma.
 * - `access`: quién lo ve. `admin` = owner y admins del workspace, `owner`,
 *   `notOwner` (salir del workspace),
 *   `staff` = ADMIN_EMAILS, `member` = cualquiera menos invitados.
 * - `app`: la app que hace falta tener (por defecto, el área si es una app).
 *
 * tests/unit/settings-search.test.ts revisa que cada ancla exista en el
 * código, que cada clave exista en en/es/pt, que cada ruta exista y que cada
 * sección y cada app tengan entradas.
 */
import { PRODUCT_CONFIG, PRODUCT_KEYS, productSettingsHref, type ProductKey } from './products';
import { SETTINGS_ADMIN_ROUTES, SETTINGS_SECTION_KEYS, settingsSectionHref, type SettingsSectionKey } from './settings-nav';

export type SettingsLocale = 'en' | 'es' | 'pt';
export type SettingAccess = 'admin' | 'owner' | 'notOwner' | 'staff' | 'member';
/** "archivo:clave" de messages/<locale>/<archivo>.json. */
export type MsgRef = `${string}:${string}`;

export interface SettingDef {
  id: string;
  /** "platform" (Ajustes de la plataforma) o la app. */
  area: 'platform' | ProductKey;
  /** Sección o pestaña: la miga del medio (sin ella, el resultado es la página entera de la sección o la app). */
  page?: MsgRef;
  href: string;
  title: MsgRef;
  /** Parámetros del título ({app}); los que faltan se borran. */
  params?: Record<string, string>;
  desc?: MsgRef;
  kw?: Partial<Record<SettingsLocale, string>>;
  /** Palabras clave tomadas de los mensajes (las de la nav: settings.keywords.<sección>). */
  kwRef?: MsgRef;
  access?: SettingAccess;
  app?: ProductKey;
  anchor?: string | false;
}

const P = (key: SettingsSectionKey): MsgRef => `settings:sections.${key}`;
const S = (key: SettingsSectionKey) => settingsSectionHref(key);

/** Ajustes puntuales de la plataforma (/app/settings/*). */
const PLATFORM: SettingDef[] = [
  // Perfil
  { id: 'profile-account', area: 'platform', page: P('profile'), href: S('profile'), title: 'settings:account.title', desc: 'settings:account.desc', kw: { en: 'email, sign in, role, photo, avatar', es: 'correo, email, inicio de sesión, rol, foto', pt: 'e-mail, login, função, foto' } },
  { id: 'profile-details', area: 'platform', page: P('profile'), href: S('profile'), title: 'settings:profileForm.title', desc: 'settings:profileForm.desc', kw: { en: 'name, language, time zone, timezone', es: 'nombre, idioma, zona horaria, huso horario', pt: 'nome, idioma, fuso horário' } },
  { id: 'profile-chat-access', area: 'platform', page: P('profile'), href: S('profile'), title: 'assistant:access.title', desc: 'assistant:access.desc', access: 'member', kw: { en: 'assistant, AI, chats, whatsapp, read my messages', es: 'asistente, IA, chats, whatsapp, leer mis mensajes', pt: 'assistente, IA, conversas, whatsapp, ler minhas mensagens' } },
  { id: 'profile-privacy', area: 'platform', page: P('profile'), href: S('profile'), title: 'settings:privacy.title', desc: 'settings:privacy.desc', kw: { en: 'download my data, export, delete account, GDPR', es: 'descargar mis datos, exportar, borrar cuenta, eliminar cuenta', pt: 'baixar meus dados, exportar, excluir conta, apagar conta, LGPD' } },
  // Apariencia
  { id: 'appearance-theme', area: 'platform', page: P('appearance'), href: S('appearance'), title: 'common:theme.label', desc: 'settings:appearance.desc', kw: { en: 'theme, dark mode, light mode, night, system', es: 'tema, modo oscuro, modo claro, noche, sistema', pt: 'tema, modo escuro, modo claro, noite, sistema' } },
  { id: 'appearance-look', area: 'platform', page: P('appearance'), href: S('appearance'), title: 'settings:appearance.lookTitle', desc: 'settings:appearance.lookDesc', kw: { en: 'style, lines, classic, liquid, glass, retro', es: 'estilo, aspecto, líneas, clásico, líquido, vidrio, retro', pt: 'estilo, aparência, linhas, clássico, líquido, vidro, retrô' } },
  { id: 'appearance-tours', area: 'platform', page: P('appearance'), href: S('appearance'), title: 'settings:appearance.toursTitle', desc: 'settings:appearance.toursDesc', kw: { en: 'onboarding, tips, help', es: 'recorrido, tour, ayuda, consejos', pt: 'tour, dicas, ajuda' } },
  { id: 'appearance-language', area: 'platform', page: P('appearance'), href: S('appearance'), title: 'settings:appearance.languageTitle', desc: 'settings:appearance.languageDesc', kw: { en: 'language, english, spanish, portuguese, locale', es: 'idioma, lenguaje, inglés, español, portugués', pt: 'idioma, língua, inglês, espanhol, português' } },
  // Notificaciones
  { id: 'notifications-email', area: 'platform', page: P('notifications'), href: S('notifications'), title: 'settings:emailPrefs.title', desc: 'settings:emailPrefs.desc', kw: { en: 'emails, newsletter, unsubscribe, digest', es: 'correos, emails, desuscribirse, resumen', pt: 'e-mails, cancelar inscrição, resumo' } },
  { id: 'notifications-apps', area: 'platform', page: P('notifications'), href: S('notifications'), title: 'settings:emailPrefs.appsTitle', desc: 'settings:emailPrefs.appsDesc', kw: { en: 'alerts, track notifications', es: 'alertas, avisos', pt: 'alertas, avisos' } },
  // Workspace
  { id: 'workspace-details', area: 'platform', page: P('workspace'), href: S('workspace'), title: 'settings:workspaceForm.detailsTitle', desc: 'settings:workspaceForm.detailsDesc', kw: { en: 'workspace name, logo, company, rename', es: 'nombre del workspace, logo, empresa, renombrar', pt: 'nome do workspace, logo, empresa, renomear' } },
  { id: 'workspace-mode', area: 'platform', page: P('workspace'), href: S('workspace'), title: 'settings:workspaceForm.modeTitle', desc: 'settings:workspaceForm.modeDesc', kw: { en: 'personal, team, mode', es: 'personal, equipo, modo', pt: 'pessoal, equipe, modo' } },
  { id: 'workspace-domains', area: 'platform', page: P('workspace'), href: S('workspace'), title: 'settings:workspaceForm.domainsTitle', desc: 'settings:workspaceForm.domainsDesc', kw: { en: 'email domain, auto join, company domain', es: 'dominio de correo, unirse automáticamente', pt: 'domínio de e-mail, entrar automaticamente' } },
  { id: 'workspace-danger', area: 'platform', page: P('workspace'), href: S('workspace'), title: 'settings:workspaceForm.dangerTitle', desc: 'settings:workspaceForm.dangerDesc', access: 'owner', kw: { en: 'transfer ownership, delete workspace, close', es: 'transferir, borrar workspace, eliminar, cerrar', pt: 'transferir propriedade, excluir workspace, fechar' } },
  { id: 'workspace-leave', area: 'platform', page: P('workspace'), href: S('workspace'), title: 'settings:workspaceForm.leaveTitle', desc: 'settings:workspaceForm.leaveBody', access: 'notOwner', kw: { en: 'leave workspace, quit', es: 'salir del workspace, abandonar', pt: 'sair do workspace' } },
  { id: 'workspace-apps', area: 'platform', page: P('apps'), href: S('apps'), title: 'settings:appsPanel.title', desc: 'settings:appsPanel.desc', kwRef: 'settings:keywords.apps' },
  // Miembros y equipos
  { id: 'members-invite', area: 'platform', page: P('members'), href: S('members'), title: 'settings:members.inviteTitle', desc: 'settings:members.inviteDesc', access: 'admin', kw: { en: 'invite, add people, add user, new member', es: 'invitar, agregar personas, sumar usuario, nuevo miembro', pt: 'convidar, adicionar pessoas, novo membro' } },
  { id: 'members-list', area: 'platform', page: P('members'), href: S('members'), title: 'settings:members.listTitle', desc: 'settings:members.listDesc', kw: { en: 'roles, permissions, admin, guest, remove member', es: 'roles, permisos, admin, invitado, quitar miembro', pt: 'funções, permissões, admin, convidado, remover membro' } },
  { id: 'members-pending', area: 'platform', page: P('members'), href: S('members'), title: 'settings:members.pendingTitle', desc: 'settings:members.pendingDesc', access: 'admin', kw: { en: 'invitations, resend invite', es: 'invitaciones, reenviar invitación', pt: 'convites, reenviar convite' } },
  { id: 'members-log', area: 'platform', page: P('members'), href: S('members'), title: 'settings:members.perm.logTitle', desc: 'settings:members.perm.logDesc', access: 'admin', kw: { en: 'permission changes, history, audit', es: 'cambios de permisos, historial, auditoría', pt: 'mudanças de permissão, histórico, auditoria' } },
  { id: 'teams-create', area: 'platform', page: P('teams'), href: S('teams'), title: 'settings:teamsForm.createTitle', desc: 'settings:teamsForm.createDesc', access: 'admin', kw: { en: 'new team, department, group', es: 'nuevo equipo, área, departamento, grupo', pt: 'nova equipe, departamento, grupo' } },
  { id: 'teams-list', area: 'platform', page: P('teams'), href: S('teams'), title: 'settings:teamsForm.listTitle', desc: 'settings:teamsForm.listDesc', kwRef: 'settings:keywords.teams' },
  // Plan, API y conexiones
  { id: 'billing-ai-usage', area: 'platform', page: P('billing'), href: S('billing'), title: 'settings:ai.title', desc: 'settings:ai.desc', kw: { en: 'tokens, quota, AI credits, limits', es: 'tokens, cuota, créditos de IA, límites', pt: 'tokens, cota, créditos de IA, limites' } },
  { id: 'api-connected', area: 'platform', page: P('api'), href: S('api'), title: 'settings:connected.title', desc: 'settings:connected.desc', kw: { en: 'claude, MCP, oauth, connected clients', es: 'claude, MCP, oauth, clientes conectados', pt: 'claude, MCP, oauth, clientes conectados' } },
  { id: 'api-keys', area: 'platform', page: P('api'), href: S('api'), title: 'settings:keys.title', kw: { en: 'API key, token, bearer, developer', es: 'clave de API, token, desarrolladores', pt: 'chave de API, token, desenvolvedores' } },
  { id: 'api-webhooks', area: 'platform', page: P('api'), href: S('api'), title: 'settings:webhooks.title', desc: 'settings:webhooks.desc', kw: { en: 'webhook, events, callback url, signing secret', es: 'webhook, eventos, url de retorno, secreto', pt: 'webhook, eventos, url de retorno, segredo' } },
  { id: 'connections-credentials', area: 'platform', page: P('connections'), href: S('connections'), title: 'settings:credentials.title', desc: 'settings:credentials.desc', kwRef: 'settings:keywords.connections' },
  // Seguridad
  { id: 'security-mfa', area: 'platform', page: P('security'), href: S('security'), title: 'settings:security.mfa.title', desc: 'settings:security.mfa.desc', kw: { en: '2FA, MFA, two-factor, authenticator, recovery codes, password', es: '2FA, MFA, dos pasos, doble factor, autenticador, códigos de recuperación, contraseña', pt: '2FA, MFA, dois fatores, autenticador, códigos de recuperação, senha' } },
  { id: 'security-sessions', area: 'platform', page: P('security'), href: S('security'), title: 'settings:security.sessions.title', desc: 'settings:security.sessions.desc', kw: { en: 'devices, sign out everywhere, logout, browsers', es: 'dispositivos, cerrar sesión en todos lados, navegadores', pt: 'dispositivos, sair de todos, navegadores' } },
  { id: 'security-workspace', area: 'platform', page: P('security'), href: S('security'), title: 'settings:security.workspace.title', desc: 'settings:security.workspace.desc', access: 'admin', params: { workspace: '' }, kw: { en: 'require 2FA, enforce, policy', es: 'exigir 2FA, obligar dos pasos, política', pt: 'exigir 2FA, política' } },
  { id: 'security-audit', area: 'platform', page: P('security'), href: S('security'), title: 'settings:security.workspace.auditTitle', desc: 'settings:security.workspace.auditDesc', access: 'admin', kw: { en: 'audit log, security log, csv', es: 'registro de auditoría, registro de seguridad', pt: 'log de auditoria, registro de segurança' } },
  { id: 'security-activity', area: 'platform', page: P('security'), href: S('security'), title: 'settings:security.activity.title', desc: 'settings:security.activity.desc', kw: { en: 'sign-ins, login history', es: 'inicios de sesión, historial de accesos', pt: 'logins, histórico de acesso' } },
  // Este dispositivo
  { id: 'offline-mode', area: 'platform', page: P('offline'), href: S('offline'), title: 'settings:offline.title', desc: 'settings:offline.desc', kw: { en: 'no internet, airplane, cache', es: 'sin internet, sin conexión, avión, caché', pt: 'sem internet, sem conexão, avião, cache' } },
  { id: 'offline-storage', area: 'platform', page: P('offline'), href: S('offline'), title: 'settings:offline.storageTitle', desc: 'settings:offline.storageDesc', kw: { en: 'disk space, clear data', es: 'espacio, borrar datos', pt: 'espaço, limpar dados' } },
  { id: 'offline-pending', area: 'platform', page: P('offline'), href: S('offline'), title: 'settings:offline.pendingTitle', desc: 'settings:offline.pendingDesc', kw: { en: 'sync, queue, unsent', es: 'sincronizar, cola, sin enviar', pt: 'sincronizar, fila, não enviados' } },
];

// ---------- Apps ----------

const LINES = '/app/lines/settings';
const lines = (tab: string) => `${LINES}?tab=${tab}`;
const LINES_ADMIN_TABS = new Set(['access', 'audit', 'integrations', 'migrate']);
const LINES_TABS = ['numbers', 'labels', 'quick', 'properties', 'ticketFields', 'assignment', 'tickets', 'access', 'audit', 'integrations', 'migrate', 'api', 'apps', 'appearance'] as const;
const linesTab = (tab: string): MsgRef => (tab === 'appearance' ? 'inboxWa:display.tab' : `groups:settings.tabs.${tab}`);

const LINES_TAB_KW: Partial<Record<string, SettingDef['kw']>> = {
  numbers: { en: 'whatsapp numbers, phone, connect number, QR', es: 'números de whatsapp, teléfono, conectar número, QR', pt: 'números do whatsapp, telefone, conectar número, QR' },
  quick: { en: 'canned responses, templates, snippets', es: 'respuestas rápidas, plantillas', pt: 'respostas rápidas, modelos' },
  integrations: { en: 'hubspot, slack, webhooks, MCP', es: 'hubspot, slack, webhooks, MCP', pt: 'hubspot, slack, webhooks, MCP' },
  migrate: { en: 'periskope, import', es: 'periskope, importar, migrar', pt: 'periskope, importar, migrar' },
  apps: { en: 'mobile app, push notifications', es: 'app móvil, notificaciones push', pt: 'app móvel, notificações push' },
};

const LINES_DEFS: SettingDef[] = [
  ...LINES_TABS.map((tab): SettingDef => ({
    id: `lines-tab-${tab}`,
    area: 'groups',
    href: lines(tab),
    title: linesTab(tab),
    anchor: false,
    access: LINES_ADMIN_TABS.has(tab) ? 'admin' : undefined,
    kw: LINES_TAB_KW[tab],
  })),
  { id: 'lines-ticket-detection', area: 'groups', page: linesTab('tickets'), href: lines('tickets'), title: 'groups:rules.keywords', desc: 'groups:rules.keywordsHelp', kw: { en: 'ticket emoji, create ticket', es: 'emoji de ticket, crear ticket', pt: 'emoji de ticket, criar ticket' } },
  { id: 'lines-response-times', area: 'groups', page: linesTab('tickets'), href: lines('tickets'), title: 'groups:rules.unanswered', kw: { en: 'SLA, first response, overdue, resolution time', es: 'SLA, primera respuesta, vencido, tiempo de resolución', pt: 'SLA, primeira resposta, atrasado, tempo de resolução' } },
  { id: 'lines-flag-mode', area: 'groups', page: linesTab('tickets'), href: lines('tickets'), title: 'groups:rules.flagMode', kw: { en: 'unanswered, questions, AI flag', es: 'sin responder, preguntas, marcar', pt: 'sem resposta, perguntas, marcar' } },
  { id: 'lines-read-receipts', area: 'groups', page: linesTab('tickets'), href: lines('tickets'), title: 'groups:rules.readReceipts', desc: 'groups:rules.readReceiptsHelp', kw: { en: 'blue ticks, seen, read receipts', es: 'tildes azules, visto, confirmación de lectura', pt: 'tiques azuis, visto, confirmação de leitura' } },
  { id: 'lines-keep-archived', area: 'groups', page: linesTab('tickets'), href: lines('tickets'), title: 'groups:rules.keepArchived', kw: { en: 'keep archived, archive, unarchive', es: 'mantener archivado, archivar, desarchivar, archivados', pt: 'manter arquivado, arquivar, desarquivar' } },
  { id: 'lines-sla-email', area: 'groups', page: linesTab('tickets'), href: lines('tickets'), title: 'groups:rules.slaEmail', desc: 'groups:rules.slaEmailHelp', kw: { en: 'SLA alert, breach email', es: 'aviso de SLA, correo de incumplimiento', pt: 'alerta de SLA, e-mail de violação' } },
  { id: 'lines-default-priority', area: 'groups', page: linesTab('tickets'), href: lines('tickets'), title: 'groups:rules.defaultPriority', kw: { en: 'ticket priority, urgent', es: 'prioridad, urgente', pt: 'prioridade, urgente' } },
  { id: 'lines-teams', area: 'groups', page: linesTab('assignment'), href: lines('assignment'), title: 'groups:assign.teams', kw: { en: 'support team, agents', es: 'equipo de soporte, agentes', pt: 'equipe de suporte, agentes' } },
  { id: 'lines-rules', area: 'groups', page: linesTab('assignment'), href: lines('assignment'), title: 'groups:assign.rules', kw: { en: 'round robin, auto assign, routing', es: 'asignación automática, reparto, ruteo', pt: 'atribuição automática, rodízio, roteamento' } },
  { id: 'lines-availability', area: 'groups', page: linesTab('assignment'), href: lines('assignment'), title: 'groups:assign.availability', kw: { en: 'away, available, out of office', es: 'ausente, disponible, fuera de la oficina', pt: 'ausente, disponível, fora do escritório' } },
  { id: 'lines-chat-style', area: 'groups', page: linesTab('appearance'), href: lines('appearance'), title: 'inboxWa:chatStyle.title', desc: 'inboxWa:chatStyle.help', anchor: 'chat-style', kw: CHAT_STYLE_KW() },
  { id: 'lines-chat-display', area: 'groups', page: linesTab('appearance'), href: lines('appearance'), title: 'inboxWa:display.title', anchor: 'chat-display', kw: CHAT_DISPLAY_KW() },
];

function CHAT_STYLE_KW(): SettingDef['kw'] {
  return { en: 'whatsapp look, bubbles, chat theme', es: 'estilo whatsapp, burbujas, tema del chat', pt: 'estilo whatsapp, balões, tema do chat' };
}
function CHAT_DISPLAY_KW(): SettingDef['kw'] {
  return { en: 'text size, font size, density, wallpaper, link previews', es: 'tamaño de letra, densidad, fondo, vista previa de links', pt: 'tamanho da fonte, densidade, papel de parede, prévia de links' };
}


const INBOX = '/app/inbox/settings';
const INBOX_DEFS: SettingDef[] = [
  { id: 'inbox-accounts', area: 'inbox', href: INBOX, title: 'inbox:settings.accounts', kw: { en: 'whatsapp, gmail, hubspot, connect account, QR', es: 'whatsapp, gmail, hubspot, conectar cuenta, QR', pt: 'whatsapp, gmail, hubspot, conectar conta, QR' } },
  { id: 'inbox-chat-style', area: 'inbox', href: INBOX, title: 'inboxWa:chatStyle.title', desc: 'inboxWa:chatStyle.help', anchor: 'chat-style', kw: CHAT_STYLE_KW() },
  { id: 'inbox-chat-display', area: 'inbox', href: INBOX, title: 'inboxWa:display.title', anchor: 'chat-display', kw: CHAT_DISPLAY_KW() },
  { id: 'inbox-folders', area: 'inbox', href: INBOX, title: 'inbox:folders.title', kw: { en: 'labels, organize', es: 'carpetas, etiquetas, organizar', pt: 'pastas, etiquetas, organizar' } },
  { id: 'inbox-snippets', area: 'inbox', href: INBOX, title: 'inbox:settings.snippets.title', kw: { en: 'quick replies, canned responses, templates', es: 'respuestas rápidas, plantillas', pt: 'respostas rápidas, modelos' } },
  { id: 'inbox-import', area: 'inbox', href: INBOX, title: 'inbox:settings.import.title', kw: { en: 'history, old chats, import', es: 'historial, chats viejos, importar', pt: 'histórico, conversas antigas, importar' } },
  { id: 'inbox-shortcuts', area: 'inbox', href: INBOX, title: 'inbox:help.title', kw: { en: 'hotkeys, keyboard', es: 'atajos de teclado, teclas', pt: 'atalhos de teclado, teclas' } },
];

const crm = (tab: string) => `/app/crm/settings?tab=${tab}`;
const crmDef = (id: string, tab: string, title: MsgRef, desc?: MsgRef, kw?: SettingDef['kw']): SettingDef => ({ id, area: 'crm', page: `crm:settings.tabs.${tab}`, href: crm(tab), title, desc, kw });
const CRM_DEFS: SettingDef[] = [
  crmDef('crm-lead-stages', 'sales', 'crm:leads.stagesTitle', 'crm:leads.stagesDesc', { en: 'leads, lead status', es: 'leads, estados de lead, prospectos', pt: 'leads, status do lead' }),
  crmDef('crm-pipelines', 'sales', 'crm:settings.pipelines', 'crm:settings.pipelinesDesc', { en: 'deal stages, funnel', es: 'etapas, embudo, negocios', pt: 'etapas, funil, negócios' }),
  crmDef('crm-board-cards', 'sales', 'crm:layouts.cardSettingsTitle', 'crm:layouts.cardSettingsDesc', { en: 'deal cards, kanban, board properties', es: 'tarjetas de deals, kanban, propiedades del board', pt: 'cartões de negócios, kanban, propriedades do quadro' }),
  crmDef('crm-approvals', 'sales', 'crm:approvals.rules.title', 'crm:approvals.rules.desc', { en: 'discount approval', es: 'aprobación de descuentos', pt: 'aprovação de descontos' }),
  crmDef('crm-quotas', 'sales', 'crm:quotas.title', 'crm:quotas.desc', { en: 'targets, goals', es: 'objetivos, metas, cuotas', pt: 'metas, objetivos, cotas' }),
  crmDef('crm-currency', 'sales', 'crm:settings.currency', 'crm:settings.currencyDesc', { en: 'exchange rates, dollars', es: 'moneda, tipo de cambio, dólares', pt: 'moeda, câmbio, dólares' }),
  crmDef('crm-call-outcomes', 'sales', 'crm:calls.settingsTitle', 'crm:calls.settingsDesc'),
  crmDef('crm-custom-fields', 'data', 'crm:settings.customFields', 'crm:settings.customFieldsDesc', { en: 'properties, custom properties', es: 'propiedades, campos personalizados', pt: 'propriedades, campos personalizados' }),
  crmDef('crm-property-options', 'data', 'crm:propertyOptions.title', 'crm:propertyOptions.desc', { en: 'lifecycle stage, lead status, property options, edit options', es: 'etapa del ciclo de vida, estado del lead, opciones de propiedades', pt: 'estágio do ciclo de vida, status do lead, opções de propriedades' }),
  crmDef('crm-lifecycle-auto', 'data', 'crm:propertyOptions.autoTitle', 'crm:propertyOptions.autoDesc', { en: 'automatic lifecycle, opportunity, customer', es: 'ciclo de vida automático, oportunidad, cliente', pt: 'ciclo de vida automático, oportunidade, cliente' }),
  crmDef('crm-create-form', 'data', 'crm:createForm.title', 'crm:createForm.desc', { en: 'required fields, new record form', es: 'campos obligatorios, formulario de alta', pt: 'campos obrigatórios, formulário de criação' }),
  crmDef('crm-preview-layout', 'data', 'crm:layouts.previewSettingsTitle', 'crm:layouts.previewSettingsDesc', { en: 'preview sidebar, record preview, customize preview', es: 'vista previa, panel lateral, personalizar vista previa', pt: 'pré-visualização, painel lateral, personalizar' }),
  crmDef('crm-field-permissions', 'data', 'crm:fieldPerms.title', 'crm:fieldPerms.desc'),
  crmDef('crm-tags', 'data', 'crm:settings.tags', 'crm:settings.tagsDesc', { en: 'labels', es: 'etiquetas', pt: 'etiquetas' }),
  { ...crmDef('crm-access', 'access', 'crm:access.title', 'crm:access.desc', { en: 'visibility, who sees what, sales teams', es: 'visibilidad, quién ve qué, equipos de ventas', pt: 'visibilidade, quem vê o quê, equipes de vendas' }) },
  crmDef('crm-assignment', 'automation', 'crm:assignment.title', 'crm:assignment.desc', { en: 'round robin, lead routing', es: 'reparto de leads, round robin', pt: 'rodízio, distribuição de leads' }),
  crmDef('crm-scoring', 'automation', 'crm:scoring.title', 'crm:scoring.desc', { en: 'lead score', es: 'puntaje de leads', pt: 'pontuação de leads' }),
  crmDef('crm-apps', 'integrations', 'crm:apps.title', 'crm:apps.desc'),
  crmDef('crm-gmail', 'integrations', 'crm:settings.gmailTitle', 'crm:settings.gmailDesc', { en: 'google mail, email sync', es: 'correo, sincronizar emails', pt: 'e-mail, sincronizar' }),
  crmDef('crm-outlook', 'integrations', 'crm:outlook.title', 'crm:outlook.desc', { en: 'microsoft, office 365', es: 'microsoft, office 365', pt: 'microsoft, office 365' }),
  crmDef('crm-email-tracking', 'integrations', 'crm:settings.trackingTitle', 'crm:settings.trackingDesc', { en: 'opens, clicks', es: 'aperturas, clics', pt: 'aberturas, cliques' }),
  crmDef('crm-voice', 'integrations', 'crm:voice.settings.title', 'crm:voice.settings.desc', { en: 'twilio, phone calls, dialer', es: 'twilio, llamadas, teléfono', pt: 'twilio, chamadas, telefone' }),
  crmDef('crm-extension', 'integrations', 'crm:extension.title', 'crm:extension.desc', { en: 'chrome extension, gmail sidebar', es: 'extensión de chrome', pt: 'extensão do chrome' }),
  crmDef('crm-migrate', 'import', 'crm:settings.migrateTitle', 'crm:settings.migrateDesc', { en: 'hubspot, pipedrive, salesforce, migrate, sync', es: 'hubspot, pipedrive, migrar, sincronizar', pt: 'hubspot, pipedrive, migrar, sincronizar' }),
  crmDef('crm-import', 'import', 'crm:settings.importCta', 'crm:settings.importDesc', { en: 'csv, spreadsheet', es: 'csv, planilla', pt: 'csv, planilha' }),
  { ...crmDef('crm-export', 'import', 'crm:settings.exportCta', 'crm:settings.exportTagline', { en: 'csv, download', es: 'csv, descargar', pt: 'csv, baixar' }), access: 'admin' },
];

const track = (tab: string) => `/app/track/settings?tab=${tab}`;
const TRACK_TABS: Array<[string, MsgRef, SettingDef['kw']?]> = [
  ['labels', 'track:labelsSettings.title', { en: 'tags', es: 'etiquetas', pt: 'etiquetas' }],
  ['templates', 'trackPlanning:templates.tab'],
  ['github', 'track:github.title', { en: 'pull requests, commits, git', es: 'pull requests, commits, git', pt: 'pull requests, commits, git' }],
  ['integrations', 'track:integrations.tab', { en: 'slack, sentry, linear, zapier', es: 'slack, sentry, linear, zapier', pt: 'slack, sentry, linear, zapier' }],
  ['api', 'track:apiSettings.tab'],
  ['access', 'track:access.tab', { en: 'permissions, who can see', es: 'permisos, quién ve', pt: 'permissões, quem vê' }],
  ['audit', 'track:audit.tab'],
  ['import', 'track:importer.tab', { en: 'jira, linear, asana, csv', es: 'jira, linear, asana, csv, importar', pt: 'jira, linear, asana, csv, importar' }],
  ['automations', 'trackPlanning:automation.tab', { en: 'auto archive, auto close', es: 'archivar solo, cerrar solo', pt: 'arquivar automaticamente' }],
  ['agents', 'trackTriage:agents.tab'],
];
const TRACK_DEFS: SettingDef[] = [
  ...TRACK_TABS.map(([tab, title, kw]): SettingDef => ({ id: `track-tab-${tab}`, area: 'track', href: track(tab), title, kw, anchor: false })),
  { id: 'track-notifications', area: 'track', href: track('notifications'), title: 'track:notifySettings.title', kw: { en: 'email notifications, alerts', es: 'notificaciones por correo, avisos', pt: 'notificações por e-mail, alertas' } },
];

const docs = (tab: string) => `/app/docs/settings?tab=${tab}`;
const DOCS_PAGE: Pick<SettingDef, 'area'> = { area: 'docs' };
const DOCS_DEFS: SettingDef[] = [
  { id: 'docs-members', ...DOCS_PAGE, page: 'settings:products.general', href: docs('general'), title: 'docs:admin.membersTitle', kw: { en: 'member role, can edit', es: 'rol de miembros, puede editar', pt: 'função dos membros, pode editar' } },
  { id: 'docs-security', ...DOCS_PAGE, page: 'settings:products.general', href: docs('general'), title: 'docs:admin.securityTitle', kw: { en: 'public pages, sharing, guests', es: 'páginas públicas, compartir, invitados', pt: 'páginas públicas, compartilhar, convidados' } },
  { id: 'docs-collab', ...DOCS_PAGE, page: 'settings:products.general', href: docs('general'), title: 'docs:admin.collabTitle', kw: { en: 'comments, mentions', es: 'comentarios, menciones', pt: 'comentários, menções' } },
  { id: 'docs-tab-teamspaces', ...DOCS_PAGE, href: docs('teamspaces'), title: 'docs:admin.teamspacesTab', anchor: false },
  { id: 'docs-site-address', ...DOCS_PAGE, page: 'docs:admin.siteTab', href: docs('site'), title: 'docs:site.addressTitle', access: 'admin', kw: { en: 'help center, public site, url', es: 'centro de ayuda, sitio público', pt: 'central de ajuda, site público' } },
  { id: 'docs-site-domain', ...DOCS_PAGE, page: 'docs:admin.siteTab', href: docs('site'), title: 'docs:site.domainTitle', access: 'admin', kw: { en: 'custom domain, dns', es: 'dominio propio, dns', pt: 'domínio próprio, dns' } },
  { id: 'docs-site-seo', ...DOCS_PAGE, page: 'docs:admin.siteTab', href: docs('site'), title: 'docs:site.seoTitle', access: 'admin' },
  { id: 'docs-site-analytics', ...DOCS_PAGE, page: 'docs:admin.siteTab', href: docs('site'), title: 'docs:site.analyticsTitle', access: 'admin' },
  { id: 'docs-site-export', ...DOCS_PAGE, page: 'docs:admin.siteTab', href: docs('site'), title: 'docs:export.workspaceTitle', access: 'admin' },
  { id: 'docs-tab-integrations', ...DOCS_PAGE, href: docs('integrations'), title: 'docs:admin.integrationsTab', access: 'admin', anchor: false, kw: { en: 'notion sync', es: 'sincronizar con notion', pt: 'sincronizar com notion' } },
  { id: 'docs-tab-audit', ...DOCS_PAGE, href: docs('audit'), title: 'docs:admin.auditTab', access: 'admin', anchor: false },
];

const cal = (tab: string) => `/app/calendar/settings?tab=${tab}`;
const CAL_PAGE: Pick<SettingDef, 'area'> = { area: 'cal' };
const CAL_DEFS: SettingDef[] = [
  { id: 'cal-public-link', ...CAL_PAGE, page: 'calendar:settings.tabProfile', href: cal('profile'), title: 'calendar:settings.publicLink', kw: { en: 'booking page, username, url', es: 'página de reservas, usuario, url', pt: 'página de agendamento, usuário, url' } },
  { id: 'cal-brand', ...CAL_PAGE, page: 'calendar:settings.tabProfile', href: cal('profile'), title: 'calendar:settings.brandTitle', kw: { en: 'logo, colors, branding', es: 'logo, colores, marca', pt: 'logo, cores, marca' } },
  { id: 'cal-tracking', ...CAL_PAGE, page: 'calendar:settings.tabProfile', href: cal('profile'), title: 'calendar:tracking.title', kw: { en: 'google analytics, pixel', es: 'google analytics, píxel', pt: 'google analytics, pixel' } },
  { id: 'cal-defaults', ...CAL_PAGE, page: 'calendar:settings.tabProfile', href: cal('profile'), title: 'calendar:settings.defaults', kw: { en: 'time zone, week start, time format', es: 'zona horaria, comienzo de semana, formato de hora', pt: 'fuso horário, início da semana, formato de hora' } },
  { id: 'cal-calendars', ...CAL_PAGE, page: 'calendar:settings.tabConnections', href: cal('connections'), title: 'calendar:connections.calendarsTitle', kw: { en: 'google calendar, outlook, conflicts', es: 'google calendar, outlook, conflictos', pt: 'google agenda, outlook, conflitos' } },
  { id: 'cal-conferencing', ...CAL_PAGE, page: 'calendar:settings.tabConnections', href: cal('connections'), title: 'calendar:location.conferencingTitle', kw: { en: 'zoom, google meet, video call', es: 'zoom, google meet, videollamada', pt: 'zoom, google meet, videochamada' } },
  { id: 'cal-sms', ...CAL_PAGE, page: 'calendar:settings.tabConnections', href: cal('connections'), title: 'calendar:connections.smsTitle', kw: { en: 'text message reminders', es: 'recordatorios por sms', pt: 'lembretes por sms' } },
  { id: 'cal-mcp', ...CAL_PAGE, page: 'calendar:settings.tabConnections', href: cal('connections'), title: 'calendar:connections.mcpTitle' },
  { id: 'cal-payments', ...CAL_PAGE, page: 'calendar:settings.tabPayments', href: cal('payments'), title: 'calendar:payments.settingsTitle', kw: { en: 'stripe, paid bookings', es: 'stripe, cobrar reservas, pagos', pt: 'stripe, cobrar agendamentos, pagamentos' } },
  { id: 'cal-tab-import', ...CAL_PAGE, href: cal('import'), title: 'calendar:importer.tab', anchor: false, kw: { en: 'calendly', es: 'calendly, importar', pt: 'calendly, importar' } },
  { id: 'cal-privacy', ...CAL_PAGE, page: 'calendar:privacy.tab', href: cal('privacy'), title: 'calendar:privacy.title', access: 'admin' },
  { id: 'cal-tab-activity', ...CAL_PAGE, href: cal('activity'), title: 'calendar:activity.tab', access: 'admin', anchor: false },
];

const link = (tab: string) => `/app/links/settings?tab=${tab}`;
const LINK_PAGE: Pick<SettingDef, 'area'> = { area: 'link' };
const LINK_DEFS: SettingDef[] = [
  { id: 'link-tab-domains', ...LINK_PAGE, href: link('domains'), title: 'link:domains.title', anchor: false, kw: { en: 'custom domain, short domain, dns', es: 'dominio propio, dominio corto, dns', pt: 'domínio próprio, domínio curto, dns' } },
  { id: 'link-conversions', ...LINK_PAGE, page: 'link:conversions.title', href: link('conversions'), title: 'link:conversions.howTitle', access: 'admin', kw: { en: 'conversion tracking, sales, leads', es: 'conversiones, ventas, leads', pt: 'conversões, vendas, leads' } },
  { id: 'link-stripe', ...LINK_PAGE, page: 'link:conversions.title', href: link('conversions'), title: 'link:conversions.stripeTitle', access: 'admin' },
  { id: 'link-shopify', ...LINK_PAGE, page: 'link:conversions.title', href: link('conversions'), title: 'link:integrations.shopify.name', access: 'admin' },
  { id: 'link-segment', ...LINK_PAGE, page: 'link:integrations.title', href: link('integrations'), title: 'link:integrations.segment.name', access: 'admin' },
  { id: 'link-tab-import', ...LINK_PAGE, href: link('import'), title: 'link:import.tab', access: 'admin', anchor: false, kw: { en: 'bitly, dub, rebrandly, csv', es: 'bitly, dub, rebrandly, csv, importar', pt: 'bitly, dub, rebrandly, csv, importar' } },
  { id: 'link-export', ...LINK_PAGE, href: link('export'), title: 'settings:link.exportTitle', kw: { en: 'csv, download', es: 'csv, descargar', pt: 'csv, baixar' } },
  { id: 'link-tab-activity', ...LINK_PAGE, href: link('activity'), title: 'link:activity.title', access: 'admin', anchor: false },
];

const NOTES_DEFS: SettingDef[] = [
  { id: 'notes-email', area: 'notes', href: '/app/notes/settings', title: 'notes:email.title', kw: { en: 'email to notes, forward', es: 'enviar por correo, reenviar', pt: 'enviar por e-mail, encaminhar' } },
  { id: 'notes-admin', area: 'notes', href: '/app/notes/settings', title: 'notes:admin.title', access: 'admin', kw: { en: 'OCR, public links, transfer', es: 'OCR, links públicos, transferir', pt: 'OCR, links públicos, transferir' } },
];

const VOICE_DEFS: SettingDef[] = [
  { id: 'voice-general', area: 'voice', href: '/app/voice/settings', title: 'voice:settings.dictation.generalTitle', kw: { en: 'dictation, microphone, language', es: 'dictado, micrófono, idioma', pt: 'ditado, microfone, idioma' } },
  { id: 'voice-styles', area: 'voice', href: '/app/voice/settings', title: 'voice:settings.dictation.stylesTitle', kw: { en: 'tone, formal, casual', es: 'tono, formal, informal', pt: 'tom, formal, informal' } },
  { id: 'voice-reminders', area: 'voice', href: '/app/voice/settings', title: 'voice:settings.meetings.remindersTitle' },
  { id: 'voice-retention', area: 'voice', href: '/app/voice/settings', title: 'voice:settings.meetings.retentionTitle', kw: { en: 'delete recordings, keep', es: 'borrar grabaciones, conservar', pt: 'apagar gravações, manter' } },
];

const ROBOTS_DEFS: SettingDef[] = [
  { id: 'robots-concurrency', area: 'robots', href: '/app/robots/settings', title: 'robots:workspace.concurrencyTitle' },
  { id: 'robots-members', area: 'robots', href: '/app/robots/settings', title: 'robots:workspace.membersTitle' },
];

const books = (tab: string) => `/app/books/settings?tab=${tab}`;
const BOOKS_TABS = ['company', 'taxes', 'series', 'reminders', 'payments', 'einvoice', 'roles', 'integrations'] as const;
const BOOKS_ADMIN = new Set(['payments', 'einvoice', 'roles']);
const BOOKS_DEFS: SettingDef[] = BOOKS_TABS.map((tab) => ({
  id: `books-tab-${tab}`,
  area: 'books',
  href: books(tab),
  title: `books:settings.tabs.${tab}`,
  anchor: false,
  access: BOOKS_ADMIN.has(tab) ? 'admin' : undefined,
}));

const people = (tab: string) => `/app/people/settings?tab=${tab}`;
const PEOPLE_TABS = ['policies', 'holidays', 'fields', 'visibility', 'changes', 'documents', 'access'] as const;
const PEOPLE_DEFS: SettingDef[] = PEOPLE_TABS.map((tab) => ({
  id: `people-tab-${tab}`,
  area: 'people',
  href: people(tab),
  title: `people:settings.tabs.${tab}`,
  anchor: false,
  kw: tab === 'policies' ? { en: 'vacation, PTO, leave', es: 'vacaciones, licencias, días libres', pt: 'férias, licenças, folgas' } : undefined,
}));

/** Ajustes puntuales (todo lo que no es "la página de una sección o de una app"). */
export const SETTING_DEFS: SettingDef[] = [
  ...PLATFORM,
  ...LINES_DEFS,
  ...INBOX_DEFS,
  ...CRM_DEFS,
  ...TRACK_DEFS,
  ...DOCS_DEFS,
  ...CAL_DEFS,
  ...LINK_DEFS,
  ...NOTES_DEFS,
  ...VOICE_DEFS,
  ...ROBOTS_DEFS,
  ...BOOKS_DEFS,
  ...PEOPLE_DEFS,
];

/** Rutas de Ajustes de la plataforma solo para ADMIN_EMAILS (feedback, roadmap, changelog…). */
const STAFF_PAGES: Array<[string, MsgRef]> = [
  [SETTINGS_ADMIN_ROUTES[0], 'settings:admin.feedback'],
  [SETTINGS_ADMIN_ROUTES[1], 'settings:admin.roadmap'],
  [SETTINGS_ADMIN_ROUTES[2], 'settings:admin.changelog'],
  [SETTINGS_ADMIN_ROUTES[3], 'settings:admin.lifecycle.emails'],
  [SETTINGS_ADMIN_ROUTES[4], 'settings:admin.waitlist.nav'],
];

/**
 * Todo el registro: una entrada por sección de la plataforma y por app (sus
 * páginas de ajustes, salen de las listas de la nav) más los ajustes puntuales.
 */
export function settingsRegistry(): SettingDef[] {
  const sections: SettingDef[] = SETTINGS_SECTION_KEYS.map((key) => ({
    id: `section-${key}`,
    area: 'platform',
    href: settingsSectionHref(key),
    title: P(key),
    kwRef: `settings:keywords.${key}`,
    anchor: false,
  }));
  const staff: SettingDef[] = STAFF_PAGES.map(([href, title]) => ({ id: `admin-${href.split('/').pop()}`, area: 'platform', page: P('admin'), href, title, access: 'staff', anchor: false }));
  const products: SettingDef[] = PRODUCT_KEYS.map((key) => ({
    id: `product-${key}`,
    area: key,
    href: productSettingsHref(key),
    title: 'settings:products.title',
    params: { app: PRODUCT_CONFIG[key].name },
    kwRef: 'settings:keywords.product',
    anchor: false,
  }));
  return [...sections, ...staff, ...SETTING_DEFS, ...products];
}

/** El ancla que se marca en la página (null: la página entera). */
export function anchorOf(def: SettingDef): string | null {
  return def.anchor === false ? null : (def.anchor ?? def.id);
}

/** La app que hace falta tener para ver el ajuste. */
export function appOf(def: SettingDef): ProductKey | null {
  return def.app ?? (def.area === 'platform' ? null : def.area);
}

/** Lo que hace falta saber de la persona para filtrar el registro. */
export interface SettingsViewer {
  role: string;
  /** Owner o admin del workspace. */
  admin: boolean;
  /** ADMIN_EMAILS (el equipo de zerosoft). */
  staff: boolean;
  canUse: (app: ProductKey) => boolean;
}

/** Si la persona puede abrir el ajuste: su rol alcanza y tiene la app. */
export function settingVisible(def: SettingDef, viewer: SettingsViewer): boolean {
  const app = appOf(def);
  if (app && !viewer.canUse(app)) return false;
  switch (def.access) {
    case 'staff':
      return viewer.staff;
    case 'owner':
      return viewer.role === 'owner';
    case 'notOwner':
      return viewer.role !== 'owner';
    case 'admin':
      return viewer.admin;
    case 'member':
      return viewer.role !== 'guest';
    default:
      return true;
  }
}
