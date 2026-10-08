'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, label, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    return <div className="w-full">
      {label && <label htmlFor={inputId} className="mb-1 block text-sm font-medium">{label}</label>}
      <input {...props} id={inputId} type={type} ref={ref}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        className={cn('flex h-11 w-full rounded-button border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50', error && 'border-destructive focus-visible:ring-destructive', className)} />
      {error && <p id={errorId} className="mt-1 text-sm text-destructive">{error}</p>}
    </div>;
  }
);
Input.displayName = 'Input';
export { Input };
