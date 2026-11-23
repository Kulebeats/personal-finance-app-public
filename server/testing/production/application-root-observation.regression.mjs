import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import * as inventory from './application-root-inventory-v2.mjs';

let observer;
try{observer=await import('./application-root-observation.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const hash=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const json=value=>stable(value)+'\n',source=path.dirname(fileURLToPath(import.meta.url)),runner=path.join(source,'application-root-observation-runner.mjs');
const executable=inventory.applicationV2Executable;
const pin=name=>({path:name,sizeBytes:fs.statSync(name).size,sha256:hash(fs.readFileSync(name))});
const outputPin=name=>{const {path,...bytes}=pin(name);return bytes;};
const put=(name,bytes)=>{fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,bytes);};
function fixture(definitions={}){
  const base=path.resolve('.local/r20-observer-v2/fixtures');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'fixture-')),emission=path.join(root,'emission');
  const marker=path.join(root,'EVALUATED'),poison=name=>`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},${JSON.stringify(name)});throw new Error('MUST_NOT_EVALUATE');\n`;
  put(path.join(root,'package.json'),JSON.stringify({name:'fixture-self',type:'module',exports:{'.':'./self.mjs'}}));put(path.join(root,'self.mjs'),poison('self'));
  const app='dist/production-application.js',getter='.runtime/trusted/server/config/redis/production-slot.mjs',bootstrap='.runtime/trusted/server/config/redis/production-slot-bootstrap.mjs';
  const members=[app,getter,bootstrap];for(const member of members)put(path.join(emission,...member.split('/')),poison(member));
  const packageDir=(name,definition,files={},parentRoot=root)=>{const dir=path.join(parentRoot,'node_modules',...name.split('/'));put(path.join(dir,'package.json'),JSON.stringify({name,...definition}));
    for(const [name,bytes]of Object.entries(files))put(path.join(dir,name),bytes);return dir;};
  const selected=packageDir('example',definitions.example??{type:'module',exports:'./entry.mjs'},{'entry.mjs':poison('outer')});
  const inner=packageDir('example',{type:'module',exports:'./entry.mjs'},{'entry.mjs':poison('inner')},path.dirname(path.join(emission,...getter.split('/'))));
  const sourcePin=name=>({path:name,format:name.endsWith('.ts')?'typescript':'javascript',sizeBytes:42,sha256:hash(name)}),entry=sourcePin('server/production-application.ts');
  const external=(parent,specifier,kind='import-statement',extra={})=>({parent,specifier,kind,target:null,external:true,...extra});
  const body={schemaVersion:1,provenance:{applicationBundle:true,applicationEntry:entry.path,architecture:'arm64',compiler:'esbuild',compilerVersion:'0.25.12',
    node:'v24.22.0',platform:'win32',splitting:false,target:'node24',trustedModulesBundled:false},
    application:{stagePath:app,esbuildOutputPath:app,format:'esm',source:entry,output:outputPin(path.join(emission,...app.split('/'))),
      inputs:[{...entry,imports:4}],imports:[{parent:app,specifier:'../'+getter,kind:'import-statement',target:getter,external:true},external(app,'example'),external(app,'node:fs'),external(app,'require-only','require-call')]},
    trustedGraph:{roots:[getter,bootstrap].map(stagePath=>({stagePath,sourcePath:stagePath.slice(17)})),members:[getter,bootstrap].map(stagePath=>({stagePath,format:'esm',source:sourcePin(stagePath.slice(17)),
      output:outputPin(path.join(emission,...stagePath.split('/'))),imports:[external(stagePath,'example',stagePath===getter?'dynamic-import':'export')]}))}};
  const toolPath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',toolStat=fs.statSync(toolPath,{bigint:true});
  const request={kind:'pfa-application-root-collection-request',version:2,collectionArgv:[runner,'collect'],
    identity:{candidateId:randomUUID(),evidenceClass:'synthetic-fixture',reviewRef:'r20-v2-synthetic',sourceRevision:'8'.repeat(40),observerEntry:runner,
      resolverEntry:path.join(source,'application-native-resolution-child.mjs'),harnessFiles:inventory.applicationV2HarnessPaths.map(pin)},
    graph:null,runtime:{executable:pin(executable),version:'24.22.0',platform:'win32',arch:'arm64',observerArgv:[runner,'observe'],
      resolverArgv:['--experimental-import-meta-resolve',path.join(source,'application-native-resolution-child.mjs')],environmentPolicy:'clean-windows-arm64-utc-v1'},
    resolutionPolicy:{profile:'native-default-esm-v1',additionalConditions:[],deadlineMs:60000,metadataBatchSize:1024},dependencyRoots:[root],scopeRoots:[root],
    metadataTool:{systemRoot:'C:\\Windows',executable:{...pin(toolPath),dev:String(toolStat.dev),ino:String(toolStat.ino)},linkCount:2}};
  let graphText;
  const rewriteGraph=()=>{const graph={...body,graphSha256:hash(stable(body))};graphText=json(graph);put(path.join(emission,'.runtime','production-profile.json'),graphText);
    request.graph={rawSha256:hash(graphText),rawSize:Buffer.byteLength(graphText),graphSha256:graph.graphSha256,schemaVersion:1,emissionRoot:emission,relativePath:'.runtime/production-profile.json'};};
  rewriteGraph();return {root,emission,marker,poison,selected,inner,request,body,packageDir,rewriteGraph,get graphText(){return graphText;},close:()=>{
    assert.ok(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});}};
}
const externalPins=candidateText=>{const d=JSON.parse(candidateText);return json({inventorySha256:hash(candidateText),
  ...Object.fromEntries(['identity','graph','runtime','resolutionPolicy','dependencyRoots','scopeRoots','metadataTool'].map(key=>[key,d[key]]))});};
async function run(command,input,overrides={}){const serialized=json(input);return await new Promise(resolve=>{
  let outcome,closed=false;const settle=()=>{if(closed&&outcome)resolve(outcome);};
  const child=childProcess.execFile(executable,[...(overrides.flags??[]),runner,command],{env:{...inventory.applicationV2Environment,...overrides.env},windowsHide:true,shell:false,
    encoding:'utf8',maxBuffer:8*1024*1024,timeout:65000},(error,stdout,stderr)=>{outcome={error,stdout,stderr};settle();});
  child.once('close',()=>{closed=true;settle();});child.stdin.on('error',()=>child.kill());child.stdin.end(serialized);
});}
async function collect(f){const requestText=json(f.request),raw=await run('collect',{graphText:f.graphText,requestText,expectedRequestSha256:hash(requestText)});
  assert.equal(raw.error,null,raw.stderr);return JSON.parse(raw.stdout);}
const observeInput=(f,candidateText,pinsText=externalPins(candidateText))=>({graphText:f.graphText,inventoryText:candidateText,pinsText});

function typelessProofFixture(profile){const f=fixture({example:{exports:'./entry.js'}});
  const body=`require('node:fs').writeFileSync(${JSON.stringify(f.marker)},'selected CommonJS ran');void import('node:fs');throw new Error('MUST_NOT_EVALUATE');`;
  for(const directory of [f.selected,f.inner]){put(path.join(directory,'package.json'),JSON.stringify({name:'example',exports:{import:'./entry.js',unused:'./not-selected.js'}}));
    put(path.join(directory,'entry.js'),body);put(path.join(directory,'not-selected.js'),'export const unused=1;');}
  f.request.resolutionPolicy.profile=profile;return f;}
test('format proof RED joined opt-in retains all tuples and alternatives while proving selected typeless CommonJS in both actual passes',async()=>{
  const f=typelessProofFixture('native-default-esm-cjs-proof-v2');try{
    const report=await collect(f);assert.equal(report.status,'collected');const declaration=JSON.parse(report.candidateText);
    assert.equal(declaration.footprints.length,3);assert.equal(declaration.footprints.every(row=>row.leaves.length===2),true);
    assert.equal(declaration.footprints.every(row=>row.leaves.every(leaf=>leaf.format==='unestablished-js')),true);
    const raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);const result=JSON.parse(raw.stdout);
    assert.equal(result.version,2);assert.equal(result.nativePasses.length,2);assert.equal(result.census.nativeRowsMeasured,6);assert.equal(result.census.packageFootprintsRequired,3);
    assert.deepEqual(result.nativePasses[0].rows,result.nativePasses[1].rows);assert.equal(fs.existsSync(f.marker),false);
    assert.equal(Object.values(result.certifications).every(value=>value===false),true);
    console.log(json({kind:'format-proof-joined-two-pass-reached',nativeRows:result.census.nativeRowsMeasured,usableRows:result.census.usableFormatRows,
      outcomes:result.outcomes.map(row=>({parent:row.parent,kind:row.kind,occurrences:row.occurrences,blocker:row.blocker,interpretedFormat:row.interpretedFormat}))}));
    assert.equal(result.census.usableFormatRows,3,'missing proof must be the behavioral failure after a complete two-child journey');
    for(const outcome of result.outcomes){assert.equal(outcome.raw.format,'unestablished-js');assert.equal(outcome.raw.syntaxProof.status,'commonjs-parse');
      assert.equal(outcome.interpretedFormat,'commonjs');assert.equal(outcome.blocker,null);}
  }finally{f.close();}
});
test('format proof old profile keeps typeless selected blockers and unchanged version1 payloads',async()=>{
  const f=typelessProofFixture('native-default-esm-v1');try{const report=await collect(f),raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);
    const result=JSON.parse(raw.stdout);assert.equal(result.version,1);assert.equal(result.census.usableFormatRows,0);assert.equal(result.census.observedBlockedRows,3);
    for(const outcome of result.outcomes){assert.equal(outcome.blocker,'AMBIGUOUS_JAVASCRIPT_FORMAT');assert.equal(outcome.interpretedFormat,'unestablished-js');assert.equal(Object.hasOwn(outcome.raw,'syntaxProof'),false);}
    assert.equal(fs.existsSync(f.marker),false);
  }finally{f.close();}
});

