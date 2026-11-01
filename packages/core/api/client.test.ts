import { afterEach, describe, expect, it, vi } from "vitest";
import { configStore } from "../config";
import { ApiClient, ApiError, CHAT_DRAFT_RESTORE_CAPABILITY, clientErrorMessage } from "./client";
import { EMPTY_PLUGIN_PACKAGE_LIST, EMPTY_PLUGIN_PREVIEW, EMPTY_PLUGIN_SURFACE_LAUNCH } from "./schemas";

afterEach(() => {
  configStore.getState().setAgentConversationStartersSupported(false);
  vi.unstubAllGlobals();
});

describe("ApiClient agent conversation-starter compatibility", () => {
  const prompt = {
    label: "Review a PR",
    prompt: "Review the open pull request.",
  };

  it("rejects create writes before an older backend can drop them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test");

    await expect(
      client.createAgent({
        name: "Reviewer",
        runtime_id: "runtime-1",
        conversation_starters: [prompt],
      }),
    ).rejects.toThrow(/server version does not support agent conversation starters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects update writes before an older backend can drop them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test");

    await expect(
      client.updateAgent("agent-1", { conversation_starters: [prompt] }),
    ).rejects.toThrow(/server version does not support agent conversation starters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows declared-capability create and update writes through", async () => {
    configStore.getState().setAgentConversationStartersSupported(true);
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "agent-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.createAgent({
      name: "Reviewer",
      runtime_id: "runtime-1",
      conversation_starters: [prompt],
    });
    await client.updateAgent("agent-1", {
      conversation_starters: [prompt],
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "Reviewer",
      runtime_id: "runtime-1",
      conversation_starters: [prompt],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      conversation_starters: [prompt],
    });
  });
});

describe("ApiClient edit guards", () => {
});

describe("ApiClient Plugin preview response schema", () => {
  it("degrades a malformed preview so a blank scope list is never shown as approval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ scopes: "execution:read" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(new ApiClient("https://api.example.test").previewPlugin(
      "workspace-1",
      { version_id: "version-1" },
    )).resolves.toEqual(EMPTY_PLUGIN_PREVIEW);
  });

  // A malformed launch must not become a partly trusted frame URL.
  it("falls back to an empty surface launch when the response is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ url: 42, bridge_token: "proof" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(new ApiClient("https://api.example.test").getPluginSurfaceLaunch(
      "workspace-1",
      "installation-1",
      "hello",
    )).resolves.toEqual(EMPTY_PLUGIN_SURFACE_LAUNCH);
  });

  it("falls back to an empty package list when the response is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ packages: "nope" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(new ApiClient("https://api.example.test").listPluginPackages("workspace-1"))
      .resolves.toEqual(EMPTY_PLUGIN_PACKAGE_LIST);
  });
});

describe("ApiClient Plugin surface bridge routes", () => {
  it("relays Action API calls through the session-only bridge prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient("https://api.example.test").callPluginAction(
      "installation-1",
      { method: "GET", path: "/context", issueId: "MUL-42" },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/plugin-bridge/v1/context?issue_id=MUL-42",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        "X-Auro-Plugin-Installation": "installation-1",
      }),
    });
  });

  it("invokes UI hooks through the session-only bridge prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: "ok",
        hook_key: "summarize",
        trigger: "ui",
        latency_ms: 1,
        attempts: 1,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient("https://api.example.test").invokePluginHook(
      "installation-1",
      "summarize",
      { trigger: "ui", issueId: "issue-1" },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/plugin-bridge/v1/hooks/summarize",
    );
  });
});

describe("ApiClient workspace working agents", () => {
  it("supports an optional source-type filter", async () => {
    const payload = [
      {
        id: "agent-1",
        name: "Agent 1",
        avatar_url: null,
        running_task_count: 2,
        issue_ids: ["issue-1"],
      },
    ];
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(
      client.getWorkspaceWorkingAgents("issue", "assigned"),
    ).resolves.toEqual(payload);
    await expect(
      client.getWorkspaceWorkingAgents("issue"),
    ).resolves.toEqual(payload);
    await expect(client.getWorkspaceWorkingAgents()).resolves.toEqual(payload);
    await expect(
      client.getWorkspaceWorkingAgents("issue", undefined, "parent-1"),
    ).resolves.toEqual(payload);
    // The server rejects parent alongside scope, so a My Issues relation wins
    // and the parent is dropped rather than sent into a 400.
    await expect(
      client.getWorkspaceWorkingAgents("issue", "assigned", "parent-1"),
    ).resolves.toEqual(payload);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/api/working-agents?type=issue&scope=mine&relation=assigned",
      "https://api.example.test/api/working-agents?type=issue",
      "https://api.example.test/api/working-agents",
      "https://api.example.test/api/working-agents?type=issue&parent=parent-1",
      "https://api.example.test/api/working-agents?type=issue&scope=mine&relation=assigned",
    ]);
  });
});

describe("ApiClient label response schemas", () => {
});

