/** One platform contract for the verifier, generated client example and repairs. */
export const WORKBENCH_SUPABASE_SETTINGS_TYPE = "{ url: string; anonKey: string; schema: 'app'; storageKey: string }";

export const WORKBENCH_SUPABASE_CLIENT_EXAMPLE = `import { createClient } from '@supabase/supabase-js';
declare global { interface Window { __DK_SUPABASE__?: ${WORKBENCH_SUPABASE_SETTINGS_TYPE} } }
const settings = window.__DK_SUPABASE__;
export const configurationError = settings ? '' : 'Database configuration is unavailable.';
export const supabase = settings ? createClient(settings.url, settings.anonKey, {
  db: { schema: settings.schema },
  auth: { storageKey: settings.storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;`;
