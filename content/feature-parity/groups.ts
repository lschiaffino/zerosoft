import type { Localized, ParityRow, ParityStatus, ProductParity } from './types';

type L = [en: string, es: string, pt: string];
const loc = ([en, es, pt]: L): Localized => ({ en, es, pt });

function row(
  id: string,
  area: string,
  label: L,
  status: ParityStatus,
  opts: { detail?: L; competitorHas?: boolean; weight?: 1 | 2 } = {},
): ParityRow {
  return {
    id,
    area,
    label: loc(label),
    ...(opts.detail ? { detail: loc(opts.detail) } : {}),
    status,
    competitorHas: opts.competitorHas ?? true,
    ...(opts.weight ? { weight: opts.weight } : {}),
  };
}

/** Groups contra Periskope. Fuente: docs/benchmark/groups.md, revisado contra el código de esta rama. */
const parity: ProductParity = {
  competitor: 'Periskope',
  lastReviewed: '2026-10-23',
  areas: [
    { id: 'numbers', label: loc(['Numbers and connection', 'Números y conexión', 'Números e conexão']) },
    { id: 'inbox', label: loc(['Shared inbox', 'Bandeja compartida', 'Caixa compartilhada']) },
    { id: 'groups', label: loc(['Group management', 'Gestión de grupos', 'Gestão de grupos']) },
    { id: 'organize', label: loc(['Labels, properties and contacts', 'Etiquetas, propiedades y contactos', 'Etiquetas, propriedades e contatos']) },
    { id: 'tickets', label: loc(['Tickets and SLA', 'Tickets y SLA', 'Tickets e SLA']) },
    { id: 'broadcasts', label: loc(['Broadcasts and scheduling', 'Envíos masivos y programados', 'Envios em massa e agendados']) },
    { id: 'automation', label: loc(['Automation and AI', 'Automatización y AI', 'Automação e IA']) },
    { id: 'integrations', label: loc(['Integrations and API', 'Integraciones y API', 'Integrações e API']) },
    { id: 'admin', label: loc(['Permissions and privacy', 'Permisos y privacidad', 'Permissões e privacidade']) },
    { id: 'reports', label: loc(['Reports and export', 'Reportes y export', 'Relatórios e exportação']) },
    { id: 'apps', label: loc(['Mobile and desktop', 'Mobile y escritorio', 'Mobile e desktop']) },
  ],
  rows: [
    // Números
    row('qr-connect', 'numbers', ['Connect a number with a QR code', 'Conectar un número con QR', 'Conectar um número com QR'], 'partial', {
      weight: 2,
      detail: [
        'Through your own WAHA or Evolution API gateway; Periskope hosts the session for you',
        'A través de tu propio gateway WAHA o Evolution API; Periskope aloja la sesión por vos',
        'Pelo seu próprio gateway WAHA ou Evolution API; o Periskope hospeda a sessão para você',
      ],
    }),
    row('multi-number', 'numbers', ['Several numbers in one inbox', 'Varios números en una bandeja', 'Vários números em uma caixa'], 'have', {
      weight: 2,
      detail: ['Up to 50 numbers per workspace, filter by number', 'Hasta 50 números por workspace, filtro por número', 'Até 50 números por workspace, filtro por número'],
    }),
    row('official-api', 'numbers', ['Official WhatsApp Cloud API numbers', 'Números de la API oficial (Cloud API)', 'Números da API oficial (Cloud API)'], 'better', {
      competitorHas: false,
      detail: [
        'Webhook with signature check, media and templates; Periskope does not accept official API numbers',
        'Webhook con firma verificada, media y plantillas; Periskope no acepta números de la API oficial',
        'Webhook com assinatura verificada, mídia e templates; o Periskope não aceita números da API oficial',
      ],
    }),
    row('number-ops', 'numbers', ['Reconnect, resync groups and remove a number', 'Reconectar, resincronizar grupos y borrar un número', 'Reconectar, ressincronizar grupos e remover um número'], 'have'),
    row('self-host', 'numbers', ['Self-hosted, your data on your server', 'Self-host, los datos en tu servidor', 'Self-host, os dados no seu servidor'], 'better', { competitorHas: false }),

    // Bandeja
    row('chats-and-groups', 'inbox', ['1:1 chats and groups in one list', 'Chats 1:1 y grupos en una lista', 'Chats 1:1 e grupos em uma lista'], 'have', { weight: 2 }),
    row('reply-from-app', 'inbox', ['Reply without the phone, media and replies', 'Responder sin el teléfono, con media y respuestas citadas', 'Responder sem o telefone, com mídia e respostas citadas'], 'have', { weight: 2 }),
    row('reactions', 'inbox', ['Reactions', 'Reacciones', 'Reações'], 'have'),
    row('edit-delete-forward', 'inbox', ['Edit, delete, forward and pin messages', 'Editar, borrar, reenviar y fijar mensajes', 'Editar, apagar, encaminhar e fixar mensagens'], 'missing'),
    row('assignment', 'inbox', ['Assign chats', 'Asignar chats', 'Atribuir chats'], 'partial', {
      weight: 2,
      detail: ['Manual assignment; no round-robin rules yet', 'Asignación manual; sin reglas round-robin por ahora', 'Atribuição manual; sem regras round-robin por enquanto'],
    }),
    row('private-notes', 'inbox', ['Internal notes', 'Notas internas', 'Notas internas'], 'partial', {
      detail: ['Notes in the thread; no @mentions yet', 'Notas en el hilo; sin @menciones por ahora', 'Notas no fio; sem @menções por enquanto'],
    }),
    row('quick-replies', 'inbox', ['Quick replies with /shortcut', 'Respuestas rápidas con /atajo', 'Respostas rápidas com /atalho'], 'have'),
    row('filters', 'inbox', ['Filters: unread, unanswered, mine, label', 'Filtros: sin leer, sin responder, míos, etiqueta', 'Filtros: não lidas, sem resposta, minhas, etiqueta'], 'have'),
    row('message-search', 'inbox', ['Search chats and message text', 'Buscar chats y texto de mensajes', 'Buscar chats e texto das mensagens'], 'have'),
    row('close-reopen', 'inbox', ['Close, reopen and mark as read', 'Cerrar, reabrir y marcar leído', 'Fechar, reabrir e marcar como lida'], 'partial', {
      detail: ['No pin or archive in bulk yet', 'Sin fijar ni archivar en masa por ahora', 'Sem fixar nem arquivar em massa por enquanto'],
    }),
    row('keyboard-inbox', 'inbox', ['Keyboard-first inbox', 'Bandeja manejable con teclado', 'Caixa operável pelo teclado'], 'better', {
      competitorHas: false,
      detail: ['J/K, R, N, E, A, T and Cmd+K across the suite', 'J/K, R, N, E, A, T y Cmd+K en toda la suite', 'J/K, R, N, E, A, T e Cmd+K em toda a suíte'],
    }),
    row('calls', 'inbox', ['Voice calls with recording', 'Llamadas de voz con grabación', 'Chamadas de voz com gravação'], 'missing'),
    row('translation', 'inbox', ['Message translation', 'Traducción de mensajes', 'Tradução de mensagens'], 'missing'),

    // Grupos
    row('create-group', 'groups', ['Create a group', 'Crear un grupo', 'Criar um grupo'], 'have', { weight: 2 }),
    row('bulk-create', 'groups', ['Create many groups from a CSV', 'Crear muchos grupos desde un CSV', 'Criar muitos grupos a partir de um CSV'], 'better', {
      competitorHas: false,
      detail: ['Up to 50 per run with result per row', 'Hasta 50 por vez con resultado por fila', 'Até 50 por vez com resultado por linha'],
    }),
    row('bulk-members', 'groups', ['Add and remove members in many groups', 'Agregar y quitar miembros en muchos grupos', 'Adicionar e remover membros em muitos grupos'], 'have', { weight: 2 }),
    row('admins', 'groups', ['Promote and demote admins in bulk', 'Promover y degradar admins en masa', 'Promover e rebaixar admins em massa'], 'have'),
    row('invite-links', 'groups', ['Invite link and reset', 'Link de invitación y regenerarlo', 'Link de convite e redefinir'], 'have'),
    row('group-settings', 'groups', ['Group settings (name, description, who can write or edit)', 'Ajustes del grupo (nombre, descripción, quién escribe o edita)', 'Configurações do grupo (nome, descrição, quem escreve ou edita)'], 'partial', {
      detail: ['Name and description; no photo, admin-only or disappearing messages yet', 'Nombre y descripción; sin foto, solo admins ni mensajes temporales por ahora', 'Nome e descrição; sem foto, só admins nem mensagens temporárias por enquanto'],
    }),
    row('group-templates', 'groups', ['Group templates with preset members', 'Plantillas de grupo con miembros fijos', 'Modelos de grupo com membros predefinidos'], 'missing'),
    row('sync-groups', 'groups', ['Refresh groups and members from WhatsApp', 'Refrescar grupos y miembros desde WhatsApp', 'Atualizar grupos e membros pelo WhatsApp'], 'have'),
    row('leave-join', 'groups', ['Join by invite and leave a group', 'Entrar por invitación y salir de un grupo', 'Entrar por convite e sair de um grupo'], 'missing'),

    // Organización
    row('labels', 'organize', ['Colored labels on chats', 'Etiquetas con color en chats', 'Etiquetas coloridas nos chats'], 'have'),
    row('custom-properties', 'organize', ['Custom properties on chats and groups', 'Propiedades propias en chats y grupos', 'Propriedades próprias em chats e grupos'], 'partial', {
      detail: ['Text, number, option and date; no file, multi-select or dependent dropdowns', 'Texto, número, opción y fecha; sin archivo, multiselección ni dependientes', 'Texto, número, opção e data; sem arquivo, seleção múltipla nem dependentes'],
    }),
    row('contacts-crm', 'organize', ['Contacts', 'Contactos', 'Contatos'], 'better', {
      detail: ['Chats and groups link to CRM contacts and companies, with messages and tickets on the record', 'Chats y grupos se vinculan a contactos y empresas del CRM, con mensajes y tickets en la ficha', 'Chats e grupos se vinculam a contatos e empresas do CRM, com mensagens e tickets na ficha'],
    }),
    row('saved-lists', 'organize', ['Saved chat lists', 'Listas guardadas de chats', 'Listas salvas de chats'], 'missing'),

    // Tickets
    row('ticket-from-message', 'tickets', ['Ticket from a message', 'Ticket desde un mensaje', 'Ticket a partir de uma mensagem'], 'have', { weight: 2 }),
    row('emoji-ticket', 'tickets', ['Ticket by emoji reaction', 'Ticket por reacción con emoji', 'Ticket por reação com emoji'], 'have', {
      weight: 2,
      detail: ['From Groups or from the phone, one ticket per message', 'Desde Groups o desde el teléfono, un ticket por mensaje', 'Pelo Groups ou pelo telefone, um ticket por mensagem'],
    }),
    row('keyword-ticket', 'tickets', ['Ticket by keyword', 'Ticket por palabra clave', 'Ticket por palavra-chave'], 'have'),
    row('ticket-fields', 'tickets', ['Status, priority, assignee and due time', 'Estado, prioridad, asignado y vencimiento', 'Status, prioridade, responsável e vencimento'], 'have'),
    row('sla', 'tickets', ['First response and resolution SLA', 'SLA de primera respuesta y resolución', 'SLA de primeira resposta e resolução'], 'have'),
    row('unanswered-flag', 'tickets', ['Flag unanswered messages', 'Marcar mensajes sin responder', 'Marcar mensagens sem resposta'], 'partial', {
      weight: 2,
      detail: ['By time without reply per chat; Periskope uses AI to tell questions from comments', 'Por tiempo sin respuesta por chat; Periskope usa AI para separar preguntas de comentarios', 'Por tempo sem resposta por chat; o Periskope usa IA para separar perguntas de comentários'],
    }),
    row('phone-replies-count', 'tickets', ['Replies from the phone count as answered', 'Lo respondido desde el teléfono cuenta como respuesta', 'O respondido pelo telefone conta como resposta'], 'better', { competitorHas: false }),
    row('sla-email', 'tickets', ['Email when an SLA is breached', 'Email cuando vence un SLA', 'Email quando um SLA vence'], 'partial', {
      detail: ['Breach events go to webhooks and Flow, which can send the email', 'El vencimiento sale por webhook y Flow, que puede mandar el email', 'O vencimento sai por webhook e Flow, que pode enviar o email'],
    }),
    row('ticket-custom-fields', 'tickets', ['Custom fields on tickets', 'Campos propios en tickets', 'Campos próprios em tickets'], 'missing'),
    row('tasks-reminders', 'tickets', ['Tasks and reminders from a chat', 'Tareas y recordatorios desde el chat', 'Tarefas e lembretes pelo chat'], 'missing'),

    // Envíos
    row('broadcast', 'broadcasts', ['Broadcast to many groups and chats', 'Envío a muchos grupos y chats', 'Envio para muitos grupos e chats'], 'have', { weight: 2 }),
    row('variables', 'broadcasts', ['Variables in the message', 'Variables en el mensaje', 'Variáveis na mensagem'], 'have'),
    row('throttle', 'broadcasts', ['Pace between messages', 'Ritmo entre mensajes', 'Ritmo entre mensagens'], 'have', {
      detail: ['Per broadcast and a cap per number', 'Por envío y un tope por número', 'Por envio e um teto por número'],
    }),
    row('scheduled', 'broadcasts', ['Scheduled messages', 'Mensajes programados', 'Mensagens agendadas'], 'have'),
    row('recurring', 'broadcasts', ['Recurring messages', 'Mensajes recurrentes', 'Mensagens recorrentes'], 'missing'),
    row('delivery-log', 'broadcasts', ['Live status per recipient', 'Estado en vivo por destinatario', 'Status ao vivo por destinatário'], 'have'),
    row('polls', 'broadcasts', ['Polls in broadcasts', 'Encuestas en envíos', 'Enquetes nos envios'], 'missing'),
    row('no-send-credits', 'broadcasts', ['No per-seat send credits', 'Sin créditos de envío por licencia', 'Sem créditos de envio por licença'], 'better', { competitorHas: false }),

    // Automatización y AI
    row('rules-engine', 'automation', ['Automation rules on WhatsApp events', 'Reglas sobre eventos de WhatsApp', 'Regras sobre eventos de WhatsApp'], 'have', {
      detail: ['Flow triggers for message received and ticket created or updated, with no rule cap', 'Disparadores de Flow para mensaje recibido y ticket creado o actualizado, sin tope de reglas', 'Gatilhos do Flow para mensagem recebida e ticket criado ou atualizado, sem limite de regras'],
    }),
    row('send-action', 'automation', ['Send a WhatsApp message from an automation', 'Mandar un WhatsApp desde una automatización', 'Enviar um WhatsApp por uma automação'], 'have'),
    row('auto-assign', 'automation', ['Round-robin auto assignment', 'Asignación automática round-robin', 'Atribuição automática round-robin'], 'missing'),
    row('ai-summary', 'automation', ['AI summary of a chat', 'Resumen AI de un chat', 'Resumo IA de um chat'], 'have'),
    row('ai-agent', 'automation', ['AI agent that answers in chats and groups', 'Agente AI que responde en chats y grupos', 'Agente IA que responde em chats e grupos'], 'have', {
      detail: ['Any agent from Agents, with its knowledge, tools and handoff', 'Cualquier agente de Agents, con su conocimiento, herramientas y derivación', 'Qualquer agente do Agents, com seu conhecimento, ferramentas e transferência'],
    }),
    row('ai-drafts', 'automation', ['AI drafts and translation of replies', 'Borradores y traducción AI de respuestas', 'Rascunhos e tradução IA de respostas'], 'missing'),

    // Integraciones
    row('crm-native', 'integrations', ['CRM link with timeline', 'Vínculo con el CRM y timeline', 'Vínculo com o CRM e timeline'], 'better', {
      weight: 2,
      detail: ['Native: the CRM record shows the WhatsApp messages and open tickets', 'Nativo: la ficha del CRM muestra los mensajes de WhatsApp y los tickets abiertos', 'Nativo: a ficha do CRM mostra as mensagens de WhatsApp e os tickets abertos'],
    }),
    row('webhooks', 'integrations', ['Outgoing webhooks', 'Webhooks salientes', 'Webhooks de saída'], 'partial', {
      detail: ['3 events (message received, ticket created, ticket updated); Periskope has 20', '3 eventos (mensaje recibido, ticket creado, ticket actualizado); Periskope tiene 20', '3 eventos (mensagem recebida, ticket criado, ticket atualizado); o Periskope tem 20'],
    }),
    row('public-api', 'integrations', ['Public REST API', 'API REST pública', 'API REST pública'], 'partial', {
      detail: ['Chats, messages and tickets; no group admin or number endpoints yet', 'Chats, mensajes y tickets; sin endpoints de grupos ni números por ahora', 'Chats, mensagens e tickets; sem endpoints de grupos nem números por enquanto'],
    }),
    row('helpdesk-integrations', 'integrations', ['Freshdesk, Zoho, Slack and Zapier', 'Freshdesk, Zoho, Slack y Zapier', 'Freshdesk, Zoho, Slack e Zapier'], 'partial', {
      detail: ['Through Flow (Slack, HTTP, Sheets); no direct Freshdesk or Zoho app', 'Con Flow (Slack, HTTP, Sheets); sin app directa de Freshdesk ni Zoho', 'Com o Flow (Slack, HTTP, Sheets); sem app direto de Freshdesk nem Zoho'],
    }),
    row('mcp', 'integrations', ['MCP server', 'Servidor MCP', 'Servidor MCP'], 'missing'),

    // Permisos
    row('roles', 'admin', ['Admin and member roles', 'Roles admin y miembro', 'Papéis admin e membro'], 'have', {
      detail: ['Admins connect numbers and change rules; members work the inbox', 'Admins conectan números y cambian reglas; miembros atienden la bandeja', 'Admins conectam números e mudam regras; membros atendem a caixa'],
    }),
    row('label-access', 'admin', ['Members see only chats with their labels', 'Miembros ven solo chats con sus etiquetas', 'Membros veem só chats com suas etiquetas'], 'missing'),
    row('masking', 'admin', ['Phone number masking', 'Ocultar números de teléfono', 'Ocultar números de telefone'], 'missing'),
    row('encrypted-credentials', 'admin', ['Provider credentials encrypted at rest', 'Credenciales del proveedor cifradas', 'Credenciais do provedor criptografadas'], 'have'),
    row('audit-log', 'admin', ['Audit log per chat', 'Log de auditoría por chat', 'Log de auditoria por chat'], 'missing'),

    // Reportes
    row('response-metrics', 'reports', ['Messages, active chats and median first response', 'Mensajes, chats activos y mediana de primera respuesta', 'Mensagens, chats ativos e mediana de primeira resposta'], 'have'),
    row('ticket-metrics', 'reports', ['Ticket and resolution metrics', 'Métricas de tickets y resolución', 'Métricas de tickets e resolução'], 'have'),
    row('per-agent', 'reports', ['By person and by group', 'Por persona y por grupo', 'Por pessoa e por grupo'], 'have'),
    row('report-filters', 'reports', ['Filter reports by label and date range', 'Filtrar reportes por etiqueta y rango', 'Filtrar relatórios por etiqueta e período'], 'partial', {
      detail: ['7, 30 or 90 days; no label filter yet', '7, 30 o 90 días; sin filtro por etiqueta por ahora', '7, 30 ou 90 dias; sem filtro por etiqueta por enquanto'],
    }),
    row('csv-export', 'reports', ['CSV export of chats, messages and tickets', 'Export CSV de chats, mensajes y tickets', 'Exportar CSV de chats, mensagens e tickets'], 'have'),

    // Apps
    row('mobile-app', 'apps', ['Mobile app', 'App mobile', 'App mobile'], 'partial', {
      detail: ['The web app works at phone width; no native app', 'La app web funciona en el teléfono; sin app nativa', 'O app web funciona no celular; sem app nativo'],
    }),
    row('desktop-app', 'apps', ['Desktop app', 'App de escritorio', 'App desktop'], 'missing'),
  ],
};

export default parity;
