<template>
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>{{ workoutDateTimeLabel(workout.startMillis) }}</span
          ><span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <!-- Naming leads. The band's own numbers are already right and are not
             why this sheet gets opened; what it was is the thing only you know,
             and it is what the month's totals are waiting on. -->
        <button type="button" class="typebtn" @click="typeOpen = true">
          <span class="tlabel mono">TYPE</span>
          <span class="tvalue" :class="{ unset: !typeName }">
            {{ typeName || "NAME THIS SESSION" }}
          </span>
          <span class="tchev">›</span>
        </button>

        <label class="notewrap">
          <span class="tlabel mono">NOTE</span>
          <textarea
            v-model="note"
            class="note"
            rows="2"
            placeholder="Anything a type cannot carry"
            @blur="saveNote"
          ></textarea>
        </label>

        <!-- The evening, not just the logged part. The band stops counting
             during the standing around, so the only way to see where a session
             actually ended is to look at where the heart rate came back down.
             The dashed line is the end you have chosen; the stepper below moves
             it. -->
        <div class="spanline mono">
          <span>{{ clockLabel(shownStartMillis) }}</span>
          <span class="arrow">→</span>
          <span class="endstamp">{{ clockLabel(chosenEndMillis) }}</span>
        </div>
        <!-- The same chart does both jobs: the marker is the end you are
             choosing, or the point you are cutting at. Tapping moves whichever
             one is live, so splitting needs no second way to pick a time. -->
        <SessionHeartChart
          :samples="hrSamples"
          :start-millis="shownStartMillis"
          :end-millis="splitting ? splitDraft : chosenEndMillis"
          @pick-end="splitting ? onPickSplit($event) : onPickTime($event)"
        />

        <!-- Only while splitting. It says what the cut would produce before it
             is made, because the halves' heart rates are recomputed and the
             figures are the whole reason to cut here rather than there. -->
        <div v-if="splitting" class="splitbox">
          <div class="splithd mono">CUT AT {{ clockLabel(splitDraft) }}</div>
          <div v-if="splitPreview" class="splitparts">
            <div v-for="(p, i) in splitPreview" :key="i" class="splitpart mono">
              <span class="pt">{{ clockLabel(p.startMillis) }}–{{ clockLabel(p.endMillis) }}</span>
              <span class="pv">
                {{ workoutDurationLabel(p.activeSeconds) }}
                <template v-if="p.hrMax != null"> · {{ p.hrMax }} MAX</template>
              </span>
            </div>
          </div>
          <div class="dim-text mono">
            TAP THE CHART TO MOVE THE CUT. HEART RATE IS RECOMPUTED PER PART;
            DURATION IS SHARED BY TIME.
          </div>
          <div class="savebar">
            <button type="button" class="action mono" @click="splitting = false">CANCEL</button>
            <button
              type="button"
              class="action save mono"
              :disabled="!splitPreview"
              @click="doSplit"
            >
              SPLIT HERE
            </button>
          </div>
        </div>

        <div class="dim-text mono">
          {{
            workout.typeAutoDetected
              ? "AUTO-DETECTED BY THE BAND"
              : "STARTED FROM THE BAND"
          }}
        </div>

        <div class="fieldlist">
          <!-- Editable, because the band cuts sessions short in one direction:
               it stops counting during the standing around, so a climb reads as
               half its length. The correction is stored beside the record, never
               over it, so a re-sync cannot undo it. -->
          <div class="fieldrow">
            <span class="mono">DURATION</span>
            <span class="durbox">
              <button
                type="button"
                class="step mono"
                aria-label="Five minutes less"
                @click="nudge(-STEP_MINUTES)"
              >
                −
              </button>
              <span class="durval mono">{{ workoutDurationLabel(shownSeconds) }}</span>
              <button
                type="button"
                class="step mono"
                aria-label="Five minutes more"
                @click="nudge(STEP_MINUTES)"
              >
                +
              </button>
            </span>
          </div>
          <!-- **One row that changes what it says, never three that appear and
               disappear.** This sheet is anchored to the bottom of the screen, so
               anything added below the chart pushes the chart UPWARD - and the
               thing that adds it is a tap on the chart. The first tap therefore
               moved the target out from under the finger that made it, and the
               second did not, which is the worst version of both.

               The hint has a natural end anyway: once you have tapped, you know
               you can tap, so the status message replacing it is not a loss. -->
          <div class="editnote mono" :class="{ unsaved: dirty, hint: !dirty && !isEdited }">
            <template v-if="dirty">
              NOT SAVED YET
              <button type="button" class="revert mono" @click="discard">DISCARD</button>
            </template>
            <template v-else-if="isEdited">
              EDITED · THE BAND RECORDED
              {{ workoutDurationLabel(workout.bandActiveSeconds ?? workout.activeSeconds) }}
              <template v-if="workout.bandStartMillis">
                FROM {{ clockLabel(workout.bandStartMillis) }}
              </template>
              <button type="button" class="revert mono" @click="revert">REVERT</button>
            </template>
            <template v-else>TAP EITHER END OF THE SESSION TO MOVE IT</template>
          </div>
          <!-- **How it was derived, where it was derived.** "EST" says a figure
               is not measured and stops there, which left a number built from
               your own heart rate through the session reading exactly like one
               built from an activity name and a clock. Measured on this archive
               those are 4.2% and 9.1% wrong respectively, so they are not the
               same claim. A band figure carries no caption at all, because it is
               a measurement. -->
          <div v-if="calories" class="fieldrow">
            <span class="mono">CALORIES</span>
            <span class="mono">
              {{ calories.kcal }} KCAL
              <span v-if="sourceLabel" class="est">{{ sourceLabel }}</span>
              <span v-else-if="calories.estimated" class="est">EST</span>
            </span>
          </div>
          <!-- Recomputed from the samples across the window you chose, not
               taken from the band: the band's averages describe the band's own
               window, and the whole point of editing is that the window
               changed. Falls back to the band's figures when the archive has
               too few samples to average honestly. -->
          <div v-if="stats || workout.hrAvg != null" class="fieldrow">
            <span class="mono">HEART RATE</span>
            <span class="mono">
              <template v-if="stats">
                {{ stats.avg }} AVG / {{ stats.max }} MAX
              </template>
              <template v-else>
                {{ Math.round(workout.hrAvg) }} AVG
                <template v-if="workout.hrMax != null">
                  / {{ Math.round(workout.hrMax) }} MAX</template
                >
              </template>
            </span>
          </div>
          <div v-if="workout.merged" class="fieldrow">
            <span class="mono">MERGED FROM</span>
            <span class="mono">{{ workout.mergedCount }} RECORDS</span>
          </div>
          <!-- A part says so, and says what the band claimed for the whole
               record: a peak of 203 on a record whose samples top out at 173 is
               exactly the disagreement splitting was built to expose. -->
          <div v-if="workout.split" class="fieldrow">
            <span class="mono">CUT FROM</span>
            <span class="mono">
              ONE RECORD
              <span v-if="workout.bandHrMax != null && workout.hrMax !== workout.bandHrMax">
                · BAND SAID {{ Math.round(workout.bandHrMax) }} MAX
              </span>
            </span>
          </div>
          <div v-if="workout.split && workout.activeSecondsApportioned" class="editnote mono">
            DURATION SHARED BY TIME · THE BAND RECORDED
            {{ workoutDurationLabel(workout.bandActiveSeconds) }} FOR THE WHOLE RECORD
          </div>
          <div v-if="workout.distanceMeters != null" class="fieldrow">
            <span class="mono">DISTANCE</span>
            <span class="mono">{{ (workout.distanceMeters / 1000).toFixed(2) }} KM</span>
          </div>
          <div v-if="workout.altitudeAvgMeters != null" class="fieldrow">
            <span class="mono">AVG ALTITUDE</span>
            <span class="mono">{{ Math.round(workout.altitudeAvgMeters) }} M</span>
          </div>
        </div>

        <!-- Merge is offered only when there is a neighbour close enough to
             plausibly be the same session. Offering it against a session three
             days away would be offering a mistake. -->
        <!-- **Always in the layout, hidden until there is something to save.**
             `v-if` here was the reported jolt: the sheet is anchored to the
             bottom, so the bar arriving pushed the chart up under the finger that
             had just tapped it - and only on the first tap, since after that the
             bar was already there. Reserved rather than removed, so the chart
             cannot move while you are working on it. -->
        <div class="savebar" :class="{ reserved: !dirty }" :aria-hidden="!dirty">
          <button type="button" class="action mono" :disabled="!dirty" @click="discard">
            DISCARD
          </button>
          <button type="button" class="action save mono" :disabled="!dirty" @click="save">
            SAVE {{ workoutDurationLabel(shownSeconds) }}
          </button>
        </div>

        <!-- **Two records of one session, and only one of them is on screen.**
             The band decided this window was a workout and Atlas timed it too;
             the band's is shown by default because it carries the calories, the
             heart-rate summary and its own active time. This is the way to the
             other one, and the choice sticks. -->
        <div v-if="overlap" class="overlap">
          <p class="overlaptext">
            {{ overlapText }}
          </p>
          <button type="button" class="action mono" @click="useOther">
            {{ overlap.showing === "band" ? "USE THE ONE I STARTED" : "USE THE STRAP'S RECORD" }}
          </button>
        </div>

        <div class="actions">
          <button
            v-if="mergeCandidate && !workout.merged"
            type="button"
            class="action mono"
            @click="doMerge"
          >
            MERGE WITH {{ clockLabel(mergeCandidate.startMillis) }}
          </button>
          <!-- "UNMERGE", not "SPLIT BACK INTO": splitting now means cutting one
               record into two activities, and one word for two opposite
               operations in the same list of buttons is how the wrong one gets
               pressed. -->
          <button
            v-if="workout.merged"
            type="button"
            class="action mono"
            @click="doUnmerge"
          >
            UNMERGE INTO {{ workout.mergedCount }} RECORDS
          </button>
          <!-- Offered only on a session long enough to have two activities in
               it. Below that the cut has nowhere to land that leaves two real
               sessions behind. -->
          <button
            v-if="canSplit && !splitting"
            type="button"
            class="action mono"
            @click="startSplit"
          >
            SPLIT INTO TWO SESSIONS
          </button>
          <button
            v-if="workout.split"
            type="button"
            class="action mono"
            @click="doUnsplit"
          >
            UNDO THIS CUT
          </button>
          <!-- **Replaced by the confirm rather than sitting above it.** With both
               on screen there were three buttons at once and two of them said
               delete, so the question "are you sure" was being asked next to the
               control that asked it. The confirm takes this button's place. -->
          <button
            v-if="!confirmingDelete"
            type="button"
            class="action danger mono"
            @click="confirmingDelete = true"
          >
            DELETE THIS SESSION
          </button>
        </div>

        <!-- Confirmed in place rather than with a system dialog: the sheet
             already owns the screen, and this says what deleting actually
             does, which is not what the word implies. -->
        <div v-if="confirmingDelete" class="confirm">
          <p class="confirmtext">
            The band's own record stays; Atlas stops showing it, and its time
            leaves your totals. You can undo this from the same place.
          </p>
          <div class="confirmrow">
            <button type="button" class="action mono" @click="confirmingDelete = false">
              KEEP IT
            </button>
            <button type="button" class="action danger mono" @click="doDelete">
              DELETE
            </button>
          </div>
        </div>
      </div>

      <SessionTypeSheet
        v-if="typeOpen"
        :current-type-id="annotation?.typeId ?? null"
        @close="typeOpen = false"
        @pick="onPickType"
      />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch, onMounted } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import { useSessionsStore } from "@/stores/sessions";
