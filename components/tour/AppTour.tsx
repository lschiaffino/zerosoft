import { getCurrentUser } from '@/lib/session';
import type { TourKey } from '@/lib/tours';
import { tourBoot } from '@/lib/tours/server';
import TourHost from './TourHost';
import '@/styles/tour.css';

/**
 * El tour guiado de una app (lib/tours): va en el layout de la app, una vez.
 * Lee el estado de la persona y si es equipo o persona sola, y monta el motor.
 *
 *   <AppTour tour="lines" />
 */
export default async function AppTour({ tour }: { tour: TourKey }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const boot = await tourBoot(user, tour).catch(() => null);
  if (!boot) return null;
  return <TourHost boot={boot} />;
}
