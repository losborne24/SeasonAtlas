/** Audit packaged annual strips and compare browser interpolation to the original grids. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const compiled = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('lib/weather/annualPages.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInThisContext(`(function(module,exports){${code}\n})`)(compiled, compiled.exports);
const { createAnnualPagesLoader } = compiled.exports;
const output = process.argv[2] ?? '.weather-data/pages-temperature';
const original = process.argv[3] ?? 'public/weather/annual-temperature-2020-2024-05deg-v1';
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'annual-manifest.json')));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(original, 'manifest.json')));
const rowsPath = path.join(output, manifest.rowBase);
const runPackage = source => spawnSync('python3',['scripts/weather/pages_annual.py','--source',source,'--output',output],{encoding:'utf8'});
const repeat = runPackage(original);
assert.equal(repeat.status,0,repeat.stderr);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'annual-manifest.json'))),manifest,'Packaging unchanged data is idempotent');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(),'seasonatlas-annual-'));
try {
  fs.writeFileSync(path.join(fixture,'manifest.json'),JSON.stringify({...sourceManifest,rows:360}));
  assert.notEqual(runPackage(fixture).status,0,'Reject incompatible grids');
  fs.writeFileSync(path.join(fixture,'manifest.json'),JSON.stringify(sourceManifest));
  fs.writeFileSync(path.join(fixture,'00.bin'),Buffer.alloc(361*720*12*2));
  assert.notEqual(runPackage(fixture).status,0,'Reject changed source checksums');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'annual-manifest.json'))),manifest,'Failures never switch the published manifest');
} finally { fs.rmSync(fixture,{recursive:true,force:true}); }
const bytesPerRow = 720 * 12 * 2;
const grids = new Map();
for (const hour of manifest.hours) {
  const name = String(hour).padStart(2,'0');
  const rows = [];
  for (let y = 0; y < 361; y++) {
    const data = fs.readFileSync(path.join(rowsPath, name, `${y}.bin`));
    assert.equal(data.length, bytesPerRow); rows.push(data);
  }
  const joined = Buffer.concat(rows);
  assert.equal(createHash('sha256').update(joined).digest('hex'), sourceManifest.sha256[`${name}.bin`]);
  assert.deepEqual(joined, fs.readFileSync(path.join(original, `${name}.bin`)));
  grids.set(hour, joined);
}
assert.match(fs.readFileSync(path.join(output, '_headers'),'utf8'), /\/annual-manifest.json\n  Cache-Control: no-cache/);
assert.equal(fs.readFileSync(path.join(rowsPath, 'NOTICE.txt'),'utf8'), fs.readFileSync(path.join(original, 'NOTICE.txt'),'utf8'));

let requests = [];
const base = 'https://tiles.example.com/data';
const fetcher = async (url, options) => {
  options.signal.throwIfAborted(); requests.push(url);
  assert.equal(options.credentials, 'omit');
  const relative = url.slice(base.length + 1);
  const file = path.join(output, relative);
  return fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response('', {status:404});
};
const load = createAnnualPagesLoader(fetcher);
const controller = new AbortController();
function reference(latitude, longitude, hour) {
  const grid = grids.get(hour), values = Array(12).fill(0);
  const row = (latitude + 90) * 2, col = (((longitude + 180) % 360) + 360) % 360 * 2;
  const y0 = Math.floor(row), y1 = Math.min(360, y0+1), x0 = Math.floor(col), x1 = (x0+1)%720;
  const dy = row-y0, dx = col-x0;
  for (const [y,x,weight] of [[y0,x0,(1-dy)*(1-dx)],[y0,x1,(1-dy)*dx],[y1,x0,dy*(1-dx)],[y1,x1,dy*dx]]) {
    if (weight === 0) continue;
    for (let month=0; month<12; month++) values[month] += grid.readInt16LE(((y*720+x)*12+month)*2)*.01*weight;
  }
  return values.map(value=>Number(value.toFixed(2)));
}
for (const hour of manifest.hours) for (const [latitude,longitude] of [
  [48.8566,2.3522], [51.5074,-.1278], [-33.8688,151.2093],
  [-90,-180], [90,180], [0,0], [0,179.9], [0,-180],
  [89.99,-179.99], [-89.99,179.99], [45.25,12.25],
]) {
  const data = await load(base,latitude,longitude,hour,controller.signal);
  assert.deepEqual(data.monthly,reference(latitude,longitude,hour));
  assert.equal(data.hourUTC,hour); assert.deepEqual(data.baseline,[2020,2024]);
}
requests = [];
const cached = createAnnualPagesLoader(fetcher);
await cached(base,48.8566,2.3522,0,controller.signal);
assert.equal(requests.length,3,'One manifest and two latitude rows');
await cached(base,48.8566,2.3522,0,controller.signal);
assert.equal(requests.length,3,'Rows and metadata are cached');
for(let row=0;row<34;row++) await cached(base,-90+row*.5,0,0,controller.signal);
const before=requests.length;
await cached(base,48.8566,2.3522,0,controller.signal);
assert.equal(requests.length,before+2,'Older rows are evicted');

let bad = true;
const retry = createAnnualPagesLoader(async (url,options) => {
  if (!url.endsWith('annual-manifest.json') && bad) return new Response(new Uint8Array(3));
  return fetcher(url,options);
});
await assert.rejects(retry(base,0,0,0,controller.signal),/Incomplete/);
bad=false; await retry(base,0,0,0,controller.signal);
let corrupt=true;
const valueRetry = createAnnualPagesLoader(async(url,options)=>{
  if(!url.endsWith('annual-manifest.json') && corrupt) {
    const row=Buffer.alloc(bytesPerRow); row.writeInt16LE(32000,0); return new Response(row);
  }
  return fetcher(url,options);
});
await assert.rejects(valueRetry(base,0,0,0,controller.signal),/Unexpected/);
corrupt=false; await valueRetry(base,0,0,0,controller.signal);
const absent = createAnnualPagesLoader(async()=>new Response('',{status:404}));
await assert.rejects(absent(base,0,0,0,controller.signal),/HTTP 404/);
const invalid = createAnnualPagesLoader(async()=>Response.json({...manifest,rowBase:'./../secret'}));
await assert.rejects(invalid(base,0,0,0,controller.signal),/Unexpected/);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(load(base,0,0,0,cancelled.signal),{name:'AbortError'});
await assert.rejects(load(base,91,0,0,controller.signal),/Invalid/);
await assert.rejects(load(base,0,0,2,controller.signal),/Invalid/);
const missing = createAnnualPagesLoader(async(url,options)=>{
  if(url.endsWith('annual-manifest.json')) return fetcher(url,options);
  const row = Buffer.alloc(bytesPerRow); row.writeInt16LE(-32768,360*24);
  return new Response(row);
});
await assert.rejects(missing(base,0,0,0,controller.signal),/Missing/);
console.log('Annual Pages: all 2,888 rows byte-identical; interpolation matches original at eight UTC hours, poles, dateline and fractional cells; caching, eviction, retries, missing data and aborts pass.');
