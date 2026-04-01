import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import Link from 'next/link';

import { HeaderSignOutButton } from '@/components/header-signout-button.tsx';
import { ServiceWorkerRegister } from '@/components/service-worker-register.tsx';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
});

export const metadata: Metadata = {
  title: 'MedvedssonCrypto',
  description:
    'Dry-run crypto signal monitoring, trade simulation, and PWA notifications.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MedvedssonCrypto',
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${ibmPlexMono.variable}`}>
        <ServiceWorkerRegister />
        <main className="shell">
          <section className="hero">
            <div className="eyebrow">MedvedssonCrypto</div>
            <nav className="hero-nav">
              <Link className="hero-link" href="/">
                Dashboard
              </Link>
              <Link className="hero-link" href="/signals">
                Signals
              </Link>
              <Link className="hero-link" href="/positions">
                Positions
              </Link>
              <Link className="hero-link" href="/trades">
                Trades
              </Link>
              <Link className="hero-link" href="/settings">
                Settings
              </Link>
              <HeaderSignOutButton />
            </nav>
          </section>
          {children}
        </main>
      </body>
    </html>
  );
}