describe("ApiClient agent builder runtime switch", () => {
  it("PATCHes the session runtime endpoint and returns the runtime the server bound", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ runtime_id: "runtime-b" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(
      client.switchAgentBuilderRuntime("session-1", { runtime_id: "runtime-b" }),
    ).resolves.toEqual({ runtime_id: "runtime-b" });

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain("/api/agent-builder/sessions/session-1/runtime");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(String(call[1].body))).toEqual({ runtime_id: "runtime-b" });
  });

  it("falls back to the requested runtime id for a malformed success body", async () => {
    // A 2xx means the rebind committed onto the runtime we asked for, so the
    // fallback must say so. Reporting "unknown" here would leave the picker on
    // the old runtime while the conversation executes on the new one — the very
    // split this endpoint exists to close.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ runtime_id: 42 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(
      client.switchAgentBuilderRuntime("session-1", { runtime_id: "runtime-b" }),
    ).resolves.toEqual({ runtime_id: "runtime-b" });
  });

  it("rejects without a fallback when the switch is refused", async () => {
    // 409 (a reply in flight) means nothing was committed, so the caller must
    // see a rejection and keep the old runtime selected.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "stop the current reply before switching runtime" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(
      client.switchAgentBuilderRuntime("session-1", { runtime_id: "runtime-b" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("ApiClient notification preferences", () => {
  it("sends atomic preference updates with PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          workspace_id: "workspace-1",
          preferences: {
            status_changes: "muted",
            comments: "muted",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(
      client.updateNotificationPreferences(
        { comments: "muted" },
        "workspace-one",
      ),
    ).resolves.toEqual({
      workspace_id: "workspace-1",
      preferences: {
        status_changes: "muted",
        comments: "muted",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/notification-preferences",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "X-Workspace-Slug": "workspace-one",
        }),
        body: JSON.stringify({ preferences: { comments: "muted" } }),
      }),
    );
  });

  it("falls back safely when a preference response is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ workspace_id: "workspace-1", preferences: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const client = new ApiClient("https://api.example.test");
    await expect(client.getNotificationPreferences()).resolves.toEqual({
      workspace_id: "",
      preferences: {},
    });
  });
});

describe("ApiClient Inbox response schemas", () => {
  const legacyRow = {
    id: "inbox-1",
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "member-1",
    type: "new_comment",
    severity: "info",
    issue_id: "issue-1",
    title: "Legacy Inbox row",
    body: null,
    read: false,
    archived: false,
    created_at: "2026-08-24T00:00:00Z",
  };
});

describe("ApiClient", () => {
  it("preserves HTTP status on failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "workspace slug already exists" }), {
          status: 409,
          statusText: "Conflict",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const client = new ApiClient("https://api.example.test");

    try {
      await client.createWorkspace({ name: "Test", slug: "test" });
      throw new Error("expected createWorkspace to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        message: "workspace slug already exists",
        status: 409,
        statusText: "Conflict",
      });
    }
  });

  it("keeps agent detail task history on the lightweight endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "task-1", status: "completed", created_at: "2026-08-27T03:00:00Z" },
          { id: "task-2", status: "completed", created_at: "2026-08-27T02:00:00Z" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    const { tasks, nextCursor } = await client.listAgentTasksPage("agent-1");

    expect(tasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(nextCursor).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/agents/agent-1/tasks?limit=200",
    );
  });

  it("reads a lossless task cursor and passes it to the next bounded request", async () => {
    const cursor = "2026-09-24T01:02:03.123456Z|00000000-0000-0000-0000-000000000001";
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify([{ id: "task-1", status: "completed" }]),
      { headers: { "X-Agent-Tasks-Next-Cursor": cursor } },
    )));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test");
    const page = await client.listAgentTasksPage("agent-1", { limit: 7 });
    expect(page.nextCursor).toBe(cursor);
    const controller = new AbortController();
    await client.listAgentTasksPage("agent-1", { limit: 7, before: page.nextCursor!, signal: controller.signal });
    const request = new URL(fetchMock.mock.calls[1]![0]);
    expect(request.searchParams.get("limit")).toBe("7");
    expect(request.searchParams.get("before")).toBe(cursor);
    expect(fetchMock.mock.calls[1]![1].signal).toBe(controller.signal);
  });

  it("drops the continuation when the task page is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ tasks: "not-an-array" }),
      { headers: { "X-Agent-Tasks-Next-Cursor": "cursor" } },
    )));
    const client = new ApiClient("https://api.example.test");
    await expect(client.listAgentTasksPage("agent-1")).resolves.toEqual({ tasks: [], nextCursor: null });
  });

  it("falls back to an empty agent task history for a malformed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tasks: "not-an-array" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(client.listAgentTasksPage("agent-1")).resolves.toEqual({ tasks: [], nextCursor: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("emits X-Client-* headers when identity is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test", {
      identity: { platform: "desktop", version: "1.2.3", os: "macos" },
    });
    await client.listWorkspaces();

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Client-Platform"]).toBe("desktop");
    expect(headers["X-Client-Version"]).toBe("1.2.3");
    expect(headers["X-Client-OS"]).toBe("macos");
  });

  it("omits X-Client-* headers when identity is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.listWorkspaces();

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Client-Platform"]).toBeUndefined();
    expect(headers["X-Client-Version"]).toBeUndefined();
    expect(headers["X-Client-OS"]).toBeUndefined();
  });

  it("posts feedback kind and parses the response through the schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "feedback-1", created_at: "2026-06-26T00:00:00Z" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    const response = await client.createFeedback({
      message: "Desktop route crashed",
      url: "app://desktop/acme/issues",
      workspace_id: "ws-1",
      kind: "bug",
      context: {
        kind: "desktop_route_error",
        trigger: "route-errorElement",
        error: {
          name: "TypeError",
          message: "Cannot read properties of undefined",
          stack: "TypeError: Cannot read properties of undefined",
        },
      },
    });

    expect(response).toEqual({
      id: "feedback-1",
      created_at: "2026-06-26T00:00:00Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          message: "Desktop route crashed",
          url: "app://desktop/acme/issues",
          workspace_id: "ws-1",
          kind: "bug",
          context: {
            kind: "desktop_route_error",
            trigger: "route-errorElement",
            error: {
              name: "TypeError",
              message: "Cannot read properties of undefined",
              stack: "TypeError: Cannot read properties of undefined",
            },
          },
        }),
      }),
    );
  });

  it("falls back to an empty feedback response when the server shape drifts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 42, created_at: "2026-06-26T00:00:00Z" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const client = new ApiClient("https://api.example.test");
    await expect(client.createFeedback({ message: "hello" })).resolves.toEqual({
      id: "",
      created_at: "",
    });
  });

  it("uses the Cloud Runtime node API contract", async () => {
    const node = {
      id: "node-1",
      owner_id: "user-1",
      instance_id: "i-0123456789abcdef0",
      region: "us-west-2",
      instance_type: "g5.xlarge",
      image_id: "ami-1",
      subnet_id: "subnet-1",
      name: "gpu-dev-01",
      status: "launching",
      tags: {},
      metadata: {},
      created_at: "2026-05-21T08:30:00Z",
      updated_at: "2026-05-21T08:30:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(node), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.listCloudRuntimeNodes({ limit: 20, offset: 5 });
    await client.createCloudRuntimeNode(
      { instance_type: "g5.xlarge", name: "gpu-dev-01" },
    );

    const listCall = fetchMock.mock.calls[0]!;
    const createCall = fetchMock.mock.calls[1]!;
    expect(listCall[0]).toBe(
      "https://api.example.test/api/cloud-runtime/nodes?limit=20&offset=5",
    );
    expect(createCall[0]).toBe(
      "https://api.example.test/api/cloud-runtime/nodes",
    );
    expect(createCall[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        instance_type: "g5.xlarge",
        name: "gpu-dev-01",
      }),
    });
  });

  it("falls back when Cloud Runtime node responses drift", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 123 }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 123 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await expect(client.listCloudRuntimeNodes()).resolves.toEqual([]);
    await expect(
      client.createCloudRuntimeNode({ instance_type: "g5.xlarge" }),
    ).resolves.toMatchObject({ id: "", status: "" });
  });

  it("deleteCloudRuntimeNode sends DELETE with JSON body containing instance id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.deleteCloudRuntimeNode("i-0123456789abcdef0");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/api/cloud-runtime/nodes");
    expect(opts).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ instance_id: "i-0123456789abcdef0" }),
    });
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  describe("getAttachment", () => {
    it("returns the parsed attachment for a well-formed response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              id: "att-1",
              workspace_id: "ws-1",
              issue_id: null,
              comment_id: null,
              uploader_type: "member",
              uploader_id: "u-1",
              filename: "report.md",
              url: "https://static.example.test/ws/att-1.md",
              download_url:
                "https://static.example.test/ws/att-1.md?Policy=p&Signature=s&Key-Pair-Id=k",
              content_type: "text/markdown",
              size_bytes: 123,
              created_at: "2026-05-11T00:00:00Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const att = await client.getAttachment("att-1");

      expect(att.id).toBe("att-1");
      expect(att.download_url).toContain("Policy=");
    });

    it("falls back to an empty attachment when the response is missing download_url", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ id: "att-1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const att = await client.getAttachment("att-1");

      // parseWithFallback returns the EMPTY_ATTACHMENT record so callers can
      // safely read `download_url` without crashing — they'll see "" and
      // surface a user-facing error instead of opening `undefined`.
      expect(att.id).toBe("");
      expect(att.download_url).toBe("");
    });
  });

  describe("getAttachmentTextContent", () => {
    it("returns body text and the original content type from the X-* header", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("# heading\n\nbody\n", {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Original-Content-Type": "text/markdown",
            },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const { text, originalContentType } =
        await client.getAttachmentTextContent("att-1");

      expect(text).toBe("# heading\n\nbody\n");
      expect(originalContentType).toBe("text/markdown");
    });

    it("throws PreviewTooLargeError on 413", async () => {
      const { PreviewTooLargeError } = await import("./client");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("", { status: 413, statusText: "Payload Too Large" }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      await expect(client.getAttachmentTextContent("att-1")).rejects.toBeInstanceOf(
        PreviewTooLargeError,
      );
    });

    it("throws PreviewUnsupportedError on 415", async () => {
      const { PreviewUnsupportedError } = await import("./client");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("", { status: 415, statusText: "Unsupported Media Type" }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      await expect(client.getAttachmentTextContent("att-1")).rejects.toBeInstanceOf(
        PreviewUnsupportedError,
      );
    });
  });

  describe("listChatMessagesPage deployment-order fallback", () => {
    const jsonResponse = (body: unknown, status: number, statusText = "") =>
      new Response(JSON.stringify(body), {
        status,
        statusText,
        headers: { "Content-Type": "application/json" },
      });

    it("falls back to the legacy full-list endpoint when the paged route 404s", async () => {
      const legacy = [
        {
          id: "m1",
          chat_session_id: "session-1",
          role: "user",
          content: "hi",
          task_id: null,
          created_at: "2026-06-01T00:00:00Z",
          quick_actions: [],
        },
        {
          id: "m2",
          chat_session_id: "session-1",
          role: "assistant",
          content: "yo",
          task_id: "task-1",
          created_at: "2026-06-01T00:00:01Z",
          quick_actions: [
            { label: "Continue", prompt: "Continue with the next step", primary: true },
          ],
        },
      ];
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404, "Not Found"))
        .mockResolvedValueOnce(jsonResponse(legacy, 200));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const page = await client.listChatMessagesPage("session-1", { limit: 50 });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://api.example.test/api/chat/sessions/session-1/messages/page?limit=50",
      );
      expect(fetchMock.mock.calls[1]![0]).toBe(
        "https://api.example.test/api/chat/sessions/session-1/messages",
      );
      expect(page).toEqual({ messages: legacy, limit: 50, has_more: false, next_cursor: null });
    });

    it("keeps a valid reply when its optional quick actions are malformed", async () => {
      const malformed = [{
        id: "m1",
        chat_session_id: "session-1",
        role: "assistant",
        content: "safe reply",
        task_id: "task-1",
        created_at: "2026-06-01T00:00:00Z",
        quick_actions: [{ label: 42, prompt: false }],
      }];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(malformed, 200)));

      const client = new ApiClient("https://api.example.test");
      await expect(client.listChatMessages("session-1")).resolves.toEqual([
        expect.objectContaining({ content: "safe reply", quick_actions: [] }),
      ]);
    });

    it("falls back to an empty page for a malformed paged response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ messages: "broken" }, 200)),
      );

      const client = new ApiClient("https://api.example.test");
      await expect(
        client.listChatMessagesPage("session-1", { limit: 25 }),
      ).resolves.toEqual({ messages: [], limit: 25, has_more: false, next_cursor: null });
    });

    it("does NOT fall back on a cursor request — a 404 there propagates", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "not found" }, 404, "Not Found"));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await expect(
        client.listChatMessagesPage("session-1", {
          before: { created_at: "2026-06-01T00:00:00Z", id: "m1" },
        }),
      ).rejects.toBeInstanceOf(ApiError);
      // Only the paged request fires; no legacy full-list call that would duplicate messages.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("propagates non-404 errors instead of masking them with the legacy list", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "boom" }, 500, "Internal Server Error"));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await expect(client.listChatMessagesPage("session-1")).rejects.toMatchObject({
        status: 500,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancelTaskById response parsing", () => {
    const taskResponse = {
      id: "task-1",
      agent_id: "agent-1",
      runtime_id: "runtime-1",
      issue_id: "",
      status: "cancelled",
      priority: 0,
      dispatched_at: null,
      started_at: null,
      completed_at: "2026-06-12T06:40:00Z",
      result: null,
      error: null,
      created_at: "2026-06-12T06:39:00Z",
    };

    it("parses the cancelled chat message payload", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          ...taskResponse,
          cancelled_chat_message: {
            chat_session_id: "session-1",
            message_id: "message-1",
            content: "restore me",
            restore_to_input: true,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const result = await client.cancelTaskById("task-1");

      expect(fetchMock.mock.calls[0]).toMatchObject([
        "https://api.example.test/api/tasks/task-1/cancel",
        { method: "POST" },
      ]);
      expect(result.cancelled_chat_message).toEqual({
        chat_session_id: "session-1",
        message_id: "message-1",
        content: "restore me",
        restore_to_input: true,
      });
    });

    it("parses task attribution when the backend enriches it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            ...taskResponse,
            attribution: {
              source: "direct_human",
              precise: true,
              initiator: { id: "user-1", name: "Ada", avatar_url: "https://x/a.png" },
              originator: { id: "user-1", name: "Ada" },
              evidence: { kind: "comment", ref_id: "comment-1" },
            },
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const result = await client.cancelTaskById("task-1");

      expect(result.attribution).toEqual({
        source: "direct_human",
        precise: true,
        initiator: { id: "user-1", name: "Ada", avatar_url: "https://x/a.png" },
        originator: { id: "user-1", name: "Ada" },
        evidence: { kind: "comment", ref_id: "comment-1" },
      });
    });

    it("leaves attribution absent on servers that predate it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(taskResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const result = await client.cancelTaskById("task-1");

      expect(result.attribution).toBeUndefined();
    });

    // The server only defers the empty-transcript judgment — and so only
    // withholds the synchronous restore — for clients that advertise this
    // capability (#5219). Drop the header and this client is treated as a
    // pre-#5219 build, quietly losing the deferred path it actually implements.
    it("advertises the durable draft-restore capability", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(taskResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await new ApiClient("https://api.example.test").cancelTaskById("task-1");

      const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
      expect(init.headers["X-Client-Capabilities"]).toBe(CHAT_DRAFT_RESTORE_CAPABILITY);
    });

    it("scopes queued edit cancellation to the expected chat session", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(taskResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await new ApiClient("https://api.example.test").cancelTaskById("task-1", {
        queuedAction: "edit",
        sessionId: "session-1",
      });

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.example.test/api/tasks/task-1/cancel" +
          "?expected_status=queued&chat_session_id=session-1&queue_action=edit",
      );
    });

    it("treats a null cancelled chat message as absent", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            ...taskResponse,
            cancelled_chat_message: null,
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const result = await client.cancelTaskById("task-1");

      expect(result.id).toBe("task-1");
      expect(result.cancelled_chat_message).toBeUndefined();
    });

    it.each([
      ["a missing task id", { ...taskResponse, id: undefined }],
      [
        "a malformed cancelled chat message",
        {
          ...taskResponse,
          cancelled_chat_message: {
            chat_session_id: "session-1",
            message_id: "message-1",
            content: "restore me",
            restore_to_input: "true",
          },
        },
      ],
      ["a null body", null],
    ])("falls back for %s", async (_label, body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const result = await client.cancelTaskById("task-1");

      expect(result.id).toBe("");
      expect(result.cancelled_chat_message).toBeUndefined();
    });
  });

  it("clears a chat queue with one session-scoped request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient("https://api.example.test").clearQueuedChatTasks("session-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/chat/sessions/session-1/queued-tasks",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  describe("chat attachment wiring", () => {
    it("uploadFile includes chat_session_id in the FormData body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "att-1", url: "https://cdn/x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const file = new File(["hi"], "hi.png", { type: "image/png" });
      await client.uploadFile(file, { chatSessionId: "session-123" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.example.test/api/upload-file");
      expect(init?.method).toBe("POST");
      const body = init?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get("chat_session_id")).toBe("session-123");
      expect(body.get("issue_id")).toBeNull();
      expect(body.get("comment_id")).toBeNull();
    });

    it("threads an AbortSignal into fetch so the coordinator can cancel it (MUL-5181)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "att-1", url: "https://cdn/x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const controller = new AbortController();
      const file = new File(["hi"], "hi.png", { type: "image/png" });
      await client.uploadFile(file, { issueId: "issue-1" }, controller.signal);

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init?.signal).toBe(controller.signal);
    });

    it("rejects with the fetch AbortError when the signal is already aborted", async () => {
      const fetchMock = vi.fn().mockImplementation((_url, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          return Promise.reject(err);
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const controller = new AbortController();
      controller.abort();
      const file = new File(["hi"], "hi.png", { type: "image/png" });

      await expect(
        client.uploadFile(file, undefined, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("sendChatMessage serialises attachment_ids onto the JSON body when present", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message_id: "m1", task_id: "t1", created_at: "2026-08-01T00:00:00Z" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await client.sendChatMessage("session-1", "hello", ["att-1", "att-2"]);

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init?.body as string)).toEqual({
        content: "hello",
        attachment_ids: ["att-1", "att-2"],
      });
    });

    it("sendChatMessage omits attachment_ids when the list is empty or undefined", async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message_id: "m1", task_id: "t1", created_at: "2026-08-01T00:00:00Z" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await client.sendChatMessage("session-1", "hello");
      await client.sendChatMessage("session-1", "again", []);

      expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ content: "hello" });
      expect(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string)).toEqual({ content: "again" });
    });

    it("sendChatMessage accepts the server's null attachment_ids for text-only sends", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            message_id: "m1",
            task_id: "t1",
            created_at: "2026-08-01T00:00:00Z",
            attachment_ids: null,
          }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await expect(
        new ApiClient("https://api.example.test").sendChatMessage("session-1", "hello"),
      ).resolves.toMatchObject({ attachment_ids: undefined });
    });

    it("sendChatMessage rejects a malformed response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ message_id: "m1", task_id: 42 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await expect(
        new ApiClient("https://api.example.test").sendChatMessage("session-1", "hello"),
      ).rejects.toThrow();
    });
  });
});

