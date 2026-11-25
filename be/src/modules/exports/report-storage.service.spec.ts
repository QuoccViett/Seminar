import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ReportStorageService } from "./report-storage.service.js";

const folder = "11111111-1111-4111-8111-111111111111";
const key = `${folder}/22222222-2222-4222-8222-222222222222-summary-all-units-2026.xlsx`;
const config = () => new ConfigService({ REPORT_EXPORT_PROVIDER: "supabase", SUPABASE_URL: "https://storage.example.invalid", SUPABASE_KEY: "secret-fixture", STORAGE_BUCKET: "evidences" });

test("báo cáo Supabase giữ bytes qua instance mới và xóa idempotent", async () => {
  const original = globalThis.fetch;
  const objects = new Map<string, Uint8Array>();
  let publicBucket = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer secret-fixture");
    if (url.includes("/bucket/")) return Response.json({ public: publicBucket });
    assert.ok(url.includes("/object/evidences"));
    if (init?.method === "POST") { objects.set(url, init.body as Uint8Array); return Response.json({}); }
    if (init?.method === "DELETE") {
      const body = JSON.parse(String(init.body)) as { prefixes: string[] };
      assert.deepEqual(body.prefixes, [`reports/${key}`]);
      objects.delete(`https://storage.example.invalid/storage/v1/object/evidences/reports/${key}`);
      return Response.json({});
    }
    const value = objects.get(url);
    return value ? new Response(new Uint8Array(value)) : Response.json({ statusCode: "404" }, { status: 400 });
  }) as typeof fetch;
  try {
    const first = new ReportStorageService(config());
    const bytes = Buffer.from("PK-report-bytes");
    await first.put(key, bytes);
    const afterRestart = new ReportStorageService(config());
    assert.deepEqual(await afterRestart.get(key), bytes);
    publicBucket = true;
    await assert.rejects(afterRestart.get(key), /Kho báo cáo chưa sẵn sàng/);
    await assert.rejects(afterRestart.put(key, bytes), /Kho báo cáo chưa sẵn sàng/);
    publicBucket = false;
    await afterRestart.remove(key);
    await afterRestart.remove(key);
    await assert.rejects(afterRestart.get(key), /Không tìm thấy tệp báo cáo/);
    await assert.rejects(afterRestart.get("../private.txt"), /Không tìm thấy tệp báo cáo/);
  } finally { globalThis.fetch = original; }
});

test("dọn Supabase chỉ xóa báo cáo cũ không được DB tham chiếu", async () => {
  const original = globalThis.fetch;
  const old = "2026-01-01T00:00:00Z";
  const referenced = key.replace("22222222", "33333333");
  const removed: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/bucket/")) return Response.json({ public: false });
    const body = JSON.parse(String(init?.body)) as { prefix: string; prefixes: string[] };
    if (url.includes("/object/list/")) {
      if (body.prefix === "reports") return Response.json([{ name: folder, id: null }, { name: "unrelated", id: null }]);
      return Response.json([
        { name: key.split("/")[1], id: "orphan", updated_at: old },
        { name: referenced.split("/")[1], id: "keep", updated_at: old },
        { name: "unrelated.txt", id: "unrelated", updated_at: old },
      ]);
    }
    removed.push(...body.prefixes);
    return Response.json({});
  }) as typeof fetch;
  try {
    const service = new ReportStorageService(config());
    assert.equal(await service.cleanup(async candidate => candidate === referenced, new Date("2026-11-26T00:00:00Z")), 1);
    assert.deepEqual(removed, [`reports/${key}`]);
  } finally { globalThis.fetch = original; }
});
