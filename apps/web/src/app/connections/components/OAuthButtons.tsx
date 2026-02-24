'use client';

import { ExternalLink, Search, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOAuthStatus, type OAuthType } from '../hooks/useOAuthStatus';

/** Brand colours used for the authorize button per service. */
const BRAND_STYLES: Record<OAuthType, string> = {
  spotify: 'bg-[#1DB954] hover:bg-[#1ed760]',
  deezer: 'bg-[#FEAA2D] hover:bg-[#FFB84D] text-black',
  tidal: 'bg-[#00FFFF] hover:bg-[#33FFFF] text-black',
};

/** Human-readable label per service. */
const LABELS: Record<OAuthType, string> = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  tidal: 'TIDAL',
};

export interface OAuthButtonsProps {
  type: OAuthType;
  connectionId: number;
  onPreview?: (connectionId: number, type: string) => void;
}

/**
 * Renders OAuth authorize / revoke / preview buttons for a single connection.
 *
 * When the user is **not** authorized (or needs re-authorization) an
 * "Authorize <Service>" button is shown. Once authorized, a status badge
 * plus "Revoke" (and optionally "Preview" for Spotify) are displayed.
 */
export function OAuthButtons({ type, connectionId, onPreview }: OAuthButtonsProps) {
  const { status, authorize, revoke, isLoading, error } = useOAuthStatus(type, connectionId);

  const needsAuth = !status?.authorized || status.needsReauthorization;
  const label = LABELS[type];

  return (
    <div className="flex items-center gap-2" data-testid={`oauth-buttons-${type}`}>
      {needsAuth ? (
        <Button
          size="sm"
          onClick={authorize}
          isLoading={isLoading}
          className={BRAND_STYLES[type]}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          {status?.expired ? `Re-authorize ${label}` : `Authorize ${label}`}
        </Button>
      ) : (
        <>
          <Badge variant="default" className="text-xs bg-green-600">
            Authorized
          </Badge>

          {type === 'spotify' && onPreview && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPreview(connectionId, type)}
            >
              <Search className="h-3 w-3 mr-1" />
              Preview
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={revoke}
            isLoading={isLoading}
          >
            <Unlink className="h-3 w-3 mr-1" />
            Revoke
          </Button>
        </>
      )}

      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error.message}
        </span>
      )}
    </div>
  );
}