// The onboarding flow acts on a workspace the app has not navigated to, so
// these calls pass the slug explicitly. The server reads X-Workspace-Slug
// before ?workspace_id, so the header — not the param — is what has to carry
// the target workspace.
describe("ApiClient explicit workspace targeting", () => {
  function stubOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function slugHeaderOf(fetchMock: ReturnType<typeof vi.fn>): unknown {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    return (init.headers as Record<string, string>)["X-Workspace-Slug"];
  }

  it("sends the given slug on Mika creation", async () => {
    const fetchMock = stubOk({ id: "agent-1" });
    await new ApiClient("https://api.example.test").createMikaAgent(
      { runtime_id: "runtime-1", language: "en" },
      "proxima-centauri",
    );
    expect(slugHeaderOf(fetchMock)).toBe("proxima-centauri");
  });

  it("sends the given slug when listing another workspace's runtimes", async () => {
    const fetchMock = stubOk([]);
    await new ApiClient("https://api.example.test").listRuntimes(
      { workspace_id: "ws-2", owner: "me" },
      "proxima-centauri",
    );
    expect(slugHeaderOf(fetchMock)).toBe("proxima-centauri");
  });

  it("omits the header when no slug is given, leaving the ambient one", async () => {
    const fetchMock = stubOk([]);
    await new ApiClient("https://api.example.test").listRuntimes({
      workspace_id: "ws-2",
    });
    expect(slugHeaderOf(fetchMock)).toBeUndefined();
  });
});

