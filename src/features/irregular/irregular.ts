/**
 * Unregelmäßige Verben zum Üben (Englisch und Französisch).
 * Englisch: Infinitiv – Simple Past – Past Participle. Mehrere Schreibweisen stehen mit „/“.
 * Französisch: die unregelmäßigen Verben aus dem Konjugier-Trainer (Präsens, Participe passé, Futur).
 */
import { VERBS, accepted as frAccepted } from '../french/verbs'
import { shuffle } from '../learning/random'
import type { Question } from '../learning/questions'

export interface EnVerb { inf: string; past: string; pp: string; de: string }

const e = (inf: string, past: string, pp: string, de: string): EnVerb => ({ inf, past, pp, de })

export const EN_VERBS: EnVerb[] = [
  e('be', 'was/were', 'been', 'sein'), e('become', 'became', 'become', 'werden'), e('begin', 'began', 'begun', 'anfangen'),
  e('bite', 'bit', 'bitten', 'beißen'), e('blow', 'blew', 'blown', 'blasen, wehen'), e('break', 'broke', 'broken', 'brechen'),
  e('bring', 'brought', 'brought', 'bringen'), e('build', 'built', 'built', 'bauen'), e('burn', 'burnt/burned', 'burnt/burned', 'brennen'),
  e('buy', 'bought', 'bought', 'kaufen'), e('catch', 'caught', 'caught', 'fangen'), e('choose', 'chose', 'chosen', 'wählen'),
  e('come', 'came', 'come', 'kommen'), e('cost', 'cost', 'cost', 'kosten'), e('cut', 'cut', 'cut', 'schneiden'),
  e('dig', 'dug', 'dug', 'graben'), e('do', 'did', 'done', 'tun, machen'), e('draw', 'drew', 'drawn', 'zeichnen'),
  e('dream', 'dreamt/dreamed', 'dreamt/dreamed', 'träumen'), e('drink', 'drank', 'drunk', 'trinken'), e('drive', 'drove', 'driven', 'fahren (Auto)'),
  e('eat', 'ate', 'eaten', 'essen'), e('fall', 'fell', 'fallen', 'fallen'), e('feed', 'fed', 'fed', 'füttern'),
  e('feel', 'felt', 'felt', 'fühlen'), e('fight', 'fought', 'fought', 'kämpfen'), e('find', 'found', 'found', 'finden'),
  e('fly', 'flew', 'flown', 'fliegen'), e('forget', 'forgot', 'forgotten', 'vergessen'), e('forgive', 'forgave', 'forgiven', 'verzeihen'),
  e('freeze', 'froze', 'frozen', 'frieren'), e('get', 'got', 'got', 'bekommen, werden'), e('give', 'gave', 'given', 'geben'),
  e('go', 'went', 'gone', 'gehen'), e('grow', 'grew', 'grown', 'wachsen'), e('hang', 'hung', 'hung', 'hängen'),
  e('have', 'had', 'had', 'haben'), e('hear', 'heard', 'heard', 'hören'), e('hide', 'hid', 'hidden', 'verstecken'),
  e('hit', 'hit', 'hit', 'schlagen, treffen'), e('hold', 'held', 'held', 'halten'), e('hurt', 'hurt', 'hurt', 'verletzen'),
  e('keep', 'kept', 'kept', 'behalten'), e('know', 'knew', 'known', 'wissen, kennen'), e('lay', 'laid', 'laid', 'legen'),
  e('lead', 'led', 'led', 'führen'), e('learn', 'learnt/learned', 'learnt/learned', 'lernen'), e('leave', 'left', 'left', 'verlassen'),
  e('lend', 'lent', 'lent', 'leihen'), e('let', 'let', 'let', 'lassen'), e('lie', 'lay', 'lain', 'liegen'),
  e('light', 'lit', 'lit', 'anzünden'), e('lose', 'lost', 'lost', 'verlieren'), e('make', 'made', 'made', 'machen'),
  e('mean', 'meant', 'meant', 'bedeuten'), e('meet', 'met', 'met', 'treffen'), e('pay', 'paid', 'paid', 'bezahlen'),
  e('put', 'put', 'put', 'setzen, stellen'), e('read', 'read', 'read', 'lesen'), e('ride', 'rode', 'ridden', 'reiten, fahren (Rad)'),
  e('ring', 'rang', 'rung', 'klingeln'), e('rise', 'rose', 'risen', 'aufstehen, steigen'), e('run', 'ran', 'run', 'rennen'),
  e('say', 'said', 'said', 'sagen'), e('see', 'saw', 'seen', 'sehen'), e('sell', 'sold', 'sold', 'verkaufen'),
  e('send', 'sent', 'sent', 'schicken'), e('set', 'set', 'set', 'setzen, einstellen'), e('shake', 'shook', 'shaken', 'schütteln'),
  e('shine', 'shone', 'shone', 'scheinen'), e('shoot', 'shot', 'shot', 'schießen'), e('show', 'showed', 'shown', 'zeigen'),
  e('shut', 'shut', 'shut', 'schließen'), e('sing', 'sang', 'sung', 'singen'), e('sink', 'sank', 'sunk', 'sinken'),
  e('sit', 'sat', 'sat', 'sitzen'), e('sleep', 'slept', 'slept', 'schlafen'), e('smell', 'smelt/smelled', 'smelt/smelled', 'riechen'),
  e('speak', 'spoke', 'spoken', 'sprechen'), e('spell', 'spelt/spelled', 'spelt/spelled', 'buchstabieren'), e('spend', 'spent', 'spent', 'ausgeben, verbringen'),
  e('stand', 'stood', 'stood', 'stehen'), e('steal', 'stole', 'stolen', 'stehlen'), e('swim', 'swam', 'swum', 'schwimmen'),
  e('take', 'took', 'taken', 'nehmen'), e('teach', 'taught', 'taught', 'unterrichten'), e('tear', 'tore', 'torn', 'zerreißen'),
  e('tell', 'told', 'told', 'erzählen'), e('think', 'thought', 'thought', 'denken'), e('throw', 'threw', 'thrown', 'werfen'),
  e('understand', 'understood', 'understood', 'verstehen'), e('wake', 'woke', 'woken', 'aufwachen'), e('wear', 'wore', 'worn', 'tragen (Kleidung)'),
  e('win', 'won', 'won', 'gewinnen'), e('write', 'wrote', 'written', 'schreiben'),
]

