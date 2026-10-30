'use client';

import Image from 'next/image';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music from 'lucide-react/dist/esm/icons/music';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';
import { ArtistLink } from '@/components/artists/ArtistLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GenrePills } from '@/components/GenrePills';
import { SpotifyIcon, LastfmIcon, MusicBrainzIcon } from '@/components/ExternalLinks';
import { cn } from '@/lib/utils';

export interface ArtistCardProps {
  artistName: string;
  foreignArtistId?: string;
  imageUrl?: string;
  sources?: string[];
  inLibrary?: boolean;
  genres?: string[];
  popularity?: number;
  followers?: number;
  fans?: number;
  listeners?: number;
  // External IDs for links
  spotifyId?: string;
  mbid?: string; // MusicBrainz ID (same as foreignArtistId usually)
  // Actions
  onAdd?: () => void;
  onSearchSlskd?: () => void;
  onSelect?: () => void;
  isSelected?: boolean;
  isAdding?: boolean;
  showCheckbox?: boolean;
  disabled?: boolean;
  acquisitionError?: string;
  onOpen?: (trigger: HTMLElement) => void;
}

export function ArtistCard({
  artistName,
  foreignArtistId,
  imageUrl,
  sources = [],
  inLibrary = false,
  genres = [],
  popularity,
  followers,
  fans,
  listeners,
  spotifyId,
  mbid,
  onAdd,
  onSearchSlskd,
  onSelect,
  isSelected = false,
  isAdding = false,
  showCheckbox = true,
  disabled = false,
  acquisitionError,
  onOpen,
}: ArtistCardProps) {
  const hasMbid = foreignArtistId || mbid;

  // Build external links
  const externalLinks = [];

  if (spotifyId) {
    externalLinks.push({
      name: 'Spotify',
      url: `https://open.spotify.com/artist/${spotifyId}`,
      icon: SpotifyIcon,
      color: 'text-muted-foreground hover:text-link',
    });
  }

  if (hasMbid) {
    externalLinks.push({
      name: 'Last.fm',
      url: `https://www.last.fm/music/${encodeURIComponent(artistName)}`,
      icon: LastfmIcon,
      color: 'text-muted-foreground hover:text-link',
    });
    externalLinks.push({
      name: 'MusicBrainz',
      url: `https://musicbrainz.org/artist/${hasMbid}`,
      icon: MusicBrainzIcon,
      color: 'text-muted-foreground hover:text-link',
    });
  }

  return (
    <article className="py-3">
      <div className="flex">
        {/* Checkbox column */}
        {showCheckbox && !inLibrary && hasMbid && onSelect && (
          <div className="flex items-center px-2"><input type="checkbox" aria-label={`Select ${artistName}`} checked={isSelected} onChange={onSelect} disabled={disabled || isAdding} className="h-4 w-4 accent-foreground" /></div>
        )}

        {/* Thumbnail - standardized size matching Discover page */}
        <ArtistLink mbid={hasMbid} aria-label={`Inspect artist ${artistName}`} onOpen={onOpen} className="relative w-12 h-12 flex-shrink-0 overflow-hidden bg-muted">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={artistName}
              fill
              sizes="48px"
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Music className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </ArtistLink>

        {/* Content */}
        <div className="flex-1 p-3 min-w-0 flex flex-col">
          {/* Header row */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm break-words"><ArtistLink mbid={hasMbid} onOpen={onOpen}>{artistName}</ArtistLink></h3>

              {/* Source badges */}
              {sources.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {sources.map((source: string) => (
                    <Badge key={source} variant="outline" className="text-xs py-0 px-1.5">
                      {source}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Genre pills */}
              {genres.length > 0 && (
                <GenrePills genres={genres} maxDisplay={3} size="sm" />
              )}
            </div>

            {/* Add button / In Library badge / Search slskd button */}
            <div className="flex gap-1 flex-shrink-0">
              {inLibrary === true ? (
                <Badge variant="success" className="text-xs">
                  <Check className="h-3 w-3 mr-1" /> In Lidarr
                </Badge>
              ) : onAdd ? (
                <Button
                  size="sm"
                  onClick={onAdd}
                  disabled={isAdding || disabled}
                  className="text-xs h-7"
                  aria-label={`Add artist ${artistName}`}
                  title="Add artist to Lidarr"
                >
                  {isAdding ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <><Plus className="h-4 w-4" /> Add artist</>
                  )}
                </Button>
              ) : null}

              {onSearchSlskd && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onSearchSlskd}
                  className="text-xs h-7"
                  aria-label={`Search Soulseek for ${artistName}`}
                  title="Search on Soulseek"
                >
                  <Search className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {acquisitionError && <p role="alert" className="mt-1 text-sm break-words">{acquisitionError}</p>}
          {/* Stats row */}
          {(popularity || followers || fans || listeners) && (
            <div className="flex gap-2 mt-1 font-mono text-xs text-muted-foreground flex-wrap">
              {popularity !== undefined && popularity > 0 && (
                <span>Pop: {popularity}</span>
              )}
              {followers !== undefined && followers > 0 && (
                <span>{(followers / 1000).toFixed(0)}K followers</span>
              )}
              {fans !== undefined && fans > 0 && (
                <span>{(fans / 1000).toFixed(0)}K fans</span>
              )}
              {listeners !== undefined && listeners > 0 && (
                <span className="tabular-nums">{listeners.toLocaleString()} listeners</span>
              )}
            </div>
          )}

          {/* External links row */}
          {externalLinks.length > 0 && (
            <div className="flex gap-1 mt-auto pt-2">
              {externalLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open on ${link.name}`}
                  aria-label={`Open ${artistName} on ${link.name}`}
                  className={cn(
                    "p-1.5 rounded hover:bg-muted transition-colors",
                    link.color
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <link.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
