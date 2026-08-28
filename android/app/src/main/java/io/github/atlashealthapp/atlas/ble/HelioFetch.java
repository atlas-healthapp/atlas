package io.github.atlashealthapp.atlas.ble;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.Calendar;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Fetches recorded data from the band, one data type at a time.
 *
 * The transfer is split across two channels, which is the thing to understand
 * before reading any of this:
 *
 *  - **Control** goes over the chunked endpoint 0x004b, the same framing as every
 *    other service.
 *  - **Bulk data** does not. It arrives as raw GATT notifications on
 *    characteristic 0x0005, outside the chunked layer entirely, each packet
 *    prefixed with a one-byte sequence counter that wraps.
 *
 * Conversation, repeated once per data type:
 * <pre>
 * -&gt; 0x01 TYPE + 8 timestamp bytes     "what do you have since then"
 * &lt;- 0x10 0x01 0x01 + len32 + 8 bytes  "this many bytes, starting then"
 * -&gt; 0x02                              "send it"
 * &lt;- (raw notifications on 0x0005)     counter byte + payload, repeatedly
 * &lt;- 0x10 0x02 0x01 [+ crc32]          "that's all, here's the checksum"
 * -&gt; 0x03 0x09                         "got it, but keep your copy"
 * </pre>
 *
 * That last byte is deliberate and load-bearing. Acking with 0x01 tells the band
 * the data is safely stored and it may discard its detailed copy permanently,
 * which would silently break the existing Gadgetbridge sync. 0x09 acknowledges
 * without granting permission to forget. While Atlas is not the only thing
 * reading this band, 0x09 is the only defensible choice.
 *
 * **Two kinds of record.** Some carry their own timestamp; others do not, and are
 * a dense one-per-minute series counted forward from the start date in the
 * band's own reply. Confusing the two silently shifts an entire day of readings,
 * so which is which is recorded per type in {@link FetchType} rather than
 * inferred.
 */
final class HelioFetch {

    static final short ENDPOINT_ACTIVITY_FETCH = 0x004b;

    private static final byte COMMAND_START_DATE = 0x01;
    private static final byte COMMAND_FETCH_DATA = 0x02;
    private static final byte COMMAND_ACK = 0x03;
    private static final byte ACK_KEEP_ON_DEVICE = 0x09;

    private static final byte RESPONSE = 0x10;
    private static final byte SUCCESS = 0x01;

    private static final long MINUTE_MS = 60_000L;

    /**
     * The bounds a heart-rate byte has to fall inside to be a reading at all.
     *
     * <p><b>These are the Java twin of {@code HR_MIN} / {@code HR_MAX} in
     * {@code src/utils/bodyMetrics.js} and the two must agree.</b> Unlike the
     * other change-both-or-neither pairs in this codebase, this one <i>is</i>
     * checked: {@code src/utils/__tests__/hrBoundsTwin.test.js} reads this file
     * and fails if the numbers drift, the way {@code families.test.js} reads
     * {@code style.css}.
     *
     * <p>Named {@code HR_PLAUSIBLE_*} because {@code HR_MIN} and {@code HR_MAX}
     * were already taken further down this file, by the protobuf field numbers of
     * a workout summary's own minimum and maximum heart rate. Two different
     * things with one obvious name, and the compiler caught it.
     *
     * <p><b>Why this exists at all (2026-08-19).</b> The band writes {@code 0xff}
     * into the heart-rate byte for a minute it has no reading for, exactly as it
     * does for stress three cases below. The stress guard was written and the
     * heart-rate one was not, so a strap sitting on its charger emitted a run of
     * 255s that were carried into the widgets as a real pulse. The app never
     * showed it, because {@code isMeaningful} drops them on ingest, which is what
     * made it look like a widget bug: the card read 255 BPM, opening Atlas
     * corrected it, and the next background sync put it back. Measured on the
     * device, the archive held 4,179 heart-rate samples over three days with a
     * maximum of 165 and not one 255, so the leak was never in the archive.
     *
     * <p>Dropping it here rather than in the service is deliberate: the sentinel
     * is protocol knowledge and this is where the bytes are, which is the same
     * reasoning the temperature scaling below carries. Both consumers, the app's
     * ingest and the widgets' carry-forward, then inherit one definition instead
     * of keeping two that can drift.
     */
    private static final int HR_PLAUSIBLE_MIN = 25;
    private static final int HR_PLAUSIBLE_MAX = 200;

