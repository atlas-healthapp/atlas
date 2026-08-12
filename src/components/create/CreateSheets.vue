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

  <ManualSessionSheet
    v-else-if="ui.createSheet === 'add-activity'"
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
import { computed } from "vue";
import { useUIStore } from "@/stores/ui";
import { useFoodStore } from "@/stores/food";
import { today } from "@/utils/date";
import MealPickSheet from "@/components/food/MealPickSheet.vue";
import ItemFormSheet from "@/components/food/ItemFormSheet.vue";
import BatchScanSheet from "@/components/food/BatchScanSheet.vue";
import EstimateSheet from "@/components/food/EstimateSheet.vue";
import ManualSessionSheet from "@/components/activity/ManualSessionSheet.vue";

const ui = useUIStore();
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
  if (mealId) food.addSnack(date.value, mealId, 1, ui.createMealType ?? "snack");
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
  if (result?.newId) food.addSnack(date.value, result.newId, 1, ui.createMealType ?? "snack");
  landOn("food");
}
</script>
