'use client';

import { connectionTypes } from '../connectionTypes';

interface WizardStepTypeProps {
  onSelectType: (type: string) => void;
}

export function WizardStepType({ onSelectType }: WizardStepTypeProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {connectionTypes.map((ct) => (
        <button
          key={ct.value}
          onClick={() => onSelectType(ct.value)}
          className="flex flex-col items-center gap-2 rounded-lg border p-4 hover:bg-accent transition-colors text-center"
          data-testid={`type-card-${ct.value}`}
        >
          <div
            className="h-10 w-10 rounded flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: ct.color }}
          >
            {ct.label[0]}
          </div>
          <span className="font-medium text-sm">{ct.label}</span>
          <span className="text-xs text-muted-foreground">{ct.description}</span>
        </button>
      ))}
    </div>
  );
}
