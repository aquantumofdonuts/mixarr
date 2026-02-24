'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-2';
import type { ConnectionFormProps } from './types';

interface JellyfinUser {
  userId: string;
  username: string;
  isAdmin: boolean;
}

interface JellyfinLibrary {
  libraryId: string;
  name: string;
  type: string;
}

export function JellyfinForm({
  initialConfig,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [jellyfinUrl, setJellyfinUrl] = useState(initialConfig?.jellyfinUrl ?? '');
  const [jellyfinApiKey, setJellyfinApiKey] = useState(initialConfig?.jellyfinApiKey ?? '');
  const [jellyfinUserId, setJellyfinUserId] = useState(initialConfig?.jellyfinUserId ?? '');
  const [jellyfinLibraryId, setJellyfinLibraryId] = useState(
    initialConfig?.jellyfinLibraryId ?? ''
  );
  const [showPassword, setShowPassword] = useState(false);
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const { addToast } = useToast();

  const [jellyfinData, setJellyfinData] = useState<{
    users: JellyfinUser[];
    libraries: JellyfinLibrary[];
  } | null>(null);

  // Pre-populate dropdown data when editing
  useEffect(() => {
    if (initialConfig?.jellyfinUserId) {
      setJellyfinData({
        users: [{
          userId: initialConfig.jellyfinUserId,
          username: initialConfig.jellyfinUserName || 'User',
          isAdmin: false,
        }],
        libraries: initialConfig.jellyfinLibraryId
          ? [{
              libraryId: initialConfig.jellyfinLibraryId,
              name: initialConfig.jellyfinLibraryName || 'Library',
              type: 'music',
            }]
          : [],
      });
      setTested(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchJellyfinData = async () => {
    if (!jellyfinUrl || !jellyfinApiKey) {
      addToast({ type: 'warning', title: 'Enter Jellyfin URL and API key first' });
      return;
    }

    setTesting(true);
    try {
      const testResult = await api.post<{ success: boolean; message: string }>(
        '/api/connections/test',
        { type: 'jellyfin', config: { jellyfinUrl, jellyfinApiKey } }
      );

      if (!testResult.data?.success) {
        addToast({
          type: 'error',
          title: 'Connection failed',
          message: testResult.data?.message || testResult.error || undefined,
        });
        return;
      }

      const [usersResult, librariesResult] = await Promise.all([
        api.post<{ users: JellyfinUser[] }>('/api/connections/jellyfin/users', {
          jellyfinUrl,
          jellyfinApiKey,
        }),
        api.post<{ libraries: JellyfinLibrary[] }>('/api/connections/jellyfin/libraries', {
          jellyfinUrl,
          jellyfinApiKey,
        }),
      ]);

      if (usersResult.data && librariesResult.data) {
        setJellyfinData({
          users: usersResult.data.users,
          libraries: librariesResult.data.libraries,
        });
        setTested(true);
        addToast({ type: 'success', title: 'Connected to Jellyfin' });

        if (usersResult.data.users.length > 0 && !jellyfinUserId) {
          setJellyfinUserId(usersResult.data.users[0].userId);
        }
      } else {
        addToast({ type: 'error', title: 'Failed to fetch Jellyfin data' });
      }
    } finally {
      setTesting(false);
    }
  };

  // Notify parent of validity
  useEffect(() => {
    if (jellyfinUrl && jellyfinApiKey && jellyfinUserId) {
      const selectedUser = jellyfinData?.users.find(
        (u) => u.userId === jellyfinUserId
      );
      const selectedLibrary = jellyfinData?.libraries.find(
        (l) => l.libraryId === jellyfinLibraryId
      );
      onConfigReady({
        jellyfinUrl,
        jellyfinApiKey,
        jellyfinUserId,
        jellyfinLibraryId: jellyfinLibraryId || null,
        jellyfinUserName: selectedUser?.username,
        jellyfinLibraryName: selectedLibrary?.name,
      });
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jellyfinUrl, jellyfinApiKey, jellyfinUserId, jellyfinLibraryId, jellyfinData]);

  return (
    <>
      <div>
        <label className="text-sm font-medium">Jellyfin URL</label>
        <Input
          value={jellyfinUrl}
          onChange={(e) => {
            setJellyfinUrl(e.target.value);
            setTested(false);
          }}
          placeholder="http://localhost:8096"
        />
      </div>
      <div>
        <label className="text-sm font-medium">API Key</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={jellyfinApiKey}
            onChange={(e) => {
              setJellyfinApiKey(e.target.value);
              setTested(false);
            }}
            placeholder="Jellyfin API key (Dashboard → API Keys)"
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

      <Button
        type="button"
        variant="outline"
        onClick={fetchJellyfinData}
        disabled={!jellyfinUrl || !jellyfinApiKey}
        isLoading={testing}
        className="w-full"
      >
        <TestTube2 className="h-4 w-4 mr-2" />
        {tested ? 'Re-test Connection' : 'Test Connection & Load Options'}
      </Button>

      {jellyfinData && (
        <>
          <div>
            <label className="text-sm font-medium">Jellyfin User</label>
            <Select
              value={jellyfinUserId}
              onChange={(e) => setJellyfinUserId(e.target.value)}
              options={jellyfinData.users.map((u) => ({
                value: u.userId,
                label: u.username + (u.isAdmin ? ' (Admin)' : ''),
              }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Listening history will be fetched for this user
            </p>
          </div>
          {jellyfinData.libraries.length > 0 && (
            <div>
              <label className="text-sm font-medium">Music Library (Optional)</label>
              <Select
                value={jellyfinLibraryId}
                onChange={(e) => setJellyfinLibraryId(e.target.value)}
                options={[
                  { value: '', label: 'All Libraries' },
                  ...jellyfinData.libraries.map((l) => ({
                    value: l.libraryId,
                    label: l.name,
                  })),
                ]}
              />
            </div>
          )}
        </>
      )}

      {!tested && (
        <p className="text-xs text-muted-foreground text-center">
          Test connection to select Jellyfin user and library
        </p>
      )}
    </>
  );
}