function fiveParentProofFixture(profile){
  const f=fixture(),specifier='five-parent-shared';
  const shared=f.packageDir(specifier,{exports:{import:'./entry.js',unused:'./not-selected.js'}},{
    'entry.js':`require('node:fs').writeFileSync(${JSON.stringify(f.marker)},'shared CommonJS ran');void import('node:fs');throw new Error('MUST_NOT_EVALUATE');`,
    'not-selected.js':'export const unused=1;'});
  const getter=f.body.trustedGraph.members[0];
  for(const name of ['one','two']){
    const sourcePath='server/testing/five-parent-'+name+'.mjs',stagePath='.runtime/trusted/'+sourcePath;
    f.body.trustedGraph.members.push({stagePath,format:'esm',source:{path:sourcePath,format:'javascript',sizeBytes:42,sha256:hash(sourcePath)},
      output:null,imports:[{parent:stagePath,specifier,kind:'import-statement',target:null,external:true}]});
    getter.imports.push({parent:getter.stagePath,specifier:path.posix.relative(path.posix.dirname(getter.stagePath),stagePath),
      kind:'import-statement',target:stagePath,external:false});
  }
  const parents=[f.body.application,...f.body.trustedGraph.members];
  for(const member of parents){
    const edge=member.imports.find(edge=>edge.specifier==='example');if(edge){edge.specifier=specifier;edge.kind='import-statement';}
    const file=path.join(f.emission,...member.stagePath.split('/'));
    put(file,member.imports.map(edge=>edge.kind==='require-call'?`require(${JSON.stringify(edge.specifier)});`:`import ${JSON.stringify(edge.specifier)};`).join('\n')+'\n'+f.poison(member.stagePath));
    member.output=outputPin(file);
  }
  f.request.resolutionPolicy.profile=profile;f.rewriteGraph();return {...f,shared,specifier,parents};
}

for(const [profile,proof] of [['native-default-esm-cjs-proof-v2',true],['native-default-esm-v1',false]]){
test('format proof five distinct emitted parents retain one physical selected source in two actual passes: '+profile,async()=>{
  const f=fiveParentProofFixture(profile);try{
    const report=await collect(f);assert.equal(report.status,'collected');const declaration=JSON.parse(report.candidateText);
    assert.deepEqual(report.census,{members:5,sourceMappings:5,graphEdges:10,importOccurrences:10,internalOccurrences:3,builtinOccurrences:1,
      typeOnlyOccurrences:0,packageOccurrences:5,unsupportedOccurrences:1,packageFootprintsRequired:5,packageFootprintsComplete:5,
      nativeRowsRequired:10,nativeRowsMeasured:0,usableFormatRows:0,observedBlockedRows:0});
    const expectedParents=f.parents.map(member=>member.stagePath).sort(),selected=fs.realpathSync.native(path.join(f.shared,'entry.js'));
    const expectedTuples=expectedParents.map(parent=>stable([parent,'import-statement','esm-static',f.specifier,false])).sort();
    assert.equal(new Set(expectedParents).size,5);assert.equal(declaration.members.length,5);
    assert.equal(new Set(declaration.members.map(member=>{const stat=fs.statSync(member.output.path,{bigint:true});return stat.dev+':'+stat.ino;})).size,5);
    assert.equal(declaration.footprints.length,5);assert.deepEqual(declaration.footprints.map(row=>row.key).sort(),expectedTuples);
    for(const footprint of declaration.footprints){assert.equal(footprint.status,'complete');assert.equal(footprint.packageRoot,f.shared);
      assert.deepEqual(footprint.leaves.map(leaf=>[leaf.path,leaf.kind,leaf.format]),['entry.js','not-selected.js'].map(name=>[path.join(f.shared,name),'file','unestablished-js']));}
    const identity=declaration.fileIdentities.find(row=>row.path===selected),stat=fs.statSync(selected,{bigint:true});
    assert.deepEqual(identity,{path:selected,dev:String(stat.dev),ino:String(stat.ino)});
    const {kind:targetKind,...selectedPin}=declaration.files.find(row=>row.path===selected);assert.equal(targetKind,'target');assert.deepEqual(selectedPin,pin(selected));
    const expectedSource={...selectedPin,dev:identity.dev,ino:identity.ino};
    assert.deepEqual(declaration.files.filter(row=>row.kind==='target').map(row=>row.path).sort(),[selected,path.join(f.shared,'not-selected.js')].sort());
    assert.deepEqual(declaration.certifications,inventory.applicationV2Certifications);
    const declarationBefore=json(declaration),raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);
    const result=JSON.parse(raw.stdout);assert.equal(result.kind,'application-root-observation-payload');assert.equal(result.version,proof?2:1);
    assert.equal(result.nativePasses.length,2);assert.equal(result.census.nativeRowsMeasured,10);assert.equal(result.census.nativeRowsRequired,10);
    assert.deepEqual(result.census,{...report.census,nativeRowsMeasured:10,usableFormatRows:proof?5:0,observedBlockedRows:proof?0:5});
    assert.equal(result.blockers.length,proof?1:6);assert.deepEqual(result.blockers.filter(row=>row.reason==='REQUIRE_UNSUPPORTED'),report.blockers.filter(row=>row.reason==='REQUIRE_UNSUPPORTED'));
    assert.equal(result.outcomes.length,5);assert.deepEqual(result.outcomes.map(row=>row.key).sort(),expectedTuples);
    assert.notEqual(result.nativePasses[0].requestSha256,result.nativePasses[1].requestSha256);
    assert.deepEqual(result.nativePasses[0].rows,result.nativePasses[1].rows);
    for(const pass of result.nativePasses){assert.equal(pass.rows.length,5);assert.equal(pass.version,proof?2:1);
      assert.deepEqual(pass.rows.map(row=>row.parent).sort(),expectedParents);assert.equal(new Set(pass.rows.map(row=>stable([row.parent,row.kind,row.mode,row.specifier,false]))).size,5);
      assert.equal(Object.values(pass.certifications).every(value=>value===false),true);
      for(const row of pass.rows){const parent=declaration.members.find(member=>member.stagePath===row.parent),physical=declaration.fileIdentities.find(pin=>pin.path===parent.output.path);
        assert.equal(row.kind,'import-statement');assert.equal(row.occurrences,1);assert.deepEqual(row.parentPin,{...parent.output,dev:physical.dev,ino:physical.ino});
        assert.equal(row.parentUrl,parent.parentUrl);assert.equal(row.diagnostic.kind,'resolved-file');assert.equal(row.diagnostic.url,pathToFileURL(selected).href);
        assert.equal(row.diagnostic.format,'unestablished-js');
        if(proof)assert.deepEqual(row.diagnostic.syntaxProof,{method:'node24-cjs-compile-v1',source:expectedSource,status:'commonjs-parse',reason:null});
        else assert.equal(Object.hasOwn(row.diagnostic,'syntaxProof'),false);}}
    for(const outcome of result.outcomes){assert.equal(outcome.raw.url,pathToFileURL(selected).href);assert.equal(outcome.interpretedFormat,proof?'commonjs':'unestablished-js');
      assert.equal(outcome.blocker,proof?null:'AMBIGUOUS_JAVASCRIPT_FORMAT');
      assert.deepEqual(outcome.raw,result.nativePasses[0].rows.find(row=>row.parent===outcome.parent).diagnostic);}
    assert.equal(json(declaration),declarationBefore);assert.equal(report.candidateText,declarationBefore);
    assert.deepEqual(result.certifications,inventory.applicationV2Certifications);assert.equal(Object.values(result.certifications).every(value=>value===false),true);
    assert.deepEqual(result.limitations,declaration.limitations);assert.equal(fs.existsSync(f.marker),false);
    console.log(json({kind:'format-proof-five-parent-assertions-reached',profile,census:result.census,parents:expectedParents,selectedSource:expectedSource,
      passRows:result.nativePasses.map(pass=>pass.rows.length),alternativeLeaves:declaration.footprints.map(row=>row.leaves.length),allAuthorityFlagsFalse:true,canaryExecuted:false}));
  }finally{f.close();}
});
}

