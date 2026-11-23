import { write } from 'node:fs';
import { assertApplicationObservationHost, runApplicationRootObservationCommand } from './application-root-observation.mjs';

// Fixed two-command process: no arbitrary entrypoint, env option or resolver.
// The shared command budget begins before stdin; no helper receives a reset.
const deadline=performance.now()+60000;
let budgetExpired=false,phase='input',writePending=false;
const timer=setTimeout(()=>{
  budgetExpired=true;
  // Only output delivery may be terminated here. The command has already
  // awaited native/metadata children and retained descriptor cleanup by then.
  // fs.write keeps the JS deadline responsive on Windows. Ordinary process
  // exit can join its blocked worker, so only this post-cleanup pending write
  // uses self-SIGKILL. No other phase may bypass awaited resource cleanup.
  if(phase==='output'&&writePending){
    try{process.kill(process.pid,'SIGKILL');}catch{process.exitCode=1;}
  }
  if(phase==='input')process.stdin.destroy(new Error('APPLICATION_OBSERVATION_REFUSED'));
  // Work-phase expiry is handled by the same aggregate budget in the helpers;
  // never bypass their awaited cleanup with a process exit or Promise.race.
},Math.max(1,Math.ceil(deadline-performance.now())));
function checkDeadline(){if(budgetExpired||performance.now()>deadline)throw new Error('APPLICATION_OBSERVATION_REFUSED');}
async function writeOutput(output){
  const buffer=Buffer.from(output,'utf8');
  if(buffer.length>8*1024*1024)throw new Error('APPLICATION_OBSERVATION_REFUSED');
  let offset=0;
  while(offset<buffer.length){
    checkDeadline();const length=Math.min(64*1024,buffer.length-offset);
    const written=await new Promise((resolve,reject)=>{
      writePending=true;
      try{write(1,buffer,offset,length,null,(error,count)=>{
        writePending=false;
        if(error){reject(error);return;}
        if(!Number.isInteger(count)||count<=0||count>length){reject(new Error('APPLICATION_OBSERVATION_REFUSED'));return;}
        try{checkDeadline();resolve(count);}catch(error){reject(error);}
      });}catch(error){writePending=false;reject(error);}
    });
    offset+=written;
  }
  checkDeadline();
}
async function main(){const command=process.argv[2];assertApplicationObservationHost(command);let input='',bytes=0;
  process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){bytes+=Buffer.byteLength(chunk);if(bytes>8*1024*1024||budgetExpired)throw new Error('APPLICATION_OBSERVATION_REFUSED');input+=chunk;}
  phase='work';
  const output=await runApplicationRootObservationCommand(command,input,deadline);checkDeadline();
  phase='output';
  await writeOutput(output);
  phase='done';
}
main().catch(()=>{
  // No pending write is abandoned by this path. Refusal is silent so it cannot
  // block on a second undrained stdout/stderr pipe after resource cleanup.
  process.exitCode=1;
}).finally(()=>clearTimeout(timer));
