export function CoRocLogo({ className, title = "Co-Roc - configuration control" }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 160" role="img" aria-label={title}>
      <g fill="none" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M104 43A43 43 0 1 0 104 117" stroke="currentColor" strokeWidth="12" />
        <path d="M86 80h50" stroke="var(--accent)" strokeWidth="8" />
        <path d="M118 70l18 10-18 10z" fill="var(--accent)" stroke="none" />
        <circle cx="61" cy="80" r="5" fill="var(--accent)" stroke="none" />
      </g>
      <text x="164" y="94" fill="currentColor" fontFamily="inherit" fontSize="64" fontWeight="700" letterSpacing="-2">Co-Roc</text>
      <path d="M166 112h371" stroke="var(--line-strong)" />
      <text x="166" y="133" fill="var(--muted)" fontFamily="inherit" fontSize="12" fontWeight="700" letterSpacing="2.4">CONFIGURATION CONTROL</text>
    </svg>
  );
}
