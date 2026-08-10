<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import { PERSONA_LABELS, PERSONA_AGENT, AGENT_COLOURS } from '~/types/index'
import type { Persona, Flexibility, Currency, DateWindow, DateInput, CreateTripInput, TravellerInput, TravellerScore, TransportMode, TransportOption, TransportActivityData, BudgetBreakdown, ItineraryDay, ItineraryActivity, ItineraryCityTransition } from '~/types/index'
import { formatTransportLabel } from '~/utils/itinerary'
import type { RestrictionWarning } from '~/utils/itinerary'

const props = withDefaults(defineProps<{ viewTripId?: string }>(), { viewTripId: undefined })

const emit = defineEmits<{
  success: [tripId: string]
  cancel: []
}>()

// ── Auth ─────────────────────────────────────────────────────
const { t: translate } = useI18n()
const authStore = useAuthStore()

// ── Wizard step ───────────────────────────────────────────────
const step = ref<1 | 2 | 3 | 4 | 5>(1)

// ── Step 1: Traveller composition ────────────────────────────

interface TravellerDraft {
  id: string
  name: string
  isCurrentUser: boolean
  persona: Persona | null
  flexibility: Flexibility
}

const nextId = (() => {
  let n = 0
  return () => `t-${++n}`
})()

const currentUserName = computed(() => authStore.user?.name ?? 'You')
const currentUserId = computed(() => authStore.user?.id ?? 'current-user')

const travellers = ref<TravellerDraft[]>([
  {
    id: nextId(),
    name: currentUserName.value,
    isCurrentUser: true,
    persona: null,
    flexibility: 'medium',
  },
])

const addTraveller = (): void => {
  if (travellers.value.length >= 4) return
  travellers.value.push({ id: nextId(), name: '', isCurrentUser: false, persona: null, flexibility: 'medium' })
}

const removeTraveller = (id: string): void => {
  travellers.value = travellers.value.filter((t) => t.id !== id)
}

const setPersona = (id: string, persona: Persona): void => {
  const t = travellers.value.find((t) => t.id === id)
  if (t) t.persona = t.persona === persona ? null : persona
}

const setFlexibility = (id: string, flex: Flexibility): void => {
  const t = travellers.value.find((t) => t.id === id)
  if (t) t.flexibility = flex
}

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name.slice(0, 2).toUpperCase() || '?')
}

const step1Valid = computed(() =>
  travellers.value.length >= 1 &&
  travellers.value.every((t) => t.name.trim() !== '' && t.persona !== null),
)

// ── Step 2: Trip brief ────────────────────────────────────────

const tripName    = ref('')
const region      = ref('')
const startDate   = ref('')
const endDate     = ref('')
const budgetTotal    = ref(3000)
const budgetCurrency = ref<Currency>('EUR')
const currencySymbol = computed(() => budgetCurrency.value === 'EUR' ? '€' : '$')
const tripFlexibility = ref<Flexibility>('medium')

// Flexible date mode
const dateMode       = ref<'fixed' | 'flexible'>('fixed')
const flexDays       = ref(7)
const preferredMonth = ref('')
const flexWindow     = ref<DateWindow>('moderate')

const mustHaveInput  = ref('')
const mustHaves      = ref<string[]>([])
const avoidInput = ref('')
const avoids     = ref<string[]>([])

const transportPreference = ref<TransportMode>('best')

const TRANSPORT_OPTIONS = computed(() => [
  { value: 'flight' as TransportMode, label: translate('trip.form.step2.transportOptions.flight'), icon: '✈️' },
  { value: 'train'  as TransportMode, label: translate('trip.form.step2.transportOptions.train'),  icon: '🚆' },
  { value: 'car'    as TransportMode, label: translate('trip.form.step2.transportOptions.car'),    icon: '🚗' },
  { value: 'best'   as TransportMode, label: translate('trip.form.step2.transportOptions.best'),   icon: '⭐' },
])

const nights = computed(() => {
  if (!startDate.value || !endDate.value) return 0
  const ms = new Date(endDate.value).getTime() - new Date(startDate.value).getTime()
  return Math.max(0, Math.round(ms / 86_400_000))
})

watch(startDate, (newStart) => {
  if (endDate.value && endDate.value < newStart) endDate.value = newStart
})

const budgetPercent = computed(() =>
  Math.round(((budgetTotal.value - 500) / (20_000 - 500)) * 100),
)

const addMustHave = (): void => {
  const v = mustHaveInput.value.trim()
  if (v && !mustHaves.value.includes(v)) mustHaves.value.push(v)
  mustHaveInput.value = ''
}

const removeMustHave = (v: string): void => {
  mustHaves.value = mustHaves.value.filter((x) => x !== v)
}

const addAvoid = (): void => {
  const v = avoidInput.value.trim()
  if (v && !avoids.value.includes(v)) avoids.value.push(v)
  avoidInput.value = ''
}

const removeAvoid = (v: string): void => {
  avoids.value = avoids.value.filter((x) => x !== v)
}

const step2Valid = computed(() =>
  tripName.value.trim() !== '' &&
  region.value.trim() !== '' &&
  (dateMode.value === 'fixed'
    ? startDate.value !== '' && endDate.value !== '' && nights.value > 0
    : flexDays.value > 0
  ) &&
  budgetTotal.value > 0,
)

// ── Validation attempt flags ──────────────────────────────────
const step1Attempted = ref(false)
const step2Attempted = ref(false)

const goToStep2 = (): void => {
  step1Attempted.value = true
  if (step1Valid.value) { step1Attempted.value = false; step.value = 2 }
}

// ── Submit → enters step 3 ────────────────────────────────────

const store = useTripPlannerStore()
const api   = useApi()

// ── Destination preview (option-1 hybrid): echo what the system understood ──
interface ParsedDestination { city: string; country: string; nights: number }
const parsedDestinations = ref<ParsedDestination[]>([])
let previewTimer: ReturnType<typeof setTimeout> | null = null

const previewDays = computed(() => (dateMode.value === 'flexible' ? flexDays.value : nights.value))

watch([region, previewDays], () => {
  if (previewTimer) clearTimeout(previewTimer)
  const r = region.value.trim()
  const days = previewDays.value
  if (!r || days < 1) { parsedDestinations.value = []; return }
  previewTimer = setTimeout(() => { void fetchDestinationPreview(r, days) }, 500)
})

const fetchDestinationPreview = async (regionText: string, days: number): Promise<void> => {
  try {
    const resp = await api.post<{ success: boolean; data: { destinations: ParsedDestination[] } }>(
      '/api/v1/trips/preview-destinations',
      { region: regionText, days },
    )
    parsedDestinations.value = resp.data.data.destinations
  } catch { /* preview is best-effort */ }
}

const activeTripId = ref<string | null>(null)

// Step 3 needs a viewport-bound flex column so its 3 negotiate columns can
// scroll internally instead of growing the whole page. Other steps keep the
// plain block layout (natural page scroll) untouched.
const wizardRootStyle = computed(() => {
  const base = 'border: var(--hair); background: var(--bg-2);'
  return step.value === 3
    ? `${base}height:100vh;display:flex;flex-direction:column;overflow:hidden;`
    : base
})

