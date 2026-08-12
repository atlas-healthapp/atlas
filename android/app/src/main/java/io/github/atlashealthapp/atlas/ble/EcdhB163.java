package io.github.atlashealthapp.atlas.ble;

/**
 * ECDH over the binary field GF(2^163), NIST B-163 (SECG sect163r2).
 *
 * Ported from tiny-ECDH-c (https://github.com/kokke/tiny-ECDH-c), which is
 * released into the public domain. Only the B-163 curve is kept. The structure
 * follows the C deliberately closely, ugly names and all, because the goal is a
 * faithful port rather than good Java: every place this reads oddly is a place
 * the original read that way, and keeping them aligned is what makes the two
 * comparable when something disagrees.
 *
 * Why hand-rolled rather than a real crypto library: the band expects raw
 * 24-bytes-per-coordinate little-endian points, not any standard point encoding.
 * A general library would give correct curve maths in the wrong wire format, and
 * that mismatch fails as "authentication rejected" with nothing to debug.
 *
 * Three things Java changes about the C, each a real bug source:
 *  - Java has no unsigned types, so every logical right shift must be >>> and
 *    never >>. A sign-extended shift here produces plausible-looking garbage.
 *  - Java cannot cast a byte[] to a uint32[], so conversion is explicit. The C
 *    relied on the host being little-endian; {@link #bytesToInts} makes that
 *    assumption visible instead.
 *  - Arrays are references, so gf2fieldMul's requirement that its output not
 *    alias its second operand is a real constraint here. Aliasing the first
 *    operand is fine and the callers rely on it.
 *
 * Not constant-time, exactly as upstream warns. That is acceptable here: the
 * attacker would need to already be measuring timings inside the phone, and the
 * secret being protected is a fitness band's session key.
 */
final class EcdhB163 {

    private static final int CURVE_DEGREE = 163;
    private static final int BITVEC_MARGIN = 3;
    private static final int BITVEC_NBITS = CURVE_DEGREE + BITVEC_MARGIN;
    private static final int BITVEC_NWORDS = (BITVEC_NBITS + 31) / 32; // 6
    private static final int BITVEC_NBYTES = 4 * BITVEC_NWORDS;        // 24

    static final int PRIVATE_KEY_SIZE = BITVEC_NBYTES;      // 24
    static final int PUBLIC_KEY_SIZE = 2 * BITVEC_NBYTES;   // 48

    // NIST B-163. Verified identical to the constants Gadgetbridge uses, which
    // matters because B-163 and K-163 share a polynomial and differ in base
    // point: picking the wrong one still computes cleanly and still fails auth.
    private static final int[] POLYNOMIAL =
            {0x000000c9, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000008};
    private static final int[] COEFF_B =
            {0x4a3205fd, 0x512f7874, 0x1481eb10, 0xb8c953ca, 0x0a601907, 0x00000002};
    private static final int[] BASE_X =
            {0xe8343e36, 0xd4994637, 0xa0991168, 0x86a2d57e, 0xf0eba162, 0x00000003};
    private static final int[] BASE_Y =
            {0x797324f1, 0xb11c5c0c, 0xa2cdd545, 0x71a0094f, 0xd51fbc6c, 0x00000000};
    private static final int[] BASE_ORDER =
            {0xa4234c33, 0x77e70c12, 0x000292fe, 0x00000000, 0x00000000, 0x00000004};

    private EcdhB163() {
    }

    /* ---------------- bit vector helpers ---------------- */

    private static int bitvecGetBit(final int[] x, final int idx) {
        return (x[idx / 32] >>> (idx & 31)) & 1;
    }

    private static void bitvecClrBit(final int[] x, final int idx) {
        x[idx / 32] &= ~(1 << (idx & 31));
    }

    private static void bitvecCopy(final int[] x, final int[] y) {
        System.arraycopy(y, 0, x, 0, BITVEC_NWORDS);
    }

    private static void bitvecSwap(final int[] x, final int[] y) {
        for (int i = 0; i < BITVEC_NWORDS; i++) {
            final int t = x[i];
            x[i] = y[i];
            y[i] = t;
        }
    }

    private static boolean bitvecEqual(final int[] x, final int[] y) {
        for (int i = 0; i < BITVEC_NWORDS; i++) {
            if (x[i] != y[i]) {
                return false;
            }
        }
        return true;
    }

