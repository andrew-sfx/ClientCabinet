// SVG paths from the accepted K-Cabinet.html canvas.
const paths = {
  coins: <><ellipse cx="8" cy="6" rx="5" ry="2.5"/><path d="M3 6v4c0 1.4 2.2 2.5 5 2.5M3 10v4c0 1.4 2.2 2.5 5 2.5"/><ellipse cx="13" cy="11" rx="4" ry="2"/><path d="M9 11v4c0 1.1 1.8 2 4 2s4-.9 4-2v-4"/></>,
  home: <><path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1Z"/></>,
  accounts: <><path d="m10 3 7 3.5-7 3.5-7-3.5Z"/><path d="m3 10 7 3.5 7-3.5"/><path d="m3 13.5 7 3.5 7-3.5"/></>,
  prop: <><path d="M6 3h8v4a4 4 0 0 1-8 0Z"/><path d="M6 5H3.5v1A2.5 2.5 0 0 0 6 8.5M14 5h2.5v1A2.5 2.5 0 0 1 14 8.5M10 11v3M7 17h6M8 14h4v3H8z"/></>,
  plus: <><path d="M10 4v12M4 10h12"/></>,
  send: <><path d="M4 10h11M11 6l4 4-4 4"/></>,
  out: <><path d="M10 15V4M6 8l4-4 4 4M4 16h12"/></>,
  exch: <><path d="M4 7h11l-3-3M16 13H5l3 3"/></>,
  more: <><circle cx="5" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15" cy="10" r="1"/></>,
  chev: <><path d="m6 8 4 4 4-4"/></>,
  right: <><path d="m8 5 5 5-5 5"/></>,
  info: <><circle cx="10" cy="10" r="7.5"/><path d="M10 9v4.5M10 6.5h.01"/></>,
  warning: <><path d="m10 3 8 14H2Z"/><path d="M10 7v4M10 14h.01"/></>,
  bell: <><path d="M5 13V9a5 5 0 0 1 10 0v4l1.5 2h-13Z"/><path d="M8.5 17.5a1.8 1.8 0 0 0 3 0"/></>,
  in: <><path d="M10 4v11M6 11l4 4 4-4"/></>,
  wallet: <><rect x="3" y="5" width="14" height="11" rx="2.5"/><path d="M3 8.5h14M13 12h1"/></>,
  list: <><path d="M6 6h9M6 10h9M6 14h6M3.5 6h.01M3.5 10h.01M3.5 14h.01"/></>,
  cloud: <><path d="M6 15h8a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 5 8.5 3.3 3.3 0 0 0 6 15Z"/><path d="m3 3 14 14"/></>,
  retry: <><path d="M15.5 8A6 6 0 1 0 16 12"/><path d="M16 4v4h-4"/></>,
  tick: <><path d="m4.5 10.5 3.5 3.5 7.5-8"/></>,
  close: <><path d="M5 5l10 10M15 5 5 15"/></>,
  user: <><circle cx="10" cy="7" r="3.2"/><path d="M4 17a6 6 0 0 1 12 0"/></>,
  shield: <><path d="M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5Z"/><path d="m7.5 10 1.8 1.8L13 8.2"/></>,
  globe: <><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5Z"/></>,
  logout: <><path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 6l4 4-4 4M16 10H8"/></>,
  chart: <><path d="M3 15l4-5 3 3 6-7"/><path d="M12 6h4v4"/></>,
}
export type IconName = keyof typeof paths
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
