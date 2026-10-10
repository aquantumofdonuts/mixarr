'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Settings from 'lucide-react/dist/esm/icons/settings';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import { navigationForRole } from './navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { ThemePicker } from '@/components/ui/theme-picker';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { user, logout } = useAuth();
  const { guardedNavigation } = useUnsavedChanges();

  // Fetch version and update status
  const { data: healthData } = useQuery<{
    version?: string;
    update?: { latest: string; url: string } | null;
  }>({
    queryKey: ['health-live'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/health/live', { signal });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    // Refresh the version/update indicator often enough that it isn't
    // stale for hours after an upgrade is published
    refetchInterval: 10 * 60 * 1000,
  });

  const visibleNavGroups = navigationForRole(user?.role);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved !== null) {
      setCollapsed(saved === 'true');
    }
  }, []);

  const toggleCollapsed = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', JSON.stringify(newState));
  };

  if (!mounted) return null;

  return (
      <aside
        className={cn(
          'hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
        )}
      >
        {/* Header */}
        <div className="flex h-[57px] shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-8 h-8 rounded-button bg-primary text-primary-foreground font-bold text-sm flex-shrink-0">
              M
            </span>
            {!collapsed && (
              <span className="text-lg font-semibold truncate">Mixarr</span>
            )}
          </Link>
          <div className="flex items-center gap-1">
            {/* Collapse toggle */}
            <button
              type="button" onClick={toggleCollapsed}
              className="h-11 w-11 rounded-button p-2 hover:bg-accent transition-colors"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronRight className={cn('h-5 w-5 transition-transform duration-[140ms]', !collapsed && 'rotate-180')} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-4 p-2 overflow-y-auto">
          {visibleNavGroups.map((group) => (
            <div key={group.label} className="space-y-1" role="group" aria-label={group.label}>
              {!collapsed && (
                <h3 className="px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h3>
              )}
              {group.items.map((item) => {
                const isActive = item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const NavigationLink = item.href === '/settings' ? 'a' : Link;
                return (
                  <NavigationLink
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-button px-3 py-2 transition-colors',
                      isActive
                        ? 'bg-muted font-bold text-foreground'
                        : 'text-sidebar-foreground hover:bg-accent hover:text-accent-foreground',
                      collapsed && 'justify-center'
                    )}
                    aria-label={collapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavigationLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer with user avatar */}
        <div className="border-t border-sidebar-border p-2 relative">
          <button
            type="button" aria-expanded={userMenuOpen} aria-label="Account menu" onClick={() => setUserMenuOpen(!userMenuOpen)}
            className={cn(
              'flex w-full items-center gap-3 rounded-button px-3 py-2 transition-colors hover:bg-accent',
              collapsed && 'justify-center'
            )}
          >
            <div className="h-8 w-8 rounded-button bg-muted flex items-center justify-center text-foreground font-medium flex-shrink-0">
              {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium truncate">{user?.displayName || user?.username}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.role}</p>
                </div>
                <ChevronRight className={cn("h-4 w-4 transition-transform duration-[140ms]", userMenuOpen && "rotate-90")} aria-hidden="true" />
              </>
            )}
          </button>

          {/* Version */}
          {healthData?.version && (
            <div className={cn('px-3 py-1', collapsed && 'text-center')}>
              {healthData.update ? (
                <a
                  href={healthData.update.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-link hover:underline inline-flex items-center gap-1"
                  title={`Update available: v${healthData.update.latest}`}
                >
                  {collapsed
                    ? <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                    : <>v{healthData.version} · update ↑</>
                  }
                </a>
              ) : (
                !collapsed && (
                  <span className="font-mono text-xs text-muted-foreground">v{healthData.version}</span>
                )
              )}
            </div>
          )}

          {/* User dropdown menu */}
          {userMenuOpen && (
            <div className={cn(
              "absolute bottom-full left-2 right-2 mb-1 rounded-button border bg-popover shadow-lg z-50",
              collapsed && "left-0 right-auto w-48"
            )}>
              <div className="p-1">
                <a
                  href={user?.role === 'admin' ? '/settings' : '/users/me'}
                  onClick={() => setUserMenuOpen(false)}
                  className="flex min-h-11 w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent"
                >
                  <Settings className="h-4 w-4" />
                  {user?.role === 'admin' ? 'Settings' : 'My Profile'}
                </a>
                <div className="border-t my-1" />
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1.5">Theme</p>
                  <ThemePicker />
                </div>
                <div className="border-t my-1" />
                <button
                  onClick={() => {
                    guardedNavigation(() => { setUserMenuOpen(false); void logout(); });
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
  );
}