// Reopen existing confirmed trip directly at step 4, or pre-fill from lastInput
onMounted(() => {
  if (isValidUUID(props.viewTripId)) {
    activeTripId.value = props.viewTripId
    negotiationStatus.value = 'confirmed'
    step.value = 4
    startNegotiationPolling(props.viewTripId)
  } else if (store.lastInput) {
    const li = store.lastInput
    tripName.value       = li.name
    region.value         = li.region ?? ''
    budgetTotal.value    = li.budgetTotal
    budgetCurrency.value = li.budgetCurrency
    // Restore date input — guard against old localStorage shape lacking dateInput
    const di = li.dateInput as DateInput | undefined
    if (di?.mode === 'flexible') {
      dateMode.value       = 'flexible'
      flexDays.value       = di.days
      preferredMonth.value = di.preferredMonth
      flexWindow.value     = di.window
    } else if (di?.mode === 'fixed') {
      dateMode.value  = 'fixed'
      startDate.value = di.startDate
      endDate.value   = di.endDate
    } else {
      // Legacy shape: startDate/endDate at top level
      const legacy = li as unknown as { startDate?: string; endDate?: string }
      startDate.value = legacy.startDate ?? ''
      endDate.value   = legacy.endDate ?? ''
    }
    if (li.transportPreference) {
      transportPreference.value = li.transportPreference as TransportMode
    }
    // The brief is trip-level. Fall back to traveller[0] so a lastInput written
    // before the move still pre-fills, and union the legacy `dealBreakers` key,
    // mirroring normalizePreferences() on the backend.
    const brief = li.preferences ?? li.travellers[0]?.preferences
    if (brief) {
      tripFlexibility.value = brief.pace ?? 'medium'
      mustHaves.value       = [...(brief.mustHaves ?? [])]
      avoids.value          = [...new Set([
        ...(brief.avoids ?? []),
        ...((brief as { dealBreakers?: string[] }).dealBreakers ?? []),
      ])]
    }
    if (li.travellers.length > 0) {
      travellers.value = li.travellers.map((t, i) => ({
        id: nextId(),
        name: t.name ?? (i === 0 ? currentUserName.value : ''),
        isCurrentUser: i === 0,
        persona: t.preferences.persona,
        flexibility: t.preferences.flexibility,
      }))
    }
  }
})

const submit = async (): Promise<void> => {
  if (!step1Valid.value || !step2Valid.value) return

  const payload: CreateTripInput = {
    name:                tripName.value.trim(),
    region:              region.value.trim(),
    dateInput:           dateMode.value === 'fixed'
      ? { mode: 'fixed', startDate: startDate.value, endDate: endDate.value }
      : { mode: 'flexible', days: flexDays.value, preferredMonth: preferredMonth.value || undefined, window: flexWindow.value },
    budgetTotal:         budgetTotal.value,
    budgetCurrency:      budgetCurrency.value,
    transportPreference: transportPreference.value,
    // Sent once for the whole trip — not copied into every traveller.
    preferences: {
      pace:      tripFlexibility.value,
      mustHaves: mustHaves.value,
      avoids:    avoids.value,
    },
    travellers:          travellers.value.map((t): TravellerInput => ({
      userId: t.isCurrentUser ? currentUserId.value : undefined,
      name:   t.name,
      preferences: {
        persona:      t.persona!,
        flexibility:  t.flexibility,
        dietary:      [],
        constraints:  [],
      },
    })),
  }

  try {
    const tripId = await store.createTrip(payload)
    activeTripId.value = tripId
    step.value = 3
    startNegotiationPolling(tripId)
  } catch {
    // error surfaced via store.error
  }
}

const attemptSubmit = async (): Promise<void> => {
  step2Attempted.value = true
  if (!step2Valid.value) return
  step2Attempted.value = false
  await submit()
}

// ── Step 3: Negotiate (polling) ───────────────────────────────

interface ProposalEntry {
  id: string
  agent: string
  round: number
  content: Record<string, unknown>
  createdAt: string
}

const liveProposals    = ref<ProposalEntry[]>([])
const negotiationStatus = ref<string>('negotiating')
const rejectionReason  = ref<string>('')
let pollInterval: ReturnType<typeof setInterval> | null = null

const startNegotiationPolling = (tripId: string): void => {
  const poll = async (): Promise<void> => {
    try {
      const [tripResp, propResp] = await Promise.all([
        api.get<{ success: boolean; data: { status: string; rejectionReason?: string | null } }>(`/api/v1/trips/${tripId}`),
        api.get<{ success: boolean; data: ProposalEntry[] }>(`/api/v1/trips/${tripId}/proposals`),
      ])
      negotiationStatus.value = tripResp.data.data.status
      liveProposals.value = propResp.data.data

      if (negotiationStatus.value === 'confirmed') {
        stopPolling()
        setTimeout(() => { step.value = 4 }, 800)
      } else if (negotiationStatus.value === 'rejected') {
        // Budget impossible — agents could not reach a bookable plan. Ask to reformulate.
        rejectionReason.value = tripResp.data.data.rejectionReason
          || translate('trip.form.errors.rejectionFallback')
        stopPolling()
      } else if (negotiationStatus.value === 'cancelled') {
        stopPolling()
      }
    } catch { /* ignore transient errors */ }
  }
  void poll()
  pollInterval = setInterval(() => void poll(), 3000)
}

const stopPolling = (): void => {
  if (pollInterval !== null) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

onUnmounted(() => stopPolling())

// ── Step 4: Itinerary review ──────────────────────────────────

type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'unscheduled'
const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  morning:     '🌅 Morning',
  afternoon:   '☀️ Afternoon',
  evening:     '🌙 Evening',
  unscheduled: '📍 Activities',
}
const TIME_SLOT_ORDER: TimeSlot[] = ['morning', 'afternoon', 'evening', 'unscheduled']

function getTimeSlot(time?: string): TimeSlot {
  if (!time) return 'unscheduled'
  const t = time.toLowerCase()
  if (t.includes('morn')) return 'morning'
  if (t.includes('after') || t.includes('noon')) return 'afternoon'
  if (t.includes('even') || t.includes('night')) return 'evening'
  const hourMatch = t.match(/^(\d{1,2})[:h]/)
  if (hourMatch) {
    const h = parseInt(hourMatch[1], 10)
    if (h >= 6 && h < 12) return 'morning'
    if (h >= 12 && h < 18) return 'afternoon'
    if (h >= 18 || h < 6) return 'evening'
  }
  return 'unscheduled'
}

const latestByAgent = computed((): Record<string, ProposalEntry> => {
  const map: Record<string, ProposalEntry> = {}
  for (const p of liveProposals.value) {
    const existing = map[p.agent]
    if (!existing || p.round > existing.round) map[p.agent] = p
  }
  return map
})

function extractJson(raw: string): unknown | null {
  // 1. Direct parse
  try { return JSON.parse(raw) } catch { /* */ }
  // 2. Strip ``` fences with simple replace (most reliable)
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try { return JSON.parse(stripped) } catch { /* */ }
  // 3. Grab first { ... } block (greedy — handles extra text around JSON)
  const m = raw.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* */ } }
  return null
}

