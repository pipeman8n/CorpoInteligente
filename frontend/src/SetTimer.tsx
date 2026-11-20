import { useState } from 'react'
import { useStopwatch } from 'react-timer-hook'

// Cronômetro por série com acompanhamento de sets (bolinhas) e botão de finalizar.
export default function SetTimer({ sets }: { sets: number }) {
  const total = Math.max(1, sets || 1)
  const { seconds, minutes, isRunning, start, pause, reset } = useStopwatch({ autoStart: false })
  const [currentSet, setCurrentSet] = useState(1) // 1-based
  const [completed, setCompleted] = useState(false)

  const finishSet = () => {
    pause()
    reset()
    if (currentSet >= total) {
      setCompleted(true)
    } else {
      setCurrentSet((s) => s + 1)
    }
  }

  const restartAll = () => {
    reset()
    setCurrentSet(1)
    setCompleted(false)
  }

  if (completed) {
    return (
      <span className="set-timer set-timer-done">
        <span className="set-done-mark" aria-hidden="true">✓</span>
        <span className="set-done-label">Série concluída</span>
        <button type="button" className="set-timer-btn" title="Reiniciar" onClick={restartAll}>↺</button>
      </span>
    )
  }

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')

  return (
    <span className="set-timer">
      <span className="set-dots" title={`Série ${currentSet} de ${total}`}>
        {Array.from({ length: total }, (_, i) => {
          const n = i + 1
          const cls = n < currentSet ? 'set-dot done' : n === currentSet ? 'set-dot active' : 'set-dot'
          return <span key={n} className={cls} />
        })}
      </span>
      <span className="set-timer-time">{mm}:{ss}</span>
      <button type="button" className="set-timer-btn" title={isRunning ? 'Pausar' : 'Iniciar'} onClick={() => (isRunning ? pause() : start())}>
        {isRunning ? '⏸' : '▶'}
      </button>
      <button type="button" className="set-timer-btn set-timer-finish" title="Finalizar série" onClick={finishSet}>
        ✓
      </button>
    </span>
  )
}
