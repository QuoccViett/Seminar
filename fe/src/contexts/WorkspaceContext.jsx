import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";

const DraftContext = createContext(null);

/** Giữ nháp trong RAM cho một danh tính đã xác thực, không lưu cây tiêu chí hay quyền
 * Đổi người dùng hoặc đổi credential sẽ tạo kho mới, đóng trang có nháp được cảnh báo
 * Không lưu nội dung nghiệp vụ vào localStorage để phiên khác không đọc lại dữ liệu
 */
function DraftScope({ children }) {
  const store = useRef(new Map());
  useEffect(() => {
    const warn = (event) => {
      if ([...store.current.values()].some((value) => Object.keys(value ?? {}).length)) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return <DraftContext.Provider value={store.current}>{children}</DraftContext.Provider>;
}

/** Tách kho nháp theo user và mốc đổi mật khẩu từ backend, user null luôn xóa phạm vi cũ */
export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const clear = () => setRevision((value) => value + 1);
    window.addEventListener("workspace:clear", clear);
    return () => window.removeEventListener("workspace:clear", clear);
  }, []);
  return <DraftScope key={`${user?.id ?? "anonymous"}:${user?.mustChangePassword ?? ""}:${revision}`} >{children}</DraftScope>;
}

/** Thay useState cho nội dung chưa lưu, key gồm loại nghiệp vụ và UUID hồ sơ
 * Chỉ kết quả ghi thành công mới được caller xóa nháp, phản hồi lỗi giữ nguyên dữ liệu
 * Khi render ngoài provider trong test độc lập vẫn hoạt động như state cục bộ
 */
export function useRecordDrafts(key) {
  const store = useContext(DraftContext);
  const [value, setValue] = useState(() => store?.get(key) ?? {});
  const update = useCallback((next) => {
    setValue((current) => {
      const result = typeof next === "function" ? next(current) : next;
      if (Object.keys(result).length) store?.set(key, result); else store?.delete(key);
      return result;
    });
  }, [key, store]);
  return [value, update];
}
