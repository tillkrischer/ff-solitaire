import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import { choose, createRandom } from "./shared.ts";

const STRATEGY_NAME = "inline-test-deal";

const TEST_DEALS = [
  {
    name: "deal-01",
    board:
      "-1|22|1,1,1,1|.|M9.A13.M3.C13.S3.S8.C10|C4.T10.C9.T9.C7.M12.M7|M17.A5.A3.C5.S2.T13.S5|M18.M4.A2.S7.M20.M19.M10|T8.M15.T11.A8.C2.M0.M2||M14.T12.T6.A12.T7.M6.M1|S13.C12.A6.M21.S12.M5.A11|S10.S4.C11.M11.M16.T3.A9|C6.S11.C8.T2.T4.S6.A10|C3.M13.A4.M8.S9.A7.T5",
  },
  {
    name: "deal-02",
    board:
      "-1|22|1,1,1,1|.|M5.A4.M19.A5.S8.T6.M18|M0.A6.M14.T2.M8.M10.S5|S3.C5.M17.A9.C7.S2.M13|C10.M15.T9.S10.M16.M2.T12|S11.M3.C6.M1.M11.C8.A13||S6.T11.M20.C4.T10.C2.A12|C3.C12.S7.T8.M4.M9.A7|C11.T5.S9.A2.A10.S4.T4|S13.S12.M7.A8.M12.M21.T13|T7.A3.C13.A11.C9.M6.T3",
  },
  {
    name: "deal-03",
    board:
      "-1|22|1,1,1,1|.|A13.S2.M19.M11.A5.M17.A10|A3.S11.S9.M7.S8.M1.T7|M6.C5.M5.T2.T10.A4.A9|T13.S3.M14.T12.M10.T3.C9|M16.M15.S6.S10.C2.M13.S5||C11.A8.M18.T9.M8.C6.T11|M21.A6.M3.A2.T4.C10.T5|C3.M12.M20.S13.A7.M2.C12|S12.C7.A12.C4.C13.T6.M4|A11.S4.C8.M9.M0.T8.S7",
  },
  {
    name: "deal-04",
    board:
      "-1|22|1,1,1,1|.|A7.C10.A10.S7.S3.C9.S6|S10.T4.S4.C6.A3.C8.M2|S5.M21.M6.T10.S13.S9.M17|T9.S8.M5.A8.T5.A6.M4|A4.A5.C4.M10.M0.C3.M20||M14.T7.T13.M8.C11.C5.M11|T8.A11.M12.A9.M3.C13.S12|T6.S2.C12.M19.A12.T11.M15|M1.M18.A2.S11.T3.C2.C7|M9.A13.T12.M13.M7.T2.M16",
  },
  {
    name: "deal-05",
    board:
      "-1|22|1,1,1,1|.|T6.M8.M18.M7.T11.S12.C3|A9.M2.A11.A5.T3.M6.S11|C5.M9.S8.T2.M21.S9.M11|M15.C2.M1.M19.M0.M10.S13|M4.C13.M12.C9.A13.A4.M14||T12.T7.S5.A7.S3.A12.T10|S6.C4.A2.A8.A10.M3.M17|T4.S4.C12.M5.A3.C7.S7|C6.C10.S10.T13.M13.T5.M16|T9.T8.S2.A6.C8.C11.M20",
  },
  {
    name: "deal-06",
    board:
      "-1|22|1,1,1,1|.|A10.C5.A13.C11.M13.T4.S8|M10.S11.M17.T8.M4.S6.M16|T10.M14.M20.C9.T9.S12.M11|S13.T13.T11.C4.M7.M5.C12|M1.M9.C10.C8.M12.T12.C13||A4.M3.S3.C2.A6.M21.C6|M8.A5.A12.M15.T3.A8.T6|M18.S10.M2.A9.S4.M19.S9|M6.S2.T2.A2.T5.S7.C3|A3.S5.A11.C7.A7.M0.T7",
  },
  {
    name: "deal-07",
    board:
      "-1|22|1,1,1,1|.|A7.C9.C11.T4.T12.M1.A5|A13.A6.A8.M7.S4.S11.A4|M4.S9.T11.A9.T13.A11.T9|M12.C2.C13.T6.M20.T7.S7|T10.M14.S12.M8.M18.S5.M6||S13.C10.C4.M15.C3.C7.M5|M10.C12.M0.A2.T5.M19.T3|M9.M2.M17.S6.M16.A10.T8|M3.M13.S2.S3.C8.C5.M11|C6.A3.A12.T2.M21.S10.S8",
  },
  {
    name: "deal-08",
    board:
      "-1|22|1,1,1,1|.|T10.A12.M16.S13.A11.A13.M8|M12.M13.A3.M19.C5.M6.A8|A4.T5.S11.M14.T2.S6.M4|S2.M11.C9.C10.M0.M20.C8|S8.M10.M15.T8.S7.M21.M7||S5.T7.S9.A6.S10.T13.C12|C7.M1.M18.C11.A2.M3.T4|C2.T11.C4.A9.A7.M2.T9|S12.A10.C3.M5.T6.T12.T3|M17.A5.S4.S3.M9.C6.C13",
  },
  {
    name: "deal-09",
    board:
      "-1|22|1,1,1,1|.|C6.C13.C12.S4.T13.T8.S11|A4.M2.M17.A10.M15.T5.M16|A3.M8.M3.C3.S12.A12.S8|M7.M0.C9.A13.A8.T3.C4|C11.T6.S13.T7.T9.M20.M1||M4.A9.M12.S5.A5.M9.M19|A11.S3.M13.C7.M14.T2.T12|M11.C8.S2.C2.C5.S7.S6|A6.A7.C10.M5.S9.M10.T10|S10.M18.M6.T11.M21.A2.T4",
  },
  {
    name: "deal-10",
    board:
      "-1|22|1,1,1,1|.|S4.M2.A6.T12.C7.A4.S5|A3.T2.C2.C13.S3.A11.T8|C6.C9.M0.M1.M5.M19.T9|C11.S10.A8.C12.T13.A7.C3|S13.A12.C10.M16.S2.M20.T6||T10.T5.S11.M13.M14.M18.M10|M17.M6.C5.T4.S8.S12.S7|M12.T3.C8.M8.S6.M3.C4|A2.A5.A13.S9.M7.M11.T11|M21.M15.A10.M4.A9.M9.T7",
  },
  {
    name: "deal-11",
    board:
      "-1|22|1,1,1,1|.|A6.A5.T12.S4.S6.T13.T4|T7.A2.T10.C3.T6.C2.A9|M7.T9.M6.M10.T3.A10.M12|C8.M4.C7.A12.S2.A11.M8|M21.M14.M19.A3.C9.M20.M11||A7.M0.T8.C10.T2.M5.C6|S11.M15.A8.S3.M2.C13.A13|S13.M18.C4.S8.C11.S12.M3|T5.M16.S10.M17.S9.S7.C12|T11.M1.A4.S5.C5.M9.M13",
  },
] as const;

export const inlineTestDealStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateInlineTestDeal,
};

export function generateInlineTestDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const deal = choose(createRandom(seed), [...TEST_DEALS]);

  return {
    board: deal.board,
    seed,
    attempts: 1,
    strategy: options.strategy ?? STRATEGY_NAME,
    metadata: {
      selectedDeal: deal.name,
      source: "inline",
    },
  };
}
