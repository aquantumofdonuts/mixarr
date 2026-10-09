'use client';

import { connectionTypes } from '../connectionTypes';

interface WizardStepTypeProps {
  onSelectType: (type: string) => void;
}

export function WizardStepType({ onSelectType }: WizardStepTypeProps) {
  return (
    <div className="divide-y border">
      {connectionTypes.map((ct) => (
        <button
          key={ct.value}
          onClick={() => onSelectType(ct.value)}
          className="flex w-full flex-col items-start gap-1 px-3 py-3 text-left hover:bg-muted transition-colors"
          data-testid={`type-card-${ct.value}`}
        >
          <span className="font-medium text-sm">{ct.label}</span>
          <span className="text-xs text-muted-foreground">{ct.description}</span>
        </button>
      ))}
    </div>
  );
}
