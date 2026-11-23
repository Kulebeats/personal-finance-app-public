import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { absolute, relative, shape, hash, uuid, freeze } from './primitives.mjs';
import { applicationEntryPath } from './application-paths.mjs';
import { graphCheck as check, graphStable as stable, graphDigest as digest, parseCanonicalGraphJson as parse } from './application-root-json.mjs';
import { readApplicationGraphDeclaration } from './application-root-graph.mjs';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const records=new WeakMap(),MiB=1024*1024;
const refuse=()=>{throw new Error('APPLICATION_INVENTORY_V2_REFUSED');};
const same=(a,b)=>check(stable(a)===stable(b));
const list=(value,max,min=0)=>check(Array.isArray(value)&&value.length>=min&&value.length<=max);
const within=(root,file)=>file===root||file.startsWith(root+'\\');
const admitted=(roots,file)=>roots.some(root=>within(root,file));
const json=value=>stable(value)+'\n';
export const applicationV2Executable=`${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`;
const directory=path.dirname(fileURLToPath(import.meta.url));
export const applicationV2HarnessPaths=freeze(['application-root-observation-runner.mjs','application-root-observation.mjs','application-root-inventory-v2.mjs',
  'application-root-graph.mjs','application-root-json.mjs','primitives.mjs','application-lookup-footprint.mjs','application-package-json.mjs',
  'application-paths.mjs','application-file-window.mjs','application-native-resolution.mjs','application-native-resolution-child.mjs'].map(name=>path.join(directory,name)));
export const applicationV2Environment=freeze({HOMEDRIVE:'C:',HOMEPATH:'\\',LOGONSERVER:'\\\\localhost',PATH:'C:\\Windows\\System32',PROCESSOR_ARCHITECTURE:'ARM64',
  SYSTEMDRIVE:'C:',SystemRoot:'C:\\Windows',TEMP:'C:\\Windows\\Temp',TZ:'UTC',USERDOMAIN:'LOCAL',USERNAME:'native-resolution',USERPROFILE:'C:\\Windows\\Temp',
  WINDIR:'C:\\Windows',NODE_OPTIONS:'',NODE_PATH:'',NODE_V8_COVERAGE:''});
export const applicationV2Certifications=freeze({allRootsObserved:false,transitiveClosureComplete:false,custodyHeld:false,runtimeDependencyIdentity:false,
  executionAuthorized:false,stageAccepted:false,runtimeModuleIdentity:false,producerIdentity:false,jobCapability:false});
const extraLimitations=['loaded-module-bytes-not-bound','no-stage-custody-or-execution-authority'];
const incompleteReasons=new Set(['BOUNDARY_REACHED','DEPENDENCY_BOUNDARY','NEARER_PACKAGE_WITHOUT_MANIFEST','NON_DIRECTORY_LOOKUP_COMPONENT','UNSUPPORTED_TARGET',
  'MIXED_EXPORTS_KEYS','EXPORTS_PATTERN','UNSUPPORTED_EXPORTS_TARGET','UNSUPPORTED_EXPORTS_CONDITION','NON_DIRECTORY_TARGET_COMPONENT','LEGACY_FALLBACK_REQUIRED','MISSING_INTERMEDIATE_TARGET_SCOPE']);
function unique(rows,key){const seen=new Set();for(const row of rows){const name=key(row).toLowerCase();check(!seen.has(name));seen.add(name);}}
function scalar(value){check(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,29})$/.test(value));}
function pin(value,maximum,zero=false){shape(value,['path','sizeBytes','sha256']);absolute(value.path);hash(value.sha256);
  check(Number.isSafeInteger(value.sizeBytes)&&value.sizeBytes>=(zero?0:1)&&value.sizeBytes<=maximum);if(value.sizeBytes===0)check(value.sha256===digest(''));}
function roots(value){list(value,16,1);value.forEach(absolute);unique(value,item=>item);
  for(let i=0;i<value.length;i++)for(let j=i+1;j<value.length;j++)check(!within(value[i].toLowerCase(),value[j].toLowerCase())&&!within(value[j].toLowerCase(),value[i].toLowerCase()));}
