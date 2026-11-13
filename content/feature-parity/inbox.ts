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
  lastReviewed: '2026-11-12',
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
    row('folders', 'triage', ['Folders and subfolders', 'Carpetas y subcarpetas', 'Pastas e subpastas'], 'have', {
      detail: [
        'Nested folders in the sidebar that collapse, unread counts that add up to the parent, hold a chat (or a selection) and drop it on a folder with undo, and drag folders to sort or nest them. V and Alt+arrows from the keyboard',
        'Carpetas anidadas en la barra que se pliegan, no leídos que suben al padre, mantener apretado un chat (o una selección) y soltarlo en una carpeta con deshacer, y arrastrar carpetas para ordenarlas o anidarlas. V y Alt+flechas desde el teclado',
        'Pastas aninhadas na barra que recolhem, não lidos que sobem para a pasta mãe, segurar uma conversa (ou uma seleção) e soltar numa pasta com desfazer, e arrastar pastas para ordenar ou aninhar. V e Alt+setas pelo teclado',
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
      detail: [
        'From the reply field, one message or a sequence where each one is its own bubble, with waits between them and a file (WhatsApp). Edit, send now or cancel. Sent by the server even with the tab closed',
        'Desde el campo, un mensaje o una secuencia donde cada uno es su burbuja, con esperas entre ellos y un archivo (WhatsApp). Editar, enviar ya o cancelar. Lo manda el servidor aunque cierres la pestaña',
        'Pelo campo, uma mensagem ou uma sequência em que cada uma é sua bolha, com esperas entre elas e um arquivo (WhatsApp). Editar, enviar agora ou cancelar. O servidor envia mesmo com a aba fechada',
      ],
    }),
    row('snippets', 'writing', ['Snippets', 'Snippets', 'Snippets'], 'have', {
      detail: ['; and the shortcut (or / and the shortcut), with the chat name as a variable. Not shared with a team', '; y el atajo (o / y el atajo), con el nombre del chat como variable. Sin compartir con un equipo', '; e o atalho (ou / e o atalho), com o nome da conversa como variável. Sem compartilhar com uma equipe'],
    }),
    row('ai-write', 'writing', ['Write with AI', 'Escribir con IA', 'Escrever com IA'], 'partial', {
      weight: 2,
      detail: [
        'Help me write, in WhatsApp chats, email threads and New message: describe the message and it is drafted in your tone (learned from what you send) for that channel, with a subject on a new email. Review it before it reaches the field, refine it (shorter, longer, tone, grammar, your own change), translate it, insert it and undo. With text already typed it improves that text. The text streams in. Tested with the fake model',
        'Ayudame a escribir, en chats de WhatsApp, hilos de correo y Mensaje nuevo: describís el mensaje y se redacta con tu tono (aprendido de lo que enviás) para ese canal, con asunto en un correo nuevo. Lo revisás antes de que llegue al campo, lo ajustás (más corto, más largo, tono, gramática, un cambio propio), lo traducís, lo insertás y podés deshacer. Con texto ya escrito, mejora ese texto. El texto llega de a poco. Probado con el modelo falso',
        'Ajude-me a escrever, em conversas do WhatsApp, fios de e-mail e Nova mensagem: você descreve a mensagem e ela é redigida no seu tom (aprendido do que você envia) para esse canal, com assunto num e-mail novo. Você revisa antes de chegar ao campo, ajusta (mais curto, mais longo, tom, gramática, uma mudança sua), traduz, insere e pode desfazer. Com texto já escrito, melhora esse texto. O texto chega aos poucos. Testado com o modelo falso',
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
      detail: ['Cmd+K finds your chats and Inbox views across the suite. The actions of the open chat are commands in its message field (type /), not in Cmd+K', 'Cmd+K encuentra tus chats y vistas de Inbox en toda la suite. Las acciones del chat abierto son comandos en su campo de mensaje (escribí /), no en Cmd+K', 'Cmd+K encontra suas conversas e visões do Inbox em toda a suíte. As ações da conversa aberta são comandos no campo de mensagem (digite /), não no Cmd+K'],
    }),
    row('search', 'navigation', ['Search', 'Búsqueda', 'Busca'], 'have', {
      detail: [
        'Full-text search over every message (text, transcribed audio, file names and senders) with highlighted results that jump to the message, plus from:, in:, has:, before: and after: filters. Also from Cmd+K',
        'Texto completo en todos los mensajes (texto, audios transcriptos, nombres de archivo y quién escribió), con resultados resaltados que llevan al mensaje y filtros from:, in:, has:, before: y after:. También desde Cmd+K',
        'Texto completo em todas as mensagens (texto, áudios transcritos, nomes de arquivo e quem escreveu), com resultados destacados que levam à mensagem e filtros from:, in:, has:, before: e after:. Também pelo Cmd+K',
      ],
    }),
    row('contact-context', 'navigation', ['Context about the person', 'Contexto de la persona', 'Contexto da pessoa'], 'partial', {
      detail: ['Private notes per chat, used by the AI drafts. No social profiles', 'Notas privadas por chat, que usan los borradores con IA. Sin perfiles sociales', 'Notas privadas por conversa, usadas pelos rascunhos com IA. Sem perfis sociais'],
    }),
    row('calendar', 'navigation', ['Calendar in the inbox', 'Calendario en la bandeja', 'Calendário na caixa'], 'missing'),

    // Plataforma
    row('mobile', 'platform', ['Mobile apps', 'Apps móviles', 'Apps móveis'], 'partial', {
      detail: ['The web app works at phone width, one panel at a time. No native app', 'La web funciona en el teléfono, un panel por vez. Sin app nativa', 'A web funciona no celular, um painel por vez. Sem app nativo'],
    }),
    row('insights', 'platform', ['Inbox analytics', 'Analítica del Inbox', 'Análise do Inbox'], 'have', {
      detail: [
        'Received and sent per day by channel (WhatsApp, email, groups), your first response time, chats to reply and waiting, done and archived, when messages arrive. Only you see it',
        'Recibidos y enviados por día y canal (WhatsApp, email, grupos), tu tiempo de primera respuesta, chats por responder y esperando, hechos y archivados, cuándo llegan los mensajes. Solo lo ves vos',
        'Recebidas e enviadas por dia e canal (WhatsApp, email, grupos), seu tempo de primeira resposta, conversas para responder e aguardando, feitas e arquivadas, quando as mensagens chegam. Só você vê',
      ],
    }),
    row('team', 'platform', ['Share and comment with a team', 'Compartir y comentar con un equipo', 'Compartilhar e comentar com uma equipe'], 'missing'),
    row('privacy', 'platform', ['Private to the person', 'Privado de la persona', 'Privado da pessoa'], 'better', {
      competitorHas: false,
      detail: ['Belongs to your user, not the workspace; no admin view, no API keys or MCP. Tokens encrypted', 'Es de tu usuario, no del workspace; sin vista de admin, API keys ni MCP. Tokens cifrados', 'É do seu usuário, não do workspace; sem visão de admin, API keys nem MCP. Tokens criptografados'],
    }),
    row('deleted-kept', 'platform', ['Messages deleted for everyone stay visible', 'Los mensajes borrados para todos se siguen viendo', 'Mensagens apagadas para todos continuam visíveis'], 'have', { competitorHas: false }),
    row('import', 'platform', ['Import from inbox-zero', 'Importar desde inbox-zero', 'Importar do inbox-zero'], 'have', {
      competitorHas: false,
      detail: [
        'Folders, scheduled, drafts, snoozes, notes and saved history from the local inbox.db, plus the full WhatsApp Desktop history of that Mac. Large files upload directly and keep importing in the background; importing twice never duplicates',
        'Carpetas, programados, borradores, pospuestos, notas e historial guardado del inbox.db local, más la historia completa de WhatsApp Desktop de esa Mac. Los archivos grandes suben directo y siguen importándose en segundo plano; importar dos veces no duplica',
        'Pastas, agendadas, rascunhos, adiadas, notas e histórico salvo do inbox.db local, mais o histórico completo do WhatsApp Desktop desse Mac. Arquivos grandes sobem direto e continuam importando em segundo plano; importar duas vezes não duplica',
      ],
    }),
    row('history-import', 'platform', ['Full WhatsApp history', 'Todo el historial de WhatsApp', 'Todo o histórico do WhatsApp'], 'partial', {
      competitorHas: false,
      detail: [
        'Brings every chat and every message the WhatsApp server stored, page by page, with progress, pause and resume. It starts by itself when WhatsApp is linked; how far back it goes depends on what the phone sends when linking. Gmail brings all the mail of the account the same way. Tested with the fake server',
        'Trae todos los chats y todos los mensajes que guardó el servidor de WhatsApp, página por página, con avance, pausa y seguir. Arranca sola al vincular WhatsApp; hasta dónde llega depende de lo que el teléfono manda al vincular. Gmail trae todo el correo de la cuenta de la misma forma. Probado con el servidor falso',
        'Traz todas as conversas e todas as mensagens que o servidor do WhatsApp guardou, página por página, com progresso, pausa e continuar. Começa sozinha ao vincular o WhatsApp; até onde chega depende do que o celular envia ao vincular. O Gmail traz todo o e-mail da conta do mesmo jeito. Testado com o servidor falso',
      ],
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
        'Viewer for photos and videos, photos sent together grouped in an album, voice notes with speed control. Polls are read only (vote on the phone). View once is not delivered to linked devices',
        'Visor de fotos y videos, fotos mandadas juntas en un álbum, notas de voz con velocidad. Las encuestas se ven pero se votan en el teléfono. "Ver una vez" no llega a los dispositivos vinculados',
        'Visualizador de fotos e vídeos, fotos enviadas juntas num álbum, notas de voz com velocidade. As enquetes aparecem mas se vota no celular. "Visualização única" não chega aos aparelhos vinculados',
      ],
    }),
    row('wa-stickers', 'whatsapp', ['Stickers and GIFs: see, send, favorites', 'Stickers y GIF: verlos, mandarlos, favoritos', 'Figurinhas e GIFs: ver, enviar, favoritas'], 'partial', {
      detail: [
        'Received stickers show small and without a bubble (animated ones move), GIFs play inside the bubble. The Stickers tab of the emoji panel has recent ones, favorites and your collection; WhatsApp does not let linked devices read the stickers saved on the phone, so the collection is built from the stickers in your chats (one click to import, then it stays up to date) and from images you turn into stickers. Lottie stickers show as a placeholder. Tested with the fake provider',
        'Los stickers que llegan se ven chicos y sin burbuja (los animados se mueven) y los GIF se reproducen en la burbuja. La pestaña Stickers del panel de emojis tiene recientes, favoritos y tu colección; WhatsApp no deja que los dispositivos vinculados lean los stickers guardados en el teléfono, así que la colección se arma con los stickers de tus chats (un clic para importarlos y después se mantiene sola) y con imágenes que convertís en sticker. Los stickers Lottie se ven como un lugar vacío. Probado con el proveedor falso',
        'As figurinhas recebidas aparecem pequenas e sem balão (as animadas se mexem) e os GIFs tocam no balão. A aba Figurinhas do painel de emojis tem recentes, favoritas e a sua coleção; o WhatsApp não deixa aparelhos vinculados lerem as figurinhas salvas no celular, então a coleção é montada com as figurinhas das suas conversas (um clique para importar e depois se atualiza sozinha) e com imagens que você transforma em figurinha. Figurinhas Lottie aparecem como um espaço vazio. Testado com o provedor falso',
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
        'Type @ to mention a member; received mentions show the name (or the number) also when WhatsApp sends an anonymous id, using the contacts of the account. Members without a visible number can not be mentioned. Tested with the fake provider; not yet tried with real WhatsApp',
        'Con @ se menciona a alguien del grupo; las menciones que llegan muestran el nombre (o el número) también cuando WhatsApp manda un id anónimo, con los contactos de la cuenta. No se puede mencionar a quien no tiene el número visible. Probado con el proveedor falso; falta probarlo con WhatsApp real',
        'Com @ se menciona alguém do grupo; as menções recebidas mostram o nome (ou o número) também quando o WhatsApp envia um id anônimo, com os contatos da conta. Não dá para mencionar quem não tem o número visível. Testado com o provedor falso; falta testar com WhatsApp real',
      ],
    }),
    row('wa-link-previews', 'whatsapp', ['Link previews', 'Vista previa de links', 'Prévia de links'], 'partial', {
      detail: [
        'Title, description, image and domain: the one WhatsApp sends, or read on our server (never from the browser) and cached for a week. The other person does not get a preview of what you send from here',
        'Título, descripción, imagen y dominio: la que manda WhatsApp, o leída en nuestro servidor (nunca desde el navegador) y guardada una semana. Del otro lado, lo que mandás desde acá llega sin vista previa',
        'Título, descrição, imagem e domínio: a que o WhatsApp envia, ou lida no nosso servidor (nunca pelo navegador) e guardada por uma semana. Do outro lado, o que você envia daqui chega sem prévia',
      ],
    }),
    row('wa-voice-notes', 'whatsapp', ['Voice notes: speed, waveform, resume', 'Notas de voz: velocidad, forma de onda, seguir', 'Notas de voz: velocidade, forma de onda, continuar'], 'have', {
      detail: [
        '1×, 1.5× and 2× (the choice is kept), the waveform WhatsApp sends, and an audio resumes where you left it in this browser',
        '1×, 1,5× y 2× (queda elegida), la forma de onda que manda WhatsApp, y un audio sigue donde lo dejaste en este navegador',
        '1×, 1,5× e 2× (a escolha fica), a forma de onda que o WhatsApp envia, e um áudio continua de onde você parou neste navegador',
      ],
    }),
    row('wa-transcripts', 'whatsapp', ['Audio transcription and summary', 'Transcripción y resumen de audios', 'Transcrição e resumo de áudios'], 'better', {
      competitorHas: false,
      detail: [
        'Every audio is transcribed with Voice when you see it and the text sits under the bubble; long ones get an AI summary. Saved once and only for you. Tested with the fake transcriber',
        'Cada audio se transcribe con Voice al verlo y el texto queda debajo de la burbuja; los largos llevan un resumen con IA. Se guarda una vez y solo para vos. Probado con el transcriptor falso',
        'Cada áudio é transcrito com o Voice ao ser visto e o texto fica embaixo do balão; os longos ganham um resumo com IA. Salvo uma vez e só para você. Testado com o transcritor falso',
      ],
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
        'Swipe a message right to reply, swipe a chat right for read and pin or left for archive and more (also with the mouse), hold it to drop it on a folder. In the browser, not a native app',
        'Deslizar un mensaje a la derecha para responder, un chat a la derecha para leído y fijar o a la izquierda para archivar y más (también con el mouse), mantenerlo apretado para soltarlo en una carpeta. En el navegador, no es una app nativa',
        'Deslizar uma mensagem para a direita para responder, uma conversa para a direita para lida e fixar ou para a esquerda para arquivar e mais (também com o mouse), segurar para soltar numa pasta. No navegador, não é um app nativo',
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