    /** Whether a raw heart-rate byte is a reading rather than the band's "none". */
    public static boolean isRealHeartRate(final double bpm) {
        return bpm >= HR_PLAUSIBLE_MIN && bpm <= HR_PLAUSIBLE_MAX;
    }

    /**
     * Record sizes and codes verified against Gadgetbridge's fetch operations.
     * A wrong size here does not throw: it silently reinterprets every field,
     * which is why each is stated once and used everywhere.
     */
    enum FetchType {
        ACTIVITY((byte) 0x01, 8, 0, true),
        RESTING_HR((byte) 0x3a, 6, 0, false),
        STRESS((byte) 0x13, 1, 0, true),
        SPO2((byte) 0x25, 65, 1, false),
        HRV((byte) 0x49, 6, 0, false),
        TEMPERATURE((byte) 0x2e, 8, 0, true),
        RESP_RATE((byte) 0x38, 8, 0, false),
        PAI((byte) 0x0d, 102, 0, false),
        SLEEP((byte) 0x48, 594, 0, false),
        /**
         * Not a fixed-size record like everything else here: one variable-length
         * protobuf-encoded workout summary per fetch round. recordSize/headerBytes
         * are unused - {@link #parseWorkout} handles the whole buffer itself,
         * the same way SLEEP is special-cased in {@link #parse}.
         */
        WORKOUT((byte) 0x05, 1, 0, false);

        final byte code;
        final int recordSize;
        /** SpO2 prefixes the whole transfer with a single version byte. */
        final int headerBytes;
        /** True when records carry no timestamp and run one per minute from the start date. */
        final boolean impliedMinutes;

        FetchType(final byte code, final int recordSize, final int headerBytes, final boolean impliedMinutes) {
            this.code = code;
            this.recordSize = recordSize;
            this.headerBytes = headerBytes;
            this.impliedMinutes = impliedMinutes;
        }
    }

    /** One normalised reading. Matches the {metric, t, v} shape the JS side already consumes. */
    static final class Sample {
        final String metric;
        final long t;
        final double v;

        Sample(final String metric, final long t, final double v) {
            this.metric = metric;
            this.t = t;
            this.v = v;
        }
    }

    /**
     * One decoded workout summary. Fields are {@code null} rather than zero when
     * the band's protobuf omits them (an indoor session has no distance/altitude),
     * matching {@link HuamiProtobuf.Message}'s own null-means-absent convention.
     */
    static final class Workout {
        final long startMillis;
        final long endMillis;
        /** Not necessarily one of Gadgetbridge's named types - see typeAutoDetected. */
        final Integer typeCode;
        /** True when the band's own {@code ai} flag says this was auto-detected, not started by hand. */
        final boolean typeAutoDetected;
        /** Moving time, excluding pauses - {@code Time.workoutDuration} in huami.proto. */
        final Integer activeSeconds;
        final Integer caloriesKcal;
        final Integer hrAvg;
        final Integer hrMax;
        final Integer hrMin;
        final Float distanceMeters;
        final Float altitudeAvgMeters;

        Workout(final long startMillis, final long endMillis, final Integer typeCode,
                final boolean typeAutoDetected, final Integer activeSeconds, final Integer caloriesKcal,
                final Integer hrAvg, final Integer hrMax, final Integer hrMin,
                final Float distanceMeters, final Float altitudeAvgMeters) {
            this.startMillis = startMillis;
            this.endMillis = endMillis;
            this.typeCode = typeCode;
            this.typeAutoDetected = typeAutoDetected;
            this.activeSeconds = activeSeconds;
            this.caloriesKcal = caloriesKcal;
            this.hrAvg = hrAvg;
            this.hrMax = hrMax;
            this.hrMin = hrMin;
            this.distanceMeters = distanceMeters;
            this.altitudeAvgMeters = altitudeAvgMeters;
        }
    }

    interface Transport {
        void sendActivityControl(byte[] payload);

        void log(String message);

        void onSamples(List<Sample> samples);

        void onSleepSessions(List<byte[]> sessions);

