import { Button } from './button';

interface BulkToolbarProps {
  selectedCount: number;
  scopeLabel: string;
  pending: boolean;
  actions: Array<{ label: string; onClick: () => void; disabled?: boolean; variant?: 'default' | 'outline' | 'destructive' }>;
  onClear?: () => void;
}

export function BulkToolbar({ selectedCount, scopeLabel, pending, actions, onClear }: BulkToolbarProps) {
  if (!selectedCount) return null;
  return <div role="region" aria-label="Bulk actions" aria-busy={pending} className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-background py-3">
    <p role="status" aria-atomic="true" className="min-w-0 flex-1 text-sm"><span className="font-mono">{selectedCount}</span> selected · {scopeLabel}</p>
    <div className="flex flex-wrap items-center gap-2">
      {actions.map(action => <Button key={action.label} variant={action.variant ?? 'outline'} disabled={pending || action.disabled} onClick={action.onClick}>{action.label}</Button>)}
      {onClear && <Button variant="ghost" disabled={pending} onClick={onClear}>Clear selection</Button>}
    </div>
  </div>;
}
