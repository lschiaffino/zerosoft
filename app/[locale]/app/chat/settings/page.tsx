import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function ChatSettingsPage() {
  redirect('/app/chat');
}
