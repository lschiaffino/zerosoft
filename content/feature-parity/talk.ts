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
 * Talk todavía no existe (solo un shell "Próximamente"), así que todas las
 * filas están en missing. Los ids son estables: las tandas siguientes los
 * pasan a have a medida que se construyen.
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
    { id: 'external', label: loc(['External people and AI', 'Externos y AI', 'Externos e IA']) },
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
    row('huddle-notes', 'huddles', ['Huddle thread and AI notes', 'Hilo y notas AI del huddle', 'Thread e notas de IA do huddle'], 'missing', {
      detail: [
        'Each huddle has a thread and a canvas; AI notes on paid plans',
        'Cada huddle tiene hilo y canvas; notas AI en los planes pagos',
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
    row('ai-summaries', 'external', ['AI summaries of channels and threads', 'Resúmenes AI de canales e hilos', 'Resumos de IA de canais e threads'], 'missing', {
      detail: ['All paid plans', 'Todos los planes pagos', 'Todos os planos pagos'],
    }),
    row('ai-search-recaps', 'external', ['AI search, daily recaps and translation', 'Búsqueda AI, recaps diarios y traducción', 'Busca com IA, resumos diários e tradução'], 'missing', {
      detail: ['Business+ and Enterprise+', 'Business+ y Enterprise+', 'Business+ e Enterprise+'],
    }),
    row('ai-agent', 'external', ['Personal AI agent and agents in channels', 'Agente AI personal y agentes en canales', 'Agente de IA pessoal e agentes em canais'], 'missing', {
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

export default parity;
