/** Textos de /docs/mcp en los tres idiomas. Los comandos y URLs van aparte, sin traducir. */
export interface McpDocsCopy {
  metaTitle: string;
  metaDescription: string;
  title: string;
  titleDim: string;
  intro: string;
  claudeCodeTitle: string;
  claudeCodeSteps: string[];
  claudeAiTitle: string;
  claudeAiSteps: string[];
  cursorTitle: string;
  cursorBody: string;
  harnessTitle: string;
  harnessBody: string[];
  harnessToolsLabel: string;
  cliTitle: string;
  cliIntro: string;
  cliRunNote: string;
  cliExamplesLabel: string;
  cliHeadless: string;
  howTitle: string;
  howBody: string[];
  accessTitle: string;
  accessBody: string[];
  outTitle: string;
  outBody: string[];
  webOnlyTitle: string;
  webOnlyIntro: string;
  webOnly: string[];
  keysTitle: string;
  keysBody: string;
  apiLink: string;
}

export const MCP_DOCS: Record<'en' | 'es' | 'pt', McpDocsCopy> = {
  en: {
    metaTitle: 'Connect Claude and the CLI',
    metaDescription: 'Connect Claude Code or the zerosoft CLI to your account with your normal login, and work in all 24 apps as yourself.',
    title: 'Connect Claude to zerosoft.',
    titleDim: 'And use it from your terminal.',
    intro: 'One connector reaches all 24 apps. You sign in through the browser with your normal login, with no keys to paste, and Claude acts as you, with your role and permissions.',
    claudeCodeTitle: 'Claude Code',
    claudeCodeSteps: ['Add the server:', 'Run /mcp inside Claude Code, pick zerosoft and sign in. Your browser opens the permissions screen.'],
    claudeAiTitle: 'claude.ai',
    claudeAiSteps: ['Open Settings, then Connectors, and choose Add custom connector.', 'Paste this URL:', 'Connect and approve in the permissions screen.'],
    cursorTitle: 'Cursor and other editors',
    cursorBody: 'Add zerosoft to .cursor/mcp.json (or the MCP settings of your editor) with the URL below. Cursor opens the browser to sign in the first time. If your editor does not support OAuth for remote servers, use the API key version.',
    harnessTitle: 'Any MCP client or agent harness',
    harnessBody: [
      'The server speaks Streamable HTTP (MCP 2025-11-25, also 2025-06-18 and 2025-03-26) at a single URL, answers in JSON and keeps no session. Clients that do OAuth find everything from the 401: the WWW-Authenticate header points to the protected resource metadata, which points to the authorization server with dynamic client registration and PKCE.',
      'Harnesses that cannot open a browser use an API key as a Bearer token. Create it in Settings, API and webhooks, turn on MCP access and pick its scopes: the key acts as you, limited by those scopes. Each key allows 300 reads and 60 writes per minute.',
      'Most used tools have their own name, so a model does not need to search for them. Everything else is reached with search_operations, get_operation_schema and invoke_operation.',
    ],
    harnessToolsLabel: 'Tools with their own name',
    cliTitle: 'The zerosoft CLI',
    cliIntro: 'Same reach, for the terminal and for scripts. It prints tables in a terminal and JSON when piped or with --json.',
    cliRunNote: 'The CLI is not on npm yet. From a copy of the repository, run it with:',
    cliExamplesLabel: 'Examples',
    cliHeadless: 'On a machine with no browser, zerosoft login --device shows a code that you approve from any other device. The token goes to the OS keychain when there is one, and otherwise to a file only you can read. For CI, set ZEROSOFT_API_KEY.',
    howTitle: 'How Claude finds things',
    howBody: [
      'There are about 1,800 operations, so they are not listed one by one. Claude uses a few tools: list_apps, search_operations, get_operation_schema and invoke_operation, plus whoami and shortcuts for common actions.',
      'Each operation runs the same code as the app. Most have an exact input schema derived from the code; some are marked partial or loose, and then Claude learns from the error message.',
    ],
    accessTitle: 'What it can do',
    accessBody: [
      "Disconnecting stops the connection. What it created stays, and flows, CRM workflows and robots it turned on keep running until you turn them off. Turning one on asks for an explicit confirmation.",
      'It can do what you can do, nothing more. If your role, your app access or a private channel stops you in the app, it stops Claude too.',
      'In the permissions screen you choose read and write, or read only, and the workspace. Destructive operations ask for an explicit confirmation from the client.',
      'See and disconnect your connected apps in Settings, API and webhooks. Changes made through a connection are recorded with the person, the app and the operation.',
      'What comes back from zerosoft may include text written by other people, such as customer messages or emails. It reaches Claude marked as data, not as instructions. Still, review what Claude proposes before it sends or deletes something.',
      'Passing to another workspace takes reconnecting: a connection stays in the workspace you chose when you approved it.',
      'Clients must use an https or local redirect address. Custom URL schemes are not supported.',
    ],
    outTitle: 'What stays out',
    outBody: [
      'Signing in, API keys and OAuth clients. Workspace ownership, account deletion and billing. Those stay in Settings.',
      'Public visitor pages, inbound webhooks, cron jobs and Pulse ingest. No person is behind them.',
      'Flows that need your browser, such as connecting Gmail or a social network, and realtime streams.',
    ],
    webOnlyTitle: 'Done in the web app',
    webOnlyIntro: 'These create something that keeps working after you disconnect, or store the keys of another service. Claude and the CLI tell you where to do them.',
    webOnly: [
      'Webhooks, incoming hooks and slash commands; Track agent apps and the GitHub connection.',
      'Payment keys and integration keys: Shop, Cal, Books, CRM apps, Flow credentials and agent secrets.',
      'Shareable links for docs, notes, boards, designs and recordings.',
      "Inviting people to the workspace; Groups numbers and their provider keys; imports that hold another service's token.",
      "Webhook addresses on forms and webhook steps in Cal.",
      "Giving someone the admin or owner role.",
    ],
    keysTitle: 'With an API key',
    keysBody: 'The endpoint also accepts a personal API key as a Bearer token, for clients without OAuth. Create the key with MCP access in Settings, API and webhooks: other keys keep working with the REST API only. It is limited by the scopes of the key.',
    apiLink: 'REST API reference',
  },
  es: {
    metaTitle: 'Conectar Claude y la CLI',
    metaDescription: 'Conectá Claude Code o la CLI de zerosoft a tu cuenta con tu login de siempre, y trabajá en las 24 apps como vos.',
    title: 'Conectá Claude a zerosoft.',
    titleDim: 'Y usalo desde tu terminal.',
    intro: 'Un solo conector llega a las 24 apps. Entrás por el navegador con tu login de siempre, sin pegar keys, y Claude actúa como vos, con tu rol y tus permisos.',
    claudeCodeTitle: 'Claude Code',
    claudeCodeSteps: ['Agregá el servidor:', 'Corré /mcp dentro de Claude Code, elegí zerosoft e iniciá sesión. El navegador abre la pantalla de permisos.'],
    claudeAiTitle: 'claude.ai',
    claudeAiSteps: ['Abrí Settings, después Connectors, y elegí Add custom connector.', 'Pegá esta URL:', 'Conectá y aprobá en la pantalla de permisos.'],
    cursorTitle: 'Cursor y otros editores',
    cursorBody: 'Agregá zerosoft a .cursor/mcp.json (o a los ajustes de MCP de tu editor) con la URL de abajo. Cursor abre el navegador para iniciar sesión la primera vez. Si tu editor no hace OAuth con servidores remotos, usá la versión con API key.',
    harnessTitle: 'Cualquier cliente MCP o harness de agentes',
    harnessBody: [
      'El servidor habla Streamable HTTP (MCP 2025-11-25, también 2025-06-18 y 2025-03-26) en una sola URL, responde en JSON y no guarda sesión. Los clientes con OAuth encuentran todo desde el 401: el header WWW-Authenticate apunta a los metadatos del recurso protegido, y esos al servidor de autorización, con registro dinámico de clientes y PKCE.',
      'Los harnesses que no pueden abrir un navegador usan una API key como Bearer. Creala en Ajustes, API y webhooks, prendé el acceso al MCP y elegí sus scopes: la key actúa como vos, con el tope de esos scopes. Cada key tiene 300 lecturas y 60 escrituras por minuto.',
      'Las herramientas más usadas tienen nombre propio, así un modelo no las tiene que buscar. Al resto se llega con search_operations, get_operation_schema e invoke_operation.',
    ],
    harnessToolsLabel: 'Herramientas con nombre propio',
    cliTitle: 'La CLI de zerosoft',
    cliIntro: 'El mismo alcance, para la terminal y para scripts. Muestra tablas en una terminal y JSON con un pipe o con --json.',
    cliRunNote: 'La CLI todavía no está en npm. Desde una copia del repositorio, se corre con:',
    cliExamplesLabel: 'Ejemplos',
    cliHeadless: 'En una máquina sin navegador, zerosoft login --device muestra un código que aprobás desde cualquier otro dispositivo. El token va al llavero del sistema si hay uno, y si no a un archivo que solo vos podés leer. Para CI, definí ZEROSOFT_API_KEY.',
    howTitle: 'Cómo encuentra las cosas Claude',
    howBody: [
      'Hay unas 1.800 operaciones, así que no se listan una por una. Claude usa pocas herramientas: list_apps, search_operations, get_operation_schema e invoke_operation, más whoami y atajos para lo más común.',
      'Cada operación corre el mismo código que la app. La mayoría tiene un esquema de entrada exacto, derivado del código; algunas están marcadas partial o loose, y ahí Claude aprende del mensaje de error.',
    ],
    accessTitle: 'Qué puede hacer',
    accessBody: [
      "Desconectar corta la conexión. Lo que creó queda, y los flows, workflows del CRM y robots que prendió siguen corriendo hasta que los apagues. Prender uno pide una confirmación explícita.",
      'Puede hacer lo que vos podés hacer, nada más. Si tu rol, tu acceso por app o un canal privado te frenan en la app, también frenan a Claude.',
      'En la pantalla de permisos elegís leer y escribir, o solo lectura, y el workspace. Las operaciones destructivas piden una confirmación explícita del cliente.',
      'Mirá y desconectá tus apps conectadas en Ajustes, API y webhooks. Los cambios hechos por una conexión quedan registrados con la persona, la app y la operación.',
      'Lo que vuelve de zerosoft puede traer texto escrito por otras personas, como mensajes de clientes o emails. Le llega a Claude marcado como dato, no como instrucción. Igual, revisá lo que Claude propone antes de que envíe o borre algo.',
      'Pasar a otro workspace pide volver a conectar: una conexión queda en el workspace que elegiste al aprobarla.',
      'Los clientes tienen que usar una dirección de vuelta https o local. Los esquemas de URL propios no están soportados.',
    ],
    outTitle: 'Qué queda afuera',
    outBody: [
      'El inicio de sesión, las API keys y los clientes OAuth. La propiedad del workspace, borrar la cuenta y la facturación. Eso sigue en Ajustes.',
      'Las páginas públicas para visitantes, los webhooks entrantes, los crons y la ingesta de Pulse. No hay una persona detrás.',
      'Lo que necesita tu navegador, como conectar Gmail o una red social, y los streams en tiempo real.',
    ],
    webOnlyTitle: 'Se hace desde la web',
    webOnlyIntro: 'Esto crea algo que sigue funcionando después de desconectar, o guarda las keys de otro servicio. Claude y la CLI te dicen dónde hacerlo.',
    webOnly: [
      'Webhooks, hooks entrantes y comandos; las apps de agentes de Track y la conexión con GitHub.',
      'Keys de pagos y de integraciones: Shop, Cal, Books, apps del CRM, credenciales de Flow y secretos de agentes.',
      'Links para compartir docs, notas, pizarras, diseños y grabaciones.',
      "Invitar personas al workspace; los números de Groups y las keys de su proveedor; las importaciones con el token de otro servicio.",
      "Las direcciones de webhook de los formularios y los pasos de webhook de Cal.",
      "Dar el rol de admin o de owner.",
    ],
    keysTitle: 'Con una API key',
    keysBody: 'El endpoint también acepta una API key personal como Bearer, para clientes sin OAuth. Creá la key con acceso al MCP en Ajustes, API y webhooks: las demás siguen solo con la API REST. Queda limitada por los scopes de la key.',
    apiLink: 'Referencia de la API REST',
  },
  pt: {
    metaTitle: 'Conectar o Claude e a CLI',
    metaDescription: 'Conecte o Claude Code ou a CLI da zerosoft à sua conta com seu login de sempre, e trabalhe nos 24 apps como você.',
    title: 'Conecte o Claude à zerosoft.',
    titleDim: 'E use pelo seu terminal.',
    intro: 'Um único conector chega aos 24 apps. Você entra pelo navegador com seu login de sempre, sem colar chaves, e o Claude age como você, com seu papel e suas permissões.',
    claudeCodeTitle: 'Claude Code',
    claudeCodeSteps: ['Adicione o servidor:', 'Rode /mcp dentro do Claude Code, escolha zerosoft e entre. O navegador abre a tela de permissões.'],
    claudeAiTitle: 'claude.ai',
    claudeAiSteps: ['Abra Settings, depois Connectors, e escolha Add custom connector.', 'Cole esta URL:', 'Conecte e aprove na tela de permissões.'],
    cursorTitle: 'Cursor e outros editores',
    cursorBody: 'Adicione a zerosoft ao .cursor/mcp.json (ou às configurações de MCP do seu editor) com a URL abaixo. O Cursor abre o navegador para entrar na primeira vez. Se o seu editor não faz OAuth com servidores remotos, use a versão com chave de API.',
    harnessTitle: 'Qualquer cliente MCP ou harness de agentes',
    harnessBody: [
      'O servidor fala Streamable HTTP (MCP 2025-11-25, também 2025-06-18 e 2025-03-26) em uma única URL, responde em JSON e não guarda sessão. Clientes com OAuth encontram tudo a partir do 401: o header WWW-Authenticate aponta para os metadados do recurso protegido, que apontam para o servidor de autorização, com registro dinâmico de clientes e PKCE.',
      'Harnesses que não conseguem abrir um navegador usam uma chave de API como Bearer. Crie-a em Ajustes, API e webhooks, ative o acesso ao MCP e escolha os scopes: a chave age como você, limitada por esses scopes. Cada chave tem 300 leituras e 60 escritas por minuto.',
      'As ferramentas mais usadas têm nome próprio, então um modelo não precisa procurá-las. O resto se alcança com search_operations, get_operation_schema e invoke_operation.',
    ],
    harnessToolsLabel: 'Ferramentas com nome próprio',
    cliTitle: 'A CLI da zerosoft',
    cliIntro: 'O mesmo alcance, para o terminal e para scripts. Mostra tabelas em um terminal e JSON com um pipe ou com --json.',
    cliRunNote: 'A CLI ainda não está no npm. A partir de uma cópia do repositório, rode com:',
    cliExamplesLabel: 'Exemplos',
    cliHeadless: 'Em uma máquina sem navegador, zerosoft login --device mostra um código que você aprova de qualquer outro dispositivo. O token vai para o chaveiro do sistema se houver um, e senão para um arquivo que só você pode ler. Para CI, defina ZEROSOFT_API_KEY.',
    howTitle: 'Como o Claude encontra as coisas',
    howBody: [
      'São cerca de 1.800 operações, então não são listadas uma a uma. O Claude usa poucas ferramentas: list_apps, search_operations, get_operation_schema e invoke_operation, mais whoami e atalhos para o mais comum.',
      'Cada operação roda o mesmo código do app. A maioria tem um esquema de entrada exato, derivado do código; algumas estão marcadas partial ou loose, e aí o Claude aprende com a mensagem de erro.',
    ],
    accessTitle: 'O que pode fazer',
    accessBody: [
      "Desconectar corta a conexão. O que ele criou fica, e os flows, workflows do CRM e robôs que ele ligou continuam rodando até você desligar. Ligar um deles pede uma confirmação explícita.",
      'Pode fazer o que você pode fazer, nada mais. Se seu papel, seu acesso por app ou um canal privado param você no app, também param o Claude.',
      'Na tela de permissões você escolhe ler e escrever, ou somente leitura, e o workspace. As operações destrutivas pedem uma confirmação explícita do cliente.',
      'Veja e desconecte seus apps conectados em Ajustes, API e webhooks. As alterações feitas por uma conexão ficam registradas com a pessoa, o app e a operação.',
      'O que volta da zerosoft pode trazer texto escrito por outras pessoas, como mensagens de clientes ou emails. Chega ao Claude marcado como dado, não como instrução. Mesmo assim, revise o que o Claude propõe antes que ele envie ou apague algo.',
      'Passar para outro workspace exige conectar de novo: uma conexão fica no workspace que você escolheu ao aprová-la.',
      'Os clientes precisam usar um endereço de retorno https ou local. Esquemas de URL próprios não são suportados.',
    ],
    outTitle: 'O que fica de fora',
    outBody: [
      'O login, as chaves de API e os clientes OAuth. A propriedade do workspace, apagar a conta e o faturamento. Isso continua em Ajustes.',
      'As páginas públicas para visitantes, os webhooks de entrada, os crons e a ingestão do Pulse. Não há uma pessoa por trás.',
      'O que precisa do seu navegador, como conectar o Gmail ou uma rede social, e os streams em tempo real.',
    ],
    webOnlyTitle: 'Feito pela web',
    webOnlyIntro: 'Isso cria algo que continua funcionando depois de desconectar, ou guarda as chaves de outro serviço. O Claude e a CLI dizem onde fazer.',
    webOnly: [
      'Webhooks, hooks de entrada e comandos; os apps de agentes do Track e a conexão com o GitHub.',
      'Chaves de pagamento e de integrações: Shop, Cal, Books, apps do CRM, credenciais do Flow e segredos de agentes.',
      'Links para compartilhar docs, notas, quadros, designs e gravações.',
      "Convidar pessoas para o workspace; os números do Groups e as chaves do provedor; as importações com o token de outro serviço.",
      "Os endereços de webhook dos formulários e as etapas de webhook do Cal.",
      "Dar o papel de admin ou owner.",
    ],
    keysTitle: 'Com uma chave de API',
    keysBody: 'O endpoint também aceita uma chave de API pessoal como Bearer, para clientes sem OAuth. Crie a chave com acesso ao MCP em Ajustes, API e webhooks: as demais continuam só com a API REST. Fica limitada pelos scopes da chave.',
    apiLink: 'Referência da API REST',
  },
};

/** Herramientas con nombre propio del servidor (lib/mcp/server.ts). tests/unit/mcp-direct-tools.test.ts las compara. */
export const MCP_NAMED_TOOLS = [
  'whoami', 'list_workspaces', 'list_apps', 'search_operations', 'get_operation_schema', 'invoke_operation',
  'search_workspace', 'list_notifications',
  'list_crm_contacts', 'create_crm_contact',
  'list_group_chats', 'read_group_messages', 'send_group_message', 'update_group_chat',
  'list_track_issues', 'get_track_issue', 'create_track_issue', 'update_track_issue', 'comment_on_track_issue',
  'search_docs', 'get_doc_page', 'create_doc_page', 'update_doc_page',
  'list_boards', 'get_board',
] as const;
