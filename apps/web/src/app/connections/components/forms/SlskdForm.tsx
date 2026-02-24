'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import type { ConnectionFormProps } from './types';

export function SlskdForm({
  initialConfig,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [url, setUrl] = useState(initialConfig?.url ?? '');
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? '');
  const [downloadDir, setDownloadDir] = useState(initialConfig?.downloadDir ?? '');
  const [musicLibraryDir, setMusicLibraryDir] = useState(initialConfig?.musicLibraryDir ?? '');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (url && apiKey) {
      onConfigReady({
        url,
        apiKey,
        downloadDir: downloadDir || '/downloads',
        musicLibraryDir: musicLibraryDir || '/music',
      });
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, apiKey, downloadDir, musicLibraryDir]);

  return (
    <>
      <div className="p-3 bg-muted/50 rounded-lg border">
        <p className="text-sm font-medium mb-1">slskd Setup</p>
        <p className="text-xs text-muted-foreground mb-2">
          Connect to your slskd instance for Soulseek downloads. Get your API key from slskd
          Settings → Options → Web.
        </p>
        <a
          href="https://github.com/slskd/slskd"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" /> slskd Documentation
        </a>
      </div>
      <div>
        <label className="text-sm font-medium">slskd URL</label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:5030"
        />
        <p className="text-xs text-muted-foreground mt-1">
          The URL of your slskd instance
        </p>
      </div>
      <div>
        <label className="text-sm font-medium">API Key</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="slskd API key"
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
      <div>
        <label className="text-sm font-medium">Download Directory</label>
        <Input
          value={downloadDir}
          onChange={(e) => setDownloadDir(e.target.value)}
          placeholder="/downloads"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Where slskd downloads files (must match slskd config)
        </p>
      </div>
      <div>
        <label className="text-sm font-medium">Music Library Directory</label>
        <Input
          value={musicLibraryDir}
          onChange={(e) => setMusicLibraryDir(e.target.value)}
          placeholder="/music"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Where to organize completed downloads
        </p>
      </div>
    </>
  );
}
