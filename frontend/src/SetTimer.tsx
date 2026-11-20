import { useStopwatch } from 'react-timer-hook'

// Cronômetro por série (play/pause/reset) exibido ao lado de cada exercício.
export default function SetTimer() {
  const { seconds, minutes, isRunning, start, pause, reset } = useStopwatch({ autoStart: false })
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return (
    <span className="set-timer">
      <span className="set-timer-time">{mm}:{ss}</span>
      <button
        type="button"
        className="set-timer-btn"
        title={isRunning ? 'Pausar' : 'Iniciar'}
        onClick={() => (isRunning ? pause() : start())}
      >
        {isRunning ? '⏸' : '▶'}
      </button>
      <button type="button" className="set-timer-btn" title="Zerar" onClick={() => reset()}>
        ↺
      </button>
    </span>
  )
}
