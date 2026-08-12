package io.github.atlashealthapp.atlas.ble;

import java.nio.ByteBuffer;
import java.util.zip.CRC32;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/**
 * The Huami 2021 chunked transfer framing used by ZeppOS devices.
 *
 * Messages are addressed to a 16-bit endpoint (authentication is 0x0082) and
 * split across BLE writes that the MTU can carry. Every frame starts 0x03 and
 * carries flags, a per-message handle and a fragment counter; the first fragment
 * additionally carries the total length and the endpoint.
 *
 * Encryption is per-message rather than per-session: the key is the session key
 * XORed with the message handle, and the plaintext gets a sequence number and a
 * CRC32 appended before padding to an AES block. Authentication runs
 * unencrypted, for the obvious reason that it is what establishes the session
 * key in the first place.
 *
 * Pure logic, no Android dependencies, so it can be tested on the JVM. That
 * matters: framing bugs surface on the wire as a silently ignored message, which
 * is nearly impossible to tell apart from a protocol misunderstanding.
 */
final class ChunkedCodec {

    private static final byte FRAME_CHUNKED = 0x03;
    private static final byte FLAG_FIRST = 0x01;
    private static final byte FLAG_LAST = 0x02;
    private static final byte FLAG_NEEDS_ACK = 0x04;
    private static final byte FLAG_ENCRYPTED = 0x08;

    /** ZeppOS always uses the extended header, which adds one reserved byte. */
    private static final int EXTENDED_HEADER_EXTRA = 1;

    private ChunkedCodec() {
    }

    /**
     * Usable payload per write. Three bytes of the MTU go to the ATT write
     * header, and the spec floors the MTU at 23 and caps an attribute at 512.
     */
    static int maxWriteChunk(final int mtu) {
        return Math.min(512, Math.max(23, mtu) - 3);
    }

