'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useAuth } from '@/lib/auth';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ThemePicker } from '@/components/ui/theme-picker';
import { cn } from '@/lib/utils';
import { navigationForRole } from './navigation';

export function MobileNav({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { guardedNavigation } = useUnsavedChanges();
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) onClose(); };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [onClose]);

  return <Modal isOpen={isOpen} onClose={onClose} title="Mixarr navigation" placement="drawer">
    <nav aria-label="Main navigation" className="space-y-4">
      {navigationForRole(user?.role).map(group => <div key={group.label} role="group" aria-label={group.label}>
        <p className="px-3 font-mono text-[10px] font-bold uppercase text-muted-foreground">{group.label}</p>
        {group.items.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const NavigationLink = item.href === '/settings' ? 'a' : Link;
          return <NavigationLink key={item.href} href={item.href} onClick={onClose} aria-current={active ? 'page' : undefined}
            className={cn('flex min-h-11 items-center gap-3 rounded-button px-3 py-2 hover:bg-muted', active && 'bg-muted font-bold')}>
            <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />{item.label}
          </NavigationLink>;
        })}
      </div>)}
    </nav>
    <div className="mt-4 space-y-3 border-t pt-4">
      <p className="break-words font-medium">{user?.displayName || user?.username}</p>
      <a href={user?.role === 'admin' ? '/settings' : '/users/me'} onClick={onClose} className="inline-flex min-h-11 items-center text-link underline">{user?.role === 'admin' ? 'Settings' : 'My Profile'}</a>
      <ThemePicker />
      <Button variant="outline" onClick={() => guardedNavigation(() => { onClose(); void logout(); })}>Logout</Button>
    </div>
  </Modal>;
}
