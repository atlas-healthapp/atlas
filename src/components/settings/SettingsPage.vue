<template>
  <!-- A full page rather than a drawer: this is where the device panel, goals
       and per-metric detail will grow, and a drawer has to stay shallow because
       a drawer opened from a drawer has nowhere to go. Teleported and covering
       the tab bar, so it reads as somewhere you went rather than a tab. -->
  <Teleport to="body">
    <div class="page grid-bg">
      <div class="pscroll">
        <div class="phd">
          <!-- Boxed rather than a bare chevron, matching the [ SYS ] control
               this page is opened from. The chevron is an SVG at the icon
               set's stroke width, not a text glyph: glyphs shift with the
               font and cannot be stroke-matched to anything else. -->
          <button class="back mono" type="button" @click="$emit('close')">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
            BACK
          </button>

          <div class="prof">
            <div class="who">
              <div class="pname">{{ profile.name || "Add your name" }}</div>
              <div class="pmeta mono">
                {{ checkin.entries.length }} DAYS RECORDED
              </div>
            </div>
            <!-- Tapping it again closes: the chip that opened this page sits
                 in exactly this spot at exactly this size, so it should behave
                 like the same object rather than a dead decoration. -->
            <button
              class="avatar mono"
              type="button"
              aria-label="Close settings"
              @click="$emit('close')"
            >
              {{ profile.initials }}
            </button>
          </div>
        </div>

        <!-- **Said once, on the first open, rather than as a tour step.** A
             tour step about settings had to open settings to point at it, which
             made the last thing the tour did a jump to another screen; and it
             could only ever be seen by somebody who sat through five steps
             first. This is read by everyone who gets here, however they got
             here, and then never again. -->
        <div v-if="showIntro" class="intro">
          <p class="itext">
            Everything here is yours to set: your goals, which rings show on
            Home, the units, and how the app looks. None of it has to be decided
            now.
          </p>
          <button class="idismiss mono" type="button" @click="dismissIntro">GOT IT</button>
        </div>

        <!-- First, above everything. Nothing else in settings matters until the
             strap is connected: without it Recovery, sleep and every vital have
             nothing to read, so a page that opened with a name field was
             offering the least important control at the top. -->
        <DevicePanel :open="openSection === 'device'" @toggle="toggle('device')" />

        <!-- Option C of three mocked up 2026-08-17: the rows you come back to are
             on the page, the rows you set once fold behind SETUP below them.

             **The strap stays above this group rather than inside SETUP**, on the
             user's call and for the reason its own comment gives: it is the row
             you need on the day it stops working, and a set-once group is exactly
             where it must not be that morning. The mockup had it folded in, with a
             note that it would have to climb back out by itself on a failure; not
             putting it in is the simpler answer to the same problem. -->
        <GoalsPanel :open="openSection === 'goals'" @toggle="toggle('goals')" />

        <DialsPanel :open="openSection === 'dials'" @toggle="toggle('dials')" />

        <!-- Only once the strap is set up: an alarm needs the pairing key, and
             a panel offering to write one without it could only ever fail. -->
        <AlarmPanel
          v-if="helio.connected"
          :open="openSection === 'alarm'"
          @toggle="toggle('alarm')"
        />

        <!-- **One card, not five.** Open, the group's rows have to read as being
             inside it rather than as four more drawers that appeared at the same
             level, which is what a row of siblings looked like. So the group is a
             single `.panel`: SETUP is its header and the rows are rows in it,
             hairline-separated and inset, exactly like every other multi-row card
             in the app. Passing `nested` is what drops each row's own surface, so
             this is still one container rather than a card inside a card.

             The group keeps its own flag rather than a value of `openSection`,
             because that ref is one-open-at-a-time and opening a child would
             otherwise close the group the child lives in. -->
        <div class="panel setupgroup" :class="{ open: setupOpen }">
          <button
            class="grouprow"
            :class="{ open: setupOpen }"
            type="button"
            :aria-expanded="setupOpen"
            @click="toggleSetup"
          >
            <span class="grouptitle mono">SETUP</span>
            <span class="groupright">
              <span class="groupsum mono">
                {{ setupOpen ? "4 THINGS YOU SET ONCE" : "YOU, UNITS, THEME, TRIPS" }}
              </span>
              <svg
                class="groupcaret"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>

        <!-- Both fields were only ever askable at first run, so anyone already
             past it could not set or correct them. Date of birth needs a way in
             particularly: it arrived after this user was onboarded, so without
             this panel there was no way for him to enter it at all. -->
        <SettingsSection
          v-if="setupOpen"
          nested
          title="YOU"
          :summary="profile.name ? profile.name.toUpperCase() : 'NOT SET'"
          :open="openSection === 'you'"
          @toggle="toggle('you')"
        >
          <label class="flabel mono" for="set-name">NAME</label>
          <input
            id="set-name"
            v-model="youDraft.name"
            class="pfield mono"
            type="text"
            maxlength="40"
            placeholder="YOUR NAME"
          />
          <label class="flabel mono" for="set-dob">DATE OF BIRTH</label>
          <input
            id="set-dob"
            v-model="youDraft.dob"
            class="pfield mono"
            type="date"
            :max="todayIso"
            min="1900-01-01"
          />
          <!-- **Fields only, no explanatory paragraphs.** They said why each
               one is wanted, which is first run's job: by the time somebody is
               editing them in settings they have already decided to give them,
               and three paragraphs between four inputs made a short form read as
               a long one. -->
          <label class="flabel mono">SEX</label>
          <div class="sexrow">
            <button
              v-for="opt in ['male', 'female']"
              :key="opt"
              class="sexbtn mono"
              :class="{ on: youDraft.sex === opt }"
              type="button"
              @click="youDraft.sex = youDraft.sex === opt ? '' : opt"
            >
              {{ opt.toUpperCase() }}
            </button>
          </div>

          <!-- Here as well as in first run, because everybody already using
               Atlas came through a first run that never asked. Without this the
               only route to a height is a reinstall, which wipes the archive. -->
          <label class="flabel mono" for="set-height">HEIGHT</label>
          <!-- `pfield`, which is what the name and date fields above use. It was
               `field`, a class this panel does not define at all, so the input
               fell back to the browser's own and sat in the middle of a column of
               Atlas ones looking like a mistake.

               The unit rides inside the box rather than in the label, so what is
               typed and what it is measured in read as one thing, and the box is
               sized to the three digits it takes rather than the full width: a
               full-bleed field invites a sentence. -->
          <span class="unitfield">
            <input
              id="set-height"
              v-model="youDraft.heightCm"
              class="pfield mono"
              type="number"
              inputmode="numeric"
              min="120"
              max="230"
              placeholder="178"
            />
            <span class="unitsuffix mono">CM</span>
          </span>

          <!-- **Saved on a button, not on every change event.** These four
               fields were each written the moment they blurred, so half a typed
               height was a stored height, tabbing away from a date picker mid-edit
               committed it, and nothing on screen ever said whether a change had
               taken. Four fields that belong to one person are one decision.

               The button says what will happen and is disabled when nothing has,
               so it doubles as the answer to "did that save". -->
          <div class="btnrow">
            <button
              class="databtn mono primary"
              type="button"
              :disabled="!youDirty"
              @click="saveYou"
            >
              {{ youSaved ? "SAVED" : "SAVE DETAILS" }}
            </button>
            <button class="databtn mono" type="button" :disabled="!youDirty" @click="resetYou">
              DISCARD
            </button>
          </div>
        </SettingsSection>

        <UnitsPanel
          v-if="setupOpen"
          nested
          :open="openSection === 'units'"
          @toggle="toggle('units')"
        />

        <SettingsSection
          v-if="setupOpen"
          nested
          title="APPEARANCE"
          :summary="activeTheme.label.toUpperCase()"
          :open="openSection === 'theme'"
          @toggle="toggle('theme')"
        >
          <div class="themerow">
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="tdot"
              :class="{ on: theme.current === t.id }"
              :style="{
                borderColor: swatchColor(t.id),
                background: swatchBg(t.id),
              }"
              :aria-label="t.label"
              @click="theme.setTheme(t.id)"
            >
              <span class="tcore" :style="{ background: swatchColor(t.id) }" />
            </button>
          </div>
          <div class="tsub mono">{{ activeTheme.sub.toUpperCase() }}</div>
        </SettingsSection>


        <!-- A trip is annotation rather than configuration: it changes nothing
             about how Atlas behaves, only how a gap in a chart is labelled once
             one has appeared. Which is what makes it set-once-and-forget, so it
             moved up from below DATA to join the group rather than sitting under
             the one row on this page that can lose everything. -->
        <SettingsSection
          v-if="setupOpen"
          nested
          title="TRIPS // GAPS"
          :summary="`${trips.trips.length} LOGGED`"
          :open="openSection === 'trips'"
          @toggle="toggle('trips')"
        >
          <div class="dim-text mono">
            NAMES THE GAPS IN HISTORY CHARTS.
          </div>
          <button class="databtn mono trips" @click="tripManagerOpen = true">MANAGE TRIPS</button>
        </SettingsSection>
        </div>
        <!-- /setupgroup -->

        <!-- **Below the group, and named for what it does.** It was called
             DATA // BACKUP with a summary of "JSON", which described the file
             format of the one row here that can lose everything while looking
             exactly like the theme picker two rows up. It now says what it does
             and how much is at stake.

             **Not painted red, and that was a real mistake worth recording.** It
             carried `danger`, which colours the summary in --bad - so the only red
             thing on the row was the reading count, a neutral fact, while the row
             itself went unmarked. Red there reads as a call to action, drawing the
             eye to the one row you should least casually tap. The destruction is
             already marked where it happens: the confirm button behind the import
             prompt is `databtn danger`, after a prompt naming what it replaces.
             Backing up is safe; only restoring is not, and only that is red. -->
        <SettingsSection
          title="BACK UP OR RESTORE"
          :summary="archiveSummary"
          :open="openSection === 'data'"
          @toggle="toggle('data')"
        >
          <div class="btnrow">
            <button class="databtn mono" @click="doExport">EXPORT</button>
            <button class="databtn mono" @click="fileInput.click()">
              IMPORT
            </button>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept=".json,application/json,.xlsx"
            class="hidden-input"
            @change="onImportFile"
          />
          <div v-if="pendingImport" class="confirm">
            <div class="dim-text mono">
              BACKUP FROM {{ pendingImport.exportedAt }} - IMPORTING REPLACES
              ALL CURRENT DATA. CONTINUE?
            </div>
            <!-- Says what the file actually holds before it is trusted. A v1
                 file carries no archive at all, and restoring one over a device
                 with readings on it would replace the settings and silently
                 leave the archive as it was. -->
            <div class="dim-text mono">
              {{ importScope }}
            </div>
            <div class="btnrow">
              <button
                class="databtn danger mono"
                :disabled="restoring"
                @click="doRestore"
              >
                {{ restoring ? "RESTORING…" : "REPLACE ALL" }}
              </button>
              <button class="databtn mono" @click="pendingImport = null">
                CANCEL
              </button>
            </div>
          </div>
          <div v-if="v10Pending" class="confirm">
            <div class="dim-text mono">
              V10 EXPORT: {{ v10Pending.summary.healthRows }} HEALTH ROWS ·
              {{ v10Pending.summary.weightRows }} WEIGHTS ·
              {{ v10Pending.summary.from }} → {{ v10Pending.summary.to
              }}<template v-if="v10Pending.summary.skipped">
                · {{ v10Pending.summary.skipped }} ROWS SKIPPED</template
              >. EXISTING ATLAS DATA ALWAYS WINS - MERGE?
            </div>
            <div class="btnrow">
              <button class="databtn mono" @click="doV10Merge">MERGE</button>
              <button class="databtn mono" @click="v10Pending = null">
                CANCEL
              </button>
            </div>
          </div>
        </SettingsSection>

        <!-- Last, and a row rather than a section: it does one thing, and
             opening a panel to find a single button would be the same
             discoverability problem one level down. -->
        <button class="panel tourrow" type="button" @click="ui.startTour()">
          <span class="trtitle">TOUR</span>
          <span class="trsub mono">A SHORT WALK THROUGH THE HOME SCREEN</span>
        </button>

        <!-- **Only ever present when there is genuinely something newer**, so it
             cannot become another permanent row nobody reads. It sits beside the
             version rather than at the top of the page: somebody who has come
             here to check what they are running is exactly who this answers.
             There is no in-app installer - Atlas is a sideloaded APK - so the
             honest action is "open the releases page". -->
        <a
          v-if="update"
          class="panel updaterow"
          :href="update.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="uptitle">ATLAS {{ update.latest }} IS AVAILABLE</span>
          <span class="upsub mono">
            YOU ARE ON {{ appVersion }} &middot; OPENS THE DOWNLOAD PAGE
          </span>
        </a>

        <div class="foot mono">ATLAS v{{ appVersion }}</div>
      </div>
    </div>

    <Transition name="toast">
      <div v-if="backupMsg" class="toast mono">{{ backupMsg }}</div>
    </Transition>
    <TripManager v-if="tripManagerOpen" @close="tripManagerOpen = false" />
  </Teleport>
