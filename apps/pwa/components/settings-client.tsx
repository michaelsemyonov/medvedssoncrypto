'use client';

import { useState } from 'react';

type SettingsClientProps = {
  apiUnavailable: boolean;
  vapidPublicKey: string;
  symbols: string[];
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);

  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
};

export function SettingsClient({ apiUnavailable, vapidPublicKey, symbols }: SettingsClientProps) {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(symbols);
  const [status, setStatus] = useState<string>('Idle');

  const subscribe = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('Push notifications are not supported in this browser.');
      return;
    }

    if (!vapidPublicKey) {
      setStatus('The backend is missing VAPID configuration.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      setStatus('Notification permission was not granted.');
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource
    });

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        subscription,
        symbolFilters: selectedSymbols,
        eventFilters: ['entry', 'exit', 'runner_error']
      })
    });

    if (!response.ok) {
      setStatus('Subscription failed.');
      return;
    }

    setStatus('Subscribed to push notifications.');
  };

  const unsubscribe = async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      setStatus('No active subscription found.');
      return;
    }

    const response = await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint
      })
    });

    if (!response.ok) {
      setStatus('Unsubscribe failed.');
      return;
    }

    await subscription.unsubscribe();
    setStatus('Push notifications disabled.');
  };

  const logout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST'
    });
    window.location.href = '/login';
  };

  return (
    <div className="stack-lg">
      <div className="card">
        <h2>Push Notifications</h2>
        <p className="muted">Signals arrive as web push alerts. Execution stays dry-run only in V1.</p>
        {apiUnavailable ? (
          <p className="status-line">Settings are temporarily degraded while the backend API reconnects.</p>
        ) : null}
        <div className="button-row">
          <button className="primary-button" onClick={() => void subscribe()} type="button">
            Subscribe
          </button>
          <button className="secondary-button" onClick={() => void unsubscribe()} type="button">
            Unsubscribe
          </button>
          <button className="secondary-button" onClick={() => void logout()} type="button">
            Sign Out
          </button>
        </div>
        <p className="status-line">{status}</p>
      </div>

      <div className="card">
        <h2>Symbol Filters</h2>
        <p className="muted">Pick which active symbols should trigger push alerts on this device.</p>
        <div className="chip-grid">
          {symbols.map((symbol) => {
            const active = selectedSymbols.includes(symbol);

            return (
              <button
                key={symbol}
                className={active ? 'chip chip-active' : 'chip'}
                onClick={() =>
                  setSelectedSymbols((current) =>
                    current.includes(symbol)
                      ? current.filter((item) => item !== symbol)
                      : [...current, symbol]
                  )
                }
                type="button"
              >
                {symbol}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
