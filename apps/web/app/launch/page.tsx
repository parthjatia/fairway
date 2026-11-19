import { PageHeader } from '@/components/ui';
import { LaunchWizard } from '@/components/launch-wizard';
import { LaunchList } from '@/components/launch-list';
import { DEMO_LAUNCHES } from '@/lib/launches';

export const metadata = { title: 'Launch — Fairway' };

export default function LaunchPage() {
  return (
    <>
      <PageHeader eyebrow="Fairway Launch" title="Launch a token. Snipers pay, humans don't.">
        Other launchpads tax everyone who is early. A Fairway launch charges by tier and by time since launch: known snipers start at 10%, fresh wallets at 3% (so switching wallets gains nothing), and wallets with a clean
        history pay 0.3% from block 0. Every curve decays to normal fees over the launch window.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <LaunchWizard />
        <LaunchList demo={DEMO_LAUNCHES} />
      </div>
    </>
  );
}
