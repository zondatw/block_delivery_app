import * as Linking from 'expo-linking';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

type PhantomState = {
  publicKey: string | null;
  session: string | null;
  phantomEncryptionPublicKey: string | null;
  signature: string | null;
  lastUrl: string | null;
  error: string | null;
};

type PhantomListener = (next: PhantomState) => void;

const initialState: PhantomState = {
  publicKey: null,
  session: null,
  phantomEncryptionPublicKey: null,
  signature: null,
  lastUrl: null,
  error: null,
};

let state: PhantomState = { ...initialState };
let listeners: PhantomListener[] = [];
let keypair: nacl.BoxKeyPair | null = null;

const emit = () => {
  listeners.forEach((listener) => listener(state));
};

export const getPhantomState = () => state;

export const resetPhantomState = () => {
  state = { ...initialState, lastUrl: state.lastUrl };
  emit();
};

export const setPhantomKeypair = (next: nacl.BoxKeyPair | null) => {
  keypair = next;
};

export const subscribePhantomState = (listener: PhantomListener) => {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((item) => item !== listener);
  };
};

const decodeBase58 = (value: string) => bs58.decode(value);

const decryptPayload = (encryptedPayload: string, nonce: string, phantomPubkey: string) => {
  if (!keypair) {
    throw new Error('Missing keypair');
  }

  const sharedSecret = nacl.box.before(decodeBase58(phantomPubkey), keypair.secretKey);
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
    signature?: string;
  };
};

export const handlePhantomCallbackUrl = (url: string) => {
  const parsed = Linking.parse(url);
  const query = parsed.queryParams ?? {};

  state = { ...state, lastUrl: url };

  if (typeof query.errorCode === 'string') {
    const message = typeof query.errorMessage === 'string' ? query.errorMessage : 'Unknown error';
    const isRejected = query.errorCode === 'userRejectedRequest';
    state = {
      ...state,
      error: isRejected ? 'Request cancelled in Phantom.' : `${query.errorCode}: ${message}`,
    };
    emit();
    return;
  }

  const encryptedPayload = query.data ?? query.payload;
  const nonce = query.nonce;
  const phantomPubkey = query.phantom_encryption_public_key;

  if (
    typeof encryptedPayload !== 'string' ||
    typeof nonce !== 'string' ||
    typeof phantomPubkey !== 'string'
  ) {
    emit();
    return;
  }

  try {
    const payload = decryptPayload(encryptedPayload, nonce, phantomPubkey);
    state = {
      ...state,
      publicKey: payload.public_key ?? state.publicKey,
      session: payload.session ?? state.session,
      signature: payload.signature ?? state.signature,
      phantomEncryptionPublicKey: phantomPubkey,
      error: null,
    };
  } catch (err) {
    state = { ...state, error: err instanceof Error ? err.message : 'Invalid callback payload' };
  }

  emit();
};
