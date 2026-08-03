<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Trip, TransportOption, TransportActivityData, BudgetBreakdown } from '~/types/index'
import type { TimelineDay, TimelineActivity } from '~/components/trip/Timeline.vue'
import type { RestrictionWarning } from '~/utils/itinerary'
import { formatTransportLabel } from '~/utils/itinerary'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const route     = useRoute()
const tripStore = useTripPlannerStore()
const authStore = useAuthStore()
const api       = useApi()

const tripId = computed(() => route.params.id as string)

const trip      = ref<Trip | null>(null)
const loading   = ref(true)
const error     = ref<string | null>(null)

// Raw proposal content extracted from proposals endpoint
type RawProposal = { agent: string; round: number; content: unknown }
const rawProposals = ref<RawProposal[]>([])

const statusColour: Record<Trip['status'], string> = {
  draft:       'var(--fg-3)',
  negotiating: 'var(--amber)',
  confirmed:   'var(--green)',
  completed:   'var(--green)',
  cancelled:   'var(--red)',
}

function extractItinerary(proposals: RawProposal[]): TimelineDay[] {
  // Priority: orchestrator refine (highest round with itinerary) > orchestrator propose
  const withItinerary = proposals
    .filter((p) => {
      const c = p.content as Record<string, unknown> | null
      return p.agent === 'orchestrator' && Array.isArray(c?.['itinerary'])
    })
    .sort((a, b) => b.round - a.round)

  const source = withItinerary[0]
  if (!source) return []

  const content = source.content as Record<string, unknown>
  const rawDays = content['itinerary'] as Array<Record<string, unknown>>

  return rawDays.map((d, i) => {
    const rawActivities = Array.isArray(d['activities'])
      ? (d['activities'] as Array<Record<string, unknown>>)
      : []

    const activities: TimelineActivity[] = rawActivities.map((a) => ({
      name:         String(a['activity'] ?? a['name'] ?? ''),
      location:     String(a['venue'] ?? a['location'] ?? ''),
      venue:        a['venue'] != null ? String(a['venue']) : undefined,
      city:         a['city'] != null ? String(a['city']) : (d['city'] != null ? String(d['city']) : undefined),
      country:      a['country'] != null ? String(a['country']) : (d['country'] != null ? String(d['country']) : undefined),
      time:         a['time'] != null ? String(a['time']) : undefined,
      cost:         typeof a['estimatedCostPerPerson'] === 'number'
        ? a['estimatedCostPerPerson']
        : (typeof a['cost'] === 'number' ? a['cost'] : undefined),
      ownerAgent:   a['ownerAgent'] != null ? String(a['ownerAgent']) : (a['agent'] != null ? String(a['agent']) : undefined),
      notes:        a['description'] != null ? String(a['description']) : (a['notes'] != null ? String(a['notes']) : undefined),
      weatherAlert: a['weatherAlert'] != null ? String(a['weatherAlert']) : undefined,
    }))

    const rawTransition = d['cityTransition'] as Record<string, unknown> | undefined

    // Inject transport card from day.transport (stamped by injectRouteGraphTransport in WorkflowEngine)
    const rawTransportArr = Array.isArray(d['transport']) ? d['transport'] as Array<Record<string, unknown>> : []
    const rt = rawTransportArr[0]
    if (rt && typeof rt['mode'] === 'string' && typeof rt['durationMinutes'] === 'number' && (rt['durationMinutes'] as number) > 0 && rawTransition?.['to']) {
      const best: TransportOption = {
        mode:            rt['mode'] as TransportOption['mode'],
        provider:        typeof rt['provider'] === 'string' ? rt['provider'] : undefined,
        durationMinutes: rt['durationMinutes'] as number,
        departureTime:   typeof rt['departureTime'] === 'string' ? rt['departureTime'] : undefined,
        arrivalTime:     typeof rt['arrivalTime'] === 'string' ? rt['arrivalTime'] : undefined,
        priceEur:        typeof rt['priceEur'] === 'number' ? rt['priceEur'] : undefined,
        flightNumber:    typeof rt['flightNumber'] === 'string' ? rt['flightNumber'] : undefined,
        trainLine:       typeof rt['trainLine'] === 'string' ? rt['trainLine'] : undefined,
        warnings:        Array.isArray(rt['warnings']) ? rt['warnings'] as string[] : [],
        segments:        Array.isArray(rt['segments']) ? rt['segments'] as TransportOption['segments'] : undefined,
        displaySummary:  typeof rt['displaySummary'] === 'string' ? rt['displaySummary'] : undefined,
        originAirport:   typeof rt['originAirport'] === 'string' ? rt['originAirport'] : undefined,
        destinationAirport: typeof rt['destinationAirport'] === 'string' ? rt['destinationAirport'] : undefined,
        fromStop:        typeof rt['fromStop'] === 'string' ? rt['fromStop'] : undefined,
        toStop:          typeof rt['toStop'] === 'string' ? rt['toStop'] : undefined,
      }
      const alts = Array.isArray(rt['alternatives']) ? rt['alternatives'] as TransportOption[] : []
      const to = String(rawTransition['to'])
      const transportData: TransportActivityData = { to, selectedOption: best, alternatives: alts }
      // The journey card anchors where the travel begins on this day: the
      // first transit placeholder — "In transit" (arrival day) or "Check out
      // and depart" (late-departure day owned by the origin city).
      const firstTransit = activities.find((a) => /in transit|check out and depart/i.test(a.name))
      activities.push({
        name:          formatTransportLabel(best, to),
        time:          firstTransit?.time ?? best.departureTime ?? 'morning',
        transportData,
      })
    }

    return {
      day:  typeof d['day'] === 'number' ? d['day'] : i + 1,
      date: d['date'] != null ? String(d['date']) : undefined,
      city: d['city'] != null ? String(d['city']) : undefined,
      country: d['country'] != null ? String(d['country']) : undefined,
      cityTransition: rawTransition
        ? { to: String(rawTransition['to'] ?? ''), travelTime: String(rawTransition['travelTime'] ?? '') }
        : undefined,
      activities,
    }
  })
}

