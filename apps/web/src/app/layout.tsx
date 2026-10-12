import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/lib/auth';
import { ProtectedLayout } from '@/components/layout/protected-layout';
import { ServiceWorkerRegistration } from '@/lib/service-worker';
import { OfflineIndicator } from '@/components/ui/offline-indicator';
import './globals.css';
export const metadata: Metadata = {
  title: 'Mixarr',
  description: 'Music discovery and import tool for Lidarr',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Mixarr',
    description: 'Music discovery and import tool for Lidarr',
    siteName: 'Mixarr',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Mixarr - Music discovery and import tool for Lidarr',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mixarr',
    description: 'Music discovery and import tool for Lidarr',
    images: ['/og-image.png'],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F8F8' },
    { media: '(prefers-color-scheme: dark)', color: '#171A1D' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="system"
          enableSystem={true}
          disableTransitionOnChange={false}
        >
          <QueryProvider>
            <AuthProvider>
              <ToastProvider>
                <ServiceWorkerRegistration />
                <OfflineIndicator />
                <ProtectedLayout>
                  {children}
                </ProtectedLayout>
              </ToastProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
