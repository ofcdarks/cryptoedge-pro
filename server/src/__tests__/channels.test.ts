import { describe, it, expect } from "vitest";
import { testUser } from "./setup";

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  headers["Authorization"] = `Bearer ${testUser.token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  return { status: res.status, data: await res.json() };
}

describe("Channel Routes", () => {
  let channelId: number;

  it("POST /channels - creates channel", async () => {
    const { status, data } = await req("/channels", {
      method: "POST",
      body: JSON.stringify({ name: "Test Channel", color: "#EF4444" }),
    });
    expect(status).toBe(201);
    expect(data.name).toBe("Test Channel");
    expect(data.userId).toBe(testUser.id);
    channelId = data.id;
  });

  it("GET /channels - lists user channels", async () => {
    const { status, data } = await req("/channels");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].userId).toBe(testUser.id);
  });

  it("PUT /channels/:id - updates channel", async () => {
    const { status, data } = await req(`/channels/${channelId}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Updated Channel" }),
    });
    expect(status).toBe(200);
    expect(data.name).toBe("Updated Channel");
  });

  it("POST /channels - validates input", async () => {
    const { status } = await req("/channels", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    expect(status).toBe(400);
  });
});

describe("Video Routes", () => {
  let videoId: number;
  let channelId: number;

  it("setup - get channel", async () => {
    const { data } = await req("/channels");
    channelId = data[0].id;
  });

  it("POST /videos - creates video", async () => {
    const { status, data } = await req("/videos", {
      method: "POST",
      body: JSON.stringify({ title: "Test Video", channelId, priority: "alta" }),
    });
    expect(status).toBe(201);
    expect(data.title).toBe("Test Video");
    expect(data.userId).toBe(testUser.id);
    expect(data.status).toBe("idea");
    videoId = data.id;
  });

  it("GET /videos - lists user videos", async () => {
    const { data } = await req("/videos");
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((v: any) => v.id === videoId)).toBe(true);
  });

  it("PUT /videos/:id - updates status + triggers notification", async () => {
    const { status, data } = await req(`/videos/${videoId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "script" }),
    });
    expect(status).toBe(200);
    expect(data.status).toBe("script");

    // Check notification was created
    const { data: notifs } = await req("/notifications");
    expect(notifs.some((n: any) => n.message.includes("Roteiro"))).toBe(true);
  });

  it("PUT /videos/:id - validates priority", async () => {
    const { status } = await req(`/videos/${videoId}`, {
      method: "PUT",
      body: JSON.stringify({ priority: "invalid" }),
    });
    expect(status).toBe(400);
  });

  it("DELETE /videos/:id - deletes video", async () => {
    const { status } = await req(`/videos/${videoId}`, { method: "DELETE" });
    expect(status).toBe(200);
  });
});