test('format proof scope keeps explicit types and unknown types separate from typeless positive proof', async () => {
  const f = typelessProofFixture('native-default-esm-cjs-proof-v2');
  try {
    const body = `require('node:fs').writeFileSync(${JSON.stringify(f.marker)},'MUST_NOT_RUN');`;
    const cases = [
      ['explicit-module', { type: 'module' }, 'esm', null],
      ['explicit-commonjs', { type: 'commonjs' }, 'commonjs', null],
      ['unknown-type', { type: 'future-format' }, 'unestablished-js', 'AMBIGUOUS_JAVASCRIPT_FORMAT'],
      ['nested-typeless', { type: 'module' }, 'commonjs', null],
      ['unproven-esm', {}, 'unestablished-js', 'AMBIGUOUS_JAVASCRIPT_FORMAT'],
    ];
    for (const [name, definition] of cases) {
      const nested = name === 'nested-typeless';
      f.packageDir(name, { ...definition, exports: nested ? './nested/entry.js' : './entry.js' }, nested
        ? { 'nested/package.json': '{}', 'nested/entry.js': body }
        : { 'entry.js': name === 'unproven-esm' ? 'export const value=1;' : body });
      f.body.application.imports.push({ parent: f.body.application.stagePath, specifier: name,
        kind: 'import-statement', target: null, external: true });
    }
    f.rewriteGraph();
    const report = await collect(f);
    assert.equal(report.status, 'collected');
    const raw = await run('observe', observeInput(f, report.candidateText));
    assert.equal(raw.error, null, raw.stderr);
    const result = JSON.parse(raw.stdout);
    assert.equal(result.version, 2);
    assert.equal(result.nativePasses.length, 2);
    assert.deepEqual(result.nativePasses[0].rows, result.nativePasses[1].rows);
    for (const [name, , format, blocker] of cases) {
      const outcome = result.outcomes.find(row => row.specifier === name);
      assert.equal(outcome.interpretedFormat, format, name);
      assert.equal(outcome.blocker, blocker, name);
      if (name.startsWith('explicit-')) assert.equal(outcome.raw.syntaxProof, null);
      else assert.equal(outcome.raw.syntaxProof.status, name === 'unproven-esm' ? 'unproven' : 'commonjs-parse');
    }
    assert.equal(Object.values(result.certifications).every(value => value === false), true);
    assert.equal(fs.existsSync(f.marker), false);
  } finally { f.close(); }
});

test('the joined clean runner collects externally pinned graph roots and makes two actual inert native observations',async()=>{
  assert.equal(typeof observer?.collectApplicationRootCandidate,'function','a joined observer must exist');const f=fixture();try{
    const report=await collect(f);assert.equal(report.status,'collected');assert.equal(typeof report.candidateText,'string');
    const raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);const result=JSON.parse(raw.stdout);
    assert.equal(result.status,'observed-with-blockers');assert.equal(result.census.packageFootprintsRequired,3);assert.equal(result.census.nativeRowsMeasured,6);
    assert.equal(result.nativePasses.length,2);assert.notEqual(result.nativePasses[0].requestSha256,result.nativePasses[1].requestSha256);
    assert.deepEqual(result.nativePasses[0].rows,result.nativePasses[1].rows);
    assert.equal(new Set(result.outcomes.map(row=>row.raw.url)).size,2);assert.equal(Object.values(result.certifications).every(flag=>flag===false),true);
    assert.equal(fs.existsSync(f.marker),false);assert.throws(()=>observer.requireApplicationRootObservation(result),/APPLICATION_OBSERVATION_REFUSED/);
  }finally{f.close();}
});
test('whole census retains conditional alternatives nested scopes scoped names self-reference and repeated occurrences',async()=>{
  const f=fixture();const oldOptions=process.env.NODE_OPTIONS,oldCoverage=process.env.NODE_V8_COVERAGE;
  try{
    const conditional=f.packageDir('conditional',{type:'module',exports:{custom:'./custom.mjs',import:{default:'./nested/entry.js'},default:'./unused-missing.mjs'}},
      {'custom.mjs':f.poison('unused-custom'),'nested/entry.js':f.poison('nested-commonjs'),'nested/package.json':JSON.stringify({type:'commonjs'})});
    f.packageDir('@scope/shared',{type:'module',exports:'./entry.mjs'},{'entry.mjs':fs.readFileSync(path.join(f.selected,'entry.mjs'))});
    for(const specifier of ['conditional','@scope/shared','fixture-self','example'])f.body.application.imports.push({parent:f.body.application.stagePath,specifier,kind:'import-statement',target:null,external:true});
    f.rewriteGraph();const preload=path.join(f.root,'poison-preload.mjs');put(preload,f.poison('preload'));
    process.env.NODE_OPTIONS='--import='+pathToFileURL(preload).href;process.env.NODE_V8_COVERAGE=path.join(f.root,'forbidden-coverage');
    const report=await collect(f),d=JSON.parse(report.candidateText);assert.equal(report.status,'collected');assert.equal(d.footprints.length,6);
    const sameByteTargets=d.files.filter(row=>row.sha256===hash(fs.readFileSync(path.join(f.selected,'entry.mjs'))));
    assert.equal(sameByteTargets.length,2);assert.notEqual(sameByteTargets[0].path,sameByteTargets[1].path);
    const conditionalFootprint=d.footprints.find(row=>row.tuple[3]==='conditional');assert.deepEqual(conditionalFootprint.leaves.map(row=>path.basename(row.path)),['custom.mjs','entry.js','unused-missing.mjs']);
    assert.equal(conditionalFootprint.leaves[1].scope.manifest,path.join(conditional,'nested/package.json'));assert.equal(d.footprints.find(row=>row.tuple[3]==='fixture-self').selfReference,true);
    for(const mutate of [v=>v.footprints.pop(),v=>v.footprints[0].occurrences++,v=>v.footprints[0].tuple[0]='dist/wrong.js',
      v=>v.footprints.find(row=>row.tuple[3]==='conditional').leaves[1].scope.steps.shift()]){
      const changed=structuredClone(d);mutate(changed);const text=json(changed);assert.throws(()=>inventory.readApplicationRootInventoryV2(f.graphText,text,externalPins(text)),/APPLICATION_INVENTORY_V2_REFUSED/);
    }
    const raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);const result=JSON.parse(raw.stdout);
    assert.equal(result.census.packageOccurrences,7);assert.equal(result.census.nativeRowsMeasured,12);
    const selected=result.outcomes.find(row=>row.specifier==='conditional');assert.equal(selected.interpretedFormat,'commonjs');assert.equal(selected.blocker,null);
    assert.equal(selected.raw.url,pathToFileURL(path.join(conditional,'nested/entry.js')).href);assert.equal(selected.raw.format,'unestablished-js');
    assert.equal(fs.existsSync(f.marker),false);assert.equal(fs.existsSync(path.join(f.root,'forbidden-coverage')),false);
  }finally{if(oldOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=oldOptions;
    if(oldCoverage===undefined)delete process.env.NODE_V8_COVERAGE;else process.env.NODE_V8_COVERAGE=oldCoverage;f.close();}
});
test('mixed incomplete and complete collection preserves census, blocks all native probes, and refuses an obsolete incomplete declaration',async()=>{
  const f=fixture({example:{exports:'./absent/entry.js'}});try{
    const report=await collect(f);assert.equal(report.status,'blocked');assert.equal(typeof report.candidateText,'string');const d=JSON.parse(report.candidateText);
    assert.equal(d.footprints.length,3);assert.ok(d.footprints.some(row=>row.status==='complete'));assert.ok(d.footprints.some(row=>row.status==='incomplete'));
    const record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
    assert.equal(inventory.requireApplicationRootInventoryV2(record).footprintStatus,'incomplete');
    const original=childProcess.execFile;let actualNativeLaunches=0;
    try{childProcess.execFile=function(exe,args,options,callback){if(exe===executable&&args[0]==='--experimental-import-meta-resolve')actualNativeLaunches++;return original(exe,args,options,callback);};syncBuiltinESMExports();
      const inProcess=await reflectedHost('observe',()=>observer.observeApplicationRootResolution(record));assert.equal(actualNativeLaunches,0);
      assert.throws(()=>observer.requireApplicationRootObservation(inProcess),/APPLICATION_OBSERVATION_REFUSED/);
    }finally{childProcess.execFile=original;syncBuiltinESMExports();}
    const blocked=await run('observe',observeInput(f,report.candidateText));assert.equal(blocked.error,null,blocked.stderr);const result=JSON.parse(blocked.stdout);
    assert.equal(result.kind,'pfa-application-root-observation-blocked');assert.equal(result.census.nativeRowsMeasured,0);assert.equal(result.nativePasses.length,0);
    assert.throws(()=>observer.requireApplicationRootObservation(result),/APPLICATION_OBSERVATION_REFUSED/);
    put(path.join(f.selected,'absent','entry.js'),f.poison('formerly-missing'));put(path.join(f.selected,'absent','package.json'),JSON.stringify({type:'module'}));
    const stale=await run('observe',observeInput(f,report.candidateText));assert.ok(stale.error);assert.equal(stale.stdout,'');
    const fresh=await collect(f);assert.equal(fresh.status,'collected');const observed=await run('observe',observeInput(f,fresh.candidateText));assert.equal(observed.error,null,observed.stderr);
  }finally{f.close();}
});
test('incomplete reason stopping-point and known-probe tampering refuse structurally or on exact reconstruction',async()=>{
  const f=fixture({example:{exports:'./absent/entry.js'}});try{const report=await collect(f),d=JSON.parse(report.candidateText);
    for(const mutate of [v=>{const row=v.footprints.find(row=>row.status==='incomplete');row.reason='LEGACY_FALLBACK_REQUIRED';},
      v=>{const row=v.footprints.find(row=>row.status==='incomplete');row.stoppingPoint.path=path.join(f.selected,'different.mjs');},
      v=>{const row=v.footprints.find(row=>row.status==='incomplete');row.parentScope.steps.shift();},
      v=>{const row=v.footprints.find(row=>row.status==='incomplete');row.status='complete';delete row.reason;delete row.stoppingPoint;}]){
      const changed=structuredClone(d);mutate(changed);const text=json(changed);let record;
      try{record=inventory.readApplicationRootInventoryV2(f.graphText,text,externalPins(text));}catch(error){assert.match(error.message,/APPLICATION_INVENTORY_V2_REFUSED/);continue;}
      await assert.rejects(reflectedHost('observe',()=>observer.observeApplicationRootResolution(record)),/APPLICATION_OBSERVATION_REFUSED/);
    }
  }finally{f.close();}
});
test('alternative leaves preserve missing directory typeless empty and manifest-as-JSON outcomes without guessing formats',async()=>{
  for(const [definition,setup,expected]of [
    [{exports:'./absent.mjs'},()=>{},'MISSING_TARGET'],[{exports:'./directory'},dir=>fs.mkdirSync(path.join(dir,'directory')),'DIRECTORY_TARGET'],
    [{exports:'./entry.js'},(dir,f)=>put(path.join(dir,'entry.js'),f.poison('typeless')),'AMBIGUOUS_JAVASCRIPT_FORMAT'],
    [{exports:'./empty.mjs'},dir=>put(path.join(dir,'empty.mjs'),''),null],[{exports:'./package.json'},()=>{},'UNSUPPORTED_SELECTED_FORMAT'],
    [{exports:{require:'./entry.mjs'}},()=>{},'PACKAGE_PATH_NOT_EXPORTED']]){
    const f=fixture({example:definition});try{setup(f.selected,f);const report=await collect(f);assert.equal(report.status,'collected');
      if(definition.exports==='./package.json')assert.equal(JSON.parse(report.candidateText).files.filter(row=>row.path===path.join(f.selected,'package.json')).length,1);
      const raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);const result=JSON.parse(raw.stdout);
      const app=result.outcomes.find(row=>row.parent==='dist/production-application.js');assert.equal(app.blocker,expected);assert.equal(fs.existsSync(f.marker),false);
      if(expected==='AMBIGUOUS_JAVASCRIPT_FORMAT')assert.equal(app.raw.format,'unestablished-js');
    }finally{f.close();}
  }
});
test('a zero-package graph preserves its census and measures without fabricated native probes',async()=>{
  const f=fixture();try{for(const member of [f.body.application,...f.body.trustedGraph.members])member.imports=member.imports.filter(edge=>edge.target!==null||edge.specifier==='node:fs');f.rewriteGraph();
    const report=await collect(f);const raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);const result=JSON.parse(raw.stdout);
    assert.equal(result.census.packageFootprintsRequired,0);assert.equal(result.census.nativeRowsRequired,0);assert.equal(result.census.nativeRowsMeasured,0);assert.deepEqual(result.nativePasses,[]);
  }finally{f.close();}
});
test('fixed runner rejects actual flags environment aliases and stale independent pins before native authority',async()=>{
  const f=fixture();try{const report=await collect(f);for(const overrides of [{flags:['--experimental-import-meta-resolve']},{env:{CAPITAL_SECRET:'refuse'}}]){
    const raw=await run('observe',observeInput(f,report.candidateText),overrides);assert.ok(raw.error);assert.equal(raw.stdout,'');}
    const d=JSON.parse(report.candidateText);d.identity.sourceRevision='f'.repeat(40);const changed=json(d);
    const stale=await run('observe',observeInput(f,changed,externalPins(report.candidateText)));assert.ok(stale.error);assert.equal(stale.stdout,'');
    const substituted=path.join(f.selected,'entry.mjs'),bytes=fs.readFileSync(substituted);fs.renameSync(substituted,substituted+'.old');put(substituted,bytes);
    const inode=await run('observe',observeInput(f,report.candidateText));assert.ok(inode.error);assert.equal(inode.stdout,'');assert.equal(fs.existsSync(f.marker),false);
  }finally{f.close();}
});

