/** Màu giao diện dùng chung; màu xếp loại vẫn lấy từ cấu hình từng kỳ */
export const palette = {
  primary: "#3563A9", primaryHover: "#2C528E", background: "#F3F5F7", surface: "#FFFFFF",
  section: "#EAF0F7", selected: "#D8E5F5", tableHeader: "#C3D4EE", border: "#D5DCE5",
  text: "#253247", muted: "#64748B", neutral: "#F1F3F5",
  success: "#2F7D50", successBg: "#EAF5EE", warning: "#9A6700", warningBg: "#FFF4DA",
  error: "#B33D3D", errorBg: "#FCEDEC",
};

export const appTheme = {
  token: {
    colorPrimary: palette.primary, colorPrimaryHover: palette.primaryHover, colorPrimaryActive: palette.primaryHover,
    colorInfo: palette.primary, colorInfoBg: palette.section, colorInfoBorder: palette.selected,
    colorSuccess: palette.success, colorSuccessBg: palette.successBg, colorSuccessBorder: "#C5DECE",
    colorWarning: palette.warning, colorWarningBg: palette.warningBg, colorWarningBorder: "#EAD9AA",
    colorError: palette.error, colorErrorBg: palette.errorBg, colorErrorBorder: "#EAC8C8",
    colorBgLayout: palette.background, colorBgContainer: palette.surface,
    colorText: palette.text, colorTextSecondary: palette.muted, colorTextDescription: palette.muted,
    colorBorder: palette.border, colorBorderSecondary: palette.border, borderRadius: 8,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 15, fontSizeSM: 13, fontSizeLG: 17,
    fontSizeHeading1: 39, fontSizeHeading2: 31, fontSizeHeading3: 25, fontSizeHeading4: 21, fontSizeHeading5: 17,
  },
  components: {
    Card: { headerBg: palette.section },
    Table: { headerBg: palette.tableHeader, headerColor: palette.text, borderColor: palette.border, rowHoverBg: palette.section },
    Menu: { itemSelectedBg: palette.selected, itemSelectedColor: palette.primary, itemHoverBg: palette.section, itemColor: palette.text },
    Button: { defaultColor: palette.text, defaultBg: palette.surface, defaultBorderColor: palette.border },
    Tag: { defaultBg: palette.neutral, defaultColor: palette.muted },
  },
};