describe("ApiClient model discovery response schema", () => {
  const completed = {
    id: "req-1",
    runtime_id: "rt-1",
    status: "completed",
    supported: true,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:01Z",
    models: [{ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }],
  };

  function stubJSON(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  }

  it("parses a live completed discovery", async () => {
    stubJSON(completed);

    const result = await new ApiClient("https://api.example.test")
      .initiateListModels("rt-1");

    expect(result).toMatchObject({
      status: "completed",
      supported: true,
      models: [{ id: "claude-sonnet-4-6" }],
    });
  });

  it("keeps the cache markers on a server-cached snapshot", async () => {
    stubJSON({ ...completed, cached: true, cached_at: "2026-07-29T00:00:00Z" });

    const result = await new ApiClient("https://api.example.test")
      .initiateListModels("rt-1");

    expect(result.cached).toBe(true);
    expect(result.cached_at).toBe("2026-07-29T00:00:00Z");
  });

  it("requests a live model list when force refresh is selected", async () => {
    stubJSON(completed);

    await new ApiClient("https://api.example.test").initiateListModels("rt-1", {
      force: true,
    });

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/runtimes/rt-1/models?force=true",
    );
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  // The picker drives a state machine off `status`, so a malformed body must
  // become an explicit failure — not a fabricated empty catalog, and not an
  // endless "discovering models" spinner.
  it("degrades a malformed initiate response to an explicit failure", async () => {
    stubJSON({ status: 7, models: "nope" });

    const result = await new ApiClient("https://api.example.test")
      .initiateListModels("rt-1");

    expect(result.status).toBe("failed");
    expect(result.supported).toBe(true);
    expect(result.error).toBe("invalid model discovery response");
    expect(result.runtime_id).toBe("rt-1");
  });

  it("degrades a malformed poll response to an explicit failure", async () => {
    stubJSON("not-an-object");

    const result = await new ApiClient("https://api.example.test")
      .getListModelsResult("rt-1", "req-9");

    expect(result.status).toBe("failed");
    expect(result.id).toBe("req-9");
    expect(result.runtime_id).toBe("rt-1");
  });

  it("stays usable against a backend that omits supported", async () => {
    const { supported: _omitted, ...withoutSupported } = completed;
    stubJSON(withoutSupported);

    const result = await new ApiClient("https://api.example.test")
      .getListModelsResult("rt-1", "req-1");

    expect(result.supported).toBe(true);
    expect(result.status).toBe("completed");
  });
});

describe("ApiClient startMikaOnboarding", () => {
  it("returns the opening a well-formed response reports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            started: true,
            message_id: "message-1",
            created_at: "2026-01-01T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      new ApiClient("https://api.example.test").startMikaOnboarding("session-1", {
        language: "en",
      }),
    ).resolves.toEqual({
      started: true,
      message_id: "message-1",
      created_at: "2026-01-01T00:00:00Z",
    });
  });

  it("falls back to started=false when the response is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ started: "yes" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    // started=false is the safe reading: the flow treats it as "someone else
    // already opened this conversation" and navigates, rather than acting on a
    // body it could not understand.
    await expect(
      new ApiClient("https://api.example.test").startMikaOnboarding("session-1", {
        language: "en",
      }),
    ).resolves.toEqual({ started: false });
  });

  it("tolerates a backend that omits the optional opening fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ started: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      new ApiClient("https://api.example.test").startMikaOnboarding("session-1", {
        language: "en",
      }),
    ).resolves.toEqual({ started: false });
  });
});

