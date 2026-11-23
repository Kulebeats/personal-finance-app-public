import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { collectApplicationLookupFootprint } from './application-lookup-footprint.mjs';
import * as lookup from './application-lookup-footprint.mjs';
import { parseApplicationPackageJson } from './application-package-json.mjs';
import { applicationEntryPath, applicationRelativeTarget } from './application-paths.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? '['+value.map(stable).join(',')+']' : value && typeof value === 'object'
  ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}' : JSON.stringify(value);
const base = fs.realpathSync.native(path.resolve('.local/r20-lookup-footprint'));
const toolPath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const toolStat=fs.lstatSync(toolPath,{bigint:true});
const metadataExecutable={path:toolPath,sizeBytes:Number(toolStat.size),sha256:hash(fs.readFileSync(toolPath)),dev:String(toolStat.dev),ino:String(toolStat.ino)};
const poison="throw new Error('MUST_NOT_EVALUATE_SELECTED_CODE');\n";
const put=(file,content)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);};
const manifest=(dir,value)=>put(path.join(dir,'package.json'),JSON.stringify(value));
function fixture() {
  const root=fs.mkdtempSync(path.join(base,'fixture-'));
  manifest(root,{name:'fixture-host',type:'module'});
  const parent=path.join(root,'app','main.mjs');put(parent,poison);
  return {root,parent};
}
function request(f,specifier='example',parent=f.parent) {
  return {kind:'application-lookup-request',version:1,parent:{path:parent,sizeBytes:fs.statSync(parent).size,sha256:hash(fs.readFileSync(parent))},
    specifier,importKind:'import-statement',mode:'esm-static',occurrences:1,scopeRoots:[f.root],dependencyRoots:[f.root],systemRoot:'C:\\Windows',metadataExecutable};
}
const collect=req=>{const text=stable(req)+'\n';return collectApplicationLookupFootprint(text,hash(text));};
const remove=root=>{assert.ok(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});};
function pkg(root,name,definition={exports:'./entry.mjs',type:'module'}) {
  const dir=path.join(root,'node_modules',...name.split('/'));manifest(dir,definition);put(path.join(dir,'entry.mjs'),poison);return dir;
}

test('collects different nearest installations for different physical parents without evaluating them',async()=>{
  const f=fixture();try {
    const other=path.join(f.root,'other','main.mjs');put(other,poison);
    const a=pkg(path.dirname(f.parent),'example'),b=pkg(path.dirname(other),'example');
    const first=await collect(request(f)),second=await collect(request(f,'example',other));
    assert.equal(first.status,'candidate');assert.equal(second.status,'candidate');
    assert.equal(first.packageRoot,a);assert.equal(second.packageRoot,b);
    assert.equal(first.certifications.nativeResolutionObserved,false);
    assert.equal(first.directories.every(row=>typeof row.identity.ino==='string' && (row.identity.attributes&16)!==0),true);
    assert.equal(first.absent.some(row=>row.path===path.join(path.dirname(f.parent),'package.json')),true);
  }finally{remove(f.root);}
});

test('captures scoped packages and conditional target order without selecting a condition',async()=>{
  const f=fixture();try {
    const dir=pkg(f.root,'@scope/example',{exports:{'.':{default:'./entry.mjs',import:'./import.mjs'}},type:'module'});
    put(path.join(dir,'import.mjs'),poison);
    const result=await collect(request(f,'@scope/example'));
    assert.equal(result.status,'candidate');
    assert.deepEqual(result.candidates.map(row=>path.basename(row.file.path)),['entry.mjs','import.mjs']);
    assert.equal(result.certifications.lookupFootprintAccepted,false);
  }finally{remove(f.root);}
});

test('self-reference takes priority over installed namesakes, including excluded subpaths',async()=>{
  const f=fixture();try {
    manifest(f.root,{name:'example',exports:{'.':'./self.mjs'},type:'module'});put(path.join(f.root,'self.mjs'),poison);pkg(f.root,'example');
    const result=await collect(request(f));assert.equal(result.selfReference,true);assert.equal(result.packageRoot,f.root);
    const excluded=await collect(request(f,'example/private'));assert.equal(excluded.selfReference,true);assert.equal(excluded.candidates.length,0);
  }finally{remove(f.root);}
});

