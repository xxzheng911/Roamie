import { describe, expect, it } from "vitest";
import { extractPlusMemoryFromUserText, mergeSessionIntoPlusMemory } from "@/lib/ai/plus-memory-from-chat";
import type { ChatPlanningSession } from "@/lib/chat-session";

describe("plus-memory-from-chat", () => {
  it("extracts pace, coffee, walk, and crowd avoidance from user text", () => {
    const text =
      "我不喜歡太趕的行程，喜歡咖啡廳、散步、不要太多人。";
    const mem = extractPlusMemoryFromUserText(text, {});
    expect(mem.dislikes?.some((d) => /太趕|排太滿/.test(d))).toBe(true);
    expect(mem.likes?.some((l) => /咖啡/.test(l))).toBe(true);
    expect(mem.likes?.some((l) => /散步/.test(l))).toBe(true);
    expect(mem.dislikes?.some((d) => /人潮/.test(d))).toBe(true);
    expect(mem.travelPace).toMatch(/慢旅行|不趕/);
  });

  it("merges session avoidTypes and tripStyles", () => {
    const session = {
      avoidTypes: ["人多吵雜"],
      tripStyles: "豪華露營",
      lastUserIntent: "喜歡咖啡廳",
      transportation: "大眾運輸",
      budget: "一般",
    } as ChatPlanningSession;
    const mem = mergeSessionIntoPlusMemory({}, session);
    expect(mem.dislikes?.length).toBeGreaterThan(0);
    expect(mem.likes?.some((l) => /豪華露營|咖啡/.test(l))).toBe(true);
    expect(mem.preferredTransport).toBe("大眾運輸");
  });
});