        void onWorkouts(List<Workout> workouts);

        void onAllFetchesFinished();
    }

    private final Transport transport;
    private final Deque<FetchType> pending = new ArrayDeque<>();

    /**
     * One WORKOUT round returns at most one workout: the earliest one starting at
     * or after the since-date it was asked for.
     *
     * That "at or after" is the whole problem, and it is why this loops rather
     * than firing once. Every other type asks for the last N days and gets
     * everything in the window, so re-asking is harmless. A workout fetch asking
     * for the last 3 days lands on the oldest workout in those 3 days, hands it
     * back, and does the same again next sync - forever, never reaching the
     * newest one. Observed on-device 2026-07-29: a sync asking since 26 Jul
     * returned the 27 Jul session while a session from that same evening sat
     * unfetched.
     *
     * So each round advances the since-date past the workout it just received and
     * asks again, until the band answers "nothing new". A previous attempt at
     * this concluded the band ignored the advanced date and kept resending the
     * same record; the log above shows the date being honoured, so the more
     * likely explanation is that the attempt advanced to the workout's END, which
     * {@link #parseWorkout} derives rather than reads, and which can land before
     * the next record for a paused session.
     *
     * Two guards, because this talks to hardware and a wrong assumption here is
     * an infinite loop against a Bluetooth device: the round is abandoned if a
     * workout does not start strictly later than the previous one, and there is a
     * hard cap on rounds per sync.
     */
    private static final int MAX_WORKOUT_ROUNDS = 40;
    /**
     * {@link #timeBytes} zeroes the seconds field, so advancing by less than a
     * minute can truncate straight back onto the workout just received and ask
     * for it again. A session is never a minute after the one before it.
     */
    private static final long WORKOUT_STEP_MILLIS = 60_000L;

    /**
     * How far behind now a minute-by-minute answer may end before it is treated
     * as truncated. Ten minutes: the band writes a record a minute, so a
     * healthy answer lands within a couple, and this leaves room for a slow
     * flush without chasing rounds that would return nothing.
     */
    private static final long CONTINUATION_GAP_MILLIS = 10 * 60_000L;
    /** A band answering with the same window forever must not hold sync open. */
    private static final int MAX_CONTINUATION_ROUNDS = 8;

    private final ByteArrayOutputStream buffer = new ByteArrayOutputStream(8192);
    private FetchType current;
    private int sinceDays;
    /** Absolute since-date for WORKOUT, or 0 to fall back to {@link #sinceDays}. */
    private long workoutSinceMillis;
    private long lastWorkoutStart;
    private int workoutRounds;
    /**
     * Where the next round for a minute-by-minute type should start, when the
     * band truncated the last one. See {@link #queueContinuation}.
     */
    private final EnumMap<FetchType, Long> continueFrom = new EnumMap<>(FetchType.class);
    private final EnumMap<FetchType, Integer> continuationRounds =
            new EnumMap<>(FetchType.class);
    private long startMillis;
    private int expectedDataLength;
    private byte lastPacketCounter;
    private boolean valid;

    HelioFetch(final Transport transport) {
        this.transport = transport;
    }

    void startAll(final int sinceDays) {
        startAll(sinceDays, 0L);
    }

    /**
     * @param workoutSinceMillis the newest workout already stored, so the first
     *                           WORKOUT round asks for the one after it rather
     *                           than re-fetching a session the archive has held
     *                           for days. 0 falls back to {@code sinceDays}.
     */
    void startAll(final int sinceDays, final long workoutSinceMillis) {
        this.sinceDays = sinceDays;
        this.workoutSinceMillis = workoutSinceMillis > 0
                ? workoutSinceMillis + WORKOUT_STEP_MILLIS
                : 0L;
        this.lastWorkoutStart = workoutSinceMillis;
        this.workoutRounds = 0;
        continueFrom.clear();
        continuationRounds.clear();
        pending.clear();
        for (final FetchType type : FetchType.values()) {
            pending.addLast(type);
        }
        next();
    }

