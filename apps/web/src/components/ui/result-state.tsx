import type { ReactNode } from 'react';
import { EmptyState } from './empty-state';

type ResultKind = 'not-searched' | 'no-matches' | 'no-records' | 'error' | 'partial-results';
interface ResultStateProps { kind: ResultKind; message?: string; action?: ReactNode }
const titles: Record<ResultKind, string> = {
  'not-searched': 'Start a search', 'no-matches': 'No matches', 'no-records': 'No records yet',
  error: 'Results unavailable', 'partial-results': 'Some results are unavailable',
};

export function ResultState({ kind, message, action }: ResultStateProps) {
  const incomplete = kind === 'error' || kind === 'partial-results';
  return <section role={kind === 'error' ? 'alert' : 'status'} aria-atomic="true" aria-label={titles[kind]} className="min-w-0">
    {incomplete ? <div className="border-y py-3">
      <p className="font-semibold">{titles[kind]}</p>
      {message && <p className="mt-1 break-words text-sm text-muted-foreground">{message}</p>}
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </div> : <>
      <EmptyState title={titles[kind]} description={message} className="py-6" />
      {action && <div className="mb-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </>}
  </section>;
}
