'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Select } from '@/components/ui/select';
import { Skeleton, Switch } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { AISettings } from '@/components/settings/ai-settings';
import { SSOSettings } from '@/components/settings/sso-settings';
import { api } from '@/lib/api';
import Bell from 'lucide-react/dist/esm/icons/bell';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Globe from 'lucide-react/dist/esm/icons/globe';
import Save from 'lucide-react/dist/esm/icons/save';
import SettingsIcon from 'lucide-react/dist/esm/icons/settings';
import Shield from 'lucide-react/dist/esm/icons/shield';
import Info from 'lucide-react/dist/esm/icons/info';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { APP_VERSION } from '@/lib/constants';

type SettingValue = string | number | boolean;

interface SettingGroup {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  settings: Setting[];
}

interface Setting {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  options?: Array<{ value: string; label: string }>;
  value: SettingValue;
  defaultValue: SettingValue;
}

const settingGroups: SettingGroup[] = [
  {
    key: 'general',
    label: 'General',
    description: 'Basic application settings',
    icon: SettingsIcon,
    settings: [
      {
        key: 'defaultResultHandling',
        label: 'Default Import Handling',
        description: 'How new imports are handled by default',
        type: 'select',
        options: [
          { value: 'preview', label: 'Preview only' },
          { value: 'queue', label: 'Add to review queue' },
          { value: 'auto', label: 'Auto-add to Lidarr' },
        ],
        value: 'queue',
        defaultValue: 'queue',
      },
      {
        key: 'maxConcurrentJobs',
        label: 'Max Concurrent Jobs',
        description: 'Maximum number of jobs to run at once',
        type: 'number',
        value: 3,
        defaultValue: 3,
      },
    ],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Configure notification preferences',
    icon: Bell,
    settings: [
      {
        key: 'notifyOnComplete',
        label: 'Notify on Job Complete',
        type: 'boolean',
        value: true,
        defaultValue: true,
      },
      {
        key: 'notifyOnError',
        label: 'Notify on Error',
        type: 'boolean',
        value: true,
        defaultValue: true,
      },
    ],
  },
];

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string, SettingValue>>({});
  const [globalSettings, setGlobalSettings] = useState({ baseUrl: '' });
  const [baseline, setBaseline] = useState<Record<string, SettingValue>>({});
  const [globalBaseline, setGlobalBaseline] = useState({ baseUrl: '' });
  const [loadedPersonal, setLoadedPersonal] = useState(false);
  const [loadedGlobal, setLoadedGlobal] = useState(false);
  const [loadingPersonal, setLoadingPersonal] = useState(true);
  const [loadingGlobal, setLoadingGlobal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const dirty = JSON.stringify(settings) !== JSON.stringify(baseline);
  const globalDirty = JSON.stringify(globalSettings) !== JSON.stringify(globalBaseline);
  useUnsavedChanges(dirty || globalDirty);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const { addToast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Fetch version and update status
  const { data: healthData } = useQuery<{
    version?: string;
    update?: { latest: string; url: string } | null;
  }>({
    queryKey: ['health-live'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/health/live', { signal });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && user && !isAdmin) {
      router.replace('/');
    }
  }, [user, isAdmin, authLoading, router]);

  useEffect(() => {
    if (!isAdmin) return;
    let current = true;
    void api.get<{ settings: Record<string, SettingValue> }>('/api/settings').then(({ data, error }) => {
      if (!current) return;
      const stored = data?.settings;
      const valid = stored && typeof stored === 'object' && !Array.isArray(stored) && settingGroups.every(group => group.settings.every(setting => {
        const value = stored[setting.key];
        return value == null || (typeof value === typeof setting.defaultValue && (typeof value !== 'number' || Number.isFinite(value)) && (!setting.options || setting.options.some(option => option.value === value)));
      }));
      if (error || !valid) { setError(error || 'Failed to load personal settings: invalid response.'); setLoadingPersonal(false); return; }
      const initial = Object.fromEntries(settingGroups.flatMap(group => group.settings.map(setting => [setting.key, stored[setting.key] ?? setting.defaultValue])));
      setLoadedPersonal(true); setSettings(initial); setBaseline(initial);
      setError(null); setLoadingPersonal(false);
    });
    void api.get<{ settings: Record<string, SettingValue> }>('/api/settings/global').then(({ data, error }) => {
      if (!current) return;
      const stored = data?.settings;
      const valid = stored && typeof stored === 'object' && !Array.isArray(stored) && (stored.baseUrl == null || typeof stored.baseUrl === 'string');
      if (error || !valid) { setGlobalError(error || 'Failed to load global settings: invalid response.'); setLoadingGlobal(false); return; }
      const initial = { baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : '' };
      setLoadedGlobal(true); setGlobalSettings(initial); setGlobalBaseline(initial);
      setGlobalError(null); setLoadingGlobal(false);
    });
    return () => { current = false; };
  }, [isAdmin]);

  const handleChange = (key: string, value: SettingValue) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleGlobalChange = (key: string, value: string) => {
    setGlobalSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (isSaving || !loadedPersonal) return;
    if (typeof settings.maxConcurrentJobs !== 'number' || !Number.isInteger(settings.maxConcurrentJobs) || settings.maxConcurrentJobs < 1) {
      setError('Max Concurrent Jobs must be a positive integer.'); document.getElementById('maxConcurrentJobs')?.focus(); return;
    }
    const submitted = { ...settings };
    setIsSaving(true); setError(null);
    const { error } = await api.put('/api/settings', { settings: submitted });
    if (!active.current) return;
    setError(error);
    if (!error) { setBaseline(submitted); addToast({ type: 'success', title: 'Personal settings saved' }); }
    setIsSaving(false);
  };

  const handleSaveGlobal = async () => {
    if (isSavingGlobal || !loadedGlobal) return;
    const submitted = { ...globalSettings };
    if (submitted.baseUrl) {
      try { const url = new URL(submitted.baseUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
      catch { setGlobalError('Base URL must be an HTTP or HTTPS URL.'); document.getElementById('global-base-url')?.focus(); return; }
    }
    setIsSavingGlobal(true); setGlobalError(null);
    const { error } = await api.put('/api/settings/global', { settings: submitted });
    if (!active.current) return;
    setGlobalError(error);
    if (!error) { setGlobalBaseline(submitted); addToast({ type: 'success', title: 'Global settings saved' }); }
    setIsSavingGlobal(false);
  };

  const handleReset = () => {
    const defaults: Record<string, SettingValue> = {};
    settingGroups.forEach(group => {
      group.settings.forEach(setting => {
        defaults[setting.key] = setting.defaultValue;
      });
    });
    setSettings(defaults);
  };

  const getValue = (key: string, defaultValue: SettingValue) => {
    return settings[key] ?? defaultValue;
  };

  // Show skeleton while auth is loading
  if (authLoading || (isAdmin && (loadingPersonal || loadingGlobal))) {
    return (
      <div className="space-y-8 max-w-4xl">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-container border bg-card p-6 space-y-4">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-6 w-11 rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Don't render anything for non-admin users (they'll be redirected)
  if (!user || !isAdmin) {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure application behavior"
      >
      </PageHeader>

      <div className="space-y-6">
        {/* AI Integration Settings */}
        <AISettings />

        {/* SSO Settings (Admin only) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-container bg-primary/10 p-2 text-primary">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Single Sign-On</CardTitle>
                <CardDescription>Configure LDAP, SAML, Google, and Plex authentication</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <SSOSettings />
          </CardContent>
        </Card>

        <section aria-label="Personal settings" className="space-y-4">
        <h2 className="text-lg font-semibold">Personal settings</h2>
        {settingGroups.map((group) => {
          const GroupIcon = group.icon;
          return (
            <Card key={group.key}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-container bg-primary/10 p-2 text-primary">
                    <GroupIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{group.label}</CardTitle>
                    <CardDescription>{group.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {group.settings.map((setting) => (
                  <div key={setting.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 border-b last:border-0">
                    <div className="flex-1">
                      <label htmlFor={setting.key} className="font-medium">{setting.label}</label>
                      {setting.description && (
                        <p className="text-sm text-muted-foreground">{setting.description}</p>
                      )}
                    </div>
                    <div className="w-full sm:w-64">
                      {setting.type === 'string' && (
                        <Input id={setting.key}
                          value={String(getValue(setting.key, setting.defaultValue))}
                          onChange={(e) => handleChange(setting.key, e.target.value)}
                        />
                      )}
                      {setting.type === 'number' && (
                        <Input id={setting.key}
                          type="number"
                          value={String(getValue(setting.key, setting.defaultValue))}
                          onChange={(e) => handleChange(setting.key, e.target.value === '' ? '' : Number(e.target.value))}
                        />
                      )}
                      {setting.type === 'boolean' && (
                        <Switch
                          checked={getValue(setting.key, setting.defaultValue) as boolean}
                          onChange={(val) => handleChange(setting.key, val)}
                          label={setting.label}
                        />
                      )}
                      {setting.type === 'select' && setting.options && (
                        <Select id={setting.key}
                          value={String(getValue(setting.key, setting.defaultValue))}
                          onChange={(e) => handleChange(setting.key, e.target.value)}
                          options={setting.options}
                        />
                      )}
                    </div>
                  </div>
                ))}
                {group.key === 'notifications' && (
                  <>
                  <p role={error ? 'alert' : 'status'} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{error || (isSaving ? 'Saving personal settings…' : dirty ? 'Unsaved personal settings changes' : loadedPersonal ? 'Personal settings saved' : 'Personal settings unavailable')}</p>
                  <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={handleReset} disabled={!loadedPersonal}>Restore personal defaults</Button><Button onClick={handleSave} disabled={isSaving || !dirty || !loadedPersonal}>Save personal settings</Button></div>
                  <a
                    href="/settings/notifications"
                    className="flex items-center justify-between py-3 px-4 -mx-4 bg-muted/50 rounded-container hover:bg-muted transition-colors mt-4"
                  >
                    <div>
                      <div className="font-medium">Notification Channels</div>
                      <div className="text-sm text-muted-foreground">
                        Configure Discord, webhooks, and other notification destinations
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </a>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}

        </section>

        {/* Global Settings (Admin only) */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-container bg-primary/10 p-2 text-primary">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">Global Settings</CardTitle>
                  <CardDescription>System-wide configuration (Admin only)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 border-b">
                <div className="flex-1">
                  <label htmlFor="global-base-url" className="font-medium">Base URL</label>
                  <p className="text-sm text-muted-foreground">
                    The public URL of this application. Used for OAuth callbacks (e.g., Spotify).
                  </p>
                </div>
                <div className="w-full sm:w-80">
                  <Input id="global-base-url" error={globalError || undefined}
                    value={globalSettings.baseUrl || ''}
                    onChange={(e) => handleGlobalChange('baseUrl', e.target.value)}
                    placeholder="http://192.168.1.245:3010"
                  />
                </div>
              </div>
              
              <p role={globalError ? "alert" : "status"} className="text-sm text-muted-foreground">{globalError || (isSavingGlobal ? "Saving global settings…" : globalDirty ? "Unsaved global settings changes" : loadedGlobal ? "Global settings saved" : "Global settings unavailable")}</p>
              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveGlobal} disabled={isSavingGlobal || !globalDirty || !loadedGlobal}>
                  <Save className="h-4 w-4 mr-2" /> {isSavingGlobal ? 'Saving...' : 'Save Global Settings'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* About */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-container bg-primary/10 p-2 text-primary">
                <Info className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">About Mixarr</CardTitle>
                <CardDescription>Version and update information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium">Version</p>
                <p className="text-sm text-muted-foreground">v{healthData?.version || APP_VERSION}</p>
              </div>
              {healthData?.update && (
                <a
                  href={healthData.update.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  v{healthData.update.latest} available →
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
