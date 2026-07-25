-- STEP 1: DIAGNOSI - Esegui questo PRIMA per vedere la struttura attuale
-- Incolla nel SQL Editor e clicca Run

-- 1. Struttura attuale di app_records
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'app_records'
ORDER BY ordinal_position;

-- 2. Oggetti che dipendono da app_records
SELECT DISTINCT
  dependent_ns.nspname as dependent_schema,
  dependent_view.relname as dependent_view,
  source_ns.nspname as source_schema,
  source_table.relname as source_table
FROM pg_depend
JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid
JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
JOIN pg_namespace source_ns ON source_ns.oid = source_table.relnamespace
WHERE source_table.relname = 'app_records'
AND dependent_view.relname != source_table.relname;

-- 3. Policy esistenti su app_records
SELECT policyname, cmd, permissive, qual, with_check
FROM pg_policies
WHERE tablename = 'app_records';

-- 4. Trigger su app_records
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'app_records';