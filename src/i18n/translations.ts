export interface LanguageOption {
  code: string;
  nativeName: string;
  englishName: string;
  dir: 'ltr' | 'rtl';
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', dir: 'rtl' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', dir: 'ltr' },
  { code: 'ur', nativeName: 'اردو', englishName: 'Urdu', dir: 'rtl' },
  { code: 'zh', nativeName: '中文', englishName: 'Chinese', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', dir: 'ltr' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', dir: 'ltr' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', dir: 'ltr' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', dir: 'ltr' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', dir: 'ltr' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', dir: 'ltr' },
];

export type TranslationKeys =
  | 'appName'
  | 'tagline'
  | 'freePolicyBadge'
  | 'welcomeTitle'
  | 'welcomeSubtitle'
  | 'chooseLanguage'
  | 'detectedCountry'
  | 'selectCountry'
  | 'phoneNumberLabel'
  | 'phoneNumberPlaceholder'
  | 'displayNameLabel'
  | 'displayNamePlaceholder'
  | 'sendOtp'
  | 'verifyOtp'
  | 'otpTitle'
  | 'otpSentTo'
  | 'otpCodeLabel'
  | 'previewOtpNotice'
  | 'changeNumber'
  | 'recoverWithPin'
  | 'recoveryPinLabel'
  | 'signInWithPin'
  | 'navHome'
  | 'navCalls'
  | 'navContacts'
  | 'navSettings'
  | 'searchPlaceholder'
  | 'scanQr'
  | 'syncContacts'
  | 'friendRequests'
  | 'friendsTitle'
  | 'noFriendsYet'
  | 'noFriendsHint'
  | 'audioCall'
  | 'videoCall'
  | 'message'
  | 'online'
  | 'offline'
  | 'incomingCall'
  | 'outgoingCall'
  | 'accept'
  | 'reject'
  | 'endCall'
  | 'mute'
  | 'unmute'
  | 'speaker'
  | 'cameraOn'
  | 'cameraOff'
  | 'flipCamera'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'dataSaverActive'
  | 'callAll'
  | 'callIncoming'
  | 'callOutgoing'
  | 'callMissed'
  | 'clearHistory'
  | 'noCallsYet'
  | 'callBack'
  | 'contactsTitle'
  | 'searchResults'
  | 'sendRequest'
  | 'requestSent'
  | 'acceptRequest'
  | 'rejectRequest'
  | 'noRequests'
  | 'contactsPermissionTitle'
  | 'contactsPermissionBody'
  | 'allowContactsSync'
  | 'uploadVcf'
  | 'pasteNumbersHint'
  | 'findMatches'
  | 'myQrCode'
  | 'scanQrCode'
  | 'qrInstruction'
  | 'enterQrManually'
  | 'lookupQr'
  | 'profileTitle'
  | 'uploadPhoto'
  | 'removePhoto'
  | 'bioLabel'
  | 'saveProfile'
  | 'savedNotice'
  | 'appearance'
  | 'lightMode'
  | 'darkMode'
  | 'language'
  | 'dataSaver'
  | 'dataSaverDesc'
  | 'privacySecurity'
  | 'discoverPhone'
  | 'discoverName'
  | 'showOnline'
  | 'setRecoveryPin'
  | 'blockedUsers'
  | 'unblock'
  | 'blockUser'
  | 'reportUser'
  | 'removeFriend'
  | 'deleteAccount'
  | 'deleteAccountConfirm'
  | 'logout'
  | 'notifications'
  | 'markAllRead'
  | 'noNotifications'
  | 'typeMessage'
  | 'send'
  | 'shareImage'
  | 'encryptionNote'
  | 'close';

