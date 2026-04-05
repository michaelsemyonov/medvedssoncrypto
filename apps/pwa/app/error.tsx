'use client';

import { Button, Card } from 'antd';

import { Eyebrow } from '@/components/ui-primitives.tsx';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card
      className="surface-card center-card error-card"
      styles={{ body: { padding: 24 } }}
    >
      <Eyebrow>PWA Error</Eyebrow>
      <h2>Something went wrong while loading the dashboard.</h2>
      <p className="muted">
        {error.message ||
          'The page could not be rendered right now. You can retry without reloading the whole app.'}
      </p>
      <div className="button-row">
        <Button onClick={() => reset()} type="primary">
          Try Again
        </Button>
      </div>
    </Card>
  );
}
