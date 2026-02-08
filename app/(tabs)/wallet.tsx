import 'react-native-get-random-values';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { AnchorProvider, BN, EventParser, Program } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import idlJson from '@/assets/idl/block_delivery.json';
import {
  getSolflareState,
  handleSolflareCallbackUrl,
  resetSolflareState,
  setSolflareKeypair,
  subscribeSolflareState,
} from '@/lib/solflare-callback';

const DAPP_URL = process.env.EXPO_PUBLIC_DAPP_URL ?? 'https://example.com';
const CLUSTER = process.env.EXPO_PUBLIC_SOLANA_CHAIN ?? 'localnet';
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const REDIRECT_LINK = Linking.createURL('solflare-connect', { scheme: 'blockdeliveryapp' });
const IDL = idlJson as Idl;

const shorten = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;
const toSol = (lamports: number) => lamports / 1_000_000_000;

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
  const [rpcHealth, setRpcHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [rpcMessage, setRpcMessage] = useState<string | null>(null);
  const [rpcRaw, setRpcRaw] = useState<string | null>(null);
  const [isCheckingRpc, setIsCheckingRpc] = useState(false);
  const [amount, setAmount] = useState('1000');
  const [events, setEvents] = useState<any[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createTx, setCreateTx] = useState<string | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
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
    if (state.signature) {
      setCreateTx(state.signature);
    }
  }, [state.signature]);

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

  const programId = useMemo(() => {
    const address = (IDL as any)?.metadata?.address ?? (IDL as any)?.address ?? null;
    if (!address) {
      return null;
    }
    try {
      return new PublicKey(address);
    } catch (err) {
      return null;
    }
  }, []);

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);

  const provider = useMemo(() => {
    if (!state.publicKey || !programId) return null;
    const publicKey = new PublicKey(state.publicKey);
    return new AnchorProvider(
      connection,
      {
        publicKey,
        signTransaction: async (tx: Transaction) => tx,
        signAllTransactions: async (txs: Transaction[]) => txs,
      } as any,
      { commitment: 'confirmed' },
    );
  }, [connection, state.publicKey, programId]);

  const program = useMemo(() => {
    if (!provider || !programId) return null;
    return new Program(IDL, provider);
  }, [provider, programId]);

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
          setBalance(toSol(lamports));
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

  useEffect(() => {
    if (!program || !programId) {
      return;
    }

    const parser = new EventParser(programId, program.coder);
    const subId = connection.onLogs(
      programId,
      (logs) => {
        if (!logs.logs) return;
        for (const event of parser.parseLogs(logs.logs)) {
          setEvents((prev) => [...prev, event]);
        }
      },
      'confirmed',
    );

    return () => {
      connection.removeOnLogsListener(subId).catch(() => {});
    };
  }, [connection, program, programId]);

  const encryptPayload = (payload: object) => {
    if (!keypairRef.current) {
      throw new Error('Missing dapp keypair');
    }
    if (!state.solflareEncryptionPublicKey) {
      throw new Error('Missing Solflare encryption key');
    }
    const sharedSecret = nacl.box.before(
      bs58.decode(state.solflareEncryptionPublicKey),
      keypairRef.current.secretKey,
    );
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const encrypted = nacl.box.after(
      Buffer.from(JSON.stringify(payload)),
      nonce,
      sharedSecret,
    );
    return {
      data: bs58.encode(encrypted),
      nonce: bs58.encode(nonce),
      dappPublicKey: bs58.encode(keypairRef.current.publicKey),
    };
  };

  const connect = async () => {
    setState((prev) => ({ ...prev, error: null }));
    setCreateError(null);

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

  const deriveOrderPda = async () => {
    if (!program || !programId || !state.publicKey) {
      throw new Error('Wallet or program not ready');
    }
    const [counterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('order_counter')],
      programId,
    );
    const counterAccount: any = await program.account.orderCounter.fetch(counterPda);
    const orderIdBN = counterAccount.nextId;

    const [orderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), new BN(orderIdBN).toArrayLike(Buffer, 'le', 8)],
      programId,
    );

    return { orderPda, orderIdBN, counterPda };
  };

  const createOrder = async () => {
    if (!program || !programId || !state.publicKey) {
      setCreateError('Wallet or program not ready.');
      return;
    }
    if (!amount || Number.isNaN(Number(amount))) {
      setCreateError('Enter a valid amount.');
      return;
    }
    if (!programId) {
      setCreateError('Program ID missing. Update the IDL file.');
      return;
    }

    setCreateError(null);
    setIsCreating(true);
    setCreateTx(null);

    try {
      const { orderPda, orderIdBN, counterPda } = await deriveOrderPda();
      const amountBN = new BN(amount);
      const tx = await program.methods
        .createOrder(amountBN)
        .accounts({
          counter: counterPda,
          order: orderPda,
          customer: new PublicKey(state.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const latest = await connection.getLatestBlockhash('confirmed');
      tx.feePayer = new PublicKey(state.publicKey);
      tx.recentBlockhash = latest.blockhash;

      if (Platform.OS === 'web') {
        if (!webWallet) {
          throw new Error('Solflare wallet not ready.');
        }
        if (typeof webWallet.signTransaction !== 'function') {
          throw new Error('Solflare SDK missing signTransaction; cannot use localnet.');
        }
        const signed = await webWallet.signTransaction(tx);
        const raw = signed.serialize();
        const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
        await connection.confirmTransaction(signature, 'confirmed');
        setCreateTx(signature);
      } else {
        if (!state.session) {
          throw new Error('Missing Solflare session. Reconnect wallet.');
        }
        const { data, nonce, dappPublicKey } = encryptPayload({
          session: state.session,
          transaction: tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }).toString('base64'),
        });
        const params = new URLSearchParams({
          app_url: DAPP_URL,
          dapp_encryption_public_key: dappPublicKey,
          redirect_link: REDIRECT_LINK,
          cluster: CLUSTER,
          nonce,
          data,
        });
        const url = `https://solflare.com/ul/v1/signAndSendTransaction?${params.toString()}`;
        await Linking.openURL(url);
      }

      setCreateTx((prev) => prev ?? state.signature ?? null);
      setLastOrderId(orderIdBN.toString());
      setEvents([]);
    } catch (err) {
      setCreateError(err instanceof Error ? `Create failed: ${err.message}` : 'createOrder failed.');
    } finally {
      setIsCreating(false);
    }
  };

  const statusText = useMemo(() => {
    if (state.error) return `Error: ${state.error}`;
    if (state.publicKey) return `Wallet: ${shorten(state.publicKey)}`;
    return 'Wallet: Not connected';
  }, [state.error, state.publicKey]);

  const isConnected = Boolean(state.publicKey);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
    >
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
          {state.signature ? (
            <ThemedText style={styles.cardText}>Last Signature: {state.signature}</ThemedText>
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

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Local Dev Wallet</ThemedText>
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
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Customer Order</ThemedText>
          {!programId ? (
            <ThemedText style={styles.cardText}>
              Program ID missing. Replace `assets/idl/block_delivery.json` with your IDL.
            </ThemedText>
          ) : null}
          <View style={styles.inputRow}>
            <ThemedText style={styles.cardText}>Amount</ThemedText>
            <TextInput
              style={[styles.input, { color: palette.text, borderColor: palette.icon }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="Amount"
              placeholderTextColor={palette.icon}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.connectButton,
              pressed && styles.buttonPressed,
              isCreating && styles.buttonDisabled,
            ]}
            onPress={createOrder}
            disabled={isCreating || !isConnected || !programId}>
            {isCreating ? (
              <ActivityIndicator color={Colors.light.background} />
            ) : (
              <ThemedText style={styles.buttonText}>Create Order</ThemedText>
            )}
          </Pressable>
          {createTx ? (
            <ThemedText style={styles.cardText}>Tx: {createTx}</ThemedText>
          ) : null}
          {lastOrderId ? (
            <ThemedText style={styles.cardText}>Order ID: {lastOrderId}</ThemedText>
          ) : null}
          {createError ? <ThemedText style={styles.cardText}>{createError}</ThemedText> : null}
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Events</ThemedText>
          {events.length === 0 ? (
            <ThemedText style={styles.cardText}>No events yet.</ThemedText>
          ) : (
            <ScrollView style={styles.events} nestedScrollEnabled>
              {events.map((event, index) => (
                <ThemedText key={`${index}`} style={styles.eventItem}>
                  {JSON.stringify(event, null, 2)}
                </ThemedText>
              ))}
            </ScrollView>
          )}
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
  inputRow: {
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  events: {
    maxHeight: 200,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(120, 120, 120, 0.25)',
    padding: 8,
  },
  eventItem: {
    fontSize: 12,
    marginBottom: 8,
  },
});
