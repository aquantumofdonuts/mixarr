'use client';

import * as React from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Info from 'lucide-react/dist/esm/icons/info';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import { Modal, ModalFooter } from './modal';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'warning' | 'info';
  loading?: boolean;
}

const icons = {
  destructive: Trash2,
  warning: AlertTriangle,
  info: Info,
};

const iconColors = {
  destructive: 'text-destructive',
  warning: 'text-status-warning',
  info: 'text-status-info',
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'destructive',
  loading = false,
}: ConfirmDialogProps) {
  const Icon = icons[variant];

  return (
    <Modal isOpen={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center">
        <div className={`rounded-full bg-muted p-3 mb-4 ${iconColors[variant]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && (
          <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{description}</p>
        )}
      </div>
      <ModalFooter className="justify-center">
        <Button variant="outline" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant === 'destructive' ? 'destructive' : 'default'}
          onClick={onConfirm}
          isLoading={loading}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