import { pairContaining } from "./sessionOverlap";
import { getSamples } from "@/utils/sampleDb";
import { calorieSourceLabel } from "@/utils/sessionCalories";
import { workoutDateTimeLabel, workoutDurationLabel } from "./workouts";
import {
  heartStats,
  scaledCalories,
  edgeNearest,
  clockLabel,
  PAD_BEFORE_MS,
  PAD_AFTER_MS,
} from "./sessionHeart";
import { splitWorkout } from "./splitSessions";
import SessionTypeSheet from "./SessionTypeSheet.vue";
import SessionHeartChart from "./SessionHeartChart.vue";

const props = defineProps({
  workout: { type: Object, required: true },
  /** Every session on the tab, so merge can find a neighbour. */
  siblings: { type: Array, default: () => [] },
  /**
   * The band's own records, unresolved.
   *
   * Needed because the other half of an overlapping pair has already been
   * suppressed by `resolveSessions` before anything rendered, so it cannot be
   * found among the siblings.
   */
  bandRecords: { type: Array, default: () => [] },
});
const emit = defineEmits(["close", "changed"]);
useBackClose(() => emit("close"));

const confirmingDelete = ref(false);

/**
 * The other record of this session, if the band and Atlas both have one.
 *
 * Computed from the raw band records rather than the sibling list, because the
 * loser of a pair is dropped before the list is built - it cannot be a sibling.
 */
