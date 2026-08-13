<!--
  Pairing the strap: the explainer, the key field and the connect.

  **Extracted so first run and settings share one implementation.** First run now
  does the pairing itself rather than sending you to settings for it, and a
  second copy of this would be a second set of instructions, a second validator
  and a second pair of failure messages to keep in step. There is exactly one.

  **The key cannot be obtained from here and it is honest to say so up front.**
  It never crosses the air: the vendor's servers issue it to the strap during
  account binding, and the handshake only ever proves you already have it.
  Gadgetbridge, where this protocol is documented, removed the write-a-key
  capability after the Mi Band 2 and requires the same extraction. So the best
  this can be is a good set of instructions, and a bare field labelled "PAIRING
  KEY" is the version that makes people give up.

  Steps rather than a paragraph, because it is done once, on two devices, in an
  order that matters.
-->
<template>
  <div class="strapconnect">
    <!-- **While it is working, the form is gone, not merely disabled.**
         Everything below stayed on screen for the whole of a connect, so the
         moment the phase line changed the screen read as having dropped back to
         the pairing form while the strap was in fact mid-import. Reported as
         "it goes back to the 32-character screen after SAVING, then connects a
         couple of seconds later". A form you cannot use is a form that should
         not be there.

         **The progress bar is a CSS animation on purpose.** Ingest is main-thread
         work, and anything driven by requestAnimationFrame or a timer stops dead
         for the whole of it - that is the same defect as Home's boot clock. A CSS
         animation runs on the compositor and keeps moving through a blocked
         thread, so a stall in the work does not read as a crash. -->
    <template v-if="busy">
      <div class="working">
        <!-- The whole wordmark, not the bare peak. `.wordmark` is the shared
             rule in style.css, the same one AppHeader and Home's boot use, so
             this cannot become a fifth treatment of three letters. The peak
             stands in for the first A, which is why the text is TLAS. -->
        <div class="wordmark"><PeakMark />TLAS</div>
        <div class="track"><div class="crawl"></div></div>
        <div class="phase mono">{{ phaseLabel }}</div>
        <div class="dim-text mono note">
          THE FIRST CONNECT READS 30 DAYS OFF THE STRAP AND TAKES A COUPLE OF
          MINUTES. KEEP ATLAS OPEN: LEAVING THE APP CLOSES THE LINK AND THE
          IMPORT STARTS AGAIN.
        </div>
      </div>
    </template>

    <template v-else>
    <ol class="steps mono">
      <li>
        <span class="sn">1</span>
        <span>
          PAIR THE STRAP WITH THE ZEPP APP ONCE, IF YOU HAVE NOT. THE KEY IS
          ISSUED WHEN IT BINDS TO YOUR ACCOUNT.
        </span>
      </li>
      <li>
        <span class="sn">2</span>
        <span>
          <!-- **Not "it logs in as you", which is what this said and is not
               what happens.** You sign into Zepp yourself, in your own browser,
               and a snippet reads the token out of your own cookie. Nothing
               acts as you and no third party is handed a password. Describing
               it the other way makes the honest route sound like the sites that
               genuinely do ask for your credentials. -->
          ON A COMPUTER, OPEN
          <b class="url">{{ TOKEN_GUIDE }}</b>
          AND FOLLOW THE "ON A COMPUTER" STEPS. YOU SIGN IN TO ZEPP YOURSELF AND
          COPY YOUR OWN DEVICE'S KEY OUT OF THE BROWSER.
        </span>
      </li>
      <li>
        <span class="sn">3</span>
        <span>PASTE THE 32-CHARACTER KEY BELOW.</span>
      </li>
      <!-- **Gadgetbridge is the single most likely thing already installed by
           anyone who has a key at all**, since extracting one sends you to their
           documentation. Two apps on one phone are one central to the band, and
           Android delivers notifications on 0x0017 to both, so each decodes the
           other's traffic: that is the 2026-07-28 "session key rejected, status
           0x02 / 0x26" failure arriving from one app over instead of one link
           over. Named as a step rather than buried in a note, because by the time
           somebody reads a note they have already tapped CONNECT. -->
      <li>
        <span class="sn">4</span>
        <span>
          DISCONNECT THE STRAP IN GADGETBRIDGE OR ZEPP FIRST, IF EITHER IS
          RUNNING. ONLY ONE APP CAN TALK TO THE BAND AT A TIME AND THEY WILL
          CORRUPT EACH OTHER'S SESSION. LEAVE THE BLUETOOTH PAIRING ALONE.
        </span>
      </li>
    </ol>
    <div class="dim-text mono note">
      ATLAS NEVER ASKS FOR YOUR ZEPP PASSWORD AND CANNOT DO THIS STEP FOR YOU.
      THE KEY IS STORED ON THIS PHONE ONLY, AND IT IS IN YOUR BACKUP FILE.
    </div>

    <input
      v-model="keyDraft"
      class="keyfield mono"
      :class="{ bad: keyDraft.trim() && !keyLooksRight }"
      type="text"
      spellcheck="false"
      autocomplete="off"
      placeholder="PAIRING KEY (32 HEX CHARACTERS)"
    />
    <!-- Shape checked before connecting, because the alternative is a BLE
         connect that spends the strap's battery to fail and reports it as a sync
         error that says nothing about the typing. -->
    <div v-if="keyDraft.trim() && !keyLooksRight" class="dim-text mono err">
      {{ keyProblem }}
    </div>

    <div class="btnrow">
      <button
        class="databtn mono primary"
        :disabled="!keyLooksRight"
        @click="doConnect"
      >
        CONNECT
      </button>
    </div>

    <!-- **A failure has to be sendable, not just visible.** Atlas is public now
         and the reports that arrive are a remembered phrase ("could not connect,
         link closed by user") with nothing behind it, which is not enough to tell
         one failure mode from another: the same sentence on screen can mean the
         Activity was destroyed, the band walked away, or another app holds the
         link. The log is the only thing that separates them, so the failure panel
         carries it and a one-tap copy rather than leaving it three screens away
         in a section that does not render until you are connected. -->
    <div v-if="failure" class="failure">
      <div class="mono err ftitle">{{ failure }}</div>
      <div class="dim-text mono note">
        SEND THE DETAILS BELOW WITH ANY BUG REPORT. THEY CONTAIN NO PERSONAL DATA
        AND NOT YOUR PAIRING KEY.
      </div>
      <div class="btnrow">
        <button class="databtn mono" @click="copyDetails">
          {{ copied ? "COPIED" : "COPY DETAILS" }}
        </button>
        <button class="databtn mono" @click="showLog = !showLog">
          {{ showLog ? "HIDE LOG" : "SHOW LOG" }}
        </button>
      </div>
      <div v-if="showLog" class="log mono">
        <div
          v-for="(line, i) in helio.logLines"
          :key="i"
          :class="{ err: line.includes('!') }"
        >
          {{ line }}
        </div>
        <div v-if="!helio.logLines.length" class="dim-text">
          NOTHING RECORDED. THE CONNECT DID NOT REACH THE STRAP.
        </div>
      </div>
    </div>

    <div v-if="message" class="dim-text mono note">{{ message }}</div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useHelioStore } from "@/stores/helio";
