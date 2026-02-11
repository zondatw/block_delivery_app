import type { Keypair } from '@solana/web3.js';
import type { BoxKeyPair } from 'tweetnacl';

type WalletKind = 'solflare' | 'phantom' | 'local';
type WalletListener = (next: WalletKind) => void;
type LocalWalletListener = (next: Keypair | null) => void;

let activeWallet: WalletKind = 'solflare';
let walletListeners: WalletListener[] = [];

let localKeypair: Keypair | null = null;
let localKeypairListeners: LocalWalletListener[] = [];

let solflareBoxKeypair: BoxKeyPair | null = null;
let solflareBoxListeners: Array<(next: BoxKeyPair | null) => void> = [];

let phantomBoxKeypair: BoxKeyPair | null = null;
let phantomBoxListeners: Array<(next: BoxKeyPair | null) => void> = [];

export const getActiveWallet = () => activeWallet;

export const setActiveWallet = (next: WalletKind) => {
  activeWallet = next;
  walletListeners.forEach((listener) => listener(activeWallet));
};

export const subscribeActiveWallet = (listener: WalletListener) => {
  walletListeners = [...walletListeners, listener];
  return () => {
    walletListeners = walletListeners.filter((item) => item !== listener);
  };
};

export const getLocalKeypair = () => localKeypair;

export const setLocalKeypair = (next: Keypair | null) => {
  localKeypair = next;
  localKeypairListeners.forEach((listener) => listener(localKeypair));
};

export const subscribeLocalKeypair = (listener: LocalWalletListener) => {
  localKeypairListeners = [...localKeypairListeners, listener];
  return () => {
    localKeypairListeners = localKeypairListeners.filter((item) => item !== listener);
  };
};

export const getSolflareBoxKeypair = () => solflareBoxKeypair;

export const setSolflareBoxKeypair = (next: BoxKeyPair | null) => {
  solflareBoxKeypair = next;
  solflareBoxListeners.forEach((listener) => listener(solflareBoxKeypair));
};

export const subscribeSolflareBoxKeypair = (listener: (next: BoxKeyPair | null) => void) => {
  solflareBoxListeners = [...solflareBoxListeners, listener];
  return () => {
    solflareBoxListeners = solflareBoxListeners.filter((item) => item !== listener);
  };
};

export const getPhantomBoxKeypair = () => phantomBoxKeypair;

export const setPhantomBoxKeypair = (next: BoxKeyPair | null) => {
  phantomBoxKeypair = next;
  phantomBoxListeners.forEach((listener) => listener(phantomBoxKeypair));
};

export const subscribePhantomBoxKeypair = (listener: (next: BoxKeyPair | null) => void) => {
  phantomBoxListeners = [...phantomBoxListeners, listener];
  return () => {
    phantomBoxListeners = phantomBoxListeners.filter((item) => item !== listener);
  };
};