    private void next() {
        current = pending.pollFirst();
        if (current == null) {
            transport.onAllFetchesFinished();
            return;
        }

        buffer.reset();
        expectedDataLength = 0;
        lastPacketCounter = -1;
        valid = true;

        final Calendar since = Calendar.getInstance();
        final Long resume = continueFrom.get(current);
        if (current == FetchType.WORKOUT && workoutSinceMillis > 0) {
            since.setTimeInMillis(workoutSinceMillis);
        } else if (resume != null) {
            since.setTimeInMillis(resume);
        } else {
            since.add(Calendar.DAY_OF_MONTH, -sinceDays);
        }

        final byte[] command = new byte[10];
        command[0] = COMMAND_START_DATE;
        command[1] = current.code;
        System.arraycopy(timeBytes(since), 0, command, 2, 8);

        transport.log("fetch " + current.name() + " since " + iso(since));
        transport.sendActivityControl(command);
    }

    /**
     * Wire format for a timestamp: little-endian year, then month (1-based),
     * day, hour, minute, second, and the UTC offset in quarter-hours.
     *
     * Seconds are deliberately zeroed. Gadgetbridge truncates to minutes by
     * default because second-precision timestamps caused fetches to fail on some
     * Amazfit models, and there is no reason to take that risk for data recorded
     * per minute anyway.
     */
    private static byte[] timeBytes(final Calendar calendar) {
        final int year = calendar.get(Calendar.YEAR);
        final TimeZone tz = calendar.getTimeZone();
        final int offsetQuarterHours = tz.getOffset(calendar.getTimeInMillis()) / (1000 * 60 * 15);

        return new byte[]{
                (byte) (year & 0xff),
                (byte) ((year >> 8) & 0xff),
                (byte) (calendar.get(Calendar.MONTH) + 1),
                (byte) calendar.get(Calendar.DATE),
                (byte) calendar.get(Calendar.HOUR_OF_DAY),
                (byte) calendar.get(Calendar.MINUTE),
                0,
                (byte) offsetQuarterHours,
        };
    }

    /**
     * The band echoes the actual start date it will send from, which is not the
     * one we asked for - and, easy to miss, the response carries its own 8th
     * byte with the same quarter-hour UTC offset format {@link #timeBytes} sends
     * on the way out. The year/month/.../second fields are wall-clock in THAT
     * offset, not in whatever zone this device happens to be in right now: a
     * band reporting in UTC while the phone is AEST (+10) silently produced a
     * time exactly 10 hours off before this was applied - confirmed on-device
     * 2026-07-28 against a real workout (08:20 decoded, 18:20 actual).
     *
     * <p>So the order below matters, and it follows from {@link Calendar}'s own
     * documented behaviour rather than from anywhere else: a Calendar resolves
     * its fields against whatever zone it holds <b>at the moment the instant is
     * computed</b>, not at the moment the fields were set. Set the fields, then
     * install a UTC-based zone at the band's reported raw offset, and only then
     * read the time - and the wall-clock figures resolve against the band's
     * offset instead of this device's default zone. Calling {@code getTime()}
     * before {@code setTimeZone} would bake in the phone's zone and no later
     * correction can undo it, which is exactly the ten-hour error above.
     */
    /**
     * The UTC offset the band last reported, in minutes, or {@link Integer#MIN_VALUE}.
     *
     * <p><b>The band keeps its own clock and Atlas does not set it.</b> Zepp
     * does, so somebody who flies and never opens Zepp has a strap still in the
     * old zone - and an alarm is written as a bare wall-clock hour, so it rings
     * at the old local time. That is not hypothetical: {@link #parseStartDate}
     * exists because a band reporting UTC against a phone on AEST decoded
     * workouts ten hours out.
     *
     * <p>Atlas cannot fix this yet (setting the clock needs a config endpoint it
     * does not speak) but it can see it, because every fetch reply carries the
     * offset. Recording it is what lets the app say so instead of leaving
     * somebody to find out at 07:00.
     *
     * <p>Static because this is a reading rather than state: the newest value
     * wins and nothing needs the history.
     */
    static volatile int lastReportedOffsetMinutes = Integer.MIN_VALUE;

