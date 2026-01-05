import type { Metadata, Viewport } from 'next';
import { 
  Inter, 
  Playfair_Display, 
  IBM_Plex_Sans, 
  IBM_Plex_Serif, 
  Space_Mono, 
  Space_Grotesk, 
  DM_Sans, 
  Outfit 
} from 'next/font/google';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/lib/auth';
import { ProtectedLayout } from '@/components/layout/protected-layout';
import { ServiceWorkerRegistration } from '@/lib/service-worker';
import { OfflineIndicator } from '@/components/ui/offline-indicator';
import './globals.css';

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-sans',
});

const ibmPlexSerif = IBM_Plex_Serif({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-serif',
});

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-space-mono',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
});

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
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${playfair.variable} ${ibmPlexSans.variable} ${ibmPlexSerif.variable} ${spaceMono.variable} ${spaceGrotesk.variable} ${dmSans.variable} ${outfit.variable} font-sans`}>
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="midnight-modern"
          themes={['dark-luxe', 'editorial-clean', 'neo-brutalist', 'soft-gradient', 'vinyl-retro', 'midnight-modern']}
          enableSystem={false}
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
