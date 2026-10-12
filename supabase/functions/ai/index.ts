// Supabase Edge Function "ai": erzeugt Grammatik-Blätter und Test-Sätze mit OpenAI.
// Der Schlüssel liegt NUR hier als Secret (OPENAI_API_KEY), nie im Browser.
// Antwort immer HTTP 200 mit { ok, code?, message?, ... }, damit die App Fehler schön anzeigen kann.
// @ts-nocheck  (läuft unter Deno, nicht unter dem Projekt-tsc)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  GRAMMAR_SCHEMA, SENTENCE_SCHEMA, MESSAGES, RequestError, buildGrammarPrompt, buildSentencesPrompt,
  classifyOpenAiError, cleanVocabList, parseGrammarRequest, parseGrammarResponse, parseSentencesResponse, titleFor, vocabKey,
} from './lib.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function fail(code: string, message?: string): Response {
  return reply({ ok: false, code, message: message ?? MESSAGES[code] ?? MESSAGES.error })
}

class OpenAiFail extends Error {
  constructor(public code: string, message: string) { super(message) }
}

async function callOpenAi(key: string, model: string, system: string, user: string, schema: unknown) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45_000)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        max_tokens: 3500,
        response_format: { type: 'json_schema', json_schema: schema },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const c = classifyOpenAiError(res.status, json)
      throw new OpenAiFail(c.code, c.message)
    }
    return {
      content: String(json?.choices?.[0]?.message?.content ?? ''),
      tin: Number(json?.usage?.prompt_tokens ?? 0),
      tout: Number(json?.usage?.completion_tokens ?? 0),
    }
  } catch (e) {
    if (e instanceof OpenAiFail) throw e
    throw new OpenAiFail('error', 'Keine Verbindung zu OpenAI.')
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await admin.auth.getUser(jwt)
    const uid = auth?.user?.id
    if (!uid) return fail('auth')

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action ?? '')
    const key = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
    const model = (Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini').trim()

    // Schlüssel fehlt → Admin sieht es, Nutzer bekommen die Meldung.
    if (!key) {
      await admin.rpc('ai_set_status', { p_state: 'no_key', p_message: 'OPENAI_API_KEY ist in Supabase nicht gesetzt.' })
      return fail('no_key')
    }

    // Nur Admins: Schlüssel und Guthaben testen (billiger Aufruf ohne Kosten).
    if (action === 'check') {
      const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
      if (prof?.role !== 'admin') return fail('auth')
      const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const c = classifyOpenAiError(res.status, json)
        await admin.rpc('ai_set_status', { p_state: c.code === 'rate' ? 'error' : c.code, p_message: c.message })
        return reply({ ok: false, code: c.code, message: c.message })
      }
      // Die Modell-Liste prüft nur den Schlüssel. Ob Guthaben da ist, zeigt sich erst bei der ersten Erzeugung.
      await admin.rpc('ai_set_status', { p_state: 'ok', p_message: 'Schlüssel gültig.' })
      return reply({ ok: true, message: 'Der Schlüssel ist gültig. Ob noch Guthaben da ist, zeigt sich beim nächsten Erzeugen.' })
    }

    if (action !== 'grammar' && action !== 'sentences') return fail('bad_request')
    const kind = action

    const { data: begin, error: beginErr } = await admin.rpc('ai_begin', { p_user: uid, p_kind: kind })
    if (beginErr) return fail('error')
    // Gespeicherte Sätze dürfen auch ohne Budget aus dem Cache kommen, nur „kein Plus“ sperrt alles.
    let cacheOnly = false
    if (!begin.ok) {
      if (kind === 'sentences' && begin.code !== 'no_plus') cacheOnly = true
      else return fail(begin.code)
    }
    const maxItems = Number(begin.max_items ?? 15)
    const maxSentences = Number(begin.max_sentences ?? 20)

    if (kind === 'grammar') {
      const r = parseGrammarRequest(body, maxItems)
      const { system, user } = buildGrammarPrompt(r)
      let lastErr = 'invalid'
      for (let attempt = 0; attempt < 2; attempt++) {
        let out
        try {
          out = await callOpenAi(key, model, system, user, GRAMMAR_SCHEMA)
        } catch (e) {
          await admin.rpc('ai_record_usage', { p_user: uid, p_kind: kind, p_in: 0, p_out: 0, p_ok: false })
          if (e.code === 'no_key' || e.code === 'empty') await admin.rpc('ai_set_status', { p_state: e.code, p_message: e.message })
          else if (e.code === 'error') await admin.rpc('ai_set_status', { p_state: 'error', p_message: e.message })
          return fail(e.code, e.message)
        }
        try {
          const parsed = parseGrammarResponse(out.content, r.count)
          await admin.rpc('ai_record_usage', { p_user: uid, p_kind: kind, p_in: out.tin, p_out: out.tout, p_ok: true })
          const title = titleFor(r.language, r.topic, r.level, r.grade, parsed.title)
          const { data: id } = await admin.rpc('ai_save_grammar_set', {
            p_user: uid, p_language: r.language, p_grade: r.grade, p_topic_key: r.topicKey, p_topic: r.topic,
            p_level: r.level, p_title: title, p_items: parsed.items,
          })
          await admin.rpc('ai_set_status', { p_state: 'ok', p_message: '' })
          return reply({ ok: true, id, title, items: parsed.items })
        } catch (e) {
          lastErr = e.message
          // Tokens wurden trotzdem verbraucht → buchen, dann einmal neu versuchen.
          await admin.rpc('ai_record_usage', { p_user: uid, p_kind: kind, p_in: out.tin, p_out: out.tout, p_ok: false })
        }
      }
      return fail('invalid', `${MESSAGES.invalid} (${lastErr})`)
    }

    // ---- Sätze zu Vokabeln ----
    const language = String(body.language ?? '')
    if (language !== 'en' && language !== 'fr') return fail('bad_request')
    const level = String(body.level ?? '')
    if (!['einfach', 'mittel', 'schwer'].includes(level)) return fail('bad_request')
    const vocab = cleanVocabList(body.vocab, maxSentences)
    const keys = vocab.map((v) => vocabKey(language, level, v))
    const { data: cached } = await admin.rpc('ai_get_vocab_sentences', { p_keys: keys })
    const have = cached ?? {}
    const missing = vocab.map((v, i) => ({ v, i })).filter(({ i }) => !have[keys[i]])

    if (missing.length > 0 && !cacheOnly) {
      const { system, user } = buildSentencesPrompt(language, level, missing.map((m) => m.v))
      try {
        const out = await callOpenAi(key, model, system, user, SENTENCE_SCHEMA)
        const parsed = parseSentencesResponse(out.content, missing.length)
        await admin.rpc('ai_record_usage', { p_user: uid, p_kind: kind, p_in: out.tin, p_out: out.tout, p_ok: parsed.size > 0 })
        const rows = []
        for (const [idx, item] of parsed) {
          const m = missing[idx]
          rows.push({ key: keys[m.i], language, level, item })
          have[keys[m.i]] = item
        }
        if (rows.length) await admin.rpc('ai_save_vocab_sentences', { p_rows: rows })
        await admin.rpc('ai_set_status', { p_state: 'ok', p_message: '' })
      } catch (e) {
        await admin.rpc('ai_record_usage', { p_user: uid, p_kind: kind, p_in: 0, p_out: 0, p_ok: false })
        if (e.code === 'no_key' || e.code === 'empty') await admin.rpc('ai_set_status', { p_state: e.code, p_message: e.message })
        // Vorhandene Sätze trotzdem liefern; fehlende bleiben leer, der Test geht ohne sie weiter.
        if (Object.keys(have).length === 0) return fail(e.code ?? 'error', e.message)
      }
    }
    const used = keys.filter((k) => have[k])
    if (used.length) await admin.rpc('ai_touch_vocab_sentences', { p_keys: used })
    return reply({ ok: true, sentences: vocab.map((v, i) => ({ foreign: v.foreign, german: v.german, item: have[keys[i]] ?? null })), partial: used.length < keys.length })
  } catch (e) {
    if (e instanceof RequestError) return fail(e.code, e.message)
    return fail('error')
  }
})
