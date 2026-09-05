-- The early Finance portal wrote this whole configuration object from browser
-- defaults. It is not an administrator-authored configuration, so clear only
-- an exact match and let Finance save real workspace settings explicitly.
update public.finance_settings
set data = '{}'::jsonb,
    updated_at = now()
where id = 'default'
  and data = '{
    "workspaceName": "Jixels Finance",
    "timezone": "Africa/Nairobi",
    "currency": "KES",
    "commissionRate": "5",
    "dailyCollectionTarget": "18500",
    "overdueGraceDays": "3",
    "exportRetentionDays": "90",
    "sessionTimeoutMinutes": "30",
    "notifyPayments": true,
    "notifyReconciliation": true,
    "notifyCommissions": true
  }'::jsonb;

notify pgrst, 'reload schema';
