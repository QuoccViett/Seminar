import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export const PERIOD_KEY = "selectedPeriodId";

/** Đồng bộ lựa chọn giao diện giữa dashboard, hồ sơ và báo cáo, URL ưu tiên bộ nhớ phiên
 * Giá trị này không phải quyền truy cập, caller phải đối chiếu danh sách kỳ từ API
 * Khi đổi kỳ chủ động loại evaluationId để tránh mở nhầm hồ sơ của kỳ trước
 */
export function usePeriodSelection() {
  const [search, setSearch] = useSearchParams();
  const [periodId, setValue] = useState(() => search.get("periodId") || sessionStorage.getItem(PERIOD_KEY) || undefined);
  useEffect(() => {
    const linked = search.get("periodId");
    if (linked) { setValue(linked); sessionStorage.setItem(PERIOD_KEY, linked); }
  }, [search]);
  const select = useCallback((next) => {
    setValue(next);
    if (next) sessionStorage.setItem(PERIOD_KEY, next); else sessionStorage.removeItem(PERIOD_KEY);
    setSearch((current) => {
      const updated = new URLSearchParams(current);
      if (updated.get("periodId") !== next) updated.delete("evaluationId");
      if (next) updated.set("periodId", next); else updated.delete("periodId");
      return updated;
    }, { replace: true });
  }, [setSearch]);
  return [periodId, select];
}