function identity(value){shape(value,['candidateId','evidenceClass','reviewRef','sourceRevision','observerEntry','resolverEntry','harnessFiles']);uuid(value.candidateId);hash(value.sourceRevision,40);
  check(['synthetic-fixture','declared-installed-candidate'].includes(value.evidenceClass));check(typeof value.reviewRef==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value.reviewRef));
  check(value.observerEntry===applicationV2HarnessPaths[0]&&value.resolverEntry===applicationV2HarnessPaths[11]);list(value.harnessFiles,12,12);
  for(let i=0;i<12;i++){pin(value.harnessFiles[i],MiB);check(value.harnessFiles[i].path===applicationV2HarnessPaths[i]);}}
function runtime(value,id){shape(value,['executable','version','platform','arch','observerArgv','resolverArgv','environmentPolicy']);pin(value.executable,128*MiB);
  check(value.executable.path===applicationV2Executable&&value.version==='24.22.0'&&value.platform==='win32'&&value.arch==='arm64');
  same(value.observerArgv,[id.observerEntry,'observe']);same(value.resolverArgv,['--experimental-import-meta-resolve',id.resolverEntry]);check(value.environmentPolicy==='clean-windows-arm64-utc-v1');}
function policy(value){shape(value,['profile','additionalConditions','deadlineMs','metadataBatchSize']);check(['native-default-esm-v1','native-default-esm-cjs-proof-v2'].includes(value.profile));same(value.additionalConditions,[]);
  check(Number.isSafeInteger(value.deadlineMs)&&value.deadlineMs>0&&value.deadlineMs<=60000);
  // The retained helper uses a fixed 1024-path maximum; do not accept a label
  // that claims a smaller execution batch than this reviewed implementation.
  check(value.metadataBatchSize===1024);}
function metadata(value){shape(value,['systemRoot','executable','linkCount']);check(value.systemRoot==='C:\\Windows'&&value.linkCount===2);
  shape(value.executable,['path','sizeBytes','sha256','dev','ino']);const {dev,ino,...bytes}=value.executable;pin(bytes,32*MiB);scalar(dev);scalar(ino);check(BigInt(ino)>0n);
  check(bytes.path==='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');}
function groups(document){identity(document.identity);runtime(document.runtime,document.identity);policy(document.resolutionPolicy);metadata(document.metadataTool);roots(document.dependencyRoots);roots(document.scopeRoots);
  shape(document.graph,['rawSha256','rawSize','graphSha256','schemaVersion','emissionRoot','relativePath']);const g=document.graph;hash(g.rawSha256);hash(g.graphSha256);absolute(g.emissionRoot);
  check(g.schemaVersion===1&&g.relativePath==='.runtime/production-profile.json'&&Number.isSafeInteger(g.rawSize)&&g.rawSize>0&&g.rawSize<=MiB);
  for(const file of [...document.identity.harnessFiles,document.runtime.executable])check(!admitted([g.emissionRoot,...document.dependencyRoots],file.path));}
export function applicationV2Graph(graphText,g){return readApplicationGraphDeclaration(graphText,json({rawSha256:g.rawSha256,rawSize:g.rawSize,graphSha256:g.graphSha256}));}
export function applicationV2Members(graph,root){return graph.members.map(member=>({stagePath:member.stagePath,parentUrl:pathToFileURL(relative(root,member.stagePath)).href,
  source:member.source,output:{path:relative(root,member.stagePath),...member.output},format:member.format,
  role:member.stagePath===graph.graph.application.stagePath?'application':member.stagePath===graph.graph.trustedGraph.roots[0].stagePath?'getter':member.stagePath===graph.graph.trustedGraph.roots[1].stagePath?'bootstrap':'trusted-dependency'}));}
export const applicationV2Tuple=edge=>[edge.parent,edge.kind,edge.mode,edge.specifier,edge.typeOnly===true];
export function applicationV2Edges(graph){return graph.edges.map(edge=>({parent:edge.parent,kind:edge.kind,specifier:edge.specifier,typeOnly:edge.typeOnly===true,mode:edge.mode,
  occurrences:edge.occurrences,classification:edge.classification,target:edge.classification==='package'?{kind:'footprint',key:stable(applicationV2Tuple(edge))}
    :edge.classification==='internal'?{kind:'internal',stagePath:edge.target}:edge.classification==='builtin'?{kind:'builtin',name:edge.normalizedSpecifier}
    :edge.classification==='type-only'?{kind:'excluded',reason:'type-only'}:{kind:'unsupported',reason:edge.reason}}));}
