/** Run with node scripts/check-weather.mjs. Uses the installed TypeScript compiler, no test dependencies. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file);
  const compiled = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })((id) => {
    if (!id.startsWith('.')) throw new Error(`Unexpected import ${id}`);
    return load(path.relative(root, path.resolve(path.dirname(file), `${id}.ts`)));
  }, compiled, compiled.exports);
  modules.set(file, compiled.exports);
  return compiled.exports;
}
const { ClimateAccumulator, validateArchive, monthRanges, VARIABLES } = load('lib/weather/climate.ts');
const { MONTHS } = load('lib/seasonalTime.ts');
function chunk(rows, timezone = 'UTC') {
  return validateArchive({ latitude: 48.75, longitude: 2.25, timezone,
    hourly_units: { time: 'unixtime', temperature_2m: '°C', wind_speed_10m: 'km/h', precipitation: 'mm' },
    hourly: { time: rows.map(r => Date.parse(r[0]) / 1000), temperature_2m: rows.map(r => r[1]),
      wind_speed_10m: rows.map(r => r[2]), precipitation: rows.map(r => r[3]) },
  });
}
const point = { latitude: 48.8566, longitude: 2.3522 };
const index = (atlas, day, hour) => (day - atlas.startDay) * 24 + hour;

// Ground truth for a ±7-day window: include endpoints, exclude day 8; ignore null, retain zero rainfall.
const window = new ClimateAccumulator({ startYear: 2020, endYear: 2021 });
window.add(chunk([
  ['2020-07-07T14:00Z', 999, 999, 999], ['2020-07-08T14:00Z', 10, 4, 0],
  ['2020-07-15T14:00Z', 20, null, 2], ['2020-07-22T14:00Z', 30, 8, null],
  ['2020-07-23T14:00Z', 999, 999, 999], ['2021-07-15T14:00Z', 40, 12, 0],
]));
const july = window.finish(7, point, 7), i = index(july, 196, 14);
assert.equal(july.values.temperature_2m[i], 25);
assert.equal(july.values.wind_speed_10m[i], 8);
assert.equal(july.values.precipitation[i], 0.667);
assert.equal(july.counts.temperature_2m[i], 4);
assert.equal(july.expectedSamples, 30);
assert.equal(july.values.temperature_2m[i + 1], null);

// Replayed overlapping API ranges must not count twice.
const unique = new ClimateAccumulator({ startYear: 2020, endYear: 2021 });
const repeated = chunk([['2020-07-15T14:00Z', 10, 2, 0]]);
unique.add(repeated); unique.add(repeated); unique.add(chunk([['2021-07-15T14:00Z', 30, 6, 4]]));
const dedup = unique.finish(7, point, 0);
assert.equal(dedup.values.temperature_2m[i], 20); assert.equal(dedup.counts.temperature_2m[i], 2);

// Leap day excluded; March 1 never shifts to February's bucket.
const leap = new ClimateAccumulator({ startYear: 2020, endYear: 2021 });
leap.add(chunk([['2020-02-29T14:00Z', 999, 999, 999], ['2020-03-01T14:00Z', 10, 2, 0], ['2021-03-01T14:00Z', 30, 6, 2]]));
const march = leap.finish(3, point, 0);
assert.equal(march.values.temperature_2m[index(march, 60, 14)], 20);

// DST autumn: both instants map to 02:00; average within the year before averaging across years.
const dst = new ClimateAccumulator({ startYear: 2020, endYear: 2021 });
dst.add(chunk([['2020-10-25T00:00Z', 10, 2, 0], ['2020-10-25T01:00Z', 30, 6, 2], ['2021-10-25T00:00Z', 40, 8, 4]], 'Europe/Paris'));
const october = dst.finish(10, point, 0), dstIndex = index(october, 298, 2);
assert.equal(october.values.temperature_2m[dstIndex], 30);
assert.equal(october.counts.temperature_2m[dstIndex], 2);

// DST spring: do not invent a sample for the skipped local hour.
const spring = new ClimateAccumulator({ startYear: 2020, endYear: 2020 });
spring.add(chunk([['2020-03-29T00:00Z', 10, 2, 0], ['2020-03-29T01:00Z', 20, 4, 0]], 'Europe/Paris'));
const gap = spring.finish(3, point, 0);
assert.equal(gap.values.temperature_2m[index(gap, 88, 2)], null);
assert.equal(gap.values.temperature_2m[index(gap, 88, 3)], 20);

// January smoothing wraps to December in each baseline year, not to extra baseline years.
const wrap = new ClimateAccumulator({ startYear: 2020, endYear: 2020 });
wrap.add(chunk([['2019-12-31T14:00Z', 999, 999, 999], ['2020-01-01T14:00Z', 10, 2, 0], ['2020-12-31T14:00Z', 30, 6, 2], ['2021-01-01T14:00Z', 999, 999, 999]]));
const january = wrap.finish(1, point, 1);
assert.equal(january.values.temperature_2m[index(january, 1, 14)], 20);
assert.equal(monthRanges(1, 7).length, 2); assert.equal(monthRanges(12, 7).length, 2);
assert.equal(monthRanges(7, 7).length, 1);
for (let m = 1; m <= 12; m++) {
  const empty = wrap.finish(m, point, 0);
  const days = (m === 12 ? 366 : MONTHS[m].start) - MONTHS[m - 1].start;
  for (const variable of VARIABLES) assert.equal(empty.values[variable].length, days * 24);
}
assert.throws(() => validateArchive({}), /Malformed/);
const invalid = chunk([['2020-01-01T00:00Z', 1, 2, 0]]); invalid.hourly_units.precipitation = 'inch';
assert.throws(() => validateArchive(invalid), /units/);
console.log('Weather aggregation: window bounds, reference means, null/zero data, deduplication, leap day, DST, year wrap, baseline bounds and units pass.');
