export type RoamieAIErrorDetail = {
  message: string;
  status?: number;
  code?: string;
  type?: string;
};

export async function mapOpenAIError(response: Response): Promise<RoamieAIErrorDetail> {
  const text = await response.text().catch(() => "");
  let code: string | undefined;
  let type: string | undefined;
  let apiMessage: string | undefined;
  try {
    const j = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } };
    code = j.error?.code;
    type = j.error?.type;
    apiMessage = j.error?.message;
  } catch {
    /* not json */
  }

  console.error("[Roamie AI] OpenAI request failed", {
    status: response.status,
    code,
    type,
    message: apiMessage ?? text.slice(0, 300),
  });

  if (response.status === 401) {
    return {
      status: 401,
      code: code ?? "invalid_api_key",
      type,
      message:
        code === "invalid_api_key" || /invalid.*api.*key/i.test(apiMessage ?? "")
          ? "OpenAI API 金鑰無效（401）。請檢查 .env 的 OPENAI_API_KEY 是否為有效金鑰。"
          : "OpenAI 驗證失敗（401）。請檢查 OPENAI_API_KEY。",
    };
  }
  if (response.status === 429) {
    const isQuota = /insufficient_quota|exceeded your current quota/i.test(text);
    return {
      status: 429,
      code: code ?? (isQuota ? "insufficient_quota" : "rate_limit"),
      type,
      message: isQuota
        ? "OpenAI 金鑰額度不足，請至 platform.openai.com/account/billing 加值後再試。"
        : "OpenAI 請求過於頻繁（429），請稍後再試。",
    };
  }
  if (response.status === 402) {
    return { status: 402, code, type, message: "AI 額度已用完，請至工作區設定加值。" };
  }
  return {
    status: response.status,
    code,
    type,
    message: apiMessage
      ? `OpenAI 錯誤（${response.status}）：${apiMessage}`
      : `AI 服務暫時無法使用（HTTP ${response.status}）。`,
  };
}

export function toError(detail: RoamieAIErrorDetail): Error {
  const err = new Error(detail.message);
  (err as Error & { roamie?: RoamieAIErrorDetail }).roamie = detail;
  return err;
}