// In-process phase interposition tests use reflected host values only to reach
// orchestration; actual clean process/argv evidence comes from the runner tests.
async function reflectedHost(command,work){const argv=process.argv,execArgv=process.execArgv,env={...process.env};
  try{process.argv=[executable,runner,command];process.execArgv=[];for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,inventory.applicationV2Environment);return await work();}
  finally{process.argv=argv;process.execArgv=execArgv;for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);}}
test('a genuine same-realm observation works, clones refuse, and target drift between actual children yields no brand',async()=>{
  const f=fixture(),original=childProcess.execFile;try{const report=await collect(f),record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
    let children=0;childProcess.execFile=function(exe,args,options,callback){const child=original(exe,args,options,callback);if(exe===executable&&args[0]==='--experimental-import-meta-resolve')children++;return child;};syncBuiltinESMExports();
    const observed=await reflectedHost('observe',()=>observer.observeApplicationRootResolution(record));assert.equal(children,2);
    assert.equal(Object.isFrozen(observer.requireApplicationRootObservation(observed)),true);assert.throws(()=>observer.requireApplicationRootObservation({...observed}),/APPLICATION_OBSERVATION_REFUSED/);
    children=0;childProcess.execFile=function(exe,args,options,callback){const child=original(exe,args,options,callback);
      if(exe===executable&&args[0]==='--experimental-import-meta-resolve'){children++;if(children===1)child.once('close',()=>put(path.join(f.selected,'entry.mjs'),'changed during observation'));}return child;};syncBuiltinESMExports();
    await assert.rejects(reflectedHost('observe',()=>observer.observeApplicationRootResolution(record)),/APPLICATION_OBSERVATION_REFUSED/);assert.equal(children,1);
  }finally{childProcess.execFile=original;syncBuiltinESMExports();f.close();}
});

for (const proofProfile of [false, true]) {
test((proofProfile ? 'format proof lifetime: ' : '')+'aggregate deadline and actual native timeout failures close every retained descriptor in each observer phase',async()=>{
  const early=fixture();try{early.request.resolutionPolicy.deadlineMs=1;const requestText=json(early.request);
    const failed=await run('collect',{graphText:early.graphText,requestText,expectedRequestSha256:hash(requestText)});assert.ok(failed.error);assert.equal(failed.stdout,'');
  }finally{early.close();}
  for(const phase of ['open','native','postcheck']){
    const f=proofProfile?typelessProofFixture('native-default-esm-cjs-proof-v2'):fixture(),originalExec=childProcess.execFile,originalOpen=fs.openSync,originalClose=fs.closeSync,originalRead=fs.readSync;
    const nowDescriptor=Object.getOwnPropertyDescriptor(performance,'now'),realNow=performance.now.bind(performance);let offset=0;
    const descriptors=new Set();let metadataChildren=0,nativeChildren=0,nativeClosed=false,reached=false;
    try{const report=await collect(f),record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
      const targetInode=fs.statSync(path.join(f.selected,proofProfile?'entry.js':'entry.mjs'),{bigint:true}).ino;
      Object.defineProperty(performance,'now',{configurable:true,value:()=>realNow()+offset});
      fs.openSync=function(...args){const fd=originalOpen.apply(fs,args);descriptors.add(fd);return fd;};
      fs.closeSync=function(fd){try{return originalClose.call(fs,fd);}finally{descriptors.delete(fd);}};
      fs.readSync=function(fd,...args){if(phase==='postcheck'&&nativeClosed&&!reached&&fs.fstatSync(fd,{bigint:true}).ino===targetInode){reached=true;offset=60001;}
        return originalRead.call(fs,fd,...args);};
      childProcess.execFile=function(exe,args,options,callback){const native=exe===executable&&args[0]==='--experimental-import-meta-resolve';
        const child=originalExec(exe,args,{...options,...(native&&phase==='native'?{timeout:1}:{})},callback);
        if(native){nativeChildren++;if(phase==='native')reached=true;child.once('close',()=>{nativeClosed=true;});}
        else if(exe===f.request.metadataTool.executable.path){metadataChildren++;if(phase==='open'&&metadataChildren===3)child.once('close',()=>{reached=true;offset=60001;});}
        return child;};syncBuiltinESMExports();
      await assert.rejects(reflectedHost('observe',()=>observer.observeApplicationRootResolution(record)),/APPLICATION_OBSERVATION_REFUSED/);
      assert.equal(reached,true,`${phase} control must reach its intended phase`);assert.equal(descriptors.size,0);
      assert.equal(nativeChildren,phase==='open'?0:1);if(phase!=='open')assert.equal(nativeClosed,true);
    }finally{childProcess.execFile=originalExec;syncBuiltinESMExports();fs.openSync=originalOpen;fs.closeSync=originalClose;fs.readSync=originalRead;
      if(nowDescriptor)Object.defineProperty(performance,'now',nowDescriptor);else delete performance.now;f.close();}
  }
});
test((proofProfile ? 'format proof lifetime: ' : '')+'a failed final retained-handle close after two real native children prevents observation lineage',async()=>{
  const f=proofProfile?typelessProofFixture('native-default-esm-cjs-proof-v2'):fixture(),originalExec=childProcess.execFile,originalOpen=fs.openSync,originalClose=fs.closeSync,descriptors=new Set();let children=0,injected=false;
  try{const report=await collect(f),record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
    const targetInode=fs.statSync(path.join(f.selected,proofProfile?'entry.js':'entry.mjs'),{bigint:true}).ino;
    fs.openSync=function(...args){const fd=originalOpen.apply(fs,args);descriptors.add(fd);return fd;};
    fs.closeSync=function(fd){const selected=fs.fstatSync(fd,{bigint:true}).ino===targetInode;
      try{originalClose.call(fs,fd);}finally{descriptors.delete(fd);}if(children===2&&selected&&!injected){injected=true;throw new Error('INJECTED_FINAL_CLOSE_FAILURE');}};
    childProcess.execFile=function(exe,args,options,callback){const child=originalExec(exe,args,options,callback);if(exe===executable&&args[0]==='--experimental-import-meta-resolve')children++;return child;};syncBuiltinESMExports();
    await assert.rejects(reflectedHost('observe',()=>observer.observeApplicationRootResolution(record)),/APPLICATION_OBSERVATION_REFUSED/);
    assert.equal(children,2);assert.equal(injected,true);assert.equal(descriptors.size,0);assert.equal(fs.existsSync(f.marker),false);
  }finally{childProcess.execFile=originalExec;syncBuiltinESMExports();fs.openSync=originalOpen;fs.closeSync=originalClose;f.close();}
});
}

