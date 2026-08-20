<template>
  <MealPickSheet
    v-if="ui.createSheet === 'add-food'"
    :kinds="['meal', 'snack', 'takeaway']"
    :pick-meal-type="true"
    title="ADD"
    @close="ui.closeCreate()"
    @pick="onPick"
    @scan="ui.openCreateSheet('scan', $event)"
    @batch-scan="ui.openCreateSheet('batch-scan', $event)"
    @quick-add="ui.openCreateSheet('quick-add', $event)"
  />

  <!-- Straight into the scanner. What it saves is a library item, so it is
       also logged into the section that was chosen before it opened: creating
       the item and not putting it anywhere is what the old scan node did, and
       it left you to search for the thing you had just scanned. -->
  <ItemFormSheet
    v-else-if="ui.createSheet === 'scan'"
    :auto-scan="true"
    @close="ui.closeCreate()"
    @saved="onScanned"
  />

  <!-- Several scans collected into one composite meal. It lands in the section
       chosen before it opened, exactly like a single scan does: making the item
       and putting it nowhere is what the old scan node did, and it left you
       hunting for the thing you had just made. -->
  <BatchScanSheet
    v-else-if="ui.createSheet === 'batch-scan'"
    @created="onBatchCreated"
    @saved-items="landOnLibrary"
    @close="ui.closeCreate()"
  />

  <EstimateSheet
    v-else-if="ui.createSheet === 'quick-add'"
    :date="date"
    :date-label="dateLabel"
    :meal-type="ui.createMealType"
    @saved="landOn('food')"
    @close="ui.closeCreate()"
  />

  <!-- **The ACTIVITY node starts one now; recording one you already did is a row
       inside it.** Starting is the common case and typing in times afterwards is
       the rare one, so they are not siblings. This is the same shape MealPickSheet
       uses for SCAN and QUICK ADD, and for the same reason `CreateFab`'s own notes
       give: giving the rarest ways in the same billing as the commonest is the
       mistake those two were moved off the arc to fix. -->
  <!-- **Starting does not move the tab, and that is not an exception to the rule
       above, it is the rule.** The tab moves once something has been *added*, and
       starting a session adds nothing: it is still running, there is nothing on
       FITNESS to go and look at, and the running row now appears under the header
       of every tab, so being sent anywhere to see it is pointless. You press START
       on the way out of the door and should be left where you were.

       Stopping still lands on FITNESS, because that is the moment a session
       actually joins the list. -->
  <SessionSheet
    v-else-if="ui.createSheet === 'add-activity'"
    @started="ui.closeCreate()"
    @stopped="onStopped"
    @record-earlier="ui.openCreateSheet('log-past-activity')"
    @close="ui.closeCreate()"
  />

  <!-- **STOP lands here rather than closing.** A session that recorded itself and
       vanished gave you nothing to check, no way to correct a type chosen before
       you started, and no way to change your mind. It is mounted beside the
       others rather than inside SessionSheet so it survives that sheet closing,
       which is what STOP does. -->
  <SessionRecapSheet
    v-else-if="ui.createSheet === 'session-recap' && recap"
    :start-millis="recap.startMillis"
    :active-seconds="recap.activeSeconds"
    @close="finishRecap"
    @discarded="finishRecap"
  />

  <ManualSessionSheet
    v-else-if="ui.createSheet === 'log-past-activity'"
    @saved="landOn('activity')"
    @close="ui.closeCreate()"
  />
</template>

<script setup>
// Everything the create button opens, mounted beside the tab bar rather than
// inside a tab.
//
// It has to be here. Tabs live in `<KeepAlive>`, and an inactive one is
// deactivated along with anything it teleports, so a sheet owned by FoodTab
// could not be shown while HOME was the tab on screen. Keeping the tab
// underneath unchanged while you create something is the whole point: the page
// behind the scrim used to change the instant you pressed a node, on the way to
// a sheet that covers it anyway.
//
// **The tab moves once, after something is added.** That is the moment it is
// worth showing, and it is the only moment: cancelling leaves you exactly where
// you were.
import { computed, ref } from "vue";
import { useUIStore } from "@/stores/ui";
import { useFoodStore } from "@/stores/food";
import { today } from "@/utils/date";
import MealPickSheet from "@/components/food/MealPickSheet.vue";
import ItemFormSheet from "@/components/food/ItemFormSheet.vue";
import BatchScanSheet from "@/components/food/BatchScanSheet.vue";
import EstimateSheet from "@/components/food/EstimateSheet.vue";
import ManualSessionSheet from "@/components/activity/ManualSessionSheet.vue";
import SessionSheet from "@/components/activity/SessionSheet.vue";
import SessionRecapSheet from "@/components/activity/SessionRecapSheet.vue";

const ui = useUIStore();

/**
 * The session STOP just recorded, held while its recap is open.
 *
 * A plain ref rather than something on the store: it is alive for exactly as long
 * as one sheet, and the store already carries the session itself.
 */
const recap = ref(null);

function onStopped(result) {
  // Null when the session was under a minute and discarded rather than stored.
  // Nothing to recap, so it behaves as it always did.
  if (!result) {
    landOn("activity");
    return;
  }
  recap.value = result;
  ui.openCreateSheet("session-recap");
}

/** Close the recap and land on FITNESS, where the session now is. */
function finishRecap() {
  recap.value = null;
  landOn("activity");
}
const food = useFoodStore();

// Whatever day the diary is browsing, or today when it has not been opened yet
// - which is the case whenever this is reached from any other tab.
const date = computed(() => ui.diaryDate ?? today());

const dateLabel = computed(() =>
  date.value === today()
    ? "TODAY"
    : new Date(`${date.value}T12:00:00`)
        .toLocaleDateString("en-AU", { weekday: "short", day: "numeric" })
        .toUpperCase()
        .replace(",", "")
);

/** Close, then show the tab the thing landed on. */
function landOn(tab) {
  ui.closeCreate();
  if (tab === "food") ui.goToFood("diary");
  else ui.setTab(tab);
}

function onPick(itemId, quantity, mealType) {
  food.addSnack(date.value, itemId, quantity, mealType);
  landOn("food");
}

/** A batch that made a meal logs it, same as any other way of adding one. */
function onBatchCreated({ mealId }) {
  // **No `?? "snack"`.** `addSnack` buckets an unstated section by the clock, and
  // hardcoding one here defeated that: anything added without choosing a section
  // landed in SNACKS whatever time it was.
  if (mealId) food.addSnack(date.value, mealId, 1, ui.createMealType ?? undefined);
  landOn("food");
}

/**
 * A batch that made items and no meal.
 *
 * The library, not the diary: nothing was logged, and a diary that looks
 * exactly as it did reads as the whole thing having failed.
 */
function landOnLibrary() {
  ui.closeCreate();
  ui.goToFood("library");
}

function onScanned(result) {
  // A scan that created something logs it where you said it was going. An edit
  // of an existing item has no new id and nothing to log.
  // Reported: "when I scan without picking a type it defaults to snack". The
  // library item is right - every scan path makes a `meal` - it was the logged
  // entry landing in the wrong section. Same fix as above: let addSnack read the
  // clock, so a sandwich scanned at 12:30 goes to LUNCH.
  if (result?.newId) food.addSnack(date.value, result.newId, 1, ui.createMealType ?? undefined);
  landOn("food");
}
</script>
