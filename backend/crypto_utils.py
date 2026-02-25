"""
crypto_utils.py — Sage E2E Encryption
Same hybrid RSA-2048 + AES-256-GCM approach.
Keys are generated on the CLIENT — server only stores public keys.
"""

import os, json, base64, hashlib, time
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend


def generate_rsa_keypair():
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
    return priv, priv.public_key()

def public_key_to_pem(pub) -> str:
    return pub.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

def private_key_to_pem(priv) -> str:
    return priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                               serialization.NoEncryption()).decode()

def pem_to_public_key(pem: str):
    return serialization.load_pem_public_key(pem.encode(), backend=default_backend())

def pem_to_private_key(pem: str):
    return serialization.load_pem_private_key(pem.encode(), password=None, backend=default_backend())

def get_key_fingerprint(pub) -> str:
    der = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    d = hashlib.sha256(der).hexdigest().upper()
    return " ".join(d[i:i+4] for i in range(0, 32, 4))  # First 32 chars formatted

def encrypt_message(plaintext: str, recipient_pub) -> str:
    payload = json.dumps({"text": plaintext, "ts": time.time()}).encode()
    aes_key = os.urandom(32)
    iv = os.urandom(12)
    ct = AESGCM(aes_key).encrypt(iv, payload, None)
    enc_key = recipient_pub.encrypt(aes_key, padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    bundle = {"enc_key": base64.b64encode(enc_key).decode(),
              "iv": base64.b64encode(iv).decode(),
              "ct": base64.b64encode(ct).decode()}
    return base64.b64encode(json.dumps(bundle).encode()).decode()

def decrypt_message(blob: str, recipient_priv, max_age: float = 86400.0) -> str:
    bundle = json.loads(base64.b64decode(blob))
    enc_key = base64.b64decode(bundle["enc_key"])
    iv      = base64.b64decode(bundle["iv"])
    ct      = base64.b64decode(bundle["ct"])
    aes_key = recipient_priv.decrypt(enc_key, padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    payload = json.loads(AESGCM(aes_key).decrypt(iv, ct, None))
    if time.time() - payload["ts"] > max_age:
        raise ValueError("Message expired")
    return payload["text"]
