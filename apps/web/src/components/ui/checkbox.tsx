'use client';

import * as React from 'react';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({ checked, onCheckedChange, className, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      className={`h-4 w-4 rounded border-gray-300 dark:border-gray-600 
        text-primary focus:ring-primary focus:ring-offset-0 
        dark:bg-gray-800 cursor-pointer ${className || ''}`}
      {...props}
    />
  );
}
