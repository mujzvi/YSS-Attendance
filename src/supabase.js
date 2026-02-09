import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ltxpaapokiutzqomobnq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0eHBhYXBva2l1dHpxb21vYm5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTk3MDgsImV4cCI6MjA4NjE5NTcwOH0.N8xY6EXKhv2mfREW_nDogRFVWq5tKHoue8DDbFrtRyg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
