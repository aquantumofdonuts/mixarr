'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import type { ConnectionFormProps } from './types';

export function ListenBrainzForm({
  initialConfig,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [username, setUsername] = useState(initialConfig?.username ?? '');
  const [token, setToken] = useState(initialConfig?.token ?? '');
  const [url, setUrl] = useState(initialConfig?.url ?? '');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (username) {
      const config: Record<string, any> = { username };
      if (token) config.token = token;
      if (url) config.url = url;
      onConfigReady(config);
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, token, url]);

  return (
    <>
      <div className="p-3 bg-muted/50 rounded-container border">
        <p className="text-sm font-medium mb-1">ListenBrainz Setup</p>
        <p className="text-xs text-muted-foreground mb-2">
          Get your user token from your profile settings.
        </p>
        <a
          href="https://listenbrainz.org/settings/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" /> ListenBrainz Settings
        </a>
      </div>
      <div>
        <label className="text-sm font-medium">ListenBrainz Username</label>
        <Input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your ListenBrainz username"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Required for listening history and recommendations
        </p>
      </div>
      <div>
        <label className="text-sm font-medium">User Token (optional)</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ListenBrainz user token"
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
        <p className="text-xs text-muted-foreground mt-1">
          Optional. Get from listenbrainz.org/profile
        </p>
      </div>
      <div>
        <label className="text-sm font-medium">API URL (optional)</label>
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.listenbrainz.org"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Leave blank for ListenBrainz. Set to your Koito instance URL for self-hosted scrobbling.
        </p>
      </div>
    </>
  );
}
