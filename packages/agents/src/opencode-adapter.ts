import { hash } from "../../assets/src/hash";
import type { WorkspaceAgentPort, AgentMessage } from "./port";
import type { AgentEvent } from "../../contracts/src/types";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
} from "../../runtime-policy/src/index";
export class OpenCodeAdapter implements WorkspaceAgentPort {
  constructor(
    public url = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096",
    public directory?: string,
    private connection?: () => Promise<string>,
  ) {}
  private async connect() {
    if (this.connection) this.url = await this.connection();
  }
  private endpoint() {
    const url = new URL(this.url);
    if (url.username || url.password)
      throw new Error("OpenCode URL 不能内嵌凭据；请使用服务认证环境变量");
    if (url.search || url.hash)
      throw new Error("OpenCode 服务地址不能包含查询参数或片段");
    assertEndpointAllowed(url, "opencode");
    return url;
  }
  private requestURL(path: string) {
    const base = this.endpoint();
    base.pathname = base.pathname.replace(/\/?$/, "/");
    return new URL(path.replace(/^\/+/, ""), base);
  }
  private async request(
    path: string,
    body?: any,
    method?: string,
    signal?: AbortSignal,
  ) {
    await this.connect();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.OPENCODE_SERVER_PASSWORD)
      headers.Authorization =
        "Basic " +
        Buffer.from(
          (process.env.OPENCODE_SERVER_USERNAME ?? "opencode") +
            ":" +
            process.env.OPENCODE_SERVER_PASSWORD,
        ).toString("base64");
    const requestUrl = this.requestURL(path);
    if (this.directory && !path.startsWith("/global/"))
      requestUrl.searchParams.set("directory", this.directory);
    const policy = readRuntimePolicy();
    assertEndpointAllowed(requestUrl, "opencode", policy);
    const response = await fetch(requestUrl, {
      ...(policy.profile === "internal" ? { redirect: "error" as const } : {}),
      method: method ?? (body ? "POST" : "GET"),
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // Project metadata may cold-start Skill/MCP; global health stays fail-fast.
      signal:
        signal ??
        (path.endsWith("/command")
          ? undefined
          : AbortSignal.timeout(
              body ? 120000 : path.startsWith("/global/") ? 4000 : 20000,
            )),
    });
    if (!response.ok) throw new Error("OpenCode HTTP " + response.status);
    return response.json();
  }
  async health() {
    try {
      const h = await this.request("/global/health");
      return {
        ready: h.healthy === true,
        version: h.version,
        url: this.endpoint().href.replace(/\/$/, ""),
      };
    } catch (e) {
      return {
        ready: false,
        version: null,
        url: (() => {
          try {
            return new URL(this.url).origin;
          } catch {
            return "invalid";
          }
        })(),
        message: (e as Error).message,
      };
    }
  }
  async createSession(options?: { title?: string }) {
    const s = await this.request("/session", {
      title: options?.title ?? "可靠性设计评估",
    });
    return { sessionId: s.id };
  }
  async reloadProject() {
    if (!this.directory) throw new Error("刷新配置必须指定任务目录");
    return this.request("/instance/dispose", {});
  }
  async webInfo() {
    await this.connect();
    const url = this.endpoint();
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("官方界面嵌入仅支持本地 OpenCode 回环服务");
    const [health, path, sessions] = await Promise.all([
      this.health(),
      this.request("/path"),
      this.request("/session"),
    ]);
    const base = url.href.replace(/\/$/, "");
    return {
      ...health,
      url: base,
      directory: this.directory ?? path.directory,
      projectUrl:
        base +
        "/" +
        Buffer.from(this.directory ?? path.directory).toString("base64url") +
        "/session",
      sessions: sessions
        .filter((s: any) => s.directory === (this.directory ?? path.directory))
        .map((s: any) => ({
          id: s.id,
          title: s.title,
          updatedAt: s.time?.updated,
          url:
            base +
            "/" +
            Buffer.from(this.directory ?? path.directory).toString(
              "base64url",
            ) +
            "/session/" +
            s.id,
        })),
    };
  }
  async addContext(id: string, context: unknown) {
    return this.request("/session/" + encodeURIComponent(id) + "/message", {
      noReply: true,
      parts: [
        {
          type: "text",
          text:
            "ReMAP 任务摘要（完整设计请调用 reliability.task_current 与 design_get 读取；尚未调用模型）。使用 /sd-dfr-remap 开始工作流。\n" +
            JSON.stringify(context, null, 2),
        },
      ],
    });
  }
  async messages(id: string): Promise<AgentMessage[]> {
    const list = await this.request(
      "/session/" + encodeURIComponent(id) + "/message",
    );
    return list.map((m: any) => ({
      id: m.info.id,
      role: m.info.role,
      parts: m.parts
        .filter((p: any) => ["text", "tool"].includes(p.type))
        .map((p: any) => ({
          id: p.id,
          type: p.type,
          text: p.text,
          toolName: p.tool,
          status: p.state?.status,
          details: p.state,
        })),
    }));
  }
  async sendMessage(id: string, text: string) {
    return this.request("/session/" + encodeURIComponent(id) + "/message", {
      parts: [{ type: "text", text }],
      ...this.model(),
    });
  }
  async runCommand(id: string, args = "", signal?: AbortSignal) {
    return this.request(
      "/session/" + encodeURIComponent(id) + "/command",
      {
        command: "sd-dfr-remap",
        arguments: args,
        ...(this.modelName() ? { model: this.modelName() } : {}),
      },
      undefined,
      signal,
    );
  }
  private model() {
    const value = this.modelName();
    if (!value) return {};
    const slash = value.indexOf("/");
    if (slash < 1) throw new Error("OPENCODE_MODEL 格式应为 provider/model");
    return {
      model: {
        providerID: value.slice(0, slash),
        modelID: value.slice(slash + 1),
      },
    };
  }
  private modelName() {
    const policy = readRuntimePolicy();
    return policy.profile === "internal"
      ? `${policy.provider!.id}/${policy.provider!.defaultModel}`
      : process.env.OPENCODE_MODEL;
  }
  async abort(id: string) {
    return this.request("/session/" + encodeURIComponent(id) + "/abort", {});
  }
  async metadata() {
    const [commands, tools] = await Promise.all([
      this.request("/command"),
      this.request("/mcp"),
    ]);
    return { commands, tools };
  }
  async providers() {
    const data = await this.request("/provider");
    return {
      connected: data.connected ?? [],
      providers: (data.all ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        models: Object.values(p.models ?? {}).map((m: any) => ({
          id: m.id,
          name: m.name,
        })),
      })),
    };
  }
  async pending(id: string) {
    const [questions, permissions] = await Promise.all([
      this.request("/question"),
      this.request("/permission"),
    ]);
    return {
      questions: questions.filter((q: any) => q.sessionID === id),
      permissions: permissions.filter((p: any) => p.sessionID === id),
    };
  }
  async reply(kind: string, id: string, body: any) {
    if (!["question", "permission"].includes(kind))
      throw new Error("未知交互类型");
    return this.request(
      "/" + kind + "/" + encodeURIComponent(id) + "/reply",
      body,
    );
  }
  async *events(
    sessionId: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    await this.connect();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (process.env.OPENCODE_SERVER_PASSWORD)
      headers.Authorization =
        "Basic " +
        Buffer.from(
          (process.env.OPENCODE_SERVER_USERNAME ?? "opencode") +
            ":" +
            process.env.OPENCODE_SERVER_PASSWORD,
        ).toString("base64");
    const eventUrl = this.requestURL("/event");
    if (this.directory) eventUrl.searchParams.set("directory", this.directory);
    const policy = readRuntimePolicy();
    assertEndpointAllowed(eventUrl, "opencode", policy);
    const response = await fetch(eventUrl, {
      headers,
      signal,
      ...(policy.profile === "internal" ? { redirect: "error" as const } : {}),
    });
    if (!response.ok || !response.body)
      throw new Error("OpenCode 事件流未连接");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder
          .decode(chunk.value, { stream: true })
          .replace(/\r\n/g, "\n");
        let pos;
        while ((pos = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, pos);
          buffer = buffer.slice(pos + 2);
          const data = block
            .split("\n")
            .filter((x) => x.startsWith("data:"))
            .map((x) => x.slice(5).trim())
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          const props = event.properties ?? {};
          const sid =
            props.sessionID ?? props.part?.sessionID ?? props.info?.sessionID;
          if (sid !== sessionId || props.part?.type === "reasoning") continue;
          let kind: AgentEvent["kind"] = "message";
          if (event.type.startsWith("permission.")) kind = "permission";
          else if (event.type.startsWith("question.")) kind = "question";
          else if (event.type === "session.error") kind = "error";
          else if (event.type === "session.idle") kind = "idle";
          else if (props.part?.type === "tool") kind = "tool";
          yield {
            sessionId,
            eventId: hash(event),
            kind,
            payload: { sourceType: event.type, ...props },
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