const overlap = computed(() =>
  pairContaining(props.workout, sessions.manualSessions, props.bandRecords)
);

const overlapText = computed(() => {
  if (!overlap.value) return "";
  const other = overlap.value.showing === "band" ? overlap.value.manual : overlap.value.band;
  const from = new Date(other.startMillis).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const mins = Math.round((other.endMillis - other.startMillis) / 60000);
  return overlap.value.showing === "band"
    ? `You also started a session for this, from ${from} for ${mins} minutes. The strap's own record is shown because it measured calories and heart rate.`
    : `The strap also recorded this, from ${from} for ${mins} minutes, with its own calories and heart rate.`;
});

function useOther() {
  // Recorded against the manual session either way: the band overwrites its
  // workouts on every sync, so a choice filed there would not survive one.
  sessions.setOverlapChoice(
    overlap.value.manual.startMillis,
    overlap.value.showing === "band" ? "manual" : "band"
  );
  emit("changed");
  emit("close");
}

/**
 * The nearest session that could plausibly be the same one.
 *
 * Within three hours either side, because a band that splits a climb resumes
 * within minutes, not the next morning. Offering a merge against a session
 * three days away would be offering a mistake with a button.
 */
const MERGE_WINDOW_MS = 3 * 60 * 60 * 1000;

