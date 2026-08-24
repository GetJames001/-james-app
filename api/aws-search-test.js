import crypto from "crypto";

const REGION = "us-east-1";
const SERVICE = "bedrock-agentcore";
const GATEWAY_URL =
  "https://james-search-gateway-yweql64lns.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp";

const TOOL_NAME = "target-quick-start-181a02___WebSearch";
const PROTOCOL_VERSION = "2026-07-28";

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmac(Buffer.from("AWS4" + secretKey, "utf8"), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { question } = req.body || {};

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const accessKey = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

    if (!accessKey || !secretKey) {
      return res.status(500).json({
        error: "AWS credentials are missing in Vercel"
      });
    }

    const url = new URL(GATEWAY_URL);
    const host = url.host;

    const now = new Date();
    const amzDate = now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "");

    const dateStamp = amzDate.slice(0, 8);

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "james-search",
      method: "tools/call",
      params: {
        name: TOOL_NAME,
        arguments: {
          query: question,
          maxResults: 5
        },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": {
            name: "James",
            version: "0.1.0"
          },
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      }
    });

    const payloadHash = sha256(body);

    const canonicalHeaders =
      `accept:application/json, text/event-stream\n` +
      `content-type:application/json\n` +
      `host:${host}\n` +
      `mcp-method:tools/call\n` +
      `mcp-name:${TOOL_NAME}\n` +
      `mcp-protocol-version:${PROTOCOL_VERSION}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;

    const signedHeaders =
      "accept;content-type;host;mcp-method;mcp-name;mcp-protocol-version;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      "POST",
      "/mcp",
      "",
      canonicalHeaders,
      signedHeaders,
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

    const signingKey = getSignatureKey(
      secretKey,
      dateStamp,
      REGION,
      SERVICE
    );

    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(stringToSign, "utf8")
      .digest("hex");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Host: host,
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": TOOL_NAME,
        "X-Amz-Content-Sha256": payloadHash,
        "X-Amz-Date": amzDate,
        Authorization: authorization
      },
      body
    });

    const text = await response.text();

    return res.status(response.status).json({
      ok: response.ok,
      provider: "aws-agentcore",
      status: response.status,
      data: text
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