</template>

<script setup>
import { computed, ref, shallowRef } from "vue";

/**
 * Which section is open, or null for none.
 *
 * One at a time, and the page opens with all of them closed: settings is a list
 * of what can be changed, and you arrive knowing which one you came for.
 */
const openSection = ref(null);
const toggle = (key) => {
  openSection.value = openSection.value === key ? null : key;
};

/**
 * How much there is to lose, for the row that can lose it.
 *
 * Counted rather than derived from anything already in memory, because nothing in
 * memory knows: the archive lives in IndexedDB and the stores hold days, not
 * readings. `countSamples` uses IndexedDB's own `count()`, so this is a number
 * rather than a read of the whole store.
 *
 * **Withheld until it answers**, not shown as 0. A backup row reading
 * "0 READINGS" while the count is still in flight says the archive is empty,
 * which is the one thing it must never say wrongly.
 */
const archiveCount = ref(null);
countSamples()
  .then((n) => {
    archiveCount.value = n;
  })
  .catch(() => {
    // Leave it null. The row still works; it just does not boast about a figure
    // it could not read.
  });

const archiveSummary = computed(() => {
  if (archiveCount.value == null) return "";
  if (archiveCount.value === 0) return "NOTHING STORED YET";
  return `${archiveCount.value.toLocaleString("en-AU")} READINGS`;
});

