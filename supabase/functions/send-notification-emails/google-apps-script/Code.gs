// Deploy this script from the dedicated Gmail account as a web app that runs
// as its owner. The shared token and fixed addresses live in Script Properties.
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var input;
  try {
    input = JSON.parse(e.postData.contents);
  } catch (_error) {
    return json_({ accepted: false, errorCode: 'INVALID_REQUEST' });
  }
  if (!input || typeof input !== 'object') {
    return json_({ accepted: false, errorCode: 'INVALID_REQUEST' });
  }

  var settings = PropertiesService.getScriptProperties();
  var token = settings.getProperty('WEBHOOK_TOKEN');
  if (!token || token.length < 32 || input.token !== token) {
    return json_({ accepted: false, errorCode: 'UNAUTHORIZED' });
  }

  var sender = Session.getEffectiveUser().getEmail().toLowerCase();
  var configuredSender = (settings.getProperty('SENDER_EMAIL') || '').toLowerCase();
  var recipient = (settings.getProperty('RECIPIENT_EMAIL') || '').toLowerCase();
  var appUrl = settings.getProperty('APP_URL') || '';
  if (!sender || sender !== configuredSender || !recipient || !/^https:\/\//.test(appUrl)) {
    return json_({ accepted: false, errorCode: 'NOT_CONFIGURED' });
  }
  if (input.action === 'check') {
    return json_({ ready: true, senderEmail: sender, recipientEmail: recipient });
  }
  if (input.action !== 'send' ||
      typeof input.senderEmail !== 'string' ||
      typeof input.recipientEmail !== 'string' ||
      typeof input.deliveryId !== 'string' ||
      typeof input.notificationId !== 'string' ||
      typeof input.eventAt !== 'string' ||
      input.senderEmail.toLowerCase() !== sender ||
      input.recipientEmail.toLowerCase() !== recipient ||
      !/^[0-9a-f-]{36}$/i.test(input.deliveryId) ||
      !/^[0-9a-f-]{36}$/i.test(input.notificationId) ||
      !isFinite(Number(input.eventRatio)) || Number(input.eventRatio) < 1 ||
      isNaN(Date.parse(input.eventAt))) {
    return json_({ accepted: false, errorCode: 'INVALID_REQUEST' });
  }

  var subject = '[ChemStock] 指定数量の合算倍率が1.0以上になりました';
  var body = [
    '指定数量の合算倍率が1.0以上になりました。',
    '発生時点の倍率: ' + Number(input.eventRatio).toFixed(3) + ' 倍',
    '発生日時: ' + Utilities.formatDate(new Date(input.eventAt), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss') + ' JST',
    '通知ID: ' + input.notificationId,
    '最新の状況は管理者画面で確認してください。',
    appUrl.replace(/\/$/, '') + '/manage/admin/notifications',
  ].join('\n');

  try {
    MailApp.sendEmail(recipient, subject, body, {
      name: 'ChemStock 溶媒庫通知',
      replyTo: recipient,
    });
  } catch (_error) {
    // The caller treats an uncertain send outcome as requiring manual review.
    return json_({ accepted: false, errorCode: 'SEND_RESULT_UNKNOWN' });
  }
  return json_({ accepted: true, senderEmail: sender, recipientEmail: recipient });
}
