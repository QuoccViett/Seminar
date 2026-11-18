import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import * as CFB from "cfb";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { checkFile, checkMetadata, safeExternalUrl } from "./file-policy.js";
import { StorageProvider } from "./storage.provider.js";
import { EvidencesService } from "./evidences.service.js";

/** Tạo OOXML tối thiểu cho kiểm chữ ký, không dùng fixture hỏng để giả báo thành công Word
 * macro và kích thước central directory được thay có chủ đích ở các nhánh từ chối
 */
async function wordZip(macro = false): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" /></Types>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body /></w:document>');
  if (macro) zip.file("word/vbaProject.bin", "Nội dung macro không được phép");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Kiểm file giả, MIME sai, Word đúng cấu trúc và macro/ZIP không phải Word
 * Các assertion chạy validator thật, không fake thư viện phân tích tệp
 */
test("policy kiểm MIME, extension, chữ ký PDF/DOC/DOCX và giới hạn giải nén", async () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
  await checkFile(pdf, "Báo cáo.pdf", "application/pdf", pdf.length);
  await assert.rejects(checkFile(Buffer.from("<html>Tệp giả</html>"), "Báo cáo.pdf", "application/pdf", 22));
  await assert.rejects(checkFile(pdf, "Báo cáo.pdf", "application/pdf", pdf.length + 1));
  for (const name of ["../Báo cáo.pdf", "C:\\Báo cáo.pdf", "tệp.svg", "tệp.pdf\n"]) assert.throws(() => checkMetadata(name, "application/pdf"));
  assert.throws(() => checkMetadata("tệp.pdf", "image/png"));
  const docx = await wordZip();
  await checkFile(docx, "Báo cáo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx.length);
  const macro = await wordZip(true);
  await assert.rejects(checkFile(macro, "Báo cáo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", macro.length));
  const archive = CFB.utils.cfb_new(); const word = Buffer.alloc(64); word.writeUInt16LE(0xa5ec);
  CFB.utils.cfb_add(archive, "WordDocument", word);
  CFB.utils.cfb_add(archive, "0Table", Buffer.alloc(32));
  const doc = Buffer.from(CFB.write(archive, { type: "buffer" }));
  await checkFile(doc, "Báo cáo.doc", "application/msword", doc.length);
  await assert.rejects(checkFile(docx, "Báo cáo.doc", "application/msword", docx.length));
  const bomb = Buffer.from(docx); const central = bomb.indexOf(Buffer.from("504b0102", "hex")); bomb.writeUInt32LE(50 * 1024 * 1024, central + 24);
  await assert.rejects(checkFile(bomb, "Báo cáo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bomb.length));
});

/** Link không được thực thi hoặc tự fetch, giao thức lạ/userinfo/ký tự điều khiển đều bị chặn */
test("policy link giữ HTTP/HTTPS và từ chối địa chỉ không an toàn", () => {
  assert.equal(safeExternalUrl("https://example.org/minh-chung"), "https://example.org/minh-chung");
  for (const link of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://user:pass@example.org", "https://example.org/\n", "không phải địa chỉ"]) assert.throws(() => safeExternalUrl(link));
});

/** Kiểm kho local bằng filesystem thật, object không có là null và xóa lặp không lỗi
 * Thư mục thử riêng trong temp được xóa sau test, key traversal không thể vượt root
 */
test("StorageProvider local private lưu/đọc/xóa bytes và chặn key tùy ý", async () => {
  const root = await mkdtemp(join(tmpdir(), "vc10-storage-"));
  const provider = new StorageProvider(new ConfigService({ STORAGE_ENABLED: true, STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: root }));
  const key = `pending/${randomUUID()}/${randomUUID()}`;
  try {
    assert.equal(await provider.get(key), null);
    await provider.put(key, Buffer.from("Minh chứng thật"), "application/pdf");
    assert.equal((await provider.get(key))?.toString(), "Minh chứng thật");
    await provider.remove(key); await provider.remove(key);
    await assert.rejects(provider.get("../../tệp-khác"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

/** Fake chỉ REST provider ngoài để kiểm ACL và contract Supabase mà không cần secret thật
 * Bucket public phải dừng trước upload; DELETE dùng prefixes và không phản chiếu lỗi provider
 */
test("StorageProvider Supabase chặn bucket public và dùng đúng request riêng tư", async (context) => {
  const calls: { url: string; method: string; body: unknown }[] = []; let publicBucket = true;
  context.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    calls.push({ url: input, method: init.method ?? "GET", body: init.body });
    return input.includes("/bucket/") ? new Response(JSON.stringify({ public: publicBucket }), { status: 200 }) : new Response("", { status: 200 });
  });
  const provider = new StorageProvider(new ConfigService({ STORAGE_ENABLED: true, STORAGE_PROVIDER: "supabase", STORAGE_BUCKET: "evidences", SUPABASE_URL: "https://storage.example.org", SUPABASE_KEY: "secret-fixture-only" }));
  const key = `pending/${randomUUID()}/${randomUUID()}`;
  await assert.rejects(provider.put(key, Buffer.from("Tệp"), "application/pdf"));
  assert.equal(calls.length, 1);
  publicBucket = false;
  await provider.put(key, Buffer.from("Tệp"), "application/pdf");
  await provider.remove(key);
  assert.equal(calls.at(-1)?.method, "DELETE");
  assert.equal(calls.at(-1)?.url, "https://storage.example.org/storage/v1/object/evidences");
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.body)), { prefixes: [key] });
});

/** Kiểm capability có chữ ký thật khi giờ DB nhỉnh hơn giờ ứng dụng một giây
 * TTL đã được issuer ký nên không so trần TTL với đồng hồ thứ hai, nhưng hết hạn và dùng chéo operation vẫn bị chặn
 * Dependency DB không được gọi trong unit này, HTTP/PG kiểm quyền và expiry phiên độc lập
 */
test("URL ký không lỗi vì lệch giờ DB nhỏ và vẫn chặn hết hạn/dùng chéo", () => {
  const secret = "vc10-unit-secret-at-least-32-characters";
  const service = new EvidencesService({} as never, {} as never, {} as never, {} as never, new ConfigService({ JWT_SECRET: secret }));
  const id = randomUUID();
  /** Tạo chữ ký theo giao ước công khai để kiểm verifier thay vì gọi private issuer của implementation */
  const signed = (operation: string, expiry: number) => `${expiry}.${createHmac("sha256", secret).update(`vc10:${operation}:${id}:${expiry}`).digest("base64url")}`;
  assert.doesNotThrow(() => service.verifyToken("upload", id, signed("upload", Date.now() + 301000)));
  assert.throws(() => service.verifyToken("upload", id, signed("upload", Date.now() - 1)));
  assert.throws(() => service.verifyToken("download", id, signed("upload", Date.now() + 120000)));
  assert.throws(() => service.verifyToken("upload", id, "chuỗi không hợp lệ"));
  const valid = signed("upload", Date.now() + 120000);
  assert.throws(() => service.verifyToken("upload", id, `${valid.slice(0, -1)}ấ`), (error: unknown) => (error as { getStatus(): number }).getStatus() === 403);
  assert.throws(() => service.verifyToken("upload", id, [valid, valid] as never), (error: unknown) => (error as { getStatus(): number }).getStatus() === 403);
});
