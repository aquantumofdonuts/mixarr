# Onboarding Wizard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the onboarding wizard to use inline modals for connection configuration, keeping users on `/setup` throughout.

**Architecture:** Single-page wizard with 5 steps. Connection configuration via modal dialogs that call existing API endpoints. State managed locally in the setup page component.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui Dialog component

---

## Task 1: Update Step Types and Progress Indicator

**Files:**
- Modify: `apps/web/src/app/setup/page.tsx:1-100`

**Step 1: Update the Step type and steps array**

Change the type definition and progress indicator to support 5 steps:

```tsx
type Step = 'welcome' | 'admin' | 'url' | 'connections' | 'complete';

// In the progress indicator section, update the array:
const steps: Step[] = ['welcome', 'admin', 'url', 'connections', 'complete'];
```

**Step 2: Update the progress indicator JSX**

Replace the hardcoded array with the `steps` variable and update the loop to handle 5 steps.

**Step 3: Verify visually**

Run the app and confirm the progress indicator shows 5 dots.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(setup): add 5-step progress indicator"
```

---

## Task 2: Update Welcome Step Verbiage

**Files:**
- Modify: `apps/web/src/app/setup/page.tsx` (welcome step section)

**Step 1: Replace the welcome content**

Update the bullet points to reflect full capabilities:

```tsx
{step === 'welcome' && (
  <Card>
    <CardHeader className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <span className="text-3xl">🎵</span>
      </div>
      <CardTitle className="text-2xl">Welcome to Mixarr</CardTitle>
      <CardDescription>
        Discover and collect music automatically
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="rounded-lg bg-muted p-4 text-sm">
        <ul className="space-y-2 text-muted-foreground">
          <li>• Subscribe to charts, playlists, and new releases</li>
          <li>• Import your library from Spotify, TIDAL, Deezer & more</li>
          <li>• Find similar artists based on your listening history</li>
          <li>• Automatically add artists to Lidarr</li>
          <li>• Schedule recurring discovery jobs</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground/70">
          Supports: Spotify, Last.fm, TIDAL, Deezer, Tautulli/Plex, MusicBrainz
        </p>
      </div>
      <Button className="w-full" onClick={() => setStep('admin')}>
        Get Started <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </CardContent>
  </Card>
)}
```

**Step 2: Verify visually**

Check that the welcome step shows the new verbiage.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(setup): update welcome verbiage with full capabilities"
```

---

## Task 3: Add Application URL Step

**Files:**
- Modify: `apps/web/src/app/setup/page.tsx`

**Step 1: Add URL state and imports**

Add to the imports and state:

```tsx
import { Globe } from 'lucide-react';

// Add to state declarations:
const [baseUrl, setBaseUrl] = useState('');
const [detectedUrl, setDetectedUrl] = useState('');

// Add useEffect to detect URL on mount:
useEffect(() => {
  if (typeof window !== 'undefined') {
    setDetectedUrl(window.location.origin);
  }
}, []);
```

**Step 2: Add URL save handler**

```tsx
const handleUrlSubmit = async () => {
  if (!baseUrl.trim()) {
    setError('Please enter a URL');
    return;
  }
  
  setIsLoading(true);
  const { error } = await api.put('/api/settings/base-url', { url: baseUrl });
  
  if (error) {
    setError(error);
    setIsLoading(false);
    return;
  }
  
  setIsLoading(false);
  setStep('connections');
};
```

**Step 3: Add URL step JSX**

Add after the admin step:

