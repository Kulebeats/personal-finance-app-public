// Pure closed-vocabulary diagnostics. No service, admission, connection or slot
// authority is issued here, and no raw error text is retained in the recorder.
const phases = new Set(['INPUT_GUARD', 'MANIFEST_GUARD', 'CREDENTIAL_IMPORT', 'CREDENTIAL_GUARD',
  'PRODUCER_IMPORT', 'SERVICE_GUARD', 'LINEAGE_GUARD', 'RUNTIME_IMPORT', 'LIFETIME_SETUP', 'CREDENTIAL_SECRET',
  'CLIENT_CONSTRUCTION', 'CONNECT', 'SOCKET_CHECK', 'PRIVATE_IDENTITY', 'SELECT_DATABASE', 'INFO_SERVER',
  'WHOAMI', 'MARKER', 'POST_IDENTITY_LIFETIME', 'FACADES', 'PROJECTION', 'RETURN_LIFETIME',
  'SECRET_CALLBACK_LIFETIME', 'SECRET_CALLBACK_AUTHORITY', 'SOCKET_ADMISSION_LIFETIME', 'SOCKET_STREAM',
  'SOCKET_AUTHORITY', 'SOCKET_ENDPOINT', 'IDENTITY_CALLBACK_LIFETIME', 'IDENTITY_CALLBACK_AUTHORITY',
  'IDENTITY_VALIDATION', 'POST_SECRET_LIFETIME']);
const codes = new Map([['ECONNREFUSED', 'TCP_REFUSED'], ['ETIMEDOUT', 'TCP_TIMEOUT'], ['ECONNRESET', 'TCP_RESET'],
  ['EHOSTUNREACH', 'TCP_UNREACHABLE'], ['ENETUNREACH', 'TCP_UNREACHABLE'], ['EACCES', 'TCP_PERMISSION'],
  ['EPERM', 'TCP_PERMISSION'], ['ERR_MODULE_NOT_FOUND', 'IMPORT_REFUSED'], ['MODULE_NOT_FOUND', 'IMPORT_REFUSED']]);
const messages = new Map([
  ['REDIS_ADMISSION_REFUSED:INPUT', 'INPUT_REFUSED'], ['REDIS_ADMISSION_REFUSED:SIGNAL', 'SIGNAL_REFUSED'],
  ['REDIS_ADMISSION_REFUSED:ABORTED', 'CANCELLED'], ['REDIS_ADMISSION_REFUSED:MANIFEST', 'MANIFEST_REFUSED'],
  ['REDIS_ADMISSION_REFUSED:LIFETIME', 'LIFETIME_REFUSED'], ['REDIS_ADMISSION_REFUSED:DEADLINE', 'ADMISSION_TIMEOUT'],
  ['REDIS_ADMISSION_REFUSED:SOCKET', 'SOCKET_REFUSED'], ['REDIS_ADMISSION_REFUSED:LINEAGE', 'IDENTITY_REFUSED'],
  ['REDIS_ADMISSION_REFUSED:IDENTITY', 'IDENTITY_REFUSED'], ['REDIS_ADMISSION_REFUSED:DATABASE', 'DATABASE_REFUSED'],
  ['REDIS_ADMISSION_REFUSED:AUTH', 'AUTH_REFUSED'], ['REDIS_ADMISSION_REFUSED:INFO', 'PROTOCOL_REFUSED'],
  ['REDIS_CONNECTION_REFUSED', 'CONNECTION_REFUSED'], ['Command timed out', 'COMMAND_TIMEOUT'],
  ['REDIS_CREDENTIALS_REFUSED:CAPABILITY', 'CREDENTIAL_REFUSED'], ['REDIS_CREDENTIALS_REFUSED:PHASE', 'CREDENTIAL_REFUSED'],
  ['REDIS_CREDENTIALS_REFUSED:SERVICE', 'CREDENTIAL_REFUSED'], ['REDIS_CREDENTIALS_REFUSED:ACTION', 'CREDENTIAL_REFUSED'],
  ['REDIS_CREDENTIALS_REFUSED:REVOKED', 'LIFETIME_REFUSED'], ['OWNED_REDIS_SERVICE_REFUSED:CAPABILITY', 'SERVICE_REFUSED'],
  ['OWNED_REDIS_SERVICE_REFUSED:REVOKED', 'LIFETIME_REFUSED'], ['OWNED_REDIS_SERVICE_REFUSED:ACTION', 'SERVICE_REFUSED'],
]);

export function redactedRedisAdmissionDiagnostic(phase, error) {
  let reason = 'UNCLASSIFIED';
  try {
    const code = error?.code;
    if (codes.has(code)) reason = codes.get(code);
    else {
      const message = error?.message;
      if (messages.has(message)) reason = messages.get(message);
      else if (error?.name === 'ReplyError' && typeof message === 'string') {
        const prefix = message.slice(0, 32);
        reason = /^NOPERM(?:\s|$)/.test(prefix) ? 'SERVER_PERMISSION' :
          /^(?:NOAUTH|WRONGPASS)(?:\s|$)/.test(prefix) ? 'SERVER_AUTH' : 'SERVER_REJECTED';
      }
    }
  } catch { /* Throwing/changing error accessors never expose their values. */ }
  return Object.freeze({ phase: phases.has(phase) ? phase : 'UNKNOWN', reason });
}

/** Retain the first closed observation before a secret callback sanitizes errors. */
export function createRedisAdmissionDiagnostics() {
  let phase = 'UNKNOWN', diagnostic, socket;
  const enter = value => { phase = phases.has(value) ? value : 'UNKNOWN'; };
  const record = error => {
    diagnostic ??= Object.freeze({ ...redactedRedisAdmissionDiagnostic(phase, error), ...(socket ? { socket } : {}) });
    return diagnostic;
  };
  const capture = async action => { try { return await action(); } catch (error) { record(error); throw error; } };
  return Object.freeze({ enter, record, snapshot: record, capture,
    socket(value) {
      const read = key => { try { return value?.[key]; } catch { return undefined; } };
      const count = read('observedStreams'), status = read('clientStatus');
      const boolean = key => { const result = read(key); return typeof result === 'boolean' ? result : null; };
      socket = Object.freeze({ observedAt: 'CONNECT_RESOLVED',
        observedStreams: count === 0 ? 'NONE' : count === 1 ? 'ONE' : Number.isSafeInteger(count) && count > 1 ? 'MULTIPLE' : 'UNKNOWN',
        currentStreamObserved: boolean('currentStreamObserved'), socketInstance: boolean('socketInstance'), destroyed: boolean('destroyed'),
        remoteAddressMatches: boolean('remoteAddressMatches'), remotePortMatches: boolean('remotePortMatches'),
        clientStatus: ['wait', 'connecting', 'connect', 'ready', 'close', 'reconnecting', 'end'].includes(status) ? status : 'UNKNOWN' });
    },
    async step(nextPhase, action) {
      enter(nextPhase);
      return capture(action);
    },
  });
}
