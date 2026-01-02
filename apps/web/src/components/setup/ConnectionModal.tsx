'use client';

import { useState } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { Check, Loader2, X, ExternalLink, RefreshCw } from 'lucide-react';

type ConnectionType = 'lidarr' | 'spotify' | 'lastfm';

interface LidarrOptions {
  qualityProfiles: Array<{ id: number; name: string }>;
  rootFolders: Array<{ id: number; path: string }>;
}

interface ConnectionModalProps {
  type: ConnectionType;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  baseUrl: string;
  isSetupMode?: boolean;
}

const connectionConfig = {
  lidarr: {
    title: 'Configure Lidarr',
    color: '#62BC50',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'http://localhost:8686', type: 'text' },
      { key: 'apiKey', label: 'API Key', placeholder: 'Your Lidarr API key', type: 'password' },
    ],
    helpText: 'Found in Lidarr → Settings → General → API Key',
    helpUrl: null,
  },
  spotify: {
    title: 'Configure Spotify',
    color: '#1DB954',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Your Spotify Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Your Spotify Client Secret', type: 'password' },
    ],
    helpText: 'Create an app at developer.spotify.com',
    helpUrl: 'https://developer.spotify.com/dashboard',
  },
  lastfm: {
    title: 'Configure Last.fm',
    color: '#D51007',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Your Last.fm API key', type: 'password' },
    ],
    helpText: 'Get API key at last.fm/api/account',
    helpUrl: 'https://www.last.fm/api/account/create',
  },
};

