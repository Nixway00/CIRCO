'use client';
import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

/** Wallet Standard picks up Phantom, Solflare, Backpack… automatically, also inside their in-app browsers. */
export default function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [], []);
  // the browser talks to our /api/rpc proxy: the real RPC key never leaves the server
  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/rpc` : 'https://api.mainnet-beta.solana.com';
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed', wsEndpoint: 'wss://api.mainnet-beta.solana.com' }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
