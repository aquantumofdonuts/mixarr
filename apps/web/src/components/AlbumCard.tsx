'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { ArtistLink } from '@/components/artists/ArtistLink';
import { useId } from 'react';
import Disc from 'lucide-react/dist/esm/icons/disc';
import Plus from 'lucide-react/dist/esm/icons/plus';
import { MusicBrainzIcon } from '@/components/ExternalLinks';
import { cn } from '@/lib/utils';

interface AlbumCardProps {
  id: string;
  title: string;
  artistId?: string;
  artistName?: string;
  date?: string;
  onAddArtist?: (artistId: string, artistName: string) => void;
  className?: string;
  pending?: boolean;
  confirmed?: boolean;
  error?: string;
  disabled?: boolean;
  onOpen?: (trigger: HTMLElement) => void;
}

/**
 * Album card component with lazy-loaded cover art from Cover Art Archive
 */
export function AlbumCard({
  id,
  title,
  artistId,
  artistName,
  date,
  onAddArtist,
  className,
  pending = false, confirmed = false, error, disabled = false, onOpen,
}: AlbumCardProps) {
  const descriptionId = useId();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Cover Art Archive URL for the release
  const coverUrl = `https://coverartarchive.org/release/${id}/front-250`;

  return (
    <article className={cn('py-3', className)}>
      <div className="flex flex-wrap gap-3">
        {/* Album cover with lazy loading */}
        <ArtistLink mbid={artistId} aria-label={`Inspect artist ${artistName || "Unidentified artist"}`} onOpen={onOpen} className="relative flex-shrink-0 w-12 h-12 overflow-hidden bg-muted">
          {!imageError && (
            <Image
              src={coverUrl}
              alt={title}
              fill
              sizes="48px"
              className={cn(
                'object-cover transition-opacity duration-200',
                imageLoaded ? 'opacity-100' : 'opacity-0'
              )}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          )}
          {/* Fallback icon - show when loading or error */}
          {(!imageLoaded || imageError) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Disc className="h-6 w-6 sm:h-7 sm:w-7 text-muted-foreground" />
            </div>
          )}
        </ArtistLink>

        {/* Album info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{title}</h3>

          {artistName && (
            <p className="text-sm text-muted-foreground"><ArtistLink mbid={artistId} onOpen={onOpen}>{artistName}</ArtistLink></p>
          )}

          {date && (
            <p className="text-xs text-muted-foreground mt-0.5">{date}</p>
          )}

          {error && <p role="alert" className="mt-1 text-sm break-words">{error}</p>}
          {confirmed && <p className="text-sm">In Lidarr</p>}
          {/* External links */}
          <div className="flex items-center gap-1 mt-2">
            <a
              href={`https://musicbrainz.org/release/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-link transition-colors"
              title="Open album on MusicBrainz" aria-label={`Open ${title} on MusicBrainz`}
            >
              <MusicBrainzIcon className="h-3.5 w-3.5" />
            </a>

            {artistId && (
              <a
                href={`https://musicbrainz.org/artist/${artistId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-link transition-colors"
                title="Open artist on MusicBrainz" aria-label={`Open ${artistName} on MusicBrainz`}
              >
                <MusicBrainzIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Add artist button */}
        {artistId && artistName && onAddArtist && (
          <div className="flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAddArtist(artistId, artistName)}
              disabled={pending || confirmed || disabled}
              aria-label={`Add artist ${artistName}`}
              aria-describedby={descriptionId}
            >
              <Plus className="h-4 w-4" /> {pending ? 'Adding artist…' : 'Add artist'}
            </Button>
          </div>
        )}
      </div>
      <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">Adds this artist to Lidarr. Lidarr applies its configured album monitoring and search settings.</p>
    </article>
  );
}
