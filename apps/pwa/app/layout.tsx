import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import Link from 'next/link';

import {
  DashboardIcon,
  PositionsIcon,
  SettingsIcon,
  SignalsIcon,
  TradesIcon,
} from '@/components/header-icons.tsx';
import { HeaderRunnerStatus } from '@/components/header-runner-status.tsx';
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
            <div className="hero-heading">
              <div className="eyebrow">MedvedssonCrypto</div>
              <HeaderRunnerStatus />
            </div>
            <nav className="hero-nav">
              <Link className="hero-link" href="/">
                <span className="hero-link-content">
                  <DashboardIcon className="hero-link-icon" />
                  <span>Dashboard</span>
                </span>
              </Link>
              <Link className="hero-link" href="/signals">
                <span className="hero-link-content">
                  <SignalsIcon className="hero-link-icon" />
                  <span>Signals</span>
                </span>
              </Link>
              <Link className="hero-link" href="/positions">
                <span className="hero-link-content">
                  <PositionsIcon className="hero-link-icon" />
                  <span>Positions</span>
                </span>
              </Link>
              <Link className="hero-link" href="/trades">
                <span className="hero-link-content">
                  <TradesIcon className="hero-link-icon" />
                  <span>Trades</span>
                </span>
              </Link>
              <Link className="hero-link" href="/settings">
                <span className="hero-link-content">
                  <SettingsIcon className="hero-link-icon" />
                  <span>Settings</span>
                </span>
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
