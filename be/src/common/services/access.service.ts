import { Injectable, NotFoundException } from "@nestjs/common";
import { ERROR_CODES } from "../constants/error-codes.js";
import { PrismaService } from "../../prisma/prisma.service.js";

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kiểm tra quyền xem hồ sơ theo vai trò và đơn vị trước khi truy vấn
   * Mã sai, vai trò lạ hoặc UNIT thiếu đơn vị đều trả 404 để không lộ sự tồn tại
   * Chỉ ADMIN hợp lệ mới được tìm không giới hạn đơn vị, kết quả thành công không có dữ liệu
   */
  async assertEvaluationAccess(evaluationId: string, role: string, unitId: string | null): Promise<void> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const reject = () => new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Không tìm thấy hồ sơ" });
    if (!uuid.test(evaluationId) || (role !== "ADMIN" && role !== "UNIT") ||
        (role === "UNIT" && (!unitId || !uuid.test(unitId)))) throw reject();
    const where = role === "UNIT" ? { id: evaluationId, unitId: unitId! } : { id: evaluationId };
    const evaluation = await this.prisma.evaluation.findFirst({ where, select: { id: true } });
    if (!evaluation) throw reject();
  }
}