    private static void bitvecSetZero(final int[] x) {
        java.util.Arrays.fill(x, 0, BITVEC_NWORDS, 0);
    }

    private static boolean bitvecIsZero(final int[] x) {
        for (int i = 0; i < BITVEC_NWORDS; i++) {
            if (x[i] != 0) {
                return false;
            }
        }
        return true;
    }

    /** Index of the highest set bit, plus one. Zero for an all-zero vector. */
    private static int bitvecDegree(final int[] x) {
        int i = BITVEC_NWORDS * 32;
        int ptr = BITVEC_NWORDS;

        // Walk down past empty words. The short-circuit matters: when every word
        // is zero this must stop before indexing below zero.
        while (i > 0 && x[--ptr] == 0) {
            i -= 32;
        }
        if (i != 0) {
            int mask = 1 << 31;
            while ((x[ptr] & mask) == 0) {
                mask >>>= 1;
                i -= 1;
            }
        }
        return i;
    }

    private static void bitvecLshift(final int[] x, final int[] y, int nbits) {
        final int nwords = nbits / 32;

        int i;
        for (i = 0; i < nwords; i++) {
            x[i] = 0;
        }
        int j = 0;
        while (i < BITVEC_NWORDS) {
            x[i] = y[j];
            i++;
            j++;
        }

        nbits &= 31;
        if (nbits != 0) {
            for (int k = BITVEC_NWORDS - 1; k > 0; k--) {
                x[k] = (x[k] << nbits) | (x[k - 1] >>> (32 - nbits));
            }
            x[0] <<= nbits;
        }
    }

    /* ---------------- field arithmetic ---------------- */

    private static void gf2fieldSetOne(final int[] x) {
        x[0] = 1;
        for (int i = 1; i < BITVEC_NWORDS; i++) {
            x[i] = 0;
        }
    }

    private static boolean gf2fieldIsOne(final int[] x) {
        if (x[0] != 1) {
            return false;
        }
        for (int i = 1; i < BITVEC_NWORDS; i++) {
            if (x[i] != 0) {
                return false;
            }
        }
        return true;
    }

    /** Addition in GF(2^m) is XOR. */
    private static void gf2fieldAdd(final int[] z, final int[] x, final int[] y) {
        for (int i = 0; i < BITVEC_NWORDS; i++) {
            z[i] = x[i] ^ y[i];
        }
    }

    private static void gf2fieldInc(final int[] x) {
        x[0] ^= 1;
    }

    /** z := x * y. z may alias x, but must not alias y. */
    private static void gf2fieldMul(final int[] z, final int[] x, final int[] y) {
        if (z == y) {
            throw new IllegalArgumentException("gf2fieldMul output must not alias its second operand");
        }
        final int[] tmp = new int[BITVEC_NWORDS];
        bitvecCopy(tmp, x);

        if (bitvecGetBit(y, 0) != 0) {
            bitvecCopy(z, x);
        } else {
            bitvecSetZero(z);
        }

        for (int i = 1; i < CURVE_DEGREE; i++) {
            bitvecLshift(tmp, tmp, 1);
            if (bitvecGetBit(tmp, CURVE_DEGREE) != 0) {
                gf2fieldAdd(tmp, tmp, POLYNOMIAL);
            }
            if (bitvecGetBit(y, i) != 0) {
                gf2fieldAdd(z, z, tmp);
            }
        }
    }

    /** z := 1/x */
    private static void gf2fieldInv(final int[] z, final int[] x) {
        final int[] u = new int[BITVEC_NWORDS];
        final int[] v = new int[BITVEC_NWORDS];
        final int[] g = new int[BITVEC_NWORDS];
        final int[] h = new int[BITVEC_NWORDS];

        bitvecCopy(u, x);
        bitvecCopy(v, POLYNOMIAL);
        bitvecSetZero(g);
        gf2fieldSetOne(z);

        while (!gf2fieldIsOne(u)) {
            int i = bitvecDegree(u) - bitvecDegree(v);
            if (i < 0) {
                bitvecSwap(u, v);
                bitvecSwap(g, z);
                i = -i;
            }
            bitvecLshift(h, v, i);
            gf2fieldAdd(u, u, h);
            bitvecLshift(h, g, i);
            gf2fieldAdd(z, z, h);
        }
    }

