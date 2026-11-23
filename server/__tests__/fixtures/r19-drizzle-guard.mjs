import { installNetworkGuard } from "../../testing/network-guard.mjs";
import assert from "node:assert/strict";
import pg from "pg";
installNetworkGuard(); // No manifest: no database, external HTTP or TLS allowed.
if (process.env.PFA_R19_CAPTURE_POOL === "1") {
  pg.Pool = class {
    constructor(options) {
      assert.equal(options.host, "127.0.0.1");
      assert.equal(options.port, 65431);
      assert.equal(options.connectionString, undefined);
      assert.equal(options.ssl.rejectUnauthorized, true);
      assert.equal(typeof options.ssl.checkServerIdentity, "function");
      if (process.env.PFA_R19_EXPECT_NO_PASSWORD === "1") assert.equal(options.password, undefined);
      console.log("R19_VERIFIED_DRIVER_BOUNDARY");
      throw new Error("R19_SYNTHETIC_STOP_BEFORE_DB_CONNECT");
    }
  };
}