const mergeCandidate = computed(() => {
  const mine = props.workout.startMillis;
  return (
    props.siblings
      .filter((s) => s.startMillis !== mine)
      .filter((s) => Math.abs(s.startMillis - mine) <= MERGE_WINDOW_MS)
      .sort((a, b) => Math.abs(a.startMillis - mine) - Math.abs(b.startMillis - mine))[0] ??
    null
  );
});

function doMerge() {
  const other = mergeCandidate.value;
  if (!other) return;
  sessions.merge([annotationKey.value, other.startMillis]);
  emit("changed");
  emit("close");
}

function doUnmerge() {
  sessions.unmerge(annotationKey.value);
  emit("changed");
  emit("close");
}

// ── cutting one record into two activities ────────────────────────────────
//
// The case it exists for: 2026-08-04 arrived as a single 17:33-20:31 record
// covering a gym session that ended about 20:07 and the walk home. Both
// boundaries are the band's and both are defensible on heart rate; what Atlas
// could not do was say they were two things.
//
// Cuts are stored against the **record**, not against the part on screen, since
// the part is something resolveSessions produced and does not exist in storage.
const recordStart = computed(() => props.workout.splitOf ?? props.workout.startMillis);

/**
 * The key every annotation is stored under, which is NOT the start being shown.
 *
 * Once a start can be corrected, `workout.startMillis` is the corrected one and
 * writing against it would file the label under a timestamp no record has. The
 * record's own start never moves, which is the whole reason the correction is
 * stored as an override rather than applied to the record.
 */