```tsx
{step === 'url' && (
  <Card>
    <CardHeader className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Globe className="h-6 w-6 text-primary" />
      </div>
      <CardTitle>Application URL</CardTitle>
      <CardDescription>
        How will you access Mixarr?
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">External URL</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://mixarr.example.com"
        />
      </div>

      {detectedUrl && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setBaseUrl(detectedUrl)}
        >
          Use detected: {detectedUrl.length > 35 ? detectedUrl.substring(0, 35) + '...' : detectedUrl}
        </Button>
      )}

      <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-400">⚠️ Spotify requires HTTPS</p>
        <p className="text-muted-foreground mt-1">
          Use port 3443 (built-in SSL via Caddy) or set up a reverse proxy with SSL.
        </p>
      </div>

      <Button className="w-full" onClick={handleUrlSubmit} isLoading={isLoading}>
        Continue <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </CardContent>
  </Card>
)}
```

**Step 4: Update admin step to go to URL step**

Change `setStep('connections')` to `setStep('url')` in `handleAdminSubmit`.

**Step 5: Verify flow**

Test: Create admin → should go to URL step → enter URL → should go to connections.

**Step 6: Commit**

```bash
git add -A && git commit -m "feat(setup): add application URL configuration step"
```

---

## Task 4: Create ConnectionModal Component

**Files:**
- Create: `apps/web/src/components/setup/ConnectionModal.tsx`

**Step 1: Create the component file**

```tsx
'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { Check, Loader2, X } from 'lucide-react';

type ConnectionType = 'lidarr' | 'spotify' | 'lastfm';

interface ConnectionModalProps {
  type: ConnectionType;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  baseUrl: string;
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
  },
  spotify: {
    title: 'Configure Spotify',
    color: '#1DB954',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Your Spotify Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Your Spotify Client Secret', type: 'password' },
    ],
    helpText: 'Create an app at developer.spotify.com',
  },
  lastfm: {
    title: 'Configure Last.fm',
    color: '#D51007',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Your Last.fm API key', type: 'password' },
    ],
    helpText: 'Get API key at last.fm/api/account',
  },
};

export function ConnectionModal({ type, isOpen, onClose, onSuccess, baseUrl }: ConnectionModalProps) {
  const config = connectionConfig[type];
  const [form, setForm] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');

    const payload = {
      type,
      ...form,
      name: config.title.replace('Configure ', ''),
    };

    const { data, error } = await api.post<{ success: boolean; error?: string }>('/api/connections/test', payload);

    if (error || !data?.success) {
      setTestStatus('error');
      setTestError(error || data?.error || 'Connection test failed');
      return;
    }

    setTestStatus('success');
  };

  const handleSave = async () => {
    setIsSaving(true);

    const payload = {
      type,
      ...form,
      name: config.title.replace('Configure ', ''),
    };

    const { error } = await api.post('/api/connections', payload);

    if (error) {
      setTestError(error);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    onSuccess();
    onClose();
  };

  const handleClose = () => {
    setForm({});
    setTestStatus('idle');
    setTestError('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="h-6 w-6 rounded flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: config.color }}
            >
              {type[0].toUpperCase()}
            </div>
            {config.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
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

          <p className="text-xs text-muted-foreground">ℹ️ {config.helpText}</p>

          {type === 'spotify' && baseUrl && (
            <div className="rounded-lg bg-muted p-3 text-xs">
              <p className="font-medium">Redirect URI for Spotify:</p>
              <code className="text-primary">{baseUrl}/api/auth/spotify/callback</code>
            </div>
          )}

          {testError && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <X className="h-4 w-4" />
              {testError}
            </div>
          )}

          {testStatus === 'success' && (
            <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
              <Check className="h-4 w-4" />
              Connection successful!
            </div>
          )}

          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testStatus === 'testing' || !config.fields.every(f => form[f.key])}
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

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={testStatus !== 'success' || isSaving}
            isLoading={isSaving}
          >
            Save Connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify component compiles**

Check for TypeScript errors.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(setup): create ConnectionModal component"
```

---

## Task 5: Update Connections Step to Use Modals

**Files:**
- Modify: `apps/web/src/app/setup/page.tsx`

**Step 1: Add imports and connection state**

