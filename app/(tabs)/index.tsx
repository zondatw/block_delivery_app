import 'react-native-get-random-values';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getSolflareState,
  handleSolflareCallbackUrl,
  resetSolflareState,
  setSolflareKeypair,
  subscribeSolflareState,
} from '@/lib/solflare-callback';
import {
  getPhantomState,
  handlePhantomCallbackUrl,
  resetPhantomState,
  setPhantomKeypair,
  subscribePhantomState,
} from '@/lib/phantom-callback';
import {
  getActiveWallet,
  getLocalKeypair,
  setActiveWallet,
  setLocalKeypair,
  setPhantomBoxKeypair,
  setSolflareBoxKeypair,
  subscribeActiveWallet,
  subscribeLocalKeypair,
} from '@/lib/wallet-store';

const DAPP_URL = process.env.EXPO_PUBLIC_DAPP_URL ?? 'https://example.com';
const CLUSTER = process.env.EXPO_PUBLIC_SOLANA_CHAIN ?? 'localnet';
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const REDIRECT_LINK = Linking.createURL('solflare-connect', { scheme: 'blockdeliveryapp' });
const PHANTOM_REDIRECT_LINK = Linking.createURL('phantom-connect', { scheme: 'blockdeliveryapp' });
const WALLET_SOLFLARE = 'solflare' as const;
const WALLET_PHANTOM = 'phantom' as const;
const WALLET_LOCAL = 'local' as const;

const shorten = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;

