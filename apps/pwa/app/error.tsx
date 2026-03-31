'use client';

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="card" style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="eyebrow">PWA Error</div>
      <h2>Something went wrong while loading the dashboard.</h2>
      <p className="muted">
        {error.message || 'The page could not be rendered right now. You can retry without reloading the whole app.'}
      </p>
      <div className="button-row">
        <button className="primary-button" onClick={() => reset()} type="button">
          Try Again
        </button>
      </div>
    </section>
  );
}
