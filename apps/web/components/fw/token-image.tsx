'use client';
import { useState } from 'react';

/** Token logo from its onchain metadata; a broken or slow image falls back to the letter icon. */
export function TokenImage({ src, size, fallback }: { src: string; size: number; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full border border-line bg-surface-2 object-cover"
      style={{ width: size, height: size }}
    />
  );
}
