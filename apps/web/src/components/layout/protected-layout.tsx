'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth, safeReturnTo } from '@/lib/auth';
import { Sidebar } from './sidebar';
import { LoadingPage } from '@/components/ui/loading';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { MobileNav } from './mobile-nav';
import Menu from 'lucide-react/dist/esm/icons/menu';
import { ArtistInspector } from '@/components/artists/ArtistInspector';
import { ListScrollContext } from '@/hooks/useListContext';

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

// Routes that don't require authentication and have their own layout
const publicRoutes = ['/login', '/setup'];
const artistRoutes = ['/', '/search', '/discover', '/library', '/queue', '/constellation'];

export function ProtectedLayout({ children }: ProtectedLayoutProps) {
  return <Suspense fallback={<LoadingPage text="Checking authentication..." />}><AuthenticatedLayout>{children}</AuthenticatedLayout></Suspense>;
}

function AuthenticatedLayout({ children }: ProtectedLayoutProps) {
  const { isLoading, isAuthenticated, setupRequired, apiError } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToast } = useToast();
  const [updateToastShown, setUpdateToastShown] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMobileOpen(false), []);
  const query = searchParams.toString();
  useEffect(closeMenu, [pathname, query, closeMenu]);

  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // Fetch version/update status when authenticated
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
    enabled: isAuthenticated,
  });

  // Show update toast once per session
  useEffect(() => {
    if (healthData?.update && !updateToastShown) {
      setUpdateToastShown(true);
      addToast({
        type: 'info',
        title: `Mixarr v${healthData.update.latest} available`,
        message: 'Visit GitHub to download the latest release.',
      });
    }
  }, [healthData, updateToastShown, addToast]);

  useEffect(() => {
    if (isLoading) return;
    
    // Don't redirect while API is unreachable - keep showing loading
    if (apiError) return;

    if (!isAuthenticated && !isPublicRoute) {
      // Use cached setupRequired from auth context - no additional API call needed
      if (setupRequired) {
        router.push('/setup');
      } else {
        // Include returnTo so user is redirected back after login
        const returnTo = encodeURIComponent(`${pathname}${query ? `?${query}` : ''}`);
        router.push(`/login?returnTo=${returnTo}`);
      }
    }

    // Only redirect from login page, NOT from setup (user needs to complete wizard)
    if (isAuthenticated && pathname === '/login') {
      router.replace(safeReturnTo(searchParams.get('returnTo')));
    }
  }, [isLoading, isAuthenticated, pathname, query, searchParams, router, isPublicRoute, setupRequired, apiError]);

  // Show loading state while checking auth or waiting for API
  if (isLoading || apiError) {
    return <LoadingPage text={apiError ? "Connecting to server..." : "Checking authentication..."} />;
  }

  // For public routes (login, setup), render just the children with no sidebar
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Not authenticated and not a public route - show loading while redirect happens
  if (!isAuthenticated) {
    return <LoadingPage text="Redirecting to login..." />;
  }

  // Authenticated - show full layout with sidebar
  return (
    <div className="flex h-dvh min-w-0 overflow-hidden">
      <Sidebar />
      <main ref={setScrollElement} data-list-scroll className="min-w-0 flex-1 overflow-y-auto">
        <header data-catalog-topbar className="sticky top-0 z-30 flex h-[57px] items-center gap-3 border-b bg-background px-3 lg:px-4">
          <button type="button" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-button hover:bg-muted lg:hidden">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="font-semibold lg:hidden">Mixarr</span>
          <span className="hidden font-mono text-xs text-muted-foreground lg:inline">Music catalog</span>
        </header>
        <div className="mx-auto px-3 py-4 lg:px-4">
          <ListScrollContext.Provider value={scrollElement}>{children}
            {(artistRoutes.includes(pathname) || /^\/subscriptions\/\d+$/.test(pathname)) && <ArtistInspector restoreContext={pathname !== '/' && pathname !== '/search' && !/^\/subscriptions\/[1-9]\d*$/.test(pathname)} />}
          </ListScrollContext.Provider>
        </div>
      </main>
      <MobileNav isOpen={mobileOpen} onClose={closeMenu} />
    </div>
  );
}
