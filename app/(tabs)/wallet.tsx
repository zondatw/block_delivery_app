import 'react-native-get-random-values';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

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

const DAPP_URL = process.env.EXPO_PUBLIC_DAPP_URL ?? 'https://example.com';
const CLUSTER = process.env.EXPO_PUBLIC_SOLANA_CHAIN ?? 'devnet';
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const REDIRECT_LINK = Linking.createURL('solflare-connect', { scheme: 'blockdeliveryapp' });

const shorten = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;

export default function WalletScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [state, setState] = useState(getSolflareState());
  const [isLoading, setIsLoading] = useState(false);
  const [webWallet, setWebWallet] = useState<any>(null);
  const [webReady, setWebReady] = useState(false);
  const keypairRef = useRef<nacl.BoxKeyPair | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  useEffect(() => {
    setState(getSolflareState());
    return subscribeSolflareState((next) => setState(next));
  }, []);

  useEffect(() => {
    const publicKey = state.publicKey;
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
          setBalance(lamports / 1_000_000_000);
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
  }, [state.publicKey]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleSolflareCallbackUrl(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleSolflareCallbackUrl(url);
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

  return (
    <ThemedView style={styles.container}>
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
        <ThemedText style={styles.cardText}>
          Balance:{' '}
          {balance === null ? '—' : `${balance.toFixed(4)} SOL`}
        </ThemedText>
        {balanceError ? <ThemedText style={styles.cardText}>{balanceError}</ThemedText> : null}
        {Platform.OS === 'web' && !webReady ? (
          <ThemedText style={styles.cardText}>Loading Solflare SDK...</ThemedText>
        ) : null}
        {state.lastUrl ? (
          <ThemedText style={styles.cardText}>Last URL: {state.lastUrl}</ThemedText>
        ) : null}
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
    </ThemedView>
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
