/**
 * PetalCanvas (v0.27) — drifting sakura petals behind the Hub hero:
 * the brand's signature, drawn on a low-cost 2D canvas. Respects
 * prefers-reduced-motion (renders a single static frame) and pauses
 * when the tab is hidden.
 */
import { useEffect, useRef } from 'react'

interface Petal {
  x: number
  y: number
  size: number
  speed: number
  sway: number
  phase: number
  hue: number
  alpha: number
}

export function PetalCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(rect.width * dpr, 1)
      canvas.height = Math.max(rect.height * dpr, 1)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const w = () => canvas.width / dpr
    const h = () => canvas.height / dpr

    const spawn = (anywhere: boolean): Petal => ({
      x: Math.random() * w(),
      y: anywhere ? Math.random() * h() : -12,
      size: 5 + Math.random() * 7,
      speed: 14 + Math.random() * 22, // px/s
      sway: 18 + Math.random() * 26,
      phase: Math.random() * Math.PI * 2,
      hue: 330 + Math.random() * 16, // sakura pinks
      alpha: 0.35 + Math.random() * 0.4,
    })

    const petals: Petal[] = Array.from({ length: 16 }, () => spawn(true))

    const drawPetal = (p: Petal, t: number) => {
      const swayX = Math.sin(t * 0.8 + p.phase) * p.sway
      ctx.save()
      ctx.translate(p.x + swayX, p.y)
      ctx.rotate(Math.sin(t * 0.9 + p.phase) * 0.6)
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = `hsl(${p.hue} 85% 74%)`
      // petal: two arcs — a soft leaf shape
      ctx.beginPath()
      ctx.moveTo(0, -p.size)
      ctx.bezierCurveTo(p.size * 0.9, -p.size * 0.4, p.size * 0.7, p.size * 0.6, 0, p.size)
      ctx.bezierCurveTo(-p.size * 0.7, p.size * 0.6, -p.size * 0.9, -p.size * 0.4, 0, -p.size)
      ctx.fill()
      ctx.restore()
    }

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      ctx.clearRect(0, 0, w(), h())
      for (const p of petals) {
        p.y += p.speed * dt
        if (p.y > h() + 14) {
          Object.assign(p, spawn(false))
        }
        drawPetal(p, now / 1000)
      }
      raf = requestAnimationFrame(frame)
    }

    if (reduced) {
      // one static scatter — no animation
      ctx.clearRect(0, 0, w(), h())
      petals.forEach((p, i) => {
        p.y = ((i + 1) / (petals.length + 1)) * h()
        drawPetal(p, 0)
      })
    } else {
      raf = requestAnimationFrame(frame)
      const onVisibility = () => {
        cancelAnimationFrame(raf)
        if (!document.hidden) {
          last = performance.now()
          raf = requestAnimationFrame(frame)
        }
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => {
        cancelAnimationFrame(raf)
        observer.disconnect()
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
