'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { connectionTypes } from '../connectionTypes';
import { WizardStepType } from './WizardStepType';
import { WizardStepConfigure } from './WizardStepConfigure';
import { WizardStepTest } from './WizardStepTest';
import type { ConnectionTestState } from '../hooks/useConnectionForm';
import type { Connection } from './ConnectionCard';

interface ConnectionWizardProps {
  onTestResult?: (id: number, result: ConnectionTestState) => void;
  isOpen: boolean;
  onClose: () => void;
  editingConnection?: Connection | null;
  preselectedType?: string;
}

export function ConnectionWizard({
  isOpen,
  onClose,
  editingConnection = null,
  preselectedType,
  onTestResult,
}: ConnectionWizardProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // --- wizard state ---
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [connectionName, setConnectionName] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configValid, setConfigValid] = useState(false);
  const [initialConfig, setInitialConfig] = useState<Record<string, unknown> | undefined>(undefined);

  const [configError, setConfigError] = useState<string | null>(null);
  const [configRetry, setConfigRetry] = useState(0);
  const [loadingConfig, setLoadingConfig] = useState(false);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Reset state when the modal opens / the editing target changes
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    let active = true;
    setConfigError(null);
    setLoadingConfig(false);

    if (editingConnection) {
      // Edit mode → skip step 1
      setStep(2);
      setSelectedType(editingConnection.type);
      setConnectionName(editingConnection.name);
      setIsGlobal(editingConnection.userId === null);
      setConfig(null);
      setConfigValid(false);
      setInitialConfig(undefined);

      setLoadingConfig(true);
      api.get<{ connection: { config: Record<string, unknown> } }>(`/api/connections/${editingConnection.id}`, { signal: controller.signal })
        .then(({ data, error }) => {
          if (!active) return;
          const loaded = data?.connection?.config;
          if (error || !loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
            setConfigError(error || 'Invalid connection configuration response');
          } else setInitialConfig(loaded);
        })
        .catch(cause => { if (active) setConfigError(cause instanceof Error ? cause.message : 'Unable to load configuration'); })
        .finally(() => { if (active) setLoadingConfig(false); });
    } else if (preselectedType) {
      // Create mode with preselected type → skip step 1
      setStep(2);
      setSelectedType(preselectedType);
      const typeInfo = connectionTypes.find((ct) => ct.value === preselectedType);
      setConnectionName(typeInfo ? `My ${typeInfo.label}` : '');
      setIsGlobal(false);
      setConfig(null);
      setConfigValid(false);
      setInitialConfig(undefined);
    } else {
      // Create mode → start at step 1
      setStep(1);
      setSelectedType(null);
      setConnectionName('');
      setIsGlobal(false);
      setConfig(null);
      setConfigValid(false);
      setInitialConfig(undefined);
    }
    return () => { active = false; controller.abort(); };
    // Retain the draft when a connection-list refetch replaces the same target object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingConnection?.id, preselectedType, configRetry]);

  // --- handlers ---

  const handleSelectType = useCallback(
    (type: string) => {
      setSelectedType(type);
      const typeInfo = connectionTypes.find((ct) => ct.value === type);
      setConnectionName(typeInfo ? `My ${typeInfo.label}` : '');
      setConfig(null);
      setConfigValid(false);
      setInitialConfig(undefined);
      setStep(2);
    },
    [],
  );

  const handleConfigReady = useCallback((cfg: Record<string, unknown>) => {
    setConfig(cfg);
    setConfigValid(true);
  }, []);

  const handleConfigInvalid = useCallback(() => {
    setConfigValid(false);
  }, []);

  const handleBack = useCallback(() => {
    if (step === 3) {
      setStep(2);
    } else if (step === 2 && !editingConnection) {
      setStep(1);
    }
  }, [step, editingConnection]);

  const handleNext = useCallback(() => {
    if (step === 2 && configValid && connectionName.trim()) {
      setStep(3);
    }
  }, [step, configValid, connectionName]);

  // --- derived ---

  const typeLabel = connectionTypes.find((ct) => ct.value === selectedType)?.label ?? '';

  const stepTitles: Record<number, string> = {
    1: 'Add Connection',
    2: editingConnection ? `Edit ${typeLabel} Connection` : `Configure ${typeLabel}`,
    3: editingConnection ? 'Updating Connection' : 'Saving Connection',
  };

  const stepDescriptions: Record<number, string> = {
    1: 'Choose a connection type to get started',
    2: 'Fill in the details for your connection',
    3: '',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={stepTitles[step]}
      description={stepDescriptions[step] || undefined}
      size={step === 1 ? 'full' : 'lg'}
    >
      {step === 1 && <WizardStepType onSelectType={handleSelectType} />}

      {step === 2 && loadingConfig && <p role="status" className="text-sm">Loading configuration…</p>}
      {step === 2 && configError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{configError}</p><Button variant="outline" onClick={() => setConfigRetry(value => value + 1)}>Retry</Button></div>}
      {step === 2 && selectedType && !loadingConfig && !configError && (!editingConnection || initialConfig) && (
        <WizardStepConfigure
          key={`${editingConnection?.id ?? 'new'}-${initialConfig ? 'config-loaded' : 'config-loading'}`}
          type={selectedType}
          connectionName={connectionName}
          onConnectionNameChange={setConnectionName}
          isGlobal={isGlobal}
          onIsGlobalChange={setIsGlobal}
          isAdmin={!!isAdmin}
          isEditing={!!editingConnection}
          connectionId={editingConnection?.id}
          baseUrl={baseUrl}
          initialConfig={initialConfig}
          onConfigReady={handleConfigReady}
          onConfigInvalid={handleConfigInvalid}
          onBack={handleBack}
          onNext={handleNext}
          configValid={configValid}
        />
      )}

      {step === 3 && selectedType && config && (
        <WizardStepTest
          onTestResult={onTestResult}
          type={selectedType}
          connectionName={connectionName}
          config={config}
          isGlobal={isGlobal}
          editingId={editingConnection?.id ?? null}
          onBack={handleBack}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