describe("ApiClient refreshSkill response schema", () => {
  const validSkill = {
    id: "skill-1",
    workspace_id: "ws-1",
    name: "review-helper",
    description: "refreshed",
    content: "# refreshed",
    config: { origin: { type: "github", source_url: "https://github.com/acme/skills" } },
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    files: [
      {
        id: "file-1",
        skill_id: "skill-1",
        path: "ref.md",
        content: "ref",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ],
  };

  it("parses a valid refreshed skill", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(validSkill), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await new ApiClient("https://api.example.test").refreshSkill("skill-1");
    expect(result).toMatchObject({
      id: "skill-1",
      name: "review-helper",
      files: [{ path: "ref.md" }],
    });
  });

  it("falls back to the empty skill when the response is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ skill: 42 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await new ApiClient("https://api.example.test").refreshSkill("skill-1");
    expect(result).toMatchObject({ id: "", name: "", files: [] });
  });

  it("defaults optional fields the server may omit", async () => {
    const { description, content, files, ...minimal } = validSkill;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(minimal), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await new ApiClient("https://api.example.test").refreshSkill("skill-1");
    expect(result).toMatchObject({
      id: "skill-1",
      description: "",
      content: "",
      files: [],
    });
  });
});

describe("ApiClient workspace MCP servers", () => {
  function stubJSON(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const server = {
    id: "srv-1",
    workspace_id: "ws-1",
    name: "linear",
    transport: "http",
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
  };

  it("parses the workspace library", async () => {
    stubJSON([server]);

    const result = await new ApiClient("https://api.example.test")
      .listWorkspaceMcpServers("ws-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "srv-1", name: "linear", transport: "http" });
    // No binding in the library listing, so no toggle to report.
    expect(result[0]?.enabled).toBeUndefined();
  });

  it("falls back safely when the library response is malformed", async () => {
    stubJSON({ nope: true });

    const result = await new ApiClient("https://api.example.test")
      .listWorkspaceMcpServers("ws-1");

    expect(result).toEqual([]);
  });

  // The write-only boundary is enforced on the client too: a server that
  // regressed to returning the stored entry must not have it land in the
  // parsed object or the query cache.
  it("strips secret-bearing fields the server should never have sent", async () => {
    stubJSON([{
      ...server,
      config: { headers: { Authorization: "Bearer sk-live-doc" } },
      url: "https://mcp.example/sk-live-url",
      headers: { Authorization: "Bearer sk-live-header" },
    }]);

    const result = await new ApiClient("https://api.example.test")
      .listWorkspaceMcpServers("ws-1");

    expect(JSON.stringify(result)).not.toContain("sk-live");
    expect(result[0]).toEqual(server);
  });

  it("keeps an unknown transport rather than dropping the server", async () => {
    // Enum drift from a newer backend must degrade, not disappear: the row
    // still renders and the UI's default branch labels it.
    stubJSON([{ ...server, transport: "websocket" }]);

    const result = await new ApiClient("https://api.example.test")
      .listWorkspaceMcpServers("ws-1");

    expect(result).toHaveLength(1);
    expect(result[0]?.transport).toBe("websocket");
  });

  it("keeps the agent count and degrades a malformed one to unknown", async () => {
    stubJSON([
      { ...server, id: "srv-1", agent_count: 3 },
      { ...server, id: "srv-2", agent_count: "many" },
      { ...server, id: "srv-3" },
    ]);

    const result = await new ApiClient("https://api.example.test")
      .listWorkspaceMcpServers("ws-1");

    expect(result.map((item) => item.agent_count)).toEqual([3, undefined, undefined]);
  });

  it("POSTs a name and entry when creating a library server", async () => {
    const fetchMock = stubJSON(server);

    await new ApiClient("https://api.example.test")
      .createWorkspaceMcpServer("ws-1", "linear", { url: "https://mcp.example" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/workspaces/ws-1/mcp-servers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "linear",
      config: { url: "https://mcp.example" },
    });
  });

  it("sends only what changed when updating a library server", async () => {
    const fetchMock = stubJSON(server);

    await new ApiClient("https://api.example.test")
      .updateWorkspaceMcpServer("ws-1", "srv-1", { name: "linear-v2" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/workspaces/ws-1/mcp-servers/srv-1");
    expect(init.method).toBe("PUT");
    // A rename must not blank the stored entry.
    expect(JSON.parse(String(init.body))).toEqual({ name: "linear-v2" });
  });

  it("assigns and un-assigns a server on the agent routes", async () => {
    const assigned = [{ ...server, enabled: true }];
    let fetchMock = stubJSON(assigned);

    const added = await new ApiClient("https://api.example.test")
      .addAgentMcpServer("agent-1", "srv-1");
    expect(added[0]?.enabled).toBe(true);
    let [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/agents/agent-1/mcp-servers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ server_id: "srv-1" });

    fetchMock = stubJSON([{ ...server, enabled: false }]);
    const toggled = await new ApiClient("https://api.example.test")
      .setAgentMcpServerEnabled("agent-1", "srv-1", false);
    expect(toggled[0]?.enabled).toBe(false);
    [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/agents/agent-1/mcp-servers/srv-1/enabled");
    expect(init.method).toBe("PUT");

    fetchMock = stubJSON([]);
    await new ApiClient("https://api.example.test").removeAgentMcpServer("agent-1", "srv-1");
    [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/agents/agent-1/mcp-servers/srv-1");
    expect(init.method).toBe("DELETE");
  });
});

describe("importSkillArchive", () => {
  it("POSTs multipart form data without a JSON content-type", async () => {
    const skill = {
      id: "skill-1",
      workspace_id: "ws-1",
      name: "review-helper",
      description: "Reviews code",
      content: "# Review",
      config: {},
      files: [],
      created_by: "user-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "created", skill }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pk"], "review-helper.skill", { type: "application/zip" });
    const result = await new ApiClient("https://api.example.test").importSkillArchive(
      file,
      "fail",
    );

    expect(result.id).toBe("skill-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/api/skills/import");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("on_conflict")).toBe("fail");
    const uploaded = body.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe("review-helper.skill");
  });

  it("falls back to Import failed when the archive envelope is malformed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ not_a_status: true, skill: 42 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pk"], "review-helper.skill");
    await expect(
      new ApiClient("https://api.example.test").importSkillArchive(file),
    ).rejects.toThrow(/import failed/i);
  });

  it("keeps the server reason for a status this client does not know", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: "quarantined", reason: "pending review" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pk"], "review-helper.skill");
    await expect(
      new ApiClient("https://api.example.test").importSkillArchive(file),
    ).rejects.toThrow("pending review");
  });

  it("throws the structured reason on a name conflict", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "conflict",
          reason: "a skill with this name already exists",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pk"], "review-helper.skill");
    await expect(
      new ApiClient("https://api.example.test").importSkillArchive(file),
    ).rejects.toMatchObject({
      message: "a skill with this name already exists",
      status: 409,
    });
  });
});

