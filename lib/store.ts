// lib/store.ts
// 데모 스토어 — localStorage 기반 단일 상태 소스
// SUPABASE_SWITCH: 각 write 헬퍼 상단 TODO 주석 위치에서 Supabase API 호출로 교체

export const STORE_KEY = "k_store_v1";
export const STORE_EVENT = "k_store_change";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface StoreChild {
  id: string;
  name: string;
  grade: string;
  interests: string[];
}

export interface StoreQuestion {
  id: string;
  childId: string;
  text: string;
  status: "대기중" | "전달됨" | "중지됨";
  deliveredCount: number;
  createdAt: string;
}

export interface StoreMission {
  id: number;
  title: string;
  desc: string;
  emoji: string;
  completed: boolean;
  isMoodRating?: boolean;
}

export interface StoreNotifSettings {
  reportAlert: boolean;
  emotionAlert: boolean;
  weeklySummary: boolean;
}

export interface StoreNotif {
  id: string;
  read: boolean;
  level: "safe" | "warning" | "danger";
  title: string;
  body: string;
  time: string;
  hasExpertCTA?: boolean;
}

export interface StoreData {
  activeFamilyId: string | null;
  familyName: string | null;
  activeChildId: string | null;
  children: StoreChild[];
  questions: StoreQuestion[];
  missions: StoreMission[];
  moodScore: number | null;
  notifSettings: StoreNotifSettings;
  notifications: StoreNotif[];
}

// ── 기본값 ────────────────────────────────────────────────────────────────────

export const DEFAULT_MISSIONS: StoreMission[] = [
  { id: 1, title: "케이와 오늘 인사하기", desc: "마이크를 눌러 오늘 얘기를 들려줘", completed: false, emoji: "👋" },
  { id: 2, title: "물 한 컵 마시고 5분 스트레칭", desc: "몸을 가볍게 풀어보자", completed: false, emoji: "💧" },
  { id: 3, title: "오늘 고마웠던 사람 떠올리기", desc: "마음 속으로만 생각해도 돼", completed: false, emoji: "💛" },
  { id: 4, title: "케이와 오늘 1분 대화", desc: "짧아도 괜찮아, 오늘 하루 어땠는지 말해봐", completed: false, emoji: "💬" },
  { id: 5, title: "오늘 기분 별점 남기기", desc: "오늘 기분을 별점으로 표현해봐", completed: false, emoji: "⭐", isMoodRating: true },
];

const normalizeMissionPolicyText = (mission: StoreMission): StoreMission => {
  if (mission.title === "케이와 하교 후 인사하기") {
    return { ...mission, title: "케이와 오늘 인사하기", desc: "마이크를 눌러 오늘 얘기를 들려줘" };
  }
  if (mission.title === "잠들기 전 케이와 1분 대화") {
    return { ...mission, title: "케이와 오늘 1분 대화", emoji: "💬" };
  }
  return mission;
};

const DEFAULT_STORE: StoreData = {
  activeFamilyId: null,
  familyName: null,
  activeChildId: null,
  children: [],
  questions: [],
  missions: DEFAULT_MISSIONS,
  moodScore: null,
  notifSettings: { reportAlert: true, emotionAlert: true, weeklySummary: false },
  notifications: [],
};

// ── 핵심 get/set ───────────────────────────────────────────────────────────────

export function getStore(): StoreData {
  if (typeof window === "undefined") return { ...DEFAULT_STORE };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_STORE };
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return {
      ...DEFAULT_STORE,
      ...parsed,
      missions: parsed.missions?.length
        ? parsed.missions.map(normalizeMissionPolicyText)
        : DEFAULT_MISSIONS,
      notifications: parsed.notifications ?? [],
      notifSettings: { ...DEFAULT_STORE.notifSettings, ...(parsed.notifSettings ?? {}) },
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

export function setStore(partial: Partial<StoreData>): void {
  if (typeof window === "undefined") return;
  const next = { ...getStore(), ...partial };
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(STORE_EVENT));
}

export function clearStore(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem("k_child_id");
  localStorage.removeItem("k_session_id");
  localStorage.removeItem("k_family_id");
  localStorage.removeItem("k_question_statuses");

  if ("caches" in window) {
    caches.keys().then((names) => {
      names.forEach((name) => {
        if (!name.startsWith("kbestie-shell-")) {
          caches.delete(name).catch(() => {});
        }
      });
    }).catch(() => {});
  }

  window.dispatchEvent(new Event(STORE_EVENT));
}

// ── 아이 ──────────────────────────────────────────────────────────────────────