// Synthetic transport faults establish teardown only. The actual fixed-child
// compilation controls above remain the independent source-format evidence.
for(const failure of ['synthetic-work-timeout','malformed-native-response','premature-native-stdin-close']){
test('format proof catalogue '+failure+' refuses without lineage and closes retained descriptors',async()=>{
  const f=typelessProofFixture('native-default-esm-cjs-proof-v2'),originalExec=childProcess.execFile,originalOpen=fs.openSync,originalClose=fs.closeSync;
  const descriptors=new Set(),trace=[];let nativeChildren=0,observed,handshake='',workReached=false;
  const stall=`let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{
    const request=JSON.parse(text);if(request.kind!=='pfa-application-native-resolution-request'||request.version!==2||!request.edges.length||!request.syntaxCandidates.length)process.exit(91);
    process.stderr.write(JSON.stringify({kind:'synthetic-native-work-phase',version:request.version,requestBytes:Buffer.byteLength(text),requestSha256:require('node:crypto').createHash('sha256').update(text).digest('hex'),edges:request.edges.length,syntaxCandidates:request.syntaxCandidates.length})+'\\n',()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0));});`;
  try{
    fs.openSync=function(...args){const fd=originalOpen.apply(fs,args);descriptors.add(fd);return fd;};
    fs.closeSync=function(fd){try{return originalClose.call(fs,fd);}finally{descriptors.delete(fd);}};
    childProcess.execFile=function(exe,args,options,callback){
      const native=exe===executable&&args[0]==='--experimental-import-meta-resolve',synthetic=native&&failure==='synthetic-work-timeout';
      const started=performance.now(),entry={role:synthetic?'synthetic-work-stall':native?'actual-fixed-native':'metadata',timeout:options.timeout,closed:false};trace.push(entry);
      const child=originalExec(exe,synthetic?['--input-type=commonjs','-e',stall]:args,options,(error,stdout,stderr)=>{
        Object.assign(entry,{elapsedMs:performance.now()-started,callbackError:error?{code:error.code??null,killed:error.killed??false,signal:error.signal??null}:null});
        if(native&&failure==='malformed-native-response'&&!error){
          const actual=JSON.parse(stdout);entry.actualVersion=actual.version;entry.actualRows=actual.rows.length;
          entry.actualProofs=actual.rows.map(row=>row.diagnostic.syntaxProof?.status??null);entry.actualStdoutSha256=hash(stdout);
          const saved=path.resolve('.local/r20-format-proof/lifetime-gaps-oct31a/malformed-native-original-'+randomUUID()+'.json');put(saved,stdout);entry.actualStdoutFile=saved;
          callback(null,'{malformed-native-response\n',stderr);
        }else callback(error,stdout,stderr);
      });
      Object.assign(entry,{pid:child.pid,executable:child.spawnfile,argv:child.spawnargs});
      child.once('close',(code,signal)=>{Object.assign(entry,{closed:true,exitCode:code,signal});});
      if(native){nativeChildren++;const end=child.stdin.end;
        child.stdin.end=function(input,...rest){entry.requestBytes=Buffer.byteLength(input);entry.requestSha256=hash(input);return end.call(this,input,...rest);};
        if(synthetic)child.stderr.on('data',chunk=>{handshake+=chunk.toString('utf8');if(handshake.endsWith('\n'))workReached=true;});
        if(failure==='premature-native-stdin-close')process.nextTick(()=>{entry.pipeDestroyed=true;child.stdin.destroy(new Error('SYNTHETIC_PREMATURE_NATIVE_STDIN_CLOSE'));});
      }
      return child;
    };syncBuiltinESMExports();
    const requestText=json(f.request),report=await reflectedHost('collect',()=>observer.collectApplicationRootCandidate(f.graphText,requestText,hash(requestText)));
    assert.equal(report.status,'collected');const record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
    await assert.rejects(reflectedHost('observe',async()=>{observed=await observer.observeApplicationRootResolution(record);return observed;}),/APPLICATION_OBSERVATION_REFUSED/);
    const native=trace.find(row=>row.role!=='metadata');assert.equal(nativeChildren,1);assert.equal(observed,undefined);assert.equal(native.closed,true);
    assert.equal(trace.every(row=>row.closed),true);assert.equal(descriptors.size,0);assert.equal(fs.existsSync(f.marker),false);
    if(failure==='synthetic-work-timeout'){
      assert.equal(workReached,true,'synthetic child must acknowledge complete request receipt before timeout');
      assert.deepEqual(JSON.parse(handshake),{kind:'synthetic-native-work-phase',version:2,requestBytes:native.requestBytes,requestSha256:native.requestSha256,edges:3,syntaxCandidates:4});
      assert.equal(native.callbackError.killed,true);assert.ok(native.timeout>0&&native.timeout<=60000);assert.ok(native.elapsedMs>=native.timeout-100);
    }else if(failure==='malformed-native-response'){
      assert.equal(native.callbackError,null);assert.equal(native.actualVersion,2);assert.equal(native.actualRows,3);
      assert.deepEqual(native.actualProofs,['commonjs-parse','commonjs-parse','commonjs-parse']);
    }else{assert.equal(native.pipeDestroyed,true);assert.ok(native.callbackError);}
    console.log(json({kind:'format-proof-catalogue-lifetime-assertions-reached',failure,syntheticTeardownOnly:failure==='synthetic-work-timeout',workReached,
      handshake:handshake?JSON.parse(handshake):null,nativeChildren,observationReturned:false,retainedDescriptors:descriptors.size,canaryExecuted:false,trace}));
  }catch(error){console.log(json({kind:'format-proof-catalogue-lifetime-failure',failure,workReached,handshake,nativeChildren,retainedDescriptors:descriptors.size,trace}));throw error;}
  finally{childProcess.execFile=originalExec;syncBuiltinESMExports();fs.openSync=originalOpen;fs.closeSync=originalClose;f.close();}
});
}

test('format proof catalogue missing directory and unsupported selected targets gain no syntax proof',async()=>{
  const f=typelessProofFixture('native-default-esm-cjs-proof-v2'),originalExec=childProcess.execFile,trace=[];
  try{
    const cases=[['catalogue-missing','./absent.js','missing-target','MISSING_TARGET'],['catalogue-directory','./folder','directory-target','DIRECTORY_TARGET'],
      ['catalogue-unsupported','./entry.json','resolved-file','UNSUPPORTED_SELECTED_FORMAT']];
    for(const [name,target]of cases){const directory=f.packageDir(name,{exports:target},name==='catalogue-unsupported'?{'entry.json':'{}'}:{});
      if(name==='catalogue-directory')fs.mkdirSync(path.join(directory,'folder'));
      f.body.application.imports.push({parent:f.body.application.stagePath,specifier:name,kind:'import-statement',target:null,external:true});}
    f.body.application.inputs[0].imports=f.body.application.imports.length;f.rewriteGraph();
    childProcess.execFile=function(exe,args,options,callback){const child=originalExec(exe,args,options,callback),entry={pid:child.pid,executable:child.spawnfile,argv:child.spawnargs,closed:false};trace.push(entry);
      child.once('close',(code,signal)=>Object.assign(entry,{closed:true,exitCode:code,signal}));return child;};syncBuiltinESMExports();
    const requestText=json(f.request),report=await reflectedHost('collect',()=>observer.collectApplicationRootCandidate(f.graphText,requestText,hash(requestText)));
    assert.equal(report.status,'collected');const record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
    const result=observer.requireApplicationRootObservation(await reflectedHost('observe',()=>observer.observeApplicationRootResolution(record)));
    assert.equal(result.nativePasses.length,2);assert.equal(result.census.nativeRowsMeasured,12);assert.equal(result.census.packageFootprintsComplete,6);
    assert.deepEqual(result.nativePasses[0].rows,result.nativePasses[1].rows);
    for(const [name,,kind,blocker]of cases){const outcome=result.outcomes.find(row=>row.specifier===name);assert.equal(outcome.raw.kind,kind);assert.equal(outcome.blocker,blocker);
      assert.equal(outcome.interpretedFormat,name==='catalogue-unsupported'?'json':null);
      for(const pass of result.nativePasses){const diagnostic=pass.rows.find(row=>row.specifier===name).diagnostic;
        if(kind==='resolved-file'){assert.equal(diagnostic.format,'json');assert.equal(diagnostic.syntaxProof,null);}else assert.equal(Object.hasOwn(diagnostic,'syntaxProof'),false);}}
    assert.equal(result.census.usableFormatRows,3);assert.equal(result.census.observedBlockedRows,3);
    assert.equal(Object.values(result.certifications).every(value=>value===false),true);assert.equal(trace.every(row=>row.closed),true);assert.equal(fs.existsSync(f.marker),false);
    console.log(json({kind:'format-proof-catalogue-outcomes-assertions-reached',cases:cases.map(row=>row[0]),nativePasses:2,nativeRows:12,canaryExecuted:false,trace}));
  }catch(error){console.log(json({kind:'format-proof-catalogue-outcomes-failure',trace}));throw error;}
  finally{childProcess.execFile=originalExec;syncBuiltinESMExports();f.close();}
});

