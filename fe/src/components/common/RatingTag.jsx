import { Tag } from "antd";

/** Giữ kiểu màu Tag gốc theo cấu hình kỳ, đồng bộ nền nhạt và viền với UNIT */
export default function RatingTag({ color, children }) {
  return <Tag color={color ?? "default"} style={{ border: "1px solid", borderColor: "color-mix(in srgb, currentColor 55%, white)" }}>{children}</Tag>;
}
