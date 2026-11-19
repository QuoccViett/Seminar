import { Body, Controller, Delete, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser, type CurrentUser } from "../../common/decorators/current-user.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { OnboardingSubscriptionDto, OnboardingTokenDto, PushSubscriptionDto, RevokePushSubscriptionDto } from "./dto/push-subscription.dto.js";
import { PushSubscriptionsService } from "./push-subscriptions.service.js";

/** Public key không phải bí mật; các thao tác Bearer vẫn lấy userId từ guard phía server */
@ApiTags("Web Push")
@Controller("api/v1/notifications/web-push")
export class PushSubscriptionsController {
  constructor(@Inject(PushSubscriptionsService) private readonly subscriptions: PushSubscriptionsService) {}

  /** Cấp public key đang bật cho PushManager, trả null khi tính năng tắt */
  @Get("public-key")
  @ApiOperation({ summary: "Khóa công khai Web Push" })
  publicKey() { return this.subscriptions.publicKey(); }

  /** Gắn subscription vào chính tài khoản đăng nhập sau khi kiểm endpoint và khóa */
  @Post("subscriptions")
  @ApiBearerAuth("access-token")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "[ADMIN, UNIT] Đăng ký thiết bị hiện tại để nhận thông báo Web Push" })
  register(@GetCurrentUser() user: CurrentUser, @Body() body: PushSubscriptionDto) { return this.subscriptions.register(user.id, body); }

  /** Thu hồi thiết bị của chính tài khoản, gọi lặp vẫn thành công để FE dọn subscription */
  @Delete("subscriptions/current")
  @ApiBearerAuth("access-token")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "[ADMIN, UNIT] Hủy đăng ký thiết bị Web Push của tài khoản hiện tại" })
  revoke(@GetCurrentUser() user: CurrentUser, @Body() body: RevokePushSubscriptionDto) { return this.subscriptions.revoke(user.id, body.endpoint); }
}

/** Token mời có quyền rất hẹp và không dùng JwtAuthGuard để tài khoản mới chưa đổi mật khẩu đăng ký thiết bị */
@ApiTags("Onboarding")
@Controller("api/v1/onboarding/web-push")
export class PushOnboardingController {
  constructor(@Inject(PushSubscriptionsService) private readonly subscriptions: PushSubscriptionsService) {}

  /** Kiểm token trước khi xin quyền trình duyệt; chỉ trả khả dụng và public key */
  @Post("verify")
  @ApiOperation({ summary: "Kiểm liên kết mời Web Push" })
  verify(@Body() body: OnboardingTokenDto) { return this.subscriptions.verify(body.token); }

  /** Tiêu thụ token một lần để gắn thiết bị, không cấp phiên đăng nhập */
  @Post("subscriptions")
  @ApiOperation({ summary: "Đăng ký Web Push bằng liên kết mời" })
  register(@Body() body: OnboardingSubscriptionDto) { return this.subscriptions.registerWithInvitation(body.token, body.subscription); }
}
