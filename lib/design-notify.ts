/**
 * Design: avisos (comentarios y diseños compartidos) y la gente del
 * workspace con acceso a la app. Server-only. Los avisos llevan href a
 * /app/design/…: la lista de avisos los oculta a quien no tiene Design.
 */
import { listTeamPeople } from './workspace';
import type { SessionUser } from './session';
import type { DesignActor } from './design-access';

export async function designPeople(user: SessionUser): Promise<Array<{ userId: string; name: string; email: string }>> {
  if (!user.workspace) {
    const person = user.actingUser ?? user;
    return [{ userId: person.id, name: person.name || person.email, email: person.email }];
  }
  const people = await listTeamPeople(user.workspace, { app: 'design' }).catch(() => []);
  return people.map((p) => ({ userId: p.user_id, name: p.name || p.email, email: p.email }));
}

async function notify(userId: string, type: 'design_comment' | 'design_share', title: string, href: string, designId: string, meta: Record<string, string>) {
  try {
    const { createNotification } = await import('./notifications');
    await createNotification({ userId, type, title, href, sourceType: 'design', sourceId: designId, meta });
  } catch {
    /* el aviso no corta el comentario ni el cambio de acceso */
  }
}

export async function notifyDesignShared(actor: DesignActor, designId: string, name: string, userIds: string[]): Promise<void> {
  for (const uid of userIds) {
    if (uid === actor.personId) continue;
    await notify(uid, 'design_share', `${actor.name} shared ${name} with you`, `/app/design/${designId}`, designId, { actorName: actor.name, title: name, kind: 'share' });
  }
}

export async function notifyDesignComment(actor: DesignActor, designId: string, name: string, commentId: string, userIds: string[], body: string): Promise<void> {
  for (const uid of userIds) {
    await notify(uid, 'design_comment', `${actor.name} commented on ${name}`, `/app/design/${designId}?comment=${commentId}`, designId, {
      actorName: actor.name,
      title: name,
      kind: 'comment',
      excerpt: body.slice(0, 140),
    });
  }
}
