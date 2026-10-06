import { useMemo, useState, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import Button from '../ui/Button'
import { Field, Select, TextArea, TextInput } from '../ui/Field'
import Modal from '../ui/Modal'
import { ErrorBox, Notice } from '../ui/States'
import { KIND_LABEL } from '../../features/shop/catalog'
import {
  DECORS,
  EFFECT_PRESETS,
  TAG_ANIMS,
  customEffect,
  customNameColor,
  customTag,
  customTheme,
  safeHex,
  svgDataUrl,
} from '../../features/shop/custom'
import { errorMessage } from '../../lib/errors'
import { adminDeleteItem, adminSaveItem } from '../../services/koins'
import type { CustomItem, ShopItem, ShopKind } from '../../types'

const KINDS: ShopKind[] = ['avatar', 'color', 'effect', 'tag', 'theme']

/** Gleiche Regeln wie auf dem Server – so sieht man den Fehler schon beim Einfügen. */
export function svgProblem(svg: string): string | null {
  const t = svg.trim()
  if (t.length < 20) return 'Bitte den SVG-Code einfügen.'
  if (t.length > 30000) return 'Zu groß (höchstens 30 000 Zeichen).'
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(t)) return 'Der Code muss mit <svg beginnen.'
  const c = t.replace(/xmlns(:[a-z]+)?\s*=\s*("[^"]*"|'[^']*')/gi, '')
  if (/<\s*(script|iframe|object|embed|foreignobject|image|use|a)[\s>/]/i.test(c)) return 'Nicht erlaubt: script, image, use, a, foreignObject, iframe, object, embed.'
  if (/\bon[a-z]+\s*=/i.test(c)) return 'Nicht erlaubt: Ereignisse wie onclick oder onload.'
  if (/javascript:|data:|@import|https?:|<!entity|<!doctype/i.test(c) || /\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(c)) return 'Nicht erlaubt: Internetadressen oder fremde Dateien.'
  if (/href\s*=/i.test(c)) return 'Nicht erlaubt: href (keine Links oder Verweise).'
  return null
}

export const AI_PROMPT = `Erstelle eine animierte SVG-Grafik als Profilbild für eine Lern-Website.

Motiv: [HIER BESCHREIBEN, z. B. "ein kleiner Drache, der Feuer spuckt"]

Strenge Regeln:
- Gib NUR den SVG-Code zurück, in einem einzigen Codeblock, ohne Erklärung.
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"> – quadratisch, gut erkennbar auch bei 32 px Größe.
- Die Grafik füllt einen Kreis gut aus (Hintergrund als Kreis oder Fläche mitzeichnen, wichtige Teile nicht am Rand).
- Die Animation läuft von selbst in Endlosschleife (SMIL mit <animate>, <animateTransform> oder CSS @keyframes in einem <style>-Element im SVG). Dauer 1 bis 4 Sekunden, dezent.
- Verboten: <script>, Ereignis-Attribute (onclick, onload …), <image>, <use>, <a>, <foreignObject>, href, Internetadressen, Schriftarten von außen, base64-Daten.
- Nur einfache Formen (circle, rect, ellipse, path, polygon, line, g) und Verläufe (linearGradient/radialGradient mit id und fill="url(#id)").
- Höchstens 20 000 Zeichen.`

function Preview({ item }: { item: CustomItem }) {
  if (item.kind === 'avatar') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {[96, 40, 28].map((s) => (
          <div key={s} className="rounded-xl bg-space-800 p-2">
            {item.svg && !svgProblem(item.svg) ? <img src={svgDataUrl(item.svg)} alt="" width={s} height={s} className="rounded-full bg-space-600" /> : <div style={{ width: s, height: s }} className="rounded-full bg-white/5" />}
          </div>
        ))}
      </div>
    )
  }
  if (item.kind === 'color') {
    const c = customNameColor(item)
    return <span className={`text-xl font-semibold ${c.className}`} style={c.style}>Dein Name</span>
  }
  if (item.kind === 'effect') {
    const e = customEffect(item)
    return <span className={`text-xl font-semibold ${e.className}`} style={e.style}>Dein Name</span>
  }
  if (item.kind === 'tag') {
    const t = customTag(item)
    return <span className={`tag ${t.className} !text-xs`} style={t.style}>{t.label}</span>
  }
  const th = customTheme(item)
  return (
    <div className="space-y-2">
      <div className="h-14 w-full rounded-xl border border-white/10" style={{ background: th.preview }} />
      <p className="text-xs text-slate-500">{th.fx === 'shine' ? 'Alle Knöpfe bekommen einen Glanz-Effekt.' : th.fx === 'rainbow' ? 'Alle Knöpfe laufen im Regenbogen.' : 'Ohne Knopf-Effekt.'}</p>
    </div>
  )
}

const Color = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="block space-y-1.5">
    <span className="label-mono">{label}</span>
    <input type="color" value={safeHex(value, '#000000')} onChange={(e) => onChange(e.target.value)} className="h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-space-900/70" />
  </label>
)