export type EnForm = 'past' | 'pp'
export const EN_FORM_LABEL: Record<EnForm, string> = { past: 'Simple Past', pp: 'Past Participle' }

/** Fragen für Englisch: pro Verb und gewählter Form eine Frage, gemischt. */
export function buildEnglishQuestions(forms: EnForm[], count: number, verbs: EnVerb[] = EN_VERBS): Question[] {
  const all = verbs.flatMap((v) => forms.map((f) => ({ v, f })))
  return shuffle(all).slice(0, count).map(({ v, f }) => ({
    id: `en|${v.inf}|${f}`,
    vocabularyId: v.inf,
    direction: 'forward' as const,
    prompt: `${v.inf} (${v.de})`,
    accepted: (f === 'past' ? v.past : v.pp).split('/'),
  }))
}

/** Französisch: nur Verben mit unregelmäßigem Präsens. */
export const FR_IRREGULAR = ['être', 'avoir', 'aller', 'faire', 'dire', 'voir', 'pouvoir', 'vouloir', 'savoir', 'devoir', 'venir', 'prendre', 'mettre', 'partir', 'sortir', 'dormir', 'ouvrir', 'lire', 'écrire', 'boire', 'croire', 'connaître']
export const FR_VERBS = VERBS.filter((v) => FR_IRREGULAR.includes(v.inf))

export type FrForm = 'je' | 'nous' | 'ils' | 'pp' | 'futur'
export const FR_FORM_LABEL: Record<FrForm, string> = {
  je: 'Présent – je', nous: 'Présent – nous', ils: 'Présent – ils/elles', pp: 'Participe passé', futur: 'Futur – je',
}

export function buildFrenchQuestions(forms: FrForm[], count: number): Question[] {
  const all = FR_VERBS.flatMap((v) => forms.map((f) => ({ v, f })))
  return shuffle(all).slice(0, count).map(({ v, f }) => ({
    id: `fr|${v.inf}|${f}`,
    vocabularyId: v.inf,
    direction: 'forward' as const,
    prompt: `${v.inf} (${v.de})`,
    accepted:
      f === 'je' ? frAccepted(v, 'present', 0)
      : f === 'nous' ? frAccepted(v, 'present', 3)
      : f === 'ils' ? frAccepted(v, 'present', 5)
      : f === 'futur' ? frAccepted(v, 'futur', 0)
      : [v.pp],
  }))
}