test('a nearer manifest-less package blocks fallback to a farther installation',async()=>{
  const f=fixture();try {
    fs.mkdirSync(path.join(path.dirname(f.parent),'node_modules','example'),{recursive:true});pkg(f.root,'example');
    const result=await collect(request(f));assert.equal(result.status,'blocked');assert.equal(result.reason,'NEARER_PACKAGE_WITHOUT_MANIFEST');
  }finally{remove(f.root);}
});

test('captures a nested format scope and refuses ambiguous typeless JavaScript',async()=>{
  const f=fixture();try {
    const dir=pkg(f.root,'example',{exports:'./nested/entry.js'});manifest(path.join(dir,'nested'),{type:'module'});put(path.join(dir,'nested','entry.js'),poison);
    const result=await collect(request(f));assert.equal(result.status,'candidate');assert.equal(result.candidates[0].format,'esm');
    assert.equal(result.candidates[0].scopeManifest,path.join(dir,'nested','package.json'));
    manifest(path.join(dir,'nested'),{});
    const blocked=await collect(request(f));assert.equal(blocked.reason,'AMBIGUOUS_JAVASCRIPT_FORMAT');
  }finally{remove(f.root);}
});

test('keeps missing, directory, pattern, legacy fallback and boundary diagnostics distinct',async()=>{
  const cases=[
    [{exports:'./missing.mjs'},'MISSING_TARGET'],
    [{exports:'./directory'},'DIRECTORY_TARGET'],
    [{exports:{'./*':'./*.mjs'}},'EXPORTS_PATTERN'],
    [{main:'./missing'},'LEGACY_FALLBACK_REQUIRED'],
  ];
  for(const [definition,reason]of cases){const f=fixture();try{const dir=pkg(f.root,'example',definition);fs.mkdirSync(path.join(dir,'directory'));const result=await collect(request(f));assert.equal(result.reason,reason);}finally{remove(f.root);}}
  const f=fixture();try{const result=await collect(request(f,'absent'));assert.equal(result.reason,'BOUNDARY_REACHED');}finally{remove(f.root);}
});

test('rejects malformed or duplicate-key manifests rather than treating them as absent',async()=>{
  const f=fixture();try {
    const dir=pkg(f.root,'example');put(path.join(dir,'package.json'),'{"exports":"./entry.mjs","exports":"./other.mjs"}');
    await assert.rejects(collect(request(f)),/APPLICATION_LOOKUP_REFUSED/);
  }finally{remove(f.root);}
  assert.throws(()=>parseApplicationPackageJson('{"x":1,"\\u0078":2}'));
  assert.deepEqual(Object.keys(parseApplicationPackageJson('{"exports":{"default":"a","import":"b"}}').exports),['default','import']);
});

test('filesystem entries support scope names and spaces while rejecting aliases and escapes',()=>{
  assert.equal(applicationEntryPath('C:\\Fixture','@scope'),'C:\\Fixture\\@scope');
  assert.equal(applicationRelativeTarget('C:\\Fixture','folder with spaces/entry.mjs'),'C:\\Fixture\\folder with spaces\\entry.mjs');
  for(const name of ['..','.', 'child/escape','child\\escape','file?query','file#fragment','CON','file.']) assert.throws(()=>applicationEntryPath('C:\\Fixture',name));
  assert.throws(()=>applicationRelativeTarget('C:\\Fixture','child/../escape'));
});

test('self-reference still requires an approved dependency boundary',async()=>{
  const f=fixture();try {
    manifest(f.root,{name:'example',exports:'./self.mjs',type:'module'});put(path.join(f.root,'self.mjs'),poison);
    const req=request(f);req.dependencyRoots=[path.join(f.root,'node_modules')];
    assert.equal((await collect(req)).reason,'DEPENDENCY_BOUNDARY');
  }finally{remove(f.root);}
});

