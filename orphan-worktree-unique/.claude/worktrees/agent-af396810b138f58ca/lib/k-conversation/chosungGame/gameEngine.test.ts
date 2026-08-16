import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assessBoredom } from "../boredomDetection";
import { GRADE_PERSONAS } from "../gradePersonas";
import { extractUtteranceSignals } from "../utteranceSignals";
import {
  buildHintInstruction,
  handleChosungTurn,
  isExpiredOrDifferentChatSession,
  shouldProactivelyOfferChosung,
} from "./gameEngine";
import type { ChosungGameSession } from "./gameSession";

interface FakeSessionRow {
  id: string;
  child_id: string;
  chat_session_id: string;
  state: string;
  initiated_by: string;
  current_word: string | null;
  current_chosung: string | null;
  current_category: string | null;
  current_difficulty: number;
  hint_level: number;
  recent_words: string[];
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

interface FakeRoundRow {
  session_id: string;
  child_id: string;
  result: string;
  hint_used: number;
  [key: string]: unknown;
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<[string, unknown]> = [];
  private values: Record<string, unknown> | null = null;
  private operation: "select" | "insert" | "update" = "select";
  private rowLimit: number | null = null;

  constructor(
    private readonly store: FakeDb,
    private readonly table: string,
  ) {}

  select(): this {
    return this;
  }

  insert(values: Record<string, unknown>): this {
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(): this {
    return this;
  }

  limit(value: number): this {
    this.rowLimit = value;
    return this;
  }

  maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
    return Promise.resolve(this.execute(true) as { data: T | null; error: null });
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }

  private execute(single: boolean): { data: unknown; error: null } {
    if (this.table === "chosung_game_sessions") {
      const matches = this.store.sessions.filter((row) =>
        this.filters.every(([column, value]) => row[column as keyof FakeSessionRow] === value));
      if (this.operation === "insert" && this.values) {
        const now = new Date().toISOString();
        const row: FakeSessionRow = {
          id: `new-${this.store.sessions.length + 1}`,
          child_id: String(this.values.child_id),
          chat_session_id: String(this.values.chat_session_id),
          state: String(this.values.state),
          initiated_by: String(this.values.initiated_by),
          current_word: null,
          current_chosung: typeof this.values.current_chosung === "string" ? this.values.current_chosung : null,
          current_category: null,
          current_difficulty: Number(this.values.current_difficulty),
          hint_level: 0,
          recent_words: [],
          started_at: now,
          updated_at: now,
          ended_at: null,
        };
        this.store.sessions.push(row);
        return { data: single ? row : [row], error: null };
      }
      if (this.operation === "update" && this.values) {
        for (const row of matches) Object.assign(row, this.values);
      }
      return { data: single ? matches[0] ?? null : matches, error: null };
    }

    if (this.table === "chosung_game_rounds") {
      if (this.operation === "insert" && this.values) {
        this.store.rounds.unshift(this.values as FakeRoundRow);
        return { data: null, error: null };
      }
      let rows = this.store.rounds.filter((row) =>
        this.filters.every(([column, value]) => row[column] === value));
      if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit);
      return { data: rows, error: null };
    }

    return { data: single ? null : [], error: null };
  }
}

class FakeDb {
  sessions: FakeSessionRow[];
  rounds: FakeRoundRow[] = [];