import PeakMark from "@/components/layout/PeakMark.vue";

const emit = defineEmits(["connected"]);
const helio = useHelioStore();

/**
 * Where the key comes from. Text rather than a link: this WebView has no browser
 * chrome to come back from, and the step is done on a computer anyway, which is
 * where the page tells you to be.
 */
const TOKEN_GUIDE = "gadgetbridge.org/basics/pairing/huami-xiaomi-server";

/**
 * Pre-filled from the stored key when there is one.
 *
 * **For the restore path.** A backup carries the pairing key, so after restoring
 * onto a new install the key is in storage while this field was empty and
 * CONNECT stayed disabled until you found and pasted the same 32 characters
 * again. Same on any occasion the connection has been dropped but the key kept.
 */
const keyDraft = ref(helio.authKey ?? "");
const message = ref("");

/**
 * 32 hex characters, which is the 16-byte key written out. `0x` prefixes and
 * separators are stripped rather than rejected, since every place you can copy
 * this from formats it differently.
 */
const cleanedKey = computed(() =>
  keyDraft.value.trim().replace(/^0x/i, "").replace(/[\s:-]/g, "")
);
const keyLooksRight = computed(() => /^[0-9a-f]{32}$/i.test(cleanedKey.value));
const keyProblem = computed(() => {
  const k = cleanedKey.value;
  if (!/^[0-9a-f]*$/i.test(k)) return "THAT HAS CHARACTERS THAT ARE NOT 0-9 OR A-F IN IT.";
  return `THAT IS ${k.length} CHARACTERS. IT SHOULD BE 32.`;
});

/**
 * What the connect is doing, under the button that started it.
 *
 * A reconnect takes the best part of a minute, and a button reading CONNECTING…
 * for that long reads as a button that did not work. Reuses the store's own
 * phases so this and Home's header cannot narrate one sync differently.
 */
const phaseLabel = computed(() => helio.syncPhase || "SAVING");

/**
 * Busy for the whole connect, not just the fetch. Lives on the store now
 * (`helio.busy`), because first run hides its own chrome on the same condition
 * and the two must not disagree by a frame.
 */
const busy = computed(() => helio.busy);

/**
 * The last failure, held until the next attempt rather than flashed.
 *
 * `flash` clears itself after four seconds, which is the right treatment for
 * "connected, 14 days imported" and exactly the wrong one for an error somebody
 * is meant to read, act on and send on. It also cannot carry the buttons that
 * make it sendable.
 */
const failure = ref("");
const showLog = ref(false);
const copied = ref(false);

