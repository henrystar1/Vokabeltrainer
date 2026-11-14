import { useCallback, useEffect, useState } from 'react'
import { carList, carUpgrades, raceSuperInfo, type SuperInfo } from '../../../services/cars'
import { SUPERCAR } from '../stats'
import { NO_UP, type Up } from '../tuning'
import type { RaceCarInfo } from './RaceView'

/** Auto, das man im Rennen fahren kann. */
export interface RaceCarOption extends RaceCarInfo { id: string; top: number | null; up: Up }

interface State { cars: RaceCarOption[]; superOk: boolean; /** Fahrassistent erlaubt (nur Admin) */ assistOk: boolean; ready: boolean }
const EMPTY: State = { cars: [], superOk: false, assistOk: false, ready: false }

/** Eigene Autos mit Tuning (und das Supercar, wenn freigegeben) für Rennen. `ready` ist true, sobald die Antwort da ist; `reload` lädt neu (nach Tuning). */
export function useRaceCars(): State & { reload: () => Promise<void> } {
  const [state, setState] = useState<State>(EMPTY)
  const load = useCallback(async () => {
    const [list, ups, info] = await Promise.all([carList().catch(() => []), carUpgrades().catch(() => []), raceSuperInfo().catch((): SuperInfo => ({ ok: false, kmh: 700, assist: false }))])
    const upOf = (id: string): Up => { const u = ups.find((x) => x.car_id === id); return u ? { motor: u.motor, reifen: u.reifen, bremse: u.bremse } : NO_UP }
    const own: RaceCarOption[] = list.filter((c) => c.owned).map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, top: c.top_kmh, up: upOf(c.id) }))
    return { cars: info.ok ? [{ ...SUPERCAR, top: info.kmh, up: NO_UP }, ...own] : own, superOk: info.ok, assistOk: info.assist, ready: true }
  }, [])
  useEffect(() => {
    let on = true
    void load().then((s) => { if (on) setState(s) })
    return () => { on = false }
  }, [load])
  const reload = useCallback(async () => { setState(await load()) }, [load])
  return { ...state, reload }
}
