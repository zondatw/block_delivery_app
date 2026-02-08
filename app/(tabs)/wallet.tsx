import 'react-native-get-random-values';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
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

const DAPP_URL = process.env.EXPO_PUBLIC_DAPP_URL ?? 'https://example.com';
const CLUSTER = process.env.EXPO_PUBLIC_SOLANA_CHAIN ?? 'localnet';
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const REDIRECT_LINK = Linking.createURL('solflare-connect', { scheme: 'blockdeliveryapp' });
const PHANTOM_REDIRECT_LINK = Linking.createURL('phantom-connect', { scheme: 'blockdeliveryapp' });

const shorten = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;

export default function WalletScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [state, setState] = useState(getSolflareState());
  const [phantomState, setPhantomState] = useState(getPhantomState());
  const [isLoading, setIsLoading] = useState(false);
  const [webWallet, setWebWallet] = useState<any>(null);
  const [webReady, setWebReady] = useState(false);
  const [phantomWebWallet, setPhantomWebWallet] = useState<any>(null);
  const [phantomWebReady, setPhantomWebReady] = useState(false);
  const keypairRef = useRef<nacl.BoxKeyPair | null>(null);
  const [localKeypair, setLocalKeypair] = useState<Keypair | null>(null);
  const [localBalance, setLocalBalance] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const localConnection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);

  useEffect(() => {
    setState(getSolflareState());
    return subscribeSolflareState((next) => setState(next));
  }, []);

  useEffect(() => {
    setPhantomState(getPhantomState());
    return subscribePhantomState((next) => setPhantomState(next));
  }, []);

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
          setState((prev) => ({
            ...prev,
            publicKey: wallet.publicKey?.toString?.() ?? null,
          }));
        });
        wallet.on?.('disconnect', () => {
          setState((prev) => ({ ...prev, publicKey: null }));
        });

        setWebWallet(wallet);
        setWebReady(true);
      } catch (err) {
        if (active) {
          setState((prev) => ({ ...prev, error: 'Solflare SDK failed to load.' }));
        }
      }
    };

    setupWebWallet();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!localKeypair) {
      setLocalBalance(null);
      return;
    }

    let active = true;

    const loadBalance = async () => {
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

    loadBalance();

    return () => {
      active = false;
    };
  }, [localConnection, localKeypair]);

  const createLocalWallet = () => {
    setLocalError(null);
    setLocalKeypair(Keypair.generate());
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
      // Poll instead of websocket-based confirm to avoid RN ws errors.
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
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    const phantom = (globalThis as any)?.solana;
    if (phantom?.isPhantom) {
      setPhantomWebWallet(phantom);
      setPhantomWebReady(true);
    } else {
      setPhantomWebReady(false);
    }
  }, []);

  const connect = async () => {
    setState((prev) => ({ ...prev, error: null }));

    if (Platform.OS === 'web') {
      if (!webWallet) {
        setState((prev) => ({ ...prev, error: 'Solflare wallet not ready.' }));
        return;
      }
      setIsLoading(true);
      try {
        await webWallet.connect();
      } catch (err) {
        setState((prev) => ({ ...prev, error: 'Connection cancelled or failed.' }));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    resetSolflareState();
    const keypair = nacl.box.keyPair();
    keypairRef.current = keypair;
    setSolflareKeypair(keypair);

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
      setState((prev) => ({ ...prev, error: 'Unable to open Solflare.' }));
    } finally {
      setIsLoading(false);
    }
  };

  const connectPhantom = async () => {
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
    setPhantomKeypair(keypair);

    const dappPublicKey = bs58.encode(keypair.publicKey);
    const params = new URLSearchParams({
      app_url: DAPP_URL,
      dapp_encryption_public_key: dappPublicKey,
      redirect_link: PHANTOM_REDIRECT_LINK,
      cluster: CLUSTER,
    });

    const url = `https://phantom.app/ul/v1/connect?${params.toString()}`;
    console.log('[Phantom] connect url', url);
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
    resetPhantomState();
  };
  const disconnect = async () => {
    if (Platform.OS === 'web') {
      if (!webWallet) {
        return;
      }
      setIsLoading(true);
      try {
        await webWallet.disconnect();
      } catch (err) {
        setState((prev) => ({ ...prev, error: 'Disconnect failed.' }));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setSolflareKeypair(null);
    resetSolflareState();
  };

  const statusText = useMemo(() => {
    if (state.error) return `Error: ${state.error}`;
    if (state.publicKey) return `Wallet: ${shorten(state.publicKey)}`;
    return 'Wallet: Not connected';
  }, [state.error, state.publicKey]);

  const isConnected = Boolean(state.publicKey);
  const isPhantomConnected = Boolean(phantomState.publicKey);
  const localPubkey = localKeypair?.publicKey.toBase58() ?? null;

  return (
    <ParallaxScrollView headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}>
      <View style={styles.hero}>
        <ThemedText type="title">Wallet</ThemedText>
        <ThemedText type="subtitle">Connect your Solflare wallet</ThemedText>
        <ThemedText style={styles.heroCopy}>
          Mobile uses Solflare deeplinks. Web uses the Solflare SDK.
        </ThemedText>
      </View>

      <View style={styles.card}>
        <ThemedText type="defaultSemiBold">Status</ThemedText>
        <ThemedText style={styles.cardText}>
          Connection: {isConnected ? 'Connected' : 'Not connected'}
        </ThemedText>
        <ThemedText style={styles.cardText}>{statusText}</ThemedText>
        <ThemedText style={styles.cardText}>Network: Solana {CLUSTER}</ThemedText>
        {Platform.OS === 'web' && !webReady ? (
          <ThemedText style={styles.cardText}>Loading Solflare SDK...</ThemedText>
        ) : null}
        {state.lastUrl ? (
          <ThemedText style={styles.cardText}>Last URL: {state.lastUrl}</ThemedText>
        ) : null}
      </View>

      <View style={styles.card}>
        <ThemedText type="defaultSemiBold">Phantom Wallet</ThemedText>
        <ThemedText style={styles.cardText}>
          Connection: {isPhantomConnected ? 'Connected' : 'Not connected'}
        </ThemedText>
        <ThemedText style={styles.cardText}>
          {phantomState.publicKey ? `Wallet: ${shorten(phantomState.publicKey)}` : 'Wallet: —'}
        </ThemedText>
        {phantomState.error ? (
          <ThemedText style={styles.cardText}>Error: {phantomState.error}</ThemedText>
        ) : null}
        {phantomState.lastUrl ? (
          <ThemedText style={styles.cardText}>Last URL: {phantomState.lastUrl}</ThemedText>
        ) : null}
        {Platform.OS === 'web' && !phantomWebReady ? (
          <ThemedText style={styles.cardText}>Phantom extension not detected.</ThemedText>
        ) : null}
        {isPhantomConnected ? (
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
        )}
      </View>

      {isConnected ? (
        <Pressable
          style={({ pressed }) => [styles.disconnectButton, pressed && styles.buttonPressed]}
          onPress={disconnect}
          disabled={isLoading}
          accessibilityRole="button">
          {isLoading ? (
            <ActivityIndicator color={Colors.light.background} />
          ) : (
            <ThemedText style={styles.buttonText}>Disconnect</ThemedText>
          )}
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.connectButton, pressed && styles.buttonPressed]}
          onPress={connect}
          disabled={isLoading}
          accessibilityRole="button">
          {isLoading ? (
            <ActivityIndicator color={Colors.light.background} />
          ) : (
            <ThemedText style={styles.buttonText}>Connect Solflare</ThemedText>
          )}
        </Pressable>
      )}

      {Platform.OS !== 'web' && DAPP_URL === 'https://example.com' ? (
        <ThemedText style={styles.cardText}>
          Update EXPO_PUBLIC_DAPP_URL to your production site URL.
        </ThemedText>
      ) : null}

      {CLUSTER === 'localnet' ? (
        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Local Dev Wallet</ThemedText>
          <ThemedText style={styles.cardText}>RPC: {SOLANA_RPC_URL}</ThemedText>
          <ThemedText style={styles.cardText}>
            Address: {localPubkey ? shorten(localPubkey) : 'Not created'}
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
        </View>
      ) : null}
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
  connectButton: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#FF7A00',
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
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
