package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * Round-trip tests for the chunked framing.
 *
 * A framing bug shows up on the wire as a message the band silently ignores,
 * which looks exactly like misunderstanding the protocol. Testing encode against
 * decode catches the whole class of length, offset and header-size errors before
 * any of that reaches hardware.
 */
public class ChunkedCodecTest {

    private static final short ENDPOINT_AUTH = (short) 0x0082;
    private static final int MTU = 247;

    /** Captures the payload the decoder reassembles, so a test can assert on it. */
    private static final class Sink implements ChunkedCodec.Decoder.Handler {
        Short endpoint;
        byte[] data;
        int messages;

        @Override
        public void payload(final short endpoint, final byte[] data) {
            this.endpoint = endpoint;
            this.data = data;
            this.messages++;
        }
    }

    private static byte[] pattern(final int length) {
        final byte[] b = new byte[length];
        for (int i = 0; i < length; i++) {
            b[i] = (byte) (i * 31 + 7);
        }
        return b;
    }

    private static List<byte[]> encode(final ChunkedCodec.Encoder encoder,
                                       final short endpoint,
                                       final byte[] payload,
                                       final boolean encrypt) {
        final List<byte[]> frames = new ArrayList<>();
        encoder.write(frames::add, endpoint, payload, encrypt);
        return frames;
    }

    private static boolean feed(final ChunkedCodec.Decoder decoder, final List<byte[]> frames) {
        boolean needsAck = false;
        for (final byte[] frame : frames) {
            needsAck = decoder.decode(frame);
        }
        return needsAck;
    }

    @Test
    public void roundTripsAMessageThatFitsInOneFrame() {
        final Sink sink = new Sink();
        final byte[] payload = pattern(20);

        final List<byte[]> frames = encode(new ChunkedCodec.Encoder(MTU), ENDPOINT_AUTH, payload, false);
        assertEquals(1, frames.size());

        final boolean needsAck = feed(new ChunkedCodec.Decoder(sink), frames);

        assertEquals(1, sink.messages);
        assertEquals(ENDPOINT_AUTH, (short) sink.endpoint);
        assertArrayEquals(payload, sink.data);
        assertTrue("last fragment must request an ack", needsAck);
    }

    /**
     * The 52-byte public key command is the real first message of the handshake,
     * so it is worth asserting it stays a single frame at the negotiated MTU.
     */
    @Test
    public void publicKeyCommandFitsInOneFrameAtNegotiatedMtu() {
        final byte[] pubKeyCommand = pattern(52);
        assertEquals(1, encode(new ChunkedCodec.Encoder(MTU), ENDPOINT_AUTH, pubKeyCommand, false).size());
    }

    @Test
    public void roundTripsAMessageSpanningManyFrames() {
        final Sink sink = new Sink();
        final byte[] payload = pattern(1000);

        final List<byte[]> frames = encode(new ChunkedCodec.Encoder(MTU), ENDPOINT_AUTH, payload, false);
        assertTrue("payload should need several frames, got " + frames.size(), frames.size() > 3);

        feed(new ChunkedCodec.Decoder(sink), frames);
        assertArrayEquals(payload, sink.data);
    }

    /** The smallest MTU the spec permits, where header overhead dominates. */
    @Test
    public void roundTripsAtTheMinimumMtu() {
        final Sink sink = new Sink();
        final byte[] payload = pattern(300);

        final List<byte[]> frames = encode(new ChunkedCodec.Encoder(23), ENDPOINT_AUTH, payload, false);
        feed(new ChunkedCodec.Decoder(sink), frames);

        assertArrayEquals(payload, sink.data);
    }

