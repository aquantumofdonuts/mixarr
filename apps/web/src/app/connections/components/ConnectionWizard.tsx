'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { connectionTypes } from '../connectionTypes';
import { WizardStepType } from './WizardStepType';
import { WizardStepConfigure } from './WizardStepConfigure';
import { WizardStepTest } from './WizardStepTest';
import type { Connection } from './ConnectionCard';

interface ConnectionWizardProps {
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

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Reset state when the modal opens / the editing target changes
  useEffect(() => {
    if (!isOpen) return;

    if (editingConnection) {
      // Edit mode → skip step 1
      setStep(2);
      setSelectedType(editingConnection.type);
      setConnectionName(editingConnection.name);
      setIsGlobal(editingConnection.userId === null);
      setConfig(null);
      setConfigValid(false);

      // Fetch config for the connection being edited
      api
        .get<{ connection: { config: Record<string, unknown> } }>(
          `/api/connections/${editingConnection.id}`,
        )
        .then(({ data }) => {
          setInitialConfig(data?.connection?.config ?? {});
        })
        .catch(() => {
          setInitialConfig({});
        });
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
  }, [isOpen, editingConnection, preselectedType]);

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

      {step === 2 && selectedType && (
        <WizardStepConfigure
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
