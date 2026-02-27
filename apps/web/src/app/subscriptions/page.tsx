'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import {
  useSubscriptions,
  usePresets,
  useRunSubscription,
  useDeleteSubscription,
  useToggleSubscription,
  useHasLidarr,
  useCreateSubscription,
  useUpdateSubscription,
} from '@/lib/hooks';
import Plus from 'lucide-react/dist/esm/icons/plus';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';

// Import extracted components
import { SubscriptionCard, Subscription } from '@/components/subscriptions/SubscriptionCard';
import { SubscriptionFormModal } from '@/components/subscriptions/SubscriptionFormModal';

// ============================================================================
// Page Component
// ============================================================================

export default function SubscriptionsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  // Data fetching hooks
  const { data: subscriptions = [], isLoading } = useSubscriptions();
  const { data: presets = [] } = usePresets();
  const { data: hasLidarr = true } = useHasLidarr();

  // Mutation hooks
  const runMutation = useRunSubscription();
  const deleteMutation = useDeleteSubscription();
  const toggleMutation = useToggleSubscription();
  const createMutation = useCreateSubscription();
  const updateMutation = useUpdateSubscription();

  // Local state - minimal orchestrator state
  const [showModal, setShowModal] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleRun = async (id: number) => {
    setRunningId(id);
    try {
      await runMutation.mutateAsync(id);
      addToast({ type: 'success', title: 'Subscription started' });
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to start subscription',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    setRunningId(null);
  };

  const handleToggle = async (subscription: Subscription) => {
    try {
      await toggleMutation.mutateAsync({ id: subscription.id, isActive: !subscription.isActive });
    } catch {
      addToast({ type: 'error', title: 'Failed to update subscription' });
    }
  };

  const handleEdit = (subscription: Subscription) => {
    setEditingSubscription(subscription);
    setShowModal(true);
  };

  const handleDeleteClick = (id: number) => setConfirmTarget(id);
  const confirmDelete = async () => {
    if (confirmTarget === null) return;
    try {
      await deleteMutation.mutateAsync(confirmTarget);
      addToast({ type: 'success', title: 'Subscription deleted' });
    } catch {
      addToast({ type: 'error', title: 'Failed to delete subscription' });
    }
    setConfirmTarget(null);
  };

  const handleSave = async (data: {
    id?: number;
    name: string;
    type: string;
    config: Record<string, unknown>;
    schedule: string;
    resultHandling: string;
  }) => {
    try {
      if (data.id) {
        // Update existing subscription
        await updateMutation.mutateAsync({
          id: data.id,
          data: {
            name: data.name,
            config: data.config,
            schedule: data.schedule || undefined,
            resultHandling: data.resultHandling as 'preview' | 'queue' | 'auto',
          },
        });
        addToast({ type: 'success', title: 'Subscription updated' });
      } else {
        // Create new subscription
        await createMutation.mutateAsync({
          name: data.name,
          type: data.type,
          config: data.config,
          schedule: data.schedule || undefined,
          resultHandling: data.resultHandling as 'preview' | 'queue' | 'auto',
        });
        addToast({ type: 'success', title: 'Subscription created' });
      }
      handleCloseModal();
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to save subscription',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error; // Re-throw so modal can handle it
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingSubscription(null);
  };

  const handleOpenModal = () => {
    setEditingSubscription(null);
    setShowModal(true);
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Automated music discovery from charts and playlists"
      >
        <Button onClick={handleOpenModal}>
          <Plus className="h-4 w-4 mr-2" /> New Subscription
        </Button>
      </PageHeader>

      {/* Loading State */}
      {isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading subscriptions...</p>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && subscriptions.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <TrendingUp className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No subscriptions yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Create a subscription to automatically discover new artists
            </p>
            <Button onClick={handleOpenModal}>
              <Plus className="h-4 w-4 mr-2" /> Create Subscription
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Subscription List */}
      {!isLoading && subscriptions.length > 0 && (
        <div className="space-y-4">
          {subscriptions.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              subscription={sub}
              currentUser={user}
              isRunning={runningId === sub.id}
              onRun={handleRun}
              onToggle={handleToggle}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDelete}
        title="Delete subscription?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />

      {/* Form Modal */}
      <SubscriptionFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        editingSubscription={editingSubscription}
        presets={presets}
        hasLidarr={hasLidarr}
        onSave={handleSave}
      />
    </>
  );
}