describe("clientErrorMessage", () => {
  it("returns a 4xx message, which handlers write for the user", () => {
    expect(clientErrorMessage(new ApiError("autopilot is not active", 400, "Bad Request")))
      .toBe("autopilot is not active");
    expect(clientErrorMessage(new ApiError("forbidden", 403, "Forbidden"))).toBe("forbidden");
  });

  it("withholds a 5xx message, which carries internal server detail", () => {
    // MUL-6472: the pre-fix body for a failed autopilot trigger looked like
    // this, and it was rendered verbatim in the run-now toast.
    const leaky = new ApiError(
      'failed to trigger autopilot: create run: ERROR: duplicate key value violates unique constraint "autopilot_run_pkey" (SQLSTATE 23505)',
      500,
      "Internal Server Error",
    );
    expect(clientErrorMessage(leaky)).toBeUndefined();
    expect(clientErrorMessage(new ApiError("internal error", 503, "Service Unavailable"))).toBeUndefined();
  });

  it("withholds a transport failure, whose message says nothing actionable", () => {
    expect(clientErrorMessage(new TypeError("Failed to fetch"))).toBeUndefined();
    expect(clientErrorMessage(undefined)).toBeUndefined();
  });
});

describe("ApiClient sliding session renewal", () => {
  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("validates the refresh response and falls back to 'not renewed'", async () => {
    // A malformed body must never be read as a renewal: acting on it would
    // hand `undefined` to the code that persists the token.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ renewed: "yes" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ApiClient("https://api.example.test").refreshSession();

    expect(result.renewed).toBe(false);
    expect(result.token).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/api/auth/refresh");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("returns the renewed token for a bearer client", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          token: "token-v2",
          expires_at: "2026-10-16T00:00:00Z",
          renewed: true,
          check_again_in_seconds: 259200,
        }),
      ),
    );

    const result = await new ApiClient("https://api.example.test").refreshSession();

    expect(result).toMatchObject({
      token: "token-v2",
      renewed: true,
      check_again_in_seconds: 259200,
    });
  });

  // The one case where a session renewal can invalidate a CSRF token another
  // tab is already holding: the first renewal of a session that predates the
  // session-bound binding. The cookie has already been replaced by then, so
  // re-reading it and sending again is enough (MUL-7436).
  it("retries once when a CSRF token turns out to be stale", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "CSRF validation failed" }, 403))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(client.markOnboardingComplete()).resolves.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 403 that is a real authorization failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(client.markOnboardingComplete()).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after one retry rather than looping", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "CSRF validation failed" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await expect(client.markOnboardingComplete()).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// This file runs in the node environment, so `document` is stubbed rather
