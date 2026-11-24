/** Codec, packaging, real HTTP loading, cancellation, retries and bounded caching. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import ts from 'typescript';

function load(file) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(module,exports){${code}\n})`, { filename: file })(compiled, compiled.exports);
  return compiled.exports;
}
const { parseTemperaturePack, temperaturePackTile, createTemperaturePackLoader } = load('map/temperaturePacks.ts');
const { validateTemperatureAtlas, temperatureAtlasBase, temperatureTileUrl } = load('map/temperature.ts');
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

function chunk(type, data) {
  const name = Buffer.from(type), crcInput = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4), footer = Buffer.alloc(4);
  header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, crcInput, footer]);
}
function png(value) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(128, 0); ihdr.writeUInt32BE(128, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const pixels = Buffer.alloc(128 * (1 + 128 * 4), value);
  for (let y = 0; y < 128; y++) pixels[y * 513] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'seasonatlas-packs-'));
let server;
try {
  const source = path.join(temporary, 'source'), output = path.join(temporary, 'pages');
  fs.mkdirSync(source);
  const atlas = {
    version: 1, kind: 'era5', baseline: [2020, 2024], windowDays: 15,
    statistic: 'daily_mean', timezone: 'UTC', variable: 'temperature_2m',
    bounds: [-180, -85, 180, 85], resolutionDegrees: .25, minzoom: 0, maxzoom: 1,
    tileSize: 128, format: 'png', days: Array.from({length:365}, (_,i)=>i+1),
    colors: [{value:-30,color:'#4a429b'}, {value:45,color:'#c23b33'}],
    tileBase: '/weather/old-local-path',
  };
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(atlas));
  fs.writeFileSync(path.join(source, 'NOTICE.txt'), 'Test fixture attribution\n');
  for (let day = 1; day <= 365; day++) for (let z = 0; z <= 1; z++) {
    for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) {
      const folder = path.join(source, `${day}/${z}/${x}`); fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `${y}.png`), png(day % 256 + x + y));
    }
  }
  const run = destination => spawnSync('python3', ['scripts/weather/pages.py', '--source', source, '--output', destination], { encoding: 'utf8' });
  const result = run(output); assert.equal(result.status, 0, result.stderr);
  const manifest = validateTemperatureAtlas(JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'))));
  assert.equal(manifest.tileStorage, 'frame-pack-v1');
  assert.match(manifest.tileBase, /^\.\/frames-[a-f0-9]{16}$/);
  assert.equal(fs.readFileSync(path.join(output, 'NOTICE.txt'), 'utf8'), 'Test fixture attribution\n');
  assert.match(fs.readFileSync(path.join(output, '_headers'), 'utf8'), /Access-Control-Allow-Origin: \*/);
  assert.ok(fs.existsSync(path.join(output, '404.html')));
  assert.notEqual(run(output).status, 0, 'Never overwrite a published package');
  assert.notEqual(run(path.join(source, 'nested-output')).status, 0, 'Never write inside the source');
  const repeat = path.join(temporary, 'repeat');
  assert.equal(run(repeat).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repeat, 'manifest.json'))), manifest, 'Same input yields the same immutable version');

  const base = temperatureAtlasBase('https://tiles.example.com', manifest);
  assert.equal(base, `https://tiles.example.com/${manifest.tileBase.slice(2)}`);
  assert.equal(temperatureAtlasBase('/weather', manifest), `/weather/${manifest.tileBase.slice(2)}`);
  assert.equal(temperatureAtlasBase('https://tiles.example.com/weather', atlas), 'https://tiles.example.com/weather/old-local-path');
  assert.throws(() => validateTemperatureAtlas({...manifest, tileStorage:'unknown'}));
  assert.throws(() => validateTemperatureAtlas({...manifest, tileBase:'./../secret'}));
  assert.match(temperatureTileUrl(base, 1, null, manifest.tileStorage), /^seasonatlas-weather-pack:/);

  const packBytes = fs.readFileSync(path.join(output, manifest.tileBase, '1.satpack'));
  const packData = arrayBuffer(packBytes), pack = parseTemperaturePack(packData);
  let hourlyRequest;
  const hourlyLoader = createTemperaturePackLoader(async url => {
    hourlyRequest = url; return new Response(packData.slice(0));
  });
  const hourlyUrl = temperatureTileUrl(base, 196, 3, manifest.tileStorage)
    .replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
  await hourlyLoader(hourlyUrl, new AbortController().signal);
  assert.equal(hourlyRequest, `${base}/03/196.satpack`, 'UTC hour remains part of the bundle URL');
  for (let z = 0; z <= 1; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) {
    assert.deepEqual(Buffer.from(temperaturePackTile(pack, z, x, y)), fs.readFileSync(path.join(source, `1/${z}/${x}/${y}.png`)));
  }
  assert.throws(() => temperaturePackTile(pack, 1, 2, 0));
  assert.throws(() => temperaturePackTile(pack, 2, 0, 0));
  assert.throws(() => parseTemperaturePack(packData.slice(0, -1)));
  const corrupt = packBytes.slice(); const bad = Buffer.from(corrupt); bad.writeUInt32LE(1, 8);
  assert.throws(() => parseTemperaturePack(arrayBuffer(bad)));
  assert.throws(() => parseTemperaturePack(new ArrayBuffer(26 * 1024 * 1024)));

  let requests = 0;
  server = http.createServer((request, response) => {
    requests++;
    const file = path.join(output, decodeURIComponent(request.url));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200); fs.createReadStream(file).pipe(response);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const remoteBase = temperatureAtlasBase(origin, manifest);
  const tileUrl = (day, z = 1, x = 0, y = 0) => temperatureTileUrl(remoteBase, day, null, manifest.tileStorage)
    .replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const loader = createTemperaturePackLoader();
  const controller = new AbortController();
  const tiles = await Promise.all([loader(tileUrl(1,1,0,1), controller.signal), loader(tileUrl(1,1,1,0), controller.signal)]);
  assert.equal(requests, 1, 'Visible tiles share one real HTTP bundle fetch');
  assert.deepEqual(Buffer.from(tiles[0]), fs.readFileSync(path.join(source,'1/1/0/1.png')));
  assert.deepEqual(Buffer.from(tiles[1]), fs.readFileSync(path.join(source,'1/1/1/0.png')));
  await loader(tileUrl(1), controller.signal); assert.equal(requests, 1, 'Cached frame is reused');
  for (let day = 2; day <= 6; day++) await loader(tileUrl(day), controller.signal);
  await loader(tileUrl(1), controller.signal); assert.equal(requests, 7, 'Old frames are evicted');
  await assert.rejects(loader(tileUrl(999), controller.signal), /HTTP 404/);

  // One consumer cancelling must not cancel another tile using the same pack.
  let complete, aborted = false;
  const shared = createTemperaturePackLoader((_url, options) => new Promise((resolve, reject) => {
    complete = () => resolve(new Response(packData.slice(0)));
    options.signal.addEventListener('abort', () => { aborted = true; reject(options.signal.reason); }, { once:true });
  }));
  const a = new AbortController(), b = new AbortController();
  const first = shared(tileUrl(1), a.signal), second = shared(tileUrl(1), b.signal);
  a.abort(); await assert.rejects(first, { name:'AbortError' }); assert.equal(aborted, false);
  complete(); await second;
  const c = new AbortController(), last = shared(tileUrl(2), c.signal);
  c.abort(); await assert.rejects(last, { name:'AbortError' }); assert.equal(aborted, true);

  let attempts = 0;
  const retry = createTemperaturePackLoader(async () => new Response(attempts++ ? packData.slice(0) : 'broken'));
  await assert.rejects(retry(tileUrl(1), controller.signal), /header/);
  await retry(tileUrl(1), controller.signal); assert.equal(attempts, 2, 'Failed bundles can be retried');
  assert.equal(packData.byteLength, packBytes.length, 'Tile copies never detach cached packs');
  fs.unlinkSync(path.join(source, '365/1/1/1.png'));
  const incomplete = path.join(temporary, 'incomplete');
  assert.notEqual(run(incomplete).status, 0, 'Missing tiles must fail packaging');
  assert.equal(fs.existsSync(incomplete), false, 'Failed packages are never published');

  // Optional full production audit: parse every bundle and compare reference
  // frames against original PNGs using the same runtime decoder as the browser.
  const actual = process.argv[2], original = process.argv[3];
  if (actual) {
    const metadata = validateTemperatureAtlas(JSON.parse(fs.readFileSync(path.join(actual, 'manifest.json'))));
    const hours = metadata.hours ?? [null]; let checked = 0, largest = 0;
    for (const hour of hours) for (const day of metadata.days) {
      const prefix = hour === null ? '' : `${String(hour).padStart(2,'0')}/`;
      const bytes = fs.readFileSync(path.join(actual, metadata.tileBase, `${prefix}${day}.satpack`));
      const decoded = parseTemperaturePack(arrayBuffer(bytes)); checked++; largest = Math.max(largest, bytes.length);
      if (original && [1,196,365].includes(day)) for (let z = 0; z <= metadata.maxzoom; z++) {
        for (let y = 0; y < 2 ** z; y++) for (let x = 0; x < 2 ** z; x++) {
          assert.deepEqual(Buffer.from(temperaturePackTile(decoded,z,x,y)), fs.readFileSync(path.join(original, `${prefix}${day}/${z}/${x}/${y}.png`)));
        }
      }
    }
    console.log(`Production audit: ${checked} bundles decoded; largest ${(largest/1024/1024).toFixed(2)} MiB; reference PNGs byte-identical.`);
  }
  console.log('Temperature packs: packaging, byte-exact extraction, external URLs, real HTTP, deduplication, LRU, cancellation, retries and malformed data pass.');
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(temporary, { recursive:true, force:true });
}
