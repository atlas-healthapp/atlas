package io.github.atlashealthapp.atlas.ble;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A hand-rolled reader for the small slice of Protocol Buffers wire format the
 * workout summary needs.
 *
 * Gadgetbridge decodes this with a real generated-code protobuf library
 * (protobuf-lite plus a compiled .proto). Atlas's native BLE code has no
 * external dependencies anywhere else - EcdhB163 is a hand port of
 * public-domain C rather than a BouncyCastle dependency for the same reason -
 * and the message this codebase actually reads (WorkoutSummary, see
 * huami.proto in the Gadgetbridge source) is flat enough that a full decoder
 * is not worth a build-system dependency for it.
 *
 * Only two wire types are handled: varint (field 0) and length-delimited
 * (field 2, used for both submessages and the deprecated 32-bit float in this
 * schema, which is field type 5). 64-bit fields never appear in the fields
 * this codebase reads and are skipped rather than decoded.
 */
final class HuamiProtobuf {

    private HuamiProtobuf() {
    }

    static final class Message {
        private final Map<Integer, List<Object>> fields = new HashMap<>();

        private void add(final int field, final Object value) {
            fields.computeIfAbsent(field, k -> new ArrayList<>()).add(value);
        }

        /** proto3 says the last occurrence of a non-repeated field wins. */
        private Object last(final int field) {
            final List<Object> values = fields.get(field);
            return values == null || values.isEmpty() ? null : values.get(values.size() - 1);
        }

        Integer getInt(final int field) {
            final Object v = last(field);
            return v instanceof Long ? (int) (long) (Long) v : null;
        }

        Float getFloat(final int field) {
            final Object v = last(field);
            return v instanceof Float ? (Float) v : null;
        }

        /** Null when the field is absent, matching proto3's hasXxx() rather than a zero value. */
        Message getMessage(final int field) {
            final Object v = last(field);
            return v instanceof byte[] ? parse((byte[]) v) : null;
        }
    }

    static Message parse(final byte[] data) {
        return parse(data, 0, data.length);
    }

    static Message parse(final byte[] data, final int offset, final int length) {
        final Message message = new Message();
        int pos = offset;
        final int end = offset + length;

        while (pos < end) {
            final long[] tag = readVarint(data, pos);
            pos = (int) tag[1];
            final int fieldNumber = (int) (tag[0] >>> 3);
            final int wireType = (int) (tag[0] & 0x7);

            switch (wireType) {
                case 0: {
                    final long[] v = readVarint(data, pos);
                    message.add(fieldNumber, v[0]);
                    pos = (int) v[1];
                    break;
                }
                case 5: {
                    final int bits = (data[pos] & 0xff)
                            | ((data[pos + 1] & 0xff) << 8)
                            | ((data[pos + 2] & 0xff) << 16)
                            | ((data[pos + 3] & 0xff) << 24);
                    message.add(fieldNumber, Float.intBitsToFloat(bits));
                    pos += 4;
                    break;
                }
                case 1: {
                    // 64-bit fixed/double. Not read anywhere in this codebase; skip.
                    pos += 8;
                    break;
                }
                case 2: {
                    final long[] len = readVarint(data, pos);
                    pos = (int) len[1];
                    final int l = (int) len[0];
                    final byte[] sub = new byte[l];
                    System.arraycopy(data, pos, sub, 0, l);
                    message.add(fieldNumber, sub);
                    pos += l;
                    break;
                }
                default:
                    throw new IllegalStateException(
                            "unsupported wire type " + wireType + " for field " + fieldNumber);
            }
        }

        return message;
    }

    /** @return a two-element array: {@code {value, positionAfterReading}} */
    private static long[] readVarint(final byte[] data, final int start) {
        long result = 0;
        int shift = 0;
        int pos = start;
        while (true) {
            final byte b = data[pos++];
            result |= (long) (b & 0x7f) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return new long[]{result, pos};
    }
}
