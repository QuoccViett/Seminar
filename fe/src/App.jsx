import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import AppRoutes from "./routes";
import { App as AntdApp } from "antd";
import { ConfigProvider } from "antd";
import { appTheme } from "./theme";
import viVN from "antd/locale/vi_VN";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import ErrorBoundary from "./components/common/ErrorBoundary";

// Hộp xác nhận và toast qua API tĩnh dùng cùng theme với các trang
ConfigProvider.config({ holderRender: (children) => <ConfigProvider locale={viVN} theme={appTheme}>{children}</ConfigProvider> });

/** Dùng locale tiếng Việt toàn ứng dụng và kho nháp chỉ tồn tại trong phiên xác thực */
export default function App() {
  return (
    <BrowserRouter>
      <ConfigProvider locale={viVN} theme={appTheme}><AntdApp>
        <AuthProvider>
          <WorkspaceProvider><ErrorBoundary><AppRoutes /></ErrorBoundary></WorkspaceProvider>
        </AuthProvider>
      </AntdApp></ConfigProvider>
    </BrowserRouter>
    
  );
}
