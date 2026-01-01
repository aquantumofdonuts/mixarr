'use client';

import { Music, Plus, Check, CheckSquare, Square, Loader2 } from 'lucide-react';
import { Card, Badge, Button } from '@/components/ui';
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
  onSelect?: () => void;
  isSelected?: boolean;
  isAdding?: boolean;
  showCheckbox?: boolean;
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
  onSelect,
  isSelected = false,
  isAdding = false,
  showCheckbox = true,
}: ArtistCardProps) {
  const hasMbid = foreignArtistId || mbid;
  
  // Build external links
  const externalLinks = [];
  
  if (spotifyId) {
    externalLinks.push({
      name: 'Spotify',
      url: `https://open.spotify.com/artist/${spotifyId}`,
      icon: SpotifyIcon,
      color: 'text-green-500 hover:text-green-400',
    });
  }
  
  if (hasMbid) {
    externalLinks.push({
      name: 'Last.fm',
      url: `https://www.last.fm/music/${encodeURIComponent(artistName)}`,
      icon: LastfmIcon,
      color: 'text-red-500 hover:text-red-400',
    });
    externalLinks.push({
      name: 'MusicBrainz',
      url: `https://musicbrainz.org/artist/${hasMbid}`,
      icon: MusicBrainzIcon,
      color: 'text-orange-500 hover:text-orange-400',
    });
  }

  return (
    <Card className="overflow-hidden group">
      <div className="flex">
        {/* Checkbox column */}
        {showCheckbox && !inLibrary && hasMbid && onSelect && (
          <button 
            onClick={onSelect} 
            className="p-2 flex items-center justify-center hover:bg-muted transition-colors"
          >
            {isSelected ? (
              <CheckSquare className="h-5 w-5 text-primary" />
            ) : (
              <Square className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        )}
        
        {/* Thumbnail - standardized size matching Discover page */}
        <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
          {imageUrl ? (
            <img 
              src={imageUrl} 
              alt={artistName} 
              className="w-full h-full object-cover" 
              loading="lazy"
            />
          ) : (
            <Music className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        
        {/* Content */}
        <div className="flex-1 p-3 min-w-0 flex flex-col">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold truncate text-sm sm:text-base">{artistName}</h3>
              
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
            
            {/* Add button / In Library badge */}
            {inLibrary ? (
              <Badge variant="success" className="flex-shrink-0 text-xs">
                <Check className="h-3 w-3 mr-1" /> In Lidarr
              </Badge>
            ) : onAdd ? (
              <Button 
                size="sm" 
                onClick={onAdd} 
                disabled={isAdding} 
                className="flex-shrink-0 text-xs h-7"
              >
                {isAdding ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            ) : null}
          </div>
          
          {/* Stats row */}
          {(popularity || followers || fans || listeners) && (
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
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
                <span>{listeners.toLocaleString()} listeners</span>
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
    </Card>
  );
}
