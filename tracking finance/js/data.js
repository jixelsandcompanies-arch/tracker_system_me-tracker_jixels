/* Data access is isolated here so a real API can replace local storage later. */
(function () {
  const STORAGE_KEY = "jixels-finance-data-empty-20260826";
  const emptyData = {
    accounts: [],
    payments: [],
    auditLogs: [],
    alerts: [],
    notifications: [],
    settings: {
      workspaceName: "Jixels Finance",
      timezone: "Africa/Nairobi",
      currency: "KES",
      commissionRate: "5",
      dailyCollectionTarget: "18500",
      overdueGraceDays: "3",
      exportRetentionDays: "90",
      sessionTimeoutMinutes: "30",
      notifyPayments: true,
      notifyReconciliation: true,
      notifyCommissions: true
    },
    agents: []
  };

  function readData() {
    try {
      return { ...emptyData, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") };
    } catch {
      return { ...emptyData };
    }
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function money(value) {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  window.FinanceStore = { emptyData, readData, saveData, money };
})();