/**
 * Whether the set-once group is showing.
 *
 * **Its own flag, not a value of `openSection`.** That ref is one-open-at-a-time
 * by design, so if the group used it, opening YOU inside the group would have
 * closed the group and taken YOU with it.
 *
 * Closed on arrival, like every section. The rows in here are the ones you set
 * during first run and then leave alone, so the page opens as three rows and a
 * door rather than as ten rows.
 */
const setupOpen = ref(false);

/** Rows that live inside the group, so collapsing it can tidy up after itself. */
const SETUP_KEYS = ["you", "units", "theme", "trips"];

function toggleSetup() {
  setupOpen.value = !setupOpen.value;
  // A child left open while the group closes would spring back expanded next
  // time the group opens, which reads as the page remembering something you did
  // not ask it to.
  if (!setupOpen.value && SETUP_KEYS.includes(openSection.value)) {
    openSection.value = null;
  }
}
import { useThemeStore, THEMES } from "@/stores/theme";
import { useCheckinStore } from "@/stores/checkin";
import { useProfileStore } from "@/stores/profile";
import { useTripsStore } from "@/stores/trips";
import { exportBackup, readBackupFile, applyBackup } from "@/utils/backup";
import { countSamples } from "@/utils/sampleDb";
import { cachedUpdate, checkForUpdate } from "@/utils/updateCheck";
import { parseV10File, mergeIntoCheckin } from "@/utils/v10import";
import { useBackClose } from "@/composables/useBackClose";
import TripManager from "../layout/TripManager.vue";
import DevicePanel from "./DevicePanel.vue";
import AlarmPanel from "./AlarmPanel.vue";
import SettingsSection from "./SettingsSection.vue";
import GoalsPanel from "./GoalsPanel.vue";
import UnitsPanel from "./UnitsPanel.vue";
import DialsPanel from "./DialsPanel.vue";
import { useHelioStore } from "@/stores/helio";
import { useUIStore } from "@/stores/ui";

