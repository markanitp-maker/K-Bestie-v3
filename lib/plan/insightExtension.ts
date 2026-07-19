import { createClient } from '@/lib/supabase/client';
import { getEffectiveRetention } from './retention';

export async function purchaseExtension(familyId: string, yearsToPurchase: number) {
  const supabase = createClient();
  const { error } = await supabase.rpc('purchase_insight_extension', {
    p_family_id: familyId,
    p_years_to_purchase: yearsToPurchase
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function calculateFinalDeletionDate(familyId: string): Promise<Date> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('insight_retention_extensions')
    .select('extension_years_purchased')
    .eq('family_id', familyId)
    .single();
    
  let extensionYears = 0;
  if (!error && data) {
    extensionYears = data.extension_years_purchased;
  }
  
  // Care Insight는 Tier 2
  const retention = getEffectiveRetention(2, extensionYears);
  
  const finalDate = new Date();
  finalDate.setUTCMonth(finalDate.getUTCMonth() + retention.months);
  return finalDate;
}
