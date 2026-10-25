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
 * docs/benchmark/voice.md. Voice todavía no existe (solo el shell
 * "Próximamente"), así que todas las filas están en missing.
 */
const parity: ProductParity = {
  competitor: 'Wispr Flow + Granola',
  lastReviewed: '2026-10-25',
  areas: [
    { id: 'dictation', label: loc(['Dictation in any app', 'Dictado en cualquier app', 'Ditado em qualquer app']) },
    { id: 'cleanup', label: loc(['AI cleanup and formatting', 'Limpieza y formato con AI', 'Limpeza e formatação com IA']) },
    { id: 'personalization', label: loc(['Dictionary, snippets and styles', 'Diccionario, snippets y estilos', 'Dicionário, snippets e estilos']) },
    { id: 'commands', label: loc(['Voice commands and rewriting', 'Comandos de voz y reescritura', 'Comandos de voz e reescrita']) },
    { id: 'apps', label: loc(['Desktop, mobile and usage', 'Escritorio, móvil y uso', 'Desktop, celular e uso']) },
    { id: 'capture', label: loc(['Meeting capture', 'Captura de reuniones', 'Captura de reuniões']) },
    { id: 'notes', label: loc(['AI notes and summaries', 'Notas y resúmenes con AI', 'Notas e resumos com IA']) },
    { id: 'chat', label: loc(['Chat with meetings', 'Chat con las reuniones', 'Chat com as reuniões']) },
    { id: 'organize', label: loc(['Organize and share', 'Organizar y compartir', 'Organizar e compartilhar']) },
    { id: 'integrations', label: loc(['Integrations and API', 'Integraciones y API', 'Integrações e API']) },
    { id: 'admin', label: loc(['Teams, privacy and admin', 'Equipos, privacidad y admin', 'Equipes, privacidade e admin']) },
  ],
  rows: [
    // Dictado en cualquier app
    row('dictate-any-app', 'dictation', ['Dictate into any text field with a shortcut', 'Dictar en cualquier campo de texto con un atajo', 'Ditar em qualquer campo de texto com um atalho'], 'missing', {
      weight: 2,
      detail: [
        'Wispr Flow: hold Fn (Mac) or Ctrl+Win (Windows), speak, and the text is pasted at the cursor',
        'Wispr Flow: mantener Fn (Mac) o Ctrl+Win (Windows), hablar, y el texto se pega donde está el cursor',
        'Wispr Flow: segurar Fn (Mac) ou Ctrl+Win (Windows), falar, e o texto é colado onde está o cursor',
      ],
    }),
    row('hands-free', 'dictation', ['Hands-free mode', 'Modo manos libres', 'Modo mãos livres'], 'missing', {
      detail: [
        'Wispr Flow: Fn+Space starts and stops dictation without holding a key',
        'Wispr Flow: Fn+Space empieza y termina el dictado sin mantener la tecla',
        'Wispr Flow: Fn+Space inicia e encerra o ditado sem segurar a tecla',
      ],
    }),
    row('languages', 'dictation', ['More than 100 languages', 'Más de 100 idiomas', 'Mais de 100 idiomas'], 'missing', {
      weight: 2,
      detail: [
        'Wispr Flow dictation and Granola transcription in several languages per account',
        'Dictado de Wispr Flow y transcripción de Granola en varios idiomas por cuenta',
        'Ditado do Wispr Flow e transcrição do Granola em vários idiomas por conta',
      ],
    }),
    row('whisper-mode', 'dictation', ['Whisper mode', 'Modo susurro', 'Modo sussurro'], 'missing', {
      detail: ['Wispr Flow: dictate at low volume in shared spaces', 'Wispr Flow: dictar en voz baja en lugares compartidos', 'Wispr Flow: ditar em voz baixa em lugares compartilhados'],
    }),
    row('paste-last', 'dictation', ['Paste or copy the last dictation', 'Pegar o copiar el último dictado', 'Colar ou copiar o último ditado'], 'missing', {
      detail: [
        'Wispr Flow: a shortcut pastes or copies the last transcript if it did not land',
        'Wispr Flow: un atajo pega o copia el último dictado si no se pegó',
        'Wispr Flow: um atalho cola ou copia o último ditado se ele não foi colado',
      ],
    }),

    // Limpieza y formato
    row('filler-cleanup', 'cleanup', ['Remove filler words and fix grammar and punctuation', 'Sacar muletillas y arreglar gramática y puntuación', 'Tirar vícios de linguagem e corrigir gramática e pontuação'], 'missing', {
      weight: 2,
      detail: [
        'Wispr Flow Smart Formatting, on by default: "um", pauses, capitals and punctuation',
        'Smart Formatting de Wispr Flow, prendido por defecto: muletillas, pausas, mayúsculas y puntuación',
        'Smart Formatting do Wispr Flow, ligado por padrão: vícios, pausas, maiúsculas e pontuação',
      ],
    }),
    row('backtrack', 'cleanup', ['Apply spoken self-corrections', 'Aplicar las autocorrecciones dichas', 'Aplicar as autocorreções faladas'], 'missing', {
      detail: [
        'Wispr Flow Backtrack: "Monday, scratch that, Tuesday" becomes "Tuesday"',
        'Backtrack de Wispr Flow: "el lunes, no, mejor el martes" queda "el martes"',
        'Backtrack do Wispr Flow: "segunda, não, melhor terça" vira "terça"',
      ],
    }),
    row('lists-punctuation', 'cleanup', ['Spoken lists and punctuation', 'Listas y puntuación dictadas', 'Listas e pontuação ditadas'], 'missing', {
      detail: [
        'Wispr Flow: "first... second..." makes a list; "comma" or "new line" insert the mark',
        'Wispr Flow: "primero... segundo..." arma una lista; "coma" o "nueva línea" insertan el signo',
        'Wispr Flow: "primeiro... segundo..." cria uma lista; "vírgula" ou "nova linha" inserem o sinal',
      ],
    }),

    // Diccionario, snippets y estilos
    row('dictionary', 'personalization', ['Personal dictionary', 'Diccionario personal', 'Dicionário pessoal'], 'missing', {
      weight: 2,
      detail: [
        'Wispr Flow learns from corrections and takes manual words; Granola takes custom transcription terms',
        'Wispr Flow aprende de las correcciones y acepta palabras a mano; Granola acepta términos propios para la transcripción',
        'O Wispr Flow aprende com as correções e aceita palavras manuais; o Granola aceita termos próprios na transcrição',
      ],
    }),
    row('snippets', 'personalization', ['Voice snippets', 'Snippets por voz', 'Snippets por voz'], 'missing', {
      detail: [
        'Wispr Flow: a spoken cue inserts saved text, like a booking link or a frequent answer',
        'Wispr Flow: una frase dicha inserta un texto guardado, como un link de agenda o una respuesta frecuente',
        'Wispr Flow: uma frase falada insere um texto salvo, como um link de agenda ou uma resposta frequente',
      ],
    }),
    row('styles-by-app', 'personalization', ['Tone by app', 'Tono según la app', 'Tom conforme o app'], 'missing', {
      detail: [
        'Wispr Flow Styles: formal, casual, very casual or excited per category (personal, work, email, other); English only',
        'Styles de Wispr Flow: formal, casual, muy casual o entusiasta por categoría (personal, trabajo, email, otros); solo en inglés',
        'Styles do Wispr Flow: formal, casual, bem casual ou animado por categoria (pessoal, trabalho, email, outros); só em inglês',
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
    row('desktop-apps', 'apps', ['Mac and Windows desktop apps', 'Apps de escritorio para Mac y Windows', 'Apps desktop para Mac e Windows'], 'missing', {
      weight: 2,
      detail: [
        'Both products ship native apps; Granola on the web only views and edits',
        'Los dos tienen app nativa; Granola en la web solo ve y edita',
        'Os dois têm app nativo; o Granola na web só vê e edita',
      ],
    }),
    row('mobile-apps', 'apps', ['iOS and Android', 'iOS y Android', 'iOS e Android'], 'missing', {
      detail: [
        'Wispr Flow keyboard on iPhone and Android; Granola apps for iOS, Android and Apple Watch',
        'Teclado de Wispr Flow en iPhone y Android; apps de Granola para iOS, Android y Apple Watch',
        'Teclado do Wispr Flow no iPhone e Android; apps do Granola para iOS, Android e Apple Watch',
      ],
    }),
    row('device-sync', 'apps', ['Sync across devices', 'Sincronizar entre dispositivos', 'Sincronizar entre dispositivos'], 'missing', {
      detail: [
        'Wispr Flow syncs dictionary, snippets and settings; Granola syncs notes',
        'Wispr Flow sincroniza diccionario, snippets y ajustes; Granola sincroniza notas',
        'O Wispr Flow sincroniza dicionário, snippets e ajustes; o Granola sincroniza notas',
      ],
    }),
    row('usage-stats', 'apps', ['Usage stats', 'Estadísticas de uso', 'Estatísticas de uso'], 'missing', {
      detail: [
        'Wispr Flow Usage tab, with team dashboards on paid plans',
        'Pestaña Usage de Wispr Flow, con paneles de equipo en planes pagos',
        'Aba Usage do Wispr Flow, com painéis de equipe nos planos pagos',
      ],
    }),

    // Captura de reuniones
    row('botless-capture', 'capture', ['Record meetings without a bot', 'Grabar reuniones sin bot', 'Gravar reuniões sem bot'], 'missing', {
      weight: 2,
      detail: [
        'Granola captures system audio and the mic for any call (Zoom, Meet, Teams, Slack) and does not keep the audio',
        'Granola captura el audio del sistema y el micrófono en cualquier llamada (Zoom, Meet, Teams, Slack) y no guarda el audio',
        'O Granola captura o áudio do sistema e o microfone em qualquer chamada (Zoom, Meet, Teams, Slack) e não guarda o áudio',
      ],
    }),
    row('live-transcript', 'capture', ['Live transcript', 'Transcripción en vivo', 'Transcrição ao vivo'], 'missing', {
      weight: 2,
      detail: [
        'Granola: a searchable panel split into "Me" and "Them"; stops on its own when the call ends',
        'Granola: panel con búsqueda separado en "Yo" y "Ellos"; para solo cuando termina la llamada',
        'Granola: painel com busca separado em "Eu" e "Eles"; para sozinho quando a chamada termina',
      ],
    }),
    row('calendar-sync', 'capture', ['Calendar sync and meeting reminders', 'Calendario y aviso al empezar la reunión', 'Calendário e aviso no início da reunião'], 'missing', {
      weight: 2,
      detail: ['Granola and Wispr Notetaker: Google Calendar and Outlook', 'Granola y Wispr Notetaker: Google Calendar y Outlook', 'Granola e Wispr Notetaker: Google Calendar e Outlook'],
    }),
    row('speaker-names', 'capture', ['Speaker names', 'Nombres de quién habla', 'Nomes de quem fala'], 'missing', {
      detail: [
        'Granola: real names in Meet, Zoom and Teams; "Me" and "Them" elsewhere',
        'Granola: nombres reales en Meet, Zoom y Teams; "Yo" y "Ellos" en el resto',
        'Granola: nomes reais no Meet, Zoom e Teams; "Eu" e "Eles" no resto',
      ],
    }),
    row('in-person-calls', 'capture', ['In-person meetings and phone calls', 'Reuniones en persona y llamadas de teléfono', 'Reuniões presenciais e ligações'], 'missing', {
      detail: ['Granola mobile', 'Granola en el celular', 'Granola no celular'],
    }),

    // Notas y resúmenes
    row('enhanced-notes', 'notes', ['AI notes from your notes and the transcript', 'Notas con AI a partir de lo escrito y la transcripción', 'Notas com IA a partir do que você escreveu e da transcrição'], 'missing', {
      weight: 2,
      detail: [
        'Granola merges the transcript, your notes and the calendar event; your own lines stay marked',
        'Granola mezcla la transcripción, tus notas y el evento del calendario; lo que escribiste queda marcado',
        'O Granola junta a transcrição, suas notas e o evento do calendário; o que você escreveu fica marcado',
      ],
    }),
    row('note-templates', 'notes', ['Note templates', 'Plantillas de notas', 'Modelos de notas'], 'missing', {
      weight: 2,
      detail: [
        'Granola: built-in templates per meeting type (sales, 1:1, stand-up, interview) and custom ones shared with the company',
        'Granola: plantillas de fábrica por tipo de reunión (ventas, 1:1, daily, entrevista) y propias compartidas con la empresa',
        'Granola: modelos prontos por tipo de reunião (vendas, 1:1, daily, entrevista) e próprios compartilhados com a empresa',
      ],
    }),
    row('note-sources', 'notes', ['See where each point came from', 'Ver de dónde sale cada punto', 'Ver de onde vem cada ponto'], 'missing', {
      detail: ['Granola: transcript or your own notes', 'Granola: la transcripción o tus notas', 'Granola: a transcrição ou suas notas'],
    }),
    row('pre-meeting-brief', 'notes', ['Pre-meeting brief', 'Brief antes de la reunión', 'Brief antes da reunião'], 'missing', {
      detail: ['Granola Business', 'Granola Business', 'Granola Business'],
    }),
    row('follow-up-email', 'notes', ['Follow-up email draft', 'Borrador de email de seguimiento', 'Rascunho de email de follow-up'], 'missing', {
      detail: ['Granola Business, in Gmail or Outlook', 'Granola Business, en Gmail u Outlook', 'Granola Business, no Gmail ou Outlook'],
    }),

    // Chat
    row('chat-meeting', 'chat', ['Chat with one meeting', 'Chat sobre una reunión', 'Chat sobre uma reunião'], 'missing', {
      weight: 2,
      detail: ['Granola Chat before, during and after the meeting', 'Granola Chat antes, durante y después de la reunión', 'Granola Chat antes, durante e depois da reunião'],
    }),
    row('chat-across', 'chat', ['Chat across meetings', 'Chat sobre muchas reuniones', 'Chat sobre várias reuniões'], 'missing', {
      weight: 2,
      detail: [
        'Granola: all notes, a folder, a selection or a person (30 days on the free plan); Wispr Flow has Ask Wispr',
        'Granola: todas las notas, una carpeta, una selección o una persona (30 días en el plan gratis); Wispr Flow tiene Ask Wispr',
        'Granola: todas as notas, uma pasta, uma seleção ou uma pessoa (30 dias no plano grátis); o Wispr Flow tem o Ask Wispr',
      ],
    }),
    row('recipes', 'chat', ['Saved prompts (recipes)', 'Prompts guardados (recipes)', 'Prompts salvos (recipes)'], 'missing', {
      detail: [
        'Granola: run with /, for one or many meetings, shareable by link',
        'Granola: se corren con /, para una o varias reuniones, compartibles por link',
        'Granola: rodam com /, para uma ou várias reuniões, compartilháveis por link',
      ],
    }),
    row('people-companies', 'chat', ['People and companies from meetings', 'Personas y empresas de las reuniones', 'Pessoas e empresas das reuniões'], 'missing', {
      detail: [
        'Granola builds a directory from calendar attendees and lists every meeting with them',
        'Granola arma un directorio con los asistentes del calendario y lista todas sus reuniones',
        'O Granola monta um diretório com os participantes do calendário e lista todas as reuniões com eles',
      ],
    }),

    // Organizar y compartir
    row('share-link', 'organize', ['Share notes by link', 'Compartir notas por link', 'Compartilhar notas por link'], 'missing', {
      weight: 2,
      detail: [
        'Granola: invited people, workspace or anyone with the link; viewer and collaborator roles',
        'Granola: invitados, workspace o cualquiera con el link; roles lector y colaborador',
        'Granola: convidados, workspace ou qualquer pessoa com o link; papéis leitor e colaborador',
      ],
    }),
    row('folders-spaces', 'organize', ['Spaces and folders', 'Espacios y carpetas', 'Espaços e pastas'], 'missing', {
      detail: [
        'Granola: private notes, a team space, custom spaces and folders one level deep',
        'Granola: notas privadas, espacio del equipo, espacios propios y carpetas con un nivel de subcarpetas',
        'Granola: notas privadas, espaço da equipe, espaços próprios e pastas com um nível de subpastas',
      ],
    }),
    row('copy-export', 'organize', ['Copy as Markdown and send by email', 'Copiar en Markdown y mandar por email', 'Copiar em Markdown e enviar por email'], 'missing'),

    // Integraciones y API
    row('slack-notion', 'integrations', ['Send notes to Slack and Notion', 'Mandar notas a Slack y Notion', 'Enviar notas para Slack e Notion'], 'missing', {
      detail: ['Granola: Slack on the free plan, Notion on Business', 'Granola: Slack en el plan gratis, Notion en Business', 'Granola: Slack no plano grátis, Notion no Business'],
    }),
    row('crm-sync', 'integrations', ['Send notes to the CRM', 'Mandar notas al CRM', 'Enviar notas para o CRM'], 'missing', {
      detail: [
        'Granola Business: HubSpot, Attio and Affinity; Salesforce on Enterprise',
        'Granola Business: HubSpot, Attio y Affinity; Salesforce en Enterprise',
        'Granola Business: HubSpot, Attio e Affinity; Salesforce no Enterprise',
      ],
    }),
    row('zapier', 'integrations', ['Zapier', 'Zapier', 'Zapier'], 'missing', {
      detail: ['Granola Business', 'Granola Business', 'Granola Business'],
    }),
    row('mcp-server', 'integrations', ['MCP server for AI assistants', 'Servidor MCP para asistentes de AI', 'Servidor MCP para assistentes de IA'], 'missing', {
      detail: [
        'Granola and Wispr Flow expose notes to Claude, ChatGPT and other MCP clients',
        'Granola y Wispr Flow exponen las notas a Claude, ChatGPT y otros clientes MCP',
        'Granola e Wispr Flow expõem as notas para Claude, ChatGPT e outros clientes MCP',
      ],
    }),
    row('api-webhooks', 'integrations', ['API and webhooks', 'API y webhooks', 'API e webhooks'], 'missing', {
      detail: [
        'Granola: notes, transcripts, folders and spaces, with webhooks',
        'Granola: notas, transcripciones, carpetas y espacios, con webhooks',
        'Granola: notas, transcrições, pastas e espaços, com webhooks',
      ],
    }),

    // Equipos, privacidad y admin
    row('team-dictionary', 'admin', ['Team dictionary and snippets', 'Diccionario y snippets del equipo', 'Dicionário e snippets da equipe'], 'missing', {
      detail: ['Wispr Flow Pro and Granola Business', 'Wispr Flow Pro y Granola Business', 'Wispr Flow Pro e Granola Business'],
    }),
    row('recording-notice', 'admin', ['Recording notice for attendees', 'Aviso de grabación a los asistentes', 'Aviso de gravação aos participantes'], 'missing', {
      detail: [
        'Granola: automatic chat message in Meet, Zoom, Teams and Slack, calendar notice and watermark; Wispr Notetaker posts a notice too',
        'Granola: mensaje automático en el chat de Meet, Zoom, Teams y Slack, aviso en el calendario y marca de agua; Wispr Notetaker también avisa',
        'Granola: mensagem automática no chat do Meet, Zoom, Teams e Slack, aviso no calendário e marca d\'água; o Wispr Notetaker também avisa',
      ],
    }),
    row('retention', 'admin', ['Retention and auto-deletion', 'Retención y borrado automático', 'Retenção e exclusão automática'], 'missing', {
      detail: [
        'Granola deletes audio after transcribing and can auto-delete transcripts; Wispr Notetaker sets how long meetings are kept',
        'Granola borra el audio después de transcribir y puede borrar transcripciones solas; Wispr Notetaker define cuánto se guardan las reuniones',
        'O Granola apaga o áudio depois de transcrever e pode apagar transcrições sozinho; o Wispr Notetaker define por quanto tempo as reuniões ficam guardadas',
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