const annotationKey = computed(() => props.workout.recordStartMillis ?? props.workout.startMillis);

/** Under twenty minutes there is nowhere to cut that leaves two real sessions. */
const MIN_SPLITTABLE_MS = 20 * 60 * 1000;
const spanMillis = computed(
  () => (props.workout.endMillis ?? props.workout.startMillis) - props.workout.startMillis
);
const canSplit = computed(() => spanMillis.value >= MIN_SPLITTABLE_MS);

const splitting = ref(false);
const splitDraft = ref(null);

function startSplit() {
  // Opens at the middle rather than at either end, which is the one position
  // that is never already a boundary and never produces an empty half.
  splitDraft.value = props.workout.startMillis + Math.round(spanMillis.value / 2);
  splitting.value = true;
}

/**
 * Move the cut, kept clear of both ends.
 *
 * Five minutes of clearance rather than one, because a two-minute session is
 * not a session and the chart is tapped with a thumb.
 */
function onPickSplit(atMillis) {
  if (atMillis == null) return;
  const edge = 5 * 60 * 1000;
  const end = props.workout.endMillis ?? props.workout.startMillis;
  splitDraft.value = Math.min(Math.max(atMillis, props.workout.startMillis + edge), end - edge);
}

/** The two halves as they would be saved, or null when the cut is not usable. */
const splitPreview = computed(() =>
  splitting.value ? splitWorkout(props.workout, splitDraft.value, hrSamples.value) : null
);

function doSplit() {
  const parts = splitPreview.value;
  if (!parts) return;

  // The measurement is taken now, while the samples are in hand, and stored
  // beside the cut. Nothing can recompute it later: every reader of a session
  // list is synchronous and the samples are in IndexedDB, and samples past 90
  // days are downsampled, so a peak recomputed next quarter would be quietly
  // lower than this one.
  const stats = {};
  for (const part of parts) {
    if (!part.hrRecomputed) continue;
    stats[part.startMillis] = {
      hrAvg: part.hrAvg,
      hrMax: part.hrMax,
      hrMin: part.hrMin,
      samples: part.hrSampleCount,
    };
  }

  sessions.splitAt(recordStart.value, splitDraft.value, stats);
  splitting.value = false;
  emit("changed");
  emit("close");
}

function doUnsplit() {
  sessions.unsplit(recordStart.value, props.workout.splitAt);
  emit("changed");
  emit("close");
}

function doDelete() {
  sessions.setHidden(annotationKey.value, true);
  // Members of a merge go with it, or splitting a deleted session later would
  // resurrect halves of something already thrown away.
  for (const start of sessions.membersOf(annotationKey.value)) {
    sessions.setHidden(start, true);
  }
  emit("changed");
  emit("close");
}

const sessions = useSessionsStore();
const typeOpen = ref(false);

const annotation = computed(() => sessions.annotationFor(annotationKey.value));
const typeName = computed(() => sessions.typeNameFor(props.workout));
const note = ref(annotation.value?.note ?? "");

function onPickType(typeId) {
  sessions.setType(annotationKey.value, typeId);
  typeOpen.value = false;
}

// On blur rather than on every keystroke: this writes to localStorage, and a
// note is finished when you look away from it.
function saveNote() {
  sessions.setNote(annotationKey.value, note.value);
}

const override = computed(() => annotation.value?.activeSecondsOverride ?? null);
const isEdited = computed(() => override.value != null);

