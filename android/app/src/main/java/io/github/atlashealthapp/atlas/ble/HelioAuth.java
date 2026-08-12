package io.github.atlashealthapp.atlas.ble;

import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/**
 * The ZeppOS authentication handshake, on endpoint 0x0082.
 *
 * <pre>
 * -&gt; 0x04 0x02 0x00 0x02 + our 48-byte public key
 * &lt;- 0x10 0x04 ok + band's 16-byte random + band's 48-byte public key
 *      shared        = ecdh(ourPrivate, bandPublic)
 *      sessionKey[i] = shared[i+8] XOR authKey[i]
 *      sequenceNr    = LE32(shared[0..4])
 * -&gt; 0x05 + AES-ECB(random, authKey) + AES-ECB(random, sessionKey)
 * &lt;- 0x10 0x05 0x01  authenticated
 * &lt;- 0x10 0x05 0x25  wrong auth key
 * </pre>
 *
 * Encrypting the band's random twice, once under the long-term key and once
 * under the freshly derived session key, is what proves both sides independently:
 * the first shows we hold the pairing secret, the second that we derived the same
 * session key from the exchange.
 *
 * The handshake itself is sent unencrypted, necessarily, since it is what
 * establishes the key that everything afterwards is encrypted with.
 */
final class HelioAuth {

    static final short ENDPOINT = (short) 0x0082;

    private static final byte RESPONSE = 0x10;
    private static final byte SUCCESS = 0x01;
    /** A distinct status, and the most useful failure this spike can get: the key is stale. */
    private static final byte STATUS_WRONG_AUTH_KEY = 0x25;

    private static final byte CMD_PUB_KEY = 0x04;
    private static final byte CMD_SESSION_KEY = 0x05;

    private static final int RANDOM_SIZE = 16;

    interface Transport {
        void send(short endpoint, byte[] payload, boolean encrypt);

        /** Hand the derived parameters to the codec before any encrypted traffic. */
        void onSessionEstablished(int sequenceNumber, byte[] sessionKey);

        void onAuthResult(boolean success, String detail);

        void log(String message);
    }

    private final Transport transport;
    private final byte[] authKey;
    private final byte[] privateKey = new byte[EcdhB163.PRIVATE_KEY_SIZE];
    /**
     * One handshake per instance, enforced rather than assumed.
     *
     * Android delivers a notification to every GATT client the app has open on a
     * device, so a link that is still connected sees handshake traffic belonging
     * to a different, newer link. Without this, that traffic is processed as if it
     * were our own: a session key gets derived from someone else's exchange (which
     * silently replaces the working one on the codec) and a proof goes back that
     * the band correctly rejects, as status 0x02 or 0x26. Observed on 2026-07-28.
     */
    private boolean finished;

    HelioAuth(final Transport transport, final byte[] authKey) {
        if (authKey == null || authKey.length != 16) {
            throw new IllegalArgumentException("auth key must be 16 bytes");
        }
        this.transport = transport;
        this.authKey = authKey;
    }

    void start() {
        final SecureRandom random = new SecureRandom();
        byte[] publicKey = null;
        // publicKey() refuses a scalar with too few significant bits. That is
        // vanishingly rare from a CSPRNG, but retrying is cheaper than reasoning
        // about how rare, and an unchecked null here would surface much later.
        for (int attempt = 0; attempt < 8 && publicKey == null; attempt++) {
            random.nextBytes(privateKey);
            publicKey = EcdhB163.publicKey(privateKey);
        }
        if (publicKey == null) {
            finish(false, "could not generate a usable key pair");
            return;
        }

        final byte[] command = new byte[4 + EcdhB163.PUBLIC_KEY_SIZE];
        command[0] = CMD_PUB_KEY;
        command[1] = 0x02;
        command[2] = 0x00;
        command[3] = 0x02;
        System.arraycopy(publicKey, 0, command, 4, EcdhB163.PUBLIC_KEY_SIZE);

        transport.log("auth: sending public key");
        transport.send(ENDPOINT, command, false);
    }

