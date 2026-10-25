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
 * Voice contra Wispr Flow (dictado) y Granola (notas de reunión). Fuente:
 * docs/benchmark/voice.md. Primera versión web (tanda 4b): dictado en toda la
 * suite y notas de reunión; la app de escritorio está en camino (código en
 * desktop/voice, sin compilar ni firmar).
 */
const parity: ProductParity = {
  competitor: 'Wispr Flow + Granola',
  lastReviewed: '2026-10-25',
  areas: [
    { id: 'dictation', label: loc(['Dictation in any app', 'Dictado en cualquier app', 'Ditado em qualquer app']) },
    { id: 'cleanup', label: loc(['AI cleanup and formatting', 'Limpieza y formato con IA', 'Limpeza e formatação com IA']) },
    { id: 'personalization', label: loc(['Dictionary, snippets and styles', 'Diccionario, snippets y estilos', 'Dicionário, snippets e estilos']) },
    { id: 'commands', label: loc(['Voice commands and rewriting', 'Comandos de voz y reescritura', 'Comandos de voz e reescrita']) },
    { id: 'apps', label: loc(['Desktop, mobile and usage', 'Escritorio, móvil y uso', 'Desktop, celular e uso']) },
    { id: 'capture', label: loc(['Meeting capture', 'Captura de reuniones', 'Captura de reuniões']) },
    { id: 'notes', label: loc(['AI notes and summaries', 'Notas y resúmenes con IA', 'Notas e resumos com IA']) },
    { id: 'chat', label: loc(['Chat with meetings', 'Chat con las reuniones', 'Chat com as reuniões']) },
    { id: 'organize', label: loc(['Organize and share', 'Organizar y compartir', 'Organizar e compartilhar']) },
    { id: 'integrations', label: loc(['Integrations and API', 'Integraciones y API', 'Integrações e API']) },
    { id: 'admin', label: loc(['Teams, privacy and admin', 'Equipos, privacidad y admin', 'Equipes, privacidade e admin']) },
  ],
  rows: [
    // Dictado en cualquier app
    row('dictate-any-app', 'dictation', ['Dictate into any text field with a shortcut', 'Dictar en cualquier campo de texto con un atajo', 'Ditar em qualquer campo de texto com um atalho'], 'partial', {
      weight: 2,
      detail: [
        "Hold Alt+Space (or the field button) in any zerosoft field and the clean text is inserted at the cursor. Other apps on the computer need the desktop app, which is on the way",
        "Mantener Alt+Space (o el botón del campo) en cualquier campo de zerosoft inserta el texto limpio donde está el cursor. Las otras apps de la compu necesitan la app de escritorio, que está en camino",
        "Segurar Alt+Space (ou o botão do campo) em qualquer campo do zerosoft insere o texto limpo no cursor. Os outros apps do computador precisam do app desktop, que está a caminho",
      ],
    }),
    row('hands-free', 'dictation', ['Hands-free mode', 'Modo manos libres', 'Modo mãos livres'], 'have', {
      detail: [
        "Double tap the shortcut, or click the field button, and Voice listens until you tap again",
        "Doble toque al atajo, o clic en el botón del campo, y Voice escucha hasta el próximo toque",
        "Toque duplo no atalho, ou clique no botão do campo, e o Voice ouve até o próximo toque",
      ],
    }),
    row('languages', 'dictation', ['More than 100 languages', 'Más de 100 idiomas', 'Mais de 100 idiomas'], 'partial', {
      weight: 2,
      detail: [
        "16 languages to pick in settings, plus automatic detection with whatever the configured provider supports (Whisper, Deepgram or AssemblyAI)",
        "16 idiomas para elegir en ajustes, más la detección automática con lo que soporte el proveedor configurado (Whisper, Deepgram o AssemblyAI)",
        "16 idiomas para escolher nos ajustes, mais a detecção automática com o que o provedor configurado suportar (Whisper, Deepgram ou AssemblyAI)",
      ],
    }),
    row('whisper-mode', 'dictation', ['Whisper mode', 'Modo susurro', 'Modo sussurro'], 'missing', {
      detail: ['Wispr Flow: dictate at low volume in shared spaces', 'Wispr Flow: dictar en voz baja en lugares compartidos', 'Wispr Flow: ditar em voz baixa em lugares compartilhados'],
    }),
    row('paste-last', 'dictation', ['Paste or copy the last dictation', 'Pegar o copiar el último dictado', 'Colar ou copiar o último ditado'], 'have', {
      detail: [
        "Ctrl+Cmd+V (Mac) or Ctrl+Alt+Shift+V pastes the last dictation from the server history, also the ones made in the desktop app; every dictation can be copied again from the history",
        "Ctrl+Cmd+V (Mac) o Ctrl+Alt+Shift+V pega el último dictado del historial del servidor, también los de la app de escritorio; cada dictado se puede volver a copiar desde el historial",
        "Ctrl+Cmd+V (Mac) ou Ctrl+Alt+Shift+V cola o último ditado do histórico do servidor, também os do app desktop; cada ditado pode ser copiado de novo pelo histórico",
      ],
    }),

    // Limpieza y formato
    row('filler-cleanup', 'cleanup', ['Remove filler words and fix grammar and punctuation', 'Sacar muletillas y arreglar gramática y puntuación', 'Tirar vícios de linguagem e corrigir gramática e pontuação'], 'have', {
      weight: 2,
      detail: [
        "AI cleanup of fillers, punctuation and capitals, with a rules fallback when AI is off",
        "Limpieza con IA de muletillas, puntuación y mayúsculas, con limpieza por reglas si la IA está apagada",
        "Limpeza com IA de vícios, pontuação e maiúsculas, com limpeza por regras se a IA estiver desligada",
      ],
    }),
    row('backtrack', 'cleanup', ['Apply spoken self-corrections', 'Aplicar las autocorrecciones dichas', 'Aplicar as autocorreções faladas'], 'partial', {
      detail: [
        "Spoken corrections (\"Monday, no, I mean Tuesday\", \"scratch that\") are applied by the AI prompt and by a rules fallback; the rules cover clear cases only and the AI behaviour has not been measured against real recordings yet",
        "Las correcciones dichas (\"el lunes, no, quise decir el martes\", \"borrá eso\") las aplica la IA y una limpieza por reglas de respaldo; las reglas cubren solo los casos claros y todavía no medimos la IA con grabaciones reales",
        "As correções faladas (\"segunda, não, quis dizer terça\", \"apaga isso\") são aplicadas pela IA e por uma limpeza por regras de reserva; as regras cobrem só os casos claros e ainda não medimos a IA com gravações reais",
      ],
    }),
    row('lists-punctuation', 'cleanup', ['Spoken lists and punctuation', 'Listas y puntuación dictadas', 'Listas e pontuação ditadas'], 'have', {
      detail: [
        "\"First… second…\" becomes a numbered list and \"new line\" or \"new paragraph\" break lines",
        "\"Primero… segundo…\" arma una lista numerada y \"nueva línea\" o \"nuevo párrafo\" cortan la línea",
        "\"Primeiro… segundo…\" vira uma lista numerada e \"nova linha\" ou \"novo parágrafo\" quebram a linha",
      ],
    }),

    // Diccionario, snippets y estilos
    row('dictionary', 'personalization', ['Personal dictionary', 'Diccionario personal', 'Dicionário pessoal'], 'partial', {
      weight: 2,
      detail: [
        "Words to spell right (they also bias the transcription) and replacements, added by hand. It does not learn from your corrections yet",
        "Palabras para escribir bien (también orientan la transcripción) y reemplazos, cargados a mano. Todavía no aprende de tus correcciones",
        "Palavras para escrever certo (também orientam a transcrição) e substituições, cadastradas à mão. Ainda não aprende com suas correções",
      ],
    }),
    row('snippets', 'personalization', ['Voice snippets', 'Snippets por voz', 'Snippets por voz'], 'have', {
      detail: [
        'Wispr Flow: a spoken cue inserts saved text, like a booking link or a frequent answer',
        'Wispr Flow: una frase dicha inserta un texto guardado, como un link de agenda o una respuesta frecuente',
        'Wispr Flow: uma frase falada insere um texto salvo, como um link de agenda ou uma resposta frequente',
      ],
    }),
    row('styles-by-app', 'personalization', ['Tone by app', 'Tono según la app', 'Tom conforme o app'], 'have', {
      detail: [
        "Formal, neutral or casual tone per context (email, chat, note, other), picked from the app and the field",
        "Tono formal, neutro o informal por contexto (email, chat, nota, otros), según la app y el campo",
        "Tom formal, neutro ou informal por contexto (email, chat, nota, outros), conforme o app e o campo",
      ],
    }),
    row('context-names', 'personalization', ['Spell names from screen context', 'Escribir nombres según el contexto de la pantalla', 'Escrever nomes pelo contexto da tela'], 'missing'),
    row('code-mode', 'personalization', ['Dictation for code editors', 'Dictado para editores de código', 'Ditado para editores de código'], 'missing', {
      detail: [
        'Wispr Flow: knows visible variable and function names in Cursor, Windsurf and VS Code, and @-tags files in Cursor and Windsurf chat',
        'Wispr Flow: reconoce variables y funciones visibles en Cursor, Windsurf y VS Code, y etiqueta archivos con @ en el chat de Cursor y Windsurf',
        'Wispr Flow: reconhece variáveis e funções visíveis no Cursor, Windsurf e VS Code, e marca arquivos com @ no chat do Cursor e Windsurf',
      ],
    }),

    // Comandos
    row('command-mode', 'commands', ['Edit selected text by voice', 'Editar el texto seleccionado por voz', 'Editar o texto selecionado por voz'], 'missing', {
      detail: [
        'Wispr Flow Command Mode: select text and say "make it shorter" or "translate it"; off by default, paid plans',
        'Command Mode de Wispr Flow: seleccionar texto y decir "hacelo más corto" o "traducilo"; apagado por defecto, en planes pagos',
        'Command Mode do Wispr Flow: selecionar texto e dizer "deixa mais curto" ou "traduz"; desligado por padrão, em planos pagos',
      ],
    }),
    row('transforms', 'commands', ['Saved rewrite prompts', 'Prompts de reescritura guardados', 'Prompts de reescrita salvos'], 'missing', {
      detail: ['Wispr Flow Transforms (beta)', 'Transforms de Wispr Flow (beta)', 'Transforms do Wispr Flow (beta)'],
    }),

    // Escritorio, móvil y uso
    row('desktop-apps', 'apps', ['Mac and Windows desktop apps', 'Apps de escritorio para Mac y Windows', 'Apps desktop para Mac e Windows'], 'partial', {
      weight: 2,
      detail: [
        "Tauri v2 source for Mac and Windows in desktop/voice (global shortcut, paste, system audio). It is on the way: not built or signed yet, so there is no download",
        "Código Tauri v2 para Mac y Windows en desktop/voice (atajo global, pegado, audio del sistema). Está en camino: todavía no está compilado ni firmado, así que no hay descarga",
        "Código Tauri v2 para Mac e Windows em desktop/voice (atalho global, colar, áudio do sistema). Está a caminho: ainda não está compilado nem assinado, então não há download",
      ],
    }),
    row('mobile-apps', 'apps', ['iOS and Android', 'iOS y Android', 'iOS e Android'], 'missing', {
      detail: [
        'Wispr Flow keyboard on iPhone and Android; Granola apps for iOS, Android and Apple Watch',
        'Teclado de Wispr Flow en iPhone y Android; apps de Granola para iOS, Android y Apple Watch',
        'Teclado do Wispr Flow no iPhone e Android; apps do Granola para iOS, Android e Apple Watch',
      ],
    }),
    row('device-sync', 'apps', ['Sync across devices', 'Sincronizar entre dispositivos', 'Sincronizar entre dispositivos'], 'have', {
      detail: [
        "Dictionary, styles and history live on the server: every browser and the desktop app (its dictations are cleaned up there) use the same ones. The shortcut is per device",
        "El diccionario, los estilos y el historial viven en el servidor: cualquier navegador y la app de escritorio (sus dictados se limpian ahí) usan los mismos. El atajo es por dispositivo",
        "O dicionário, os estilos e o histórico ficam no servidor: qualquer navegador e o app desktop (os ditados dele são limpos lá) usam os mesmos. O atalho é por dispositivo",
      ],
    }),
    row('usage-stats', 'apps', ['Usage stats', 'Estadísticas de uso', 'Estatísticas de uso'], 'partial', {
      detail: [
        "Words this week, dictations and minutes for each person; no team dashboard",
        "Palabras de la semana, dictados y minutos por persona; sin panel de equipo",
        "Palavras da semana, ditados e minutos por pessoa; sem painel de equipe",
      ],
    }),

    // Captura de reuniones
    row('botless-capture', 'capture', ['Record meetings without a bot', 'Grabar reuniones sin bot', 'Gravar reuniões sem bot'], 'partial', {
      weight: 2,
      detail: [
        "No bot: the browser records your mic, or your mic plus a tab with Meet, Zoom or Teams on the web. The audio of native call apps needs the desktop app, which is on the way",
        "Sin bot: el navegador graba tu micrófono, o el micrófono y una pestaña con Meet, Zoom o Teams web. El audio de las apps de llamadas nativas necesita la app de escritorio, que está en camino",
        "Sem bot: o navegador grava seu microfone, ou o microfone e uma aba com Meet, Zoom ou Teams web. O áudio dos apps de chamada nativos precisa do app desktop, que está a caminho",
      ],
    }),
    row('live-transcript', 'capture', ['Live transcript', 'Transcripción en vivo', 'Transcrição ao vivo'], 'have', {
      weight: 2,
      detail: [
        "Searchable transcript split into Me (mic) and Them (tab), arriving in parts of about 20 seconds",
        "Transcripción con búsqueda separada en Yo (micrófono) y Ellos (pestaña), que llega en partes de unos 20 segundos",
        "Transcrição com busca separada em Eu (microfone) e Eles (aba), que chega em partes de uns 20 segundos",
      ],
    }),
    row('calendar-sync', 'capture', ['Calendar sync and meeting reminders', 'Calendario y aviso al empezar la reunión', 'Calendário e aviso no início da reunião'], 'partial', {
      weight: 2,
      detail: [
        "Upcoming Cal bookings show up to take notes and a meeting can be linked to one; no Google Calendar or Outlook and no reminder when it starts",
        "Las próximas reservas de Cal aparecen para tomar notas y se puede vincular una reunión; sin Google Calendar ni Outlook y sin aviso al empezar",
        "As próximas reservas do Cal aparecem para fazer notas e dá para vincular uma reunião; sem Google Calendar nem Outlook e sem aviso no início",
      ],
    }),
    row('speaker-names', 'capture', ['Speaker names', 'Nombres de quién habla', 'Nomes de quem fala'], 'partial', {
      detail: [
        "Me and Them by audio source, separate speakers with Deepgram or AssemblyAI, and names set by hand; no names from the call",
        "Yo y Ellos según la fuente de audio, hablantes separados con Deepgram o AssemblyAI y nombres puestos a mano; sin los nombres de la llamada",
        "Eu e Eles pela fonte de áudio, falantes separados com Deepgram ou AssemblyAI e nomes definidos à mão; sem os nomes da chamada",
      ],
    }),
    row('in-person-calls', 'capture', ['In-person meetings and phone calls', 'Reuniones en persona y llamadas de teléfono', 'Reuniões presenciais e ligações'], 'partial', {
      detail: [
        "Microphone mode records in-person meetings from the browser; no phone calls and no mobile app",
        "El modo micrófono graba reuniones en persona desde el navegador; sin llamadas de teléfono ni app móvil",
        "O modo microfone grava reuniões presenciais pelo navegador; sem ligações e sem app móvel",
      ],
    }),

    // Notas y resúmenes
    row('enhanced-notes', 'notes', ['AI notes from your notes and the transcript', 'Notas con IA a partir de lo escrito y la transcripción', 'Notas com IA a partir do que você escreveu e da transcrição'], 'have', {
      weight: 2,
      detail: [
        "AI combines your notes with the transcript and the template; your own lines stay marked",
        "La IA combina tus notas con la transcripción y la plantilla; tus líneas quedan marcadas",
        "A IA junta suas notas com a transcrição e o modelo; suas linhas ficam marcadas",
      ],
    }),
    row('note-templates', 'notes', ['Note templates', 'Plantillas de notas', 'Modelos de notas'], 'have', {
      weight: 2,
      detail: [
        "Sales, 1:1, stand-up, interview, customer and general, plus your own",
        "Ventas, 1:1, daily, entrevista, cliente y general, más las propias",
        "Vendas, 1:1, daily, entrevista, cliente e geral, mais os próprios",
      ],
    }),
    row('note-sources', 'notes', ['See where each point came from', 'Ver de dónde sale cada punto', 'Ver de onde vem cada ponto'], 'have', {
      detail: [
        "Each point says whether it came from your notes or from the transcript",
        "Cada punto dice si salió de tus notas o de la transcripción",
        "Cada ponto diz se veio das suas notas ou da transcrição",
      ],
    }),
    row('pre-meeting-brief', 'notes', ['Pre-meeting brief', 'Brief antes de la reunión', 'Brief antes da reunião'], 'missing', {
      detail: ['Granola Business', 'Granola Business', 'Granola Business'],
    }),
    row('follow-up-email', 'notes', ['Follow-up email draft', 'Borrador de email de seguimiento', 'Rascunho de email de follow-up'], 'missing', {
      detail: ['Granola Business, in Gmail or Outlook', 'Granola Business, en Gmail u Outlook', 'Granola Business, no Gmail ou Outlook'],
    }),

    // Chat
    row('chat-meeting', 'chat', ['Chat with one meeting', 'Chat sobre una reunión', 'Chat sobre uma reunião'], 'have', {
      weight: 2,
      detail: ['Granola Chat before, during and after the meeting', 'Granola Chat antes, durante y después de la reunión', 'Granola Chat antes, durante e depois da reunião'],
    }),
    row('chat-across', 'chat', ['Chat across meetings', 'Chat sobre muchas reuniones', 'Chat sobre várias reuniões'], 'have', {
      weight: 2,
      detail: [
        "Questions across your meetings, answered from the ones that mention the topic, with links to each",
        "Preguntas sobre tus reuniones, respondidas con las que mencionan el tema y links a cada una",
        "Perguntas sobre suas reuniões, respondidas com as que citam o assunto e links para cada uma",
      ],
    }),
    row('recipes', 'chat', ['Saved prompts (recipes)', 'Prompts guardados (recipes)', 'Prompts salvos (recipes)'], 'missing', {
      detail: [
        'Granola: run with /, for one or many meetings, shareable by link',
        'Granola: se corren con /, para una o varias reuniones, compartibles por link',
        'Granola: rodam com /, para uma ou várias reuniões, compartilháveis por link',
      ],
    }),
    row('people-companies', 'chat', ['People and companies from meetings', 'Personas y empresas de las reuniones', 'Pessoas e empresas das reuniões'], 'partial', {
      detail: [
        "A meeting links to a CRM contact (by hand or from the Cal guest email); no automatic directory of people and companies",
        "Una reunión se vincula a un contacto del CRM (a mano o por el email del invitado de Cal); sin directorio automático de personas y empresas",
        "Uma reunião se vincula a um contato do CRM (à mão ou pelo email do convidado do Cal); sem diretório automático de pessoas e empresas",
      ],
    }),

    // Organizar y compartir
    row('share-link', 'organize', ['Share notes by link', 'Compartir notas por link', 'Compartilhar notas por link'], 'partial', {
      weight: 2,
      detail: [
        "Meetings are private; you share them by sending the notes to Docs or Notes, which have their own sharing",
        "Las reuniones son privadas; se comparten mandando la nota a Docs o Notes, que tienen sus propios permisos",
        "As reuniões são privadas; são compartilhadas enviando a nota para Docs ou Notes, que têm suas próprias permissões",
      ],
    }),
    row('folders-spaces', 'organize', ['Spaces and folders', 'Espacios y carpetas', 'Espaços e pastas'], 'missing', {
      detail: [
        'Granola: private notes, a team space, custom spaces and folders one level deep',
        'Granola: notas privadas, espacio del equipo, espacios propios y carpetas con un nivel de subcarpetas',
        'Granola: notas privadas, espaço da equipe, espaços próprios e pastas com um nível de subpastas',
      ],
    }),
    row('copy-export', 'organize', ['Copy as Markdown and send by email', 'Copiar en Markdown y mandar por email', 'Copiar em Markdown e enviar por email'], 'partial', {
      detail: [
        "Copy as Markdown and send to Docs or Notes; no email sending",
        "Copiar en Markdown y mandar a Docs o Notes; sin envío por email",
        "Copiar em Markdown e enviar para Docs ou Notes; sem envio por email",
      ],
    }),

    // Integraciones y API
    row('slack-notion', 'integrations', ['Send notes to Slack and Notion', 'Mandar notas a Slack y Notion', 'Enviar notas para Slack e Notion'], 'missing', {
      detail: ['Granola: Slack on the free plan, Notion on Business', 'Granola: Slack en el plan gratis, Notion en Business', 'Granola: Slack no plano grátis, Notion no Business'],
    }),
    row('crm-sync', 'integrations', ['Send notes to the CRM', 'Mandar notas al CRM', 'Enviar notas para o CRM'], 'have', {
      detail: [
        "The notes land on the zerosoft CRM contact timeline and next steps become CRM tasks",
        "La nota queda en el timeline del contacto del CRM de zerosoft y los próximos pasos pasan a tareas del CRM",
        "A nota fica na linha do tempo do contato do CRM do zerosoft e os próximos passos viram tarefas do CRM",
      ],
    }),
    row('zapier', 'integrations', ['Zapier', 'Zapier', 'Zapier'], 'missing', {
      detail: ['Granola Business', 'Granola Business', 'Granola Business'],
    }),
    row('mcp-server', 'integrations', ['MCP server for AI assistants', 'Servidor MCP para asistentes de IA', 'Servidor MCP para assistentes de IA'], 'missing', {
      detail: [
        'Granola and Wispr Flow expose notes to Claude, ChatGPT and other MCP clients',
        'Granola y Wispr Flow exponen las notas a Claude, ChatGPT y otros clientes MCP',
        'Granola e Wispr Flow expõem as notas para Claude, ChatGPT e outros clientes MCP',
      ],
    }),
    row('api-webhooks', 'integrations', ['API and webhooks', 'API y webhooks', 'API e webhooks'], 'partial', {
      detail: [
        "API v1 with voice:read and voice:write (dictate, sessions, audio chunks, dictionary); no webhooks yet",
        "API v1 con voice:read y voice:write (dictado, sesiones, trozos de audio, diccionario); sin webhooks todavía",
        "API v1 com voice:read e voice:write (ditado, sessões, trechos de áudio, dicionário); sem webhooks por enquanto",
      ],
    }),

    // Equipos, privacidad y admin
    row('team-dictionary', 'admin', ['Team dictionary and snippets', 'Diccionario y snippets del equipo', 'Dicionário e snippets da equipe'], 'missing', {
      detail: ['Wispr Flow Pro and Granola Business', 'Wispr Flow Pro y Granola Business', 'Wispr Flow Pro e Granola Business'],
    }),
    row('recording-notice', 'admin', ['Recording notice for attendees', 'Aviso de grabación a los asistentes', 'Aviso de gravação aos participantes'], 'partial', {
      detail: [
        "The recorder reminds you to tell attendees; nothing is posted in the call",
        "El grabador te recuerda avisar a los asistentes; no se publica nada en la llamada",
        "O gravador lembra você de avisar os participantes; nada é publicado na chamada",
      ],
    }),
    row('retention', 'admin', ['Retention and auto-deletion', 'Retención y borrado automático', 'Retenção e exclusão automática'], 'partial', {
      detail: [
        "The audio is never stored: it is transcribed in parts and discarded. Transcripts are kept until you delete them; no automatic deletion",
        "El audio nunca se guarda: se transcribe por partes y se descarta. Las transcripciones quedan hasta que las borrás; sin borrado automático",
        "O áudio nunca é guardado: é transcrito em partes e descartado. As transcrições ficam até você apagar; sem exclusão automática",
      ],
    }),
    row('sso-scim', 'admin', ['SSO and SCIM', 'SSO y SCIM', 'SSO e SCIM'], 'missing', {
      detail: [
        'Wispr Flow Growth (SSO) and Enterprise (SCIM); Granola Enterprise',
        'Wispr Flow Growth (SSO) y Enterprise (SCIM); Granola Enterprise',
        'Wispr Flow Growth (SSO) e Enterprise (SCIM); Granola Enterprise',
      ],
    }),
  ],
};

export default parity;
