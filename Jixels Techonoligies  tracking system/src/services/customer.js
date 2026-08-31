import { apiRequest } from "./api";

export const customerApi = {
  getOverview: token => apiRequest("/v1/customer/overview", { token }),
  updateProfile: (token, profile) => apiRequest("/v1/customer/profile", { method: "PATCH", token, body: profile }),
  getPayments: token => apiRequest("/v1/customer/payments", { token }),
  getAlerts: token => apiRequest("/v1/customer/alerts", { token }),
  markAlertsRead: (token, ids) => apiRequest("/v1/customer/alerts/read", { method: "POST", token, body: { ids } }),
  deleteAlerts: (token, ids) => apiRequest("/v1/customer/alerts", { method: "DELETE", token, body: { ids } }),
  generateReport: (token, request) => apiRequest("/v1/customer/reports", { method: "POST", token, body: request }),
};
