import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { extractJSON } from "@/app/api/_lib/utils";

export async function runContextCorrectionPipeline(targetDate: string, specificSessionIds?: string[]) {
  const db = createServiceClient();
  const result = { processed_children: 0, success: 0, failed: 0, errors: [] as any[] };

  let query = db
    .from("raw_daily_conversations")
    .select("id, child_id, business_date, mission_1, free_chat_1, mission_2, free_chat_2, collection_status")
    .eq("business_date", targetDate);

  const { data: rawRows, error: rawErr } = await query;
  if (rawErr) throw new Error(`Raw 데이터 조회 실패: ${rawErr.message}`);
  if (!rawRows?.length) return result;

  const { data: correctedRows, error: corrErr } = await db
    .from("corrected_daily_conversations")
    .select("raw_conversation_id")
    .eq("business_date", targetDate)
    .neq("status", "failed");
    
  if (corrErr) throw new Error(`Corrected 조회 실패: ${corrErr.message}`);
  const correctedSet = new Set(correctedRows.map((r: any) => r.raw_conversation_id));

  const aiConfig = await getModelForGroup("A");
  const ai = createGenAIClient(aiConfig);

  for (const raw of rawRows) {
    if (correctedSet.has(raw.id)) continue;

    try {
      result.processed_children++;

      const m1 = (raw.mission_1 || []).map((m: any) => `${m.role === 'child' ? '아이' : '케이'}: ${m.content}`).join('\n');
      const f1 = (raw.free_chat_1 || []).map((m: any) => `${m.role === 'child' ? '아이' : '케이'}: ${m.content}`).join('\n');
      const m2 = (raw.mission_2 || []).map((m: any) => `${m.role === 'child' ? '아이' : '케이'}: ${m.content}`).join('\n');
      const f2 = (raw.free_chat_2 || []).map((m: any) => `${m.role === 'child' ? '아이' : '케이'}: ${m.content}`).join('\n');

      const fullContext = `
[미션 1]
${m1 || '없음'}
[자유대화 1]
${f1 || '없음'}
[미션 2]
${m2 || '없음'}
[자유대화 2]
${f2 || '없음'}
`.trim();

      if (!m1 && !f1 && !m2 && !f2) {
        await db.from("corrected_daily_conversations").insert({
          raw_conversation_id: raw.id,
          child_id: raw.child_id,
          business_date: raw.business_date,
          corrected_data: { mission_1: [], free_chat_1: [], mission_2: [], free_chat_2: [] },
          status: 'corrected',
          correction_reason: '대화 없음'
        });
        result.success++;
        continue;
      }

      let childMemoryContext = "없음";
      try {
        const { data: memories } = await db
          .from("child_memory")
          .select("category, content")
          .eq("child_id", raw.child_id)
          .eq("memory_type", "long_term")
          .order("business_date", { ascending: false })
          .limit(15);
        if (memories && memories.length > 0) {
          childMemoryContext = memories.map((m: any) => `[${m.category || "일반"}] ${m.content}`).join("\n");
        }
      } catch (memErr) {
        console.error("[contextCorrection] child_memory 조회 실패:", memErr);
      }

      const prompt = `당신은 아이의 발화를 자연스럽게 보정하는 AI입니다. 
아래 아이의 하루 전체 대화(미션 1, 자유대화 1, 미션 2, 자유대화 2)를 읽고, 아이의 발화에 대해 STT 오인식이나 불완전한 문장을 대화 흐름과 [아이 기억 정보]를 참고하여 자연스럽게 복원하세요. 
케이의 발화는 그대로 유지하고 아이의 발화만 보정합니다.

[아이 기억 정보]
${childMemoryContext}

[하루 전체 대화]
${fullContext}

출력은 반드시 원본과 동일한 구조의 JSON 형식이어야 합니다. 각 발화 객체는 원본 배열과 1:1로 대응해야 합니다.
\`\`\`json
{
  "mission_1": [{ "id": "원본메시지id", "role": "child|k", "content": "보정된(또는 원본) 텍스트" }],
  "free_chat_1": [...],
  "mission_2": [...],
  "free_chat_2": [...]
}
\`\`\`
`;

      const response = await ai.models.generateContent({
        model: "gemma-4-31b-it",
        contents: prompt,
        config: { systemInstruction: "반드시 JSON 형식으로만 응답하라. 여분의 텍스트 금지." }
      });

      const text = response.text || "";
      
      let correctedJson;
      try {
        const cleanText = text.replace(/```json\n?|```\n?/g, "").trim();
        correctedJson = JSON.parse(cleanText);
      } catch {
        const objMatch = text.match(/\{[\s\S]*\}/);
        if (objMatch) {
          try { correctedJson = JSON.parse(objMatch[0]); } catch {}
        }
      }

      if (!correctedJson || typeof correctedJson !== 'object') {
        throw new Error("JSON 파싱 실패");
      }

      const { error: insertErr } = await db.from("corrected_daily_conversations").insert({
        raw_conversation_id: raw.id,
        child_id: raw.child_id,
        business_date: raw.business_date,
        corrected_data: {
          mission_1: correctedJson.mission_1 || raw.mission_1 || [],
          free_chat_1: correctedJson.free_chat_1 || raw.free_chat_1 || [],
          mission_2: correctedJson.mission_2 || raw.mission_2 || [],
          free_chat_2: correctedJson.free_chat_2 || raw.free_chat_2 || []
        },
        status: 'corrected',
        correction_reason: 'AI 보정 완료'
      });

      if (insertErr) throw new Error(`DB Insert Error: ${insertErr.message}`);
      result.success++;

    } catch (err: any) {
      console.error(`[Correction] child: ${raw.child_id} 실패:`, err);
      result.failed++;
      result.errors.push({ child_id: raw.child_id, error: String(err) });
      
      await db.from("corrected_daily_conversations").upsert({
        raw_conversation_id: raw.id,
        child_id: raw.child_id,
        business_date: raw.business_date,
        corrected_data: { mission_1: [], free_chat_1: [], mission_2: [], free_chat_2: [] },
        status: 'failed',
        correction_reason: String(err)
      }, { onConflict: 'raw_conversation_id' });
    }
  }

  return result;
}