/**
 * The duration being tried out, which is not yet the duration.
 *
 * Dragging along the chart writes a new value every few pixels, and committing
 * each one would leave whatever you happened to release on as the answer, with
 * no way back to what it was. So the drag, the stepper and the tap all move a
 * draft, and nothing reaches the store until SAVE. Closing the sheet throws the
 * draft away, which is what makes experimenting on the chart safe.
 */
const draftSeconds = ref(null);

/**
 * The start being tried out, which is not yet the start.
 *
 * Same reasoning as the duration draft: tapping the chart writes a value every
 * time, and committing each one would leave whatever you last touched as the
 * answer with no way back. Nothing reaches the store until SAVE.
 */
const draftStartMillis = ref(null);
const shownStartMillis = computed(
  () => draftStartMillis.value ?? props.workout.startMillis
);
const shownSeconds = computed(
  () => draftSeconds.value ?? override.value ?? props.workout.activeSeconds
);
const dirty = computed(
  () =>
    (draftSeconds.value != null &&
      draftSeconds.value !== (override.value ?? props.workout.activeSeconds)) ||
    (draftStartMillis.value != null && draftStartMillis.value !== props.workout.startMillis)
);

function save() {
  if (!dirty.value) return;
  // The start first: the duration is measured from it, so writing them the
  // other way round would store a length against the old start for an instant.
  if (draftStartMillis.value != null) {
    sessions.setStart(
      annotationKey.value,
      draftStartMillis.value === props.workout.bandStartMillis ? null : draftStartMillis.value
    );
  }
  if (draftSeconds.value != null) sessions.setDuration(annotationKey.value, draftSeconds.value);
  draftSeconds.value = null;
  draftStartMillis.value = null;
  emit("changed");
}

function discard() {
  draftSeconds.value = null;
  draftStartMillis.value = null;
}

// Five minutes. Fifteen was chosen when the stepper was the only way to set
// this, and it was too coarse to land on the point where the heart rate came
// down. Tapping the chart now does the coarse move, so the buttons are free to
// be the fine one.
const STEP_MINUTES = 5;

function nudge(minutes) {
  const base = shownSeconds.value ?? 0;
  draftSeconds.value = Math.max(60, base + minutes * 60);
}

/**
 * Set the end from a tap on the chart.
 *
 * Floored at five minutes so a tap left of the start cannot produce a session
 * of zero length, and rounded to the same five-minute grid the stepper uses, or
 * tapping and then nudging would drift off it.
 */
/**
 * A tap on the chart moves whichever end it was nearest.
 *
 * It used to always mean the end, which made the band starting late
 * uncorrectable: the only editable edge was the one that was already right. The
 * position decides, because a tap out in the run-up can only be about the start
 * and one past the finish can only be about the end.
 */
function onPickTime(atMillis) {
  if (atMillis == null) return;
  const step = STEP_MINUTES * 60;
  // The start being shown, not the draft. Reading the draft meant the FIRST tap
  // always worked from null: `edgeNearest` compared a real timestamp against an
  // end of a few thousand milliseconds, decided "end", and set a duration of
  // fifty-odd years - which the header then printed as a plausible-looking clock
  // time. The start could therefore never be moved at all, because the tap that
  // would have moved it was the one with nothing to measure against.
  const start = shownStartMillis.value;
  const end = start + (shownSeconds.value ?? 0) * 1000;

  if (edgeNearest(atMillis, { startMillis: start, endMillis: end }) === "start") {
    // Never past the end, and rounded to the same five-minute grid the stepper
    // uses so tapping and then nudging cannot drift off it.
    const snapped = Math.round(atMillis / (step * 1000)) * step * 1000;
    const moved = Math.min(snapped, end - step * 1000);
    draftStartMillis.value = moved;
    // **The end stays where it was.** Duration is measured from the start, so
    // pulling the start back without this drags the end back with it by the same
    // amount - and the case this edge exists for is a band that started late,
    // where the end was already right.
    draftSeconds.value = Math.round((end - moved) / 1000);
    return;
  }

  const seconds = Math.round((atMillis - start) / 1000);
  draftSeconds.value = Math.max(step, Math.round(seconds / step) * step);
}

