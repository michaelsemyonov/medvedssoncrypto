import { createSessionToken, verifySessionToken } from '@medvedsson/shared';

describe('session auth', () => {
  it('creates and verifies a signed admin session token', () => {
    const secret = 'super-secret-session-key-with-32-plus-bytes';
    const token = createSessionToken(secret, 1);
    const payload = verifySessionToken(token, secret);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('admin');
    expect(payload?.exp).toBeGreaterThan(payload?.iat ?? 0);
  });

  it('rejects tampered tokens', () => {
    const secret = 'super-secret-session-key-with-32-plus-bytes';
    const token = createSessionToken(secret, 1);
    const tampered = `${token}tampered`;

    expect(verifySessionToken(tampered, secret)).toBeNull();
  });
});