// than relying on jsdom — readCookie only ever reads `document.cookie`, and a
// stub keeps these tests next to the rest of the client's coverage.
// This file runs in the node environment, so `document` is stubbed rather
// than relying on jsdom — readCookie only ever reads `document.cookie`, and a
// stub keeps these tests next to the rest of the client's coverage.
describe("ApiClient CSRF headers", () => {
  function stubCookies(cookie: string) {
    vi.stubGlobal("document", { cookie });
  }

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function capturedHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
    return (fetchMock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
  }

  // One header name, deliberately. A second one would have to be in the
  // server's CORS allowlist, and a rolled-back server allowlists only the
  // names it shipped with — the preflight would fail and no retry could help.
  it("sends exactly one CSRF header, preferring the session-bound value", async () => {
    stubCookies("auro_csrf=token-bound; auro_csrf_session=session-bound");
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient("https://api.example.test").markOnboardingComplete();

    const headers = capturedHeaders(fetchMock);
    expect(headers["X-CSRF-Token"]).toBe("session-bound");
    expect(headers["X-CSRF-Session"]).toBeUndefined();
  });

  // A session that predates the session-bound cookie, and every request after
  // a rollback, has only the token-bound value to offer.
  it("falls back to the token-bound value when no session cookie exists", async () => {
    stubCookies("auro_csrf=token-bound");
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient("https://api.example.test").markOnboardingComplete();

    expect(capturedHeaders(fetchMock)["X-CSRF-Token"]).toBe("token-bound");
  });

  it("sends no CSRF header when there is no cookie to echo", async () => {
    stubCookies("");
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient("https://api.example.test").markOnboardingComplete();

    expect(capturedHeaders(fetchMock)["X-CSRF-Token"]).toBeUndefined();
  });

  // The rollback path end to end: a server running the previous release
  // cannot verify the session-bound value, and the client has to discover that
  // and switch — otherwise the user is authenticated for reads and rejected
  // for every write.
  it("retries with the token-bound value when the server rejects the session-bound one", async () => {
    stubCookies("auro_csrf=token-bound; auro_csrf_session=session-bound");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "CSRF validation failed" }, 403))
      // A factory, not a fixed value: a Response body can only be read once,
      // so a shared instance breaks on the second call.
      .mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.markOnboardingComplete();

    expect(capturedHeaders(fetchMock, 0)["X-CSRF-Token"]).toBe("session-bound");
    expect(capturedHeaders(fetchMock, 1)["X-CSRF-Token"]).toBe("token-bound");
  });

  // ...and it stays switched, so a rolled-back server does not cost two
  // requests per write for the rest of the session.
  it("keeps using the token-bound value while the rejected cookie is current", async () => {
    stubCookies("auro_csrf=token-bound; auro_csrf_session=session-bound");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "CSRF validation failed" }, 403))
      // A factory, not a fixed value: a Response body can only be read once,
      // so a shared instance breaks on the second call.
      .mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.markOnboardingComplete();
    await client.markOnboardingComplete();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(capturedHeaders(fetchMock, 2)["X-CSRF-Token"]).toBe("token-bound");
  });

  // But only while it is current. A renewal or a new login replaces the
  // session cookie, and the preferred binding is worth trying again — keying
  // on the value rather than a boolean is what stops this oscillating once
  // per renewal against a server that understands it perfectly well.
  it("prefers the session-bound value again once the cookie changes", async () => {
    stubCookies("auro_csrf=token-bound; auro_csrf_session=session-bound");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "CSRF validation failed" }, 403))
      // A factory, not a fixed value: a Response body can only be read once,
      // so a shared instance breaks on the second call.
      .mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.markOnboardingComplete();

    stubCookies("auro_csrf=token-bound-2; auro_csrf_session=session-bound-2");
    await client.markOnboardingComplete();

    expect(capturedHeaders(fetchMock, 2)["X-CSRF-Token"]).toBe("session-bound-2");
  });
});

