'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';

// Admin user ID from admin page
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

export type UserPlan = 'free' | 'starter' | 'pro' | 'business';
export type UserRole = 'admin' | 'reseller' | 'viewer' | 'editor' | 'agent';

// Types for database queries
interface ProfileData {
  role?: string;
  subscription_plan?: string;
}

interface TenantData {
  plan?: string;
}

interface TenantMemberData {
  tenant_id?: string;
}

export function useUserPlan() {
  const [plan, setPlan] = useState<UserPlan>('free');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReseller, setIsReseller] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  useEffect(() => {
    fetchUserPlan();
  }, []);

  const fetchUserPlan = async () => {
    setLoading(true);
    
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session?.user) {
      setPlan('free');
      setIsAdmin(false);
      setIsReseller(false);
      setUserRole(null);
      setLoading(false);
      return;
    }

    // Get user profile with role (handle missing table/columns gracefully)
    let profile: ProfileData | null = null;
    try {
      const { data } = await supabaseBrowser
        .from('profiles')
        .select('role, subscription_plan')
        .eq('user_id', session.user.id)
        .single();
      profile = data ? (data as unknown as ProfileData) : null;
    } catch (err) {
      // Table or columns may not exist, continue with defaults
      console.warn('[useUserPlan] Profiles table not accessible, using defaults');
    }

    // Check if user is admin (by ID or by role)
    const isUserAdmin = session.user.id === ADMIN_USER_ID || (profile?.role === 'admin');
    setIsAdmin(isUserAdmin);

    // Check if user is reseller
    const isUserReseller = profile?.role === 'reseller';
    setIsReseller(isUserReseller);

    // Set user role
    setUserRole((profile?.role as UserRole) || null);

    // Get user plan (check both owner and membership)
    let userPlan: UserPlan = 'free';
    
    // First check if user is owner of a tenant
    const { data: ownedTenant } = await supabaseBrowser
      .from('tenants')
      .select('plan')
      .eq('owner_id', session.user.id)
      .single();
    
    if (ownedTenant && (ownedTenant as TenantData).plan) {
      userPlan = (ownedTenant as TenantData).plan as UserPlan;
    } else {
      // If not owner, check if user is member of a tenant
      const { data: membership } = await supabaseBrowser
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', session.user.id)
        .limit(1)
        .single();
      
      if (membership && (membership as TenantMemberData).tenant_id) {
        const tenantId = (membership as TenantMemberData).tenant_id;
        if (tenantId) {
          const { data: tenant } = await supabaseBrowser
            .from('tenants')
            .select('plan')
            .eq('id', tenantId)
            .single();
          
          if (tenant && (tenant as TenantData).plan) {
            userPlan = (tenant as TenantData).plan as UserPlan;
          }
        }
      }
    }

    setPlan(userPlan);
    setLoading(false);
  };

  const isProOrBusiness = plan === 'pro' || plan === 'business';

  return { 
    plan, 
    loading, 
    isProOrBusiness, 
    isAdmin, 
    isReseller,
    userRole,
    refetch: fetchUserPlan 
  };
}