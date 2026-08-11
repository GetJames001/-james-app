/**
 * James Live Council E2E v0.3.0
 *
 * Purpose:
 * Wire the six live OpenAI advisor adapters into the Live Council Runtime
 * and provide one server-side entry point for a complete Executive Council meeting.
 */

const {
  createOpenAIAdvisorCouncil
} = require("./openai-advisor-council.js");

const { LiveCouncilRuntime } = require("./live-council-runtime.js");
const { ExecutiveDeliberationEngine } = require("./executive-deliberation-engine.js");
const { ChairmanEngine } = require("./chairman-engine.js");

class SimpleRecommendationEngine {
  build(pkg) {
    const results = pkg.advisor_results || [];
    const weighted = Number(pkg.weighted_confidence || 0.5);

    const positives = results.filter(r =>
      /\b(proceed|accept|buy|recommend|move forward|go forward)\b/i.test(
        String(r.recommendation || r.finding || "")
      )
    );

    const negatives = results.filter(r =>
      /\b(do not|don't|avoid|reject|decline|stop|no)\b/i.test(
        String(r.recommendation || r.finding || "")
      )
    );

    let recommendation = "Proceed cautiously and resolve any remaining open issues.";
    if (negatives.length > positives.length) {
      recommendation = "Do not proceed until the Council's unresolved concerns are addressed.";
    } else if (positives.length > negatives.length) {
      recommendation = "Proceed, subject to the safeguards and conditions identified by the Council.";
    }

    return {
      recommendation,
      confidence: {
        score: weighted,
        label:
          weighted >= 0.85 ? "Very High" :
          weighted >= 0.75 ? "High" :
          weighted >= 0.55 ? "Moderate" : "Low"
      },
      dissent_preserved: negatives.map(r => ({
        advisor_id: r.advisor_id,
        recommendation: r.recommendation
      }))
    };
  }
}

function defaultAssignments(question) {
  return [
    { advisor_id: "research", question, mission: "Find and verify relevant evidence." },
    { advisor_id: "strategy", question, mission: "Evaluate long-term strategic implications." },
    { advisor_id: "finance", question, mission: "Evaluate financial impact and risk." },
    { advisor_id: "legal", question, mission: "Identify legal and compliance risk." },
    { advisor_id: "operations", question, mission: "Assess execution feasibility and operational risk." },
    { advisor_id: "technology", question, mission: "Assess technical feasibility, architecture, and security." }
  ];
}

function createJamesLiveCouncil({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  model = process.env.JAMES_DEFAULT_MODEL || "gpt-5"
} = {}) {
  const adapters = createOpenAIAdvisorCouncil({
    apiKey,
    fetchImpl,
    model
  });

  return new LiveCouncilRuntime({
    adapters,
    deliberationEngine: new ExecutiveDeliberationEngine({ maxRounds: 1 }),
    chairmanEngine: new ChairmanEngine(),
    recommendationEngine: new SimpleRecommendationEngine(),
    maxRounds: 1
  });
}

async function runExecutiveCouncil({
  question,
  context = {},
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  model
}) {
  if (!question) throw new Error("question is required");

  const council = createJamesLiveCouncil({
    apiKey,
    fetchImpl,
    model
  });

  const result = await council.run({
    question,
    assignments: defaultAssignments(question),
    context
  });

  return {
    question,
    status: result.status,
    meeting: result.meeting,
    deliberation: result.deliberation,
    final_recommendation: result.final_recommendation
  };
}

module.exports = {
  createJamesLiveCouncil,
  runExecutiveCouncil,
  defaultAssignments,
  SimpleRecommendationEngine
};
