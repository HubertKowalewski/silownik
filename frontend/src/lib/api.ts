// Klient HTTP do Django REST: sesja + CSRF, jednolita obsługa błędów, typy danych.

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Tekst błędu do pokazania użytkownikowi (ApiError, błąd sieci lub dowolny wyjątek). */
export function errorText(e: unknown, fallback = "Coś poszło nie tak."): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function firstErrorMessage(data: any): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return firstErrorMessage(data[0]);
  if (data.detail) return String(data.detail);
  if (data.non_field_errors) return String(data.non_field_errors[0]);
  const key = Object.keys(data)[0];
  if (!key) return null;
  const val = data[key];
  if (typeof val === "object" && !Array.isArray(val)) return firstErrorMessage(val);
  return Array.isArray(val) ? firstErrorMessage(val[0]) ?? String(val[0]) : String(val);
}

// --- wolna odpowiedź serwera --------------------------------------------------------
// Darmowy hosting usypia aplikację po kilkunastu minutach bez ruchu; pierwsze żądanie po przerwie
// może trwać do ok. minuty. Gdy jakieś żądanie trwa dłużej niż SLOW_MS, aplikacja pokazuje komunikat.
const SLOW_MS = 3500;
let inFlight = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let slow = false;
const slowListeners = new Set<(slow: boolean) => void>();
function setSlow(value: boolean) {
  if (slow === value) return;
  slow = value;
  slowListeners.forEach((fn) => fn(value));
}
/** Subskrypcja stanu „serwer odpowiada wolno”; zwraca funkcję wypisania. */
export function onServerSlow(fn: (slow: boolean) => void) {
  slowListeners.add(fn);
  return () => { slowListeners.delete(fn); };
}
function tracked<T>(promise: Promise<T>): Promise<T> {
  if (++inFlight === 1) slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
  return promise.finally(() => {
    if (--inFlight === 0) {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    let token = getCookie("csrftoken");
    if (!token) {
      await tracked(fetch("/api/auth/csrf/", { credentials: "same-origin" }));
      token = getCookie("csrftoken");
    }
    if (token) headers["X-CSRFToken"] = token;
  }
  const response = await tracked(fetch(path, { ...options, method, headers, credentials: "same-origin" }));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new ApiError(response.status, firstErrorMessage(data) ?? `Błąd ${response.status}`, data);
  }
  return data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body !== undefined ? JSON.stringify(body) : undefined }),
};

