import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Compile and exercise only the actual Send method over owned anonymous pipes.
// The native supervisor's Run method, installed imports and component are absent.
const helper = fs.readFileSync(new URL('../runtime-installed-custody-windows.ps1', import.meta.url), 'utf8');
const begin = helper.indexOf('    static void Send('), end = helper.indexOf('    static string ExpectedRefusal()', begin);
assert.ok(begin > 0 && end > begin && helper.indexOf('    static void Send(', begin + 1) === -1);
const send = helper.slice(begin, end);
const source = `using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
public static class R20SendRegression {
    static string Scenario;
    static bool AckAllowed;
    const string Fixture = "sharp-geoip-v1";
    static void Need(bool value) { if (!value) throw new InvalidOperationException("SEND_REGRESSION_REFUSED"); }
${send}
    public static object Probe(string scenario) {
        Scenario = scenario; AckAllowed = scenario == "normal";
        using (var signal = new ManualResetEventSlim(false))
        using (var writerPipe = new AnonymousPipeServerStream(PipeDirection.Out, HandleInheritability.None))
        using (var readerPipe = new AnonymousPipeClientStream(PipeDirection.In, writerPipe.ClientSafePipeHandle))
        using (var reader = new StreamReader(readerPipe, Encoding.UTF8, false, 4096, true)) {
            // Transfer the writer's sole native ownership into Send's SafeFileHandle.
            // Invalidating the original SafePipeHandle avoids a double close.
            using (var handle = new SafeFileHandle(writerPipe.SafePipeHandle.DangerousGetHandle(), true)) {
                writerPipe.SafePipeHandle.SetHandleAsInvalid();
                Task sending = Task.Run(() => Send(handle, "protocol", signal));
                bool joined = false;
                try {
                    Task<string> first = reader.ReadLineAsync(); Need(first.Wait(3000)); Need(first.Result == "protocol");
                    Task<string> next = reader.ReadLineAsync();
                    bool completedBeforeSignal = sending.Wait(250);
                    bool readCompletedBeforeSignal = next.Wait(250);
                    signal.Set(); Need(sending.Wait(5000)); joined = true; Need(next.Wait(5000));
                    string secondLine = next.Result;
                    Task<string> tail = reader.ReadToEndAsync(); Need(tail.Wait(3000)); Need(tail.Result == "");
                    return new { scenario, completedBeforeSignal, readCompletedBeforeSignal, secondLine, senderJoined = joined, eofObserved = true };
                } finally {
                    signal.Set();
                    if (!joined) Need(sending.Wait(5000));
                }
            }
        }
    }
}`;
const encodedSource = Buffer.from(source).toString('base64');
const ps = `$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.ToString() -ne '7.6.6' -or [Environment]::Version.ToString() -ne '10.0.12') { throw 'HOST' }
$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedSource}'))
Add-Type -TypeDefinition $source -ErrorAction Stop
$rows=@(foreach($scenario in @('unknown-module','unknown-data','native-substitution','normal','timeout','supervisor-loss','preexisting-writer','unknown-member','digest-drift')){[R20SendRegression]::Probe($scenario)})
ConvertTo-Json -InputObject $rows -Depth 4 -Compress`;
const probe = spawnSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
  windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8',
  env: { SystemRoot: 'C:\\WINDOWS', TEMP: process.env.TEMP, TMP: process.env.TMP, TZ: 'UTC' },
});
assert.equal(probe.error, undefined); assert.equal(probe.status, 0, probe.stderr); assert.equal(probe.signal, null); assert.equal(probe.stderr, '');
const rows = JSON.parse(probe.stdout);
assert.equal(rows.length, 9);
for (const row of rows) test(`actual C# Send lifetime for ${row.scenario}`, () => {
  const poison = ['unknown-module', 'unknown-data', 'native-substitution'].includes(row.scenario);
  assert.equal(row.completedBeforeSignal, poison);
  assert.equal(row.readCompletedBeforeSignal, poison);
  assert.equal(row.secondLine, row.scenario === 'normal' ? 'R20_INSTALLED_ACK:sharp-geoip-v1' : null);
  assert.equal(row.senderJoined, true); assert.equal(row.eofObserved, true);
});
