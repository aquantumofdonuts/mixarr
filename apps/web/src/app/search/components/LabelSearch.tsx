'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LabelResult } from '../hooks/useSearch';

export interface LabelSearchProps {
  results: LabelResult[];
  onViewArtists: (label: LabelResult) => void;
}

/**
 * Renders the label search results grid.
 * Each card shows label name, type, country and a "View Artists" button
 * that opens the LabelArtistsModal (via the parent).
 * Pagination is handled by the parent page.
 */
export function LabelSearch({ results, onViewArtists }: LabelSearchProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((label, i) => (
        <Card key={`${label.id}-${i}`} className="p-4">
          <h3 className="font-semibold truncate">{label.name}</h3>
          <div className="flex gap-2 mt-1">
            {label.type && (
              <Badge variant="outline" className="text-xs">
                {label.type}
              </Badge>
            )}
            {label.country && (
              <Badge variant="outline" className="text-xs">
                {label.country}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => onViewArtists(label)}
          >
            View Artists
          </Button>
        </Card>
      ))}
    </div>
  );
}
