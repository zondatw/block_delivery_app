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
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import idlJson from '@/assets/idl/block_delivery.json';
import {
  getSolflareState,
  handleSolflareCallbackUrl,
  subscribeSolflareState,
} from '@/lib/solflare-callback';
import {
  getPhantomState,
  handlePhantomCallbackUrl,
  subscribePhantomState,
} from '@/lib/phantom-callback';
import {
  getActiveWallet,
  getLocalKeypair,
  getPhantomBoxKeypair,
  getSolflareBoxKeypair,
  subscribeActiveWallet,
  subscribeLocalKeypair,
  subscribePhantomBoxKeypair,
  subscribeSolflareBoxKeypair,
} from '@/lib/wallet-store';

const DAPP_URL = process.env.EXPO_PUBLIC_DAPP_URL ?? 'https://example.com';
const CLUSTER = process.env.EXPO_PUBLIC_SOLANA_CHAIN ?? 'localnet';
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const REDIRECT_LINK = Linking.createURL('solflare-connect', { scheme: 'blockdeliveryapp' });
const PHANTOM_REDIRECT_LINK = Linking.createURL('phantom-connect', { scheme: 'blockdeliveryapp' });
const IDL = idlJson as Idl;
const WALLET_SOLFLARE = 'solflare' as const;
const WALLET_PHANTOM = 'phantom' as const;
const WALLET_LOCAL = 'local' as const;

