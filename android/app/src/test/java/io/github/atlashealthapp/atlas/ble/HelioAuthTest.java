package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * The handshake's terminal behaviour.
 *
 * Android delivers a notification to every GATT client an app holds open on a
 * device, so a link that is still connected receives handshake frames belonging
 * to a newer link. On 2026-07-28 that produced two proofs for one exchange: the
 * band accepted the real one and rejected the stale link's, and the stale link
 * had meanwhile replaced its own working session key with one derived from an
 * exchange it was not part of. One handshake per instance is the invariant that
 * makes that impossible, and it is only worth anything if it is enforced here,
 * where the state machine lives.
 */
public class HelioAuthTest {

    private static final byte RESPONSE = 0x10;
    private static final byte CMD_PUB_KEY = 0x04;
    private static final byte CMD_SESSION_KEY = 0x05;
    private static final byte SUCCESS = 0x01;

    /** Records everything the handshake tries to do, so a test can count it. */
    private static final class FakeTransport implements HelioAuth.Transport {
        final List<byte[]> sent = new ArrayList<>();
        final List<String> results = new ArrayList<>();
        int sessionsEstablished;
        byte[] lastSessionKey;

        @Override
        public void send(final short endpoint, final byte[] payload, final boolean encrypt) {
            sent.add(payload);
        }

        @Override
        public void onSessionEstablished(final int sequenceNumber, final byte[] sessionKey) {
            sessionsEstablished++;
            lastSessionKey = sessionKey;
        }

        @Override
        public void onAuthResult(final boolean success, final String detail) {
            results.add(success + ":" + detail);
        }

        @Override
        public void log(final String message) {
        }
    }

    private static byte[] authKey() {
        final byte[] key = new byte[16];
        for (int i = 0; i < key.length; i++) {
            key[i] = (byte) (i * 17 + 3);
        }
        return key;
    }

    /**
     * A real curve point, not a pattern: the handshake rejects anything that is
     * not on the curve, so a made-up 48 bytes would fail for the wrong reason.
     */
    private static byte[] bandPublicKey(final int seed) {
        final byte[] priv = new byte[EcdhB163.PRIVATE_KEY_SIZE];
        for (int i = 0; i < priv.length; i++) {
            priv[i] = (byte) (i * 13 + seed);
        }
        final byte[] pub = EcdhB163.publicKey(priv);
        assertNotNull("test fixture needs a valid curve point", pub);
        return pub;
    }

    private static byte[] publicKeyResponse(final int seed) {
        final byte[] pub = bandPublicKey(seed);
        final byte[] payload = new byte[3 + 16 + EcdhB163.PUBLIC_KEY_SIZE];
        payload[0] = RESPONSE;
        payload[1] = CMD_PUB_KEY;
        payload[2] = SUCCESS;
        for (int i = 0; i < 16; i++) {
            payload[3 + i] = (byte) (i * 7 + 1);
        }
        System.arraycopy(pub, 0, payload, 3 + 16, pub.length);
        return payload;
    }

    private static byte[] sessionKeyResponse(final byte status) {
        return new byte[]{RESPONSE, CMD_SESSION_KEY, status};
    }

    @Test
    public void completesANormalHandshake() {
        final FakeTransport transport = new FakeTransport();
        final HelioAuth auth = new HelioAuth(transport, authKey());

        auth.start();
        auth.handle(publicKeyResponse(1));
        auth.handle(sessionKeyResponse(SUCCESS));

        // the public key, then the double-encrypted random
        assertEquals(2, transport.sent.size());
        assertEquals(1, transport.sessionsEstablished);
        assertEquals(1, transport.results.size());
        assertTrue(transport.results.get(0).startsWith("true:"));
    }

    /**
     * The exact 2026-07-28 failure: a second exchange, belonging to a different
     * link, arriving on an instance that has already authenticated.
     */
    @Test
    public void ignoresASecondExchangeAfterAuthenticating() {
        final FakeTransport transport = new FakeTransport();
        final HelioAuth auth = new HelioAuth(transport, authKey());

        auth.start();
        auth.handle(publicKeyResponse(1));
        auth.handle(sessionKeyResponse(SUCCESS));

        final byte[] established = transport.lastSessionKey;
        auth.handle(publicKeyResponse(2));

        // No second proof on the wire, so the band has nothing to reject…
        assertEquals(2, transport.sent.size());
        // …and, just as important, the key the codec is already using stands.
        assertEquals(1, transport.sessionsEstablished);
        assertEquals(established, transport.lastSessionKey);
        assertEquals(1, transport.results.size());
    }

    /** A failed handshake is just as terminal: retrying is the caller's job, on a fresh link. */
    @Test
    public void ignoresAnythingFollowingARejection() {
        final FakeTransport transport = new FakeTransport();
        final HelioAuth auth = new HelioAuth(transport, authKey());

        auth.start();
        auth.handle(publicKeyResponse(1));
        auth.handle(sessionKeyResponse((byte) 0x26));

        assertEquals(1, transport.results.size());
        assertTrue(transport.results.get(0).startsWith("false:"));

        auth.handle(publicKeyResponse(2));
        auth.handle(sessionKeyResponse(SUCCESS));

        assertEquals(2, transport.sent.size());
        assertEquals(1, transport.sessionsEstablished);
        assertEquals(1, transport.results.size());
    }
}