export function applicationV2MeasuredFiles(document){const rows=[{path:relative(document.graph.emissionRoot,document.graph.relativePath),sizeBytes:document.graph.rawSize,sha256:document.graph.rawSha256},
  ...document.members.map(member=>member.output),document.runtime.executable,...document.identity.harnessFiles,...document.files.map(({kind,...bytes})=>bytes)];
  const result=new Map();for(const row of rows){const prior=result.get(row.path.toLowerCase());if(prior)same(prior,row);else result.set(row.path.toLowerCase(),row);}return [...result.values()];}
export function applicationV2Census(graph,footprints,nativeRowsMeasured=0,usableFormatRows=0,observedBlockedRows=0){const eligible=graph.edges.filter(edge=>edge.classification==='package');
  return {members:graph.members.length,sourceMappings:graph.graph.application.inputs.length+graph.graph.trustedGraph.members.length,graphEdges:graph.edges.length,...graph.coverage,
    packageFootprintsRequired:eligible.length,packageFootprintsComplete:footprints.filter(row=>row.status==='complete').length,nativeRowsRequired:eligible.length*2,
    nativeRowsMeasured,usableFormatRows,observedBlockedRows};}
export function applicationV2Blockers(graph,footprints){const rows=graph.blockers.map(row=>({key:null,parent:row.parent,kind:row.kind,specifier:row.specifier,occurrences:row.occurrences,reason:row.reason,path:null}));
  for(const footprint of footprints){const [parent,kind,,specifier]=footprint.tuple;
    if(footprint.status==='incomplete')rows.push({key:footprint.key,parent,kind,specifier,occurrences:footprint.occurrences,reason:footprint.reason,path:footprint.stoppingPoint.path});
    for(const leaf of footprint.leaves)if(leaf.kind==='file'&&!['esm','commonjs'].includes(leaf.format))rows.push({key:footprint.key,parent,kind,specifier,occurrences:footprint.occurrences,
      reason:leaf.format==='unestablished-js'?'AMBIGUOUS_JAVASCRIPT_FORMAT':'UNSUPPORTED_SELECTED_FORMAT',path:leaf.path});}
  check(rows.length<=128);return rows;}
/** The collection request binds collect and eventual observe as separate invocations. */
export function readApplicationCollectionRequest(text,expectedHash){try{hash(expectedHash);check(typeof text==='string'&&digest(text)===expectedHash);const request=parse(text,128*1024);
  shape(request,['kind','version','collectionArgv','identity','graph','runtime','resolutionPolicy','dependencyRoots','scopeRoots','metadataTool']);
  check(request.kind==='pfa-application-root-collection-request'&&request.version===2);groups(request);same(request.collectionArgv,[request.identity.observerEntry,'collect']);return freeze(request);
}catch{refuse();}}

