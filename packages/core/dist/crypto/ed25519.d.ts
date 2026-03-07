export interface Ed25519Keypair {
    publicKeyHex: string;
    privateKeyHex: string;
}
/**
 * Generate a fresh Ed25519 keypair from secure random bytes.
 */
export declare function generateKeypair(): Ed25519Keypair;
/**
 * Derive keypair from a deterministic seed (e.g. for test agents).
 * Seed must be 32 bytes of hex.
 */
export declare function keypairFromSeed(seedHex: string): Ed25519Keypair;
/**
 * Derive public key from private key hex.
 */
export declare function publicKeyFromPrivate(privateKeyHex: string): string;
/**
 * Prepare a canonical message for signing.
 * For strings/hashes: SHA-256 of the UTF-8 bytes.
 * For objects: SHA-256 of canonical JSON (sorted keys).
 *
 * This matches GNS Protocol's canonical JSON requirement:
 * signature failures often stem from key ordering mismatches.
 */
export declare function canonicalMessage(input: string | object): Uint8Array;
/**
 * Sign a message with an Ed25519 private key.
 * Returns 128 hex chars (64-byte signature).
 */
export declare function signMessage(message: string | object, privateKeyHex: string): string;
/**
 * Sign a raw hash (already SHA-256 hex) with an Ed25519 private key.
 * The hash is treated as a pre-hashed message — we sign its bytes directly.
 */
export declare function signHash(hashHex: string, privateKeyHex: string): string;
/**
 * Verify an Ed25519 signature over a message.
 */
export declare function verifyMessage(message: string | object, signatureHex: string, publicKeyHex: string): boolean;
/**
 * Verify an Ed25519 signature over a raw hash.
 */
export declare function verifyHash(hashHex: string, signatureHex: string, publicKeyHex: string): boolean;
/**
 * Build the canonical delegation cert payload for signing.
 * Matches the DelegationCert type — human signs over these fields.
 */
export declare function delegationCertPayload(cert: {
    agentPublicKey: string;
    scopeCells: string[];
    scopeFacets: string[];
    validFrom: string;
    validUntil: string;
    maxSubdelegationDepth: number;
}): string;
/**
 * Sign a delegation cert with the human's private key.
 */
export declare function signDelegationCert(cert: Parameters<typeof delegationCertPayload>[0], humanPrivateKeyHex: string): string;
/**
 * Verify a delegation cert signature with the human's public key.
 */
export declare function verifyDelegationCert(cert: Parameters<typeof delegationCertPayload>[0], signatureHex: string, humanPublicKeyHex: string): boolean;
/**
 * Check if a hex string looks like a valid Ed25519 public key.
 */
export declare function isValidPublicKey(hex: string): boolean;
/**
 * Check if a hex string looks like a valid Ed25519 signature.
 */
export declare function isValidSignature(hex: string): boolean;
/**
 * Check if a string is a stub signature (all zeros padding).
 * Used to detect unupgraded Phase 0 signatures.
 */
export declare function isStubSignature(hex: string): boolean;
//# sourceMappingURL=ed25519.d.ts.map