const EN: Record<TranslationKeys, string> = {
  appName: 'EASY CALL',
  tagline: 'One World. One Connection.',
  freePolicyBadge: '100% Free Worldwide · No Ads · No Subscriptions',
  welcomeTitle: 'Simple, clear calls with the people you love.',
  welcomeSubtitle:
    'Built for every country, every language, and every generation. Only approved friends can call or message you.',
  chooseLanguage: 'Language',
  detectedCountry: 'Detected country',
  selectCountry: 'Country',
  phoneNumberLabel: 'Mobile phone number',
  phoneNumberPlaceholder: 'Phone number without leading zero',
  displayNameLabel: 'Your name (optional)',
  displayNamePlaceholder: 'e.g. Rahim Ahmed',
  sendOtp: 'Send Verification Code',
  verifyOtp: 'Verify & Continue',
  otpTitle: 'Enter 6-digit code',
  otpSentTo: 'Code sent to',
  otpCodeLabel: 'Verification code',
  previewOtpNotice: 'Preview SMS code (configure Twilio in .env for live carrier SMS):',
  changeNumber: 'Change phone number',
  recoverWithPin: 'Use Recovery PIN instead',
  recoveryPinLabel: 'Recovery PIN (4–8 digits)',
  signInWithPin: 'Sign In with PIN',
  navHome: 'Home',
  navCalls: 'Calls',
  navContacts: 'Contacts',
  navSettings: 'Settings',
  searchPlaceholder: 'Search by name or full +phone number...',
  scanQr: 'QR Code',
  syncContacts: 'Contacts',
  friendRequests: 'Friend Requests',
  friendsTitle: 'Your Friends',
  noFriendsYet: 'No friends added yet',
  noFriendsHint:
    'Search by full phone number, scan a QR code, or sync your contacts to send a Friend Request.',
  audioCall: 'Audio Call',
  videoCall: 'Video Call',
  message: 'Message',
  online: 'Online',
  offline: 'Offline',
  incomingCall: 'Incoming call',
  outgoingCall: 'Calling...',
  accept: 'Accept',
  reject: 'Reject',
  endCall: 'End Call',
  mute: 'Mute',
  unmute: 'Unmute',
  speaker: 'Speaker',
  cameraOn: 'Camera On',
  cameraOff: 'Camera Off',
  flipCamera: 'Flip Camera',
  connecting: 'Connecting...',
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  dataSaverActive: 'Data Saver Active',
  callAll: 'All',
  callIncoming: 'Incoming',
  callOutgoing: 'Outgoing',
  callMissed: 'Missed',
  clearHistory: 'Clear History',
  noCallsYet: 'No call history yet',
  callBack: 'Call Back',
  contactsTitle: 'Contacts & Requests',
  searchResults: 'Search Results',
  sendRequest: 'Add Friend',
  requestSent: 'Request Sent',
  acceptRequest: 'Accept',
  rejectRequest: 'Reject',
  noRequests: 'No pending friend requests',
  contactsPermissionTitle: 'Find friends from your phone contacts',
  contactsPermissionBody:
    'With your permission, EASY CALL checks which numbers are registered. Your contacts are never exposed to other users.',
  allowContactsSync: 'Open Phone Contacts',
  uploadVcf: 'Import .vcf File',
  pasteNumbersHint: 'Or enter full international numbers (one per line, e.g. +88017...)',
  findMatches: 'Find EASY CALL Friends',
  myQrCode: 'My QR Code',
  scanQrCode: 'Scan QR Code',
  qrInstruction: 'Friends can scan your personal QR code to send a Friend Request.',
  enterQrManually: 'Or enter QR code ID (e.g. EC-A1B2C3...)',
  lookupQr: 'Find Person',
  profileTitle: 'Profile & Settings',
  uploadPhoto: 'Upload Photo',
  removePhoto: 'Remove Photo',
  bioLabel: 'Status note',
  saveProfile: 'Save Changes',
  savedNotice: 'Saved',
  appearance: 'Appearance',
  lightMode: 'Light Mode',
  darkMode: 'Dark Mode',
  language: 'App Language',
  dataSaver: 'Data Saver',
  dataSaverDesc: 'Reduces video quality and optimizes audio for weak internet connections.',
  privacySecurity: 'Privacy & Security',
  discoverPhone: 'Allow finding me by full phone number',
  discoverName: 'Allow finding me by display name',
  showOnline: 'Show when I am online to friends',
  setRecoveryPin: 'Set Account Recovery PIN (4–8 digits)',
  blockedUsers: 'Blocked Users',
  unblock: 'Unblock',
  blockUser: 'Block',
  reportUser: 'Report',
  removeFriend: 'Remove Friend',
  deleteAccount: 'Delete My Account',
  deleteAccountConfirm: 'Permanently delete your account, profile photo, and contacts?',
  logout: 'Sign Out',
  notifications: 'Notifications',
  markAllRead: 'Mark all read',
  noNotifications: 'No notifications yet',
  typeMessage: 'Write a message...',
  send: 'Send',
  shareImage: 'Share Photo',
  encryptionNote: 'Protected with TLS & WebRTC DTLS-SRTP media encryption.',
  close: 'Close',
};