const emit = defineEmits(["close"]);
useBackClose(() => emit("close"));

const theme = useThemeStore();
const checkin = useCheckinStore();
const profile = useProfileStore();
const ui = useUIStore();

// Baked in by vite from android/version.properties, so what is on screen is the
// same number as the APK on the releases page rather than a second one that can
// drift. "dev" on a tree with no version file.
const appVersion = __APP_VERSION__;

/**
 * A newer release, or null. Painted from the cache immediately so opening
 * settings never waits on a network call, then refreshed in the background.
 */
const update = shallowRef(cachedUpdate());
// **Forced here, unlike on Home.** Home checks at most once every six hours,
// which is right for something glanced at all day. Settings is the one screen
// somebody opens *to find out what they are running*, and a six-hour-old "no,
// nothing newer" is exactly the wrong answer to give them: it happened on the
// day this shipped, where the app had cached its answer twenty minutes before
// the release went out and would have said nothing until the evening.
checkForUpdate({ force: true }).then((found) => {
  update.value = found;
});
// Opened on whichever section sent us here, so first run's SET IT UP NOW lands
// on the strap panel already expanded rather than on nine collapsed rows.
openSection.value = ui.settingsSection;

// One-time, and stored rather than held in the store: it has to survive a
// reload, and a flag that reset on every launch would be an explainer nobody
// could get rid of.
const INTRO_KEY = "atlas_settings_intro_seen";
const showIntro = ref(localStorage.getItem(INTRO_KEY) !== "1");
function dismissIntro() {
  showIntro.value = false;
  localStorage.setItem(INTRO_KEY, "1");
}
const trips = useTripsStore();
const helio = useHelioStore();
/** No future birthdays; the native picker enforces it rather than a message. */
const todayIso = new Date().toISOString().slice(0, 10);
const tripManagerOpen = ref(false);
const SWATCH_COLORS = {
  sentinel: "#4FE0FF",
  ember: "#FFB000",
  paper: "#C25E2A",
  mission: "#0F62FE",
};
const SWATCH_BGS = {
  sentinel: "#04080f",
  ember: "#0c0803",
  paper: "#f0e7d3",
  mission: "#eef2f7",
};
function swatchColor(id) {
  return SWATCH_COLORS[id];
}
function swatchBg(id) {
  return SWATCH_BGS[id];
}
const activeTheme = computed(
  () => THEMES.find((t) => t.id === theme.current) ?? THEMES[0]
);

