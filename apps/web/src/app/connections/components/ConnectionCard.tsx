'use client';

import { Button } from '@/components/ui/button';
import { OAuthButtons } from './OAuthButtons';
import { LidarrMaintenance } from './LidarrMaintenance';
import type { OAuthType } from '../hooks/useOAuthStatus';
import type { ConnectionTestState } from '../hooks/useConnectionForm';
const OAUTH_TYPES: ReadonlySet<string> = new Set(['spotify', 'deezer', 'tidal']);

export interface Connection {
  id: number;
  userId: number | null;
  type: 'lidarr' | 'spotify' | 'lastfm' | 'tautulli' | 'jellyfin' | 'deezer' | 'tidal' | 'listenbrainz' | 'discogs' | 'slskd';
  name: string;
  isActive: boolean;
  lastTest: string | null;
  createdAt: string;
  user?: { username: string; displayName: string } | null;
}

export interface ConnectionCardProps {
  typeConfig: { value: string; label: string; color: string; description: string; icon?: string };
  connections: Connection[];
  isAdmin: boolean;
  currentUserId?: number;
  testStates?: Record<number, ConnectionTestState>;
  onAdd: (type: string) => void;
  onEdit: (id: number) => void;
  onTest: (id: number) => void;
  onDelete: (id: number) => void;
  testingId: number | null;
  onPreview?: (connectionId: number, type: string) => void;
}

export function ConnectionCard({ typeConfig, connections, isAdmin, currentUserId, onEdit, onTest, onDelete, testingId, testStates = {}, onPreview }: ConnectionCardProps) {
  return <>
    {connections.map(conn => {
      const canModify = isAdmin || (conn.userId !== null && conn.userId === currentUserId);
      const result = testStates[conn.id];
      const testing = result?.verdict === 'testing' || testingId === conn.id;
      const timestamp = result?.testedAt ?? conn.lastTest;
      return <article key={conn.id} aria-label={conn.name} className="border-b px-3 py-3 last:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="break-words font-medium">{conn.name} <span className="font-normal text-sm text-muted-foreground">· {typeConfig.label}</span></p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Enabled: {conn.isActive ? 'Yes' : 'No'}</span>
              <span>{conn.userId === null ? 'Global' : 'Personal'}{isAdmin && conn.userId !== null && conn.user ? ` · ${conn.user.displayName || conn.user.username}` : ''}</span>
              <span>Last tested: {timestamp ? <time className="font-mono" dateTime={timestamp}>{new Date(timestamp).toLocaleString()}</time> : 'Never'}</span>
              <span>Session test: <span className={result?.verdict === 'pass' ? 'text-status-success' : result?.verdict === 'fail' ? 'text-destructive' : ''}>{testing ? 'Testing…' : result?.verdict === 'pass' ? 'Pass' : result?.verdict === 'fail' ? 'Fail' : 'Unknown'}</span></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" title="Test connection" onClick={() => onTest(conn.id)} disabled={testing}>Test</Button>
            {canModify && <>
              <Button size="sm" variant="outline" title="Edit" onClick={() => onEdit(conn.id)}>Edit</Button>
              <Button size="sm" variant="outline" title="Delete" onClick={() => onDelete(conn.id)}>Delete</Button>
            </>}
          </div>
        </div>
        <div className="mt-2">
          {OAUTH_TYPES.has(conn.type) ? <OAuthButtons type={conn.type as OAuthType} connectionId={conn.id} canModify={canModify} onPreview={onPreview} /> : <span className="text-xs text-muted-foreground">Authorization: Not reported by this provider</span>}
        </div>
        {result?.verdict === 'fail' && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{result.message}</span><Button variant="outline" size="sm" onClick={() => onTest(conn.id)}>Retry</Button></div>}
        {conn.type === 'lastfm' && onPreview && <Button className="mt-2" size="sm" variant="outline" onClick={() => onPreview(conn.id, 'lastfm')}>Preview Artists</Button>}
        {conn.type === 'lidarr' && isAdmin && <LidarrMaintenance connectionId={conn.id} />}
      </article>;
    })}
  </>;
}
