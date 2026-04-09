/**
 * Supabase Client Configuration
 */

const SUPABASE_URL = 'https://hrsaqncwszbqfutdpdkn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhyc2FxbmN3c3picWZ1dGRwZGtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNTI4MDksImV4cCI6MjA4NDkyODgwOX0.wi2gibUkjMFpy2oHc6psjMjd0lW7fm6QdN_NEoh8TEU';

// Initialize Supabase client (v2 SDK uses supabase object directly)
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Export as 'supabase' for use in app.js
window.supabase = supabaseClient;
