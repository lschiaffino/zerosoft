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
 * Analytics contra PostHog (2026-10-29). Primera versión: proyectos con key
 * pública, snippet de JS, ingesta por lotes, tendencias, embudos, retención,
 * caminos, personas, cohortes, tableros, feature flags, SQL de solo lectura y
 * analítica web, sobre la misma base libsql que el resto de la suite. Los
 * límites de escala están en la fila `scale`. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'PostHog',
  lastReviewed: '2026-10-29',
  areas: [
    { id: 'ingest', label: loc(['Capture and SDKs', 'Captura y SDKs', 'Captura e SDKs']) },
    { id: 'privacy', label: loc(['Privacy and limits', 'Privacidad y límites', 'Privacidade e limites']) },
    { id: 'insights', label: loc(['Insights', 'Insights', 'Insights']) },
    { id: 'people', label: loc(['People and cohorts', 'Personas y cohortes', 'Pessoas e coortes']) },
    { id: 'flags', label: loc(['Feature flags', 'Feature flags', 'Feature flags']) },
    { id: 'web', label: loc(['Web analytics', 'Analítica web', 'Analytics web']) },
    { id: 'data', label: loc(['Data and platform', 'Datos y plataforma', 'Dados e plataforma']) },
    { id: 'more', label: loc(['Other products', 'Otros productos', 'Outros produtos']) },
  ],
  rows: [
    // Captura
    row('projects', 'ingest', ['Projects with a public key', 'Proyectos con key pública', 'Projetos com key pública'], 'have', {
      weight: 2,
      detail: [
        'Several projects per workspace, each with its own public key, optional secret key and isolated data',
        'Varios proyectos por workspace, cada uno con su key pública, una key secreta opcional y sus datos aparte',
        'Vários projetos por workspace, cada um com sua key pública, uma key secreta opcional e dados separados',
      ],
    }),
    row('js-snippet', 'ingest', ['JavaScript snippet', 'Snippet de JavaScript', 'Snippet de JavaScript'], 'have', {
      weight: 2,
      detail: [
        'Script tag or ES module (/zs.mjs) with capture, identify, alias, group, register and reset',
        'Tag de script o módulo ES (/zs.mjs) con capture, identify, alias, group, register y reset',
        'Tag de script ou módulo ES (/zs.mjs) com capture, identify, alias, group, register e reset',
      ],
    }),
    row('pageviews', 'ingest', ['Automatic page views', 'Páginas vistas automáticas', 'Visualizações de página automáticas'], 'have', {
      detail: ['Including single-page apps (history changes)', 'También en apps de una página (cambios de history)', 'Também em apps de página única (mudanças de history)'],
    }),
    row('autocapture', 'ingest', ['Autocapture', 'Autocapture', 'Autocapture'], 'have', {
      weight: 2,
      detail: [
        'Clicks on links and buttons, field changes without their values and form submits. Skips password fields and zs-no-capture',
        'Clicks en links y botones, cambios en campos sin su valor y envíos de formularios. Saltea contraseñas y zs-no-capture',
        'Cliques em links e botões, mudanças em campos sem o valor e envios de formulários. Ignora senhas e zs-no-capture',
      ],
    }),
    row('event-context', 'ingest', ['UTM, referrer, device and country', 'UTM, referente, dispositivo y país', 'UTM, referência, dispositivo e país'], 'have', {
      detail: [
        'UTM tags, referrer and referring domain, browser, OS, device type and country, plus first-touch values on the person',
        'Etiquetas UTM, referente y su dominio, navegador, sistema, tipo de dispositivo y país, más los valores iniciales en la persona',
        'Tags UTM, referência e domínio, navegador, sistema, tipo de dispositivo e país, mais os valores iniciais na pessoa',
      ],
    }),
    row('sessions', 'ingest', ['Session id', 'Id de sesión', 'Id de sessão'], 'have', {
      detail: ['A new session after 30 minutes without events', 'Sesión nueva después de 30 minutos sin eventos', 'Sessão nova depois de 30 minutos sem eventos'],
    }),
    row('batch-api', 'ingest', ['Batch capture API for servers', 'API de captura por lotes para servidores', 'API de captura em lote para servidores'], 'have', {
      weight: 2,
      detail: [
        'POST /api/ingest/e with up to 200 events, from the browser with the public key or from a server with the project secret key',
        'POST /api/ingest/e con hasta 200 eventos, desde el navegador con la key pública o desde un servidor con la key secreta',
        'POST /api/ingest/e com até 200 eventos, do navegador com a key pública ou de um servidor com a key secreta',
      ],
    }),
    row('sdks', 'ingest', ['SDKs for other platforms', 'SDKs para otras plataformas', 'SDKs para outras plataformas'], 'partial', {
      detail: [
        'Browser JavaScript and plain HTTP only. The endpoint accepts PostHog-style batches with api_key or token, but there are no server or mobile SDKs',
        'Solo JavaScript de navegador y HTTP. El endpoint acepta lotes al estilo PostHog con api_key o token, pero no hay SDKs de servidor ni mobile',
        'Só JavaScript de navegador e HTTP. O endpoint aceita lotes no estilo PostHog com api_key ou token, mas não há SDKs de servidor nem mobile',
      ],
    }),
    row('group-analytics', 'ingest', ['Group analytics', 'Analítica por grupos', 'Analytics por grupos'], 'partial', {
      detail: [
        'group() stores the group with its properties and tags later events, but insights cannot count by group yet',
        'group() guarda el grupo con sus propiedades y marca los eventos siguientes, pero los insights todavía no cuentan por grupo',
        'group() guarda o grupo com suas propriedades e marca os eventos seguintes, mas os insights ainda não contam por grupo',
      ],
    }),
    row('reverse-proxy', 'ingest', ['Reverse proxy guide', 'Guía de proxy inverso', 'Guia de proxy reverso'], 'missing'),

    // Privacidad
    row('dnt', 'privacy', ['Respect Do Not Track', 'Respetar Do Not Track', 'Respeitar Do Not Track'], 'have', {
      detail: ['Project setting; also honors Global Privacy Control', 'Ajuste del proyecto; también respeta Global Privacy Control', 'Ajuste do projeto; também respeita Global Privacy Control'],
    }),
    row('ip-anonymize', 'privacy', ['IP anonymization', 'Anonimizar IPs', 'Anonimizar IPs'], 'have', {
      detail: ['The last part of the address is dropped before saving', 'Se descarta la última parte de la dirección antes de guardarla', 'A última parte do endereço é descartada antes de salvar'],
    }),
    row('allowed-domains', 'privacy', ['Allowed domains', 'Dominios permitidos', 'Domínios permitidos'], 'have', {
      detail: ['Events with the public key from other origins are rejected', 'Se rechazan los eventos con la key pública que vienen de otros orígenes', 'Eventos com a key pública vindos de outras origens são rejeitados'],
    }),
    row('ingest-limits', 'privacy', ['Rate limits and payload caps', 'Topes de pedidos y de tamaño', 'Limites de pedidos e de tamanho'], 'have', {
      detail: ['Per-project rate limit, 512 KB per request and 200 events per batch', 'Tope por proyecto, 512 KB por pedido y 200 eventos por lote', 'Limite por projeto, 512 KB por pedido e 200 eventos por lote'],
    }),
    row('delete-person', 'privacy', ['Delete a person and their data', 'Borrar una persona y sus datos', 'Apagar uma pessoa e seus dados'], 'have', {
      weight: 2,
      detail: [
        'From the person page (admins) or POST /api/ingest/delete with the secret key',
        'Desde la página de la persona (admins) o POST /api/ingest/delete con la key secreta',
        'Na página da pessoa (admins) ou POST /api/ingest/delete com a key secreta',
      ],
    }),
    row('retention-setting', 'privacy', ['Data retention per project', 'Retención de datos por proyecto', 'Retenção de dados por projeto'], 'have', {
      detail: ['Older events and sessions are purged by the hourly job', 'El trabajo de cada hora borra los eventos y sesiones más viejos', 'O job de cada hora apaga eventos e sessões mais antigos'],
    }),

    // Insights
    row('live-events', 'insights', ['Live events', 'Eventos en vivo', 'Eventos ao vivo'], 'have', { weight: 2 }),
    row('trends', 'insights', ['Trends', 'Tendencias', 'Tendências'], 'have', {
      weight: 2,
      detail: [
        'Totals and unique users by hour, day, week or month, up to 5 series, filters and a cohort filter',
        'Totales y personas únicas por hora, día, semana o mes, hasta 5 series, filtros y filtro por cohorte',
        'Totais e usuários únicos por hora, dia, semana ou mês, até 5 séries, filtros e filtro por coorte',
      ],
    }),
    row('breakdown', 'insights', ['Breakdown by property', 'Apertura por propiedad', 'Abertura por propriedade'], 'have', {
      detail: ['Event or person property, top 10 values plus the rest', 'Propiedad del evento o de la persona, los 10 valores principales más el resto', 'Propriedade do evento ou da pessoa, os 10 valores principais mais o resto'],
    }),
    row('compare-period', 'insights', ['Compare to the previous period', 'Comparar con el período anterior', 'Comparar com o período anterior'], 'have'),
    row('funnels', 'insights', ['Funnels', 'Embudos', 'Funis'], 'have', {
      weight: 2,
      detail: [
        '2 to 10 steps, conversion window of 1 to 90 days, drop-off, median time between steps and the people who dropped',
        'De 2 a 10 pasos, ventana de conversión de 1 a 90 días, abandono, mediana de tiempo entre pasos y la gente que abandonó',
        'De 2 a 10 etapas, janela de conversão de 1 a 90 dias, abandono, mediana de tempo entre etapas e as pessoas que desistiram',
      ],
    }),
    row('retention', 'insights', ['Retention', 'Retención', 'Retenção'], 'have', {
      weight: 2,
      detail: ['Daily or weekly cohorts with a start event and a return event', 'Cohortes diarias o semanales con evento inicial y evento de vuelta', 'Coortes diárias ou semanais com evento inicial e evento de retorno'],
    }),
    row('paths', 'insights', ['User paths', 'Caminos de usuarios', 'Caminhos de usuários'], 'partial', {
      detail: [
        'Top transitions per step and top full paths as tables, from page views only. No Sankey diagram',
        'Las transiciones principales por paso y los caminos más comunes en tablas, solo con páginas vistas. Sin diagrama Sankey',
        'As principais transições por etapa e os caminhos mais comuns em tabelas, só com visualizações de página. Sem diagrama Sankey',
      ],
    }),
    row('sql', 'insights', ['SQL queries', 'Consultas SQL', 'Consultas SQL'], 'partial', {
      weight: 2,
      detail: [
        'Read-only SQLite over events, persons, person_distinct_ids and sessions of the project, with a strict whitelist and 1,000 rows. Not HogQL',
        'SQLite de solo lectura sobre events, persons, person_distinct_ids y sessions del proyecto, con lista blanca estricta y 1.000 filas. No es HogQL',
        'SQLite somente leitura sobre events, persons, person_distinct_ids e sessions do projeto, com lista branca estrita e 1.000 linhas. Não é HogQL',
      ],
    }),
    row('dashboards', 'insights', ['Dashboards', 'Tableros', 'Painéis'], 'have', { weight: 2 }),
    row('stickiness-lifecycle', 'insights', ['Stickiness and lifecycle', 'Stickiness y ciclo de vida', 'Stickiness e ciclo de vida'], 'missing'),
    row('correlation', 'insights', ['Funnel correlation analysis', 'Análisis de correlación en embudos', 'Análise de correlação em funis'], 'missing'),
    row('alerts', 'insights', ['Alerts on insights', 'Alertas sobre insights', 'Alertas sobre insights'], 'missing'),
    row('sharing', 'insights', ['Public sharing and embeds', 'Compartir y embeber en público', 'Compartilhar e embutir em público'], 'missing'),

    // Personas
    row('persons', 'people', ['Persons with properties and timeline', 'Personas con propiedades y línea de tiempo', 'Pessoas com propriedades e linha do tempo'], 'have', {
      weight: 2,
      detail: ['Properties, distinct ids, identify merges and the event timeline', 'Propiedades, distinct ids, fusión al identificar y la línea de tiempo de eventos', 'Propriedades, distinct ids, fusão ao identificar e a linha do tempo de eventos'],
    }),
    row('cohorts', 'people', ['Cohorts', 'Cohortes', 'Coortes'], 'partial', {
      detail: [
        'Person-property filters plus one behavioral rule (did an event at least N times in the last D days). No nested groups or static CSV cohorts',
        'Filtros de propiedades más una regla de comportamiento (hizo un evento al menos N veces en los últimos D días). Sin grupos anidados ni cohortes estáticas por CSV',
        'Filtros de propriedades mais uma regra de comportamento (fez um evento pelo menos N vezes nos últimos D dias). Sem grupos aninhados nem coortes estáticas por CSV',
      ],
    }),

    // Flags
    row('flags-basic', 'flags', ['Boolean and multivariate flags', 'Flags booleanos y multivariante', 'Flags booleanas e multivariantes'], 'have', {
      weight: 2,
      detail: ['With rollout percentage and variant split', 'Con porcentaje de rollout y reparto de variantes', 'Com porcentagem de rollout e divisão de variantes'],
    }),
    row('flags-targeting', 'flags', ['Targeting by person properties', 'Segmentación por propiedades de la persona', 'Segmentação por propriedades da pessoa'], 'partial', {
      detail: [
        'One set of conditions joined with AND. No multiple release groups, payloads, local evaluation or early access management',
        'Un solo conjunto de condiciones con AND. Sin varios grupos de release, payloads, evaluación local ni early access',
        'Um só conjunto de condições com AND. Sem vários grupos de release, payloads, avaliação local nem early access',
      ],
    }),
    row('flags-decide', 'flags', ['Decide endpoint and snippet helpers', 'Endpoint decide y helpers del snippet', 'Endpoint decide e helpers do snippet'], 'have', {
      detail: ['POST /api/ingest/decide, isFeatureEnabled, getFeatureFlag and onFeatureFlags', 'POST /api/ingest/decide, isFeatureEnabled, getFeatureFlag y onFeatureFlags', 'POST /api/ingest/decide, isFeatureEnabled, getFeatureFlag e onFeatureFlags'],
    }),
    row('experiments', 'flags', ['Experiments (A/B test analysis)', 'Experimentos (análisis de A/B)', 'Experimentos (análise de A/B)'], 'missing'),

    // Web
    row('web-overview', 'web', ['Web analytics overview', 'Resumen de analítica web', 'Resumo de analytics web'], 'have', {
      weight: 2,
      detail: [
        'Visitors, page views, sessions, bounce rate and average duration, with top pages, entry pages, referrers, UTM sources, countries, devices, browsers and OS',
        'Visitantes, páginas vistas, sesiones, rebote y duración promedio, con páginas, páginas de entrada, referentes, fuentes UTM, países, dispositivos, navegadores y sistemas',
        'Visitantes, visualizações, sessões, rejeição e duração média, com páginas, páginas de entrada, referências, fontes UTM, países, dispositivos, navegadores e sistemas',
      ],
    }),
    row('heatmaps', 'web', ['Heatmaps', 'Mapas de calor', 'Mapas de calor'], 'missing'),
    row('toolbar', 'web', ['Toolbar on your site', 'Toolbar en tu sitio', 'Toolbar no seu site'], 'missing'),

    // Datos y plataforma
    row('scale', 'data', ['Scale', 'Escala', 'Escala'], 'partial', {
      weight: 2,
      detail: [
        'Runs on the same libsql or Turso database as the suite, with one writer. Meant for small and mid-size sites, roughly a few million events per project before queries slow down. Daily rollups speed up unfiltered daily trends; funnels, retention and paths read up to 200,000 rows and say when they are cut',
        'Corre en la misma base libsql o Turso que la suite, con un solo escritor. Pensado para sitios chicos y medianos, unos pocos millones de eventos por proyecto antes de que las consultas se pongan lentas. Los rollups diarios aceleran las tendencias por día sin filtros; embudos, retención y caminos leen hasta 200.000 filas y avisan si se cortan',
        'Roda no mesmo banco libsql ou Turso da suíte, com um só escritor. Pensado para sites pequenos e médios, alguns milhões de eventos por projeto antes de as consultas ficarem lentas. Os rollups diários aceleram tendências diárias sem filtros; funis, retenção e caminhos leem até 200.000 linhas e avisam quando cortam',
      ],
    }),
    row('timezone', 'data', ['Project time zone', 'Zona horaria del proyecto', 'Fuso horário do projeto'], 'partial', {
      detail: ['A fixed UTC offset per project, without daylight saving changes', 'Un desfase fijo respecto de UTC por proyecto, sin horario de verano', 'Um deslocamento fixo de UTC por projeto, sem horário de verão'],
    }),
    row('api-scopes', 'data', ['API access with scoped keys', 'Acceso por API con keys con permisos', 'Acesso por API com keys com permissões'], 'have', {
      detail: ['analytics:read and analytics:write for queries, events and persons', 'analytics:read y analytics:write para consultas, eventos y personas', 'analytics:read e analytics:write para consultas, eventos e pessoas'],
    }),
    row('ai-assistant', 'data', ['AI assistant over your analytics', 'Asistente de IA sobre tu analítica', 'Assistente de IA sobre o seu analytics'], 'have', {
      detail: ['Read tools in the platform assistant, with the same app access', 'Herramientas de lectura en el asistente de la plataforma, con el mismo acceso por app', 'Ferramentas de leitura no assistente da plataforma, com o mesmo acesso por app'],
    }),
    row('data-warehouse', 'data', ['Data warehouse and external sources', 'Data warehouse y fuentes externas', 'Data warehouse e fontes externas'], 'missing'),
    row('pipelines', 'data', ['CDP destinations and pipelines', 'Destinos CDP y pipelines', 'Destinos CDP e pipelines'], 'missing'),

    // Otros productos de PostHog
    row('session-replay', 'more', ['Session replay', 'Session replay', 'Session replay'], 'missing', {
      weight: 2,
      detail: ['Not built: Analytics does not record the screen', 'No está hecho: Analytics no graba la pantalla', 'Não foi feito: o Analytics não grava a tela'],
    }),
    row('surveys', 'more', ['Surveys', 'Encuestas', 'Pesquisas'], 'missing'),
    row('error-tracking', 'more', ['Error tracking', 'Seguimiento de errores', 'Rastreamento de erros'], 'missing'),
    row('llm-observability', 'more', ['LLM observability', 'Observabilidad de LLMs', 'Observabilidade de LLMs'], 'missing'),
  ],
};

export default parity;
