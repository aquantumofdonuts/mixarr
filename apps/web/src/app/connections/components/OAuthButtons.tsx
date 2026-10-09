'use client';

import { Button } from '@/components/ui/button';
import { useOAuthStatus, type OAuthType } from '../hooks/useOAuthStatus';

const LABELS: Record<OAuthType, string> = { spotify: 'Spotify', deezer: 'Deezer', tidal: 'TIDAL' };
export interface OAuthButtonsProps {
  type: OAuthType;
  connectionId: number;
  canModify?: boolean;
  onPreview?: (connectionId: number, type: string) => void;
}

export function OAuthButtons({ type, connectionId, onPreview, canModify = true }: OAuthButtonsProps) {
  const { status, authorize, revoke, isLoading, isChecking, error, retry } = useOAuthStatus(type, connectionId);
  const label = LABELS[type];
  const authorized = status?.authorized && !status.expired && !status.needsReauthorization;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid={`oauth-buttons-${type}`}>
      <span>Authorization: {status ? (authorized ? 'Authorized' : status.expired ? 'Expired' : 'Required') : isChecking ? 'Checking…' : 'Unknown'}</span>
      {status && canModify && !authorized && <Button size="sm" variant="outline" onClick={authorize} isLoading={isLoading}>{status.expired ? `Re-authorize ${label}` : `Authorize ${label}`}</Button>}
      {authorized && <>
        {type === 'spotify' && onPreview && <Button size="sm" variant="outline" onClick={() => onPreview(connectionId, type)}>Preview</Button>}
        {canModify && <Button size="sm" variant="outline" onClick={revoke} isLoading={isLoading}>Revoke</Button>}
      </>}
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-destructive"><span>{error.message}</span><Button size="sm" variant="outline" onClick={retry} disabled={isLoading || isChecking}>Retry</Button></div>}
    </div>
  );
}
