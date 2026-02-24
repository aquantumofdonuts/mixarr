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

interface PlexUser {
  userId: number;
  username: string;
  friendlyName: string;
  isAdmin: boolean;
}

interface PlexLibrary {
  sectionId: number;
  sectionName: string;
  sectionType: string;
  count: number;
}

export function TautulliForm({
  initialConfig,
  onConfigReady,
  onConfigInvalid,
}: ConnectionFormProps) {
  const [tautulliUrl, setTautulliUrl] = useState(initialConfig?.tautulliUrl ?? '');
  const [tautulliApiKey, setTautulliApiKey] = useState(initialConfig?.tautulliApiKey ?? '');
  const [plexUserId, setPlexUserId] = useState(
    initialConfig?.plexUserId != null ? String(initialConfig.plexUserId) : ''
  );
  const [plexLibraryId, setPlexLibraryId] = useState(
    initialConfig?.plexLibraryId != null ? String(initialConfig.plexLibraryId) : ''
  );
  const [showPassword, setShowPassword] = useState(false);
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const { addToast } = useToast();

  const [tautulliData, setTautulliData] = useState<{
    users: PlexUser[];
    libraries: PlexLibrary[];
  } | null>(null);

  // Pre-populate dropdown data when editing
  useEffect(() => {
    if (initialConfig?.plexUserId && initialConfig?.plexLibraryId) {
      setTautulliData({
        users: [{
          userId: initialConfig.plexUserId,
          username: initialConfig.plexUserName || 'User',
          friendlyName: initialConfig.plexUserName || 'User',
          isAdmin: false,
        }],
        libraries: [{
          sectionId: initialConfig.plexLibraryId,
          sectionName: initialConfig.plexLibraryName || 'Library',
          sectionType: 'artist',
          count: 0,
        }],
      });
      setTested(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTautulliData = async () => {
    if (!tautulliUrl || !tautulliApiKey) {
      addToast({ type: 'warning', title: 'Enter Tautulli URL and API key first' });
      return;
    }

    setTesting(true);
    try {
      const testResult = await api.post<{ success: boolean; message: string }>(
        '/api/connections/test-tautulli',
        { tautulliUrl, tautulliApiKey }
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
        api.post<{ users: PlexUser[] }>('/api/connections/tautulli/users', {
          tautulliUrl,
          tautulliApiKey,
        }),
        api.post<{ libraries: PlexLibrary[] }>('/api/connections/tautulli/libraries', {
          tautulliUrl,
          tautulliApiKey,
        }),
      ]);

      if (usersResult.data && librariesResult.data) {
        setTautulliData({
          users: usersResult.data.users,
          libraries: librariesResult.data.libraries,
        });
        setTested(true);
        addToast({ type: 'success', title: 'Connected to Tautulli' });

        if (usersResult.data.users.length > 0 && !plexUserId) {
          setPlexUserId(usersResult.data.users[0].userId.toString());
        }
        if (librariesResult.data.libraries.length > 0 && !plexLibraryId) {
          setPlexLibraryId(librariesResult.data.libraries[0].sectionId.toString());
        }
      } else {
        addToast({ type: 'error', title: 'Failed to fetch Tautulli data' });
      }
    } finally {
      setTesting(false);
    }
  };

  // Notify parent of validity
  useEffect(() => {
    if (tautulliUrl && tautulliApiKey && plexUserId && plexLibraryId) {
      const selectedUser = tautulliData?.users.find(
        (u) => u.userId === parseInt(plexUserId)
      );
      const selectedLibrary = tautulliData?.libraries.find(
        (l) => l.sectionId === parseInt(plexLibraryId)
      );
      onConfigReady({
        tautulliUrl,
        tautulliApiKey,
        plexUserId: parseInt(plexUserId),
        plexLibraryId: parseInt(plexLibraryId),
        plexUserName: selectedUser?.friendlyName || selectedUser?.username,
        plexLibraryName: selectedLibrary?.sectionName,
      });
    } else {
      onConfigInvalid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tautulliUrl, tautulliApiKey, plexUserId, plexLibraryId, tautulliData]);

  return (
    <>
      <div>
        <label className="text-sm font-medium">Tautulli URL</label>
        <Input
          value={tautulliUrl}
          onChange={(e) => {
            setTautulliUrl(e.target.value);
            setTested(false);
          }}
          placeholder="http://localhost:8181"
        />
      </div>
      <div>
        <label className="text-sm font-medium">API Key</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={tautulliApiKey}
            onChange={(e) => {
              setTautulliApiKey(e.target.value);
              setTested(false);
            }}
            placeholder="Tautulli API key (Settings → Web Interface)"
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
        onClick={fetchTautulliData}
        disabled={!tautulliUrl || !tautulliApiKey}
        isLoading={testing}
        className="w-full"
      >
        <TestTube2 className="h-4 w-4 mr-2" />
        {tested ? 'Re-test Connection' : 'Test Connection & Load Options'}
      </Button>

      {tautulliData && (
        <>
          <div>
            <label className="text-sm font-medium">Plex User</label>
            <Select
              value={plexUserId}
              onChange={(e) => setPlexUserId(e.target.value)}
              options={tautulliData.users.map((u) => ({
                value: u.userId.toString(),
                label: u.friendlyName || u.username,
              }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Listening history will be fetched for this user
            </p>
          </div>
          <div>
            <label className="text-sm font-medium">Music Library</label>
            <Select
              value={plexLibraryId}
              onChange={(e) => setPlexLibraryId(e.target.value)}
              options={tautulliData.libraries.map((l) => ({
                value: l.sectionId.toString(),
                label: `${l.sectionName} (${l.count} artists)`,
              }))}
            />
          </div>
        </>
      )}

      {!tested && (
        <p className="text-xs text-muted-foreground text-center">
          Test connection to select Plex user and library
        </p>
      )}
    </>
  );
}