function buildDays(obj: unknown): ItineraryDay[] {
  if (!obj || typeof obj !== 'object') return []
  const o = obj as Record<string, unknown>
  const arr = o['itinerary'] ?? o['days'] ?? o['plan'] ?? o['schedule']
  if (!Array.isArray(arr) || arr.length === 0) return []
  return (arr as Array<Record<string, unknown>>).map((d, i) => {
    const rawTransition = d['cityTransition']
    const rt = rawTransition as Record<string, unknown> | null | undefined
    const cityTransition: ItineraryCityTransition | undefined =
      rt && typeof rt === 'object'
        ? {
            to:        String(rt['to'] ?? ''),
            travelTime: String(rt['travelTime'] ?? ''),
          }
        : undefined

    return {
      day:  typeof d['day'] === 'number' ? d['day'] : i + 1,
      date: typeof d['date'] === 'string' ? d['date'] : undefined,
      city:    typeof d['city'] === 'string' && d['city'].trim() ? d['city'].trim() : undefined,
      country: typeof d['country'] === 'string' && d['country'].trim() ? d['country'].trim() : undefined,
      cityTransition: cityTransition?.to ? cityTransition : undefined,
      rawTransport: Array.isArray(d['transport'])
        ? (d['transport'] as Array<Record<string, unknown>>)
        : undefined,
      activities: Array.isArray(d['activities'])
        ? (d['activities'] as Array<Record<string, unknown>>).map((a) => ({
            name:         String(a['name'] ?? a['activity'] ?? a['title'] ?? '—'),
            time:         typeof a['time'] === 'string' ? a['time'] : typeof a['startTime'] === 'string' ? a['startTime'] : undefined,
            location:     (typeof a['location'] === 'string' && a['location'].trim())
                            ? a['location'].trim()
                            : (typeof a['venue'] === 'string' && a['venue'].trim() ? a['venue'].trim() : undefined),
            venue:        typeof a['venue'] === 'string' && a['venue'].trim() ? a['venue'].trim() : undefined,
            city:         typeof a['city'] === 'string' && a['city'].trim() ? a['city'].trim() : undefined,
            country:      typeof a['country'] === 'string' && a['country'].trim() ? a['country'].trim() : undefined,
            ownerAgent:   typeof a['ownerAgent'] === 'string' && a['ownerAgent'].trim() ? a['ownerAgent'].trim() : undefined,
            notes:        typeof a['notes'] === 'string' ? a['notes'] : typeof a['description'] === 'string' ? a['description'] : undefined,
            cost:         typeof a['cost'] === 'number' ? a['cost'] : undefined,
            weatherAlert: typeof a['weatherAlert'] === 'string' ? a['weatherAlert'] : undefined,
            satisfies:    Array.isArray(a['satisfies']) ? (a['satisfies'] as string[]) : undefined,
          }))
        : [],
      meals: Array.isArray(d['meals'])
        ? (d['meals'] as Array<Record<string, unknown>>).map((m) => ({ type: String(m['type'] ?? 'meal'), name: String(m['name'] ?? '—') }))
        : undefined,
    }
  })
}


const parsedItinerary = computed((): ItineraryDay[] => {
  // Try every possible way to extract ItineraryDay[] from a proposal
  const tryExtract = (content: Record<string, unknown>): ItineraryDay[] => {
    // 1. Content has itinerary key directly
    const d1 = buildDays(content)
    if (d1.length > 0) return d1

    // 2. Content has { raw: "string" } — try several parse strategies
    const rawVal = content['raw']
    if (typeof rawVal !== 'string') return []
    const r = rawVal as string

    // 2a. Strip code fences then parse (works when Claude's JSON is complete)
    const stripped = r.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    try { const d = buildDays(JSON.parse(stripped) as unknown); if (d.length > 0) return d } catch { /* */ }

    // 2b. Direct parse of raw string (no fences)
    try { const d = buildDays(JSON.parse(r) as unknown); if (d.length > 0) return d } catch { /* */ }

    // 2c. String-aware extraction of "itinerary": [...] — handles [] inside string values
    //     and partial JSON by collecting complete objects individually
    const itKey = r.indexOf('"itinerary"')
    if (itKey !== -1) {
      const arrStart = r.indexOf('[', itKey)
      if (arrStart !== -1) {
        const items: unknown[] = []
        let pos = arrStart + 1
        while (pos < r.length) {
          while (pos < r.length && /[ \t\r\n,]/.test(r[pos]!)) pos++
          if (pos >= r.length || r[pos] === ']') break
          if (r[pos] !== '{') break
          let depth = 0; let objEnd = -1; let inStr = false; let esc = false
          for (let j = pos; j < r.length; j++) {
            const ch = r[j]!
            if (esc) { esc = false; continue }
            if (ch === '\\' && inStr) { esc = true; continue }
            if (ch === '"') { inStr = !inStr; continue }
            if (!inStr) {
              if (ch === '{') depth++
              else if (ch === '}') { depth--; if (depth === 0) { objEnd = j + 1; break } }
            }
          }
          if (objEnd === -1) break
          try { items.push(JSON.parse(r.slice(pos, objEnd))) } catch { /* skip malformed */ }
          pos = objEnd
        }
        if (items.length > 0) {
          const d = buildDays({ itinerary: items })
          if (d.length > 0) return d
        }
      }
    }

    return []
  }

  // Prefer orchestrator proposals, highest round first
  for (const p of [...liveProposals.value].filter(x => x.agent === 'orchestrator').sort((a, b) => b.round - a.round)) {
    const d = tryExtract(p.content)
    if (d.length > 0) return d
  }

  // Fallback: any other agent
  for (const agent of ['validator', 'logistics', 'finance', 'alice', 'bob', 'carlos', 'diana'] as const) {
    const p = latestByAgent.value[agent]
    if (p) { const d = tryExtract(p.content); if (d.length > 0) return d }
  }

  return []
})

// Enriches parsedItinerary with transport activities.
// Priority: day.transport from orchestrator proposal (set by mergeTransportIntoProposal
// with confirmed pre-resolved legs) > logistics content transportOptions.
const timelineDays = computed((): ItineraryDay[] => {
  const logisticsContent = latestByAgent.value['logistics']?.content as Record<string, unknown> | undefined
  const rawTransportOpts = logisticsContent?.['transportOptions'] as Record<number, TransportOption[]> | undefined

  return parsedItinerary.value.map((day) => {
    const ct = day.cityTransition
    if (!ct?.to) return day

    // Try orchestrator's day.transport first (has confirmed legs + real alternatives)
    let best: TransportOption | undefined
    let rest: TransportOption[] = []

    const rt = day.rawTransport?.[0]
    if (rt && typeof rt['mode'] === 'string' && typeof rt['durationMinutes'] === 'number' && rt['durationMinutes'] > 0) {
      best = {
        mode: rt['mode'] as TransportOption['mode'],
        provider: typeof rt['provider'] === 'string' ? rt['provider'] : undefined,
        durationMinutes: rt['durationMinutes'] as number,
        departureTime: typeof rt['departureTime'] === 'string' ? rt['departureTime'] : undefined,
        arrivalTime: typeof rt['arrivalTime'] === 'string' ? rt['arrivalTime'] : undefined,
        priceEur: typeof rt['priceEur'] === 'number' ? rt['priceEur'] : undefined,
        flightNumber: typeof rt['flightNumber'] === 'string' ? rt['flightNumber'] : undefined,
        trainLine: typeof rt['trainLine'] === 'string' ? rt['trainLine'] : undefined,
        warnings: Array.isArray(rt['warnings']) ? (rt['warnings'] as string[]) : [],
        segments: Array.isArray(rt['segments']) ? (rt['segments'] as TransportOption['segments']) : undefined,
        displaySummary: typeof rt['displaySummary'] === 'string' ? rt['displaySummary'] : undefined,
        originAirport: typeof rt['originAirport'] === 'string' ? rt['originAirport'] : undefined,
        destinationAirport: typeof rt['destinationAirport'] === 'string' ? rt['destinationAirport'] : undefined,
        fromStop: typeof rt['fromStop'] === 'string' ? rt['fromStop'] : undefined,
        toStop: typeof rt['toStop'] === 'string' ? rt['toStop'] : undefined,
      }
      rest = Array.isArray(rt['alternatives']) ? (rt['alternatives'] as TransportOption[]) : []
    } else {
      // Fall back to logistics transportOptions (keyed by day number)
      const opts = rawTransportOpts?.[day.day]
      if (!opts || opts.length === 0) return day
      const [b, ...r] = opts
      if (!b || b.durationMinutes === 0) return day
      best = b
      rest = r
    }

    if (!best) return day
    // Anchor the journey card where the travel begins on this day: the first
    // transit placeholder — "In transit" (arrival day) or "Check out and
    // depart" (late-departure day owned by the origin city).
    const firstTransit = day.activities.find((a) => /in transit|check out and depart/i.test(a.name))
    const transportActivity: ItineraryActivity = {
      name:          formatTransportLabel(best, ct.to),
      time:          firstTransit?.time ?? best.departureTime ?? 'morning',
      transportData: { to: ct.to, selectedOption: best, alternatives: rest },
    }
    return { ...day, activities: [...day.activities, transportActivity] }
  })
})

