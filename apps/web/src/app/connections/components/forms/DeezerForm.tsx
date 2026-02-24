'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import type { ConnectionFormProps } from './types';

export function DeezerForm({
  initialConfig,
  connectionId,
  baseUrl,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [appId, setAppId] = useState(initialConfig?.appId ?? '');
  const [appSecret, setAppSecret] = useState(initialConfig?.appSecret ?? '');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (appId && appSecret) {
      onConfigReady({ appId, appSecret });
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, appSecret]);

  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  return (
    <>
      {/* Redirect URI info box */}
      <div className="p-3 bg-muted/50 rounded-lg border">
        <p className="text-sm font-medium mb-1">Deezer App Setup</p>
        <p className="text-xs text-muted-foreground mb-2">
          Add this Redirect URI to your Deezer app settings:
        </p>
        <code className="text-xs bg-background p-2 rounded block break-all select-all">
          {connectionId
            ? `${origin}/api/connections/${connectionId}/deezer/callback`
            : `${origin}/api/connections/[ID]/deezer/callback`}
        </code>
        {!connectionId && (
          <p className="text-xs text-muted-foreground mt-2 italic">
            Save this connection first, then the exact URI will be shown.
          </p>
        )}
        <a
          href="https://developers.deezer.com/myapps"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
        >
          <ExternalLink className="h-3 w-3" /> Create Deezer App
        </a>
      </div>

      <div>
        <label className="text-sm font-medium">Application ID</label>
        <Input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder="Deezer Application ID"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Secret Key</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="Deezer Secret Key"
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
