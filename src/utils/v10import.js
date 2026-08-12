import * as XLSX from "xlsx";

// One-time migration reader for road-to-v10 xlsx exports. Reads ONLY the
// "Health" and "Body Weight" sheets (all other sheets in the export are
// ignored) - column names mirror v10's excel.js exporter exactly:
//   Health:      Date | Protein (g) | Creatine (g) | Water (L) | Sleep (hrs)
//   Body Weight: Date | Weight (kg)
// See docs/atlas-design.md "Migration mechanics" for the sequencing rules —
// v10's Health tab is not to be touched until this is verified on device.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v) {
  if (v === "" || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function parseV10File(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let wb;
      try {
        wb = XLSX.read(e.target.result, { type: "array" });
      } catch {
        reject("File could not be read as an xlsx workbook");
        return;
      }
      const healthSheet = wb.Sheets["Health"];
      const bwSheet = wb.Sheets["Body Weight"];
      if (!healthSheet && !bwSheet) {
        reject("No Health or Body Weight sheet. Is this a v10 export?");
        return;
      }

      let skipped = 0;
      const health = healthSheet
        ? XLSX.utils
            .sheet_to_json(healthSheet, { defval: "" })
            .map((r) => ({
              date: String(r["Date"]),
              protein: num(r["Protein (g)"]),
              creatine: num(r["Creatine (g)"]),
              water: num(r["Water (L)"]),
              sleep: num(r["Sleep (hrs)"]),
            }))
            .filter((r) => {
              if (DATE_RE.test(r.date)) return true;
              skipped++;
              return false;
            })
        : [];
      const weights = bwSheet
        ? XLSX.utils
            .sheet_to_json(bwSheet, { defval: "" })
            .map((r) => ({
              date: String(r["Date"]),
              weight: num(r["Weight (kg)"]),
            }))
            .filter((r) => {
              if (DATE_RE.test(r.date) && r.weight != null) return true;
              skipped++;
              return false;
            })
        : [];

      const allDates = [
        ...health.map((r) => r.date),
        ...weights.map((r) => r.date),
      ].sort();
      resolve({
        health,
        weights,
        summary: {
          healthRows: health.length,
          weightRows: weights.length,
          skipped,
          from: allDates[0] ?? null,
          to: allDates.at(-1) ?? null,
        },
      });
    };
    reader.onerror = () => reject("Could not read file");
    reader.readAsArrayBuffer(file);
  });
}

// Merge parsed v10 data into the checkin store. Atlas always wins: only
// dates Atlas doesn't have, and null fields on dates it does, get filled —
// historical data never overwrites anything logged in Atlas.
export function mergeIntoCheckin(checkin, { health, weights }) {
  const byDate = new Map();
  for (const r of health) {
    byDate.set(r.date, {
      sleep: r.sleep,
      protein: r.protein,
      water: r.water,
      creatine: r.creatine,
    });
  }
  for (const w of weights) {
    byDate.set(w.date, { ...(byDate.get(w.date) ?? {}), weight: w.weight });
  }

  let datesTouched = 0;
  let fieldsFilled = 0;
  for (const [date, fields] of byDate) {
    const existing = checkin.entryFor(date);
    const apply = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v == null) continue;
      if (existing && existing[k] != null) continue;
      apply[k] = v;
    }
    const n = Object.keys(apply).length;
    if (n > 0) {
      checkin.logMetric(apply, date);
      datesTouched++;
      fieldsFilled += n;
    }
  }
  return { datesTouched, fieldsFilled, datesInFile: byDate.size };
}
