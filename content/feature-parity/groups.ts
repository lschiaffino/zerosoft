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
  lastReviewed: '2026-10-25',
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
    row('recurring', 'broadcasts', ['Recurring messages', 'Mensajes recurrentes', 'Mensagens recorrentes'], 'have', {
      detail: [
        'Daily, weekly by day, monthly or cron, with time zone and end date, to chats and groups; pause, edit and next runs visible; each run goes out with the broadcast pace',
        'Diario, semanal por días, mensual o cron, con zona horaria y fecha de fin, a chats y grupos; pausar, editar y próximas corridas a la vista; cada corrida sale con el ritmo de los envíos',
        'Diário, semanal por dias, mensal ou cron, com fuso e data de fim, para chats e grupos; pausar, editar e próximas execuções visíveis; cada execução sai no ritmo dos envios',
      ],
    }),
    row('delivery-log', 'broadcasts', ['Live status per recipient', 'Estado en vivo por destinatario', 'Status ao vivo por destinatário'], 'have'),
    row('polls', 'broadcasts', ['Polls in broadcasts', 'Encuestas en envíos', 'Enquetes nos envios'], 'have', {
      detail: [
        'In chats, broadcasts and recurring messages, with live results from WAHA votes; Evolution counts votes when the gateway sends them decrypted; the Meta Cloud API has no polls',
        'En chats, envíos y recurrentes, con resultados en vivo de los votos de WAHA; Evolution los cuenta cuando el gateway los manda descifrados; la Cloud API de Meta no tiene encuestas',
        'Em chats, envios e recorrentes, com resultados ao vivo dos votos do WAHA; o Evolution conta quando o gateway manda os votos decifrados; a Cloud API da Meta não tem enquetes',
      ],
    }),
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
    row('webhooks', 'integrations', ['Outgoing webhooks', 'Webhooks salientes', 'Webhooks de saída'], 'have', {
      detail: [
        '13 events (messages in and out, chat created, assigned and closed, members in and out, tickets, SLA, poll votes), HMAC signature, retries with backoff, delivery log and resend; Periskope also sends message edits, deletions and number status',
        '13 eventos (mensajes entrantes y salientes, chat creado, asignado y cerrado, miembros que entran y salen, tickets, SLA, votos), firma HMAC, reintentos con backoff, log de entregas y reenvío; Periskope además manda ediciones, borrados y estado del número',
        '13 eventos (mensagens recebidas e enviadas, chat criado, atribuído e fechado, membros que entram e saem, tickets, SLA, votos), assinatura HMAC, novas tentativas com backoff, log de entregas e reenvio; o Periskope também manda edições, exclusões e status do número',
      ],
    }),
    row('public-api', 'integrations', ['Public REST API', 'API REST pública', 'API REST pública'], 'have', {
      detail: [
        'Chats, messages (text, media, polls), groups, members and invite links, tickets, labels, numbers, broadcasts and recurring messages, with scoped API keys; no contacts or custom property endpoints yet',
        'Chats, mensajes (texto, media, encuestas), grupos, miembros y links de invitación, tickets, etiquetas, números, envíos y recurrentes, con API keys por scope; sin endpoints de contactos ni de propiedades por ahora',
        'Chats, mensagens (texto, mídia, enquetes), grupos, membros e links de convite, tickets, etiquetas, números, envios e recorrentes, com API keys por scope; sem endpoints de contatos nem de propriedades por enquanto',
      ],
    }),
    row('helpdesk-integrations', 'integrations', ['Freshdesk, Zoho, Slack and Zapier', 'Freshdesk, Zoho, Slack y Zapier', 'Freshdesk, Zoho, Slack e Zapier'], 'have', {
      detail: [
        'Slack channel alerts; Freshdesk and Zoho Desk tickets created from ours with status synced both ways (each workspace pastes its own keys, stored encrypted); Zapier through webhooks and the API, with no app in the Zapier directory',
        'Avisos en un canal de Slack; tickets de Freshdesk y Zoho Desk creados desde los nuestros con el estado sincronizado en los dos sentidos (cada workspace pega sus claves, guardadas cifradas); Zapier por webhooks y la API, sin app en el directorio de Zapier',
        'Avisos em um canal do Slack; tickets do Freshdesk e do Zoho Desk criados a partir dos nossos com status sincronizado nos dois sentidos (cada workspace cola suas chaves, guardadas criptografadas); Zapier por webhooks e a API, sem app no diretório do Zapier',
      ],
    }),
    row('mcp', 'integrations', ['MCP server', 'Servidor MCP', 'Servidor MCP'], 'have', {
      detail: [
        'Streamable HTTP with an API key: 9 tools to list chats, read and send messages and polls, assign, close and label chats, and handle tickets; Periskope lists 56 tools',
        'Streamable HTTP con API key: 9 herramientas para listar chats, leer y mandar mensajes y encuestas, asignar, cerrar y etiquetar chats y manejar tickets; Periskope lista 56',
        'Streamable HTTP com API key: 9 ferramentas para listar chats, ler e enviar mensagens e enquetes, atribuir, fechar e etiquetar chats e cuidar de tickets; o Periskope lista 56',
      ],
    }),

    // Permisos
    row('roles', 'admin', ['Admin and member roles', 'Roles admin y miembro', 'Papéis admin e membro'], 'have', {
      detail: ['Admins connect numbers and change rules; members work the inbox', 'Admins conectan números y cambian reglas; miembros atienden la bandeja', 'Admins conectam números e mudam regras; membros atendem a caixa'],
    }),
    row('label-access', 'admin', ['Members see only chats with their labels', 'Miembros ven solo chats con sus etiquetas', 'Membros veem só chats com suas etiquetas'], 'have', {
      detail: [
        'Per label, who sees it; members also see the chats assigned to them; applies to inbox, search, Cmd+K, reports, export, API and MCP',
        'Por etiqueta, quién la ve; los miembros ven además los chats que tienen asignados; aplica en bandeja, búsqueda, Cmd+K, reportes, export, API y MCP',
        'Por etiqueta, quem a vê; os membros também veem os chats atribuídos a eles; vale na caixa, na busca, no Cmd+K, nos relatórios, no export, na API e no MCP',
      ],
    }),
    row('masking', 'admin', ['Phone number masking', 'Ocultar números de teléfono', 'Ocultar números de telefone'], 'have', {
      detail: [
        'Per role (members, admins); hidden in the app, CSV export, API, MCP and push notifications',
        'Por rol (miembros, admins); ocultos en la app, el export CSV, la API, el MCP y las notificaciones',
        'Por papel (membros, admins); ocultos no app, no export CSV, na API, no MCP e nas notificações',
      ],
    }),
    row('encrypted-credentials', 'admin', ['Provider credentials encrypted at rest', 'Credenciales del proveedor cifradas', 'Credenciais do provedor criptografadas'], 'have'),
    row('audit-log', 'admin', ['Audit log per chat', 'Log de auditoría por chat', 'Log de auditoria por chat'], 'have', {
      detail: [
        'Who assigned, closed, labeled, renamed, exported, removed or changed members and tickets, from the app, API or MCP; in each chat and for the whole workspace, filterable by action and person',
        'Quién asignó, cerró, etiquetó, renombró, exportó, sacó o cambió miembros y tickets, desde la app, la API o el MCP; en cada chat y para todo el workspace, filtrable por acción y persona',
        'Quem atribuiu, fechou, etiquetou, renomeou, exportou, removeu ou mudou membros e tickets, pelo app, pela API ou pelo MCP; em cada chat e para todo o workspace, filtrável por ação e pessoa',
      ],
    }),

    // Reportes
    row('response-metrics', 'reports', ['Messages, active chats and median first response', 'Mensajes, chats activos y mediana de primera respuesta', 'Mensagens, chats ativos e mediana de primeira resposta'], 'have'),
    row('ticket-metrics', 'reports', ['Ticket and resolution metrics', 'Métricas de tickets y resolución', 'Métricas de tickets e resolução'], 'have'),
    row('per-agent', 'reports', ['By person and by group', 'Por persona y por grupo', 'Por pessoa e por grupo'], 'have'),
    row('report-filters', 'reports', ['Filter reports by label and date range', 'Filtrar reportes por etiqueta y rango', 'Filtrar relatórios por etiqueta e período'], 'have', {
      detail: [
        '7, 30 or 90 days or any date range, by label, by chat or group and by number',
        '7, 30 o 90 días o cualquier rango de fechas, por etiqueta, por chat o grupo y por número',
        '7, 30 ou 90 dias ou qualquer período, por etiqueta, por chat ou grupo e por número',
      ],
    }),
    row('csv-export', 'reports', ['CSV export of chats, messages and tickets', 'Export CSV de chats, mensajes y tickets', 'Exportar CSV de chats, mensagens e tickets'], 'have'),

    // Apps
    row('mobile-app', 'apps', ['Mobile app', 'App mobile', 'App mobile'], 'have', {
      detail: [
        'Installable app (PWA) on Android and iPhone with push notifications for assigned chats; it is not in the app stores',
        'App instalable (PWA) en Android y iPhone con notificaciones push de los chats asignados; no está en las tiendas',
        'App instalável (PWA) no Android e no iPhone com notificações push dos chats atribuídos; não está nas lojas',
      ],
    }),
    row('desktop-app', 'apps', ['Desktop app', 'App de escritorio', 'App desktop'], 'partial', {
      detail: [
        'The same installable app (PWA) in Chrome or Edge, with its own window and notifications; no downloadable desktop binary',
        'La misma app instalable (PWA) en Chrome o Edge, con ventana propia y notificaciones; sin binario de escritorio para descargar',
        'O mesmo app instalável (PWA) no Chrome ou Edge, com janela própria e notificações; sem binário desktop para baixar',
      ],
    }),
  ],
};

export default parity;
