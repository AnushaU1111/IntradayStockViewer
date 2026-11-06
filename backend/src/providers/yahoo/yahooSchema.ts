import { z } from "zod";

/** Largest Unix-seconds value a JavaScript Date can represent. */
const MAX_UNIX_SECONDS = 8_640_000_000_000;

const unixSeconds = z.int().min(0).max(MAX_UNIX_SECONDS);
const period = z.object({ start: unixSeconds, end: unixSeconds });
const series = z.array(z.number().nullable());

// Unknown keys are ignored (z.object strips them); never .strict(), because Yahoo adds
// fields freely. Display-only fields fall back to "absent" when malformed (D-41).
const meta = z.object({
  exchangeTimezoneName: z.string().min(1),
  instrumentType: z.string().min(1),
  dataGranularity: z.string().min(1),
  currency: z.string().min(1).optional().catch(undefined),
  currentTradingPeriod: z.object({ regular: period }).optional().catch(undefined),
  tradingPeriods: z.array(z.array(period)).optional(),
});

const result = z.object({
  meta,
  timestamp: z.array(unixSeconds).optional(),
  indicators: z
    .object({
      quote: z.array(
        z.object({ low: series.optional(), high: series.optional(), volume: series.optional() }),
      ),
    })
    .optional(),
});

export const yahooChartSchema = z.object({
  chart: z.object({
    result: z.array(result).nullable().optional(),
    error: z.object({ code: z.string(), description: z.string().optional() }).nullable().optional(),
  }),
});

export type YahooChart = z.infer<typeof yahooChartSchema>;
export type YahooResult = z.infer<typeof result>;
