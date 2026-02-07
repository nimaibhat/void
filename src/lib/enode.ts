/**
 * Enode Sandbox API Helper
 *
 * Handles OAuth2 authentication (client credentials flow with Basic auth)
 * and provides typed helpers for all Enode Sandbox endpoints.
 *
 * Docs: https://developers.enode.com/api/reference
 *
 * Environment variables required:
 *   ENODE_CLIENT_ID     – from Enode developer dashboard
 *   ENODE_CLIENT_SECRET – from Enode developer dashboard
 *   ENODE_API_URL       – https://enode-api.sandbox.enode.io  (sandbox)
 *   ENODE_OAUTH_URL     – https://oauth.sandbox.enode.io/oauth2/token
 */

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
const ENODE_CLIENT_ID = (process.env.ENODE_CLIENT_ID ?? "").trim();
const ENODE_CLIENT_SECRET = (process.env.ENODE_CLIENT_SECRET ?? "").trim();
const ENODE_API_URL = (
  process.env.ENODE_API_URL ?? "https://enode-api.sandbox.enode.io"
).replace(/\/+$/, ""); // strip trailing slash
const ENODE_OAUTH_URL = (
  process.env.ENODE_OAUTH_URL ?? "https://oauth.sandbox.enode.io/oauth2/token"
).trim();

/* ------------------------------------------------------------------ */
/*  Default scopes for Link sessions                                   */
/* ------------------------------------------------------------------ */
const DEFAULT_SCOPES = [
  "vehicle:read:data",
  "vehicle:control:charging",
  "charger:read:data",
  "charger:control:charging",
  "hvac:read:data",
  "hvac:control:mode",
  "battery:read:data",
  "battery:control:operation_mode",
  "inverter:read:data",
];

/* ------------------------------------------------------------------ */
/*  Token cache (in-memory, server-side only)                          */
/* ------------------------------------------------------------------ */
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms

/**
 * Obtain an OAuth2 bearer token using the client-credentials grant.
 * Enode requires Basic auth (base64 of client_id:client_secret).
 * Tokens are cached until 60 s before expiry.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!ENODE_CLIENT_ID || !ENODE_CLIENT_SECRET) {
    throw new Error(
      "Missing ENODE_CLIENT_ID or ENODE_CLIENT_SECRET in environment variables. " +
        "Sign up at https://developers.enode.com and add your credentials to .env"
    );
  }

  const credentials = Buffer.from(
    `${ENODE_CLIENT_ID}:${ENODE_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(ENODE_OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enode OAuth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token as string;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/* ------------------------------------------------------------------ */
/*  Generic fetch wrapper                                              */
/* ------------------------------------------------------------------ */
export async function enodeFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();

  const res = await fetch(`${ENODE_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Enode API ${options.method ?? "GET"} ${path} → ${res.status}: ${text}`
    );
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/*  Users                                                              */
/* ------------------------------------------------------------------ */
export interface EnodeUser {
  id: string;
  createdAt?: string;
  linkedVendors?: { vendor: string; isValid: boolean }[];
}

/**
 * List all users. In Enode, users are implicitly created when you
 * create a Link session — there is no separate "create user" endpoint.
 */
export function listUsers() {
  return enodeFetch<{ data: EnodeUser[] }>("/users");
}

/** Get a single user by ID. */
export function getUser(userId: string) {
  return enodeFetch<EnodeUser>(`/users/${userId}`);
}

