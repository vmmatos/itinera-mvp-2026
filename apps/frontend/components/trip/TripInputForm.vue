<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import { PERSONA_LABELS, PERSONA_AGENT, AGENT_COLOURS } from '~/types/index'
import type { Persona, Flexibility, Currency, DateWindow, DateInput, CreateTripInput, TravellerInput, SatisfactionScore, AgentStreamEvent, TransportMode, TransportOption, TransportActivityData, BudgetBreakdown } from '~/types/index'
import { formatTransportLabel } from '~/utils/itinerary'

const props = withDefaults(defineProps<{ viewTripId?: string }>(), { viewTripId: undefined })

const emit = defineEmits<{
  success: [tripId: string]
  cancel: []
}>()

// ── Auth ─────────────────────────────────────────────────────
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
const dealBreakerInput = ref('')
const dealBreakers   = ref<string[]>([])

const transportPreference = ref<TransportMode>('best')

const TRANSPORT_OPTIONS = [
  { value: 'flight' as TransportMode, label: 'Flight',      icon: '✈️' },
  { value: 'train'  as TransportMode, label: 'Train',       icon: '🚆' },
  { value: 'car'    as TransportMode, label: 'Car',         icon: '🚗' },
  { value: 'best'   as TransportMode, label: 'Best option', icon: '⭐' },
]

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

const addDealBreaker = (): void => {
  const v = dealBreakerInput.value.trim()
  if (v && !dealBreakers.value.includes(v)) dealBreakers.value.push(v)
  dealBreakerInput.value = ''
}

