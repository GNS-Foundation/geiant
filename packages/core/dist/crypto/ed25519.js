"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateKeypair = generateKeypair;
exports.keypairFromSeed = keypairFromSeed;
exports.publicKeyFromPrivate = publicKeyFromPrivate;
exports.canonicalMessage = canonicalMessage;
exports.signMessage = signMessage;
exports.signHash = signHash;
exports.verifyMessage = verifyMessage;
exports.verifyHash = verifyHash;
exports.delegationCertPayload = delegationCertPayload;
exports.signDelegationCert = signDelegationCert;
exports.verifyDelegationCert = verifyDelegationCert;
exports.isValidPublicKey = isValidPublicKey;
exports.isValidSignature = isValidSignature;
exports.isStubSignature = isStubSignature;
const ed = __importStar(require("@noble/ed25519"));
const crypto_1 = require("crypto");
// @noble/ed25519 v2 requires sha512Sync to be set.
// Use Node's built-in crypto — no extra dependency needed.
ed.etc.sha512Sync = (...msgs) => {
    const combined = ed.etc.concatBytes(...msgs);
    return new Uint8Array((0, crypto_1.createHash)('sha512').update(combined).digest());
};
// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
/**
 * Generate a fresh Ed25519 keypair from secure random bytes.
 */
function generateKeypair() {
    const privateKeyBytes = (0, crypto_1.randomBytes)(32);
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
function keypairFromSeed(seedHex) {
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
function publicKeyFromPrivate(privateKeyHex) {
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
function canonicalMessage(input) {
    const json = typeof input === 'string'
        ? input
        : JSON.stringify(input, Object.keys(input).sort());
    return new Uint8Array((0, crypto_1.createHash)('sha256').update(json, 'utf8').digest());
}
// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------
/**
 * Sign a message with an Ed25519 private key.
 * Returns 128 hex chars (64-byte signature).
 */
function signMessage(message, privateKeyHex) {
    const msgBytes = canonicalMessage(message);
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    const sigBytes = ed.sign(msgBytes, privateKeyBytes);
    return Buffer.from(sigBytes).toString('hex');
}
/**
 * Sign a raw hash (already SHA-256 hex) with an Ed25519 private key.
 * The hash is treated as a pre-hashed message — we sign its bytes directly.
 */
function signHash(hashHex, privateKeyHex) {
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
function verifyMessage(message, signatureHex, publicKeyHex) {
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
function verifyHash(hashHex, signatureHex, publicKeyHex) {
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
function delegationCertPayload(cert) {
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
function signDelegationCert(cert, humanPrivateKeyHex) {
    return signMessage(delegationCertPayload(cert), humanPrivateKeyHex);
}
/**
 * Verify a delegation cert signature with the human's public key.
 */
function verifyDelegationCert(cert, signatureHex, humanPublicKeyHex) {
    return verifyMessage(delegationCertPayload(cert), signatureHex, humanPublicKeyHex);
}
// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
/**
 * Check if a hex string looks like a valid Ed25519 public key.
 */
function isValidPublicKey(hex) {
    return /^[0-9a-f]{64}$/.test(hex);
}
/**
 * Check if a hex string looks like a valid Ed25519 signature.
 */
function isValidSignature(hex) {
    return /^[0-9a-f]{128}$/.test(hex);
}
/**
 * Check if a string is a stub signature (all zeros padding).
 * Used to detect unupgraded Phase 0 signatures.
 */
function isStubSignature(hex) {
    return hex.endsWith('0000000000000000000000000000000000000000000000000000000000000000');
}
//# sourceMappingURL=ed25519.js.map