'use client';

import { cn } from '@/lib/utils';

// External service icons (simple SVG components)
export const SpotifyIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

export const LastfmIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.932-1.457-4.59-3.464l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/>
  </svg>
);

export const MusicBrainzIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2.182c5.424 0 9.818 4.394 9.818 9.818 0 5.424-4.394 9.818-9.818 9.818-5.424 0-9.818-4.394-9.818-9.818 0-5.424 4.394-9.818 9.818-9.818zm0 1.636c-4.519 0-8.182 3.663-8.182 8.182 0 4.519 3.663 8.182 8.182 8.182 4.519 0 8.182-3.663 8.182-8.182 0-4.519-3.663-8.182-8.182-8.182z"/>
  </svg>
);

export interface ExternalLinksProps {
  artistName: string;
  spotifyId?: string | null;
  mbid?: string | null;
  lastfmUrl?: string | null;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * External links component for artist cards
 * Shows Spotify, Last.fm, and MusicBrainz icons with links
 */
export function ExternalLinks({
  artistName,
  spotifyId,
  mbid,
  lastfmUrl,
  className,
  size = 'sm',
}: ExternalLinksProps) {
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const padding = size === 'sm' ? 'p-1' : 'p-1.5';
  
  const links = [];
  
  if (spotifyId) {
    links.push({
      name: 'Spotify',
      url: `https://open.spotify.com/artist/${spotifyId}`,
      icon: SpotifyIcon,
      color: 'text-green-500 hover:text-green-400',
    });
  }
  
  // Last.fm link - use provided URL or construct from artist name
  if (lastfmUrl || artistName) {
    links.push({
      name: 'Last.fm',
      url: lastfmUrl || `https://www.last.fm/music/${encodeURIComponent(artistName)}`,
      icon: LastfmIcon,
      color: 'text-red-500 hover:text-red-400',
    });
  }
  
  if (mbid) {
    links.push({
      name: 'MusicBrainz',
      url: `https://musicbrainz.org/artist/${mbid}`,
      icon: MusicBrainzIcon,
      color: 'text-orange-500 hover:text-orange-400',
    });
  }
  
  if (links.length === 0) return null;
  
  return (
    <div className={cn("flex gap-0.5", className)}>
      {links.map((link) => (
        <a
          key={link.name}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open on ${link.name}`}
          className={cn(
            padding,
            "rounded hover:bg-muted transition-colors",
            link.color
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <link.icon className={iconSize} />
        </a>
      ))}
    </div>
  );
}

/**
 * Standard thumbnail component for artist images
 * Use this for consistent sizing across the app
 * Reference: Discover page recommendations
 */
export interface ArtistThumbnailProps {
  imageUrl?: string | null;
  artistName: string;
  className?: string;
}

export function ArtistThumbnail({ imageUrl, artistName, className }: ArtistThumbnailProps) {
  return (
    <div className={cn(
      "flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-muted flex items-center justify-center",
      className
    )}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={artistName}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
      )}
    </div>
  );
}
