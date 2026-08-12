<template>
  <Teleport to="body">
    <div class="page grid-bg">
      <div class="pscroll">
        <PageHeader :from="from" context="TODAY" @close="$emit('close')" />

        <!-- The count and the one thing you are up to, which is the whole
             question the page answers before you have read a single row. -->
        <div class="hero">
          <div class="count">
            <span class="n">{{ tally.done }}</span
            ><span class="of">/{{ tally.due }}</span>
            <!-- DONE rather than TODAY: the header says TODAY now, and the two
                 sat one line apart saying the same word. -->
            <div class="k mono">DONE</div>
          </div>
          <div class="next">
            <div class="k mono">{{ next ? "NEXT" : "" }}</div>
            <div class="v">{{ next ? next.name : "ROUTINE DONE" }}</div>
          </div>
        </div>

        <!-- The whole day is one card, not one per band. Four cards made the
             routine look like four lists, and a card header takes the family
             colour, which would have turned all four band headers teal and
             killed the "you are here" highlight that says which part of the
             day the clock is in. Inside one card they stay sub-headings.

             It is also the one card on any drill-through with no header of its
             own, and for the same reason: a teal title here would be a second
             teal heading two lines above the lit band. The hero directly above
             is what names it, and hero, THE DAY and MORNING would be three
             headings in a row. Same surface as a HomeCard either way. -->
        <div class="panel day">
          <div v-for="band in bands" :key="band.id" class="band">
          <div class="bandhd mono" :class="{ now: band.id === nowBand }">
            <span>{{ band.label }}</span>
            <span class="ln"></span>
            <span v-if="band.due">{{ band.done }}/{{ band.due }}</span>
          </div>

          <div v-if="!band.rows.length" class="empty mono">NOTHING HERE YET</div>

          <div v-for="row in band.rows" :key="row.id" class="hrow">
            <!-- The box and the name are one target, because ticking is what
                 this page is for. EDIT is its own, small, at the far end. -->
            <button
              type="button"
              class="tick"
              :disabled="!row.dueToday"
              @click="habits.toggle(row.id)"
            >
              <span class="box" :class="{ on: row.doneToday }" aria-hidden="true"></span>
              <span class="t" :class="{ done: row.doneToday, off: !row.dueToday }">
                {{ row.name }}
              </span>
            </button>
            <span v-if="!row.dueToday" class="restday mono">NOT TODAY</span>
            <button type="button" class="edit mono" @click="openSheet(row.id)">
              EDIT
            </button>
          </div>
        </div>

          <button type="button" class="addrow mono" @click="openSheet(null)">
            + ADD A HABIT
          </button>
        </div>

        <div class="grouphd mono" :style="{ color: famColor('habits') }">HISTORY</div>

        <!-- One column per day: how much of the routine was kept that day.
             A day nothing was due at all draws nothing rather than a zero,
             which would read as a failure that never happened. -->
        <HomeCard
          title="HOW MUCH YOU KEPT"
          :meta="history.kept != null ? `${history.kept}% OVER ${history.days.length} DAYS` : ''"
          :color="famColor('habits')"
        >
          <div class="daybars" role="img" :aria-label="keptAria">
            <span
              v-for="d in history.days"
              :key="d.date"
              class="daybar"
              :class="{ today: d.isToday, none: !d.due }"
            >
              <i :style="{ height: `${Math.round(d.pct * 100)}%` }"></i>
            </span>
          </div>
        </HomeCard>

        <!-- Name and rate on their own line, strip underneath at full width.
             Sharing one line put thirty dots into 170px and they ran under
             the percentage. -->
        <HomeCard title="EACH HABIT" :color="famColor('habits')">
          <div v-for="row in rows" :key="row.id" class="hline">
            <div class="htop">
              <span class="n mono">{{ row.label }}</span>
              <span class="p mono">{{ habits.completionRate(row.id, STRIP_DAYS) }}%</span>
            </div>
            <HabitStrip :days="row.dots" :color="famColor('habits')" />
          </div>
        </HomeCard>
      </div>

      <HabitSheet v-if="sheetOpen" :habit="editing" @close="sheetOpen = false" />
    </div>
  </Teleport>
</template>

<script setup>
// The routine as a day rather than as a list: four bands in the order they
// happen, the whole day visible without a tap, and history underneath.
//
// Reached from Home's ROUTINE card and from FITNESS. Everything about a habit
// is here, including adding and editing, because the alternative was Settings
// accumulating another manager.
import { computed, ref } from "vue";
import { useHabitsStore } from "@/stores/habits";
import { useBackClose } from "@/composables/useBackClose";
import PageHeader from "@/components/layout/PageHeader.vue";
import { familyColor } from "@/utils/families";
import { bandForHour } from "@/utils/bands";
import { today } from "@/utils/date";
import {
  habitRows,
  routineBands,
  routineTally,
  keptPerDay,
  nextUp,
  STRIP_DAYS,
} from "./routineModel";
import HabitStrip from "@/components/marks/HabitStrip.vue";
import HomeCard from "@/components/home/HomeCard.vue";
import HabitSheet from "./HabitSheet.vue";

