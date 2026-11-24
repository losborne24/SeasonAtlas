const MAX_PACK_BYTES = 25 * 1024 * 1024;
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

type Pack = { data: ArrayBuffer; index: DataView; count: number };

/** SAT1: magic, uint32 count, then absolute uint32 offset/length pairs, all LE.
 * Tiles are ordered by zoom, then y, then x. PNG payloads are copied unchanged.
 */
export function parseTemperaturePack(data: ArrayBuffer): Pack {
  const bytes = new Uint8Array(data);
  const index = new DataView(data);
  if (data.byteLength < 16 || data.byteLength > MAX_PACK_BYTES ||
    bytes[0] !== 83 || bytes[1] !== 65 || bytes[2] !== 84 || bytes[3] !== 49) {
    throw new Error("Invalid temperature bundle header.");
  }
  const count = index.getUint32(4, true);
  if (![1, 5, 21, 85, 341, 1365].includes(count) || 8 + count * 8 > data.byteLength) {
    throw new Error("Invalid temperature bundle index.");
  }
  let end = 8 + count * 8;
  for (let tile = 0; tile < count; tile++) {
    const offset = index.getUint32(8 + tile * 8, true);
    const length = index.getUint32(12 + tile * 8, true);
    if (offset !== end || length < PNG.length || offset + length > data.byteLength ||
      PNG.some((value, i) => bytes[offset + i] !== value)) {
      throw new Error("Incomplete temperature bundle.");
    }
    end = offset + length;
  }
  if (end !== data.byteLength) throw new Error("Unexpected temperature bundle data.");
  return { data, index, count };
}

export function temperaturePackTile(pack: Pack, z: number, x: number, y: number): ArrayBuffer {
  const width = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 5 || x < 0 || y < 0 || x >= width || y >= width) {
    throw new Error("Invalid temperature tile coordinates.");
  }
  const tile = (4 ** z - 1) / 3 + y * width + x;
  if (tile >= pack.count) throw new Error("Temperature zoom is absent from the bundle.");
  const offset = pack.index.getUint32(8 + tile * 8, true);
  const length = pack.index.getUint32(12 + tile * 8, true);
  // MapLibre can transfer this copy to a worker without detaching the cache.
  return pack.data.slice(offset, offset + length);
}

/** Shared in-flight downloads; bounded LRU of completed frames. An aborted tile
 * releases only its own lease. Abort the download once every consumer leaves.
 */
export function createTemperaturePackLoader(fetcher: typeof fetch = fetch) {
  type Entry = { promise: Promise<Pack>; controller: AbortController; users: number; pack?: Pack };
  const entries = new Map<string, Entry>();
  const trim = () => {
    let count = 0, bytes = 0;
    for (const entry of entries.values()) {
      if (entry.pack) { count++; bytes += entry.pack.data.byteLength; }
    }
    for (const [url, entry] of entries) {
      if (count <= 4 && bytes <= 32 * 1024 * 1024) break;
      if (entry.pack && entry.users === 0) {
        entries.delete(url); count--; bytes -= entry.pack.data.byteLength;
      }
    }
  };

  return async (url: string, signal: AbortSignal): Promise<ArrayBuffer> => {
    signal.throwIfAborted();
    const match = /^seasonatlas-weather-pack:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
    if (!match) throw new Error("Invalid temperature bundle URL.");
    const [, frame, zoom, column, row] = match;
    const packUrl = `${frame}.satpack`;
    let entry = entries.get(packUrl);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, users: 0, promise: Promise.resolve(null as unknown as Pack) };
      const current = entry;
      current.promise = (async () => {
        const response = await fetcher(packUrl, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), credentials: "omit",
        });
        if (!response.ok) throw new Error(`Temperature bundle failed (HTTP ${response.status}).`);
        const pack = parseTemperaturePack(await response.arrayBuffer());
        if (entries.get(packUrl) === current) { current.pack = pack; trim(); }
        return pack;
      })().catch((error: unknown) => {
        if (entries.get(packUrl) === current) entries.delete(packUrl);
        throw error;
      });
      entries.set(packUrl, current);
    }
    // Refresh insertion order for LRU eviction.
    entries.delete(packUrl); entries.set(packUrl, entry);
    entry.users++;
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const pack = await Promise.race([entry.promise, aborted]);
      signal.throwIfAborted();
      return temperaturePackTile(pack, Number(zoom), Number(column), Number(row));
    } finally {
      signal.removeEventListener("abort", onAbort);
      entry.users--;
      if (!entry.pack && entry.users === 0) {
        entry.controller.abort();
        if (entries.get(packUrl) === entry) entries.delete(packUrl);
      }
      trim();
    }
  };
}