```tsx
import { ConnectionModal } from '@/components/setup/ConnectionModal';

// Add to state:
const [activeModal, setActiveModal] = useState<'lidarr' | 'spotify' | 'lastfm' | null>(null);
const [connectedServices, setConnectedServices] = useState<Set<string>>(new Set());
```

**Step 2: Add function to refresh connection status**

```tsx
const refreshConnections = async () => {
  const { data } = await api.get<Array<{ type: string }>>('/api/connections');
  if (data) {
    setConnectedServices(new Set(data.map(c => c.type)));
  }
};
```

**Step 3: Update connections step JSX**

Replace the connections step with:

```tsx
{step === 'connections' && (
  <Card>
    <CardHeader className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Plug className="h-6 w-6 text-primary" />
      </div>
      <CardTitle>Configure Connections</CardTitle>
      <CardDescription>
        Set up your music services (optional)
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-3">
        {/* Lidarr */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-[#62BC50] flex items-center justify-center text-white font-bold">L</div>
            <div>
              <p className="font-medium flex items-center gap-2">
                Lidarr
                {connectedServices.has('lidarr') && <Check className="h-4 w-4 text-green-500" />}
              </p>
              <p className="text-sm text-muted-foreground">Required for adding artists</p>
            </div>
          </div>
          <Button
            variant={connectedServices.has('lidarr') ? 'ghost' : 'outline'}
            size="sm"
            onClick={() => setActiveModal('lidarr')}
          >
            {connectedServices.has('lidarr') ? 'Edit' : 'Configure'}
          </Button>
        </div>

        {/* Spotify */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-[#1DB954] flex items-center justify-center text-white font-bold">S</div>
            <div>
              <p className="font-medium flex items-center gap-2">
                Spotify
                {connectedServices.has('spotify') && <Check className="h-4 w-4 text-green-500" />}
              </p>
              <p className="text-sm text-muted-foreground">Import & playlist subscriptions</p>
            </div>
          </div>
          <Button
            variant={connectedServices.has('spotify') ? 'ghost' : 'outline'}
            size="sm"
            onClick={() => setActiveModal('spotify')}
          >
            {connectedServices.has('spotify') ? 'Edit' : 'Configure'}
          </Button>
        </div>

        {/* Last.fm */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-[#D51007] flex items-center justify-center text-white font-bold">L</div>
            <div>
              <p className="font-medium flex items-center gap-2">
                Last.fm
                {connectedServices.has('lastfm') && <Check className="h-4 w-4 text-green-500" />}
              </p>
              <p className="text-sm text-muted-foreground">Chart & tag subscriptions</p>
            </div>
          </div>
          <Button
            variant={connectedServices.has('lastfm') ? 'ghost' : 'outline'}
            size="sm"
            onClick={() => setActiveModal('lastfm')}
          >
            {connectedServices.has('lastfm') ? 'Edit' : 'Configure'}
          </Button>
        </div>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        More services (TIDAL, Deezer, Plex) available in Settings
      </p>

      <Button
        className="w-full"
        variant={connectedServices.size === 0 ? 'outline' : 'default'}
        onClick={() => setStep('complete')}
      >
        {connectedServices.size === 0 ? 'Skip for now' : 'Complete Setup'}
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </CardContent>
  </Card>
)}

{/* Connection Modals */}
<ConnectionModal
  type="lidarr"
  isOpen={activeModal === 'lidarr'}
  onClose={() => setActiveModal(null)}
  onSuccess={refreshConnections}
  baseUrl={baseUrl}
/>
<ConnectionModal
  type="spotify"
  isOpen={activeModal === 'spotify'}
  onClose={() => setActiveModal(null)}
  onSuccess={refreshConnections}
  baseUrl={baseUrl}
/>
<ConnectionModal
  type="lastfm"
  isOpen={activeModal === 'lastfm'}
  onClose={() => setActiveModal(null)}
  onSuccess={refreshConnections}
  baseUrl={baseUrl}
/>
```

**Step 4: Test flow**

