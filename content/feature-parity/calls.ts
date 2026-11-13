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
 * Calls contra Gong. Fuente: docs/benchmark/calls.md (sitio y centro de ayuda
 * públicos de Gong, leídos el 2026-11-08). have solo para lo que funciona de
 * punta a punta con tests reales; lo probado con fakes (el bot contra una
 * página falsa de Meet, el calendario falso, el modelo de IA falso) queda como
 * partial. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Gong',
  lastReviewed: '2026-11-12',
  areas: [
    { id: 'capture', label: loc(['Recording', 'Grabación', 'Gravação']) },
    { id: 'transcript', label: loc(['Transcript', 'Transcripción', 'Transcrição']) },
    { id: 'library', label: loc(['Call library', 'Biblioteca de llamadas', 'Biblioteca de chamadas']) },
    { id: 'player', label: loc(['Call page', 'Página de la llamada', 'Página da chamada']) },
    { id: 'collab', label: loc(['Sharing and collaboration', 'Compartir y colaborar', 'Compartilhar e colaborar']) },
    { id: 'ai', label: loc(['AI insights', 'Análisis con IA', 'Análise com IA']) },
    { id: 'metrics', label: loc(['Stats and coaching', 'Métricas y coaching', 'Métricas e coaching']) },
    { id: 'deals', label: loc(['Deals and forecast', 'Deals y forecast', 'Deals e forecast']) },
    { id: 'platform', label: loc(['Integrations and platform', 'Integraciones y plataforma', 'Integrações e plataforma']) },
  ],
  rows: [
    // Grabación
    row('meet-bot', 'capture', ['Recording bot for Google Meet', 'Bot que graba Google Meet', 'Bot que grava o Google Meet'], 'partial', {
      weight: 2,
      detail: [
        'zerosoft Notetaker joins as a guest, records audio and video, and leaves when the meeting ends, when it is left alone, at 3 hours or when you stop it. Tested against a simulated Meet page inside the real bot container, not yet against live Google Meet',
        'zerosoft Notetaker entra como invitado, graba audio y video, y se va cuando termina la reunión, cuando queda solo, a las 3 horas o cuando lo parás. Probado contra una página de Meet simulada dentro del contenedor real del bot, todavía no contra Google Meet en vivo',
        'zerosoft Notetaker entra como convidado, grava áudio e vídeo, e sai quando a reunião termina, quando fica sozinho, às 3 horas ou quando você o para. Testado contra uma página do Meet simulada dentro do contêiner real do bot, ainda não contra o Google Meet ao vivo',
      ],
    }),
    row('zoom-bot', 'capture', ['Recording bot for Zoom', 'Bot que graba Zoom', 'Bot que grava o Zoom'], 'missing', {
      weight: 2,
      detail: ['Zoom links are detected; the bot does not join them yet', 'Los links de Zoom se detectan; el bot todavía no entra', 'Os links do Zoom são detectados; o bot ainda não entra'],
    }),
    row('teams-bot', 'capture', ['Recording bot for Microsoft Teams', 'Bot que graba Microsoft Teams', 'Bot que grava o Microsoft Teams'], 'missing', {
      weight: 2,
      detail: ['Teams links are detected; the bot does not join them yet', 'Los links de Teams se detectan; el bot todavía no entra', 'Os links do Teams são detectados; o bot ainda não entra'],
    }),
    row('phone-calls', 'capture', ['Phone calls through a dialer', 'Llamadas telefónicas con un discador', 'Ligações telefônicas com um discador'], 'missing', { weight: 2 }),
    row('consent-notice', 'capture', ['Recording notice to participants', 'Aviso de grabación a los participantes', 'Aviso de gravação aos participantes'], 'partial', {
      detail: [
        'The bot posts a recording notice in the meeting chat when it joins. Tested only on the simulated Meet page',
        'El bot publica un aviso de grabación en el chat de la reunión al entrar. Probado solo en la página de Meet simulada',
        'O bot publica um aviso de gravação no chat da reunião ao entrar. Testado só na página do Meet simulada',
      ],
    }),
    row('calendar-autojoin', 'capture', ['Auto-join from the calendar', 'Entrar solo desde el calendario', 'Entrar sozinho a partir da agenda'], 'partial', {
      weight: 2,
      detail: [
        'Uses the Google Calendar or Outlook connection from Cal. Rule per person: every meeting with a Meet link, only with external attendees, only external with an open deal, or manual, plus a switch per meeting. Tested with a simulated Google Calendar',
        'Usa la conexión de Google Calendar u Outlook de Cal. Regla por persona: toda reunión con link de Meet, solo con invitados externos, solo externos con un deal abierto o manual, más un interruptor por reunión. Probado con un Google Calendar simulado',
        'Usa a conexão do Google Calendar ou Outlook do Cal. Regra por pessoa: toda reunião com link do Meet, só com convidados externos, só externos com um deal aberto ou manual, mais um botão por reunião. Testado com um Google Calendar simulado',
      ],
    }),
    row('bot-by-link', 'capture', ['Send the bot to a meeting by link', 'Mandar el bot a una reunión con el link', 'Mandar o bot para uma reunião pelo link'], 'partial', {
      detail: ['Works with Meet links only, with the same limits as the Meet bot', 'Funciona solo con links de Meet, con los mismos límites que el bot de Meet', 'Funciona só com links do Meet, com os mesmos limites do bot do Meet'],
    }),
    row('upload-recording', 'capture', ['Upload a recording', 'Subir una grabación', 'Enviar uma gravação'], 'have', {
      detail: ['Audio or video file, transcribed and analyzed like a recorded call', 'Archivo de audio o video, transcripto y analizado como una llamada grabada', 'Arquivo de áudio ou vídeo, transcrito e analisado como uma chamada gravada'],
    }),

    // Transcripción
    row('transcription', 'transcript', ['Transcription', 'Transcripción', 'Transcrição'], 'partial', {
      weight: 2,
      detail: [
        'Through the speech-to-text provider Voice uses (gateway, OpenAI Whisper, Deepgram or AssemblyAI), in 10-minute segments. Languages and accuracy depend on that provider',
        'Con el proveedor de voz a texto que usa Voice (gateway, OpenAI Whisper, Deepgram o AssemblyAI), en partes de 10 minutos. Idiomas y precisión dependen de ese proveedor',
        'Com o provedor de voz para texto que o Voice usa (gateway, OpenAI Whisper, Deepgram ou AssemblyAI), em partes de 10 minutos. Idiomas e precisão dependem desse provedor',
      ],
    }),
    row('speaker-names', 'transcript', ['Speaker names in the transcript', 'Nombres de quien habla en la transcripción', 'Nomes de quem fala na transcrição'], 'partial', {
      weight: 2,
      detail: [
        'From the active speaker and captions in Meet; you can rename speakers and mark them internal or external. An uploaded file has no names until you set them',
        'Del orador activo y los subtítulos de Meet; podés renombrar a cada persona y marcarla interna o externa. Un archivo subido no trae nombres hasta que los ponés',
        'Do orador ativo e das legendas do Meet; você pode renomear cada pessoa e marcá-la como interna ou externa. Um arquivo enviado não traz nomes até você colocá-los',
      ],
    }),
    row('transcript-translation', 'transcript', ['Transcript translation', 'Traducción de la transcripción', 'Tradução da transcrição'], 'missing'),

    // Biblioteca
    row('call-library', 'library', ['Call library with filters', 'Biblioteca de llamadas con filtros', 'Biblioteca de chamadas com filtros'], 'have', {
      weight: 2,
      detail: ['Filter by rep, deal, date range and duration', 'Filtros por vendedor, deal, rango de fechas y duración', 'Filtros por vendedor, deal, período e duração'],
    }),
    row('transcript-search', 'library', ['Search what was said', 'Buscar lo que se dijo', 'Buscar o que foi dito'], 'have', {
      weight: 2,
      detail: ['In titles and transcripts, from the library and from Cmd+K', 'En títulos y transcripciones, desde la biblioteca y desde Cmd+K', 'Em títulos e transcrições, na biblioteca e no Cmd+K'],
    }),
    row('library-export', 'library', ['Export the call list', 'Exportar la lista de llamadas', 'Exportar a lista de chamadas'], 'have', {
      detail: ['CSV with the active filters', 'CSV con los filtros aplicados', 'CSV com os filtros aplicados'],
    }),
    row('keyword-trackers', 'library', ['Keyword trackers', 'Trackers de palabras', 'Trackers de palavras'], 'partial', {
      detail: [
        'Only competitors: a list you configure, matched word by word and also by the AI. No trackers for other terms',
        'Solo competidores: una lista que configurás, buscada palabra por palabra y también por la IA. Sin trackers para otros términos',
        'Só concorrentes: uma lista que você configura, buscada palavra por palavra e também pela IA. Sem trackers para outros termos',
      ],
    }),
    row('smart-trackers', 'library', ['Smart trackers trained on examples', 'Trackers inteligentes entrenados con ejemplos', 'Trackers inteligentes treinados com exemplos'], 'missing'),

    // Página de la llamada
    row('synced-player', 'player', ['Player with a synced transcript', 'Reproductor con transcripción sincronizada', 'Player com transcrição sincronizada'], 'have', {
      weight: 2,
      detail: ['Click any line to jump there; the current line follows playback', 'Un clic en cualquier línea salta ahí; la línea actual sigue la reproducción', 'Um clique em qualquer linha pula para ela; a linha atual acompanha a reprodução'],
    }),
    row('speaker-timeline', 'player', ['Timeline of who spoke when', 'Línea de tiempo de quién habló cuándo', 'Linha do tempo de quem falou quando'], 'have'),
    row('in-call-search', 'player', ['Search inside a call', 'Buscar dentro de una llamada', 'Buscar dentro de uma chamada'], 'have'),
    row('call-download', 'player', ['Download the transcript', 'Descargar la transcripción', 'Baixar a transcrição'], 'have', {
      detail: ['Markdown, TXT, WebVTT or JSON', 'Markdown, TXT, WebVTT o JSON', 'Markdown, TXT, WebVTT ou JSON'],
    }),

    // Compartir y colaborar
    row('timestamp-comments', 'collab', ['Comments at a moment of the call', 'Comentarios en un momento de la llamada', 'Comentários em um momento da chamada'], 'have', {
      weight: 2,
      detail: ['The call owner gets a notification', 'Quien es dueño de la llamada recibe un aviso', 'Quem é dono da chamada recebe um aviso'],
    }),
    row('clips', 'collab', ['Clips of a call', 'Clips de una llamada', 'Clipes de uma chamada'], 'partial', {
      detail: [
        'Named ranges you can play and link to inside the workspace. Clips have no public link of their own',
        'Tramos con nombre que se reproducen y se enlazan dentro del workspace. Los clips no tienen link público propio',
        'Trechos com nome que se reproduzem e se linkam dentro do workspace. Os clipes não têm link público próprio',
      ],
    }),
    row('public-share', 'collab', ['Share a call outside the company', 'Compartir una llamada fuera de la empresa', 'Compartilhar uma chamada fora da empresa'], 'have', {
      detail: ['Read-only link with the recording, transcript, summary and next steps', 'Link de solo lectura con la grabación, la transcripción, el resumen y los próximos pasos', 'Link somente leitura com a gravação, a transcrição, o resumo e os próximos passos'],
    }),
    row('libraries', 'collab', ['Libraries and playlists of clips', 'Bibliotecas y playlists de clips', 'Bibliotecas e playlists de clipes'], 'missing'),
    row('coaching-feedback', 'collab', ['Coaching feedback and call reviews', 'Feedback de coaching y revisión de llamadas', 'Feedback de coaching e revisão de chamadas'], 'missing', { weight: 2 }),

    // IA
    row('summary', 'ai', ['Call summary and next steps', 'Resumen y próximos pasos', 'Resumo e próximos passos'], 'partial', {
      weight: 2,
      detail: [
        'Through the suite\'s AI, within the workspace quota. The pipeline runs for real; quality was tested with a simulated model',
        'Con la IA de la suite, dentro de la cuota del workspace. El circuito es real; la calidad se probó con un modelo simulado',
        'Com a IA da suíte, dentro da cota do workspace. O circuito é real; a qualidade foi testada com um modelo simulado',
      ],
    }),
    row('topics', 'ai', ['Topics and questions with timestamps', 'Temas y preguntas con su minuto', 'Temas e perguntas com o minuto'], 'partial', {
      detail: ['Topics and the questions asked, each linked to its moment. Tested with a simulated model', 'Temas y preguntas hechas, cada uno con su momento. Probado con un modelo simulado', 'Temas e perguntas feitas, cada um com seu momento. Testado com um modelo simulado'],
    }),
    row('objections', 'ai', ['Objections and how they were answered', 'Objeciones y cómo se respondieron', 'Objeções e como foram respondidas'], 'partial', {
      detail: ['Tested with a simulated model', 'Probado con un modelo simulado', 'Testado com um modelo simulado'],
    }),
    row('competitor-mentions', 'ai', ['Competitor mentions', 'Menciones de competidores', 'Menções de concorrentes'], 'partial', {
      detail: ['Your list matched word by word, plus the ones the AI finds', 'Tu lista buscada palabra por palabra, más los que encuentra la IA', 'Sua lista buscada palavra por palavra, mais os que a IA encontra'],
    }),
    row('methodology-scorecard', 'ai', ['Scorecard by sales methodology', 'Scorecard por metodología de venta', 'Scorecard por metodologia de venda'], 'partial', {
      weight: 2,
      detail: [
        'SPICED, MEDDIC, BANT or your own criteria, each with evidence and its moment in the call. Filled by the AI, tested with a simulated model',
        'SPICED, MEDDIC, BANT o criterios propios, cada uno con evidencia y su momento en la llamada. Lo completa la IA, probado con un modelo simulado',
        'SPICED, MEDDIC, BANT ou critérios próprios, cada um com evidência e seu momento na chamada. Preenchido pela IA, testado com um modelo simulado',
      ],
    }),
    row('ask-call', 'ai', ['Ask anything about a call', 'Preguntar lo que sea sobre una llamada', 'Perguntar qualquer coisa sobre uma chamada'], 'partial', {
      weight: 2,
      detail: ['Answers cite the moments [m:ss] they come from. Tested with a simulated model', 'Las respuestas citan los momentos [m:ss] de donde salen. Probado con un modelo simulado', 'As respostas citam os momentos [m:ss] de onde vêm. Testado com um modelo simulado'],
    }),
    row('ask-all-calls', 'ai', ['Ask across all calls', 'Preguntar sobre todas las llamadas', 'Perguntar sobre todas as chamadas'], 'partial', {
      detail: ['Answers say which calls they come from. Tested with a simulated model', 'Las respuestas dicen de qué llamadas salen. Probado con un modelo simulado', 'As respostas dizem de quais chamadas vêm. Testado com um modelo simulado'],
    }),
    row('followup-email', 'ai', ['Follow-up email draft', 'Borrador del email de seguimiento', 'Rascunho do email de acompanhamento'], 'missing'),

    // Métricas y coaching
    row('interaction-stats', 'metrics', ['Interaction stats per call', 'Métricas de interacción por llamada', 'Métricas de interação por chamada'], 'have', {
      weight: 2,
      detail: [
        'Talk ratio, longest monologue, longest customer story, interactivity (speaker switches per minute), patience (pause before the rep answers) and questions asked, computed from the transcript',
        'Talk ratio, monólogo más largo, historia más larga del cliente, interactividad (cambios de quien habla por minuto), paciencia (pausa antes de que responda quien vende) y preguntas hechas, calculadas desde la transcripción',
        'Talk ratio, monólogo mais longo, história mais longa do cliente, interatividade (trocas de quem fala por minuto), paciência (pausa antes de quem vende responder) e perguntas feitas, calculadas a partir da transcrição',
      ],
    }),
    row('team-trends', 'metrics', ['Team stats and trends over time', 'Métricas del equipo y tendencias en el tiempo', 'Métricas da equipe e tendências no tempo'], 'partial', {
      weight: 2,
      detail: [
        'Analytics page: calls and minutes per day against the previous period, team talk time, customer and team questions, methodology score, top topics, competitors and a table by rep. No per-rep trend lines or benchmarks yet',
        'Página de analítica: llamadas y minutos por día contra el período anterior, cuánto habla el equipo, preguntas del cliente y del equipo, puntaje de la metodología, temas, competidores y una tabla por rep. Todavía sin líneas por rep ni comparación con referencias',
        'Página de análise: chamadas e minutos por dia contra o período anterior, quanto a equipe fala, perguntas do cliente e da equipe, nota da metodologia, temas, concorrentes e uma tabela por rep. Ainda sem linhas por rep nem comparação com referências',
      ],
    }),
    row('scorecard-library', 'metrics', ['Manager scorecards and coaching programs', 'Scorecards de managers y programas de coaching', 'Scorecards de gestores e programas de coaching'], 'missing'),

    // Deals
    row('crm-linking', 'deals', ['Link calls to contacts and deals', 'Vincular llamadas a contactos y deals', 'Vincular chamadas a contatos e deals'], 'have', {
      weight: 2,
      detail: [
        'In the suite\'s CRM, by attendee email and to their most recent open deal, or picked by hand. Each call logs one meeting on the deal or contact with the summary, next steps and a link',
        'En el CRM de la suite, por el email de los invitados y a su deal abierto más reciente, o elegido a mano. Cada llamada registra una reunión en el deal o el contacto con el resumen, los próximos pasos y el link',
        'No CRM da suíte, pelo email dos convidados e ao deal aberto mais recente, ou escolhido à mão. Cada chamada registra uma reunião no deal ou no contato com o resumo, os próximos passos e o link',
      ],
    }),
    row('deal-board', 'deals', ['Deal view with risk signals', 'Vista de deals con señales de riesgo', 'Visão de deals com sinais de risco'], 'partial', {
      weight: 2,
      detail: [
        'Call activity per deal and fixed signals: no call in 14 days, no next step, competitor mentioned, unanswered objection, a single contact, close date passed. No deal boards with custom columns',
        'Actividad de llamadas por deal y señales fijas: sin llamada en 14 días, sin próximo paso, competidor mencionado, objeción sin respuesta, un solo contacto, fecha de cierre vencida. Sin tableros de deals con columnas propias',
        'Atividade de chamadas por deal e sinais fixos: sem chamada em 14 dias, sem próximo passo, concorrente mencionado, objeção sem resposta, um único contato, data de fechamento vencida. Sem quadros de deals com colunas próprias',
      ],
    }),
    row('forecast', 'deals', ['Forecast', 'Forecast', 'Forecast'], 'missing', { weight: 2 }),
    row('email-capture', 'deals', ['Emails and engagement on the deal', 'Emails y engagement en el deal', 'Emails e engajamento no deal'], 'missing'),
    row('engage', 'deals', ['Sales sequences (Engage)', 'Secuencias de venta (Engage)', 'Sequências de venda (Engage)'], 'missing'),
    row('external-crm', 'deals', ['Sync with Salesforce or HubSpot', 'Sincronizar con Salesforce o HubSpot', 'Sincronizar com Salesforce ou HubSpot'], 'missing', { weight: 2 }),

    // Integraciones y plataforma
    row('chat-summary', 'platform', ['Post the summary to a team chat', 'Mandar el resumen a un chat del equipo', 'Enviar o resumo para um chat da equipe'], 'partial', {
      detail: ['To a Talk channel in the suite. Slack is not supported', 'A un canal de Talk en la suite. Slack no está soportado', 'Para um canal do Talk na suíte. O Slack não é suportado'],
    }),
    row('webhooks', 'platform', ['Webhook when a call is ready', 'Webhook cuando una llamada está lista', 'Webhook quando uma chamada fica pronta'], 'have', {
      detail: ['The call.ready event', 'El evento call.ready', 'O evento call.ready'],
    }),
    row('api', 'platform', ['API and MCP', 'API y MCP', 'API e MCP'], 'have', {
      detail: ['The Calls API is reachable from the suite\'s MCP server, so Claude can search and read calls', 'La API de Calls se usa desde el servidor MCP de la suite, así Claude busca y lee llamadas', 'A API do Calls é usada pelo servidor MCP da suíte, assim o Claude busca e lê chamadas'],
    }),
    row('mobile-app', 'platform', ['Mobile app', 'App para el celular', 'App para o celular'], 'missing'),
    row('self-host', 'platform', ['Run it on your own server', 'Correrlo en tu servidor', 'Rodar no seu servidor'], 'better', {
      competitorHas: false,
      detail: ['The app is AGPLv3. The bot is a separate service you deploy next to it', 'La app es AGPLv3. El bot es un servicio aparte que desplegás al lado', 'O app é AGPLv3. O bot é um serviço separado que você implanta ao lado'],
    }),
  ],
};

export default parity;