    @Test
    public void roundTripsAnEncryptedMessage() {
        final Sink sink = new Sink();
        final byte[] sessionKey = pattern(16);
        final byte[] payload = pattern(64);

        final ChunkedCodec.Encoder encoder = new ChunkedCodec.Encoder(MTU);
        encoder.setEncryptionParameters(1, sessionKey);
        final List<byte[]> frames = encode(encoder, (short) 0x0010, payload, true);

        final ChunkedCodec.Decoder decoder = new ChunkedCodec.Decoder(sink);
        decoder.setSessionKey(sessionKey);
        feed(decoder, frames);

        // Padding to an AES block must not leak into the delivered payload.
        assertArrayEquals(payload, sink.data);
        assertEquals((short) 0x0010, (short) sink.endpoint);
    }

    /**
     * Each message masks the session key with its own handle, so a message
     * decoded under the wrong handle must not silently yield plausible bytes.
     */
    @Test
    public void encryptedMessagesUseADifferentKeyPerHandle() {
        final byte[] sessionKey = pattern(16);
        final ChunkedCodec.Encoder encoder = new ChunkedCodec.Encoder(MTU);
        encoder.setEncryptionParameters(0, sessionKey);

        final byte[] payload = pattern(32);
        final List<byte[]> first = encode(encoder, (short) 0x0010, payload, true);
        final List<byte[]> second = encode(encoder, (short) 0x0010, payload, true);

        final byte[] firstBody = tail(first.get(0), 11);
        final byte[] secondBody = tail(second.get(0), 11);
        assertFalse("identical ciphertext would mean the handle is not in the key",
                java.util.Arrays.equals(firstBody, secondBody));
    }

    private static byte[] tail(final byte[] frame, final int from) {
        final byte[] out = new byte[frame.length - from];
        System.arraycopy(frame, from, out, 0, out.length);
        return out;
    }

    @Test
    public void firstFrameCarriesTheHeaderTheProtocolExpects() {
        final List<byte[]> frames = encode(new ChunkedCodec.Encoder(MTU), ENDPOINT_AUTH, pattern(10), false);
        final byte[] frame = frames.get(0);

        assertEquals("frames start with 0x03", 0x03, frame[0]);
        assertEquals("first, last and needs-ack", 0x07, frame[1] & 0x0f);
        assertEquals("extended header byte is reserved", 0x00, frame[2]);
        assertEquals("handles start at one", 0x01, frame[3]);
        assertEquals("fragment counter starts at zero", 0x00, frame[4]);
        assertEquals("declared length, low byte", 10, frame[5]);
        assertEquals("endpoint, low byte", (byte) 0x82, frame[9]);
        assertEquals("endpoint, high byte", (byte) 0x00, frame[10]);
    }

    @Test
    public void ignoresFramesThatAreNotChunkedTransfer() {
        final Sink sink = new Sink();
        final ChunkedCodec.Decoder decoder = new ChunkedCodec.Decoder(sink);

        assertFalse(decoder.decode(new byte[]{0x04, 0x00, 0x01, 0x01, 0x00}));
        assertEquals(0, sink.messages);
        assertNull(sink.data);
    }

    @Test
    public void ignoresAContinuationWithNoBeginning() {
        final Sink sink = new Sink();
        final ChunkedCodec.Decoder decoder = new ChunkedCodec.Decoder(sink);

        final List<byte[]> frames = encode(new ChunkedCodec.Encoder(23), ENDPOINT_AUTH, pattern(300), false);
        // Skip the opening frame, as would happen joining a transfer late.
        assertFalse(decoder.decode(frames.get(1)));
        assertEquals(0, sink.messages);
    }

    @Test
    public void ackFrameMatchesTheExpectedShape() {
        assertArrayEquals(new byte[]{0x04, 0x00, 0x07, 0x01, 0x03},
                ChunkedCodec.ackFrame((byte) 0x07, (byte) 0x03));
    }

    @Test
    public void chunkSizeRespectsTheAttributeHeaderAndSpecBounds() {
        assertEquals(244, ChunkedCodec.maxWriteChunk(247));
        assertEquals(20, ChunkedCodec.maxWriteChunk(23));
        assertEquals("MTU below the spec minimum is floored", 20, ChunkedCodec.maxWriteChunk(10));
        assertEquals("attribute length is capped", 512, ChunkedCodec.maxWriteChunk(1000));
    }
}
