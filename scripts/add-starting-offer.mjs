// Uses Supabase service role to run DDL via a temporary RPC function
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://pyrgotfotmwazigewlke.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'
)

// Insert a dummy row to test write access, then check columns
const { data, error } = await supabase.from('leads').select('starting_offer').limit(1)
if (error?.message?.includes('column "starting_offer" does not exist')) {
  console.log('Column missing — need to add via Supabase dashboard SQL editor:')
  console.log('ALTER TABLE leads ADD COLUMN IF NOT EXISTS starting_offer numeric;')
} else if (error) {
  console.error('Error:', error.message)
} else {
  console.log('✓ starting_offer column already exists! Sample:', data)
}