    /* ---------------- point arithmetic ---------------- */

    private static void gf2pointCopy(final int[] x1, final int[] y1, final int[] x2, final int[] y2) {
        bitvecCopy(x1, x2);
        bitvecCopy(y1, y2);
    }

    private static void gf2pointSetZero(final int[] x, final int[] y) {
        bitvecSetZero(x);
        bitvecSetZero(y);
    }

    private static boolean gf2pointIsZero(final int[] x, final int[] y) {
        return bitvecIsZero(x) && bitvecIsZero(y);
    }

    private static void gf2pointDouble(final int[] x, final int[] y) {
        if (bitvecIsZero(x)) {
            bitvecSetZero(y);
            return;
        }
        final int[] l = new int[BITVEC_NWORDS];
        gf2fieldInv(l, x);
        gf2fieldMul(l, l, y);
        gf2fieldAdd(l, l, x);
        gf2fieldMul(y, x, x);
        gf2fieldMul(x, l, l);
        gf2fieldInc(l); // coeff_a == 1 for B-163
        gf2fieldAdd(x, x, l);
        gf2fieldMul(l, l, x);
        gf2fieldAdd(y, y, l);
    }

    private static void gf2pointAdd(final int[] x1, final int[] y1, final int[] x2, final int[] y2) {
        if (gf2pointIsZero(x2, y2)) {
            return;
        }
        if (gf2pointIsZero(x1, y1)) {
            gf2pointCopy(x1, y1, x2, y2);
            return;
        }
        if (bitvecEqual(x1, x2)) {
            if (bitvecEqual(y1, y2)) {
                gf2pointDouble(x1, y1);
            } else {
                gf2pointSetZero(x1, y1);
            }
            return;
        }

        final int[] a = new int[BITVEC_NWORDS];
        final int[] b = new int[BITVEC_NWORDS];
        final int[] c = new int[BITVEC_NWORDS];
        final int[] d = new int[BITVEC_NWORDS];

        gf2fieldAdd(a, y1, y2);
        gf2fieldAdd(b, x1, x2);
        gf2fieldInv(c, b);
        gf2fieldMul(c, c, a);
        gf2fieldMul(d, c, c);
        gf2fieldAdd(d, d, c);
        gf2fieldAdd(d, d, b);
        gf2fieldInc(d); // coeff_a == 1
        gf2fieldAdd(x1, x1, d);
        gf2fieldMul(a, x1, c);
        gf2fieldAdd(a, a, d);
        gf2fieldAdd(y1, y1, a);
        bitvecCopy(x1, d);
    }

    /** Double-and-add. Not constant-time, as upstream. */
    private static void gf2pointMul(final int[] x, final int[] y, final int[] exp) {
        final int[] tmpx = new int[BITVEC_NWORDS];
        final int[] tmpy = new int[BITVEC_NWORDS];
        final int nbits = bitvecDegree(exp);

        gf2pointSetZero(tmpx, tmpy);
        for (int i = nbits - 1; i >= 0; i--) {
            gf2pointDouble(tmpx, tmpy);
            if (bitvecGetBit(exp, i) != 0) {
                gf2pointAdd(tmpx, tmpy, x, y);
            }
        }
        gf2pointCopy(x, y, tmpx, tmpy);
    }

    /** y^2 + x*y == x^3 + a*x^2 + b */
    private static boolean gf2pointOnCurve(final int[] x, final int[] y) {
        if (gf2pointIsZero(x, y)) {
            return true;
        }
        final int[] a = new int[BITVEC_NWORDS];
        final int[] b = new int[BITVEC_NWORDS];

        gf2fieldMul(a, x, x);
        gf2fieldMul(b, a, x); // coeff_a == 1
        gf2fieldAdd(a, a, b);
        gf2fieldAdd(a, a, COEFF_B);
        gf2fieldMul(b, y, y);
        gf2fieldAdd(a, a, b);
        gf2fieldMul(b, x, y);

        return bitvecEqual(a, b);
    }

    /* ---------------- byte conversion ---------------- */

