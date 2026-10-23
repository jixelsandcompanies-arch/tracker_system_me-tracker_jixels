import { apiRequest } from "./api";

function normalizeSession(response) {
  const session = response?.session ?? response;
  if (!session?.accessToken || !session?.user) throw new Error("The login response did not contain a valid agent session.");
  return session;
}

export const authApi = {
  async login(email, password) {
    return normalizeSession(await apiRequest("/v1/agent/auth/login", { method: "POST", body: { email, password } }));
  },
  register: data => apiRequest("/v1/agent/auth/register", { method: "POST", body: data }),
  listCustomers: token => apiRequest("/v1/agent/customers", { token }),
  listAssignments: token => apiRequest("/v1/agent/assignments", { token }),
  listAlertStates: token => apiRequest("/v1/agent/alerts", { token }),
  updateAlertStates: (token, ids, action) => apiRequest("/v1/agent/alerts", { method: "PATCH", token, body: { ids, action } }),
  onboardCustomer: (token, data) => apiRequest("/v1/agent/customers", { method: "POST", token, body: data }),
  addVehicleToCustomer: (token, customerId, data) => apiRequest(`/v1/agent/customers/${encodeURIComponent(customerId)}/vehicles`, { method: "POST", token, body: data }),
  updatePaymentPhone: (token, customerId, paymentPhone) => apiRequest(`/v1/agent/customers/${encodeURIComponent(customerId)}/payment-phone`, { method: "PATCH", token, body: { paymentPhone } }),
  updateInstallation: (token, customerId, installed) => apiRequest(`/v1/agent/customers/${encodeURIComponent(customerId)}/installation`, { method: "PATCH", token, body: { installed } }),
  promptDeposit: (token, customerId, amount, paymentPhone) => apiRequest(`/v1/agent/customers/${encodeURIComponent(customerId)}/deposit-prompt`, { method: "POST", token, body: { amount, paymentPhone } }),
  requestPasswordReset: email => apiRequest("/v1/agent/auth/request-password-reset", { method: "POST", body: { email } })
};
