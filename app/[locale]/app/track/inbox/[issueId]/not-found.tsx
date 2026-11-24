import InboxPaneMissing from '@/components/track/InboxPaneMissing';

/** El issue no existe o no es del workspace activo: el aviso queda en la lista y el panel lo dice. */
export default function InboxIssueNotFound() {
  return <InboxPaneMissing />;
}
