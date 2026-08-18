/**
 * James Live Advisor Council — OpenAI Adapters v0.3.2
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
    if (!id || !title || !mission) {
      throw new Error("id, title, and mission are required");
    }

    if (!fetchImpl) {
      throw new Error("fetch implementation required");
    }

    this.id = id;
    this.title = title;
    this.mission = mission;
    this.model =
      model ||
      process.env.JAMES_DEFAULT_MODEL ||
      "gpt-5";

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
    if (!assignment?.question) {
      throw new Error(
        `${this.id}: assignment.question is required`
      );
    }

    const schemaInstruction = [
      "Return ONLY valid JSON.",
      "Return exactly these top-level keys:",
      "finding, recommendation, evidence, counterarguments, missing_information, risks, change_conditions, confidence, metadata.",
      "finding must be a concise string.",
      "recommendation must be a concise string or null.",
      "evidence must be an array.",
      "counterarguments must be an array.",
      "missing_information must be an array.",
      "risks must be an array.",
      "change_conditions must be an array.",
      "confidence must be a number from 0 to 1.",
      "metadata must be an object.",

      "IMPORTANT: change_conditions and missing_information are different.",
      "missing_information means facts you would like to know before becoming more certain.",
      "change_conditions means concrete conditions that would cause your recommendation itself to change.",
      "Each change_conditions item must describe what would have to become true for your current recommendation to reverse or materially change.",
      "Do NOT put ordinary missing facts, due-diligence questions, or additional information requests into change_conditions.",
      "Whenever possible, make change_conditions measurable and specific.",
      "If your recommendation is negative, explain what would need to improve for the answer to become yes.",
      "If your recommendation is positive, explain what deterioration or new fact would cause the answer to become no.",
      "Return no more than 4 change_conditions."
    ];

    const instructions = [
      `You are the ${this.title} inside James.`,
      this.mission,
      "Think independently. Do not merely agree with another advisor.",
      "Separate verified evidence from inference.",
      "Identify the strongest counterargument to your own conclusion.",
      "Identify any missing information that could materially affect confidence.",
      "Identify concrete conditions that would actually reverse or materially change your recommendation.",
      "Do not overstate confidence.",
      "Keep the analysis decision-oriented and useful to an executive.",
      ...this.roleInstructions(),
      ...schemaInstruction
    ].join("\n");

    const body = {
      model: this.model,
      store: false,
      max_output_tokens: 3000,

      text: {
        format: {
          type: "json_object"
        }
      },

      instructions,

      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analyze the following case and return your answer as valid JSON only.\n\n" +
                JSON.stringify(
                  this.contextPayload(
                    assignment,
                    context
                  ),
                  null,
                  2
                )
            }
          ]
        }
      ]
    };

    body.reasoning = {
      effort: "minimal"
    };

    if (this.enableWebSearch) {
      body.tools = [
        {
          type: "web_search"
        }
      ];

      body.tool_choice = "auto";
    }

    return body;
  }

  async execute(assignment, context = {}) {
    if (!this.apiKey) {
      throw new Error(
        `${this.id}: OPENAI_API_KEY is not configured`
      );
    }

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      90000
    );

    try {
      const response = await this.fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          signal: controller.signal,

          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },

          body: JSON.stringify(
            this.buildRequest(
              assignment,
              context
            )
          )
        }
      );

      if (!response.ok) {
        const text = await response.text();

        throw new Error(
          `${this.id}: OpenAI Responses API error ${response.status}: ${text}`
        );
      }

      const data = await response.json();

      if (data.status === "incomplete") {
        throw new Error(
          `${this.id}: incomplete response: ${JSON.stringify(
            data.incomplete_details || {}
          )}`
        );
      }

      return this.parseResponse(
        data,
        assignment
      );

    } finally {
      clearTimeout(timeout);
    }
  }

  extractOutputText(data) {
    if (
      typeof data?.output_text === "string" &&
      data.output_text.trim()
    ) {
      return data.output_text.trim();
    }

    const texts = [];

    for (const item of data?.output || []) {
      if (item?.type !== "message") {
        continue;
      }

      for (const part of item.content || []) {
        if (
          part?.type === "output_text" &&
          typeof part.text === "string"
        ) {
          texts.push(part.text);
        }
      }
    }

    if (!texts.length) {
      throw new Error(
        `${this.id}: no output text returned`
      );
    }

    return texts.join("\n").trim();
  }

  parseResponse(data, assignment) {
    const text =
      this.extractOutputText(data);

    const cleanedText = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      throw new Error(
        `${this.id}: non-JSON output: ${text.slice(
          0,
          500
        )}`
      );
    }

    const confidence =
      Number(parsed.confidence);

    if (
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      throw new Error(
        `${this.id}: confidence must be between 0 and 1`
      );
    }

    return {
      advisor_id:
        assignment.advisor_id ||
        this.id,

      finding:
        String(parsed.finding || ""),

      recommendation:
        parsed.recommendation == null
          ? null
          : String(
              parsed.recommendation
            ),

      evidence:
        Array.isArray(parsed.evidence)
          ? parsed.evidence
          : [],

      counterarguments:
        Array.isArray(
          parsed.counterarguments
        )
          ? parsed.counterarguments
          : [],

      missing_information:
        Array.isArray(
          parsed.missing_information
        )
          ? parsed.missing_information
          : [],

      risks:
        Array.isArray(parsed.risks)
          ? parsed.risks
          : [],

      change_conditions:
        Array.isArray(
          parsed.change_conditions
        )
          ? parsed.change_conditions
          : [],

      confidence,

      source_count:
        Number(
          parsed.metadata?.source_count ||
            0
        ),

      metadata: {
        ...(parsed.metadata || {}),
        provider: "openai",
        model:
          data.model || this.model,
        response_id:
          data.id || null
      }
    };
  }
}


class ResearchAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "research",

      title:
        "Chief Research Officer",

      mission:
        "Find, verify, and synthesize reliable information using authoritative sources.",

      model:
        process.env
          .JAMES_RESEARCH_MODEL ||
        opts.model,

      enableWebSearch: false,

      ...opts
    });
  }

  roleInstructions() {
    return [
      "Use current external evidence when it is available in the supplied context.",
      "Prefer primary, official, and authoritative sources.",
      "Distinguish evidence from inference.",
      "In metadata include a sources array with title and URL when available, and source_count."
    ];
  }
}


class StrategyAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "strategy",

      title:
        "Chief Strategy Officer",

      mission:
        "Evaluate long-term implications, trade-offs, opportunity cost, strategic fit, and second-order effects.",

      model:
        process.env
          .JAMES_STRATEGY_MODEL ||
        opts.model,

      ...opts
    });
  }

  roleInstructions() {
    return [
      "Use research as evidence, not authority.",
      "Identify the strongest realistic alternative course of action.",
      "State strategic assumptions explicitly.",
      "Make change_conditions describe circumstances that would actually reverse the strategic recommendation.",
      "Do not use missing information as a substitute for change_conditions.",
      "In metadata include strategic_alternatives and key_assumptions."
    ];
  }
}


class FinanceAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "finance",

      title:
        "Chief Financial Officer",

      mission:
        "Evaluate financial impact, downside, upside, ROI, cash flow, affordability, and sensitivity to assumptions.",

      model:
        process.env
          .JAMES_FINANCE_MODEL ||
        opts.model,

      ...opts
    });
  }
}
 
    class LegalAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "legal",

      title:
        "General Counsel",

      mission:
        "Identify legal, contractual, regulatory, compliance, and liability risks and distinguish blockers from manageable risks.",

      model:
        process.env
          .JAMES_LEGAL_MODEL ||
        opts.model,

      ...opts
    });
  }

  roleInstructions() {
    return [
      "Do not present uncertain jurisdiction-specific legal conclusions as established fact.",
      "Flag when qualified human counsel is required.",
      "If a legal blocker drives the recommendation, state the specific remediation that would remove that blocker in change_conditions.",
      "Do not place ordinary legal due-diligence questions into change_conditions.",
      "Keep finding and recommendation concise: each must be no more than 120 words.",
      "In metadata include legal_summary, compliance_flags, and requires_human_counsel."
    ];
  }
}


class OperationsAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "operations",

      title:
        "Chief Operating Officer",

      mission:
        "Evaluate execution feasibility, bottlenecks, resources, timing, process, and operational risk.",

      model:
        process.env
          .JAMES_OPERATIONS_MODEL ||
        opts.model,

      ...opts
    });
  }

  roleInstructions() {
    return [
      "Translate conclusions into operational consequences.",
      "When execution feasibility drives the recommendation, state the concrete resource, timing, staffing, capacity, or process changes that would reverse it.",
      "Do not put ordinary information requests into change_conditions.",
      "In metadata include execution_plan, bottlenecks, kpis, and next_actions."
    ];
  }
}


class TechnologyAdvisor extends BaseOpenAIAdvisorAdapter {
  constructor(opts = {}) {
    super({
      id: "technology",

      title:
        "Chief Technology Officer",

      mission:
        "Evaluate architecture, scalability, security, implementation risk, technical debt, and technical feasibility.",

      model:
        process.env
          .JAMES_TECHNOLOGY_MODEL ||
        opts.model,

      ...opts
    });
  }

  roleInstructions() {
    return [
      "Distinguish known technical facts from assumptions.",
      "When technical feasibility or security drives the recommendation, state the concrete architecture, security, staffing, cost, or implementation changes that would reverse it.",
      "Do not put ordinary technical questions or missing facts into change_conditions.",
      "In metadata include architecture_review, security_concerns, technical_debt, and implementation_plan."
    ];
  }
}

  


function createOpenAIAdvisorCouncil(
  options = {}
) {
  const shared = {
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    model: options.model
  };

  return {
    research:
      new ResearchAdvisor(shared),

    strategy:
      new StrategyAdvisor(shared),

    finance:
      new FinanceAdvisor(shared),

    legal:
      new LegalAdvisor(shared),

    operations:
      new OperationsAdvisor(shared),

    technology:
      new TechnologyAdvisor(shared)
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