function validateReferences(document,graph){
  list(document.files,512);unique(document.files,row=>row.path);const files=new Map();
  for(const file of document.files){shape(file,['path','sizeBytes','sha256','kind']);const {kind,...bytes}=file;check(['manifest','target'].includes(kind));pin(bytes,kind==='manifest'?MiB:32*MiB,kind==='target');
    check(admitted([...document.dependencyRoots,...document.scopeRoots],file.path));if(kind==='manifest')check(path.win32.basename(file.path)==='package.json');files.set(file.path,file);}
  const measured=applicationV2MeasuredFiles(document);check(measured.length<=512);check(measured.reduce((sum,row)=>sum+row.sizeBytes,document.metadataTool.executable.sizeBytes)<=256*MiB);
  list(document.fileIdentities,512);check(document.fileIdentities.length===measured.length);unique(document.fileIdentities,row=>row.path);const measuredMap=new Map(measured.map(row=>[row.path,row])),physical=new Set();
  for(const row of document.fileIdentities){shape(row,['path','dev','ino']);check(measuredMap.has(row.path));scalar(row.dev);scalar(row.ino);check(BigInt(row.ino)>0n);
    const key=row.dev+':'+row.ino;check(!physical.has(key));physical.add(key);}
  shape(document.lookup,['directories','absent']);list(document.lookup.directories,4096);list(document.lookup.absent,4096);unique([...document.lookup.directories,...document.lookup.absent],row=>row.path);
  const directories=new Map(),absent=new Map(),present=new Map(),usedFiles=new Set(),usedAbsent=new Set(),usedDirectories=new Set();let entries=0,steps=0;
  const approved=[document.graph.emissionRoot,...document.dependencyRoots,...document.scopeRoots];
  const add=(file,kind)=>{const key=file.toLowerCase(),prior=present.get(key);if(prior)check(prior.path===file&&prior.kind===kind);else present.set(key,{path:file,kind});};
  measured.forEach(file=>add(file.path,'file'));
  for(const row of document.lookup.directories){shape(row,['path','entries','identity']);absolute(row.path);check(admitted(approved,row.path));shape(row.identity,['dev','ino','birthtimeNs','attributes']);
    for(const key of ['dev','ino','birthtimeNs'])scalar(row.identity[key]);check(BigInt(row.identity.ino)>0n);const attributes=row.identity.attributes;
    check(Number.isInteger(attributes)&&attributes>=0&&attributes<=0xffffffff&&(attributes&0x400)===0&&(attributes&16)!==0);list(row.entries,4096);unique(row.entries,item=>item.name);
    check((entries+=row.entries.length)<=4096);add(row.path,'directory');
    for(const entry of row.entries){shape(entry,['name','kind']);check(['file','directory'].includes(entry.kind));add(applicationEntryPath(row.path,entry.name),entry.kind);}directories.set(row.path,row);}
  for(const row of document.lookup.absent){shape(row,['path','parent']);absolute(row.path);absolute(row.parent);check(admitted(approved,row.path)&&path.win32.dirname(row.path)===row.parent&&directories.has(row.parent));
    check(!directories.get(row.parent).entries.some(entry=>entry.name.toLowerCase()===path.win32.basename(row.path).toLowerCase()));absent.set(row.path,row);}
  check(present.size+absent.size<=4096);
  for(const probe of absent.values())for(const node of present.values())check(!within(probe.path.toLowerCase(),node.path.toLowerCase()));
  for(const node of present.values()){let parent=path.win32.dirname(node.path);while(parent!==path.win32.dirname(parent)){
    check(present.get(parent.toLowerCase())?.kind!=='file');const listing=directories.get(parent);
    if(listing){const components=node.path.slice(parent.length+1).split('\\'),entry=listing.entries.find(item=>item.name.toLowerCase()===components[0].toLowerCase());
      check(entry&&entry.name===components[0]&&entry.kind===(components.length>1?'directory':node.kind)&&node.path.startsWith(parent+'\\'));}parent=path.win32.dirname(parent);}}
  const dir=file=>{check(directories.has(file));usedDirectories.add(file);return directories.get(file);};
  const useManifest=file=>{check(files.get(file)?.kind==='manifest');usedFiles.add(file);dir(path.win32.dirname(file));};
  const useAbsent=file=>{check(absent.has(file));usedAbsent.add(file);dir(absent.get(file).parent);};
  function scope(trace,subject,allowIncomplete){shape(trace,['subject','steps','manifest','boundary']);check(trace.subject===subject);list(trace.steps,4096,1);
    let current=path.win32.dirname(subject);check(['manifest','node_modules',...(allowIncomplete?['incomplete']:[])].includes(trace.boundary));
    for(let i=0;i<trace.steps.length;i++){check(++steps<=4096);const step=trace.steps[i];shape(step,['directory','probe']);check(step.directory===current);dir(current);shape(step.probe,['kind','path']);
      if(path.win32.basename(current)==='node_modules'){same(step.probe,{kind:'boundary',path:current});check(i===trace.steps.length-1&&trace.boundary==='node_modules'&&trace.manifest===null);return;}
      const manifest=path.win32.join(current,'package.json');check(step.probe.path===manifest);
      if(step.probe.kind==='manifest'){useManifest(manifest);check(i===trace.steps.length-1&&trace.boundary==='manifest'&&trace.manifest===manifest);return;}
      check(step.probe.kind==='absent');useAbsent(manifest);current=path.win32.dirname(current);
    }
    check(allowIncomplete&&trace.boundary==='incomplete'&&trace.manifest===null&&!admitted(approved,current));
  }
  function targetPath(root,file,allowMissing){check(within(root,file)&&file!==root);let current=root;const parts=path.win32.relative(root,file).split('\\');
    for(let i=0;i<parts.length;i++){const name=parts[i],child=applicationEntryPath(current,name),listing=dir(current),entry=listing.entries.find(item=>item.name.toLowerCase()===name.toLowerCase());
      if(!entry){check(allowMissing);useAbsent(child);return child;}check(entry.name===name);if(i<parts.length-1){check(entry.kind==='directory');current=child;}else return child;}}
  const eligible=graph.edges.filter(edge=>edge.classification==='package');list(document.footprints,256);check(document.footprints.length===eligible.length);unique(document.footprints,row=>row.key);
  const declarations=new Map(eligible.map(edge=>[stable(applicationV2Tuple(edge)),edge]));
  for(const row of document.footprints){const incomplete=row.status==='incomplete';shape(row,['key','tuple','occurrences','status','packageRoot','packageManifest','selfReference','strategy','parentScope','lookupTrace','leaves',...(incomplete?['reason','stoppingPoint']:[])]);
    check(incomplete||row.status==='complete');const edge=declarations.get(row.key);check(edge&&row.key===stable(row.tuple));same(row.tuple,applicationV2Tuple(edge));check(row.occurrences===edge.occurrences);
    if(incomplete){check(incompleteReasons.has(row.reason));shape(row.stoppingPoint,['kind','path','probe']);check(['scope','lookup','exports','target'].includes(row.stoppingPoint.kind));absolute(row.stoppingPoint.path);
      if(row.stoppingPoint.probe!==null)useAbsent(row.stoppingPoint.probe);}
    const parent=relative(document.graph.emissionRoot,edge.parent);scope(row.parentScope,parent,incomplete);
    check(row.selfReference===true||row.selfReference===false||incomplete&&row.selfReference===null);check(['exports','legacy','subpath'].includes(row.strategy)||incomplete&&row.strategy===null);
    if(row.packageManifest!==null){absolute(row.packageManifest);useManifest(row.packageManifest);check(row.packageRoot===path.win32.dirname(row.packageManifest)&&admitted(document.dependencyRoots,row.packageRoot));}
    else check(incomplete&&row.packageRoot===null);
    list(row.lookupTrace,4096);let current=path.win32.dirname(parent),selected=false;
    if(row.selfReference===true)check(row.lookupTrace.length===0&&row.parentScope.manifest===row.packageManifest&&row.strategy==='exports');
    const parts=edge.specifier.split('/'),packageParts=parts.slice(0,edge.specifier.startsWith('@')?2:1);
    for(let i=0;i<row.lookupTrace.length;i++){check(++steps<=4096);const trace=row.lookupTrace[i];shape(trace,['directory','probes','packageManifest']);check(!selected&&trace.directory===current);list(trace.probes,3,1);
      const components=['node_modules',...packageParts];let directory=current,missing=false;
      for(let j=0;j<trace.probes.length;j++){check(++steps<=4096);const probe=trace.probes[j];shape(probe,['parent','path','kind']);check(probe.parent===directory&&probe.path===applicationEntryPath(directory,components[j]));dir(directory);
        if(probe.kind==='absent'){useAbsent(probe.path);check(j===trace.probes.length-1);missing=true;break;}
        check(probe.kind==='directory'||incomplete&&probe.kind==='file');const actual=present.get(probe.path.toLowerCase());check(actual&&actual.path===probe.path&&actual.kind===probe.kind);directory=probe.path;}
      if(trace.packageManifest!==null){check(!missing&&trace.probes.length===components.length&&i===row.lookupTrace.length-1);useManifest(trace.packageManifest);
        check(trace.packageManifest===path.win32.join(directory,'package.json')&&trace.packageManifest===row.packageManifest);selected=true;}
      else check(incomplete||missing);current=path.win32.dirname(current);
    }
    if(!incomplete)check(row.parentScope.boundary!=='incomplete'&&row.packageManifest!==null&&(row.selfReference===true||selected));
    list(row.leaves,128);unique(row.leaves,leaf=>leaf.path);
    for(const leaf of row.leaves){check(row.packageRoot!==null);absolute(leaf.path);check(admitted(document.dependencyRoots,leaf.path));
      if(leaf.kind==='file'){shape(leaf,['kind','path','file','format','scope']);check(leaf.file===leaf.path&&files.has(leaf.file));usedFiles.add(leaf.file);targetPath(row.packageRoot,leaf.path,false);
        const extension=path.win32.extname(leaf.path),formats=extension==='.js'?['esm','commonjs','unestablished-js']:[({'.mjs':'esm','.cjs':'commonjs','.json':'json','.node':'native'}[extension]??'unsupported')];check(formats.includes(leaf.format));
        if(files.get(leaf.file).kind==='manifest')check(extension==='.json');
      }else if(leaf.kind==='missing'){shape(leaf,['kind','path','absent','scope']);check(row.strategy!=='legacy'&&leaf.absent===leaf.path&&targetPath(row.packageRoot,leaf.path,true)===leaf.path);useAbsent(leaf.path);}
      else{shape(leaf,['kind','path','directory','scope']);check(leaf.kind==='directory'&&row.strategy!=='legacy'&&leaf.directory===leaf.path);targetPath(row.packageRoot,leaf.path,false);dir(leaf.directory);}
      scope(leaf.scope,leaf.path,incomplete);
    }
    if(incomplete&&row.stoppingPoint.kind==='target'&&row.packageRoot!==null&&row.stoppingPoint.probe!==null)check(targetPath(row.packageRoot,row.stoppingPoint.path,true)===row.stoppingPoint.probe);
  }
  for(const file of files.values())check(usedFiles.has(file.path));for(const row of absent.values())check(usedAbsent.has(row.path));for(const row of directories.values())check(usedDirectories.has(row.path));
}

