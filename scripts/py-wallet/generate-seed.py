from tonsdk.crypto import mnemonic_new, mnemonic_to_wallet_key

# Generate a new 24-word seed phrase
words = mnemonic_new(words_count=24)
print("Seed phrase:", " ".join(words))

# Derive the keypair from it
pub_key, priv_key = mnemonic_to_wallet_key(words)
print("Public key:", pub_key.hex())