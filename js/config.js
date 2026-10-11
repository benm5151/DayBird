// Daybird cloud config. The anon key is safe to publish; row-level security in schema.sql
// decides what each logged-in user can read and write. Leave both empty to run offline.
window.DAYBIRD_CONFIG = {
  supabaseUrl: 'https://permtdnqrkipvjvbbyjb.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlcm10ZG5xcmtpcHZqdmJieWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NDU1NTEsImV4cCI6MjEwNzMyMTU1MX0.eT8hDgWBWOiX96E2ZjtQr61V9MrpesW54SAucSamiWY',
};