/** Admin: eigenen Shop-Artikel anlegen oder ändern. */
export default function ItemEditor({ item, onClose, onSaved }: { item: ShopItem | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const st = (item?.style ?? {}) as Record<string, unknown>
  const [kind, setKind] = useState<ShopKind>(item?.kind ?? 'avatar')
  const [name, setName] = useState(item?.name ?? '')
  const [price, setPrice] = useState(String(item?.price ?? 500))
  const [role, setRole] = useState<'' | 'mod' | 'admin'>(item?.required_role ?? '')
  const [active, setActive] = useState(item?.active ?? true)
  const [svg, setSvg] = useState(item?.svg ?? '')
  const [colors, setColors] = useState<string[]>(Array.isArray(st.colors) ? (st.colors as string[]) : ['#22d3ee'])
  const [animate, setAnimate] = useState(st.animate === true)
  const [preset, setPreset] = useState(typeof st.preset === 'string' ? st.preset : 'glow')
  const [fxColor, setFxColor] = useState(typeof st.color === 'string' ? st.color : '#22d3ee')
  const [speed, setSpeed] = useState(String(st.speed ?? 2))
  const [label, setLabel] = useState(typeof st.label === 'string' ? st.label : '')
  const [bg1, setBg1] = useState(typeof st.bg1 === 'string' ? st.bg1 : '#7c3aed')
  const [bg2, setBg2] = useState(typeof st.bg2 === 'string' ? st.bg2 : '#db2777')
  const [fg, setFg] = useState(typeof st.fg === 'string' ? st.fg : '#ffffff')
  const [anim, setAnim] = useState(typeof st.anim === 'string' ? st.anim : 'none')
  const [bg, setBg] = useState(typeof st.bg === 'string' ? st.bg : '#10162e')
  const [a1, setA1] = useState(typeof st.a1 === 'string' ? st.a1 : '#22d3ee')
  const [a2, setA2] = useState(typeof st.a2 === 'string' ? st.a2 : '#8b5cf6')
  const [a3, setA3] = useState(typeof st.a3 === 'string' ? st.a3 : '#3b82f6')
  const [decor, setDecor] = useState(typeof st.decor === 'string' ? st.decor : 'stars')
  const [fx, setFx] = useState(typeof st.fx === 'string' ? st.fx : 'none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const style = useMemo<Record<string, unknown> | null>(() => {
    if (kind === 'avatar') return null
    if (kind === 'color') return { colors, animate }
    if (kind === 'effect') return { preset, color: fxColor, speed: Number(speed) || 2 }
    if (kind === 'tag') return { label, bg1, bg2, fg, anim }
    return { bg, a1, a2, a3, decor, fx: fx === 'none' ? null : fx }
  }, [kind, colors, animate, preset, fxColor, speed, label, bg1, bg2, fg, anim, bg, a1, a2, a3, decor, fx])

  const preview: CustomItem = { id: 'preview', kind, name: name || 'Vorschau', style, svg: kind === 'avatar' ? svg : null }
  const problem = kind === 'avatar' && svg.trim() ? svgProblem(svg) : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'avatar' && svgProblem(svg)) throw new Error(svgProblem(svg) ?? 'SVG ungültig.')
      const p = Number.parseInt(price, 10)
      if (!Number.isInteger(p) || p < 0) throw new Error('Bitte einen Preis ab 0 eingeben.')
      await adminSaveItem({ id: item?.id ?? null, kind, name: name.trim(), price: p, requiredRole: role || null, style, svg: kind === 'avatar' ? svg.trim() : null, active })
      onSaved(item ? 'Artikel gespeichert.' : 'Artikel angelegt – er steht jetzt im Shop.')
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  async function remove() {
    if (!item || !window.confirm(`„${item.name}“ endgültig löschen? Wer ihn besitzt, verliert ihn.`)) return
    setBusy(true)
    try {
      await adminDeleteItem(item.id)
      onSaved('Artikel gelöscht.')
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const row = (children: ReactNode) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>

  return (
    <Modal title={item ? 'Artikel bearbeiten' : 'Neuer Artikel'} onClose={onClose}>
      <div className="space-y-4">
        {!item && (
          <Field label="Art">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ShopKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
        )}
        {row(
          <>
            <Field label="Name">
              <TextInput value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Preis (Coins)">
              <TextInput type="number" min={0} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          </>,
        )}

        {kind === 'avatar' && (
          <div className="space-y-3">
            <Notice tone="info">
              Kopiere den Prompt, gib ihn einer KI deiner Wahl (und ersetze das Motiv) und füge den SVG-Code hier ein.
            </Notice>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(AI_PROMPT).then(() => setCopied(true))
              }}
            >
              <Copy size={15} /> {copied ? 'Prompt kopiert ✓' : 'Prompt für die KI kopieren'}
            </Button>
            <Field label="SVG-Code" hint="Skripte, Links und fremde Bilder werden abgelehnt.">
              <TextArea value={svg} onChange={(e) => setSvg(e.target.value)} rows={6} className="font-mono text-xs" placeholder="<svg xmlns=… viewBox=&quot;0 0 100 100&quot;>…</svg>" />
            </Field>
            {problem && <p className="text-sm text-rose-300">{problem}</p>}
          </div>
        )}

        {kind === 'color' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {colors.map((c, i) => (
                <Color key={i} label={`Farbe ${i + 1}`} value={c} onChange={(v) => setColors(colors.map((x, k) => (k === i ? v : x)))} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {colors.length < 4 && <Button variant="secondary" onClick={() => setColors([...colors, '#f472b6'])}>Farbe hinzufügen</Button>}
              {colors.length > 1 && <Button variant="ghost" onClick={() => setColors(colors.slice(0, -1))}>Letzte entfernen</Button>}
            </div>
            {colors.length > 1 && (
              <label className="flex min-h-[44px] items-center gap-3 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={animate} onChange={(e) => setAnimate(e.target.checked)} /> Verlauf läuft durch
              </label>
            )}
          </div>
        )}

        {kind === 'effect' && row(
          <>
            <Field label="Vorlage">
              <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {EFFECT_PRESETS.map((p) => <option key={p} value={p}>{{ glow: 'Leuchten', pulse: 'Pulsieren', rainbow: 'Regenbogen', shimmer: 'Flimmern', neon: 'Neon', float: 'Schweben' }[p]}</option>)}
              </Select>
            </Field>
            <Color label="Farbe" value={fxColor} onChange={setFxColor} />
            <Field label="Tempo (Sekunden je Durchlauf)">
              <TextInput type="number" min={0.5} max={10} step={0.5} inputMode="decimal" value={speed} onChange={(e) => setSpeed(e.target.value)} />
            </Field>
          </>,
        )}

        {kind === 'tag' && (
          <div className="space-y-3">
            {row(
              <>
                <Field label="Text (höchstens 10 Zeichen)">
                  <TextInput value={label} maxLength={10} onChange={(e) => setLabel(e.target.value)} />
                </Field>
                <Field label="Bewegung">
                  <Select value={anim} onChange={(e) => setAnim(e.target.value)}>
                    {TAG_ANIMS.map((a) => <option key={a} value={a}>{{ none: 'Keine', shine: 'Glanz läuft', rainbow: 'Farbe läuft' }[a]}</option>)}
                  </Select>
                </Field>
              </>,
            )}
            <div className="grid grid-cols-3 gap-3">
              <Color label="Hintergrund 1" value={bg1} onChange={setBg1} />
              <Color label="Hintergrund 2" value={bg2} onChange={setBg2} />
              <Color label="Schrift" value={fg} onChange={setFg} />
            </div>
          </div>
        )}

        {kind === 'theme' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Color label="Hintergrund" value={bg} onChange={setBg} />
              <Color label="Akzent 1" value={a1} onChange={setA1} />
              <Color label="Akzent 2" value={a2} onChange={setA2} />
              <Color label="Akzent 3" value={a3} onChange={setA3} />
            </div>
            {row(
              <>
                <Field label="Dekoration">
                  <Select value={decor} onChange={(e) => setDecor(e.target.value)}>
                    {DECORS.map((d) => <option key={d} value={d}>{{ stars: 'Sterne', bubbles: 'Blasen', petals: 'Blütenblätter', confetti: 'Konfetti', fireflies: 'Glühwürmchen', code: 'Code-Regen', sparkles: 'Funken' }[d]}</option>)}
                  </Select>
                </Field>
                <Field label="Knopf-Effekt">
                  <Select value={fx} onChange={(e) => setFx(e.target.value)}>
                    <option value="none">Keiner</option>
                    <option value="shine">Glanz</option>
                    <option value="rainbow">Regenbogen läuft durch</option>
                  </Select>
                </Field>
              </>,
            )}
          </div>
        )}

        {row(
          <>
            <Field label="Wer darf ihn sehen?">
              <Select value={role} onChange={(e) => setRole(e.target.value as '' | 'mod' | 'admin')}>
                <option value="">Alle</option>
                <option value="mod">Nur Mods und Admins</option>
                <option value="admin">Nur Admins</option>
              </Select>
            </Field>
            <label className="flex min-h-[44px] items-center gap-3 self-end text-sm">
              <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={active} onChange={(e) => setActive(e.target.checked)} /> Im Shop sichtbar
            </label>
          </>,
        )}

        <div>
          <p className="label-mono mb-2">Vorschau</p>
          <Preview item={preview} />
        </div>

        {error && <ErrorBox message={error} />}
        <div className="flex flex-wrap justify-between gap-2">
          {item ? <Button variant="danger" disabled={busy} onClick={() => void remove()}>Löschen</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
            <Button busy={busy} disabled={!name.trim() || (kind === 'avatar' && (!svg.trim() || !!problem))} onClick={() => void save()}>Speichern</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
