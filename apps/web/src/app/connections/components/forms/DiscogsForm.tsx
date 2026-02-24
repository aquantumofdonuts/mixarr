'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import type { ConnectionFormProps } from './types';

export function DiscogsForm({
  initialConfig,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [token, setToken] = useState(initialConfig?.token ?? '');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (token) {
      onConfigReady({ token });
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <>
      <div className="p-3 bg-muted/50 rounded-lg border">
        <p className="text-sm font-medium mb-1">Discogs Setup</p>
        <p className="text-xs text-muted-foreground mb-2">
          Generate a personal access token from your Discogs developer settings.
        </p>
        <a
          href="https://www.discogs.com/settings/developers"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" /> Discogs Developer Settings
        </a>
      </div>
      <div>
        <label className="text-sm font-medium">Personal Access Token</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Discogs personal access token"
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
