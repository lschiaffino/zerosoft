/**
 * CRM ↔ HubSpot — el control de acceso de sus rutas, en un solo lugar.
 *
 * Todo lo del sync es solo para admins del workspace (owner o admin): la
 * conexión maneja una clave de HubSpot y la vista previa muestra registros de
 * todo el workspace, que alguien con visibilidad restringida no debe ver.
 * Una persona del equipo sin ese rol recibe 403 en todas las rutas, también
 * en las de solo lectura.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from '../session';
import { forbidden, unauthorized } from '../crm-http';

export interface SyncAdmin {
  user: SessionUser;
  /** El workspace (el id de su owner: bajo ese id viven los datos). */
  ws: string;
  /** La persona que hace el pedido. */
  me: string;
}

export async function syncAdmin(): Promise<SyncAdmin | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  return { user, ws: user.id, me: realUserId(user) };
}
