import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types; it runs only when executed, so importing it starts nothing
import { needsTempHome } from "../scripts/nested.mjs";

// ADR 0023 D2: `ray build` writes under HOME, so only that one gets a temporary one.
describe("nested package runner", () => {
  it("a temporary HOME only for raycast's build", () => {
    const needs = needsTempHome as (dir: string, script: string) => boolean;
    expect(needs("raycast", "build")).toBe(true);
    expect(needs("raycast", "test")).toBe(false);
    expect(needs("raycast", "typecheck")).toBe(false);
    expect(needs("zapier", "build")).toBe(false);
    expect(needs("zapier", "test")).toBe(false);
  });
});
