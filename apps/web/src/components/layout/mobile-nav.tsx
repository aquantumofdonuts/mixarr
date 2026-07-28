'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Calendar from 'lucide-react/dist/esm/icons/calendar';
import Compass from 'lucide-react/dist/esm/icons/compass';
import Download from 'lucide-react/dist/esm/icons/download';
import Home from 'lucide-react/dist/esm/icons/home';
import Library from 'lucide-react/dist/esm/icons/library';
import ListTodo from 'lucide-react/dist/esm/icons/list-todo';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';
import Plug from 'lucide-react/dist/esm/icons/plug';
import Search from 'lucide-react/dist/esm/icons/search';
import SettingsIcon from 'lucide-react/dist/esm/icons/settings';
import Waypoints from 'lucide-react/dist/esm/icons/waypoints';
import { useOfflineStatus } from '@/lib/use-offline-status';
import { BottomSheet } from '@/components/ui/bottom-sheet';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const MORE_PATHS = ['/subscriptions', '/discover', '/constellation', '/downloads', '/connections', '/settings'];

export function MobileNav() {
  const pathname = usePathname();
  const { isOffline, pendingActionsCount } = useOfflineStatus();
  const [moreOpen, setMoreOpen] = useState(false);

  const navItems: NavItem[] = [
    {
      href: '/',
      label: 'Home',
      icon: <Home className="h-5 w-5" />,
    },
    {
      href: '/queue',
      label: 'Queue',
      icon: <ListTodo className="h-5 w-5" />,
    },
    {
      href: '/search',
      label: 'Search',
      icon: <Search className="h-5 w-5" />,
    },
    {
      href: '/library',
      label: 'Library',
      icon: <Library className="h-5 w-5" />,
    },
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/' || pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  const isMoreActive = MORE_PATHS.some((p) => pathname.startsWith(p));

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t border-border md:hidden safe-area-inset-bottom">
        {/* Offline indicator */}
        {isOffline && (
          <div className="bg-status-warning/90 text-foreground text-xs text-center py-1 px-2">
            You&apos;re offline
            {pendingActionsCount > 0 && ` • ${pendingActionsCount} pending`}
          </div>
        )}
        
        <div className="flex justify-around items-center py-2 px-1">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center min-w-[56px] py-1 px-2 rounded-lg transition-colors ${
                  active 
                    ? 'text-primary' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="relative">
                  {item.icon}
                  {item.badge && item.badge > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </span>
                <span className="text-[10px] mt-0.5 font-medium">{item.label}</span>
              </Link>
            );
          })}

          {/* More tab */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center min-w-[56px] py-1 px-2 rounded-lg transition-colors ${
              isMoreActive
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-[10px] mt-0.5 font-medium">More</span>
          </button>
        </div>
      </nav>

      <BottomSheet isOpen={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="flex flex-col gap-1">
          <Link href="/subscriptions" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-accent transition-colors">
            <Calendar className="w-5 h-5" />
            <span>Subscriptions</span>
          </Link>
          <Link href="/discover" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-accent transition-colors">
            <Compass className="w-5 h-5" />
            <span>Discover</span>
          </Link>
          <Link href="/constellation" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-accent transition-colors">
            <Waypoints className="w-5 h-5" />
            <span>Constellation</span>
          </Link>
          <Link href="/downloads" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-accent transition-colors">
            <Download className="w-5 h-5" />
            <span>Downloads</span>
          </Link>
          <Link href="/connections" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-accent transition-colors">
            <Plug className="w-5 h-5" />
            <span>Connections</span>
          </Link>
          <Link href="/settings" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-accent transition-colors">
            <SettingsIcon className="w-5 h-5" />
            <span>Settings</span>
          </Link>
        </div>
      </BottomSheet>
    </>
  );
}
