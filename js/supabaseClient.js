const supabaseUrl = "https://xvezpvqqjzvhilltzbsr.supabase.co";
const supabasePublishableKey = "sb_publishable_xVCjn-UcQ0egtUFjX4OjUQ_42ujQAIf";

export const supabase = window.supabase.createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
