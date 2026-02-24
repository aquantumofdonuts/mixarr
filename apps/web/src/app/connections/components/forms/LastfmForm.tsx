'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import type { ConnectionFormProps } from './types';

export function LastfmForm({
  initialConfig,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [username, setUsername] = useState(initialConfig?.username ?? '');
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? '');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (apiKey) {
      const config: Record<string, any> = { apiKey };
      if (username) config.username = username;
      onConfigReady(config);
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, username]);

  return (
    <>
      <div className="p-3 bg-muted/50 rounded-lg border">
        <p className="text-sm font-medium mb-1">Last.fm API Setup</p>
        <p className="text-xs text-muted-foreground mb-2">
          Create an API account to get your API key.
        </p>
        <a
          href="https://www.last.fm/api/account/create"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" /> Last.fm API Account
        </a>
      </div>
      <div>
        <label className="text-sm font-medium">Last.fm Username</label>
        <Input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your Last.fm username (for library subscriptions)"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Required for personal listening history subscriptions
        </p>
      </div>
      <div>
        <label className="text-sm font-medium">API Key</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Last.fm API key"
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
