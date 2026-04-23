interface Props {
  seed: string
}

export function CyberpunkDuck({ seed }: Props) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  const id = `duck-${Math.abs(hash)}`
  const bodyStart = `hsl(${hue}, 95%, 72%)`
  const bodyEnd = `hsl(${(hue + 55) % 360}, 85%, 42%)`

  return (
    <svg viewBox="0 0 40 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={bodyStart} />
          <stop offset="100%" stopColor={bodyEnd} />
        </linearGradient>
        <linearGradient id={`${id}-visor`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#31e5ff" />
          <stop offset="100%" stopColor="#ff3dd5" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="17" r="12" fill={`url(#${id}-body)`} />
      <path d="M 3 17 Q 3 12 9 12 L 17 14 L 17 21 L 9 23 Q 3 22 3 17 Z" fill="#ffb020" />
      <path d="M 9 18 L 17 18" stroke="#b36b00" strokeWidth="0.6" strokeLinecap="round" />
      <rect x="12" y="12" width="22" height="4.5" rx="1.5" fill={`url(#${id}-visor)`} />
      <rect x="13" y="12.5" width="20" height="0.9" fill="#ffffff" opacity="0.65" />
      <rect x="18" y="12" width="1.2" height="4.5" fill="#0a031a" opacity="0.7" />
      <line x1="30" y1="5" x2="30" y2="1" stroke="#31e5ff" strokeWidth="1" strokeLinecap="round" />
      <circle cx="30" cy="1.2" r="1.1" fill="#ff3dd5" />
    </svg>
  )
}
