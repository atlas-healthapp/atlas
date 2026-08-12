package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The expected values below are not self-generated. They were produced by
 * compiling Gadgetbridge's own ECDH_B163 (a separate, independently written port
 * of the same public-domain C, and the implementation that demonstrably
 * authenticates against real Huami hardware) and running it on these exact
 * inputs.
 *
 * That distinction is the whole point. A self-consistency test, where two of our
 * own keypairs derive the same shared secret, passes just as happily with the
 * wrong curve, the wrong byte order, or a scalar reduced on one path only. All
 * three of those fail on the wire as an indistinguishable "authentication
 * rejected". Only a known-answer test against a working implementation catches
 * them, and the byte order in particular is the failure this spike was most
 * exposed to.
 */
public class EcdhB163Test {

    /** Arbitrary but fixed, matching the generator used against Gadgetbridge's port. */
    private static byte[] fill(final int seed) {
        final byte[] k = new byte[24];
        for (int i = 0; i < 24; i++) {
            k[i] = (byte) (seed * 31 + i * 7 + 1);
        }
        return k;
    }

    private static byte[] hex(final String s) {
        final byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static String hex(final byte[] b) {
        final StringBuilder s = new StringBuilder();
        for (final byte x : b) {
            s.append(String.format("%02x", x));
        }
        return s.toString();
    }

    private static final byte[] PRIV_A = fill(3);
    private static final byte[] PRIV_B = fill(11);

    private static final String PUB_A =
            "255dfdfbb242095437221d8546338123c659c14707000000"
                    + "070bdce6ee522af68282d7499094e2c01b7eebcf03000000";
    private static final String PUB_B =
            "d73b220424861171c31cbd289dda66ede6c1828406000000"
                    + "d2c45e63736412e10f677c422d4afe61913c99ef07000000";
    private static final String SHARED =
            "c927ab97da43aae5d0dd5f3850a31ab58bd7ca5800000000"
                    + "42757b7e5ad13a050e4194dc1ca7867a53d1ea0003000000";

    @Test
    public void publicKeyMatchesReferenceImplementation() {
        assertEquals(PUB_A, hex(EcdhB163.publicKey(PRIV_A)));
        assertEquals(PUB_B, hex(EcdhB163.publicKey(PRIV_B)));
    }

    @Test
    public void sharedSecretMatchesReferenceImplementation() {
        assertEquals(SHARED, hex(EcdhB163.sharedSecret(PRIV_A, hex(PUB_B))));
    }

    /** Both sides must land on the same secret, which is the point of the exchange. */
    @Test
    public void sharedSecretIsSymmetric() {
        final byte[] ab = EcdhB163.sharedSecret(PRIV_A, EcdhB163.publicKey(PRIV_B));
        final byte[] ba = EcdhB163.sharedSecret(PRIV_B, EcdhB163.publicKey(PRIV_A));
        assertNotNull(ab);
        assertArrayEquals(ab, ba);
    }

    @Test
    public void keySizesAreWhatTheProtocolExpects() {
        assertEquals(24, EcdhB163.PRIVATE_KEY_SIZE);
        assertEquals(48, EcdhB163.PUBLIC_KEY_SIZE);
        assertEquals(48, EcdhB163.publicKey(PRIV_A).length);
    }

    @Test
    public void rejectsPublicKeyThatIsNotOnTheCurve() {
        final byte[] mangled = hex(PUB_B);
        mangled[0] ^= 0x01;
        assertNull(EcdhB163.sharedSecret(PRIV_A, mangled));
    }

    @Test
    public void rejectsPointAtInfinity() {
        assertNull(EcdhB163.sharedSecret(PRIV_A, new byte[48]));
    }

    /**
     * Upstream refuses to generate from a scalar with too few significant bits,
     * since a tiny private key makes the discrete log tractable.
     */
    @Test
    public void rejectsPrivateKeyWithTooFewBits() {
        final byte[] tiny = new byte[24];
        tiny[0] = 1;
        assertNull(EcdhB163.publicKey(tiny));
    }
}