const validatorSummary = computed(() => {
  const p = latestByAgent.value['validator']
  if (!p) return null
  const c = p.content
  const fairness  = c['fairness']   as Record<string, unknown> | undefined
  const scoring   = c['scoring']    as Record<string, unknown> | undefined
  const constr    = c['constraints'] as Record<string, unknown> | undefined
  const metrics   = c['metrics']    as Record<string, unknown> | undefined
  return {
    fairnessScore:     typeof fairness?.['fairnessScore']    === 'number' ? fairness['fairnessScore']    as number : null,
    overallScore:      typeof scoring?.['overallScore']      === 'number' ? scoring['overallScore']      as number : null,
    constraintsPassed: constr?.['passed'] === true ? true : constr?.['passed'] === false ? false : null as boolean | null,
    rounds:            typeof metrics?.['convergenceRounds'] === 'number' ? metrics['convergenceRounds'] as number : null,
  }
})

// Itemised per-category, per-person budget breakdown (issue #73). Older
// proposals won't have this field — the fallback cost-breakdown card below
// still covers those.
const budgetBreakdown = computed<BudgetBreakdown | null>(() => {
  const p = latestByAgent.value['finance']
  const bd = p?.content?.['budgetBreakdown'] as BudgetBreakdown | undefined
  return bd ?? null
})

// Real per-city nightly accommodation cost from the merged proposal — used by
// Step 4 v2 to apportion lodging cost across each day of a city stay (not
// otherwise present in timelineDays/buildDays, which only parses activities).
interface AccommodationBlock { city: string; pricePerNightPerPerson: number; nights: number }
const accommodationBlocks = computed<AccommodationBlock[]>(() => {
  const acc = latestOrchestratorContent.value?.['accommodation']
  if (!Array.isArray(acc)) return []
  return (acc as Array<Record<string, unknown>>)
    .map((a) => ({
      city: typeof a['city'] === 'string' ? a['city'] : '',
      pricePerNightPerPerson: typeof a['pricePerNightPerPerson'] === 'number' ? a['pricePerNightPerPerson'] : 0,
      nights: typeof a['nights'] === 'number' ? a['nights'] : 0,
    }))
    .filter((a) => a.city && a.pricePerNightPerPerson > 0)
})

// ── Step 4: Scores, cost breakdown, weather ───────────────────

// Per-traveller preference match, from the same validator proposal
// `validatorSummary` reads. The old lookup pinned round 6 and read
// `content.scores`; the validator runs at round 2 and nests the rows under
// `content.scoring.scores`, so it always came back empty and Step 4 silently
// fell back to the single group number.
const travellerScores = computed<TravellerScore[]>(() => {
  const scoring = latestByAgent.value['validator']?.content?.['scoring'] as Record<string, unknown> | undefined
  const rows = scoring?.['scores']
  if (!Array.isArray(rows)) return []
  // Rows written before the traveller-keyed rename have no travellerId/label —
  // drop them rather than render a blank row.
  return rows.filter((r): r is TravellerScore => {
    if (typeof r !== 'object' || r === null) return false
    const row = r as Record<string, unknown>
    return typeof row['travellerId'] === 'string'
      && typeof row['label'] === 'string'
      && typeof row['score'] === 'number'
  })
})

// WorkflowEngine.executeMerge attaches weatherAssessment to the merged
// itinerary (agent 'orchestrator') post-merge — the earlier 'logistics'
// proposal is just the /plan route-graph and never carries it.
const latestOrchestratorContent = computed((): Record<string, unknown> | null => {
  const withItinerary = [...liveProposals.value]
    .filter((p) => p.agent === 'orchestrator' && Array.isArray((p.content as Record<string, unknown> | null)?.['itinerary']))
    .sort((a, b) => b.round - a.round)
  return (withItinerary[0]?.content as Record<string, unknown> | null) ?? null
})

const weatherAssessment = computed<Record<string, unknown> | null>(() => {
  const wa = latestOrchestratorContent.value?.['weatherAssessment']
  return wa && typeof wa === 'object' ? (wa as Record<string, unknown>) : null
})

const weatherAlerts = computed<string[]>(() => {
  const c = weatherAssessment.value
  return Array.isArray(c?.['weatherAlerts']) ? (c['weatherAlerts'] as string[]) : []
})

const restrictionWarnings = computed((): RestrictionWarning[] => {
  const c = latestOrchestratorContent.value
  return Array.isArray(c?.['restrictionWarnings'])
    ? (c['restrictionWarnings'] as RestrictionWarning[])
    : []
})

const showWeather = computed(() => !(dateMode.value === 'flexible' && !preferredMonth.value))

// ── Step 4: Share link ────────────────────────────────────────

const shareLoading = ref(false)
const shareCopied  = ref(false)
const shareError   = ref<string | null>(null)

const handleShare = async (): Promise<void> => {
  if (!activeTripId.value) return
  shareLoading.value = true
  shareError.value = null
  try {
    const resp = await api.post<{ success: boolean; data: { shareUrl: string } }>(
      '/api/share/api/v1/share/generate',
      { tripId: activeTripId.value },
    )
    await navigator.clipboard.writeText(resp.data.data.shareUrl)
    shareCopied.value = true
    setTimeout(() => { shareCopied.value = false }, 2000)
  } catch {
    shareError.value = translate('trip.form.errors.shareFailed')
  } finally {
    shareLoading.value = false
  }
}

const handleRefine = (): void => {
  const currentInput: CreateTripInput = {
    name:           tripName.value,
    region:         region.value,
    startDate:      startDate.value,
    endDate:        endDate.value,
    budgetTotal:    budgetTotal.value,
    budgetCurrency: budgetCurrency.value,
    preferences: {
      pace:      tripFlexibility.value,
      mustHaves: mustHaves.value,
      avoids:    avoids.value,
    },
    travellers:     travellers.value.map((t): TravellerInput => ({
      userId: t.isCurrentUser ? currentUserId.value : undefined,
      name:   t.name,
      preferences: {
        persona:      t.persona ?? 'culture',
        flexibility:  t.flexibility,
        dietary:      [],
        constraints:  [],
      },
    })),
  }
  store.setLastInput(currentInput)
  activeTripId.value = null
  step.value = 1
}

const handleAccept = (): void => { step.value = 5 }
const handleReject = async (): Promise<void> => {
  if (activeTripId.value) {
    try {
      await api.patch(`/api/v1/trips/${activeTripId.value}/status`, { status: 'cancelled' })
    } catch { /* best-effort — proceed regardless */ }
  }
  stopPolling()
  emit('cancel')
}