for(const boundary of ['out-of-root-candidate','case-alias','directory-junction']){
test('format proof catalogue '+boundary+' refuses before native proof',async()=>{
  const f=typelessProofFixture('native-default-esm-cjs-proof-v2'),originalExec=childProcess.execFile,originalOpen=fs.openSync,originalClose=fs.closeSync;
  const descriptors=new Set(),trace=[];let nativeChildren=0,reached=false,junctionTarget=null;
  try{
    fs.openSync=function(...args){const fd=originalOpen.apply(fs,args);descriptors.add(fd);return fd;};
    fs.closeSync=function(fd){try{return originalClose.call(fs,fd);}finally{descriptors.delete(fd);}};
    childProcess.execFile=function(exe,args,options,callback){if(exe===executable&&args[0]==='--experimental-import-meta-resolve')nativeChildren++;
      const child=originalExec(exe,args,options,callback),entry={pid:child.pid,executable:child.spawnfile,argv:child.spawnargs,closed:false};trace.push(entry);
      child.once('close',(code,signal)=>Object.assign(entry,{closed:true,exitCode:code,signal}));return child;};syncBuiltinESMExports();
    const requestText=json(f.request),report=await reflectedHost('collect',()=>observer.collectApplicationRootCandidate(f.graphText,requestText,hash(requestText)));
    assert.equal(report.status,'collected');const selected=path.join(f.selected,'entry.js');
    if(boundary==='out-of-root-candidate'){
      // This is an inventory trust-boundary control, not escaped native resolution.
      const outside=path.resolve('.local/r20-format-proof/lifetime-gaps-oct31a/outside-selected.js');put(outside,`throw new Error('OUTSIDE_MUST_NOT_RUN');`);
      assert.equal(outside.startsWith(f.root+path.sep),false);assert.equal(fs.realpathSync.native(outside),outside);
      const declaration=JSON.parse(report.candidateText),file=declaration.files.find(row=>row.path===selected);Object.assign(file,pin(outside));reached=true;
      const changed=json(declaration);assert.throws(()=>inventory.readApplicationRootInventoryV2(f.graphText,changed,externalPins(changed)),/APPLICATION_INVENTORY_V2_REFUSED/);
    }else{
      const record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText)),before=fs.statSync(selected,{bigint:true});
      if(boundary==='case-alias'){
        const temporary=path.join(f.selected,'case-transition.js'),renamed=path.join(f.selected,'Entry.js');fs.renameSync(selected,temporary);fs.renameSync(temporary,renamed);
        assert.equal(fs.statSync(selected,{bigint:true}).ino,before.ino);assert.equal(fs.realpathSync.native(selected),renamed);assert.notEqual(selected,renamed);reached=true;
      }else{
        junctionTarget=f.selected+'-junction-target';assert.ok(junctionTarget.startsWith(f.root+path.sep));fs.renameSync(f.selected,junctionTarget);
        fs.symlinkSync(junctionTarget,f.selected,'junction');assert.equal(fs.lstatSync(f.selected).isSymbolicLink(),true);
        assert.equal(fs.realpathSync.native(f.selected),junctionTarget);assert.equal(fs.realpathSync.native(selected),path.join(junctionTarget,'entry.js'));reached=true;
      }
      await assert.rejects(reflectedHost('observe',()=>observer.observeApplicationRootResolution(record)),/APPLICATION_OBSERVATION_REFUSED/);
    }
    assert.equal(reached,true);assert.equal(nativeChildren,0);assert.equal(descriptors.size,0);assert.equal(trace.every(row=>row.closed),true);assert.equal(fs.existsSync(f.marker),false);
    console.log(json({kind:'format-proof-catalogue-boundary-assertions-reached',boundary,intendedBoundaryReached:reached,nativeChildren,retainedDescriptors:descriptors.size,canaryExecuted:false,trace}));
  }catch(error){console.log(json({kind:'format-proof-catalogue-boundary-failure',boundary,reached,nativeChildren,retainedDescriptors:descriptors.size,trace}));throw error;}
  finally{
    childProcess.execFile=originalExec;syncBuiltinESMExports();fs.openSync=originalOpen;fs.closeSync=originalClose;
    if(junctionTarget&&fs.existsSync(f.selected)&&fs.lstatSync(f.selected).isSymbolicLink()){
      assert.ok(fs.realpathSync.native(f.root)===f.root&&junctionTarget.startsWith(f.root+path.sep));assert.equal(fs.realpathSync.native(f.selected),junctionTarget);
      fs.unlinkSync(f.selected);assert.equal(fs.existsSync(path.join(junctionTarget,'entry.js')),true);
    }
    f.close();
  }
});
}

test('format proof boundary keeps manifest-free packages incomplete without guessing from repository type', async () => {
  const f = typelessProofFixture('native-default-esm-cjs-proof-v2');
  try {
    const directory = f.packageDir('boundary', {}, { 'entry.js': 'module.exports=1;' });
    fs.unlinkSync(path.join(directory, 'package.json'));
    f.body.application.imports.push({ parent: f.body.application.stagePath, specifier: 'boundary/entry.js',
      kind: 'import-statement', target: null, external: true });
    f.rewriteGraph();
    const report = await collect(f);
    assert.equal(report.status, 'blocked');
    const declaration = JSON.parse(report.candidateText);
    const footprint = declaration.footprints.find(row => row.tuple[3] === 'boundary/entry.js');
    assert.equal(footprint.status, 'incomplete');
    assert.equal(footprint.reason, 'NEARER_PACKAGE_WITHOUT_MANIFEST');
    assert.deepEqual(footprint.leaves, []);
    const raw = await run('observe', observeInput(f, report.candidateText));
    assert.equal(raw.error, null, raw.stderr);
    const result = JSON.parse(raw.stdout);
    assert.equal(result.kind, 'pfa-application-root-observation-blocked');
    assert.equal(result.census.nativeRowsMeasured, 0);
    assert.deepEqual(result.nativePasses, []);
    assert.ok(result.blockers.some(row => row.specifier === 'boundary/entry.js' && row.reason === 'NEARER_PACKAGE_WITHOUT_MANIFEST'));
    assert.equal(fs.existsSync(f.marker), false);
  } finally { f.close(); }
});

test('format proof non-string package type never gains a usable CommonJS outcome', async () => {
  const f = typelessProofFixture('native-default-esm-cjs-proof-v2');
  try {
    put(path.join(f.selected, 'package.json'), JSON.stringify({ name: 'example', type: 42, exports: './entry.js' }));
    const report = await collect(f);
    assert.equal(report.status, 'collected');
    const raw = await run('observe', observeInput(f, report.candidateText));
    assert.equal(raw.error, null, raw.stderr);
    const result = JSON.parse(raw.stdout);
    // Either Node rejects the malformed type or the measured scope rejects the
    // upgrade. A preflight failure or missing native pass cannot satisfy this.
    assert.ok(result.nativePasses.length >= 1);
    if (result.kind === 'pfa-application-root-observation-blocked') {
      assert.equal(result.blockers[0].reason, 'UNEXPECTED_NATIVE_DIAGNOSTIC');
      const selected = result.nativePasses[0].rows.find(row => row.parent === f.body.application.stagePath);
      assert.equal(selected.diagnostic.kind, 'native-error');
      assert.equal(selected.diagnostic.code, 'ERR_INVALID_PACKAGE_CONFIG');
    } else {
      assert.equal(result.kind, 'application-root-observation-payload');
      const selected = result.outcomes.find(row => row.parent === f.body.application.stagePath);
      assert.equal(selected.interpretedFormat, 'unestablished-js');
      assert.equal(selected.blocker, 'AMBIGUOUS_JAVASCRIPT_FORMAT');
    }
    assert.equal(Object.values(result.certifications).every(value => value === false), true);
    assert.equal(fs.existsSync(f.marker), false);
  } finally { f.close(); }
});

