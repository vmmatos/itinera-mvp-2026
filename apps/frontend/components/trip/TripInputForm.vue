<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { PERSONA_LABELS, PERSONA_AGENT, AGENT_COLOURS } from '~/types/index'
import type { Persona, Flexibility, Currency, CreateTripInput, TravellerInput, SatisfactionScore } from '~/types/index'

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

const mustHaveInput  = ref('')
const mustHaves      = ref<string[]>([])
const dealBreakerInput = ref('')
const dealBreakers   = ref<string[]>([])

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
  startDate.value !== '' &&
  endDate.value !== '' &&
  nights.value > 0 &&
  budgetTotal.value > 0,
)

// ── Submit → enters step 3 ────────────────────────────────────

const store = useTripPlannerStore()
const api   = useApi()

const activeTripId = ref<string | null>(null)

const submit = async (): Promise<void> => {
  if (!step1Valid.value || !step2Valid.value) return

  const payload: CreateTripInput = {
    name:           tripName.value.trim(),
    region:         region.value.trim(),
    startDate:      startDate.value,
    endDate:        endDate.value,
    budgetTotal:    budgetTotal.value,
    budgetCurrency: budgetCurrency.value,
    travellers:     travellers.value.map((t): TravellerInput => ({
      userId: t.isCurrentUser ? currentUserId.value : undefined,
      preferences: {
        persona:      t.persona!,
        flexibility:  t.flexibility,
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

const startNegotiationPolling = (tripId: string): void => {
  const poll = async (): Promise<void> => {
    try {
      const [tripResp, propResp] = await Promise.all([
        api.get<{ success: boolean; data: { status: string } }>(`/api/v1/trips/${tripId}`),
        api.get<{ success: boolean; data: ProposalEntry[] }>(`/api/v1/trips/${tripId}/proposals`),
      ])
      negotiationStatus.value = tripResp.data.data.status
      liveProposals.value = propResp.data.data

      if (negotiationStatus.value === 'confirmed') {
        stopPolling()
        setTimeout(() => { step.value = 4 }, 800)
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

const decisionEvent = computed(() =>
  streamEvents.value.find(
    (e) => (e.agent === 'orchestrator' || e.agent === 'validator') && e.round === 6,
  ) ?? null,
)

// Orchestrator events with reasoning — displayed separately in decisions panel
const orchestratorDecisions = computed(() =>
  streamEvents.value.filter(
    (e) => e.agent === 'orchestrator' && e.reasoning,
  ),
)

// Non-orchestrator events for the main feed
const agentOnlyEvents = computed(() =>
  streamEvents.value.filter((e) => e.agent !== 'orchestrator'),
)

// ── Step 4: Itinerary review ──────────────────────────────────

interface ItineraryActivity {
  name:          string
  time?:         string
  location?:     string
  notes?:        string
  cost?:         number
  weatherAlert?: string
}

interface ItineraryDay {
  day:        number
  date?:      string
  activities: ItineraryActivity[]
  meals?:     Array<{ type: string; name: string }>
}

function tryParseItinerary(content: Record<string, unknown>): ItineraryDay[] {
  const mapActivities = (raw: unknown): ItineraryActivity[] => {
    if (!Array.isArray(raw)) return []
    return (raw as Array<Record<string, unknown>>).map((a) => ({
      name:         String(a['name'] ?? a['activity'] ?? a['title'] ?? '—'),
      time:         typeof a['time'] === 'string' ? a['time']
                      : typeof a['startTime'] === 'string' ? a['startTime'] : undefined,
      location:     typeof a['location'] === 'string' ? a['location'] : undefined,
      notes:        typeof a['notes'] === 'string' ? a['notes']
                      : typeof a['description'] === 'string' ? a['description'] : undefined,
      cost:         typeof a['cost'] === 'number' ? a['cost'] : undefined,
      weatherAlert: typeof a['weatherAlert'] === 'string' ? a['weatherAlert'] : undefined,
    }))
  }

  const tryFromObj = (obj: unknown): ItineraryDay[] => {
    if (!obj || typeof obj !== 'object') return []
    const o = obj as Record<string, unknown>
    const raw = o['itinerary'] ?? o['days'] ?? o['plan'] ?? o['schedule']
    if (!Array.isArray(raw) || raw.length === 0) return []
    return (raw as Array<Record<string, unknown>>).map((d, i) => ({
      day:        typeof d['day'] === 'number' ? d['day'] : i + 1,
      date:       typeof d['date'] === 'string' ? d['date'] : undefined,
      activities: mapActivities(d['activities']),
      meals:      Array.isArray(d['meals'])
        ? (d['meals'] as Array<Record<string, unknown>>).map((m) => ({
            type: String(m['type'] ?? 'meal'),
            name: String(m['name'] ?? '—'),
          }))
        : undefined,
    }))
  }

  const direct = tryFromObj(content)
  if (direct.length > 0) return direct

  if (typeof content['raw'] === 'string') {
    try {
      // Strip markdown code fences (```json ... ```) before parsing
      const stripped = content['raw']
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim()
      const fromRaw = tryFromObj(JSON.parse(stripped) as unknown)
      if (fromRaw.length > 0) return fromRaw
    } catch { /* not JSON */ }
  }

  return []
}

function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
}

const latestByAgent = computed((): Record<string, ProposalEntry> => {
  const map: Record<string, ProposalEntry> = {}
  for (const p of liveProposals.value) {
    const existing = map[p.agent]
    if (!existing || p.round > existing.round) map[p.agent] = p
  }
  return map
})

const parsedItinerary = computed((): ItineraryDay[] => {
  // Prefer orchestrator round 3 (compromise proposal from /propose endpoint)
  const orchestratorRound3 = liveProposals.value.find(
    (p) => p.agent === 'orchestrator' && p.round === 3,
  )
  if (orchestratorRound3) {
    const days = tryParseItinerary(orchestratorRound3.content)
    if (days.length > 0) return days
  }

  // Fallback: any proposal with structured itinerary data
  const ordered = ['orchestrator', 'validator', 'logistics', 'finance', 'alice', 'bob', 'carlos', 'diana']
  for (const agent of ordered) {
    const p = latestByAgent.value[agent]
    if (!p) continue
    const days = tryParseItinerary(p.content)
    if (days.length > 0) return days
  }
  return []
})

const validatorSummary = computed(() => {
  const p = latestByAgent.value['validator']
  if (!p) return null
  const c = p.content
  return {
    metrics: c['metrics'] as Record<string, unknown> | undefined,
    scoring: c['scoring'] as Record<string, unknown> | undefined,
    fairness: typeof c['fairness'] === 'number' ? c['fairness'] : undefined,
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

const orchestratorText = computed((): string | null => {
  const p = latestByAgent.value['orchestrator']
  if (!p) return null
  const raw = p.content['raw']
  if (typeof raw === 'string') {
    const clean = stripCodeFences(raw)
    return clean.slice(0, 800) + (clean.length > 800 ? '…' : '')
  }
  return null
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

  // Backend sends byCategory: { activities, meals, transport }
  const byCat = bd['byCategory'] as Record<string, number> | undefined
  if (byCat && typeof byCat === 'object') {
    return Object.entries(byCat)
      .map(([label, amount]) => ({ label, amount }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }

  // Fallback: categories array format
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
  return typeof summary === 'string' ? summary.slice(0, 400) : null
})

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

const handleAccept = (): void => { step.value = 5 }
const handleReject = (): void => {
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
            style="border: var(--hair); background: var(--bg-1); border-radius: var(--r-2); padding: var(--s-4);"
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
                />
                <span v-else class="gn">
                  {{ t.name }}
                  <span class="role">organiser</span>
                </span>
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
            :disabled="!step1Valid"
            @click="step = 2"
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
          <div class="field-input" style="width:100%">
            <input
              v-model="tripName"
              class="txt full lg"
              placeholder="e.g. Cusco run · Jun 2026"
              data-testid="trip-name"
            />
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Destination</div>
          <div class="field-input" style="width:100%">
            <input
              v-model="region"
              class="txt full"
              placeholder="e.g. Cusco + Sacred Valley, Peru"
              data-testid="region"
            />
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Dates</div>
          <div class="field-input">
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
              @keydown.enter.prevent="addDealBreaker"
              @blur="addDealBreaker"
            />
          </div>
        </div>

        <div v-if="store.error" style="padding:var(--s-3) var(--s-4);background:rgba(255,93,93,0.08);border:1px solid rgba(255,93,93,0.32);border-radius:var(--r-2);font-size:var(--t-13);color:var(--red);margin-top:var(--s-4)">
          {{ store.error }}
        </div>

        <div class="user-form-foot">
          <span class="helper">{{ step2Valid ? 'ready' : 'fill required fields' }}</span>
          <div style="display:flex;gap:8px">
            <button class="btn" @click="step = 1">Back</button>
            <button
              class="btn btn-primary"
              :disabled="!step2Valid || store.loading"
              data-testid="submit-btn"
              @click="submit"
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
          <h3>{{ region || '—' }}{{ nights > 0 ? ` · ${nights} nights` : '' }} · {{ travellers.length }} travellers</h3>
          <div class="kv">
            <div class="k">target / pp</div>
            <div class="v"><span class="mono">{{ currencySymbol }}{{ budgetPerPerson.toLocaleString() }}</span></div>
            <div class="k">pace</div>
            <div class="v">{{ tripFlexibility === 'low' ? 'slow' : tripFlexibility === 'medium' ? 'moderate' : 'packed' }}</div>
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
            <span v-if="negotiationStatus === 'negotiating'" class="helper pulse-green" style="font-family:var(--mono)">
              ● live
            </span>
            <span v-else-if="negotiationStatus === 'confirmed'" style="color:var(--green);font-family:var(--mono);font-size:var(--t-13)">
              ✓ confirmed
            </span>
            <span v-else-if="negotiationStatus === 'cancelled'" style="color:var(--red);font-family:var(--mono);font-size:var(--t-13)">
              ✗ cancelled
            </span>
          </div>
        </div>

        <!-- Cancelled state -->
        <div v-if="negotiationStatus === 'cancelled'" style="padding:var(--s-6);background:rgba(255,93,93,0.06);border:1px solid rgba(255,93,93,0.24);border-radius:var(--r-2);text-align:center">
          <p style="color:var(--red);font-size:var(--t-15);margin:0 0 var(--s-3)">Negotiation failed</p>
          <p class="helper" style="margin:0 0 var(--s-4)">The agents could not agree on an itinerary. Please try again.</p>
          <button class="btn" @click="emit('cancel')">Back to dashboard</button>
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
              style="padding:var(--s-3) var(--s-4);border-bottom:var(--hair);display:flex;align-items:flex-start;gap:var(--s-3)"
            >
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
          </div>
        </div>

        <!-- Round progress -->
        <div v-if="negotiationStatus === 'negotiating'" style="margin-top:var(--s-4)">
          <div class="helper" style="margin-bottom:var(--s-2)">
            Round {{ Math.min(liveProposals.length > 0 ? Math.max(...liveProposals.map(p => p.round)) : 0, 6) }} / 6
          </div>
          <div style="height:4px;background:var(--bg-3);border-radius:2px;overflow:hidden">
            <div
              style="height:100%;background:var(--green);border-radius:2px;transition:width 0.5s"
              :style="`width:${Math.min((liveProposals.length > 0 ? Math.max(...liveProposals.map(p => p.round)) : 0) / 6 * 100, 100)}%`"
            />
          </div>
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
          <div class="lz" v-if="streamConnected">
            <span class="pulse" />
            <span>live</span>
          </div>
          <span v-else class="helper">{{ streamEvents.length }} messages</span>
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

        <!-- Skeleton loader — before any stream events arrive -->
        <div
          v-if="streamEvents.length === 0 && negotiationStatus === 'negotiating'"
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
          v-if="streamEvents.length > 0"
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
              :class="negotiationStatus === 'negotiating' && evt === streamEvents[0] ? 'pulse-green' : ''"
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
        <div v-if="parsedItinerary.length > 0" style="display:flex;flex-direction:column;gap:var(--s-3);margin-bottom:var(--s-6)">
          <div
            v-for="day in parsedItinerary"
            :key="day.day"
            style="border:var(--hair);border-radius:var(--r-2);background:var(--bg-1);overflow:hidden"
          >
            <!-- Day header -->
            <div style="padding:var(--s-3) var(--s-4);border-bottom:var(--hair);display:flex;align-items:center;gap:var(--s-3);background:var(--bg-2)">
              <span style="font-family:var(--mono);font-size:var(--t-12);color:var(--green);font-weight:600;background:var(--green-bg);border:1px solid var(--green-line);padding:2px 8px;border-radius:var(--r-1)">Day {{ day.day }}</span>
              <span v-if="day.date" class="helper">{{ day.date }}</span>
            </div>
            <div style="padding:var(--s-3) var(--s-4)">
              <div v-if="day.activities.length === 0" class="helper" style="padding:var(--s-2) 0">No structured activities.</div>
              <div
                v-for="(act, i) in day.activities"
                :key="i"
                style="display:flex;align-items:flex-start;gap:var(--s-3);padding:var(--s-3) 0;border-bottom:1px solid rgba(255,255,255,0.04)"
              >
                <!-- Time pill -->
                <span
                  v-if="act.time"
                  style="font-family:var(--mono);font-size:var(--t-12);color:var(--green);background:var(--green-bg);padding:2px 6px;border-radius:var(--r-1);min-width:52px;text-align:center;flex-shrink:0;margin-top:1px"
                >{{ act.time }}</span>
                <span v-else style="min-width:52px;flex-shrink:0" />
                <!-- Activity details -->
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:var(--s-2);flex-wrap:wrap;margin-bottom:2px">
                    <p style="margin:0;font-size:var(--t-14);color:var(--fg-0);font-weight:500">{{ act.name }}</p>
                    <!-- Weather alert badge per activity -->
                    <span
                      v-if="act.weatherAlert"
                      style="font-family:var(--mono);font-size:10px;color:var(--amber);background:var(--amber-bg);border:1px solid var(--amber-line);padding:1px 6px;border-radius:var(--r-1)"
                    >⚠ {{ act.weatherAlert }}</span>
                    <!-- Cost badge -->
                    <span
                      v-if="act.cost"
                      style="font-family:var(--mono);font-size:var(--t-12);color:var(--fg-2)"
                    >{{ financeSummary?.currency ?? currencySymbol }}{{ act.cost }}</span>
                  </div>
                  <p v-if="act.location" style="margin:0;font-size:var(--t-12);color:var(--fg-3)">{{ act.location }}</p>
                  <p v-if="act.notes" style="margin:2px 0 0;font-size:var(--t-12);color:var(--fg-3);font-style:italic">{{ act.notes }}</p>
                </div>
              </div>
              <!-- Meals row -->
              <div v-if="day.meals && day.meals.length > 0" style="margin-top:var(--s-3);display:flex;gap:var(--s-2);flex-wrap:wrap;padding-top:var(--s-2);border-top:1px solid rgba(255,255,255,0.04)">
                <span v-for="m in day.meals" :key="m.type" class="chip on" style="font-size:var(--t-12)">
                  {{ m.type }}: {{ m.name }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Orchestrator proposal text fallback -->
        <div v-else-if="orchestratorText" style="margin-bottom:var(--s-6);border:var(--hair);border-radius:var(--r-2);background:var(--bg-1);padding:var(--s-4)">
          <div class="helper" style="margin-bottom:var(--s-3)">Agent-proposed itinerary</div>
          <p style="font-size:var(--t-13);color:var(--fg-2);line-height:1.7;margin:0;white-space:pre-wrap">{{ orchestratorText }}</p>
        </div>

        <div v-else class="helper" style="margin-bottom:var(--s-6)">Proposal data is processing.</div>

        <!-- Actions -->
        <div class="user-form-foot">
          <button class="btn" style="color:var(--red);border-color:rgba(255,93,93,0.32)" @click="handleReject">
            Reject
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

        <!-- Weather section (conditional — only shown when logistics data present) -->
        <div v-if="weatherAlerts.length > 0 || logisticsWeatherSummary" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub" style="margin-bottom:var(--s-3)">Weather forecast</div>
          <p v-if="logisticsWeatherSummary" style="margin:0 0 var(--s-3);font-size:var(--t-13);color:var(--fg-1);line-height:1.6">
            {{ logisticsWeatherSummary }}
          </p>
          <div v-if="weatherAlerts.length > 0" style="display:flex;flex-direction:column;gap:var(--s-2)">
            <div
              v-for="(alert, i) in weatherAlerts"
              :key="i"
              style="padding:var(--s-2) var(--s-3);background:var(--amber-bg);border:1px solid var(--amber-line);border-radius:var(--r-2);display:flex;align-items:flex-start;gap:var(--s-2)"
            >
              <span style="color:var(--amber);flex-shrink:0;font-size:var(--t-12)">⚠</span>
              <p style="margin:0;font-size:var(--t-13);color:var(--fg-1)">{{ alert }}</p>
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

        <!-- ScoresCard fallback: fairness only -->
        <div v-else-if="validatorSummary" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub">Fairness score</div>
          <div class="kv">
            <template v-if="validatorSummary.metrics">
              <template v-for="(val, key) in validatorSummary.metrics" :key="String(key)">
                <div class="k">{{ String(key) }}</div>
                <div class="v mono">{{ val }}</div>
              </template>
            </template>
            <div v-if="typeof validatorSummary.fairness === 'number'" class="k">Fairness</div>
            <div v-if="typeof validatorSummary.fairness === 'number'" class="v mono" style="color:var(--green)">
              {{ Math.round(validatorSummary.fairness * 100) }}%
            </div>
          </div>
        </div>

        <!-- CostBreakdown -->
        <div v-if="costCategories.length > 0" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub">Cost breakdown</div>
          <div class="kv" style="padding-top:var(--s-3)">
            <template v-for="cat in costCategories" :key="cat.label">
              <div class="k">{{ cat.label }}</div>
              <div class="v mono">{{ financeSummary?.currency ?? '€' }}{{ cat.amount.toLocaleString() }}</div>
            </template>
          </div>
          <div v-if="financeSummary?.grandTotal" style="display:flex;justify-content:space-between;align-items:center;padding-top:var(--s-3);margin-top:var(--s-3);border-top:var(--hair)">
            <span style="font-family:var(--mono);font-size:var(--t-12);color:var(--fg-2);text-transform:uppercase;letter-spacing:.06em">Total</span>
            <span style="font-family:var(--mono);font-size:var(--t-14);color:var(--fg-0);font-weight:600">{{ financeSummary.currency ?? '€' }}{{ String(financeSummary.grandTotal) }}</span>
          </div>
        </div>

        <!-- CostBreakdown fallback: finance summary only -->
        <div v-else-if="financeSummary" class="summary-card" style="margin-bottom:var(--s-4)">
          <div class="sub">Budget review</div>
          <div class="kv">
            <div class="k">Estimated cost</div>
            <div class="v mono">{{ financeSummary.grandTotal ?? '—' }} {{ financeSummary.currency ?? '' }}</div>
            <div class="k">Status</div>
            <div class="v" :style="financeSummary.status === 'within_budget' ? 'color:var(--green)' : 'color:var(--amber)'">
              {{ financeSummary.status ?? '—' }}
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
            {{ region }} · {{ nights }} nights · {{ travellers.length }} traveller{{ travellers.length !== 1 ? 's' : '' }}
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
