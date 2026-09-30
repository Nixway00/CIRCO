import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Providers from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: '$CIRCO · The 24/7 memecoin circus',
  description: 'Every trade pumps the balloon. Every ticket burns $CIRCO. When it pops, someone wins.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')),
  applicationName: '$CIRCO',
  openGraph: {
    type: 'website', siteName: '$CIRCO',
    title: '$CIRCO · The 24/7 memecoin circus',
    description: 'Every trade pumps the balloon. Every ticket burns $CIRCO. When it pops, someone wins.',
  },
  twitter: {
    card: 'summary_large_image',
    title: '$CIRCO · The 24/7 memecoin circus',
    description: 'Every trade pumps the balloon. Every ticket burns $CIRCO. When it pops, someone wins.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
