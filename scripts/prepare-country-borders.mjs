/** Vendor country boundary lines from the same pinned release as the base map. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const revision = "f1890d9f152c896d250a77557a5751a93d494776";
const filename = "ne_50m_admin_0_boundary_lines_land.geojson";
const hash = "2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48";
const output = new URL("../public/geo/natural-earth-v5.1.2/", import.meta.url);
let original;
if (process.argv[2]) {
  original = await readFile(process.argv[2]);
} else {
  const response = await fetch(`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/${filename}`);
  if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
  original = Buffer.from(await response.arrayBuffer());
}
assert.equal(createHash("sha256").update(original).digest("hex"), hash, "Unexpected upstream country borders");
const features = JSON.parse(original).features.map(({ geometry, properties }) => ({
  type: "Feature",
  properties: { min_zoom: properties.MIN_ZOOM ?? 0 },
  geometry,
}));
const data = JSON.stringify({ type: "FeatureCollection", features }) + "\n";
await mkdir(output, { recursive: true });
await writeFile(new URL(filename, output), data);
console.log(`${filename}: ${features.length} boundaries, ${Buffer.byteLength(data)} bytes`);
