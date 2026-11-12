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
 * Rec contra Loom. Fuente: docs/benchmark/rec.md (2026-10-25). Primera
 * versión (tanda 4c): grabador en el navegador, subida por partes, página
 * pública, comentarios, analítica, transcripción e IA. Lo que depende de un
 * proveedor (transcripción) lo dice en `detail`. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Loom',
  lastReviewed: '2026-11-12',
  areas: [
    { id: 'capture', label: loc(['Recording', 'Grabación', 'Gravação']) },
    { id: 'recorder', label: loc(['Recording tools', 'Herramientas al grabar', 'Ferramentas de gravação']) },
    { id: 'editing', label: loc(['Editing', 'Edición', 'Edição']) },
    { id: 'sharing', label: loc(['Sharing', 'Compartir', 'Compartilhamento']) },
    { id: 'privacy', label: loc(['Privacy', 'Privacidad', 'Privacidade']) },
    { id: 'engagement', label: loc(['Comments and reactions', 'Comentarios y reacciones', 'Comentários e reações']) },
    { id: 'analytics', label: loc(['Analytics', 'Analítica', 'Análises']) },
    { id: 'ai', label: loc(['AI', 'IA', 'IA']) },
    { id: 'library', label: loc(['Library and spaces', 'Biblioteca y espacios', 'Biblioteca e espaços']) },
    { id: 'integrations', label: loc(['Integrations', 'Integraciones', 'Integrações']) },
    { id: 'admin', label: loc(['Admin and security', 'Administración y seguridad', 'Administração e segurança']) },
  ],
  rows: [
    // Grabación
    row('screen-camera-record', 'capture', ['Record screen and camera together', 'Grabar pantalla y cámara a la vez', 'Gravar tela e câmera juntas'], 'have', {
      weight: 2,
      detail: [
        'Screen and camera, screen only or camera only, from the browser. The camera bubble is drawn into the video and you drag it, resize it or move it with the keyboard',
        'Pantalla y cámara, solo pantalla o solo cámara, desde el navegador. La burbuja se dibuja en el video y se arrastra, se agranda o se mueve con el teclado',
        'Tela e câmera, só tela ou só câmera, pelo navegador. A bolha é desenhada no vídeo e se arrasta, aumenta ou move com o teclado',
      ],
    }),
    row('capture-source', 'capture', ['Pick full screen, window or tab', 'Elegir pantalla completa, ventana o pestaña', 'Escolher tela inteira, janela ou aba'], 'have', {
      weight: 2,
      detail: [
        'The browser picker: full screen, a window or a tab',
        'El selector del navegador: pantalla completa, una ventana o una pestaña',
        'O seletor do navegador: tela inteira, uma janela ou uma aba',
      ],
    }),
    row('browser-extension', 'capture', ['Chrome extension', 'Extensión de Chrome', 'Extensão do Chrome'], 'missing'),
    row('desktop-app', 'capture', ['Desktop app', 'App de escritorio', 'App desktop'], 'partial', {
      detail: [
        'Mac and Windows: the camera bubble and a control bar (timer, mic, pause, restart, discard, finish) float over any app while you record, with global shortcuts. Recording starts from the Rec page in the app',
        'Mac y Windows: la burbuja de la cámara y una barra de controles (reloj, micrófono, pausa, empezar de nuevo, descartar, terminar) flotan sobre cualquier app mientras grabás, con atajos globales. La grabación se empieza desde la página de Rec en la app',
        'Mac e Windows: a bolha da câmera e uma barra de controles (relógio, microfone, pausa, recomeçar, descartar, terminar) flutuam sobre qualquer app enquanto você grava, com atalhos globais. A gravação começa pela página do Rec no app',
      ],
    }),
    row('mobile-app', 'capture', ['Mobile app', 'App móvil', 'App mobile'], 'missing', {
      detail: [
        'iOS and Android: screen, camera or audio only',
        'iOS y Android: pantalla, cámara o solo audio',
        'iOS e Android: tela, câmera ou só áudio',
      ],
    }),
    row('audio-capture', 'capture', ['Microphone, system audio and noise suppression', 'Micrófono, audio del sistema y supresión de ruido', 'Microfone, áudio do sistema e supressão de ruído'], 'partial', {
      weight: 2,
      detail: [
        'Microphone with device picker, the browser noise suppression and a level meter. Tab audio in Chrome and system audio only where the browser shares it (Windows and ChromeOS): no Mac system audio without a desktop app',
        'Micrófono con selector, la supresión de ruido del navegador y medidor de nivel. Audio de la pestaña en Chrome y del sistema solo donde el navegador lo comparte (Windows y ChromeOS): sin app de escritorio no hay audio del sistema en Mac',
        'Microfone com seletor, a supressão de ruído do navegador e medidor de nível. Áudio da aba no Chrome e do sistema só onde o navegador compartilha (Windows e ChromeOS): sem app desktop não há áudio do sistema no Mac',
      ],
    }),
    row('pause-rewind', 'capture', ['Pause, resume and rewind while recording', 'Pausar, retomar y volver atrás mientras se graba', 'Pausar, retomar e voltar enquanto grava'], 'partial', {
      detail: [
        'Pause and resume, restart the take and mute the mic, with a 3 second countdown before starting. No Live Rewind',
        'Pausar y seguir, empezar la toma de nuevo y silenciar el micrófono, con cuenta regresiva de 3 segundos al empezar. Sin Live Rewind',
        'Pausar e continuar, recomeçar a tomada e silenciar o microfone, com contagem de 3 segundos ao começar. Sem Live Rewind',
      ],
    }),
    row('meeting-recording', 'capture', ['Record meetings', 'Grabar reuniones', 'Gravar reuniões'], 'missing'),

    // Herramientas al grabar
    row('recording-quality', 'recorder', ['Up to 4K quality', 'Calidad hasta 4K', 'Qualidade até 4K'], 'have', {
      detail: [
        '720p, 1080p or 4K, capped by the source (your screen or camera)',
        '720p, 1080p o 4K, con el tope de la fuente (tu pantalla o tu cámara)',
        '720p, 1080p ou 4K, limitado pela fonte (sua tela ou sua câmera)',
      ],
    }),
    row('camera-effects', 'recorder', ['Virtual backgrounds, camera frames and blur', 'Fondos virtuales, marcos de cámara y desenfoque', 'Fundos virtuais, molduras de câmera e desfoque'], 'missing'),
    row('drawing-tool', 'recorder', ['Draw on screen and highlight the mouse', 'Dibujar en pantalla y resaltar el mouse', 'Desenhar na tela e destacar o mouse'], 'missing'),

    // Edición
    row('trim-stitch', 'editing', ['Trim and stitch videos', 'Recortar y unir videos', 'Cortar e unir vídeos'], 'partial', {
      weight: 2,
      detail: [
        'Trim the start and the end. In WebM recordings everyone else gets a copy cut without re-encoding (from the keyframe before the start: up to about 2 s before it stay in that file, hidden by the player); thumbnail, GIF and captions are rebuilt for the trim. WebM recordings of the same size and tracks can be joined into a new video. MP4 and MOV uploads are only trimmed in the player and cannot be joined',
        'Recortar el principio y el final. En las grabaciones WebM los demás reciben una copia cortada sin recodificar (desde el keyframe anterior al inicio: hasta unos 2 s antes quedan en ese archivo, ocultos por el reproductor); miniatura, GIF y subtítulos se rearman para el recorte. Las grabaciones WebM del mismo tamaño y pistas se unen en un video nuevo. En MP4 y MOV subidos solo se recorta en el reproductor y no se pueden unir',
        'Cortar o começo e o fim. Nas gravações WebM os outros recebem uma cópia cortada sem recodificar (desde o keyframe anterior ao começo: até uns 2 s antes ficam nesse arquivo, ocultos pelo player); miniatura, GIF e legendas são refeitos para o corte. Gravações WebM do mesmo tamanho e faixas se unem num vídeo novo. Em MP4 e MOV enviados só corta no player e não dá para unir',
      ],
    }),
    row('edit-by-transcript', 'editing', ['Edit from the transcript', 'Editar desde la transcripción', 'Editar pela transcrição'], 'partial', {
      detail: [
        'Check phrases of the transcript and it creates a new video without them, re-using the transcript and without AI. By phrase, not by word; each cut ends at the next keyframe (about 2 s in recordings); WebM recordings up to 600 MB only. The original is not changed',
        'Marcás frases de la transcripción y crea un video nuevo sin ellas, con la misma transcripción y sin IA. Por frase, no por palabra; cada corte termina en el keyframe siguiente (unos 2 s en las grabaciones); solo grabaciones WebM de hasta 600 MB. El original no cambia',
        'Você marca frases da transcrição e cria um vídeo novo sem elas, com a mesma transcrição e sem IA. Por frase, não por palavra; cada corte termina no keyframe seguinte (uns 2 s nas gravações); só gravações WebM de até 600 MB. O original não muda',
      ],
    }),
    row('filler-silence-removal', 'editing', ['Remove filler words and silences with AI', 'Quitar muletillas y silencios con IA', 'Remover vícios de linguagem e silêncios com IA'], 'partial', {
      detail: [
        'From the transcript and without AI: marks silences of 2 s or more and phrases made up only of filler words, then creates a new video. It does not remove a filler word inside a sentence. Same limits as editing from the transcript',
        'Desde la transcripción y sin IA: marca silencios de 2 s o más y frases hechas solo de muletillas, y crea un video nuevo. No saca una muletilla en medio de una frase. Los mismos límites que editar desde la transcripción',
        'A partir da transcrição e sem IA: marca silêncios de 2 s ou mais e frases feitas só de vícios, e cria um vídeo novo. Não tira um vício no meio de uma frase. Os mesmos limites de editar pela transcrição',
      ],
    }),
    row('custom-thumbnail', 'editing', ['Custom and GIF thumbnails', 'Miniatura propia y GIF', 'Miniatura própria e GIF'], 'have', {
      detail: [
        'A GIF of the first seconds and a thumbnail are made while recording; any frame can be the thumbnail',
        'Un GIF de los primeros segundos y una miniatura se arman al grabar; cualquier cuadro puede ser la miniatura',
        'Um GIF dos primeiros segundos e uma miniatura são feitos ao gravar; qualquer quadro pode ser a miniatura',
      ],
    }),
    row('overlays', 'editing', ['Text, box and arrow overlays', 'Textos, cajas y flechas sobre el video', 'Textos, caixas e setas sobre o vídeo'], 'have', {
      detail: [
        'Text, boxes and arrows with a time range, position and color. The player draws them on the video page, the shared page and embeds; downloaded files do not include them',
        'Textos, cajas y flechas con rango de tiempo, posición y color. Los dibuja el reproductor en el detalle, la página compartida y al insertar; el archivo descargado no los lleva',
        'Textos, caixas e setas com intervalo de tempo, posição e cor. O player desenha no detalhe, na página compartilhada e ao incorporar; o arquivo baixado não os inclui',
      ],
    }),
    row('upload-download', 'editing', ['Upload and download videos', 'Subir y descargar videos', 'Enviar e baixar vídeos'], 'have', {
      detail: [
        'Upload a WebM, MP4 or MOV file and download the original',
        'Subir un archivo WebM, MP4 o MOV y descargar el original',
        'Enviar um arquivo WebM, MP4 ou MOV e baixar o original',
      ],
    }),

    // Compartir
    row('instant-link', 'sharing', ['Share link ready when you stop', 'Link listo al terminar de grabar', 'Link pronto ao parar a gravação'], 'have', {
      weight: 2,
      detail: [
        'It uploads in parts while you record and the link is copied when you stop. Each part is kept in the browser until the server has it: if the connection drops it keeps recording, retries by itself and the upload can be resumed or downloaded after a reload',
        'Se sube por partes mientras grabás y el link se copia al cortar. Cada parte queda en el navegador hasta que el servidor la tiene: si se corta la red sigue grabando, reintenta solo y después de recargar se puede retomar o descargar',
        'É enviado em partes enquanto você grava e o link é copiado ao parar. Cada parte fica no navegador até o servidor recebê-la: se a rede cair continua gravando, tenta de novo sozinho e depois de recarregar dá para retomar ou baixar',
      ],
    }),
    row('watch-page', 'sharing', ['Video page with player and transcript', 'Página del video con reproductor y transcripción', 'Página do vídeo com player e transcrição'], 'have', {
      weight: 2,
      detail: [
        '/v/<id>: player with speed, captions, chapters and keyboard shortcuts, summary, transcript and comments',
        '/v/<id>: reproductor con velocidad, subtítulos, capítulos y atajos de teclado, resumen, transcripción y comentarios',
        '/v/<id>: player com velocidade, legendas, capítulos e atalhos de teclado, resumo, transcrição e comentários',
      ],
    }),
    row('embed-player', 'sharing', ['Embed the player in other sites', 'Insertar el reproductor en otros sitios', 'Incorporar o player em outros sites'], 'have', {
      detail: [
        'Copy an iframe code for /v/<id>/embed; it works in any page that accepts iframes',
        'Copiás un código iframe de /v/<id>/embed; anda en cualquier página que acepte iframes',
        'Você copia um código iframe de /v/<id>/embed; funciona em qualquer página que aceite iframes',
      ],
    }),
    row('cta-button', 'sharing', ['Call to action button', 'Botón de llamada a la acción', 'Botão de chamada para ação'], 'have', {
      detail: [
        'Web links only (no email, phone or IP), during the whole video or only at the end, with click counts',
        'Solo links web (sin email, teléfono ni IP), durante todo el video o solo al final, con conteo de clics',
        'Só links web (sem email, telefone ou IP), durante o vídeo todo ou só no final, com contagem de cliques',
      ],
    }),
    row('custom-branding', 'sharing', ['Your logo and colors, no Loom branding', 'Logo y colores propios, sin la marca de Loom', 'Logo e cores próprios, sem a marca do Loom'], 'have', {
      detail: [
        'Your name, logo (PNG, JPEG or WebP up to 1 MB) and color on the shared page and embeds, only for people who can watch. These pages carry no zerosoft or Loom branding',
        'Tu nombre, logo (PNG, JPEG o WebP de hasta 1 MB) y color en la página compartida y al insertar, solo para quien puede ver el video. Esas páginas no llevan marca de zerosoft ni de Loom',
        'Seu nome, logo (PNG, JPEG ou WebP de até 1 MB) e cor na página compartilhada e ao incorporar, só para quem pode assistir. Essas páginas não têm marca da zerosoft nem do Loom',
      ],
    }),

    // Privacidad
    row('privacy-levels', 'privacy', ['General access: restricted, workspace or anyone with the link', 'Acceso general: restringido, workspace o cualquiera con el link', 'Acesso geral: restrito, workspace ou qualquer pessoa com o link'], 'partial', {
      weight: 2,
      detail: [
        'New videos start restricted (only the owner and invited people) unless the workspace picks another default. Workspace (or space) members, or anyone with the link, checked on every request: page, file, thumbnail, captions, comments, views, embed and link previews. Videos shared by link before this change keep working and show as "Anyone with the link". The link can be reset. Files in a public Blob store (the default without REC_BLOB_ACCESS=private) stay readable by anyone holding the storage URL; the app never shows that URL',
        'Lo nuevo nace restringido (solo quien grabó y las personas invitadas), salvo que el workspace elija otro default. Miembros del workspace (o del espacio), o cualquiera con el link, chequeado en cada pedido: página, archivo, miniatura, subtítulos, comentarios, vistas, inserción y vista previa del link. Los videos compartidos por link antes de este cambio siguen andando y aparecen como "Cualquiera con el link". El link se puede cambiar. Los archivos en un store público de Blob (el default sin REC_BLOB_ACCESS=private) siguen siendo leíbles por quien tenga la URL del almacenamiento; la app nunca la muestra',
        'Os novos nascem restritos (só quem gravou e as pessoas convidadas), salvo se o workspace escolher outro padrão. Membros do workspace (ou do espaço), ou qualquer pessoa com o link, verificado em cada pedido: página, arquivo, miniatura, legendas, comentários, visualizações, incorporação e prévia do link. Os vídeos compartilhados por link antes desta mudança continuam funcionando e aparecem como "Qualquer pessoa com o link". O link pode ser trocado. Os arquivos num store público do Blob (o padrão sem REC_BLOB_ACCESS=private) continuam legíveis por quem tiver a URL do armazenamento; o app nunca a mostra',
      ],
    }),
    row('invite-people', 'privacy', ['Invite people by email with a role', 'Invitar personas por email con rol', 'Convidar pessoas por email com papel'], 'partial', {
      weight: 2,
      detail: [
        'Workspace members and outside emails, as viewer or commenter, with a list of who has access, whether they watched, role change and remove (cuts access right away). Members sign in; outside people get a one-time magic link by email that keeps them in for 30 days on that browser. Invited people skip the link password and expiry. Emails go out through Resend; the tests read the captured email',
        'Miembros del workspace y emails de afuera, como lector o comentador, con la lista de quién tiene acceso, si ya lo vio, cambio de rol y quitar (corta el acceso al toque). Los miembros entran con su cuenta; la gente de afuera recibe por mail un link mágico de un solo uso que la deja adentro 30 días en ese navegador. Las personas invitadas no necesitan la contraseña del link ni las frena el vencimiento. Los mails salen por Resend; las pruebas leen el mail capturado',
        'Membros do workspace e emails de fora, como leitor ou comentador, com a lista de quem tem acesso, se já assistiu, troca de papel e remover (corta o acesso na hora). Os membros entram com a conta; as pessoas de fora recebem por email um link mágico de uso único que as mantém dentro por 30 dias naquele navegador. As pessoas convidadas não precisam da senha do link nem são barradas pela expiração. Os emails saem pelo Resend; os testes leem o email capturado',
      ],
    }),
    row('password-protect', 'privacy', ['Password-protected videos', 'Videos con contraseña', 'Vídeos com senha'], 'have', {
      detail: [
        'The video, thumbnail, GIF and captions are only served through our routes after checking the password, expiry and workspace. With REC_BLOB_ACCESS=private the Blob store is private; with a public store the file path is random and never shown',
        'El video, la miniatura, el GIF y los subtítulos solo salen por nuestras rutas después de chequear contraseña, vencimiento y workspace. Con REC_BLOB_ACCESS=private el store de Blob es privado; con uno público el path del archivo es al azar y nunca se muestra',
        'O vídeo, a miniatura, o GIF e as legendas só saem pelas nossas rotas depois de checar senha, expiração e workspace. Com REC_BLOB_ACCESS=private o store do Blob é privado; com um público o path do arquivo é aleatório e nunca aparece',
      ],
    }),
    row('request-access', 'privacy', ['Request access or ask for an email to watch', 'Pedir acceso o pedir email para ver', 'Pedir acesso ou pedir email para assistir'], 'have', {
      detail: [
        'People without access ask for it with their account or with an email; the owner gets a notice and approves or declines in Share, and an approval emails a magic link to that address. An invited person who lost the link asks for a new one the same way. "Ask for an email to watch" collects an email from people who are not signed in: it is not verified',
        'Quien no tiene acceso lo pide con su cuenta o con un email; el autor recibe un aviso y aprueba o rechaza en Compartir, y al aprobar le llega un link mágico a ese email. Una persona invitada que perdió el link pide uno nuevo igual. "Pedir email para ver" le pide un email a quien no entró con su cuenta: no se verifica',
        'Quem não tem acesso pede com a conta ou com um email; o autor recebe um aviso e aprova ou recusa em Compartilhar, e ao aprovar chega um link mágico nesse email. Uma pessoa convidada que perdeu o link pede um novo do mesmo jeito. "Pedir email para assistir" pede um email a quem não entrou com a conta: não é verificado',
      ],
    }),
    row('mp4-download', 'sharing', ['Download as MP4', 'Descargar en MP4', 'Baixar em MP4'], 'partial', {
      detail: [
        'Downloads come as H.264/AAC MP4 named after the video, of the version others see (trim applied), built once and kept. Recording stays WebM so trimming and joining work without re-encoding. With ffmpeg on the server (self-host, CI) it is tested with ffprobe; on Vercel it runs in a Vercel Sandbox microVM, not yet tried in production. Without either, the original file downloads',
        'La descarga sale en MP4 H.264/AAC con el nombre del video, de la versión que ven los demás (con el recorte aplicado), armada una vez y guardada. La grabación sigue en WebM para recortar y unir sin recodificar. Con ffmpeg en el servidor (self-host, CI) está probado con ffprobe; en Vercel corre en una microVM de Vercel Sandbox, todavía sin probar en producción. Sin ninguno, se baja el archivo original',
        'O download sai em MP4 H.264/AAC com o nome do vídeo, da versão que os outros veem (com o corte aplicado), montado uma vez e guardado. A gravação continua em WebM para cortar e juntar sem recodificar. Com ffmpeg no servidor (self-host, CI) está testado com ffprobe; na Vercel roda numa microVM do Vercel Sandbox, ainda sem testar em produção. Sem nenhum, baixa o arquivo original',
      ],
    }),
    row('download-restriction', 'privacy', ['Block downloads', 'Bloquear la descarga', 'Bloquear o download'], 'have', {
      detail: [
        'Per video and as a workspace default for new videos: the download button, the download link and the browser "save video" menu stop working. The video still streams, so it can be captured',
        'Por video y como valor por defecto del workspace para lo nuevo: el botón, el link de descarga y el "guardar video" del navegador dejan de andar. El video se sigue transmitiendo, así que se puede capturar',
        'Por vídeo e como padrão do workspace para os novos: o botão, o link de download e o "salvar vídeo" do navegador param de funcionar. O vídeo continua sendo transmitido, então dá para capturar',
      ],
    }),

    // Interacción
    row('timestamped-comments', 'engagement', ['Time-stamped comments', 'Comentarios con tiempo', 'Comentários com tempo'], 'have', {
      weight: 2,
      detail: [
        'Marked on the timeline, one click jumps to the second, with text replies (no video replies)',
        'Marcados en la línea de tiempo, un clic lleva al segundo, con respuestas de texto (sin respuestas en video)',
        'Marcados na linha do tempo, um clique leva ao segundo, com respostas de texto (sem respostas em vídeo)',
      ],
    }),
    row('emoji-reactions', 'engagement', ['Emoji reactions', 'Reacciones con emoji', 'Reações com emoji'], 'have', {
      detail: [
        'Six reactions with the second of the video, shown on the timeline',
        'Seis reacciones con el segundo del video, marcadas en la línea de tiempo',
        'Seis reações com o segundo do vídeo, marcadas na linha do tempo',
      ],
    }),
    row('transcript-captions', 'engagement', ['Transcript and captions', 'Transcripción y subtítulos', 'Transcrição e legendas'], 'have', {
      weight: 2,
      detail: [
        'With the transcription provider configured (AI Gateway by default, or OpenAI or Deepgram with REC_TRANSCRIBE_PROVIDER): clickable transcript and captions in the language spoken',
        'Con el proveedor de transcripción configurado (AI Gateway por defecto, u OpenAI o Deepgram con REC_TRANSCRIBE_PROVIDER): transcripción clicable y subtítulos en el idioma hablado',
        'Com o provedor de transcrição configurado (AI Gateway por padrão, ou OpenAI ou Deepgram com REC_TRANSCRIBE_PROVIDER): transcrição clicável e legendas no idioma falado',
      ],
    }),
    row('notifications', 'engagement', ['Notifications for views, comments and reactions', 'Avisos de vistas, comentarios y reacciones', 'Avisos de visualizações, comentários e reações'], 'have', {
      detail: [
        'The first view of each viewer, and comments and reactions grouped in one notice ("3 new comments") until you read it; can be turned off per video',
        'La primera vista de cada espectador, y los comentarios y reacciones agrupados en un aviso ("3 comentarios nuevos") hasta que lo leés; se apaga por video',
        'A primeira visualização de cada espectador, e os comentários e reações agrupados num aviso ("3 comentários novos") até você ler; dá para desligar por vídeo',
      ],
    }),

    // Analítica
    row('viewer-insights', 'analytics', ['Who watched', 'Quién vio el video', 'Quem assistiu'], 'have', {
      weight: 2,
      detail: [
        'Views, unique viewers and the names of signed-in viewers (the rest numbered as Viewer 1, 2, 3), with approximate city and country, device and the site they came from; your own views do not count',
        'Vistas, espectadores únicos y el nombre de quien entró con sesión (el resto numerado como Espectador 1, 2, 3), con ciudad y país aproximados, dispositivo y el sitio de donde vino; tus propias vistas no cuentan',
        'Visualizações, espectadores únicos e o nome de quem entrou com sessão (o resto numerado como Espectador 1, 2, 3), com cidade e país aproximados, dispositivo e o site de onde veio; suas próprias visualizações não contam',
      ],
    }),
    row('engagement-insights', 'analytics', ['Watch time, CTA clicks and export', 'Cuánto vio cada uno, clics y export', 'Quanto cada um assistiu, cliques e exportação'], 'have', {
      detail: [
        'Time really watched per viewer (the union of the parts played: skipping ahead does not count), average, watched to the end, a retention curve with rewatched parts, views per day, breakdowns by country, city, device and source, and CTA clicks, with CSV export. Only whoever manages the video sees it',
        'Tiempo realmente visto por espectador (la unión de lo reproducido: adelantar no cuenta), promedio, quienes lo vieron hasta el final, curva de retención con las partes re-vistas, vistas por día, desgloses por país, ciudad, dispositivo y origen, y clics en la CTA, con export a CSV. Solo la ve quien administra el video',
        'Tempo realmente assistido por espectador (a união do que foi reproduzido: avançar não conta), média, quem assistiu até o fim, curva de retenção com as partes revistas, visualizações por dia, detalhamento por país, cidade, dispositivo e origem, e cliques na CTA, com exportação CSV. Só quem administra o vídeo vê',
      ],
    }),

    // IA
    row('ai-title-summary', 'ai', ['AI title and summary', 'Título y resumen con IA', 'Título e resumo com IA'], 'have', {
      weight: 2,
      detail: [
        'From the transcript, through the workspace AI quota; the title is kept if you changed it',
        'Desde la transcripción, con la cuota de IA del workspace; si cambiaste el título, se respeta',
        'A partir da transcrição, com a cota de IA do workspace; se você mudou o título, ele é mantido',
      ],
    }),
    row('ai-chapters', 'ai', ['AI chapters', 'Capítulos con IA', 'Capítulos com IA'], 'have', {
      detail: [
        'For videos of 60 seconds or more, editable as "0:00 Intro" lines',
        'En videos de 60 segundos o más, editables como líneas "0:00 Intro"',
        'Em vídeos de 60 segundos ou mais, editáveis como linhas "0:00 Intro"',
      ],
    }),
    row('ai-workflows', 'ai', ['Turn a video into a doc or a task', 'Del video a un documento o una tarea', 'Do vídeo para um documento ou uma tarefa'], 'partial', {
      detail: [
        'One click creates a Docs page or a Track issue with the link, the AI summary, chapters and transcript that you can see. The text is copied as it is, not rewritten by AI. No Jira',
        'Con un clic crea una página de Docs o un issue de Track con el link, el resumen de IA, los capítulos y la transcripción que podés ver. El texto se copia tal cual, sin reescribirlo con IA. Sin Jira',
        'Com um clique cria uma página do Docs ou um issue do Track com o link, o resumo de IA, os capítulos e a transcrição que você pode ver. O texto é copiado como está, sem reescrever com IA. Sem Jira',
      ],
    }),
    row('ai-meeting-notes', 'ai', ['Meeting notes and recap emails', 'Notas y mail de resumen de reuniones', 'Notas e email de resumo de reuniões'], 'partial', {
      detail: [
        'Emails a recap of any video (title, summary, chapters and link), to workspace members and people allowed on the video, up to 20 addresses per send and 50 per day, without repeating a send. Tested with the email capture of the tests, not against Resend in production. No meeting capture and no notes written for meetings',
        'Manda por mail un resumen de cualquier video (título, resumen, capítulos y link), a miembros del workspace y a quienes tienen permiso en el video, hasta 20 direcciones por envío y 50 por día, sin repetir un envío. Probado con la captura de mails de los tests, no contra Resend en producción. No graba reuniones ni escribe notas para ellas',
        'Envia por email um resumo de qualquer vídeo (título, resumo, capítulos e link), para membros do workspace e quem tem permissão no vídeo, até 20 endereços por envio e 50 por dia, sem repetir um envio. Testado com a captura de emails dos testes, não contra o Resend em produção. Não grava reuniões nem escreve notas para elas',
      ],
    }),

    // Biblioteca
    row('library-folders', 'library', ['Personal library with folders and archive', 'Biblioteca personal con carpetas y archivo', 'Biblioteca pessoal com pastas e arquivo'], 'have', {
      weight: 2,
      detail: [
        'My videos with folders, search, rename, move and delete, an archive that keeps the links working, and a personal watch later list',
        'Mis videos con carpetas, búsqueda, renombrar, mover y borrar, un archivo que deja andando los links y una lista personal de "ver más tarde"',
        'Meus vídeos com pastas, busca, renomear, mover e apagar, um arquivo que mantém os links funcionando e uma lista pessoal de "assistir depois"',
      ],
    }),
    row('shared-spaces', 'library', ['Shared team spaces', 'Espacios compartidos del equipo', 'Espaços compartilhados da equipe'], 'have', {
      detail: [
        'One space shared with the whole workspace, plus any number of spaces with their own members and folders. Only members and workspace admins see a space and its videos in the library and in Cmd+K; a video open to anyone with the link stays open',
        'Un espacio compartido con todo el workspace y todos los espacios que quieras con sus miembros y carpetas. Solo los miembros y los admins del workspace ven un espacio y sus videos en la biblioteca y en Cmd+K; un video abierto a cualquiera con el link sigue abierto',
        'Um espaço compartilhado com todo o workspace e quantos espaços quiser com membros e pastas próprios. Só os membros e os admins do workspace veem um espaço e seus vídeos na biblioteca e no Cmd+K; um vídeo aberto a qualquer pessoa com o link continua aberto',
      ],
    }),
    row('video-search', 'library', ['Search videos', 'Buscar videos', 'Buscar vídeos'], 'have', {
      detail: [
        'By title, description and transcript, with matching folders, in the library and in Cmd+K. People who do not manage a video only find text inside its trim',
        'Por título, descripción y transcripción, con las carpetas que coinciden, en la biblioteca y en Cmd+K. Quien no administra un video solo encuentra texto dentro de su recorte',
        'Por título, descrição e transcrição, com as pastas que coincidem, na biblioteca e no Cmd+K. Quem não administra um vídeo só encontra texto dentro do corte',
      ],
    }),

    // Integraciones
    row('slack', 'integrations', ['Slack previews', 'Vista previa en Slack', 'Prévia no Slack'], 'partial', {
      detail: [
        'Open videos publish Open Graph tags and oEmbed, which Slack reads to build the preview. Checked by reading those responses: never tried in a real Slack workspace. No Slack app',
        'Los videos abiertos publican etiquetas Open Graph y oEmbed, que Slack lee para armar la vista previa. Comprobado leyendo esas respuestas: nunca se probó en un Slack real. Sin app de Slack',
        'Os vídeos abertos publicam tags Open Graph e oEmbed, que o Slack lê para montar a prévia. Verificado lendo essas respostas: nunca testado num Slack real. Sem app do Slack',
      ],
    }),
    row('jira-confluence-github', 'integrations', ['Jira, Confluence and GitHub', 'Jira, Confluence y GitHub', 'Jira, Confluence e GitHub'], 'missing'),
    row('gmail', 'integrations', ['Record and insert from Gmail', 'Grabar e insertar desde Gmail', 'Gravar e inserir pelo Gmail'], 'missing'),

    // Administración
    row('members-roles', 'admin', ['Members and roles', 'Miembros y roles', 'Membros e funções'], 'have', {
      detail: [
        'Workspace members and roles: My videos are only for whoever recorded them (admins included, as in Loom); in the workspace space the author or an admin edits',
        'Miembros y roles del workspace: Mis videos son solo de quien los grabó (los admins tampoco los ven, como en Loom); en el espacio del workspace edita el autor o un admin',
        'Membros e funções do workspace: Meus vídeos são só de quem gravou (os admins também não veem, como no Loom); no espaço do workspace edita o autor ou um admin',
      ],
    }),
    row('sso-scim', 'admin', ['SSO and SCIM', 'SSO y SCIM', 'SSO e SCIM'], 'missing'),
    row('data-retention', 'admin', ['Data retention and content transfer', 'Retención de datos y traspaso de contenido', 'Retenção de dados e transferência de conteúdo'], 'have', {
      detail: [
        'Per workspace and off by default: deletes videos older than 30 to 730 days, after a confirmation with the count and 7 days of notice. Authors get an in-app notice (a video that ages in later, only when deleted) when those days start and when videos are deleted. Admins can transfer the videos and folders of someone who left to another person',
        'Por workspace y apagada por defecto: borra videos de más de 30 a 730 días, con confirmación que dice cuántos y 7 días de aviso. Quienes los grabaron reciben un aviso en la app (un video que cumple la edad después, solo al borrarse) al empezar esos días y al borrarse. Los admins pueden pasar los videos y carpetas de alguien que se fue a otra persona',
        'Por workspace e desligada por padrão: apaga vídeos com mais de 30 a 730 dias, com confirmação que diz quantos e 7 dias de aviso. Quem gravou recebe um aviso no app (um vídeo que atinge a idade depois, só ao ser apagado) no começo desses dias e ao apagar. Os admins podem passar os vídeos e pastas de alguém que saiu para outra pessoa',
      ],
    }),
  ],
};

export default parity;
