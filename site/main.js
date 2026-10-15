// InputSplit website: animated background, scroll effects, screenshot viewer and the FPS demo.
// No trackers, no network requests.
;(() => {
  document.documentElement.classList.add('js')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---------- Background: drifting "signal" particles linked by lines ----------
  const canvas = document.querySelector('.bg canvas')
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext('2d')
    const pointer = { x: -9999, y: -9999 }
    let width = 0
    let height = 0
    let dpr = 1
    let dots = []

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round(Math.min(110, (width * height) / 16000))
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 1.6 + 0.6,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    // Violet on the "player" side, cyan on the "desk" side.
    const colour = (x, alpha) => {
      const t = Math.max(0, Math.min(1, x / width))
      const r = Math.round(139 + (45 - 139) * t)
      const g = Math.round(108 + (212 - 108) * t)
      const b = Math.round(255 + (239 - 255) * t)
      return `rgba(${r},${g},${b},${alpha})`
    }

    const LINK = 140
    let time = 0
    const frame = () => {
      time += 1
      ctx.clearRect(0, 0, width, height)
      for (const d of dots) {
        const dx = d.x - pointer.x
        const dy = d.y - pointer.y
        const dist = Math.hypot(dx, dy)
        if (dist < 180 && dist > 0.1) {
          d.vx += (dx / dist) * 0.02
          d.vy += (dy / dist) * 0.02
        }
        d.vx *= 0.995
        d.vy *= 0.995
        const speed = Math.hypot(d.vx, d.vy)
        if (speed < 0.08) {
          d.vx += (Math.random() - 0.5) * 0.04
          d.vy += (Math.random() - 0.5) * 0.04
        }
        d.x += d.vx
        d.y += d.vy
        if (d.x < -20) d.x = width + 20
        if (d.x > width + 20) d.x = -20
        if (d.y < -20) d.y = height + 20
        if (d.y > height + 20) d.y = -20
      }
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i]
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j]
          const dist = Math.hypot(a.x - b.x, a.y - b.y)
          if (dist < LINK) {
            ctx.strokeStyle = colour((a.x + b.x) / 2, (1 - dist / LINK) * 0.22)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }
      for (const d of dots) {
        const glow = 0.55 + 0.45 * Math.sin(time * 0.03 + d.phase)
        ctx.fillStyle = colour(d.x, 0.35 + 0.5 * glow)
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r * (0.8 + glow * 0.5), 0, Math.PI * 2)
        ctx.fill()
      }
      if (!reduceMotion && !document.hidden) requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
    })
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !reduceMotion) requestAnimationFrame(frame)
    })
    requestAnimationFrame(frame)
  }

  // ---------- Header background once scrolled, hero screenshot straightens ----------
  const header = document.querySelector('header.top')
  const heroFrame = document.querySelector('.stage .frame')
  const onScroll = () => {
    header?.classList.toggle('scrolled', window.scrollY > 10)
    if (heroFrame && !reduceMotion) {
      const p = Math.min(1, window.scrollY / 420)
      heroFrame.style.transform = `rotateX(${18 * (1 - p)}deg) scale(${0.94 + 0.06 * p})`
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  // ---------- Reveal on scroll ----------
  const revealed = document.querySelectorAll('.reveal')
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in')
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    revealed.forEach((el) => io.observe(el))
  } else {
    revealed.forEach((el) => el.classList.add('in'))
  }

  // ---------- Glow that follows the pointer on tiles ----------
  document.querySelectorAll('.tile').forEach((tile) => {
    tile.addEventListener('pointermove', (e) => {
      const rect = tile.getBoundingClientRect()
      tile.style.setProperty('--mx', `${e.clientX - rect.left}px`)
      tile.style.setProperty('--my', `${e.clientY - rect.top}px`)
    })
  })

  // ---------- Screenshot viewer ----------
  const box = document.querySelector('.lightbox')
  if (box) {
    const img = box.querySelector('img')
    const caption = box.querySelector('p')
    const close = () => box.classList.remove('open')
    document.querySelectorAll('[data-full]').forEach((el) => {
      el.addEventListener('click', () => {
        img.src = el.dataset.full
        img.alt = el.dataset.caption || ''
        caption.textContent = el.dataset.caption || ''
        box.classList.add('open')
        box.querySelector('button').focus()
      })
    })
    box.addEventListener('click', (e) => {
      if (e.target !== img) close()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close()
    })
  }

  // ---------- FPS demo: numbers that move like the real overlay ----------
  const osd = document.querySelector('.osd')
  if (osd) {
    const ms = osd.dataset.ms
    const worst = osd.dataset.worst
    const fpsEl = osd.querySelector('[data-v="fps"]')
    const frameEl = osd.querySelector('[data-v="frame"]')
    const latEl = osd.querySelector('[data-v="latency"]')
    const fmt = (v) => v.toFixed(1).replace('.', osd.dataset.dec || '.')
    const tick = () => {
      const fps = 59 + Math.round(Math.random() * 1.2)
      const frameMs = 1000 / fps + (Math.random() - 0.5) * 0.3
      const worstFrame = frameMs + 1 + Math.random() * 2.5
      const latency = 8.5 + Math.random() * 3
      const worstLatency = latency + 2 + Math.random() * 3
      fpsEl.textContent = String(fps)
      frameEl.textContent = `${ms.replace('{v}', fmt(frameMs))} · ${worst.replace('{v}', fmt(worstFrame))}`
      latEl.textContent = `${ms.replace('{v}', fmt(latency))} · ${worst.replace('{v}', fmt(worstLatency))}`
    }
    tick()
    if (!reduceMotion) setInterval(tick, 1000)
  }
})()
