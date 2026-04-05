import { Button, Card, Input } from 'antd';

import { Eyebrow } from '@/components/ui-primitives.tsx';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const hasError = params.error === 'invalid';

  return (
    <Card
      className="surface-card center-card login-card"
      styles={{ body: { padding: 24 } }}
    >
      <Eyebrow>Admin Login</Eyebrow>
      <h2>Unlock the MedvedssonCrypto PWA</h2>
      <p className="muted">
        This build uses a single shared admin password and a signed session
        cookie.
      </p>
      <form action="/api/auth/login" method="post" className="stack-lg">
        <label className="field-label" htmlFor="password">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
        />
        {hasError ? (
          <p className="status-line status-line-danger">Invalid password.</p>
        ) : null}
        <Button htmlType="submit" type="primary">
          Sign In
        </Button>
      </form>
    </Card>
  );
}
