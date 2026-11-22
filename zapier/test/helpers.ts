import { createAppTester } from "zapier-platform-core";
import App from "../src/index.js";

// The definition is typed as Zapier's schema (functions as `Function`); the tests call its parts by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const app = App as any;
export const appTester = createAppTester(App as object);

export const KEY = "lk_test_synthetic_key";
export const API = "https://api.linkonda.com";

/** The key with the spaces a paste brings (AC-1). */
export const authData = { apiKey: ` ${KEY} ` };

export const bundleFor = (inputData: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  authData,
  inputData,
  ...extra,
});

/** What a failing step throws, as its name and the JSON Zapier's `Error` and `ThrottledError` put in the message. */
export async function failure(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const err = e as Error;
    let detail: { message?: string; code?: string; status?: number; delay?: number } = {};
    try {
      detail = JSON.parse(err.message);
    } catch {
      detail = { message: err.message };
    }
    // Core appends "What happened: …" (the step and its bundle) to the message of the errors it contextifies.
    const full = err.message;
    if (detail.message !== undefined) detail.message = detail.message.split("\nWhat happened:")[0];
    return { name: err.name, ...detail, full };
  }
  throw new Error("expected the step to fail");
}