/** Structural declaration lineage only. Independent pins are never self-issued. */
export function readApplicationRootInventoryV2(graphText,inventoryText,pinsText){try{
  const pins=parse(pinsText,128*1024);shape(pins,['inventorySha256','identity','graph','runtime','resolutionPolicy','dependencyRoots','scopeRoots','metadataTool']);hash(pins.inventorySha256);
  check(typeof inventoryText==='string'&&Buffer.byteLength(inventoryText)<=2*MiB&&digest(inventoryText)===pins.inventorySha256);
  const {document,graph}=inspectUntrustedApplicationInventoryV2(graphText,inventoryText);
  for(const key of ['identity','graph','runtime','resolutionPolicy','dependencyRoots','scopeRoots','metadataTool'])same(document[key],pins[key]);
  const incomplete=document.footprints.filter(row=>row.status==='incomplete');const payload=freeze({document,graph,inventorySha256:pins.inventorySha256,
    footprintStatus:incomplete.length?'incomplete':'complete',incompleteTuples:incomplete.map(row=>({key:row.key,reason:row.reason,stoppingPoint:row.stoppingPoint})),blockers:applicationV2Blockers(graph,document.footprints)});
  const record=freeze({kind:'validated-application-root-inventory-v2',inventorySha256:pins.inventorySha256,certifications:{...applicationV2Certifications}});records.set(record,payload);return record;
}catch{refuse();}}
/** Pure unbranded candidate inspection for collection; it issues no independent pins or lineage. */
export function inspectUntrustedApplicationInventoryV2(graphText,inventoryText){try{
  const document=parse(inventoryText,2*MiB);
  shape(document,['kind','version','identity','graph','runtime','resolutionPolicy','dependencyRoots','scopeRoots','members','edges','files','lookup','certifications','limitations','fileIdentities','footprints','metadataTool']);
  check(document.kind==='pfa-application-root-inventory'&&document.version===2);groups(document);
  const graph=applicationV2Graph(graphText,document.graph);same(document.members,applicationV2Members(graph,document.graph.emissionRoot));
  const expected=applicationV2Edges(graph);check(document.edges.length===expected.length);const key=row=>stable(applicationV2Tuple(row));unique(document.edges,key);
  for(const row of document.edges){const match=expected.find(edge=>key(edge)===key(row));check(match);same(row,match);}
  same(document.certifications,applicationV2Certifications);same(document.limitations,[...graph.limitations,...extraLimitations]);validateReferences(document,graph);
  return freeze({document,graph});
}catch{refuse();}}
export function requireApplicationRootInventoryV2(record){const payload=records.get(record);if(!payload)refuse();return payload;}
