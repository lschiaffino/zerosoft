import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-24-lines-invite-permission',
  date: '2026-11-24',
  title: {
    en: 'A teammate can invite people to Lines without being an admin',
    es: 'Una persona del equipo puede invitar gente a Lines sin ser admin',
    pt: 'Uma pessoa da equipe pode convidar gente para o Lines sem ser admin',
  },
  items: [
    {
      product: 'groups',
      en: 'In Settings › Members and permissions, an admin can give a member "Can invite to Lines". That person invites by email or link from the new Invite tab in Lines settings, and whoever they invite joins as a member with access to Lines only: they cannot invite admins, give other apps, add people to teams, or see and change other members. Members without the permission see the Invite tab disabled, with a note to ask an admin. Every invitation and every change of the permission goes in the audit log.',
      es: 'En Ajustes › Miembros y permisos, un admin puede darle a un member "Puede invitar a Lines". Esa persona invita por email o con link desde la nueva pestaña Invitar de los ajustes de Lines, y quien invite entra como member con acceso solo a Lines: no puede invitar admins, dar otras apps, sumar gente a equipos ni ver o cambiar a otros miembros. Los members sin el permiso ven la pestaña Invitar apagada, con un aviso para pedirle a un admin. Cada invitación y cada cambio del permiso queda en el registro de cambios.',
      pt: 'Em Ajustes › Membros e permissões, um admin pode dar a um member "Pode convidar para o Lines". Essa pessoa convida por email ou link na nova aba Convidar dos ajustes do Lines, e quem ela convidar entra como member com acesso só ao Lines: não pode convidar admins, dar outros apps, colocar pessoas em equipes nem ver e mudar outros membros. Members sem a permissão veem a aba Convidar desativada, com um aviso para pedir a um admin. Cada convite e cada mudança da permissão ficam no registro de alterações.',
    },
  ],
} satisfies ChangelogEntry;