function revert() {
  draftSeconds.value = null;
  draftStartMillis.value = null;
  sessions.setDuration(annotationKey.value, null);
  sessions.setStart(annotationKey.value, null);
  emit("changed");
}

// ── the evening's heart rate ──────────────────────────────────────────
const hrSamples = ref([]);
const chosenEndMillis = computed(
  () => shownStartMillis.value + (shownSeconds.value ?? 0) * 1000
);

/**
 * Loaded once for a fixed window around the band's own session, not around the
 * chosen end. Refetching on every tap of the stepper would make the chart's own
 * axis move under the line you are trying to read against it.
 */
async function loadHeart() {
  const bandEnd =
    props.workout.startMillis + (props.workout.activeSeconds ?? 0) * 1000;
  try {
    hrSamples.value = await getSamples(
      "hr",
      props.workout.startMillis - PAD_BEFORE_MS,
      bandEnd + PAD_AFTER_MS
    );
  } catch {
    hrSamples.value = [];
  }
}
onMounted(loadHeart);
watch(() => props.workout.startMillis, loadHeart);

// Across the window being SHOWN, both ends of it. It read the record's own start
// while honouring the chosen end, so a session pulled back half an hour averaged
// a window it was no longer claiming.
const stats = computed(() =>
  heartStats(hrSamples.value, {
    startMillis: shownStartMillis.value,
    endMillis: chosenEndMillis.value,
  })
);

// The workout arriving here is already resolved, so activeSeconds is the
// corrected figure and bandActiveSeconds holds the original. Calories always
// come from the band and always describe the band's own window, so that is the
// duration they have to be scaled against.
const sourceLabel = computed(() => calorieSourceLabel(props.workout.caloriesSource));

const calories = computed(() =>
  scaledCalories(
    props.workout.caloriesKcal,
    props.workout.bandActiveSeconds ?? props.workout.activeSeconds,
    shownSeconds.value
  )
);
</script>

<style scoped>
.sheetwrap {
  position: fixed;
  inset: 0;
  background: rgba(2, 5, 9, 0.55);
  z-index: 500;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 80%;
  overflow-y: auto;
  background: var(--bg1);
  border-top: 1px solid color-mix(in srgb, var(--acc) 30%, transparent);
  padding: 16px 18px calc(20px + env(safe-area-inset-bottom));
  color: var(--body);
  font-family: var(--font-sans);
}
.typebtn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  margin-top: 14px;
  padding: 12px 13px;
  background: color-mix(in srgb, var(--fam-activity) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-activity) 35%, transparent);
  border-radius: 7px;
  color: var(--body);
  text-align: left;
  cursor: pointer;
  font-family: var(--font-sans);
}
.typebtn:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 2px;
}
.tlabel {
  width: 52px;
  flex: none;
  font-size: 13.5px;
  letter-spacing: 1.6px;
  color: var(--fam-activity);
}
.tvalue {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tvalue.unset {
  color: var(--dim);
  font-size: 14px;
  letter-spacing: 1.4px;
  font-family: var(--font-mono);
}
.tchev {
  color: var(--dim);
  font-size: 16px;
}
.notewrap {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 10px;
  padding: 12px 13px;
  border: 1px solid color-mix(in srgb, var(--dim) 26%, transparent);
  border-radius: 7px;
}
.notewrap .tlabel {
  color: var(--dim);
  margin-top: 3px;
}
.note {
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  resize: none;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.45;
}
.note:focus {
  outline: none;
}
.note::placeholder {
  color: var(--dim);
}
/* The cut being considered, set apart from the fields below it: those describe
   the session as it is, and this describes one it would become. */
.splitbox {
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--fam-activity) 8%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.splithd {
  font-size: var(--fs-cardhd);
  letter-spacing: 0.09em;
  color: var(--fam-activity);
  font-weight: 600;
}
.splitparts {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--panel-line);
  border-radius: 6px;
  overflow: hidden;
}
.splitpart {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  background: var(--panel);
  padding: 8px 10px;
  font-size: var(--fs-label);
}
.splitpart .pt {
  color: var(--dim);
}
.splitpart .pv {
  font-variant-numeric: tabular-nums;
}
.splitbox .savebar {
  margin-top: 2px;
}
.action:disabled {
  opacity: 0.45;
}

