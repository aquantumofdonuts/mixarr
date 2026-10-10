'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Check from 'lucide-react/dist/esm/icons/check';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

type Step = 'welcome' | 'admin' | 'url' | 'success';
const steps: Step[] = ['welcome', 'admin', 'url', 'success'];

interface AdminForm {
  username: string;
  password: string;
  confirmPassword: string;
  displayName: string;
}

function SetupPageContent() {
  const [step, setStep] = useState<Step>('welcome');
  const [adminForm, setAdminForm] = useState<AdminForm>({
    username: '',
    password: '',
    confirmPassword: '',
    displayName: '',
  });
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const router = useRouter();
  const { refetchAuth } = useAuth();

  // Check if setup is already complete - redirect to login if so
  // Also check if admin/baseUrl exists to resume at the right step
  useEffect(() => {
    api.get<{ setupRequired: boolean; adminExists: boolean; baseUrlExists: boolean }>('/api/auth/setup-required')
      .then(({ data }) => {
        if (data && !data.setupRequired) {
          router.replace('/login');
        } else {
          // Resume at the appropriate step based on what's already configured
          if (data?.adminExists && data?.baseUrlExists) {
            // Both configured - go straight to success step
            setStep('success');
          } else if (data?.adminExists) {
            // Admin exists but no baseUrl - skip to URL step
            setStep('url');
          }
          // Otherwise start from welcome step (default)
          setCheckingSetup(false);
        }
      })
      .catch(() => setCheckingSetup(false));
  }, [router]);

  // Auto-detect base URL on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBaseUrl(window.location.origin);
    }
  }, []);

  // Show loading while checking if setup is needed
  if (checkingSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleAdminSubmit = async () => {
    setError('');

    if (adminForm.password !== adminForm.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (adminForm.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    const { error } = await api.post('/api/auth/setup', {
      username: adminForm.username,
      password: adminForm.password,
      displayName: adminForm.displayName || adminForm.username,
    });

    if (error) {
      setError(error);
      setIsLoading(false);
      return;
    }

    // Refresh auth state so ProtectedLayout knows we're logged in
    refetchAuth();

    setIsLoading(false);
    setStep('url');
  };

  const handleUrlSubmit = async () => {
    setError('');
    setIsLoading(true);

    const { error } = await api.post('/api/settings/base-url', {
      baseUrl: baseUrl.trim().replace(/\/$/, ''), // Remove trailing slash
    });

    if (error) {
      setError(error);
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setStep('success');
  };

  const handleGoToConnections = async () => {
    setError('');
    setIsLoading(true);
    try {
      // Mark setup as complete before redirecting
      const res = await fetch('/api/auth/complete-setup', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to complete setup');
      }
      router.push('/connections');
    } catch (err) {
      console.error('Error completing setup:', err);
      setError(err instanceof Error ? err.message : 'Failed to complete setup. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <div className="mb-4 flex justify-center" aria-label={`Setup step ${steps.indexOf(step) + 1} of ${steps.length}`}>
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-button font-mono text-sm font-medium ${
                    step === s
                      ? 'bg-primary text-primary-foreground'
                      : i < steps.indexOf(step)
                      ? 'bg-muted text-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i < steps.indexOf(step) ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`mx-2 h-0.5 w-8 ${
                      i < steps.indexOf(step)
                        ? 'bg-primary'
                        : 'bg-muted'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        {step === 'welcome' && (
          <Card>
            <CardHeader>
              <PageHeader title="Set up Mixarr" />
              <CardDescription>
                Create an administrator account, set the application URL, then connect your music services.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-container bg-muted p-4 text-sm">
                <p className="mb-3 font-medium">After setup:</p>
                <ul className="space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span>Subscribe to charts, playlists, and new releases</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span>Import your library from Spotify, TIDAL, Deezer & more</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span>Find similar artists based on your listening history</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span>Automatically add artists to Lidarr</span>
                  </li>
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Supports: Spotify, Last.fm, TIDAL, Deezer, Tautulli/Plex, MusicBrainz
                </p>
              </div>
              <Button className="w-full" onClick={() => setStep('admin')}>
                Get Started <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'admin' && (
          <Card>
            <CardHeader>
              <PageHeader title="Create Admin Account" />
              <CardDescription>
                Set up your administrator credentials
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={event => { event.preventDefault(); void handleAdminSubmit(); }}>
                {error && (
                  <div role="alert" className="rounded-button bg-status-error-surface p-3 text-sm text-status-error">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Input
                    label="Username"
                    required
                    value={adminForm.username}
                    onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
                    placeholder="admin"
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-2">
                  <Input
                    label="Display Name"
                    value={adminForm.displayName}
                    onChange={(e) => setAdminForm({ ...adminForm, displayName: e.target.value })}
                    placeholder="Administrator"
                  />
                </div>

                <div className="space-y-2">
                  <Input
                    label="Password"
                    required
                    minLength={8}
                    type="password"
                    value={adminForm.password}
                    onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <Input
                    label="Confirm Password"
                    required
                    type="password"
                    value={adminForm.confirmPassword}
                    onChange={(e) => setAdminForm({ ...adminForm, confirmPassword: e.target.value })}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                </div>

                <Button type="submit" className="w-full" isLoading={isLoading}>
                  Create Account <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 'url' && (
          <Card>
            <CardHeader>
              <PageHeader title="Application URL" />
              <CardDescription>
                Set the external URL used to access Mixarr
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={event => { event.preventDefault(); void handleUrlSubmit(); }}>
                {error && (
                  <div role="alert" className="rounded-button bg-status-error-surface p-3 text-sm text-status-error">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Input
                    label="Base URL"
                    type="url"
                    aria-describedby="base-url-help"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://mixarr.example.com"
                  />
                  <p id="base-url-help" className="text-xs text-muted-foreground">
                    Include the protocol (http/https) and port if needed
                  </p>
                </div>

                {!baseUrl.startsWith('https://') && (
                  <div className="rounded-button border bg-status-warning-surface p-3 text-sm">
                    <p className="font-medium text-status-warning">HTTPS Recommended</p>
                    <p className="text-muted-foreground mt-1">
                      Spotify integration requires HTTPS. Use port 3443 for built-in HTTPS or configure a reverse proxy.
                    </p>
                  </div>
                )}

                <Button type="submit" className="w-full" isLoading={isLoading}>
                  Continue <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 'success' && (
          <Card>
            <CardHeader>
              <PageHeader title="Setup complete" />
              <CardDescription>
                Next, connect your services to get started
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div role="alert" className="rounded-button bg-status-error-surface p-3 text-sm text-status-error">
                  {error}
                </div>
              )}
              <Button className="w-full" onClick={handleGoToConnections} isLoading={isLoading}>
                Continue to Connections <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <SetupPageContent />
    </Suspense>
  );
}