const fileInput = ref(null);
const backupMsg = ref("");
/**
 * The YOU panel's four fields, held as a draft until SAVE.
 *
 * Written straight through on every change event before, so a half-typed height
 * was a stored height and nothing said whether an edit had taken. They describe
 * one person and they are one decision.
 */
const youDraft = ref({
  name: profile.name,
  dob: profile.dob,
  sex: profile.sex,
  heightCm: profile.heightCm ?? "",
});
const youSaved = ref(false);

const youDirty = computed(
  () =>
    youDraft.value.name !== profile.name ||
    youDraft.value.dob !== profile.dob ||
    youDraft.value.sex !== profile.sex ||
    String(youDraft.value.heightCm ?? "") !== String(profile.heightCm ?? "")
);

function saveYou() {
  profile.setName(youDraft.value.name);
  profile.setDob(youDraft.value.dob);
  profile.setSex(youDraft.value.sex);
  profile.setHeight(youDraft.value.heightCm);
  // Back off the store, not off the draft: `setHeight` range checks and can
  // refuse, so echoing the draft would show a height that was not kept.
  resetYou();
  youSaved.value = true;
  setTimeout(() => (youSaved.value = false), 1600);
}

function resetYou() {
  youDraft.value = {
    name: profile.name,
    dob: profile.dob,
    sex: profile.sex,
    heightCm: profile.heightCm ?? "",
  };
}

