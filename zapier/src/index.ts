import { defineApp, version } from "zapier-platform-core";
import { mapErrors, beforeRequest } from "./api.js";
import { authentication } from "./authentication.js";
import { createLink } from "./creates/create-link.js";
import { linkEvent } from "./triggers/link-event.js";

/** Equal to package.json's `version`, which `definition.test.ts` checks. */
const APP_VERSION = "1.0.0";

export default defineApp({
  version: APP_VERSION,
  platformVersion: version,
  authentication,
  beforeRequest: [beforeRequest],
  afterResponse: [mapErrors],
  // The API's refusals are mapped by `mapErrors`, which needs to see every status, 429 included (AC-3).
  flags: { skipThrowForStatus: true, throwForThrottlingEarly: false },
  triggers: { [linkEvent.key]: linkEvent },
  creates: { [createLink.key]: createLink },
});
