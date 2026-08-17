<template>
  <div ref="scroller" class="food grid-bg">
    <PullIndicator :pull="pull" :refreshing="refreshing" :armed="armed" :note="note" />
    <AppHeader label="FUEL DB" :meta="`${food.library.length} ITEMS`" />

    <div class="subnav">
      <button
        v-for="t in subTabs"
        :key="t.key"
        class="mono"
        :class="{ on: subTab === t.key }"
        @click="subTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <LibraryView v-if="subTab === 'library'" />
    <DiaryView v-else v-model:date="date" />
  </div>
</template>

<script setup>
import PullIndicator from "@/components/layout/PullIndicator.vue";
import { usePullToRefresh } from "@/composables/usePullToRefresh";
import { useHelioStore } from "@/stores/helio";
import { computed, ref, watch } from "vue";
import { useFoodStore } from "@/stores/food";
import { useUIStore } from "@/stores/ui";
import AppHeader from "@/components/layout/AppHeader.vue";
import { today } from "@/utils/date";
import DiaryView from "./DiaryView.vue";
import LibraryView from "./LibraryView.vue";

const ui = useUIStore();
// Still needed by the header's item count, even though the sheets that used the
// rest of it have moved out.
const food = useFoodStore();

// The browsed day lives in the store, not here. The sheets that log against it
// moved out of this tab (see CreateSheets.vue), and something added from HOME
// still has to land on the day the diary is showing. Written through a computed
// so DiaryView's `v-model:date` keeps working unchanged.
const date = computed({
  get: () => ui.diaryDate ?? today(),
  set: (v) => (ui.diaryDate = v),
});

// Food has no strap data of its own, but the gesture has to work everywhere or
// it is a gesture you have to remember the exceptions to.
const helio = useHelioStore();
const scroller = ref(null);
const { pull, refreshing, armed, note } = usePullToRefresh(scroller, () =>
  helio.refresh({ force: true, trigger: "pull-food" }).catch(() => null)
);
// SCHEDULE is hidden, not deleted: ScheduleEditor.vue, the store's weekly
// template and the lazy per-date seeding all still work, and putting the tab
// back is this one line. Nothing seeds a day plan while there is no template,
// so Home's Up Next simply stays empty rather than showing a stale plan.
const subTabs = [
  { key: "diary", label: "DIARY" },
  { key: "library", label: "LIBRARY" },
];
// backed by ui.foodSubTab (not a local ref) so external navigation - Home's
// VIEW ALL - can set the target sub-tab before switching to Food at all,
// same computed-writable-over-a-store-ref pattern as v10's ActivityTab.
const subTab = computed({
  get: () => ui.foodSubTab,
  set: (v) => {
    ui.foodSubTab = v;
  },
});
</script>

<style scoped>
.food {
  height: 100%;
  overflow-y: auto;
  padding: calc(12px + env(safe-area-inset-top)) 18px
    calc(100px + env(safe-area-inset-bottom));
  /* Hides the Android overlay scroll bar by overscanning past #app-shell.
     See --sb-overscan in style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: calc(18px + var(--sb-overscan));
  color: var(--body);
  font-family: var(--font-sans);
}
.subnav {
  display: flex;
  gap: 2px;
  margin-bottom: 16px;
}
.subnav button {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  color: var(--dim);
  font-size: 11px;
  letter-spacing: 2px;
  padding: 9px 0;
}
.subnav .on {
  color: var(--bg1);
  background: var(--fam-intake);
}
.emptyrow {
  padding: 6px 0;
}
.dim-text {
  color: var(--dim);
  font-size: 12.5px;
  font-weight: 400;
}
</style>