/**
 * **`shallowRef`, and the whole archive restore depends on it.**
 *
 * A plain `ref` makes what you assign to it *deeply* reactive, so every one of
 * the ninety thousand rows inside a parsed backup came back out as a Vue Proxy.
 * A Proxy cannot be structured-cloned, and structured clone is what IndexedDB
 * uses, so `store.put(row)` threw `DataCloneError: ... could not be cloned` and
 * the restore died on the first chunk. Nothing here needs the file to be
 * reactive: the template reads a handful of fields off it, which a shallow ref
 * still updates on assignment.
 *
 * **Nothing could have caught this in tests.** Every test uses fake-indexeddb,
 * which does not implement the structured clone algorithm, so a proxy sails
 * through it. And a v1 backup never touched IndexedDB at all, so the failure
 * arrived with the v2 archive on 2026-08-12 and the archive half of the backup
 * had never once worked on a real device until it was tried on 2026-08-13.
 * `applyBackup` also unwraps defensively now, so a future caller reintroducing a
 * deep ref does not silently break it again.
 */
const pendingImport = shallowRef(null);
const restoring = ref(false);

/**
 * What is actually in the file, before it is trusted.
 *
 * A v1 backup has no archive section, so restoring one leaves every reading
 * where it was while replacing everything else. That is a coherent thing to
 * want and a terrible thing to discover afterwards.
 */
const importScope = computed(() => {
  const file = pendingImport.value;
  if (!file) return "";
  const n = file.archive?.samples?.length;
  return n
    ? `INCLUDES ${n.toLocaleString("en-AU")} READINGS.`
    : "SETTINGS AND LOGS ONLY. THIS FILE HAS NO SAMPLE ARCHIVE IN IT, SO YOUR READINGS WILL BE LEFT AS THEY ARE.";
});

async function doRestore() {
  if (restoring.value) return;
  restoring.value = true;
  try {
    // Awaited, and the button is held disabled meanwhile: a year of readings is
    // written in chunks and the page reloads itself at the end, so a second tap
    // would start a second restore over a half-finished one.
    await applyBackup(pendingImport.value);
  } catch (e) {
    restoring.value = false;
    backupMsg.value = `RESTORE FAILED: ${e?.message || e}`;
  }
}

async function doExport() {
  const res = await exportBackup();
  backupMsg.value = res.msg;
  // Errors can be a full sentence (the real exception text, not just
  // "SEE CONSOLE") - give it long enough to actually read on a phone.
  setTimeout(() => (backupMsg.value = ""), res.ok ? 3000 : 8000);
}

const v10Pending = ref(null);

// One IMPORT button, routed by file type: .json restores an Atlas backup,
// .xlsx runs the one-time v10 migration merge.
async function onImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  pendingImport.value = null;
  v10Pending.value = null;
  try {
    if (/\.xlsx$/i.test(file.name)) {
      v10Pending.value = await parseV10File(file);
    } else {
      pendingImport.value = await readBackupFile(file);
    }
  } catch (problem) {
    const reason = (problem?.message ?? String(problem)).toUpperCase();
    backupMsg.value = `IMPORT FAILED - ${reason}`;
    setTimeout(() => (backupMsg.value = ""), 4000);
  }
}

function doV10Merge() {
  const res = mergeIntoCheckin(checkin, v10Pending.value);
  v10Pending.value = null;
  backupMsg.value = `MERGED ${res.datesTouched}/${res.datesInFile} DATES · ${res.fieldsFilled} FIELDS`;
  setTimeout(() => (backupMsg.value = ""), 6000);
}
</script>

<style scoped>
.intro {
  margin-bottom: 12px;
  padding: 14px 16px 10px;
  background: color-mix(in srgb, var(--acc) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--acc) 32%, transparent);
  border-radius: 10px;
}
.intro .itext {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--body);
}
.idismiss {
  margin-top: 8px;
  margin-left: -6px;
  min-height: 38px;
  padding: 0 6px;
  background: none;
  border: 0;
  color: var(--acc);
  font-size: 10.5px;
  letter-spacing: 1.8px;
  cursor: pointer;
}

/* Uses .panel so it is the same surface as every section around it, and the
   whole row is the button: a chevron or a small CTA inside a panel would make
   the thing you must tap smaller than the thing you can see. */
