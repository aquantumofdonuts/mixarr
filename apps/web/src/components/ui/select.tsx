'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  label?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, label, options, placeholder, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id || generatedId;
    const errorId = `${selectId}-error`;
    return <div className="w-full">
      {label && <label htmlFor={selectId} className="mb-1 block text-sm font-medium">{label}</label>}
      <select {...props} ref={ref} id={selectId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        className={cn('flex h-11 w-full rounded-button border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50', error && 'border-destructive focus-visible:ring-destructive', className)}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      {error && <p id={errorId} className="mt-1 text-sm text-destructive">{error}</p>}
    </div>;
  }
);
Select.displayName = 'Select';
export { Select };