/** 로그인 후 DB에서 아이 목록을 store에 동기화 */
export async function syncChildrenFromDB(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    // 1. 내 가족 목록 조회
    const famsRes = await fetch("/api/families");
    if (!famsRes.ok) return;
    const { families } = (await famsRes.json()) as {
      families: Array<{
        family_id: string;
        role: string;
        families: { id: string; name: string; created_at: string };
      }>;
    };

    if (!Array.isArray(families) || families.length === 0) {
      // 가족이 없으면 스토어를 빈 상태로 초기화
      setStore({
        activeFamilyId: null,
        familyName: null,
        children: [],
        activeChildId: null,
      });
      localStorage.removeItem("k_family_id");
      localStorage.removeItem("k_child_id");
      return;
    }

    type FamilyDetail = {
      id: string;
      name: string;
      child_profiles: Array<{
        id: string;
        name: string;
        grade: string;
        interests: string[];
        created_at: string;
      }>;
    };

    if (families.length > 1) {
      console.warn("예상치 못한 다중 가족 멤버십");
    }

    const activeFamily = families[0];
    const famDetailRes = await fetch(`/api/families/${activeFamily.family_id}`);
    if (!famDetailRes.ok) return;
    const { family } = (await famDetailRes.json()) as { family: FamilyDetail };
    if (!family) return;

    const familyId = activeFamily.family_id;
    const familyName = activeFamily.families?.name ?? family.name ?? "";

    const children: StoreChild[] = (family.child_profiles ?? []).map((cp) => ({
      id: cp.id,
      name: cp.name,
      grade: cp.grade,
      interests: cp.interests,
    }));

    const store = getStore();

    // activeChildId 결정
    const currentActive = store.activeChildId;
    const activeChildId =
      currentActive &&
      !currentActive.startsWith("demo-") &&
      children.find((c) => c.id === currentActive)
        ? currentActive
        : children[0]?.id ?? null;

    // demo→real 전환 감지
    const currentChildId = localStorage.getItem("k_child_id");
    const isTransitioningFromDemo =
      !currentChildId || currentChildId.startsWith("demo-");

    setStore({
      activeFamilyId: familyId,
      familyName: familyName,
      children,
      activeChildId,
      ...(isTransitioningFromDemo
        ? { missions: DEFAULT_MISSIONS, moodScore: null }
        : {}),
    });

    localStorage.setItem("k_family_id", familyId);
    if (activeChildId && isTransitioningFromDemo) {
      localStorage.setItem("k_child_id", activeChildId);
    }
  } catch {}
}

export function registerChild(child: StoreChild): void {
  // TODO [SUPABASE_SWITCH]: 이미 /api/child/register로 DB 저장됨. 스토어는 로컬 캐시 역할.
  const store = getStore();
  const exists = store.children.find((c) => c.id === child.id);
  const children = exists
    ? store.children.map((c) => (c.id === child.id ? child : c))
    : [...store.children, child];
  setStore({ children, activeChildId: child.id });
}

export function updateChild(id: string, partial: Partial<Omit<StoreChild, "id">>): void {
  const store = getStore();
  setStore({
    children: store.children.map((c) => (c.id === id ? { ...c, ...partial } : c)),
  });
  // DB 백그라운드 동기화 (데모 ID 제외)
  if (!id.startsWith("demo-")) {
    fetch(`/api/child/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    }).catch(() => {});
  }
}

export function removeChild(id: string): void {
  const store = getStore();
  const children = store.children.filter((c) => c.id !== id);
  const nextActiveId = store.activeChildId === id
    ? (children[0]?.id ?? null)
    : store.activeChildId;
  // k_child_id 동기화
  if (store.activeChildId === id) {
    if (nextActiveId) {
      localStorage.setItem("k_child_id", nextActiveId);
    } else {
      localStorage.removeItem("k_child_id");
    }
  }
  setStore({ children, activeChildId: nextActiveId });
  // DB 백그라운드 동기화 (데모 ID 제외)
  if (!id.startsWith("demo-")) {
    fetch(`/api/child/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }
}

// ── 질문 ──────────────────────────────────────────────────────────────────────

export function addLocalQuestion(childId: string, text: string): StoreQuestion {
  // TODO [SUPABASE_SWITCH]: POST /api/parent/questions 결과를 스토어에도 저장
  const q: StoreQuestion = {
    id: `local-q-${Date.now()}`,
    childId,
    text,
    status: "대기중",
    deliveredCount: 0,
    createdAt: new Date().toISOString(),
  };
  const store = getStore();
  setStore({ questions: [...store.questions, q] });
  return q;
}

export function stopLocalQuestion(id: string): void {
  // TODO [SUPABASE_SWITCH]: PATCH /api/parent/questions/{id}
  const store = getStore();
  setStore({
    questions: store.questions.map((q) =>
      q.id === id ? { ...q, status: "중지됨" } : q
    ),
  });
}

export function getQuestionsForChild(childId: string): StoreQuestion[] {
  return getStore().questions.filter((q) => q.childId === childId);
}

// ── 미션 ──────────────────────────────────────────────────────────────────────

export function toggleMission(id: number): void {
  const store = getStore();
  setStore({
    missions: store.missions.map((m) =>
      m.id === id ? { ...m, completed: !m.completed } : m
    ),
  });
}

export function setMoodScore(score: number): void {
  // TODO [SUPABASE_SWITCH]: 대화 세션의 mood_score 업데이트 (POST /api/chat/mood 등)
  const store = getStore();
  setStore({
    moodScore: score,
    missions: store.missions.map((m) =>
      m.isMoodRating ? { ...m, completed: true } : m
    ),
  });
}

// ── 알림 ──────────────────────────────────────────────────────────────────────

export function markNotifRead(id: string): void {
  const store = getStore();
  setStore({
    notifications: store.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n
    ),
  });
}

export function markAllNotifsRead(): void {
  const store = getStore();
  setStore({
    notifications: store.notifications.map((n) => ({ ...n, read: true })),
  });
}

export function unreadCount(store: StoreData): number {
  return store.notifications.filter((n) => !n.read).length;
}

// ── 설정 ──────────────────────────────────────────────────────────────────────

export function setNotifSetting(
  key: keyof StoreNotifSettings,
  value: boolean
): void {
  const store = getStore();
  setStore({ notifSettings: { ...store.notifSettings, [key]: value } });
}
