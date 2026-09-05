import { describe, expect, it } from "vitest";
import { canAccess } from "../lib/security";

describe("admin workspace access", () => {
  it("grants database admin roles access to the dashboard and operations modules", () => {
    expect(canAccess("admin", "Dashboard")).toBe(true);
    expect(canAccess("admin", "Customers")).toBe(true);
    expect(canAccess("admin", "Settings")).toBe(true);
  });
});