    /**
     * Little-endian, four bytes per word. The C original cast the buffer
     * straight to uint32_t*, so its wire format is whatever the host's byte
     * order happened to be. Every device involved here is little-endian, and
     * writing it out explicitly is what keeps that from being an accident.
     */
    private static int[] bytesToInts(final byte[] bytes, final int offset) {
        final int[] value = new int[BITVEC_NWORDS];
        int p = offset;
        for (int i = 0; i < BITVEC_NWORDS; i++) {
            value[i] = (bytes[p++] & 0xff)
                    | ((bytes[p++] & 0xff) << 8)
                    | ((bytes[p++] & 0xff) << 16)
                    | ((bytes[p++] & 0xff) << 24);
        }
        return value;
    }

    private static void intsToBytes(final byte[] bytes, final int[] ints, final int offset) {
        int p = offset;
        for (int i = 0; i < BITVEC_NWORDS; i++) {
            bytes[p++] = (byte) (ints[i] & 0xff);
            bytes[p++] = (byte) ((ints[i] >>> 8) & 0xff);
            bytes[p++] = (byte) ((ints[i] >>> 16) & 0xff);
            bytes[p++] = (byte) ((ints[i] >>> 24) & 0xff);
        }
    }

    /**
     * Reduce a scalar to 1 <= exp < n by clearing everything above the order's
     * top bit.
     *
     * The C did this inside key generation only, mutating the caller's buffer so
     * that the shared-secret step later received an already-reduced key. Java
     * converts to a word array instead of aliasing the bytes, so that side
     * effect does not happen and the reduction has to be applied on both paths.
     * Reducing on one path only yields a public key and a shared secret derived
     * from two different scalars, which fails auth with no other symptom.
     */
    private static void reduceScalar(final int[] scalar) {
        final int nbits = bitvecDegree(BASE_ORDER);
        for (int i = nbits - 1; i < BITVEC_NWORDS * 32; i++) {
            bitvecClrBit(scalar, i);
        }
    }

    /* ---------------- public API ---------------- */

    /**
     * @param privateKey 24 bytes of random data
     * @return the 48-byte public key, or null if the private key is too small to use
     */
    static byte[] publicKey(final byte[] privateKey) {
        if (privateKey.length != PRIVATE_KEY_SIZE) {
            throw new IllegalArgumentException("private key must be " + PRIVATE_KEY_SIZE + " bytes");
        }
        final int[] priv = bytesToInts(privateKey, 0);
        if (bitvecDegree(priv) < CURVE_DEGREE / 2) {
            return null;
        }
        reduceScalar(priv);

        final int[] px = new int[BITVEC_NWORDS];
        final int[] py = new int[BITVEC_NWORDS];
        gf2pointCopy(px, py, BASE_X, BASE_Y);
        gf2pointMul(px, py, priv);

        final byte[] out = new byte[PUBLIC_KEY_SIZE];
        intsToBytes(out, px, 0);
        intsToBytes(out, py, BITVEC_NBYTES);
        return out;
    }

    /**
     * @return the 48-byte shared point, or null if the peer's public key is not
     *         a valid point on the curve
     */
    static byte[] sharedSecret(final byte[] privateKey, final byte[] othersPublic) {
        if (privateKey.length != PRIVATE_KEY_SIZE) {
            throw new IllegalArgumentException("private key must be " + PRIVATE_KEY_SIZE + " bytes");
        }
        if (othersPublic.length != PUBLIC_KEY_SIZE) {
            throw new IllegalArgumentException("public key must be " + PUBLIC_KEY_SIZE + " bytes");
        }
        final int[] qx = bytesToInts(othersPublic, 0);
        final int[] qy = bytesToInts(othersPublic, BITVEC_NBYTES);

        // Rejecting an off-curve point is not a formality: accepting one is the
        // classic invalid-curve attack, where a chosen bad point leaks the
        // private scalar through the resulting "shared" secret.
        if (gf2pointIsZero(qx, qy) || !gf2pointOnCurve(qx, qy)) {
            return null;
        }

        final int[] priv = bytesToInts(privateKey, 0);
        reduceScalar(priv);
        gf2pointMul(qx, qy, priv);

        final byte[] out = new byte[PUBLIC_KEY_SIZE];
        intsToBytes(out, qx, 0);
        intsToBytes(out, qy, BITVEC_NBYTES);
        return out;
    }
}
