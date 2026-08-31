export const customer = {
  id: "customer-demo",
  name: "Purice Mwero",
  phone: "0759289343",
  email: "puricekaka@gmail.com",
};

export const bikes = [
  { id: "bike-kdx", type: "motorcycle", registration: "KDX 221B", model: "Bajaj Boxer 150", tracker: "T-230", status: "online", financeStatus: "On Track", total: 120000, paid: 80000, balance: 40000, monthlyPayment: 700, paidThisMonth: 0, nextPayment: "KES 700 this month", monitoringArmed: true, immobilized: false, tamperStatus: "secure" },
  { id: "bike-kda", type: "motorcycle", registration: "KDA 118M", model: "TVS HLX 150", tracker: "T-231", status: "stale", financeStatus: "Overdue", total: 95000, paid: 80000, balance: 15000, monthlyPayment: 700, paidThisMonth: 0, nextPayment: "KES 700 due today", monitoringArmed: true, immobilized: false, tamperStatus: "secure" },
  { id: "car-kcy", type: "car", registration: "KCY 730C", model: "Toyota Probox", tracker: "T-232", status: "online", financeStatus: "On Track", total: 150000, paid: 80000, balance: 70000, monthlyPayment: 700, paidThisMonth: 0, nextPayment: "KES 700 this month", monitoringArmed: true, immobilized: false, tamperStatus: "secure" },
];

export const payments = [
  { id: "UHMI74MVOL", mpesaReceiptNumber: "UHMI74MVOL", bikeId: "bike-kdx", date: "21 Aug 2026", amount: 1200, method: "M-Pesa", status: "Confirmed" },
  { id: "UH7P2KQ9DX", mpesaReceiptNumber: "UH7P2KQ9DX", bikeId: "bike-kda", date: "18 Aug 2026", amount: 800, method: "M-Pesa", status: "Confirmed" },
  { id: "UGX8NR4WBC", mpesaReceiptNumber: "UGX8NR4WBC", bikeId: "bike-kdx", date: "08 Aug 2026", amount: 1500, method: "M-Pesa", status: "Confirmed" },
];

export const alerts = [
  { id: "alert-1", type: "payment", icon: "wallet-outline", title: "Payment due today", message: "KES 400 is due for KDA 118M.", age: "12 min", unread: true },
  { id: "alert-2", type: "tracker", icon: "warning-outline", title: "Tracker update delayed", message: "KDA 118M has not reported a recent position.", age: "28 min", unread: true },
  { id: "alert-3", type: "receipt", icon: "checkmark-circle-outline", title: "Payment received", message: "KES 1,200 for KDX 221B was confirmed.", age: "2 days", unread: false },
  { id: "alert-4", type: "location", icon: "location-outline", title: "Bike is online", message: "KDX 221B is reporting normally.", age: "3 days", unread: false },
];

export function money(value) {
  return `KES ${Number(value).toLocaleString("en-KE")}`;
}
