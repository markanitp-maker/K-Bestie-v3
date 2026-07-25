import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";

const VALID_STATUSES = new Set(["unchanged", "corrected", "uncertain", "rejected"]);

// chat_sessions.session_type의 실제 DB 값은 'mission'/'free' (raw_daily_conversations.session_type
// CHECK 제약은 요청서 표기 그대로 'mission'/'free_chat'을 쓰므로 여기서 매핑한다).
function toRawSessionType(sessionType: string): "mission" | "free_chat" {
  return sessionType === "mission" ? "mission" : "free_chat";
}

export async function runContextCorrectionPipeline(targetDate: string, specificSessionIds?: string[]) {
  const db = createServiceClient();
  const result = {
    collected: 0,
    corrected: 0,
    unchanged: 0,
    uncertain: 0,
    rejected: 0,
    errors: [] as any[]
  };

  let query = db
    .from("chat_sessions")
    .select("id, child_id, session_type")
    .gte("started_at", `${targetDate}T00:00:00+09:00`)
    .lte("started_at", `${targetDate}T23:59:59+09:00`);

  if (specificSessionIds && specificSessionIds.length > 0) {
    query = query.in("id", specificSessionIds);
  }

  const { data: sessions, error: sessionErr } = await query;
  if (sessionErr) throw new Error(`세션 조회 실패: ${sessionErr.message}`);
  if (!sessions?.length) return result;

  const aiConfig = await getModelForGroup("A");
  const ai = createGenAIClient(aiConfig);

  for (const session of sessions) {
    try {
      const { data: messages, error: msgErr } = await db
        .from("chat_messages")
        .select("id, role, content, created_at")
        .eq("session_id", session.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) continue;

      const { data: existingRaw, error: rawCheckErr } = await db
        .from("raw_daily_conversations")
        .select("chat_message_id")
        .eq("session_id", session.id);
      
      if (rawCheckErr) throw new Error(rawCheckErr.message);
      const existingMsgIds = new Set(existingRaw?.map((r: any) => r.chat_message_id) ?? []);

      let turnOrder = existingMsgIds.size;
      const newRawRecords = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.content.trim() === "") continue;
        if (msg.content.startsWith("[SYSTEM]")) continue;
        if (existingMsgIds.has(msg.id)) continue;

        turnOrder++;
        const speaker = msg.role === "child" ? "child" : "k";
        
        newRawRecords.push({
          child_id: session.child_id,
          session_id: session.id,
          chat_message_id: msg.id,
          speaker,
          raw_text: msg.content,
          session_type: toRawSessionType(session.session_type),
          business_date: targetDate,
          turn_order: turnOrder
        });
      }

      // newRawRecords가 0건이어도(이미 전부 수집된 세션) 곧장 건너뛰지 않는다 - 이전 실행에서
      // raw는 수집됐지만 correction이 실패/타임아웃으로 완료되지 못한 채 남아있을 수 있고,
      // 그 경우 여기서 continue하면 그 세션은 영원히 재시도되지 않는다.
      if (newRawRecords.length > 0) {
        const { error: rawInsertErr } = await db
          .from("raw_daily_conversations")
          .insert(newRawRecords);
        if (rawInsertErr) throw new Error(`Raw 데이터 삽입 실패: ${rawInsertErr.message}`);
        result.collected += newRawRecords.length;
      }

      // "케이 직전 질문"/"이전 1~3턴"은 이번 실행에서 새로 넣은 것뿐 아니라 같은 세션이 이전
      // 수집 배치(예: 18:00분)에서 이미 저장해 둔 턴까지 포함해야 한다 - 세션 전체 raw 이력을
      // turn_order 순으로 다시 조회해 사용한다(신규/기존 구분 없이 항상 전체 재조회).
      const { data: allSessionRaw, error: allRawErr } = await db
        .from("raw_daily_conversations")
        .select("id, speaker, raw_text, child_id, session_id, business_date")
        .eq("session_id", session.id)
        .order("turn_order", { ascending: true });
      if (allRawErr) throw new Error(`세션 전체 raw 조회 실패: ${allRawErr.message}`);
      if (!allSessionRaw?.length) continue;
      const sessionRawHistory = allSessionRaw;

      // 이미 보정된(corrected_daily_conversations에 행이 있는) raw는 다시 보정하지 않는다 -
      // 신규 수집분뿐 아니라 이전 실행에서 raw만 남고 보정이 안 끝난 것까지 여기서 함께 잡는다.
      const { data: alreadyCorrected, error: correctedCheckErr } = await db
        .from("corrected_daily_conversations")
        .select("raw_conversation_id")
        .eq("session_id", session.id);
      if (correctedCheckErr) throw new Error(`보정 완료 여부 조회 실패: ${correctedCheckErr.message}`);
      const correctedRawIds = new Set((alreadyCorrected ?? []).map((r: any) => r.raw_conversation_id));

      // 아이별 확정 정보(이름/친구/관심사/자주 쓰는 표현) — 보정 프롬프트의 컨텍스트로 사용.
      // 이미 mission 리포트/memoryRecallResponder가 쓰는 것과 동일한 조회 패턴(long_term 위주).
      let childMemoryContext = "없음";
      try {
        const { data: memories } = await db
          .from("child_memory")
          .select("category, content")
          .eq("child_id", session.child_id)
          .eq("memory_type", "long_term")
          .order("business_date", { ascending: false })
          .limit(15);
        if (memories && memories.length > 0) {
          childMemoryContext = memories.map((m: any) => `[${m.category || "일반"}] ${m.content}`).join("\n");
        }
      } catch (memErr) {
        console.error("[contextCorrection] child_memory 조회 실패(계속 진행):", memErr);
      }

      const childRaws = sessionRawHistory.filter(
        (r: any) => r.speaker === "child" && !correctedRawIds.has(r.id)
      );
      for (const raw of childRaws) {
        const rawIdx = sessionRawHistory.findIndex((r: any) => r.id === raw.id);
        const previousTurns = sessionRawHistory.slice(Math.max(0, rawIdx - 3), rawIdx);
        let kLastQuestion = "없음";
        if (previousTurns.length > 0) {
          const lastTurn = previousTurns[previousTurns.length - 1];
          if (lastTurn.speaker === "k") kLastQuestion = lastTurn.raw_text;
        }

        const recentContext = previousTurns.map((t: any) => `${t.speaker}: ${t.raw_text}`).join("\n");

        const prompt = `아이의 STT 음성 인식 결과를 대화 문맥에 맞게 보정해라.
반드시 아래 JSON 구조로만 출력할 것(기타 텍스트 금지):
\`\`\`json
{
  "corrected_text": "보정된 텍스트",
  "status": "unchanged|corrected|uncertain|rejected",
  "confidence": 0.9,
  "report_eligible": true,
  "correction_reason": "이유",
  "uncertain_reason": "이유"
}
\`\`\`

입력 데이터:
- 아이 STT 원문: ${raw.raw_text}
- 케이 직전 질문: ${kLastQuestion}
- 이전 대화 내역: ${recentContext}
- 세션 타입: ${session.session_type}
- 아이별 기존 확정 정보(이름/친구/관심사/자주 쓰는 표현): ${childMemoryContext}

규칙:
1. 허용: 띄어쓰기 수정, 명백한 발음 오류 수정, 조사 수정, 문맥상 확실한 단어 수정, 고유명사 후보 기반 수정.
2. 절대 금지: 아이가 하지 않은 내용 추가, 감정 임의 생성, 친구 관계 추론, 학교 사건 생성, 부모가 듣고 싶어 하는 방향으로 변경, 의미가 달라지는 수정.
3. 확신할 수 없으면 절대 보정하지 말고 status를 "uncertain"으로, report_eligible을 false로 설정한다.
4. 아이가 실제로 하지 않은 말을 지어내느니 차라리 원문을 그대로 두고 status를 "uncertain"으로 표시하는 쪽을 항상 택한다.`;

        let parsed: any;
        try {
          const aiResponse = await ai.models.generateContent({
            model: aiConfig.modelId,
            contents: prompt,
            config: {
              systemInstruction: "반드시 JSON 형식으로만 응답할 것.",
              temperature: 0.2
            }
          });
          const text = aiResponse.text?.trim() || "{}";
          const cleanText = text.replace(/```json\n?|```\n?/g, "").trim();
          parsed = JSON.parse(cleanText);
        } catch (aiErr) {
          console.error("[contextCorrection] AI Error:", aiErr);
          parsed = {
            corrected_text: raw.raw_text,
            status: "uncertain",
            confidence: 0,
            report_eligible: false,
            uncertain_reason: "AI 호출 오류"
          };
        }

        // LLM 출력을 그대로 믿지 않는다(defense in depth) — status enum 강제, confidence clamp,
        // 그리고 uncertain/rejected면 LLM이 report_eligible=true를 줘도 무조건 false로 덮어쓴다.
        // (요청서 §8: "불확실 데이터를 부모 리포트에 사실처럼 사용하지 않는다")
        const status = VALID_STATUSES.has(parsed.status) ? parsed.status : "uncertain";
        const rawConfidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
        const confidence = Math.max(0, Math.min(1, rawConfidence));
        const reportEligible =
          status === "uncertain" || status === "rejected" ? false : !!parsed.report_eligible;

        const { error: corrErr } = await db
          .from("corrected_daily_conversations")
          .insert({
            raw_conversation_id: raw.id,
            child_id: raw.child_id,
            session_id: raw.session_id,
            business_date: raw.business_date,
            corrected_text: parsed.corrected_text || raw.raw_text,
            status,
            confidence,
            report_eligible: reportEligible,
            correction_reason: parsed.correction_reason || null,
            uncertain_reason: parsed.uncertain_reason || null
          });

        if (corrErr) throw new Error(`보정 데이터 저장 실패: ${corrErr.message}`);

        if (status === "unchanged") result.unchanged++;
        else if (status === "corrected") result.corrected++;
        else if (status === "uncertain") result.uncertain++;
        else result.rejected++;
      }
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }

  return result;
}
