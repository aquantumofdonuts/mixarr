'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface YearReleaseGroup {
  id: string;
  title: string;
  'artist-credit'?: Array<{ artist: { id: string; name: string } }>;
  'primary-type'?: string;
  'first-release-date'?: string;
}

export interface YearSearchProps {
  results: YearReleaseGroup[];
}

/**
 * Renders the year-based release group search results grid.
 * Simplest search results component — just cards with title, artist, type, and date.
 * Pagination is handled by the parent page.
 */
export function YearSearch({ results }: YearSearchProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((rg, i) => (
        <Card key={`${rg.id}-${i}`} className="p-4">
          <h3 className="font-semibold truncate">{rg.title}</h3>
          {rg['artist-credit']?.[0]?.artist && (
            <p className="text-sm text-muted-foreground truncate">
              {rg['artist-credit'][0].artist.name}
            </p>
          )}
          <div className="flex gap-2 mt-1">
            {rg['primary-type'] && (
              <Badge variant="outline" className="text-xs">
                {rg['primary-type']}
              </Badge>
            )}
            {rg['first-release-date'] && (
              <span className="text-xs text-muted-foreground">
                {rg['first-release-date']}
              </span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
