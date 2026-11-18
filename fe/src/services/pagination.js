/** Tải toàn bộ lựa chọn qua các trang thật, mỗi request vẫn giữ giới hạn 100 của contract
 * Dừng ở trang rỗng hoặc đủ tổng để dữ liệu thiếu total trong test/dev không gây vòng lặp vô hạn
 * Lỗi một trang được chuyển lên caller, không trình bày danh sách bị cắt như đã tải đầy đủ
 */
export async function allPages(loader, params = {}) {
  const items = [];
  for (let page = 1; ; page++) {
    const result = await loader({ ...params, page, pageSize: 100 });
    items.push(...result.items);
    if (!Number.isFinite(result.total) || items.length >= result.total || !result.items.length) return items;
  }
}
