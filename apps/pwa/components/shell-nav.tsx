'use client';

import { Menu } from 'antd';
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

  if (pathname === '/login') {
    return null;
  }

  return (
    <div className="hero-nav">
      <Menu
        className="hero-menu"
        items={NAV_ITEMS.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: <Link href={item.href}>{item.label}</Link>,
        }))}
        mode="horizontal"
        overflowedIndicator={null}
        selectedKeys={selectedKey ? [selectedKey] : []}
      />
      <HeaderSignOutButton />
    </div>
  );
}