const timelineDays = computed((): TimelineDay[] => extractItinerary(rawProposals.value))

// The merged itinerary (agent 'orchestrator') is where WorkflowEngine.executeMerge
// attaches post-merge, non-LLM-proposal data — restrictionWarnings, weatherAssessment
// (and its suggestedDates for flexible trips). Real activities+dates only exist once
// this proposal is saved, so none of that data lives on the earlier 'logistics'
// proposal (that one is just the /plan route-graph).
const latestMergedContent = computed((): Record<string, unknown> | null => {
  const withItinerary = rawProposals.value
    .filter((p) => {
      const c = p.content as Record<string, unknown> | null
      return p.agent === 'orchestrator' && Array.isArray(c?.['itinerary'])
    })
    .sort((a, b) => b.round - a.round)
  return (withItinerary[0]?.content as Record<string, unknown> | null) ?? null
})

const suggestedDates = computed(() => {
  if (trip.value?.dateInput?.mode !== 'flexible') return null
  const weatherAssessment = latestMergedContent.value?.['weatherAssessment'] as Record<string, unknown> | undefined
  const sd = weatherAssessment?.['suggestedDates'] as Record<string, unknown> | undefined
  if (!sd?.['startDate'] || !sd?.['endDate']) return null
  return {
    startDate: String(sd['startDate']),
    endDate:   String(sd['endDate']),
    rationale: sd['rationale'] ? String(sd['rationale']) : null,
  }
})

const currencySymbol = computed(() =>
  trip.value?.budgetCurrency === 'USD' ? '$' : '€',
)

// Itemised per-category, per-person budget breakdown (issue #73).
const budgetBreakdown = computed<BudgetBreakdown | null>(() => {
  const fp = rawProposals.value.find((p) => p.agent === 'finance')
  const c = fp?.content as Record<string, unknown> | null
  const bd = c?.['budgetBreakdown'] as BudgetBreakdown | undefined
  return bd ?? null
})

const restrictionWarnings = computed((): RestrictionWarning[] => {
  const c = latestMergedContent.value
  return Array.isArray(c?.['restrictionWarnings'])
    ? (c['restrictionWarnings'] as RestrictionWarning[])
    : []
})

const handleRefine = (): void => {
  if (trip.value && !tripStore.lastInput) {
    tripStore.setLastInput({
      name:           trip.value.name,
      region:         trip.value.region,
      startDate:      trip.value.startDate,
      endDate:        trip.value.endDate,
      budgetTotal:    trip.value.budgetTotal,
      budgetCurrency: trip.value.budgetCurrency,
      travellers:     [],
    })
  }
  navigateTo('/planner')
}

