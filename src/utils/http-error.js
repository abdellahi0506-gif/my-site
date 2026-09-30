'use strict';

/** خطأ HTTP يمكن إرساله مباشرة إلى العميل */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** يغلّف دوال async في Express 4 حتى تُمرَّر الأخطاء إلى معالج الأخطاء */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { HttpError, asyncHandler };
