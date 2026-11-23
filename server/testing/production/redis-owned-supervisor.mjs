// Trusted bootstrap dependency only. Secrets arrive on stdin, never in argv,
// files, public events or Redis diagnostics. This is not a hostile-code sandbox.
export const redisSupervisorSource = String.raw`
import ctypes,hashlib,json,os,pathlib,select,selectors,signal,stat,subprocess,sys,time

def fail(): raise RuntimeError('SUPERVISOR_REFUSED')
def emit(value):
    sys.stdout.write(json.dumps(value,separators=(',',':'))+'\n');sys.stdout.flush()
def checked_file(path,size,digest):
    p=pathlib.Path(path);s=p.stat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_nlink!=1 or s.st_size!=size:fail()
    if hashlib.sha256(p.read_bytes()).hexdigest()!=digest:fail()
def listener(port):
    found=[]
    for line in pathlib.Path('/proc/net/tcp').read_text().splitlines()[1:]:
        fields=line.split()
        if int(fields[1].split(':')[1],16)==port and fields[3]=='0A':
            found.append((fields[1],int(fields[7]),fields[9]))
    for line in pathlib.Path('/proc/net/tcp6').read_text().splitlines()[1:]:
        f=line.split()
        if int(f[1].split(':')[1],16)==port and f[3]=='0A':fail()
    return found
def process_identity(child,pidfd,port):
    if child.poll() is not None or select.select([pidfd],[],[],0)[0]:fail()
    p=pathlib.Path('/proc')/str(child.pid)
    raw=(p/'stat').read_text();fields=raw[raw.rfind(')')+2:].split()
    if fields[1]!=str(os.getpid()):fail()
    status=(p/'status').read_text().splitlines()
    if next(x for x in status if x.startswith('Uid:')).split()[1:]!=['105']*4:fail()
    if next(x for x in status if x.startswith('Gid:')).split()[1:]!=['108']*4:fail()
    if os.readlink(p/'exe')!='/usr/bin/redis-check-rdb':fail()
    sockets=listener(port)
    if len(sockets)!=1 or sockets[0][0]!='0100007F:'+format(port,'04X') or sockets[0][1]!=105:fail()
    inode=sockets[0][2]
    links=[]
    for fd in (p/'fd').iterdir():
        try:links.append(os.readlink(fd))
        except FileNotFoundError:pass
    if 'socket:['+inode+']' not in links:fail()
    exe=(p/'exe').stat()
    return {'pid':child.pid,'startTicks':fields[19],'listenerInode':inode,
            'bootId':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
            'exeDev':str(exe.st_dev),'exeIno':str(exe.st_ino),'supervisorPid':os.getpid()}

child=None;pidfd=None;stop=False;port=None;identity=None;exit_code=1
def request_stop(*_):
    global stop
    stop=True
signal.signal(signal.SIGTERM,request_stop);signal.signal(signal.SIGINT,request_stop)
try:
    if os.getuid()!=105 or os.getgid()!=108 or os.uname().machine!='aarch64':fail()
    if pathlib.Path('/run/systemd/system').exists():fail()
    checked_file('/etc/wsl.conf',135,'bfb73b12bcdff092c77024199cb8e402168ed01fa81e03ca59f8a0744f9ed737')
    checked_file('/etc/wsl-distribution.conf',79,'0ffaa82f3108577226a0612eac1fc02a3900d97da49a5fad5cae771079213449')
    checked_file('/usr/sbin/policy-rc.d',19,'c2bcd9decf63ff2c0d9f473f38bc3607900530aad80f99139855d56678456230')
    checked_file('/usr/bin/redis-check-rdb',2723512,'54a0ace7ff91c089ff23ee102420be96926db4bb436a50c9616440995f3dc113')
    if os.path.realpath('/usr/bin/redis-server')!='/usr/bin/redis-check-rdb':fail()
    for unit in ('redis.service','redis-server.service','redis-server@.service','redis.socket','redis-server.socket'):
        if os.readlink('/etc/systemd/system/'+unit)!='/dev/null':fail()
    os.set_blocking(sys.stdin.fileno(),False);line=b'';input_deadline=time.monotonic()+5
    while b'\n' not in line:
        if stop or time.monotonic()>=input_deadline:fail()
        if select.select([sys.stdin],[],[],0.1)[0]:
            chunk=os.read(sys.stdin.fileno(),8193)
            if not chunk:fail()
            line+=chunk
            if len(line)>8192:fail()
    if not line.endswith(b'\n') or line.count(b'\n')!=1:fail()
    config=json.loads(line)
    if set(config)!={'port','config','runMs'}:fail()
    port=config['port'];run_ms=config['runMs']
    if type(port)!=int or not 1024<=port<=65535 or type(run_ms)!=int or not 1000<=run_ms<=3600000:fail()
    if not isinstance(config['config'],str) or len(config['config'])>7000 or listener(port):fail()
    supervisor_pid=os.getpid();libc=ctypes.CDLL(None,use_errno=True)
    def parent_death_guard():
        if libc.prctl(1,signal.SIGTERM,0,0,0)!=0 or os.getppid()!=supervisor_pid:os._exit(126)
    child=subprocess.Popen(['/usr/bin/redis-server','-'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
        env={'HOME':'/var/lib/redis','PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','TZ':'UTC'},cwd='/var/lib/redis',
        start_new_session=True,preexec_fn=parent_death_guard)
    pidfd=os.pidfd_open(child.pid,0)
    child.stdin.write(config['config'].encode('ascii'));child.stdin.close();config=None
    sel=selectors.DefaultSelector()
    for stream in (child.stdout,child.stderr):os.set_blocking(stream.fileno(),False);sel.register(stream,selectors.EVENT_READ,'diagnostic')
    os.set_blocking(sys.stdin.fileno(),False);sel.register(sys.stdin,selectors.EVENT_READ,'control');sel.register(pidfd,selectors.EVENT_READ,'exit')
    started=time.monotonic();deadline=started+run_ms/1000;ready=False;diagnostics=0;control=b'';last_beat=started
    while not stop:
        now=time.monotonic()
        if now>=deadline:fail()
        if child.poll() is not None:fail()
        if not ready:
            if now-started>10:fail()
            if listener(port):
                checked_file('/proc/'+str(child.pid)+'/exe',2723512,'54a0ace7ff91c089ff23ee102420be96926db4bb436a50c9616440995f3dc113')
                identity=process_identity(child,pidfd,port);emit({'event':'ready',**identity});ready=True
        if ready and now-last_beat>=1:
            if process_identity(child,pidfd,port)!=identity:fail()
            emit({'event':'alive','pid':child.pid,'startTicks':identity['startTicks']});last_beat=now
        for key,_ in sel.select(0.1):
            if key.data=='exit':fail()
            elif key.data=='diagnostic':
                chunk=os.read(key.fileobj.fileno(),4096)
                if not chunk:sel.unregister(key.fileobj)
                diagnostics+=len(chunk)
                if diagnostics>65536:fail()
            else:
                chunk=os.read(sys.stdin.fileno(),256)
                if not chunk:stop=True;break
                control+=chunk
                if len(control)>256:fail()
                if b'\n' in control:
                    if control!=b'STOP\n':fail()
                    stop=True;break
    exit_code=0
except BaseException:
    emit({'event':'failure','code':'SUPERVISOR_REFUSED'})
finally:
    terminated=False;closed=False
    if child is not None:
        try:
            if child.poll() is None:
                if pidfd is None:fail()
                signal.pidfd_send_signal(pidfd,signal.SIGTERM,None,0)
                try:child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    signal.pidfd_send_signal(pidfd,signal.SIGKILL,None,0);child.wait(timeout=3)
            terminated=child.returncode is not None
            for _ in range(40):
                if not listener(port):closed=True;break
                time.sleep(0.05)
        except BaseException:pass
        if pidfd is not None:os.close(pidfd)
    emit({'event':'stopped','terminated':terminated,'listenerClosed':closed,'pid':child.pid if child else None,
          'startTicks':identity['startTicks'] if identity else None})
    if not terminated or not closed:exit_code=1
sys.exit(exit_code)
`;