onMounted(async () => {
  loading.value = true
  error.value   = null
  try {
    const { data } = await api.get<{ success: boolean; data: Trip }>(`/api/v1/trips/${tripId.value}`)
    trip.value = data.data

    if (trip.value.status === 'confirmed' || trip.value.status === 'completed') {
      try {
        const { data: pData } = await api.get<{ success: boolean; data: RawProposal[] }>(
          `/api/v1/trips/${tripId.value}/proposals`,
        )
        rawProposals.value = Array.isArray(pData.data) ? pData.data : []
      } catch {
        // proposals missing — page still loads, shows empty state
      }
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to load trip'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="min-h-screen bg-bg-0 text-fg-0">
    <!-- Header -->
    <header class="border-b border-line-2 px-6 py-4 flex items-center justify-between">
      <AppLogo :size="20" />
      <div class="flex items-center gap-4">
        <ThemeToggle />
        <LanguageSwitcher />
        <NuxtLink to="/dashboard" class="btn text-13">← Dashboard</NuxtLink>
        <NuxtLink
          v-if="authStore.isAdmin && trip"
          :to="`/admin/${trip.id}`"
          class="btn text-13"
          style="color:var(--amber);border-color:var(--amber-line);font-family:var(--mono)"
        >Debug view</NuxtLink>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-32">
      <span class="helper pulse-green">Loading trip…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="px-6 py-10">
      <div class="card" style="border-color:rgba(255,93,93,0.32)">
        <p class="text-danger text-13">{{ error }}</p>
      </div>
    </div>

    <!-- Trip content -->
    <main v-else-if="trip" class="px-6 py-10">

      <!-- Trip header -->
      <div class="mb-8">
        <div class="flex items-start justify-between gap-4 mb-2 flex-wrap">
          <div>
            <div class="sec-eyebrow mb-1">Trip results</div>
            <h1 style="font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em;margin:0">
              {{ trip.name }}
            </h1>
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            <span
              class="badge font-mono"
              :style="`color:${statusColour[trip.status]};background:transparent;border-color:${statusColour[trip.status]}33`"
            >{{ trip.status }}</span>
            <button
              class="btn btn-primary"
              data-testid="refine-trip-btn"
              @click="handleRefine"
            >
              ← Refine trip
            </button>
          </div>
        </div>

        <!-- Meta row -->
        <div class="flex flex-wrap gap-4 mt-3" style="font-family:var(--mono);font-size:var(--t-12);color:var(--fg-3)">
          <span>{{ trip.region }}</span>
          <span>{{ trip.startDate }} → {{ trip.endDate }}</span>
          <span>{{ trip.budgetCurrency }} {{ trip.budgetTotal.toLocaleString() }} budget</span>
        </div>

        <!-- Flexible dates: suggested window + rationale -->
        <div
          v-if="suggestedDates"
          style="margin-top:var(--s-3);padding:var(--s-3) var(--s-4);background:var(--bg-2);border:var(--hair);border-radius:var(--r-2);font-size:var(--t-13);color:var(--fg-2);line-height:1.5"
        >
          <span style="font-family:var(--mono);font-size:var(--t-11);text-transform:uppercase;letter-spacing:.06em;color:var(--green);margin-right:var(--s-2)">suggested window</span>
          {{ suggestedDates.startDate }} – {{ suggestedDates.endDate }}<span v-if="suggestedDates.rationale" style="color:var(--fg-3)"> · {{ suggestedDates.rationale }}</span>
        </div>
      </div>

      <!-- Itinerary -->
      <div v-if="trip.status === 'confirmed' || trip.status === 'completed'">
        <div v-if="timelineDays.length > 0">
          <div class="sec-eyebrow mb-4">Itinerary</div>
          <TripTimeline
            :days="timelineDays"
            :restriction-warnings="restrictionWarnings"
            :currency-symbol="currencySymbol"
          />
        </div>
        <div v-else class="card" style="padding:var(--s-6);text-align:center">
          <p class="helper">Itinerary data is not available for this trip.</p>
        </div>

        <div v-if="budgetBreakdown" class="mt-8">
          <div class="sec-eyebrow mb-4">Budget breakdown</div>
          <TripBudgetBreakdown :breakdown="budgetBreakdown" />
        </div>
      </div>

      <!-- Non-confirmed state -->
      <div v-else class="card" style="padding:var(--s-6);text-align:center">
        <p class="helper">
          {{ trip.status === 'negotiating' ? 'Agents are still building this itinerary…' : 'No itinerary available.' }}
        </p>
      </div>

      <!-- Refine CTA (bottom) -->
      <div class="mt-10 pt-6 border-t border-line-2 flex items-center justify-between flex-wrap gap-4">
        <div>
          <p style="font-size:var(--t-15);font-weight:500;margin:0">Not quite right?</p>
          <p style="font-size:var(--t-13);color:var(--fg-3);margin:4px 0 0">
            Adjust your preferences and re-plan. A new trip will be created.
          </p>
        </div>
        <button
          class="btn btn-primary"
          @click="handleRefine"
        >← Refine trip</button>
      </div>

    </main>
  </div>
</template>
