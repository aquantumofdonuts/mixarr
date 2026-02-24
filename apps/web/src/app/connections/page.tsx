'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useConnections, useDeleteConnection, queryKeys } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import Check from 'lucide-react/dist/esm/icons/check';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import Plus from 'lucide-react/dist/esm/icons/plus';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-2';
import X from 'lucide-react/dist/esm/icons/x';
import { ConnectionCard } from './components/ConnectionCard';
import type { Connection } from './components/ConnectionCard';
import { connectionTypes } from './connectionTypes';

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

export default function ConnectionsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  
  // React Query for connections - cached across navigations
  const { data: connections = [] } = useConnections();
  const deleteMutation = useDeleteConnection();
  
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const { addToast } = useToast();
  
  // Load welcome banner dismissed state from localStorage
  useEffect(() => {
    const dismissed = localStorage.getItem('mixarr_welcome_dismissed');
    if (dismissed === 'true') {
      setWelcomeDismissed(true);
    }
  }, []);
  
  const handleDismissWelcome = () => {
    setWelcomeDismissed(true);
    localStorage.setItem('mixarr_welcome_dismissed', 'true');
  };

  
  // Invalidate to trigger refetch
  const refetchConnections = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.connections });
  };

  const handlePreview = (connectionId: number, type: string) => {
    router.push(`/preview?connectionId=${connectionId}&type=${type}`);
  };

  const [form, setForm] = useState({
    type: 'lidarr' as Connection['type'],
    name: '',
    url: '',
    apiKey: '',
    clientId: '',
    clientSecret: '',
    // Lidarr-specific settings
    qualityProfileId: '',
    rootFolderPath: '',
    monitorOption: 'all',
    monitorNewItems: 'all',
    searchOnAdd: true,
    // Last.fm-specific settings
    lastfmUsername: '',
    // Tautulli-specific settings
    tautulliUrl: '',
    tautulliApiKey: '',
    plexUserId: '',
    plexLibraryId: '',
    // Jellyfin-specific settings
    jellyfinUrl: '',
    jellyfinApiKey: '',
    jellyfinUserId: '',
    jellyfinLibraryId: '',
    // ListenBrainz-specific settings
    listenbrainzUsername: '',
    listenbrainzToken: '',
    // Discogs-specific settings
    discogsToken: '',
    // slskd-specific settings
    slskdUrl: '',
    slskdApiKey: '',
    slskdDownloadDir: '',
    slskdMusicLibraryDir: '',
  });

  // Lidarr data fetched when testing connection
  const [lidarrData, setLidarrData] = useState<{
    qualityProfiles: Array<{ id: number; name: string }>;
    rootFolders: Array<{ id: number; path: string }>;
  } | null>(null);

  // Tautulli data fetched when testing connection
  const [tautulliData, setTautulliData] = useState<{
    users: PlexUser[];
    libraries: PlexLibrary[];
  } | null>(null);
  const [tautulliTested, setTautulliTested] = useState(false);

  // Jellyfin data fetched when testing connection
  const [jellyfinData, setJellyfinData] = useState<{
    users: Array<{ userId: string; username: string; isAdmin: boolean }>;
    libraries: Array<{ libraryId: string; name: string; type: string }>;
  } | null>(null);
  const [jellyfinTested, setJellyfinTested] = useState(false);

  const fetchLidarrData = async (connectionId?: number) => {
    if (connectionId) {
      // Fetch from existing connection
      const { data } = await api.get<{ 
        qualityProfiles: Array<{ id: number; name: string }>;
        rootFolders: Array<{ id: number; path: string }>;
      }>(`/api/connections/${connectionId}/lidarr-options`);
      if (data) setLidarrData(data);
    } else if (form.url && form.apiKey) {
      // Test connection and fetch data
      const { data } = await api.post<{ 
        success: boolean;
        qualityProfiles?: Array<{ id: number; name: string }>;
        rootFolders?: Array<{ id: number; path: string }>;
      }>('/api/connections/test-lidarr', { url: form.url, apiKey: form.apiKey });
      if (data?.success) {
        setLidarrData({
          qualityProfiles: data.qualityProfiles || [],
          rootFolders: data.rootFolders || [],
        });
      }
    }
  };

  const fetchTautulliData = async () => {
    if (!form.tautulliUrl || !form.tautulliApiKey) {
      addToast({ type: 'warning', title: 'Enter Tautulli URL and API key first' });
      return;
    }

    // Test connection first
    const testResult = await api.post<{ success: boolean; message: string }>(
      '/api/connections/test-tautulli',
      { tautulliUrl: form.tautulliUrl, tautulliApiKey: form.tautulliApiKey }
    );

    if (!testResult.data?.success) {
      addToast({ 
        type: 'error', 
        title: 'Connection failed', 
        message: testResult.data?.message || testResult.error || undefined
      });
      return;
    }

    // Fetch users and libraries in parallel
    const [usersResult, librariesResult] = await Promise.all([
      api.post<{ users: PlexUser[] }>('/api/connections/tautulli/users', {
        tautulliUrl: form.tautulliUrl,
        tautulliApiKey: form.tautulliApiKey,
      }),
      api.post<{ libraries: PlexLibrary[] }>('/api/connections/tautulli/libraries', {
        tautulliUrl: form.tautulliUrl,
        tautulliApiKey: form.tautulliApiKey,
      }),
    ]);

    if (usersResult.data && librariesResult.data) {
      setTautulliData({
        users: usersResult.data.users,
        libraries: librariesResult.data.libraries,
      });
      setTautulliTested(true);
      addToast({ type: 'success', title: 'Connected to Tautulli' });
      
      // Auto-select first user and library if available
      if (usersResult.data.users.length > 0 && !form.plexUserId) {
        setForm(f => ({ ...f, plexUserId: usersResult.data!.users[0].userId.toString() }));
      }
      if (librariesResult.data.libraries.length > 0 && !form.plexLibraryId) {
        setForm(f => ({ ...f, plexLibraryId: librariesResult.data!.libraries[0].sectionId.toString() }));
      }
    } else {
      addToast({ type: 'error', title: 'Failed to fetch Tautulli data' });
    }
  };

  const fetchJellyfinData = async () => {
    if (!form.jellyfinUrl || !form.jellyfinApiKey) {
      addToast({ type: 'warning', title: 'Enter Jellyfin URL and API key first' });
      return;
    }

    // Test connection first
    const testResult = await api.post<{ success: boolean; message: string }>(
      '/api/connections/test',
      { type: 'jellyfin', config: { jellyfinUrl: form.jellyfinUrl, jellyfinApiKey: form.jellyfinApiKey } }
    );

    if (!testResult.data?.success) {
      addToast({ 
        type: 'error', 
        title: 'Connection failed', 
        message: testResult.data?.message || testResult.error || undefined
      });
      return;
    }

    // Fetch users and libraries in parallel
    const [usersResult, librariesResult] = await Promise.all([
      api.post<{ users: Array<{ userId: string; username: string; isAdmin: boolean }> }>('/api/connections/jellyfin/users', {
        jellyfinUrl: form.jellyfinUrl,
        jellyfinApiKey: form.jellyfinApiKey,
      }),
      api.post<{ libraries: Array<{ libraryId: string; name: string; type: string }> }>('/api/connections/jellyfin/libraries', {
        jellyfinUrl: form.jellyfinUrl,
        jellyfinApiKey: form.jellyfinApiKey,
      }),
    ]);

    if (usersResult.data && librariesResult.data) {
      setJellyfinData({
        users: usersResult.data.users,
        libraries: librariesResult.data.libraries,
      });
      setJellyfinTested(true);
      addToast({ type: 'success', title: 'Connected to Jellyfin' });
      
      // Auto-select first user if available
      if (usersResult.data.users.length > 0 && !form.jellyfinUserId) {
        setForm(f => ({ ...f, jellyfinUserId: usersResult.data!.users[0].userId }));
      }
    } else {
      addToast({ type: 'error', title: 'Failed to fetch Jellyfin data' });
    }
  };

  useEffect(() => {
    fetchBaseUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBaseUrl = async () => {
    const { data } = await api.get<{ baseUrl: string }>('/api/settings/base-url');
    if (data?.baseUrl) {
      setBaseUrl(data.baseUrl);
    } else {
      // Fall back to current window origin
      setBaseUrl(window.location.origin);
    }
  };

  // Handle OAuth callback results
  useEffect(() => {
    const error = searchParams.get('error');
    const spotifyAuthorized = searchParams.get('spotify_authorized');
    const deezerAuthorized = searchParams.get('deezer_authorized');
    const tidalAuthorized = searchParams.get('tidal_authorized');

    if (error) {
      const errorMessages: Record<string, string> = {
        'access_denied': 'Authorization was denied',
        'missing_code_or_state': 'Authorization failed: missing data',
        'invalid_state': 'Authorization failed: invalid state',
        'state_expired': 'Authorization session expired, please try again',
        'connection_mismatch': 'Authorization failed: connection mismatch',
        'connection_not_found': 'Connection not found',
        'missing_credentials': 'Credentials not configured',
        'token_exchange_failed': 'Failed to complete authorization',
      };
      addToast({ 
        type: 'error', 
        title: 'Authorization Failed', 
        message: errorMessages[error] || error 
      });
      // Clean up URL
      window.history.replaceState({}, '', '/connections');
    }

    if (spotifyAuthorized) {
      addToast({ type: 'success', title: 'Spotify account authorized successfully!' });
      window.history.replaceState({}, '', '/connections');
    }

    if (deezerAuthorized) {
      addToast({ type: 'success', title: 'Deezer account authorized successfully!' });
      window.history.replaceState({}, '', '/connections');
    }

    if (tidalAuthorized) {
      addToast({ type: 'success', title: 'TIDAL account authorized successfully!' });
      window.history.replaceState({}, '', '/connections');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSave = async () => {
    const config: Record<string, any> = {};
    
    if (form.type === 'lidarr') {
      config.url = form.url;
      config.apiKey = form.apiKey;
      // Parse qualityProfileId to number - dropdown values are strings
      config.qualityProfileId = form.qualityProfileId ? parseInt(form.qualityProfileId, 10) : undefined;
      config.rootFolderPath = form.rootFolderPath;
      config.monitorOption = form.monitorOption;
      config.monitorNewItems = form.monitorNewItems;
      config.searchOnAdd = form.searchOnAdd;
    } else if (form.type === 'spotify') {
      config.clientId = form.clientId;
      config.clientSecret = form.clientSecret;
    } else if (form.type === 'lastfm') {
      config.apiKey = form.apiKey;
      config.username = form.lastfmUsername;
    } else if (form.type === 'tautulli') {
      if (!form.plexUserId || !form.plexLibraryId) {
        addToast({ type: 'warning', title: 'Please select a Plex user and library' });
        return;
      }
      config.tautulliUrl = form.tautulliUrl;
      config.tautulliApiKey = form.tautulliApiKey;
      config.plexUserId = parseInt(form.plexUserId);
      config.plexLibraryId = parseInt(form.plexLibraryId);
      // Store friendly names for display
      const selectedUser = tautulliData?.users.find(u => u.userId === parseInt(form.plexUserId));
      const selectedLibrary = tautulliData?.libraries.find(l => l.sectionId === parseInt(form.plexLibraryId));
      config.plexUserName = selectedUser?.friendlyName || selectedUser?.username;
      config.plexLibraryName = selectedLibrary?.sectionName;
    } else if (form.type === 'deezer') {
      config.appId = form.clientId;
      config.appSecret = form.clientSecret;
    } else if (form.type === 'tidal') {
      config.clientId = form.clientId;
      config.clientSecret = form.clientSecret;
    } else if (form.type === 'listenbrainz') {
      config.username = form.listenbrainzUsername;
      if (form.listenbrainzToken) {
        config.token = form.listenbrainzToken;
      }
    } else if (form.type === 'discogs') {
      config.token = form.discogsToken;
    } else if (form.type === 'jellyfin') {
      if (!form.jellyfinUserId) {
        addToast({ type: 'warning', title: 'Please select a Jellyfin user' });
        return;
      }
      config.jellyfinUrl = form.jellyfinUrl;
      config.jellyfinApiKey = form.jellyfinApiKey;
      config.jellyfinUserId = form.jellyfinUserId;
      config.jellyfinLibraryId = form.jellyfinLibraryId || null;
      // Store friendly names for display
      const selectedUser = jellyfinData?.users.find(u => u.userId === form.jellyfinUserId);
      const selectedLibrary = jellyfinData?.libraries.find(l => l.libraryId === form.jellyfinLibraryId);
      config.jellyfinUserName = selectedUser?.username;
      config.jellyfinLibraryName = selectedLibrary?.name;
    } else if (form.type === 'slskd') {
      if (!form.slskdUrl || !form.slskdApiKey) {
        addToast({ type: 'warning', title: 'Please enter slskd URL and API Key' });
        return;
      }
      config.url = form.slskdUrl;
      config.apiKey = form.slskdApiKey;
      config.downloadDir = form.slskdDownloadDir || '/downloads';
      config.musicLibraryDir = form.slskdMusicLibraryDir || '/music';
    }

    const payload = {
      type: form.type,
      name: form.name || connectionTypes.find(t => t.value === form.type)?.label,
      config,
    };

    const { error } = editingId
      ? await api.put(`/api/connections/${editingId}`, payload)
      : await api.post('/api/connections', payload);

    if (error) {
      addToast({ type: 'error', title: 'Failed to save connection', message: error });
    } else {
      addToast({ type: 'success', title: editingId ? 'Connection updated' : 'Connection added' });
      closeModal();
      refetchConnections();
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    const { data, error } = await api.post<{ success: boolean; message?: string }>(`/api/connections/${id}/test`);
    
    if (error || !data?.success) {
      addToast({ type: 'error', title: 'Connection test failed', message: error || data?.message });
    } else {
      addToast({ type: 'success', title: 'Connection test successful' });
      refetchConnections();
    }
    setTestingId(null);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this connection?')) return;
    
    try {
      await deleteMutation.mutateAsync(id);
      addToast({ type: 'success', title: 'Connection deleted' });
    } catch {
      addToast({ type: 'error', title: 'Failed to delete connection' });
    }
  };

  const openModal = async (connection?: Connection, defaultType?: Connection['type']) => {
    if (connection) {
      setEditingId(connection.id);
      // Fetch config for existing connection
      const { data } = await api.get<{ connection: { config: Record<string, any> } }>(`/api/connections/${connection.id}`);
      const config = data?.connection?.config || {};
      
      setForm({
        type: connection.type,
        name: connection.name,
        url: config.url || '',
        apiKey: '', // Don't pre-fill for security
        clientId: config.clientId || '',
        clientSecret: '', // Don't pre-fill for security
        qualityProfileId: config.qualityProfileId || '',
        rootFolderPath: config.rootFolderPath || '',
        monitorOption: config.monitorOption || 'all',
        monitorNewItems: config.monitorNewItems || 'all',
        searchOnAdd: config.searchOnAdd !== false,
        lastfmUsername: config.username || '',
        tautulliUrl: config.tautulliUrl || '',
        tautulliApiKey: '', // Don't pre-fill for security
        plexUserId: config.plexUserId?.toString() || '',
        plexLibraryId: config.plexLibraryId?.toString() || '',
        jellyfinUrl: config.jellyfinUrl || '',
        jellyfinApiKey: '', // Don't pre-fill for security
        jellyfinUserId: config.jellyfinUserId || '',
        jellyfinLibraryId: config.jellyfinLibraryId || '',
        listenbrainzUsername: config.username || '',
        listenbrainzToken: '', // Don't pre-fill for security
        discogsToken: '', // Don't pre-fill for security
        slskdUrl: config.url || '',
        slskdApiKey: '', // Don't pre-fill for security
        slskdDownloadDir: config.downloadDir || '',
        slskdMusicLibraryDir: config.musicLibraryDir || '',
      });
      
      // Fetch Lidarr data if editing a Lidarr connection
      if (connection.type === 'lidarr') {
        fetchLidarrData(connection.id);
      }
      
      // Set up Tautulli data if editing a Tautulli connection
      if (connection.type === 'tautulli' && config.plexUserId && config.plexLibraryId) {
        // Show existing selections
        setTautulliData({
          users: [{ userId: config.plexUserId, username: config.plexUserName || 'User', friendlyName: config.plexUserName || 'User', isAdmin: false }],
          libraries: [{ sectionId: config.plexLibraryId, sectionName: config.plexLibraryName || 'Library', sectionType: 'artist', count: 0 }],
        });
        setTautulliTested(true);
      }
      
      // Set up Jellyfin data if editing a Jellyfin connection
      if (connection.type === 'jellyfin' && config.jellyfinUserId) {
        // Show existing selections
        setJellyfinData({
          users: [{ userId: config.jellyfinUserId, username: config.jellyfinUserName || 'User', isAdmin: false }],
          libraries: config.jellyfinLibraryId ? [{ libraryId: config.jellyfinLibraryId, name: config.jellyfinLibraryName || 'Library', type: 'music' }] : [],
        });
        setJellyfinTested(true);
      }
    } else {
      setEditingId(null);
      setForm({
        type: defaultType || 'lidarr',
        name: '',
        url: '',
        apiKey: '',
        clientId: '',
        clientSecret: '',
        qualityProfileId: '',
        rootFolderPath: '',
        monitorOption: 'all',
        monitorNewItems: 'all',
        searchOnAdd: true,
        lastfmUsername: '',
        tautulliUrl: '',
        tautulliApiKey: '',
        plexUserId: '',
        plexLibraryId: '',
        jellyfinUrl: '',
        jellyfinApiKey: '',
        jellyfinUserId: '',
        jellyfinLibraryId: '',
        listenbrainzUsername: '',
        listenbrainzToken: '',
        discogsToken: '',
        slskdUrl: '',
        slskdApiKey: '',
        slskdDownloadDir: '',
        slskdMusicLibraryDir: '',
      });
    }
    setLidarrData(null);
    if (!connection || connection.type !== 'tautulli') {
      setTautulliData(null);
      setTautulliTested(false);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setShowPassword(false);
    setLidarrData(null);
    setTautulliData(null);
    setTautulliTested(false);
  };

  const typeConfig = connectionTypes.find(t => t.value === form.type);

  // Check if this is a fresh setup (no connections yet) and not dismissed
  const showWelcomeBanner = connections.length === 0 && !welcomeDismissed;

  return (
    <>
      <PageHeader
        title="Connections"
        description="Configure your service connections"
      >
        <Button onClick={() => openModal()}>
          <Plus className="h-4 w-4 mr-2" /> Add Connection
        </Button>
      </PageHeader>

      {/* First-time setup welcome banner */}
      {showWelcomeBanner && (
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <h3 className="font-semibold text-lg">Welcome to Mixarr!</h3>
                <p className="text-muted-foreground">
                  Your account is ready. To get started, you'll need to connect at least:
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li><strong>Lidarr</strong> – Required to manage and download music to your library</li>
                  <li><strong>Last.fm, Spotify, or another source</strong> – To discover and import music</li>
                </ul>
                <p className="text-sm text-muted-foreground pt-2">
                  Click "Configure" on any service below to add your first connection.
                </p>
              </div>
              <button
                onClick={handleDismissWelcome}
                className="shrink-0 rounded-md p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss welcome message"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connection Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {connectionTypes.map((type) => (
          <ConnectionCard
            key={type.value}
            typeConfig={type}
            connections={connections.filter(c => c.type === type.value)}
            isAdmin={user?.role === 'admin'}
            onAdd={(t) => openModal(undefined, t as Connection['type'])}
            onEdit={(id) => {
              const conn = connections.find(c => c.id === id);
              if (conn) openModal(conn);
            }}
            onTest={(id) => handleTest(id)}
            onDelete={(id) => handleDelete(id)}
            testingId={testingId}
            onPreview={(id, t) => handlePreview(id, t)}
          />
        ))}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Edit Connection' : 'Add Connection'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Type</label>
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as Connection['type'] })}
              options={connectionTypes.map(t => ({ value: t.value, label: t.label }))}
              disabled={!!editingId}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={typeConfig?.label}
            />
          </div>

          {form.type === 'lidarr' && (
            <>
              <div>
                <label className="text-sm font-medium">URL</label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="http://localhost:8686"
                />
              </div>
              <div>
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
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
              {!lidarrData && form.url && form.apiKey && (
                <Button 
                  variant="outline" 
                  onClick={() => fetchLidarrData()}
                  className="w-full"
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Fetch Lidarr Options
                </Button>
              )}

              {/* Lidarr-specific settings - only show after fetching options */}
              {(lidarrData || editingId) && (
                <>
                  <div className="border-t pt-4 mt-2">
                    <h4 className="text-sm font-medium mb-3">Lidarr Import Settings</h4>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium">Quality Profile</label>
                    <Select
                      value={form.qualityProfileId}
                      onChange={(e) => setForm({ ...form, qualityProfileId: e.target.value })}
                      options={[
                        { value: '', label: 'Select a quality profile...' },
                        ...(lidarrData?.qualityProfiles?.map(p => ({ value: String(p.id), label: p.name })) || [])
                      ]}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Quality profile for new artists</p>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Root Folder</label>
                    <Select
                      value={form.rootFolderPath}
                      onChange={(e) => setForm({ ...form, rootFolderPath: e.target.value })}
                      options={[
                        { value: '', label: 'Select a root folder...' },
                        ...(lidarrData?.rootFolders?.map(f => ({ value: f.path, label: f.path })) || [])
                      ]}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Root folder for new artists</p>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Monitor Existing Albums</label>
                    <Select
                      value={form.monitorOption}
                      onChange={(e) => setForm({ ...form, monitorOption: e.target.value })}
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
                      value={form.monitorNewItems}
                      onChange={(e) => setForm({ ...form, monitorNewItems: e.target.value })}
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
                      <p className="text-xs text-muted-foreground">Automatically search for albums when adding artists</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.searchOnAdd}
                      onChange={(e) => setForm({ ...form, searchOnAdd: e.target.checked })}
                      className="h-4 w-4"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {form.type === 'spotify' && (
            <>
              {/* Redirect URI info box */}
              <div className="p-3 bg-muted/50 rounded-lg border">
                <p className="text-sm font-medium mb-1">Spotify App Setup</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Add this Redirect URI to your Spotify app settings:
                </p>
                <code className="text-xs bg-background p-2 rounded block break-all select-all">
                  {editingId 
                    ? `${baseUrl || window.location.origin}/api/connections/${editingId}/spotify/callback`
                    : `${baseUrl || window.location.origin}/api/connections/[ID]/spotify/callback`
                  }
                </code>
                {!editingId && (
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
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  placeholder="Spotify client ID"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Client Secret</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.clientSecret}
                    onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
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
          )}

          {form.type === 'lastfm' && (
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
                  value={form.lastfmUsername}
                  onChange={(e) => setForm({ ...form, lastfmUsername: e.target.value })}
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
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
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
          )}

          {form.type === 'listenbrainz' && (
            <>
              <div className="p-3 bg-muted/50 rounded-lg border">
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
                  value={form.listenbrainzUsername}
                  onChange={(e) => setForm({ ...form, listenbrainzUsername: e.target.value })}
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
                    value={form.listenbrainzToken}
                    onChange={(e) => setForm({ ...form, listenbrainzToken: e.target.value })}
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
            </>
          )}

          {form.type === 'discogs' && (
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
                    value={form.discogsToken}
                    onChange={(e) => setForm({ ...form, discogsToken: e.target.value })}
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
          )}

          {form.type === 'tautulli' && (
            <>
              <div>
                <label className="text-sm font-medium">Tautulli URL</label>
                <Input
                  value={form.tautulliUrl}
                  onChange={(e) => { setForm({ ...form, tautulliUrl: e.target.value }); setTautulliTested(false); }}
                  placeholder="http://localhost:8181"
                />
              </div>
              <div>
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.tautulliApiKey}
                    onChange={(e) => { setForm({ ...form, tautulliApiKey: e.target.value }); setTautulliTested(false); }}
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
                disabled={!form.tautulliUrl || !form.tautulliApiKey}
                className="w-full"
              >
                <TestTube2 className="h-4 w-4 mr-2" />
                {tautulliTested ? 'Re-test Connection' : 'Test Connection & Load Options'}
              </Button>

              {tautulliData && (
                <>
                  <div>
                    <label className="text-sm font-medium">Plex User</label>
                    <Select
                      value={form.plexUserId}
                      onChange={(e) => setForm({ ...form, plexUserId: e.target.value })}
                      options={tautulliData.users.map(u => ({ 
                        value: u.userId.toString(), 
                        label: u.friendlyName || u.username 
                      }))}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Listening history will be fetched for this user
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Music Library</label>
                    <Select
                      value={form.plexLibraryId}
                      onChange={(e) => setForm({ ...form, plexLibraryId: e.target.value })}
                      options={tautulliData.libraries.map(l => ({ 
                        value: l.sectionId.toString(), 
                        label: `${l.sectionName} (${l.count} artists)` 
                      }))}
                    />
                  </div>
                </>
              )}

              {!tautulliTested && (
                <p className="text-xs text-muted-foreground text-center">
                  Test connection to select Plex user and library
                </p>
              )}
            </>
          )}

          {form.type === 'jellyfin' && (
            <>
              <div>
                <label className="text-sm font-medium">Jellyfin URL</label>
                <Input
                  value={form.jellyfinUrl}
                  onChange={(e) => { setForm({ ...form, jellyfinUrl: e.target.value }); setJellyfinTested(false); }}
                  placeholder="http://localhost:8096"
                />
              </div>
              <div>
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.jellyfinApiKey}
                    onChange={(e) => { setForm({ ...form, jellyfinApiKey: e.target.value }); setJellyfinTested(false); }}
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
                disabled={!form.jellyfinUrl || !form.jellyfinApiKey}
                className="w-full"
              >
                <TestTube2 className="h-4 w-4 mr-2" />
                {jellyfinTested ? 'Re-test Connection' : 'Test Connection & Load Options'}
              </Button>

              {jellyfinData && (
                <>
                  <div>
                    <label className="text-sm font-medium">Jellyfin User</label>
                    <Select
                      value={form.jellyfinUserId}
                      onChange={(e) => setForm({ ...form, jellyfinUserId: e.target.value })}
                      options={jellyfinData.users.map(u => ({ 
                        value: u.userId, 
                        label: u.username + (u.isAdmin ? ' (Admin)' : '')
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
                        value={form.jellyfinLibraryId}
                        onChange={(e) => setForm({ ...form, jellyfinLibraryId: e.target.value })}
                        options={[
                          { value: '', label: 'All Libraries' },
                          ...jellyfinData.libraries.map(l => ({ 
                            value: l.libraryId, 
                            label: l.name 
                          }))
                        ]}
                      />
                    </div>
                  )}
                </>
              )}

              {!jellyfinTested && (
                <p className="text-xs text-muted-foreground text-center">
                  Test connection to select Jellyfin user and library
                </p>
              )}
            </>
          )}

          {form.type === 'deezer' && (
            <>
              {/* Redirect URI info box */}
              <div className="p-3 bg-muted/50 rounded-lg border">
                <p className="text-sm font-medium mb-1">Deezer App Setup</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Add this Redirect URI to your Deezer app settings:
                </p>
                <code className="text-xs bg-background p-2 rounded block break-all select-all">
                  {editingId 
                    ? `${baseUrl || window.location.origin}/api/connections/${editingId}/deezer/callback`
                    : `${baseUrl || window.location.origin}/api/connections/[ID]/deezer/callback`
                  }
                </code>
                {!editingId && (
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
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  placeholder="Deezer Application ID"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Secret Key</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.clientSecret}
                    onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
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
          )}

          {form.type === 'tidal' && (
            <>
              {/* Redirect URI info box */}
              <div className="p-3 bg-muted/50 rounded-lg border">
                <p className="text-sm font-medium mb-1">TIDAL App Setup</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Add this Redirect URI to your TIDAL developer app:
                </p>
                <code className="text-xs bg-background p-2 rounded block break-all select-all">
                  {editingId 
                    ? `${baseUrl || window.location.origin}/api/connections/${editingId}/tidal/callback`
                    : `${baseUrl || window.location.origin}/api/connections/[ID]/tidal/callback`
                  }
                </code>
                {!editingId && (
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    Save this connection first, then the exact URI will be shown.
                  </p>
                )}
                <a 
                  href="https://developer.tidal.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
                >
                  <ExternalLink className="h-3 w-3" /> TIDAL Developer Portal
                </a>
              </div>

              <div>
                <label className="text-sm font-medium">Client ID</label>
                <Input
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  placeholder="TIDAL Client ID"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Client Secret</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.clientSecret}
                    onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                    placeholder="TIDAL Client Secret"
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
          )}

          {form.type === 'slskd' && (
            <>
              <div className="p-3 bg-muted/50 rounded-lg border">
                <p className="text-sm font-medium mb-1">slskd Setup</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Connect to your slskd instance for Soulseek downloads. Get your API key from slskd Settings → Options → Web.
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
                  value={form.slskdUrl}
                  onChange={(e) => setForm({ ...form, slskdUrl: e.target.value })}
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
                    value={form.slskdApiKey}
                    onChange={(e) => setForm({ ...form, slskdApiKey: e.target.value })}
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
                  value={form.slskdDownloadDir}
                  onChange={(e) => setForm({ ...form, slskdDownloadDir: e.target.value })}
                  placeholder="/downloads"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Where slskd downloads files (must match slskd config)
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Music Library Directory</label>
                <Input
                  value={form.slskdMusicLibraryDir}
                  onChange={(e) => setForm({ ...form, slskdMusicLibraryDir: e.target.value })}
                  placeholder="/music"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Where to organize completed downloads
                </p>
              </div>
            </>
          )}
        </div>
        <ModalFooter>
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
