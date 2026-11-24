import { open } from "node:fs/promises";
import path from "node:path";
import { ANNUAL_DATASET, type AnnualTemperature } from "./annual";

const ROWS = 361, COLUMNS = 720, MONTHS = 12;

/** Four tiny reads, independent of atlas size. Longitude wraps, latitude clamps at poles. */
export async function getAnnualTemperature(latitude: number, longitude: number, hourUTC: number): Promise<AnnualTemperature> {
  const row = (latitude + 90) * 2;
  const column = (((longitude + 180) % 360) + 360) % 360 * 2;
  const y0 = Math.floor(row), y1 = Math.min(ROWS - 1, y0 + 1);
  const x0 = Math.floor(column), x1 = (x0 + 1) % COLUMNS;
  const dy = row - y0, dx = column - x0;
  const file = await open(path.join(process.cwd(), "public", "weather", ANNUAL_DATASET, `${String(hourUTC).padStart(2, "0")}.bin`), "r");
  try {
    const monthly = Array<number>(MONTHS).fill(0);
    for (const [y, x, weight] of [[y0, x0, (1 - dy) * (1 - dx)], [y0, x1, (1 - dy) * dx],
      [y1, x0, dy * (1 - dx)], [y1, x1, dy * dx]]) {
      if (weight === 0) continue;
      const buffer = Buffer.alloc(MONTHS * 2);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, (y * COLUMNS + x) * buffer.length);
      if (bytesRead !== buffer.length) throw new Error("Incomplete annual temperature data.");
      for (let month = 0; month < MONTHS; month++) {
        const encoded = buffer.readInt16LE(month * 2);
        if (encoded === -32768) throw new Error("Missing annual temperature coverage.");
        monthly[month] += encoded * .01 * weight;
      }
    }
    return { version: 1, baseline: [2020, 2024], hourUTC, resolutionDegrees: .5,
      monthly: monthly.map((value) => Number(value.toFixed(2))) };
  } finally { await file.close(); }
}
