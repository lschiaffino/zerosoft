import type { ReactNode } from 'react';
import '@/styles/pages.css';
import '@/styles/changelog.css';
import '@/styles/board-public.css';

export const dynamic = 'force-dynamic';

/**
 * Board público (feedback.zerosoft.ai o /<locale>/feedback-board). El chrome
 * propio lo pone cada página (BoardChrome) para marcar la sección activa;
 * .bp-root apaga el header y footer de marketing (board-public.css).
 */
export default function FeedbackBoardLayout({ children }: { children: ReactNode }) {
  return <div className="bp-root">{children}</div>;
}
