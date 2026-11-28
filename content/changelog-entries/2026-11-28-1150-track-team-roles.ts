import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-track-team-roles',
  date: '2026-11-28',
  title: {
    en: 'Track: team owners',
    es: 'Track: dueños de equipo',
    pt: 'Track: donos de equipe',
  },
  items: [
    {
      product: 'track',
      en: 'Teams have owners, as in Linear. Whoever creates a team is its owner, and owners name other owners in Team settings › Members. A team owner manages that team without being a workspace admin: members of a private team, its name, identifier and workflow statuses, labels, templates, triage, automatic cycles, auto-close and auto-archive, GitHub rules and Slack channels. Other members see these settings but can’t change them, unless an owner opens an area (settings, labels, templates or members) to any member. Owning one team gives nothing over another team, and workspace settings (access, guests, connecting GitHub, Slack and other integrations, API and agents) stay with workspace admins. Teams created before this have no owners: workspace admins manage them until they name one. Guests can’t be owners.',
      es: 'Los equipos tienen dueños, como en Linear. Quien crea un equipo es su dueño, y los dueños nombran a otros en Ajustes del equipo › Miembros. Un dueño maneja su equipo sin ser admin del workspace: los miembros de un equipo privado, el nombre, el identificador y los estados del workflow, los labels, las plantillas, el triage, los cycles automáticos, el auto-cierre y el auto-archivo, las reglas de GitHub y los canales de Slack. Los demás miembros ven esos ajustes pero no los cambian, salvo que un dueño abra un área (ajustes, labels, plantillas o miembros) a cualquier miembro. Ser dueño de un equipo no da nada sobre otro, y los ajustes del workspace (acceso, invitados, conectar GitHub, Slack y otras integraciones, API y agentes) siguen siendo de los admins. Los equipos de antes no tienen dueños: los manejan los admins del workspace hasta que nombren uno. Un invitado no puede ser dueño.',
      pt: 'As equipes têm donos, como no Linear. Quem cria uma equipe é o dono, e os donos nomeiam outros em Ajustes da equipe › Membros. Um dono gerencia a sua equipe sem ser admin do workspace: os membros de uma equipe privada, o nome, o identificador e os status do workflow, as etiquetas, os templates, o triage, os cycles automáticos, o fechamento e o arquivamento automáticos, as regras do GitHub e os canais do Slack. Os outros membros veem esses ajustes mas não os mudam, a menos que um dono abra uma área (ajustes, etiquetas, templates ou membros) para qualquer membro. Ser dono de uma equipe não dá nada sobre outra, e os ajustes do workspace (acesso, convidados, conectar GitHub, Slack e outras integrações, API e agentes) continuam com os admins. As equipes de antes não têm donos: os admins do workspace as gerenciam até nomearem um. Um convidado não pode ser dono.',
    },
  ],
} satisfies ChangelogEntry;
