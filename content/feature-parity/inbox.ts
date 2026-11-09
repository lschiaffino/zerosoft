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
 * Inbox contra Superhuman (correo), mirando también WhatsApp Web (chats) y la
 * app local inbox-zero que reemplaza. Lo probado solo con proveedores falsos
 * (WhatsApp por QR, Gmail, IA) queda como partial hasta pasarlo con cuentas
 * reales. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Superhuman',
  alsoCompared: ['WhatsApp Web', 'inbox-zero'],
  lastReviewed: '2026-11-08',
  areas: [
    { id: 'channels', label: loc(['Accounts', 'Cuentas', 'Contas']) },
    { id: 'triage', label: loc(['Triage', 'Ordenar', 'Triagem']) },
    { id: 'writing', label: loc(['Writing', 'Escribir', 'Escrita']) },
    { id: 'navigation', label: loc(['Keyboard and search', 'Teclado y búsqueda', 'Teclado e busca']) },
    { id: 'platform', label: loc(['Platform', 'Plataforma', 'Plataforma']) },
    { id: 'whatsapp', label: loc(['WhatsApp Web', 'WhatsApp Web', 'WhatsApp Web']) },
  ],
  rows: [
    // Cuentas
    row('gmail', 'channels', ['Gmail', 'Gmail', 'Gmail'], 'partial', {
      weight: 2,
      detail: [
        'Google sign-in, threads from the last 60 days and changes every two minutes. Plain text, no attachments yet. Tested against a mocked Gmail API',
        'Entrar con Google, hilos de los últimos 60 días y cambios cada dos minutos. Texto plano, todavía sin adjuntos. Probado contra la API de Gmail simulada',
        'Entrar com o Google, conversas dos últimos 60 dias e mudanças a cada dois minutos. Texto simples, ainda sem anexos. Testado contra a API do Gmail simulada',
      ],
    }),
    row('outlook', 'channels', ['Outlook and Microsoft 365', 'Outlook y Microsoft 365', 'Outlook e Microsoft 365'], 'missing'),
    row('multi-account', 'channels', ['Several accounts', 'Varias cuentas', 'Várias contas'], 'partial', {
      detail: ['Several Gmail accounts and one WhatsApp, in the same list', 'Varios Gmail y un WhatsApp, en la misma lista', 'Vários Gmail e um WhatsApp, na mesma lista'],
    }),
    row('whatsapp', 'channels', ['Personal WhatsApp by QR', 'WhatsApp personal por QR', 'WhatsApp pessoal por QR'], 'partial', {
      competitorHas: false,
      detail: [
        'Linked like WhatsApp Web on our WhatsApp server: text, photos, audio, documents, groups, delivery ticks and recent history. Tested with the fake provider and in use with a real account',
        'Vinculado como WhatsApp Web en nuestro servidor de WhatsApp: texto, fotos, audios, documentos, grupos, tildes de entrega e historial reciente. Probado con el proveedor falso y en uso con una cuenta real',
        'Vinculado como o WhatsApp Web no nosso servidor de WhatsApp: texto, fotos, áudios, documentos, grupos, confirmações de entrega e histórico recente. Testado com o provedor falso e em uso com uma conta real',
      ],
    }),

    // Ordenar
    row('done', 'triage', ['Mark done (archive)', 'Marcar hecho (archivar)', 'Concluir (arquivar)'], 'have', {
      weight: 2,
      detail: ['E, from the list or the conversation. In Gmail it removes the thread from the inbox', 'E, desde la lista o la conversación. En Gmail saca el hilo de la bandeja', 'E, da lista ou da conversa. No Gmail tira a conversa da caixa'],
    }),
    row('snooze', 'triage', ['Snooze (remind me)', 'Posponer', 'Adiar'], 'have', {
      weight: 2,
      detail: ['H with six presets or any date. A new message brings it back early', 'H con seis opciones o cualquier fecha. Un mensaje nuevo lo trae antes', 'H com seis opções ou qualquer data. Uma mensagem nova traz de volta antes'],
    }),
    row('follow-up', 'triage', ['Remind me if there is no reply', 'Recordame si no contesta', 'Lembrar se não responder'], 'have', {
      detail: ['F. If they reply in the meantime the reminder clears by itself', 'F. Si contesta antes, el recordatorio se borra solo', 'F. Se responderem antes, o lembrete some sozinho'],
    }),
    row('splits', 'triage', ['Split inbox', 'Bandeja dividida (splits)', 'Caixa dividida (splits)'], 'partial', {
      weight: 2,
      detail: [
        'Fixed views (to reply, waiting, unread, WhatsApp, email, groups) and your folders with rules by channel, kind and name. No VIP or calendar splits',
        'Vistas fijas (por responder, esperando, no leídos, WhatsApp, correo, grupos) y tus carpetas con reglas por canal, tipo y nombre. Sin splits de VIP ni de calendario',
        'Visões fixas (para responder, aguardando, não lidos, WhatsApp, e-mail, grupos) e suas pastas com regras por canal, tipo e nome. Sem splits de VIP nem de calendário',
      ],
    }),
    row('auto-labels', 'triage', ['AI labels and auto-archive', 'Etiquetas por IA y archivado automático', 'Etiquetas por IA e arquivamento automático'], 'missing'),
    row('bulk', 'triage', ['Act on several at once', 'Varios a la vez', 'Vários de uma vez'], 'have', {
      detail: ['X or Shift+click to select, then done, snooze or folder', 'X o Shift+clic para elegir, después hecho, posponer o carpeta', 'X ou Shift+clique para selecionar, depois concluir, adiar ou pasta'],
    }),
    row('undo', 'triage', ['Undo', 'Deshacer', 'Desfazer'], 'have', {
      detail: ['Z or the toast button undoes the last action', 'Z o el botón del aviso deshace lo último', 'Z ou o botão do aviso desfaz a última ação'],
    }),
    row('read-state', 'triage', ['Read and unread', 'Leído y no leído', 'Lido e não lido'], 'have', {
      detail: ['U. Mirrored in Gmail; on WhatsApp it stays in Inbox', 'U. Se refleja en Gmail; en WhatsApp queda en Inbox', 'U. Espelhado no Gmail; no WhatsApp fica no Inbox'],
    }),
    row('pin-mute', 'triage', ['Pin and mute', 'Fijar y silenciar', 'Fixar e silenciar'], 'have', { competitorHas: false }),

    // Escribir
    row('send-later', 'writing', ['Send later', 'Enviar más tarde', 'Enviar mais tarde'], 'have', {
      weight: 2,
      detail: ['From the reply field, with send now, edit time and cancel. Sent by the server even with the tab closed', 'Desde el campo, con enviar ya, cambiar hora y cancelar. Lo manda el servidor aunque cierres la pestaña', 'Pelo campo, com enviar agora, mudar horário e cancelar. O servidor envia mesmo com a aba fechada'],
    }),
    row('snippets', 'writing', ['Snippets', 'Snippets', 'Snippets'], 'have', {
      detail: ['; and the shortcut, with the chat name as a variable. Not shared with a team', '; y el atajo, con el nombre del chat como variable. Sin compartir con un equipo', '; e o atalho, com o nome da conversa como variável. Sem compartilhar com uma equipe'],
    }),
    row('ai-write', 'writing', ['Write with AI', 'Escribir con IA', 'Escrever com IA'], 'partial', {
      weight: 2,
      detail: [
        'Draft from the conversation and your notes, or rewrite shorter, warmer, more formal or corrected. Tested with the fake model',
        'Borrador con la conversación y tus notas, o reescribir más corto, más cálido, más formal o corregido. Probado con el modelo falso',
        'Rascunho com a conversa e suas notas, ou reescrever mais curto, mais caloroso, mais formal ou corrigido. Testado com o modelo falso',
      ],
    }),
    row('dictation', 'writing', ['Dictation', 'Dictado', 'Ditado'], 'better', {
      competitorHas: false,
      detail: ['Voice dictation in any field (Alt+Space) and from the reply field', 'Dictado de Voice en cualquier campo (Alt+Espacio) y desde el campo de respuesta', 'Ditado do Voice em qualquer campo (Alt+Espaço) e pelo campo de resposta'],
    }),
    row('undo-send', 'writing', ['Undo send', 'Deshacer envío', 'Desfazer envio'], 'missing'),
    row('read-receipts', 'writing', ['Email read receipts', 'Confirmación de lectura en correos', 'Confirmação de leitura em e-mails'], 'missing'),
    row('rich-email', 'writing', ['Formatting, signatures and attachments', 'Formato, firmas y adjuntos', 'Formatação, assinaturas e anexos'], 'missing'),

    // Teclado y búsqueda
    row('shortcuts', 'navigation', ['Keyboard shortcuts', 'Atajos de teclado', 'Atalhos de teclado'], 'have', {
      weight: 2,
      detail: ['J, K, E, H, F, R, C, U, P, V, X, Z, /, g + letter and ? for the list', 'J, K, E, H, F, R, C, U, P, V, X, Z, /, g + letra y ? para la lista', 'J, K, E, H, F, R, C, U, P, V, X, Z, /, g + letra e ? para a lista'],
    }),
    row('command', 'navigation', ['Command palette', 'Paleta de comandos', 'Paleta de comandos'], 'partial', {
      detail: ['Cmd+K finds your chats and Inbox views across the suite; actions are shortcuts, not commands', 'Cmd+K encuentra tus chats y vistas de Inbox en toda la suite; las acciones son atajos, no comandos', 'Cmd+K encontra suas conversas e visões do Inbox em toda a suíte; as ações são atalhos, não comandos'],
    }),
    row('search', 'navigation', ['Search', 'Búsqueda', 'Busca'], 'partial', {
      detail: ['Names, numbers, emails and the text of every saved message, including Done. No search operators', 'Nombres, números, emails y el texto de todos los mensajes guardados, también Hechos. Sin operadores', 'Nomes, números, e-mails e o texto de todas as mensagens salvas, inclusive Concluídos. Sem operadores'],
    }),
    row('contact-context', 'navigation', ['Context about the person', 'Contexto de la persona', 'Contexto da pessoa'], 'partial', {
      detail: ['Private notes per chat, used by the AI drafts. No social profiles', 'Notas privadas por chat, que usan los borradores con IA. Sin perfiles sociales', 'Notas privadas por conversa, usadas pelos rascunhos com IA. Sem perfis sociais'],
    }),
    row('calendar', 'navigation', ['Calendar in the inbox', 'Calendario en la bandeja', 'Calendário na caixa'], 'missing'),

    // Plataforma
    row('mobile', 'platform', ['Mobile apps', 'Apps móviles', 'Apps móveis'], 'partial', {
      detail: ['The web app works at phone width, one panel at a time. No native app', 'La web funciona en el teléfono, un panel por vez. Sin app nativa', 'A web funciona no celular, um painel por vez. Sem app nativo'],
    }),
    row('team', 'platform', ['Share and comment with a team', 'Compartir y comentar con un equipo', 'Compartilhar e comentar com uma equipe'], 'missing'),
    row('privacy', 'platform', ['Private to the person', 'Privado de la persona', 'Privado da pessoa'], 'better', {
      competitorHas: false,
      detail: ['Belongs to your user, not the workspace; no admin view, no API keys or MCP. Tokens encrypted', 'Es de tu usuario, no del workspace; sin vista de admin, API keys ni MCP. Tokens cifrados', 'É do seu usuário, não do workspace; sem visão de admin, API keys nem MCP. Tokens criptografados'],
    }),
    row('deleted-kept', 'platform', ['Messages deleted for everyone stay visible', 'Los mensajes borrados para todos se siguen viendo', 'Mensagens apagadas para todos continuam visíveis'], 'have', { competitorHas: false }),
    row('import', 'platform', ['Import from inbox-zero', 'Importar desde inbox-zero', 'Importar do inbox-zero'], 'have', {
      competitorHas: false,
      detail: ['Folders, scheduled, drafts, snoozes, notes and saved history from the local inbox.db', 'Carpetas, programados, borradores, pospuestos, notas e historial guardado del inbox.db local', 'Pastas, agendadas, rascunhos, adiadas, notas e histórico salvo do inbox.db local'],
    }),
    row('self-host', 'platform', ['Run it on your own server', 'Correrlo en tu servidor', 'Rodar no seu servidor'], 'have', { competitorHas: false }),

    // WhatsApp Web (la lista, la conversación y la info del contacto, como en WhatsApp)
    row('wa-names', 'whatsapp', ['Real chat names', 'Nombres reales de los chats', 'Nomes reais das conversas'], 'partial', {
      detail: [
        'Group subject and contact profile from the WhatsApp server, refreshed every three days; never the raw id. Tested with the fake provider and the real payload shapes',
        'Asunto del grupo y perfil del contacto desde el servidor de WhatsApp, renovados cada tres días; nunca el id crudo. Probado con el proveedor falso y la forma real de los datos',
        'Assunto do grupo e perfil do contato vindos do servidor do WhatsApp, renovados a cada três dias; nunca o id cru. Testado com o provedor falso e o formato real dos dados',
      ],
    }),
    row('wa-photos', 'whatsapp', ['Profile photos', 'Fotos de perfil', 'Fotos de perfil'], 'partial', {
      detail: [
        'Contacts and groups, served with your session and cached privately in the browser; an expired link is renewed. Tested with the fake provider',
        'Contactos y grupos, servidas con tu sesión y guardadas en la caché privada del navegador; un link vencido se renueva. Probado con el proveedor falso',
        'Contatos e grupos, servidas com sua sessão e guardadas no cache privado do navegador; um link vencido é renovado. Testado com o provedor falso',
      ],
    }),
    row('wa-list', 'whatsapp', ['Chat list like WhatsApp', 'Lista de chats como WhatsApp', 'Lista de conversas como o WhatsApp'], 'partial', {
      detail: [
        'Photo, name, time, ticks, sender in groups, media icon, typing, muted, unread and pinned. Filters are Inbox views, not WhatsApp lists',
        'Foto, nombre, hora, tildes, quién mandó en grupos, ícono de media, escribiendo, silenciado, no leídos y fijado. Los filtros son las vistas de Inbox, no las listas de WhatsApp',
        'Foto, nome, hora, confirmações, quem enviou em grupos, ícone de mídia, digitando, silenciado, não lidas e fixada. Os filtros são as visões do Inbox, não as listas do WhatsApp',
      ],
    }),
    row('wa-conversation', 'whatsapp', ['Conversation like WhatsApp Web', 'Conversación como WhatsApp Web', 'Conversa como o WhatsApp Web'], 'partial', {
      detail: [
        'Wallpaper, bubbles with tails, grouped messages, day chips, sender names in color, ticks, edited, forwarded and deleted, in light and dark. No chat search or pinned messages yet',
        'Fondo, burbujas con cola, mensajes agrupados, separadores de día, nombres de color, tildes, editado, reenviado y borrado, en claro y oscuro. Todavía sin buscar en el chat ni mensajes fijados',
        'Fundo, balões com ponta, mensagens agrupadas, separadores de dia, nomes coloridos, confirmações, editada, encaminhada e apagada, no claro e no escuro. Ainda sem busca na conversa nem mensagens fixadas',
      ],
    }),
    row('wa-message-actions', 'whatsapp', ['Reply, react, forward, copy, edit, delete, star', 'Responder, reaccionar, reenviar, copiar, editar, borrar, destacar', 'Responder, reagir, encaminhar, copiar, editar, apagar, favoritar'], 'partial', {
      detail: [
        'From the arrow menu, right click or a long press. Forwarding sends a copy of the text (no "Forwarded" mark on the other side, no media). Message info shows delivered and read, not the time',
        'Desde la flecha, el clic derecho o un toque largo. Reenviar manda una copia del texto (sin la marca "Reenviado" del otro lado ni archivos). La info del mensaje muestra entregado y leído, sin la hora',
        'Pela seta, clique direito ou toque longo. Encaminhar envia uma cópia do texto (sem a marca "Encaminhada" do outro lado nem arquivos). Os dados da mensagem mostram entregue e lida, sem a hora',
      ],
    }),
    row('wa-media-view', 'whatsapp', ['Photos, video, voice notes, documents, stickers, locations, contacts, polls', 'Fotos, video, notas de voz, documentos, stickers, ubicaciones, contactos, encuestas', 'Fotos, vídeo, notas de voz, documentos, figurinhas, localizações, contatos, enquetes'], 'partial', {
      detail: [
        'Viewer for photos and videos, voice notes with speed control. Polls are read only (vote on the phone). View once is not delivered to linked devices',
        'Visor de fotos y videos, notas de voz con velocidad. Las encuestas se ven pero se votan en el teléfono. "Ver una vez" no llega a los dispositivos vinculados',
        'Visualizador de fotos e vídeos, notas de voz com velocidade. As enquetes aparecem mas se vota no celular. "Visualização única" não chega aos aparelhos vinculados',
      ],
    }),
    row('wa-send-media', 'whatsapp', ['Send files, drag and drop, paste', 'Mandar archivos, arrastrar y pegar', 'Enviar arquivos, arrastar e colar'], 'partial', {
      detail: [
        'Several files at once with a caption each and a preview before sending; voice notes from the microphone. Over 4 MB needs Blob storage on the server. Tested with the fake provider',
        'Varios archivos juntos, con un comentario cada uno y vista previa antes de enviar; notas de voz con el micrófono. Más de 4 MB necesita Blob en el servidor. Probado con el proveedor falso',
        'Vários arquivos de uma vez, com legenda em cada um e prévia antes de enviar; notas de voz pelo microfone. Mais de 4 MB precisa de Blob no servidor. Testado com o provedor falso',
      ],
    }),
    row('wa-mentions', 'whatsapp', ['Mentions in groups', 'Menciones en grupos', 'Menções em grupos'], 'partial', {
      detail: [
        'Type @ to mention a member; received mentions show the name when it is known. Members without a visible number can not be mentioned',
        'Con @ se menciona a alguien del grupo; las menciones que llegan muestran el nombre si se conoce. No se puede mencionar a quien no tiene el número visible',
        'Com @ se menciona alguém do grupo; as menções recebidas mostram o nome quando é conhecido. Não dá para mencionar quem não tem o número visível',
      ],
    }),
    row('wa-link-previews', 'whatsapp', ['Link previews', 'Vista previa de links', 'Prévia de links'], 'partial', {
      detail: ['The preview the other phone sends is shown. Messages sent from here go without a preview', 'Se ve la vista previa que manda el otro teléfono. Lo que se manda desde acá sale sin vista previa', 'Aparece a prévia que o outro celular envia. O que se envia daqui sai sem prévia'],
    }),
    row('wa-contact-info', 'whatsapp', ['Contact and group info', 'Info del contacto y del grupo', 'Dados do contato e do grupo'], 'partial', {
      detail: [
        'Photo, name, number or members with admins, about or description, shared photos, documents and links, starred messages, groups in common, mute and block. Leaving or editing a group is done on the phone',
        'Foto, nombre, número o integrantes con sus admins, info o descripción, fotos, documentos y enlaces compartidos, destacados, grupos en común, silenciar y bloquear. Salir o editar un grupo se hace en el teléfono',
        'Foto, nome, número ou membros com os admins, recado ou descrição, fotos, documentos e links compartilhados, favoritas, grupos em comum, silenciar e bloquear. Sair ou editar um grupo é feito no celular',
      ],
    }),
    row('wa-ai-summary', 'whatsapp', ['AI summary of a chat', 'Resumen con IA de un chat', 'Resumo com IA de uma conversa'], 'better', {
      competitorHas: false,
      detail: [
        'In the info panel: the relationship and what is pending with a contact, or the recent activity of a group. Made only from that chat and your notes, and saved until there are new messages',
        'En el panel de info: la relación y lo pendiente con un contacto, o lo último de un grupo. Hecho solo con ese chat y tus notas, y guardado hasta que haya mensajes nuevos',
        'No painel de dados: a relação e o que está pendente com um contato, ou o que rolou num grupo. Feito só com essa conversa e suas notas, e salvo até chegarem mensagens novas',
      ],
    }),
    row('wa-mobile', 'whatsapp', ['Phone gestures', 'Gestos del teléfono', 'Gestos do celular'], 'partial', {
      detail: [
        'Swipe a message right to reply, swipe a chat left for Done or right to pin, long press for the menu. In the browser, not a native app',
        'Deslizar un mensaje a la derecha para responder, un chat a la izquierda para Hecho o a la derecha para fijar, toque largo para el menú. En el navegador, no es una app nativa',
        'Deslizar uma mensagem para a direita para responder, uma conversa para a esquerda para Concluir ou para a direita para fixar, toque longo para o menu. No navegador, não é um app nativo',
      ],
    }),
    row('wa-reactions-live', 'whatsapp', ['Reactions and typing arrive live', 'Reacciones y "escribiendo" en vivo', 'Reações e "digitando" ao vivo'], 'partial', {
      detail: [
        'Stored as they arrive from WhatsApp and shown on the next refresh (a few seconds). Typing depends on WhatsApp sending presence',
        'Se guardan al llegar de WhatsApp y se ven en la próxima actualización (unos segundos). "Escribiendo" depende de que WhatsApp mande la presencia',
        'São salvas quando chegam do WhatsApp e aparecem na próxima atualização (alguns segundos). "Digitando" depende de o WhatsApp enviar a presença',
      ],
    }),
  ],
};

export default parity;