const props = defineProps({
  /** Where the back control returns to, named by whoever opened this. */
  from: { type: String, default: "BACK" },
  /**
   * Open the add-habit sheet on arrival.
   *
   * For Home's empty state, which is an offer to add a habit: landing on a page
   * that says the same thing again and waiting for a second tap is one step of
   * ceremony between the offer and the thing offered.
   */
  addOnOpen: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);

useBackClose(() => emit("close"));

const habits = useHabitsStore();
const famColor = familyColor;

const todayKey = today();
// Which band is lit. Read once on open rather than on a timer: a page that
// re-lit itself at 17:00 while being looked at would move under the reader for
// no gain.
const nowBand = bandForHour(new Date().getHours());

const rows = computed(() => habitRows(habits, todayKey));
const bands = computed(() => routineBands(habits, todayKey));
const tally = computed(() => routineTally(habits, todayKey));
const next = computed(() => nextUp(habits, todayKey));
const history = computed(() => keptPerDay(habits, todayKey));

const keptAria = computed(() =>
  history.value.kept == null
    ? "No routine history yet"
    : `Routine kept ${history.value.kept}% over the last ${history.value.days.length} days`
);

const sheetOpen = ref(props.addOnOpen);
const editing = ref(null);
function openSheet(id) {
  editing.value = id ? (habits.habits.find((h) => h.id === id) ?? null) : null;
  sheetOpen.value = true;
}
</script>

<style scoped>
.page {
  position: fixed;
  inset: 0;
  z-index: 600;
  display: flex;
  flex-direction: column;
  background: var(--bg1);
  color: var(--body);
  font-family: var(--font-sans);
  padding: calc(12px + env(safe-area-inset-top)) 18px
    calc(20px + env(safe-area-inset-bottom));
  overflow: hidden;
  animation: pagein 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes pagein {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .page {
    animation: none;
  }
}
.pscroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Hides the Android overlay scroll bar by overscanning past the page box.
     See --sb-overscan in style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: var(--sb-overscan);
}

.hero {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin: 2px 0 22px;
}
.count .n {
  font-size: 38px;
  font-weight: 300;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.count .of {
  font-size: 20px;
  color: var(--dim);
}
.k {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--dim);
}
.next {
  margin-left: auto;
  text-align: right;
  min-width: 0;
}
.next .v {
  font-size: 14.5px;
  color: var(--fam-activity);
}

.band {
  margin-top: 14px;
}
/* The card already sets the gap above the first band. */
.day .band:first-child {
  margin-top: 0;
}
.bandhd {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10.5px;
  letter-spacing: 2.4px;
  color: var(--dim);
  margin-bottom: 2px;
}
.bandhd .ln {
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--dim) 22%, transparent);
}
/* The band the clock is in. The only colour on a band header, so it reads as
   where you are rather than as another label. */
.bandhd.now {
  color: var(--fam-activity);
}
.bandhd.now .ln {
  background: color-mix(in srgb, var(--fam-activity) 35%, transparent);
}
.empty {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  padding: 8px 0 4px;
  opacity: 0.7;
}

.hrow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
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
}
.box.on {
  border-color: var(--fam-activity);
  background: color-mix(in srgb, var(--fam-activity) 20%, transparent);
}
.box.on::after {
  content: "";
  position: absolute;
  left: 3.5px;
  top: 5px;
  width: 7px;
  height: 3.5px;
  border-left: 1.8px solid var(--fam-activity);
  border-bottom: 1.8px solid var(--fam-activity);
  transform: rotate(-45deg);
}
.t {
  font-size: 14.5px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Done is quieter, not struck through: it happened, it is not cancelled. */
.t.done {
  color: var(--dim);
}
.t.off {
  color: var(--dim);
}
.restday {
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
  flex: none;
}
.edit {
  flex: none;
  min-height: 44px;
  padding: 0 4px 0 10px;
  background: none;
  border: 0;
  color: var(--dim);
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  cursor: pointer;
}
.addrow {
  display: block;
  width: 100%;
  min-height: 48px;
  margin-top: 14px;
  padding: 0;
  background: none;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--dim) 18%, transparent);
  color: var(--fam-activity);
  font-size: var(--fs-label);
  letter-spacing: 1.6px;
  text-align: left;
  cursor: pointer;
}

.daybars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 46px;
  margin: 6px 0 8px;
}
.daybar {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  background: color-mix(in srgb, var(--dim) 12%, transparent);
  border-radius: 1px;
}
.daybar i {
  width: 100%;
  min-height: 1px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--fam-activity) 55%, transparent);
}
.daybar.today i {
  background: var(--fam-activity);
}
/* A day nothing was due keeps its slot but draws no track, so the row stays a
   calendar without claiming a zero that never happened. */
.daybar.none {
  background: none;
}
.hline {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 0;
}
.hline .htop {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.hline .n {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  letter-spacing: 1px;
  color: var(--dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hline .p {
  flex: none;
  font-size: 10.5px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
</style>
