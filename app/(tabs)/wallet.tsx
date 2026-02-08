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
const IDL = idlJson as Idl;

const shorten = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;
const toSol = (lamports: number) => lamports / 1_000_000_000;

export default function WalletScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [state, setState] = useState(getSolflareState());
  const [phantomState, setPhantomState] = useState(getPhantomState());
  const [activeWallet, setActiveWallet] = useState<'solflare' | 'phantom' | 'local'>('solflare');
  const [isLoading, setIsLoading] = useState(false);
  const [webWallet, setWebWallet] = useState<any>(null);
  const [webReady, setWebReady] = useState(false);
  const [phantomWebWallet, setPhantomWebWallet] = useState<any>(null);
  const [phantomWebReady, setPhantomWebReady] = useState(false);
  const keypairRef = useRef<nacl.BoxKeyPair | null>(null);
  const phantomKeypairRef = useRef<nacl.BoxKeyPair | null>(null);
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

  const activeWalletPublicKey = useMemo(() => {
    if (activeWallet === 'local') {
      return localKeypair?.publicKey.toBase58() ?? null;
    }
    if (activeWallet === 'phantom') {
      return phantomState.publicKey ?? null;
    }
    return state.publicKey ?? null;
  }, [activeWallet, localKeypair, phantomState.publicKey, state.publicKey]);

  useEffect(() => {
    setState(getSolflareState());
    return subscribeSolflareState((next) => setState(next));
  }, []);

  useEffect(() => {
    setPhantomState(getPhantomState());
    return subscribePhantomState((next) => setPhantomState(next));
  }, []);

  useEffect(() => {
    if (state.signature) {
      setCreateTx(state.signature);
    }
  }, [state.signature]);

  useEffect(() => {
    if (phantomState.signature) {
      setCreateTx(phantomState.signature);
    }
  }, [phantomState.signature]);

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
    setActiveWallet('local');
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
    if (!programId) return null;
    const publicKey = activeWalletPublicKey
      ? new PublicKey(activeWalletPublicKey)
      : programId;
    return new AnchorProvider(
      connection,
      {
        publicKey,
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
    if (activeWallet === 'local') {
      setBalance(null);
      setBalanceError(null);
      return;
    }

    const publicKey = activeWalletPublicKey;
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
  }, [activeWallet, activeWalletPublicKey]);

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

  useEffect(() => {
    if (!program || !programId) {
      return;
    }
    if (Platform.OS === 'android') {
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

  const encryptPayload = (
    payload: object,
    encryptionPublicKey: string,
    keypair: nacl.BoxKeyPair,
  ) => {
    const sharedSecret = nacl.box.before(bs58.decode(encryptionPublicKey), keypair.secretKey);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const encrypted = nacl.box.after(Buffer.from(JSON.stringify(payload)), nonce, sharedSecret);
    return {
      data: bs58.encode(encrypted),
      nonce: bs58.encode(nonce),
      dappPublicKey: bs58.encode(keypair.publicKey),
    };
  };

  const connect = async () => {
    setActiveWallet('solflare');
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

  const connectPhantom = async () => {
    setActiveWallet('phantom');
    setPhantomState((prev) => ({ ...prev, error: null }));
    setCreateError(null);

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

    const activeKey = activeWalletPublicKey;
    if (activeWallet !== 'local' && !activeKey) {
      setCreateError('Wallet not connected.');
      return;
    }
    if (activeWallet === 'local' && !localKeypair) {
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
        activeWallet === 'local' ? localKeypair!.publicKey : new PublicKey(activeKey!);

      const tx = await program.methods
        .createOrder(amountBN)
        .accounts({
          counter: counterPda,
          order: orderPda,
          customer: customerPubkey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const latest = await connection.getLatestBlockhash('confirmed');
      tx.feePayer = customerPubkey;
      tx.recentBlockhash = latest.blockhash;

      if (activeWallet === 'local') {
        tx.sign(localKeypair!);
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
        });
        await confirmSignature(signature);
        setCreateTx(signature);
      } else if (activeWallet === 'phantom') {
        if (Platform.OS === 'web') {
          if (!phantomWebWallet) {
            throw new Error('Phantom wallet not ready.');
          }
          if (typeof phantomWebWallet.signTransaction !== 'function') {
            throw new Error('Phantom missing signTransaction.');
          }
          const signed = await phantomWebWallet.signTransaction(tx);
          const raw = signed.serialize();
          const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
          await confirmSignature(signature);
          setCreateTx(signature);
        } else {
          if (!phantomState.session || !phantomState.phantomEncryptionPublicKey) {
            throw new Error('Missing Phantom session. Reconnect wallet.');
          }
          if (!phantomKeypairRef.current) {
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
            phantomKeypairRef.current,
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
        }
      } else {
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
        await confirmSignature(signature);
        setCreateTx(signature);
      } else {
          if (!state.session || !state.solflareEncryptionPublicKey) {
            throw new Error('Missing Solflare session. Reconnect wallet.');
          }
          if (!keypairRef.current) {
            throw new Error('Missing Solflare keypair.');
          }
          const { data, nonce, dappPublicKey } = encryptPayload(
            {
              session: state.session,
              transaction: tx.serialize({
                requireAllSignatures: false,
                verifySignatures: false,
              }).toString('base64'),
            },
            state.solflareEncryptionPublicKey,
            keypairRef.current,
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
        }
      }

      setCreateTx(
        (prev) =>
          prev ??
          state.signature ??
          phantomState.signature ??
          null,
      );
      setLastOrderId(orderIdBN.toString());
      setEvents([]);
    } catch (err) {
      setCreateError(err instanceof Error ? `Create failed: ${err.message}` : 'createOrder failed.');
    } finally {
      setIsCreating(false);
    }
  };

  const statusText = useMemo(() => {
    const activeKey = activeWalletPublicKey;
    const activeError =
      activeWallet === 'phantom' ? phantomState.error : activeWallet === 'local' ? localError : state.error;
    if (activeError) return `Error: ${activeError}`;
    if (activeKey) return `Wallet: ${shorten(activeKey)}`;
    return 'Wallet: Not connected';
  }, [activeWallet, activeWalletPublicKey, localError, phantomState.error, state.error]);

  const isConnected = Boolean(state.publicKey);
  const isPhantomConnected = Boolean(phantomState.publicKey);
  const isLocalConnected = Boolean(localKeypair);
  const canCreateOrder =
    Boolean(programId) &&
    (activeWallet === 'local'
      ? isLocalConnected
      : activeWallet === 'phantom'
        ? isPhantomConnected
        : isConnected);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
    >
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
                activeWallet === 'solflare' && styles.switchButtonActive,
              ]}
              onPress={() => setActiveWallet('solflare')}>
              <ThemedText
                style={[
                  styles.switchText,
                  activeWallet === 'solflare' ? styles.switchTextActive : styles.switchTextInactive,
                ]}>
                Solflare
              </ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.switchButton,
                activeWallet === 'phantom' && styles.switchButtonActive,
              ]}
              onPress={() => setActiveWallet('phantom')}>
              <ThemedText
                style={[
                  styles.switchText,
                  activeWallet === 'phantom' ? styles.switchTextActive : styles.switchTextInactive,
                ]}>
                Phantom
              </ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.switchButton,
                activeWallet === 'local' && styles.switchButtonActive,
              ]}
              onPress={() => setActiveWallet('local')}>
              <ThemedText
                style={[
                  styles.switchText,
                  activeWallet === 'local' ? styles.switchTextActive : styles.switchTextInactive,
                ]}>
                Local
              </ThemedText>
            </Pressable>
          </View>
          <ThemedText style={styles.cardText}>
            Using: {activeWallet.charAt(0).toUpperCase() + activeWallet.slice(1)}
          </ThemedText>
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Status</ThemedText>
          <ThemedText style={styles.cardText}>
            Connection:{' '}
            {activeWallet === 'local'
              ? isLocalConnected
                ? 'Connected'
                : 'Not connected'
              : activeWallet === 'phantom'
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
            {activeWallet === 'local'
              ? localBalance === null
                ? '—'
                : `${localBalance.toFixed(4)} SOL`
              : balance === null
                ? '—'
                : `${balance.toFixed(4)} SOL`}
          </ThemedText>
          {activeWallet !== 'local' && balanceError ? (
            <ThemedText style={styles.cardText}>{balanceError}</ThemedText>
          ) : null}
          {Platform.OS === 'web' && !webReady ? (
            <ThemedText style={styles.cardText}>Loading Solflare SDK...</ThemedText>
          ) : null}
          {state.lastUrl ? (
            <ThemedText style={styles.cardText}>Last URL: {state.lastUrl}</ThemedText>
          ) : null}
          {activeWallet === 'solflare' && state.signature ? (
            <ThemedText style={styles.cardText}>Last Signature: {state.signature}</ThemedText>
          ) : null}
          {activeWallet === 'phantom' && phantomState.signature ? (
            <ThemedText style={styles.cardText}>
              Last Signature: {phantomState.signature}
            </ThemedText>
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

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Solflare Wallet</ThemedText>
          {isConnected ? (
            <Pressable
              style={({ pressed }) => [styles.disconnectButton, pressed && styles.buttonPressed]}
              onPress={disconnect}
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
        </View>

        <View style={styles.card}>
          <ThemedText type="defaultSemiBold">Phantom Wallet</ThemedText>
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
          <ThemedText style={styles.cardText}>
            Active wallet: {activeWallet.charAt(0).toUpperCase() + activeWallet.slice(1)}
          </ThemedText>
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
            disabled={isCreating || !canCreateOrder}>
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
          {Platform.OS === 'android' ? (
            <ThemedText style={styles.cardText}>
              Event streaming is disabled on Android to avoid websocket errors.
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
