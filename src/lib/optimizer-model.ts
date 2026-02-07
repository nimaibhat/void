/**
 * Void Optimizer Model
 *
 * A feature-based optimization model that mimics ML behavior.
 * Given a set of input features about the grid state and household,
 * it produces a recommended thermostat setpoint along with:
 *   - Confidence score (0–1)
 *   - Feature importance weights (how much each factor influenced the decision)
 *   - Predicted energy savings (kWh) and cost savings ($)
 *   - Human-readable reasoning chain
 *
 * In production, this would be a trained XGBoost/neural net model.
 * For the hackathon demo, we use a weighted feature scoring system
 * that produces the same kind of output a real ML model would.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface ModelInput {
  // Grid state
  gridLoadPercent: number;         // 0–100
  electricityPrice: number;        // $/kWh
  eventSeverity: number;           // 0 = none, 1 = LOW, 2 = MEDIUM, 3 = HIGH, 4 = CRITICAL

  // Household state
  currentSetpoint: number;         // °C
  currentTemp: number;             // °C (indoor)
  hvacMode: "HEAT" | "COOL" | "OFF";

  // Environment
  outsideTemp: number;             // °C
  timeOfDay: number;               // 0–23 (hour)
  isWeekend: boolean;

  // Event type context
  eventType: string;               // e.g. "DEMAND_REDUCTION", "HEAT_WAVE", etc.
}

export interface FeatureWeight {
  name: string;
  displayName: string;
  value: number;                   // raw input value
  normalizedValue: number;         // 0–1 normalized
  weight: number;                  // model weight (importance)
  contribution: number;            // weight × normalizedValue
}

export interface ModelOutput {
  recommendedSetpoint: number;     // °C, clamped to [15, 25]
  adjustmentDelta: number;         // change from current (signed)
  confidence: number;              // 0–1
  predictedEnergySavings: number;  // kWh over next 4 hours
  predictedCostSavings: number;    // $
  estimatedCredits: number;        // resilience credits
  featureWeights: FeatureWeight[];
  reasoningChain: string[];        // step-by-step reasoning
  modelVersion: string;
  inferenceTimeMs: number;
}

/* ------------------------------------------------------------------ */
/*  Model weights (would be learned in production)                     */
/* ------------------------------------------------------------------ */
const WEIGHTS = {
  gridLoad:       0.30,   // How stressed is the grid?
  priceSignal:    0.20,   // How expensive is electricity?
  eventSeverity:  0.25,   // How critical is the event?
  thermalInertia: 0.10,   // How much thermal buffer does the home have?
  timeOfDay:      0.08,   // Are we in peak hours?
  outsideTemp:    0.07,   // How cold/hot is it outside?
};

// Maximum temperature adjustment per event type
const MAX_DELTA: Record<string, number> = {
  DEMAND_REDUCTION: -4,    // negative = reduce setpoint (save energy)
  PRICE_SPIKE: -3,
  HEAT_WAVE: 3,            // positive = raise setpoint (less cooling needed)
  COLD_SNAP: -3,
  RENEWABLE_SURPLUS: 2,    // use free energy → increase comfort
};

