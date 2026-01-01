'use client';

import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { Plus, Disc } from 'lucide-react';
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
}: AlbumCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  // Cover Art Archive URL for the release
  const coverUrl = `https://coverartarchive.org/release/${id}/front-250`;
  
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex gap-4">
        {/* Album cover with lazy loading */}
        <div className="relative flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-muted">
          {!imageError && (
            <img
              src={coverUrl}
              alt={title}
              loading="lazy"
              className={cn(
                'w-full h-full object-cover transition-opacity duration-200',
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
        </div>
        
        {/* Album info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{title}</h3>
          
          {artistName && (
            <p className="text-sm text-muted-foreground truncate">{artistName}</p>
          )}
          
          {date && (
            <p className="text-xs text-muted-foreground mt-0.5">{date}</p>
          )}
          
          {/* External links */}
          <div className="flex items-center gap-1 mt-2">
            <a
              href={`https://musicbrainz.org/release/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-muted text-orange-500 hover:text-orange-400 transition-colors"
              title="Open album on MusicBrainz"
            >
              <MusicBrainzIcon className="h-3.5 w-3.5" />
            </a>
            
            {artistId && (
              <a
                href={`https://musicbrainz.org/artist/${artistId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-muted text-orange-500/60 hover:text-orange-400 transition-colors"
                title="Open artist on MusicBrainz"
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
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