.tourrow {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.tourrow .trtitle {
  font-size: 13px;
  color: var(--acc);
  letter-spacing: 0.5px;
}
.tourrow .trsub {
  font-size: 10px;
  letter-spacing: 1.4px;
  color: var(--dim);
}

/* The update row borrows the tour row's shape, because it is the same kind of
   thing: one row, one action, no panel to open. It takes --acc rather than a
   warning colour - a newer version is an offer, not a fault. */
.updaterow {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  margin-top: 10px;
  padding: 14px 16px;
  text-decoration: none;
  border: 1px solid color-mix(in srgb, var(--acc) 40%, transparent);
}
.updaterow .uptitle {
  font-size: 13px;
  color: var(--acc);
  letter-spacing: 0.5px;
}
.updaterow .upsub {
  font-size: 10px;
  letter-spacing: 1.4px;
  color: var(--dim);
}

.page {
  position: fixed;
  inset: 0;
  z-index: 600;
  /* Same gradient as the app behind it, anchored to the viewport, so moving
     here does not read as a different surface. */
  background-image: var(--page-bg);
  background-size: 100vw 100vh;
  background-position: 0 0;
  background-repeat: no-repeat;
  display: flex;
  flex-direction: column;
  /* Safe-area padding on the shell, never on the scrolling child: on the child
     the inset scrolls away with the content and panels ride up under the
     status icons. */
  /* Matches every tab's own padding, so the avatar sits in the same place
     before and after the page opens rather than jumping a few pixels. */
  padding: calc(12px + env(safe-area-inset-top)) 18px
    calc(20px + env(safe-area-inset-bottom));
  overflow: hidden;
  color: var(--body);
  font-family: var(--font-sans);
  animation: pagein 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes pagein {
  from { opacity: 0; transform: translateY(8px); }
}
@media (prefers-reduced-motion: reduce) {
  .page { animation: none; }
}
.pscroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* .page already clips (overflow: hidden), so the overscan alone hides the
     Android overlay scroll bar. See --sb-overscan in style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: var(--sb-overscan);
}
.phd {
  display: flex;
  /* Top-aligned, not centred: it makes the avatar's top edge exactly the
     page's padding top, which is the same origin Home anchors its chip to.
     Centring would offset it by half the difference between the row height
     and the circle. */
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 22px;
}
.back {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--acc) 45%, transparent);
  color: var(--acc);
  font-size: 9px;
  letter-spacing: 1.8px;
  cursor: pointer;
  position: relative;
}
.back svg {
  width: 12px;
  height: 12px;
}
/* The box is smaller than a 48dp target, so the target is extended outward
   rather than by padding, which would inflate the box itself. */
.back::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  min-width: 48px;
  width: 100%;
  height: 48px;
  transform: translate(-50%, -50%);
}
.back:active {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.back:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.prof {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.who {
  text-align: right;
  min-width: 0;
}
.avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--acc);
  color: var(--bg1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  letter-spacing: 0.3px;
  line-height: 1;
  cursor: pointer;
  position: relative;
}
.avatar::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  transform: translate(-50%, -50%);
}
.avatar:active {
  opacity: 0.75;
}
.avatar:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.pname {
  font-size: 16px;
  line-height: 1.2;
  color: var(--ink);
  /* A long name shortens rather than pushing the avatar off the row. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pmeta {
  font-size: 8px;
  letter-spacing: 1.4px;
  color: var(--dim);
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.themerow {
  display: flex;
  gap: 10px;
  margin-top: 2px;
}
.tdot {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border-width: 2px;
  border-style: solid;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0.65;
}
.tdot.on {
  opacity: 1;
  box-shadow: 0 0 12px color-mix(in srgb, var(--acc) 45%, transparent);
  outline: 1px solid color-mix(in srgb, var(--ink) 40%, transparent);
  outline-offset: 2px;
}
.tcore {
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
}
.tsub {
  font-size: 9px;
  letter-spacing: 2px;
  margin-top: 8px;
  color: var(--dim);
}
/* outranks the global .panel-hd span:last-child dim colour */
/* Clear of the line above it: the button sat hard against the explainer. */
.sexrow {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}
.sexbtn {
  flex: 1;
  min-height: 44px;
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  background: none;
  color: var(--dim);
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
}
.sexbtn.on {
  color: var(--bg1);
  background: var(--acc);
  border-color: var(--acc);
}
/* The group's card. One surface holding the header and its rows, so what is
   inside SETUP reads as inside it. Closed it is indistinguishable from any other
   settings row, which is the point: it only becomes a container once it has
   something to contain. */
.setupgroup {
  padding: 0;
  margin-bottom: 10px;
  /* clip, not hidden, for the same reason SettingsSection gives: hidden would
     make this a scroll container and let a slightly-too-wide child scroll inside
     the card instead of being laid out to fit it. */
  overflow: clip;
}
/* Its header. Deliberately the same metrics and type as SettingsSection's own
   header, including the 2026-08-17 size bump, so the door looks like the rows it
   opens. If those move, these move with them. */
.grouprow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  margin: 0;
  padding: 0 14px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  letter-spacing: 1.6px;
}
/* Open, the header takes the accent its contents are gathered under, which is the
   one cue that survives being scrolled past. */
