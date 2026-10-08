'use client';

import type { MouseEvent, ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useListContext } from '@/hooks/useListContext';
import { updateQuery } from '@/lib/list-state';
import { cn } from '@/lib/utils';

export function canonicalArtistMbid(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}

interface ArtistLinkProps {
  mbid: string | null | undefined;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
  onIdentify?: () => void;
  onOpen?: (trigger: HTMLElement) => void;
}

export function ArtistLink({ mbid, children, className, onIdentify, onOpen, 'aria-label': label }: ArtistLinkProps) {
  const pathname = usePathname(), params = useSearchParams(), router = useRouter();
  const { remember } = useListContext({ ready: true, selectionOwner: false, restore: false });
  const identity = canonicalArtistMbid(mbid);
  const classes = cn('text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className);
  if (!identity) {
    if (!onIdentify) return <span className={className}>{children}</span>;
    return <button type="button" className={classes} aria-label={label || `Identify artist: ${typeof children === 'string' ? children : 'unidentified artist'}`} onClick={onIdentify}>{children}</button>;
  }
  const href = `${pathname}${updateQuery(new URLSearchParams(params.toString()), { artist: identity })}`;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (onOpen) onOpen(event.currentTarget); else remember(event.currentTarget);
    router.push(href, { scroll: false });
  }
  return <a href={href} className={classes} aria-label={label} onClick={open}>{children}</a>;
}
