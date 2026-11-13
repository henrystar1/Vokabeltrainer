import { useEffect, useState } from 'react'
import { carList } from '../../../services/cars'
import { raceSuperOk } from '../../../services/cars'
import { SUPERCAR } from '../stats'
import type { RaceCarInfo } from './RaceView'

/** Auto, das man im Rennen fahren kann. */
export interface RaceCarOption extends RaceCarInfo { id: string; top: number | null }

/** Eigene Autos (und das Supercar, wenn freigegeben) für Rennen. Lädt einmal; `ready` ist true, sobald die Antwort da ist. */
export function useRaceCars(): { cars: RaceCarOption[]; superOk: boolean; ready: boolean } {
  const [state, setState] = useState<{ cars: RaceCarOption[]; superOk: boolean; ready: boolean }>({ cars: [], superOk: false, ready: false })
  useEffect(() => {
    let on = true
    void Promise.all([carList().catch(() => []), raceSuperOk().catch(() => false)]).then(([list, ok]) => {
      if (!on) return
      const own: RaceCarOption[] = list.filter((c) => c.owned).map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, top: c.top_kmh }))
      setState({ cars: ok ? [{ ...SUPERCAR }, ...own] : own, superOk: ok, ready: true })
    })
    return () => { on = false }
  }, [])
  return state
}
