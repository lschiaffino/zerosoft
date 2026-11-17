'use client';

import { useHubspotSchema } from './hubspot-client';
import { setHubspotPanelPinned, useHubspotDocked } from './hubspot-dock';
import HubspotScreen, { type HubspotSource } from './HubspotScreen';

/**
 * El panel de HubSpot fijado al costado del chat abierto (Lines o Inbox). Lo
 * pone la vista del chat una sola vez; sin HubSpot conectado, en una pantalla
 * angosta o sin fijar, no muestra nada. Cerrarlo lo desfija.
 */
export default function HubspotDock({ source, isAdmin }: { source: HubspotSource; isAdmin: boolean }) {
  const docked = useHubspotDocked();
  const { schema } = useHubspotSchema(docked);
  if (!docked || !schema?.connected) return null;
  return <HubspotScreen source={source} open={false} docked isAdmin={isAdmin} onClose={() => setHubspotPanelPinned(false)} />;
}