Verify clicking "Configure" opens modal, test connection works, save updates card.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(setup): connections step with inline modals"
```

---

## Task 6: Update Complete Step to "What's Next"

**Files:**
- Modify: `apps/web/src/app/setup/page.tsx`

**Step 1: Add Sparkles import**

```tsx
import { Sparkles, Music2, Search } from 'lucide-react';
```

**Step 2: Replace complete step JSX**

```tsx
{step === 'complete' && (
  <Card>
    <CardHeader className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <CardTitle>You&apos;re all set!</CardTitle>
      <CardDescription>
        Here&apos;s what you can do next
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {connectedServices.size > 0 ? (
        <>
          {(connectedServices.has('spotify') || connectedServices.has('lastfm')) && (
            <button
              onClick={() => router.push('/subscriptions')}
              className="w-full flex items-center gap-3 rounded-lg border p-4 hover:bg-muted transition-colors text-left"
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Music2 className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Create your first subscription</p>
                <p className="text-sm text-muted-foreground">Discover artists from charts & playlists</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}

          {connectedServices.has('spotify') && (
            <button
              onClick={() => router.push('/discover')}
              className="w-full flex items-center gap-3 rounded-lg border p-4 hover:bg-muted transition-colors text-left"
            >
              <div className="h-10 w-10 rounded-full bg-[#1DB954]/10 flex items-center justify-center">
                <span className="text-lg">📚</span>
              </div>
              <div className="flex-1">
                <p className="font-medium">Import your Spotify library</p>
                <p className="text-sm text-muted-foreground">Add artists you already follow</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}

          {connectedServices.has('lidarr') && (
            <button
              onClick={() => router.push('/search')}
              className="w-full flex items-center gap-3 rounded-lg border p-4 hover:bg-muted transition-colors text-left"
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Search className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Search for artists</p>
                <p className="text-sm text-muted-foreground">Find and add specific artists</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </>
      ) : (
        <div className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
          Configure connections in Settings to start discovering artists
        </div>
      )}

      <Button className="w-full mt-4" onClick={() => router.push('/')}>
        Go to Dashboard
      </Button>
    </CardContent>
  </Card>
)}
```

**Step 3: Test with different connection states**

- No connections → shows message about Settings
- Lidarr only → shows Search
- Spotify + Lidarr → shows Subscription, Import, Search
- All three → shows all options

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(setup): add What's Next step with conditional suggestions"
```

---

## Task 7: Remove Debug Logging from Auth Route

**Files:**
- Modify: `apps/api/src/routes/auth.ts`

**Step 1: Remove console.log statements**

Remove the debug logging added earlier from the setup route.

**Step 2: Commit**

```bash
git add -A && git commit -m "chore(api): remove debug logging from setup route"
```

---

## Task 8: End-to-End Testing

**Step 1: Reset database**

```bash
cd v2 && sudo docker compose down && sudo docker volume rm v2_db_data && sudo docker compose up -d
```

**Step 2: Rebuild web**

```bash
sudo docker compose up --build -d web
```

**Step 3: Test complete flow**

1. Navigate to https://localhost:3443
2. Should redirect to /setup
3. Welcome step → Get Started
4. Create Admin → Create Account (auto-login should happen)
5. URL step → Enter URL → Continue
6. Connections → Configure Lidarr (modal opens) → Test → Save
7. Connections → shows Lidarr connected, Complete Setup
8. What's Next → shows Search option → Go to Dashboard
9. Should be on Dashboard, logged in

**Step 4: Final commit**

```bash
git add -A && git commit -m "feat(setup): complete onboarding wizard redesign"
```

---

## Success Criteria

- [ ] User can complete entire wizard without leaving `/setup`
- [ ] Connections can be configured via inline modals
- [ ] Session persists throughout wizard (no login redirects)
- [ ] URL step warns about HTTPS for Spotify
- [ ] What's Next suggestions reflect configured connections
- [ ] Skip option available if user doesn't configure connections
