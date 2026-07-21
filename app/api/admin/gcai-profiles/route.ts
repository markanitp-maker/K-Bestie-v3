import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const authResponse = await requireAdmin();
  if (authResponse) return authResponse;

  try {
    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from('gcai_profiles')
      .select('*')
      .order('profile');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profiles: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
