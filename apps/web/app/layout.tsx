import type { Metadata } from 'next';
import './globals.css';
import { AppStateProvider } from '@/lib/client/state';
import { LiveProvider } from '@/components/live/live-provider';
import { Shell } from '@/components/shell';
import { personas, poolView } from '@/lib/server/data';

export const metadata: Metadata = {
  title: 'Fairway — bots pay more, humans pay less',
  description: 'A Solana AMM whose swap fee depends on the trader’s measured toxicity (markout), powered by QuickNode Streams.',
};

// set the theme before paint (default dark) to avoid a flash
const themeScript = `try{var t=localStorage.getItem('fw.theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const p = poolView();
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppStateProvider personas={personas()} initialPool={p.reserves}>
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
