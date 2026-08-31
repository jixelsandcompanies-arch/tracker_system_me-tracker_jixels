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
  requestPasswordReset: email => apiRequest("/v1/agent/auth/request-password-reset", { method: "POST", body: { email } })
};