const removeDealBreaker = (v: string): void => {
  dealBreakers.value = dealBreakers.value.filter((x) => x !== v)
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
    const first = li.travellers[0]
    if (first) {
      tripFlexibility.value = first.preferences.pace ?? 'medium'
      mustHaves.value       = [...(first.preferences.mustHaves ?? [])]
      dealBreakers.value    = [...(first.preferences.dealBreakers ?? [])]
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
    travellers:          travellers.value.map((t): TravellerInput => ({
      userId: t.isCurrentUser ? currentUserId.value : undefined,
      name:   t.name,
      preferences: {
        persona:      t.persona!,
        flexibility:  t.flexibility,
        pace:         tripFlexibility.value,
        dietary:      [],
        constraints:  [],
        mustHaves:    mustHaves.value,
        dealBreakers: dealBreakers.value,
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

const AGENT_COLOUR: Record<string, string> = {
  alice:        'var(--green)',
  bob:          'var(--amber)',
  carlos:       'var(--blue)',
  diana:        'var(--magenta)',
  orchestrator: 'var(--fg-0)',
  finance:      'var(--amber)',
  logistics:    'var(--blue)',
  validator:    'var(--magenta)',
}

const ROUND_LABELS: Record<number, string> = {
  1: 'Preferences',
  2: 'Conflict analysis',
  3: 'Compromise proposal',
  4: 'Budget review',
  5: 'Logistics validation',
  6: 'Final scoring',
}

const ROUND_AGENTS: Record<number, string[]> = {
  1: ['alice', 'bob', 'carlos', 'diana'],
  2: ['orchestrator'],
  3: ['orchestrator'],
  4: ['finance'],
  5: ['logistics'],
  6: ['validator'],
}

// ── Workflow Engine v2 state maps ─────────────────────────────
const WORKFLOW_STATES = [
  'LOGISTICS_PLANNING',
  'FINANCE_ENVELOPE_CHECK',
  'PARALLEL_TURISTIC_PLANNING',
  'MERGE_AND_SCORE',
  'FINANCE_VALIDATE',
  'FINAL_VALIDATION',
  'FINISH',
] as const

const STATE_LABELS: Record<string, string> = {
  INTAKE_COMPLETE:             'Preparing…',
  LOGISTICS_PLANNING:          'Building route',
  FINANCE_ENVELOPE_CHECK:      'Checking budget',
  PARALLEL_TURISTIC_PLANNING:  'Planning experiences',
  MERGE_AND_SCORE:             'Merging proposals',
  FINANCE_VALIDATE:            'Validating costs',
  FINAL_VALIDATION:            'Final check',
  ASK_REFINEMENT:              'Needs adjustment',
  FINISH:                      'Done',
}

const STATE_ACTIVE_AGENTS: Record<string, string[]> = {
  LOGISTICS_PLANNING:          ['logistics'],
  FINANCE_ENVELOPE_CHECK:      ['finance'],
  PARALLEL_TURISTIC_PLANNING:  ['alice', 'bob', 'carlos', 'diana'],
  MERGE_AND_SCORE:             ['orchestrator'],
  FINANCE_VALIDATE:            ['finance'],
  FINAL_VALIDATION:            ['validator'],
}

const workflowState = ref<string | null>(null)

const workflowStateIndex = computed(() =>
  workflowState.value ? WORKFLOW_STATES.indexOf(workflowState.value as typeof WORKFLOW_STATES[number]) : -1,
)

const activeWorkflowAgents = computed(() =>
  workflowState.value ? (STATE_ACTIVE_AGENTS[workflowState.value] ?? []) : [],
)

const startNegotiationPolling = (tripId: string): void => {
  const poll = async (): Promise<void> => {
    try {
      const [tripResp, propResp] = await Promise.all([
        api.get<{ success: boolean; data: { status: string; rejectionReason?: string | null; workflowState?: string | null } }>(`/api/v1/trips/${tripId}`),
        api.get<{ success: boolean; data: ProposalEntry[] }>(`/api/v1/trips/${tripId}/proposals`),
      ])
      negotiationStatus.value = tripResp.data.data.status
      workflowState.value = tripResp.data.data.workflowState ?? null
      liveProposals.value = propResp.data.data

      if (negotiationStatus.value === 'confirmed') {
        stopPolling()
        setTimeout(() => { step.value = 4 }, 800)
      } else if (negotiationStatus.value === 'rejected') {
        // Budget impossible — agents could not reach a bookable plan. Ask to reformulate.
        rejectionReason.value = tripResp.data.data.rejectionReason
          || 'Budget unrealistic for this trip — increase the budget or reduce the scope.'
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

// ── Step 3: Live discussion (SSE) ─────────────────────────────

const { events: streamEvents, connected: streamConnected } = useAgentStream(activeTripId)

// Merge SSE events (preferred — have reasoning) with DB proposals (fallback — always available).
// Race condition: agents publish before SSE connects → ws-relay drops missed messages.
// DB polling via liveProposals ensures the panel always has data.
const discussionEvents = computed((): AgentStreamEvent[] => {
  if (streamEvents.value.length > 0) return streamEvents.value
  return [...liveProposals.value]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((p): AgentStreamEvent => ({
      tripId:    activeTripId.value ?? '',
      type:      'propose',
      agent:     p.agent as AgentStreamEvent['agent'],
      round:     p.round,
      timestamp: p.createdAt,
      content:   p.content,
    }))
})

const decisionEvent = computed(() =>
  discussionEvents.value.find(
    (e) => (e.agent === 'orchestrator' || e.agent === 'validator') && e.round === 6,
  ) ?? null,
)

// Orchestrator events — displayed separately in decisions panel
const orchestratorDecisions = computed(() =>
  discussionEvents.value.filter((e) => e.agent === 'orchestrator'),
)

// Non-orchestrator events for the main feed
const agentOnlyEvents = computed(() =>
  discussionEvents.value.filter((e) => e.agent !== 'orchestrator'),
)

// Highest round with at least one completed event
const completedRound = computed((): number => {
  const src = streamEvents.value.length > 0 ? streamEvents.value : liveProposals.value
  if (src.length === 0) return 0
  return Math.min(Math.max(...src.map((e) => e.round)), 6)
})

// Round currently executing — completedRound + 1, capped at 6, 0 when not negotiating
const activeRound = computed((): number => {
  if (negotiationStatus.value !== 'negotiating') return 0
  return Math.min(completedRound.value + 1, 6)
})

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

function weatherEmoji(risk: string): string {
  if (risk === 'high') return '🌧️'
  if (risk === 'medium') return '🌤️'
  return '☀️'
}

interface ItineraryActivity {
  name:           string
  time?:          string
  location?:      string
  venue?:         string
  city?:          string
  country?:       string
  ownerAgent?:    string
  notes?:         string
  cost?:          number
  weatherAlert?:  string
  satisfies?:     string[]
  transportData?: TransportActivityData
}

interface ItineraryCityTransition {
  to:        string
  travelTime: string
}

interface ItineraryDay {
  day:             number
  date?:           string
  city?:           string
  country?:        string
  cityTransition?: ItineraryCityTransition
  activities:      ItineraryActivity[]
  meals?:          Array<{ type: string; name: string }>
  // Per-day transport legs from the merged itinerary; preferred over logistics options.
  rawTransport?:   Array<Record<string, unknown>>
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
            location:     typeof a['location'] === 'string' ? a['location'] : undefined,
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

const transportCostEur = computed<number | null>(() => {
  const c = latestByAgent.value['logistics']?.content as Record<string, unknown> | undefined
  const v = c?.['transportCostEur']
  return typeof v === 'number' && v > 0 ? v : null
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

const financeSummary = computed(() => {
  const p = latestByAgent.value['finance']
  if (!p) return null
  const c = p.content
  const bd = c['costBreakdown'] as Record<string, unknown> | undefined
  const bv = c['budgetValidation'] as Record<string, unknown> | undefined
  return { grandTotal: bd?.['grandTotal'], currency: bd?.['currency'], status: bv?.['status'] }
})

// Itemised per-category, per-person budget breakdown (issue #73). Older
// proposals won't have this field — the fallback cost-breakdown card below
// still covers those.
const budgetBreakdown = computed<BudgetBreakdown | null>(() => {
  const p = latestByAgent.value['finance']
  const bd = p?.content?.['budgetBreakdown'] as BudgetBreakdown | undefined
  return bd ?? null
})

// ── Step 4: Scores, cost breakdown, weather ───────────────────

const travellerScores = computed<SatisfactionScore[]>(() => {
  const vp = liveProposals.value.find((p) => p.agent === 'validator' && p.round === 6)
  const c = vp?.content
  return Array.isArray(c?.['scores']) ? (c['scores'] as SatisfactionScore[]) : []
})

const costCategories = computed<Array<{ label: string; amount: number }>>(() => {
  const fp = liveProposals.value.find((p) => p.agent === 'finance')
  const c = fp?.content
  const bd = c?.['costBreakdown'] as Record<string, unknown> | undefined
  if (!bd) return []

  const byCat = bd['byCategory'] as Record<string, number> | undefined
  if (byCat && typeof byCat === 'object') {
    return Object.entries(byCat)
      .map(([label, amount]) => ({ label, amount }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }

  const cats = bd['categories']
  return Array.isArray(cats)
    ? [...(cats as Array<{ label: string; amount: number }>)].sort((a, b) => b.amount - a.amount)
    : []
})

const weatherAlerts = computed<string[]>(() => {
  const lp = liveProposals.value.find((p) => p.agent === 'logistics')
  const c = lp?.content
  return Array.isArray(c?.['weatherAlerts']) ? (c['weatherAlerts'] as string[]) : []
})

const logisticsWeatherSummary = computed<string | null>(() => {
  const lp = liveProposals.value.find((p) => p.agent === 'logistics')
  const c = lp?.content
  if (!c) return null
  const summary = c['weatherSummary'] ?? c['summary'] ?? c['overview']
  return typeof summary === 'string' ? summary.slice(0, 200) : null
})

// Per-day weather cards — structured when dayAssessments present, fallback to overallRisk per itinerary day
interface WeatherCard { day: number; date?: string; risk: string; label: string }

const dayWeatherCards = computed<WeatherCard[]>(() => {
  const lp = liveProposals.value.find((p) => p.agent === 'logistics')
  const c = lp?.content
  if (!c) return []

  const assessments = c['dayAssessments']
  if (Array.isArray(assessments) && assessments.length > 0) {
    return (assessments as Array<Record<string, unknown>>).map((d) => {
      const risk = typeof d['weatherRisk'] === 'string' ? d['weatherRisk'] as string : 'low'
      return {
        day:   typeof d['day'] === 'number' ? d['day'] as number : 0,
        date:  typeof d['date'] === 'string' ? d['date'] as string : undefined,
        risk,
        label: risk === 'high' ? 'stormy' : risk === 'medium' ? 'cloudy' : 'clear',
      }
    })
  }

  // Fallback: use overallRisk for each day in the parsed itinerary
  const overallRisk = typeof c['overallRisk'] === 'string' ? c['overallRisk'] as string : null
  if (!overallRisk || parsedItinerary.value.length === 0) return []
  return parsedItinerary.value.map((d) => ({
    day:   d.day,
    date:  d.date,
    risk:  overallRisk,
    label: overallRisk === 'high' ? 'stormy' : overallRisk === 'medium' ? 'cloudy' : 'clear',
  }))
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
    shareError.value = 'Failed to generate share link.'
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
    travellers:     travellers.value.map((t): TravellerInput => ({
      userId: t.isCurrentUser ? currentUserId.value : undefined,
      name:   t.name,
      preferences: {
        persona:      t.persona ?? 'culture',
        flexibility:  t.flexibility,
        pace:         tripFlexibility.value,
        dietary:      [],
        constraints:  [],
        mustHaves:    mustHaves.value,
        dealBreakers: dealBreakers.value,
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
    exportError.value = 'PDF export failed. Try again.'
  } finally {
    exportLoading.value = false
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
const PERSONAS: { value: Persona; label: string; agent: string; colour: string }[] = [
  { value: 'culture',    label: 'Culture',    agent: 'alice',  colour: 'var(--green)'   },
  { value: 'relaxation', label: 'Relaxation', agent: 'bob',    colour: 'var(--amber)'   },
  { value: 'action',     label: 'Action',     agent: 'carlos', colour: 'var(--blue)'    },
  { value: 'gastronomy', label: 'Gastronomy', agent: 'diana',  colour: 'var(--magenta)' },
]
</script>

<template>
  <div class="fade-in" style="border: var(--hair); background: var(--bg-2);">

    <!-- App bar -->
    <div class="app-bar">
      <div class="crumb">
        <AppLogo />
        <span class="sep">/</span>
        <b>{{ tripName || 'New trip' }}</b>
        <span class="sep">/</span>
        <span>{{ step <= 2 ? 'draft' : step === 3 ? 'negotiating' : step === 4 ? 'review' : 'confirmed' }}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button v-if="step <= 2" class="btn" @click="emit('cancel')">Cancel</button>
        <div class="avatar">{{ initials(currentUserName) }}</div>
      </div>
    </div>

    <!-- Wizard steps -->
    <div class="usteps">
      <div class="ustep" :class="{ cur: step === 1, done: step > 1 }">
        <span class="n">01</span> Group
      </div>
      <div class="ustep" :class="{ cur: step === 2, done: step > 2 }">
        <span class="n">02</span> Brief
      </div>
      <div class="ustep" :class="{ cur: step === 3, done: step > 3 }">
        <span class="n">03</span> Negotiate
      </div>
      <div class="ustep" :class="{ cur: step === 4, done: step > 4 }">
        <span class="n">04</span> Itinerary
      </div>
      <div class="ustep" :class="{ cur: step === 5 }">
        <span class="n">05</span> Export
      </div>
    </div>

    <!-- ── Step 1: Group ───────────────────────────────────── -->
    <div v-if="step === 1" class="user-grid">

      <!-- Left: traveller list -->
      <div class="user-left">
        <div style="margin-bottom:var(--s-8)">
          <div class="sec-eyebrow" style="margin-bottom:6px">Group composition</div>
          <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
            Who's joining the trip?
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
                  placeholder="Traveller name"
                  style="font-size:var(--t-14)"
                  maxlength="255"
                />
                <span v-else class="gn">
                  {{ t.name }}
                  <span class="role">organiser</span>
                </span>
                <p
                  v-if="step1Attempted && !t.isCurrentUser && !t.name.trim()"
                  style="color:var(--red);font-size:var(--t-12);margin:2px 0 0;font-family:var(--mono)"
                >
                  Name is required
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
              <div class="field-label" style="margin-bottom:var(--s-2)">Persona</div>
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
                Select a persona to continue
              </p>
            </div>

            <!-- Flexibility row -->
            <div>
              <div class="field-label" style="margin-bottom:var(--s-2)">Flexibility</div>
              <div style="display:flex;gap:6px">
                <button
                  v-for="f in (['low', 'medium', 'high'] as Flexibility[])"
                  :key="f"
                  class="chip"
                  :class="{ on: t.flexibility === f }"
                  @click="setFlexibility(t.id, f)"
                >
                  {{ f }}
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
            + invite traveller
          </div>
        </div>

        <div class="user-form-foot">
          <span class="helper">{{ travellers.length }} traveller{{ travellers.length !== 1 ? 's' : '' }}</span>
          <button
            class="btn btn-primary"
            @click="goToStep2"
          >
            Next <span style="margin-left:4px">→</span>
          </button>
        </div>
      </div>

      <!-- Right: preview -->
      <div class="user-right">
        <div class="preview-head">
          <span class="ttl">Live preview</span>
          <span class="lz"><span class="pulse" />&nbsp;derived</span>
        </div>

        <div class="summary-card">
          <div class="sub">Group summary</div>
          <h3>{{ travellers.length }} traveller{{ travellers.length !== 1 ? 's' : '' }}</h3>
          <div class="kv">
            <div class="k">Personas selected</div>
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
          <h4>How agents work</h4>
          <p style="font-size:var(--t-13);color:var(--fg-2);margin:0;line-height:1.6">
            Each traveller is assigned an AI agent that argues their persona's preferences
            during negotiation rounds. Agents converge on a fair itinerary.
          </p>
        </div>
      </div>
    </div>

    <!-- ── Step 2: Trip Brief ──────────────────────────────── -->
    <div v-if="step === 2" class="user-grid">

      <!-- Left: form -->
      <div class="user-left">
        <div style="margin-bottom:var(--s-8)">
          <div class="sec-eyebrow" style="margin-bottom:6px">Trip brief</div>
          <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
            Describe what you're optimising for.
          </h2>
        </div>

        <div class="field-row">
          <div class="field-label">Trip name</div>
          <div class="field-input" style="width:100%;flex-direction:column;align-items:stretch">
            <input
              v-model="tripName"
              class="txt full lg"
              placeholder="e.g. Cusco run · Jun 2026"
              data-testid="trip-name"
              maxlength="255"
            />
            <p
              v-if="step2Attempted && !tripName.trim()"
              style="color:var(--red);font-size:var(--t-12);margin:4px 0 0;font-family:var(--mono)"
            >
              Trip name is required
            </p>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Destination</div>
          <div class="field-input" style="width:100%;flex-direction:column;align-items:stretch">
            <input
              v-model="region"
              class="txt full"
              placeholder="e.g. Cusco + Sacred Valley, Peru"
              data-testid="region"
              maxlength="255"
            />
            <p
              v-if="step2Attempted && !region.trim()"
              style="color:var(--red);font-size:var(--t-12);margin:4px 0 0;font-family:var(--mono)"
            >
              Destination is required
            </p>
            <!-- Echo of how the system understood the destinations + nights split -->
            <div
              v-if="parsedDestinations.length"
              style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0"
              data-testid="parsed-destinations"
            >
              <span class="helper" style="text-transform:none;letter-spacing:0;width:100%;margin-bottom:2px">
                Understood as:
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
          <div class="field-label">Dates</div>
          <div class="field-input" style="flex-direction:column;align-items:flex-start;gap:var(--s-3)">
            <!-- Mode toggle -->
            <div style="display:flex;gap:6px">
              <button
                class="chip"
                :class="{ on: dateMode === 'fixed' }"
                data-testid="date-mode-fixed"
                @click="dateMode = 'fixed'"
              >Fixed dates</button>
              <button
                class="chip"
                :class="{ on: dateMode === 'flexible' }"
                data-testid="date-mode-flexible"
                @click="dateMode = 'flexible'"
              >I'm flexible</button>
            </div>

            <!-- Fixed mode -->
            <template v-if="dateMode === 'fixed'">
              <div style="display:flex;align-items:center;gap:8px">
                <input
                  v-model="startDate"
                  type="date"
                  class="txt"
                  style="width:140px"
                  data-testid="start-date"
                />
                <span style="color:var(--fg-3);font-family:var(--mono);font-size:var(--t-12)">→</span>
                <input
                  v-model="endDate"
                  type="date"
                  class="txt"
                  style="width:140px"
                  :min="startDate"
                  data-testid="end-date"
                />
                <span v-if="nights > 0" class="helper">{{ nights }} night{{ nights !== 1 ? 's' : '' }}</span>
              </div>
              <p
                v-if="step2Attempted && !startDate"
                style="color:var(--red);font-size:var(--t-12);margin:0;font-family:var(--mono)"
              >
                Select a start date
              </p>
              <p
                v-else-if="step2Attempted && (!endDate || nights <= 0)"
                style="color:var(--red);font-size:var(--t-12);margin:0;font-family:var(--mono)"
              >
                End date must be after start date
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
                <span class="helper">days</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <input
                  v-model="preferredMonth"
                  type="month"
                  class="txt"
                  data-testid="preferred-month"
                />
                <span class="helper">preferred month</span>
              </div>
              <div style="display:flex;gap:6px">
                <button
                  v-for="w in (['tight', 'moderate', 'open'] as DateWindow[])"
                  :key="w"
                  class="chip"
                  :class="{ on: flexWindow === w }"
                  @click="flexWindow = w"
                >{{ w }}</button>
              </div>
            </template>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Budget / pp</div>
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
              <span class="val">{{ currencySymbol }}{{ budgetTotal.toLocaleString() }} ceiling</span>
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
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Pace</div>
          <div class="field-input">
            <button
              v-for="f in (['low', 'medium', 'high'] as Flexibility[])"
              :key="f"
              class="chip"
              :class="{ on: tripFlexibility === f }"
              @click="tripFlexibility = f"
            >
              {{ f === 'low' ? 'slow' : f === 'medium' ? 'moderate' : 'packed' }}
            </button>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Transport</div>
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
          <div class="field-label">Must-haves</div>
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
              class="txt"
              placeholder="+ add must-have"
              style="width:160px"
              maxlength="200"
              @keydown.enter.prevent="addMustHave"
              @blur="addMustHave"
            />
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Avoid</div>
          <div class="field-input" style="width:100%">
            <span
              v-for="item in dealBreakers"
              :key="item"
              class="chip on"
              data-testid="deal-breaker-chip"
            >
              {{ item }}
              <span class="x" @click="removeDealBreaker(item)">×</span>
            </span>
            <input
              v-model="dealBreakerInput"
              class="txt"
              placeholder="+ add avoid"
              style="width:160px"
              maxlength="200"
              @keydown.enter.prevent="addDealBreaker"
              @blur="addDealBreaker"
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
            {{ step2Attempted && !step2Valid ? 'fix errors above' : step2Valid ? 'ready' : '' }}
          </span>
          <div style="display:flex;gap:8px">
            <button class="btn" @click="step = 1">Back</button>
            <button
              class="btn btn-primary"
              :disabled="store.loading"
              data-testid="submit-btn"
              @click="attemptSubmit"
            >
              {{ store.loading ? 'Starting…' : 'Start negotiation' }}
              <span style="margin-left:4px">→</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Right: live preview -->
      <div class="user-right">
        <div class="preview-head">
          <span class="ttl">Live preview · derived</span>
          <span class="lz"><span class="pulse" />&nbsp;updating</span>
        </div>

        <div class="summary-card">
          <div class="sub">Trip summary</div>
          <h3>{{ region || '—' }}{{ dateMode === 'flexible' ? ` · ${flexDays} nights · flexible` : nights > 0 ? ` · ${nights} nights` : '' }} · {{ travellers.length }} travellers</h3>
          <div class="kv">
            <div class="k">target / pp</div>
            <div class="v"><span class="mono">{{ currencySymbol }}{{ budgetPerPerson.toLocaleString() }}</span></div>
            <div class="k">pace</div>
            <div class="v">{{ tripFlexibility === 'low' ? 'slow' : tripFlexibility === 'medium' ? 'moderate' : 'packed' }}</div>
            <div class="k">transport</div>
            <div class="v">{{ TRANSPORT_OPTIONS.find(o => o.value === transportPreference)?.label ?? '—' }}</div>
            <div class="k">est. rounds</div>
            <div class="v"><span class="mono">{{ estRounds }}</span></div>
            <div class="k">must-haves</div>
            <div class="v mono">{{ mustHaves.length }}</div>
            <div class="k">avoids</div>
            <div class="v mono">{{ dealBreakers.length }}</div>
          </div>
        </div>

        <div v-if="travellers.filter(t => t.persona).length > 1" class="suggest">
          <h4>
            Persona mix
            <span style="float:right;font-family:var(--mono);font-size:var(--t-12)">
              {{ travellers.filter(t => t.persona).length }} agents
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

    <!-- ── Step 3: Negotiate ───────────────────────────────── -->
    <div v-if="step === 3" class="user-grid">

      <!-- Left: activity feed -->
      <div class="user-left">

        <div style="margin-bottom:var(--s-6)">
          <div class="sec-eyebrow" style="margin-bottom:6px">Live negotiation</div>
          <div style="display:flex;align-items:center;gap:var(--s-4)">
            <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
              Agents are building your itinerary
            </h2>
            <span v-if="negotiationStatus === 'confirmed'" style="color:var(--green);font-family:var(--mono);font-size:var(--t-13)">
              ✓ confirmed
            </span>
            <span v-else-if="negotiationStatus === 'cancelled'" style="color:var(--red);font-family:var(--mono);font-size:var(--t-13)">
              ✗ cancelled
            </span>
            <span v-else-if="negotiationStatus === 'rejected'" style="color:var(--amber, #f59e0b);font-family:var(--mono);font-size:var(--t-13)">
              ⚠ needs reformulation
            </span>
          </div>
        </div>

        <!-- Active agent working indicator (v2: state-based / v1: round-based) -->
        <div
          v-if="negotiationStatus === 'negotiating' && (workflowState ? activeWorkflowAgents.length > 0 : activeRound > 0)"
          data-testid="active-agent-indicator"
          style="margin-bottom:var(--s-4);padding:var(--s-3) var(--s-4);border:var(--hair);border-radius:var(--r-2);background:var(--bg-2);display:flex;align-items:center;gap:var(--s-4);flex-wrap:wrap"
        >
          <span v-if="workflowState" class="helper">{{ STATE_LABELS[workflowState] ?? workflowState }}</span>
          <span v-else class="helper">Round {{ activeRound }} / 6 · {{ ROUND_LABELS[activeRound] ?? '' }}</span>
          <div style="display:flex;gap:var(--s-4);flex-wrap:wrap">
            <div
              v-for="agent in (workflowState ? activeWorkflowAgents : ROUND_AGENTS[activeRound])"
              :key="agent"
              style="display:flex;align-items:center;gap:var(--s-2)"
            >
              <span
                class="agent-thinking-dot"
                :style="`background:${AGENT_COLOUR[agent] ?? 'var(--fg-3)'}`"
              />
              <span
                style="font-size:var(--t-13);font-family:var(--mono);font-weight:600"
                :style="`color:${AGENT_COLOUR[agent] ?? 'var(--fg-2)'}`"
              >{{ agent }}</span>
              <span class="helper" style="text-transform:none;letter-spacing:0">thinking…</span>
            </div>
          </div>
        </div>

        <!-- Cancelled state -->
        <div v-if="negotiationStatus === 'cancelled'" style="padding:var(--s-6);background:rgba(255,93,93,0.06);border:1px solid rgba(255,93,93,0.24);border-radius:var(--r-2);text-align:center">
          <p style="color:var(--red);font-size:var(--t-15);margin:0 0 var(--s-3)">Negotiation failed</p>
          <p class="helper" style="margin:0 0 var(--s-4)">The agents could not agree on an itinerary. Please try again.</p>
          <button class="btn" @click="emit('cancel')">Back to dashboard</button>
        </div>

        <!-- Rejected state — budget impossible, ask user to reformulate -->
        <div v-else-if="negotiationStatus === 'rejected'" style="padding:var(--s-6);background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.28);border-radius:var(--r-2);text-align:center">
          <p style="color:var(--amber, #f59e0b);font-size:var(--t-15);margin:0 0 var(--s-3)">This trip needs reformulating</p>
          <p class="helper" style="margin:0 0 var(--s-4);text-transform:none;letter-spacing:0">{{ rejectionReason }}</p>
          <button class="btn" @click="step = 2">Adjust trip &amp; budget</button>
        </div>

        <!-- Live event feed -->
        <div
          v-else
          style="border:var(--hair);border-radius:var(--r-2);background:var(--bg-1);overflow:hidden"
        >
          <!-- Header -->
          <div style="padding:var(--s-3) var(--s-4);border-bottom:var(--hair);display:flex;align-items:center;justify-content:space-between">
            <span class="helper" style="font-family:var(--mono)">agent activity</span>
            <span class="helper" style="font-family:var(--mono)">{{ liveProposals.length }} events</span>
          </div>

          <!-- Empty state -->
          <div v-if="liveProposals.length === 0" style="padding:var(--s-8);text-align:center">
            <span class="helper pulse-green">Initialising agents…</span>
          </div>

          <!-- Event list -->
          <div v-else style="max-height:400px;overflow-y:auto">
            <div
              v-for="p in liveProposals"
              :key="p.id"
              style="padding:var(--s-3) var(--s-4);border-bottom:var(--hair)"
            >
              <!-- Route graph summary card (logistics plan event) -->
              <template v-if="p.agent === 'logistics' && typeof p.content === 'object' && p.content !== null && 'cityStays' in p.content">
                <div style="display:flex;align-items:center;gap:var(--s-2);margin-bottom:var(--s-2)">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--blue);flex-shrink:0" />
                  <span style="font-size:var(--t-12);font-family:var(--mono);font-weight:600;color:var(--blue)">logistics</span>
                  <span class="helper" style="font-family:var(--mono)">route plan</span>
                </div>
                <div style="font-size:var(--t-13);color:var(--fg-2);line-height:1.8">
                  <div
                    v-for="(leg, i) in (p.content as Record<string, unknown[]>)['orderedLegs'] ?? []"
                    :key="i"
                    style="font-family:var(--mono)"
                  >
                    {{ (leg as Record<string, unknown>)['from'] }} → {{ (leg as Record<string, unknown>)['to'] }}
                    <span class="helper" style="margin-left:var(--s-2)">
                      {{ ((leg as Record<string, unknown>)['bestOption'] as Record<string, unknown>)?.['mode'] }}
                      · {{ Math.round(Number(((leg as Record<string, unknown>)['bestOption'] as Record<string, unknown>)?.['durationMinutes']) / 60 * 10) / 10 }}h
                      · €{{ ((leg as Record<string, unknown>)['totalCostEurPerPerson']) ?? '?' }}/pp
                    </span>
                  </div>
                  <div
                    v-for="stay in (p.content as Record<string, unknown[]>)['cityStays'] ?? []"
                    :key="(stay as Record<string, unknown>)['city'] as string"
                    style="font-family:var(--mono)"
                  >
                    {{ (stay as Record<string, unknown>)['city'] }} {{ (stay as Record<string, unknown>)['nights'] }} nights
                  </div>
                </div>
              </template>

              <!-- Budget envelope card (finance estimate event) -->
              <template v-else-if="p.agent === 'finance' && typeof p.content === 'object' && p.content !== null && 'perBlock' in p.content">
                <div style="display:flex;align-items:center;gap:var(--s-2);margin-bottom:var(--s-2)">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--amber);flex-shrink:0" />
                  <span style="font-size:var(--t-12);font-family:var(--mono);font-weight:600;color:var(--amber)">finance</span>
                  <span class="helper" style="font-family:var(--mono)">budget envelope</span>
                  <span
                    :style="`font-family:var(--mono);font-size:10px;padding:1px 6px;border-radius:var(--r-1);${(p.content as Record<string, unknown>)['feasible'] ? 'background:rgba(0,255,136,0.12);color:var(--green)' : 'background:rgba(255,93,93,0.12);color:var(--red)'}`"
                  >{{ (p.content as Record<string, unknown>)['feasible'] ? 'feasible' : 'infeasible' }}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px var(--s-4);font-size:var(--t-13);font-family:var(--mono)">
                  <span class="helper">Transport</span>
                  <span>€{{ ((p.content as Record<string, unknown[]>)['perBlock'] ?? []).reduce((s: number, b: unknown) => s + Number((b as Record<string, unknown>)['transportCostEurPerPerson'] ?? 0), 0).toFixed(0) }}/pp</span>
                  <span class="helper">Accommodation</span>
                  <span>€{{ ((p.content as Record<string, unknown[]>)['perBlock'] ?? []).reduce((s: number, b: unknown) => s + Number((b as Record<string, unknown>)['accommodationBudgetEurPerPerson'] ?? 0), 0).toFixed(0) }}/pp</span>
                  <span class="helper">Experiences</span>
                  <span>€{{ ((p.content as Record<string, unknown[]>)['perBlock'] ?? []).reduce((s: number, b: unknown) => s + Number((b as Record<string, unknown>)['experiencesBudgetEurPerPerson'] ?? 0), 0).toFixed(0) }}/pp</span>
                  <span class="helper">Buffer</span>
                  <span>{{ Number((p.content as Record<string, unknown>)['bufferPct'] ?? 0).toFixed(1) }}%</span>
                </div>
              </template>

              <!-- Default event row -->
              <template v-else>
                <div style="display:flex;align-items:flex-start;gap:var(--s-3)">
                  <span
                    style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0"
                    :style="`background:${AGENT_COLOUR[p.agent] ?? 'var(--fg-3)'}`"
                  />
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:var(--s-2);margin-bottom:3px">
                      <span
                        style="font-size:var(--t-12);font-family:var(--mono);font-weight:600"
                        :style="`color:${AGENT_COLOUR[p.agent] ?? 'var(--fg-2)'}`"
                      >{{ p.agent }}</span>
                      <span class="helper" style="font-family:var(--mono)">round {{ p.round }} · {{ ROUND_LABELS[p.round] ?? 'processing' }}</span>
                    </div>
                    <p style="margin:0;font-size:var(--t-13);color:var(--fg-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:400px">
                      {{ typeof p.content === 'object' && p.content !== null
                          ? Object.keys(p.content).slice(0,3).join(', ') + (Object.keys(p.content).length > 3 ? '…' : '')
                          : '—' }}
                    </p>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Progress bar — v2: state-based / v1: round-based -->
        <div v-if="negotiationStatus === 'negotiating'" style="margin-top:var(--s-5)" data-testid="round-progress">

          <!-- v2: workflow state steps -->
          <template v-if="workflowState">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s-2)">
              <span class="helper">{{ STATE_LABELS[workflowState] ?? workflowState }}</span>
              <span class="helper">{{ Math.round(((workflowStateIndex + 1) / WORKFLOW_STATES.length) * 100) }}%</span>
            </div>
            <div style="display:flex;gap:3px" data-testid="progress-segments">
              <div
                v-for="(state, idx) in WORKFLOW_STATES"
                :key="state"
                style="flex:1;height:8px;border-radius:var(--r-1);overflow:hidden;background:var(--bg-3)"
                :title="STATE_LABELS[state] ?? state"
              >
                <div
                  v-if="idx < workflowStateIndex"
                  style="height:100%;background:var(--green);border-radius:var(--r-1)"
                />
                <div
                  v-else-if="idx === workflowStateIndex"
                  class="progress-segment-active"
                  style="height:100%;background:var(--green-dim);border-radius:var(--r-1)"
                />
              </div>
            </div>
          </template>

          <!-- v1: round-based (unchanged) -->
          <template v-else>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s-2)">
              <span class="helper">
                Round {{ completedRound }} / 6{{ completedRound > 0 ? ' · ' + ROUND_LABELS[completedRound] : '' }}
              </span>
              <span class="helper">{{ Math.round((completedRound / 6) * 100) }}%</span>
            </div>
            <div style="display:flex;gap:3px" data-testid="progress-segments">
              <div
                v-for="n in 6"
                :key="n"
                style="flex:1;height:8px;border-radius:var(--r-1);overflow:hidden;background:var(--bg-3)"
              >
                <div
                  v-if="n <= completedRound"
                  style="height:100%;background:var(--green);border-radius:var(--r-1)"
                />
                <div
                  v-else-if="n === activeRound"
                  class="progress-segment-active"
                  style="height:100%;background:var(--green-dim);border-radius:var(--r-1)"
                />
              </div>
            </div>
          </template>
        </div>

        <!-- Auto-advance hint -->
        <div v-if="negotiationStatus === 'confirmed'" style="margin-top:var(--s-4);padding:var(--s-3) var(--s-4);background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.24);border-radius:var(--r-2)">
          <p style="margin:0;font-size:var(--t-13);color:var(--green)">Negotiation complete — moving to itinerary review…</p>
        </div>
      </div>

      <!-- Right: live discussion panel -->
      <div class="user-right">
        <div class="preview-head">
          <span class="ttl">agent discussion</span>
          <div class="lz" v-if="streamConnected && streamEvents.length > 0">
            <span class="pulse" />
            <span>live</span>
          </div>
        </div>

        <!-- Orchestrator decision card — shown always when available -->
        <div
          v-if="orchestratorDecisions.length > 0"
          style="margin-bottom:var(--s-4)"
        >
          <div class="helper" style="margin-bottom:var(--s-2)">Orchestrator decisions</div>
          <div
            v-for="evt in orchestratorDecisions"
            :key="evt.timestamp + evt.round"
            class="fade-in"
            style="margin-bottom:4px;padding:var(--s-3) var(--s-4);border-radius:var(--r-2)"
            :style="evt.type === 'accept'
              ? 'background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.24)'
              : 'background:rgba(91,157,255,0.06);border:1px solid rgba(91,157,255,0.24)'"
          >
            <div style="display:flex;align-items:center;gap:var(--s-2);margin-bottom:4px;flex-wrap:wrap">
              <span style="font-size:var(--t-12);font-family:var(--mono);font-weight:600;color:var(--fg-0)">
                orchestrator
              </span>
              <span class="helper">round {{ evt.round }} · {{ ROUND_LABELS[evt.round] ?? 'processing' }}</span>
              <span
                style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:1px 6px;border-radius:var(--r-1);background:rgba(255,255,255,0.06);color:var(--fg-2)"
              >{{ evt.type }}</span>
            </div>
            <p
              v-if="evt.reasoning"
              style="margin:0;font-size:var(--t-13);color:var(--fg-1);line-height:1.6"
            >{{ evt.reasoning }}</p>
            <p
              v-else-if="typeof evt.content === 'object' && evt.content !== null"
              style="margin:0;font-size:var(--t-13);color:var(--fg-3);font-style:italic"
            >{{ Object.keys(evt.content as Record<string, unknown>).slice(0, 5).join(', ') }}</p>
          </div>
        </div>

        <!-- Final decision card -->
        <div
          v-if="negotiationStatus !== 'negotiating' && decisionEvent"
          style="margin-bottom:var(--s-4);padding:var(--s-4);border-radius:var(--r-2)"
          :style="negotiationStatus === 'confirmed'
            ? 'background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.24)'
            : 'background:rgba(255,93,93,0.06);border:1px solid rgba(255,93,93,0.24)'"
        >
          <div style="display:flex;align-items:center;gap:var(--s-2);margin-bottom:var(--s-2)">
            <span
              style="font-size:var(--t-12);font-family:var(--mono);font-weight:600"
              :style="negotiationStatus === 'confirmed' ? 'color:var(--green)' : 'color:var(--red)'"
            >
              {{ negotiationStatus === 'confirmed' ? '✓ decision' : '✗ decision' }}
            </span>
            <span class="helper">{{ decisionEvent.agent }} · round {{ decisionEvent.round }}</span>
          </div>
          <p style="margin:0;font-size:var(--t-13);color:var(--fg-1);line-height:1.6">
            {{ decisionEvent.reasoning ?? 'Negotiation concluded.' }}
          </p>
        </div>

        <!-- Skeleton loader — before any events arrive (SSE or DB) -->
        <div
          v-if="discussionEvents.length === 0 && negotiationStatus === 'negotiating'"
          style="display:flex;flex-direction:column;gap:6px"
        >
          <div
            v-for="n in 4"
            :key="n"
            class="stream-skeleton"
            style="padding:var(--s-3) var(--s-4);border:var(--hair);border-radius:var(--r-2);background:var(--bg-2)"
          >
            <div style="display:flex;gap:var(--s-3);align-items:center">
              <div class="skel skel-dot" />
              <div style="flex:1">
                <div class="skel skel-line" style="width:40%;margin-bottom:6px" />
                <div class="skel skel-line" style="width:75%" />
              </div>
            </div>
          </div>
        </div>

        <!-- Agent event feed (newest at top) -->
        <div
          v-if="discussionEvents.length > 0"
          style="overflow-y:auto;max-height:55vh;display:flex;flex-direction:column;gap:1px"
        >
          <div
            v-for="evt in agentOnlyEvents"
            :key="evt.timestamp + evt.agent + evt.round"
            class="stream-event-slide"
            style="padding:var(--s-3) var(--s-4);border:var(--hair);border-radius:var(--r-2);background:var(--bg-2);display:flex;align-items:flex-start;gap:var(--s-3)"
          >
            <!-- Agent status dot -->
            <span
              style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0"
              :class="negotiationStatus === 'negotiating' && evt === discussionEvents[0] ? 'pulse-green' : ''"
              :style="`background:${AGENT_COLOUR[evt.agent] ?? 'var(--fg-3)'}`"
            />
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:var(--s-2);margin-bottom:4px;flex-wrap:wrap">
                <span
                  style="font-size:var(--t-12);font-family:var(--mono);font-weight:600"
                  :style="`color:${AGENT_COLOUR[evt.agent] ?? 'var(--fg-2)'}`"
                >{{ evt.agent }}</span>
                <span class="helper">round {{ evt.round }} · {{ ROUND_LABELS[evt.round] ?? 'processing' }}</span>
                <span
                  style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:1px 6px;border-radius:var(--r-1)"
                  :style="`background:${AGENT_COLOUR[evt.agent] ?? 'var(--fg-4)'}18;color:${AGENT_COLOUR[evt.agent] ?? 'var(--fg-3)'}`"
                >{{ evt.type }}</span>
              </div>
              <p
                v-if="evt.reasoning"
                style="margin:0;font-size:var(--t-13);color:var(--fg-1);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden"
              >{{ evt.reasoning }}</p>
              <p
                v-else
                style="margin:0;font-size:var(--t-13);color:var(--fg-3);font-style:italic"
              >{{ typeof evt.content === 'object' && evt.content !== null
                  ? Object.keys(evt.content as Record<string, unknown>).slice(0,4).join(', ')
                  : '—' }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Step 4: Itinerary ───────────────────────────────── -->
    <div v-if="step === 4" class="user-grid">
      <!-- Left: timeline -->
      <div class="user-left">

        <div style="margin-bottom:var(--s-6)">
          <div class="sec-eyebrow" style="margin-bottom:6px">Proposed itinerary</div>
          <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
            Review what the agents proposed
          </h2>
        </div>

        <!-- Structured itinerary timeline -->
        <div v-if="timelineDays.length > 0" style="margin-bottom:var(--s-6)">
          <TripTimeline
            :days="timelineDays"
            :currency-symbol="financeSummary?.currency ?? currencySymbol"
          />
        </div>

        <div v-else class="helper" style="margin-bottom:var(--s-6)">Proposal data is processing.</div>

        <!-- Actions -->
        <div class="user-form-foot">
          <button class="btn" style="color:var(--red);border-color:rgba(255,93,93,0.32)" @click="handleReject">
            Reject
          </button>
          <button
            class="btn"
            data-testid="refine-trip-btn"
            @click="handleRefine"
          >
            ← Refine trip
          </button>
          <button class="btn btn-primary" @click="handleAccept">
            Accept &amp; Export →
          </button>
        </div>
      </div>

      <!-- Right: results panel -->
      <div class="user-right">
        <div class="preview-head">
          <span class="ttl">Negotiation results</span>
        </div>

        <!-- Weather forecast — per-day icon grid (hidden when flexible with no preferred month) -->
        <div v-if="showWeather && (dayWeatherCards.length > 0 || logisticsWeatherSummary)" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub" style="margin-bottom:var(--s-3)">Weather forecast</div>

          <!-- Day-by-day icon grid -->
          <div
            v-if="dayWeatherCards.length > 0"
            style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:var(--s-2);margin-bottom:var(--s-3)"
          >
            <div
              v-for="card in dayWeatherCards"
              :key="card.day"
              style="display:flex;flex-direction:column;align-items:center;padding:var(--s-3) var(--s-2);background:var(--bg-2);border:var(--hair);border-radius:var(--r-2);gap:2px"
            >
              <span style="font-size:20px;line-height:1.2">{{ weatherEmoji(card.risk) }}</span>
              <span style="font-family:var(--mono);font-size:10px;color:var(--fg-0);font-weight:600">Day {{ card.day }}</span>
              <span v-if="card.date" style="font-family:var(--mono);font-size:9px;color:var(--fg-3)">{{ card.date.slice(5) }}</span>
              <span
                style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.04em"
                :style="card.risk === 'high' ? 'color:var(--red)' : card.risk === 'medium' ? 'color:var(--amber)' : 'color:var(--green)'"
              >{{ card.label }}</span>
            </div>
          </div>

          <!-- Summary text (truncated) -->
          <p
            v-if="logisticsWeatherSummary"
            style="margin:0;font-size:var(--t-12);color:var(--fg-3);line-height:1.5"
          >{{ logisticsWeatherSummary }}</p>

          <!-- High-risk alerts -->
          <div v-if="weatherAlerts.length > 0" style="display:flex;flex-direction:column;gap:var(--s-2);margin-top:var(--s-3)">
            <div
              v-for="(alert, i) in weatherAlerts"
              :key="i"
              style="padding:var(--s-2) var(--s-3);background:var(--amber-bg);border:1px solid var(--amber-line);border-radius:var(--r-2);display:flex;align-items:flex-start;gap:var(--s-2)"
            >
              <span style="color:var(--amber);flex-shrink:0;font-size:var(--t-12)">⚠</span>
              <p style="margin:0;font-size:var(--t-12);color:var(--fg-1)">{{ alert }}</p>
            </div>
          </div>
        </div>

        <!-- ScoresCard: per-traveller satisfaction -->
        <div v-if="travellerScores.length > 0" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub">Traveller satisfaction</div>
          <div style="display:flex;flex-direction:column;gap:var(--s-3);padding-top:var(--s-3)">
            <div v-for="score in travellerScores" :key="score.travellerId" style="display:flex;flex-direction:column;gap:var(--s-2)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:var(--s-2)">
                  <span style="font-size:var(--t-13);color:var(--fg-0)">{{ score.name }}</span>
                  <span
                    class="chip on"
                    style="font-size:10px;height:20px;padding:0 6px"
                    :style="`color:${AGENT_COLOUR[PERSONA_AGENT[score.persona]] ?? 'var(--fg-2)'};border-color:${AGENT_COLOUR[PERSONA_AGENT[score.persona]] ?? 'var(--fg-3)'}44`"
                  >{{ PERSONA_LABELS[score.persona] }}</span>
                </div>
                <span style="font-family:var(--mono);font-size:var(--t-12);color:var(--green)">{{ Math.round(score.postScore * 100) }}%</span>
              </div>
              <!-- Score bar -->
              <div style="height:4px;background:var(--bg-3);border-radius:2px;overflow:hidden">
                <div
                  style="height:100%;background:var(--green);border-radius:2px;transition:width 0.5s"
                  :style="`width:${Math.round(score.postScore * 100)}%`"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Validator results: fairness + satisfaction + constraints -->
        <div v-else-if="validatorSummary" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub" style="margin-bottom:var(--s-3)">Negotiation quality</div>

          <!-- Fairness score bar -->
          <div v-if="validatorSummary.fairnessScore !== null" style="margin-bottom:var(--s-3)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span style="font-size:var(--t-12);color:var(--fg-2)">Fairness</span>
              <span
                style="font-family:var(--mono);font-size:var(--t-12);font-weight:600"
                :style="validatorSummary.fairnessScore >= 70 ? 'color:var(--green)' : 'color:var(--amber)'"
              >{{ validatorSummary.fairnessScore }}%</span>
            </div>
            <div style="height:5px;background:var(--bg-3);border-radius:3px;overflow:hidden">
              <div
                style="height:100%;border-radius:3px;transition:width .5s"
                :style="`width:${validatorSummary.fairnessScore}%;background:${validatorSummary.fairnessScore >= 70 ? 'var(--green)' : 'var(--amber)'}`"
              />
            </div>
          </div>

          <!-- Overall satisfaction bar -->
          <div v-if="validatorSummary.overallScore !== null" style="margin-bottom:var(--s-3)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span style="font-size:var(--t-12);color:var(--fg-2)">Satisfaction</span>
              <span
                style="font-family:var(--mono);font-size:var(--t-12);font-weight:600"
                :style="validatorSummary.overallScore >= 70 ? 'color:var(--green)' : 'color:var(--amber)'"
              >{{ validatorSummary.overallScore }}%</span>
            </div>
            <div style="height:5px;background:var(--bg-3);border-radius:3px;overflow:hidden">
              <div
                style="height:100%;border-radius:3px;transition:width .5s"
                :style="`width:${validatorSummary.overallScore}%;background:${validatorSummary.overallScore >= 70 ? 'var(--green)' : 'var(--amber)'}`"
              />
            </div>
          </div>

          <!-- Constraints + rounds -->
          <div class="kv" style="margin-top:var(--s-2)">
            <template v-if="validatorSummary.constraintsPassed !== null">
              <div class="k">Constraints</div>
              <div class="v mono" :style="validatorSummary.constraintsPassed ? 'color:var(--green)' : 'color:var(--red)'">
                {{ validatorSummary.constraintsPassed ? '✓ passed' : '✗ issues' }}
              </div>
            </template>
            <template v-if="validatorSummary.rounds !== null">
              <div class="k">Rounds</div>
              <div class="v mono">{{ validatorSummary.rounds }}</div>
            </template>
          </div>
        </div>

        <!-- BudgetBreakdown (issue #73) -->
        <TripBudgetBreakdown v-if="budgetBreakdown" :breakdown="budgetBreakdown" />

        <!-- CostBreakdown (fallback for proposals without budgetBreakdown) -->
        <div v-else-if="costCategories.length > 0" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub">Cost breakdown</div>
          <div class="kv" style="padding-top:var(--s-3)">
            <template v-for="cat in costCategories" :key="cat.label">
              <div class="k">{{ cat.label }}</div>
              <div class="v mono">{{ financeSummary?.currency ?? '€' }}{{ cat.amount.toLocaleString() }}</div>
            </template>
            <template v-if="transportCostEur">
              <div class="k">transport</div>
              <div class="v mono">{{ financeSummary?.currency ?? '€' }}{{ transportCostEur.toLocaleString() }}</div>
            </template>
          </div>
          <div v-if="financeSummary?.grandTotal" style="display:flex;justify-content:space-between;align-items:center;padding-top:var(--s-3);margin-top:var(--s-3);border-top:var(--hair)">
            <span style="font-family:var(--mono);font-size:var(--t-12);color:var(--fg-2);text-transform:uppercase;letter-spacing:.06em">Total</span>
            <span style="font-family:var(--mono);font-size:var(--t-14);color:var(--fg-0);font-weight:600">{{ financeSummary.currency ?? '€' }}{{ String(financeSummary.grandTotal) }}</span>
          </div>
        </div>

        <!-- CostBreakdown fallback: finance summary only -->
        <div v-else-if="financeSummary" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub" style="margin-bottom:var(--s-3)">Budget review</div>
          <!-- Status pill -->
          <div v-if="financeSummary.status" style="margin-bottom:var(--s-3)">
            <span
              style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:3px 10px;border-radius:var(--r-1);font-weight:600"
              :style="financeSummary.status === 'within_budget'
                ? 'background:rgba(0,255,136,0.08);color:var(--green);border:1px solid rgba(0,255,136,0.3)'
                : 'background:rgba(255,163,0,0.08);color:var(--amber);border:1px solid rgba(255,163,0,0.3)'"
            >{{ financeSummary.status === 'within_budget' ? '✓ Within budget' : '⚠ Over budget' }}</span>
          </div>
          <!-- Cost line — only if a real value was calculated -->
          <div class="kv" style="margin-top:var(--s-2)">
            <div class="k">Estimated cost</div>
            <div class="v mono">
              <template v-if="financeSummary.grandTotal && Number(financeSummary.grandTotal) > 0">
                {{ financeSummary.currency ?? '€' }}{{ Number(financeSummary.grandTotal).toLocaleString() }}
              </template>
              <span v-else class="helper">Not itemised</span>
            </div>
          </div>
        </div>

        <!-- Agents involved -->
        <div class="suggest" style="margin-bottom:var(--s-4)">
          <h4>Agents involved</h4>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--s-2)">
            <span
              v-for="agent in Object.keys(latestByAgent)"
              :key="agent"
              class="chip on"
              style="font-size:var(--t-12)"
              :style="`color:${AGENT_COLOUR[agent] ?? 'var(--fg-2)'};border-color:${AGENT_COLOUR[agent] ?? 'var(--fg-3)'}44`"
            >{{ agent }}</span>
          </div>
        </div>

        <!-- Export & Share actions -->
        <div style="display:flex;flex-direction:column;gap:var(--s-2);padding-top:var(--s-4);border-top:var(--hair)">
          <button
            class="btn btn-primary"
            style="width:100%;justify-content:center"
            :disabled="exportLoading"
            @click="downloadPdf"
          >{{ exportLoading ? 'Generating…' : '↓ Export PDF' }}</button>
          <button
            class="btn"
            style="width:100%;justify-content:center"
            :disabled="shareLoading"
            @click="handleShare"
          >{{ shareCopied ? '✓ Copied!' : shareLoading ? 'Generating…' : '⎘ Share link' }}</button>
          <p v-if="exportError || shareError" style="margin:0;font-size:var(--t-12);color:var(--red)">
            {{ exportError ?? shareError }}
          </p>
        </div>
      </div>
    </div>

    <!-- ── Step 5: Export ──────────────────────────────────── -->
    <div v-if="step === 5" class="user-grid">
      <div class="user-left" style="flex:1;max-width:600px">

        <div style="margin-bottom:var(--s-8)">
          <div class="sec-eyebrow" style="margin-bottom:6px;color:var(--green)">Confirmed</div>
          <h2 style="margin:0;font-size:var(--t-28);font-weight:400;letter-spacing:-0.02em">
            {{ tripName }} is ready.
          </h2>
          <p style="margin:var(--s-2) 0 0;color:var(--fg-3);font-size:var(--t-14)">
            {{ region }} · {{ dateMode === 'flexible' ? `${flexDays} nights (flexible)` : `${nights} nights` }} · {{ travellers.length }} traveller{{ travellers.length !== 1 ? 's' : '' }}
          </p>
        </div>

        <div style="display:flex;flex-direction:column;gap:var(--s-3)">
          <!-- PDF export -->
          <div style="border:var(--hair);border-radius:var(--r-2);padding:var(--s-5);background:var(--bg-1)">
            <div style="margin-bottom:var(--s-3)">
              <p style="margin:0;font-size:var(--t-15);font-weight:500">Download PDF</p>
              <p style="margin:4px 0 0;font-size:var(--t-13);color:var(--fg-3)">Full itinerary with day-by-day plan, activities and logistics.</p>
            </div>
            <div v-if="exportError" style="font-size:var(--t-13);color:var(--red);margin-bottom:var(--s-3)">{{ exportError }}</div>
            <button
              class="btn btn-primary"
              :disabled="exportLoading"
              @click="downloadPdf"
            >
              {{ exportLoading ? 'Generating…' : '↓ Download PDF' }}
            </button>
          </div>

          <!-- Summary card -->
          <div style="border:var(--hair);border-radius:var(--r-2);padding:var(--s-5);background:var(--bg-1)">
            <div class="sub" style="margin-bottom:var(--s-3)">Trip summary</div>
            <div class="kv">
              <div class="k">Budget</div>
              <div class="v mono">{{ currencySymbol }}{{ budgetTotal.toLocaleString() }}</div>
              <div class="k">Per person</div>
              <div class="v mono">{{ currencySymbol }}{{ budgetPerPerson.toLocaleString() }}</div>
              <div class="k">Rounds completed</div>
              <div class="v mono">{{ liveProposals.length > 0 ? Math.max(...liveProposals.map(p => p.round)) : 6 }}</div>
              <div class="k">Agents involved</div>
              <div class="v mono">{{ new Set(liveProposals.map(p => p.agent)).size }}</div>
            </div>
          </div>
        </div>

        <div class="user-form-foot" style="margin-top:var(--s-6)">
          <button class="btn btn-primary" @click="goToDashboard">
            ← Back to dashboard
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