test('format proof drift refuses source and scope changes after the first actual native pass', async () => {
  for (const mutation of ['source', 'scope']) {
    const f = typelessProofFixture('native-default-esm-cjs-proof-v2'), originalExec = childProcess.execFile;
    const originalOpen = fs.openSync, originalClose = fs.closeSync, descriptors = new Set();
    const trace = [];
    let children = 0, closed = false, changed = false;
    try {
      childProcess.execFile = function (exe, args, options, callback) {
        const started = performance.now(), entry = { phase: children ? 'after-native' : 'before-native', timeout: options.timeout };
        trace.push(entry);
        const child = originalExec(exe, args, options, (error, stdout, stderr) => {
          Object.assign(entry, { elapsedMs: performance.now() - started, code: error ? error.code ?? null : 0,
            killed: error?.killed ?? false, signal: error?.signal ?? null });
          callback(error, stdout, stderr);
        });
        child.once('close', () => { entry.closed = true; });
        if (exe === executable && args[0] === '--experimental-import-meta-resolve') {
          children++;
          if (children === 1) child.once('close', () => {
            closed = true;
            if (mutation === 'source') put(path.join(f.selected, 'entry.js'), 'module.exports=2;');
            else put(path.join(f.selected, 'package.json'), JSON.stringify({ name: 'example', type: 'module', exports: './entry.js' }));
            changed = true;
          });
        }
        return child;
      };
      syncBuiltinESMExports();
      // Fault injection already requires same-realm host reflection. Collect in
      // that realm too so metadata failures retain timing evidence, without
      // changing child arguments, timeouts, environment or selected code.
      const requestText = json(f.request);
      const report = await reflectedHost('collect', () => observer.collectApplicationRootCandidate(f.graphText, requestText, hash(requestText)));
      const record = inventory.readApplicationRootInventoryV2(f.graphText, report.candidateText, externalPins(report.candidateText));
      fs.openSync = function (...args) { const fd = originalOpen.apply(fs, args); descriptors.add(fd); return fd; };
      fs.closeSync = function (fd) { try { return originalClose.call(fs, fd); } finally { descriptors.delete(fd); } };
      await assert.rejects(reflectedHost('observe', () => observer.observeApplicationRootResolution(record)), /APPLICATION_OBSERVATION_REFUSED/);
      assert.equal(children, 1, mutation);
      assert.equal(changed, true, mutation);
      assert.equal(closed, true, mutation);
      assert.equal(descriptors.size, 0, mutation);
      assert.equal(fs.existsSync(f.marker), false);
    } catch (error) {
      console.log(json({ kind: 'format-proof-drift-diagnostic', mutation, children, changed, trace }));
      throw error;
    } finally {
      childProcess.execFile = originalExec; syncBuiltinESMExports();
      fs.openSync = originalOpen; fs.closeSync = originalClose; f.close();
    }
  }
});
test('directory-only physical replacement and actual hardlinks refuse before native launch',async()=>{
  for(const mutation of ['directory','hardlink']){const f=fixture(),originalExec=childProcess.execFile;let children=0;
    try{const report=await collect(f),record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
      const selected=path.join(f.selected,'entry.mjs'),before=fs.statSync(selected,{bigint:true}),oldDirectory=fs.statSync(f.selected,{bigint:true});
      if(mutation==='hardlink'){fs.linkSync(selected,path.join(f.root,'hardlink-alias.mjs'));assert.equal(fs.statSync(selected).nlink,2);}
      else{const old=f.selected+'-old';fs.renameSync(f.selected,old);fs.mkdirSync(f.selected);
        for(const name of fs.readdirSync(old))fs.renameSync(path.join(old,name),path.join(f.selected,name));fs.rmdirSync(old);
        assert.equal(fs.statSync(selected,{bigint:true}).ino,before.ino);assert.notEqual(fs.statSync(f.selected,{bigint:true}).ino,oldDirectory.ino);}
      childProcess.execFile=function(exe,args,options,callback){if(exe===executable&&args[0]==='--experimental-import-meta-resolve')children++;return originalExec(exe,args,options,callback);};syncBuiltinESMExports();
      await assert.rejects(reflectedHost('observe',()=>observer.observeApplicationRootResolution(record)),/APPLICATION_OBSERVATION_REFUSED/);assert.equal(children,0);
    }finally{childProcess.execFile=originalExec;syncBuiltinESMExports();f.close();}
  }
});

test('explicit legacy subpath missing and directory targets retain complete diagnostics without main fallback',async()=>{
  for(const kind of ['missing','directory']){const f=fixture({example:{}});try{
    const subpath=kind==='missing'?'absent.mjs':'folder';if(kind==='directory')fs.mkdirSync(path.join(f.selected,subpath));
    f.body.application.imports.find(edge=>edge.specifier==='example').specifier='example/'+subpath;f.rewriteGraph();
    const report=await collect(f);assert.equal(report.status,'collected','explicit ESM subpaths must not inherit legacy main fallback');
    const raw=await run('observe',observeInput(f,report.candidateText));assert.equal(raw.error,null,raw.stderr);const result=JSON.parse(raw.stdout);
    assert.equal(result.outcomes.find(row=>row.parent==='dist/production-application.js').blocker,kind==='missing'?'MISSING_TARGET':'DIRECTORY_TARGET');
  }finally{f.close();}}
});

function backpressureFixture(){
  const f=fixture(),conditions={};
  for(let i=0;i<128;i++)conditions[i===127?'default':'unused-'+i]='./leaf-'+String(i).padStart(3,'0')+'.mjs';
  const exports={'.':conditions};for(let i=0;i<6;i++)exports['./alias-'+i]=conditions;
  for(const directory of [f.selected,f.inner]){
    put(path.join(directory,'package.json'),JSON.stringify({name:'example',type:'module',exports}));
    for(let i=0;i<128;i++)put(path.join(directory,'leaf-'+String(i).padStart(3,'0')+'.mjs'),i===127?f.poison('pipe-target'):'');
  }
  for(let i=0;i<6;i++)f.body.application.imports.push({parent:f.body.application.stagePath,specifier:'example/alias-'+i,kind:'import-statement',target:null,external:true});
  f.body.application.inputs[0].imports=f.body.application.imports.length;f.rewriteGraph();return f;
}
function collectionFrame(f){const requestText=json(f.request);return {graphText:f.graphText,requestText,expectedRequestSha256:hash(requestText)};}
async function undrainedRunner(frame,expectedReportBytes,closeEarly=false){
  const started=performance.now(),child=childProcess.spawn(executable,[runner,'collect'],{env:{...inventory.applicationV2Environment},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let reached=false,stalled=false,rescued=false,firstOutputMs=null,bufferedBytes=0,consumerClosedMs=null,stderr='',checkTimer,watchdog,exitError,stalledState=null,exitState=null;
  const pipeState=()=>({paused:child.stdout.isPaused(),flowing:child.stdout.readableFlowing,bufferedBytes:child.stdout.readableLength,destroyed:child.stdout.destroyed});
  const closed=new Promise(resolve=>child.once('close',()=>resolve()));
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,elapsedMs:performance.now()-started}));});
  child.stdout.pause();
  child.stdout.once('readable',()=>{
    reached=true;firstOutputMs=performance.now()-started;bufferedBytes=child.stdout.readableLength;
    if(closeEarly){consumerClosedMs=performance.now()-started;child.stdout.destroy();return;}
    checkTimer=setTimeout(()=>{bufferedBytes=child.stdout.readableLength;stalledState=pipeState();stalled=child.exitCode===null&&bufferedBytes>0&&bufferedBytes<expectedReportBytes;},250);
  });
  child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');if(Buffer.byteLength(stderr)>65536){rescued=true;child.kill();}});
  child.stdin.on('error',error=>{exitError=error.code??'STDIN_ERROR';});
  watchdog=setTimeout(()=>{rescued=true;child.kill();},67000);
  child.stdin.end(json(frame));let result;
  try{result=await exited;}
  finally{
    clearTimeout(watchdog);clearTimeout(checkTimer);
    if(child.exitCode===null&&child.signalCode===null){rescued=true;child.kill();await exited.catch(()=>{});}
    // Observe child exit FIRST. Only then close the parent's unread read end,
    // allowing ChildProcess.close to finish without draining the report.
    exitState=pipeState();
    child.stdout.destroy();child.stdin.destroy();child.stderr.destroy();await closed;
  }
  return {...result,pid:child.pid,reached,stalled,rescued,firstOutputMs,bufferedBytes,expectedReportBytes,consumerClosedMs,
    postConsumerCloseMs:consumerClosedMs===null?null:result.elapsedMs-consumerClosedMs,stdinError:exitError??null,
    launchedExecutable:child.spawnfile,launchedArgv:child.spawnargs,expectedExecArgv:[],
    environment:{...inventory.applicationV2Environment},environmentSha256:hash(json(inventory.applicationV2Environment)),
    stalledState,exitState,phaseEvidence:'first output follows successful actual-host assertion and awaited command cleanup',
    childClosed:true,consumerReadEndDestroyed:child.stdout.destroyed,stderr};
}
test('non-draining stdout cannot outlive the fixed runner aggregate deadline',async()=>{
  const f=backpressureFixture(),evidence=path.resolve('.local/r20-observer-v2/repair-v3'),id=randomUUID();fs.mkdirSync(evidence,{recursive:true});let proof={kind:'actual-undrained-runner-pipe',version:2};
  try{
    const frame=collectionFrame(f),positive=await run('collect',frame);assert.equal(positive.error,null,positive.stderr);const report=JSON.parse(positive.stdout);
    assert.equal(positive.stdout,json(report),'drained bytes must preserve canonical complete framing');
    assert.equal(report.status,'collected');assert.equal(typeof report.candidateText,'string');assert.ok(Buffer.byteLength(report.candidateText)<=2*1024*1024);
    const record=inventory.readApplicationRootInventoryV2(f.graphText,report.candidateText,externalPins(report.candidateText));
    assert.equal(inventory.requireApplicationRootInventoryV2(record).footprintStatus,'complete');
    const reportBytes=Buffer.byteLength(positive.stdout);assert.ok(reportBytes>512*1024,'the positive control must produce a legal report larger than pipe buffers');
    proof={...proof,positiveReportBytes:reportBytes,positiveReportSha256:hash(positive.stdout),positiveCandidateBytes:Buffer.byteLength(report.candidateText),positiveCandidateSha256:hash(report.candidateText),positiveCensus:report.census,
      runnerPin:f.request.identity.harnessFiles.find(row=>row.path===runner),harnessPins:f.request.identity.harnessFiles,runtimePin:f.request.runtime.executable};
    fs.writeFileSync(path.join(evidence,'pipe-positive-'+id+'.json'),positive.stdout);
    console.log(json({kind:'pipe-positive-control',reportBytes,candidateBytes:proof.positiveCandidateBytes,packageTuples:report.census.packageFootprintsRequired}));
    const result=await undrainedRunner(frame,reportBytes);proof={...proof,...result};console.log(json(proof));
    assert.equal(result.reached,true,'the actual fixed runner must reach output');assert.equal(result.stalled,true,'the parent must leave a live undrained pipe open before deadline');
    assert.equal(result.stalledState.paused,true);assert.equal(result.stalledState.destroyed,false);assert.equal(result.exitState.destroyed,false);
    assert.equal(result.rescued,false,'an external watchdog kill is RED, never autonomous runner completion');
    assert.equal(result.signal,null);assert.notEqual(result.code,0);assert.ok(result.elapsedMs>=59000&&result.elapsedMs<=65000,'termination must use the existing aggregate sixty-second deadline');
    assert.equal(result.childClosed,true);assert.equal(result.consumerReadEndDestroyed,true);assert.equal(result.stderr,'');assert.equal(fs.existsSync(f.marker),false);
  }finally{fs.writeFileSync(path.join(evidence,'pipe-control-'+id+'.json'),json(proof));f.close();}
});
test('premature stdout close fails the fixed runner promptly after command cleanup',async()=>{
  const f=backpressureFixture(),evidence=path.resolve('.local/r20-observer-v2/repair-v3');fs.mkdirSync(evidence,{recursive:true});let proof={kind:'actual-premature-output-close',version:1};try{
    const result=await undrainedRunner(collectionFrame(f),1024*1024,true);proof={...proof,...result,runnerPin:pin(runner),runtimePin:pin(executable)};console.log(json(proof));
    assert.equal(result.reached,true);assert.equal(result.rescued,false);assert.equal(result.signal,null);assert.notEqual(result.code,0);
    assert.ok(result.postConsumerCloseMs>=0&&result.postConsumerCloseMs<5000,'closed consumer must refuse within five seconds of closure');
    assert.equal(result.childClosed,true);assert.equal(result.stderr,'');assert.equal(fs.existsSync(f.marker),false);
  }finally{fs.writeFileSync(path.join(evidence,'early-close-'+randomUUID()+'.json'),json(proof));f.close();}
});