/** Delete a user and all their linked devices. */
export function deleteUser(userId: string) {
  return enodeFetch(`/users/${userId}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/*  Link UI session                                                    */
/* ------------------------------------------------------------------ */
export interface LinkSession {
  linkUrl: string;
  linkToken: string;
}

/**
 * Generate a Link UI session so the user can connect virtual devices.
 * This also implicitly creates the user if they don't already exist.
 * Required fields: redirectUri, scopes, language
 */
export function createLinkSession(
  userId: string,
  redirectUri: string,
  options?: { vendor?: string; scopes?: string[]; language?: string }
) {
  const body = {
    redirectUri,
    scopes: options?.scopes ?? DEFAULT_SCOPES,
    language: options?.language ?? "en-US",
    ...(options?.vendor ? { vendor: options.vendor } : {}),
  };

  return enodeFetch<LinkSession>(`/users/${userId}/link`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ */
/*  Devices                                                            */
/* ------------------------------------------------------------------ */
export interface DeviceBase {
  id: string;
  userId: string;
  vendor: string;
  isReachable: boolean;
  lastSeen: string;
}

export interface Charger extends DeviceBase {
  chargeState: {
    isPluggedIn: boolean;
    isCharging: boolean;
    chargeRate: number | null;
    powerDelivery: number | null;
  };
  information: { brand: string; model: string };
}

export interface HvacSystem extends DeviceBase {
  currentTemperature: number | null;
  targetTemperature: number | null;
  operationMode: string | null;
  information: { brand: string; model: string };
}

export interface Battery extends DeviceBase {
  chargeState: {
    batteryLevel: number | null;
    isCharging: boolean;
    chargeRate: number | null;
  };
  information: { brand: string; model: string };
}

export interface Vehicle extends DeviceBase {
  chargeState: {
    batteryLevel: number | null;
    range: number | null;
    isPluggedIn: boolean;
    isCharging: boolean;
    chargeRate: number | null;
  };
  information: { brand: string; model: string; year: number | null };
}

export interface SolarInverter extends DeviceBase {
  productionState: {
    isProducing: boolean;
    productionRate: number | null;
  };
  information: { brand: string; model: string };
}

export type AnyDevice = (
  | Charger
  | HvacSystem
  | Battery
  | Vehicle
  | SolarInverter
) & {
  deviceType: "charger" | "hvac" | "battery" | "vehicle" | "solarInverter";
};

export function listChargers(userId: string) {
  return enodeFetch<{ data: Charger[] }>(`/users/${userId}/chargers`);
}
export function listHvacs(userId: string) {
  return enodeFetch<{ data: HvacSystem[] }>(`/users/${userId}/hvacs`);
}
export function listBatteries(userId: string) {
  return enodeFetch<{ data: Battery[] }>(`/users/${userId}/batteries`);
}
export function listVehicles(userId: string) {
  return enodeFetch<{ data: Vehicle[] }>(`/users/${userId}/vehicles`);
}
export function listSolarInverters(userId: string) {
  return enodeFetch<{ data: SolarInverter[] }>(
    `/users/${userId}/solar-inverters`
  );
}

/** Get all device types for a user. */
export async function listAllDevices(userId: string): Promise<AnyDevice[]> {
  const [chargers, hvacs, batteries, vehicles, solar] = await Promise.all([
    listChargers(userId).catch(() => ({ data: [] as Charger[] })),
    listHvacs(userId).catch(() => ({ data: [] as HvacSystem[] })),
    listBatteries(userId).catch(() => ({ data: [] as Battery[] })),
    listVehicles(userId).catch(() => ({ data: [] as Vehicle[] })),
    listSolarInverters(userId).catch(() => ({ data: [] as SolarInverter[] })),
  ]);

  return [
    ...chargers.data.map((d) => ({ ...d, deviceType: "charger" as const })),
    ...hvacs.data.map((d) => ({ ...d, deviceType: "hvac" as const })),
    ...batteries.data.map((d) => ({ ...d, deviceType: "battery" as const })),
    ...vehicles.data.map((d) => ({ ...d, deviceType: "vehicle" as const })),
    ...solar.data.map((d) => ({ ...d, deviceType: "solarInverter" as const })),
  ];
}

/* ------------------------------------------------------------------ */
/*  Actions — send commands to devices                                 */
/* ------------------------------------------------------------------ */
export interface EnodeAction {
  id: string;
  userId: string;
  targetId: string;
  targetType: string;
  kind: string;
  state: "PENDING" | "CONFIRMED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
}

/** Start / stop charging on a charger. */
export function controlCharging(chargerId: string, action: "START" | "STOP") {
  return enodeFetch<EnodeAction>(`/chargers/${chargerId}/charging`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

/**
 * Set a permanent hold on an HVAC (thermostat).
 * Example: { mode: "HEAT", heatSetpoint: 22 }
 */
export function controlHvac(
  hvacId: string,
  action: { mode?: string; heatSetpoint?: number; coolSetpoint?: number }
) {
  return enodeFetch<EnodeAction>(`/hvacs/${hvacId}/permanent-hold`, {
    method: "POST",
    body: JSON.stringify(action),
  });
}

/** Tell an HVAC to follow its built-in schedule (removes any hold). */
export function hvacFollowSchedule(hvacId: string) {
  return enodeFetch<EnodeAction>(`/hvacs/${hvacId}/follow-schedule`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Start / stop vehicle charging. */
export function controlVehicleCharging(
  vehicleId: string,
  action: "START" | "STOP"
) {
  return enodeFetch<EnodeAction>(`/vehicles/${vehicleId}/charging`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

/** Get action status. */
export function getAction(actionId: string) {
  return enodeFetch<EnodeAction>(`/actions/${actionId}`);
}