.savebar {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
/* `visibility`, not `display`, so the row keeps its height and the sheet above
   it cannot move. Untabbable and unclickable while it is standing in for
   itself. */
.savebar.reserved {
  visibility: hidden;
  pointer-events: none;
}
.savebar .action {
  flex: 1;
}
.action.save {
  border-color: var(--fam-activity);
  color: var(--bg1);
  background: var(--fam-activity);
}
.editnote.unsaved {
  color: var(--fam-activity);
}
/* Its own block above the actions, not a row in the field list: the list is
   what this session WAS, and this is a question about which record of it you are
   reading. */
.overlap {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--panel-line);
}
.overlaptext {
  margin: 0 0 10px;
  font-size: var(--fs-second);
  line-height: 1.5;
  color: var(--dim);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 18px;
}
.action {
  width: 100%;
  min-height: 46px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 40%, transparent);
  border-radius: 7px;
  color: var(--dim);
  font-size: 14px;
  letter-spacing: 1.6px;
  cursor: pointer;
}
.action:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 2px;
}
.action.danger {
  border-color: color-mix(in srgb, var(--bad) 45%, transparent);
  color: var(--bad);
}
.confirm {
  margin-top: 12px;
  padding: 13px;
  border: 1px solid color-mix(in srgb, var(--bad) 35%, transparent);
  border-radius: 7px;
}
.confirmtext {
  margin: 0 0 12px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--body);
}
.confirmrow {
  display: flex;
  gap: 8px;
}
.confirmrow .action {
  flex: 1;
}
.spanline {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 16px;
  font-size: 14.5px;
  letter-spacing: 1.2px;
  color: var(--ink);
}
.spanline .arrow {
  color: var(--dim);
}
/* The end moves as you edit, so it is the one of the two that is highlighted. */
.spanline .endstamp {
  color: var(--fam-activity);
}
.est {
  margin-left: 5px;
  font-size: 13px;
  letter-spacing: 1.2px;
  color: var(--dim);
}
.dim-text {
  color: var(--dim);
  font-size: 14px;
  font-weight: 400;
  margin-top: 14px;
}
.fieldlist {
  margin-top: 12px;
}
.fieldrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  padding: 8px 0;
  font-size: 14.5px;
  border-bottom: 1px solid color-mix(in srgb, var(--acc) 12%, transparent);
}
.durbox {
  display: flex;
  align-items: center;
  gap: 4px;
}
.durval {
  min-width: 74px;
  text-align: center;
  font-size: 15px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.step {
  width: 38px;
  height: 38px;
  flex: none;
  background: none;
  border: 1px solid color-mix(in srgb, var(--fam-activity) 40%, transparent);
  border-radius: 6px;
  color: var(--fam-activity);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.step:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 2px;
}
.step:active {
  background: color-mix(in srgb, var(--fam-activity) 14%, transparent);
}
.editnote {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 0 0;
  font-size: 13.5px;
  letter-spacing: 1.2px;
  color: var(--dim);
  /* Two lines' worth, reserved. This row says three different things and the
     longest of them wraps, so without a floor it grows on the tap that changes
     it - the same jolt the save bar was making, one row further up. */
  min-height: 40px;
  align-content: center;
}
.revert {
  background: none;
  border: 0;
  padding: 4px 0;
  color: var(--fam-activity);
  font-size: 13.5px;
  letter-spacing: 1.2px;
  cursor: pointer;
  text-decoration: underline;
}
</style>
