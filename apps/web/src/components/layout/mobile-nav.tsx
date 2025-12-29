'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Home, 
  ListTodo, 
  Calendar, 
  Search,
  Library 
} from 'lucide-react';
import { useOfflineStatus } from '@/lib/use-offline-status';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export function MobileNav() {
  const pathname = usePathname();
  const { isOffline, pendingActionsCount } = useOfflineStatus();

  const navItems: NavItem[] = [
    {
      href: '/dashboard',
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
    {
      href: '/subscriptions',
      label: 'Subs',
      icon: <Calendar className="h-5 w-5" />,
    },
  ];

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/';
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t border-border md:hidden safe-area-inset-bottom">
      {/* Offline indicator */}
      {isOffline && (
        <div className="bg-yellow-500/90 text-yellow-950 text-xs text-center py-1 px-2">
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
      </div>
    </nav>
  );
}
