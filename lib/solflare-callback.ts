import * as Linking from 'expo-linking';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

type SolflareState = {
  publicKey: string | null;
  session: string | null;
  lastUrl: string | null;
  error: string | null;
};

type SolflareListener = (next: SolflareState) => void;

const initialState: SolflareState = {
  publicKey: null,
  session: null,
  lastUrl: null,
  error: null,
};

let state: SolflareState = { ...initialState };
let listeners: SolflareListener[] = [];
let keypair: nacl.BoxKeyPair | null = null;

const emit = () => {
  listeners.forEach((listener) => listener(state));
};

export const getSolflareState = () => state;

export const resetSolflareState = () => {
  state = { ...initialState, lastUrl: state.lastUrl };
  emit();
};

export const setSolflareKeypair = (next: nacl.BoxKeyPair | null) => {
  keypair = next;
};

export const subscribeSolflareState = (listener: SolflareListener) => {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((item) => item !== listener);
  };
};

const decodeBase58 = (value: string) => bs58.decode(value);

const decryptPayload = (encryptedPayload: string, nonce: string, solflarePubkey: string) => {
  if (!keypair) {
    throw new Error('Missing keypair');
  }

  const sharedSecret = nacl.box.before(decodeBase58(solflarePubkey), keypair.secretKey);
  const decrypted = nacl.box.open.after(
    decodeBase58(encryptedPayload),
    decodeBase58(nonce),
    sharedSecret,
  );

  if (!decrypted) {
    throw new Error('Unable to decrypt payload');
  }

  return JSON.parse(Buffer.from(decrypted).toString('utf8')) as {
    public_key?: string;
    session?: string;
  };
};

export const handleSolflareCallbackUrl = (url: string) => {
  const parsed = Linking.parse(url);
  const query = parsed.queryParams ?? {};

  state = { ...state, lastUrl: url };

  if (typeof query.errorCode === 'string') {
    const message = typeof query.errorMessage === 'string' ? query.errorMessage : 'Unknown error';
    state = { ...state, error: `${query.errorCode}: ${message}` };
    emit();
    return;
  }

  const encryptedPayload = query.data;
  const nonce = query.nonce;
  const solflarePubkey = query.solflare_encryption_public_key;

  if (
    typeof encryptedPayload !== 'string' ||
    typeof nonce !== 'string' ||
    typeof solflarePubkey !== 'string'
  ) {
    emit();
    return;
  }

  try {
    const payload = decryptPayload(encryptedPayload, nonce, solflarePubkey);
    state = {
      ...state,
      publicKey: payload.public_key ?? state.publicKey,
      session: payload.session ?? state.session,
      error: null,
    };
  } catch (err) {
    state = { ...state, error: err instanceof Error ? err.message : 'Invalid callback payload' };
  }

  emit();
};
