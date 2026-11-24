/** Check the annual chart's non-leap calendar and interpolation at missing/wrapped boundaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const compiled = {exports:{}};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:file})(id=>load(path.join(path.dirname(file),id+'.ts')),compiled,compiled.exports);
  modules.set(file,compiled.exports);return compiled.exports;
}
const {annualValue,MONTH_CENTRES}=load('lib/weather/annual.ts');
assert.equal(MONTH_CENTRES.length,12);
assert.equal(MONTH_CENTRES[0],16);
assert.equal(MONTH_CENTRES[1],45.5);
assert.equal(MONTH_CENTRES[11],350);
const values=Array.from({length:12},(_,i)=>i*2);
for(let i=0;i<12;i++)assert.equal(annualValue(values,MONTH_CENTRES[i]),values[i]);
assert.equal(annualValue(values,(MONTH_CENTRES[5]+MONTH_CENTRES[6])/2),11);
assert.equal(annualValue(values,1),22*(1-16/31));
assert.equal(annualValue(values,365),22*(1-15/31));
assert.equal(annualValue(Array(12).fill(10),365),10);
const missing=[...values];missing[0]=null;
assert.equal(annualValue(missing,1),null);
assert.equal(annualValue(missing,MONTH_CENTRES[1]),2);
assert.equal(annualValue(missing,30),null);
console.log('Annual chart: month centres, exact values, cyclic January/December interpolation, constants and missing-data gaps pass.');
