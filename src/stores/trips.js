import { defineStore } from "pinia";
import { ref } from "vue";
import { load, persist } from "@/utils/storage";
import { uid } from "@/utils/date";

// Trip = { id, label, start, end } - a labelled date range explaining why
// checkin data is missing (holiday, sick, travel). Purely a display
// annotation: it never inserts values, so it can't affect any average.
export const useTripsStore = defineStore("trips", () => {
  const trips = ref(load("atlas_trips", []));

  function _persist() {
    persist("atlas_trips", trips.value);
  }

  function addTrip(label, start, end) {
    const [s, e] = start <= end ? [start, end] : [end, start];
    trips.value.push({ id: uid(), label, start: s, end: e });
    _persist();
  }

  function removeTrip(id) {
    trips.value = trips.value.filter((t) => t.id !== id);
    _persist();
  }

  // date strings are YYYY-MM-DD, so lexicographic comparison is correct
  function labelFor(date) {
    const t = trips.value.find((t) => date >= t.start && date <= t.end);
    return t?.label ?? null;
  }

  return { trips, addTrip, removeTrip, labelFor };
});
