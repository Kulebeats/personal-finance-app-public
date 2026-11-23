import session, { type SessionData } from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { sessionIdentityHash } from "../services/session-identity";

const PgSession = connectPgSimple(session);
const identity = (data: SessionData) => data.userId || data.mfaPendingUserId;
const generation = (data: SessionData) => data.userId ? data.securityGeneration : data.mfaPendingSecurityGeneration;

/** Both writes and revocations lock users first, so an old save cannot win last. */
export class GuardedSessionStore extends PgSession {
  private async allowed(client: Pick<PoolClient, "query">, sid: string, data: SessionData, lock = false) {
    const userId = identity(data);
    if (!userId) return true;
    const { rows: [user] } = await client.query(`SELECT security_generation, erased_at, password_hash LIKE '!erased!%' AS legacy_erased
      FROM users WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
    const value = generation(data);
    // Rolling compatibility: old payloads mean generation 0, never the current
    // value. Once revoked/reset, a generation-less late save stays invalid.
    if (!user || user.erased_at || user.legacy_erased || user.security_generation !== (value ?? 0) ||
        (value !== undefined && (!Number.isSafeInteger(value) || value < 0))) return false;
    const revoked = await client.query("SELECT 1 FROM session_revocations WHERE session_id_hash = $1", [sessionIdentityHash(sid)]);
    return revoked.rows.length === 0;
  }

  override get(sid: string, callback: (error: unknown, data?: SessionData | null) => void): void {
    super.get(sid, (error: unknown, data?: SessionData | null) => {
      if (error || !data) return callback(error, data);
      // The base read starts its normal expiry pruning. Its payload may already
      // be stale, so authorize and return the persisted payload in one snapshot.
      // Never delete a newer current-device row because an old read was denied.
      pool.query<{ sess: SessionData }>(`SELECT s.sess FROM "session" s
        LEFT JOIN users u ON u.id = CASE WHEN COALESCE(s.sess->>'userId', s.sess->>'mfaPendingUserId')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN COALESCE(s.sess->>'userId', s.sess->>'mfaPendingUserId')::uuid END
        WHERE s.sid = $1 AND s.expire >= now()
          AND NOT EXISTS (SELECT 1 FROM session_revocations r WHERE r.session_id_hash = $2)
          AND (COALESCE(s.sess->>'userId', s.sess->>'mfaPendingUserId') IS NULL OR (
            u.id IS NOT NULL AND u.erased_at IS NULL AND u.password_hash NOT LIKE '!erased!%'
            AND u.security_generation::text = COALESCE(CASE WHEN s.sess->>'userId' IS NOT NULL
              THEN s.sess->>'securityGeneration' ELSE s.sess->>'mfaPendingSecurityGeneration' END, '0')
          ))`, [sid, sessionIdentityHash(sid)]).then((result) => callback(null, result.rows[0]?.sess), callback);
    });
  }

  private async persist(sid: string, data: SessionData, touch: boolean) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (await this.allowed(client, sid, data, true)) {
        const expires = data.cookie.expires ? new Date(data.cookie.expires) : new Date(Date.now() + (data.cookie.maxAge ?? 86400000));
        if (touch) await client.query('UPDATE "session" SET expire = $1 WHERE sid = $2', [expires, sid]);
        else await client.query('INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3', [sid, JSON.stringify(data), expires]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  override set(sid: string, data: SessionData, callback?: (error?: unknown) => void): void {
    this.persist(sid, data, false).then(() => callback?.(), (error: unknown) => callback?.(error));
  }
  override touch(sid: string, data: SessionData, callback?: (error?: unknown) => void): void {
    this.persist(sid, data, true).then(() => callback?.(), (error: unknown) => callback?.(error));
  }
}

export const sessionStore = new GuardedSessionStore({ pool, tableName: "session", createTableIfMissing: false });
