export type LocalTransportMode = 'drive' | 'transit' | 'walk';

export interface LocalTransportOption {
  mode: LocalTransportMode;
  durationMinutes: number;
  /** Heuristic for drive/transit; absent for walk (free). */
  priceEur?: number;
  distanceKm?: number;
  /** Real transit line name from Google Routes transitDetails, e.g. "Metro Line M1". */
  transitLine?: string;
  /** e.g. "SUBWAY" | "BUS" | "TRAM" — from Google Routes transitDetails. */
  transitVehicleType?: string;
  warnings: string[];
}

export interface LocalTransportPriorityResult {
  selectedMode: LocalTransportMode;
  selectedOption: LocalTransportOption;
  wasPreferenceHonored: boolean;
  downgradeReason?: string;
}
