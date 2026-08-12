import { defineStore } from "pinia";
import { ref } from "vue";
import { load, persist } from "@/utils/storage";
import { today, uid } from "@/utils/date";
import { bandForHour, BAND_IDS } from "@/utils/bands";

// Habit = { id, name, days: [0-6] (0=Sun, matches Date#getDay), band, archived,
//           created }
// Ticks = { date, habitId } - separate array so history/completion-rate math
// never has to touch the habit definitions themselves.
export const useHabitsStore = defineStore("habits", () => {
  const habits = ref(load("atlas_habits", []));
  const ticks = ref(load("atlas_habit_ticks", []));

  function _persistHabits() {
    persist("atlas_habits", habits.value);
  }
  function _persistTicks() {
    persist("atlas_habit_ticks", ticks.value);
  }

  // `created` is what stops a habit added this morning showing a month of
  // misses it never had the chance to take. Habits stored before this field
  // existed have none, and are treated as having always been there.
  //
  // `band` defaults to the part of the day it is being added in: a habit typed
  // at 9pm is far more likely to be a night one than a morning one, and a wrong
  // guess costs one tap in the same sheet.
  function addHabit(name, days = [0, 1, 2, 3, 4, 5, 6], band) {
    habits.value.push({
      id: uid(),
      name,
      days,
      band: band ?? bandForHour(new Date().getHours()),
      archived: false,
      created: today(),
    });
    _persistHabits();
  }

  // Renaming, re-timing and re-banding edit the definition in place, so the
  // ticks already recorded against this id stay attached: a habit whose cadence
  // changed is still the same habit, and rebuilding it as a new one would throw
  // away its history to record a detail about its future.
  //
  // Takes a patch rather than positional arguments, so adding the next field
  // does not mean every caller passing an extra undefined.
  function updateHabit(id, { name, days, band } = {}) {
    const h = habits.value.find((x) => x.id === id);
    if (!h) return;
    if (name) h.name = name;
    if (days?.length) h.days = days;
    if (BAND_IDS.includes(band)) h.band = band;
    _persistHabits();
  }

  function archiveHabit(id) {
    const h = habits.value.find((x) => x.id === id);
    if (h) {
      h.archived = true;
      _persistHabits();
    }
  }

  // Deletion takes the ticks with it. Archiving is the option that keeps them,
  // so a delete that left them behind would be neither one thing nor the other:
  // the history would be unreachable but still counted in the stored file, and
  // a habit added later under the same name would inherit somebody else's days.
  function deleteHabit(id) {
    const idx = habits.value.findIndex((x) => x.id === id);
    if (idx < 0) return;
    habits.value.splice(idx, 1);
    ticks.value = ticks.value.filter((t) => t.habitId !== id);
    _persistHabits();
    _persistTicks();
  }

  /** How much history a delete would take, so the confirm can say so. */
  function tickCount(habitId) {
    return ticks.value.filter((t) => t.habitId === habitId).length;
  }

  function unarchiveHabit(id) {
    const h = habits.value.find((x) => x.id === id);
    if (h) {
      h.archived = false;
      _persistHabits();
    }
  }

  // Habits due on a given date, by weekday match
  function dueOn(date) {
    const dow = new Date(date + "T12:00:00").getDay();
    return habits.value.filter((h) => !h.archived && h.days.includes(dow));
  }

  function isDone(habitId, date = today()) {
    return ticks.value.some((t) => t.habitId === habitId && t.date === date);
  }

  function toggle(habitId, date = today()) {
    const idx = ticks.value.findIndex(
      (t) => t.habitId === habitId && t.date === date
    );
    if (idx >= 0) ticks.value.splice(idx, 1);
    else ticks.value.push({ habitId, date });
    _persistTicks();
  }

  // Completion rate over the trailing N days (only counting days the habit was due)
  function completionRate(habitId, days = 30) {
    const h = habits.value.find((x) => x.id === habitId);
    if (!h) return 0;
    let due = 0;
    let done = 0;
    const t = new Date(today() + "T12:00:00");
    for (let i = 0; i < days; i++) {
      const dt = new Date(t);
      dt.setDate(dt.getDate() - i);
      const dateStr = dt.toLocaleDateString("sv");
      if (h.days.includes(dt.getDay())) {
        due++;
        if (isDone(h.id, dateStr)) done++;
      }
    }
    return due ? Math.round((done / due) * 100) : 0;
  }

  return {
    habits,
    ticks,
    addHabit,
    updateHabit,
    deleteHabit,
    tickCount,
    archiveHabit,
    unarchiveHabit,
    dueOn,
    isDone,
    toggle,
    completionRate,
  };
});
