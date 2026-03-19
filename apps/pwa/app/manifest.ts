import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MedvedssonCrypto',
    short_name: 'Medvedsson',
    description: 'Dry-run crypto signal and push notification dashboard.',
    start_url: '/',
    display: 'standalone',
    background_color: '#07111d',
    theme_color: '#14b8a6',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml'
      }
    ]
  };
}
