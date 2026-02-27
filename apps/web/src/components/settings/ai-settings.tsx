'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import Brain from 'lucide-react/dist/esm/icons/brain';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import Save from 'lucide-react/dist/esm/icons/save';

interface AISettingsData {
  openaiEnabled: boolean;
  openaiConfigured: boolean;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  anthropicEnabled: boolean;
  anthropicConfigured: boolean;
  anthropicApiKey?: string;
}

export function AISettings() {
  const [settings, setSettings] = useState<AISettingsData>({
    openaiEnabled: false,
    openaiConfigured: false,
    anthropicEnabled: false,
    anthropicConfigured: false,
  });
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiModel, setOpenaiModel] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToast();

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get<{ settings: AISettingsData }>('/api/ai/settings');
      if (data) {
        setSettings(data.settings);
        if (data.settings.openaiApiKey) {
          setOpenaiKey(data.settings.openaiApiKey);
        }
        if (data.settings.openaiBaseUrl) {
          setOpenaiBaseUrl(data.settings.openaiBaseUrl);
        }
        if (data.settings.openaiModel) {
          setOpenaiModel(data.settings.openaiModel);
        }
        if (data.settings.anthropicApiKey) {
          setAnthropicKey(data.settings.anthropicApiKey);
        }
      }
    } catch {
      addToast({ type: 'error', title: 'Failed to load AI settings' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await api.put('/api/ai/settings', {
        openaiEnabled: settings.openaiEnabled,
        openaiApiKey: openaiKey || undefined,
        openaiBaseUrl: openaiBaseUrl || undefined,
        openaiModel: openaiModel || undefined,
        anthropicEnabled: settings.anthropicEnabled,
        anthropicApiKey: anthropicKey || undefined,
      });

      if (error) {
        addToast({ type: 'error', title: 'Failed to save AI settings', message: error });
      } else {
        addToast({ type: 'success', title: 'AI settings saved' });
        fetchSettings();
      }
    } catch {
      addToast({ type: 'error', title: 'Failed to save AI settings' });
    }
    setIsSaving(false);
  };

  const handleToggle = (key: 'openaiEnabled' | 'anthropicEnabled') => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Integration</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Integration</CardTitle>
              <CardDescription>
                Configure AI-powered artist recommendations using OpenAI or Anthropic
              </CardDescription>
            </div>
          </div>
          <Button onClick={handleSave} disabled={isSaving} size="sm">
            <Save className="h-4 w-4 mr-2" /> {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* OpenAI Section */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">OpenAI-Compatible</h3>
              <p className="text-sm text-muted-foreground">
                Use OpenAI, Ollama, LiteLLM, OpenRouter, or other compatible providers
              </p>
            </div>
            <button
              onClick={() => handleToggle('openaiEnabled')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.openaiEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-foreground transition-transform ${
                  settings.openaiEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {settings.openaiEnabled && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showOpenaiKey ? 'text' : 'password'}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder={settings.openaiConfigured ? '••••••••••••••••' : 'sk-...'}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Required for OpenAI. Optional when using a custom base URL (e.g., Ollama).
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Base URL (Optional)</label>
                <Input
                  type="text"
                  value={openaiBaseUrl}
                  onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1 (default)"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty for OpenAI. For Ollama use http://localhost:11434/v1
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Model (Optional)</label>
                <Input
                  type="text"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  placeholder="gpt-3.5-turbo (default)"
                />
                <p className="text-xs text-muted-foreground">
                  Model name varies by provider (e.g., llama3.2, mistral, gpt-4o)
                </p>
              </div>

              {settings.openaiConfigured && (
                <p className="text-xs text-green-600">✓ OpenAI-compatible provider configured</p>
              )}
            </>
          )}
        </div>

        {/* Anthropic Section */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Anthropic (Claude)</h3>
              <p className="text-sm text-muted-foreground">
                Use Anthropic&apos;s Claude models for recommendations
              </p>
            </div>
            <button
              onClick={() => handleToggle('anthropicEnabled')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.anthropicEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-foreground transition-transform ${
                  settings.anthropicEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {settings.anthropicEnabled && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showAnthropicKey ? 'text' : 'password'}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder={settings.anthropicConfigured ? '••••••••••••••••' : 'sk-ant-...'}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {settings.anthropicConfigured && (
                  <p className="text-xs text-green-600">✓ API key configured</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Info */}
        <div className="rounded-lg bg-status-info/10 p-4 text-sm">
          <p className="font-medium text-status-info">About AI Recommendations</p>
          <p className="mt-1 text-status-info">
            AI recommendations analyze your library and listening patterns to suggest new artists.
            Configure AI recommendation strategy per-subscription when creating an AI Recommendations subscription.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
