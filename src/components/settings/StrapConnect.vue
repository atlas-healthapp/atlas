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
        :disabled="busy || !keyLooksRight"
        @click="doConnect"
      >
        {{ busy ? "CONNECTING…" : "CONNECT" }}
      </button>
    </div>
    <div v-if="busy" class="dim-text mono note">{{ phaseLabel }}</div>
    <div v-if="message" class="dim-text mono note">{{ message }}</div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useHelioStore } from "@/stores/helio";

const emit = defineEmits(["connected"]);
const helio = useHelioStore();

/**
 * Where the key comes from. Text rather than a link: this WebView has no browser
 * chrome to come back from, and the step is done on a computer anyway, which is
 * where the page tells you to be.
 */
const TOKEN_GUIDE = "gadgetbridge.org/basics/pairing/huami-xiaomi-server";

const keyDraft = ref("");
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
 * Busy for the whole connect, not just the fetch.
 *
 * `syncing` drops the moment the fetch resolves and `connected` rises a line
 * later, and in that gap this component was rendering a fresh pairing form over
 * a connect that had just succeeded.
 */
const busy = computed(() => helio.syncing || helio.connecting);

function flash(text) {
  message.value = text;
  setTimeout(() => (message.value = ""), 4000);
}

async function doConnect() {
  try {
    // The cleaned form, so a key pasted with `0x`, spaces or colons connects
    // rather than being stored verbatim and failing at the handshake.
    helio.setAuthKey(cleanedKey.value);
    const res = await helio.connect();
    flash(`CONNECTED. ${res.days} DAY${res.days === 1 ? "" : "S"} IMPORTED`);
    emit("connected", res);
  } catch (e) {
    flash("COULD NOT CONNECT: " + (e?.message || String(e)).toUpperCase());
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
</style>
