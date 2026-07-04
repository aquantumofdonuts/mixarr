'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Download from 'lucide-react/dist/esm/icons/download';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Home from 'lucide-react/dist/esm/icons/home';
import Layers from 'lucide-react/dist/esm/icons/layers';
import Library from 'lucide-react/dist/esm/icons/library';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import Menu from 'lucide-react/dist/esm/icons/menu';
import Plug from 'lucide-react/dist/esm/icons/plug';
import Search from 'lucide-react/dist/esm/icons/search';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import Users from 'lucide-react/dist/esm/icons/users';
import X from 'lucide-react/dist/esm/icons/x';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ThemePicker } from '@/components/ui/theme-picker';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Discovery',
    items: [
      { href: '/', label: 'Dashboard', icon: Home },
      { href: '/search', label: 'Search', icon: Search },
      { href: '/discover', label: 'Discover', icon: Sparkles },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/subscriptions', label: 'Subscriptions', icon: TrendingUp },
      { href: '/queue', label: 'Review Queue', icon: ListChecks },
      { href: '/downloads', label: 'Downloads', icon: Download },
    ],
  },
  {
    label: 'System',
    adminOnly: true,
    items: [
      { href: '/connections', label: 'Connections', icon: Plug },
      { href: '/library', label: 'Library', icon: Library },
      { href: '/jobs', label: 'Jobs', icon: Layers },
      { href: '/logs', label: 'Logs', icon: FileText },
      { href: '/users', label: 'Users', icon: Users },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { user, logout } = useAuth();
  const router = useRouter();

  // Fetch version and update status
  const { data: healthData } = useQuery<{
    version?: string;
    update?: { latest: string; url: string } | null;
  }>({
    queryKey: ['health-live'],
    queryFn: async () => {
      const res = await fetch('/api/health/live');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    // Refresh the version/update indicator often enough that it isn't
    // stale for hours after an upgrade is published
    refetchInterval: 10 * 60 * 1000,
  });

  // Filter nav groups based on user role
  const visibleNavGroups = navGroups
    .filter(group => !group.adminOnly || user?.role === 'admin')
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.adminOnly || user?.role === 'admin')
    }))
    .filter(group => group.items.length > 0);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved !== null) {
      setCollapsed(JSON.parse(saved));
    }
  }, []);

  const toggleCollapsed = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', JSON.stringify(newState));
  };

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!mounted) {
    return null;
  }

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-sidebar p-2 lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-6 w-6" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 lg:relative',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm flex-shrink-0">
              M
            </span>
            {!collapsed && (
              <span className="text-lg font-semibold truncate">Mixarr</span>
            )}
          </Link>
          <div className="flex items-center gap-1">
            {/* Collapse toggle */}
            <button
              onClick={() => mobileOpen ? setMobileOpen(false) : toggleCollapsed()}
              className="rounded-lg p-2 hover:bg-accent transition-colors"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {mobileOpen ? (
                <X className="h-5 w-5" />
              ) : collapsed ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <ChevronLeft className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-4 p-2 overflow-y-auto">
          {visibleNavGroups.map((group) => (
            <div key={group.label} className="space-y-1" role="group" aria-label={group.label}>
              {!collapsed && (
                <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h3>
              )}
              {group.items.map((item) => {
                const isActive = item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-sidebar-foreground hover:bg-accent hover:text-accent-foreground',
                      collapsed && 'justify-center'
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer with user avatar */}
        <div className="border-t border-sidebar-border p-2 relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent',
              collapsed && 'justify-center'
            )}
          >
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium flex-shrink-0">
              {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium truncate">{user?.displayName || user?.username}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.role}</p>
                </div>
                <ChevronDown className={cn("h-4 w-4 transition-transform", userMenuOpen && "rotate-180")} />
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
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  title={`Update available: v${healthData.update.latest}`}
                >
                  {collapsed
                    ? <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                    : <>v{healthData.version} · update ↑</>
                  }
                </a>
              ) : (
                !collapsed && (
                  <span className="text-xs text-muted-foreground">v{healthData.version}</span>
                )
              )}
            </div>
          )}

          {/* User dropdown menu */}
          {userMenuOpen && (
            <div className={cn(
              "absolute bottom-full left-2 right-2 mb-1 rounded-lg border bg-popover shadow-lg z-50",
              collapsed && "left-0 right-auto w-48"
            )}>
              <div className="p-1">
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push(user?.role === 'admin' ? '/settings' : '/users/me');
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent"
                >
                  <Settings className="h-4 w-4" />
                  {user?.role === 'admin' ? 'Settings' : 'My Profile'}
                </button>
                <div className="border-t my-1" />
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1.5">Theme</p>
                  <ThemePicker />
                </div>
                <div className="border-t my-1" />
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout();
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
    </>
  );
}
