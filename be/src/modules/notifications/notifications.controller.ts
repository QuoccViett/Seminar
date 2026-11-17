import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser, type CurrentUser } from "../../common/decorators/current-user.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { NotificationQueryDto } from "./dto/notification-query.dto.js";
import { NotificationPreferencesDto } from "./dto/notification-preferences.dto.js";
import { TestNotificationDto } from "./dto/test-notification.dto.js";
import { NotificationsService } from "./notifications.service.js";

/** Mọi tuyến dùng danh tính từ guard, không chấp nhận userId do trình duyệt cung cấp
 * Guard cũng buộc tài khoản đổi mật khẩu ban đầu trước khi vào hộp thư
 */
@ApiTags("Notifications")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("api/v1/notifications")
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  /** Trả trang thông báo SYSTEM của người đăng nhập theo bộ lọc đã được DTO kiểm tra */
  @Get()
  @ApiOperation({ summary: "Danh sách thông báo trong hộp thư của tôi" })
  list(@GetCurrentUser() user: CurrentUser, @Query() query: NotificationQueryDto) { return this.notifications.list(user.id, query); }

  /** Trả số chưa đọc để chuông FE không cần tải cả danh sách */
  @Get("unread-count")
  @ApiOperation({ summary: "Đếm thông báo chưa đọc của tôi" })
  unreadCount(@GetCurrentUser() user: CurrentUser) { return this.notifications.unreadCount(user.id); }

  /** Kiểm trạng thái gửi của đúng thông báo trong hộp thư hiện tại */
  @Get(":notificationId/deliveries")
  @ApiOperation({ summary: "Trạng thái gửi từng kênh của thông báo" })
  deliveries(@GetCurrentUser() user: CurrentUser, @Param("notificationId", new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ code: "VALIDATION_ERROR", message: "Mã thông báo không hợp lệ.", details: [{ field: "notificationId", messages: ["notificationId phải là UUID hợp lệ."] }] }) })) id: string) { return this.notifications.deliveryStatus(user.id, id); }

  /** Trả cấu hình kênh đã hợp nhất với giá trị mặc định, SYSTEM luôn bật */
  @Get("preferences")
  @ApiOperation({ summary: "Xem tùy chọn kênh thông báo của tôi" })
  preferences(@GetCurrentUser() user: CurrentUser) { return this.notifications.getPreferences(user.id); }

  /** Chỉ sửa các tùy chọn có mặt trong body, giữ những kênh còn lại */
  @Patch("preferences")
  @ApiOperation({ summary: "Cập nhật tùy chọn kênh thông báo của tôi" })
  updatePreferences(@GetCurrentUser() user: CurrentUser, @Body() body: NotificationPreferencesDto) { return this.notifications.setPreferences(user.id, body); }

  /** Đánh dấu ID thuộc hộp thư hiện tại; pipe chặn UUID sai trước khi truy vấn */
  @Patch(":notificationId/read")
  @ApiOperation({ summary: "Đánh dấu một thông báo đã đọc" })
  read(@GetCurrentUser() user: CurrentUser, @Param("notificationId", new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ code: "VALIDATION_ERROR", message: "Mã thông báo không hợp lệ.", details: [{ field: "notificationId", messages: ["notificationId phải là UUID hợp lệ."] }] }) })) id: string) { return this.notifications.markRead(user.id, id); }

  /** Đánh dấu toàn bộ thông báo chưa đọc và trả số dòng thật đã cập nhật */
  @Post("read-all")
  @ApiOperation({ summary: "Đánh dấu mọi thông báo đã đọc" })
  readAll(@GetCurrentUser() user: CurrentUser) { return this.notifications.markAllRead(user.id); }

  /** Tạo thông báo thử cho chính mình, không gửi mạng trong transaction HTTP */
  @Post("test")
  @ApiOperation({ summary: "Xếp thông báo kiểm tra cho kênh được chọn" })
  test(@GetCurrentUser() user: CurrentUser, @Body() body: TestNotificationDto) { return this.notifications.test(user.id, body.channel); }
}
