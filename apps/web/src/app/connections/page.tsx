'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import { useConnections } from '@/lib/hooks';
import { ConnectionCard, type Connection } from './components/ConnectionCard';
import { ConnectionWizard } from './components/ConnectionWizard';
import { useConnectionForm } from './hooks/useConnectionForm';
import { connectionTypes } from './connectionTypes';

export default function ConnectionsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { data: connections = [], isLoading, error: loadError, refetch } = useConnections();
  const {
    testConnection, deleteConnection, testingId, testStates, clearTest,
    recordTest, isDeleting, error,
  } = useConnectionForm();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const callbackHandled = useRef<string | null>(null);

  useEffect(() => {
    const signature = searchParams.toString();
    if (callbackHandled.current === signature) return;
    const params = new URLSearchParams(signature);
    let hasCallback = false;
    for (const type of ['spotify', 'deezer', 'tidal']) {
      const value = params.get(`${type}_authorized`);
      if (value === null) continue;
      hasCallback = true;
      // The callback ID only requests fresh provider evidence; it is not a verdict.
      if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) {
        void queryClient.invalidateQueries({ queryKey: ['connections', Number(value), type, 'oauth-status'] });
      }
      params.delete(`${type}_authorized`);
    }
    if (params.has('error')) {
      hasCallback = true;
      addToast({
        type: 'error', title: 'Authorization failed',
        message: params.get('error') || 'Authorization could not complete',
      });
      params.delete('error');
    }
    if (hasCallback) {
      callbackHandled.current = signature;
      router.replace(`/connections${params.size ? `?${params}` : ''}`, { scroll: false });
    }
  }, [searchParams, router, queryClient, addToast]);

  const canModify = (connection: Connection) => user?.role === 'admin'
    || (connection.userId !== null && connection.userId === user?.id);
  const openModal = (connection?: Connection) => {
    if (connection && !canModify(connection)) return;
    if (connection) clearTest(connection.id);
    setEditingId(connection?.id ?? null);
    setShowModal(true);
  };
  const closeModal = () => {
    if (editingId && testStates[editingId]?.verdict === 'testing') clearTest(editingId);
    setShowModal(false);
    setEditingId(null);
  };
  const editConnection = (id: number) => {
    const connection = connections.find(item => item.id === id);
    if (connection) openModal(connection);
  };
  const requestDelete = (id: number) => {
    const connection = connections.find(item => item.id === id);
    if (connection && canModify(connection)) {
      setDeleteFailed(false);
      setConfirmTarget(id);
    }
  };
  const target = connections.find(connection => connection.id === confirmTarget);
  const confirmDelete = async () => {
    if (!target || !canModify(target) || isDeleting) return;
    setDeleteFailed(false);
    const success = await deleteConnection(target.id);
    if (success) setConfirmTarget(null);
    else setDeleteFailed(true);
  };

  return (
    <>
      <PageHeader title="Connections" description="Configured services">
        <Button onClick={() => openModal()}>Add connection</Button>
      </PageHeader>
      {loadError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{loadError.message}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}
      {isLoading ? (
        <div aria-label="Loading connections" className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : connections.length ? (
        <div className="border" aria-label="Configured connections">
          {connections.map(connection => (
            <ConnectionCard
              key={connection.id}
              typeConfig={connectionTypes.find(type => type.value === connection.type)
                ?? { value: connection.type, label: connection.type, color: '', description: '' }}
              connections={[connection]}
              isAdmin={user?.role === 'admin'}
              currentUserId={user?.id}
              onAdd={() => openModal()}
              onEdit={editConnection}
              onTest={id => void testConnection(id)}
              onDelete={requestDelete}
              testingId={testingId}
              testStates={testStates}
              onPreview={(id, type) => router.push(`/preview?connectionId=${id}&type=${type}`)}
            />
          ))}
        </div>
      ) : !loadError && (
        <div className="border p-4 text-sm">
          <p className="font-medium">No configured connections</p>
          <p className="mt-1 text-muted-foreground">Add Lidarr to manage your library, then add a music source for discovery.</p>
        </div>
      )}
      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => { if (!isDeleting) setConfirmTarget(null); }}
        onConfirm={() => void confirmDelete()}
        title={`Delete ${target?.name ?? 'connection'}?`}
        description={`This removes the connection and its credentials. Linked subscriptions are retained but lose this connection and need reconfiguration. This cannot be undone.${deleteFailed ? `\nDelete failed: ${error?.message ?? 'Please retry.'}` : ''}`}
        confirmLabel={deleteFailed ? 'Retry' : 'Delete'}
        loading={isDeleting}
        variant="destructive"
      />
      <ConnectionWizard
        onTestResult={recordTest}
        isOpen={showModal}
        onClose={closeModal}
        editingConnection={editingId ? connections.find(connection => connection.id === editingId) ?? null : null}
      />
    </>
  );
}
