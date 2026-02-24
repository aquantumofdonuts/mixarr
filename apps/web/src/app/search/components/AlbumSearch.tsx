'use client';

import { AlbumCard } from '@/components/AlbumCard';
import type { AlbumResult } from '../hooks/useSearch';

export interface AlbumSearchProps {
  results: AlbumResult[];
  onAddArtist: (artistId: string, artistName: string) => Promise<void>;
}

/**
 * Renders the album search results grid.
 * Pagination is handled by the parent page.
 */
export function AlbumSearch({ results, onAddArtist }: AlbumSearchProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((album, i) => (
        <AlbumCard
          key={`${album.id}-${i}`}
          id={album.id}
          title={album.title}
          artistId={album['artist-credit']?.[0]?.artist?.id}
          artistName={album['artist-credit']?.[0]?.artist?.name}
          date={album.date}
          onAddArtist={onAddArtist}
        />
      ))}
    </div>
  );
}
