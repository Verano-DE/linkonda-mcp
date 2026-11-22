import nock from "nock";
import { afterEach, beforeAll } from "vitest";

// Offline gate (ADR 0023 D3): a request no test described fails instead of reaching the network.
beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});
