import crypto from "crypto";

const REGION = "us-east-1";
const SERVICE = "bedrock-agentcore";

const GATEWAY_URL =
  "https://james-search-gateway-yweql64lns.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp";

const TOOL_NAME =
  "target-quick-start-181a02___WebSearch";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, date) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function parseAwsResponse(text) {
  try {
    return JSON.parse(text);
  } catch {}

  const events = text
    .split("\n")
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trim());

  for (const event of events.reverse()) {
    try {
      return JSON.parse(event);
    } catch {}
  }

  return { raw: text };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    const accessKey = process.env.AWS_ACCESS_KEY_ID;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;

    if (!accessKey || !secretKey) {
      return res.status(500).json({
        ok: false,
        error: "AWS credentials are not configured"
      });
    }

    const question = String(req.body?.question || "").trim();

    if (!question) {
      return res.status(400).json({
        ok: false,
        error: "Missing question"
      });
    }

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "james-search",
      method: "tools/call",
      params: {
        name: TOOL_NAME,
        arguments: {
          query: question,
          maxResults: 10
        },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "James",
            version: "0.1.4"
          },
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      }
    });

    const url = new URL(GATEWAY_URL);

    const now = new Date();
    const amzDate = now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "");

    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(body);

    const headers = {
      "content-type": "application/json",
      "host": url.host,
      "mcp-method": "tools/call",
      "mcp-name": TOOL_NAME,
      "mcp-protocol-version": "2026-07-28",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    };

    if (sessionToken) {
      headers["x-amz-security-token"] = sessionToken;
    }

    const signedHeaderNames = Object.keys(headers)
      .sort()
      .join(";");

    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map(key => `${key}:${headers[key].trim()}\n`)
      .join("");

    const canonicalRequest = [
      "POST",
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaderNames,
      payloadHash
    ].join("\n");

    const credentialScope =
      `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256(canonicalRequest)
    ].join("\n");

    const signature = hmac(
      signingKey(secretKey, dateStamp),
      stringToSign,
      "hex"
    );

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        ...headers,
        Accept: "application/json, text/event-stream",
        Authorization: authorization
      },
      body
    });

    const text = await response.text();
    const data = parseAwsResponse(text);

    return res.status(response.ok ? 200 : response.status).json({
      ok: response.ok,
      provider: "aws-agentcore",
      data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "AWS search failed"
    });
  }
}
