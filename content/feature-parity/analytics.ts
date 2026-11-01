import type { Localized, ParityArea, ParityRow, ParityStatus, ProductParity } from './types';
import benchmark from './analytics-benchmark.json';

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
 * Analytics contra PostHog. Las filas de abajo son las primeras; el resto sale de
 * analytics-benchmark.json, una fila por cada capacidad de la documentación de
 * PostHog (fuentes en docs/benchmark/analytics.md). Primera versión: proyectos con key
 * pública, snippet de JS, ingesta por lotes, tendencias, embudos, retención,
 * caminos, personas, cohortes, tableros, feature flags, SQL de solo lectura y
 * analítica web, sobre la misma base libsql que el resto de la suite. Los
 * límites de escala están en la fila `scale`. Los ids son estables.
 */
const BASE_AREAS = new Set(['ingest', 'privacy', 'insights', 'people', 'flags', 'web', 'data', 'more']);

const parity: ProductParity = {
  competitor: 'PostHog',
  lastReviewed: '2026-11-01',
  areas: [
    { id: 'ingest', label: loc(['Capture and SDKs', 'Captura y SDKs', 'Captura e SDKs']) },
    { id: 'privacy', label: loc(['Privacy and limits', 'Privacidad y límites', 'Privacidade e limites']) },
    { id: 'insights', label: loc(['Insights', 'Insights', 'Insights']) },
    { id: 'people', label: loc(['People and cohorts', 'Personas y cohortes', 'Pessoas e coortes']) },
    { id: 'flags', label: loc(['Feature flags', 'Feature flags', 'Feature flags']) },
    { id: 'web', label: loc(['Web analytics', 'Analítica web', 'Analytics web']) },
    { id: 'data', label: loc(['Data and platform', 'Datos y plataforma', 'Dados e plataforma']) },
    { id: 'more', label: loc(['Other products', 'Otros productos', 'Outros produtos']) },
    ...(benchmark.areas as ParityArea[]).filter((a) => !BASE_AREAS.has(a.id) && a.id !== 'tours'),
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
        'Browser JavaScript and plain HTTP. The posthog-node SDK works against our host for capture, identify, flags and payloads; other PostHog SDKs were not tried. No SDKs of our own for servers or mobile',
        'JavaScript de navegador y HTTP. El SDK posthog-node funciona contra nuestro host para captura, identify, flags y payloads; otros SDKs de PostHog no se probaron. Sin SDKs propios de servidor ni mobile',
        'JavaScript de navegador e HTTP. O SDK posthog-node funciona com nosso host para captura, identify, flags e payloads; outros SDKs do PostHog não foram testados. Sem SDKs próprios de servidor nem mobile',
      ],
    }),
    row('group-analytics', 'ingest', ['Group analytics', 'Analítica por grupos', 'Analytics por grupos'], 'partial', {
      detail: [
        'group() stores groups and tags events; trends count unique groups, funnels count by group and there is a group list. No group pages, group filters or retention by group',
        'group() guarda grupos y marca eventos; las tendencias cuentan grupos únicos, los embudos cuentan por grupo y hay una lista de grupos. Sin páginas de grupo, filtros de grupo ni retención por grupo',
        'group() guarda grupos e marca eventos; as tendências contam grupos únicos, os funis contam por grupo e há uma lista de grupos. Sem páginas de grupo, filtros de grupo nem retenção por grupo',
      ],
    }),
    row('reverse-proxy', 'ingest', ['Reverse proxy guide', 'Guía de proxy inverso', 'Guia de proxy reverso'], 'have', {
      detail: [
        'Guides for Next.js and nginx in project settings; the snippet and ingest were exercised through a real proxy on another origin',
        'Guías para Next.js y nginx en los ajustes del proyecto; el snippet y la ingesta se probaron a través de un proxy real en otro origen',
        'Guias para Next.js e nginx nas configurações do projeto; o snippet e a ingestão foram testados através de um proxy real em outra origem',
      ],
    }),

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
        'Sankey diagram and tables, with page views or custom events, a start and an end, and ids grouped in URLs. No path cleaning rules or exclusions',
        'Diagrama Sankey y tablas, con páginas vistas o eventos propios, inicio y final, e ids juntados en las URLs. Sin reglas de limpieza de caminos ni exclusiones',
        'Diagrama Sankey e tabelas, com visualizações de página ou eventos próprios, início e fim, e ids agrupados nas URLs. Sem regras de limpeza de caminhos nem exclusões',
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
    row('stickiness-lifecycle', 'insights', ['Stickiness and lifecycle', 'Stickiness y ciclo de vida', 'Stickiness e ciclo de vida'], 'have', {
      detail: [
        'Both insight kinds, by day, week or month, checked against events sent through the real API',
        'Los dos tipos de insight, por día, semana o mes, comprobados contra eventos enviados por la API real',
        'Os dois tipos de insight, por dia, semana ou mês, verificados contra eventos enviados pela API real',
      ],
    }),
    row('correlation', 'insights', ['Funnel correlation analysis', 'Análisis de correlación en embudos', 'Análise de correlação em funis'], 'partial', {
      detail: [
        'Events and person properties, with odds ratios. No event property correlation or per-step analysis',
        'Eventos y propiedades de la persona, con odds ratio. Sin correlación por propiedades de evento ni análisis por paso',
        'Eventos e propriedades da pessoa, com odds ratio. Sem correlação por propriedades de evento nem análise por etapa',
      ],
    }),
    row('alerts', 'insights', ['Alerts on insights', 'Alertas sobre insights', 'Alertas sobre insights'], 'partial', {
      detail: [
        'Thresholds and percentage changes on trends insights, hourly or daily, with in-app notices. No email or Slack delivery',
        'Umbrales y cambios porcentuales sobre insights de tendencias, por hora o por día, con avisos en la app. Sin envío por email ni Slack',
        'Limites e variações percentuais em insights de tendências, por hora ou por dia, com avisos no app. Sem envio por email nem Slack',
      ],
    }),
    row('sharing', 'insights', ['Public sharing and embeds', 'Compartir y embeber en público', 'Compartilhar e embutir em público'], 'partial', {
      detail: [
        'Revocable public links and iframe embeds for insights and dashboards, with results only. No password or whitelabel options',
        'Links públicos revocables e iframes para insights y tableros, solo con resultados. Sin contraseña ni marca blanca',
        'Links públicos revogáveis e iframes para insights e painéis, só com resultados. Sem senha nem marca branca',
      ],
    }),

    // Personas
    row('persons', 'people', ['Persons with properties and timeline', 'Personas con propiedades y línea de tiempo', 'Pessoas com propriedades e linha do tempo'], 'have', {
      weight: 2,
      detail: ['Properties, distinct ids, identify merges and the event timeline', 'Propiedades, distinct ids, fusión al identificar y la línea de tiempo de eventos', 'Propriedades, distinct ids, fusão ao identificar e a linha do tempo de eventos'],
    }),
    row('cohorts', 'people', ['Cohorts', 'Cohortes', 'Coortes'], 'partial', {
      detail: [
        'Rule groups joined with OR, did and did not do, static lists by CSV and from a list of people. No sequence rules or cohorts of cohorts',
        'Grupos de reglas con O, hizo y no hizo, listas estáticas por CSV y desde una lista de personas. Sin reglas de secuencia ni cohortes de cohortes',
        'Grupos de regras com OU, fez e não fez, listas estáticas por CSV e a partir de uma lista de pessoas. Sem regras de sequência nem coortes de coortes',
      ],
    }),

    // Flags
    row('flags-basic', 'flags', ['Boolean and multivariate flags', 'Flags booleanos y multivariante', 'Flags booleanas e multivariantes'], 'have', {
      weight: 2,
      detail: ['With rollout percentage and variant split', 'Con porcentaje de rollout y reparto de variantes', 'Com porcentagem de rollout e divisão de variantes'],
    }),
    row('flags-targeting', 'flags', ['Targeting by person properties', 'Segmentación por propiedades de la persona', 'Segmentação por propriedades da pessoa'], 'partial', {
      detail: [
        'Ordered release groups with person properties, a cohort, a rollout and a forced variant, plus payloads. No group targeting, GeoIP operators or flag dependencies',
        'Grupos de release en orden con propiedades de la persona, una cohorte, un porcentaje y una variante forzada, más payloads. Sin segmentar por grupos, operadores GeoIP ni dependencias entre flags',
        'Grupos de release em ordem com propriedades da pessoa, uma coorte, uma porcentagem e uma variante forçada, mais payloads. Sem segmentar por grupos, operadores GeoIP nem dependências entre flags',
      ],
    }),
    row('flags-decide', 'flags', ['Decide endpoint and snippet helpers', 'Endpoint decide y helpers del snippet', 'Endpoint decide e helpers do snippet'], 'have', {
      detail: ['POST /api/ingest/decide, isFeatureEnabled, getFeatureFlag and onFeatureFlags', 'POST /api/ingest/decide, isFeatureEnabled, getFeatureFlag y onFeatureFlags', 'POST /api/ingest/decide, isFeatureEnabled, getFeatureFlag e onFeatureFlags'],
    }),
    row('experiments', 'flags', ['Experiments (A/B test analysis)', 'Experimentos (análisis de A/B)', 'Experimentos (análise de A/B)'], 'partial', {
      detail: [
        'Bayesian analysis of conversion and average metrics on a flag, exposure tracking, sample mismatch warning and rolling out a winner. No frequentist engine, ratio metrics, holdouts or shared metrics',
        'Análisis bayesiano de conversión y promedio sobre un flag, registro de exposición, aviso de reparto desparejo y pasar a la ganadora. Sin motor frecuentista, métricas de razón, holdouts ni métricas compartidas',
        'Análise bayesiana de conversão e média sobre um flag, registro de exposição, aviso de divisão desigual e passar para a vencedora. Sem motor frequentista, métricas de razão, holdouts nem métricas compartilhadas',
      ],
    }),

    // Web
    row('web-overview', 'web', ['Web analytics overview', 'Resumen de analítica web', 'Resumo de analytics web'], 'have', {
      weight: 2,
      detail: [
        'Visitors, page views, sessions, bounce rate and average duration, with top pages, entry pages, referrers, UTM sources, countries, devices, browsers and OS',
        'Visitantes, páginas vistas, sesiones, rebote y duración promedio, con páginas, páginas de entrada, referentes, fuentes UTM, países, dispositivos, navegadores y sistemas',
        'Visitantes, visualizações, sessões, rejeição e duração média, com páginas, páginas de entrada, referências, fontes UTM, países, dispositivos, navegadores e sistemas',
      ],
    }),
    row('heatmaps', 'web', ['Heatmaps', 'Mapas de calor', 'Mapas de calor'], 'partial', {
      detail: [
        'Clicks, most clicked elements and scroll depth per page and viewport, opt-in per project. No rage clicks or in-page view',
        'Clics, elementos más clicados y profundidad de scroll por página y ancho, a elección por proyecto. Sin clics de bronca ni vista dentro de la página',
        'Cliques, elementos mais clicados e profundidade de scroll por página e largura, opcional por projeto. Sem cliques de raiva nem visão dentro da página',
      ],
    }),
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
    row('session-replay', 'more', ['Session replay', 'Session replay', 'Session replay'], 'partial', {
      weight: 2,
      detail: [
        'Web recording with rrweb, opt-in per project, masked inputs, list with filters and a player with timeline and events. No console or network logs, playlists, or mobile',
        'Grabación web con rrweb, a elección por proyecto, campos enmascarados, lista con filtros y reproductor con línea de tiempo y eventos. Sin logs de consola ni de red, listas de reproducción ni mobile',
        'Gravação web com rrweb, opcional por projeto, campos mascarados, lista com filtros e player com linha do tempo e eventos. Sem logs de console nem de rede, playlists nem mobile',
      ],
    }),
    row('surveys', 'more', ['Surveys', 'Encuestas', 'Pesquisas'], 'partial', {
      detail: [
        'Popover surveys with open, rating and choice questions, targeting, sampling, preview and results with CSV. No branching, link or email surveys',
        'Encuestas en popover con preguntas abiertas, de puntaje y de opción, segmentación, muestreo, vista previa y resultados con CSV. Sin ramificación ni encuestas por link o email',
        'Pesquisas em popover com perguntas abertas, de nota e de opção, segmentação, amostragem, prévia e resultados com CSV. Sem ramificação nem pesquisas por link ou email',
      ],
    }),
    row('error-tracking', 'more', ['Error tracking', 'Seguimiento de errores', 'Rastreamento de erros'], 'partial', {
      detail: [
        'Captures uncaught errors from the snippet, groups them with a server fingerprint and has status, assignee and regressions. No source maps or SDKs for other platforms',
        'Captura errores sin atrapar del snippet, los agrupa con una huella del servidor y tiene estado, responsable y regresiones. Sin source maps ni SDKs para otras plataformas',
        'Captura erros não tratados do snippet, agrupa com uma impressão do servidor e tem estado, responsável e regressões. Sem source maps nem SDKs para outras plataformas',
      ],
    }),
    row('llm-observability', 'more', ['LLM observability', 'Observabilidad de LLMs', 'Observabilidade de LLMs'], 'partial', {
      detail: [
        'Generations by model with tokens, reported cost, latency, errors and traces, from PostHog event names. No SDK wrappers or evaluations',
        'Generaciones por modelo con tokens, costo informado, latencia, errores y trazas, con los nombres de eventos de PostHog. Sin wrappers de SDK ni evaluaciones',
        'Gerações por modelo com tokens, custo informado, latência, erros e traces, com os nomes de eventos do PostHog. Sem wrappers de SDK nem avaliações',
      ],
    }),
    // Lo que PostHog no confirma en su documentación no cuenta ni se publica (queda en docs/benchmark/analytics.md).
    ...(benchmark.rows as ParityRow[]).filter((r) => r.competitorHas || r.status !== 'missing'),
  ],
};

export default parity;
