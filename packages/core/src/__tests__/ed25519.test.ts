// =============================================================================
// GEIANT — Ed25519 CRYPTO TEST SUITE
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  generateKeypair,
  keypairFromSeed,
  publicKeyFromPrivate,
  signMessage,
  signHash,
  verifyMessage,
  verifyHash,
  signDelegationCert,
  verifyDelegationCert,
  isValidPublicKey,
  isValidSignature,
  isStubSignature,
  canonicalMessage,
} from '../crypto/ed25519.js';

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

describe('Key generation', () => {
  it('generates a valid keypair', () => {
    const kp = generateKeypair();
    expect(kp.publicKeyHex).toHaveLength(64);
    expect(kp.privateKeyHex).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(kp.publicKeyHex)).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(kp.privateKeyHex)).toBe(true);
  });

  it('generates unique keypairs each call', () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    expect(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
    expect(kp1.privateKeyHex).not.toBe(kp2.privateKeyHex);
  });

  it('derives keypair deterministically from seed', () => {
    const seed = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const kp1 = keypairFromSeed(seed);
    const kp2 = keypairFromSeed(seed);
    expect(kp1.publicKeyHex).toBe(kp2.publicKeyHex);
    expect(kp1.privateKeyHex).toBe(kp2.privateKeyHex);
  });

  it('different seeds produce different keypairs', () => {
    const kp1 = keypairFromSeed('aaaa');
    const kp2 = keypairFromSeed('bbbb');
    expect(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
  });

  it('derives correct public key from private key', () => {
    const kp = generateKeypair();
    const derived = publicKeyFromPrivate(kp.privateKeyHex);
    expect(derived).toBe(kp.publicKeyHex);
  });
});

// ---------------------------------------------------------------------------
// Sign + verify message
// ---------------------------------------------------------------------------

