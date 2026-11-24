import type { AnnualTemperature } from "./annual";

const ROWS = 361, COLUMNS = 720, MONTHS = 12, ROW_BYTES = COLUMNS * MONTHS * 2;
type Manifest = { rowBase: string };

function validateManifest(value: unknown): Manifest {
  const data = value as Record<string, unknown>;
  if (!data || data.version !== 1 || data.rowStorage !== "latitude-rows-v1" ||
    JSON.stringify(data.baseline) !== "[2020,2024]" || JSON.stringify(data.hours) !== "[0,3,6,9,12,15,18,21]" ||
    data.rows !== ROWS || data.columns !== COLUMNS || data.months !== MONTHS ||
    data.south !== -90 || data.west !== -180 || data.resolutionDegrees !== .5 ||
    data.scale !== .01 || data.missing !== -32768 || data.encoding !== "little-endian-int16" ||
    JSON.stringify(data.order) !== '["latitude","longitude","month"]' ||
    typeof data.rowBase !== "string" || !/^\.\/annual-[a-f0-9]{16}$/.test(data.rowBase)) {
    throw new Error("Unexpected annual temperature manifest.");
  }
  return { rowBase: data.rowBase };
}

/** Fetch at most two 17 KiB latitude strips, then interpolate in the browser.
 * Successful rows are cached; failures and aborted requests remain retryable.
 */
export function createAnnualPagesLoader(fetcher: typeof fetch = fetch) {
  const manifests = new Map<string, Manifest>();
  const rows = new Map<string, DataView>();
  return async (base: string, latitude: number, longitude: number, hourUTC: number,
    signal: AbortSignal): Promise<AnnualTemperature> => {
    signal.throwIfAborted();
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isInteger(hourUTC) || hourUTC < 0 || hourUTC > 21 || hourUTC % 3 !== 0) {
      throw new Error("Invalid annual temperature location or UTC hour.");
    }
    base = base.replace(/\/$/, "");
    let manifest = manifests.get(base);
    if (!manifest) {
      const response = await fetcher(`${base}/annual-manifest.json`, { signal, credentials: "omit" });
      if (!response.ok) throw new Error(`Annual temperature manifest failed (HTTP ${response.status}).`);
      manifest = validateManifest(await response.json());
      signal.throwIfAborted();
      manifests.set(base, manifest);
      while (manifests.size > 4) manifests.delete(manifests.keys().next().value!);
    }
    const row = (latitude + 90) * 2;
    const column = (((longitude + 180) % 360) + 360) % 360 * 2;
    const y0 = Math.floor(row), y1 = Math.min(ROWS - 1, y0 + 1);
    const x0 = Math.floor(column), x1 = (x0 + 1) % COLUMNS;
    const dy = row - y0, dx = column - x0;
    const samples = [
      [y0, x0, (1 - dy) * (1 - dx)], [y0, x1, (1 - dy) * dx],
      [y1, x0, dy * (1 - dx)], [y1, x1, dy * dx],
    ].filter((sample) => sample[2] !== 0);
    const loaded = new Map<number, DataView>();
    await Promise.all([...new Set(samples.map(([y]) => y))].map(async (y) => {
      const url = `${base}/${manifest.rowBase.slice(2)}/${String(hourUTC).padStart(2, "0")}/${y}.bin`;
      let data = rows.get(url);
      if (!data) {
        const response = await fetcher(url, { signal, credentials: "omit" });
        if (!response.ok) throw new Error(`Annual temperature data failed (HTTP ${response.status}).`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== ROW_BYTES) throw new Error("Incomplete annual temperature data.");
        data = new DataView(bytes);
        for (let offset = 0; offset < ROW_BYTES; offset += 2) {
          const value = data.getInt16(offset, true);
          if (value !== -32768 && (value < -12000 || value > 8000)) {
            throw new Error("Unexpected annual temperature value.");
          }
        }
        signal.throwIfAborted();
        rows.set(url, data);
        while (rows.size > 32) rows.delete(rows.keys().next().value!);
      } else {
        rows.delete(url); rows.set(url, data);
      }
      loaded.set(y, data);
    }));
    signal.throwIfAborted();
    const monthly = Array<number>(MONTHS).fill(0);
    for (const [y, x, weight] of samples) {
      const data = loaded.get(y)!;
      for (let month = 0; month < MONTHS; month++) {
        const encoded = data.getInt16((x * MONTHS + month) * 2, true);
        if (encoded === -32768) throw new Error("Missing annual temperature coverage.");
        if (encoded < -12000 || encoded > 8000) throw new Error("Unexpected annual temperature value.");
        monthly[month] += encoded * .01 * weight;
      }
    }
    return { version: 1, baseline: [2020, 2024], hourUTC, resolutionDegrees: .5,
      monthly: monthly.map((value) => Number(value.toFixed(2))) };
  };
}
