import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { absolute, shape, hash, freeze } from './primitives.mjs';
import { graphCheck as check, graphStable as stable, graphDigest as digest, parseCanonicalGraphJson as parse } from './application-root-json.mjs';
import { openApplicationFileWindow, finishApplicationFileWindow, closeApplicationFileWindow } from './application-file-window.mjs';
import { parseApplicationPackageJson } from './application-package-json.mjs';
import { applicationEntryPath, applicationRelativeTarget } from './application-paths.mjs';

const MiB = 1024 * 1024;
const inside = (root, file) => file === root || file.startsWith(root+'\\');
const json = value => stable(value)+'\n';
const identity = node => [node.dev, node.ino, node.mode, node.nlink, node.size, node.birthtimeNs, node.ctimeNs, node.mtimeNs].map(String);
const refuse = () => { throw new Error('APPLICATION_LOOKUP_REFUSED'); };
class Unsupported extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const unsupported = reason => { throw new Unsupported(reason); };
function validate(text, expectedHash) {
  hash(expectedHash); check(typeof text === 'string' && Buffer.byteLength(text) <= 128 * 1024 && digest(text) === expectedHash);
  const request = parse(text, 128 * 1024);
  shape(request, ['kind', 'version', 'parent', 'specifier', 'importKind', 'mode', 'occurrences', 'scopeRoots', 'dependencyRoots', 'systemRoot', 'metadataExecutable']);
  check(request.kind === 'application-lookup-request' && request.version === 1);
  shape(request.parent, ['path', 'sizeBytes', 'sha256']); absolute(request.parent.path); hash(request.parent.sha256);
  check(Number.isSafeInteger(request.parent.sizeBytes) && request.parent.sizeBytes >= 0 && request.parent.sizeBytes <= 32 * MiB);
  check(typeof request.specifier === 'string' && request.specifier.length <= 256 && !isBuiltin(request.specifier));
  check(/^(?:@[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/.test(request.specifier));
  check(!request.specifier.split('/').some(part => part === '.' || part === '..'));
  check(['import','export','import-statement','dynamic-import'].includes(request.importKind));
  check(request.mode === (request.importKind === 'dynamic-import' ? 'esm-dynamic' : 'esm-static'));
  check(Number.isSafeInteger(request.occurrences) && request.occurrences > 0 && request.occurrences <= 4096);
  for (const roots of [request.scopeRoots, request.dependencyRoots]) {
    check(Array.isArray(roots) && roots.length > 0 && roots.length <= 16);
    roots.forEach(absolute); check(new Set(roots.map(root => root.toLowerCase())).size === roots.length);
  }
  absolute(request.systemRoot);
  shape(request.metadataExecutable, ['path', 'sizeBytes', 'sha256', 'dev', 'ino']);
  return request;
}

/** Collect untrusted lookup inputs; never calls a resolver or evaluates selected code. */
export async function collectApplicationLookupFootprint(text, expectedHash) {
  let window, request;
  try {
    request = validate(text, expectedHash);
    const roots = [...new Set([...request.scopeRoots, ...request.dependencyRoots])];
    const allowed = file => { absolute(file); if (!roots.some(root => inside(root, file))) unsupported('BOUNDARY_REACHED'); };
    const files = new Map(), contents = new Map(), directories = new Map(), absent = new Map(), manifests = new Map(), nodes = new Map();
    let totalBytes = 0, entries = 0;
    const deadline = performance.now()+60000;
    const tick = () => check(performance.now() <= deadline && nodes.size + absent.size <= 4096);
    function node(file) {
      allowed(file); tick();
      const stat = fs.lstatSync(file, { bigint: true });
      check(!stat.isSymbolicLink() && stat.ino > 0n && fs.realpathSync.native(file) === file);
      check(stat.isFile() || stat.isDirectory());
      if (stat.isFile()) check(stat.nlink === 1n);
      const prior = nodes.get(file);
      if (prior) check(stable(prior) === stable(identity(stat))); else nodes.set(file, identity(stat));
      return stat;
    }
    function listing(directory) {
      check(node(directory).isDirectory());
      if (directories.has(directory)) return directories.get(directory);
      const result = [], handle = fs.opendirSync(directory);
      try {
        let entry;
        while ((entry = handle.readSync()) !== null) {
          tick(); check(++entries <= 4096 && !entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()));
          applicationEntryPath(directory, entry.name);
          result.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' });
        }
      } finally { handle.closeSync(); }
      result.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      check(new Set(result.map(row => row.name.toLowerCase())).size === result.length);
      directories.set(directory, result); return result;
    }
    function child(directory, name) {
      const file = applicationEntryPath(directory, name); allowed(file);
      const match = listing(directory).find(entry => entry.name.toLowerCase() === name.toLowerCase());
      if (!match) { absent.set(file, { path: file, parent: directory }); return null; }
      check(match.name === name); const stat = node(file); check(stat.isDirectory() === (match.kind === 'directory')); return stat;
    }
    function measure(file, maximum) {
      if (files.has(file)) { check(files.get(file).sizeBytes <= maximum); return { ...files.get(file), bytes:contents.get(file) }; }
      const before = node(file); check(before.isFile() && before.size <= BigInt(maximum));
      const fd = fs.openSync(file, fs.constants.O_RDONLY); let bytes;
      try {
        check(stable(identity(fs.fstatSync(fd,{bigint:true}))) === stable(identity(before)));
        bytes = Buffer.alloc(Number(before.size)); let offset = 0;
        while (offset < bytes.length) { tick(); const length = fs.readSync(fd, bytes, offset, Math.min(65536,bytes.length-offset), offset); check(length > 0); offset += length; }
        check(stable(identity(fs.fstatSync(fd,{bigint:true}))) === stable(identity(before)));
      } finally { fs.closeSync(fd); }
      node(file); totalBytes += bytes.length; check(totalBytes <= 128 * MiB && files.size < 512);
      const pin = { path: file, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      files.set(file,pin); if (bytes.length <= MiB) contents.set(file,bytes); return { ...pin, bytes };
    }
    function manifest(directory) {
      const file = path.win32.join(directory,'package.json');
      if (manifests.has(file)) return manifests.get(file);
      const found = child(directory,'package.json'); if (!found) return null;
      check(found.isFile()); const measured = measure(file,MiB);
      check(measured.bytes); const raw = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(measured.bytes);
      const result = { path:file, value:parseApplicationPackageJson(raw) }; manifests.set(file,result); return result;
    }
    function scope(file) {
      let current = path.win32.dirname(file);
      while (true) {
        allowed(current);
        if (path.win32.basename(current) === 'node_modules') return null;
        const found = manifest(current); if (found) return found;
        const parent = path.win32.dirname(current); if (parent === current) unsupported('BOUNDARY_REACHED'); current = parent;
      }
    }
    const parentPin = measure(request.parent.path,32*MiB);
    check(parentPin.sizeBytes === request.parent.sizeBytes && parentPin.sha256 === request.parent.sha256);
    const parts = request.specifier.split('/'), scoped = request.specifier.startsWith('@');
    const packageParts = parts.slice(0,scoped?2:1), packageName = packageParts.join('/');
    const subparts = parts.slice(packageParts.length), subpath = subparts.length ? './'+subparts.join('/') : '.';
    const parentScope = scope(request.parent.path); let selected, selfReference = false;
    if (parentScope && parentScope.value.name === packageName && parentScope.value.exports != null) {
      selected = parentScope; selfReference = true;
    } else {
      let current = path.win32.dirname(request.parent.path);
      while (!selected) {
        allowed(current); let directory = current, matched = true;
        for (const component of ['node_modules', ...packageParts]) {
          const found = child(directory,component);
          if (!found) { matched = false; break; }
          if (!found.isDirectory()) unsupported('NON_DIRECTORY_LOOKUP_COMPONENT');
          directory = path.win32.join(directory,component);
        }
        if (matched) {
          if (!request.dependencyRoots.some(root => inside(root,directory))) unsupported('DEPENDENCY_BOUNDARY');
          selected = manifest(directory); if (!selected) unsupported('NEARER_PACKAGE_WITHOUT_MANIFEST');
          break;
        }
        const parent = path.win32.dirname(current); if (parent === current) unsupported('BOUNDARY_REACHED'); current = parent;
      }
    }
    const packageRoot = path.win32.dirname(selected.path), candidates = [], targetNames = new Set();
    if (!request.dependencyRoots.some(root => inside(root,packageRoot))) unsupported('DEPENDENCY_BOUNDARY');
    const target = (value, exportsTarget = true) => {
      if (typeof value !== 'string' || (exportsTarget && !value.startsWith('./'))) unsupported('UNSUPPORTED_TARGET');
      const name = value.startsWith('./') ? value.slice(2) : value;
      if (!name || name.split('/').some(part => part.toLowerCase() === 'node_modules')) unsupported('UNSUPPORTED_TARGET');
      let file; try { file = applicationRelativeTarget(packageRoot,name); } catch { unsupported('UNSUPPORTED_TARGET'); }
      if (!targetNames.has(file)) { check(targetNames.size < 128); targetNames.add(file); candidates.push(file); }
    };
    let legacy = false;
    const exports = selected.value.exports;
    if (exports != null) {
      let branch = exports;
      if (typeof exports === 'object' && !Array.isArray(exports)) {
        const keys = Object.keys(exports), subpaths = keys.some(key => key.startsWith('.'));
        if (subpaths) {
          if (!keys.every(key => key.startsWith('.'))) unsupported('MIXED_EXPORTS_KEYS');
          if (Object.hasOwn(exports,subpath)) branch = exports[subpath];
          else if (keys.some(key => key.includes('*'))) unsupported('EXPORTS_PATTERN');
          else branch = null;
        } else if (subpath !== '.') branch = null;
      } else if (subpath !== '.') branch = null;
      let visits = 0;
      const visit = (value,depth=0) => {
        check(++visits <= 1024 && depth <= 16);
        if (value === null) return;
        if (typeof value === 'string') return target(value);
        if (!value || typeof value !== 'object' || Array.isArray(value)) unsupported('UNSUPPORTED_EXPORTS_TARGET');
        for (const key of Object.keys(value)) {
          if (!key || key.startsWith('.') || /^\d+$/.test(key)) unsupported('UNSUPPORTED_EXPORTS_CONDITION');
          visit(value[key],depth+1);
        }
      };
      visit(branch);
    } else if (subpath !== '.') target(subpath);
    else { legacy = true; target(selected.value.main ?? './index.js',false); }
    const measuredCandidates = [];
    for (const file of candidates) {
      const components = path.win32.relative(packageRoot,file).split('\\'); let current = packageRoot, found;
      for (let i=0;i<components.length;i++) {
        found = child(current,components[i]);
        if (!found) break;
        if (i < components.length-1) { if (!found.isDirectory()) unsupported('NON_DIRECTORY_TARGET_COMPONENT'); current = path.win32.join(current,components[i]); }
      }
      if (!found || found.isDirectory()) {
        unsupported(legacy ? 'LEGACY_FALLBACK_REQUIRED' : !found ? 'MISSING_TARGET' : 'DIRECTORY_TARGET');
      }
      const pin = measure(file,32*MiB), formatScope = scope(file), extension = path.win32.extname(file);
      let format = extension === '.mjs' ? 'esm' : extension === '.cjs' ? 'commonjs' : extension === '.json' ? 'json' : extension === '.node' ? 'native' : 'unsupported';
      if (extension === '.js') {
        const type = formatScope?.value.type;
        if (type !== 'module' && type !== 'commonjs') unsupported('AMBIGUOUS_JAVASCRIPT_FORMAT');
        format = type === 'module' ? 'esm' : 'commonjs';
      }
      measuredCandidates.push({ file: { path:pin.path,sizeBytes:pin.sizeBytes,sha256:pin.sha256 }, format, scopeManifest:formatScope?.path ?? null });
    }
    tick();
    const requestWindow = { kind:'application-file-window',version:1,approvedRoots:roots,
      files:[...files.values()].map(file=>({...file,kind:'data'})),directories:[...directories].map(([path,entries])=>({path,entries})),absent:[...absent.values()],
      systemRoot:request.systemRoot,metadataExecutable:request.metadataExecutable,deadlineMs:Math.max(1,Math.floor(deadline-performance.now())) };
    const windowText = json(requestWindow); window = await openApplicationFileWindow(windowText,digest(windowText));
    const measuredWindow = await finishApplicationFileWindow(window); window = null;
    const measuredDirectories = new Map(measuredWindow.directoryIdentities.map(row=>[row.path,row.identity]));
    return freeze({ kind:'untrusted-application-lookup-footprint',requestSha256:expectedHash,parent:request.parent,
      parentUrl:pathToFileURL(request.parent.path).href,specifier:request.specifier,importKind:request.importKind,mode:request.mode,occurrences:request.occurrences,
      status:'candidate',packageRoot,packageManifest:selected.path,parentScopeManifest:parentScope?.path??null,selfReference,
      candidates:measuredCandidates,files:[...files.values()],manifestPaths:[...manifests.keys()],
      directories:requestWindow.directories.map(directory=>({...directory,identity:measuredDirectories.get(directory.path)})),absent:requestWindow.absent,
      certifications:{nativeResolutionObserved:false,lookupFootprintAccepted:false,custodyHeld:false,executionAuthorized:false} });
  } catch (error) {
    if (window) closeApplicationFileWindow(window);
    if (error instanceof Unsupported) return freeze({ kind:'untrusted-application-lookup-diagnostic',requestSha256:expectedHash,parent:request.parent,
      specifier:request.specifier,importKind:request.importKind,mode:request.mode,occurrences:request.occurrences,status:'blocked',reason:error.reason,
      certifications:{nativeResolutionObserved:false,lookupFootprintAccepted:false,custodyHeld:false,executionAuthorized:false} });
    refuse();
  }
}

/** Version 2 measures the whole package census with one cache and one budget.
 * An absolute deadline is supplied only by the fixed observer, never a callback.
 * This collector performs no native resolution and creates no authority brand. */
export async function collectApplicationLookupFootprintsV2(text, expectedHash, outerDeadline) {
  const started = performance.now(); let window;
  try {
    hash(expectedHash); check(typeof text === 'string' && Buffer.byteLength(text) <= MiB && digest(text) === expectedHash);
    const request = parse(text, MiB);
    shape(request, ['kind','version','scopeRoots','dependencyRoots','systemRoot','metadataExecutable','deadlineMs','files','edges']);
    check(request.kind === 'application-lookup-batch-request' && request.version === 2);
    check(Number.isSafeInteger(request.deadlineMs) && request.deadlineMs > 0 && request.deadlineMs <= 60000);
    const deadline = outerDeadline === undefined ? started+request.deadlineMs : Math.min(outerDeadline,started+request.deadlineMs);
    check(Number.isFinite(deadline) && deadline <= started+60000);
    const files = new Map(), contents = new Map(), kinds = new Map(), directories = new Map(), absent = new Map(), manifests = new Map(), nodes = new Map();
    let totalBytes=0, entries=0, traceSteps=0;
    const roots=[...new Set([...request.scopeRoots,...request.dependencyRoots])];
    check(roots.length > 0 && roots.length <= 32); roots.forEach(absolute);
    const tick=()=>check(performance.now() <= deadline && nodes.size+absent.size <= 4096 && traceSteps <= 4096);
    const allowed=file=>{absolute(file);if(!roots.some(root=>inside(root,file)))unsupported('BOUNDARY_REACHED');};
    function node(file,trusted=false) {
      if(!trusted)allowed(file);else absolute(file);tick();
      const stat=fs.lstatSync(file,{bigint:true});
      check(!stat.isSymbolicLink() && stat.ino>0n && fs.realpathSync.native(file)===file && (stat.isFile()||stat.isDirectory()));
      if(stat.isFile())check(stat.nlink===1n);
      const prior=nodes.get(file);if(prior)check(stable(prior)===stable(identity(stat)));else nodes.set(file,identity(stat));return stat;
    }
    function listing(directory) {
      check(node(directory).isDirectory());if(directories.has(directory))return directories.get(directory);
      const result=[],handle=fs.opendirSync(directory);
      try {let entry;while((entry=handle.readSync())!==null){tick();check(++entries<=4096 && !entry.isSymbolicLink() && (entry.isFile()||entry.isDirectory()));
        applicationEntryPath(directory,entry.name);result.push({name:entry.name,kind:entry.isDirectory()?'directory':'file'});}}
      finally{handle.closeSync();}
      result.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);check(new Set(result.map(row=>row.name.toLowerCase())).size===result.length);
      directories.set(directory,result);return result;
    }
    function child(directory,name) {
      const file=applicationEntryPath(directory,name);allowed(file);
      const match=listing(directory).find(row=>row.name.toLowerCase()===name.toLowerCase());
      if(!match){absent.set(file,{path:file,parent:directory});return null;}
      check(match.name===name);const stat=node(file);check(stat.isDirectory()===(match.kind==='directory'));return stat;
    }
    function measure(file,maximum,trusted=false,kind) {
      if(files.has(file)){const pin=files.get(file);check(pin.sizeBytes<=maximum);node(file,trusted);if(kind==='manifest'||!kinds.has(file)&&kind)kinds.set(file,kind);return {...pin,bytes:contents.get(file)};}
      const before=node(file,trusted);check(before.isFile() && before.size<=BigInt(maximum));
      const fd=fs.openSync(file,'r');let bytes;
      try{check(stable(identity(fs.fstatSync(fd,{bigint:true})))===stable(identity(before)));bytes=Buffer.alloc(Number(before.size));let offset=0;
        while(offset<bytes.length){tick();const n=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),offset);check(n>0);offset+=n;}
        check(stable(identity(fs.fstatSync(fd,{bigint:true})))===stable(identity(before)));}
      finally{fs.closeSync(fd);}
      node(file,trusted);check((totalBytes+=bytes.length)<=256*MiB && files.size<512);
      const pin={path:file,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};files.set(file,pin);
      if(kind)kinds.set(file,kind);if(bytes.length<=MiB)contents.set(file,bytes);return {...pin,bytes};
    }
    function manifest(directory) {
      const file=path.win32.join(directory,'package.json');if(manifests.has(file))return manifests.get(file);
      const found=child(directory,'package.json');if(!found)return null;check(found.isFile());
      const measured=measure(file,MiB,false,'manifest');check(measured.sizeBytes>0 && measured.bytes);
      const value=parseApplicationPackageJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(measured.bytes));
      const result={path:file,value};manifests.set(file,result);return result;
    }
    function scope(subject) {
      const result={subject,steps:[],manifest:null,boundary:'incomplete'};let current=path.win32.dirname(subject);
      while(true){try{allowed(current);}catch(error){if(error instanceof Unsupported)return result;throw error;}tick();check(++traceSteps<=4096);
        if(path.win32.basename(current)==='node_modules'){listing(current);result.steps.push({directory:current,probe:{kind:'boundary',path:current}});result.boundary='node_modules';return result;}
        const found=manifest(current),probe=path.win32.join(current,'package.json');
        result.steps.push({directory:current,probe:{kind:found?'manifest':'absent',path:probe}});
        if(found){result.manifest=found.path;result.boundary='manifest';return result;}
        const parent=path.win32.dirname(current);if(parent===current)unsupported('BOUNDARY_REACHED');current=parent;
      }
    }
    check(Array.isArray(request.files)&&request.files.length<=512);const extras=new Map();
    for(const file of request.files){shape(file,['path','sizeBytes','sha256','kind']);check(['runtime','data'].includes(file.kind));
      const measured=measure(file.path,file.kind==='runtime'?128*MiB:32*MiB,true);check(measured.sizeBytes===file.sizeBytes&&measured.sha256===file.sha256);
      check(!extras.has(file.path.toLowerCase()));extras.set(file.path.toLowerCase(),file);}
    check(Array.isArray(request.edges)&&request.edges.length<=256);const keys=new Set();let occurrences=0;
    const footprints=[];
    for(const edge of request.edges){tick();shape(edge,['key','tuple','occurrences','parent']);
      check(Array.isArray(edge.tuple)&&edge.tuple.length===5&&edge.key===stable(edge.tuple)&&!keys.has(edge.key));keys.add(edge.key);
      const [parent,importKind,mode,specifier,typeOnly]=edge.tuple;check(typeOnly===false&&typeof parent==='string'&&/^[A-Za-z0-9._/-]{1,256}$/.test(parent)&&parent.split('/').every(part=>part&&part!=='.'&&part!=='..'));
      const single={kind:'application-lookup-request',version:1,parent:edge.parent,specifier,importKind,mode,occurrences:edge.occurrences,
        scopeRoots:request.scopeRoots,dependencyRoots:request.dependencyRoots,systemRoot:request.systemRoot,metadataExecutable:request.metadataExecutable};
      const singleText=json(single);validate(singleText,digest(singleText));check((occurrences+=edge.occurrences)<=4096);
      const physical=measure(edge.parent.path,32*MiB);check(physical.sizeBytes===edge.parent.sizeBytes&&physical.sha256===edge.parent.sha256);
      const row={key:edge.key,tuple:edge.tuple,occurrences:edge.occurrences,status:'incomplete',reason:null,
        stoppingPoint:{kind:'scope',path:edge.parent.path,probe:null},packageRoot:null,packageManifest:null,
        selfReference:null,strategy:null,parentScope:null,lookupTrace:[],leaves:[]};footprints.push(row);
      try{
        row.parentScope=scope(edge.parent.path);if(row.parentScope.boundary==='incomplete'){
          row.stoppingPoint.path=path.win32.dirname(row.parentScope.steps.at(-1)?.directory??edge.parent.path);unsupported('BOUNDARY_REACHED');}
        row.selfReference=false;
        const parts=specifier.split('/'),packageParts=parts.slice(0,specifier.startsWith('@')?2:1),packageName=packageParts.join('/');
        const subparts=parts.slice(packageParts.length),subpath=subparts.length?'./'+subparts.join('/'):'.';let selected;
        const parentManifest=row.parentScope.manifest?manifests.get(row.parentScope.manifest):null;
        if(parentManifest&&parentManifest.value.name===packageName&&parentManifest.value.exports!=null){selected=parentManifest;row.selfReference=true;}
        else{let current=path.win32.dirname(edge.parent.path);
          while(!selected){row.stoppingPoint={kind:'lookup',path:current,probe:null};allowed(current);check(++traceSteps<=4096);const trace={directory:current,probes:[],packageManifest:null};row.lookupTrace.push(trace);
            let directory=current,matched=true;
            for(const component of ['node_modules',...packageParts]){check(++traceSteps<=4096);const file=applicationEntryPath(directory,component),found=child(directory,component);
              trace.probes.push({parent:directory,path:file,kind:found?found.isDirectory()?'directory':'file':'absent'});
              if(!found){matched=false;break;}if(!found.isDirectory())unsupported('NON_DIRECTORY_LOOKUP_COMPONENT');directory=file;}
            if(matched){if(!request.dependencyRoots.some(root=>inside(root,directory)))unsupported('DEPENDENCY_BOUNDARY');
              selected=manifest(directory);if(!selected){row.stoppingPoint.probe=path.win32.join(directory,'package.json');unsupported('NEARER_PACKAGE_WITHOUT_MANIFEST');}trace.packageManifest=selected.path;break;}
            const parentDirectory=path.win32.dirname(current);if(parentDirectory===current)unsupported('BOUNDARY_REACHED');current=parentDirectory;
          }
        }
        row.packageManifest=selected.path;row.packageRoot=path.win32.dirname(selected.path);
        row.stoppingPoint={kind:'exports',path:selected.path,probe:null};
        if(!request.dependencyRoots.some(root=>inside(root,row.packageRoot)))unsupported('DEPENDENCY_BOUNDARY');
        const targets=[],seen=new Set();const target=(value,exportTarget=true)=>{
          if(typeof value!=='string'||exportTarget&&!value.startsWith('./'))unsupported('UNSUPPORTED_TARGET');const name=value.startsWith('./')?value.slice(2):value;
          if(!name||name.split('/').some(part=>part.toLowerCase()==='node_modules'))unsupported('UNSUPPORTED_TARGET');let file;
          try{file=applicationRelativeTarget(row.packageRoot,name);}catch{unsupported('UNSUPPORTED_TARGET');}
          if(!seen.has(file)){check(seen.size<128);seen.add(file);targets.push(file);}
        };
        const exports=selected.value.exports;row.strategy=exports!=null?'exports':subpath==='.'?'legacy':'subpath';
        if(exports!=null){let branch=exports;
          if(typeof exports==='object'&&!Array.isArray(exports)){const names=Object.keys(exports);
            if(names.some(name=>name.startsWith('.'))){if(!names.every(name=>name.startsWith('.')))unsupported('MIXED_EXPORTS_KEYS');
              if(Object.hasOwn(exports,subpath))branch=exports[subpath];else if(names.some(name=>name.includes('*')))unsupported('EXPORTS_PATTERN');else branch=null;
            }else if(subpath!=='.')branch=null;
          }else if(subpath!=='.')branch=null;
          let visits=0;const visit=(value,depth=0)=>{tick();check(++visits<=1024&&depth<=16);if(value===null)return;
            if(typeof value==='string')return target(value);if(!value||typeof value!=='object'||Array.isArray(value))unsupported('UNSUPPORTED_EXPORTS_TARGET');
            for(const condition of Object.keys(value)){if(!condition||condition.startsWith('.')||/^\d+$/.test(condition))unsupported('UNSUPPORTED_EXPORTS_CONDITION');visit(value[condition],depth+1);}};visit(branch);
        }else if(subpath!=='.')target(subpath);else target(selected.value.main??'./index.js',false);
        for(const file of targets){tick();row.stoppingPoint={kind:'target',path:file,probe:null};const parts=path.win32.relative(row.packageRoot,file).split('\\');let current=row.packageRoot,found,missingAt=-1;
          for(let i=0;i<parts.length;i++){check(++traceSteps<=4096);found=child(current,parts[i]);if(!found){missingAt=i;break;}
            if(i<parts.length-1){if(!found.isDirectory())unsupported('NON_DIRECTORY_TARGET_COMPONENT');current=path.win32.join(current,parts[i]);}}
          if(missingAt>=0){row.stoppingPoint.probe=path.win32.join(current,parts[missingAt]);if(row.strategy==='legacy')unsupported('LEGACY_FALLBACK_REQUIRED');if(missingAt!==parts.length-1)unsupported('MISSING_INTERMEDIATE_TARGET_SCOPE');
            const targetScope=scope(file);row.leaves.push({kind:'missing',path:file,absent:file,scope:targetScope});if(targetScope.boundary==='incomplete')unsupported('BOUNDARY_REACHED');continue;}
          if(found.isDirectory()){if(row.strategy==='legacy')unsupported('LEGACY_FALLBACK_REQUIRED');listing(file);const targetScope=scope(file);row.leaves.push({kind:'directory',path:file,directory:file,scope:targetScope});if(targetScope.boundary==='incomplete')unsupported('BOUNDARY_REACHED');continue;}
          measure(file,32*MiB,false,'target');const targetScope=scope(file),extension=path.win32.extname(file);
          let format={'.mjs':'esm','.cjs':'commonjs','.json':'json','.node':'native'}[extension]??'unsupported';
          if(extension==='.js'){const type=targetScope.manifest?manifests.get(targetScope.manifest).value.type:null;format=type==='module'?'esm':type==='commonjs'?'commonjs':'unestablished-js';}
          row.leaves.push({kind:'file',path:file,file:file,format,scope:targetScope});
          if(targetScope.boundary==='incomplete')unsupported('BOUNDARY_REACHED');
        }
        row.status='complete';delete row.reason;delete row.stoppingPoint;
      }catch(error){if(!(error instanceof Unsupported))throw error;row.reason=error.reason;}
    }
    tick();const union=[...files.values()].map(pin=>({...pin,kind:extras.get(pin.path.toLowerCase())?.kind??'data'}));
    const approvedRoots=[...new Set([...roots,...request.files.filter(file=>!roots.some(root=>inside(root,file.path))).map(file=>path.win32.dirname(file.path))])];check(approvedRoots.length<=32);
    const measurement={kind:'application-file-window',version:1,approvedRoots,files:union,directories:[...directories].map(([path,entries])=>({path,entries})),
      absent:[...absent.values()],systemRoot:request.systemRoot,metadataExecutable:request.metadataExecutable,deadlineMs:Math.max(1,Math.floor(deadline-performance.now()))};
    const measurementText=json(measurement);window=await openApplicationFileWindow(measurementText,digest(measurementText));
    const measured=await finishApplicationFileWindow(window);window=null;tick();for(const file of nodes.keys())node(file,extras.has(file.toLowerCase()));
    const directoryMap=new Map(measured.directoryIdentities.map(row=>[row.path,row.identity]));
    return freeze({kind:'untrusted-application-lookup-batch',version:2,footprints,files:[...kinds].map(([path,kind])=>({...files.get(path),kind})),
      measuredFiles:union,fileIdentities:measured.fileIdentities,directories:measurement.directories.map(row=>({...row,identity:directoryMap.get(row.path)})),absent:measurement.absent,
      certifications:{nativeResolutionObserved:false,lookupFootprintAccepted:false,custodyHeld:false,executionAuthorized:false}});
  }catch{if(window)closeApplicationFileWindow(window);refuse();}
}
