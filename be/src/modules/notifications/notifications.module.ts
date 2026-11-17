import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { EmailNotificationProvider, WebPushNotificationProvider } from "./real-notification-providers.js";
import { NOTIFICATION_PROVIDERS } from "./notification-provider.js";
import { CredentialDispatchService } from "./credential-dispatch.service.js";
import { PushSubscriptionsService } from "./push-subscriptions.service.js";
import { PushOnboardingController, PushSubscriptionsController } from "./push-subscriptions.controller.js";

/** Gắn API hộp thư và worker vào vòng đời Nest; provider thật sẽ được đăng ký ở VC06 */
@Module({ imports: [PrismaModule], controllers: [NotificationsController, PushSubscriptionsController, PushOnboardingController], providers: [NotificationsService, EmailNotificationProvider, WebPushNotificationProvider, PushSubscriptionsService, CredentialDispatchService, { provide: NOTIFICATION_PROVIDERS, useFactory: (email: EmailNotificationProvider, push: WebPushNotificationProvider) => [email, push], inject: [EmailNotificationProvider, WebPushNotificationProvider] }], exports: [NotificationsService, CredentialDispatchService] })
export class NotificationsModule {}
