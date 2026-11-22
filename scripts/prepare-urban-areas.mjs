/** Tile pinned Natural Earth urban areas offline using MapLibre's existing tools. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const revision = "f1890d9f152c896d250a77557a5751a93d494776";
const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/ne_10m_urban_areas.geojson`;
const original = process.argv[2] ? await readFile(process.argv[2]) :
  Buffer.from(await (await fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response;
  })).arrayBuffer());
assert.equal(createHash("sha256").update(original).digest("hex"),
  "5136ffd816a9b28c0f295e6797b4c03eaa421be80d78b90f542db4a932dd4497");
const collection = JSON.parse(original);
for (const feature of collection.features) feature.properties = {};
const require = createRequire(import.meta.resolve("maplibre-gl"));
const { GeoJSONVT } = await import(new URL("geojson-vt.mjs", pathToFileURL(require.resolve("@maplibre/geojson-vt"))));
const { fromGeojsonVt } = await import(require.resolve("@maplibre/vt-pbf"));
const extent = 8192;
const index = new GeoJSONVT(collection, { maxZoom: 4, indexMaxZoom: 4, extent, buffer: 64, tolerance: 1 });
const output = new URL("../public/geo/natural-earth-v5.1.2/urban-10m/", import.meta.url);
let bytes = 0;
let count = 0;
for (let z = 0; z <= 4; z++) {
  for (let x = 0; x < 2 ** z; x++) {
    await mkdir(new URL(`${z}/${x}/`, output), { recursive: true });
    for (let y = 0; y < 2 ** z; y++) {
      // Empty tiles are valid PBFs too, avoiding missing-tile requests at sea.
      const tile = index.getTile(z, x, y) ?? { features: [] };
      // Quantisation collapses tiny rings at low zoom; omit zero-area rings.
      tile.features = tile.features.flatMap((feature) => {
        const geometry = feature.geometry.filter((ring) => ring.length >= 4 &&
          ring.reduce((sum, point, i) => {
            const next = ring[(i + 1) % ring.length];
            return sum + point[0] * next[1] - next[0] * point[1];
          }, 0) !== 0);
        return geometry.length ? [{ ...feature, geometry }] : [];
      });
      const data = fromGeojsonVt({ urban: tile }, { extent, version: 2 });
      await writeFile(new URL(`${z}/${x}/${y}.pbf`, output), data);
      bytes += data.length;
      count++;
    }
  }
}
console.log(`${collection.features.length} urban areas; ${count} tiles; ${bytes} bytes.`);
