'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { connectionForms } from './forms';
import { connectionTypes } from '../connectionTypes';

interface WizardStepConfigureProps {
  type: string;
  connectionName: string;
  onConnectionNameChange: (name: string) => void;
  isGlobal: boolean;
  onIsGlobalChange: (isGlobal: boolean) => void;
  isAdmin: boolean;
  isEditing: boolean;
  connectionId?: number;
  baseUrl: string;
  initialConfig?: Record<string, unknown>;
  onConfigReady: (config: Record<string, unknown>) => void;
  onConfigInvalid: () => void;
  onBack: () => void;
  onNext: () => void;
  configValid: boolean;
}

export function WizardStepConfigure({
  type,
  connectionName,
  onConnectionNameChange,
  isGlobal,
  onIsGlobalChange,
  isAdmin,
  isEditing,
  connectionId,
  baseUrl,
  initialConfig,
  onConfigReady,
  onConfigInvalid,
  onBack,
  onNext,
  configValid,
}: WizardStepConfigureProps) {
  const FormComponent = connectionForms[type];
  const typeInfo = connectionTypes.find((ct) => ct.value === type);

  return (
    <div className="space-y-4">
      {/* Connection name */}
      <div>
        <label htmlFor="wizard-connection-name" className="block text-sm font-medium mb-1">
          Connection Name
        </label>
        <Input
          id="wizard-connection-name"
          placeholder={typeInfo ? `My ${typeInfo.label}` : 'Connection name'}
          value={connectionName}
          onChange={(e) => onConnectionNameChange(e.target.value)}
        />
      </div>

      {/* Global checkbox (admin only) */}
      {isAdmin && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isGlobal}
            onChange={(e) => onIsGlobalChange(e.target.checked)}
            className="rounded border-input"
          />
          Global connection (available to all users)
        </label>
      )}

      {/* Type-specific form */}
      {FormComponent && (
        <FormComponent
          initialConfig={initialConfig}
          connectionId={connectionId}
          baseUrl={baseUrl}
          onConfigReady={onConfigReady}
          onConfigInvalid={onConfigInvalid}
        />
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4">
        {!isEditing ? (
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        ) : (
          <div />
        )}
        <Button
          onClick={onNext}
          disabled={!configValid || !connectionName.trim()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
