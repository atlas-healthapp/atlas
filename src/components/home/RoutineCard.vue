<template>
  <HomeCard title="ROUTINE" :color="color" :meta="meta">
    <!-- **Nothing is seeded, so a new user has no habits at all**, and four
         bands of em-dashes above a card that never says anything is a card you
         learn to skip. The empty state is the way in rather than a description
         of the emptiness: this is the only place on Home that offers to create
         something, and it earns it because the routine is the one feature that
         cannot start itself from the strap. -->
    <button v-if="!anyHabits" type="button" class="empty" @click.stop="$emit('open', 'add')">
      <span class="etitle">Add your first habit</span>
      <span class="esub mono">
        THE THINGS YOU MEAN TO DO EACH DAY, GROUPED INTO MORNING, DAY, EVENING
        AND NIGHT.
      </span>
    </button>

    <template v-else>
      <MetricRow
        v-for="band in bands"
        :key="band.id"
        :label="band.label"
        :value="band.due ? `${band.done}/${band.due}` : '—'"
        tappable
        @click.stop="$emit('open')"
      >
        <!-- A band with nothing due draws no mark at all. A bar of zero over one
             still renders its target tick, which reads as a goal you have not
             met rather than as an evening with nothing in it. -->
        <GoalBar v-if="band.due" :value="band.done" :goal="band.due" :color="color" />
      </MetricRow>
    </template>

    <!-- The one thing you are up to, tickable where you stand. The commonest
         action in the whole feature is marking one habit off, and making that
         cost a page was the thing this card exists to avoid.
         When everything is done the row stays and changes its words rather than
         disappearing, so the card does not change height halfway through the
         day. -->
    <div v-if="anyHabits" class="nextrow">
      <!-- The row holds the habit you just ticked for a moment, checked, before
           moving on to the next one. It used to swap the instant you tapped,
           which gave no acknowledgement that the tap had landed on the thing you
           aimed at - the name simply became a different name under your finger.
           The bars behind it still update immediately, so nothing is delayed
           except the row's own wording. -->
      <button
        type="button"
        class="tick"
        :disabled="!shown"
        @click.stop="tickNext"
      >
        <span v-if="shown" class="box" :class="{ on: justTicked }" aria-hidden="true"></span>
        <span class="t" :class="{ done: !shown, ticked: justTicked }">
          {{ shown ? shown.name : "ROUTINE DONE" }}
        </span>
      </button>
      <span class="k mono" :style="{ color }">{{ shown ? "NEXT UP" : "" }}</span>
    </div>

    <!-- What the day dropped, counted rather than listed. A day is allowed to
         be imperfect without the screen becoming a list of failures, but
         silence would let two missed habits hide behind one thin bar. Opens the
         routine page, where they are still there to tick. -->
    <button v-if="missed" type="button" class="missed mono" @click.stop="$emit('open')">
      {{ missed }} STILL OPEN FROM EARLIER
    </button>
  </HomeCard>
</template>

<script setup>
// Home's read on the routine: four bands as bars, and the next habit.
//
// Its own component rather than more markup inside HomeTab.vue, which is
// already 1,186 lines and has its own splitting ticket.
//
// The bands are bars rather than a single count because the empty ones are the
// message: at 4pm a flat EVENING bar is exactly what you want to see, and one
// number over nine cannot say that.
import { computed, ref, onUnmounted } from "vue";
import { useHabitsStore } from "@/stores/habits";
import { familyColor } from "@/utils/families";
import { bandForHour } from "@/utils/bands";
import { today } from "@/utils/date";
import { routineBands, routineTally, routineStatus } from "@/components/routine/routineModel";
import HomeCard from "./HomeCard.vue";
import MetricRow from "./MetricRow.vue";
import GoalBar from "@/components/marks/GoalBar.vue";

defineEmits(["open"]);

const habits = useHabitsStore();
const color = familyColor("habits");
const todayKey = today();
const nowBand = bandForHour(new Date().getHours());

const bands = computed(() => routineBands(habits, todayKey));
// Read once on mount rather than on a timer, the same as the routine page: a
// card that re-pointed itself at 17:00 while being looked at would move under
// the reader for no gain.
// Every habit ever defined, archived included: an archived one still means the
// user has met this feature, so offering "add your first habit" to somebody who
// has archived all of theirs would be telling them something they know.
const anyHabits = computed(() => habits.habits.length > 0);
const status = computed(() => routineStatus(habits, todayKey, nowBand));
const next = computed(() => status.value.next);
const missed = computed(() => status.value.missed);

/**
 * How long the row keeps showing what you just ticked.
 *
 * Long enough to register as an acknowledgement, short enough that a second tap
 * is never waiting on it - the tap itself is not blocked, only the wording.
 */
const TICK_HOLD_MS = 650;

const justTicked = ref(null);
let holdTimer = null;

/** What the row is displaying: the habit just completed, or the next one due. */
const shown = computed(() => justTicked.value ?? next.value);

function tickNext() {
  // Deliberately reads `shown`, not `next`: tapping again during the hold should
  // tick the habit whose name is under the finger, which is the one being shown.
  const target = shown.value;
  if (!target) return;
  habits.toggle(target.id);
  justTicked.value = { id: target.id, name: target.name };
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    justTicked.value = null;
  }, TICK_HOLD_MS);
}

onUnmounted(() => clearTimeout(holdTimer));
const meta = computed(() => {
  const { done, due } = routineTally(habits, todayKey);
  return due ? `${done}/${due} TODAY` : "NONE DUE";
});
</script>

<style scoped>
/* The whole block is the button, and it reads as a sentence rather than a
   control: the card is otherwise rows of numbers, and a lone CTA in that
   context looks like an advert. */
.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  width: 100%;
  padding: 10px 0 12px;
  background: none;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.empty .etitle {
  font-size: 16px;
  color: var(--ink);
}
.empty .esub {
  font-size: 13.5px;
  line-height: 1.6;
  letter-spacing: 1px;
  color: var(--dim);
}

.nextrow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  border-top: 1px solid color-mix(in srgb, var(--dim) 16%, transparent);
  margin-top: 2px;
}
.tick {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 48px;
  padding: 0;
  background: none;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.tick:disabled {
  cursor: default;
}
.box {
  width: 17px;
  height: 17px;
  flex: none;
  border-radius: 4px;
  border: 1.4px solid var(--dim);
  position: relative;
  transition: border-color 120ms ease, background 120ms ease;
}
/* Filled and checked for the moment the row holds the habit you just ticked. */
.box.on {
  border-color: var(--row-label, var(--acc));
  background: var(--row-label, var(--acc));
}
.box.on::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 1.5px;
  width: 4px;
  height: 8px;
  border: solid var(--bg1);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.t.ticked {
  color: var(--dim);
}
.t {
  font-size: 15px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t.done {
  color: var(--dim);
  letter-spacing: 1.4px;
  font-size: 14px;
}
.k {
  flex: none;
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
}
.missed {
  display: block;
  width: 100%;
  min-height: 34px;
  padding: 0 0 4px 28px;
  background: none;
  border: 0;
  text-align: left;
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  color: var(--dim);
  cursor: pointer;
}
</style>
