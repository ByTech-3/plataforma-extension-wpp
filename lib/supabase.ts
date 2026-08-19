import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.WXT_SUPABASE_URL;
const anonKey = import.meta.env.WXT_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey);