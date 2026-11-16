import { BadRequestException, ValidationPipe, type PipeTransform, type ValidationError } from "@nestjs/common";
import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate } from "class-validator";
import { ERROR_CODES } from "../constants/error-codes.js";

type Detail = { field: string; messages: string[] };

/** Duyệt cây lỗi class-validator để giữ đường dẫn trường và chỉ số mảng ổn định
 * Các câu mặc định tiếng Anh và trường lạ được thay bằng thông báo tiếng Việt cố định
 * Không đưa value hoặc target vào phản hồi vì có thể chứa mật khẩu hoặc token
 */
function flattenErrors(errors: ValidationError[], parent = ""): Detail[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const messages = Object.entries(error.constraints ?? {}).map(([key, message]) =>
      key === "whitelistValidation" ? "Trường này không được phép."
        : /[À-ỹ]/u.test(message) ? message : "Giá trị của trường không hợp lệ.");
    return [...(messages.length ? [{ field, messages }] : []), ...flattenErrors(error.children ?? [], field)];
  });
}

/** Tạo pipe dùng chung cho DTO, từ chối trường lạ và trả lỗi theo contract
 * Dữ liệu được chuyển kiểu theo DTO, lỗi lồng nhau vẫn giữ nguyên vị trí trường
 */
export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) => new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Dữ liệu gửi lên không hợp lệ.",
      details: flattenErrors(errors),
    }),
  });
}

/** Kiểm tra từng phần tử của body mảng vì metadata TypeScript chỉ cho biết kiểu Array
 * Giữ nguyên contract body mảng và thêm chỉ số vào đường dẫn lỗi của từng DTO
 * Từ chối đầu vào không phải mảng và trường lạ, không lưu lại dữ liệu nhạy cảm
 */
export class ApiArrayValidationPipe<T extends object> implements PipeTransform {
  constructor(private readonly itemType: ClassConstructor<T>) {}

  async transform(value: unknown): Promise<T[]> {
    if (!Array.isArray(value)) throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR, message: "Dữ liệu gửi lên phải là mảng.", details: [],
    });
    const items: T[] = [];
    const details: Detail[] = [];
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        details.push({ field: String(index), messages: ["Phần tử phải là đối tượng."] });
        continue;
      }
      const instance = plainToInstance(this.itemType, item);
      details.push(...flattenErrors(await validate(instance, { whitelist: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } }), String(index)));
      items.push(instance);
    }
    if (details.length) throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR, message: "Dữ liệu gửi lên không hợp lệ.", details,
    });
    return items;
  }
}
