import type { RiskGrade } from '@fairway/scoring';

/** Marshal's mood follows the grade: alert (wing up) on High risk, happy (eye closed) on Low, watching otherwise. */
export type HawkMood = 'watch' | 'alert' | 'happy';
export const moodFor = (grade?: RiskGrade | null): HawkMood => (grade === 'High' ? 'alert' : grade === 'Low' ? 'happy' : 'watch');

/** Marshal the hawk, Fairway's mascot: flat polygons in the hawk tokens, so it follows the theme. */
export function Marshal({ mood = 'watch', size = 150, className = '' }: { mood?: HawkMood; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label="Marshal the hawk" className={`block overflow-visible ${className}`}>
      <g strokeLinejoin="miter">
        <polygon points="88,118 112,150 96,152 80,124" fill="var(--hawk-dark)" />
        {mood === 'alert' && <polygon points="86,80 132,34 124,50 136,50 122,62 130,66 98,90" fill="var(--hawk-dark)" />}
        <polyline points="68,126 68,142 58,142" fill="none" stroke="var(--hawk-beak)" strokeWidth="3" />
        <polyline points="81,128 81,142 71,142" fill="none" stroke="var(--hawk-beak)" strokeWidth="3" />
        <polygon points="60,58 82,54 104,80 104,112 88,132 66,130 50,108 50,78" fill="var(--hawk-body)" />
        <polygon points="58,68 68,66 72,92 68,126 56,112 52,84" fill="var(--hawk-belly)" />
        <polygon points="78,70 98,80 102,110 100,130 86,118 78,96" fill="var(--hawk-dark)" />
        <g transform="rotate(-6 66 62)">
          <polygon points="44,36 62,26 84,30 92,46 86,62 66,66 48,58" fill="var(--hawk-body)" />
          <polygon points="50,30 62,26 84,30 92,46 76,36" fill="var(--hawk-dark)" />
          <polygon points="48,58 66,66 72,58 60,52" fill="var(--hawk-belly)" />
          <polygon points="46,40 30,46 30,58 36,52 48,54" fill="var(--hawk-beak)" />
          <polygon points="30,52 30,58 36,52" fill="#201e1d" opacity="0.35" />
          {mood === 'happy' ? (
            <polyline points="54,46 60,41 66,46" fill="none" stroke="#201e1d" strokeWidth="3" />
          ) : (
            <g>
              <polygon points="54,40 64,38 66,47 56,49" fill="var(--hawk-beak)" />
              <rect x="57" y="41" width="5" height="5" fill="#201e1d" />
              <polyline points="50,37 66,33" fill="none" stroke="var(--hawk-dark)" strokeWidth="3" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

/** The header mark: Marshal's head in a ruled square. */
export function HawkMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" fill="none" stroke="var(--ink)" />
      <polygon points="12,9 22,7 28,13 27,22 18,24 12,20" fill="var(--hawk-body)" />
      <polygon points="12,9 22,7 28,13 20,11" fill="var(--hawk-dark)" />
      <polygon points="12,12 4,15 5,21 8,18 12,18" fill="var(--hawk-beak)" />
      <rect x="15" y="13" width="3" height="3" fill="var(--hawk-beak)" />
    </svg>
  );
}

/** Marshal on a sky plate with a caption, as on the Check page. */
export function MarshalPlate({ mood, tag, children }: { mood: HawkMood; tag: string; children: React.ReactNode }) {
  return (
    <figure className="m-0 flex flex-col justify-end">
      <div className="relative grid place-items-center border border-line bg-sky px-0 pb-3.5 pt-[22px]">
        <span className="absolute left-2.5 top-2 font-mono text-[10px] tracking-[0.1em] text-ink-2">PL. 01</span>
        <span className="absolute right-2.5 top-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2">{tag}</span>
        <Marshal mood={mood} />
      </div>
      <figcaption className="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-3">
        <span className="whitespace-nowrap font-serif text-[15px] italic">Marshal</span>
        <span className="text-pretty text-sm text-ink-2">{children}</span>
      </figcaption>
    </figure>
  );
}