// Recovery only for the process facts observed by the live supervisor, retained
// privately by its owner. Reopen a pidfd, compare boot/start/executable identity
// around the open, then signal that descriptor. A reused PID is never signalled.
export const redisCleanupSource = String.raw`
import hashlib,json,os,pathlib,select,signal,sys,time
def fail():raise RuntimeError('CLEANUP_REFUSED')
def listening(port):
    for source in ('/proc/net/tcp','/proc/net/tcp6'):
        for line in pathlib.Path(source).read_text().splitlines()[1:]:
            f=line.split()
            if int(f[1].split(':')[1],16)==port and f[3]=='0A':return True
    return False
try:
    if os.getuid()!=105 or os.getgid()!=108:fail()
    os.set_blocking(sys.stdin.fileno(),False);raw=b'';deadline=time.monotonic()+3
    while b'\n' not in raw:
        if time.monotonic()>deadline:fail()
        if select.select([sys.stdin],[],[],0.1)[0]:
            b=os.read(sys.stdin.fileno(),4097)
            if not b:fail()
            raw+=b
            if len(raw)>4096:fail()
    if raw.count(b'\n')!=1 or not raw.endswith(b'\n'):fail()
    value=json.loads(raw);port=value['port'];expected=value['observed'];pid=expected['pid']
    if type(pid)!=int or pid<=1 or type(port)!=int or not 1024<=port<=65535:fail()
    boot=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    process=pathlib.Path('/proc')/str(pid)
    def original_alive():
        if boot!=expected['bootId']:return False
        try:
            r=(process/'stat').read_text();f=r[r.rfind(')')+2:].split()
            return f[19]==expected['startTicks'] and f[0] not in ('Z','X','x')
        except (FileNotFoundError,ProcessLookupError):return False
    def same():
        if not original_alive():return False
        s=(process/'exe').stat()
        if str(s.st_dev)!=expected['exeDev'] or str(s.st_ino)!=expected['exeIno']:fail()
        return True
    try:
        if same():
            status=(process/'status').read_text().splitlines()
            if next(x for x in status if x.startswith('Uid:')).split()[1:]!=['105']*4:fail()
            if next(x for x in status if x.startswith('Gid:')).split()[1:]!=['108']*4:fail()
            if os.readlink(process/'exe')!='/usr/bin/redis-check-rdb':fail()
            if hashlib.sha256((process/'exe').read_bytes()).hexdigest()!='54a0ace7ff91c089ff23ee102420be96926db4bb436a50c9616440995f3dc113':fail()
            fd=os.pidfd_open(pid,0)
            try:
                if same() and not select.select([fd],[],[],0)[0]:
                    signal.pidfd_send_signal(fd,signal.SIGTERM,None,0)
                    if not select.select([fd],[],[],5)[0]:
                        signal.pidfd_send_signal(fd,signal.SIGKILL,None,0)
                        if not select.select([fd],[],[],3)[0]:fail()
            finally:os.close(fd)
    except (FileNotFoundError,ProcessLookupError):
        # A disappearing original process is a valid cleanup observation only
        # after a fresh boot/start check; listener closure is still separate.
        if original_alive():fail()
    for _ in range(40):
        if not listening(port):break
        time.sleep(0.05)
    print(json.dumps({'event':'cleanup','processTerminated':not original_alive(),'listenerClosed':not listening(port)},separators=(',',':')))
except BaseException:
    print('{"event":"cleanup","processTerminated":false,"listenerClosed":false}')
    sys.exit(1)
`;
