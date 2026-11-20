import { PageHeader } from '@/components/ui';
import { LaunchFeed } from '@/components/fw/launch-feed';

export const metadata = { title: 'Launch' };

export default function LaunchPage() {
  return (
    <>
      <PageHeader eyebrow="Fairway Launch" title="Launch a token. Snipers pay, humans don't.">
        A Fairway launch charges by tier and by time since launch: known snipers start at 10%, fresh wallets at 3% (so switching wallets gains nothing), and wallets with a clean history pay 0.3% from block 0. Every curve decays to
        normal fees over the launch window.
      </PageHeader>
      <LaunchFeed />
    </>
  );
}
