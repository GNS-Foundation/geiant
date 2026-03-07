"use strict";
// =============================================================================
// GEIANT — Ed25519 CRYPTO TEST SUITE
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ed25519_1 = require("../crypto/ed25519");
// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Key generation', () => {
    (0, vitest_1.it)('generates a valid keypair', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        (0, vitest_1.expect)(kp.publicKeyHex).toHaveLength(64);
        (0, vitest_1.expect)(kp.privateKeyHex).toHaveLength(64);
        (0, vitest_1.expect)(/^[0-9a-f]{64}$/.test(kp.publicKeyHex)).toBe(true);
        (0, vitest_1.expect)(/^[0-9a-f]{64}$/.test(kp.privateKeyHex)).toBe(true);
    });
    (0, vitest_1.it)('generates unique keypairs each call', () => {
        const kp1 = (0, ed25519_1.generateKeypair)();
        const kp2 = (0, ed25519_1.generateKeypair)();
        (0, vitest_1.expect)(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
        (0, vitest_1.expect)(kp1.privateKeyHex).not.toBe(kp2.privateKeyHex);
    });
    (0, vitest_1.it)('derives keypair deterministically from seed', () => {
        const seed = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
        const kp1 = (0, ed25519_1.keypairFromSeed)(seed);
        const kp2 = (0, ed25519_1.keypairFromSeed)(seed);
        (0, vitest_1.expect)(kp1.publicKeyHex).toBe(kp2.publicKeyHex);
        (0, vitest_1.expect)(kp1.privateKeyHex).toBe(kp2.privateKeyHex);
    });
    (0, vitest_1.it)('different seeds produce different keypairs', () => {
        const kp1 = (0, ed25519_1.keypairFromSeed)('aaaa');
        const kp2 = (0, ed25519_1.keypairFromSeed)('bbbb');
        (0, vitest_1.expect)(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
    });
    (0, vitest_1.it)('derives correct public key from private key', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const derived = (0, ed25519_1.publicKeyFromPrivate)(kp.privateKeyHex);
        (0, vitest_1.expect)(derived).toBe(kp.publicKeyHex);
    });
});
// ---------------------------------------------------------------------------
// Sign + verify message
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Sign and verify message', () => {
    (0, vitest_1.it)('signs a string message and verifies it', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const msg = 'hello geiant';
        const sig = (0, ed25519_1.signMessage)(msg, kp.privateKeyHex);
        (0, vitest_1.expect)(sig).toHaveLength(128);
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)(msg, sig, kp.publicKeyHex)).toBe(true);
    });
    (0, vitest_1.it)('signs an object and verifies it', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const obj = { taskId: 'task-001', cell: '851e8053fffffff', facet: 'grid' };
        const sig = (0, ed25519_1.signMessage)(obj, kp.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)(obj, sig, kp.publicKeyHex)).toBe(true);
    });
    (0, vitest_1.it)('canonical JSON — key order does not affect verification', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const obj1 = { a: 1, b: 2, c: 3 };
        const obj2 = { c: 3, a: 1, b: 2 }; // different key order
        const sig = (0, ed25519_1.signMessage)(obj1, kp.privateKeyHex);
        // Both should verify — canonical JSON sorts keys
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)(obj1, sig, kp.publicKeyHex)).toBe(true);
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)(obj2, sig, kp.publicKeyHex)).toBe(true);
    });
    (0, vitest_1.it)('rejects tampered message', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signMessage)('original', kp.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)('tampered', sig, kp.publicKeyHex)).toBe(false);
    });
    (0, vitest_1.it)('rejects wrong public key', () => {
        const kp1 = (0, ed25519_1.generateKeypair)();
        const kp2 = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signMessage)('hello', kp1.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)('hello', sig, kp2.publicKeyHex)).toBe(false);
    });
    (0, vitest_1.it)('rejects invalid signature length', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)('hello', 'tooshort', kp.publicKeyHex)).toBe(false);
    });
    (0, vitest_1.it)('rejects invalid public key length', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signMessage)('hello', kp.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)('hello', sig, 'tooshort')).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// Sign + verify hash
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Sign and verify hash', () => {
    (0, vitest_1.it)('signs a SHA-256 hash and verifies it', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const hash = '5c4450c4a428bb754d8853005f09f60c9df2de32e9d682b181a86e6b78bfb10e';
        const sig = (0, ed25519_1.signHash)(hash, kp.privateKeyHex);
        (0, vitest_1.expect)(sig).toHaveLength(128);
        (0, vitest_1.expect)((0, ed25519_1.verifyHash)(hash, sig, kp.publicKeyHex)).toBe(true);
    });
    (0, vitest_1.it)('rejects tampered hash', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const hash = '5c4450c4a428bb754d8853005f09f60c9df2de32e9d682b181a86e6b78bfb10e';
        const sig = (0, ed25519_1.signHash)(hash, kp.privateKeyHex);
        const tampered = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        (0, vitest_1.expect)((0, ed25519_1.verifyHash)(tampered, sig, kp.publicKeyHex)).toBe(false);
    });
    (0, vitest_1.it)('sign/verifyHash and sign/verifyMessage produce different sigs for same content', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const content = 'abc123';
        const sigMsg = (0, ed25519_1.signMessage)(content, kp.privateKeyHex);
        const sigHash = (0, ed25519_1.signHash)(content, kp.privateKeyHex);
        // Different pre-processing → different signatures
        (0, vitest_1.expect)(sigMsg).not.toBe(sigHash);
    });
});
// ---------------------------------------------------------------------------
// Delegation cert signing
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Delegation cert signing', () => {
    const certPayload = {
        agentPublicKey: 'a'.repeat(64),
        scopeCells: ['851e8053fffffff', '851e8050ca7ffff'],
        scopeFacets: ['grid', 'compliance'],
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2026-12-31T00:00:00.000Z',
        maxSubdelegationDepth: 1,
    };
    (0, vitest_1.it)('signs and verifies a delegation cert', () => {
        const humanKp = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signDelegationCert)(certPayload, humanKp.privateKeyHex);
        (0, vitest_1.expect)(sig).toHaveLength(128);
        (0, vitest_1.expect)((0, ed25519_1.verifyDelegationCert)(certPayload, sig, humanKp.publicKeyHex)).toBe(true);
    });
    (0, vitest_1.it)('scope_cells order does not affect verification', () => {
        const humanKp = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signDelegationCert)(certPayload, humanKp.privateKeyHex);
        // Reversed scope_cells — canonical sort makes it equivalent
        const certReversed = {
            ...certPayload,
            scopeCells: [...certPayload.scopeCells].reverse(),
        };
        (0, vitest_1.expect)((0, ed25519_1.verifyDelegationCert)(certReversed, sig, humanKp.publicKeyHex)).toBe(true);
    });
    (0, vitest_1.it)('rejects cert with modified scope', () => {
        const humanKp = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signDelegationCert)(certPayload, humanKp.privateKeyHex);
        const tampered = { ...certPayload, scopeFacets: ['grid', 'finance'] };
        (0, vitest_1.expect)((0, ed25519_1.verifyDelegationCert)(tampered, sig, humanKp.publicKeyHex)).toBe(false);
    });
    (0, vitest_1.it)('rejects cert signed by different human', () => {
        const human1 = (0, ed25519_1.generateKeypair)();
        const human2 = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signDelegationCert)(certPayload, human1.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.verifyDelegationCert)(certPayload, sig, human2.publicKeyHex)).toBe(false);
    });
    (0, vitest_1.it)('rejects cert with modified validity window', () => {
        const humanKp = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signDelegationCert)(certPayload, humanKp.privateKeyHex);
        const tampered = { ...certPayload, validUntil: '2099-12-31T00:00:00.000Z' };
        (0, vitest_1.expect)((0, ed25519_1.verifyDelegationCert)(tampered, sig, humanKp.publicKeyHex)).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// Canonical message
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Canonical message', () => {
    (0, vitest_1.it)('produces same bytes for same string', () => {
        const m1 = (0, ed25519_1.canonicalMessage)('hello');
        const m2 = (0, ed25519_1.canonicalMessage)('hello');
        (0, vitest_1.expect)(Buffer.from(m1).toString('hex')).toBe(Buffer.from(m2).toString('hex'));
    });
    (0, vitest_1.it)('produces different bytes for different strings', () => {
        const m1 = (0, ed25519_1.canonicalMessage)('hello');
        const m2 = (0, ed25519_1.canonicalMessage)('world');
        (0, vitest_1.expect)(Buffer.from(m1).toString('hex')).not.toBe(Buffer.from(m2).toString('hex'));
    });
    (0, vitest_1.it)('produces 32 bytes (SHA-256 output)', () => {
        (0, vitest_1.expect)((0, ed25519_1.canonicalMessage)('test')).toHaveLength(32);
        (0, vitest_1.expect)((0, ed25519_1.canonicalMessage)({ a: 1 })).toHaveLength(32);
    });
});
// ---------------------------------------------------------------------------
// Utility validators
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Utility validators', () => {
    (0, vitest_1.it)('isValidPublicKey accepts 64-char hex', () => {
        (0, vitest_1.expect)((0, ed25519_1.isValidPublicKey)('a'.repeat(64))).toBe(true);
        (0, vitest_1.expect)((0, ed25519_1.isValidPublicKey)('0'.repeat(64))).toBe(true);
    });
    (0, vitest_1.it)('isValidPublicKey rejects bad inputs', () => {
        (0, vitest_1.expect)((0, ed25519_1.isValidPublicKey)('tooshort')).toBe(false);
        (0, vitest_1.expect)((0, ed25519_1.isValidPublicKey)('z'.repeat(64))).toBe(false); // non-hex
        (0, vitest_1.expect)((0, ed25519_1.isValidPublicKey)('')).toBe(false);
    });
    (0, vitest_1.it)('isValidSignature accepts 128-char hex', () => {
        (0, vitest_1.expect)((0, ed25519_1.isValidSignature)('a'.repeat(128))).toBe(true);
    });
    (0, vitest_1.it)('isValidSignature rejects bad inputs', () => {
        (0, vitest_1.expect)((0, ed25519_1.isValidSignature)('a'.repeat(64))).toBe(false);
        (0, vitest_1.expect)((0, ed25519_1.isValidSignature)('')).toBe(false);
    });
    (0, vitest_1.it)('isStubSignature detects zero-padded stubs', () => {
        const stub = 'e5195dac4982e0386c3ad6c65fcdda8d768d2f0754b92ac09e31698a95db06690000000000000000000000000000000000000000000000000000000000000000';
        (0, vitest_1.expect)((0, ed25519_1.isStubSignature)(stub)).toBe(true);
    });
    (0, vitest_1.it)('isStubSignature returns false for real signatures', () => {
        const kp = (0, ed25519_1.generateKeypair)();
        const sig = (0, ed25519_1.signMessage)('real', kp.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.isStubSignature)(sig)).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// Integration — full agent identity workflow
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Full agent identity workflow', () => {
    (0, vitest_1.it)('human signs delegation cert, agent signs task, both verify', () => {
        // Generate identities
        const humanKp = (0, ed25519_1.generateKeypair)();
        const agentKp = (0, ed25519_1.generateKeypair)();
        // Human creates and signs a delegation cert
        const cert = {
            agentPublicKey: agentKp.publicKeyHex,
            scopeCells: ['851e8053fffffff'],
            scopeFacets: ['grid'],
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: '2026-12-31T00:00:00.000Z',
            maxSubdelegationDepth: 1,
        };
        const humanSig = (0, ed25519_1.signDelegationCert)(cert, humanKp.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.verifyDelegationCert)(cert, humanSig, humanKp.publicKeyHex)).toBe(true);
        // Agent signs a task using its private key
        const task = {
            originCell: '851e8053fffffff',
            facet: 'grid',
            taskId: 'task-001',
            certHash: humanSig.substring(0, 64),
        };
        const agentSig = (0, ed25519_1.signMessage)(task, agentKp.privateKeyHex);
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)(task, agentSig, agentKp.publicKeyHex)).toBe(true);
        // Cross-check: agent sig doesn't verify with human key and vice versa
        (0, vitest_1.expect)((0, ed25519_1.verifyMessage)(task, agentSig, humanKp.publicKeyHex)).toBe(false);
        (0, vitest_1.expect)((0, ed25519_1.verifyDelegationCert)(cert, humanSig, agentKp.publicKeyHex)).toBe(false);
    });
});
//# sourceMappingURL=ed25519.test.js.map