import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

let reader;
try { reader=await import('./application-root-inventory-v2.mjs'); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const hash=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const json=value=>stable(value)+'\n';
const pin=(name,sizeBytes=42)=>({path:name,sizeBytes,sha256:hash(name)});
const source=path.dirname(fileURLToPath(import.meta.url)),root='C:\\Fixture\\emission';
const app='dist/production-application.js',getter='.runtime/trusted/server/config/redis/production-slot.mjs',bootstrap='.runtime/trusted/server/config/redis/production-slot-bootstrap.mjs';
const executable=`${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`;
const closure=['application-root-observation-runner.mjs','application-root-observation.mjs','application-root-inventory-v2.mjs','application-root-graph.mjs',
  'application-root-json.mjs','primitives.mjs','application-lookup-footprint.mjs','application-package-json.mjs','application-paths.mjs','application-file-window.mjs',
  'application-native-resolution.mjs','application-native-resolution-child.mjs'].map(name=>path.join(source,name));
function fixture() {
  const sourcePin=name=>({...pin(name),format:name.endsWith('.ts')?'typescript':'javascript'}),entry=sourcePin('server/production-application.ts');
  const edge=(specifier,kind='import-statement',target=null,extra={})=>({parent:app,specifier,kind,target,external:true,...extra});
  const body={schemaVersion:1,provenance:{applicationBundle:true,applicationEntry:entry.path,architecture:'arm64',compiler:'esbuild',compilerVersion:'0.25.12',
    node:'v24.22.0',platform:'win32',splitting:false,target:'node24',trustedModulesBundled:false},
    application:{stagePath:app,esbuildOutputPath:app,format:'esm',source:entry,output:{sizeBytes:42,sha256:hash('application')},inputs:[{...entry,imports:4}],
      imports:[edge('../'+getter,'import-statement',getter),edge('node:fs'),edge('require-only','require-call'),edge('types','import',null,{typeOnly:true})]},
    trustedGraph:{roots:[getter,bootstrap].map(stagePath=>({stagePath,sourcePath:stagePath.slice(17)})),
      members:[getter,bootstrap].map(stagePath=>({stagePath,format:'esm',source:sourcePin(stagePath.slice(17)),output:{sizeBytes:42,sha256:hash(stagePath)},imports:[]}))}};
  const graph={...body,graphSha256:hash(stable(body))},graphText=json(graph);
  const members=[graph.application,...graph.trustedGraph.members].map(member=>({stagePath:member.stagePath,parentUrl:pathToFileURL(path.win32.join(root,...member.stagePath.split('/'))).href,
    source:member.source,output:{path:path.win32.join(root,...member.stagePath.split('/')),...member.output},format:'esm',
    role:member.stagePath===app?'application':member.stagePath===getter?'getter':'bootstrap'}));
  const document={kind:'pfa-application-root-inventory',version:2,
    identity:{candidateId:'12345678-1234-4234-8234-123456789abc',evidenceClass:'synthetic-fixture',reviewRef:'independent-fixture',sourceRevision:'a'.repeat(40),
      observerEntry:closure[0],resolverEntry:closure[11],harnessFiles:closure.map(name=>pin(name))},
    graph:{rawSha256:hash(graphText),rawSize:Buffer.byteLength(graphText),graphSha256:graph.graphSha256,schemaVersion:1,emissionRoot:root,relativePath:'.runtime/production-profile.json'},
    runtime:{executable:pin(executable),version:'24.22.0',platform:'win32',arch:'arm64',observerArgv:[closure[0],'observe'],
      resolverArgv:['--experimental-import-meta-resolve',closure[11]],environmentPolicy:'clean-windows-arm64-utc-v1'},
    resolutionPolicy:{profile:'native-default-esm-v1',additionalConditions:[],deadlineMs:60000,metadataBatchSize:1024},dependencyRoots:[root],scopeRoots:[root],members,
    edges:graph.application.imports.map(item=>({parent:app,kind:item.kind,specifier:item.specifier,typeOnly:item.typeOnly===true,
      mode:item.kind==='require-call'?'require':'esm-static',occurrences:1,classification:item.target?'internal':item.typeOnly?'type-only':item.kind==='require-call'?'unsupported':'builtin',
      target:item.target?{kind:'internal',stagePath:item.target}:item.typeOnly?{kind:'excluded',reason:'type-only'}:item.kind==='require-call'?{kind:'unsupported',reason:'REQUIRE_UNSUPPORTED'}:{kind:'builtin',name:'node:fs'}})),
    files:[],lookup:{directories:[],absent:[]},fileIdentities:[],footprints:[],
    metadataTool:{systemRoot:'C:\\Windows',executable:{...pin('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),dev:'1',ino:'2'},linkCount:2},
    certifications:{allRootsObserved:false,transitiveClosureComplete:false,custodyHeld:false,runtimeDependencyIdentity:false,executionAuthorized:false,
      stageAccepted:false,runtimeModuleIdentity:false,producerIdentity:false,jobCapability:false},
    limitations:['compile-declaration-only','compiler-configuration-not-fully-pinned','graph-has-no-build-revision','loaded-module-bytes-not-bound','no-stage-custody-or-execution-authority']};
  const measured=[{path:path.win32.join(root,'.runtime','production-profile.json'),sizeBytes:document.graph.rawSize,sha256:document.graph.rawSha256},
    ...members.map(member=>member.output),document.runtime.executable,...document.identity.harnessFiles];
  document.fileIdentities=measured.map((file,index)=>({path:file.path,dev:'1',ino:String(index+10)}));
  return {graphText,document};
}
function materialize(f) {const inventoryText=json(f.document);return {inventoryText,pinsText:json({inventorySha256:hash(inventoryText),
  ...Object.fromEntries(['identity','graph','runtime','resolutionPolicy','dependencyRoots','scopeRoots','metadataTool'].map(key=>[key,f.document[key]]))})};}
function read(f=fixture()) {assert.equal(typeof reader?.readApplicationRootInventoryV2,'function','a distinct v2 reader must bind the complete declaration');const m=materialize(f);return reader.readApplicationRootInventoryV2(f.graphText,m.inventoryText,m.pinsText);}
const refused=fn=>assert.throws(fn,/APPLICATION_INVENTORY_V2_REFUSED/);

test('v2 preserves a zero-package whole graph census and creates only private structural lineage',()=>{
  const record=read(),payload=reader.requireApplicationRootInventoryV2(record);
  assert.equal(payload.graph.coverage.importOccurrences,4);assert.equal(payload.graph.coverage.internalOccurrences,1);
  assert.equal(payload.graph.coverage.builtinOccurrences,1);assert.equal(payload.graph.coverage.typeOnlyOccurrences,1);
  assert.equal(payload.footprintStatus,'complete');assert.equal(payload.document.footprints.length,0);
  assert.equal(Object.values(payload.document.certifications).every(value=>value===false),true);
  refused(()=>reader.requireApplicationRootInventoryV2({...record}));refused(()=>reader.requireApplicationRootInventoryV2(JSON.parse(JSON.stringify(record))));
  refused(()=>reader.requireApplicationRootInventoryV2({kind:'validated-application-root-inventory'}));
});
test('v2 refuses independently pinned drift and a selfhash cannot replace independent identity groups',()=>{
  const f=fixture();assert.equal(typeof reader?.readApplicationRootInventoryV2,'function');const before=materialize(f);
  f.document.identity.sourceRevision='b'.repeat(40);const changed=materialize(f);
  refused(()=>reader.readApplicationRootInventoryV2(f.graphText,changed.inventoryText,before.pinsText));
  const pins=JSON.parse(before.pinsText);pins.inventorySha256=hash(changed.inventoryText);
  refused(()=>reader.readApplicationRootInventoryV2(f.graphText,changed.inventoryText,json(pins)));
});
test('v2 rejects missing census rows, occurrence changes, empty authority pins and incomplete closure',()=>{
  for(const change of [f=>f.document.edges.pop(),f=>f.document.edges[0].occurrences++,f=>f.document.members.pop(),
    f=>f.document.identity.harnessFiles.pop(),f=>f.document.identity.harnessFiles.push(pin(path.join(source,'arbitrary.mjs'))),
    f=>f.document.runtime.executable.sizeBytes=0,f=>f.document.identity.harnessFiles[0].sizeBytes=0,
    f=>f.document.runtime.observerArgv.push('--import=evil'),f=>f.document.certifications.executionAuthorized=true,
    f=>f.document.fileIdentities.pop(),f=>f.document.fileIdentities.push({...f.document.fileIdentities[0]}),
    f=>f.document.metadataTool.linkCount=1]){const f=fixture();change(f);refused(()=>read(f));}
});
test('v2 refuses unused manifests and forged project roles rather than exempting them',()=>{
  for(const kind of ['manifest','project-manifest']){const f=fixture(),file={...pin(root+'\\package.json'),kind};f.document.files.push(file);
    f.document.fileIdentities.push({path:file.path,dev:'1',ino:'999'});refused(()=>read(f));}
});
test('format proof policy requires a separately pinned exact opt-in without changing inventory version or declared formats',()=>{
  const f=fixture(),old=materialize(f);f.document.resolutionPolicy.profile='native-default-esm-cjs-proof-v2';const next=materialize(f);
  const record=reader.readApplicationRootInventoryV2(f.graphText,next.inventoryText,next.pinsText),payload=reader.requireApplicationRootInventoryV2(record);
  assert.equal(payload.document.version,2);assert.equal(payload.document.resolutionPolicy.profile,'native-default-esm-cjs-proof-v2');
  assert.equal(Object.values(payload.document.certifications).every(value=>value===false),true);
  refused(()=>reader.readApplicationRootInventoryV2(f.graphText,next.inventoryText,old.pinsText));
  for(const mutate of [v=>v.profile='native-default-esm-cjs-proof-v3',v=>v.additionalConditions=['import'],v=>v.deadlineMs=60001,
    v=>v.compilerOptions={},v=>v.metadataBatchSize=512]){const changed=fixture();mutate(changed.document.resolutionPolicy);refused(()=>read(changed));}
});
