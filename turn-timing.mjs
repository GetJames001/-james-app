// Timing observer only. No conversation, transport, storage, network or audio ownership.
const EVENTS = new Set(['input_end_observed','recognition_final','request_start','response_headers','response_decoded','text_painted','text_dom_updated','speech_stopped_event','response_created_event','provider_audio_started_event','audible_start_observed','meaningful_answer_observed','answer_complete_observed','response_done_event']);
const idOK = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && !/^(sk-|token-|secret-)/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
export function createTurnTiming({ enabled = false, generation = 0, now = () => performance.now(), capacity = 128 } = {}) {
  if (!Number.isSafeInteger(generation) || generation < 0 || typeof now !== 'function' || !Number.isInteger(capacity) || capacity < 1 || capacity > 1024) throw Error('Invalid timing configuration');
  let currentGeneration = generation;
  const turns = new Map();
  const timestamp = () => { const value = now(); return Number.isFinite(value) && value >= 0 ? value : null; };
  function get(input, keys) {
    if (!enabled || !exact(input, keys) || input.generation !== currentGeneration || !idOK(input.turnId)) return null;
    const turn = turns.get(input.turnId);
    return turn && turn.status === 'active' ? turn : null;
  }
  function timeFor(turn) { const at = timestamp(); return at !== null && at >= turn.lastAt ? at : null; }
  function begin(input) {
    if (!enabled || !exact(input, ['turnId','generation']) || input.generation !== currentGeneration || !idOK(input.turnId) || turns.has(input.turnId) || turns.size >= capacity) return false;
    const at = timestamp(); if (at === null) return false;
    turns.set(input.turnId, { turnId: input.turnId, generation: currentGeneration, status: 'active', startedAt: at, lastAt: at, events: {}, tools: {} });
    return true;
  }
  function mark(input) {
    const turn = get(input, ['turnId','generation','event']);
    if (!turn || !EVENTS.has(input.event) || Object.hasOwn(turn.events, input.event)) return false;
    const at = timeFor(turn); if (at === null) return false;
    turn.events[input.event] = at; turn.lastAt = at; return true;
  }
  function tool(input) {
    const turn = get(input, ['turnId','generation','toolId','phase']);
    if (!turn || !idOK(input.toolId) || !['start','end'].includes(input.phase)) return false;
    const prior = Object.hasOwn(turn.tools, input.toolId) ? turn.tools[input.toolId] : undefined;
    if (input.phase === 'start' ? !!prior || Object.keys(turn.tools).length >= 32 : !prior || prior.end !== null) return false;
    const at = timeFor(turn); if (at === null) return false;
    if (input.phase === 'start') turn.tools[input.toolId] = { start: at, end: null };
    else prior.end = at;
    turn.lastAt = at; return true;
  }
  function close(input) {
    const turn = get(input, ['turnId','generation','status']);
    if (!turn || !['completed','interrupted','ended','failed'].includes(input.status)) return false;
    const at = timeFor(turn); if (at === null) return false;
    turn.status = input.status; turn.lastAt = at; turn.closedAt = at; return true;
  }
  function rotate(nextGeneration) {
    if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= currentGeneration) return false;
    currentGeneration = nextGeneration; turns.clear(); return true;
  }
  function snapshot() {
    if (!enabled) return [];
    return [...turns.values()].map(turn => {
      const elapsed = name => Object.hasOwn(turn.events, name) ? turn.events[name] - turn.startedAt : null;
      return { turnId: turn.turnId, generation: turn.generation, status: turn.status,
        eventsMs: Object.fromEntries(Object.keys(turn.events).map(name => [name, elapsed(name)])),
        toolsMs: Object.fromEntries(Object.entries(turn.tools).map(([id, span]) => [id, { start: span.start - turn.startedAt, end: span.end === null ? null : span.end - turn.startedAt, duration: span.end === null ? null : span.end - span.start }])),
        elapsedToProviderAudioEventMs: elapsed('provider_audio_started_event'),
        elapsedToAudibleObservationMs: elapsed('audible_start_observed'),
        elapsedToMeaningfulAnswerMs: elapsed('meaningful_answer_observed'),
        elapsedToCompleteAnswerMs: elapsed('answer_complete_observed'),
        observerClosedMs: turn.closedAt === undefined ? null : turn.closedAt - turn.startedAt };
    });
  }
  return Object.freeze({ begin, mark, tool, close, rotate, snapshot });
}
