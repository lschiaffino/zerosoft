import type { Localized } from '@/content/feature-parity/types';
import type { ProductKey } from '@/lib/products';

/**
 * Directorio público de software (/software y /software/<categoría>): por
 * categoría, los productos open source, los source-available y los pagos,
 * con la app de zerosoft que cubre esa categoría.
 *
 * Solo hechos verificables:
 * - `license` de un open source es el SPDX de la licencia del repositorio
 *   (la que aplica fuera de las carpetas `ee/` o enterprise), revisada en el
 *   archivo LICENSE de `source` en la fecha de DIRECTORY_REVIEWED. Solo
 *   licencias aprobadas por la OSI cuentan como open source.
 * - Source-available: el código es público pero la licencia no es open source
 *   (BUSL, Sustainable Use License). Van aparte, con el nombre de la licencia.
 * - Pagos: productos propietarios con planes pagos. Sin precios ni puntajes:
 *   cambian seguido y no los medimos.
 *
 * Al sumar o cambiar un producto, revisá la licencia en su repositorio y
 * actualizá DIRECTORY_REVIEWED. tests/unit/software-directory.test.ts valida
 * slugs, URLs, licencias y que cada categoría tenga una app de zerosoft.
 */

/** Última revisión de licencias y enlaces (YYYY-MM-DD). */
export const DIRECTORY_REVIEWED = '2026-11-19';

export interface DirectoryProduct {
  name: string;
  /** Sitio oficial. */
  url: string;
  /** Repositorio público del código (open source y source-available). */
  source?: string;
  /** SPDX de la licencia (open source) o su nombre (source-available). */
  license?: string;
}

export interface DirectoryCategory {
  /** Segmento de /software/<slug>, en inglés y estable. */
  slug: string;
  /** Las apps de zerosoft que cubren la categoría (la primera es la principal). */
  apps: ProductKey[];
  /** Nombre corto: "CRM", "Gestión de proyectos". */
  name: Localized;
  /** Título de la página: la búsqueda tal como se hace. */
  title: Localized;
  /** Qué hace este tipo de software, en una oración. */
  summary: Localized;
  openSource: DirectoryProduct[];
  sourceAvailable?: DirectoryProduct[];
  paid: DirectoryProduct[];
}

const gh = (repo: string) => `https://github.com/${repo}`;