    static long parseStartDate(final byte[] payload, final int offset) {
        final Calendar c = Calendar.getInstance();
        final int year = (payload[offset] & 0xff) | ((payload[offset + 1] & 0xff) << 8);
        c.set(Calendar.YEAR, year);
        c.set(Calendar.MONTH, (payload[offset + 2] & 0xff) - 1);
        c.set(Calendar.DAY_OF_MONTH, payload[offset + 3] & 0xff);
        c.set(Calendar.HOUR_OF_DAY, payload[offset + 4] & 0xff);
        c.set(Calendar.MINUTE, payload[offset + 5] & 0xff);
        c.set(Calendar.SECOND, payload[offset + 6] & 0xff);
        c.set(Calendar.MILLISECOND, 0);
        if (payload.length > offset + 7) {
            // Signed: quarter-hours west of UTC are negative, and byte is
            // already signed in Java so this needs no & 0xff mask.
            final TimeZone reported = TimeZone.getTimeZone("UTC");
            reported.setRawOffset(payload[offset + 7] * 15 * 60 * 1000);
            c.setTimeZone(reported);
            // Recorded on the way past. The band is telling us which zone it
            // thinks it is in, and that is the only way to know it disagrees
            // with the phone.
            lastReportedOffsetMinutes = payload[offset + 7] * 15;
        }
        return c.getTimeInMillis();
    }