export default function CustomerScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [solflareState, setSolflareState] = useState(getSolflareState());
  const [phantomState, setPhantomState] = useState(getPhantomState());
  const [activeWallet, setActiveWalletState] = useState(getActiveWallet());
  const [localKeypair, setLocalKeypairState] = useState(getLocalKeypair());
  const solflareBoxKeypairRef = useRef<nacl.BoxKeyPair | null>(getSolflareBoxKeypair());
  const phantomBoxKeypairRef = useRef<nacl.BoxKeyPair | null>(getPhantomBoxKeypair());
  const [webWallet, setWebWallet] = useState<any>(null);
  const [phantomWebWallet, setPhantomWebWallet] = useState<any>(null);
  const [amount, setAmount] = useState('1000');
  const [events, setEvents] = useState<any[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createTx, setCreateTx] = useState<string | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);

  useEffect(() => subscribeActiveWallet(setActiveWalletState), []);
  useEffect(() => subscribeLocalKeypair(setLocalKeypairState), []);
  useEffect(() => subscribeSolflareBoxKeypair((next) => (solflareBoxKeypairRef.current = next)), []);
  useEffect(() => subscribePhantomBoxKeypair((next) => (phantomBoxKeypairRef.current = next)), []);

  useEffect(() => {
    setSolflareState(getSolflareState());
    return subscribeSolflareState((next) => setSolflareState(next));
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

  const activeWalletPublicKey = useMemo(() => {
    if (activeWallet === WALLET_LOCAL) {
      return localKeypair?.publicKey ?? null;
    }
    if (activeWallet === WALLET_PHANTOM) {
      return phantomState.publicKey ? new PublicKey(phantomState.publicKey) : null;
    }
    return solflareState.publicKey ? new PublicKey(solflareState.publicKey) : null;
  }, [activeWallet, localKeypair, phantomState.publicKey, solflareState.publicKey]);

  const provider = useMemo(() => {
    if (!programId) return null;
    return new AnchorProvider(
      connection,
      {
        publicKey: activeWalletPublicKey ?? programId,
        signTransaction: async (tx: Transaction) => tx,
        signAllTransactions: async (txs: Transaction[]) => txs,
      } as any,
      { commitment: 'confirmed' },
    );
  }, [connection, activeWalletPublicKey, programId]);

  const program = useMemo(() => {
    if (!provider || !programId) return null;
    return new Program(IDL, provider);
  }, [provider, programId]);

  useEffect(() => {
    if (!program || !programId) {
      return;
    }
    if (Platform.OS !== 'web') {
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

  const encryptPayload = (payload: object, encryptionPublicKey: string, keypair: nacl.BoxKeyPair) => {
    const sharedSecret = nacl.box.before(bs58.decode(encryptionPublicKey), keypair.secretKey);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const encrypted = nacl.box.after(Buffer.from(JSON.stringify(payload)), nonce, sharedSecret);
    return {
      data: bs58.encode(encrypted),
      nonce: bs58.encode(nonce),
      dappPublicKey: bs58.encode(keypair.publicKey),
    };
  };

  const confirmSignature = async (signature: string) => {
    if (Platform.OS !== 'android') {
      await connection.confirmTransaction(signature, 'confirmed');
      return;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await connection.getSignatureStatuses([signature]);
      const info = status?.value?.[0];
      if (info?.confirmationStatus === 'confirmed' || info?.confirmationStatus === 'finalized') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  const sendTxWithActiveWallet = async (tx: Transaction, feePayer: PublicKey) => {
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = feePayer;
    tx.recentBlockhash = latest.blockhash;

    if (activeWallet === WALLET_LOCAL) {
      if (!localKeypair) {
        throw new Error('Local wallet not created.');
      }
      tx.sign(localKeypair);
      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await confirmSignature(signature);
      return signature;
    }

    if (activeWallet === WALLET_PHANTOM) {
      if (Platform.OS === 'web') {
        if (!phantomWebWallet?.signTransaction) {
          throw new Error('Phantom wallet not ready.');
        }
        const signed = await phantomWebWallet.signTransaction(tx);
        const raw = signed.serialize();
        const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
        await confirmSignature(signature);
        return signature;
      }

      if (!phantomState.session || !phantomState.phantomEncryptionPublicKey) {
        throw new Error('Missing Phantom session. Reconnect wallet.');
      }
      if (!phantomBoxKeypairRef.current) {
        throw new Error('Missing Phantom keypair.');
      }
      const { data, nonce, dappPublicKey } = encryptPayload(
        {
          session: phantomState.session,
          transaction: tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }).toString('base64'),
        },
        phantomState.phantomEncryptionPublicKey,
        phantomBoxKeypairRef.current,
      );
      const params = new URLSearchParams({
        app_url: DAPP_URL,
        dapp_encryption_public_key: dappPublicKey,
        redirect_link: PHANTOM_REDIRECT_LINK,
        cluster: CLUSTER,
        nonce,
        data,
      });
      const url = `https://phantom.app/ul/v1/signAndSendTransaction?${params.toString()}`;
      await Linking.openURL(url);
      return phantomState.signature ?? null;
    }

    if (Platform.OS === 'web') {
      if (!webWallet?.signTransaction) {
        throw new Error('Solflare wallet not ready.');
      }
      const signed = await webWallet.signTransaction(tx);
      const raw = signed.serialize();
      const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
      await confirmSignature(signature);
      return signature;
    }

    if (!solflareState.session || !solflareState.solflareEncryptionPublicKey) {
      throw new Error('Missing Solflare session. Reconnect wallet.');
    }
    if (!solflareBoxKeypairRef.current) {
      throw new Error('Missing Solflare keypair.');
    }
    const { data, nonce, dappPublicKey } = encryptPayload(
      {
        session: solflareState.session,
        transaction: tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }).toString('base64'),
      },
      solflareState.solflareEncryptionPublicKey,
      solflareBoxKeypairRef.current,
    );
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
    return solflareState.signature ?? null;
  };

  const deriveOrderPda = async () => {
    if (!program || !programId) {
      throw new Error('Program not ready');
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
    if (!program || !programId) {
      setCreateError('Program not ready.');
      return;
    }
    if (!amount || Number.isNaN(Number(amount))) {
      setCreateError('Enter a valid amount.');
      return;
    }
    if (!activeWalletPublicKey && activeWallet !== WALLET_LOCAL) {
      setCreateError('Wallet not connected.');
      return;
    }
    if (activeWallet === WALLET_LOCAL && !localKeypair) {
      setCreateError('Local wallet not created.');
      return;
    }

    setCreateError(null);
    setIsCreating(true);
    setCreateTx(null);

    try {
      const { orderPda, orderIdBN, counterPda } = await deriveOrderPda();
      const amountBN = new BN(amount);
      const customerPubkey =
        activeWallet === WALLET_LOCAL
          ? localKeypair!.publicKey
          : activeWalletPublicKey!;

      const tx = await program.methods
        .createOrder(amountBN)
        .accounts({
          counter: counterPda,
          order: orderPda,
          customer: customerPubkey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const signature = await sendTxWithActiveWallet(tx, customerPubkey);
      if (signature) {
        setCreateTx(signature);
      }
      setLastOrderId(orderIdBN.toString());
      setEvents([]);
    } catch (err) {
      setCreateError(err instanceof Error ? `Create failed: ${err.message}` : 'Create failed.');
    } finally {
      setIsCreating(false);
    }
  };

  const canCreateCustomer = Boolean(amount) && !Number.isNaN(Number(amount));

  return (
    <ParallaxScrollView headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}>
      <ThemedView style={styles.container}>
        <View style={styles.hero}>
          <ThemedText type="title">Customer</ThemedText>
          <ThemedText type="subtitle">Create and manage orders</ThemedText>
          <ThemedText style={styles.heroCopy}>
            Connect a wallet in the Wallet tab before creating orders.
          </ThemedText>
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Order</ThemedText>
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
              (isCreating || !canCreateCustomer) && styles.buttonDisabled,
            ]}
            onPress={createOrder}
            disabled={isCreating || !canCreateCustomer}>
            {isCreating ? (
              <ActivityIndicator color={Colors.light.background} />
            ) : (
              <ThemedText style={styles.buttonText}>Create Order</ThemedText>
            )}
          </Pressable>
          {createTx ? <ThemedText style={styles.cardText}>Tx: {createTx}</ThemedText> : null}
          {lastOrderId ? <ThemedText style={styles.cardText}>Order ID: {lastOrderId}</ThemedText> : null}
          {createError ? <ThemedText style={styles.cardText}>{createError}</ThemedText> : null}
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Events</ThemedText>
          {Platform.OS !== 'web' ? (
            <ThemedText style={styles.cardText}>
              Event streaming is disabled on mobile to avoid websocket errors.
            </ThemedText>
          ) : null}
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