// DRF może zwracać paginację - normalizujemy do tablicy.
export function asList<T>(data: any): T[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

export function uuid(): string {
  if (crypto && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// --- Typy ---------------------------------------------------------------

export type User = { id: number; username: string; email: string; first_name: string; is_staff: boolean };
export type Option = { value: string; label: string };
export type BodyArea = { id: number; code: string; name: string };
export type Meta = {
  equipment: Option[];
  goals: Option[];
  levels: Option[];
  load_types: Option[];
  test_protocols: Option[];
  body_areas: BodyArea[];
  muscle_groups: string[];
};

export type Exercise = {
  id: number;
  name: string;
  muscle_group: string;
  secondary_muscles?: string;
  equipment: string;
  description?: string;
  stressed_areas: number[];
  is_custom?: boolean;
  times_used?: number;
};

export type PlanTemplate = {
  key: string;
  title: string;
  description: string;
  goal: string;
  level: string;
  days_per_week: number;
  duration_weeks: number;
  equipment: string[];
  days: { name: string; exercises: number }[];
};

export type Profile = {
  birth_year: number | null;
  sex: string;
  height_cm: number | null;
  level: string;
  goal: string;
  days_per_week: number;
  equipment: string[];
  load_increment: number;
  default_rest_seconds: number;
  rest_step_seconds: number;
  rest_auto_start: boolean;
  rest_sound: boolean;
  rest_vibrate: boolean;
  effort_scale: "reps" | "rir" | "rpe";
  profile_public: boolean;
  trainings_public: boolean;
  health_consent: boolean;
  health_consent_date: string | null;
  restrictions: number[];
  health_notes: string;
};

export type LoadType = "percent" | "rpe" | "kg";

export type PlanExercise = {
  id?: number;
  exercise: number;
  exercise_name?: string;
  muscle_group?: string;
  order: number;
  target_sets: number;
  target_reps: number;
  target_reps_max?: number | null;
  target_rir?: number | null;
  load_type: LoadType;
  load_value: number;
  rest_seconds: number;
  notes: string;
  calculated_weight?: number | null;
  needs_calibration?: boolean;
};

export type PlanDay = { id?: number; week: number; order: number; name: string; exercises: PlanExercise[] };

export type WorkoutPlan = {
  id: number;
  title: string;
  description: string;
  is_public: boolean;
  goal: string;
  level: string;
  days_per_week: number;
  duration_weeks: number;
  required_equipment: string[];
  creator_name: string;
  parent_plan: number | null;
  parent_title: string | null;
  parent_creator: string | null;
  share_progress_with_author: boolean;
  created_at: string;
  updated_at: string;
  days: PlanDay[];
  fork_count: number;
  exercise_count: number;
  comment_count: number;
  is_owner: boolean;
  is_hidden?: boolean;
  match_score?: number;
  match_reasons?: string[];
  health_warnings?: number;
};

export type Substitute = { id: number; name: string; equipment: string };
export type HealthWarning = {
  plan_exercise_id: number;
  exercise_id: number;
  exercise_name: string;
  areas: string[];
  substitutes: Substitute[];
};
export type Match = { score: number; reasons: string[]; warnings: HealthWarning[] };

export type ScaledItem = {
  plan_exercise_id: number;
  day_name: string;
  week: number;
  exercise_id: number;
  exercise_name: string;
  substituted: boolean;
  sets: number;
  reps: number;
  load_type: LoadType;
  load_value: number;
  user_1rm: number;
  suggested_weight: number | null;
  needs_calibration: boolean;
  based_on: string;
};

export type PlanComment = {
  id: number;
  plan: number;
  author_name: string;
  is_plan_author: boolean;
  parent: number | null;
  text: string;
  created_at: string;
};

export type Follower = {
  username: string;
  forked_at: string;
  shares_progress: boolean;
  sessions?: number;
  last_session?: string | null;
  progress?: { exercise: string; current_1rm: number }[];
};

export type LoggedSet = {
  exercise: number;
  set_number: number;
  weight: number;
  reps: number;
  rpe: number | null;
  rir?: number | null;
  is_warmup?: boolean;
};

export type SessionPayload = {
  client_uuid: string;
  plan: number | null;
  plan_day: number | null;
  date_completed: string;
  notes: string;
  post_workout_hr: number | null;
  duration_seconds: number | null;
  sets: LoggedSet[];
};

export type Session = Omit<SessionPayload, "client_uuid" | "sets"> & {
  id: number;
  client_uuid: string | null;
  plan_title: string | null;
  day_name: string | null;
  total_tonnage: number;
  sets: (LoggedSet & { id: number; exercise_name: string })[];
};

export type Suggestion = {
  action: "increase" | "keep" | "decrease" | "start";
  weight: number | null;
  reps_min: number;
  reps_max: number;
  target_rir: number | null;
  reason: string;
  based_on: string | null;
};
export type RepRecord = { reps: number; weight: number; date: string };
export type NewRepRecord = { exercise_id: number; exercise: string; reps: number; weight: number; previous: number | null };
export type Goal = {
  id: number;
  exercise: number;
  exercise_name: string;
  target_1rm: number;
  deadline: string | null;
  start_1rm: number;
  created_at: string;
  achieved_at: string | null;
  status: {
    current_1rm: number;
    source: string;
    progress_percent: number;
    weekly_trend: number | null;
    predicted_date: string | null;
    on_track: boolean | null;
    message: string;
  };
};
export type PlanComparison = {
  plan_day: string;
  completion_percent: number | null;
  items: { exercise: string; status: "done" | "partial" | "skipped" | "added"; planned: string; done: string }[];
};
export type ImportResult = {
  format: string;
  sessions_created: number;
  sessions_skipped_duplicates: number;
  sets_created: number;
  rows_skipped: number;
  exercises_created: string[];
};

export type NewRecord = { exercise_id: number; exercise: string; previous: number; current: number };
export type OneRepMaxRecord = {
  exercise_id: number;
  exercise: string;
  value: number;
  source: string;
  best_weight: number;
  updated_at: string;
};

export type Measurement = {
  id?: number;
  client_uuid?: string;
  measured_at?: string;
  body_weight: number | null;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  arm: number | null;
  thigh: number | null;
  resting_hr: number | null;
};

export type StrengthTest = {
  id?: number;
  client_uuid?: string;
  exercise: number;
  exercise_name?: string;
  protocol: string;
  protocol_name?: string;
  weight: number;
  reps: number;
  estimated_1rm?: number;
  performed_at?: string;
};

export type PublicProfile = {
  username: string;
  member_since: string;
  level: string;
  goal: string;
  is_own: boolean;
  profile_public: boolean;
  trainings_public: boolean;
  plans: WorkoutPlan[];
  trainings: null | {
    total_sessions: number;
    sessions_30_days: number;
    weekly_tonnage: { week: string; tonnage: number }[];
    records: { exercise: string; e1rm: number }[];
  };
};

export type Notification = { id: number; text: string; url: string; is_read: boolean; created_at: string };

export type Stats = {
  weeklyTonnage: { week: string; tonnage: number }[];
  monthlyTonnage: { month: string; tonnage: number }[];
  muscleSplit: { group: string; tonnage: number; percent: number }[];
  personalRecords: { exercise_id: number; exercise: string; e1rm: number; source: string; best_weight: number; total_sets: number }[];
  progression: { week: string; weight: number; e1rm: number | null }[];
  prediction: { week: string; predicted: number }[];
  relativeStrength: number | null;
  effort: {
    total_sets: number;
    rated_sets: number;
    avg_rir: number | null;
    to_failure_percent: number | null;
    distribution: { rir: string; sets: number; percent: number }[];
    weekly: { week: string; avg_rir: number; sets: number }[];
    by_exercise: { exercise: string; avg_rir: number; sets: number }[];
  };
  load: {
    acute_tonnage: number;
    chronic_weekly_tonnage: number;
    acwr: number | null;
    zone: "low" | "optimal" | "elevated" | "high" | null;
    zone_text: string;
    streak_weeks: number;
    sessions_per_week_4w: number;
    target_per_week: number | null;
    calendar: { date: string; sessions: number; tonnage: number }[];
  };
  repRecords: RepRecord[];
  measurements: {
    date: string;
    body_weight: number | null;
    waist: number | null;
    chest: number | null;
    arm: number | null;
    thigh: number | null;
    hips: number | null;
    resting_hr: number | null;
  }[];
};

// --- Endpointy ----------------------------------------------------------

export const authApi = {
  me: () => api.get<User | null>("/api/auth/me/"),
  login: (username: string, password: string) => api.post<User>("/api/auth/login/", { username, password }),
  register: (payload: { username: string; email: string; password: string; password2: string }) =>
    api.post<User>("/api/auth/register/", payload),
  logout: () => api.post<void>("/api/auth/logout/"),
  deleteAccount: (password: string) => api.delete<void>("/api/auth/me/", { password }),
  updateAccount: (payload: { email: string }) => api.patch<User>("/api/auth/me/", payload),
  changePassword: (payload: { old_password: string; new_password: string; new_password2: string }) =>
    api.post<{ detail: string }>("/api/auth/password/", payload),
  requestPasswordReset: (email: string) => api.post<{ detail: string }>("/api/auth/password-reset/", { email }),
  confirmPasswordReset: (payload: { uid: string; token: string; password: string; password2: string }) =>
    api.post<{ detail: string }>("/api/auth/password-reset/confirm/", payload),
};

/** Raport okresowy (GET /api/reports/) - pola wykorzystywane w interfejsie. */
export type PeriodReport = {
  date_from: string; date_to: string; weeks: number; sessions: number; total_sets: number; total_tonnage: number;
  avg_duration_min: number | null; sessions_per_week: number; plan: string | null;
  comparison: { metric: string; current: number; previous: number; change_percent: number | null }[];
  planned_sessions: number; completed_plan_sessions: number;
  adherence_percent: number | null; avg_plan_completion_percent: number | null;
  session_list: { date: string; name: string; duration_min: number | null; sets: number; tonnage: number;
    completion_percent: number | null }[];
  weekly: { week: string; tonnage: number; sets: number }[];
  muscle_split: { group: string; tonnage: number; sets: number; hard_sets_per_week: number }[];
  progress: { exercise: string; start_1rm: number; best_1rm: number; change: number; record: boolean; sets: number }[];
  rep_records: { exercise: string; exercise_id: number; reps: number; weight: number; previous: number | null }[];
};

/** Zgłoszenie w panelu moderatora (GET /api/moderation/reports/). */
export type ModerationReport = {
  id: number; kind: "plan" | "comment"; reason: string; reporter: string; created_at: string;
  reports_count: number; target_id: number; plan_id: number; title: string; content: string;
  author: string; author_id: number; author_blocked: boolean; author_is_staff: boolean; is_hidden: boolean;
  decision: "" | "hidden" | "dismissed" | "restored"; moderator_note: string;
  resolved_by: string | null; resolved_at: string | null;
};
export type ModerationDecision = "hidden" | "dismissed" | "restored";

/** Kwestionariusz SUS (WN-10). */
export type SusResponse = { answers: number[]; score: number; comment: string; created_at: string };
export type SusSummary = {
  count: number; mean: number | null; stdev: number | null; min: number | null; max: number | null;
  target: number; target_met: boolean; per_question: number[];
  responses: { user: string; score: number; answers: number[]; comment: string; date: string }[];
};

/** Asystent tworzenia planu (POST /api/plan-assistant/). */
export type AssistantSplit = { key: string; name: string; description: string; days: string[]; days_per_week: number };
export type AssistantCandidate = { id: number; name: string; equipment: string; tags: string[] };
export type AssistantSlot = {
  key: string; label: string; hint: string; kind: "main" | "secondary" | "accessory";
  sets: number; reps_min: number; reps_max: number; rir: number; rest: number;
  enabled: boolean; optional: boolean; default: number | null; candidates: AssistantCandidate[];
};
export type AssistantSuggestion = {
  split: string; name: string; days_per_week: number; goal: string; health_filtered: boolean;
  days: { name: string; slots: AssistantSlot[] }[];
};

let metaCache: Promise<Meta> | null = null;
let exerciseCache: Promise<Exercise[]> | null = null;

export const trainingApi = {
  meta: () => (metaCache ??= api.get<Meta>("/api/meta/").catch((e) => ((metaCache = null), Promise.reject(e)))),
  exercises: () =>
    (exerciseCache ??= api
      .get<any>("/api/exercises/")
      .then((d) => asList<Exercise>(d))
      .catch((e) => ((exerciseCache = null), Promise.reject(e)))),
  resetExercises: () => (exerciseCache = null),
  createExercise: (payload: Partial<Exercise>) => api.post<Exercise>("/api/exercises/", payload),

  profile: () => api.get<Profile>("/api/profile/"),
  saveProfile: (payload: Partial<Profile>) => api.put<Profile>("/api/profile/", payload),

  dashboard: () => api.get<any>("/api/dashboard/"),
  stats: (weeks = 12, exerciseId?: number) =>
    api.get<Stats>(`/api/stats/?weeks=${weeks}${exerciseId ? `&exercise=${exerciseId}` : ""}`),
  report: (from: string, to: string) => api.get<PeriodReport>(`/api/reports/?from=${from}&to=${to}`),
  reportUrl: (from: string, to: string, format: "csv" | "pdf") =>
    `/api/reports/?from=${from}&to=${to}&export=${format}`,

  lastForExercise: (exerciseId: number, range?: { reps_min: number; reps_max?: number | null; rir?: number | null }) =>
    api.get<{
      estimated_1rm: number;
      source: string;
      note: string;
      rep_records: RepRecord[];
      suggestion: Suggestion | null;
      last_sets: { weight: number; reps: number; rpe: number | null; rir: number | null; date: string }[];
    }>(`/api/sessions/last-for-exercise/${exerciseId}/${range ? `?reps_min=${range.reps_min}${range.reps_max ? `&reps_max=${range.reps_max}` : ""}${range.rir != null ? `&rir=${range.rir}` : ""}` : ""}`),
  planSuggestions: (planId: number, dayId?: number | null) =>
    api.get<Record<string, Suggestion>>(`/api/plans/${planId}/suggestions/${dayId ? `?day=${dayId}` : ""}`),
  substitutes: (exerciseId: number) => api.get<Substitute[]>(`/api/exercises/${exerciseId}/substitutes/`),
  saveNote: (exerciseId: number, text: string) => api.put<{ text: string }>(`/api/exercises/${exerciseId}/note/`, { text }),
  compareSession: (id: number) => api.get<PlanComparison>(`/api/sessions/${id}/compare/`),
  duplicatePlan: (id: number) => api.post<WorkoutPlan>(`/api/plans/${id}/duplicate/`),
  planAssistant: () =>
    api.get<{ recommended: string; reason: string; splits: AssistantSplit[] }>("/api/plan-assistant/"),
  planAssistantSuggest: (split: string) => api.post<AssistantSuggestion>("/api/plan-assistant/", { split }),
  planTemplates: () => api.get<{ templates: PlanTemplate[]; recommended: string; reason: string }>("/api/plan-templates/"),
  createFromTemplate: (key: string, adapt = true) =>
    api.post<{ template: string; reason: string | null; plan: WorkoutPlan;
      changes: { day: string; from: string; to: string; reason: string }[] }>(`/api/plan-templates/${key}/`, { adapt }),
  goals: () => api.get<Goal[]>("/api/goals/"),
  createGoal: (payload: { exercise: number; target_1rm: number; deadline: string | null }) => api.post<Goal>("/api/goals/", payload),
  deleteGoal: (id: number) => api.delete<void>(`/api/goals/${id}/`),
  importCsv: async (file: File) => {
    // wysyłka pliku (multipart) - poza wspólnym klientem JSON
    await fetch("/api/auth/csrf/", { credentials: "same-origin" });
    const token = document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? "";
    const body = new FormData();
    body.append("file", file);
    const r = await fetch("/api/import/", { method: "POST", body, credentials: "same-origin", headers: { "X-CSRFToken": token } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, data.detail ?? `Błąd ${r.status}`, data);
    return data as ImportResult;
  },
  saveSession: (payload: SessionPayload) =>
    api.post<Session & { new_records: NewRecord[]; rep_records: NewRepRecord[] }>("/api/sessions/", payload),
  updateSession: (id: number, payload: Partial<SessionPayload>) =>
    api.put<Session & { new_records: NewRecord[]; rep_records: NewRepRecord[] }>(`/api/sessions/${id}/`, payload),
  deleteSession: (id: number) => api.delete<void>(`/api/sessions/${id}/`),
  session: (id: number) => api.get<Session>(`/api/sessions/${id}/`),
  sessions: (page = 1) =>
    api.get<{ count: number; next: string | null; results: Session[] }>(`/api/sessions/?page=${page}`),
  sessionToPlan: (id: number, title: string) => api.post<WorkoutPlan>(`/api/sessions/${id}/to-plan/`, { title }),
  records: () => api.get<OneRepMaxRecord[]>("/api/one-rep-max/"),

  measurements: () => api.get<any>("/api/measurements/").then((d) => asList<Measurement>(d)),
  saveMeasurement: (payload: Measurement) => api.post<Measurement>("/api/measurements/", payload),
  deleteMeasurement: (id: number) => api.delete<void>(`/api/measurements/${id}/`),
  tests: () => api.get<any>("/api/tests/").then((d) => asList<StrengthTest>(d)),
  saveTest: (payload: StrengthTest) => api.post<StrengthTest>("/api/tests/", payload),
  deleteTest: (id: number) => api.delete<void>(`/api/tests/${id}/`),
  setOneRepMax: (exercise: number, value: number) => api.post<any>("/api/one-rep-max/", { exercise, value }),

  plans: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api.get<any>(`/api/plans/${qs ? `?${qs}` : ""}`).then((d) => asList<WorkoutPlan>(d));
  },
  recommended: () => api.get<WorkoutPlan[]>("/api/plans/recommended/"),
  plan: (id: number) => api.get<WorkoutPlan>(`/api/plans/${id}/`),
  createPlan: (payload: Partial<WorkoutPlan>) => api.post<WorkoutPlan>("/api/plans/", payload),
  updatePlan: (id: number, payload: Partial<WorkoutPlan>) => api.put<WorkoutPlan>(`/api/plans/${id}/`, payload),
  deletePlan: (id: number) => api.delete<void>(`/api/plans/${id}/`),
  match: (id: number) => api.get<Match>(`/api/plans/${id}/match/`),
  forkPreview: (id: number) => api.get<Match & { items: ScaledItem[] }>(`/api/plans/${id}/fork-preview/`),
  forkPlan: (id: number, payload: { substitutions: Record<string, number>; share_progress: boolean }) =>
    api.post<{ forked_plan_id: number; scaled_exercises_data: ScaledItem[] }>(`/api/plans/${id}/fork/`, payload),
  recalculate: (id: number) => api.post<WorkoutPlan>(`/api/plans/${id}/recalculate/`),
  shareProgress: (id: number, value: boolean) => api.patch<any>(`/api/plans/${id}/share-progress/`, { value }),
  comments: (id: number) =>
    api.get<{ plan_id: number; plan_title: string; comments: PlanComment[] }>(`/api/plans/${id}/comments/`),
  addComment: (id: number, text: string, parent: number | null = null) =>
    api.post<PlanComment>(`/api/plans/${id}/comments/`, { text, parent }),
  followers: (id: number) => api.get<Follower[]>(`/api/plans/${id}/followers/`),
  flagPlan: (id: number, reason: string) => api.post<{ detail: string }>(`/api/plans/${id}/flag/`, { reason }),
  flagComment: (id: number, reason: string) => api.post<{ detail: string }>(`/api/comments/${id}/flag/`, { reason }),

  sus: () => api.get<SusResponse | null>("/api/sus/"),
  saveSus: (answers: number[], comment: string) => api.post<SusResponse>("/api/sus/", { answers, comment }),
  susSummary: () => api.get<SusSummary>("/api/sus/summary/"),

  moderationReports: (status: "open" | "closed") =>
    api.get<{ open_count: number; reports: ModerationReport[] }>(`/api/moderation/reports/?status=${status}`),
  moderationDecide: (id: number, decision: ModerationDecision, note = "") =>
    api.post<{ detail: string; closed_reports: number; open_count: number }>(
      `/api/moderation/reports/${id}/decision/`, { decision, note }),
  moderationBlock: (userId: number, blocked: boolean) =>
    api.post<{ detail: string; blocked: boolean }>(`/api/moderation/users/${userId}/block/`, { blocked }),

  publicProfile: (username: string) => api.get<PublicProfile>(`/api/users/${encodeURIComponent(username)}/`),
  notifications: () => api.get<Notification[]>("/api/notifications/"),
  readNotifications: () => api.post<void>("/api/notifications/read/"),
};

export function label(options: Option[] | undefined, value: string): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}

export function loadText(pe: { load_type: LoadType; load_value: number }): string {
  if (pe.load_type === "percent") return `${pe.load_value}% 1RM`;
  if (pe.load_type === "rpe") return `RPE ${pe.load_value}`;
  return `${pe.load_value} kg`;
}