    private static byte[] aes(final int mode, final byte[] data, final byte[] key) throws Exception {
        final Cipher cipher = Cipher.getInstance("AES/ECB/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"));
        return cipher.doFinal(data);
    }

    /** The session key masked by the message handle. Both directions derive it the same way. */
    private static byte[] messageKey(final byte[] sessionKey, final byte handle) {
        final byte[] key = new byte[16];
        for (int i = 0; i < 16; i++) {
            key[i] = (byte) (sessionKey[i] ^ handle);
        }
        return key;
    }

    static int crc32(final byte[] data, final int offset, final int length) {
        final CRC32 crc = new CRC32();
        crc.update(data, offset, length);
        return (int) crc.getValue();
    }

    /** Acknowledges a completed inbound message. Note this goes to 0x0017, not the write characteristic. */
    static byte[] ackFrame(final byte handle, final byte count) {
        return new byte[]{0x04, 0x00, handle, 0x01, count};
    }

    interface ChunkSink {
        void chunk(byte[] frame);
    }

    static final class Encoder {
        private int mtu;
        private byte writeHandle;
        private int encryptedSequenceNr;
        private byte[] sessionKey;

        Encoder(final int mtu) {
            this.mtu = mtu;
        }

        void setMtu(final int mtu) {
            this.mtu = mtu;
        }

        void setEncryptionParameters(final int sequenceNr, final byte[] sessionKey) {
            this.encryptedSequenceNr = sequenceNr;
            this.sessionKey = sessionKey;
        }

        void reset() {
            writeHandle = 0;
            encryptedSequenceNr = 0;
        }

        void write(final ChunkSink sink, final short endpoint, final byte[] data, final boolean encrypt) {
            if (encrypt && sessionKey == null) {
                throw new IllegalStateException("cannot encrypt before the session key exists");
            }

            writeHandle++;

            final int length = data.length;
            byte[] toSend = data;

            if (encrypt) {
                // Sequence number and CRC go inside the encrypted region, then
                // the whole thing is padded up to an AES block. The declared
                // length in the header stays the *plaintext* length; the receiver
                // recomputes the padded size the same way.
                int encryptedLength = length + 8;
                final int overflow = encryptedLength % 16;
                if (overflow > 0) {
                    encryptedLength += 16 - overflow;
                }
                final byte[] payload = new byte[encryptedLength];
                System.arraycopy(data, 0, payload, 0, length);
                writeInt32(payload, length, encryptedSequenceNr);
                encryptedSequenceNr++;
                writeInt32(payload, length + 4, crc32(payload, 0, length + 4));
                try {
                    toSend = aes(Cipher.ENCRYPT_MODE, payload, messageKey(sessionKey, writeHandle));
                } catch (final Exception e) {
                    throw new IllegalStateException("chunk encryption failed", e);
                }
            }

            int remaining = toSend.length;
            byte count = 0;
            int headerSize = 10 + EXTENDED_HEADER_EXTRA;

            while (remaining > 0) {
                final int maxChunk = maxWriteChunk(mtu) - headerSize;
                final int copyBytes = Math.min(remaining, maxChunk);
                final byte[] chunk = new byte[copyBytes + headerSize];

                byte flags = 0;
                if (encrypt) {
                    flags |= FLAG_ENCRYPTED;
                }
                if (count == 0) {
                    flags |= FLAG_FIRST;
                    int i = 4 + EXTENDED_HEADER_EXTRA;
                    writeInt32(chunk, i, length);
                    i += 4;
                    chunk[i++] = (byte) (endpoint & 0xff);
                    chunk[i] = (byte) ((endpoint >> 8) & 0xff);
                }
                if (remaining <= maxChunk) {
                    flags |= FLAG_LAST;
                    flags |= FLAG_NEEDS_ACK;
                }

                chunk[0] = FRAME_CHUNKED;
                chunk[1] = flags;
                chunk[2] = 0; // extended header, reserved
                chunk[3] = writeHandle;
                chunk[4] = count;

                System.arraycopy(toSend, toSend.length - remaining, chunk, headerSize, copyBytes);
                sink.chunk(chunk);

                remaining -= copyBytes;
                headerSize = 4 + EXTENDED_HEADER_EXTRA;
                count++;
            }
        }

        private static void writeInt32(final byte[] buf, final int offset, final int value) {
            buf[offset] = (byte) (value & 0xff);
            buf[offset + 1] = (byte) ((value >> 8) & 0xff);
            buf[offset + 2] = (byte) ((value >> 16) & 0xff);
            buf[offset + 3] = (byte) ((value >> 24) & 0xff);
        }
    }

    static final class Decoder {
        interface Handler {
            void payload(short endpoint, byte[] data);
        }

        private final Handler handler;
        private byte[] sessionKey;

        private ByteBuffer reassembly;
        private Byte currentHandle;
        private int currentEndpoint;
        private int currentLength;
        private byte lastHandle;
        private byte lastCount;

        Decoder(final Handler handler) {
            this.handler = handler;
        }

        void setSessionKey(final byte[] sessionKey) {
            this.sessionKey = sessionKey;
        }

        byte lastHandle() {
            return lastHandle;
        }

        byte lastCount() {
            return lastCount;
        }

        void reset() {
            currentHandle = null;
            currentEndpoint = 0;
            reassembly = null;
        }

        /** @return true when the sender expects an ack for the message just completed */
        boolean decode(final byte[] data) {
            int i = 0;
            if (data.length < 5 || data[i++] != FRAME_CHUNKED) {
                return false;
            }
            final byte flags = data[i++];
            final boolean encrypted = (flags & FLAG_ENCRYPTED) != 0;
            final boolean firstChunk = (flags & FLAG_FIRST) != 0;
            final boolean lastChunk = (flags & FLAG_LAST) != 0;
            final boolean needsAck = (flags & FLAG_NEEDS_ACK) != 0;

            i++; // extended header, reserved
            final byte handle = data[i++];
            if (currentHandle != null && currentHandle != handle) {
                // A fragment from a message we are not assembling. Dropping it is
                // right: interleaving would corrupt the one in progress.
                return false;
            }
            lastHandle = handle;
            lastCount = data[i++];

            if (firstChunk) {
                int fullLength = readInt32(data, i);
                i += 4;
                currentLength = fullLength;
                if (encrypted) {
                    int encryptedLength = fullLength + 8;
                    final int overflow = encryptedLength % 16;
                    if (overflow > 0) {
                        encryptedLength += 16 - overflow;
                    }
                    fullLength = encryptedLength;
                }
                reassembly = ByteBuffer.allocate(fullLength);
                currentEndpoint = (data[i++] & 0xff) | ((data[i++] & 0xff) << 8);
                currentHandle = handle;
            }

            if (reassembly == null) {
                // A continuation with no beginning, ie we joined mid-message.
                return false;
            }
            try {
                reassembly.put(data, i, data.length - i);
            } catch (final RuntimeException e) {
                // More data than the declared length. Better to drop the message
                // than to hand a truncated payload upwards as though it were whole.
                reset();
                return false;
            }

            if (lastChunk) {
                byte[] buf = reassembly.array();
                if (encrypted) {
                    if (sessionKey == null) {
                        reset();
                        return false;
                    }
                    try {
                        buf = aes(Cipher.DECRYPT_MODE, buf, messageKey(sessionKey, handle));
                    } catch (final Exception e) {
                        reset();
                        return false;
                    }
                    final byte[] trimmed = new byte[currentLength];
                    System.arraycopy(buf, 0, trimmed, 0, currentLength);
                    buf = trimmed;
                }
                final short endpoint = (short) currentEndpoint;
                reset();
                handler.payload(endpoint, buf);
            }

            return needsAck;
        }

        private static int readInt32(final byte[] data, final int offset) {
            return (data[offset] & 0xff)
                    | ((data[offset + 1] & 0xff) << 8)
                    | ((data[offset + 2] & 0xff) << 16)
                    | ((data[offset + 3] & 0xff) << 24);
        }
    }
}
