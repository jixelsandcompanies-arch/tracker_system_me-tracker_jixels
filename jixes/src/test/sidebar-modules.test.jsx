import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EnhancedModuleView from "../components/EnhancedModuleView";

const modules = ["Customers", "Customer Accounts", "Products", "GPS Trackers", "Screening", "Payments", "Commissions", "Users", "Alerts", "Reports", "Settings", "Audit Logs"];
describe("sidebar modules", () => {
  afterEach(cleanup);
  it.each(modules)("renders %s without a crash", (title) => {
    render(<EnhancedModuleView title={title} setShowAdd={() => {}} />);
    const heading = title === "Customer Accounts" ? "Customer accounts" : title === "Products" ? "Product inventory" : title === "Screening" ? "Screening applications" : title === "Payments" ? "Payment records" : title === "Users" ? "Staff accounts" : title;
    expect(screen.getByRole("heading", { name: new RegExp(heading, "i") })).toBeInTheDocument();
  });
});
