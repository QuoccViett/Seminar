/** Cấu hình APPS_SCRIPT_SECRET trong Script Properties, không đặt khóa vào mã nguồn. */
function authorizeMail() {
  // Chạy một lần trong editor để tài khoản triển khai cấp quyền gửi; không gửi thư.
  MailApp.getRemainingDailyQuota();
}

function reply_(ok, code) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok, code: code })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 24000) return reply_(false, 'INVALID');
    var request = JSON.parse(e.postData.contents);
    if (typeof request.timestamp !== 'string' || !/^\d{13}$/.test(request.timestamp) || Math.abs(Date.now() - Number(request.timestamp)) > 300000 ||
        typeof request.nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(request.nonce) ||
        typeof request.payload !== 'string' || !/^[A-Za-z0-9_-]+$/.test(request.payload) ||
        typeof request.signature !== 'string' || !/^[0-9a-f]{64}$/.test(request.signature)) return reply_(false, 'INVALID');
    var secret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SECRET');
    if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) return reply_(false, 'NOT_CONFIGURED');
    var digest = Utilities.computeHmacSha256Signature(request.timestamp + '.' + request.nonce + '.' + request.payload, secret, Utilities.Charset.UTF_8);
    var signature = digest.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    var diff = 0;
    for (var i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ request.signature.charCodeAt(i);
    if (diff !== 0) return reply_(false, 'UNAUTHORIZED');
    var paddedPayload = request.payload + '='.repeat((4 - request.payload.length % 4) % 4);
    var message = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(paddedPayload)).getDataAsString('UTF-8'));
    if (!message || typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) ||
        typeof message.to !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(message.to) ||
        typeof message.subject !== 'string' || !message.subject || message.subject.length > 255 || /[\r\n]/.test(message.subject) ||
        typeof message.text !== 'string' || !message.text || message.text.length > 8000 ||
        typeof message.html !== 'string' || message.html.length > 16000 ||
        (message.expiresAt !== null && (typeof message.expiresAt !== 'number' || !isFinite(message.expiresAt)))) return reply_(false, 'INVALID');
    if (message.expiresAt !== null && Date.now() >= message.expiresAt) return reply_(false, 'EXPIRED');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return reply_(false, 'BUSY');
    try {
      var cache = CacheService.getScriptCache();
      var key = 'mail_nonce_' + request.nonce;
      if (cache.get(key)) return reply_(false, 'REPLAY');
      cache.put(key, '1', 600);
      var properties = PropertiesService.getScriptProperties();
      var sentKey = 'mail_sent_' + message.id;
      if (properties.getProperty(sentKey)) return reply_(true, 'ALREADY_SENT');
      if (message.expiresAt !== null && Date.now() >= message.expiresAt) return reply_(false, 'EXPIRED');
      if (MailApp.getRemainingDailyQuota() < 1) return reply_(false, 'RATE_LIMIT');
      MailApp.sendEmail({ to: message.to, subject: message.subject, body: message.text, htmlBody: message.html, name: 'Hệ thống đánh giá' });
      properties.setProperty(sentKey, String(Date.now()));
      var all = properties.getProperties();
      Object.keys(all).forEach(function (key) {
        if (key.indexOf('mail_sent_') === 0 && Number(all[key]) < Date.now() - 7 * 86400000) properties.deleteProperty(key);
      });
      return reply_(true, 'SENT');
    } finally { lock.releaseLock(); }
  } catch (error) {
    // Không ghi request, nội dung thư, địa chỉ hoặc lỗi thô vào log.
    return reply_(false, 'TEMPORARY_FAILURE');
  }
}
