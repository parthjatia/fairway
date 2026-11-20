import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AppStateProvider } from '@/lib/client/state';
import { LiveProvider } from '@/components/live/live-provider';
import { Shell } from '@/components/shell';
import { pairs, personas, poolView } from '@/lib/server/data';

// Self-hosted (SIL OFL) so the offline demo needs no font CDN.
const sans = localFont({ src: './fonts/ibm-plex-sans-latin.woff2', weight: '400 600', variable: '--font-plex-sans', display: 'swap' });
const mono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-400-latin.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono-500-latin.woff2', weight: '500' },
    { path: './fonts/ibm-plex-mono-700-latin.woff2', weight: '700' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});
const serif = localFont({ src: './fonts/newsreader-latin.woff2', weight: '400 500', variable: '--font-newsreader', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Fairway: know who you are buying from', template: '%s · Fairway' },
  description: 'Fairway Check shows who bought a Solana token in its first minute, and Fairway Launch makes snipers pay more. Powered by QuickNode Streams.',
};

// set the theme before paint (default light, the paper look) to avoid a flash
const themeScript = `try{var t=localStorage.getItem('fw.theme');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const initialPools = { sol: poolView('sol').reserves, bonk: poolView('bonk').reserves };
  return (
    <html lang="en" data-theme="light" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppStateProvider personas={personas()} pairs={pairs()} initialPools={initialPools}>
          <LiveProvider>
            <Shell>{children}</Shell>
          </LiveProvider>
        </AppStateProvider>
      </body>
    </html>
  );
}
