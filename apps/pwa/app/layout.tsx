import type { Metadata, Viewport } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { Card } from 'antd';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';

import { AntdProvider } from '@/components/antd-provider.tsx';
import { HeaderRunnerStatus } from '@/components/header-runner-status.tsx';
import { ShellNav } from '@/components/shell-nav.tsx';
import { Eyebrow } from '@/components/ui-primitives.tsx';
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
        <AntdRegistry>
          <AntdProvider>
            <ServiceWorkerRegister />
            <main className="shell">
              <Card className="hero-card" styles={{ body: { padding: 0 } }}>
                <div className="hero">
                  <div className="hero-heading">
                    <Eyebrow>MedvedssonCrypto</Eyebrow>
                    <HeaderRunnerStatus />
                  </div>
                  <ShellNav />
                </div>
              </Card>
              {children}
            </main>
          </AntdProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
