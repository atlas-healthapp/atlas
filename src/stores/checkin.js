import { defineStore } from "pinia";
import { ref } from "vue";
import { load, persist } from "@/utils/storage";
import { today } from "@/utils/date";

// One entry per date: { date, sleep, protein, water, creatine, weight }
// Mirrors v10's health.js upsert-by-date pattern.
export const useCheckinStore = defineStore("checkin", () => {
  const entries = ref(load("atlas_checkins", []));

  function _find(date) {
    return entries.value.find((e) => e.date === date);
  }

  function entryFor(date) {
    return _find(date) ?? null;
  }

  // Merges partial fields into today's (or a given date's) entry, creating it if absent
  function logMetric(fields, date = today()) {
    let e = _find(date);
    if (!e) {
      e = {
        date,
        sleep: null,
        protein: null,
        water: null,
        creatine: null,
        weight: null,
        fibre: null,
      };
      entries.value.push(e);
    }
    Object.assign(e, fields);
    entries.value.sort((a, b) => a.date.localeCompare(b.date));
    persist("atlas_checkins", entries.value);
  }

  return { entries, entryFor, logMetric };
});
