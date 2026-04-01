export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const hasError = params.error === 'invalid';

  return (
    <section className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="eyebrow">Admin Login</div>
      <h2>Unlock the MedvedssonCrypto PWA</h2>
      <p className="muted">
        This build uses a single shared admin password and a signed session cookie.
      </p>
      <form action="/api/auth/login" method="post" className="stack-lg">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="input"
          autoFocus
        />
        {hasError ? <p className="status-line" style={{ color: 'var(--danger)' }}>Invalid password.</p> : null}
        <button className="primary-button" type="submit">
          Sign In
        </button>
      </form>
    </section>
  );
}
