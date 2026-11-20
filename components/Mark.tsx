// Stringboard's mark: three pins and the red string between them.
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 5 Q9 10 15.5 4.5 M4 5 Q6 12 10 16 M15.5 4.5 Q15 11 10 16" stroke="#ff4d00" strokeWidth="1.4" />
      <circle cx="4" cy="5" r="2.2" fill="#f2f2f0" />
      <rect x="13.6" y="2.6" width="3.8" height="3.8" fill="#f2f2f0" />
      <circle cx="10" cy="16" r="2.2" fill="#f2f2f0" />
    </svg>
  );
}
