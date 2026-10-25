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

/**
 * Talk contra Slack. Fuente: docs/benchmark/talk.md (2026-10-25).
 * Las filas describen a Slack; lo que Talk ya hace (tanda 4d) se marca en
 * BUILT, al final, con su detalle cuando es parcial. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Slack',
  lastReviewed: '2026-10-25',
  areas: [
    { id: 'channels', label: loc(['Channels', 'Canales', 'Canais']) },
    { id: 'dms', label: loc(['Direct messages', 'Mensajes directos', 'Mensagens diretas']) },
    { id: 'messaging', label: loc(['Writing and conversation', 'Escribir y conversar', 'Escrita e conversa']) },
    { id: 'files', label: loc(['Files', 'Archivos', 'Arquivos']) },
    { id: 'search', label: loc(['Search and follow-up', 'Búsqueda y seguimiento', 'Busca e acompanhamento']) },
    { id: 'presence', label: loc(['Presence and profile', 'Presencia y perfil', 'Presença e perfil']) },
    { id: 'huddles', label: loc(['Huddles', 'Huddles', 'Huddles']) },
    { id: 'canvases', label: loc(['Canvases and lists', 'Canvases y listas', 'Canvases e listas']) },
    { id: 'automation', label: loc(['Workflows and apps', 'Workflows y apps', 'Workflows e apps']) },
    { id: 'external', label: loc(['External people and AI', 'Externos y IA', 'Externos e IA']) },
    { id: 'admin', label: loc(['Admin and security', 'Admin y seguridad', 'Admin e segurança']) },
    { id: 'apps', label: loc(['Desktop and mobile', 'Escritorio y mobile', 'Desktop e mobile']) },
  ],
  rows: [
    // Canales
    row('public-channels', 'channels', ['Public channels', 'Canales públicos', 'Canais públicos'], 'missing', {
      weight: 2,
      detail: [
        'Anyone in the workspace can find and join them from the channel directory',
        'Cualquiera del workspace los encuentra y se une desde el directorio de canales',
        'Qualquer pessoa do workspace encontra e entra pelo diretório de canais',
      ],
    }),
    row('private-channels', 'channels', ['Private channels', 'Canales privados', 'Canais privados'], 'missing', {
      weight: 2,
      detail: ['Invite only, hidden from the directory', 'Solo por invitación, fuera del directorio', 'Só por convite, fora do diretório'],
    }),
    row('channel-header', 'channels', ['Channel topic, description and bookmarks', 'Tema, descripción y marcadores del canal', 'Tema, descrição e favoritos do canal'], 'missing'),
    row('sidebar-sections', 'channels', ['Custom sidebar sections', 'Secciones propias en el sidebar', 'Seções próprias na barra lateral'], 'missing', {
      detail: [
        'Each person groups and sorts channels and DMs',
        'Cada persona agrupa y ordena canales y DMs',
        'Cada pessoa agrupa e ordena canais e DMs',
      ],
    }),
    row('channel-manage', 'channels', ['Rename, archive and convert channels', 'Renombrar, archivar y convertir canales', 'Renomear, arquivar e converter canais'], 'missing', {
      detail: [
        'Archiving keeps the history; a public channel can become private',
        'Archivar conserva el historial; un canal público puede pasar a privado',
        'Arquivar mantém o histórico; um canal público pode virar privado',
      ],
    }),

    // DMs
    row('direct-messages', 'dms', ['One-to-one direct messages', 'Mensajes directos 1:1', 'Mensagens diretas 1:1'], 'missing', { weight: 2 }),
    row('group-dms', 'dms', ['Group direct messages', 'Mensajes directos grupales', 'Mensagens diretas em grupo'], 'missing', {
      detail: [
        'Up to 9 people besides you; can be turned into a private channel',
        'Hasta 9 personas además de vos; se pueden convertir en canal privado',
        'Até 9 pessoas além de você; podem virar um canal privado',
      ],
    }),

    // Escribir
    row('realtime-messages', 'messaging', ['Real-time messages', 'Mensajes en tiempo real', 'Mensagens em tempo real'], 'missing', {
      weight: 2,
      detail: [
        'New messages and typing indicators appear without reloading',
        'Los mensajes nuevos y quién está escribiendo aparecen sin recargar',
        'Mensagens novas e quem está digitando aparecem sem recarregar',
      ],
    }),
    row('rich-composer', 'messaging', ['Composer with formatting and link previews', 'Editor con formato y vista previa de links', 'Editor com formatação e prévia de links'], 'missing', {
      weight: 2,
      detail: [
        'Bold, lists, code blocks, quotes and links',
        'Negrita, listas, bloques de código, citas y links',
        'Negrito, listas, blocos de código, citações e links',
      ],
    }),
    row('threads', 'messaging', ['Threads', 'Hilos', 'Threads'], 'missing', {
      weight: 2,
      detail: [
        'Replies in a side panel, with the option to also send to the channel',
        'Respuestas en un panel lateral, con opción de mandar también al canal',
        'Respostas em um painel lateral, com opção de enviar também ao canal',
      ],
    }),
    row('mentions', 'messaging', ['Mentions, @channel, @here and user groups', 'Menciones, @canal, @here y grupos de usuarios', 'Menções, @canal, @here e grupos de usuários'], 'missing', { weight: 2 }),
    row('reactions', 'messaging', ['Emoji reactions and custom emoji', 'Reacciones con emoji y emoji propios', 'Reações com emoji e emoji próprios'], 'missing'),
    row('edit-delete', 'messaging', ['Edit and delete messages', 'Editar y borrar mensajes', 'Editar e apagar mensagens'], 'missing', {
      detail: [
        'Admins set how long people can edit',
        'El admin define por cuánto tiempo se puede editar',
        'O admin define por quanto tempo é possível editar',
      ],
    }),
    row('scheduled-messages', 'messaging', ['Scheduled messages', 'Mensajes programados', 'Mensagens agendadas'], 'missing'),
    row('pinned-messages', 'messaging', ['Pinned messages', 'Mensajes fijados', 'Mensagens fixadas'], 'missing'),
    row('clips', 'messaging', ['Audio and video clips', 'Clips de audio y video', 'Clipes de áudio e vídeo'], 'missing', {
      detail: [
        'Short recordings inside a message, with a transcript',
        'Grabaciones cortas dentro del mensaje, con transcripción',
        'Gravações curtas dentro da mensagem, com transcrição',
      ],
    }),

    // Archivos
    row('file-sharing', 'files', ['Upload files with previews', 'Subir archivos con vista previa', 'Enviar arquivos com prévia'], 'missing', {
      weight: 2,
      detail: [
        'Images, PDFs and documents preview inside the message',
        'Imágenes, PDF y documentos se ven dentro del mensaje',
        'Imagens, PDFs e documentos aparecem dentro da mensagem',
      ],
    }),
    row('file-browser', 'files', ['Browse all files', 'Explorador de archivos', 'Navegador de arquivos'], 'missing'),

    // Búsqueda
    row('message-search', 'search', ['Search messages and files with filters', 'Buscar mensajes y archivos con filtros', 'Buscar mensagens e arquivos com filtros'], 'missing', {
      weight: 2,
      detail: [
        'from:, in: and date filters; the free plan only searches the last 90 days',
        'Filtros from:, in: y fechas; el plan gratis solo busca en los últimos 90 días',
        'Filtros from:, in: e datas; o plano grátis só busca nos últimos 90 dias',
      ],
    }),
    row('unreads', 'search', ['Unread counts and Activity view', 'No leídos y vista de actividad', 'Não lidas e visão de atividade'], 'missing', {
      weight: 2,
      detail: [
        'Counts per channel, an unreads view and an Activity tab with mentions and reactions',
        'Contadores por canal, vista de no leídos y pestaña Actividad con menciones y reacciones',
        'Contadores por canal, visão de não lidas e aba Atividade com menções e reações',
      ],
    }),
    row('save-later', 'search', ['Save for later and reminders', 'Guardar para después y recordatorios', 'Salvar para depois e lembretes'], 'missing'),
    row('notifications', 'search', ['Notification settings', 'Ajustes de notificaciones', 'Configurações de notificação'], 'missing', {
      weight: 2,
      detail: [
        'Per channel, keywords, do not disturb hours, push and desktop',
        'Por canal, palabras clave, horario de no molestar, push y escritorio',
        'Por canal, palavras-chave, horário de não perturbe, push e desktop',
      ],
    }),

    // Presencia
    row('status', 'presence', ['Status with emoji and expiry', 'Estado con emoji y vencimiento', 'Status com emoji e expiração'], 'missing'),
    row('presence', 'presence', ['Active and away presence', 'Presencia activo y ausente', 'Presença ativo e ausente'], 'missing'),
    row('profiles', 'presence', ['Profiles with title, time zone and custom fields', 'Perfiles con cargo, zona horaria y campos propios', 'Perfis com cargo, fuso horário e campos próprios'], 'missing'),

    // Huddles
    row('huddles', 'huddles', ['Audio and video huddles', 'Huddles de audio y video', 'Huddles de áudio e vídeo'], 'missing', {
      weight: 2,
      detail: [
        'In channels and DMs; free plan 1:1 only, paid plans up to 50 people with 25 on video',
        'En canales y DMs; el plan gratis solo 1:1, los pagos hasta 50 personas con 25 en video',
        'Em canais e DMs; o plano grátis só 1:1, os pagos até 50 pessoas com 25 em vídeo',
      ],
    }),
    row('screen-share', 'huddles', ['Screen sharing and drawing', 'Compartir pantalla y dibujar', 'Compartilhar tela e desenhar'], 'missing', {
      detail: [
        'Up to two screens at once, drawing on the desktop app',
        'Hasta dos pantallas a la vez, dibujo en la app de escritorio',
        'Até duas telas ao mesmo tempo, desenho no app desktop',
      ],
    }),
    row('huddle-notes', 'huddles', ['Huddle thread and AI notes', 'Hilo y notas de IA del huddle', 'Thread e notas de IA do huddle'], 'missing', {
      detail: [
        'Each huddle has a thread and a canvas; AI notes on paid plans',
        'Cada huddle tiene hilo y canvas; notas de IA en los planes pagos',
        'Cada huddle tem thread e canvas; notas de IA nos planos pagos',
      ],
    }),

    // Canvases y listas
    row('canvases', 'canvases', ['Canvases', 'Canvases', 'Canvases'], 'missing', {
      detail: [
        'Documents as a channel tab or standalone, with embeds and comments; paid plans',
        'Documentos en una pestaña del canal o sueltos, con embeds y comentarios; planes pagos',
        'Documentos em uma aba do canal ou avulsos, com embeds e comentários; planos pagos',
      ],
    }),
    row('lists', 'canvases', ['Lists', 'Listas', 'Listas'], 'missing', {
      detail: [
        'Table or board with fields, saved views and a thread per item; up to 1,000 items on Pro',
        'Tabla o tablero con campos, vistas guardadas e hilo por ítem; hasta 1.000 ítems en Pro',
        'Tabela ou quadro com campos, visões salvas e thread por item; até 1.000 itens no Pro',
      ],
    }),

    // Automatización
    row('workflow-builder', 'automation', ['Workflow Builder', 'Workflow Builder', 'Workflow Builder'], 'missing', {
      detail: [
        'Triggers by link, schedule, emoji or channel events, with conditional steps; paid plans',
        'Disparadores por link, horario, emoji o eventos del canal, con pasos condicionales; planes pagos',
        'Gatilhos por link, horário, emoji ou eventos do canal, com passos condicionais; planos pagos',
      ],
    }),
    row('workflow-connectors', 'automation', ['Third-party steps in workflows', 'Pasos de otras herramientas en workflows', 'Passos de outras ferramentas nos workflows'], 'missing'),
    row('app-marketplace', 'automation', ['App marketplace', 'Marketplace de apps', 'Marketplace de apps'], 'missing', {
      detail: [
        'Over 2,600 apps; the free plan allows 10',
        'Más de 2.600 apps; el plan gratis permite 10',
        'Mais de 2.600 apps; o plano grátis permite 10',
      ],
    }),
    row('api-bots', 'automation', ['API, bots, slash commands and webhooks', 'API, bots, comandos y webhooks', 'API, bots, comandos e webhooks'], 'missing'),

    // Externos y AI
    row('shared-channels', 'external', ['Channels shared with other companies', 'Canales compartidos con otras empresas', 'Canais compartilhados com outras empresas'], 'missing', {
      detail: [
        'Slack Connect with up to 250 organizations; free plan 1:1 DMs only',
        'Slack Connect con hasta 250 organizaciones; el plan gratis solo DMs 1:1',
        'Slack Connect com até 250 organizações; o plano grátis só DMs 1:1',
      ],
    }),
    row('guests', 'external', ['Guest accounts', 'Cuentas de invitado', 'Contas de convidado'], 'missing', {
      detail: ['Limited to some channels', 'Limitadas a algunos canales', 'Limitadas a alguns canais'],
    }),
    row('ai-summaries', 'external', ['AI summaries of channels and threads', 'Resúmenes de IA de canales e hilos', 'Resumos de IA de canais e threads'], 'missing', {
      detail: ['All paid plans', 'Todos los planes pagos', 'Todos os planos pagos'],
    }),
    row('ai-search-recaps', 'external', ['AI search, daily recaps and translation', 'Búsqueda con IA, recaps diarios y traducción', 'Busca com IA, resumos diários e tradução'], 'missing', {
      detail: ['Business+ and Enterprise+', 'Business+ y Enterprise+', 'Business+ e Enterprise+'],
    }),
    row('ai-agent', 'external', ['Personal AI agent and agents in channels', 'Agente de IA personal y agentes en canales', 'Agente de IA pessoal e agentes em canais'], 'missing', {
      detail: [
        'Slackbot on Business+ and up, plus Agentforce and partner agents in channels and DMs',
        'Slackbot desde Business+, y agentes de Agentforce y de terceros en canales y DMs',
        'Slackbot a partir do Business+, e agentes do Agentforce e de terceiros em canais e DMs',
      ],
    }),

    // Admin
    row('roles', 'admin', ['Member, admin and owner roles', 'Roles de miembro, admin y owner', 'Papéis de membro, admin e owner'], 'missing'),
    row('retention-export', 'admin', ['Retention policies and data export', 'Políticas de retención y export de datos', 'Políticas de retenção e exportação de dados'], 'missing', {
      detail: [
        'Free plan keeps 90 days visible and deletes data older than a year',
        'El plan gratis muestra 90 días y borra lo de más de un año',
        'O plano grátis mostra 90 dias e apaga o que tem mais de um ano',
      ],
    }),
    row('sso-scim', 'admin', ['SSO and SCIM', 'SSO y SCIM', 'SSO e SCIM'], 'missing', {
      detail: ['Google OAuth on Pro, SAML on Business+', 'OAuth de Google en Pro, SAML en Business+', 'OAuth do Google no Pro, SAML no Business+'],
    }),

    // Apps
    row('desktop-app', 'apps', ['Desktop app', 'App de escritorio', 'App desktop'], 'missing', {
      detail: ['Mac, Windows and Linux', 'Mac, Windows y Linux', 'Mac, Windows e Linux'],
    }),
    row('mobile-app', 'apps', ['Mobile apps with push', 'Apps móviles con push', 'Apps mobile com push'], 'missing', {
      weight: 2,
      detail: ['iOS and Android', 'iOS y Android', 'iOS e Android'],
    }),
  ],
};

type Built = { status: ParityStatus; detail?: L };

/** Lo que Talk ya hace (tanda 4d, 2026-10-25). Lo que no está acá sigue en missing. */
const BUILT: Record<string, Built> = {
  'public-channels': { status: 'have' },
  'private-channels': { status: 'have', detail: ['Only members read them; webhooks and flows only get their messages if the person who created them is a member', 'Solo los leen sus miembros; webhooks y flows reciben sus mensajes solo si quien los creó es miembro', 'Só os membros leem; webhooks e flows recebem as mensagens só se quem os criou for membro'] },
  'channel-manage': { status: 'have', detail: ['Rename, topic, description, archive and restore, change to private and delete', 'Renombrar, tema, descripción, archivar y restaurar, pasar a privado y borrar', 'Renomear, tema, descrição, arquivar e restaurar, tornar privado e apagar'] },
  'channel-header': {
    status: 'partial',
    detail: ['Header with topic, members and pinned messages. No bookmarks or tabs yet', 'Encabezado con tema, miembros y mensajes fijados. Todavía sin marcadores ni pestañas', 'Cabeçalho com tema, membros e mensagens fixadas. Ainda sem marcadores nem abas'],
  },
  'sidebar-sections': {
    status: 'partial',
    detail: ['Fixed Starred, Channels and Direct messages sections that collapse. You cannot create your own sections yet', 'Secciones fijas de Destacados, Canales y Mensajes directos, que se colapsan. Todavía no se crean secciones propias', 'Seções fixas de Favoritos, Canais e Mensagens diretas, que recolhem. Ainda não dá para criar seções próprias'],
  },
  'direct-messages': { status: 'have', detail: ['Including a DM with yourself', 'También el DM con vos mismo', 'Também a DM com você mesmo'] },
  'group-dms': { status: 'have', detail: ['Up to 9 people plus you. Converting a group into a private channel is not there yet', 'Hasta 9 personas más vos. Todavía no se convierte un grupo en canal privado', 'Até 9 pessoas mais você. Ainda não dá para converter um grupo em canal privado'] },
  'realtime-messages': {
    status: 'have',
    detail: [
      'SSE over one shared feed per server instance, with short polling as fallback and typing indicator. A message shows up in other tabs in about 0.8 s (median of 5 measurements, Oct 25, 2026)',
      'SSE sobre un feed compartido por instancia del servidor, con polling corto de respaldo y quién está escribiendo. Un mensaje aparece en otras pestañas en unos 0,8 s (mediana de 5 mediciones, 25/10/2026)',
      'SSE sobre um feed compartilhado por instância do servidor, com polling curto de reserva e quem está digitando. Uma mensagem aparece em outras abas em cerca de 0,8 s (mediana de 5 medições, 25/10/2026)',
    ],
  },
  'rich-composer': { status: 'have', detail: ['Toolbar and markup (bold, italic, strikethrough, code, lists, quotes, links), :emoji:, link previews', 'Barra y marcado (negrita, itálica, tachado, código, listas, citas, links), :emoji:, vista previa de links', 'Barra e marcação (negrito, itálico, tachado, código, listas, citações, links), :emoji:, prévia de links'] },
  threads: { status: 'have', detail: ['Side panel with "also send to the channel" and a Threads view', 'Panel lateral con "también enviar al canal" y vista de Hilos', 'Painel lateral com "também enviar ao canal" e visão de Fios'] },
  mentions: { status: 'have', detail: ['People, @channel, @here and workspace teams (the CRM sales teams for now)', 'Personas, @canal, @aquí y equipos del workspace (por ahora los equipos de ventas del CRM)', 'Pessoas, @canal, @aqui e equipes do workspace (por enquanto as equipes de vendas do CRM)'] },
  reactions: { status: 'have', detail: ['No custom workspace emoji yet', 'Todavía sin emoji propios del workspace', 'Ainda sem emoji próprios do workspace'] },
  'edit-delete': { status: 'have', detail: ['Authors edit and delete; workspace admins delete. No admin time limit for edits yet', 'El autor edita y borra; los admins del workspace borran. Todavía sin límite de tiempo para editar', 'O autor edita e apaga; os admins do workspace apagam. Ainda sem limite de tempo para editar'] },
  'scheduled-messages': { status: 'have' },
  'pinned-messages': { status: 'have' },
  'file-sharing': { status: 'have', detail: ['Images shown inline and files up to 10 MB, served only to people who can read the channel', 'Imágenes en línea y archivos de hasta 10 MB, que solo ve quien puede leer el canal', 'Imagens em linha e arquivos de até 10 MB, que só vê quem pode ler o canal'] },
  'file-browser': { status: 'have' },
  'message-search': { status: 'have', detail: ['in:, from:, has:, is:, before:, after:, on:, during:, exact phrases and exclusions. Text match, no ranking', 'in:, from:, has:, is:, before:, after:, on:, during:, frases exactas y exclusiones. Coincidencia de texto, sin ranking', 'in:, from:, has:, is:, before:, after:, on:, during:, frases exatas e exclusões. Correspondência de texto, sem ranking'] },
  unreads: { status: 'have', detail: ['Unread and mention counts per channel, a New line and a Mentions view', 'Sin leer y menciones por canal, línea de Nuevos y vista de Menciones', 'Não lidas e menções por canal, linha de Novas e visão de Menções'] },
  'save-later': { status: 'have', detail: ['Later with saved messages, reminders on a message and /remind', 'Más tarde con guardados, recordatorios en un mensaje y /recordar', 'Mais tarde com salvas, lembretes em uma mensagem e /lembrar'] },
  notifications: {
    status: 'partial',
    detail: ['Bell and email for unread mentions and DMs, per channel and general levels, keywords and pausing for an hour. No browser push or do not disturb schedule yet', 'Campana y email de menciones y DMs sin leer, niveles por canal y generales, palabras clave y pausa de una hora. Todavía sin push del navegador ni horario de no molestar', 'Sino e e-mail de menções e DMs não lidas, níveis por canal e gerais, palavras-chave e pausa de uma hora. Ainda sem push do navegador nem horário de não perturbe'],
  },
  status: { status: 'have' },
  presence: { status: 'have', detail: ['Active or away by activity, and manual away', 'Activo o ausente por actividad, y ausente a mano', 'Ativo ou ausente pela atividade, e ausente manual'] },
  profiles: {
    status: 'partial',
    detail: ['Name, photo, status and presence. No title, time zone or custom fields yet', 'Nombre, foto, estado y presencia. Todavía sin cargo, zona horaria ni campos propios', 'Nome, foto, status e presença. Ainda sem cargo, fuso horário nem campos próprios'],
  },
  'workflow-builder': {
    status: 'partial',
    detail: ['Through Flow: a "message in a channel" trigger and a "send message" action. No builder inside Talk', 'A través de Flow: disparador "mensaje en un canal" y acción "enviar mensaje". Sin editor dentro de Talk', 'Pelo Flow: gatilho "mensagem em um canal" e ação "enviar mensagem". Sem editor dentro do Talk'],
  },
  'workflow-connectors': {
    status: 'partial',
    detail: ['The Flow connectors work with Talk events and messages; there are no Talk-specific connector steps', 'Los conectores de Flow funcionan con los eventos y mensajes de Talk; no hay pasos propios de Talk', 'Os conectores do Flow funcionam com os eventos e mensagens do Talk; não há passos próprios do Talk'],
  },
  'api-bots': {
    status: 'partial',
    detail: [
      'API v1 for channels and their messages (talk:read, talk:write; direct messages are not exposed), incoming webhooks per channel and outgoing workspace webhooks. No slash commands or interactive bots yet',
      'API v1 de canales y sus mensajes (talk:read, talk:write; los mensajes directos no se exponen), webhooks entrantes por canal y webhooks salientes del workspace. Todavía sin slash commands ni bots interactivos',
      'API v1 de canais e suas mensagens (talk:read, talk:write; as mensagens diretas não são expostas), webhooks de entrada por canal e webhooks de saída do workspace. Ainda sem slash commands nem bots interativos',
    ],
  },
  roles: {
    status: 'partial',
    detail: ['Workspace owner, admin and member, plus channel admins. No finer roles', 'Owner, admin y miembro del workspace, más admins de canal. Sin roles más finos', 'Owner, admin e membro do workspace, mais admins de canal. Sem papéis mais finos'],
  },
};

for (const r of parity.rows) {
  const b = BUILT[r.id];
  if (!b) continue;
  r.status = b.status;
  if (b.detail) r.detail = loc(b.detail);
}

export default parity;