    private static String iso(final Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d %02d:%02d",
                c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DATE),
                c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }

    /** Control responses, arriving over the chunked endpoint. */
    void onControl(final byte[] payload) {
        if (current == null) {
            return;
        }
        if (payload.length < 3 || payload[0] != RESPONSE) {
            transport.log("! " + current.name() + ": unexpected control payload");
            next();
            return;
        }
        switch (payload[1]) {
            case COMMAND_START_DATE:
                onStartDateResponse(payload);
                return;
            case COMMAND_FETCH_DATA:
                onFetchDataResponse(payload);
                return;
            case COMMAND_ACK:
                next();
                return;
            default:
                transport.log("! " + current.name() + ": unknown control response " + hex(payload[1]));
                next();
        }
    }

    private void onStartDateResponse(final byte[] payload) {
        if (payload[2] != SUCCESS) {
            // Not every firmware records every metric. A refusal here means this
            // band has nothing of this kind, which is information rather than an
            // error, so the queue simply moves on.
            transport.log(current.name() + ": not available (status " + hex(payload[2]) + ")");
            next();
            return;
        }
        if (payload.length < 15) {
            transport.log("! " + current.name() + ": short start-date response");
            next();
            return;
        }
        expectedDataLength = (payload[3] & 0xff)
                | ((payload[4] & 0xff) << 8)
                | ((payload[5] & 0xff) << 16)
                | ((payload[6] & 0xff) << 24);
        startMillis = parseStartDate(payload, 7);

        if (expectedDataLength == 0) {
            transport.log(current.name() + ": nothing new");
            sendAck();
            return;
        }

        transport.log(current.name() + ": expecting " + expectedDataLength + " bytes");
        transport.sendActivityControl(new byte[]{COMMAND_FETCH_DATA});
    }

    private void onFetchDataResponse(final byte[] payload) {
        if (payload[2] != SUCCESS) {
            transport.log("! " + current.name() + ": transfer failed, status " + hex(payload[2]));
            next();
            return;
        }

        final byte[] data = buffer.toByteArray();

        // A checksum only accompanies the reply on some firmwares. When it is
        // there it is worth checking: a truncated transfer would otherwise be
        // decoded into plausible-looking but wrong readings.
        if (payload.length >= 7) {
            final int expected = (payload[3] & 0xff)
                    | ((payload[4] & 0xff) << 8)
                    | ((payload[5] & 0xff) << 16)
                    | ((payload[6] & 0xff) << 24);
            if (expected != ChunkedCodec.crc32(data, 0, data.length)) {
                transport.log("! " + current.name() + ": checksum mismatch, discarding");
                sendAck();
                return;
            }
        }
        if (!valid) {
            transport.log("! " + current.name() + ": transfer had a gap, discarding");
            sendAck();
            return;
        }

        try {
            parse(data);
        } catch (final RuntimeException e) {
            // A malformed record must not take the whole sync down with it.
            transport.log("! " + current.name() + ": parse failed, " + e);
        }
        sendAck();
    }

    private void parse(final byte[] data) {
        if (current == FetchType.WORKOUT) {
            parseWorkout(data);
            return;
        }

        final int body = data.length - current.headerBytes;
        if (body < 0 || body % current.recordSize != 0) {
            transport.log("! " + current.name() + ": " + data.length
                    + " bytes is not a whole number of " + current.recordSize + "-byte records");
            return;
        }
        final int records = body / current.recordSize;

        if (current == FetchType.SLEEP) {
            final List<byte[]> sessions = new ArrayList<>(records);
            for (int i = 0; i < records; i++) {
                final byte[] session = new byte[FetchType.SLEEP.recordSize];
                System.arraycopy(data, i * FetchType.SLEEP.recordSize, session, 0, session.length);
                sessions.add(session);
            }
            transport.log("SLEEP: " + sessions.size() + " session(s)");
            transport.onSleepSessions(sessions);
            return;
        }

        final ByteBuffer buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        buf.position(current.headerBytes);
        final List<Sample> samples = new ArrayList<>(records);

        for (int i = 0; i < records; i++) {
            final int base = current.headerBytes + i * current.recordSize;
            // Implied-minute types have no timestamp of their own and simply run
            // forward from the start date the band reported.
            final long impliedTime = startMillis + (long) i * MINUTE_MS;

            switch (current) {
                case ACTIVITY: {
                    final int steps = data[base + 2] & 0xff;
                    final int hr = data[base + 3] & 0xff;
                    samples.add(new Sample("steps", impliedTime, steps));
                    // 0xff is the band's "no reading this minute" marker, not a
                    // value, and a charging strap sends runs of them. See
                    // isRealHeartRate. Steps are deliberately not filtered the
                    // same way: measured on the device, three days of step
                    // samples top out at 112, so the band does not appear to
                    // mark an absent step count the same way, and dropping 255
                    // there would throw away a real, if unlikely, minute.
                    if (isRealHeartRate(hr)) {
                        samples.add(new Sample("hr", impliedTime, hr));
                    }
                    break;
                }
                case STRESS: {
                    final int stress = data[base] & 0xff;
                    // 0xff is the band's "no reading this minute" marker, not a value.
                    if (stress != 0xff) {
                        samples.add(new Sample("stress", impliedTime, stress));
                    }
                    break;
                }
                case TEMPERATURE: {
                    // Hundredths of a degree: the band sends 3431 for 34.31C.
                    // Unscaled, every reading fell outside the 20-45C plausible
                    // range and was dropped on ingest, so skin temperature had
                    // silently shown nothing since the switch from Gadgetbridge
                    // to BLE - the samples arrived on every sync and were thrown
                    // away one layer later. Scaled here because unit knowledge
                    // is protocol knowledge, and this is where the bytes are.
                    final double temperature = buf.getShort(base + 2) / 100.0;
                    samples.add(new Sample("skinTemp", impliedTime, temperature));
                    break;
                }
                case RESTING_HR: {
                    final long t = unsignedInt(buf.getInt(base)) * 1000L;
                    // Same sentinel, same reason: this is a heart rate too, and a
                    // day the band never got a resting reading for is reported
                    // rather than omitted.
                    final int resting = data[base + 5] & 0xff;
                    if (isRealHeartRate(resting)) {
                        samples.add(new Sample("restingHr", t, resting));
                    }
                    break;
                }
                case HRV: {
                    final long t = unsignedInt(buf.getInt(base)) * 1000L;
                    samples.add(new Sample("hrv", t, data[base + 5] & 0xff));
                    break;
                }
                case RESP_RATE: {
                    final long t = unsignedInt(buf.getInt(base)) * 1000L;
                    samples.add(new Sample("respRate", t, data[base + 5] & 0xff));
                    break;
                }
                case SPO2: {
                    final long t = unsignedInt(buf.getInt(base)) * 1000L;
                    // The top bit flags an automatic measurement rather than
                    // being part of the value, so it has to be stripped.
                    final byte raw = data[base + 4];
                    final int spo2 = raw < 0 ? raw + 128 : raw;
                    samples.add(new Sample("spo2", t, spo2));
                    break;
                }
                case PAI: {
                    final long t = unsignedInt(buf.getInt(base + 1)) * 1000L;
                    // paiTotal is the rolling seven-day score Zepp calls "your
                    // PAI"; paiToday four bytes earlier is only today's share.
                    samples.add(new Sample("pai", t, buf.getFloat(base + 59)));
                    break;
                }
                default:
                    break;
            }
        }

        transport.log(current.name() + ": " + samples.size() + " sample(s)");
        transport.onSamples(samples);

        if (current.impliedMinutes && records > 0) {
            queueContinuation(current, startMillis + (long) (records - 1) * MINUTE_MS);
        }
    }

    /**
     * Ask again for a minute-by-minute type whose answer stopped short of now.
     *
     * The band caps how much it will send in one round, and the cap is per
     * record rather than per byte - so a dense type like ACTIVITY (steps and
     * heart rate, eight bytes a minute) runs out long before a sparse one does.
     * Asking for "the last two days" then yields two days *of records*, ending
     * wherever the cap fell, and asking again next sync returns the same
     * truncated window: everything past it can never arrive.
     *
     * That is not theoretical. On 2026-08-03 the strap answered ACTIVITY with
     * 3422 records ending at 07:22 while stress and SpO2 came back current to
     * 22:00, so the day showed **23 steps** and every session that evening had
     * no heart rate at all - both fed by the same truncated record.
     *
     * So each round resumes from the minute after the last one delivered, with
     * the same two guards the workout rounds already use: stop when a round
     * makes no progress, and cap the rounds so a band that keeps answering with
     * the same window cannot hold the sync open forever.
     */
    private void queueContinuation(final FetchType type, final long lastRecordMillis) {
        if (System.currentTimeMillis() - lastRecordMillis < CONTINUATION_GAP_MILLIS) {
            return;
        }
        final Long previous = continueFrom.get(type);
        final long resumeAt = lastRecordMillis + MINUTE_MS;
        if (previous != null && resumeAt <= previous) {
            transport.log(type.name() + ": no progress, giving up on continuation");
            return;
        }
        final int round = continuationRounds.getOrDefault(type, 0) + 1;
        if (round > MAX_CONTINUATION_ROUNDS) {
            transport.log(type.name() + ": continuation cap reached");
            return;
        }
        continueFrom.put(type, resumeAt);
        continuationRounds.put(type, round);
        pending.addFirst(type);
        final Calendar at = Calendar.getInstance();
        at.setTimeInMillis(resumeAt);
        transport.log(type.name() + ": truncated, continuing from " + iso(at));
    }

    private static long unsignedInt(final int value) {
        return value & 0xffffffffL;
    }

    // Field numbers from Gadgetbridge's huami.proto (message WorkoutSummary and
    // its submessages). Not renumbered or reordered here on purpose, so this
    // reads directly against that schema rather than against its own invented
    // order.
    private static final int F_TYPE = 3;
    private static final int F_DISTANCE = 4;
    private static final int F_TIME = 7;
    private static final int F_ALTITUDE = 13;
    private static final int F_CALORIES = 16;
    private static final int F_HEART_RATE = 19;
    private static final int TYPE_CODE = 1;
    private static final int TYPE_AI = 2;
    private static final int TIME_WORKOUT_DURATION = 2;
    private static final int DISTANCE_METERS = 1;
    private static final int ALTITUDE_AVG = 3;
    private static final int CALORIES_KCAL = 1;
    private static final int HR_AVG = 1;
    private static final int HR_MAX = 2;
    private static final int HR_MIN = 3;
    /** Gadgetbridge stores raw altitude in 1/200 metres; see huami.proto's comment on the field. */
    private static final float ALTITUDE_SCALE = 200f;
    /** A degenerate zero-duration record still needs a sane displayed end time. */
    private static final long MIN_DURATION_SECONDS = 60;

    /**
     * One variable-length protobuf-encoded workout per round: 2 version bytes
     * (0x8000 on this firmware) then a WorkoutSummary message. Nothing here
     * validates the version beyond logging a surprise - the fields read are
     * stable across the versions Gadgetbridge itself tolerates.
     */
    private void parseWorkout(final byte[] data) {
        if (data.length < 2) {
            transport.log("! WORKOUT: payload too short (" + data.length + " bytes)");
            return;
        }
        final int version = (data[0] & 0xff) | ((data[1] & 0xff) << 8);
        if (version != 0x8000) {
            transport.log("WORKOUT: unexpected version 0x" + Integer.toHexString(version) + ", parsing anyway");
        }

        final HuamiProtobuf.Message summary = HuamiProtobuf.parse(data, 2, data.length - 2);
        final HuamiProtobuf.Message type = summary.getMessage(F_TYPE);
        final HuamiProtobuf.Message time = summary.getMessage(F_TIME);
        final HuamiProtobuf.Message calories = summary.getMessage(F_CALORIES);
        final HuamiProtobuf.Message heartRate = summary.getMessage(F_HEART_RATE);
        final HuamiProtobuf.Message distance = summary.getMessage(F_DISTANCE);
        final HuamiProtobuf.Message altitude = summary.getMessage(F_ALTITUDE);

        final Integer totalDurationSec = time != null ? time.getInt(1) : null;
        final long durationSeconds = Math.max(totalDurationSec != null ? totalDurationSec : 0, MIN_DURATION_SECONDS);
        final long endMillis = startMillis + durationSeconds * 1000L;

        final Integer altitudeRaw = altitude != null ? altitude.getInt(ALTITUDE_AVG) : null;

        final Workout workout = new Workout(
                startMillis,
                endMillis,
                type != null ? type.getInt(TYPE_CODE) : null,
                type != null && Integer.valueOf(1).equals(type.getInt(TYPE_AI)),
                time != null ? time.getInt(TIME_WORKOUT_DURATION) : null,
                calories != null ? calories.getInt(CALORIES_KCAL) : null,
                heartRate != null ? heartRate.getInt(HR_AVG) : null,
                heartRate != null ? heartRate.getInt(HR_MAX) : null,
                heartRate != null ? heartRate.getInt(HR_MIN) : null,
                distance != null ? distance.getFloat(DISTANCE_METERS) : null,
                altitudeRaw != null ? altitudeRaw / ALTITUDE_SCALE : null);

        transport.log("WORKOUT: type=" + workout.typeCode
                + (workout.typeAutoDetected ? " (auto)" : " (manual)")
                + " duration=" + workout.activeSeconds + "s"
                + " calories=" + workout.caloriesKcal
                + " hr=" + workout.hrAvg + "/" + workout.hrMax);
        transport.onWorkouts(java.util.Collections.singletonList(workout));
        queueNextWorkoutRound(workout.startMillis);
    }

    /**
     * Asks for the workout after the one just received, so a backlog drains in
     * one sync instead of one session per sync.
     *
     * Re-queued at the FRONT: the ack that follows this pops the queue, and the
     * loop has to finish before the fetch is declared complete or the extra
     * workouts arrive after the caller has already committed what it had.
     */
    private void queueNextWorkoutRound(final long startMillis) {
        if (startMillis <= lastWorkoutStart) {
            // No progress. Either the band ignored the advanced since-date or it
            // has nothing newer; both mean asking again would loop.
            transport.log("WORKOUT: no newer session, stopping");
            return;
        }
        if (++workoutRounds >= MAX_WORKOUT_ROUNDS) {
            transport.log("WORKOUT: hit the " + MAX_WORKOUT_ROUNDS
                    + "-round cap, the rest arrive next sync");
            return;
        }
        lastWorkoutStart = startMillis;
        workoutSinceMillis = startMillis + WORKOUT_STEP_MILLIS;
        pending.addFirst(FetchType.WORKOUT);
    }

    /** Raw notifications on characteristic 0x0005, outside the chunked layer. */
    void onData(final byte[] packet) {
        if (!valid || packet.length < 1) {
            return;
        }
        // The counter is a byte and wraps, so the comparison has to be done as a
        // byte too. Comparing as ints breaks at 127.
        if ((byte) (lastPacketCounter + 1) != packet[0]) {
            transport.log("! " + current.name() + ": packet out of order, expected "
                    + ((lastPacketCounter + 1) & 0xff) + " got " + (packet[0] & 0xff));
            valid = false;
            return;
        }
        lastPacketCounter++;
        buffer.write(packet, 1, packet.length - 1);
    }

    private void sendAck() {
        transport.sendActivityControl(new byte[]{COMMAND_ACK, ACK_KEEP_ON_DEVICE});
    }

    private static String hex(final byte b) {
        return String.format("0x%02x", b);
    }
}
