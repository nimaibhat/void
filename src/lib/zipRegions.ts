/**
 * Texas ZIP code → ERCOT weather zone mapping.
 *
 * Shared between OperatorEntryModal and the consumer dashboard
 * so both resolve ZIP codes the same way.
 */

export const ZIP_REGIONS: Record<string, { zone: string; lat: number; lng: number }> = {
  "77": { zone: "Coast", lat: 29.76, lng: -95.37 },
  "75": { zone: "North Central", lat: 32.78, lng: -96.80 },
  "76": { zone: "North Central", lat: 32.45, lng: -97.35 },
  "78": { zone: "South Central", lat: 30.27, lng: -97.74 },
  "79": { zone: "Far West", lat: 31.99, lng: -102.08 },
  "73": { zone: "North", lat: 34.0, lng: -97.0 },
  "88": { zone: "Far West", lat: 31.76, lng: -106.44 },
};

export function getRegionFromZip(zip: string): { zone: string; lat: number; lng: number } {
  const prefix = zip.substring(0, 2);
  return ZIP_REGIONS[prefix] || { zone: "South Central", lat: 30.27, lng: -97.74 };
}
