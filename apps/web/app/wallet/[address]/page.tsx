import { WalletDetail } from '@/components/wallet-detail';

export const metadata = { title: 'Wallet — Fairway' };

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <WalletDetail address={address} />;
}