const TRANSLATIONS: Record<string, Partial<Record<TranslationKeys, string>>> = {
  en: EN,
  bn: {
    tagline: 'এক পৃথিবী। এক সংযোগ।',
    freePolicyBadge: 'বিশ্বজুড়ে ১০০% ফ্রি · কোনো বিজ্ঞাপন নেই · কোনো সাবস্ক্রিপশন নেই',
    welcomeTitle: 'প্রিয়জনদের সাথে সহজ ও পরিষ্কার কল।',
    welcomeSubtitle: 'সব দেশ, সব ভাষা এবং সব বয়সের মানুষের জন্য তৈরি। শুধু অনুমোদিত বন্ধুরাই আপনাকে কল করতে পারবেন।',
    chooseLanguage: 'ভাষা',
    detectedCountry: 'শনাক্তকৃত দেশ',
    selectCountry: 'দেশ নির্বাচন করুন',
    phoneNumberLabel: 'মোবাইল নম্বর',
    phoneNumberPlaceholder: 'শূন্য ছাড়া মোবাইল নম্বর লিখুন',
    displayNameLabel: 'আপনার নাম (ঐচ্ছিক)',
    displayNamePlaceholder: 'যেমন: রহিম আহমেদ',
    sendOtp: 'ভেরিফিকেশন কোড পাঠান',
    verifyOtp: 'যাচাই করুন ও এগিয়ে যান',
    otpTitle: '৬ সংখ্যার কোড লিখুন',
    otpSentTo: 'কোড পাঠানো হয়েছে',
    otpCodeLabel: 'ভেরিফিকেশন কোড',
    changeNumber: 'নম্বর পরিবর্তন করুন',
    navHome: 'হোম',
    navCalls: 'কল',
    navContacts: 'যোগাযোগ',
    navSettings: 'সেটিংস',
    searchPlaceholder: 'নাম বা পুরো +ফোন নম্বর দিয়ে খুঁজুন...',
    scanQr: 'কিউআর কোড',
    syncContacts: 'কন্টাক্ট',
    friendRequests: 'বন্ধুত্বের অনুরোধ',
    friendsTitle: 'আপনার বন্ধুরা',
    noFriendsYet: 'এখনো কোনো বন্ধু যোগ করা হয়নি',
    audioCall: 'অডিও কল',
    videoCall: 'ভিডিও কল',
    message: 'বার্তা',
    online: 'অনলাইন',
    offline: 'অফলাইন',
    incomingCall: 'ইনকামিং কল',
    outgoingCall: 'কল করা হচ্ছে...',
    accept: 'গ্রহণ করুন',
    reject: 'বাতিল করুন',
    endCall: 'কল শেষ করুন',
    mute: 'মিউট',
    unmute: 'আনমিউট',
    speaker: 'স্পিকার',
    cameraOn: 'ক্যামেরা চালু',
    cameraOff: 'ক্যামেরা বন্ধ',
    flipCamera: 'ক্যামেরা ঘোরান',
    callAll: 'সব',
    callIncoming: 'আসা কল',
    callOutgoing: 'করা কল',
    callMissed: 'মিসড কল',
    clearHistory: 'ইতিহাস মুছুন',
    sendRequest: 'বন্ধু যোগ করুন',
    requestSent: 'অনুরোধ পাঠানো হয়েছে',
    acceptRequest: 'গ্রহণ করুন',
    rejectRequest: 'প্রত্যাখ্যান করুন',
    myQrCode: 'আমার কিউআর কোড',
    scanQrCode: 'কিউআর স্ক্যান',
    profileTitle: 'প্রোফাইল ও সেটিংস',
    uploadPhoto: 'ছবি আপলোড',
    removePhoto: 'ছবি সরান',
    saveProfile: 'সংরক্ষণ করুন',
    lightMode: 'লাইট মোড',
    darkMode: 'ডার্ক মোড',
    language: 'অ্যাপের ভাষা',
    dataSaver: 'ডেটা সেভার',
    privacySecurity: 'গোপনীয়তা ও নিরাপত্তা',
    deleteAccount: 'অ্যাকাউন্ট মুছুন',
    logout: 'লগ আউট',
    notifications: 'বিজ্ঞপ্তি',
    typeMessage: 'বার্তা লিখুন...',
    send: 'পাঠান',
    close: 'বন্ধ করুন',
  },
  ar: {
    tagline: 'عالم واحد. تواصل واحد.',
    freePolicyBadge: 'مجاني 100% عالمياً · بدون إعلانات · بدون اشتراكات',
    welcomeTitle: 'مكالمات سهلة وواضحة مع أحبائك.',
    welcomeSubtitle: 'مصمم لكل بلد ولكل لغة ولكل جيل. فقط الأصدقاء المعتمدون يمكنهم الاتصال بك.',
    chooseLanguage: 'اللغة',
    detectedCountry: 'الدولة المكتشفة',
    selectCountry: 'الدولة',
    phoneNumberLabel: 'رقم الهاتف المحمول',
    phoneNumberPlaceholder: 'أدخل الرقم بدون صفر في البداية',
    displayNameLabel: 'الاسم (اختياري)',
    sendOtp: 'إرسال رمز التحقق',
    verifyOtp: 'تحقق وتابع',
    otpTitle: 'أدخل الرمز المكون من 6 أرقام',
    otpSentTo: 'تم إرسال الرمز إلى',
    changeNumber: 'تغيير رقم الهاتف',
    navHome: 'الرئيسية',
    navCalls: 'المكالمات',
    navContacts: 'جهات الاتصال',
    navSettings: 'الإعدادات',
    searchPlaceholder: 'ابحث بالاسم أو رقم الهاتف الكامل...',
    scanQr: 'رمز QR',
    syncContacts: 'جهات الاتصال',
    friendRequests: 'طلبات الصداقة',
    friendsTitle: 'الأصدقاء',
    noFriendsYet: 'لا يوجد أصدقاء بعد',
    audioCall: 'مكالمة صوتية',
    videoCall: 'مكالمة فيديو',
    message: 'رسالة',
    online: 'متصل',
    offline: 'غير متصل',
    incomingCall: 'مكالمة واردة',
    outgoingCall: 'جارٍ الاتصال...',
    accept: 'قبول',
    reject: 'رفض',
    endCall: 'إنهاء المكالمة',
    mute: 'كتم الصوت',
    unmute: 'إلغاء الكتم',
    speaker: 'مكبر الصوت',
    callAll: 'الكل',
    callIncoming: 'الواردة',
    callOutgoing: 'الصادرة',
    callMissed: 'الفائتة',
    clearHistory: 'مسح السجل',
    sendRequest: 'إضافة صديق',
    requestSent: 'تم إرسال الطلب',
    acceptRequest: 'قبول',
    rejectRequest: 'رفض',
    myQrCode: 'رمز QR الخاص بي',
    scanQrCode: 'مسح رمز QR',
    profileTitle: 'الملف الشخصي والإعدادات',
    uploadPhoto: 'رفع صورة',
    removePhoto: 'إزالة الصورة',
    saveProfile: 'حفظ التغييرات',
    lightMode: 'الوضع الفاتح',
    darkMode: 'الوضع الداكن',
    language: 'لغة التطبيق',
    dataSaver: 'توفير البيانات',
    privacySecurity: 'الخصوصية والأمان',
    deleteAccount: 'حذف حسابي',
    logout: 'تسجيل الخروج',
    notifications: 'الإشعارات',
    typeMessage: 'اكتب رسالة...',
    send: 'إرسال',
    close: 'إغلاق',
  },
  hi: {
    tagline: 'एक दुनिया। एक जुड़ाव।',
    freePolicyBadge: 'दुनिया भर में 100% मुफ़्त · कोई विज्ञापन नहीं',
    welcomeTitle: 'अपने अपनों से आसान और साफ़ कॉल।',
    chooseLanguage: 'भाषा',
    phoneNumberLabel: 'मोबाइल फ़ोन नंबर',
    sendOtp: 'सत्यापन कोड भेजें',
    verifyOtp: 'सत्यापित करें और आगे बढ़ें',
    navHome: 'होम',
    navCalls: 'कॉल',
    navContacts: 'संपर्क',
    navSettings: 'सेटिंग्स',
    searchPlaceholder: 'नाम या पूरा +फ़ोन नंबर खोजें...',
    audioCall: 'ऑडियो कॉल',
    videoCall: 'वीडियो कॉल',
    message: 'संदेश',
    accept: 'स्वीकार करें',
    reject: 'अस्वीकार करें',
    endCall: 'कॉल समाप्त करें',
    saveProfile: 'बदलाव सहेजें',
    language: 'ऐप की भाषा',
    dataSaver: 'डेटा सेवर',
    logout: 'साइन आउट',
  },
  ur: {
    tagline: 'ایک دنیا۔ ایک رابطہ۔',
    freePolicyBadge: 'دنیا بھر میں 100% مفت · کوئی اشتہار نہیں',
    welcomeTitle: 'اپنے پیاروں کے ساتھ آسان اور صاف کالز۔',
    chooseLanguage: 'زبان',
    phoneNumberLabel: 'موبائل فون نمبر',
    sendOtp: 'تصدیقی کوڈ بھیجیں',
    verifyOtp: 'تصدیق کریں اور جاری رکھیں',
    navHome: 'ہوم',
    navCalls: 'کالز',
    navContacts: 'رابطے',
    navSettings: 'سیٹنگز',
    audioCall: 'آڈیو کال',
    videoCall: 'ویڈیو کال',
    message: 'پیغام',
    accept: 'قبول کریں',
    reject: 'مسترد کریں',
    endCall: 'کال ختم کریں',
    saveProfile: 'محفوظ کریں',
    language: 'ایپ کی زبان',
    dataSaver: 'ڈیٹا سیور',
    logout: 'لاگ آؤٹ',
  },
  zh: {
    tagline: '同一个世界，同一个连接。',
    freePolicyBadge: '全球100%免费 · 无广告 · 无订阅',
    welcomeTitle: '与挚爱之人进行简单清晰的通话。',
    chooseLanguage: '语言',
    phoneNumberLabel: '手机号码',
    sendOtp: '发送验证码',
    verifyOtp: '验证并继续',
    navHome: '首页',
    navCalls: '通话',
    navContacts: '联系人',
    navSettings: '设置',
    audioCall: '语音通话',
    videoCall: '视频通话',
    message: '消息',
    accept: '接听',
    reject: '拒绝',
    endCall: '结束通话',
    saveProfile: '保存更改',
    language: '应用语言',
    dataSaver: '省流量模式',
    logout: '退出登录',
  },
  es: {
    tagline: 'Un Mundo. Una Conexión.',
    freePolicyBadge: '100% Gratis en Todo el Mundo · Sin Anuncios',
    welcomeTitle: 'Llamadas simples y claras con quienes más quieres.',
    chooseLanguage: 'Idioma',
    phoneNumberLabel: 'Número de teléfono móvil',
    sendOtp: 'Enviar código',
    verifyOtp: 'Verificar y continuar',
    navHome: 'Inicio',
    navCalls: 'Llamadas',
    navContacts: 'Contactos',
    navSettings: 'Ajustes',
    audioCall: 'Llamada de voz',
    videoCall: 'Videollamada',
    message: 'Mensaje',
    accept: 'Aceptar',
    reject: 'Rechazar',
    endCall: 'Finalizar',
    saveProfile: 'Guardar cambios',
    language: 'Idioma de la aplicación',
    dataSaver: 'Ahorro de datos',
    logout: 'Cerrar sesión',
  },
  fr: {
    tagline: 'Un Monde. Une Connexion.',
    freePolicyBadge: '100% Gratuit dans le Monde · Sans Publicité',
    welcomeTitle: 'Des appels simples et clairs avec vos proches.',
    chooseLanguage: 'Langue',
    phoneNumberLabel: 'Numéro de téléphone mobile',
    sendOtp: 'Envoyer le code',
    verifyOtp: 'Vérifier et continuer',
    navHome: 'Accueil',
    navCalls: 'Appels',
    navContacts: 'Contacts',
    navSettings: 'Paramètres',
    audioCall: 'Appel audio',
    videoCall: 'Appel vidéo',
    message: 'Message',
    accept: 'Accepter',
    reject: 'Refuser',
    endCall: 'Raccrocher',
    saveProfile: 'Enregistrer',
    language: "Langue de l'application",
    dataSaver: 'Économiseur de données',
    logout: 'Déconnexion',
  },
  de: {
    tagline: 'Eine Welt. Eine Verbindung.',
    freePolicyBadge: 'Weltweit 100% Kostenlos · Keine Werbung',
    welcomeTitle: 'Einfache, klare Anrufe mit Ihren Liebsten.',
    chooseLanguage: 'Sprache',
    phoneNumberLabel: 'Mobilfunknummer',
    sendOtp: 'Code senden',
    verifyOtp: 'Bestätigen & Weiter',
    navHome: 'Start',
    navCalls: 'Anrufe',
    navContacts: 'Kontakte',
    navSettings: 'Einstellungen',
    audioCall: 'Sprachanruf',
    videoCall: 'Videoanruf',
    message: 'Nachricht',
    accept: 'Annehmen',
    reject: 'Ablehnen',
    endCall: 'Auflegen',
    saveProfile: 'Speichern',
    language: 'App-Sprache',
    dataSaver: 'Datensparmodus',
    logout: 'Abmelden',
  },
  ru: {
    tagline: 'Один мир. Одна связь.',
    freePolicyBadge: '100% бесплатно по всему миру · Без рекламы',
    welcomeTitle: 'Простые и чёткие звонки близким.',
    chooseLanguage: 'Язык',
    phoneNumberLabel: 'Номер мобильного телефона',
    sendOtp: 'Отправить код',
    verifyOtp: 'Подтвердить и продолжить',
    navHome: 'Главная',
    navCalls: 'Звонки',
    navContacts: 'Контакты',
    navSettings: 'Настройки',
    audioCall: 'Аудиозвонок',
    videoCall: 'Видеозвонок',
    message: 'Сообщение',
    accept: 'Принять',
    reject: 'Отклонить',
    endCall: 'Завершить',
    saveProfile: 'Сохранить',
    language: 'Язык приложения',
    dataSaver: 'Экономия трафика',
    logout: 'Выйти',
  },
  ja: {
    tagline: 'ひとつの世界、ひとつのつながり。',
    freePolicyBadge: '世界中100%無料 · 広告なし',
    welcomeTitle: '大切な人とのシンプルでクリアな通話。',
    chooseLanguage: '言語',
    phoneNumberLabel: '携帯電話番号',
    sendOtp: '認証コードを送信',
    verifyOtp: '認証して続行',
    navHome: 'ホーム',
    navCalls: '通話',
    navContacts: '連絡先',
    navSettings: '設定',
    audioCall: '音声通話',
    videoCall: 'ビデオ通話',
    message: 'メッセージ',
    accept: '応答',
    reject: '拒否',
    endCall: '通話終了',
    saveProfile: '保存する',
    language: 'アプリの言語',
    dataSaver: 'データセーバー',
    logout: 'ログアウト',
  },
  pt: {
    tagline: 'Um Mundo. Uma Conexão.',
    freePolicyBadge: '100% Grátis no Mundo Todo · Sem Anúncios',
    welcomeTitle: 'Chamadas simples e claras com quem você ama.',
    chooseLanguage: 'Idioma',
    phoneNumberLabel: 'Número de celular',
    sendOtp: 'Enviar código',
    verifyOtp: 'Verificar e continuar',
    navHome: 'Início',
    navCalls: 'Chamadas',
    navContacts: 'Contatos',
    navSettings: 'Ajustes',
    audioCall: 'Chamada de voz',
    videoCall: 'Videochamada',
    message: 'Mensagem',
    accept: 'Atender',
    reject: 'Recusar',
    endCall: 'Encerrar',
    saveProfile: 'Salvar alterações',
    language: 'Idioma do aplicativo',
    dataSaver: 'Economia de dados',
    logout: 'Sair',
  },
  id: {
    tagline: 'Satu Dunia. Satu Koneksi.',
    freePolicyBadge: '100% Gratis Seluruh Dunia · Tanpa Iklan',
    welcomeTitle: 'Panggilan mudah dan jernih bersama keluarga.',
    chooseLanguage: 'Bahasa',
    phoneNumberLabel: 'Nomor ponsel',
    sendOtp: 'Kirim Kode Verifikasi',
    verifyOtp: 'Verifikasi & Lanjutkan',
    navHome: 'Beranda',
    navCalls: 'Panggilan',
    navContacts: 'Kontak',
    navSettings: 'Pengaturan',
    audioCall: 'Panggilan Suara',
    videoCall: 'Panggilan Video',
    message: 'Pesan',
    accept: 'Terima',
    reject: 'Tolak',
    endCall: 'Akhiri',
    saveProfile: 'Simpan',
    language: 'Bahasa Aplikasi',
    dataSaver: 'Penghemat Data',
    logout: 'Keluar',
  },
  tr: {
    tagline: 'Tek Dünya. Tek Bağlantı.',
    freePolicyBadge: 'Dünya Çapında %100 Ücretsiz · Reklamsız',
    welcomeTitle: 'Sevdiklerinizle basit ve net aramalar.',
    chooseLanguage: 'Dil',
    phoneNumberLabel: 'Cep telefonu numarası',
    sendOtp: 'Doğrulama Kodu Gönder',
    verifyOtp: 'Doğrula ve Devam Et',
    navHome: 'Ana Sayfa',
    navCalls: 'Aramalar',
    navContacts: 'Kişiler',
    navSettings: 'Ayarlar',
    audioCall: 'Sesli Arama',
    videoCall: 'Görüntülü Arama',
    message: 'Mesaj',
    accept: 'Kabul Et',
    reject: 'Reddet',
    endCall: 'Bitir',
    saveProfile: 'Kaydet',
    language: 'Uygulama Dili',
    dataSaver: 'Veri Tasarrufu',
    logout: 'Çıkış Yap',
  },
};

export function detectDeviceLanguage(): string {
  if (typeof navigator === 'undefined') return 'en';
  const raw = (navigator.language || 'en').toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.some((l) => l.code === raw) ? raw : 'en';
}

export function getLanguageMeta(code: string): LanguageOption {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) || SUPPORTED_LANGUAGES[0];
}

export function translate(lang: string, key: TranslationKeys): string {
  const dict = TRANSLATIONS[lang];
  return (dict && dict[key]) || EN[key];
}
