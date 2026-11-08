import { createClient } from '@supabase/supabase-js'
import { ANON } from './api'

const SUPABASE_URL = 'https://ylmwwwtnqhqjtufqmctf.supabase.co'

export const supabase = createClient(SUPABASE_URL, ANON)
