'use client';

import { useCallback, useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

interface FullscreenToggleProps {
  color?: string;
  hoverBackground?: string;
  size?: number;
}

// Pulsante discreto per attivare/disattivare lo Schermo Intero via Fullscreen
// API nativa. Renderizza null se il browser non la supporta (es. Safari iOS
// su elementi non-video) invece di mostrare un controllo inerte.
export default function FullscreenToggle({
  color = 'currentColor',
  hoverBackground = 'rgba(127,127,127,0.15)',
  size = 18,
}: FullscreenToggleProps) {
  const [supported, setSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setSupported(!!document.documentElement.requestFullscreen);

    const handleChange = () => setIsFullscreen(!!document.fullscreenElement);
    handleChange();
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggleFullscreen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={isFullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
      aria-label={isFullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '34px', height: '34px', borderRadius: '8px', border: 'none',
        background: hovered ? hoverBackground : 'transparent',
        color, cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      {isFullscreen ? <Minimize size={size} /> : <Maximize size={size} />}
    </button>
  );
}
