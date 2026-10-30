export function BackIcon() {
  return <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 10H5M9 6l-4 4 4 4" /></svg>
}

export function ErrorIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M10 6v5M10 14h.01" /></svg>
}

export function MethodIcon({ method }: { method: string }) {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{method === 'Email'
    ? <><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M3 5.5l7 5 7-5" /></>
    : <><rect x="5.5" y="2.5" width="9" height="15" rx="2" />{method === 'Sms' ? <path d="M8 6h4M8 9h4M9 14.5h2" /> : <path d="M9 14.5h2" />}</>}</svg>
}