/* ------------------------------------------------------------------ */
/*  Normalization helpers                                               */
/* ------------------------------------------------------------------ */
function normalize(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/* ------------------------------------------------------------------ */
/*  Inference                                                          */
/* ------------------------------------------------------------------ */
export function runModel(input: ModelInput): ModelOutput {
  const startTime = performance.now();

  // ── Feature engineering ─────────────────────────────────
  const gridLoadNorm = normalize(input.gridLoadPercent, 40, 100);
  const priceNorm = normalize(input.electricityPrice, 0.08, 0.50);
  const severityNorm = normalize(input.eventSeverity, 0, 4);

  // Thermal inertia: how far is indoor from outdoor? More buffer = more room to adjust
  const thermalDiff = Math.abs(input.currentTemp - input.outsideTemp);
  const thermalNorm = normalize(thermalDiff, 0, 20);

  // Time-of-day factor: peak hours (14:00–19:00) get higher scores
  const isPeak = input.timeOfDay >= 14 && input.timeOfDay <= 19;
  const timeNorm = isPeak ? 0.9 : normalize(input.timeOfDay, 6, 22);

  // Outside temperature stress: extremes are more important
  const outsideTempStress = Math.abs(input.outsideTemp - 20) / 25; // 20°C = comfortable
  const outsideNorm = Math.min(1, outsideTempStress);

  // ── Weighted score ──────────────────────────────────────
  const features: FeatureWeight[] = [
    {
      name: "gridLoad",
      displayName: "Grid Load Stress",
      value: input.gridLoadPercent,
      normalizedValue: gridLoadNorm,
      weight: WEIGHTS.gridLoad,
      contribution: gridLoadNorm * WEIGHTS.gridLoad,
    },
    {
      name: "priceSignal",
      displayName: "Price Signal",
      value: input.electricityPrice,
      normalizedValue: priceNorm,
      weight: WEIGHTS.priceSignal,
      contribution: priceNorm * WEIGHTS.priceSignal,
    },
    {
      name: "eventSeverity",
      displayName: "Event Severity",
      value: input.eventSeverity,
      normalizedValue: severityNorm,
      weight: WEIGHTS.eventSeverity,
      contribution: severityNorm * WEIGHTS.eventSeverity,
    },
    {
      name: "thermalInertia",
      displayName: "Thermal Buffer",
      value: thermalDiff,
      normalizedValue: thermalNorm,
      weight: WEIGHTS.thermalInertia,
      contribution: thermalNorm * WEIGHTS.thermalInertia,
    },
    {
      name: "timeOfDay",
      displayName: "Peak Hour Factor",
      value: input.timeOfDay,
      normalizedValue: timeNorm,
      weight: WEIGHTS.timeOfDay,
      contribution: timeNorm * WEIGHTS.timeOfDay,
    },
    {
      name: "outsideTemp",
      displayName: "Outside Temp Stress",
      value: input.outsideTemp,
      normalizedValue: outsideNorm,
      weight: WEIGHTS.outsideTemp,
      contribution: outsideNorm * WEIGHTS.outsideTemp,
    },
  ];

  // Total urgency score (0–1)
  const urgencyScore = features.reduce((sum, f) => sum + f.contribution, 0);

  // ── Calculate adjustment ────────────────────────────────
  const maxDelta = MAX_DELTA[input.eventType] ?? -2;
  // Scale delta by urgency: more urgent → bigger adjustment
  const rawDelta = maxDelta * urgencyScore;
  // Round to nearest 0.5°C
  const roundedDelta = Math.round(rawDelta * 2) / 2;

  // Apply to current setpoint, clamp to safe range
  let recommended = input.currentSetpoint + roundedDelta;
  recommended = Math.max(15, Math.min(25, recommended));
  // Round to nearest 0.5
  recommended = Math.round(recommended * 2) / 2;

  const actualDelta = recommended - input.currentSetpoint;

  // ── Confidence ──────────────────────────────────────────
  // Higher when features agree (low variance in contributions)
  const contributions = features.map((f) => f.contribution);
  const meanContrib = contributions.reduce((a, b) => a + b, 0) / contributions.length;
  const variance =
    contributions.reduce((sum, c) => sum + Math.pow(c - meanContrib, 2), 0) /
    contributions.length;
  // Low variance + high urgency → high confidence
  const confidenceRaw = sigmoid((urgencyScore - 0.3) * 4) * (1 - variance * 2);
  const confidence = Math.max(0.55, Math.min(0.98, confidenceRaw));

  // ── Savings estimates ───────────────────────────────────
  // Rough: each 1°C reduction ≈ 0.4 kWh saved over 4 hours
  const energySaved = Math.abs(actualDelta) * 0.4;
  const costSaved = energySaved * input.electricityPrice;
  const credits = Math.round(Math.abs(actualDelta) * 5 * urgencyScore + 2);

  // ── Reasoning chain ─────────────────────────────────────
  const reasoning: string[] = [];

  reasoning.push(
    `Input: grid at ${input.gridLoadPercent}% load, price $${input.electricityPrice.toFixed(2)}/kWh, ` +
    `event severity ${input.eventSeverity}/4, outside ${input.outsideTemp}°C`
  );

  // Sort features by contribution (descending)
  const sortedFeatures = [...features].sort((a, b) => b.contribution - a.contribution);
  reasoning.push(
    `Top factors: ${sortedFeatures[0].displayName} (${(sortedFeatures[0].contribution * 100).toFixed(1)}%), ` +
    `${sortedFeatures[1].displayName} (${(sortedFeatures[1].contribution * 100).toFixed(1)}%)`
  );

  reasoning.push(
    `Urgency score: ${(urgencyScore * 100).toFixed(1)}% → ` +
    `adjustment range [0, ${maxDelta}°C]`
  );

  reasoning.push(
    `Recommended: ${input.currentSetpoint}°C → ${recommended}°C ` +
    `(Δ${actualDelta > 0 ? "+" : ""}${actualDelta}°C)`
  );

  reasoning.push(
    `Predicted savings: ${energySaved.toFixed(1)} kWh / $${costSaved.toFixed(2)} over 4 hours`
  );

  reasoning.push(
    `Model confidence: ${(confidence * 100).toFixed(1)}%`
  );

  const inferenceTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

  return {
    recommendedSetpoint: recommended,
    adjustmentDelta: actualDelta,
    confidence,
    predictedEnergySavings: Math.round(energySaved * 10) / 10,
    predictedCostSavings: Math.round(costSaved * 100) / 100,
    estimatedCredits: credits,
    featureWeights: features,
    reasoningChain: reasoning,
    modelVersion: "blackout-opt-v1.2.0",
    inferenceTimeMs,
  };
}

/* ------------------------------------------------------------------ */
/*  Severity mapping helper                                            */
/* ------------------------------------------------------------------ */
export function severityToNumber(severity: string): number {
  switch (severity) {
    case "LOW":
      return 1;
    case "MEDIUM":
      return 2;
    case "HIGH":
      return 3;
    case "CRITICAL":
      return 4;
    default:
      return 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Simulated outside temperature for demo                             */
/* ------------------------------------------------------------------ */
export function getSimulatedOutsideTemp(eventType: string): number {
  switch (eventType) {
    case "HEAT_WAVE":
      return 38;   // 100°F
    case "COLD_SNAP":
      return -5;   // 23°F
    case "DEMAND_REDUCTION":
      return 32;   // 90°F — hot day, high AC demand
    case "PRICE_SPIKE":
      return 28;   // 82°F
    case "RENEWABLE_SURPLUS":
      return 18;   // 64°F — mild
    default:
      return 20;
  }
}
