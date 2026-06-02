<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{ error: { statusCode: number; message?: string; url?: string } }>()

const handleError = (): void => clearError({ redirect: '/' })

// ── Floating node animation ───────────────────────────────────

interface Node { x: number; y: number; vx: number; vy: number; r: number; colour: string }

const canvas = ref<HTMLCanvasElement | null>(null)
const COLOURS = ['#00ff88', '#ffb547', '#5b9dff', '#d36bff']
let animFrame = 0

function initNodes(w: number, h: number): Node[] {
  return Array.from({ length: 28 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 2 + 1.5,
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
  }))
}

onMounted(() => {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return

  const resize = (): void => {
    el.width  = el.offsetWidth
    el.height = el.offsetHeight
  }
  resize()
  window.addEventListener('resize', resize)

  const nodes = initNodes(el.width, el.height)
  const LINK_DIST = 140

  const draw = (): void => {
    const w = el.width
    const h = el.height
    ctx.clearRect(0, 0, w, h)

    // links
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < LINK_DIST) {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(255,255,255,${0.06 * (1 - d / LINK_DIST)})`
          ctx.lineWidth = 0.8
          ctx.moveTo(nodes[i].x, nodes[i].y)
          ctx.lineTo(nodes[j].x, nodes[j].y)
          ctx.stroke()
        }
      }
    }

    // nodes
    for (const n of nodes) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
      ctx.fillStyle = n.colour + '99'
      ctx.fill()

      // move & bounce
      n.x += n.vx
      n.y += n.vy
      if (n.x < 0 || n.x > w) n.vx *= -1
      if (n.y < 0 || n.y > h) n.vy *= -1
    }

    animFrame = requestAnimationFrame(draw)
  }

  draw()

  onUnmounted(() => {
    cancelAnimationFrame(animFrame)
    window.removeEventListener('resize', resize)
  })
})
</script>

<template>
  <div style="position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-0);overflow:hidden">

    <!-- Animated background -->
    <canvas
      ref="canvas"
      style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"
    />

    <!-- Content -->
    <div class="fade-in" style="position:relative;z-index:1;text-align:center;padding:var(--s-8)">

      <!-- Logo -->
      <div style="display:flex;align-items:center;justify-content:center;gap:var(--s-3);margin-bottom:var(--s-8)">
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle cx="6"  cy="14" r="2.4" stroke="#00ff88" stroke-width="1.2" fill="none"/>
          <circle cx="14" cy="6"  r="2.4" stroke="#f2f2f2" stroke-width="1.2" fill="none"/>
          <circle cx="22" cy="14" r="2.4" stroke="#f2f2f2" stroke-width="1.2" fill="none"/>
          <circle cx="14" cy="22" r="2.4" stroke="#f2f2f2" stroke-width="1.2" fill="none"/>
          <path d="M8 13 L21 15" stroke="#00ff88" stroke-width="1.2"/>
        </svg>
        <span style="font-weight:600;font-size:var(--t-18);color:var(--green);letter-spacing:-0.01em">itinera</span>
      </div>

      <!-- Error code -->
      <div
        style="font-family:var(--mono);font-size:var(--t-96);font-weight:600;line-height:1;letter-spacing:-0.04em;color:var(--fg-0);margin-bottom:var(--s-4)"
        :style="error.statusCode === 404 ? 'color:var(--fg-0)' : 'color:var(--red)'"
      >{{ error.statusCode }}</div>

      <!-- Message -->
      <p style="font-family:var(--mono);font-size:var(--t-14);color:var(--fg-3);text-transform:uppercase;letter-spacing:.1em;margin:0 0 var(--s-2)">
        {{ error.statusCode === 404 ? 'page not found' : 'something went wrong' }}
      </p>

      <!-- URL hint -->
      <p
        v-if="error.url || error.message"
        style="font-family:var(--mono);font-size:var(--t-13);color:var(--fg-4);margin:0 0 var(--s-8);max-width:480px;overflow-wrap:break-word"
      >{{ error.url ?? error.message }}</p>
      <div v-else style="margin-bottom:var(--s-8)" />

      <!-- CTA -->
      <button
        class="btn btn-primary"
        style="font-family:var(--mono);font-size:var(--t-13);letter-spacing:.04em"
        @click="handleError"
      >← back to itinera</button>

    </div>
  </div>
</template>
