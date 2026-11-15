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
 * Fleet contra lo que se mira hoy en GitHub y en Vercel (los paneles de cada uno, de a una cuenta). Lo que esos
 * paneles hacen y Fleet no (comentar, mergear, redeployar) va como missing; lo que solo hace Fleet (los agentes
 * locales, el chat con ellos, varias cuentas juntas) como better con competitorHas: false. Revisado contra el
 * código de main el 2026-11-15.
 */
const parity: ProductParity = {
  competitor: 'GitHub · Vercel',
  lastReviewed: '2026-11-15',
  areas: [
    { id: 'github', label: loc(['GitHub', 'GitHub', 'GitHub']) },
    { id: 'vercel', label: loc(['Vercel', 'Vercel', 'Vercel']) },
    { id: 'agents', label: loc(['Local agents', 'Agentes locales', 'Agentes locais']) },
    { id: 'platform', label: loc(['Board and platform', 'Tablero y plataforma', 'Painel e plataforma']) },
  ],
  rows: [
    // GitHub
    row('open-prs', 'github', ['Open pull requests with author and branch', 'Pull requests abiertos con autor y rama', 'Pull requests abertos com autor e branch'], 'have', { weight: 2 }),
    row('checks', 'github', ['Checks status of each pull request', 'Estado de los checks de cada pull request', 'Status dos checks de cada pull request'], 'have', {
      weight: 2,
      detail: ['The combined status of the last commit. Individual check names and logs are not shown', 'El estado combinado del último commit. No muestra cada check ni sus logs', 'O status combinado do último commit. Não mostra cada check nem os logs'],
    }),
    row('auto-merge', 'github', ['Auto-merge and mergeable state', 'Auto-merge y si se puede mergear', 'Auto-merge e se dá para mergear'], 'have'),
    row('workflow-runs', 'github', ['Recent workflow runs', 'Últimas corridas de workflows', 'Últimas execuções de workflows'], 'partial', {
      detail: ['The last 10 runs per repository, without logs or jobs', 'Las últimas 10 corridas por repositorio, sin logs ni jobs', 'As últimas 10 execuções por repositório, sem logs nem jobs'],
    }),
    row('releases', 'github', ['Releases', 'Releases', 'Releases'], 'partial', { detail: ['The last 5 per repository', 'Los últimos 5 por repositorio', 'Os últimos 5 por repositório'] }),
    row('pr-actions', 'github', ['Review, comment, merge or close from the app', 'Revisar, comentar, mergear o cerrar desde la app', 'Revisar, comentar, mergear ou fechar pelo app'], 'missing', { weight: 2 }),
    row('webhooks-live', 'github', ['Instant updates from GitHub', 'Cambios al instante desde GitHub', 'Mudanças na hora vindas do GitHub'], 'partial', {
      detail: ['Every 5 minutes and on Refresh. No GitHub webhooks yet', 'Cada 5 minutos y con Actualizar. Todavía sin webhooks de GitHub', 'A cada 5 minutos e com Atualizar. Ainda sem webhooks do GitHub'],
    }),
    row('multi-github', 'github', ['Several accounts and organizations together', 'Varias cuentas y organizaciones juntas', 'Várias contas e organizações juntas'], 'better', { competitorHas: false }),

    // Vercel
    row('deploys', 'vercel', ['Deploys with state, branch, commit and pull request', 'Deploys con estado, rama, commit y pull request', 'Deploys com estado, branch, commit e pull request'], 'have', { weight: 2 }),
    row('production', 'vercel', ['Which deploy serves production', 'Qué deploy sirve producción', 'Qual deploy serve produção'], 'have'),
    row('build-logs', 'vercel', ['Build logs', 'Logs del build', 'Logs do build'], 'missing'),
    row('redeploy', 'vercel', ['Redeploy, promote or roll back', 'Redeployar, promover o volver atrás', 'Refazer o deploy, promover ou voltar'], 'missing'),
    row('multi-vercel', 'vercel', ['Several accounts and teams together', 'Varias cuentas y equipos juntos', 'Várias contas e times juntos'], 'better', { competitorHas: false }),

    // Agentes locales
    row('claude-code', 'agents', ['Claude Code sessions with live status', 'Sesiones de Claude Code con estado en vivo', 'Sessões do Claude Code com status ao vivo'], 'better', {
      competitorHas: false,
      detail: ['Through a hook installed with one command, also inside Orca', 'Con un hook que se instala con un comando, también dentro de Orca', 'Com um hook instalado com um comando, também dentro do Orca'],
    }),
    row('chat', 'agents', ['Answer an agent from a chat', 'Responder a un agente desde un chat', 'Responder a um agente em uma conversa'], 'better', {
      competitorHas: false,
      detail: ['Delivered by the Stop hook when the agent stops, or with the next prompt', 'Lo entrega el Stop hook cuando el agente se detiene, o con el próximo prompt', 'Entregue pelo Stop hook quando o agente para, ou com o próximo prompt'],
    }),
    row('whatsapp', 'agents', ['WhatsApp message to yourself, and reply from it', 'WhatsApp a vos mismo, y responder desde ahí', 'WhatsApp para você mesmo, e responder por ele'], 'better', {
      competitorHas: false,
      detail: ['Through the WhatsApp you connected in Inbox', 'Con el WhatsApp que conectaste en Inbox', 'Com o WhatsApp que você conectou no Inbox'],
    }),
    row('other-agents', 'agents', ['Other agents (Codex, Cursor, cloud routines)', 'Otros agentes (Codex, Cursor, rutinas en la nube)', 'Outros agentes (Codex, Cursor, rotinas na nuvem)'], 'missing', { competitorHas: false }),

    // Tablero
    row('board', 'platform', ['A board of everything in progress', 'Un tablero de todo lo que está en curso', 'Um painel de tudo o que está em andamento'], 'better', { competitorHas: false }),
    row('notifications', 'platform', ['Notifications', 'Avisos', 'Avisos'], 'partial', {
      detail: ['WhatsApp to yourself. No email or push yet', 'WhatsApp a vos mismo. Todavía sin email ni push', 'WhatsApp para você mesmo. Ainda sem email nem push'],
    }),
    row('self-host', 'platform', ['Run it on your own server', 'Correrlo en tu servidor', 'Rodar no seu servidor'], 'better', { competitorHas: false }),
  ],
};

export default parity;
