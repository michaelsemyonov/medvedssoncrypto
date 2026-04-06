'use client';

import React, { useMemo, useState } from 'react';
import { Menu, Button, Drawer, Grid } from 'antd';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  DashboardIcon,
  PositionsIcon,
  SettingsIcon,
  SignalsIcon,
  TradesIcon,
} from '@/components/header-icons.tsx';
import { HeaderSignOutButton } from '@/components/header-signout-button.tsx';

/**
 * Responsive header navigation:
 * - Uses Ant Design breakpoints via `Grid.useBreakpoint()`.
 * - Shows horizontal `Menu` on `md` and larger screens.
 * - On small screens, shows a simple text hamburger (no external icon package)
 *   which opens a `Drawer` containing a vertical `Menu` and the sign-out button.
 *
 * This version avoids importing `@ant-design/icons` to keep dependencies minimal.
 */

const NAV_ITEMS = [
  {
    key: '/',
    href: '/',
    icon: <DashboardIcon className="hero-link-icon" />,
    label: 'Dashboard',
  },
  {
    key: '/signals',
    href: '/signals',
    icon: <SignalsIcon className="hero-link-icon" />,
    label: 'Signals',
  },
  {
    key: '/positions',
    href: '/positions',
    icon: <PositionsIcon className="hero-link-icon" />,
    label: 'Positions',
  },
  {
    key: '/trades',
    href: '/trades',
    icon: <TradesIcon className="hero-link-icon" />,
    label: 'Trades',
  },
  {
    key: '/settings',
    href: '/settings',
    icon: <SettingsIcon className="hero-link-icon" />,
    label: 'Settings',
  },
];

const resolveSelectedKey = (pathname: string): string => {
  if (pathname === '/login') {
    return '';
  }

  return (
    NAV_ITEMS.find((item) =>
      item.key === '/' ? pathname === '/' : pathname.startsWith(item.key)
    )?.key ?? pathname
  );
};

export function ShellNav() {
  const pathname = usePathname();
  const selectedKey = resolveSelectedKey(pathname);
  const screens = Grid.useBreakpoint();
  const isMdUp = Boolean(screens?.md);

  const [drawerOpen, setDrawerOpen] = useState(false);

  if (pathname === '/login') {
    return null;
  }

  // Build Menu items in the shape AntD expects.
  const menuItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        key: item.key,
        icon: item.icon,
        // Use Link as the label to keep client-side routing.
        label: <Link href={item.href}>{item.label}</Link>,
      })),
    []
  );

  const handleMenuClickInDrawer = () => {
    // Close the drawer after a navigation click on mobile.
    setDrawerOpen(false);
  };

  return (
    <div className="hero-nav" role="navigation" aria-label="Main Navigation">
      {isMdUp ? (
        // Desktop / tablet: show inline horizontal menu + sign-out button
        <>
          <Menu
            className="hero-menu"
            items={menuItems}
            mode="horizontal"
            overflowedIndicator={null}
            selectedKeys={selectedKey ? [selectedKey] : []}
          />
          <HeaderSignOutButton />
        </>
      ) : (
        // Mobile: compact header with a simple text hamburger that opens a Drawer
        <>
          <Button
            type="text"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="hero-hamburger"
          >
            {/* Use a simple unicode hamburger to avoid external icon dependency */}
            <span style={{ fontSize: 20, lineHeight: 1 }}>☰</span>
          </Button>

          <Drawer
            title="Menu"
            placement="top"
            onClose={() => setDrawerOpen(false)}
            open={drawerOpen}
            height="auto"
            bodyStyle={{ padding: 8 }}
            headerStyle={{ padding: '12px 16px' }}
            closeIcon={null}
          >
            <Menu
              items={menuItems}
              mode="vertical"
              selectable
              selectedKeys={selectedKey ? [selectedKey] : []}
              onClick={handleMenuClickInDrawer}
            />
            <div style={{ marginTop: 12 }}>
              <HeaderSignOutButton />
            </div>
          </Drawer>
        </>
      )}
    </div>
  );
}

export default ShellNav;
