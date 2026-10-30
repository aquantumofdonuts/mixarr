'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useConnectionForm, type ConnectionTestState } from '../hooks/useConnectionForm';

type Phase = 'saving' | 'testing' | 'success' | 'save-failed' | 'test-failed';
interface WizardStepTestProps {
  type: string; connectionName: string; config: Record<string, unknown>; isGlobal: boolean;
  onTestResult?: (id: number, result: ConnectionTestState) => void;
  editingId?: number | null; onBack: () => void; onClose: () => void;
}
export function WizardStepTest({ type, connectionName, config, isGlobal, editingId, onBack, onClose, onTestResult }: WizardStepTestProps) {
  const { saveConnection, testConnection, error } = useConnectionForm(onTestResult);
  const [phase, setPhase] = useState<Phase>('saving');
  const [attempt, setAttempt] = useState(0);
  const [retryTestOnly, setRetryTestOnly] = useState(false);
  useEffect(() => {
    let active = true;
    async function run() {
      // Let a Strict Mode probe retire before starting a provider write.
      await Promise.resolve();
      if (!active) return;
      if (!retryTestOnly) {
        setPhase('saving');
        const saved = await saveConnection(type, connectionName, config, isGlobal, editingId);
        if (!active) return;
        if (!saved) { setPhase('save-failed'); return; }
      }
      if (editingId) {
        setPhase('testing');
        const passed = await testConnection(editingId);
        if (active) setPhase(passed ? 'success' : 'test-failed');
      } else if (active) setPhase('success');
    }
    void run();
    return () => { active = false; };
    // Each retry is an explicit action, never an implicit mutation retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return <div className="space-y-4 py-4 text-sm">
    {(phase === 'saving' || phase === 'testing') && <p role="status">{phase === 'saving' ? 'Saving connection…' : 'Testing connection…'}</p>}
    {phase === 'success' && <><p>{editingId ? 'Connection saved and tested!' : 'Connection saved!'}</p>{!editingId && <p className="text-muted-foreground">Test it from the configured connections list.</p>}<Button onClick={onClose}>Close</Button></>}
    {(phase === 'save-failed' || phase === 'test-failed') && <>
      <div role="alert"><p className="font-medium">{phase === 'save-failed' ? 'Failed to save connection' : 'Connection saved but test failed'}</p>{error && <p className="mt-1 text-destructive">{error.message}</p>}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onBack}>Back</Button><Button onClick={() => { setRetryTestOnly(phase === 'test-failed'); setAttempt(value => value + 1); }}>Retry</Button><Button variant="outline" onClick={onClose}>Close</Button></div>
    </>}
  </div>;
}
