'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Home,
  Plug,
  Search,
  Sparkles,
  TrendingUp,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Users,
  Layers,
  ListChecks,
  LogOut,
  ChevronDown,
  Library,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ThemePicker } from '@/components/ui/theme-picker';

const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/connections', label: 'Connections', icon: Plug },
  { href: '/library', label: 'Library', icon: Library, adminOnly: true },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/discover', label: 'Discover', icon: Sparkles },
  { href: '/subscriptions', label: 'Subscriptions', icon: TrendingUp },
  { href: '/queue', label: 'Review Queue', icon: ListChecks },
  { href: '/duplicates', label: 'Duplicates', icon: Copy },
  { href: '/jobs', label: 'Jobs', icon: Layers },
  { href: '/logs', label: 'Logs', icon: FileText },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { user, logout } = useAuth();
  const router = useRouter();

  // Filter nav items based on user role
  const visibleNavItems = navItems.filter(item => !item.adminOnly || user?.role === 'admin');

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
          {!collapsed && (
            <span className="text-lg font-semibold truncate">Mixarr</span>
          )}
          <div className="flex items-center gap-1">
            {/* Theme picker */}
            <ThemePicker />
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
        <nav className="flex-1 space-y-1 p-2 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const isActive = pathname === item.href;
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
                    router.push('/settings');
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
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