    /** Terminal, in both directions: nothing is processed after a result is reported. */
    private void finish(final boolean success, final String detail) {
        finished = true;
        transport.onAuthResult(success, detail);
    }

    void handle(final byte[] payload) {
        if (finished) {
            transport.log("auth: ignoring a handshake frame, this link is already done");
            return;
        }
        if (payload.length < 3 || payload[0] != RESPONSE) {
            transport.log("auth: ignoring non-response " + hex(payload[0]));
            return;
        }

        switch (payload[1]) {
            case CMD_PUB_KEY:
                handlePublicKeyResponse(payload);
                return;
            case CMD_SESSION_KEY:
                handleSessionKeyResponse(payload);
                return;
            default:
                transport.log("auth: unknown command " + hex(payload[1]));
        }
    }

    private void handlePublicKeyResponse(final byte[] payload) {
        if (payload[2] != SUCCESS) {
            finish(false, "band rejected our public key, status " + hex(payload[2]));
            return;
        }
        final int expected = 3 + RANDOM_SIZE + EcdhB163.PUBLIC_KEY_SIZE;
        if (payload.length < expected) {
            finish(false, "short public key response, " + payload.length + " bytes");
            return;
        }

        final byte[] remoteRandom = new byte[RANDOM_SIZE];
        final byte[] remotePublic = new byte[EcdhB163.PUBLIC_KEY_SIZE];
        System.arraycopy(payload, 3, remoteRandom, 0, RANDOM_SIZE);
        System.arraycopy(payload, 3 + RANDOM_SIZE, remotePublic, 0, EcdhB163.PUBLIC_KEY_SIZE);

        final byte[] shared = EcdhB163.sharedSecret(privateKey, remotePublic);
        if (shared == null) {
            finish(false, "band's public key is not a valid curve point");
            return;
        }

        final int sequenceNumber = (shared[0] & 0xff)
                | ((shared[1] & 0xff) << 8)
                | ((shared[2] & 0xff) << 16)
                | ((shared[3] & 0xff) << 24);

        // Bytes 8..24 of the shared point, not 0..16: the first four are already
        // spoken for as the sequence number.
        final byte[] sessionKey = new byte[16];
        for (int i = 0; i < 16; i++) {
            sessionKey[i] = (byte) (shared[i + 8] ^ authKey[i]);
        }

        transport.log("auth: derived session key");
        transport.onSessionEstablished(sequenceNumber, sessionKey);

        try {
            final byte[] underAuthKey = encrypt(remoteRandom, authKey);
            final byte[] underSessionKey = encrypt(remoteRandom, sessionKey);
            final byte[] command = new byte[1 + 32];
            command[0] = CMD_SESSION_KEY;
            System.arraycopy(underAuthKey, 0, command, 1, 16);
            System.arraycopy(underSessionKey, 0, command, 17, 16);

            transport.log("auth: sending double-encrypted random");
            transport.send(ENDPOINT, command, false);
        } catch (final Exception e) {
            finish(false, "AES failed: " + e.getMessage());
        }
    }

    private void handleSessionKeyResponse(final byte[] payload) {
        if (payload[2] == STATUS_WRONG_AUTH_KEY) {
            finish(false, "wrong auth key (0x25) - the stored key is stale");
            return;
        }
        if (payload[2] != SUCCESS) {
            finish(false, "session key rejected, status " + hex(payload[2]));
            return;
        }
        finish(true, "authenticated");
    }

    private static byte[] encrypt(final byte[] value, final byte[] key) throws Exception {
        final Cipher cipher = Cipher.getInstance("AES/ECB/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"));
        return cipher.doFinal(value);
    }

    private static String hex(final byte b) {
        return String.format("0x%02x", b);
    }
}
