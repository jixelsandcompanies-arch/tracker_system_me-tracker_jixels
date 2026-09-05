import { apiRequest } from "./api";

export const authApi = {
  async login(email, password) {
    const response = await apiRequest("/v1/auth/login", { method: "POST", body: { email, password } });
    const session = response?.session ?? response;
    if (!session?.accessToken || !session?.user || !session?.expiresAt) throw new Error("The login response did not contain a valid expiring session.");
    return session;
  },
  register: data => apiRequest("/v1/auth/register", { method: "POST", body: data }),
  requestPasswordReset: email => apiRequest("/v1/auth/request-password-reset", { method: "POST", body: { email } }),
  verifyApprovalCode: data => apiRequest("/v1/auth/verify-customer-approval-code", { method: "POST", body: data }),
  verifyOtp: data => apiRequest("/v1/auth/verify-admin-otp", { method: "POST", body: data }),
  requestOtp: data => apiRequest("/v1/auth/request-admin-otp", { method: "POST", body: data }),
  accountStatus: email => apiRequest(`/v1/auth/account-status?email=${encodeURIComponent(email)}`),
};