export function ConnectionModal({ type, isOpen, onClose, onSuccess, baseUrl, isSetupMode = false }: ConnectionModalProps) {
  const config = connectionConfig[type];
  const [form, setForm] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [lidarrOptions, setLidarrOptions] = useState<LidarrOptions | null>(null);
  const [isFetchingOptions, setIsFetchingOptions] = useState(false);

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');

    const payload = {
      type,
      ...form,
      name: type.charAt(0).toUpperCase() + type.slice(1),
    };

    const { data, error } = await api.post<{ success: boolean; error?: string }>('/api/connections/test', payload);

    if (error || !data?.success) {
      setTestStatus('error');
      setTestError(error || data?.error || 'Connection test failed');
      return;
    }

    setTestStatus('success');
    
    // For Lidarr, automatically fetch options after successful test
    if (type === 'lidarr') {
      fetchLidarrOptions();
    }
  };

  const fetchLidarrOptions = async () => {
    if (!form.url || !form.apiKey) return;
    
    setIsFetchingOptions(true);
    // Use setup endpoint during onboarding (doesn't require auth)
    const endpoint = isSetupMode 
      ? '/api/connections/setup/test-lidarr' 
      : '/api/connections/test-lidarr';
    const { data } = await api.post<{ 
      success: boolean;
      qualityProfiles?: Array<{ id: number; name: string }>;
      rootFolders?: Array<{ id: number; path: string }>;
    }>(endpoint, { url: form.url, apiKey: form.apiKey });
    
    if (data?.success) {
      setLidarrOptions({
        qualityProfiles: data.qualityProfiles || [],
        rootFolders: data.rootFolders || [],
      });
    }
    setIsFetchingOptions(false);
  };

  const handleSave = async () => {
    setIsSaving(true);

    // Build config with Lidarr-specific settings if applicable
    const configData: Record<string, string> = { ...form };
    if (type === 'lidarr') {
      // Include quality profile and root folder in config
      if (form.qualityProfileId) configData.qualityProfileId = form.qualityProfileId;
      if (form.rootFolderPath) configData.rootFolderPath = form.rootFolderPath;
      if (form.monitorOption) configData.monitorOption = form.monitorOption;
    }

    const payload = {
      type,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      config: configData,
    };

    // Use setup endpoint during onboarding (doesn't require auth)
    const endpoint = isSetupMode 
      ? '/api/connections/setup' 
      : '/api/connections';
    
    const { data, error } = await api.post<{ success: boolean; connection: { id: number } }>(endpoint, payload);

    if (error || !data?.connection?.id) {
      setTestError(error || 'Failed to save connection');
      setIsSaving(false);
      return;
    }

    // For Spotify in setup mode, redirect to OAuth authorization
    if (type === 'spotify' && isSetupMode) {
      // Get the auth URL with returnTo pointing back to setup page - use setup endpoint
      const returnTo = encodeURIComponent('/setup?spotify_authorized=true');
      const { data: authData, error: authError } = await api.get<{ authUrl: string }>(
        `/api/connections/setup/${data.connection.id}/spotify/auth?returnTo=${returnTo}`
      );
      
      if (authData?.authUrl) {
        // Redirect to Spotify OAuth - will return to /setup after authorization
        window.location.href = authData.authUrl;
        return;
      } else {
        // If we couldn't get auth URL, still mark connection as saved but show message
        console.error('Failed to get Spotify auth URL:', authError);
        setTestError('Connection saved but authorization failed. Please authorize from the Connections page.');
        setIsSaving(false);
        onSuccess();
        handleClose();
        return;
      }
    }

    setIsSaving(false);
    onSuccess();
    handleClose();
  };

  const handleClose = () => {
    setForm({});
    setTestStatus('idle');
    setTestError('');
    setLidarrOptions(null);
    onClose();
  };

  const isFormComplete = config.fields.every(f => form[f.key]?.trim());
  
  // For Lidarr, also require quality profile and root folder to be selected
  const isLidarrComplete = type !== 'lidarr' || (form.qualityProfileId && form.rootFolderPath);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={config.title}
      size="md"
    >
      <div className="space-y-4 p-6">
        {config.fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <label className="text-sm font-medium">{field.label}</label>
            <Input
              type={field.type}
              value={form[field.key] || ''}
              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              placeholder={field.placeholder}
            />
          </div>
        ))}

        <p className="text-xs text-muted-foreground flex items-center gap-1">
          ℹ️ {config.helpText}
          {config.helpUrl && (
            <a
              href={config.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>

        {type === 'spotify' && baseUrl && (
          <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
            <p className="font-medium">Add this Redirect URI in your Spotify app:</p>
            <code className="text-primary block break-all">{baseUrl}/api/auth/spotify/callback</code>
          </div>
        )}

        {testError && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
            <X className="h-4 w-4 shrink-0" />
            {testError}
          </div>
        )}

        {testStatus === 'success' && (
          <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            Connection successful!
          </div>
        )}

        {/* Lidarr-specific settings after successful connection */}
        {type === 'lidarr' && testStatus === 'success' && (
          <div className="space-y-4 border-t pt-4">
            <h4 className="text-sm font-medium">Lidarr Import Settings</h4>
            
            {isFetchingOptions ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading options...
              </div>
            ) : lidarrOptions ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Quality Profile *</label>
                  <Select
                    value={form.qualityProfileId || ''}
                    onChange={(e) => setForm({ ...form, qualityProfileId: e.target.value })}
                    options={[
                      { value: '', label: 'Select a quality profile...' },
                      ...lidarrOptions.qualityProfiles.map(p => ({ value: String(p.id), label: p.name }))
                    ]}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Root Folder *</label>
                  <Select
                    value={form.rootFolderPath || ''}
                    onChange={(e) => setForm({ ...form, rootFolderPath: e.target.value })}
                    options={[
                      { value: '', label: 'Select a root folder...' },
                      ...lidarrOptions.rootFolders.map(f => ({ value: f.path, label: f.path }))
                    ]}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Monitor Option</label>
                  <Select
                    value={form.monitorOption || 'all'}
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
              </>
            ) : (
              <Button
                variant="outline"
                onClick={fetchLidarrOptions}
                disabled={isFetchingOptions}
                className="w-full"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Load Import Settings
              </Button>
            )}
          </div>
        )}

        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testStatus === 'testing' || !isFormComplete}
          className="w-full"
        >
          {testStatus === 'testing' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            'Test Connection'
          )}
        </Button>
      </div>

      <div className="flex justify-end gap-2 border-t p-4">
        <Button variant="outline" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={testStatus !== 'success' || isSaving || !isLidarrComplete}
          isLoading={isSaving}
        >
          Save Connection
        </Button>
      </div>
    </Modal>
  );
}
