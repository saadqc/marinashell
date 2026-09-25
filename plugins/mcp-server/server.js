const http = require("http");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} = require("@modelcontextprotocol/sdk/types.js");
function createHttpServer({ store, tools, onStop = () => {} }) {
  let server;
  let state = "stopped";
  let error = "";
  let serial = Promise.resolve();
  const inflight = new Set();
  const status = () => ({
    state,
    error,
    url: `http://127.0.0.1:${store.data.port}/mcp`,
    protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  });
  async function start() {
    if (server) return status();
    state = "starting";
    error = "";
    const port = store.data.port;
    const next = http.createServer(async (req, res) => {
      const reject = (code) => {
        res.writeHead(code, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        });
        res.end(http.STATUS_CODES[code]);
      };
      if (state !== "running") return reject(503);
      if (
        req.headers.host !== `127.0.0.1:${port}` ||
        (req.headers.origin &&
          req.headers.origin !== `http://127.0.0.1:${port}`)
      )
        return reject(403);
      if (req.url !== "/mcp") return reject(404);
      // Printable ASCII without spaces covers generated base64url tokens and
      // user-chosen fixed passwords alike; store.authenticate caps the length.
      const auth = /^Bearer ([!-~]{1,256})$/.exec(
        req.headers.authorization || "",
      );
      const client = auth && store.authenticate(auth[1]);
      if (!client) return reject(401);
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return reject(405);
      }
      if (
        !String(req.headers["content-type"] || "").startsWith(
          "application/json",
        )
      )
        return reject(415);
      if (inflight.size >= 8) return reject(429);
      const controller = new AbortController();
      inflight.add(controller);
      const timer = setTimeout(() => {
        controller.abort();
        if (!res.writableEnded) res.destroy();
      }, 60000);
      let mcp;
      res.on("close", () => {
        clearTimeout(timer);
        controller.abort();
        inflight.delete(controller);
        mcp?.close().catch(() => {});
      });
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) {
            reject(413);
            return;
          }
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return reject(400);
        }
        if (Array.isArray(body)) return reject(400);
        mcp = new Server(
          { name: "marinashell", version: "1.0.0" },
          { capabilities: { tools: {} } },
        );
        mcp.setRequestHandler(ListToolsRequestSchema, async () => {
          const current = store.authenticate(auth[1]);
          if (!current) throw new Error("AUTH_REQUIRED");
          return { tools: tools.list(current) };
        });
        mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
          try {
            const current = store.authenticate(auth[1]);
            if (!current) throw new Error("AUTH_REQUIRED");
            const result = await tools.execute(
              current.id,
              request.params.name,
              request.params.arguments || {},
              controller.signal,
            );
            if (result?.image)
              return {
                content: [
                  { type: "image", mimeType: "image/png", data: result.image },
                ],
              };
            if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024)
              throw new Error("Output exceeds 512 KB. Request a smaller page.");
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (e) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: { code: e.code || "FAILED", message: e.message },
                  }),
                },
              ],
            };
          }
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch {
        if (!res.headersSent) reject(500);
        else res.end();
      }
    });
    next.requestTimeout = 65000;
    next.headersTimeout = 10000;
    next.keepAliveTimeout = 1000;
    try {
      await new Promise((resolve, reject) => {
        next.once("error", reject);
        next.listen(port, "127.0.0.1", resolve);
      });
      server = next;
      state = "running";
      next.on("error", (e) => {
        error = e.code || "Server failed";
      });
    } catch (e) {
      next.close();
      state = "error";
      error =
        e.code === "EADDRINUSE"
          ? `Port ${port} is already in use. Choose another port.`
          : e.message;
    }
    return status();
  }
  async function stop() {
    state = "stopping";
    onStop();
    for (const controller of inflight) controller.abort();
    const previous = server;
    server = null;
    if (previous)
      await new Promise((resolve) => {
        previous.close(resolve);
        previous.closeAllConnections();
      });
    state = "stopped";
    return status();
  }
  const serialized = (operation) => {
    const result = serial.then(operation);
    serial = result.catch(() => {});
    return result;
  };
  return {
    status,
    start: () => serialized(start),
    stop: () => serialized(stop),
  };
}
module.exports = { createHttpServer };
