'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, useToast, Select } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { AISettings } from '@/components/settings/ai-settings';
import { api } from '@/lib/api';
import { Settings as SettingsIcon, Save, RefreshCw, Bell, Globe, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';

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
  value: any;
  defaultValue: any;
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
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [globalSettings, setGlobalSettings] = useState<Record<string, any>>({});
  const [, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const { addToast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && user && !isAdmin) {
      router.replace('/');
    }
  }, [user, isAdmin, authLoading, router]);

  const fetchSettings = async () => {
    setIsLoading(true);
    const { data } = await api.get<{ settings: Record<string, any> }>('/api/settings');
    if (data) {
      setSettings(data.settings);
    }
    setIsLoading(false);
  };

  const fetchGlobalSettings = async () => {
    if (!isAdmin) return;
    const { data } = await api.get<{ settings: Record<string, any> }>('/api/settings/global');
    if (data) {
      setGlobalSettings(data.settings);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchGlobalSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleGlobalChange = (key: string, value: any) => {
    setGlobalSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const { error } = await api.put('/api/settings', { settings });
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to save settings', message: error });
    } else {
      addToast({ type: 'success', title: 'Settings saved' });
    }
    setIsSaving(false);
  };

  const handleSaveGlobal = async () => {
    setIsSavingGlobal(true);
    
    // Save each global setting
    for (const [key, value] of Object.entries(globalSettings)) {
      const { error } = await api.put(`/api/settings/global/${key}`, { value });
      if (error) {
        addToast({ type: 'error', title: 'Failed to save global settings', message: error });
        setIsSavingGlobal(false);
        return;
      }
    }
    
    addToast({ type: 'success', title: 'Global settings saved' });
    setIsSavingGlobal(false);
  };

  const handleReset = () => {
    const defaults: Record<string, any> = {};
    settingGroups.forEach(group => {
      group.settings.forEach(setting => {
        defaults[setting.key] = setting.defaultValue;
      });
    });
    setSettings(defaults);
  };

  const getValue = (key: string, defaultValue: any) => {
    return settings[key] ?? defaultValue;
  };

  // Don't render anything for non-admin users (they'll be redirected)
  if (authLoading || !user || !isAdmin) {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure application behavior"
      >
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleReset}>
            <RefreshCw className="h-4 w-4 mr-2" /> Reset
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" /> {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-6">
        {/* AI Integration Settings */}
        <AISettings />

        {settingGroups.map((group) => {
          const GroupIcon = group.icon;
          return (
            <Card key={group.key}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
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
                      <label className="font-medium">{setting.label}</label>
                      {setting.description && (
                        <p className="text-sm text-muted-foreground">{setting.description}</p>
                      )}
                    </div>
                    <div className="w-full sm:w-64">
                      {setting.type === 'string' && (
                        <Input
                          value={getValue(setting.key, setting.defaultValue)}
                          onChange={(e) => handleChange(setting.key, e.target.value)}
                        />
                      )}
                      {setting.type === 'number' && (
                        <Input
                          type="number"
                          value={getValue(setting.key, setting.defaultValue)}
                          onChange={(e) => handleChange(setting.key, parseInt(e.target.value, 10))}
                        />
                      )}
                      {setting.type === 'boolean' && (
                        <button
                          onClick={() => handleChange(setting.key, !getValue(setting.key, setting.defaultValue))}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            getValue(setting.key, setting.defaultValue) ? 'bg-primary' : 'bg-muted'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              getValue(setting.key, setting.defaultValue) ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      )}
                      {setting.type === 'select' && setting.options && (
                        <Select
                          value={getValue(setting.key, setting.defaultValue)}
                          onChange={(e) => handleChange(setting.key, e.target.value)}
                          options={setting.options}
                        />
                      )}
                    </div>
                  </div>
                ))}
                {group.key === 'notifications' && (
                  <Link 
                    href="/settings/notifications"
                    className="flex items-center justify-between py-3 px-4 -mx-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors mt-4"
                  >
                    <div>
                      <div className="font-medium">Notification Channels</div>
                      <div className="text-sm text-muted-foreground">
                        Configure Discord, webhooks, and other notification destinations
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Global Settings (Admin only) */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
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
                  <label className="font-medium">Base URL</label>
                  <p className="text-sm text-muted-foreground">
                    The public URL of this application. Used for OAuth callbacks (e.g., Spotify).
                  </p>
                </div>
                <div className="w-full sm:w-80">
                  <Input
                    value={globalSettings.baseUrl || ''}
                    onChange={(e) => handleGlobalChange('baseUrl', e.target.value)}
                    placeholder="http://192.168.1.245:3010"
                  />
                </div>
              </div>
              
              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveGlobal} disabled={isSavingGlobal}>
                  <Save className="h-4 w-4 mr-2" /> {isSavingGlobal ? 'Saving...' : 'Save Global Settings'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
