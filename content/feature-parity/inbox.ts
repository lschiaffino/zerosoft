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
  lastReviewed: '2026-11-22',
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
      detail: [
        'E, from the list or the conversation. In Gmail it removes the thread from the inbox. On WhatsApp, sending a message brings the chat back to the list, like on the phone, except for chats set to Keep archived',
        'E, desde la lista o la conversación. En Gmail saca el hilo de la bandeja. En WhatsApp, mandar un mensaje devuelve el chat a la lista, como en el teléfono, salvo en los chats con Mantener archivado',
        'E, da lista ou da conversa. No Gmail tira a conversa da caixa. No WhatsApp, enviar uma mensagem devolve a conversa para a lista, como no celular, salvo nas conversas marcadas como Manter arquivada',
      ],
    }),
    row('snooze', 'triage', ['Snooze (remind me)', 'Posponer', 'Adiar'], 'have', {
      weight: 2,
      detail: [
        'H with options that fit the moment (tomorrow morning, this weekend…) or a day and time from a calendar. The chat waits in Archived (on the phone too) and comes back when the time is up. A new message brings it back early',
        'H con opciones según el momento (mañana a la mañana, este fin de semana…) o un día y hora del calendario. El chat espera en Archivados (también en el teléfono) y vuelve a la hora. Un mensaje nuevo lo trae antes',
        'H com opções conforme o momento (amanhã de manhã, neste fim de semana…) ou um dia e hora do calendário. A conversa espera em Arquivadas (no celular também) e volta na hora. Uma mensagem nova traz de volta antes',
      ],
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
        'Nested folders in the sidebar that collapse, unread counts that add up to the parent, hold a chat (or a selection) and drop it on a folder with undo, and drag folders to sort or nest them. "No folder" at the top of the tree lists the chats that are in none, to file them. V and Alt+arrows from the keyboard',
        'Carpetas anidadas en la barra que se pliegan, no leídos que suben al padre, mantener apretado un chat (o una selección) y soltarlo en una carpeta con deshacer, y arrastrar carpetas para ordenarlas o anidarlas. "Sin carpeta" arriba del árbol lista los chats que no están en ninguna, para ordenarlos. V y Alt+flechas desde el teclado',
        'Pastas aninhadas na barra que recolhem, não lidos que sobem para a pasta mãe, segurar uma conversa (ou uma seleção) e soltar numa pasta com desfazer, e arrastar pastas para ordenar ou aninhar. "Sem pasta" no topo da árvore lista as conversas que não estão em nenhuma, para organizá-las. V e Alt+setas pelo teclado',
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
        'From the reply field, one message or a sequence where each one is its own bubble, with waits between them and a file (WhatsApp). Edit, send now or cancel. Sent by the server even with the tab closed. A voice note can be scheduled from the recording bar: it shows with its length and a play button, and goes out as a voice note (tested with the fake provider)',
        'Desde el campo, un mensaje o una secuencia donde cada uno es su burbuja, con esperas entre ellos y un archivo (WhatsApp). Editar, enviar ya o cancelar. Lo manda el servidor aunque cierres la pestaña. Una nota de voz se programa desde la barra de grabación: se ve con su duración y un botón para escucharla, y sale como nota de voz (probado con el proveedor falso)',
        'Pelo campo, uma mensagem ou uma sequência em que cada uma é sua bolha, com esperas entre elas e um arquivo (WhatsApp). Editar, enviar agora ou cancelar. O servidor envia mesmo com a aba fechada. Uma mensagem de voz pode ser agendada pela barra de gravação: aparece com a duração e um botão para ouvir, e sai como mensagem de voz (testado com o provedor falso)',
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
    row('wa-contacts', 'navigation', ['Contacts list', 'Lista de contactos', 'Lista de contatos'], 'partial', {
      detail: [
        'Contacts lists each person of your WhatsApp accounts once (phone and WhatsApp id joined), with their accounts, groups and last message, filters by account and chat, and their HubSpot contact and company from the workspace connection. A 1:1 chat shows the HubSpot contact, its company and its deal with the properties you pick for each, creates the contact with one click or by itself for new chats (opt-in), and opens the HubSpot panel, which can stay pinned next to the chat. Tested with the fake provider and a simulated HubSpot',
        'Contactos muestra cada persona de tus cuentas de WhatsApp una vez (teléfono e id de WhatsApp unidos), con sus cuentas, grupos y último mensaje, filtros por cuenta y por chat, y su contacto y empresa de HubSpot de la conexión del workspace. Un chat 1:1 muestra el contacto de HubSpot, su empresa y su negocio con las propiedades que elijas para cada uno, crea el contacto con un clic o solo para los chats nuevos (opcional) y abre el panel de HubSpot, que puede quedar fijo al lado del chat. Probado con el proveedor falso y un HubSpot simulado',
        'Contatos mostra cada pessoa das suas contas de WhatsApp uma vez (telefone e id do WhatsApp unidos), com contas, grupos e última mensagem, filtros por conta e por chat, e o contato e a empresa no HubSpot da conexão do workspace. Uma conversa 1:1 mostra o contato do HubSpot, a empresa e o negócio dele com as propriedades que você escolher para cada um, cria o contato com um clique ou sozinha para conversas novas (opcional) e abre o painel do HubSpot, que pode ficar fixo ao lado da conversa. Testado com o provedor falso e um HubSpot simulado',
      ],
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
    row('removed-restore', 'triage', ['Restore a chat removed from Inbox', 'Recuperar un chat sacado de Inbox', 'Recuperar uma conversa removida do Inbox'], 'have', {
      detail: [
        'Removed chats wait 30 days in Removed from Inbox (under Archived), keep receiving messages silently and come back where they were; then they are deleted for good, or sooner by hand',
        'Los chats sacados esperan 30 días en Sacados de Inbox (dentro de Archivados), siguen recibiendo mensajes sin avisar y vuelven a donde estaban; después se borran del todo, o antes a mano',
        'As conversas removidas esperam 30 dias em Removidos do Inbox (dentro de Arquivadas), continuam recebendo mensagens sem avisar e voltam para onde estavam; depois são apagadas de vez, ou antes à mão',
      ],
    }),
    row('import', 'platform', ['Import from inbox-zero', 'Importar desde inbox-zero', 'Importar do inbox-zero'], 'have', {
      competitorHas: false,
      detail: [
        'Folders, scheduled, drafts, snoozes, notes and saved history from the local inbox.db, plus the full WhatsApp Desktop history of that Mac. Large files upload directly and keep importing in the background; importing twice never duplicates',
        'Carpetas, programados, borradores, pospuestos, notas e historial guardado del inbox.db local, más la historia completa de WhatsApp Desktop de esa Mac. Los archivos grandes suben directo y siguen importándose en segundo plano; importar dos veces no duplica',
        'Pastas, agendadas, rascunhos, adiadas, notas e histórico salvo do inbox.db local, mais o histórico completo do WhatsApp Desktop desse Mac. Arquivos grandes sobem direto e continuam importando em segundo plano; importar duas vezes não duplica',
      ],
    }),
    row('folders-json', 'platform', ['Folders from another inbox with the assistant', 'Carpetas de otra bandeja con el asistente', 'Pastas de outra caixa com o assistente'], 'partial', {
      competitorHas: false,
      detail: [
        'Paste or attach the JSON exported from another inbox and ask the assistant (⌘J) to create the folders and subfolders and put the chats in them. It finds chats by name, phone, WhatsApp id or email, shows the plan with the chats it could not find and their closest names, and changes nothing until you click Confirm. Running it again only does what is missing. Tested with the fake model',
        'Pegá o adjuntá el JSON exportado de otra bandeja y pedile al asistente (⌘J) que cree las carpetas y subcarpetas y ponga los chats. Encuentra los chats por nombre, teléfono, id de WhatsApp o email, muestra el plan con los que no encontró y los nombres más parecidos, y no cambia nada hasta que tocás Confirmar. Repetirlo solo hace lo que falta. Probado con el modelo falso',
        'Cole ou anexe o JSON exportado de outra caixa e peça ao assistente (⌘J) para criar as pastas e subpastas e colocar as conversas. Ele encontra as conversas por nome, telefone, id do WhatsApp ou e-mail, mostra o plano com as que não encontrou e os nomes mais parecidos, e não muda nada até você clicar em Confirmar. Repetir só faz o que falta. Testado com o modelo falso',
      ],
    }),
    row('assistant-behind', 'platform', ['Assistant: what you are behind on', 'Asistente: qué tenés atrasado', 'Assistente: o que está atrasado'], 'partial', {
      competitorHas: false,
      detail: [
        'Ask the assistant (⌘J) what you are behind on: chats waiting for your reply and for how long, overdue reminders, back from snooze and important unread, from names and times only. It reads messages only after you allow it (this time or always, revocable in Settings), and suggests reply drafts, snooze, reminders, archive, done or folders in one card. Tested with the fake model',
        'Preguntale al asistente (⌘J) qué tenés atrasado: chats que esperan tu respuesta y hace cuánto, recordatorios vencidos, los que volvieron de posponer y no leídos importantes, solo con nombres y horarios. Lee mensajes solo si lo permitís (esta vez o siempre, se apaga en Ajustes) y propone borradores, posponer, recordatorios, archivar, hecho o carpetas en una tarjeta. Probado con el modelo falso',
        'Pergunte ao assistente (⌘J) o que está atrasado: conversas esperando sua resposta e há quanto tempo, lembretes vencidos, as que voltaram do adiamento e não lidas importantes, só com nomes e horários. Ele lê mensagens só se você permitir (desta vez ou sempre, desligável em Configurações) e sugere rascunhos, adiar, lembretes, arquivar, feito ou pastas num cartão. Testado com o modelo falso',
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
    row('history-older', 'platform', ['Load older messages from the phone, on demand', 'Cargar mensajes anteriores desde el teléfono, a pedido', 'Carregar mensagens anteriores do celular, sob demanda'], 'partial', {
      detail: [
        'A "Load older messages" chip at the top of a chat, once what we have stored runs out. It asks the phone for the 50 messages before the oldest one we have; they come in as history, without duplicates, and what you were reading stays in place. It says when the phone has no more, lets you retry after an error and is disabled with the reason while the line is disconnected. One request per chat at a time and a cap per line per hour. Tested with the fake server; with real WhatsApp it needs the phone online, and after linking a line again it needs our WhatsApp server image with patch 0006',
        'Una ficha "Cargar mensajes anteriores" arriba del chat, cuando lo que tenemos guardado se termina. Le pide al teléfono los 50 mensajes anteriores al más viejo que tenemos; entran como historial, sin repetidos, y lo que estabas leyendo queda en su lugar. Dice cuando el teléfono no tiene más, deja reintentar después de un error y queda deshabilitada con el motivo mientras la línea está desconectada. Un pedido por chat a la vez y un tope por línea por hora. Probado con el servidor falso; con WhatsApp real necesita el teléfono en línea y, después de volver a vincular una línea, la imagen de nuestro servidor de WhatsApp con el parche 0006',
        'Uma ficha "Carregar mensagens anteriores" no topo da conversa, quando o que temos guardado acaba. Pede ao celular as 50 mensagens anteriores à mais antiga que temos; entram como histórico, sem repetidas, e o que você estava lendo fica no lugar. Avisa quando o celular não tem mais, deixa tentar de novo depois de um erro e fica desabilitada com o motivo enquanto a linha está desconectada. Um pedido por conversa por vez e um limite por linha por hora. Testado com o servidor falso; com o WhatsApp real precisa do celular online e, depois de vincular uma linha de novo, da imagem do nosso servidor de WhatsApp com o patch 0006',
      ],
    }),
    row('history-missing', 'platform', ['Fetch missing messages from the phone', 'Traer mensajes que faltan desde el teléfono', 'Buscar mensagens que faltam no celular'], 'partial', {
      detail: [
        '"Fetch missing messages" in the chat menu asks the phone for the messages before the last one, around the gaps WhatsApp reported and a bit further back (up to three requests of 50). What comes back is stored as history without duplicates, and a strip at the top of the chat says what happened: how many came, that nothing was missing, that the phone did not answer (with retry), that the line is disconnected or at its hourly cap. Tested with the fake server; with real WhatsApp it needs the phone online, and on lines linked again it needs our WhatsApp server image with patch 0006',
        '"Traer mensajes que faltan" en el menú del chat le pide al teléfono los mensajes anteriores al último, alrededor de los huecos que avisó WhatsApp y un poco más atrás (hasta tres pedidos de 50). Lo que vuelve se guarda como historial sin repetidos, y una franja arriba del chat dice qué pasó: cuántos llegaron, que no faltaba nada, que el teléfono no respondió (con reintentar), que la línea está desconectada o llegó a su tope por hora. Probado con el servidor falso; con WhatsApp real necesita el teléfono en línea y, en líneas vinculadas de nuevo, la imagen de nuestro servidor de WhatsApp con el parche 0006',
        '"Buscar mensagens que faltam" no menu da conversa pede ao celular as mensagens anteriores à última, em volta das lacunas que o WhatsApp avisou e um pouco mais para trás (até três pedidos de 50). O que volta é guardado como histórico sem repetidas, e uma faixa no topo da conversa diz o que aconteceu: quantas vieram, que não faltava nada, que o celular não respondeu (com tentar de novo), que a linha está desconectada ou chegou ao limite por hora. Testado com o servidor falso; com o WhatsApp real precisa do celular online e, em linhas vinculadas de novo, da imagem do nosso servidor de WhatsApp com o patch 0006',
      ],
    }),
    row('self-host', 'platform', ['Run it on your own server', 'Correrlo en tu servidor', 'Rodar no seu servidor'], 'have', { competitorHas: false }),

    // WhatsApp Web (la lista, la conversación y la info del contacto, como en WhatsApp)
    row('wa-names', 'whatsapp', ['Real chat names', 'Nombres reales de los chats', 'Nomes reais das conversas'], 'partial', {
      detail: [
        'Group subject and contact profile from the WhatsApp server, refreshed every three days; never the raw id. Without a saved name, the number in international format, as on WhatsApp Web. Tested with the fake provider and the real payload shapes',
        'Asunto del grupo y perfil del contacto desde el servidor de WhatsApp, renovados cada tres días; nunca el id crudo. Sin nombre guardado, el número en formato internacional, como en WhatsApp Web. Probado con el proveedor falso y la forma real de los datos',
        'Assunto do grupo e perfil do contato vindos do servidor do WhatsApp, renovados a cada três dias; nunca o id cru. Sem nome salvo, o número em formato internacional, como no WhatsApp Web. Testado com o provedor falso e o formato real dos dados',
      ],
    }),
    row('wa-photos', 'whatsapp', ['Profile photos', 'Fotos de perfil', 'Fotos de perfil'], 'partial', {
      detail: [
        'Contacts and groups, served with your session and cached privately in the browser; an expired link is renewed. In groups, every participant has their photo (next to their messages, in the participant list and when mentioning), fetched a few at a time, stored so it does not expire and checked again every week. Tested with the fake provider',
        'Contactos y grupos, servidas con tu sesión y guardadas en la caché privada del navegador; un link vencido se renueva. En los grupos, cada participante tiene su foto (al lado de sus mensajes, en la lista de participantes y al mencionar), pedida de a pocas, guardada para que no venza y revisada cada semana. Probado con el proveedor falso',
        'Contatos e grupos, servidas com sua sessão e guardadas no cache privado do navegador; um link vencido é renovado. Nos grupos, cada participante tem sua foto (ao lado das mensagens, na lista de participantes e ao mencionar), buscada poucas por vez, guardada para não expirar e conferida toda semana. Testado com o provedor falso',
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
        'Wallpaper, bubbles with tails, grouped messages, day chips, sender names in color, ticks, edited, forwarded and deleted, in light and dark. Pinned messages (up to 3, from the message menu) show in a strip on top that jumps to each one, also older ones; with the current WhatsApp server they stay pinned here, not on the phone. No chat search yet',
        'Fondo, burbujas con cola, mensajes agrupados, separadores de día, nombres de color, tildes, editado, reenviado y borrado, en claro y oscuro. Los mensajes fijados (hasta 3, desde el menú del mensaje) van en una franja arriba que lleva a cada uno, también a los viejos; con el servidor de WhatsApp actual quedan fijados acá, no en el teléfono. Todavía sin buscar en el chat',
        'Fundo, balões com ponta, mensagens agrupadas, separadores de dia, nomes coloridos, confirmações, editada, encaminhada e apagada, no claro e no escuro. As mensagens fixadas (até 3, pelo menu da mensagem) ficam numa faixa no topo que leva a cada uma, também às antigas; com o servidor de WhatsApp atual ficam fixadas aqui, não no celular. Ainda sem busca na conversa',
      ],
    }),
    row('wa-message-actions', 'whatsapp', ['Reply, react, forward, copy, edit, delete, star', 'Responder, reaccionar, reenviar, copiar, editar, borrar, destacar', 'Responder, reagir, encaminhar, copiar, editar, apagar, favoritar'], 'partial', {
      detail: [
        'From the arrow menu, right click or a long press, in the WhatsApp order. In groups, Reply privately (the one on one chat opens replying, the quote shows the group like on WhatsApp) and Message plus the name of the sender. Download for photos, videos and files. No Pin, Select messages or Report yet. Forwarding sends a copy of any message (text, photo, video, document, sticker, audio; a voice note goes as a voice note) to up to 5 chats, marked "Forwarded" here but not on the other phone, because our WhatsApp server has no native forward. View once messages are not forwarded. Message info opens beside the message: in a one to one chat, delivered and read with their time; in a group, who read it and who received it, each with the time, when the line reports it',
        'Desde la flecha, el clic derecho o un toque largo, en el orden de WhatsApp. En grupos, Responder en privado (el chat individual se abre respondiendo y la cita muestra el grupo como en WhatsApp) y Enviar mensaje con el nombre de quien escribió. Descargar para fotos, videos y archivos. Todavía sin Fijar, Seleccionar mensajes ni Reportar. Reenviar manda una copia de cualquier mensaje (texto, foto, video, documento, sticker, audio; una nota de voz sale como nota de voz) a hasta 5 chats, marcada "Reenviado" acá pero no en el teléfono de quien la recibe, porque nuestro servidor de WhatsApp no tiene reenvío nativo. Los de ver una vez no se reenvían. La info del mensaje se abre al lado del mensaje: en un chat individual, entregado y leído con su hora; en un grupo, quién lo leyó y quién lo recibió, cada uno con su hora, cuando la línea lo informa',
        'Pela seta, clique direito ou toque longo, na ordem do WhatsApp. Em grupos, Responder em particular (a conversa individual abre respondendo e a citação mostra o grupo como no WhatsApp) e Enviar mensagem com o nome de quem escreveu. Baixar para fotos, vídeos e arquivos. Ainda sem Fixar, Selecionar mensagens nem Denunciar. Encaminhar envia uma cópia de qualquer mensagem (texto, foto, vídeo, documento, figurinha, áudio; uma nota de voz sai como nota de voz) para até 5 conversas, marcada "Encaminhada" aqui mas não no telefone de quem recebe, porque nosso servidor de WhatsApp não tem encaminhamento nativo. As de visualização única não são encaminhadas. Os dados da mensagem abrem ao lado da mensagem: numa conversa individual, entregue e lida com o horário; num grupo, quem leu e quem recebeu, cada um com o horário, quando a linha informa',
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
        'Received stickers show small and without a bubble (animated ones move), GIFs play inside the bubble. The Stickers tab of the emoji panel shows yours first, like WhatsApp: Recent (what you sent from that number, also from the phone), Favorites and Created by you, with received stickers folded under "From your chats"; one collection per number (each chat shows the stickers of its own number); WhatsApp does not let linked devices read the stickers saved on the phone, so the collection is built from the stickers in the chats of that number (imported on their own the first time you open the tab, then it stays up to date) and from images you turn into stickers. Lottie stickers show as a placeholder. Tested with the fake provider',
        'Los stickers que llegan se ven chicos y sin burbuja (los animados se mueven) y los GIF se reproducen en la burbuja. La pestaña Stickers del panel de emojis muestra primero lo tuyo, como WhatsApp: Recientes (lo que mandaste desde ese número, también desde el teléfono), Favoritos y Creados por vos, con los recibidos plegados en "De tus chats"; una colección por número (cada chat muestra los stickers de su número); WhatsApp no deja que los dispositivos vinculados lean los stickers guardados en el teléfono, así que la colección se arma con los stickers de los chats de ese número (se importan solos la primera vez que abrís la pestaña y después se mantiene sola) y con imágenes que convertís en sticker. Los stickers Lottie se ven como un lugar vacío. Probado con el proveedor falso',
        'As figurinhas recebidas aparecem pequenas e sem balão (as animadas se mexem) e os GIFs tocam no balão. A aba Figurinhas do painel de emojis mostra primeiro as suas, como o WhatsApp: Recentes (o que você enviou desse número, também pelo celular), Favoritas e Criadas por você, com as recebidas recolhidas em "Das suas conversas"; uma coleção por número (cada conversa mostra as figurinhas do seu número); o WhatsApp não deixa aparelhos vinculados lerem as figurinhas salvas no celular, então a coleção é montada com as figurinhas das conversas desse número (importadas sozinhas na primeira vez que você abre a aba e depois se atualiza sozinha) e com imagens que você transforma em figurinha. Figurinhas Lottie aparecem como um espaço vazio. Testado com o provedor falso',
      ],
    }),
    row('wa-gifs', 'whatsapp', ['Search and send GIFs', 'Buscar y mandar GIF', 'Pesquisar e enviar GIFs'], 'partial', {
      detail: [
        'GIFs tab in the emoji panel, between Emoji and Stickers: trending when empty, categories like WhatsApp (Haha, Sad, Love...), search in your language, and a click sends it as a WhatsApp GIF (MP4 that plays muted on a loop). Needs a GIPHY or Tenor key on the server. With Evolution 2.3.7 and earlier it arrives as a regular video, because that version does not pass gifPlayback. Tested with sample GIFs and the fake provider',
        'Pestaña GIF en el panel de emojis, entre Emoji y Stickers: tendencias al abrirla, categorías como WhatsApp (Jaja, Triste, Amor...), búsqueda en tu idioma, y un clic lo manda como GIF de WhatsApp (MP4 que se reproduce sin sonido y en bucle). Necesita una clave de GIPHY o Tenor en el servidor. Con Evolution 2.3.7 o anterior llega como video común, porque esa versión no pasa gifPlayback. Probado con GIF de ejemplo y el proveedor falso',
        'Aba GIFs no painel de emojis, entre Emoji e Figurinhas: em alta ao abrir, categorias como no WhatsApp (Haha, Triste, Amor...), pesquisa no seu idioma, e um clique envia como GIF do WhatsApp (MP4 que toca sem som e em loop). Precisa de uma chave do GIPHY ou do Tenor no servidor. Com o Evolution 2.3.7 ou anterior chega como vídeo comum, porque essa versão não repassa gifPlayback. Testado com GIFs de exemplo e o provedor falso',
      ],
    }),
    row('wa-image-editor', 'whatsapp', ['Edit a photo before sending (crop, draw, text, sticker, blur, filters, HD)', 'Editar una foto antes de mandarla (recortar, dibujar, texto, sticker, desenfocar, filtros, HD)', 'Editar uma foto antes de enviar (cortar, desenhar, texto, figurinha, desfoque, filtros, HD)'], 'have', {
      detail: [
        'In the preview, for photos picked, dropped or pasted: crop and rotate, emoji or sticker on top, colored text, pencil with colors and sizes, a blur brush, color filters (Pop, B&W, Cool, Chrome, Film), undo, an emoji button for the caption and HD (standard quality otherwise, up to 1600 px like WhatsApp). Several photos, each with its own edits. Tested with the fake provider',
        'En la vista previa, para fotos elegidas, soltadas o pegadas: recortar y rotar, emoji o sticker encima, texto de color, lápiz con colores y grosores, pincel para desenfocar, filtros de color (Pop, B&N, Frío, Cromo, Película), deshacer, botón de emoji para el comentario y HD (si no, calidad estándar, hasta 1600 px como WhatsApp). Varias fotos, cada una con sus cambios. Probado con el proveedor falso',
        'Na pré-visualização, para fotos escolhidas, soltas ou coladas: cortar e girar, emoji ou figurinha por cima, texto colorido, lápis com cores e espessuras, pincel de desfoque, filtros de cor (Pop, P&B, Frio, Cromo, Filme), desfazer, botão de emoji para a legenda e HD (senão, qualidade padrão, até 1600 px como no WhatsApp). Várias fotos, cada uma com suas edições. Testado com o provedor falso',
      ],
    }),
    row('wa-attach-menu', 'whatsapp', ['Attach menu: document, photos, camera, audio, contact, poll, new sticker', 'Menú de adjuntar: documento, fotos, cámara, audio, contacto, encuesta, sticker nuevo', 'Menu de anexar: documento, fotos, câmera, áudio, contato, enquete, nova figurinha'], 'partial', {
      detail: [
        'The + menu has the WhatsApp options in the WhatsApp order, with colored icons: camera opens the computer camera (or the phone camera), contact sends up to 5 contact cards, poll sends a WhatsApp poll, and new sticker turns an image into a sticker and sends it. Help me write, dictate and commands go below a line. Events are missing: our WhatsApp server cannot send them yet. Tested with the fake provider',
        'El menú + tiene las opciones de WhatsApp en el orden de WhatsApp, con íconos de color: cámara abre la de la computadora (o la del teléfono), contacto manda hasta 5 tarjetas, encuesta manda una encuesta de WhatsApp y sticker nuevo convierte una imagen en sticker y lo manda. Ayudame a escribir, dictar y comandos van debajo de una línea. Faltan los eventos: nuestro servidor de WhatsApp todavía no los puede mandar. Probado con el proveedor falso',
        'O menu + tem as opções do WhatsApp na ordem do WhatsApp, com ícones coloridos: câmera abre a do computador (ou a do celular), contato envia até 5 cartões, enquete envia uma enquete do WhatsApp e nova figurinha transforma uma imagem em figurinha e envia. Me ajude a escrever, ditar e comandos ficam abaixo de uma linha. Faltam os eventos: nosso servidor de WhatsApp ainda não consegue enviá-los. Testado com o provedor falso',
      ],
    }),
    row('wa-send-media', 'whatsapp', ['Send files, drag and drop, paste', 'Mandar archivos, arrastrar y pegar', 'Enviar arquivos, arrastar e colar'], 'partial', {
      detail: [
        'Several files at once with a caption each and a preview before sending (paste more images into the preview; the same one twice goes in once); voice notes from the microphone. Files and voice notes show in the chat as soon as you send, with the clock, and upload in the background. Over 4 MB needs Blob storage on the server. Tested with the fake provider',
        'Varios archivos juntos, con un comentario cada uno y vista previa antes de enviar (se pueden pegar más imágenes en la vista previa; la misma dos veces entra una vez); notas de voz con el micrófono. Archivos y notas de voz aparecen en el chat al mandarlos, con el reloj, y se suben por detrás. Más de 4 MB necesita Blob en el servidor. Probado con el proveedor falso',
        'Vários arquivos de uma vez, com legenda em cada um e prévia antes de enviar (dá para colar mais imagens na prévia; a mesma duas vezes entra uma vez); notas de voz pelo microfone. Arquivos e notas de voz aparecem na conversa assim que são enviados, com o relógio, e sobem em segundo plano. Mais de 4 MB precisa de Blob no servidor. Testado com o provedor falso',
      ],
    }),
    row('offline-queue', 'whatsapp', ['Write without a connection: messages queue and send on their own', 'Escribir sin conexión: los mensajes quedan en cola y salen solos', 'Escrever sem conexão: as mensagens ficam na fila e saem sozinhas'], 'partial', {
      detail: [
        'Chats you opened open without a connection. A text written offline shows with the clock, survives a reload, can be deleted before it goes, and sends in order and once when the connection is back (also with two tabs open); if the server rejects it, it stays as not sent with retry. Files need a connection: they stay in the tray. Tested with the fake provider',
        'Los chats que abriste se abren sin conexión. Un texto escrito sin red aparece con el reloj, sobrevive a recargar, se puede borrar antes de que salga y sale en orden y una sola vez al volver la conexión (también con dos pestañas abiertas); si el servidor lo rechaza, queda como no enviado con reintentar. Los archivos necesitan conexión: quedan en la bandeja. Probado con el proveedor falso',
        'As conversas que você abriu abrem sem conexão. Um texto escrito sem conexão aparece com o relógio, sobrevive a recarregar, pode ser apagado antes de sair e sai em ordem e uma única vez quando a conexão volta (também com duas abas abertas); se o servidor recusar, fica como não enviado com tentar de novo. Arquivos precisam de conexão: ficam na bandeja. Testado com o provedor falso',
      ],
    }),
    row('wa-mentions', 'whatsapp', ['Mentions in groups', 'Menciones en grupos', 'Menções em grupos'], 'partial', {
      detail: [
        'Type @ to pick a member (photo, name and number); the mention shows in green in the field and goes out as a WhatsApp mention, so the person gets notified. Received mentions show the name (or the number) also when WhatsApp sends an anonymous id, using the contacts of the account, and clicking one opens that contact info. The caption of a photo, video or document mentions too. Members without a visible number can not be mentioned. Tested with the fake provider; not yet tried with real WhatsApp',
        'Con @ se elige a alguien del grupo (foto, nombre y número); la mención se ve en verde en el campo y sale como mención de WhatsApp, así a la persona le llega el aviso. Las menciones que llegan muestran el nombre (o el número) también cuando WhatsApp manda un id anónimo, con los contactos de la cuenta, y hacer clic en una abre la info del contacto. El pie de una foto, un video o un documento también menciona. No se puede mencionar a quien no tiene el número visible. Probado con el proveedor falso; falta probarlo con WhatsApp real',
        'Com @ se escolhe alguém do grupo (foto, nome e número); a menção aparece em verde no campo e sai como menção do WhatsApp, e a pessoa recebe o aviso. As menções recebidas mostram o nome (ou o número) também quando o WhatsApp envia um id anônimo, com os contatos da conta, e clicar em uma abre os dados do contato. A legenda de uma foto, um vídeo ou um documento também menciona. Não dá para mencionar quem não tem o número visível. Testado com o provedor falso; falta testar com WhatsApp real',
      ],
    }),
    row('wa-link-previews', 'whatsapp', ['Link previews', 'Vista previa de links', 'Prévia de links'], 'partial', {
      detail: [
        'Like WhatsApp: a large image on top for pages with a big image, a small thumbnail for logos, text only without an image, with the domain and the site icon. Read on our server (never from the browser) and cached for a week. While typing, the preview shows above the field and can be removed before sending. Large, compact or off in Display. A WhatsApp group invite gets its own card (round group photo, name, Join group with a confirmation, Open in WhatsApp). Tested with the fake reader and provider; not yet tried with real WhatsApp',
        'Como WhatsApp: la imagen grande arriba en páginas con una imagen grande, miniatura chica con logos, solo texto sin imagen, con el dominio y el ícono del sitio. Leída en nuestro servidor (nunca desde el navegador) y guardada una semana. Al escribir, la vista previa aparece arriba del campo y se puede sacar antes de mandar. Grande, compacta o ninguna en Visualización. Una invitación a un grupo de WhatsApp tiene su tarjeta (foto redonda del grupo, nombre, Unirme al grupo con confirmación, Abrir en WhatsApp). Probado con el lector y el proveedor falsos; falta probarlo con WhatsApp real',
        'Como no WhatsApp: a imagem grande em cima em páginas com uma imagem grande, miniatura pequena com logos, só texto sem imagem, com o domínio e o ícone do site. Lida no nosso servidor (nunca pelo navegador) e guardada por uma semana. Ao digitar, a prévia aparece acima do campo e pode ser tirada antes de enviar. Grande, compacta ou nenhuma em Visualização. Um convite para grupo do WhatsApp tem seu cartão (foto redonda do grupo, nome, Entrar no grupo com confirmação, Abrir no WhatsApp). Testado com o leitor e o provedor falsos; falta testar com WhatsApp real',
      ],
    }),
    row('wa-display', 'whatsapp', ['Personal chat display', 'Visualización de los chats por persona', 'Visualização das conversas por pessoa'], 'have', {
      detail: [
        'Text size, chat list density, photo and video size, link previews, message width, background and sender photos in groups. A live preview (chat list and a group chat) shows every option as you pick it. Opened from the menu of any chat or from settings, and shared with Lines',
        'Tamaño del texto, densidad de la lista, tamaño de fotos y videos, vista previa de links, ancho de los mensajes, fondo y fotos de quien escribe en grupos. Una vista previa en vivo (lista de chats y un chat de grupo) muestra cada opción al elegirla. Se abre desde el menú de cualquier chat o desde los ajustes, y vale también para Lines',
        'Tamanho do texto, densidade da lista, tamanho de fotos e vídeos, prévia de links, largura das mensagens, fundo e fotos de quem escreve nos grupos. Uma prévia ao vivo (lista de conversas e uma conversa de grupo) mostra cada opção ao escolher. Abre pelo menu de qualquer conversa ou pelas configurações, e vale também para o Lines',
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
    row('wa-new-chat', 'whatsapp', ['New chat like WhatsApp Web: message yourself, new group, all contacts A to Z', 'Chat nuevo como WhatsApp Web: mandate un mensaje, grupo nuevo, todos los contactos de la A a la Z', 'Nova conversa como o WhatsApp Web: mensagem para você, novo grupo, todos os contatos de A a Z'], 'partial', {
      detail: [
        'Search by name or number, frequently contacted, new WhatsApp group with members and a name, New email for Gmail. No communities. Tested with the fake provider; not yet tried with real WhatsApp',
        'Búsqueda por nombre o número, contactados con frecuencia, grupo nuevo de WhatsApp con participantes y nombre, Correo nuevo para Gmail. Sin comunidades. Probado con el proveedor falso; falta probarlo con WhatsApp real',
        'Pesquisa por nome ou número, contatos frequentes, novo grupo do WhatsApp com participantes e nome, Novo e-mail para o Gmail. Sem comunidades. Testado com o provedor falso; falta testar com WhatsApp real',
      ],
    }),
    row('wa-group-events', 'whatsapp', ['Group notices: created, added, left, admins', 'Avisos del grupo: creado, agregó, salió, admins', 'Avisos do grupo: criado, adicionou, saiu, admins'], 'partial', {
      detail: [
        'A new group shows at the top of the list right away, with "You created group" or "Ana added you" as its preview and a card in the empty chat. Adds, removals, leaves, invite link joins and admin changes show as centered lines and as the preview when they are the latest. Name, description and icon changes made on the phone arrive once the updated WhatsApp server is deployed, and notices from before this change cannot be recovered. Tested with the fake provider and simulated gateway payloads',
        'Un grupo nuevo aparece arriba de la lista en el momento, con "Creaste el grupo" o "Ana te agregó" de vista previa y una tarjeta en el chat vacío. Agregados, sacados, salidas, entradas con el link y cambios de admin se ven como líneas centradas y como vista previa si son lo último. Los cambios de nombre, descripción o foto hechos en el teléfono llegan cuando se despliegue el servidor de WhatsApp actualizado, y los avisos anteriores a este cambio no se pueden recuperar. Probado con el proveedor falso y avisos simulados del gateway',
        'Um grupo novo aparece no topo da lista na hora, com "Você criou o grupo" ou "Ana adicionou você" como prévia e um cartão na conversa vazia. Adições, remoções, saídas, entradas pelo link e mudanças de admin aparecem como linhas centralizadas e como prévia quando são o último. Mudanças de nome, descrição ou foto feitas no celular chegam quando o servidor do WhatsApp atualizado for implantado, e os avisos anteriores a esta mudança não podem ser recuperados. Testado com o provedor falso e avisos simulados do gateway',
      ],
    }),
    row('wa-contact-info', 'whatsapp', ['Contact and group info', 'Info del contacto y del grupo', 'Dados do contato e do grupo'], 'partial', {
      detail: [
        'Photo, name, number or members with admins, about or description, shared photos, documents and links, starred messages, groups in common, mute and block. The photo or name of anyone in a group, or a participant, opens their contact info with Message (opens or starts the one on one chat). No audio or video calls. The pencil next to the group name and description changes them on WhatsApp, with the notice in the chat (tested with the fake provider). Leaving a group and changing its photo or settings are done on the phone',
        'Foto, nombre, número o integrantes con sus admins, info o descripción, fotos, documentos y enlaces compartidos, destacados, grupos en común, silenciar y bloquear. La foto o el nombre de alguien en un grupo, o un participante, abre su info del contacto con Mensaje (abre o empieza el chat individual). Sin llamadas de audio ni video. El lápiz al lado del nombre y de la descripción del grupo los cambia en WhatsApp, con el aviso en el chat (probado con el proveedor falso). Salir del grupo y cambiar su foto o sus ajustes se hace en el teléfono',
        'Foto, nome, número ou membros com os admins, recado ou descrição, fotos, documentos e links compartilhados, favoritas, grupos em comum, silenciar e bloquear. A foto ou o nome de alguém em um grupo, ou um participante, abre os dados do contato com Mensagem (abre ou começa a conversa individual). Sem chamadas de áudio ou vídeo. O lápis ao lado do nome e da descrição do grupo os muda no WhatsApp, com o aviso na conversa (testado com o provedor falso). Sair do grupo e mudar a foto ou as configurações dele é feito no celular',
      ],
    }),
    row('wa-group-members', 'whatsapp', ['Add members and change group admins', 'Agregar miembros y cambiar admins del grupo', 'Adicionar membros e mudar admins do grupo'], 'partial', {
      detail: [
        'In the group info: Add members (several at once, from your contacts or a typed number), Invite via link, and a menu on each member to make or dismiss a group admin, remove them or message them. If your number is not an admin of the group the actions show disabled with the reason. When WhatsApp refuses someone (privacy settings) you can send them the invite link. Tested with the fake provider; not yet tried with real WhatsApp',
        'En la info del grupo: Agregar miembros (varios a la vez, de tus contactos o un número escrito), Invitar con link, y un menú en cada miembro para hacerlo admin o quitarle el admin, sacarlo o mandarle un mensaje. Si tu número no es admin del grupo, las acciones se ven deshabilitadas con el motivo. Si WhatsApp rechaza a alguien (su privacidad), le podés mandar el link. Probado con el proveedor falso; falta probarlo con WhatsApp real',
        'Nos dados do grupo: Adicionar membros (vários de uma vez, dos seus contatos ou um número digitado), Convidar via link e um menu em cada membro para torná-lo admin ou tirar o admin, removê-lo ou mandar mensagem. Se o seu número não é admin do grupo, as ações aparecem desabilitadas com o motivo. Se o WhatsApp recusa alguém (privacidade), você pode enviar o link. Testado com o provedor falso; falta testar com WhatsApp real',
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
        'Stored as they arrive from WhatsApp and shown on the next refresh (a few seconds). Clicking the reactions shows who reacted with what (photo, name, number) and removes your own, as in WhatsApp. Typing depends on WhatsApp sending presence',
        'Se guardan al llegar de WhatsApp y se ven en la próxima actualización (unos segundos). Un clic en las reacciones muestra quién reaccionó y con qué (foto, nombre, número) y saca la propia, como en WhatsApp. "Escribiendo" depende de que WhatsApp mande la presencia',
        'São salvas quando chegam do WhatsApp e aparecem na próxima atualização (alguns segundos). Um clique nas reações mostra quem reagiu e com o quê (foto, nome, número) e remove a sua, como no WhatsApp. "Digitando" depende de o WhatsApp enviar a presença',
      ],
    }),
  ],
};

export default parity;