test('retains original dynamic import identity and occurrence counts on blocked results',async()=>{
  const f=fixture();try {
    const req=request(f,'absent');Object.assign(req,{importKind:'dynamic-import',mode:'esm-dynamic',occurrences:3});
    const result=await collect(req);assert.equal(result.importKind,'dynamic-import');assert.equal(result.mode,'esm-dynamic');assert.equal(result.occurrences,3);
    assert.equal(result.parent.path,f.parent);
    req.mode='esm-static';await assert.rejects(collect(req),/APPLICATION_LOOKUP_REFUSED/);
  }finally{remove(f.root);}
});

function batchRequest(f, names) {
  return { kind:'application-lookup-batch-request', version:2, scopeRoots:[f.root], dependencyRoots:[f.root], systemRoot:'C:\\Windows', metadataExecutable,
    deadlineMs:60000, files:[], edges:names.map(specifier => {
      const tuple=['app/main.mjs','import-statement','esm-static',specifier,false];
      return {key:stable(tuple),tuple,occurrences:1,parent:request(f,specifier).parent};
    }) };
}
const collectBatch = req => { const text=stable(req)+'\n'; return lookup.collectApplicationLookupFootprintsV2(text,hash(text)); };

test('batch collection retains complete missing directory typeless and empty target evidence in one measured union',async()=>{
  const f=fixture();try {
    const missing=pkg(f.root,'missing',{exports:'./absent.mjs'});
    const directory=pkg(f.root,'directory',{exports:'./folder'});fs.mkdirSync(path.join(directory,'folder'));
    const typeless=pkg(f.root,'typeless',{exports:'./entry.js'});put(path.join(typeless,'entry.js'),poison);
    const empty=pkg(f.root,'empty',{exports:'./empty.mjs'});put(path.join(empty,'empty.mjs'),'');
    assert.equal(typeof lookup.collectApplicationLookupFootprintsV2,'function','the graph census needs one aggregate collector');
    const result=await collectBatch(batchRequest(f,['missing','directory','typeless','empty']));
    assert.equal(result.footprints.every(row=>row.status==='complete'),true);
    assert.deepEqual(result.footprints.map(row=>row.leaves[0].kind),['missing','directory','file','file']);
    assert.equal(result.footprints[2].leaves[0].format,'unestablished-js');
    const data=result.files.find(row=>row.path===path.join(empty,'empty.mjs'));
    assert.equal(data.sizeBytes,0);assert.equal(data.sha256,hash(''));
    assert.ok(result.absent.some(row=>row.path===path.join(missing,'absent.mjs')));
    assert.equal(new Set(result.files.map(row=>row.path)).size,result.files.length);
    assert.ok(result.fileIdentities.every(row=>typeof row.ino==='string'));
    assert.equal(result.certifications.nativeResolutionObserved,false);
  }finally{remove(f.root);}
});

test('batch keeps an incomplete graph row without manufacturing nested absences or resetting an expired budget',async()=>{
  const f=fixture();try {
    pkg(f.root,'nested',{exports:'./absent/entry.js'});
    assert.equal(typeof lookup.collectApplicationLookupFootprintsV2,'function');
    const req=batchRequest(f,['nested']);const result=await collectBatch(req);
    assert.equal(result.footprints[0].status,'incomplete');
    assert.equal(result.absent.some(row=>row.path.endsWith('absent\\entry.js')),false);
    await assert.rejects(lookup.collectApplicationLookupFootprintsV2(stable(req)+'\n',hash(stable(req)+'\n'),performance.now()-1),/APPLICATION_LOOKUP_REFUSED/);
  }finally{remove(f.root);}
});

test('batch rejects an empty manifest as invalid measured input rather than treating it as empty target data',async()=>{
  const f=fixture();try{const dir=pkg(f.root,'empty-manifest');put(path.join(dir,'package.json'),'');
    await assert.rejects(collectBatch(batchRequest(f,['empty-manifest'])),/APPLICATION_LOOKUP_REFUSED/);
  }finally{remove(f.root);}
});