// Desktop runs one ApiClient per window over one shared localStorage. Before
// MUL-7436 each instance cached the bearer token, so a session renewed in one
// window left every other window sending the credential it happened to be
// holding — until that one expired and took the whole session down with it,
// clearing tabs and drafts on the way (MUL-7028).
describe("ApiClient shared credential across windows", () => {
  function sharedStorage(initial: string | null) {
    let token = initial;
    return {
      read: () => token,
      write: (next: string | null) => {
        token = next;
      },
    };
  }

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function authHeaderOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
    const headers = (fetchMock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
    return headers["Authorization"];
  }

  it("reads the current token per request, so a renewal in one window reaches the others", async () => {
    const storage = sharedStorage("token-v1");
    const windowA = new ApiClient("https://api.example.test", { getToken: storage.read });
    const windowB = new ApiClient("https://api.example.test", { getToken: storage.read });

    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await windowB.markOnboardingComplete();
    expect(authHeaderOf(fetchMock, 0)).toBe("Bearer token-v1");

    // Window A renews; only shared storage is updated, exactly as the renewal
    // controller does it.
    storage.write("token-v2");
    windowA.setToken("token-v2");

    await windowB.markOnboardingComplete();
    expect(authHeaderOf(fetchMock, 1)).toBe("Bearer token-v2");
  });

  // The other half: a request that went out with the previous credential can
  // 401 AFTER the renewal landed. Ending the session on that would tear down
  // one that is demonstrably alive.
  it("ignores a 401 for a credential that has since been replaced", async () => {
    const storage = sharedStorage("token-v1");
    const onUnauthorized = vi.fn();
    const client = new ApiClient("https://api.example.test", {
      getToken: storage.read,
      onUnauthorized,
    });

    const fetchMock = vi.fn().mockImplementation(async () => {
      // The renewal lands while this request is in flight.
      storage.write("token-v2");
      return jsonResponse({ error: "invalid token" }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.markOnboardingComplete()).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  // ...but a genuine expiry still ends the session: nothing replaced the
  // credential, so the 401 is about the one still in use.
  it("still ends the session on a 401 for the credential in use", async () => {
    const storage = sharedStorage("token-v1");
    const onUnauthorized = vi.fn();
    const client = new ApiClient("https://api.example.test", {
      getToken: storage.read,
      onUnauthorized,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => jsonResponse({ error: "invalid token" }, 401)),
    );

    await expect(client.markOnboardingComplete()).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  // Cookie mode has no bearer token to compare, so the guard must not swallow
  // its expiries.
  it("ends the session on a 401 in cookie mode", async () => {
    const onUnauthorized = vi.fn();
    const client = new ApiClient("https://api.example.test", { onUnauthorized });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => jsonResponse({ error: "invalid token" }, 401)),
    );

    await expect(client.markOnboardingComplete()).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