describe('Sign and verify message', () => {
  it('signs a string message and verifies it', () => {
    const kp = generateKeypair();
    const msg = 'hello geiant';
    const sig = signMessage(msg, kp.privateKeyHex);

    expect(sig).toHaveLength(128);
    expect(verifyMessage(msg, sig, kp.publicKeyHex)).toBe(true);
  });

  it('signs an object and verifies it', () => {
    const kp = generateKeypair();
    const obj = { taskId: 'task-001', cell: '851e8053fffffff', facet: 'grid' };
    const sig = signMessage(obj, kp.privateKeyHex);

    expect(verifyMessage(obj, sig, kp.publicKeyHex)).toBe(true);
  });

  it('canonical JSON — key order does not affect verification', () => {
    const kp = generateKeypair();
    const obj1 = { a: 1, b: 2, c: 3 };
    const obj2 = { c: 3, a: 1, b: 2 }; // different key order
    const sig = signMessage(obj1, kp.privateKeyHex);

    // Both should verify — canonical JSON sorts keys
    expect(verifyMessage(obj1, sig, kp.publicKeyHex)).toBe(true);
    expect(verifyMessage(obj2, sig, kp.publicKeyHex)).toBe(true);
  });

  it('rejects tampered message', () => {
    const kp = generateKeypair();
    const sig = signMessage('original', kp.privateKeyHex);
    expect(verifyMessage('tampered', sig, kp.publicKeyHex)).toBe(false);
  });

  it('rejects wrong public key', () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const sig = signMessage('hello', kp1.privateKeyHex);
    expect(verifyMessage('hello', sig, kp2.publicKeyHex)).toBe(false);
  });

  it('rejects invalid signature length', () => {
    const kp = generateKeypair();
    expect(verifyMessage('hello', 'tooshort', kp.publicKeyHex)).toBe(false);
  });

  it('rejects invalid public key length', () => {
    const kp = generateKeypair();
    const sig = signMessage('hello', kp.privateKeyHex);
    expect(verifyMessage('hello', sig, 'tooshort')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sign + verify hash
// ---------------------------------------------------------------------------

describe('Sign and verify hash', () => {
  it('signs a SHA-256 hash and verifies it', () => {
    const kp = generateKeypair();
    const hash = '5c4450c4a428bb754d8853005f09f60c9df2de32e9d682b181a86e6b78bfb10e';
    const sig = signHash(hash, kp.privateKeyHex);

    expect(sig).toHaveLength(128);
    expect(verifyHash(hash, sig, kp.publicKeyHex)).toBe(true);
  });

  it('rejects tampered hash', () => {
    const kp = generateKeypair();
    const hash = '5c4450c4a428bb754d8853005f09f60c9df2de32e9d682b181a86e6b78bfb10e';
    const sig = signHash(hash, kp.privateKeyHex);
    const tampered = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(verifyHash(tampered, sig, kp.publicKeyHex)).toBe(false);
  });

  it('sign/verifyHash and sign/verifyMessage produce different sigs for same content', () => {
    const kp = generateKeypair();
    const content = 'abc123';
    const sigMsg  = signMessage(content, kp.privateKeyHex);
    const sigHash = signHash(content, kp.privateKeyHex);
    // Different pre-processing → different signatures
    expect(sigMsg).not.toBe(sigHash);
  });
});

// ---------------------------------------------------------------------------
// Delegation cert signing
// ---------------------------------------------------------------------------

describe('Delegation cert signing', () => {
  const certPayload = {
    agentPublicKey: 'a'.repeat(64),
    scopeCells: ['851e8053fffffff', '851e8050ca7ffff'],
    scopeFacets: ['grid', 'compliance'],
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T00:00:00.000Z',
    maxSubdelegationDepth: 1,
  };

  it('signs and verifies a delegation cert', () => {
    const humanKp = generateKeypair();
    const sig = signDelegationCert(certPayload, humanKp.privateKeyHex);

    expect(sig).toHaveLength(128);
    expect(verifyDelegationCert(certPayload, sig, humanKp.publicKeyHex)).toBe(true);
  });

  it('scope_cells order does not affect verification', () => {
    const humanKp = generateKeypair();
    const sig = signDelegationCert(certPayload, humanKp.privateKeyHex);

    // Reversed scope_cells — canonical sort makes it equivalent
    const certReversed = {
      ...certPayload,
      scopeCells: [...certPayload.scopeCells].reverse(),
    };
    expect(verifyDelegationCert(certReversed, sig, humanKp.publicKeyHex)).toBe(true);
  });

  it('rejects cert with modified scope', () => {
    const humanKp = generateKeypair();
    const sig = signDelegationCert(certPayload, humanKp.privateKeyHex);

    const tampered = { ...certPayload, scopeFacets: ['grid', 'finance'] };
    expect(verifyDelegationCert(tampered, sig, humanKp.publicKeyHex)).toBe(false);
  });

  it('rejects cert signed by different human', () => {
    const human1 = generateKeypair();
    const human2 = generateKeypair();
    const sig = signDelegationCert(certPayload, human1.privateKeyHex);
    expect(verifyDelegationCert(certPayload, sig, human2.publicKeyHex)).toBe(false);
  });

  it('rejects cert with modified validity window', () => {
    const humanKp = generateKeypair();
    const sig = signDelegationCert(certPayload, humanKp.privateKeyHex);
    const tampered = { ...certPayload, validUntil: '2099-12-31T00:00:00.000Z' };
    expect(verifyDelegationCert(tampered, sig, humanKp.publicKeyHex)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Canonical message
// ---------------------------------------------------------------------------

describe('Canonical message', () => {
  it('produces same bytes for same string', () => {
    const m1 = canonicalMessage('hello');
    const m2 = canonicalMessage('hello');
    expect(Buffer.from(m1).toString('hex')).toBe(Buffer.from(m2).toString('hex'));
  });

  it('produces different bytes for different strings', () => {
    const m1 = canonicalMessage('hello');
    const m2 = canonicalMessage('world');
    expect(Buffer.from(m1).toString('hex')).not.toBe(Buffer.from(m2).toString('hex'));
  });

  it('produces 32 bytes (SHA-256 output)', () => {
    expect(canonicalMessage('test')).toHaveLength(32);
    expect(canonicalMessage({ a: 1 })).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// Utility validators
// ---------------------------------------------------------------------------

describe('Utility validators', () => {
  it('isValidPublicKey accepts 64-char hex', () => {
    expect(isValidPublicKey('a'.repeat(64))).toBe(true);
    expect(isValidPublicKey('0'.repeat(64))).toBe(true);
  });

  it('isValidPublicKey rejects bad inputs', () => {
    expect(isValidPublicKey('tooshort')).toBe(false);
    expect(isValidPublicKey('z'.repeat(64))).toBe(false); // non-hex
    expect(isValidPublicKey('')).toBe(false);
  });

  it('isValidSignature accepts 128-char hex', () => {
    expect(isValidSignature('a'.repeat(128))).toBe(true);
  });

  it('isValidSignature rejects bad inputs', () => {
    expect(isValidSignature('a'.repeat(64))).toBe(false);
    expect(isValidSignature('')).toBe(false);
  });

  it('isStubSignature detects zero-padded stubs', () => {
    const stub = 'e5195dac4982e0386c3ad6c65fcdda8d768d2f0754b92ac09e31698a95db06690000000000000000000000000000000000000000000000000000000000000000';
    expect(isStubSignature(stub)).toBe(true);
  });

  it('isStubSignature returns false for real signatures', () => {
    const kp = generateKeypair();
    const sig = signMessage('real', kp.privateKeyHex);
    expect(isStubSignature(sig)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration — full agent identity workflow
// ---------------------------------------------------------------------------

describe('Full agent identity workflow', () => {
  it('human signs delegation cert, agent signs task, both verify', () => {
    // Generate identities
    const humanKp = generateKeypair();
    const agentKp = generateKeypair();

    // Human creates and signs a delegation cert
    const cert = {
      agentPublicKey: agentKp.publicKeyHex,
      scopeCells: ['851e8053fffffff'],
      scopeFacets: ['grid'],
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-12-31T00:00:00.000Z',
      maxSubdelegationDepth: 1,
    };
    const humanSig = signDelegationCert(cert, humanKp.privateKeyHex);
    expect(verifyDelegationCert(cert, humanSig, humanKp.publicKeyHex)).toBe(true);

    // Agent signs a task using its private key
    const task = {
      originCell: '851e8053fffffff',
      facet: 'grid',
      taskId: 'task-001',
      certHash: humanSig.substring(0, 64),
    };
    const agentSig = signMessage(task, agentKp.privateKeyHex);
    expect(verifyMessage(task, agentSig, agentKp.publicKeyHex)).toBe(true);

    // Cross-check: agent sig doesn't verify with human key and vice versa
    expect(verifyMessage(task, agentSig, humanKp.publicKeyHex)).toBe(false);
    expect(verifyDelegationCert(cert, humanSig, agentKp.publicKeyHex)).toBe(false);
  });
});
