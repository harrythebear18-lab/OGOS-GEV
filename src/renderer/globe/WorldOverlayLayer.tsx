/**
 * WorldOverlayLayer — renders HTML cards on top of the Cesium globe.
 *
 * Cards are positioned using screen coordinates computed by WorldOverlay
 * via Cesium.SceneTransforms. This component just renders the HTML.
 *
 * Cards are rich content: title, subtitle, colored border, clickable.
 * Labels are handled by Cesium entities directly (in WorldOverlay.ts).
 */

import { useState, useEffect, useCallback } from 'react'
import type { WorldOverlay, VisibleCard } from './WorldOverlay'

interface WorldOverlayLayerProps {
  overlay: WorldOverlay | null
  onCardClick?: (card: VisibleCard) => void
}

export default function WorldOverlayLayer({ overlay, onCardClick }: WorldOverlayLayerProps) {
  const [cards, setCards] = useState<VisibleCard[]>([])

  useEffect(() => {
    if (!overlay) return
    overlay.setCardCallback(setCards)
    return () => {
      overlay.setCardCallback(null)
    }
  }, [overlay])

  const handleClick = useCallback((card: VisibleCard) => {
    onCardClick?.(card)
  }, [onCardClick])

  if (!overlay || cards.length === 0) return null

  return (
    <div style={containerStyle}>
      {cards.map((card) => (
        <div
          key={card.id}
          onClick={() => handleClick(card)}
          style={{
            ...cardStyle,
            left: card.screenX,
            top: card.screenY,
            borderColor: card.color || '#4affd4',
          }}
        >
          <div style={cardTitleStyle}>{card.title}</div>
          {card.subtitle && <div style={cardSubtitleStyle}>{card.subtitle}</div>}
        </div>
      ))}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'none',
  zIndex: 15,
  overflow: 'hidden',
}

const cardStyle: React.CSSProperties = {
  position: 'absolute',
  transform: 'translate(-50%, -100%)',
  background: 'rgba(11, 15, 20, 0.92)',
  border: '1px solid',
  borderRadius: 3,
  padding: '4px 8px',
  fontFamily: 'monospace',
  fontSize: 10,
  color: '#c0c8d0',
  pointerEvents: 'auto',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  maxWidth: 200,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
  transition: 'background 0.15s',
}

const cardTitleStyle: React.CSSProperties = {
  fontWeight: 'bold',
  fontSize: 10,
  letterSpacing: 0.5,
}

const cardSubtitleStyle: React.CSSProperties = {
  fontSize: 9,
  color: 'rgba(192, 200, 208, 0.6)',
  marginTop: 2,
}
