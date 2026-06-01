<script setup lang="ts">
import { ref, computed } from 'vue'
import { PERSONA_LABELS, PERSONA_AGENT, AGENT_COLOURS } from '~/types/index'
import type { Persona, Flexibility, CreateTripInput, TravellerInput } from '~/types/index'

const emit = defineEmits<{
  success: [tripId: string]
  cancel: []
}>()

// ── Auth ─────────────────────────────────────────────────────
const authStore = useAuthStore()

// ── Wizard step ───────────────────────────────────────────────
const step = ref<1 | 2>(1)

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
const budgetTotal = ref(3000)
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

// ── Submit ────────────────────────────────────────────────────

const store = useTripPlannerStore()

const submit = async (): Promise<void> => {
  if (!step1Valid.value || !step2Valid.value) return

  const payload: CreateTripInput = {
    name:           tripName.value.trim(),
    region:         region.value.trim(),
    startDate:      startDate.value,
    endDate:        endDate.value,
    budgetTotal:    budgetTotal.value,
    budgetCurrency: 'USD',
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
    emit('success', tripId)
  } catch {
    // error surfaced via store.error
  }
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
        <div class="logo">
          <svg width="18" height="18" viewBox="0 0 28 28">
            <circle cx="6" cy="14" r="2.4" stroke="#00ff88" stroke-width="1.2"/>
            <circle cx="14" cy="6" r="2.4" stroke="#f2f2f2" stroke-width="1.2"/>
            <circle cx="22" cy="14" r="2.4" stroke="#f2f2f2" stroke-width="1.2"/>
            <circle cx="14" cy="22" r="2.4" stroke="#f2f2f2" stroke-width="1.2"/>
            <path d="M8 13 L21 15" stroke="#00ff88" stroke-width="1.2"/>
          </svg>
          <span class="word">itinera</span>
        </div>
        <span class="sep">/</span>
        <b>{{ tripName || 'New trip' }}</b>
        <span class="sep">/</span>
        <span>draft</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn" @click="emit('cancel')">Cancel</button>
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
      <div class="ustep"><span class="n">03</span> Negotiate</div>
      <div class="ustep"><span class="n">04</span> Itinerary</div>
      <div class="ustep"><span class="n">05</span> Export</div>
      <div style="margin-left:auto;align-self:center" class="helper">
        step 0{{ step }} · fill in your details
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
              data-testid="end-date"
            />
            <span v-if="nights > 0" class="helper">{{ nights }} night{{ nights !== 1 ? 's' : '' }}</span>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Budget / pp</div>
          <div class="field-input" style="width:100%;flex-direction:column;align-items:stretch;gap:var(--s-2)">
            <div class="budget">
              <span class="helper" style="min-width:50px">$500</span>
              <div class="track" style="position:relative">
                <div class="fill" :style="`width:${budgetPercent}%`" />
              </div>
              <span class="helper" style="min-width:60px">$20k</span>
              <span class="val">${{ budgetTotal.toLocaleString() }} ceiling</span>
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
            <div class="v"><span class="mono">${{ budgetPerPerson.toLocaleString() }}</span></div>
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

        <div class="suggest" v-if="travellers.filter(t => t.persona).length > 1">
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
  </div>
</template>
