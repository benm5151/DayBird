// Daybird cloud config. The anon key is safe to publish; row-level security in schema.sql
// decides what each logged-in user can read and write. Leave both empty to run offline.
window.DAYBIRD_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