function flash(text) {
  message.value = text;
  setTimeout(() => (message.value = ""), 4000);
}

async function copyDetails() {
  const report = helio.diagnosticReport();
  try {
    await navigator.clipboard.writeText(report);
    copied.value = true;
    setTimeout(() => (copied.value = false), 3000);
  } catch {
    // The WebView refuses the clipboard without a secure context in some
    // configurations. Showing the log is then the only route, so say so rather
    // than failing silently under a button that claims to have worked.
    showLog.value = true;
    flash("COULD NOT COPY. SELECT THE LOG BELOW INSTEAD.");
  }
}

async function doConnect() {
  failure.value = "";
  showLog.value = false;
  try {
    // The cleaned form, so a key pasted with `0x`, spaces or colons connects
    // rather than being stored verbatim and failing at the handshake.
    helio.setAuthKey(cleanedKey.value);
    const res = await helio.connect();
    flash(`CONNECTED. ${res.days} DAY${res.days === 1 ? "" : "S"} IMPORTED`);
    emit("connected", res);
  } catch (e) {
    failure.value = "COULD NOT CONNECT: " + (e?.message || String(e)).toUpperCase();
  }
}
</script>

<style scoped>
.steps {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.steps li {
  display: flex;
  gap: 9px;
  font-size: 10.5px;
  line-height: 1.6;
  letter-spacing: 1px;
  color: var(--dim);
}
.sn {
  flex: none;
  width: 17px;
  height: 17px;
  margin-top: 1px;
  border: 1px solid color-mix(in srgb, var(--acc) 45%, transparent);
  border-radius: 50%;
  color: var(--acc);
  font-size: 9px;
  line-height: 15px;
  text-align: center;
}
.url {
  color: var(--acc);
  font-weight: 400;
  overflow-wrap: anywhere;
}
.note {
  margin-top: 12px;
  font-size: 10px;
  line-height: 1.6;
  letter-spacing: 1px;
}
.err {
  margin-top: 6px;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--bad, #e5484d);
}
.keyfield {
  width: 100%;
  margin-top: 12px;
  padding: 12px 13px;
  min-height: 46px;
  background: color-mix(in srgb, var(--acc) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--acc) 30%, transparent);
  border-radius: 7px;
  color: var(--ink);
  font-size: 13px;
  letter-spacing: 1px;
}
.keyfield::placeholder {
  color: var(--dim);
  font-size: 11px;
  letter-spacing: 1.2px;
}
.keyfield:focus {
  outline: none;
  border-color: var(--acc);
}
.keyfield.bad {
  border-color: var(--bad, #e5484d);
}
.btnrow {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.databtn {
  flex: 1;
  min-height: 44px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  color: var(--ink);
  font-size: 10px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.databtn.primary {
  border-color: var(--acc);
  color: var(--acc);
}
.databtn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ── While it is working ─────────────────────────────────────────────── */
.working {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 0 6px;
}
/* No colour override. The peak carries --acc from its own file and TLAS takes
   --ink from `.wordmark`, which is the treatment on every other screen. Painting
   the whole thing accent here was tried and dropped: it is the same three
   letters, and a per-screen colour is how the four treatments `.wordmark` was
   extracted to end got started. */
.track {
  position: relative;
  width: 100%;
  height: 2px;
  margin-top: 20px;
  overflow: hidden;
  background: color-mix(in srgb, var(--dim) 30%, transparent);
}
/* Indeterminate on purpose: the phase text carries the count, and a bar
   claiming a percentage would have to invent one for the fetch, which has no
   known total until the band stops sending. */
.crawl {
  position: absolute;
  top: 0;
  left: 0;
  width: 38%;
  height: 100%;
  background: var(--acc);
  animation: crawl 1.5s ease-in-out infinite;
}
@keyframes crawl {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(363%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .crawl {
    animation: none;
    width: 100%;
    opacity: 0.5;
  }
}
.phase {
  margin-top: 14px;
  font-size: 10.5px;
  letter-spacing: 1.4px;
  color: var(--acc);
  text-align: center;
}
.working .note {
  text-align: center;
}

/* ── After a failure ─────────────────────────────────────────────────── */
.failure {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--dim) 30%, transparent);
}
.ftitle {
  font-size: 11px;
  line-height: 1.55;
  letter-spacing: 1px;
}
.log {
  margin-top: 10px;
  max-height: 220px;
  padding: 9px 10px;
  overflow: auto;
  /* Sideways rather than wrapping: a wrapped hex frame is unreadable, and the
     page must not scroll horizontally to accommodate it. */
  white-space: pre;
  background: color-mix(in srgb, var(--dim) 12%, transparent);
  border-radius: 7px;
  font-size: 9.5px;
  line-height: 1.7;
  color: var(--dim);
  user-select: text;
}
.log .err {
  color: var(--bad, #e5484d);
}
</style>
