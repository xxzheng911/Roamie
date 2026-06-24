import { parsePendingOptionSelection } from "../src/lib/ai/destination-pending-question.ts";

const pending = {
  type: "ask_preference",
  options: ["經典景點", "美食咖啡", "海灘放鬆", "都可以"],
  baseDestination: "雪梨",
};

for (const text of ["景點", "經典景點", "A", "a", "購物", "都可以", "美食"]) {
  console.log(text, "->", parsePendingOptionSelection(text, pending));
}
