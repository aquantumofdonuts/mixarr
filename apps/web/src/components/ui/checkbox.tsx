'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  checked?: boolean;
  indeterminate?: boolean;
  label?: string;
  onCheckedChange?: (checked: boolean) => void;
}
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, indeterminate = false, label, id, onCheckedChange, className, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inputRef.current!, []);
    React.useEffect(() => { if (inputRef.current) inputRef.current.indeterminate = indeterminate; }, [indeterminate]);
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const input = <input {...props} id={inputId} ref={inputRef} type="checkbox" checked={checked}
      onChange={event => onCheckedChange?.(event.target.checked)}
      className={cn('h-4 w-4 cursor-pointer rounded border-input accent-primary disabled:cursor-not-allowed focus-visible:ring-ring', className)} />;
    return label ? <label htmlFor={inputId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">{input}{label}</label> : input;
  }
);
Checkbox.displayName = 'Checkbox';
