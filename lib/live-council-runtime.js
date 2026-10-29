/**
 * James Live Council Runtime v0.1.0
 *
 * Production-facing integration layer for:
 * - six advisor seats
 * - structured Council meeting
 * - deliberation / blocker handling
 * - Chairman review
 * - final recommendation handoff
 *
 * Provider-agnostic: each advisor adapter only needs execute(assignment, context).
 */

class LiveCouncilRuntime {
  constructor({
    adapters,
    deliberationEngine,
    chairmanEngine,
    recommendationEngine,
    maxRounds = 1
  }) {
    this.adapters = adapters || {};
    this.deliberationEngine = deliberationEngine;
    this.chairmanEngine = chairmanEngine;
    this.recommendationEngine = recommendationEngine;
    this.maxRounds = maxRounds;
  }

  requiredSeats() {
    return ["research","strategy","finance","legal","operations","technology"];
  }

  validateAdapters() {
    const missing = this.requiredSeats().filter(id => {
      const a = this.adapters[id];
      return !a || typeof a.execute !== "function";
    });
    return { valid: missing.length === 0, missing };
  }

  async run({ question, assignments, context = {} }) {
    if (!question) throw new Error("question is required");
    if (!Array.isArray(assignments)) throw new Error("assignments must be an array");

    const validation = this.validateAdapters();
    if (!validation.valid) {
      throw new Error(`Missing executable advisor adapters: ${validation.missing.join(", ")}`);
    }

    const meeting = {
      status: "IN_SESSION",
      round: 1,
      minutes: [],
      actions: [],
      dissent: [],
      advisor_results: []
    };

    // Round 1: independent work.
    const roundOne = await Promise.all(
      assignments
        .filter(a => this.requiredSeats().includes(a.advisor_id))
        .map(a => this.executeSeat(a, context))
    );

    meeting.advisor_results = roundOne;
    for (const r of roundOne) {
      meeting.minutes.push({
        round: 1,
        advisor_id: r.advisor_id,
        finding: r.finding,
        recommendation: r.recommendation,
        confidence: r.confidence
      });
    }

    let current = roundOne;
    let round = 1;
    let state = this.deliberationEngine.conclude(current, round);

    while (round < this.maxRounds && state.state.status !== "ready") {
      const chair = this.chairmanEngine.review({
        conflicts: state.state.conflicts,
        blockers: state.state.blockers
      });

      meeting.actions.push(...(chair.actions || []).map(a => ({ round, ...a })));

      const targets = this.targetsForNextRound(state, current);
      if (!targets.length) break;

      round += 1;
      meeting.round = round;

      const updates = await Promise.all(
        targets.map(id => {
          const baseAssignment = assignments.find(a => a.advisor_id === id);
          return this.executeSeat(baseAssignment, {
            ...context,
            prior_rounds: meeting.minutes,
            deliberation: state,
            chairman_actions: chair.actions || []
          });
        })
      );

      current = this.mergeResults(current, updates);

      for (const r of updates) {
        meeting.minutes.push({
          round,
          advisor_id: r.advisor_id,
          finding: r.finding,
          recommendation: r.recommendation,
          confidence: r.confidence
        });
      }

      state = this.deliberationEngine.conclude(current, round);
    }

    meeting.status =
      state.state.status === "blocked" ? "BLOCKED" :
      state.state.status === "ready" ? "READY_FOR_DECISION" :
      "DELIBERATION_LIMIT_REACHED";

    meeting.advisor_results = current;

    for (const conflict of state.state.conflicts || []) {
      meeting.dissent.push(conflict);
    }

    const output = {
      status: meeting.status,
      meeting,
      deliberation: state,
      final_recommendation: null
    };

    if (meeting.status === "READY_FOR_DECISION" && this.recommendationEngine) {
      // The recommendation engine consumes a synthesis-style package.
      const synthesis = {
        weighted_confidence: this.weightedConfidence(current),
        advisor_results: current
      };
      output.final_recommendation = this.recommendationEngine.build(synthesis);
    }

    return output;
  }

 async executeSeat(assignment, context) {
  if (!assignment?.advisor_id) {
    throw new Error("assignment.advisor_id is required");
  }

  const adapter = this.adapters[assignment.advisor_id];

  if (!adapter) {
    throw new Error(`No adapter for ${assignment.advisor_id}`);
  }

  const started = Date.now();

  try {
    const result = await adapter.execute(assignment, context);

    console.log(
      `[James Council Timing] ${assignment.advisor_id}: ${Date.now() - started}ms`
    );

    return result;
  } catch (err) {
    console.log(
      `[James Council Timing] ${assignment.advisor_id}: failed after ${Date.now() - started}ms`
    );

    throw err;
  }
}

  targetsForNextRound(state, current) {
    const ids = new Set();

    for (const c of state.state.conflicts || []) {
      for (const a of c.advisors || []) {
        if (a.advisor_id) ids.add(a.advisor_id);
        else if (typeof a === "string") ids.add(a);
      }
      for (const g of c.gaps || []) {
        if (g.advisor_id) ids.add(g.advisor_id);
      }
    }

    for (const b of state.state.blockers || []) {
      if (b.advisor_id) ids.add(b.advisor_id);
      ids.add("research"); // Research helps close decision-critical gaps.
    }

    // If conflict exists but target extraction was sparse, re-run Strategy + Intelligence-facing roles available here.
    if (!ids.size && state.state.status !== "ready") {
      ["research","strategy","legal"].forEach(id => {
        if (current.some(r => r.advisor_id === id)) ids.add(id);
      });
    }

    return [...ids].filter(id => this.requiredSeats().includes(id)).slice(0,2);
  }

  mergeResults(existing, updates) {
    const map = Object.fromEntries(existing.map(r => [r.advisor_id, {...r}]));
    for (const u of updates) map[u.advisor_id] = {...map[u.advisor_id], ...u};
    return Object.values(map);
  }

  weightedConfidence(results) {
    if (!results.length) return 0.5;
    const values = results.map(r => Number(r.confidence ?? 0.5));
    return Number((values.reduce((a,b)=>a+b,0) / values.length).toFixed(3));
  }
}

module.exports = { LiveCouncilRuntime };
