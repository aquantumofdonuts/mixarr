'use client';

import { Button } from '@/components/ui/button';

export interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkAdd: () => void;
  isAdding: boolean;
}

/**
 * Renders Select All / Deselect All buttons and a bulk "Add N Selected" button.
 * Shown when there are artist/AI search results.
 */
export function BulkActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onBulkAdd,
  isAdding,
}: BulkActionBarProps) {
  if (totalCount === 0) return null;

  return (
    <div className="flex items-center gap-3 border-t pt-4">
      <Button variant="outline" size="sm" onClick={onSelectAll}>
        Select All
      </Button>
      <Button variant="outline" size="sm" onClick={onDeselectAll}>
        Deselect All
      </Button>
      {selectedCount > 0 && (
        <Button size="sm" onClick={onBulkAdd} disabled={isAdding}>
          {isAdding ? 'Adding...' : `Add ${selectedCount} Selected`}
        </Button>
      )}
    </div>
  );
}
