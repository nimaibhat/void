/**
 * Claude-enhanced alert text generation.
 *
 * The rules engine (priceAlerts.ts) does all the math — this module takes
 * the computed alerts + price analysis and asks Claude Haiku to rewrite
 * the prose into concise, personalised, context-aware language.
 *
 * Falls back to the original rule-generated text on any error or timeout.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AlertData } from "@/components/AlertsPanel";
import type { HourlyPrice } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RuleAnalysisItem {
  alertId: string;
  deviceType: string;
  deviceName: string;
  actionType: string;
  savingsDollars: number;
  currentPriceKwh: number;
  optimalPriceKwh: number;
  optimalWindowLabel: string;
  peakWindowLabel: string;
}

export interface PriceSummary {
  currentPriceKwh: number;
  avgPriceKwh: number;
  peakPriceKwh: number;
  valleyPriceKwh: number;
  peakHour: number;
  valleyHour: number;
  spikeCount: number;
  avgUtilizationPct: number;
}

/* ------------------------------------------------------------------ */
/*  ERCOT residential pricing context (no dataset needed)              */
/* ------------------------------------------------------------------ */

const ERCOT_PRICING_CONTEXT = `
ERCOT Residential Electricity Pricing Reference (Texas):
- Average residential rate: $0.12/kWh (statewide avg, varies by REP)
- Typical off-peak rate: $0.06-$0.09/kWh (overnight, 10pm-6am)
- Typical on-peak rate: $0.14-$0.22/kWh (summer afternoons 2pm-7pm)
- Summer peak rates can exceed: $0.30-$0.50/kWh during grid stress
- Winter storm events (like URI 2021): wholesale spiked to $9.00/kWh cap
- Average monthly bill: ~$150-175 for a 2,000 sqft home
- Average monthly consumption: ~1,200 kWh
- Time-of-use plans save 15-25% for flexible load shifting
- Solar buyback rates: $0.04-$0.08/kWh (varies by REP)
- Demand charges (commercial): $5-15/kW for peak demand
`.trim();

/* ------------------------------------------------------------------ */
/*  Anthropic client (lazy init)                                       */
/* ------------------------------------------------------------------ */

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.warn("[claude-alerts] ANTHROPIC_API_KEY not set — falling back to rule-based text");
    return null;
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

/* ------------------------------------------------------------------ */
/*  Summarize price curve                                              */
/* ------------------------------------------------------------------ */

export function summarizePrices(prices: HourlyPrice[]): PriceSummary {
  if (!prices.length) {
    return {
      currentPriceKwh: 0.12,
      avgPriceKwh: 0.12,
      peakPriceKwh: 0.12,
      valleyPriceKwh: 0.12,
      peakHour: 0,
      valleyHour: 0,
      spikeCount: 0,
      avgUtilizationPct: 50,
    };
  }

  const kwhPrices = prices.map((p) => p.consumer_price_kwh);
  const peakIdx = kwhPrices.indexOf(Math.max(...kwhPrices));
  const valleyIdx = kwhPrices.indexOf(Math.min(...kwhPrices));

  return {
    currentPriceKwh: prices[0].consumer_price_kwh,
    avgPriceKwh: kwhPrices.reduce((a, b) => a + b, 0) / kwhPrices.length,
    peakPriceKwh: kwhPrices[peakIdx],
    valleyPriceKwh: kwhPrices[valleyIdx],
    peakHour: prices[peakIdx].hour,
    valleyHour: prices[valleyIdx].hour,
    spikeCount: prices.filter((p) => p.consumer_price_kwh > 0.25).length,
    avgUtilizationPct:
      prices.reduce((s, p) => s + p.grid_utilization_pct, 0) / prices.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Enhance alerts with Claude                                         */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are a smart energy advisor embedded in a home dashboard app called Blackout.
You write SHORT, friendly, actionable alert text for homeowners in Texas (ERCOT grid).

Rules:
- Each alert gets a rewritten "title" (max 60 chars) and "description" (max 180 chars).
- Reference actual dollar amounts from the analysis — never invent numbers.
- Compare current prices to the ERCOT average ($0.12/kWh) to give context ("2x the average", "40% below normal").
- Be conversational but concise. No jargon. No exclamation marks.
- For savings alerts, lead with the dollar amount.
- For warnings, lead with the risk and what to do.
- Return valid JSON array: [{ "alertId": "...", "title": "...", "description": "..." }, ...]
- Return ONLY the JSON array, no markdown fences, no explanation.

${ERCOT_PRICING_CONTEXT}`;

export async function enhanceAlertsWithClaude(
  alerts: AlertData[],
  priceSummary: PriceSummary,
  ruleAnalysis: RuleAnalysisItem[]
): Promise<AlertData[]> {
  const client = getClient();
  if (!client || alerts.length === 0) return alerts;

  // Build user message with price context + alert data
  const userMessage = `
Price forecast summary:
- Current: $${priceSummary.currentPriceKwh.toFixed(3)}/kWh (ERCOT avg is $0.120/kWh)
- 48h average: $${priceSummary.avgPriceKwh.toFixed(3)}/kWh
- Peak: $${priceSummary.peakPriceKwh.toFixed(3)}/kWh at hour ${priceSummary.peakHour}
- Valley: $${priceSummary.valleyPriceKwh.toFixed(3)}/kWh at hour ${priceSummary.valleyHour}
- Spike hours (>$0.25): ${priceSummary.spikeCount}
- Avg grid utilization: ${priceSummary.avgUtilizationPct.toFixed(0)}%

Alerts to enhance (${alerts.length}):
${alerts.map((a) => {
  const analysis = ruleAnalysis.find((r) => r.alertId === a.id);
  return `- id="${a.id}" severity=${a.severity} title="${a.title}"
  description="${a.description}"${
    analysis
      ? `\n  analysis: ${analysis.deviceName} (${analysis.deviceType}), action=${analysis.actionType}, savings=$${analysis.savingsDollars.toFixed(2)}, current=$${analysis.currentPriceKwh.toFixed(3)}/kWh, optimal=$${analysis.optimalPriceKwh.toFixed(3)}/kWh, window="${analysis.optimalWindowLabel}"`
      : ""
  }`;
}).join("\n")}

Rewrite each alert's title and description. Keep alertId the same.`;

  try {
    const response = await Promise.race([
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000)
      ),
    ]);

    // Extract text from response
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Parse JSON — strip markdown fences if present
    const cleaned = text.replace(/```json?\s*\n?/g, "").replace(/```\s*$/g, "").trim();
    const enhanced: { alertId: string; title: string; description: string }[] =
      JSON.parse(cleaned);

    // Merge enhanced text back into alerts
    const enhancedMap = new Map(enhanced.map((e) => [e.alertId, e]));
    return alerts.map((alert) => {
      const e = enhancedMap.get(alert.id);
      if (e) {
        return {
          ...alert,
          title: e.title || alert.title,
          description: e.description || alert.description,
        };
      }
      return alert;
    });
  } catch (err) {
    console.warn(
      "[claude-alerts] Enhancement failed, using rule-based text:",
      err instanceof Error ? err.message : err
    );
    return alerts;
  }
}
