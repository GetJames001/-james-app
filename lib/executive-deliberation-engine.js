/**
 * James Executive Deliberation Engine v0.1.0
 *
 * Purpose:
 * - Preserve advisor disagreement.
 * - Identify the reason for conflict.
 * - Generate targeted challenge rounds.
 * - Determine whether the Council is ready for James to decide.
 * - Block premature recommendations when decision-critical uncertainty remains.
 */

class ExecutiveDeliberationEngine {
  constructor({
    maxRounds = 3,
    blockingRiskPatterns = [
      
      
      /\b(physical safety|health and safety|unsafe| hazard|injury|injuries)\b/i,
      /fraud/i,
      /insolvency/i,
      
      
    ]
  } = {}) {
    this.maxRounds = maxRounds;
    this.blockingRiskPatterns = blockingRiskPatterns;
  }

  normalize(results = []) {
    return results.map(r => ({
      advisor_id: r.advisor_id,
      recommendation: r.recommendation || null,
      finding: r.finding || "",
      confidence: this.clamp(r.confidence ?? 0.5),
      evidence: Array.isArray(r.evidence) ? r.evidence : [],
      counterarguments: Array.isArray(r.counterarguments) ? r.counterarguments : [],
      missing_information: Array.isArray(r.missing_information) ? r.missing_information : [],
      risks: Array.isArray(r.risks) ? r.risks : []
    }));
  }

  clamp(v) {
    return Math.max(0, Math.min(1, Number(v)));
  }

  polarity(text = "") {
    const t = String(text).toLowerCase();
    if (/\b(do not|don't|avoid|reject|decline|stop|no|unfavorable)\b/.test(t)) return -1;
    if (/\b(proceed|accept|buy|yes|recommend|favorable|move forward|go forward)\b/.test(t)) return 1;
    return 0;
  }

  findConflicts(results) {
    const normalized = this.normalize(results);
    const conflicts = [];

    const polarities = normalized.map(r => ({
      advisor_id: r.advisor_id,
      polarity: this.polarity(r.recommendation || r.finding)
    }));

    const hasPositive = polarities.some(x => x.polarity === 1);
    const hasNegative = polarities.some(x => x.polarity === -1);

    if (hasPositive && hasNegative) {
      conflicts.push({
        type: "recommendation_conflict",
        advisors: polarities.filter(x => x.polarity !== 0)
      });
    }

    const lowConfidence = normalized.filter(r => r.confidence < 0.55);
    if (lowConfidence.length) {
      conflicts.push({
        type: "confidence_conflict",
        advisors: lowConfidence.map(r => r.advisor_id)
      });
    }

    const gaps = normalized.filter(r => r.missing_information.length);
    if (gaps.length >= 2) {
      conflicts.push({
        type: "evidence_gap_conflict",
        gaps: gaps.map(r => ({
          advisor_id: r.advisor_id,
          missing_information: r.missing_information
        }))
      });
    }

    return conflicts;
  }

  findBlockingIssues(results) {
    const normalized = this.normalize(results);
const blockers = [];

for (const r of normalized) {
  for (const risk of r.risks) {
    const text = String(risk).trim();

    if (/^BLOCKER:/i.test(text)) {
      blockers.push({
        advisor_id: r.advisor_id,
        risk: text.replace(/^BLOCKER:\s*/i, "")
      });
    }
  }
}

return blockers;
  }

  buildChallengeRound(results, round = 1) {
    if (round > this.maxRounds) {
      return {
        round,
        required: false,
        reason: "max_rounds_reached",
        prompts: []
      };
    }

    const conflicts = this.findConflicts(results);
    const blockers = this.findBlockingIssues(results);
    const prompts = [];

    if (conflicts.some(c => c.type === "recommendation_conflict")) {
      prompts.push({
        type: "cross_examination",
        prompt:
          "The Council has opposing recommendations. Each side must state its strongest evidence, weakest assumption, and the single fact that would most likely change its position."
      });
    }

    if (conflicts.some(c => c.type === "confidence_conflict")) {
      prompts.push({
        type: "confidence_review",
        prompt:
          "Re-evaluate the low-confidence conclusions. Separate uncertainty caused by missing evidence from uncertainty caused by genuine ambiguity."
      });
    }

    if (conflicts.some(c => c.type === "evidence_gap_conflict")) {
      prompts.push({
        type: "evidence_gap_review",
        prompt:
          "Identify which missing facts are decision-critical. Rank the gaps by how much they could change the final recommendation."
      });
    }

    if (blockers.length) {
      prompts.push({
        type: "blocking_issue_review",
        prompt:
          "Review the blocking risks. James must not issue a final recommendation until each blocker is resolved, accepted explicitly, or escalated to a qualified human expert."
      });
    }

    return {
      round,
      required: prompts.length > 0,
      conflicts,
      blockers,
      prompts
    };
  }

  readiness(results, round = 1) {
    const conflicts = this.findConflicts(results);
    const blockers = this.findBlockingIssues(results);

    const unresolvedRecommendationConflict =
      conflicts.some(c => c.type === "recommendation_conflict");

    const unresolvedCriticalUncertainty =
      conflicts.some(c => c.type === "confidence_conflict") ||
      conflicts.some(c => c.type === "evidence_gap_conflict");

    let status = "ready";

if (blockers.length) {
  status = "blocked";
} else if (
  round < this.maxRounds &&
  (unresolvedRecommendationConflict || unresolvedCriticalUncertainty)
) {
  status = "deliberate";
}

    return {
      status,
      ready_for_james:
        status === "ready" || round >= this.maxRounds,
      round,
      conflicts,
      blockers,
      next_round: status === "deliberate" && round < this.maxRounds
    };
  }

  conclude(results, round = 1) {
    const state = this.readiness(results, round);
    const challenge = this.buildChallengeRound(results, round);

    return {
      version: "0.1.0",
      state,
      challenge,
      james_guidance:
        state.status === "blocked"
          ? "Do not issue a final recommendation. Explain the blocker and the next action needed to resolve it."
          : state.status === "deliberate"
          ? "Run another targeted deliberation round before issuing a recommendation."
          : "Council review is complete. James may synthesize and own the final recommendation."
    };
  }
}

module.exports = { ExecutiveDeliberationEngine };
