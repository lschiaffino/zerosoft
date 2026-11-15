import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-fleet',
  date: '2026-11-15',
  title: {
    en: 'New app, Fleet: one board for your coding agents, pull requests and deploys',
    es: 'App nueva, Fleet: un tablero para tus agentes de código, pull requests y deploys',
    pt: 'App novo, Fleet: um painel para seus agentes de código, pull requests e deploys',
  },
  items: [
    {
      product: 'fleet',
      en: 'Fleet shows every Claude Code session on your computers as a card with its status (working, waiting for you, done or failed), the last thing it said, its folder and branch, and the pull request and deploy of that branch. You install it with one command that adds a hook to Claude Code and keeps your other hooks, Orca\'s included. Inside Orca, sessions also carry the pane and worktree. The hook sends the event, the session id, the folder name, the branch, and your prompt and the agent\'s last message cut short with common secrets removed. Never your files or full paths.',
      es: 'Fleet muestra cada sesión de Claude Code de tus computadoras como una tarjeta con su estado (trabajando, te espera, lista o con error), lo último que dijo, su carpeta y rama, y el pull request y el deploy de esa rama. Se instala con un comando que agrega un hook a Claude Code y deja tus otros hooks, los de Orca incluidos. Dentro de Orca, las sesiones también llevan el panel y el worktree. El hook manda el evento, el id de la sesión, el nombre de la carpeta, la rama, y tu prompt y el último mensaje del agente recortados y sin los secretos comunes. Nunca tus archivos ni rutas completas.',
      pt: 'O Fleet mostra cada sessão do Claude Code dos seus computadores como um cartão com o status (trabalhando, esperando você, pronto ou com erro), a última coisa que disse, a pasta e o branch, e o pull request e o deploy desse branch. Ele é instalado com um comando que adiciona um hook ao Claude Code e mantém seus outros hooks, inclusive os do Orca. Dentro do Orca, as sessões também levam o painel e o worktree. O hook envia o evento, o id da sessão, o nome da pasta, o branch, e seu prompt e a última mensagem do agente cortados e sem os segredos comuns. Nunca seus arquivos nem caminhos completos.',
    },
    {
      product: 'fleet',
      en: 'Connect several GitHub accounts and organizations with read-only tokens, and several Vercel accounts and teams. Fleet lists open pull requests with their checks, auto-merge and conflicts, recent workflow runs and releases, and Vercel deploys with their state, branch, commit and the one serving production. It refreshes every 5 minutes and when you press Refresh, and never writes to GitHub or Vercel.',
      es: 'Conectá varias cuentas y organizaciones de GitHub con tokens de solo lectura, y varias cuentas y equipos de Vercel. Fleet lista los pull requests abiertos con sus checks, auto-merge y conflictos, las últimas corridas de workflows y releases, y los deploys de Vercel con su estado, rama, commit y el que sirve producción. Se actualiza cada 5 minutos y cuando tocás Actualizar, y nunca escribe en GitHub ni en Vercel.',
      pt: 'Conecte várias contas e organizações do GitHub com tokens só de leitura, e várias contas e times da Vercel. O Fleet lista os pull requests abertos com checks, auto-merge e conflitos, as últimas execuções de workflows e releases, e os deploys da Vercel com estado, branch, commit e o que serve produção. Ele atualiza a cada 5 minutos e quando você toca em Atualizar, e nunca escreve no GitHub nem na Vercel.',
    },
    {
      product: 'fleet',
      en: 'The Now page counts agents working, agents waiting for you, open pull requests, failing checks and deploys in progress, and updates live as events arrive.',
      es: 'La página Ahora cuenta los agentes trabajando, los que te esperan, los pull requests abiertos, los checks en rojo y los deploys en curso, y se actualiza en vivo a medida que llegan los eventos.',
      pt: 'A página Agora conta os agentes trabalhando, os que esperam você, os pull requests abertos, os checks falhando e os deploys em andamento, e atualiza ao vivo conforme os eventos chegam.',
    },
  ],
} satisfies ChangelogEntry;