export const SOFTWARE_DIRECTORY: DirectoryCategory[] = [
  {
    slug: 'crm',
    apps: ['crm'],
    name: { en: 'CRM', es: 'CRM', pt: 'CRM' },
    title: { en: 'Open-source CRM software', es: 'Software de CRM open source', pt: 'Software de CRM open source' },
    summary: {
      en: 'A CRM keeps contacts, companies and deals in one place, with pipelines, tasks and the history of every conversation.',
      es: 'Un CRM guarda contactos, empresas y negocios en un lugar, con pipelines, tareas y el historial de cada conversación.',
      pt: 'Um CRM guarda contatos, empresas e negócios em um só lugar, com pipelines, tarefas e o histórico de cada conversa.',
    },
    openSource: [
      { name: 'Twenty', url: 'https://twenty.com', source: gh('twentyhq/twenty'), license: 'AGPL-3.0' },
      { name: 'SuiteCRM', url: 'https://suitecrm.com', source: gh('SuiteCRM/SuiteCRM'), license: 'AGPL-3.0' },
      { name: 'EspoCRM', url: 'https://www.espocrm.com', source: gh('espocrm/espocrm'), license: 'AGPL-3.0' },
      { name: 'Frappe CRM', url: 'https://frappe.io/crm', source: gh('frappe/crm'), license: 'AGPL-3.0' },
      { name: 'Odoo Community', url: 'https://www.odoo.com', source: gh('odoo/odoo'), license: 'LGPL-3.0' },
    ],
    paid: [
      { name: 'HubSpot', url: 'https://www.hubspot.com' },
      { name: 'Salesforce', url: 'https://www.salesforce.com' },
      { name: 'Pipedrive', url: 'https://www.pipedrive.com' },
      { name: 'Zoho CRM', url: 'https://www.zoho.com/crm/' },
    ],
  },
  {
    slug: 'project-management',
    apps: ['track'],
    name: { en: 'Project management', es: 'Gestión de proyectos', pt: 'Gestão de projetos' },
    title: {
      en: 'Open-source project management and issue tracking',
      es: 'Gestión de proyectos e issues open source',
      pt: 'Gestão de projetos e issues open source',
    },
    summary: {
      en: 'Issue trackers and project tools plan the work: tasks, sprints or cycles, boards, roadmaps and who is doing what.',
      es: 'Los gestores de issues y proyectos planifican el trabajo: tareas, sprints o ciclos, tableros, roadmaps y quién hace qué.',
      pt: 'Os gestores de issues e projetos planejam o trabalho: tarefas, sprints ou ciclos, quadros, roadmaps e quem faz o quê.',
    },
    openSource: [
      { name: 'Plane', url: 'https://plane.so', source: gh('makeplane/plane'), license: 'AGPL-3.0' },
      { name: 'OpenProject', url: 'https://www.openproject.org', source: gh('opf/openproject'), license: 'GPL-3.0' },
      { name: 'Taiga', url: 'https://taiga.io', source: gh('taigaio/taiga-back'), license: 'MPL-2.0' },
      { name: 'Redmine', url: 'https://www.redmine.org', source: gh('redmine/redmine'), license: 'GPL-2.0' },
      { name: 'Vikunja', url: 'https://vikunja.io', source: gh('go-vikunja/vikunja'), license: 'AGPL-3.0' },
      { name: 'Wekan', url: 'https://wekan.fi', source: gh('wekan/wekan'), license: 'MIT' },
    ],
    paid: [
      { name: 'Linear', url: 'https://linear.app' },
      { name: 'Jira', url: 'https://www.atlassian.com/software/jira' },
      { name: 'Asana', url: 'https://asana.com' },
      { name: 'monday.com', url: 'https://monday.com' },
    ],
  },
  {
    slug: 'team-chat',
    apps: ['talk'],
    name: { en: 'Team chat', es: 'Chat de equipo', pt: 'Chat de equipe' },
    title: { en: 'Open-source team chat software', es: 'Chat de equipo open source', pt: 'Chat de equipe open source' },
    summary: {
      en: 'Team chat replaces internal email with channels, direct messages, threads and calls.',
      es: 'El chat de equipo reemplaza el mail interno con canales, mensajes directos, hilos y llamadas.',
      pt: 'O chat de equipe substitui o email interno por canais, mensagens diretas, threads e chamadas.',
    },
    openSource: [
      { name: 'Mattermost', url: 'https://mattermost.com', source: gh('mattermost/mattermost'), license: 'AGPL-3.0' },
      { name: 'Rocket.Chat', url: 'https://www.rocket.chat', source: gh('RocketChat/Rocket.Chat'), license: 'MIT' },
      { name: 'Zulip', url: 'https://zulip.com', source: gh('zulip/zulip'), license: 'Apache-2.0' },
      { name: 'Element', url: 'https://element.io', source: gh('element-hq/element-web'), license: 'AGPL-3.0' },
    ],
    paid: [
      { name: 'Slack', url: 'https://slack.com' },
      { name: 'Microsoft Teams', url: 'https://www.microsoft.com/microsoft-teams' },
      { name: 'Google Chat', url: 'https://workspace.google.com/products/chat/' },
    ],
  },
  {
    slug: 'whatsapp-team-inbox',
    apps: ['groups', 'inbox'],
    name: { en: 'WhatsApp team inbox', es: 'WhatsApp para equipos', pt: 'WhatsApp para equipes' },
    title: {
      en: 'Open-source WhatsApp team inbox software',
      es: 'Bandeja de WhatsApp para equipos open source',
      pt: 'Caixa de WhatsApp para equipes open source',
    },
    summary: {
      en: 'A WhatsApp team inbox lets several people answer customer chats and groups from one number, with assignment and history.',
      es: 'Una bandeja de WhatsApp para equipos deja que varias personas respondan chats y grupos de clientes desde un número, con asignación e historial.',
      pt: 'Uma caixa de WhatsApp para equipes deixa várias pessoas responderem chats e grupos de clientes de um número, com atribuição e histórico.',
    },
    openSource: [{ name: 'Chatwoot', url: 'https://www.chatwoot.com', source: gh('chatwoot/chatwoot'), license: 'MIT' }],
    paid: [
      { name: 'Periskope', url: 'https://periskope.app' },
      { name: 'WATI', url: 'https://www.wati.io' },
      { name: 'respond.io', url: 'https://respond.io' },
    ],
  },
  {
    slug: 'email-client',
    apps: ['inbox'],
    name: { en: 'Email client', es: 'Cliente de email', pt: 'Cliente de email' },
    title: { en: 'Open-source email clients', es: 'Clientes de email open source', pt: 'Clientes de email open source' },
    summary: {
      en: 'An email client reads and sends mail from your accounts, with search, labels and keyboard shortcuts.',
      es: 'Un cliente de email lee y manda correo de tus cuentas, con búsqueda, etiquetas y atajos de teclado.',
      pt: 'Um cliente de email lê e envia emails das suas contas, com busca, marcadores e atalhos de teclado.',
    },
    openSource: [
      { name: 'Thunderbird', url: 'https://www.thunderbird.net', license: 'MPL-2.0' },
      { name: 'Mailspring', url: 'https://getmailspring.com', source: gh('Foundry376/Mailspring'), license: 'GPL-3.0' },
    ],
    paid: [
      { name: 'Superhuman', url: 'https://superhuman.com' },
      { name: 'Shortwave', url: 'https://www.shortwave.com' },
      { name: 'HEY', url: 'https://www.hey.com' },
    ],
  },
  {
    slug: 'docs-and-wiki',
    apps: ['docs'],
    name: { en: 'Docs and wiki', es: 'Documentos y wiki', pt: 'Documentos e wiki' },
    title: { en: 'Open-source docs and wiki software', es: 'Documentos y wiki open source', pt: 'Documentos e wiki open source' },
    summary: {
      en: 'Docs and wiki tools hold a team’s pages, specs and knowledge base, with a block editor and databases.',
      es: 'Las herramientas de documentos y wiki guardan las páginas, specs y base de conocimiento de un equipo, con editor de bloques y bases de datos.',
      pt: 'As ferramentas de documentos e wiki guardam as páginas, specs e base de conhecimento de uma equipe, com editor de blocos e bancos de dados.',
    },
    openSource: [
      { name: 'AppFlowy', url: 'https://appflowy.com', source: gh('AppFlowy-IO/AppFlowy'), license: 'AGPL-3.0' },
      { name: 'Docmost', url: 'https://docmost.com', source: gh('docmost/docmost'), license: 'AGPL-3.0' },
      { name: 'BookStack', url: 'https://www.bookstackapp.com', source: gh('BookStackApp/BookStack'), license: 'MIT' },
    ],
    sourceAvailable: [{ name: 'Outline', url: 'https://www.getoutline.com', source: gh('outline/outline'), license: 'Business Source License 1.1' }],
    paid: [
      { name: 'Notion', url: 'https://www.notion.com' },
      { name: 'Confluence', url: 'https://www.atlassian.com/software/confluence' },
      { name: 'Coda', url: 'https://coda.io' },
    ],
  },
  {
    slug: 'notes',
    apps: ['notes'],
    name: { en: 'Note-taking', es: 'Notas', pt: 'Notas' },
    title: { en: 'Open-source note-taking apps', es: 'Apps de notas open source', pt: 'Apps de notas open source' },
    summary: {
      en: 'Note-taking apps keep personal notes in notebooks, with tags, search and sync across devices.',
      es: 'Las apps de notas guardan notas personales en libretas, con etiquetas, búsqueda y sincronización entre dispositivos.',
      pt: 'Os apps de notas guardam notas pessoais em cadernos, com tags, busca e sincronização entre dispositivos.',
    },
    openSource: [
      { name: 'Joplin', url: 'https://joplinapp.org', source: gh('laurent22/joplin'), license: 'AGPL-3.0' },
      { name: 'Standard Notes', url: 'https://standardnotes.com', source: gh('standardnotes/app'), license: 'AGPL-3.0' },
      { name: 'Trilium Notes', url: 'https://triliumnotes.org', source: gh('TriliumNext/Trilium'), license: 'AGPL-3.0' },
      { name: 'Logseq', url: 'https://logseq.com', source: gh('logseq/logseq'), license: 'AGPL-3.0' },
    ],
    paid: [
      { name: 'Evernote', url: 'https://evernote.com' },
      { name: 'Bear', url: 'https://bear.app' },
      { name: 'Craft', url: 'https://www.craft.do' },
    ],
  },
  {
    slug: 'scheduling',
    apps: ['cal'],
    name: { en: 'Scheduling', es: 'Agendas y reservas', pt: 'Agendamento' },
    title: { en: 'Open-source scheduling software', es: 'Agendas y reservas open source', pt: 'Agendamento open source' },
    summary: {
      en: 'Scheduling tools publish booking pages that read your calendar, so people pick a free slot without back and forth.',
      es: 'Las herramientas de agenda publican páginas de reserva que leen tu calendario, así la gente elige un horario libre sin ida y vuelta.',
      pt: 'As ferramentas de agendamento publicam páginas de reserva que leem sua agenda, assim as pessoas escolhem um horário livre sem idas e vindas.',
    },
    openSource: [
      { name: 'Cal.diy', url: 'https://cal.diy', source: gh('calcom/cal.diy'), license: 'MIT' },
      { name: 'Easy!Appointments', url: 'https://easyappointments.org', source: gh('alextselegidis/easyappointments'), license: 'GPL-3.0' },
    ],
    paid: [
      { name: 'Calendly', url: 'https://calendly.com' },
      { name: 'Cal.com', url: 'https://cal.com' },
      { name: 'Acuity Scheduling', url: 'https://acuityscheduling.com' },
      { name: 'SavvyCal', url: 'https://savvycal.com' },
      { name: 'Chili Piper', url: 'https://www.chilipiper.com' },
    ],
  },
  {
    slug: 'forms-and-surveys',
    apps: ['forms'],
    name: { en: 'Forms and surveys', es: 'Formularios y encuestas', pt: 'Formulários e pesquisas' },
    title: { en: 'Open-source form and survey builders', es: 'Formularios y encuestas open source', pt: 'Formulários e pesquisas open source' },
    summary: {
      en: 'Form builders collect answers with a shareable link or an embed: lead forms, surveys, quizzes and applications.',
      es: 'Los creadores de formularios juntan respuestas con un link o un embed: formularios de leads, encuestas, quizzes y postulaciones.',
      pt: 'Os criadores de formulários coletam respostas com um link ou um embed: formulários de leads, pesquisas, quizzes e inscrições.',
    },
    openSource: [
      { name: 'Formbricks', url: 'https://formbricks.com', source: gh('formbricks/formbricks'), license: 'AGPL-3.0' },
      { name: 'LimeSurvey', url: 'https://www.limesurvey.org', source: gh('LimeSurvey/LimeSurvey'), license: 'GPL-2.0-or-later' },
      { name: 'HeyForm', url: 'https://heyform.net', source: gh('heyform/heyform'), license: 'AGPL-3.0' },
      { name: 'OpnForm', url: 'https://opnform.com', source: gh('OpnForm/OpnForm'), license: 'AGPL-3.0' },
    ],
    paid: [
      { name: 'Typeform', url: 'https://www.typeform.com' },
      { name: 'Jotform', url: 'https://www.jotform.com' },
      { name: 'SurveyMonkey', url: 'https://www.surveymonkey.com' },
      { name: 'Tally', url: 'https://tally.so' },
    ],
  },
  {
    slug: 'e-signature',
    apps: ['sign'],
    name: { en: 'Electronic signature', es: 'Firma electrónica', pt: 'Assinatura eletrônica' },
    title: { en: 'Open-source e-signature software', es: 'Firma electrónica open source', pt: 'Assinatura eletrônica open source' },
    summary: {
      en: 'E-signature tools send a document to be signed online and keep an audit trail of who signed, when and from where.',
      es: 'Las herramientas de firma electrónica mandan un documento a firmar online y guardan un registro de quién firmó, cuándo y desde dónde.',
      pt: 'As ferramentas de assinatura eletrônica enviam um documento para assinar online e guardam um registro de quem assinou, quando e de onde.',
    },
    openSource: [
      { name: 'Documenso', url: 'https://documenso.com', source: gh('documenso/documenso'), license: 'AGPL-3.0' },
      { name: 'DocuSeal', url: 'https://www.docuseal.com', source: gh('docusealco/docuseal'), license: 'AGPL-3.0' },
      { name: 'OpenSign', url: 'https://www.opensignlabs.com', source: gh('OpenSignLabs/OpenSign'), license: 'AGPL-3.0' },
    ],
    paid: [
      { name: 'DocuSign', url: 'https://www.docusign.com' },
      { name: 'Dropbox Sign', url: 'https://sign.dropbox.com' },
      { name: 'PandaDoc', url: 'https://www.pandadoc.com' },
      { name: 'Adobe Acrobat Sign', url: 'https://www.adobe.com/sign.html' },
    ],
  },
  {
    slug: 'document-sharing',
    apps: ['send'],
    name: { en: 'Document sharing', es: 'Envío de documentos', pt: 'Envio de documentos' },
    title: {
      en: 'Open-source document sharing with analytics',
      es: 'Envío de documentos con analítica, open source',
      pt: 'Envio de documentos com analytics, open source',
    },
    summary: {
      en: 'Document sharing tools send a deck or PDF as a link and show who opened it and how long they spent on each page.',
      es: 'Las herramientas de envío de documentos mandan un deck o PDF como link y muestran quién lo abrió y cuánto tiempo pasó en cada página.',
      pt: 'As ferramentas de envio de documentos mandam um deck ou PDF como link e mostram quem abriu e quanto tempo passou em cada página.',
    },
    openSource: [{ name: 'Papermark', url: 'https://www.papermark.com', source: gh('papermark/papermark'), license: 'AGPL-3.0' }],
    paid: [
      { name: 'DocSend', url: 'https://www.docsend.com' },
      { name: 'Digify', url: 'https://digify.com' },
    ],
  },
  {
    slug: 'screen-recording',
    apps: ['rec'],
    name: { en: 'Screen recording', es: 'Grabación de pantalla', pt: 'Gravação de tela' },
    title: { en: 'Open-source screen recording software', es: 'Grabación de pantalla open source', pt: 'Gravação de tela open source' },
    summary: {
      en: 'Screen recorders capture your screen and camera and share the video as a link, with comments and view counts.',
      es: 'Los grabadores de pantalla capturan tu pantalla y cámara y comparten el video como link, con comentarios y vistas.',
      pt: 'Os gravadores de tela capturam sua tela e câmera e compartilham o vídeo como link, com comentários e visualizações.',
    },
    openSource: [
      { name: 'Cap', url: 'https://cap.so', source: gh('CapSoftware/Cap'), license: 'AGPL-3.0' },
      { name: 'OBS Studio', url: 'https://obsproject.com', source: gh('obsproject/obs-studio'), license: 'GPL-2.0' },
    ],
    paid: [
      { name: 'Loom', url: 'https://www.loom.com' },
      { name: 'Vidyard', url: 'https://www.vidyard.com' },
      { name: 'Tella', url: 'https://www.tella.tv' },
    ],
  },
  {
    slug: 'meeting-notes',
    apps: ['calls', 'voice'],
    name: { en: 'Meeting recording and notes', es: 'Grabación y notas de reuniones', pt: 'Gravação e notas de reuniões' },
    title: {
      en: 'Open-source meeting recording and notes',
      es: 'Grabación y notas de reuniones open source',
      pt: 'Gravação e notas de reuniões open source',
    },
    summary: {
      en: 'Meeting tools record calls, transcribe them and write the summary, so the team can search what was said.',
      es: 'Las herramientas de reuniones graban las llamadas, las transcriben y escriben el resumen, así el equipo puede buscar lo que se dijo.',
      pt: 'As ferramentas de reuniões gravam as chamadas, transcrevem e escrevem o resumo, assim a equipe pode buscar o que foi dito.',
    },
    openSource: [{ name: 'Meetily', url: 'https://meetily.ai', source: gh('Zackriya-Solutions/meetily'), license: 'MIT' }],
    paid: [
      { name: 'Gong', url: 'https://www.gong.io' },
      { name: 'Granola', url: 'https://www.granola.ai' },
      { name: 'Otter.ai', url: 'https://otter.ai' },
      { name: 'Fireflies.ai', url: 'https://fireflies.ai' },
      { name: 'Avoma', url: 'https://www.avoma.com' },
    ],
  },
  {
    slug: 'transcription',
    apps: ['voice'],
    name: { en: 'Dictation and transcription', es: 'Dictado y transcripción', pt: 'Ditado e transcrição' },
    title: {
      en: 'Open-source dictation and transcription',
      es: 'Dictado y transcripción open source',
      pt: 'Ditado e transcrição open source',
    },
    summary: {
      en: 'Dictation and transcription tools turn speech into text: typing by voice in any app, or transcribing audio files.',
      es: 'Las herramientas de dictado y transcripción pasan la voz a texto: escribir hablando en cualquier app o transcribir archivos de audio.',
      pt: 'As ferramentas de ditado e transcrição transformam voz em texto: escrever falando em qualquer app ou transcrever arquivos de áudio.',
    },
    openSource: [
      { name: 'Whisper', url: gh('openai/whisper'), source: gh('openai/whisper'), license: 'MIT' },
      { name: 'Buzz', url: 'https://chidiwilliams.github.io/buzz', source: gh('chidiwilliams/buzz'), license: 'MIT' },
    ],
    paid: [
      { name: 'Wispr Flow', url: 'https://wisprflow.ai' },
      { name: 'Otter.ai', url: 'https://otter.ai' },
      { name: 'Rev', url: 'https://www.rev.com' },
      { name: 'Descript', url: 'https://www.descript.com' },
    ],
  },
  {
    slug: 'link-management',
    apps: ['link'],
    name: { en: 'Link shortener', es: 'Acortador de links', pt: 'Encurtador de links' },
    title: { en: 'Open-source URL shorteners', es: 'Acortadores de links open source', pt: 'Encurtadores de links open source' },
    summary: {
      en: 'Link shorteners turn long URLs into short links on your own domain, with click analytics and QR codes.',
      es: 'Los acortadores convierten URLs largas en links cortos en tu propio dominio, con analítica de clics y códigos QR.',
      pt: 'Os encurtadores transformam URLs longas em links curtos no seu próprio domínio, com analytics de cliques e QR codes.',
    },
    openSource: [
      { name: 'Dub', url: 'https://dub.co', source: gh('dubinc/dub.link'), license: 'AGPL-3.0' },
      { name: 'YOURLS', url: 'https://yourls.org', source: gh('YOURLS/YOURLS'), license: 'MIT' },
      { name: 'Shlink', url: 'https://shlink.io', source: gh('shlinkio/shlink'), license: 'MIT' },
      { name: 'Kutt', url: 'https://kutt.it', source: gh('thedevs-network/kutt'), license: 'MIT' },
    ],
    paid: [
      { name: 'Bitly', url: 'https://bitly.com' },
      { name: 'Rebrandly', url: 'https://www.rebrandly.com' },
      { name: 'Short.io', url: 'https://short.io' },
    ],
  },
  {
    slug: 'workflow-automation',
    apps: ['flow'],
    name: { en: 'Workflow automation', es: 'Automatizaciones', pt: 'Automações' },
    title: { en: 'Open-source workflow automation', es: 'Automatizaciones open source', pt: 'Automações open source' },
    summary: {
      en: 'Automation tools connect apps with triggers and steps, so a new form answer or deal runs a workflow on its own.',
      es: 'Las herramientas de automatización conectan apps con disparadores y pasos, así una respuesta nueva o un negocio corre un flujo solo.',
      pt: 'As ferramentas de automação conectam apps com gatilhos e etapas, assim uma resposta nova ou um negócio roda um fluxo sozinho.',
    },
    openSource: [
      { name: 'Activepieces', url: 'https://www.activepieces.com', source: gh('activepieces/activepieces'), license: 'MIT' },
      { name: 'Node-RED', url: 'https://nodered.org', source: gh('node-red/node-red'), license: 'Apache-2.0' },
      { name: 'Huginn', url: gh('huginn/huginn'), source: gh('huginn/huginn'), license: 'MIT' },
    ],
    sourceAvailable: [{ name: 'n8n', url: 'https://n8n.io', source: gh('n8n-io/n8n'), license: 'Sustainable Use License' }],
    paid: [
      { name: 'Zapier', url: 'https://zapier.com' },
      { name: 'Make', url: 'https://www.make.com' },
      { name: 'Workato', url: 'https://www.workato.com' },
    ],
  },
  {
    slug: 'whiteboard',
    apps: ['board'],
    name: { en: 'Whiteboard', es: 'Pizarra', pt: 'Quadro branco' },
    title: { en: 'Open-source online whiteboards', es: 'Pizarras online open source', pt: 'Quadros brancos online open source' },
    summary: {
      en: 'Online whiteboards are an infinite canvas for sketches, diagrams and sticky notes, drawn together in real time.',
      es: 'Las pizarras online son un lienzo infinito para bocetos, diagramas y notas adhesivas, dibujado en equipo en tiempo real.',
      pt: 'Os quadros brancos online são uma tela infinita para esboços, diagramas e notas adesivas, desenhada em equipe em tempo real.',
    },
    openSource: [
      { name: 'Excalidraw', url: 'https://excalidraw.com', source: gh('excalidraw/excalidraw'), license: 'MIT' },
      { name: 'draw.io', url: 'https://www.drawio.com', source: gh('jgraph/drawio'), license: 'Apache-2.0' },
    ],
    paid: [
      { name: 'Miro', url: 'https://miro.com' },
      { name: 'Excalidraw+', url: 'https://plus.excalidraw.com' },
      { name: 'FigJam', url: 'https://www.figma.com/figjam/' },
      { name: 'Mural', url: 'https://www.mural.co' },
    ],
  },
  {
    slug: 'product-analytics',
    apps: ['pulse'],
    name: { en: 'Product analytics', es: 'Analítica de producto', pt: 'Analytics de produto' },
    title: { en: 'Open-source product analytics', es: 'Analítica de producto open source', pt: 'Analytics de produto open source' },
    summary: {
      en: 'Product analytics tracks what people do in your site or app: events, funnels, retention and session replays.',
      es: 'La analítica de producto mide qué hace la gente en tu sitio o app: eventos, embudos, retención y grabaciones de sesión.',
      pt: 'O analytics de produto mede o que as pessoas fazem no seu site ou app: eventos, funis, retenção e gravações de sessão.',
    },
    openSource: [
      { name: 'PostHog', url: 'https://posthog.com', source: gh('PostHog/posthog'), license: 'MIT' },
      { name: 'Matomo', url: 'https://matomo.org', source: gh('matomo-org/matomo'), license: 'GPL-3.0' },
      { name: 'Plausible', url: 'https://plausible.io', source: gh('plausible/analytics'), license: 'AGPL-3.0' },
      { name: 'Umami', url: 'https://umami.is', source: gh('umami-software/umami'), license: 'MIT' },
    ],
    paid: [
      { name: 'Mixpanel', url: 'https://mixpanel.com' },
      { name: 'Amplitude', url: 'https://amplitude.com' },
      { name: 'Heap', url: 'https://www.heap.io' },
      { name: 'FullStory', url: 'https://www.fullstory.com' },
    ],
  },
  {
    slug: 'business-intelligence',
    apps: ['analytics'],
    name: { en: 'Business intelligence', es: 'Business intelligence', pt: 'Business intelligence' },
    title: {
      en: 'Open-source business intelligence and dashboards',
      es: 'Business intelligence y dashboards open source',
      pt: 'Business intelligence e dashboards open source',
    },
    summary: {
      en: 'BI tools connect to your databases so the team can ask questions, build charts and share dashboards.',
      es: 'Las herramientas de BI se conectan a tus bases de datos para que el equipo haga preguntas, arme gráficos y comparta dashboards.',
      pt: 'As ferramentas de BI se conectam aos seus bancos de dados para a equipe fazer perguntas, montar gráficos e compartilhar dashboards.',
    },
    openSource: [
      { name: 'Metabase', url: 'https://www.metabase.com', source: gh('metabase/metabase'), license: 'AGPL-3.0' },
      { name: 'Apache Superset', url: 'https://superset.apache.org', source: gh('apache/superset'), license: 'Apache-2.0' },
      { name: 'Redash', url: 'https://redash.io', source: gh('getredash/redash'), license: 'BSD-2-Clause' },
      { name: 'Grafana', url: 'https://grafana.com', source: gh('grafana/grafana'), license: 'AGPL-3.0' },
    ],
    paid: [
      { name: 'Tableau', url: 'https://www.tableau.com' },
      { name: 'Power BI', url: 'https://www.microsoft.com/power-platform/products/power-bi' },
      { name: 'Looker', url: 'https://cloud.google.com/looker' },
    ],
  },
  {
    slug: 'hr',
    apps: ['people'],
    name: { en: 'HR', es: 'Recursos humanos', pt: 'Recursos humanos' },
    title: { en: 'Open-source HR software', es: 'Software de RR. HH. open source', pt: 'Software de RH open source' },
    summary: {
      en: 'HR software keeps the employee directory and runs time off, onboarding and performance reviews.',
      es: 'El software de RR. HH. lleva el directorio de empleados y maneja vacaciones, onboarding y evaluaciones de desempeño.',
      pt: 'O software de RH mantém o diretório de funcionários e cuida de férias, onboarding e avaliações de desempenho.',
    },
    openSource: [
      { name: 'OrangeHRM', url: 'https://www.orangehrm.com', source: gh('orangehrm/orangehrm'), license: 'GPL-3.0' },
      { name: 'Frappe HR', url: 'https://frappe.io/hr', source: gh('frappe/hrms'), license: 'GPL-3.0' },
    ],
    paid: [
      { name: 'BambooHR', url: 'https://www.bamboohr.com' },
      { name: 'Rippling', url: 'https://www.rippling.com' },
      { name: 'Personio', url: 'https://www.personio.com' },
      { name: 'HiBob', url: 'https://www.hibob.com' },
    ],
  },
];

export function directoryCategory(slug: string): DirectoryCategory | undefined {
  return SOFTWARE_DIRECTORY.find((c) => c.slug === slug);
}

/** Licencias que se muestran como open source (aprobadas por la OSI, en SPDX). */
export const OSI_LICENSES = [
  'AGPL-3.0',
  'GPL-3.0',
  'GPL-2.0',
  'GPL-2.0-or-later',
  'LGPL-3.0',
  'MPL-2.0',
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
] as const;

/** Página de la licencia en spdx.org (para el JSON-LD y el link de la tabla). */
export function licenseUrl(license: string): string | null {
  return (OSI_LICENSES as readonly string[]).includes(license) ? `https://spdx.org/licenses/${license}.html` : null;
}