.grouprow.open .grouptitle {
  color: var(--acc);
}
/* Same nowrap reasoning as SettingsSection's .title. */
.grouptitle {
  color: var(--ink);
  white-space: nowrap;
  flex: none;
}
.groupright {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--dim);
}
/* A step below the title, matching SettingsSection's .summary. */
.groupsum {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  letter-spacing: 1px;
}
.groupcaret {
  width: 15px;
  height: 15px;
  flex: none;
  transition: transform 140ms ease;
}
.grouprow.open .groupcaret {
  transform: rotate(180deg);
}
.databtn.trips {
  margin-top: 12px;
}
.panel-hd span.manage {
  cursor: pointer;
  color: var(--acc);
}
.btnrow {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.databtn {
  flex: 1;
  text-align: center;
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--acc);
  border: 1px solid color-mix(in srgb, var(--acc) 40%, transparent);
  padding: 8px 0;
}
.databtn.danger {
  color: var(--bad);
  border-color: color-mix(in srgb, var(--bad) 50%, transparent);
}
.databtn:disabled {
  opacity: 0.4;
}
.hidden-input {
  display: none;
}
.confirm {
  margin-top: 10px;
  border-top: 1px dashed color-mix(in srgb, var(--acc) 25%, transparent);
  padding-top: 8px;
}
.confirm .dim-text {
  margin-bottom: 8px;
  line-height: 1.5;
}
.dim-text {
  color: var(--dim);
  font-size: 11px;
  font-weight: 400;
}
.dim-text.syncerr {
  color: var(--bad);
  margin-top: 4px;
}
.foot {
  margin-top: auto;
  padding-top: 18px;
  font-size: 8px;
  letter-spacing: 2px;
  color: var(--dim);
  text-align: center;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(28px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 700;
  /* Wide enough that the routine sync results stay on one line. Failure
     messages carry an arbitrary error string and may still wrap. */
  max-width: 310px;
  padding: 11px 18px;
  font-size: 11px;
  letter-spacing: 1.5px;
  text-align: center;
  color: var(--ink);
  background: color-mix(in srgb, var(--bg1) 92%, black);
  border: 1px solid var(--acc);
  box-shadow: 0 0 18px color-mix(in srgb, var(--acc) 55%, transparent);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.flabel {
  display: block;
  font-size: 9.5px;
  letter-spacing: 1.4px;
  color: var(--dim);
  margin: 4px 0 5px;
}
.pfield {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 6px;
  padding: 9px;
  background: var(--bg0);
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  color: var(--ink);
  font-size: 12px;
  letter-spacing: 0.06em;
}
.pfield:focus {
  outline: none;
  border-color: var(--acc);
}

/* A short field with its unit inside it. Sized to its content, because 178 in a
   full-width box reads as the start of something longer. */
.unitfield {
  position: relative;
  display: inline-block;
  width: 118px;
}
.unitfield .pfield {
  margin-bottom: 0;
  padding-right: 34px;
  text-align: left;
}
/* The number spinners are noise on a field with a fixed unit, and on Android
   they eat a third of the width. */
.unitfield .pfield::-webkit-outer-spin-button,
.unitfield .pfield::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
.unitfield .pfield[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}
.unitsuffix {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  letter-spacing: 1.2px;
  color: var(--dim);
  pointer-events: none;
}
.dim-note {
  margin-top: 6px;
  font-size: 9px;
  letter-spacing: 0.08em;
  line-height: 1.6;
  color: var(--dim);
}
</style>