export default function WalletScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [solflareState, setSolflareState] = useState(getSolflareState());
  const [phantomState, setPhantomState] = useState(getPhantomState());
  const [activeWallet, setActiveWalletState] = useState<
    typeof WALLET_SOLFLARE | typeof WALLET_PHANTOM | typeof WALLET_LOCAL
  >(getActiveWallet());
  const [isLoading, setIsLoading] = useState(false);
  const [webWallet, setWebWallet] = useState<any>(null);
  const [phantomWebWallet, setPhantomWebWallet] = useState<any>(null);
  const keypairRef = useRef<nacl.BoxKeyPair | null>(null);
  const phantomKeypairRef = useRef<nacl.BoxKeyPair | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [rpcHealth, setRpcHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [rpcMessage, setRpcMessage] = useState<string | null>(null);
  const [rpcRaw, setRpcRaw] = useState<string | null>(null);
  const [isCheckingRpc, setIsCheckingRpc] = useState(false);
  const [localKeypair, setLocalKeypairState] = useState<Keypair | null>(getLocalKeypair());
  const [localBalance, setLocalBalance] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  const localConnection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);

  useEffect(() => subscribeActiveWallet(setActiveWalletState), []);
  useEffect(() => subscribeLocalKeypair(setLocalKeypairState), []);

  useEffect(() => {
    setSolflareState(getSolflareState());
    return subscribeSolflareState((next) => setSolflareState(next));
  }, []);

  useEffect(() => {
    setPhantomState(getPhantomState());
    return subscribePhantomState((next) => setPhantomState(next));
  }, []);

  useEffect(() => {
    if (!localKeypair) {
      setLocalBalance(null);
      return;
    }

    let active = true;

    const loadLocalBalance = async () => {
      try {
        const lamports = await localConnection.getBalance(localKeypair.publicKey, 'confirmed');
        if (active) {
          setLocalBalance(lamports / LAMPORTS_PER_SOL);
        }
      } catch (err) {
        if (active) {
          setLocalError('Unable to fetch local balance.');
        }
      }
    };

    loadLocalBalance();

    return () => {
      active = false;
    };
  }, [localConnection, localKeypair]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleSolflareCallbackUrl(url);
      handlePhantomCallbackUrl(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleSolflareCallbackUrl(url);
        handlePhantomCallbackUrl(url);
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    let active = true;

    const setupWebWallet = async () => {
      try {
        const solflareModule = await import('@solflare-wallet/sdk');
        if (!active) {
          return;
        }

        const wallet = new solflareModule.default();
        wallet.on?.('connect', () => {
          setSolflareState((prev) => ({
            ...prev,
            publicKey: wallet.publicKey?.toString?.() ?? null,
          }));
        });
        wallet.on?.('disconnect', () => {
          setSolflareState((prev) => ({ ...prev, publicKey: null }));
        });

        setWebWallet(wallet);
      } catch (err) {
        if (active) {
          setSolflareState((prev) => ({ ...prev, error: 'Solflare SDK failed to load.' }));
        }
      }
    };

    setupWebWallet();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    const phantom = (globalThis as any)?.solana;
    if (phantom?.isPhantom) {
      setPhantomWebWallet(phantom);
    }
  }, []);

  useEffect(() => {
    if (activeWallet === WALLET_LOCAL) {
      setBalance(null);
      setBalanceError(null);
      return;
    }

    const publicKey =
      activeWallet === WALLET_PHANTOM ? phantomState.publicKey : solflareState.publicKey;

    if (!publicKey) {
      setBalance(null);
      setBalanceError(null);
      return;
    }

    let active = true;

    const loadBalance = async () => {
      setBalanceError(null);
      try {
        const response = await fetch(SOLANA_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [publicKey],
          }),
        });
        const data = await response.json();
        const lamports = data?.result?.value;
        if (typeof lamports !== 'number') {
          throw new Error('Invalid balance response');
        }
        if (active) {
          setBalance(lamports / LAMPORTS_PER_SOL);
        }
      } catch (err) {
        if (active) {
          setBalanceError('Unable to fetch balance.');
        }
      }
    };

    loadBalance();

    return () => {
      active = false;
    };
  }, [activeWallet, phantomState.publicKey, solflareState.publicKey]);

  const createLocalWallet = () => {
    setLocalError(null);
    setActiveWallet(WALLET_LOCAL);
    const next = Keypair.generate();
    setLocalKeypair(next);
    setLocalKeypairState(next);
  };

  const refreshLocalBalance = async () => {
    if (!localKeypair) return;
    setLocalBusy(true);
    setLocalError(null);
    try {
      const lamports = await localConnection.getBalance(localKeypair.publicKey, 'confirmed');
      setLocalBalance(lamports / LAMPORTS_PER_SOL);
    } catch (err) {
      setLocalError('Unable to fetch local balance.');
    } finally {
      setLocalBusy(false);
    }
  };

  const airdropLocal = async () => {
    if (!localKeypair) return;
    setLocalBusy(true);
    setLocalError(null);
    try {
      const signature = await localConnection.requestAirdrop(
        localKeypair.publicKey,
        2 * LAMPORTS_PER_SOL,
      );
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const status = await localConnection.getSignatureStatuses([signature]);
        const info = status?.value?.[0];
        if (info?.confirmationStatus === 'confirmed' || info?.confirmationStatus === 'finalized') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const lamports = await localConnection.getBalance(localKeypair.publicKey, 'confirmed');
      setLocalBalance(lamports / LAMPORTS_PER_SOL);
    } catch (err) {
      setLocalError('Airdrop failed. Check RPC URL and local validator.');
    } finally {
      setLocalBusy(false);
    }
  };

  const checkRpcHealth = async () => {
    setIsCheckingRpc(true);
    setRpcMessage(null);
    setRpcRaw(null);
    try {
      const response = await fetch(SOLANA_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth',
        }),
      });
      const data = await response.json();
      if (data?.result === 'ok') {
        setRpcHealth('ok');
        setRpcMessage('RPC OK');
      } else {
        setRpcHealth('error');
        setRpcMessage('RPC unhealthy');
      }
      setRpcRaw(JSON.stringify(data));
    } catch (err) {
      setRpcHealth('error');
      setRpcMessage('RPC unreachable');
      setRpcRaw(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsCheckingRpc(false);
    }
  };

  const connectSolflare = async () => {
    setActiveWallet(WALLET_SOLFLARE);
    setSolflareState((prev) => ({ ...prev, error: null }));

    if (Platform.OS === 'web') {
      if (!webWallet) {
        setSolflareState((prev) => ({ ...prev, error: 'Solflare wallet not ready.' }));
        return;
      }
      setIsLoading(true);
      try {
        await webWallet.connect();
      } catch (err) {
        setSolflareState((prev) => ({ ...prev, error: 'Connection cancelled or failed.' }));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    resetSolflareState();
    const keypair = nacl.box.keyPair();
    keypairRef.current = keypair;
    setSolflareKeypair(keypair);
    setSolflareBoxKeypair(keypair);

    const dappPublicKey = bs58.encode(keypair.publicKey);
    const params = new URLSearchParams({
      app_url: DAPP_URL,
      dapp_encryption_public_key: dappPublicKey,
      redirect_link: REDIRECT_LINK,
      cluster: CLUSTER,
    });

    const url = `https://solflare.com/ul/v1/connect?${params.toString()}`;
    setIsLoading(true);
    try {
      await Linking.openURL(url);
    } catch (err) {
      resetSolflareState();
      setSolflareState((prev) => ({ ...prev, error: 'Unable to open Solflare.' }));
    } finally {
      setIsLoading(false);
    }
  };

  const connectPhantom = async () => {
    setActiveWallet(WALLET_PHANTOM);
    setPhantomState((prev) => ({ ...prev, error: null }));

    if (Platform.OS === 'web') {
      if (!phantomWebWallet) {
        setPhantomState((prev) => ({ ...prev, error: 'Phantom wallet not ready.' }));
        return;
      }
      setIsLoading(true);
      try {
        const response = await phantomWebWallet.connect();
        const publicKey =
          response?.publicKey?.toString?.() ??
          phantomWebWallet.publicKey?.toString?.() ??
          null;
        setPhantomState((prev) => ({ ...prev, publicKey }));
      } catch (err) {
        setPhantomState((prev) => ({ ...prev, error: 'Connection cancelled or failed.' }));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    resetPhantomState();
    const keypair = nacl.box.keyPair();
    phantomKeypairRef.current = keypair;
    setPhantomKeypair(keypair);
    setPhantomBoxKeypair(keypair);

    const dappPublicKey = bs58.encode(keypair.publicKey);
    const params = new URLSearchParams({
      app_url: DAPP_URL,
      dapp_encryption_public_key: dappPublicKey,
      redirect_link: PHANTOM_REDIRECT_LINK,
      cluster: CLUSTER,
    });

    const url = `https://phantom.app/ul/v1/connect?${params.toString()}`;
    setIsLoading(true);
    try {
      await Linking.openURL(url);
    } catch (err) {
      resetPhantomState();
      setPhantomState((prev) => ({ ...prev, error: 'Unable to open Phantom.' }));
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectSolflare = async () => {
    if (Platform.OS === 'web') {
      if (!webWallet) {
        return;
      }
      setIsLoading(true);
      try {
        await webWallet.disconnect();
      } catch (err) {
        setSolflareState((prev) => ({ ...prev, error: 'Disconnect failed.' }));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setSolflareKeypair(null);
    setSolflareBoxKeypair(null);
    resetSolflareState();
  };

  const disconnectPhantom = async () => {
    if (Platform.OS === 'web') {
      if (!phantomWebWallet) {
        return;
      }
      setIsLoading(true);
      try {
        await phantomWebWallet.disconnect();
      } catch (err) {
        setPhantomState((prev) => ({ ...prev, error: 'Disconnect failed.' }));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setPhantomKeypair(null);
    setPhantomBoxKeypair(null);
    resetPhantomState();
  };

  const isConnected = Boolean(solflareState.publicKey);
  const isPhantomConnected = Boolean(phantomState.publicKey);
  const isLocalConnected = Boolean(localKeypair);
  const activeError =
    activeWallet === WALLET_PHANTOM
      ? phantomState.error
      : activeWallet === WALLET_LOCAL
        ? localError
        : solflareState.error;
  const statusText = activeError
    ? `Error: ${activeError}`
    : activeWallet === WALLET_LOCAL
      ? localKeypair
        ? `Wallet: ${shorten(localKeypair.publicKey.toBase58())}`
        : 'Wallet: Not connected'
      : activeWallet === WALLET_PHANTOM
        ? phantomState.publicKey
          ? `Wallet: ${shorten(phantomState.publicKey)}`
          : 'Wallet: Not connected'
        : solflareState.publicKey
          ? `Wallet: ${shorten(solflareState.publicKey)}`
          : 'Wallet: Not connected';

  return (
    <ParallaxScrollView headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}>
      <ThemedView style={styles.container}>
        <View style={styles.hero}>
          <ThemedText type="title">Wallet</ThemedText>
          <ThemedText type="subtitle">Connect your Solana wallet</ThemedText>
          <ThemedText style={styles.heroCopy}>
            Mobile uses wallet deeplinks. Web uses browser wallet SDKs.
          </ThemedText>
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Active Wallet</ThemedText>
          <View style={styles.switchRow}>
            <Pressable
              style={[
                styles.switchButton,
                activeWallet === WALLET_SOLFLARE && styles.switchButtonActive,
              ]}
              onPress={() => setActiveWallet(WALLET_SOLFLARE)}>
              <ThemedText
                style={[
                  styles.switchText,
                  activeWallet === WALLET_SOLFLARE
                    ? styles.switchTextActive
                    : styles.switchTextInactive,
                ]}>
                Solflare
              </ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.switchButton,
                activeWallet === WALLET_PHANTOM && styles.switchButtonActive,
              ]}
              onPress={() => setActiveWallet(WALLET_PHANTOM)}>
              <ThemedText
                style={[
                  styles.switchText,
                  activeWallet === WALLET_PHANTOM
                    ? styles.switchTextActive
                    : styles.switchTextInactive,
                ]}>
                Phantom
              </ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.switchButton,
                activeWallet === WALLET_LOCAL && styles.switchButtonActive,
              ]}
              onPress={() => setActiveWallet(WALLET_LOCAL)}>
              <ThemedText
                style={[
                  styles.switchText,
                  activeWallet === WALLET_LOCAL
                    ? styles.switchTextActive
                    : styles.switchTextInactive,
                ]}>
                Local
              </ThemedText>
            </Pressable>
          </View>
          <ThemedText style={styles.cardText}>
            Using: {activeWallet.charAt(0).toUpperCase() + activeWallet.slice(1)}
          </ThemedText>
          {activeWallet === WALLET_SOLFLARE ? (
            isConnected ? (
              <Pressable
                style={({ pressed }) => [styles.disconnectButton, pressed && styles.buttonPressed]}
                onPress={disconnectSolflare}
                disabled={isLoading}
                accessibilityRole="button">
                {isLoading ? (
                  <ActivityIndicator color={Colors.light.background} />
                ) : (
                  <ThemedText style={styles.buttonText}>Disconnect Solflare</ThemedText>
                )}
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.connectButton, pressed && styles.buttonPressed]}
                onPress={connectSolflare}
                disabled={isLoading}
                accessibilityRole="button">
                {isLoading ? (
                  <ActivityIndicator color={Colors.light.background} />
                ) : (
                  <ThemedText style={styles.buttonText}>Connect Solflare</ThemedText>
                )}
              </Pressable>
            )
          ) : null}
          {activeWallet === WALLET_PHANTOM ? (
            isPhantomConnected ? (
              <Pressable
                style={({ pressed }) => [styles.disconnectButton, pressed && styles.buttonPressed]}
                onPress={disconnectPhantom}
                disabled={isLoading}
                accessibilityRole="button">
                {isLoading ? (
                  <ActivityIndicator color={Colors.light.background} />
                ) : (
                  <ThemedText style={styles.buttonText}>Disconnect Phantom</ThemedText>
                )}
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.connectButton, pressed && styles.buttonPressed]}
                onPress={connectPhantom}
                disabled={isLoading}
                accessibilityRole="button">
                {isLoading ? (
                  <ActivityIndicator color={Colors.light.background} />
                ) : (
                  <ThemedText style={styles.buttonText}>Connect Phantom</ThemedText>
                )}
              </Pressable>
            )
          ) : null}
          {activeWallet === WALLET_LOCAL ? (
            <>
              <ThemedText style={styles.cardText}>RPC: {SOLANA_RPC_URL}</ThemedText>
              <ThemedText style={styles.cardText}>
                Address: {localKeypair ? shorten(localKeypair.publicKey.toBase58()) : 'Not created'}
              </ThemedText>
              <ThemedText style={styles.cardText}>
                Balance: {localBalance === null ? '—' : `${localBalance.toFixed(4)} SOL`}
              </ThemedText>
              {localError ? <ThemedText style={styles.cardText}>{localError}</ThemedText> : null}
              <Pressable
                style={({ pressed }) => [styles.connectButton, pressed && styles.buttonPressed]}
                onPress={createLocalWallet}
                disabled={localBusy}
                accessibilityRole="button">
                <ThemedText style={styles.buttonText}>Generate Local Wallet</ThemedText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.disconnectButton, pressed && styles.buttonPressed]}
                onPress={airdropLocal}
                disabled={!localKeypair || localBusy}
                accessibilityRole="button">
                {localBusy ? (
                  <ActivityIndicator color={Colors.light.background} />
                ) : (
                  <ThemedText style={styles.buttonText}>Airdrop 2 SOL</ThemedText>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.connectButton, pressed && styles.buttonPressed]}
                onPress={refreshLocalBalance}
                disabled={!localKeypair || localBusy}
                accessibilityRole="button">
                <ThemedText style={styles.buttonText}>Refresh Balance</ThemedText>
              </Pressable>
              {Platform.OS === 'android' && SOLANA_RPC_URL.includes('127.0.0.1') ? (
                <ThemedText style={styles.cardText}>
                  Android note: use 10.0.2.2 for emulator or your LAN IP for device.
                </ThemedText>
              ) : null}
              {CLUSTER !== 'localnet' ? (
                <ThemedText style={styles.cardText}>
                  Note: Airdrop works only on localnet/devnet. For mainnet, fund manually.
                </ThemedText>
              ) : null}
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Status</ThemedText>
          <ThemedText style={styles.cardText}>
            Connection:{' '}
            {activeWallet === WALLET_LOCAL
              ? isLocalConnected
                ? 'Connected'
                : 'Not connected'
              : activeWallet === WALLET_PHANTOM
                ? isPhantomConnected
                  ? 'Connected'
                  : 'Not connected'
                : isConnected
                  ? 'Connected'
                  : 'Not connected'}
          </ThemedText>
          <ThemedText style={styles.cardText}>{statusText}</ThemedText>
          <ThemedText style={styles.cardText}>Network: Solana {CLUSTER}</ThemedText>
          <ThemedText style={styles.cardText}>
            Balance:{' '}
            {activeWallet === WALLET_LOCAL
              ? localBalance === null
                ? '—'
                : `${localBalance.toFixed(4)} SOL`
              : balance === null
                ? '—'
                : `${balance.toFixed(4)} SOL`}
          </ThemedText>
          {activeWallet !== WALLET_LOCAL && balanceError ? (
            <ThemedText style={styles.cardText}>{balanceError}</ThemedText>
          ) : null}
          {solflareState.lastUrl ? (
            <ThemedText style={styles.cardText}>Last URL: {solflareState.lastUrl}</ThemedText>
          ) : null}
          {activeWallet === WALLET_SOLFLARE && solflareState.signature ? (
            <ThemedText style={styles.cardText}>Last Signature: {solflareState.signature}</ThemedText>
          ) : null}
          {activeWallet === WALLET_PHANTOM && phantomState.signature ? (
            <ThemedText style={styles.cardText}>Last Signature: {phantomState.signature}</ThemedText>
          ) : null}
          {CLUSTER === 'localnet' ? (
            <ThemedText style={styles.cardText}>
              Note: Solflare may not support localnet signing.
            </ThemedText>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.rpcButton,
              pressed && styles.buttonPressed,
              isCheckingRpc && styles.buttonDisabled,
            ]}
            onPress={checkRpcHealth}
            disabled={isCheckingRpc}>
            {isCheckingRpc ? (
              <ActivityIndicator color={Colors.light.background} />
            ) : (
              <ThemedText style={styles.buttonText}>Check RPC Health</ThemedText>
            )}
          </Pressable>
          <ThemedText style={styles.cardText}>
            RPC Status:{' '}
            {rpcHealth === 'unknown' ? 'Unknown' : rpcHealth === 'ok' ? 'OK' : 'Error'}
          </ThemedText>
          {rpcMessage ? <ThemedText style={styles.cardText}>{rpcMessage}</ThemedText> : null}
          {rpcRaw ? <ThemedText style={styles.cardText}>RPC Response: {rpcRaw}</ThemedText> : null}
        </View>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
    gap: 20,
  },
  hero: {
    gap: 8,
  },
  heroCopy: {
    opacity: 0.8,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(120, 120, 120, 0.25)',
    backgroundColor: 'rgba(120, 120, 120, 0.08)',
  },
  cardText: {
    opacity: 0.85,
  },
  switchRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  switchButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(120, 120, 120, 0.25)',
    backgroundColor: 'rgba(120, 120, 120, 0.08)',
  },
  switchButtonActive: {
    backgroundColor: '#1C1C1C',
    borderColor: '#1C1C1C',
  },
  switchText: {
    fontSize: 14,
    fontWeight: '600',
  },
  switchTextActive: {
    color: '#FFFFFF',
  },
  switchTextInactive: {
    color: '#1C1C1C',
  },
  connectButton: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#FF7A00',
  },
  rpcButton: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#2B5C9A',
  },
  disconnectButton: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#1C1C1C',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.45,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
