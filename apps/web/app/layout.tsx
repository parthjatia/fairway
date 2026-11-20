import type { Metadata } from 'next';
import './globals.css';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { AppStateProvider } from '@/lib/client/state';
import { LiveProvider } from '@/components/live/live-provider';
import { Shell } from '@/components/shell';
import { pairs, personas, poolView } from '@/lib/server/data';

export const metadata: Metadata = {
  title: { default: 'Fairway: know who you are buying from', template: '%s · Fairway' },
  description: 'Fairway Check shows who bought a Solana token in its first minute, and Fairway Launch makes snipers pay more. Powered by QuickNode Streams.',
};

// set the theme before paint (default dark) to avoid a flash
const themeScript = `try{var t=localStorage.getItem('fw.theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const initialPools = { sol: poolView('sol').reserves, bonk: poolView('bonk').reserves };
  return (
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppStateProvider personas={personas()} pairs={pairs()} initialPools={initialPools}>
          {process.env.NEXT_PUBLIC_MODE === 'live' ? (
            <LiveProvider>
              <Shell>{children}</Shell>
            </LiveProvider>
          ) : (
            <Shell>{children}</Shell>
          )}
        </AppStateProvider>
      </body>
    </html>
  );
}