// ── Step 5: Export ────────────────────────────────────────────

const exportLoading = ref(false)
const exportError   = ref<string | null>(null)

const emailTo          = ref(authStore.user?.email ?? '')
const sendEmailLoading = ref(false)
const sendEmailError   = ref<string | null>(null)
const sendEmailSuccess = ref(false)

const buildExportPayload = (): Record<string, unknown> => ({
  tripId: activeTripId.value,
  itinerary: {
    tripName:       tripName.value,
    tripId:         activeTripId.value,
    startDate:      startDate.value || undefined,
    endDate:        endDate.value || undefined,
    budgetTotal:    budgetTotal.value,
    budgetCurrency: budgetCurrency.value,
    travellers:     travellers.value.map((t) => ({ name: t.name })),
    weather: weatherAlerts.value.length > 0
      ? { alerts: weatherAlerts.value }
      : undefined,
    days: parsedItinerary.value.map((d) => ({
      day:        d.day,
      date:       d.date,
      activities: d.activities.map((a) => ({
        name:     a.name,
        location: a.location,
        duration: a.time,
        notes:    a.notes,
      })),
      meals: d.meals?.map((m) => ({ type: m.type, name: m.name })),
      transport: d.rawTransport?.map((t) => ({
        from:           t['from'] as string,
        to:             t['to'] as string,
        mode:           t['mode'] as string,
        provider:       t['provider'] as string | undefined,
        durationMinutes: t['durationMinutes'] as number | undefined,
        priceEur:       t['priceEur'] as number | undefined,
        departureTime:  t['departureTime'] as string | undefined,
        arrivalTime:    t['arrivalTime'] as string | undefined,
        displaySummary: t['displaySummary'] as string | undefined,
        segments:       t['segments'] as Array<Record<string, unknown>> | undefined,
      })),
    })),
  },
})

