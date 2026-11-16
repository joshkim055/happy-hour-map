// The four icon: only the stem and crossbar of the 4 are drawn —
// the diagonal is the edge where day (cream) meets night (dark).
export default function Logo({ size = 34, night = false }: { size?: number; night?: boolean }) {
  const id = night ? 'logo-n' : 'logo-d';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="four logo">
      <defs>
        <clipPath id={`${id}-r`}><rect width="100" height="100" rx="22" /></clipPath>
        <clipPath id={`${id}-day`}><polygon points="0,0 77,0 0,93" /></clipPath>
        <clipPath id={`${id}-night`}><polygon points="77,0 100,0 100,100 0,100 0,93" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}-r)`}>
        <rect width="100" height="100" fill={night ? '#2A2433' : '#14121A'} />
        <polygon points="0,0 77,0 0,93" fill={night ? '#FBF7F0' : '#F1E7D6'} />
        <g clipPath={`url(#${id}-day)`} stroke="#2B2520" strokeWidth="10">
          <line x1="62" y1="18" x2="62" y2="86" /><line x1="24" y1="64" x2="80" y2="64" />
        </g>
        <g clipPath={`url(#${id}-night)`} stroke="#F2ECE2" strokeWidth="10">
          <line x1="62" y1="18" x2="62" y2="86" /><line x1="24" y1="64" x2="80" y2="64" />
        </g>
      </g>
    </svg>
  );
}
