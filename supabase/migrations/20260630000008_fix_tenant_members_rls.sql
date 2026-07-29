-- Fix RLS policy for tenant_members to allow users to create their own membership
-- This fixes the circular issue where a user can't create their first tenant membership

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "tenant_members_insert_owner" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_insert_self" ON tenant_members;

-- Allow users to insert their own membership (they can only add themselves)
CREATE POLICY "tenant_members_insert_self" ON tenant_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Keep other policies as they are
-- (tenant_members_select_own, tenant_members_update_owner, tenant_members_delete_owner)