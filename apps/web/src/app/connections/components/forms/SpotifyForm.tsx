'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import type { ConnectionFormProps } from './types';

export function SpotifyForm({
  initialConfig,
  connectionId,
  baseUrl,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [clientId, setClientId] = useState(initialConfig?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState(initialConfig?.clientSecret ?? '');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (clientId && clientSecret) {
      onConfigReady({ clientId, clientSecret });
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clientSecret]);

  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  return (
    <>
      {/* Redirect URI info box */}
      <div className="p-3 bg-muted/50 rounded-lg border">
        <p className="text-sm font-medium mb-1">Spotify App Setup</p>
        <p className="text-xs text-muted-foreground mb-2">
          Add this Redirect URI to your Spotify app settings:
        </p>
        <code className="text-xs bg-background p-2 rounded block break-all select-all">
          {connectionId
            ? `${origin}/api/connections/${connectionId}/spotify/callback`
            : `${origin}/api/connections/[ID]/spotify/callback`}
        </code>
        {!connectionId && (
          <p className="text-xs text-muted-foreground mt-2 italic">
            Save this connection first, then the exact URI will be shown.
          </p>
        )}
        <a
          href="https://developer.spotify.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
        >
          <ExternalLink className="h-3 w-3" /> Spotify Developer Dashboard
        </a>
      </div>

      <div>
        <label className="text-sm font-medium">Client ID</label>
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Spotify client ID"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Client Secret</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Spotify client secret"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </>
  );
}
