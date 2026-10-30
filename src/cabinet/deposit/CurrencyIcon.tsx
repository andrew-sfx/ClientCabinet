import type { ReactNode } from 'react'
const graphics: Record<string, ReactNode> = {
  USD: (
    <>
      <rect width="32" height="32" fill="#fff" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} y={i * 4.6} width="32" height="2.3" fill="#B22234" />
      ))}
      <rect width="15" height="17" fill="#3C3B6E" />
      {Array.from({ length: 12 }, (_, i) => (
        <circle
          key={i}
          cx={3 + (i % 3) * 4}
          cy={3 + Math.floor(i / 3) * 4}
          r=".6"
          fill="#fff"
        />
      ))}
    </>
  ),
  EUR: (
    <>
      <rect width="32" height="32" fill="#17469e" />
      {Array.from({ length: 12 }, (_, i) => (
        <circle
          key={i}
          cx={16 + 9 * Math.sin((i * Math.PI) / 6)}
          cy={16 + 9 * Math.cos((i * Math.PI) / 6)}
          r="1.2"
          fill="#ffdf00"
        />
      ))}
    </>
  ),
  GBP: (
    <>
      <rect width="32" height="32" fill="#15356b" />
      <path d="M-2-2 34 34M34-2-2 34" stroke="#fff" strokeWidth="8" />
      <path d="M-2-2 34 34M34-2-2 34" stroke="#c8102e" strokeWidth="3" />
      <path d="M16 0v32M0 16h32" stroke="#fff" strokeWidth="11" />
      <path d="M16 0v32M0 16h32" stroke="#c8102e" strokeWidth="6" />
    </>
  ),
  CHF: (
    <>
      <rect width="32" height="32" fill="#d52b1e" />
      <path d="M16 8v16M8 16h16" stroke="#fff" strokeWidth="5" />
    </>
  ),
  AUD: (
    <>
      <rect width="32" height="32" fill="#15356b" />
      <path d="M0 0 16 15M16 0 0 15" stroke="#fff" strokeWidth="4" />
      <path d="M8 0v16M0 8h16" stroke="#fff" strokeWidth="5" />
      <path d="M8 0v16M0 8h16" stroke="#c8102e" strokeWidth="2" />
      {[
        [9, 23],
        [24, 11],
        [20, 21],
        [27, 25],
        [27, 17],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.5" fill="#fff" />
      ))}
    </>
  ),
  USDT: (
    <>
      <circle cx="16" cy="16" r="16" fill="#26a17b" />
      <path d="M9 8h14v4h-5v14h-4V12H9z" fill="#fff" />
      <ellipse
        cx="16"
        cy="16"
        rx="10"
        ry="2.5"
        fill="none"
        stroke="#fff"
        strokeWidth="1.4"
      />
    </>
  ),
  BTC: (
    <>
      <circle cx="16" cy="16" r="16" fill="#f7931a" />
      <text
        x="16"
        y="23"
        textAnchor="middle"
        fill="#fff"
        fontSize="23"
        fontFamily="Inter,sans-serif"
        fontWeight="700"
      >
        ₿
      </text>
    </>
  ),
  ETH: (
    <>
      <circle cx="16" cy="16" r="16" fill="#627eea" />
      <path d="m16 5-7 12 7 4 7-4zm0 18-7-4 7 9 7-9z" fill="#fff" />
    </>
  ),
  XRP: (
    <>
      <circle cx="16" cy="16" r="16" fill="#23292f" />
      <path
        d="m8 8 5 5a4 4 0 0 0 6 0l5-5M8 24l5-5a4 4 0 0 1 6 0l5 5"
        stroke="#fff"
        strokeWidth="2.5"
        fill="none"
      />
    </>
  ),
}
export function CurrencyIcon({
  code,
  selected = false,
}: {
  code: string
  selected?: boolean
}) {
  return (
    <span
      className={
        'currency-icon' + (!graphics[code] ? ' currency-code-icon' : '')
      }
      aria-hidden="true"
    >
      {graphics[code] ? <svg viewBox="0 0 32 32">{graphics[code]}</svg> : code}
      {selected && (
        <span className="selected-check">
          <svg viewBox="0 0 12 12">
            <path d="m2 6 2.5 2.5L10 3" fill="none" />
          </svg>
        </span>
      )}
    </span>
  )
}
