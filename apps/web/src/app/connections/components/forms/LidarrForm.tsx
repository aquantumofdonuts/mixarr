'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import type { ConnectionFormProps } from './types';

export function LidarrForm({
  initialConfig,
  connectionId,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [url, setUrl] = useState(initialConfig?.url ?? '');
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? '');
  const [qualityProfileId, setQualityProfileId] = useState<string>(
    initialConfig?.qualityProfileId != null ? String(initialConfig.qualityProfileId) : ''
  );
  const [rootFolderPath, setRootFolderPath] = useState(initialConfig?.rootFolderPath ?? '');
  const [monitorOption, setMonitorOption] = useState(initialConfig?.monitorOption ?? 'all');
  const [monitorNewItems, setMonitorNewItems] = useState(initialConfig?.monitorNewItems ?? 'all');
  const [searchOnAdd, setSearchOnAdd] = useState(initialConfig?.searchOnAdd !== false);
  const [showPassword, setShowPassword] = useState(false);
  const [fetching, setFetching] = useState(false);

  const [lidarrData, setLidarrData] = useState<{
    qualityProfiles: Array<{ id: number; name: string }>;
    rootFolders: Array<{ id: number; path: string }>;
  } | null>(null);

  // Auto-fetch options when editing an existing connection
  useEffect(() => {
    if (connectionId) {
      fetchLidarrData(connectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const fetchLidarrData = async (existingConnectionId?: number) => {
    setFetching(true);
    try {
      if (existingConnectionId) {
        const { data } = await api.get<{
          qualityProfiles: Array<{ id: number; name: string }>;
          rootFolders: Array<{ id: number; path: string }>;
        }>(`/api/connections/${existingConnectionId}/lidarr-options`);
        if (data) setLidarrData(data);
      } else if (url && apiKey) {
        const { data } = await api.post<{
          success: boolean;
          qualityProfiles?: Array<{ id: number; name: string }>;
          rootFolders?: Array<{ id: number; path: string }>;
        }>('/api/connections/test-lidarr', { url, apiKey });
        if (data?.success) {
          setLidarrData({
            qualityProfiles: data.qualityProfiles || [],
            rootFolders: data.rootFolders || [],
          });
        }
      }
    } finally {
      setFetching(false);
    }
  };

  // Notify parent of validity
  useEffect(() => {
    if (url && apiKey) {
      const config: Record<string, any> = {
        url,
        apiKey,
        qualityProfileId: qualityProfileId ? parseInt(qualityProfileId, 10) : undefined,
        rootFolderPath,
        monitorOption,
        monitorNewItems,
        searchOnAdd,
      };
      onConfigReady(config);
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, apiKey, qualityProfileId, rootFolderPath, monitorOption, monitorNewItems, searchOnAdd]);

  return (
    <>
      <div>
        <label className="text-sm font-medium">URL</label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8686"
        />
      </div>
      <div>
        <label className="text-sm font-medium">API Key</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter API key"
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

      {/* Fetch Lidarr options button */}
      {!lidarrData && url && apiKey && (
        <Button
          variant="outline"
          onClick={() => fetchLidarrData()}
          isLoading={fetching}
          className="w-full"
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Fetch Lidarr Options
        </Button>
      )}

      {/* Lidarr-specific settings — only after fetching options or when editing */}
      {(lidarrData || connectionId) && (
        <>
          <div className="border-t pt-4 mt-2">
            <h4 className="text-sm font-medium mb-3">Lidarr Import Settings</h4>
          </div>

          <div>
            <label className="text-sm font-medium">Quality Profile</label>
            <Select
              value={qualityProfileId}
              onChange={(e) => setQualityProfileId(e.target.value)}
              options={[
                { value: '', label: 'Select a quality profile...' },
                ...(lidarrData?.qualityProfiles?.map((p) => ({
                  value: String(p.id),
                  label: p.name,
                })) || []),
              ]}
            />
            <p className="text-xs text-muted-foreground mt-1">Quality profile for new artists</p>
          </div>

          <div>
            <label className="text-sm font-medium">Root Folder</label>
            <Select
              value={rootFolderPath}
              onChange={(e) => setRootFolderPath(e.target.value)}
              options={[
                { value: '', label: 'Select a root folder...' },
                ...(lidarrData?.rootFolders?.map((f) => ({
                  value: f.path,
                  label: f.path,
                })) || []),
              ]}
            />
            <p className="text-xs text-muted-foreground mt-1">Root folder for new artists</p>
          </div>

          <div>
            <label className="text-sm font-medium">Monitor Existing Albums</label>
            <Select
              value={monitorOption}
              onChange={(e) => setMonitorOption(e.target.value)}
              options={[
                { value: 'all', label: 'All Albums' },
                { value: 'future', label: 'Future Albums Only' },
                { value: 'missing', label: 'Missing Albums' },
                { value: 'existing', label: 'Existing Albums' },
                { value: 'none', label: 'None' },
              ]}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Monitor New Albums</label>
            <Select
              value={monitorNewItems}
              onChange={(e) => setMonitorNewItems(e.target.value)}
              options={[
                { value: 'all', label: 'All New Albums' },
                { value: 'new', label: 'New Releases Only' },
                { value: 'none', label: 'None' },
              ]}
            />
            <p className="text-xs text-muted-foreground mt-1">How to handle future album releases</p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Search on Add</label>
              <p className="text-xs text-muted-foreground">
                Automatically search for albums when adding artists
              </p>
            </div>
            <input
              type="checkbox"
              checked={searchOnAdd}
              onChange={(e) => setSearchOnAdd(e.target.checked)}
              className="h-4 w-4"
            />
          </div>
        </>
      )}
    </>
  );
}
