/**
 * TestApiClient — lightweight API helper for E2E test data setup/teardown.
 *
 * Uses raw fetch so E2E tests have zero build-time coupling to the web app.
 */

import "./env";
import pg from "pg";
import { randomInt } from "node:crypto";

// `||` (not `??`) so an empty `NEXT_PUBLIC_API_URL=` in .env still falls
// back to localhost. dotenv sets unset-vs-empty both as "" — treating them
// the same matches user intent.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://auro:auro@localhost:5432/auro?sslmode=disable";

interface TestWorkspace {
  id: string;
  name: string;
  slug: string;
}

export class TestApiClient {
  private token: string | null = null;
  private workspaceSlug: string | null = null;
  private workspaceId: string | null = null;
  private email: string | null = null;

  async login(email: string, name: string, password?: string) {
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      // Seed a verification fixture so E2E setup never sends external mail.
      const code = String(randomInt(100000, 1000000));
      await client.query("DELETE FROM verification_code WHERE email = $1", [email]);
      await client.query(
        "INSERT INTO verification_code (email, code, expires_at) VALUES ($1, $2, now() + interval '10 minutes')",
        [email, code],
      );

      // Exercise the real verification handler to obtain the session token.
      const verifyRes = await fetch(`${API_BASE}/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, ...(password !== undefined ? { password } : {}) }),
      });
      if (!verifyRes.ok) {
        throw new Error(`verify-code failed: ${verifyRes.status}`);
      }
      const data = await verifyRes.json();

      this.token = data.token;
      this.email = email;

      // Update user name if needed
      if (name && data.user?.name !== name) {
        await this.authedFetch("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
      }

      await client.query("DELETE FROM verification_code WHERE email = $1", [email]);

      return data;
    } finally {
      await client.end();
    }
  }

  async getWorkspaces(): Promise<TestWorkspace[]> {
    const res = await this.authedFetch("/api/workspaces");
    return res.json();
  }

  setWorkspaceId(id: string) {
    this.workspaceId = id;
  }

  setWorkspaceSlug(slug: string) {
    this.workspaceSlug = slug;
  }

  /** Create an explicit isolated workspace, even when this account already has one. */
  async createWorkspace(name: string, slug: string): Promise<TestWorkspace> {
    const res = await this.authedFetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    if (!res.ok) throw new Error(`create workspace failed: ${res.status} ${await res.text()}`);
    const workspace = await res.json() as TestWorkspace;
    this.workspaceId = workspace.id;
    this.workspaceSlug = workspace.slug;
    return workspace;
  }

  async ensureWorkspace(name = "E2E Workspace", slug = "e2e-workspace") {
    const workspaces = await this.getWorkspaces();
    const workspace = workspaces.find((item) => item.slug === slug) ?? workspaces[0];
    if (workspace) {
      this.workspaceId = workspace.id;
      this.workspaceSlug = workspace.slug;
      return workspace;
    }

    const res = await this.authedFetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    if (res.ok) {
      const created = (await res.json()) as TestWorkspace;
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      return created;
    }

    const refreshed = await this.getWorkspaces();
    const created = refreshed.find((item) => item.slug === slug) ?? refreshed[0];
    if (created) {
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      return created;
    }

    throw new Error(`Failed to ensure workspace ${slug}: ${res.status} ${res.statusText}`);
  }

  async markUserOnboarded() {
    if (!this.email) {
      throw new Error("Cannot mark E2E user onboarded before login");
    }

    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query(
        `
          UPDATE "user"
          SET
            onboarded_at = COALESCE(onboarded_at, now()),
            onboarding_questionnaire = COALESCE(onboarding_questionnaire, '{}'::jsonb)
              || '{"source":["friends_colleagues"],"source_other":null,"source_skipped":false}'::jsonb
          WHERE email = $1
        `,
        [this.email],
      );
      if (result.rowCount !== 1) {
        throw new Error(`Failed to mark E2E user onboarded: ${this.email}`);
      }
    } finally {
      await client.end();
    }
  }

  /** Adds an existing user to this client's workspace and returns the member id. */
  async addMemberByEmail(email: string, role: "admin" | "member" = "member"): Promise<string> {
    if (!this.workspaceId) throw new Error("Cannot add a member before a workspace is selected");
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query(
        `INSERT INTO member (workspace_id, user_id, role)
         SELECT $1, id, $3 FROM "user" WHERE email = $2
         RETURNING id`,
        [this.workspaceId, email, role],
      );
      if (result.rowCount !== 1) throw new Error(`No user with email ${email}`);
      return result.rows[0].id as string;
    } finally {
      await client.end();
    }
  }

  async removeMember(memberId: string) {
    const res = await this.authedFetch(`/api/workspaces/${this.workspaceId}/members/${memberId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`remove member failed: ${res.status} ${await res.text()}`);
    }
  }

  async siegeStatus(): Promise<{ mode: string; ready: boolean }> {
    const response = await this.authedFetch("/api/siege/status");
    if (!response.ok) throw new Error(`Siege status failed: ${response.status}`);
    return response.json();
  }

  async readSiegeSession(id: string) {
    const response = await this.authedFetch(`/api/siege/sessions/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Siege session failed: ${response.status}`);
    return response.json();
  }

  /** Deletes this client's workspace; only for workspaces a test created. */
  async deleteWorkspace() {
    if (!this.workspaceId) return;
    await this.authedFetch(`/api/workspaces/${this.workspaceId}`, { method: "DELETE" });
  }

  getToken() {
    return this.token;
  }

  getEmail() {
    if (!this.email) {
      throw new Error("Test API client is not logged in");
    }
    return this.email;
  }

  private async authedFetch(path: string, init?: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (this.workspaceSlug) headers["X-Workspace-Slug"] = this.workspaceSlug;
    else if (this.workspaceId) headers["X-Workspace-ID"] = this.workspaceId;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  }
}