  constructor(sessionRow: FakeSessionRow) {
    this.sessions = [sessionRow];
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

const makeSessionRow = (overrides: Partial<FakeSessionRow> = {}): FakeSessionRow => ({
  id: "session-id",
  child_id: "child-id",
  chat_session_id: "chat-session-id",
  state: "WAITING_FOR_ANSWER",
  initiated_by: "K",
  current_word: "피카츄",
  current_chosung: "ㅍㅋㅊ",
  current_category: "캐릭터",
  current_difficulty: 1,
  hint_level: 0,
  recent_words: ["피카츄"],
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ended_at: null,
  ...overrides,
});

const runTurn = async (db: FakeDb, utterance: string, sessionId = "chat-session-id") => {
  const instructions: string[] = [];
  const result = await handleChosungTurn(db as unknown as SupabaseClient, {
    childId: "child-id",
    sessionId,
    currentUtterance: utterance,
  }, {
    gradePersona: GRADE_PERSONAS[1],
    signals: extractUtteranceSignals(utterance),
    boredom: assessBoredom([utterance]),
    generate: async ({ instruction }) => {
      instructions.push(instruction);
      return { text: "생성 응답", tokenIn: 1, tokenOut: 2 };
    },
  });
  return { result, instructions };
};

const session: ChosungGameSession = {
  id: "session-id",
  childId: "child-id",
  chatSessionId: "chat-session-id",
  state: "HINT",
  initiatedBy: "K",
  currentWord: "피카츄",
  currentChosung: "ㅍㅋㅊ",
  currentCategory: "캐릭터",
  currentDifficulty: 1,
  hintLevel: 1,
  recentWords: ["피카츄"],
  startedAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
  endedAt: null,
};

test("지루함·놀이 신호가 있고 보호 신호가 없을 때만 K가 게임을 제안한다", () => {
  assert.equal(shouldProactivelyOfferChosung({
    currentUtterance: "심심해",
    signals: extractUtteranceSignals("심심해"),
    boredom: assessBoredom(["심심해"]),
  }), true);
  assert.equal(shouldProactivelyOfferChosung({
    currentUtterance: "왜 하늘은 파래?",
    signals: extractUtteranceSignals("왜 하늘은 파래?"),
    boredom: assessBoredom(["몰라", "몰라", "왜 하늘은 파래?"]),
  }), false);
  assert.equal(shouldProactivelyOfferChosung({
    currentUtterance: "나 너무 속상해",
    signals: extractUtteranceSignals("나 너무 속상해"),
    boredom: assessBoredom(["몰라", "몰라", "나 너무 속상해"]),
  }), false);
});

test("힌트 단계별 지시는 정답 공개 여부와 금지 표현을 명시한다", () => {
  const categoryHint = buildHintInstruction(session, 1, "쉬운 특징을 알려주기");
  const meaningHint = buildHintInstruction(session, 2, "쉬운 특징을 알려주기");
  const firstLetterHint = buildHintInstruction(session, 3, "쉬운 특징을 알려주기");

  assert.match(categoryHint, /캐릭터/);
  assert.match(meaningHint, /뜻이나 쓰임/);
  assert.match(firstLetterHint, /첫 글자는 '피'/);
  assert.match(firstLetterHint, /틀렸어/);
  assert.match(firstLetterHint, /실력을 평가/);
});

test("정답이면 correct 라운드를 기록하고 다음 문제로 전이한다", async () => {
  const db = new FakeDb(makeSessionRow());
  const { result, instructions } = await runTurn(db, "피카츄");

  assert.equal(result?.action, "PLAYFUL_GAME_CHOSUNG");
  assert.equal(db.rounds[0]?.result, "correct");
  assert.equal(db.sessions[0].state, "WAITING_FOR_ANSWER");
  assert.notEqual(db.sessions[0].current_word, "피카츄");
  assert.match(instructions[0], /맞혔어/);
});

test("4단계 힌트는 revealed를 기록하고 정답 공개 후 다음 문제로 전이한다", async () => {
  const db = new FakeDb(makeSessionRow({ state: "HINT", hint_level: 3 }));
  const { result, instructions } = await runTurn(db, "힌트");

  assert.equal(result?.action, "PLAYFUL_GAME_CHOSUNG");
  assert.equal(db.rounds[0]?.result, "revealed");
  assert.match(instructions[0], /정답 '피카츄'/);
  assert.equal(db.sessions[0].state, "WAITING_FOR_ANSWER");
});

test("중단 요청은 skip을 기록하고 활성 세션을 종료한다", async () => {
  const db = new FakeDb(makeSessionRow());
  const { result } = await runTurn(db, "다른 거 하자");

  assert.equal(result?.action, "PLAYFUL_GAME_CHOSUNG");
  assert.equal(db.rounds[0]?.result, "skip");
  assert.equal(db.sessions[0].state, "ENDED");
  assert.ok(db.sessions[0].ended_at);
});

test("허용 단어 풀이 비어 있으면 세션을 종료하고 자연스러운 마무리 응답을 반환한다", async () => {
  const db = new FakeDb(makeSessionRow({ current_difficulty: 7 }));
  const instructions: string[] = [];
  const result = await handleChosungTurn(db as unknown as SupabaseClient, {
    childId: "child-id",
    sessionId: "chat-session-id",
    currentUtterance: "피카츄",
  }, {
    gradePersona: {
      ...GRADE_PERSONAS[1],
      chosungGame: { ...GRADE_PERSONAS[1].chosungGame, minDifficulty: 7, maxDifficulty: 7 },
    },
    signals: extractUtteranceSignals("피카츄"),
    boredom: assessBoredom(["피카츄"]),
    generate: async ({ instruction }) => {
      instructions.push(instruction);
      return { text: "여기까지 재밌게 놀았다!", tokenIn: 1, tokenOut: 2 };
    },
  });

  assert.equal(result?.text, "여기까지 재밌게 놀았다!");
  assert.equal(db.sessions[0].state, "ENDED");
  assert.ok(db.sessions[0].ended_at);
  assert.match(instructions[0], /자연스럽고 기분 좋게 마무리/);
});

test("다른 채팅 세션 또는 30분 지난 세션은 종료한 뒤 현재 발화를 신규 A분기로 처리한다", async () => {
  const staleRows = [
    makeSessionRow({ chat_session_id: "old-chat-session" }),
    makeSessionRow({ updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() }),
  ];

  for (const staleRow of staleRows) {
    const db = new FakeDb(staleRow);
    const { result } = await runTurn(db, "안녕");
    assert.equal(result, null);
    assert.equal(db.sessions[0].state, "ENDED");
    assert.ok(db.sessions[0].ended_at);
    assert.equal(db.rounds.length, 0);
  }
});

test("세션 TTL 경계와 채팅 세션 불일치를 결정론적으로 판정한다", () => {
  const current = { ...session, updatedAt: "2026-08-13T00:00:00.000Z" };
  assert.equal(isExpiredOrDifferentChatSession(current, "different", Date.parse("2026-08-13T00:01:00.000Z")), true);
  assert.equal(isExpiredOrDifferentChatSession(current, current.chatSessionId, Date.parse("2026-08-13T00:29:59.000Z")), false);
  assert.equal(isExpiredOrDifferentChatSession(current, current.chatSessionId, Date.parse("2026-08-13T00:30:00.000Z")), true);
});
