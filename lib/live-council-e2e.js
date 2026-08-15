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
    const results = Array.isArray(pkg.advisor_results)
      ? pkg.advisor_results
      : [];

    const weighted = Number(pkg.weighted_confidence || 0.5);

    const textFor = (r) =>
      [
        r?.recommendation,
        r?.finding,
        r?.analysis,
        r?.summary,
        ...(Array.isArray(r?.risks) ? r.risks : []),
        ...(Array.isArray(r?.concerns) ? r.concerns : [])
      ]
        .filter(Boolean)
        .join(" ");

    const negativePattern =
      /\b(do not|don't|avoid|reject|decline|stop|no\b|not feasible|not affordable|unaffordable|cannot|can't|insufficient|exceeds|too expensive|high risk|not recommended)\b/i;

    const positivePattern =
      /\b(proceed|accept|buy|recommend|move forward|go forward|feasible|affordable|approved)\b/i;

    const negatives = results.filter(r =>
      negativePattern.test(textFor(r))
    );

    const positives = results.filter(r =>
      positivePattern.test(textFor(r))
    );

    // Finance, legal, and operations can surface blocking constraints.
    const blockingAdvisors = results.filter(r =>
      ["finance", "legal", "operations"].includes(r.advisor_id) &&
      negativePattern.test(textFor(r))
    );

    let recommendation;

    if (blockingAdvisors.length > 0) {
      recommendation = "Do not proceed on the current terms.";
    } else if (negatives.length > positives.length) {
      recommendation = "Do not proceed until the Council's concerns are resolved.";
    } else if (positives.length > negatives.length) {
      recommendation = "Proceed, subject to the safeguards and conditions identified by the Council.";
    } else {
      recommendation = "More information is needed before making a final decision.";
    }

    const unique = (items) =>
      [...new Set(
        items
          .map(x => String(x || "").trim())
          .filter(Boolean)
      )];

    const reasons = unique(
      results.flatMap(r => [
        r.recommendation,
        r.finding,
        r.summary
      ])
    ).slice(0, 3);

    const key_facts = unique(
      results.flatMap(r => [
        ...(Array.isArray(r.evidence) ? r.evidence : []),
        ...(Array.isArray(r.key_facts) ? r.key_facts : []),
        ...(Array.isArray(r.facts) ? r.facts : [])
      ])
    ).slice(0, 4);

    const risks = unique(
      results.flatMap(r => [
        ...(Array.isArray(r.risks) ? r.risks : []),
        ...(Array.isArray(r.concerns) ? r.concerns : []),
        ...(Array.isArray(r.warnings) ? r.warnings : [])
      ])
    ).slice(0, 4);

    const what_would_change_the_answer = unique(
      results.flatMap(r => [
        ...(Array.isArray(r.missing_information)
          ? r.missing_information
          : []),
        ...(Array.isArray(r.conditions)
          ? r.conditions
          : []),
        ...(Array.isArray(r.change_conditions)
          ? r.change_conditions
          : [])
      ])
    ).slice(0, 4);

    return {
      recommendation,

      confidence: {
        score: weighted,
        label:
          weighted >= 0.85 ? "Very High" :
          weighted >= 0.75 ? "High" :
          weighted >= 0.55 ? "Moderate" : "Low"
      },

      reasons,
      key_facts,
      risks,
      what_would_change_the_answer,

      advisor_summary: results.map(r => ({
        advisor_id: r.advisor_id,
        recommendation: r.recommendation,
        finding: r.finding,
        confidence: r.confidence
      })),

      dissent_preserved: negatives.map(r => ({
        advisor_id: r.advisor_id,
        recommendation: r.recommendation || r.finding
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
