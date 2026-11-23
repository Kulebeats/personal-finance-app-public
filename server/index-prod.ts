import "dotenv/config";

import { startApplication } from "./production-application";
export { serveStatic } from "./production-application";

(async () => {
  await startApplication();
})();
