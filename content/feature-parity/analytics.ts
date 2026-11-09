import type { Localized, ParityRow, ParityStatus, ProductParity } from './types';

type L = [en: string, es: string, pt: string];
const loc = ([en, es, pt]: L): Localized => ({ en, es, pt });

function row(id: string, area: string, label: L, status: ParityStatus, opts: { detail?: L; competitorHas?: boolean; weight?: 1 | 2 } = {}): ParityRow {
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
 * Analytics contra Metabase (open source y Cloud). Primera versión: tablas
 * propias del workspace con permisos, Postgres y MySQL, constructor, SQL con
 * variables, gráficos, tableros con filtros, links públicos, suscripciones,
 * colecciones y preguntas en lenguaje natural. Lo probado solo con fakes o sin
 * un motor real en los tests queda como parcial. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Metabase',
  lastReviewed: '2026-11-08',
  areas: [
    { id: 'data', label: loc(['Data sources', 'Fuentes de datos', 'Fontes de dados']) },
    { id: 'questions', label: loc(['Questions', 'Preguntas', 'Perguntas']) },
    { id: 'viz', label: loc(['Visualizations', 'Visualizaciones', 'Visualizações']) },
    { id: 'dashboards', label: loc(['Dashboards', 'Tableros', 'Painéis']) },
    { id: 'sharing', label: loc(['Sharing', 'Compartir', 'Compartilhar']) },
    { id: 'admin', label: loc(['Permissions and admin', 'Permisos y administración', 'Permissões e administração']) },
  ],
  rows: [
    // Fuentes
    row('own-data', 'data', ['Your workspace data as tables', 'Datos del workspace como tablas', 'Dados do workspace como tabelas'], 'better', {
      competitorHas: false,
      weight: 2,
      detail: [
        'CRM, Track, Books, Lines and Pulse, read-only, with each app’s permissions applied per person. Metabase needs a database first',
        'CRM, Track, Books, Lines y Pulse, de solo lectura, con los permisos de cada app por persona. Metabase necesita primero una base',
        'CRM, Track, Books, Lines e Pulse, só leitura, com as permissões de cada app por pessoa. O Metabase precisa primeiro de um banco',
      ],
    }),
    row('postgres', 'data', ['PostgreSQL', 'PostgreSQL', 'PostgreSQL'], 'have', {
      weight: 2,
      detail: ['Read-only transaction, statement timeout, row limit, encrypted password and private addresses blocked', 'Transacción de solo lectura, tope de tiempo, tope de filas, contraseña cifrada y direcciones privadas bloqueadas', 'Transação só de leitura, limite de tempo, limite de linhas, senha criptografada e endereços privados bloqueados'],
    }),
    row('mysql', 'data', ['MySQL', 'MySQL', 'MySQL'], 'partial', {
      weight: 2,
      detail: ['Built with the same controls as PostgreSQL; not yet tested against a real MySQL server', 'Hecho con los mismos controles que PostgreSQL; todavía sin probar contra un MySQL real', 'Feito com os mesmos controles do PostgreSQL; ainda sem testar contra um MySQL real'],
    }),
    row('warehouses', 'data', ['BigQuery, Snowflake, Redshift and others', 'BigQuery, Snowflake, Redshift y otros', 'BigQuery, Snowflake, Redshift e outros'], 'missing', { weight: 2 }),
    row('sync-schema', 'data', ['Schema sync', 'Sincronizar el esquema', 'Sincronizar o esquema'], 'partial', {
      detail: ['On connect and with a button; no scheduled sync or field values scan', 'Al conectar y con un botón; sin sincronización programada ni escaneo de valores', 'Ao conectar e com um botão; sem sincronização agendada nem varredura de valores'],
    }),
    row('ssh', 'data', ['SSH tunnels', 'Túneles SSH', 'Túneis SSH'], 'missing'),
    row('uploads', 'data', ['Upload CSV as a table', 'Subir un CSV como tabla', 'Enviar um CSV como tabela'], 'missing'),
    row('models', 'data', ['Models and metrics', 'Modelos y métricas', 'Modelos e métricas'], 'missing'),

    // Preguntas
    row('builder', 'questions', ['Query builder without code', 'Constructor sin código', 'Construtor sem código'], 'have', {
      weight: 2,
      detail: ['Table, filters, metrics, grouping by date buckets, sort, limit and joins (by keys on workspace data)', 'Tabla, filtros, métricas, agrupar por períodos de fecha, orden, límite y uniones (por claves en los datos del workspace)', 'Tabela, filtros, métricas, agrupar por períodos de data, ordem, limite e uniões (por chaves nos dados do workspace)'],
    }),
    row('custom-expressions', 'questions', ['Custom columns and expressions', 'Columnas y expresiones propias', 'Colunas e expressões próprias'], 'missing'),
    row('sql-editor', 'questions', ['SQL editor', 'Editor SQL', 'Editor SQL'], 'have', {
      weight: 2,
      detail: ['Autocomplete of tables, columns and keywords, schema browser, Cmd+Enter', 'Autocompletado de tablas, columnas y palabras clave, navegador de esquema, Cmd+Enter', 'Autocompletar de tabelas, colunas e palavras-chave, navegador do esquema, Cmd+Enter'],
    }),
    row('variables', 'questions', ['SQL variables and optional clauses', 'Variables de SQL y cláusulas opcionales', 'Variáveis de SQL e cláusulas opcionais'], 'have', {
      detail: ['Text, number and date with defaults; field filters that map to a column are not built', 'Texto, número y fecha con valores por defecto; no hay filtros de campo atados a una columna', 'Texto, número e data com valores padrão; não há filtros de campo ligados a uma coluna'],
    }),
    row('snippets', 'questions', ['Saved SQL snippets', 'Fragmentos de SQL guardados', 'Trechos de SQL salvos'], 'missing'),
    row('natural-language', 'questions', ['Ask in plain language', 'Preguntar en lenguaje natural', 'Perguntar em linguagem natural'], 'have', {
      detail: ['AI writes SQL from the schema you can read and always shows it; Metabot is a paid add-on', 'La IA escribe el SQL a partir del esquema que podés leer y siempre lo muestra; Metabot es un extra pago', 'A IA escreve o SQL a partir do esquema que você pode ler e sempre mostra; o Metabot é um extra pago'],
    }),
    row('drill', 'questions', ['Drill-through by clicking a chart', 'Drill-through con clic en el gráfico', 'Drill-through clicando no gráfico'], 'missing'),
    row('caching', 'questions', ['Result caching', 'Caché de resultados', 'Cache de resultados'], 'have', {
      detail: ['Per person and query, 5 minutes by default; no per-question policy', 'Por persona y consulta, 5 minutos por defecto; sin política por pregunta', 'Por pessoa e consulta, 5 minutos por padrão; sem política por pergunta'],
    }),
    row('history', 'questions', ['Revision history', 'Historial de versiones', 'Histórico de versões'], 'missing'),

    // Visualizaciones
    row('viz-basic', 'viz', ['Table, number, line, bar and area', 'Tabla, número, línea, barras y área', 'Tabela, número, linha, barras e área'], 'have', { weight: 2 }),
    row('viz-auto', 'viz', ['Automatic chart choice', 'Gráfico elegido solo', 'Gráfico escolhido automaticamente'], 'have'),
    row('viz-pie-funnel', 'viz', ['Pie and funnel', 'Torta y embudo', 'Pizza e funil'], 'have'),
    row('viz-pivot', 'viz', ['Pivot tables', 'Tablas dinámicas', 'Tabelas dinâmicas'], 'missing'),
    row('viz-maps', 'viz', ['Maps', 'Mapas', 'Mapas'], 'missing'),
    row('viz-combo', 'viz', ['Combo, scatter, waterfall, gauge and progress', 'Combinados, dispersión, cascada, medidor y progreso', 'Combinados, dispersão, cascata, medidor e progresso'], 'missing'),
    row('viz-settings', 'viz', ['Formatting and series settings', 'Formato y ajustes de series', 'Formato e ajustes de séries'], 'partial', {
      detail: ['Pick the chart, x and series; no per-column formatting, goal lines or colors', 'Elegir gráfico, eje x y series; sin formato por columna, líneas de meta ni colores', 'Escolher gráfico, eixo x e séries; sem formato por coluna, linhas de meta nem cores'],
    }),
    row('export', 'viz', ['Download results', 'Descargar resultados', 'Baixar resultados'], 'partial', {
      detail: ['CSV of the rows shown (up to 2,000); no XLSX or JSON', 'CSV de las filas que se muestran (hasta 2.000); sin XLSX ni JSON', 'CSV das linhas mostradas (até 2.000); sem XLSX nem JSON'],
    }),

    // Tableros
    row('dash-grid', 'dashboards', ['Dashboard grid of cards', 'Grilla de tarjetas', 'Grade de cartões'], 'partial', {
      weight: 2,
      detail: ['Reorder and resize with buttons (keyboard friendly), text cards; no drag and drop or tabs', 'Reordenar y cambiar tamaño con botones (sirve con teclado), tarjetas de texto; sin arrastrar ni pestañas', 'Reordenar e mudar tamanho com botões (funciona com teclado), cartões de texto; sem arrastar nem abas'],
    }),
    row('dash-filters', 'dashboards', ['Dashboard filters wired to cards', 'Filtros del tablero conectados a tarjetas', 'Filtros do painel conectados aos cartões'], 'have', {
      weight: 2,
      detail: ['Text, number and date ranges, to a SQL variable or a builder column', 'Texto, número y rangos de fecha, a una variable del SQL o una columna del constructor', 'Texto, número e períodos de data, para uma variável do SQL ou uma coluna do construtor'],
    }),
    row('dash-refresh', 'dashboards', ['Auto-refresh and full screen', 'Actualización automática y pantalla completa', 'Atualização automática e tela cheia'], 'have'),
    row('collections', 'dashboards', ['Collections and personal collections', 'Colecciones y colecciones personales', 'Coleções e coleções pessoais'], 'have', {
      detail: ['Nested collections are stored but browsed flat', 'Las colecciones anidadas se guardan pero se recorren planas', 'As coleções aninhadas são guardadas mas navegadas sem hierarquia'],
    }),
    row('click-behavior', 'dashboards', ['Click behavior and cross-filtering', 'Acciones al hacer clic y filtros cruzados', 'Ações ao clicar e filtros cruzados'], 'missing'),

    // Compartir
    row('public-links', 'sharing', ['Public links and iframe embed', 'Links públicos e iframe', 'Links públicos e iframe'], 'have', {
      weight: 2,
      detail: ['Long random token stored hashed, revocable, calculated with the creator’s permissions, the query never reaches the browser', 'Token largo al azar guardado como hash, se puede apagar, calculado con los permisos de quien lo creó; la consulta nunca llega al navegador', 'Token longo aleatório guardado como hash, pode ser desligado, calculado com as permissões de quem criou; a consulta nunca chega ao navegador'],
    }),
    row('signed-embed', 'sharing', ['Signed embedding (JWT) with locked parameters', 'Incrustación firmada (JWT) con parámetros fijos', 'Incorporação assinada (JWT) com parâmetros fixos'], 'missing'),
    row('subscriptions', 'sharing', ['Dashboard subscriptions by email', 'Suscripciones de tableros por email', 'Assinaturas de painéis por email'], 'partial', {
      detail: ['Daily or weekly at a local hour, to people in the workspace; tested with a fake mail sender; no attachments', 'Diarias o semanales a una hora local, a personas del workspace; probado con un envío de email falso; sin adjuntos', 'Diárias ou semanais numa hora local, para pessoas do workspace; testado com um envio de email falso; sem anexos'],
    }),
    row('chat-digest', 'sharing', ['Subscriptions to a chat channel', 'Suscripciones a un canal de chat', 'Assinaturas para um canal de chat'], 'partial', {
      detail: ['To a Talk channel (Metabase sends to Slack)', 'A un canal de Talk (Metabase manda a Slack)', 'Para um canal do Talk (o Metabase envia para o Slack)'],
    }),
    row('alerts', 'sharing', ['Alerts when a question crosses a goal', 'Alertas cuando una pregunta pasa una meta', 'Alertas quando uma pergunta passa uma meta'], 'missing'),

    // Permisos
    row('data-permissions', 'admin', ['Data permissions', 'Permisos sobre los datos', 'Permissões sobre os dados'], 'partial', {
      weight: 2,
      detail: ['Workspace data follows each app’s permissions; on external databases admins choose who writes SQL. No per-table or per-group rules', 'Los datos del workspace siguen los permisos de cada app; en bases externas los admins eligen quién escribe SQL. Sin reglas por tabla ni por grupo', 'Os dados do workspace seguem as permissões de cada app; nos bancos externos os admins escolhem quem escreve SQL. Sem regras por tabela nem por grupo'],
    }),
    row('collection-permissions', 'admin', ['Collection permissions', 'Permisos de colecciones', 'Permissões de coleções'], 'partial', {
      detail: ['Shared or personal; only the author or an admin edits. No per-group view or curate rights', 'Compartidas o personales; edita el autor o un admin. Sin permisos de ver o curar por grupo', 'Compartilhadas ou pessoais; edita o autor ou um admin. Sem permissões de ver ou curar por grupo'],
    }),
    row('sandboxing', 'admin', ['Row-level sandboxing by group', 'Sandboxing de filas por grupo', 'Sandboxing de linhas por grupo'], 'missing'),
    row('audit', 'admin', ['Usage analytics and audit log', 'Uso y registro de auditoría', 'Uso e registro de auditoria'], 'missing'),
    row('api', 'admin', ['API and MCP', 'API y MCP', 'API e MCP'], 'have', {
      detail: ['Session or API key with bi:read and bi:write; the same operations are on the MCP server', 'Sesión o API key con bi:read y bi:write; las mismas operaciones están en el servidor MCP', 'Sessão ou API key com bi:read e bi:write; as mesmas operações estão no servidor MCP'],
    }),
    row('open-source', 'admin', ['Open source and self-hosted', 'Código abierto y alojado por vos', 'Open source e auto-hospedado'], 'have'),
  ],
};

export default parity;
