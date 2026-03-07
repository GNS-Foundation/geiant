// =============================================================================
// GEIANT — Ed25519 CRYPTO MODULE
// Real signing and verification using @noble/ed25519.
//
// Key design principles (from GNS Protocol):
//   - Private keys NEVER leave this module as plain hex in production
//   - All signing is over canonical JSON (sorted keys + SHA-256)
//   - Public keys are 32 bytes = 64 hex chars
//   - Signatures are 64 bytes = 128 hex chars
//   - Keys are generated fresh per agent identity — deterministic from seed
//
// Usage:
//   const keypair = await generateKeypair();
//   const sig = await sign(message, keypair.privateKeyHex);
//   const valid = await verify(message, sig, keypair.publicKeyHex);
// =============================================================================
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'crypto';
// @noble/ed25519 v2 requires sha512Sync to be set.
// Use Node's built-in crypto — no extra dependency needed.
ed.etc.sha512Sync = (...msgs) => {
    const combined = ed.etc.concatBytes(...msgs);
    return new Uint8Array(createHash('sha512').update(combined).digest());
};
// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
/**
 * Generate a fresh Ed25519 keypair from secure random bytes.
 */
export function generateKeypair() {
    const privateKeyBytes = randomBytes(32);
    const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
    return {
        privateKeyHex: Buffer.from(privateKeyBytes).toString('hex'),
        publicKeyHex: Buffer.from(publicKeyBytes).toString('hex'),
    };
}
/**
 * Derive keypair from a deterministic seed (e.g. for test agents).
 * Seed must be 32 bytes of hex.
 */
export function keypairFromSeed(seedHex) {
    const privateKeyBytes = Buffer.from(seedHex.padEnd(64, '0').substring(0, 64), 'hex');
    const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
    return {
        privateKeyHex: Buffer.from(privateKeyBytes).toString('hex'),
        publicKeyHex: Buffer.from(publicKeyBytes).toString('hex'),
    };
}
/**
 * Derive public key from private key hex.
 */
export function publicKeyFromPrivate(privateKeyHex) {
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
    return Buffer.from(publicKeyBytes).toString('hex');
}
// ---------------------------------------------------------------------------
// Canonical message preparation
// ---------------------------------------------------------------------------
/**
 * Prepare a canonical message for signing.
 * For strings/hashes: SHA-256 of the UTF-8 bytes.
 * For objects: SHA-256 of canonical JSON (sorted keys).
 *
 * This matches GNS Protocol's canonical JSON requirement:
 * signature failures often stem from key ordering mismatches.
 */
export function canonicalMessage(input) {
    const json = typeof input === 'string'
        ? input
        : JSON.stringify(input, Object.keys(input).sort());
    return new Uint8Array(createHash('sha256').update(json, 'utf8').digest());
}
// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------
/**
 * Sign a message with an Ed25519 private key.
 * Returns 128 hex chars (64-byte signature).
 */
export function signMessage(message, privateKeyHex) {
    const msgBytes = canonicalMessage(message);
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    const sigBytes = ed.sign(msgBytes, privateKeyBytes);
    return Buffer.from(sigBytes).toString('hex');
}
/**
 * Sign a raw hash (already SHA-256 hex) with an Ed25519 private key.
 * The hash is treated as a pre-hashed message — we sign its bytes directly.
 */
export function signHash(hashHex, privateKeyHex) {
    const msgBytes = new Uint8Array(Buffer.from(hashHex, 'hex'));
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    const sigBytes = ed.sign(msgBytes, privateKeyBytes);
    return Buffer.from(sigBytes).toString('hex');
}
// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------
/**
 * Verify an Ed25519 signature over a message.
 */
export function verifyMessage(message, signatureHex, publicKeyHex) {
    try {
        if (!signatureHex || signatureHex.length !== 128)
            return false;
        if (!publicKeyHex || publicKeyHex.length !== 64)
            return false;
        const msgBytes = canonicalMessage(message);
        const sigBytes = Buffer.from(signatureHex, 'hex');
        const pubBytes = Buffer.from(publicKeyHex, 'hex');
        return ed.verify(sigBytes, msgBytes, pubBytes);
    }
    catch {
        return false;
    }
}
/**
 * Verify an Ed25519 signature over a raw hash.
 */
export function verifyHash(hashHex, signatureHex, publicKeyHex) {
    try {
        if (!signatureHex || signatureHex.length !== 128)
            return false;
        if (!publicKeyHex || publicKeyHex.length !== 64)
            return false;
        const msgBytes = new Uint8Array(Buffer.from(hashHex, 'hex'));
        const sigBytes = Buffer.from(signatureHex, 'hex');
        const pubBytes = Buffer.from(publicKeyHex, 'hex');
        return ed.verify(sigBytes, msgBytes, pubBytes);
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------------------
// Delegation cert signing helpers
// ---------------------------------------------------------------------------
/**
 * Build the canonical delegation cert payload for signing.
 * Matches the DelegationCert type — human signs over these fields.
 */
export function delegationCertPayload(cert) {
    return JSON.stringify({
        agentPublicKey: cert.agentPublicKey,
        maxSubdelegationDepth: cert.maxSubdelegationDepth,
        scopeCells: [...cert.scopeCells].sort(),
        scopeFacets: [...cert.scopeFacets].sort(),
        validFrom: cert.validFrom,
        validUntil: cert.validUntil,
    });
}
/**
 * Sign a delegation cert with the human's private key.
 */
export function signDelegationCert(cert, humanPrivateKeyHex) {
    return signMessage(delegationCertPayload(cert), humanPrivateKeyHex);
}
/**
 * Verify a delegation cert signature with the human's public key.
 */
export function verifyDelegationCert(cert, signatureHex, humanPublicKeyHex) {
    return verifyMessage(delegationCertPayload(cert), signatureHex, humanPublicKeyHex);
}
// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
/**
 * Check if a hex string looks like a valid Ed25519 public key.
 */
export function isValidPublicKey(hex) {
    return /^[0-9a-f]{64}$/.test(hex);
}
/**
 * Check if a hex string looks like a valid Ed25519 signature.
 */
export function isValidSignature(hex) {
    return /^[0-9a-f]{128}$/.test(hex);
}
/**
 * Check if a string is a stub signature (all zeros padding).
 * Used to detect unupgraded Phase 0 signatures.
 */
export function isStubSignature(hex) {
    return hex.endsWith('0000000000000000000000000000000000000000000000000000000000000000');
}
//# sourceMappingURL=ed25519.js.map