export const TRANSLATIONS = Object.freeze({
  ar: {
    appTitle: 'نظام المطعم', loginSubtitle: 'تسجيل دخول النادل', email: 'البريد الإلكتروني', password: 'كلمة المرور',
    login: 'تسجيل الدخول', verifying: 'جارٍ التحقق…', setupTitle: 'إعداد تطبيق النادل', setupHint: 'ضع عنوان API محلياً أو سحابياً صالحاً ثم أعد تشغيل Expo.',
    preparing: 'تهيئة قاعدة البيانات المحلية…', orders: 'طلبات النادل', logout: 'خروج', sync: 'المزامنة', pending: 'طلبات غير مكتملة:',
    syncing: 'جارٍ التنفيذ…', syncNow: 'مزامنة الآن', sent: 'تم الإرسال', failed: 'فشل ويحتاج مراجعة', sending: 'جارٍ الإرسال', waiting: 'بانتظار الإرسال',
    serviceArea: 'منطقة الخدمة', refreshCatalog: 'تحديث القائمة', stale: 'القائمة المخزنة قديمة. تحقق من الطاولة قبل إرسال الطلب؛ الخادم هو المرجع النهائي.',
    chooseTable: 'اختر الطاولة', occupied: 'مشغولة', reserved: 'محجوزة', available: 'متاحة', menu: 'قائمة الأصناف', bar: 'البار', other: 'قسم آخر', kitchen: 'المطبخ', add: 'إضافة',
    cart: 'السلة', emptyCart: 'لم تتم إضافة أصناف.', estimated: 'المجموع التقديري:', serverValidation: 'السعر النهائي وحالة الطاولة يعاد التحقق منهما في الخادم عند المزامنة.',
    saveSend: 'حفظ وإرسال الطلب', language: 'English', loginDone: 'تم تسجيل الدخول.', catalogUpdated: 'تم تحديث قائمة المطعم.',
    staleTable: 'القائمة المخزنة قديمة؛ تحقق من توفر الطاولات قبل إرسال الطلب.', savedLocal: 'حُفظ الطلب على الجهاز أولاً. ستتم مزامنته الآن أو عند عودة الاتصال.',
    offline: 'الخادم غير متاح حالياً. سنستخدم القائمة المحفوظة ونحتفظ بالطلبات على الجهاز حتى يعود الاتصال.',
    reauth: 'انتهت صلاحية الجلسة أو تغيّرت صلاحيات الحساب. سجّل الدخول بالحساب نفسه لمتابعة الطلبات المحفوظة.',
    expired: 'انتهت الجلسة. سجّل الدخول بالحساب نفسه؛ لم تُحذف القائمة أو الطلبات المحفوظة.',
    authSync: 'انتهت الجلسة. سجّل الدخول بالحساب نفسه؛ بقي الطلب محفوظاً ولم يُحتسب كمحاولة فاشلة.',
    oldAccount: 'يوجد طلب غير متزامن للحساب السابق. سجّل الدخول بالحساب السابق وأرسل الطلبات أولاً؛ لن نترك الطلبات مرتبطة بحساب آخر.',
    logoutBlockedTitle: 'توجد طلبات غير مكتملة', logoutBlocked: 'أرسل الطلبات المعلقة أو راجع الطلبات الفاشلة قبل تسجيل الخروج. لن نحذفها أو ننقلها إلى حساب آخر.',
    oldAccountLabel: 'الحساب السابق:', useSame: 'استخدم الحساب نفسه لإرسال أي طلبات محفوظة.', noItems: 'لا توجد أصناف مضافة.',
    badCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', forbidden: 'الحساب غير مخوّل لهذه العملية. راجع مدير المطعم.', genericError: 'تعذرت العملية. تحقق من الاتصال والإعدادات ثم حاول مجدداً.', networkError: 'تعذر الاتصال بالخادم.', invalidConfig: 'إعداد عنوان الخادم غير صحيح.', identityCheck: 'تعذر التحقق من هوية الحساب.', bootFailure: 'تعذر تهيئة التطبيق.', catalogOld: 'القائمة المخزنة قديمة.', catalogAvailable: 'القائمة المحفوظة متاحة.', loginFailure: 'تعذر تسجيل الدخول.'
  },
  en: {
    appTitle: 'Restaurant POS', loginSubtitle: 'Waiter sign in', email: 'Email address', password: 'Password',
    login: 'Sign in', verifying: 'Signing in…', setupTitle: 'Waiter app setup', setupHint: 'Set a valid local or cloud API origin, then restart Expo.',
    preparing: 'Preparing local database…', orders: 'Waiter orders', logout: 'Sign out', sync: 'Synchronization', pending: 'Unfinished orders:',
    syncing: 'Working…', syncNow: 'Sync now', sent: 'Sent', failed: 'Failed — review needed', sending: 'Sending', waiting: 'Waiting to send',
    serviceArea: 'Service area', refreshCatalog: 'Refresh catalog', stale: 'The saved catalog is out of date. Check table availability before sending; the server remains authoritative.',
    chooseTable: 'Choose a table', occupied: 'Occupied', reserved: 'Reserved', available: 'Available', menu: 'Menu items', bar: 'Bar', other: 'Other', kitchen: 'Kitchen', add: 'Add',
    cart: 'Cart', emptyCart: 'No items added.', estimated: 'Estimated total:', serverValidation: 'The server revalidates final prices and table status during synchronization.',
    saveSend: 'Save and send order', language: 'العربية', loginDone: 'Signed in.', catalogUpdated: 'Restaurant catalog updated.',
    staleTable: 'The saved catalog is out of date; verify table availability before sending.', savedLocal: 'Order saved on this device first. It will sync now or when connectivity returns.',
    offline: 'The server is currently unavailable. The saved catalog and local orders will remain available until connectivity returns.',
    reauth: 'The session expired or account permissions changed. Sign in with the same account to continue saved orders.',
    expired: 'Session expired. Sign in with the same account; saved catalog and orders were kept.',
    authSync: 'Session expired. Sign in with the same account; the order remains saved and no failed attempt was counted.',
    oldAccount: 'An order from the previous account is not synchronized. Sign in with that account and send its orders first; orders cannot be reassigned.',
    logoutBlockedTitle: 'Unfinished orders remain', logoutBlocked: 'Send pending orders or review failed orders before signing out. They will not be deleted or moved to another account.',
    oldAccountLabel: 'Previous account:', useSame: 'Use the same account to send its saved orders.', noItems: 'No items have been added.',
    badCredentials: 'The email or password is incorrect.', forbidden: 'This account is not allowed to perform this action. Contact the restaurant manager.', genericError: 'The operation failed. Check the connection and settings, then try again.', networkError: 'Could not connect to the server.', invalidConfig: 'The server origin configuration is invalid.', identityCheck: 'Could not verify the account identity.', bootFailure: 'Could not initialize the app.', catalogOld: 'The saved catalog is out of date.', catalogAvailable: 'The saved catalog is available.', loginFailure: 'Sign-in failed.'
  }
});

export function translate(language, key) {
  return TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.ar[key] ?? key;
}
