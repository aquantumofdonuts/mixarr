'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useConnectionForm } from '../hooks/useConnectionForm';
import Check from 'lucide-react/dist/esm/icons/check';
import X from 'lucide-react/dist/esm/icons/x';

type Phase = 'saving' | 'testing' | 'success' | 'save-failed' | 'test-failed';

interface WizardStepTestProps {
  type: string;
  connectionName: string;
  config: Record<string, unknown>;
  isGlobal: boolean;
  editingId?: number | null;
  onBack: () => void;
  onClose: () => void;
}

export function WizardStepTest({
  type,
  connectionName,
  config,
  isGlobal,
  editingId,
  onBack,
  onClose,
}: WizardStepTestProps) {
  const { saveConnection, testConnection, testingId, error } = useConnectionForm();
  const [phase, setPhase] = useState<Phase>('saving');
  const hasStartedRef = useRef(false);

  // Run save (then test) on mount
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    async function run() {
      const success = await saveConnection(type, connectionName, config, isGlobal, editingId);

      if (!success) {
        setPhase('save-failed');
        return;
      }

      if (editingId) {
        setPhase('testing');
        testConnection(editingId);
      } else {
        // New connection — no ID to test against
        setPhase('success');
      }
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect test completion: testingId returns to null while we're in 'testing' phase
  useEffect(() => {
    if (phase === 'testing' && testingId === null) {
      setPhase(error ? 'test-failed' : 'success');
    }
  }, [phase, testingId, error]);

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      {phase === 'saving' && (
        <>
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
            role="status"
            aria-label="Saving"
          />
          <p className="text-sm text-muted-foreground">Saving connection…</p>
        </>
      )}

      {phase === 'testing' && (
        <>
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
            role="status"
            aria-label="Testing"
          />
          <p className="text-sm text-muted-foreground">Testing connection…</p>
        </>
      )}

      {phase === 'success' && (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <Check className="h-6 w-6 text-green-600" />
          </div>
          <p className="font-medium">
            {editingId ? 'Connection saved and tested!' : 'Connection saved!'}
          </p>
          <Button onClick={onClose}>Close</Button>
        </>
      )}

      {phase === 'save-failed' && (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <X className="h-6 w-6 text-red-600" />
          </div>
          <p className="font-medium">Failed to save connection</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}

      {phase === 'test-failed' && (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
            <X className="h-6 w-6 text-yellow-600" />
          </div>
          <p className="font-medium">Connection saved but test failed</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </>
      )}
    </div>
  );
}
