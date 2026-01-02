'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ChevronRight, User, Check, Globe, Sparkles, Loader2, Music2, Search, Plug } from 'lucide-react';

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
  useEffect(() => {
    api.get<{ setupRequired: boolean }>('/api/auth/setup-required')
      .then(({ data }) => {
        if (data && !data.setupRequired) {
          router.replace('/login');
        } else {
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
    setIsLoading(true);
    try {
      // Mark setup as complete before redirecting
      const res = await fetch('/api/auth/complete-setup', { method: 'POST' });
      if (!res.ok) {
        throw new Error('Failed to complete setup');
      }
      router.push('/connections');
    } catch (error) {
      console.error('Error completing setup:', error);
      // Still redirect even if the flag fails to save
      router.push('/connections');
    }
    setIsLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <div className="mb-8 flex justify-center">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                    step === s
                      ? 'bg-primary text-primary-foreground'
                      : i < steps.indexOf(step)
                      ? 'bg-primary/20 text-primary'
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
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Music2 className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Welcome to Mixarr</CardTitle>
              <CardDescription>
                Discover and import music from your favorite sources
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium mb-3">What Mixarr can do:</p>
                <ul className="space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>Subscribe to charts, playlists, and new releases</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Music2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>Import your library from Spotify, TIDAL, Deezer & more</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Search className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>Find similar artists based on your listening history</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Plug className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>Automatically add artists to Lidarr</span>
                  </li>
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

        {step === 'admin' && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <User className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Create Admin Account</CardTitle>
              <CardDescription>
                Set up your administrator credentials
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Username</label>
                <Input
                  value={adminForm.username}
                  onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
                  placeholder="admin"
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Display Name</label>
                <Input
                  value={adminForm.displayName}
                  onChange={(e) => setAdminForm({ ...adminForm, displayName: e.target.value })}
                  placeholder="Administrator"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  value={adminForm.password}
                  onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm Password</label>
                <Input
                  type="password"
                  value={adminForm.confirmPassword}
                  onChange={(e) => setAdminForm({ ...adminForm, confirmPassword: e.target.value })}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                />
              </div>

              <Button className="w-full" onClick={handleAdminSubmit} isLoading={isLoading}>
                Create Account <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'url' && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Globe className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Application URL</CardTitle>
              <CardDescription>
                Set the external URL used to access Mixarr
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://mixarr.example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Include the protocol (http/https) and port if needed
                </p>
              </div>

              {!baseUrl.startsWith('https://') && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm">
                  <p className="font-medium text-amber-600 dark:text-amber-400">HTTPS Recommended</p>
                  <p className="text-muted-foreground mt-1">
                    Spotify integration requires HTTPS. Use port 3443 for built-in HTTPS or configure a reverse proxy.
                  </p>
                </div>
              )}

              <Button className="w-full" onClick={handleUrlSubmit} isLoading={isLoading}>
                Continue <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'success' && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                <Check className="h-8 w-8 text-green-500" />
              </div>
              <CardTitle className="text-2xl">Account Created!</CardTitle>
              <CardDescription>
                Next, connect your services to get started
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
