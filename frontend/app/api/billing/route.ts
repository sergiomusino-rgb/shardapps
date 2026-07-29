import { createClient } from "@supabase/supabase-js";
import type { Database } from '@/types/database';
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ensureTenantAccess } from "../../../src/lib/tenant";

const STRIPE_API_VERSION = "2026-06-24.dahlia";

function getSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  );
}

async function getUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  try {
    const body = await req.json();
    const { tenantId: requestedTenantId } = body;

    const { tenantId } = await ensureTenantAccess(user.id, requestedTenantId);

    const supabase = getSupabase();
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("tenant_id", tenantId)
      .single();

    if (error || !subscription?.stripe_customer_id) {
      return NextResponse.json({ error: "Nessun abbonamento attivo trovato" }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2025-02-24.acacia" as any,
    });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Errore Stripe";
    console.error("Errore billing portal:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