// These bounded branch controls execute the exact runner body in a VM with
// test-only imports and IO. They do not launch a child, evaluate selected code,
// change production parameters, or substitute for the real OS-pipe controls.
async function controlledRunnerOutput(output,control={}){
  const original=fs.readFileSync(runner,'utf8'),imports=original.match(/^import .+;\r?\n/gm);
  assert.equal(imports?.length,2);assert.equal((original.match(/main\(\)\.catch\(/g)??[]).length,1);
  const body=original.replace(/^import .+;\r?\n/gm,'').replace('main().catch(','globalThis.completion=main().catch(');
  const calls=[],chunks=[],kills=[],inputCloses=[];let now=0,deadlineCallback,cleared=false,cleanupDone=false,pending=0,maxPending=0,callbackCount=0;
  const fakeProcess={argv:[executable,runner,'collect'],pid:314159,exitCode:0,stdin:{setEncoding(){},destroy(error){inputCloses.push(error.message);},
    async *[Symbol.asyncIterator](){if(control.expiry==='input'){now=60001;deadlineCallback();throw new Error('TEST_INPUT_EXPIRED');}yield '{}\n';}},
    kill(pid,signal){kills.push({pid,signal,pending,cleanupDone});}};
  const context=vm.createContext({Buffer,Number,Math,Error,performance:{now:()=>now},process:fakeProcess,
    setTimeout(callback,delay){assert.equal(delay,60000);deadlineCallback=callback;return 1;},clearTimeout(timer){assert.equal(timer,1);cleared=true;},
    assertApplicationObservationHost(command){assert.equal(command,'collect');},
    async runApplicationRootObservationCommand(command,input,deadline){assert.equal(command,'collect');assert.equal(input,'{}\n');assert.equal(deadline,60000);
      if(control.expiry==='work'){now=60001;deadlineCallback();}cleanupDone=true;return output;},
    write(fd,buffer,offset,length,position,callback){
      assert.equal(cleanupDone,true,'output cannot precede awaited command cleanup');assert.equal(fd,1);assert.equal(position,null);assert.ok(length>0&&length<=65536);
      assert.ok(calls.length<64,'branch control must stay bounded');assert.equal(pending,0);pending++;maxPending=Math.max(maxPending,pending);calls.push({offset,length});
      if(control.dispatchError){pending--;throw new Error('TEST_DISPATCH_FAILURE');}
      queueMicrotask(()=>{const index=callbackCount++,error=control.errorAt===index?new Error('TEST_WRITE_ERROR'):null;
        const count=control.countAt?.(index,length)??length;
        if(!error&&Number.isInteger(count)&&count>0&&count<=length)chunks.push(Buffer.from(buffer.subarray(offset,offset+count)));
        if(control.expiry==='output'){now=60001;deadlineCallback();}
        if(control.expiry==='callback')now=60001;
        pending--;callback(error,count);
      });
    }});
  new vm.Script(body,{filename:runner}).runInContext(context,{timeout:1000});await context.completion;
  return {bytes:Buffer.concat(chunks),calls,kills,inputCloses,pending,maxPending,callbackCount,cleanupDone,cleared,exitCode:fakeProcess.exitCode};
}
test('runner async output advances partial writes in byte order with one bounded request',async()=>{
  const output='\u00e9\u6c34\ud83d\ude00'.repeat(18000)+'\n',expected=Buffer.from(output);
  const result=await controlledRunnerOutput(output,{countAt:(index,length)=>Math.min(length,index%2===0?19001:32767)});
  assert.deepEqual(result.bytes,expected);assert.ok(result.calls.length>3);assert.equal(result.maxPending,1);assert.equal(result.pending,0);
  for(let i=1;i<result.calls.length;i++)assert.ok(result.calls[i].offset>result.calls[i-1].offset);
  assert.equal(result.exitCode,0);assert.equal(result.cleared,true);assert.deepEqual(result.kills,[]);
});
test('runner async output refuses zero invalid counts callback errors and dispatch exceptions without another write',async()=>{
  const oversized=await controlledRunnerOutput('x'.repeat(8*1024*1024+1));assert.equal(oversized.calls.length,0);assert.equal(oversized.exitCode,1);assert.equal(oversized.pending,0);
  for(const count of [0,-1,0.5,65537]){
    const result=await controlledRunnerOutput('x'.repeat(70000),{countAt:()=>count});assert.equal(result.calls.length,1);assert.equal(result.exitCode,1);
    assert.equal(result.pending,0);assert.equal(result.cleared,true);assert.deepEqual(result.kills,[]);
  }
  for(const control of [{errorAt:1,countAt:()=>7},{dispatchError:true}]){
    const result=await controlledRunnerOutput('x'.repeat(70000),control);assert.equal(result.calls.length,control.dispatchError?1:2);
    assert.equal(result.exitCode,1);assert.equal(result.pending,0);assert.equal(result.cleared,true);assert.deepEqual(result.kills,[]);
    assert.equal(result.bytes.length,control.dispatchError?0:7);
  }
});
test('runner expiry preserves input work and completed-write cleanup before output-only pending self-termination',async()=>{
  for(const expiry of ['input','work','callback','output']){
    const result=await controlledRunnerOutput('x'.repeat(70000),{expiry});assert.equal(result.exitCode,1);assert.equal(result.pending,0);assert.equal(result.cleared,true);
    if(expiry==='output')assert.deepEqual(result.kills,[{pid:314159,signal:'SIGKILL',pending:1,cleanupDone:true}]);else assert.deepEqual(result.kills,[]);
    assert.equal(result.calls.length,expiry==='input'||expiry==='work'?0:1);
    if(expiry==='input')assert.equal(result.inputCloses.length,1);
  }
});
