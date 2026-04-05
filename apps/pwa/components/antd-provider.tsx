'use client';

import { App, ConfigProvider, theme } from 'antd';

type AntdProviderProps = {
  children: React.ReactNode;
};

export function AntdProvider({ children }: AntdProviderProps) {
  return (
    <ConfigProvider
      componentSize="large"
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          borderRadius: 18,
          borderRadiusLG: 24,
          colorBgBase: '#000000',
          colorBgContainer: 'rgba(8, 12, 18, 0.82)',
          colorBgElevated: 'rgba(8, 12, 18, 0.96)',
          colorBgLayout: '#000000',
          colorBorder: 'rgba(123, 163, 214, 0.18)',
          colorBorderSecondary: 'rgba(123, 163, 214, 0.18)',
          colorError: '#fb7185',
          colorFillSecondary: 'rgba(255, 255, 255, 0.03)',
          colorFillTertiary: 'rgba(255, 255, 255, 0.05)',
          colorPrimary: '#6ee7b7',
          colorSuccess: '#6ee7b7',
          colorText: '#eff6ff',
          colorTextSecondary: '#9fb6d3',
          colorWarning: '#fbbf24',
          controlHeight: 48,
          fontFamily: 'var(--font-space-grotesk), sans-serif',
          fontFamilyCode: 'var(--font-ibm-plex-mono), monospace',
        },
      }}
    >
      <App className="antd-app-shell">{children}</App>
    </ConfigProvider>
  );
}
