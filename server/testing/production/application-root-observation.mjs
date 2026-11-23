import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shape, freeze, relative } from './primitives.mjs';
import { graphCheck as check, graphStable as stable, graphDigest as digest } from './application-root-json.mjs';
import { collectApplicationLookupFootprintsV2 } from './application-lookup-footprint.mjs';
import { openApplicationFileWindow, inspectApplicationFileWindow, checkApplicationFileWindow, finishApplicationFileWindow, closeApplicationFileWindow } from './application-file-window.mjs';
import { diagnoseApplicationNativeResolution } from './application-native-resolution.mjs';
import { parseApplicationPackageJson } from './application-package-json.mjs';
import { readApplicationCollectionRequest, readApplicationRootInventoryV2, requireApplicationRootInventoryV2, inspectUntrustedApplicationInventoryV2,
  applicationV2Executable, applicationV2Environment, applicationV2HarnessPaths, applicationV2Certifications, applicationV2Graph, applicationV2Members,
  applicationV2Edges, applicationV2Tuple, applicationV2MeasuredFiles, applicationV2Census, applicationV2Blockers } from './application-root-inventory-v2.mjs';

const observations=new WeakMap(),MiB=1024*1024;
const json=value=>stable(value)+'\n';
const same=(a,b)=>check(stable(a)===stable(b));
const refuse=()=>{throw new Error('APPLICATION_OBSERVATION_REFUSED');};
const tick=deadline=>check(Number.isFinite(deadline)&&performance.now()<=deadline);
const remaining=deadline=>{tick(deadline);const value=Math.floor(deadline-performance.now());check(value>0);return value;};
const within=(root,file)=>file===root||file.startsWith(root+'\\');
const sorted=rows=>[...rows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const limitations=graph=>[...graph.limitations,'loaded-module-bytes-not-bound','no-stage-custody-or-execution-authority'];
class UnexpectedNative extends Error { constructor(){super('UNEXPECTED_NATIVE_DIAGNOSTIC');} }

/** Actual reflected host values are checked before collection/observation. */
export function assertApplicationObservationHost(command){
  check(command==='collect'||command==='observe');check(process.platform==='win32'&&process.arch==='arm64'&&process.version==='v24.22.0'&&process.execPath===applicationV2Executable);
  check(fs.realpathSync.native(process.execPath)===applicationV2Executable);same(process.execArgv,[]);same(process.argv,[applicationV2Executable,applicationV2HarnessPaths[0],command]);
  same(Object.keys(process.env).sort(),Object.keys(applicationV2Environment).sort());for(const [key,value]of Object.entries(applicationV2Environment))check(process.env[key]===value);
  check(fs.realpathSync.native(applicationV2Environment.SystemRoot)===applicationV2Environment.SystemRoot);
}
function baseFiles(document){return [{path:relative(document.graph.emissionRoot,document.graph.relativePath),sizeBytes:document.graph.rawSize,sha256:document.graph.rawSha256},
  ...document.members.map(member=>member.output),document.runtime.executable,...document.identity.harnessFiles];}
async function reconstruct(document,graph,deadline){tick(deadline);const members=new Map(document.members.map(member=>[member.stagePath,member]));
  const request={kind:'application-lookup-batch-request',version:2,scopeRoots:document.scopeRoots,dependencyRoots:document.dependencyRoots,
    systemRoot:document.metadataTool.systemRoot,metadataExecutable:document.metadataTool.executable,deadlineMs:remaining(deadline),
    files:baseFiles(document).map(file=>({...file,kind:file.path===document.runtime.executable.path?'runtime':'data'})),
    edges:graph.edges.filter(edge=>edge.classification==='package').map(edge=>({key:stable(applicationV2Tuple(edge)),tuple:applicationV2Tuple(edge),occurrences:edge.occurrences,parent:members.get(edge.parent).output}))};
  const text=json(request);const batch=await collectApplicationLookupFootprintsV2(text,digest(text),deadline);tick(deadline);return batch;
}
async function collect(graphText,requestText,expectedRequestSha256,outerDeadline){
  assertApplicationObservationHost('collect');tick(outerDeadline);const request=readApplicationCollectionRequest(requestText,expectedRequestSha256);
  const deadline=Math.min(outerDeadline,performance.now()+request.resolutionPolicy.deadlineMs);tick(deadline);
  const graph=applicationV2Graph(graphText,request.graph);
  const document={kind:'pfa-application-root-inventory',version:2,...Object.fromEntries(['identity','graph','runtime','resolutionPolicy','dependencyRoots','scopeRoots','metadataTool'].map(key=>[key,request[key]])),
    members:applicationV2Members(graph,request.graph.emissionRoot),edges:applicationV2Edges(graph),files:[],lookup:{directories:[],absent:[]},
    fileIdentities:[],footprints:[],certifications:{...applicationV2Certifications},limitations:limitations(graph)};
  const batch=await reconstruct(document,graph,deadline);document.files=batch.files;document.lookup={directories:batch.directories,absent:batch.absent};
  document.fileIdentities=batch.fileIdentities;document.footprints=batch.footprints;
  const census=applicationV2Census(graph,document.footprints),blockers=applicationV2Blockers(graph,document.footprints),candidateText=json(document);tick(deadline);
  if(Buffer.byteLength(candidateText)>2*MiB){check(blockers.length<128);return freeze({kind:'pfa-application-root-collection-report',version:1,status:'blocked',candidateText:null,census,
    blockers:[...blockers,{key:null,parent:null,kind:null,specifier:null,occurrences:0,reason:'INVENTORY_LIMIT_EXCEEDED',path:null}]});}
  // Structural inspection only, deliberately no self-issued pin/read/observe path.
  inspectUntrustedApplicationInventoryV2(graphText,candidateText);tick(deadline);
  return freeze({kind:'pfa-application-root-collection-report',version:1,status:document.footprints.some(row=>row.status==='incomplete')?'blocked':'collected',candidateText,census,blockers});
}
/** Returns one unbranded report with serialized candidate bytes, never approval pins. */
export async function collectApplicationRootCandidate(graphText,requestText,expectedRequestSha256){try{return await collect(graphText,requestText,expectedRequestSha256,performance.now()+60000);}catch{refuse();}}
function compareReconstruction(document,batch){same(batch.footprints,document.footprints);same(batch.files,document.files);
  same(batch.directories,document.lookup.directories);same(batch.absent,document.lookup.absent);same(sorted(batch.fileIdentities),sorted(document.fileIdentities));
  const measured=applicationV2MeasuredFiles(document).map(file=>({...file,kind:file.path===document.runtime.executable.path?'runtime':'data'}));same(sorted(batch.measuredFiles),sorted(measured));}
function windowRequest(document,deadline){const files=applicationV2MeasuredFiles(document),roots=[document.graph.emissionRoot,...document.scopeRoots,...document.dependencyRoots];
  const approvedRoots=[...new Set([...roots,...files.filter(file=>!roots.some(root=>within(root,file.path))).map(file=>path.win32.dirname(file.path))])];
  return {kind:'application-file-window',version:1,approvedRoots,files:files.map(file=>({...file,kind:file.path===document.runtime.executable.path?'runtime':'data'})),
    directories:document.lookup.directories.map(({identity,...row})=>row),absent:document.lookup.absent,systemRoot:document.metadataTool.systemRoot,
    metadataExecutable:document.metadataTool.executable,deadlineMs:remaining(deadline)};
}
function checkIdentities(document,measurement){same(sorted(measurement.fileIdentities),sorted(document.fileIdentities));
  same(sorted(measurement.directoryIdentities),sorted(document.lookup.directories.map(row=>({path:row.path,identity:row.identity}))));}
function nativeRequest(document,graph,measurement,deadline){const identities=new Map(measurement.fileIdentities.map(row=>[row.path,row]));
  const bind=file=>{const physical=identities.get(file.path);check(physical);return {...file,dev:physical.dev,ino:physical.ino};};
  const members=new Map(document.members.map(member=>[member.stagePath,member]));
  const proofProfile=document.resolutionPolicy.profile==='native-default-esm-cjs-proof-v2',syntaxCandidates=new Map();
  if(proofProfile){const files=new Map(document.files.map(({kind,...pin})=>[pin.path,pin]));
    for(const footprint of document.footprints)for(const leaf of footprint.leaves)if(leaf.kind==='file'&&leaf.format==='unestablished-js'){
      const file=files.get(leaf.file);check(file&&path.win32.extname(file.path)==='.js');const pin=bind(file),prior=syntaxCandidates.get(pin.path);if(prior)same(prior,pin);else syntaxCandidates.set(pin.path,pin);}}
  return {kind:'pfa-application-native-resolution-request',version:proofProfile?2:1,emissionRoot:document.graph.emissionRoot,runtime:bind(document.runtime.executable),
    harnessFiles:[10,11].map(index=>bind(document.identity.harnessFiles[index])),edges:graph.edges.filter(edge=>edge.classification==='package').map(edge=>{
      const member=members.get(edge.parent);return {parent:edge.parent,parentUrl:member.parentUrl,parentPin:bind(member.output),kind:edge.kind,mode:edge.mode,specifier:edge.specifier,occurrences:edge.occurrences};}),deadlineMs:remaining(deadline),
    ...(proofProfile?{syntaxCandidates:sorted([...syntaxCandidates.values()])}:{})};
}
function supportsTypelessProof(document,leaf,deadline){
  tick(deadline);
  if(leaf.scope.manifest===null){check(leaf.scope.boundary==='node_modules');const last=leaf.scope.steps.at(-1);
    check(last&&path.win32.basename(last.directory)==='node_modules'&&last.probe.kind==='boundary');return true;}
  const pin=document.files.find(row=>row.path===leaf.scope.manifest),expected=document.fileIdentities.find(row=>row.path===leaf.scope.manifest);
  check(pin&&pin.kind==='manifest'&&expected&&pin.sizeBytes>0&&pin.sizeBytes<=MiB);
  const identity=node=>[node.dev,node.ino,node.mode,node.nlink,node.size,node.birthtimeNs,node.ctimeNs,node.mtimeNs].map(String);
  const before=fs.lstatSync(pin.path,{bigint:true});check(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size===BigInt(pin.sizeBytes));
  check(String(before.dev)===expected.dev&&String(before.ino)===expected.ino&&fs.realpathSync.native(pin.path)===pin.path);
  const fd=fs.openSync(pin.path,'r');
  try{same(identity(fs.fstatSync(fd,{bigint:true})),identity(before));const bytes=Buffer.alloc(pin.sizeBytes);let offset=0;
    while(offset<bytes.length){tick(deadline);const count=fs.readSync(fd,bytes,offset,Math.min(64*1024,bytes.length-offset),offset);check(count>0);offset+=count;}
    check(digest(bytes)===pin.sha256);const manifest=parseApplicationPackageJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
    same(identity(fs.fstatSync(fd,{bigint:true})),identity(before));same(identity(fs.lstatSync(pin.path,{bigint:true})),identity(before));
    check(fs.realpathSync.native(pin.path)===pin.path);tick(deadline);return !Object.hasOwn(manifest,'type');
  }finally{fs.closeSync(fd);}
}
function interpret(document,native,request,deadline){same(native.invocation.argv,document.runtime.resolverArgv);same(native.invocation.executable,request.runtime);
  check(native.version===(document.resolutionPolicy.profile==='native-default-esm-cjs-proof-v2'?2:1));
  const footprints=new Map(document.footprints.map(row=>[row.key,row]));check(native.rows.length===request.edges.length);
  return native.rows.map((row,index)=>{const {diagnostic:raw,...edge}=row;same(edge,request.edges[index]);const footprint=footprints.get(stable([row.parent,row.kind,row.mode,row.specifier,false]));check(footprint);
    let interpretedFormat=null,blocker=null;
    if(raw.kind==='native-error'){if(raw.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED'||footprint.strategy!=='exports')throw new UnexpectedNative();blocker='PACKAGE_PATH_NOT_EXPORTED';}
    else{const parsed=new URL(raw.url);check(parsed.protocol==='file:'&&!parsed.search&&!parsed.hash);const file=fileURLToPath(parsed);check(pathToFileURL(file).href===raw.url);
      check(document.dependencyRoots.some(root=>within(root,file))&&within(footprint.packageRoot,file));const leaf=footprint.leaves.find(leaf=>leaf.path===file);check(leaf);
      if(leaf.kind==='missing'){check(raw.kind==='missing-target');blocker='MISSING_TARGET';}
      else if(leaf.kind==='directory'){check(raw.kind==='directory-target');blocker='DIRECTORY_TARGET';}
      else{check(raw.kind==='resolved-file');check(raw.format===(path.win32.extname(file)==='.js'?'unestablished-js':leaf.format));interpretedFormat=leaf.format;
        if(leaf.format==='unestablished-js'){
          blocker='AMBIGUOUS_JAVASCRIPT_FORMAT';
          if(request.version===2&&raw.syntaxProof?.status==='commonjs-parse'){
            const proof=raw.syntaxProof,approved=request.syntaxCandidates.find(pin=>pin.path===leaf.path);check(approved);same(proof.source,approved);
            check(proof.method==='node24-cjs-compile-v1'&&proof.reason===null);
            if(supportsTypelessProof(document,leaf,deadline)){interpretedFormat='commonjs';blocker=null;}
          }
        }else if(!['esm','commonjs'].includes(leaf.format))blocker='UNSUPPORTED_SELECTED_FORMAT';}
    }
    return {key:footprint.key,parent:row.parent,parentUrl:row.parentUrl,kind:row.kind,mode:row.mode,specifier:row.specifier,occurrences:row.occurrences,raw,interpretedFormat,blocker};
  });
}
function blockedReport(bound,reason,nativePasses=[]){return freeze({kind:'pfa-application-root-observation-blocked',version:1,status:'blocked',candidateSha256:bound.inventorySha256,
  graph:{rawSha256:bound.document.graph.rawSha256,graphSha256:bound.document.graph.graphSha256},census:applicationV2Census(bound.graph,bound.document.footprints,nativePasses.reduce((n,pass)=>n+pass.rows.length,0)),
  blockers:reason==='INCOMPLETE_LOOKUP_FOOTPRINT'?bound.blockers:[{key:null,parent:null,kind:null,specifier:null,occurrences:0,reason,path:null}],nativePasses,
  certifications:{...applicationV2Certifications},limitations:bound.document.limitations});}
async function observe(record,outerDeadline){const bound=requireApplicationRootInventoryV2(record);assertApplicationObservationHost('observe');tick(outerDeadline);
  const {document,graph}=bound,deadline=Math.min(outerDeadline,performance.now()+document.resolutionPolicy.deadlineMs),nativePasses=[];let window,answer,error;
  try{
    const batch=await reconstruct(document,graph,deadline);compareReconstruction(document,batch);tick(deadline);
    if(bound.footprintStatus==='incomplete')return blockedReport(bound,'INCOMPLETE_LOOKUP_FOOTPRINT');
    const request=windowRequest(document,deadline),text=json(request);window=await openApplicationFileWindow(text,digest(text));tick(deadline);
    const before=inspectApplicationFileWindow(window);checkIdentities(document,before);let outcomes=[];
    const eligible=graph.edges.filter(edge=>edge.classification==='package');
    if(eligible.length){const firstRequest=nativeRequest(document,graph,before,deadline),firstText=json(firstRequest);
      nativePasses.push(await diagnoseApplicationNativeResolution(firstText,digest(firstText)));tick(deadline);outcomes=interpret(document,nativePasses[0],firstRequest,deadline);
      await checkApplicationFileWindow(window);tick(deadline);const current=inspectApplicationFileWindow(window);checkIdentities(document,current);
      const secondRequest=nativeRequest(document,graph,current,deadline),secondText=json(secondRequest);
      nativePasses.push(await diagnoseApplicationNativeResolution(secondText,digest(secondText)));tick(deadline);
      same(interpret(document,nativePasses[1],secondRequest,deadline),outcomes);
      const semantic=({requestSha256,...rest})=>rest;same(semantic(nativePasses[0]),semantic(nativePasses[1]));
    }else{await checkApplicationFileWindow(window);tick(deadline);}
    const after=await finishApplicationFileWindow(window);window=null;tick(deadline);checkIdentities(document,after);
    const blockers=[...graph.blockers.map(row=>({key:null,parent:row.parent,kind:row.kind,specifier:row.specifier,occurrences:row.occurrences,reason:row.reason,path:null})),
      ...outcomes.filter(row=>row.blocker).map(row=>({key:row.key,parent:row.parent,kind:row.kind,specifier:row.specifier,occurrences:row.occurrences,reason:row.blocker,path:row.raw.url??null}))];check(blockers.length<=128);
    answer=freeze({kind:'application-root-observation-payload',version:document.resolutionPolicy.profile==='native-default-esm-cjs-proof-v2'?2:1,status:blockers.length?'observed-with-blockers':'observed',observationId:randomUUID(),candidateSha256:bound.inventorySha256,
      graph:{rawSha256:document.graph.rawSha256,graphSha256:document.graph.graphSha256},identity:document.identity,runtime:document.runtime,
      census:applicationV2Census(graph,document.footprints,nativePasses.reduce((n,pass)=>n+pass.rows.length,0),outcomes.filter(row=>!row.blocker).length,outcomes.filter(row=>row.blocker).length),
      outcomes,blockers,nativePasses,measurements:{before,after},certifications:{...applicationV2Certifications},limitations:document.limitations});
  }catch(caught){error=caught;}
  finally{if(window)closeApplicationFileWindow(window);}
  if(error instanceof UnexpectedNative)return blockedReport(bound,'UNEXPECTED_NATIVE_DIAGNOSTIC',nativePasses);if(error)throw error;
  tick(deadline);const observed=freeze({kind:'application-root-observation-v1',observationId:answer.observationId,candidateSha256:bound.inventorySha256,certifications:{...applicationV2Certifications}});
  observations.set(observed,answer);return observed;
}
export async function observeApplicationRootResolution(record){try{return await observe(record,performance.now()+60000);}catch{refuse();}}
export function requireApplicationRootObservation(record){const payload=observations.get(record);if(!payload)refuse();return payload;}

/** Fixed runner framing only; the inner documents retain their original bounds. */
export async function runApplicationRootObservationCommand(command,frameText,deadline){try{
  assertApplicationObservationHost(command);tick(deadline);check(deadline<=performance.now()+60000&&typeof frameText==='string'&&Buffer.byteLength(frameText)<=8*MiB);
  const frame=JSON.parse(frameText);check(json(frame)===frameText);let result;
  if(command==='collect'){shape(frame,['graphText','requestText','expectedRequestSha256']);result=await collect(frame.graphText,frame.requestText,frame.expectedRequestSha256,deadline);}
  else{shape(frame,['graphText','inventoryText','pinsText']);const record=readApplicationRootInventoryV2(frame.graphText,frame.inventoryText,frame.pinsText);tick(deadline);
    const observed=await observe(record,deadline);result=observations.has(observed)?requireApplicationRootObservation(observed):observed;}
  tick(deadline);const output=json(result);check(Buffer.byteLength(output)<=8*MiB);tick(deadline);return output;
}catch{refuse();}}
