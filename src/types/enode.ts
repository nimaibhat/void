/* ------------------------------------------------------------------ */
/*  Shared Enode types (mirrors Enode API shapes)                      */
/* ------------------------------------------------------------------ */

export interface DeviceInfo {
  id: string;
  deviceType: string;
  vendor: string;
  isReachable: boolean;
  lastSeen: string;
  chargeState?: {
    isPluggedIn?: boolean;
    isCharging?: boolean;
    chargeRate?: number | null;
    powerDelivery?: number | null;
    batteryLevel?: number | null;
    range?: number | null;
  };
  currentTemperature?: number | null;
  targetTemperature?: number | null;
  operationMode?: string | null;
  temperatureState?: {
    currentTemperature?: number | null;
    isActive?: boolean;
  };
  thermostatState?: {
    mode?: string | null;
    holdType?: string | null;
    heatSetpoint?: number | null;
    coolSetpoint?: number | null;
  };
  capabilities?: {
    capableModes?: string[];
    heatSetpointRange?: { min: number; max: number } | null;
  };
  productionState?: {
    isProducing?: boolean;
    productionRate?: number | null;
  };
  information?: {
    brand?: string;
    model?: string;
    year?: number | null;
  };
}

export interface ActionResult {
  id: string;
  state: string;
  kind: string;
  createdAt: string;
}

export interface LogEntry {
  time: string;
  msg: string;
  type: "ok" | "err" | "info" | "action";
}
