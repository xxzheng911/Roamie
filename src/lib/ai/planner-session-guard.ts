const activePlannerSessions = new Set<string>();
const completedPlannerSessions = new Map<string, number>();
const activePlannerRuns = new Set<string>();
const completedPlannerRuns = new Map<string, number>();

export function buildPlannerRunKey(params: {
  sessionId?: string;
  style: string;
  days: number;
  poolFingerprint: string;
}): string {
  const sid = params.sessionId?.trim() || "anon";
  return `${sid}|${params.style}|${params.days}|${params.poolFingerprint}`;
}

export function buildCandidatePoolFingerprint(places: { id?: string | null; name?: string | null }[]): string {
  const keys = places
    .map((place) => (place.id ?? place.name ?? "").trim())
    .filter(Boolean)
    .sort()
    .slice(0, 48);
  if (!keys.length) return "empty";
  let hash = 0;
  const blob = keys.join("|");
  for (let i = 0; i < blob.length; i += 1) {
    hash = (hash * 31 + blob.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function beginPlannerRun(runKey: string): boolean {
  if (completedPlannerRuns.has(runKey)) {
    console.warn("[PLANNER_SKIP_DUPLICATE]", `runKey=${runKey}`, "reason=already_completed");
    return false;
  }
  if (activePlannerRuns.has(runKey)) {
    console.warn("[PLANNER_SKIP_DUPLICATE]", `runKey=${runKey}`, "reason=already_running");
    return false;
  }
  activePlannerRuns.add(runKey);
  return true;
}

export function finishPlannerRun(runKey: string, itemCount: number): void {
  activePlannerRuns.delete(runKey);
  completedPlannerRuns.set(runKey, itemCount);
}

export function resetPlannerRun(runKey: string): void {
  activePlannerRuns.delete(runKey);
  completedPlannerRuns.delete(runKey);
}

type PipelineStageEntry = {
  completed: boolean;
  retryCount: number;
  lastReason?: string;
};

const pipelineStagesBySession = new Map<string, Map<string, PipelineStageEntry>>();

const MAX_PIPELINE_STAGE_RETRIES = 5;

export function beginPipelineStage(
  sessionId: string | undefined,
  stage: string,
  options?: { retry?: boolean; reason?: string },
): boolean {
  if (!sessionId?.trim()) return true;

  const sid = sessionId.trim();
  let stages = pipelineStagesBySession.get(sid);
  if (!stages) {
    stages = new Map();
    pipelineStagesBySession.set(sid, stages);
  }

  const existing = stages.get(stage);
  if (!existing) {
    stages.set(stage, { completed: false, retryCount: 0, lastReason: options?.reason });
    return true;
  }

  if (options?.retry) {
    if (existing.retryCount >= MAX_PIPELINE_STAGE_RETRIES) {
      console.warn(
        "[PIPELINE_STAGE_SKIP]",
        `sessionId=${sid}`,
        `stage=${stage}`,
        `reason=max_retries`,
        `retries=${existing.retryCount}`,
      );
      return false;
    }
    existing.retryCount += 1;
    existing.lastReason = options.reason;
    console.warn(
      "[PIPELINE_STAGE_RETRY]",
      `sessionId=${sid}`,
      `stage=${stage}`,
      `retry=${existing.retryCount}`,
      options.reason ? `reason=${options.reason}` : "",
    );
    return true;
  }

  if (existing.completed) {
    console.warn(
      "[PIPELINE_STAGE_SKIP]",
      `sessionId=${sid}`,
      `stage=${stage}`,
      "reason=already_completed",
    );
    return false;
  }

  return true;
}

export function finishPipelineStage(sessionId: string | undefined, stage: string): void {
  if (!sessionId?.trim()) return;
  const stages = pipelineStagesBySession.get(sessionId.trim());
  if (!stages) return;
  const entry = stages.get(stage);
  if (entry) entry.completed = true;
}

export function resetPipelineStages(sessionId: string | undefined): void {
  if (!sessionId?.trim()) {
    pipelineStagesBySession.clear();
    return;
  }
  pipelineStagesBySession.delete(sessionId.trim());
}

export function beginPlannerSession(sessionId: string | undefined): boolean {
  if (!sessionId) return true;
  if (activePlannerSessions.has(sessionId)) {
    console.warn("[PLANNER_SKIP_DUPLICATE]", `sessionId=${sessionId}`, "reason=already_running");
    return false;
  }
  if (completedPlannerSessions.has(sessionId)) {
    console.warn("[PLANNER_SKIP_DUPLICATE]", `sessionId=${sessionId}`, "reason=already_completed");
    return false;
  }
  activePlannerSessions.add(sessionId);
  return true;
}

export function finishPlannerSession(sessionId: string | undefined, itemCount: number): void {
  if (!sessionId) return;
  activePlannerSessions.delete(sessionId);
  completedPlannerSessions.set(sessionId, itemCount);
}

export function resetPlannerSession(sessionId: string | undefined): void {
  if (!sessionId) return;
  const hadActive = activePlannerSessions.has(sessionId);
  const hadCompleted = completedPlannerSessions.has(sessionId);
  activePlannerSessions.delete(sessionId);
  completedPlannerSessions.delete(sessionId);
  resetPipelineStages(sessionId);
  // Drop any planner run keys scoped to this session (sid|style|days|fingerprint).
  const prefix = `${sessionId}|`;
  for (const key of [...activePlannerRuns]) {
    if (key.startsWith(prefix)) activePlannerRuns.delete(key);
  }
  for (const key of [...completedPlannerRuns.keys()]) {
    if (key.startsWith(prefix)) completedPlannerRuns.delete(key);
  }
  console.info(
    "[PLANNER_SESSION_RESET]",
    `sessionId=${sessionId}`,
    `hadActive=${hadActive}`,
    `hadCompleted=${hadCompleted}`,
  );
}

export function getPlannerSessionItemCount(sessionId: string | undefined): number | undefined {
  if (!sessionId) return undefined;
  return completedPlannerSessions.get(sessionId);
}
