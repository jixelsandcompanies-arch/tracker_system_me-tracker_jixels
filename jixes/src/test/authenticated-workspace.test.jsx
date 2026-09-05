import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "../App";

const SESSION_KEY = "jixels.admin.session.v1";

describe("authenticated admin workspace", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: "00000000-0000-0000-0000-000000000001",
      email: "admin@example.com",
      name: "Admin User",
      role: "super_admin",
      accessToken: "test-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      lastActivity: Date.now(),
    }));
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it("renders the dashboard for a super administrator role", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Dashboard Overview")).toBeInTheDocument(), { timeout: 10_000 });
  }, 15_000);
});