const downloadPdf = async (): Promise<void> => {
  exportLoading.value = true
  exportError.value = null
  try {
    const resp = await api.post(
      '/api/share/api/v1/export/pdf',
      buildExportPayload(),
      { responseType: 'blob' },
    )
    const url = URL.createObjectURL(new Blob([resp.data as BlobPart], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `itinerary-${activeTripId.value ?? 'trip'}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch {
    exportError.value = translate('trip.form.errors.pdfExportFailed')
  } finally {
    exportLoading.value = false
  }
}

const sendPdfEmail = async (): Promise<void> => {
  sendEmailLoading.value = true
  sendEmailError.value = null
  sendEmailSuccess.value = false
  try {
    await api.post('/api/share/api/v1/export/email', {
      ...buildExportPayload(),
      to: emailTo.value,
    })
    sendEmailSuccess.value = true
  } catch {
    sendEmailError.value = translate('trip.form.errors.sendEmailFailed')
  } finally {
    sendEmailLoading.value = false
  }
}

const goToDashboard = (): void => {
  stopPolling()
  emit('success', activeTripId.value ?? '')
}

// ── Preview derived values ────────────────────────────────────

const budgetPerPerson = computed(() =>
  travellers.value.length > 0
    ? Math.round(budgetTotal.value / travellers.value.length)
    : budgetTotal.value,
)

const estRounds = computed(() => {
  const n = travellers.value.length
  return n <= 1 ? '3–5' : n === 2 ? '5–7' : n === 3 ? '6–9' : '8–12'
})

// ── Persona meta ──────────────────────────────────────────────
const PERSONAS = computed(() => [
  { value: 'culture' as Persona,    label: translate('trip.form.personas.culture'),    agent: 'alice',  colour: 'var(--green)'   },
  { value: 'relaxation' as Persona, label: translate('trip.form.personas.relaxation'), agent: 'bob',    colour: 'var(--amber)'   },
  { value: 'action' as Persona,     label: translate('trip.form.personas.action'),     agent: 'carlos', colour: 'var(--blue)'    },
  { value: 'gastronomy' as Persona, label: translate('trip.form.personas.gastronomy'), agent: 'diana',  colour: 'var(--magenta)' },
])
</script>

<template>
  <div class="fade-in" :style="wizardRootStyle">

    <!-- App bar -->
    <div class="app-bar" style="flex-shrink:0">
      <div class="crumb">
        <AppLogo />
        <span class="sep">/</span>
        <b>{{ tripName || translate('trip.form.newTrip') }}</b>
        <span class="sep">/</span>
        <span>{{ step <= 2 ? translate('trip.form.status.draft') : step === 3 ? translate('trip.form.status.negotiating') : step === 4 ? translate('trip.form.status.review') : translate('trip.form.status.confirmed') }}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <ThemeToggle />
        <LanguageSwitcher />
        <button v-if="step <= 2" class="btn" @click="emit('cancel')">{{ translate('trip.form.cancel') }}</button>
        <div class="avatar">{{ initials(currentUserName) }}</div>
      </div>
    </div>

    <!-- Wizard steps -->
    <div class="usteps" style="flex-shrink:0">
      <div class="ustep" :class="{ cur: step === 1, done: step > 1 }">
        <span class="n">01</span> {{ translate('trip.form.steps.group') }}
      </div>
      <div class="ustep" :class="{ cur: step === 2, done: step > 2 }">
        <span class="n">02</span> {{ translate('trip.form.steps.brief') }}
      </div>
      <div class="ustep" :class="{ cur: step === 3, done: step > 3 }">
        <span class="n">03</span> {{ translate('trip.form.steps.negotiate') }}
      </div>
      <div class="ustep" :class="{ cur: step === 4, done: step > 4 }">
        <span class="n">04</span> {{ translate('trip.form.steps.itinerary') }}
      </div>
      <div class="ustep" :class="{ cur: step === 5 }">
        <span class="n">05</span> {{ translate('trip.form.steps.export') }}
      </div>
    </div>

    <!-- ── Step 1: Group ───────────────────────────────────── -->
    <div v-if="step === 1" class="user-grid">

      <!-- Left: traveller list -->
      <div class="user-left">
        <div style="margin-bottom:var(--s-8)">
          <div class="sec-eyebrow" style="margin-bottom:6px">{{ translate('trip.form.step1.eyebrow') }}</div>
          <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
            {{ translate('trip.form.step1.heading') }}
          </h2>
        </div>

        <div class="group" style="margin-bottom:var(--s-6)">
          <!-- Existing travellers -->
          <div
            v-for="t in travellers"
            :key="t.id"
            data-testid="traveller-card"
            :style="`background:var(--bg-1);border-radius:var(--r-2);padding:var(--s-4);border:1px solid ${step1Attempted && (!t.name.trim() || !t.persona) ? 'var(--red)' : 'var(--line-2)'}`"
          >
            <!-- Name row -->
            <div style="display:flex;align-items:center;gap:var(--s-3);margin-bottom:var(--s-3)">
              <div class="gav">{{ initials(t.name || '?') }}</div>
              <div style="flex:1">
                <input
                  v-if="!t.isCurrentUser"
                  v-model="t.name"
                  class="txt full"
                  :placeholder="translate('trip.form.step1.namePlaceholder')"
                  style="font-size:var(--t-14)"
                  maxlength="255"
                />
                <span v-else class="gn">
                  {{ t.name }}
                  <span class="role">{{ translate('trip.form.step1.organiser') }}</span>
                </span>
                <p
                  v-if="step1Attempted && !t.isCurrentUser && !t.name.trim()"
                  style="color:var(--red);font-size:var(--t-12);margin:2px 0 0;font-family:var(--mono)"
                >
                  {{ translate('trip.form.step1.nameRequired') }}
                </p>
              </div>
              <button
                v-if="!t.isCurrentUser"
                class="gx"
                style="background:none;border:none;cursor:pointer;color:var(--fg-3);font-family:var(--mono)"
                @click="removeTraveller(t.id)"
              >
                ×
              </button>
            </div>

            <!-- Persona row -->
            <div style="margin-bottom:var(--s-3)">
              <div class="field-label" style="margin-bottom:var(--s-2)">{{ translate('trip.form.step1.persona') }}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button
                  v-for="p in PERSONAS"
                  :key="p.value"
                  class="persona-card"
                  :class="t.persona === p.value ? `selected-${p.agent}` : ''"
                  style="min-width:80px;background:none;border-width:1px;border-style:solid"
                  @click="setPersona(t.id, p.value)"
                >
                  <span class="pc-name">{{ p.label }}</span>
                  <span class="pc-agent">{{ p.agent }}</span>
                </button>
              </div>
              <p
                v-if="step1Attempted && !t.persona"
                style="color:var(--red);font-size:var(--t-12);margin:4px 0 0;font-family:var(--mono)"
              >
                {{ translate('trip.form.step1.personaRequired') }}
              </p>
            </div>

            <!-- Flexibility row -->
            <div>
              <div class="field-label" style="margin-bottom:var(--s-2)">{{ translate('trip.form.step1.flexibility') }}</div>
              <div style="display:flex;gap:6px">
                <button
                  v-for="f in (['low', 'medium', 'high'] as Flexibility[])"
                  :key="f"
                  class="chip"
                  :class="{ on: t.flexibility === f }"
                  @click="setFlexibility(t.id, f)"
                >
                  {{ translate(`trip.form.flexibility.${f}`) }}
                </button>
              </div>
            </div>
          </div>

          <!-- Add traveller card -->
          <div
            v-if="travellers.length < 4"
            class="gcard add"
            data-testid="add-traveller"
            @click="addTraveller"
          >
            {{ translate('trip.form.step1.inviteTraveller') }}
          </div>
        </div>

        <div class="user-form-foot">
          <span class="helper">{{ travellers.length }} {{ translate(travellers.length !== 1 ? 'trip.form.travellersPlural' : 'trip.form.traveller') }}</span>
          <button
            class="btn btn-primary"
            @click="goToStep2"
          >
            {{ translate('trip.form.step1.next') }} <span style="margin-left:4px">→</span>
          </button>
        </div>
      </div>

      <!-- Right: preview -->
      <div class="user-right">
        <div class="preview-head">
          <span class="ttl">{{ translate('trip.form.step1.livePreview') }}</span>
          <span class="lz"><span class="pulse" />&nbsp;{{ translate('trip.form.step1.derived') }}</span>
        </div>

        <div class="summary-card">
          <div class="sub">{{ translate('trip.form.step1.groupSummary') }}</div>
          <h3>{{ travellers.length }} {{ translate(travellers.length !== 1 ? 'trip.form.travellersPlural' : 'trip.form.traveller') }}</h3>
          <div class="kv">
            <div class="k">{{ translate('trip.form.step1.personasSelected') }}</div>
            <div class="v mono">{{ travellers.filter(t => t.persona).length }} / {{ travellers.length }}</div>
            <template v-for="t in travellers" :key="t.id">
              <div class="k">{{ t.name || '—' }}</div>
              <div class="v" :style="t.persona ? `color:${PERSONAS.find(p => p.value === t.persona)?.colour}` : ''">
                {{ t.persona ? PERSONA_LABELS[t.persona] : '—' }}
              </div>
            </template>
          </div>
        </div>

        <div class="suggest">
          <h4>{{ translate('trip.form.step1.howAgentsWork') }}</h4>
          <p style="font-size:var(--t-13);color:var(--fg-2);margin:0;line-height:1.6">
            {{ translate('trip.form.step1.howAgentsWorkBody') }}
          </p>
        </div>
      </div>
    </div>

    <!-- ── Step 2: Trip Brief ──────────────────────────────── -->
    <div v-if="step === 2" class="user-grid">

      <!-- Left: form -->
      <div class="user-left">
        <div style="margin-bottom:var(--s-8)">
          <div class="sec-eyebrow" style="margin-bottom:6px">{{ translate('trip.form.step2.eyebrow') }}</div>
          <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
            {{ translate('trip.form.step2.heading') }}
          </h2>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.tripName') }}</div>
          <div class="field-input" style="width:100%;flex-direction:column;align-items:stretch">
            <input
              v-model="tripName"
              class="txt full lg"
              :placeholder="translate('trip.form.step2.tripNamePlaceholder')"
              data-testid="trip-name"
              maxlength="255"
            />
            <p
              v-if="step2Attempted && !tripName.trim()"
              style="color:var(--red);font-size:var(--t-12);margin:4px 0 0;font-family:var(--mono)"
            >
              {{ translate('trip.form.step2.tripNameRequired') }}
            </p>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.destination') }}</div>
          <div class="field-input" style="width:100%;flex-direction:column;align-items:stretch">
            <input
              v-model="region"
              class="txt full"
              :placeholder="translate('trip.form.step2.destinationPlaceholder')"
              data-testid="region"
              maxlength="255"
            />
            <p
              v-if="step2Attempted && !region.trim()"
              style="color:var(--red);font-size:var(--t-12);margin:4px 0 0;font-family:var(--mono)"
            >
              {{ translate('trip.form.step2.destinationRequired') }}
            </p>
            <!-- Echo of how the system understood the destinations + nights split -->
            <div
              v-if="parsedDestinations.length"
              style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0"
              data-testid="parsed-destinations"
            >
              <span class="helper" style="text-transform:none;letter-spacing:0;width:100%;margin-bottom:2px">
                {{ translate('trip.form.step2.understoodAs') }}
              </span>
              <span
                v-for="(d, i) in parsedDestinations"
                :key="i"
                style="font-family:var(--mono);font-size:var(--t-12);padding:3px 8px;border:var(--hair);border-radius:var(--r-1);background:var(--bg-2)"
              >
                {{ d.city }}<template v-if="d.country">, {{ d.country }}</template> · {{ d.nights }}n
              </span>
            </div>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.dates') }}</div>
          <div class="field-input" style="flex-direction:column;align-items:flex-start;gap:var(--s-3)">
            <!-- Mode toggle -->
            <div style="display:flex;gap:6px">
              <button
                class="chip"
                :class="{ on: dateMode === 'fixed' }"
                data-testid="date-mode-fixed"
                @click="dateMode = 'fixed'"
              >{{ translate('trip.form.step2.fixedDates') }}</button>
              <button
                class="chip"
                :class="{ on: dateMode === 'flexible' }"
                data-testid="date-mode-flexible"
                @click="dateMode = 'flexible'"
              >{{ translate('trip.form.step2.flexibleDates') }}</button>
            </div>

            <!-- Fixed mode -->
            <template v-if="dateMode === 'fixed'">
              <div class="date-range-row" style="display:flex;align-items:center;gap:8px">
                <input
                  v-model="startDate"
                  type="date"
                  class="txt date-range-input"
                  data-testid="start-date"
                />
                <span style="color:var(--fg-3);font-family:var(--mono);font-size:var(--t-12)">→</span>
                <input
                  v-model="endDate"
                  type="date"
                  class="txt date-range-input"
                  :min="startDate"
                  data-testid="end-date"
                />
                <span v-if="nights > 0" class="helper">{{ nights }} {{ translate(nights !== 1 ? 'trip.form.step2.nightsPlural' : 'trip.form.step2.night') }}</span>
              </div>
              <p
                v-if="step2Attempted && !startDate"
                style="color:var(--red);font-size:var(--t-12);margin:0;font-family:var(--mono)"
              >
                {{ translate('trip.form.step2.selectStartDate') }}
              </p>
              <p
                v-else-if="step2Attempted && (!endDate || nights <= 0)"
                style="color:var(--red);font-size:var(--t-12);margin:0;font-family:var(--mono)"
              >
                {{ translate('trip.form.step2.endDateError') }}
              </p>
            </template>

            <!-- Flexible mode -->
            <template v-else>
              <div style="display:flex;align-items:center;gap:8px">
                <input
                  v-model.number="flexDays"
                  type="number"
                  min="1"
                  max="60"
                  class="txt"
                  style="width:64px"
                  data-testid="flex-days"
                />
                <span class="helper">{{ translate('trip.form.step2.days') }}</span>
              </div>
              <div class="month-row" style="display:flex;align-items:center;gap:8px">
                <input
                  v-model="preferredMonth"
                  type="month"
                  class="txt"
                  data-testid="preferred-month"
                />
                <span class="helper">{{ translate('trip.form.step2.preferredMonth') }}</span>
              </div>
              <div style="display:flex;gap:6px">
                <button
                  v-for="w in (['tight', 'moderate', 'open'] as DateWindow[])"
                  :key="w"
                  class="chip"
                  :class="{ on: flexWindow === w }"
                  @click="flexWindow = w"
                >{{ translate(`trip.form.step2.dateWindow.${w}`) }}</button>
              </div>
            </template>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.budgetTotalLabel') }}</div>
          <div class="field-input" style="width:100%;flex-direction:column;align-items:stretch;gap:var(--s-2)">
            <div style="display:flex;gap:6px;margin-bottom:4px">
              <button
                v-for="c in (['EUR', 'USD'] as Currency[])"
                :key="c"
                class="chip"
                :class="{ on: budgetCurrency === c }"
                style="height:24px;font-size:11px;padding:0 8px"
                @click="budgetCurrency = c"
              >{{ c }}</button>
            </div>
            <div class="budget">
              <span class="helper" style="min-width:50px">{{ currencySymbol }}500</span>
              <div class="track" style="position:relative">
                <div class="fill" :style="`width:${budgetPercent}%`" />
              </div>
              <span class="helper" style="min-width:60px">{{ currencySymbol }}20k</span>
              <span class="val">{{ currencySymbol }}{{ budgetTotal.toLocaleString() }} {{ translate('trip.form.step2.ceiling') }}</span>
            </div>
            <input
              v-model.number="budgetTotal"
              type="range"
              min="500"
              max="20000"
              step="100"
              style="width:100%;accent-color:var(--green)"
              data-testid="budget-slider"
            />
            <div class="helper" data-testid="budget-per-person-hint" style="text-transform:none;letter-spacing:0">
              {{ translate('trip.form.step2.budgetPerPersonHint', { amount: `${currencySymbol}${budgetPerPerson.toLocaleString()}` }) }}
            </div>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.pace') }}</div>
          <div class="field-input">
            <button
              v-for="f in (['low', 'medium', 'high'] as Flexibility[])"
              :key="f"
              class="chip"
              :class="{ on: tripFlexibility === f }"
              @click="tripFlexibility = f"
            >
              {{ translate(`trip.form.pace.${f}`) }}
            </button>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.transport') }}</div>
          <div class="field-input">
            <button
              v-for="opt in TRANSPORT_OPTIONS"
              :key="opt.value"
              class="chip"
              :class="{ on: transportPreference === opt.value }"
              :data-testid="`transport-${opt.value}`"
              @click="transportPreference = opt.value"
            >
              {{ opt.icon }} {{ opt.label }}
            </button>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.mustHaves') }}</div>
          <div class="field-input" style="width:100%">
            <span
              v-for="item in mustHaves"
              :key="item"
              class="chip on"
              data-testid="must-have-chip"
            >
              {{ item }}
              <span class="x" @click="removeMustHave(item)">×</span>
            </span>
            <input
              v-model="mustHaveInput"
              class="txt txt-inline"
              :placeholder="translate('trip.form.step2.mustHavePlaceholder')"
              maxlength="200"
              @keydown.enter.prevent="addMustHave"
              @blur="addMustHave"
            />
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">{{ translate('trip.form.step2.avoid') }}</div>
          <div class="field-input" style="width:100%">
            <span
              v-for="item in avoids"
              :key="item"
              class="chip on"
              data-testid="avoid-chip"
            >
              {{ item }}
              <span class="x" @click="removeAvoid(item)">×</span>
            </span>
            <input
              v-model="avoidInput"
              class="txt txt-inline"
              :placeholder="translate('trip.form.step2.avoidPlaceholder')"
              maxlength="200"
              @keydown.enter.prevent="addAvoid"
              @blur="addAvoid"
            />
          </div>
        </div>

        <div v-if="store.error" style="padding:var(--s-3) var(--s-4);background:rgba(255,93,93,0.08);border:1px solid rgba(255,93,93,0.32);border-radius:var(--r-2);font-size:var(--t-13);color:var(--red);margin-top:var(--s-4)">
          {{ store.error }}
        </div>

        <div class="user-form-foot">
          <span
            class="helper"
            :style="step2Attempted && !step2Valid ? 'color:var(--red)' : ''"
          >
            {{ step2Attempted && !step2Valid ? translate('trip.form.step2.fixErrors') : step2Valid ? translate('trip.form.step2.ready') : '' }}
          </span>
          <div style="display:flex;gap:8px">
            <button class="btn" @click="step = 1">{{ translate('trip.form.step2.back') }}</button>
            <button
              class="btn btn-primary"
              :disabled="store.loading"
              data-testid="submit-btn"
              @click="attemptSubmit"
            >
              {{ store.loading ? translate('trip.form.step2.starting') : translate('trip.form.step2.startNegotiation') }}
              <span style="margin-left:4px">→</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Right: live preview -->
      <div class="user-right">
        <div class="preview-head">
          <span class="ttl">{{ translate('trip.form.step2.liveDerived') }}</span>
          <span class="lz"><span class="pulse" />&nbsp;{{ translate('trip.form.step2.updating') }}</span>
        </div>

        <div class="summary-card">
          <div class="sub">{{ translate('trip.form.tripSummary') }}</div>
          <h3>{{ region || '—' }}{{ dateMode === 'flexible' ? ` · ${flexDays} ${translate('trip.form.step2.nightsPlural')} · ${translate('trip.form.step2.flexibleSuffix')}` : nights > 0 ? ` · ${nights} ${translate(nights !== 1 ? 'trip.form.step2.nightsPlural' : 'trip.form.step2.night')}` : '' }} · {{ travellers.length }} {{ translate('trip.form.travellersPlural') }}</h3>
          <div class="kv">
            <div class="k">{{ translate('trip.form.step2.targetPerPerson') }}</div>
            <div class="v"><span class="mono">{{ currencySymbol }}{{ budgetPerPerson.toLocaleString() }}</span></div>
            <div class="k">{{ translate('trip.form.step2.pace') }}</div>
            <div class="v">{{ translate(`trip.form.pace.${tripFlexibility}`) }}</div>
            <div class="k">{{ translate('trip.form.step2.transport') }}</div>
            <div class="v">{{ TRANSPORT_OPTIONS.find(o => o.value === transportPreference)?.label ?? '—' }}</div>
            <div class="k">{{ translate('trip.form.step2.estRounds') }}</div>
            <div class="v"><span class="mono">{{ estRounds }}</span></div>
            <div class="k">{{ translate('trip.form.step2.mustHavesLower') }}</div>
            <div class="v mono">{{ mustHaves.length }}</div>
            <div class="k">{{ translate('trip.form.step2.avoidsLower') }}</div>
            <div class="v mono">{{ avoids.length }}</div>
          </div>
        </div>

        <div v-if="travellers.filter(t => t.persona).length > 1" class="suggest">
          <h4>
            {{ translate('trip.form.step2.personaMix') }}
            <span style="float:right;font-family:var(--mono);font-size:var(--t-12)">
              {{ translate('trip.form.step2.agentsCount', { count: travellers.filter(t => t.persona).length }) }}
            </span>
          </h4>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--s-2)">
            <span
              v-for="t in travellers.filter(tv => tv.persona)"
              :key="t.id"
              class="badge"
              :class="`badge-${AGENT_COLOURS[PERSONA_AGENT[t.persona!]]}`"
            >
              {{ t.name || '?' }} · {{ PERSONA_LABELS[t.persona!] }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Step 3: Negotiate (orchestrator pipeline) ───────────── -->
    <TripNegotiateStepV2
      v-if="step === 3"
      :trip-id="activeTripId"
      :budget-total="budgetTotal"
      :negotiation-status="negotiationStatus"
      :rejection-reason="rejectionReason"
      style="flex:1;min-height:0;display:flex;flex-direction:column"
      @cancel="emit('cancel')"
      @adjust="step = 2"
    />

    <!-- ── Step 4: Itinerary (timeline rail + focused day) ── -->
    <TripItineraryStep
      v-if="step === 4"
      :trip-name="tripName"
      :region="region"
      :start-date="startDate"
      :end-date="endDate"
      :date-mode="dateMode"
      :preferred-month="preferredMonth"
      :travellers="travellers.length"
      :timeline-days="timelineDays"
      :budget-breakdown="budgetBreakdown"
      :accommodation="accommodationBlocks"
      :weather-assessment="weatherAssessment"
      :show-weather="showWeather"
      :restriction-warnings="restrictionWarnings"
      :validator-summary="validatorSummary"
      :traveller-scores="travellerScores"
      :agent-names="Object.keys(latestByAgent)"
      :export-loading="exportLoading"
      :share-loading="shareLoading"
      :share-copied="shareCopied"
      :export-error="exportError"
      :share-error="shareError"
      style="flex:1;min-height:0;display:flex;flex-direction:column"
      @accept="handleAccept"
      @reject="handleReject"
      @refine="handleRefine"
      @share="handleShare"
      @export="downloadPdf"
    />

    <!-- ── Step 5: Export ──────────────────────────────────── -->
    <div v-if="step === 5" class="user-grid">
      <div class="user-left" style="flex:1;max-width:600px">

        <div style="margin-bottom:var(--s-8)">
          <div class="sec-eyebrow" style="margin-bottom:6px;color:var(--green)">{{ translate('trip.form.step5.confirmed') }}</div>
          <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
            {{ translate('trip.form.step5.ready', { name: tripName }) }}
          </h2>
          <p style="margin:var(--s-2) 0 0;color:var(--fg-3);font-size:var(--t-14)">
            {{ region }} · {{ dateMode === 'flexible' ? `${flexDays} ${translate('trip.form.step2.nightsPlural')} (${translate('trip.form.step2.flexibleSuffix')})` : `${nights} ${translate(nights !== 1 ? 'trip.form.step2.nightsPlural' : 'trip.form.step2.night')}` }} · {{ travellers.length }} {{ translate(travellers.length !== 1 ? 'trip.form.travellersPlural' : 'trip.form.traveller') }}
          </p>
        </div>

        <div style="display:flex;flex-direction:column;gap:var(--s-3)">
          <!-- PDF export -->
          <div style="border:var(--hair);border-radius:var(--r-2);padding:var(--s-5);background:var(--bg-1)">
            <div style="margin-bottom:var(--s-3)">
              <p style="margin:0;font-size:var(--t-15);font-weight:500">{{ translate('trip.form.step5.downloadPdfTitle') }}</p>
              <p style="margin:4px 0 0;font-size:var(--t-13);color:var(--fg-3)">{{ translate('trip.form.step5.downloadPdfBody') }}</p>
            </div>
            <div v-if="exportError" style="font-size:var(--t-13);color:var(--red);margin-bottom:var(--s-3)">{{ exportError }}</div>
            <button
              class="btn btn-primary"
              :disabled="exportLoading"
              @click="downloadPdf"
            >
              {{ exportLoading ? translate('trip.form.step5.generating') : translate('trip.form.step5.downloadPdf') }}
            </button>
          </div>

          <!-- Send by email -->
          <div style="border:var(--hair);border-radius:var(--r-2);padding:var(--s-5);background:var(--bg-1)">
            <div style="margin-bottom:var(--s-3)">
              <p style="margin:0;font-size:var(--t-15);font-weight:500">{{ translate('trip.form.step5.sendByEmailTitle') }}</p>
              <p style="margin:4px 0 0;font-size:var(--t-13);color:var(--fg-3)">{{ translate('trip.form.step5.sendByEmailBody') }}</p>
            </div>
            <div v-if="sendEmailError" style="font-size:var(--t-13);color:var(--red);margin-bottom:var(--s-3)">{{ sendEmailError }}</div>
            <div v-if="sendEmailSuccess" style="font-size:var(--t-13);color:var(--green);margin-bottom:var(--s-3)">{{ translate('trip.form.step5.sentTo', { email: emailTo }) }}</div>
            <div style="display:flex;gap:var(--s-2)">
              <input
                v-model="emailTo"
                type="email"
                placeholder="you@example.com"
                style="flex:1;min-width:0;padding:8px 10px;border:var(--hair);border-radius:var(--r-1);background:var(--bg-0);color:var(--fg-1);font-size:var(--t-14)"
              >
              <button
                class="btn btn-primary"
                :disabled="sendEmailLoading || !emailTo"
                @click="sendPdfEmail"
              >
                {{ sendEmailLoading ? translate('trip.form.step5.sending') : translate('trip.form.step5.send') }}
              </button>
            </div>
          </div>

          <!-- Summary card -->
          <div style="border:var(--hair);border-radius:var(--r-2);padding:var(--s-5);background:var(--bg-1)">
            <div class="sub" style="margin-bottom:var(--s-3)">{{ translate('trip.form.tripSummary') }}</div>
            <div class="kv">
              <div class="k">{{ translate('trip.form.step5.budget') }}</div>
              <div class="v mono">{{ currencySymbol }}{{ budgetTotal.toLocaleString() }}</div>
              <div class="k">{{ translate('trip.form.step5.perPerson') }}</div>
              <div class="v mono">{{ currencySymbol }}{{ budgetPerPerson.toLocaleString() }}</div>
              <div class="k">{{ translate('trip.form.step5.roundsCompleted') }}</div>
              <div class="v mono">{{ liveProposals.length > 0 ? Math.max(...liveProposals.map(p => p.round)) : 6 }}</div>
              <div class="k">{{ translate('trip.form.step5.agentsInvolved') }}</div>
              <div class="v mono">{{ new Set(liveProposals.map(p => p.agent)).size }}</div>
            </div>
          </div>
        </div>

        <div class="user-form-foot" style="margin-top:var(--s-6)">
          <button class="btn btn-primary" @click="goToDashboard">
            {{ translate('trip.form.step5.backToDashboard') }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
