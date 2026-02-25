// src/utils/crypto.ts
// Client-side E2E encryption.
// Keys are generated here, private key NEVER leaves the device.
// node-forge works in React Native and web.

import forge from 'node-forge';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PRIVATE_KEY_STORE = 'sage_private_key';
const PUBLIC_KEY_STORE  = 'sage_public_key';

// ── Key Generation & Storage ─────────────────────────────────

export async function generateOrLoadKeyPair(): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  // Try loading existing keys first
  const existingPriv = await SecureStore.getItemAsync(PRIVATE_KEY_STORE);
  const existingPub  = await AsyncStorage.getItem(PUBLIC_KEY_STORE);

  if (existingPriv && existingPub) {
    return { publicKeyPem: existingPub, privateKeyPem: existingPriv };
  }

  // Generate new RSA-2048 key pair
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, async (err, keypair) => {
      if (err) return reject(err);
      const publicKeyPem  = forge.pki.publicKeyToPem(keypair.publicKey);
      const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
      // Store: private key in SecureStore (encrypted by OS keychain), public key in AsyncStorage
      await SecureStore.setItemAsync(PRIVATE_KEY_STORE, privateKeyPem);
      await AsyncStorage.setItem(PUBLIC_KEY_STORE, publicKeyPem);
      resolve({ publicKeyPem, privateKeyPem });
    });
  });
}

export async function getPublicKeyPem(): Promise<string | null> {
  return AsyncStorage.getItem(PUBLIC_KEY_STORE);
}

export async function getPrivateKeyPem(): Promise<string | null> {
  return SecureStore.getItemAsync(PRIVATE_KEY_STORE);
}

export function getKeyFingerprint(publicKeyPem: string): string {
  const pub = forge.pki.publicKeyFromPem(publicKeyPem);
  const der = forge.asn1.toDer(forge.pki.publicKeyToAsn1(pub)).bytes();
  const md  = forge.md.sha256.create();
  md.update(der);
  const hex = md.digest().toHex().toUpperCase();
  return hex.match(/.{1,4}/g)!.slice(0, 8).join(' ');
}

// ── Encryption ───────────────────────────────────────────────

export function encryptMessage(plaintext: string, recipientPublicKeyPem: string): string {
  const recipientPub = forge.pki.publicKeyFromPem(recipientPublicKeyPem);

  // Payload with timestamp (anti-replay)
  const payload = JSON.stringify({ text: plaintext, ts: Date.now() / 1000 });

  // AES-256-GCM
  const aesKey = forge.random.getBytesSync(32);
  const iv     = forge.random.getBytesSync(12);
  const cipher = forge.cipher.createCipher('AES-GCM', aesKey);
  cipher.start({ iv, tagLength: 128 });
  cipher.update(forge.util.createBuffer(payload, 'utf8'));
  cipher.finish();
  const ciphertext = cipher.output.bytes();
  const tag        = cipher.mode.tag.bytes();

  // RSA-OAEP encrypt the AES key
  const encAesKey = recipientPub.encrypt(aesKey, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });

  const bundle = {
    enc_key: forge.util.encode64(encAesKey),
    iv:      forge.util.encode64(iv),
    ct:      forge.util.encode64(ciphertext + tag), // tag appended
  };
  return btoa(JSON.stringify(bundle));
}

export function decryptMessage(blob: string, privateKeyPem: string): string {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const bundle     = JSON.parse(atob(blob));

  const encAesKey = forge.util.decode64(bundle.enc_key);
  const iv        = forge.util.decode64(bundle.iv);
  const ctWithTag = forge.util.decode64(bundle.ct);
  const ciphertext = ctWithTag.slice(0, -16);
  const tag        = ctWithTag.slice(-16);

  // Decrypt AES key
  const aesKey = privateKey.decrypt(encAesKey, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });

  // Decrypt message
  const decipher = forge.cipher.createDecipher('AES-GCM', aesKey);
  decipher.start({ iv, tagLength: 128, tag: forge.util.createBuffer(tag) });
  decipher.update(forge.util.createBuffer(ciphertext));
  const ok = decipher.finish();
  if (!ok) throw new Error('Decryption failed — message tampered or wrong key');

  const payload = JSON.parse(decipher.output.toString());
  const age = (Date.now() / 1000) - payload.ts;
  if (age > 86400 || age < -60) throw new Error('Message timestamp invalid');
  return payload.text;
}

// ── Burn mode duration ────────────────────────────────────────

export function calculateBurnDuration(text: string): number {
  // ~3.5 seconds per word, minimum 20 seconds
  const wordCount = text.trim().split(/\s+/).length;
  return Math.max(20000, wordCount * 3500);
}
