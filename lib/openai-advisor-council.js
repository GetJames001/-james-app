/**
 * James Live Advisor Council — OpenAI Adapters v0.2.0
 *
 * Six executable server-side adapters:
 * Research, Strategy, Finance, Legal, Operations, Technology.
 *
 * Contract:
 *   await adapter.execute(assignment, context)
 *
 * IMPORTANT:
 * - Keep OPENAI_API_KEY server-side.
 * - Research may use web search.
 * - Other advisors reason primarily over supplied case context.
 */

class BaseOpenAIAdvisorAdapter {
  constructor({
    id,
    title,
    mission,
    model,
    apiKey = process.env.OPENAI_API_KEY,
    fetchImpl = globalThis.fetch,
    enableWebSearch = false
  }) {
    if (!id || !title || !mission) throw new Error("id, title, and mission are required");
    if (!fetchImpl) throw new Error("fetch implementation required");

    this.id = id;
    this.title = title;
    this.mission = mission;
    this.model = model || process.env.JAMES_DEFAULT_MODEL || "gpt-5";
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.enableWebSearch = enableWebSearch;
  }

  roleInstructions() {
    return [];
  }

  contextPayload(assignment, context = {}) {
    return {
      question: assignment.question,
      mission: assignment.mission || this.mission,
      case_file: context.case_file || null,
      prior_rounds: context.prior_rounds || [],
      deliberation: context.deliberation || null,
      chairman_actions: context.chairman_actions || [],
      research_findings: context.research_findings || [],
      user_objectives: context.user_objectives || [],
      constraints: context.constraints || [],
      financial_inputs: context.financial_inputs || {},
      contracts: context.contracts || [],
      regulations: context.regulations || [],
      projects: context.projects || [],
      resources: context.resources || [],
      architecture: context.architecture || {},
      tech_stack: context.tech_stack || []
    };
  }

  buildRequest(assignment, context = {}) {
    if (!assignment?.question) throw new Error(`${this.id}: assignment.question is required`);

    const schemaInstruction = [
      "metadata must be an object.,"
      
      
      "Return ONLY valid JSON with exactly these top-level keys:",
      "finding, recommendation, evidence, counterarguments, missing_information, risks, confidence, metadata.",
      "confidence must be a number from 0 to 1.",
      "evidence, counterarguments, missing_information, and risks must be arrays.",
      "metadata must be an object.",
];
    const instructions = [
      `You are the ${this.title} inside James.`,
      this.mission,
      "Think independently. Do not merely agree with another advisor.",
      "Separate verified evidence from inference.",
      "Identify the strongest counterargument to your own conclusion.",
      "Identify any missing information that could materially change the decision.",
      "Do not overstate confidence.",
      ...this.roleInstructions(),
      ...schemaInstruction
    ].join("\n");

    const body = {
      model: this.model,
      
      store: false,
      max_output_tokens:4000,
      text: { format: { type: "json_object" } }
      instructions,
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify(this.contextPayload(assignment, context), null, 2)
        }]
      }]
    };
if (!this.enabledwebsearch) {
  body.reasoning = { effort: "minimal" };
}
    if (this.enableWebSearch) {
      body.tools = [{ type: "web_search" }];
      body.tool_choice = "auto";
    }

    return body;
  }

  async execute(assignment, context = {}) {
    if (!this.apiKey) {
      throw new Error(`${this.id}: OPENAI_API_KEY is not configured`);
    }

    const response = await this.fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(this.buildRequest(assignment, context))
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.id}: OpenAI Responses API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return this.parseResponse(data, assignment);
  }

  extractOutputText(data) {
    if (typeof data?.output_text === "string" && data.output_text.trim()) {
      return data.output_text.trim();
    }

    const texts = [];
    for (const item of data?.output || []) {
      if (item?.type !== "message") continue;
      for (const part of item.content || []) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          texts.push(part.text);
        }
      }
    }

    if (!texts.length) throw new Error(`${this.id}: no output text returned`);
    return texts.join("\n").trim();
  }

  parseResponse(data, assignment) {
    const text = this.extractOutputText(data);
    const cleanedText = text.replace(/^'''(?:json)?\s*'''$/,"").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      throw new Error(`${this.id}: non-JSON output: ${text.slice(0, 500)}`);
    }

    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`${this.id}: confidence must be between 0 and 1`);
    }

    return {
      advisor_id: assignment.advisor_id || this.id,
      finding: String(parsed.finding || ""),
      recommendation: parsed.recommendation == null ? null : String(parsed.recommendation),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      counterarguments: Array.isArray(parsed.counterarguments) ? parsed.counterarguments : [],
      missing_information: Array.isArray(parsed.missing_information) ? parsed.missing_information : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      confidence,
      source_count: Number(parsed.metadata?.source_count || 0),
      metadata: {
        ...(parsed.metadata || {}),
        provider: "openai",
        model: data.model || this.model,
        response_id: data.id || null
      }
    };
  }
}

class ResearchAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "research",
      title: "Chief Research Officer",
      mission: "Find, verify, and synthesize reliable information using authoritative sources.",
      model: process.env.JAMES_RESEARCH_MODEL || opts.model,
      enableWebSearch: false,
      ...opts
    });
  }

  roleInstructions() {
    return [
      "Use web search when current or externally verifiable information would materially improve the analysis.",
      "Prefer primary, official, and authoritative sources.",
      "In metadata include a sources array with title and URL when available, and source_count."
    ];
  }
}

class StrategyAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "strategy",
      title: "Chief Strategy Officer",
      mission: "Evaluate long-term implications, trade-offs, opportunity cost, strategic fit, and second-order effects.",
      model: process.env.JAMES_STRATEGY_MODEL || opts.model,
      ...opts
    });
  }
  roleInstructions() {
    return [
      "Use research as evidence, not authority.",
      "In metadata include strategic_alternatives, key_assumptions, and change_conditions."
    ];
  }
}

class FinanceAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "finance",
      title: "Chief Financial Officer",
      mission: "Evaluate financial impact, downside, upside, ROI, cash flow, and sensitivity to assumptions.",
      model: process.env.JAMES_FINANCE_MODEL || opts.model,
      ...opts
    });
  }
  roleInstructions() {
    return [
      "Quantify where inputs permit; otherwise state what financial data is missing.",
      "In metadata include financial_summary, key_metrics, and sensitivity_analysis."
    "keep finding and recommendation concise: each must be no more than 120 words.",];
  }
}

class LegalAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "legal",
      title: "General Counsel",
      mission: "Identify legal, contractual, regulatory, compliance, and liability risks and distinguish blockers from manageable risks.",
      model: process.env.JAMES_LEGAL_MODEL || opts.model,
      ...opts
    });
  }
  roleInstructions() {
    return [
      "Do not present uncertain jurisdiction-specific legal conclusions as established fact.",
      "Flag when qualified human counsel is required.",
      "In metadata include legal_summary, compliance_flags, requires_human_counsel."
    ];
  }
}

class OperationsAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "operations",
      title: "Chief Operating Officer",
      mission: "Evaluate execution feasibility, bottlenecks, resources, timing, process, and operational risk.",
      model: process.env.JAMES_OPERATIONS_MODEL || opts.model,
      ...opts
    });
  }
  roleInstructions() {
    return [
      "Translate conclusions into operational consequences.",
      "In metadata include execution_plan, bottlenecks, kpis, next_actions."
    ];
  }
}

class TechnologyAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "technology",
      title: "Chief Technology Officer",
      mission: "Evaluate architecture, scalability, security, implementation risk, technical debt, and technical feasibility.",
      model: process.env.JAMES_TECHNOLOGY_MODEL || opts.model,
      ...opts
    });
  }
  roleInstructions() {
    return [
      "Distinguish known technical facts from assumptions.",
      "In metadata include architecture_review, security_concerns, technical_debt, implementation_plan."
    ];
  }
}

function createOpenAIAdvisorCouncil(options = {}) {
  const shared = {
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    model: options.model
  };

  return {
    research: new ResearchAdvisor(shared),
    strategy: new StrategyAdvisor(shared),
    finance: new FinanceAdvisor(shared),
    legal: new LegalAdvisor(shared),
    operations: new OperationsAdvisor(shared),
    technology: new TechnologyAdvisor(shared)
  };
}

module.exports = {
  BaseOpenAIAdvisorAdapter,
  ResearchAdvisor,
  StrategyAdvisor,
  FinanceAdvisor,
  LegalAdvisor,
  OperationsAdvisor,
  TechnologyAdvisor,
  createOpenAIAdvisorCouncil
};
