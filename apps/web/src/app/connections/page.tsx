'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import { useConnections } from '@/lib/hooks';
import Check from 'lucide-react/dist/esm/icons/check';
import Plus from 'lucide-react/dist/esm/icons/plus';
import X from 'lucide-react/dist/esm/icons/x';
import { ConnectionCard } from './components/ConnectionCard';
import type { Connection } from './components/ConnectionCard';
import { ConnectionWizard } from './components/ConnectionWizard';
import { useConnectionForm } from './hooks/useConnectionForm';
import { connectionTypes } from './connectionTypes';

export default function ConnectionsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToast } = useToast();

  // React Query for connections — cached across navigations
  const { data: connections = [] } = useConnections();

  // Connection form hook for test / delete operations
  const { testConnection, deleteConnection, testingId } = useConnectionForm();
  // Modal / wizard state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [preselectedType, setPreselectedType] = useState<string | undefined>(undefined);

  // Welcome banner
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

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

  const handlePreview = (connectionId: number, type: string) => {
    router.push(`/preview?connectionId=${connectionId}&type=${type}`);
  };

  // Handle OAuth callback results from URL search params
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
        message: errorMessages[error] || error,
      });
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

  // --- Modal handlers ---
  const openModal = (connection?: Connection, defaultType?: string) => {
    if (connection) {
      setEditingId(connection.id);
      setPreselectedType(undefined);
    } else {
      setEditingId(null);
      setPreselectedType(defaultType);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setPreselectedType(undefined);
  };

  const handleDelete = (id: number) => {
    if (!confirm('Delete this connection?')) return;
    deleteConnection(id);
  };

  // Derived state
  const isAdmin = user?.role === 'admin';
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
                  Click &quot;Configure&quot; on any service below to add your first connection.
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
            connections={connections.filter((c) => c.type === type.value)}
            isAdmin={user?.role === 'admin'}
            onAdd={(t) => openModal(undefined, t)}
            onEdit={(id) => {
              const conn = connections.find((c) => c.id === id);
              if (conn) openModal(conn);
            }}
            onTest={(id) => testConnection(id)}
            onDelete={(id) => handleDelete(id)}
            testingId={testingId}
            onPreview={(id, t) => handlePreview(id, t)}
          />
        ))}
      </div>

      {/* Connection Wizard */}
      <ConnectionWizard
        isOpen={showModal}
        onClose={closeModal}
        editingConnection={editingId ? connections.find((c) => c.id === editingId) ?? null : null}
        preselectedType={preselectedType}
      />
    </>
  );
}
