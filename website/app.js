/**
 * Mirai Studio website — sakura particle canvas, genre marquee,
 * scroll-reveal. Vanilla JS, no dependencies.
 */
;(() => {
  // --------------------------------------------------------- sakura canvas
  const canvas = document.getElementById('sakura')
  const ctx = canvas.getContext('2d')
  let petals = []
  const PETAL_COLORS = ['#f472b6', '#a78bfa', '#22d3ee']

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  window.addEventListener('resize', resize)
  resize()

  function spawnPetal(initial) {
    return {
      x: Math.random() * canvas.width,
      y: initial ? Math.random() * canvas.height : -20,
      size: 5 + Math.random() * 7,
      speedY: 0.4 + Math.random() * 0.9,
      sway: Math.random() * 2 * Math.PI,
      swaySpeed: 0.01 + Math.random() * 0.02,
      swayAmp: 0.6 + Math.random() * 1.4,
      rotation: Math.random() * Math.PI,
      rotSpeed: (Math.random() - 0.5) * 0.02,
      color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
      opacity: 0.25 + Math.random() * 0.45,
    }
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduceMotion) {
    for (let i = 0; i < 42; i++) petals.push(spawnPetal(true))

    function drawPetal(p) {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.globalAlpha = p.opacity
      ctx.fillStyle = p.color
      // petal: two overlapping ellipses = sakura-ish shape
      ctx.beginPath()
      ctx.ellipse(0, 0, p.size * 0.55, p.size, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(p.size * 0.35, p.size * 0.2, p.size * 0.4, p.size * 0.7, 0.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of petals) {
        p.sway += p.swaySpeed
        p.x += Math.sin(p.sway) * p.swayAmp
        p.y += p.speedY
        p.rotation += p.rotSpeed
        if (p.y > canvas.height + 24) Object.assign(p, spawnPetal(false))
        drawPetal(p)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // -------------------------------------------------------- genre marquee
  const GENRES = [
    'Isekai', 'Shounen', 'Shoujo', 'Seinen', 'Josei', 'Kodomo',
    'Action', 'Adventure', 'Comedy', 'Drama', 'Romance', 'Slice of Life',
    'Fantasy', 'Isekai', 'Dark Fantasy', 'Sci-Fi', 'Mecha', 'Cyberpunk',
    'Supernatural', 'Horror', 'Gore', 'Psychological', 'Thriller', 'Mystery', 'Suspense',
    'Ecchi', 'Harem', 'Reverse Harem', 'Shounen Ai', 'Shoujo Ai', 'Yuri',
    'School', 'Magic', 'Martial Arts', 'Super Power', 'Sports', 'Music', 'Idol',
    'Military', 'Historical', 'Samurai', 'Ninja', 'Wuxia', 'Post-Apocalyptic', 'Survival',
    'Zombie', 'Vampire', 'Space', 'Time Travel', 'Isekai', 'Video Game', 'Virtual Reality',
    'Detective', 'Parody', 'Gag Humor', 'Gourmet', 'Medical', 'Tragedy', 'Kids',
  ]
  const track = document.getElementById('genreTrack')
  const HOT = new Set(['Isekai', 'Romance', 'Ecchi', 'Shounen', 'Fantasy', 'Harem', 'Yuri', 'Psychological'])
  const chips = GENRES.map(
    (g) => `<span class="chip${HOT.has(g) ? ' hot' : ''}">${g}</span>`,
  ).join('')
  // duplicate for the seamless infinite loop
  track.innerHTML = chips + chips

  // ---------------------------------------------------------- scroll reveal
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
          observer.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.12 },
  )
  document.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i * 40, 240)}ms`
    observer.observe(el)
  })
})()
