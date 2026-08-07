import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    DAY_TRIP_DISTANCE_THRESHOLD_KM: 20,
  },
}));

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

import { ActivityTransportResolver } from '@/services/ActivityTransportResolver';
import type { DayInput } from '@/services/ActivityTransportResolver';
import type { PlacesService } from '@/services/PlacesService';
import type { LocalTransportService } from '@/services/LocalTransportService';
import type { TransportService } from '@/services/TransportService';
import type { TransportOption, LocalTransportOption } from '@itinera/shared';

// Base city and a local museum ~2km away (well below the 20km day-trip threshold).
const LISBON = { lat: 38.7223, lng: -9.1393 };
const LOCAL_MUSEUM = { lat: 38.71, lng: -9.14 };
// Sintra/Pena Palace-equivalent — ~28km away, above the threshold.
const SINTRA_PALACE = { lat: 38.7876, lng: -9.3903 };

function makePlacesMock(): PlacesService {
  return {
    geocodePlace: vi.fn(async (place: string) => {
      if (place === 'Lisbon') return LISBON;
      if (place === 'Local Museum') return LOCAL_MUSEUM;
      if (place === 'Pena Palace') return SINTRA_PALACE;
      if (place === 'Unknown Place') return null;
      return null;
    }),
  } as unknown as PlacesService;
}

const DRIVE_OPTION: LocalTransportOption = { mode: 'drive', durationMinutes: 15, priceEur: 6, warnings: [] };
const TRANSIT_OPTION: LocalTransportOption = { mode: 'transit', durationMinutes: 25, priceEur: 2, warnings: [] };

function makeLocalTransportMock(): LocalTransportService {
  return {
    resolveCandidates: vi.fn().mockResolvedValue([DRIVE_OPTION, TRANSIT_OPTION]),
  } as unknown as LocalTransportService;
}

const TRAIN_OUT: TransportOption = { mode: 'train', durationMinutes: 45, priceEur: 12, warnings: [] };
const TRAIN_BACK: TransportOption = { mode: 'train', durationMinutes: 50, priceEur: 12, warnings: [] };

function makeTransportServiceMock(): TransportService {
  return {
    resolveTransportOptions: vi.fn(async ({ from }: { from: string }) => {
      return from === 'Lisbon' ? [TRAIN_OUT] : [TRAIN_BACK];
    }),
  } as unknown as TransportService;
}

function makeDay(activities: DayInput['activities']): DayInput {
  return { day: 1, city: 'Lisbon', activities };
}

describe('ActivityTransportResolver', () => {
  let places: PlacesService;
  let localTransport: LocalTransportService;
  let transportService: TransportService;
  let resolver: ActivityTransportResolver;
  const dateByDay = new Map([[1, '2026-08-10']]);

  beforeEach(() => {
    places = makePlacesMock();
    localTransport = makeLocalTransportMock();
    transportService = makeTransportServiceMock();
    resolver = new ActivityTransportResolver(places, localTransport, transportService);
  });

  it('resolves a nearby activity via the local transport path', async () => {
    const itinerary = [makeDay([{ activity: 'Visit the museum', venue: 'Local Museum', estimatedCostPerPerson: 12 }])];

    const result = await resolver.resolveForItinerary(itinerary, dateByDay, 'best');

    expect(localTransport.resolveCandidates).toHaveBeenCalledWith('Lisbon', 'Local Museum');
    expect(transportService.resolveTransportOptions).not.toHaveBeenCalled();
    expect(result.satelliteLegs).toHaveLength(0);
    const activity = result.itinerary[0]!.activities[0]!;
    expect(activity.localTransport).toBeDefined();
    expect(result.itinerary[0]!.transport).toHaveLength(1);
    expect(result.itinerary[0]!.transport![0]).toMatchObject({ isEstimate: true });
  });

  it('resolves a day-trip-distance activity via the round-trip satellite leg path', async () => {
    const itinerary = [makeDay([{ activity: 'Visit Pena Palace', venue: 'Pena Palace', estimatedCostPerPerson: 14 }])];

    const result = await resolver.resolveForItinerary(itinerary, dateByDay, 'train');

    expect(transportService.resolveTransportOptions).toHaveBeenCalledTimes(2);
    expect(transportService.resolveTransportOptions).toHaveBeenCalledWith(
      { from: 'Lisbon', to: 'Pena Palace', departureDateIso: '2026-08-10' },
      'train',
    );
    expect(transportService.resolveTransportOptions).toHaveBeenCalledWith(
      { from: 'Pena Palace', to: 'Lisbon', departureDateIso: '2026-08-10' },
      'train',
    );
    expect(localTransport.resolveCandidates).not.toHaveBeenCalled();
    expect(result.satelliteLegs).toHaveLength(1);
    expect(result.satelliteLegs[0]!.bestOption.durationMinutes).toBe(95); // 45 + 50
    expect(result.satelliteLegs[0]!.bestOption.priceEur).toBe(24); // 12 + 12
    const activity = result.itinerary[0]!.activities[0]!;
    expect(activity.dayTripTransport).toBeDefined();
    expect(result.itinerary[0]!.transport).toHaveLength(1);
    // Satellite entries follow the same untagged convention as ordinary
    // inter-city legs — no isEstimate/source override.
    expect(result.itinerary[0]!.transport![0]).not.toHaveProperty('isEstimate');
  });

  it('skips resolution when the venue cannot be geocoded, without throwing', async () => {
    const itinerary = [makeDay([{ activity: 'Mystery outing', venue: 'Unknown Place', estimatedCostPerPerson: 10 }])];

    const result = await resolver.resolveForItinerary(itinerary, dateByDay, 'best');

    expect(localTransport.resolveCandidates).not.toHaveBeenCalled();
    expect(transportService.resolveTransportOptions).not.toHaveBeenCalled();
    expect(result.itinerary[0]!.activities[0]).toEqual(itinerary[0]!.activities[0]);
    expect(result.itinerary[0]!.transport).toBeUndefined();
  });

  it('skips placeholder activities (transit/check-in/rest) without geocoding', async () => {
    const itinerary = [
      makeDay([
        { activity: 'In transit from Porto', venue: 'Bus / Train / Car' },
        { activity: 'Check in and rest', venue: 'Hotel', estimatedCostPerPerson: 0 },
      ]),
    ];

    const result = await resolver.resolveForItinerary(itinerary, dateByDay, 'best');

    expect(places.geocodePlace).not.toHaveBeenCalled();
    expect(result.itinerary[0]!.activities).toEqual(itinerary[0]!.activities);
  });

  it('leaves an activity untouched when it has no venue field', async () => {
    const itinerary = [makeDay([{ activity: 'Free time' }])];

    const result = await resolver.resolveForItinerary(itinerary, dateByDay, 'best');

    expect(places.geocodePlace).not.toHaveBeenCalled();
    expect(result.itinerary[0]!.activities[0]).toEqual({ activity: 'Free time' });
  });
});
