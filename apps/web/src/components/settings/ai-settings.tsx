'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
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

  const [loaded, setLoaded] = useState(false);
  const [baseline, setBaseline] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const draft = { openaiEnabled: settings.openaiEnabled, anthropicEnabled: settings.anthropicEnabled, openaiApiKey: openaiKey, openaiBaseUrl, openaiModel, anthropicApiKey: anthropicKey };
  const dirty = loaded && JSON.stringify(draft) !== JSON.stringify(baseline);
  useUnsavedChanges(dirty);
  useEffect(() => {
    active.current = true;
    let current = true;
    void api.get<{ settings: AISettingsData }>('/api/ai/settings').then(({ data, error }) => {
      if (!current) return;
      if (data) {
        setLoaded(true); setSettings(data.settings);
        const initial = { openaiEnabled: data.settings.openaiEnabled, anthropicEnabled: data.settings.anthropicEnabled, openaiApiKey: data.settings.openaiApiKey || '', openaiBaseUrl: data.settings.openaiBaseUrl || '', openaiModel: data.settings.openaiModel || '', anthropicApiKey: data.settings.anthropicApiKey || '' };
        setOpenaiKey(initial.openaiApiKey); setOpenaiBaseUrl(initial.openaiBaseUrl); setOpenaiModel(initial.openaiModel); setAnthropicKey(initial.anthropicApiKey); setBaseline(initial);
      }
      setError(error); setIsLoading(false);
    });
    return () => { current = false; active.current = false; };
  }, []);

  const handleSave = async () => {
    if (isSaving || !loaded) return;
    if (openaiBaseUrl) {
      try { const url = new URL(openaiBaseUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
      catch { setError('Base URL must be an HTTP or HTTPS URL.'); document.getElementById('ai-base-url')?.focus(); return; }
    }
    if (openaiModel && !/^[a-zA-Z0-9._:-]+$/.test(openaiModel)) { setError('Model contains unsupported characters.'); document.getElementById('ai-model')?.focus(); return; }
    const submitted = { ...draft };
    const changes = Object.fromEntries(Object.entries(submitted).filter(([key, value]) => value !== baseline[key]));
    setIsSaving(true); setError(null);
    const { data, error } = await api.put<{ settings?: AISettingsData }>('/api/ai/settings', changes);
    if (!active.current) return;
    setError(error);
    if (!error) {
      setBaseline(submitted);
      if (data?.settings) setSettings(current => ({ ...current, openaiConfigured: data.settings!.openaiConfigured, anthropicConfigured: data.settings!.anthropicConfigured }));
      addToast({ type: 'success', title: 'AI settings saved' });
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
            <div className="rounded-container bg-primary/10 p-2 text-primary">
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
            <div className="rounded-container bg-primary/10 p-2 text-primary">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Integration</CardTitle>
              <CardDescription>
                Configure AI-powered artist recommendations using OpenAI or Anthropic
              </CardDescription>
            </div>
          </div>
          <Button onClick={handleSave} disabled={isSaving || !dirty || !loaded} size="sm">
            <Save className="h-4 w-4 mr-2" /> {isSaving ? 'Saving...' : 'Save AI settings'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p role={error ? "alert" : "status"} className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{error || (isSaving ? "Saving AI settings…" : dirty ? "Unsaved AI settings changes" : "AI settings saved")}</p>
        <fieldset disabled={!loaded} className="space-y-6">
        {/* OpenAI Section */}
        <div className="rounded-container border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">OpenAI-Compatible</h3>
              <p className="text-sm text-muted-foreground">
                Use OpenAI, Ollama, LiteLLM, OpenRouter, or other compatible providers
              </p>
            </div>
            <Switch
              checked={settings.openaiEnabled}
              onChange={() => handleToggle('openaiEnabled')}
              label="Enable OpenAI-Compatible"
            />
          </div>

          <>
              <div className="space-y-2">
                <label htmlFor="ai-openai-key" className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input id="ai-openai-key"
                    type={showOpenaiKey ? 'text' : 'password'}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder={settings.openaiConfigured ? '••••••••••••••••' : 'sk-...'}
                    className="pr-10"
                  />
                  <button
                    type="button" aria-label={showOpenaiKey ? "Hide OpenAI API key" : "Show OpenAI API key"}
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
                <label htmlFor="ai-base-url" className="text-sm font-medium">Base URL (Optional)</label>
                <Input id="ai-base-url"
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
                <label htmlFor="ai-model" className="text-sm font-medium">Model (Optional)</label>
                <Input id="ai-model"
                  type="text"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  placeholder="gpt-4o-mini (default)"
                />
                <p className="text-xs text-muted-foreground">
                  Model name varies by provider (e.g., llama3.2, mistral, gpt-4o)
                </p>
              </div>

              {settings.openaiConfigured && (
                <p className="text-xs text-status-success">✓ OpenAI-compatible provider configured</p>
              )}
          </>
        </div>

        {/* Anthropic Section */}
        <div className="rounded-container border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Anthropic (Claude)</h3>
              <p className="text-sm text-muted-foreground">
                Use Anthropic&apos;s Claude models for recommendations
              </p>
            </div>
            <Switch
              checked={settings.anthropicEnabled}
              onChange={() => handleToggle('anthropicEnabled')}
              label="Enable Anthropic (Claude)"
            />
          </div>

          <>
              <div className="space-y-2">
                <label htmlFor="ai-anthropic-key" className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input id="ai-anthropic-key"
                    type={showAnthropicKey ? 'text' : 'password'}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder={settings.anthropicConfigured ? '••••••••••••••••' : 'sk-ant-...'}
                    className="pr-10"
                  />
                  <button
                    type="button" aria-label={showAnthropicKey ? "Hide Anthropic API key" : "Show Anthropic API key"}
                    onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {settings.anthropicConfigured && (
                  <p className="text-xs text-status-success">✓ API key configured</p>
                )}
              </div>
          </>
        </div>

        {/* Info */}
        <div className="rounded-container bg-status-info/10 p-4 text-sm">
          <p className="font-medium text-status-info">About AI Recommendations</p>
          <p className="mt-1 text-status-info">
            AI recommendations analyze your library and listening patterns to suggest new artists.
            Configure AI recommendation strategy per-subscription when creating an AI Recommendations subscription.
          </p>
        </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
