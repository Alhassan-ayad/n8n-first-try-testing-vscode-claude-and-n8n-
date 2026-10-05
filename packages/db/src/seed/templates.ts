// Seed template library — every message the platform can send, in Arabic
// and English (plan §5, §7, Appendix A tone). Seeded as `in_review`: each
// template must be approved by Compliance in the console before it is used
// in production (TEMPLATE_REQUIRE_APPROVAL=true). Arabic copy is modern
// standard Arabic written for the purpose, not translated line by line.
//
// Push copy stays under 90 characters (variables are estimated at 8 chars).

type Lang = 'en' | 'ar';
interface Copy {
  subject?: string;
  title?: string;
  body: string;
}
type Pair = Record<Lang, Copy>;

export interface TemplateSeed {
  key: string;
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  topic: string;
  deepLink?: string;
  push?: Pair;
  email?: Pair;
  sms?: Pair;
  inapp?: Pair;
  whatsapp?: Pair;
}

const p = (enTitle: string, en: string, arTitle: string, ar: string): Pair => ({
  en: { title: enTitle, body: en },
  ar: { title: arTitle, body: ar },
});
const e = (enSubject: string, en: string, arSubject: string, ar: string): Pair => ({
  en: { subject: enSubject, body: en },
  ar: { subject: arSubject, body: ar },
});
const s = (en: string, ar: string): Pair => ({ en: { body: en }, ar: { body: ar } });

const HI_EN = 'Hello {{firstName}},';
const HI_AR = 'مرحبًا {{firstName}}،';
const PRICE_NOTE_EN = 'Prices move continuously; past performance is not an indication of what comes next.';
const PRICE_NOTE_AR = 'الأسعار تتغير باستمرار، والأداء السابق لا يدل على ما سيأتي.';

export const TEMPLATES: TemplateSeed[] = [
  // ══ Category A — transactional and account ═══════════════════════════════
  {
    key: 'otp',
    category: 'A',
    topic: 'transactional',
    sms: s(
      'Your mngm code is {{code}}. It expires in 5 minutes. Never share it with anyone, including mngm staff.',
      'رمز التحقق من mngm هو {{code}}. صالح لمدة 5 دقائق. لا تشاركه مع أي شخص، حتى موظفي mngm.',
    ),
    email: e(
      'Your mngm verification code',
      'Your verification code is {{code}}.\n\nIt expires in 5 minutes. Never share it with anyone, including mngm staff. If you did not request it, change your password.',
      'رمز التحقق من mngm',
      'رمز التحقق الخاص بك هو {{code}}.\n\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص، حتى موظفي mngm. إذا لم تطلبه، غيّر كلمة المرور.',
    ),
  },
  {
    key: 'welcome',
    category: 'A',
    topic: 'transactional',
    email: e(
      'Welcome to mngm — one step left',
      `${HI_EN}\n\nWelcome to mngm. Your account is created.\n\nOne step is left before you can buy: identity verification. It takes about 3 minutes and you need your national ID.\n\nEvery gram you own on mngm is physically backed and held in insured vault storage.`,
      'مرحبًا بك في mngm — خطوة واحدة متبقية',
      `${HI_AR}\n\nأهلًا بك في mngm. تم إنشاء حسابك.\n\nتبقّت خطوة واحدة قبل أن تتمكن من الشراء: التحقق من الهوية. تستغرق نحو 3 دقائق وتحتاج إلى بطاقتك القومية.\n\nكل جرام تملكه على mngm مدعوم بمعدن حقيقي ومحفوظ في خزائن مؤمَّنة.`,
    ),
    push: p('Welcome to mngm', 'One step left: verify your ID in about 3 minutes.', 'أهلًا بك في mngm', 'خطوة واحدة متبقية: تحقق من هويتك في نحو 3 دقائق.'),
  },
  {
    key: 'ekyc_submitted',
    category: 'A',
    topic: 'transactional',
    push: p('Verification received', 'We received your documents. We will tell you as soon as they are reviewed.', 'استلمنا مستنداتك', 'استلمنا مستنداتك وسنبلغك فور مراجعتها.'),
    email: e(
      'We received your verification documents',
      `${HI_EN}\n\nWe received your identity documents and they are under review. Most reviews finish within a few hours. We will notify you as soon as it is done.`,
      'استلمنا مستندات التحقق',
      `${HI_AR}\n\nاستلمنا مستندات هويتك وهي قيد المراجعة. تنتهي معظم المراجعات خلال ساعات قليلة، وسنبلغك فور الانتهاء.`,
    ),
  },
  {
    key: 'ekyc_approved',
    category: 'A',
    topic: 'transactional',
    push: p('You are verified', 'Your account is active. You can buy from 0.001 g.', 'تم التحقق من حسابك', 'حسابك مفعّل الآن. يمكنك الشراء بدءًا من 0.001 جرام.'),
    email: e(
      'Your mngm account is active',
      `${HI_EN}\n\nYour identity is verified and your account is active.\n\nYou can start with as little as 0.001 g. Add cash to your wallet, choose gold or silver, and buy at the live price.`,
      'تم تفعيل حسابك في mngm',
      `${HI_AR}\n\nتم التحقق من هويتك وأصبح حسابك مفعّلًا.\n\nيمكنك البدء بـ 0.001 جرام فقط. أضف رصيدًا إلى محفظتك، واختر الذهب أو الفضة، واشترِ بالسعر اللحظي.`,
    ),
    sms: s('mngm: your account is verified and active. You can now buy gold from 0.001 g.', 'mngm: تم التحقق من حسابك وتفعيله. يمكنك الآن شراء الذهب بدءًا من 0.001 جرام.'),
  },
  {
    key: 'ekyc_rejected',
    category: 'A',
    topic: 'transactional',
    push: p('Verification needs a fix', 'We could not verify your ID. Tap to see why and fix it.', 'التحقق يحتاج إلى تعديل', 'لم نتمكن من التحقق من هويتك. اضغط لمعرفة السبب وتصحيحه.'),
    email: e(
      'Your verification needs one more step',
      `${HI_EN}\n\nWe could not complete your identity verification.\n\nReason: {{reason}}\n\nOpen the app to resubmit. If you need help, reply to this email or call us and an agent will walk you through it.`,
      'التحقق من هويتك يحتاج خطوة إضافية',
      `${HI_AR}\n\nلم نتمكن من إتمام التحقق من هويتك.\n\nالسبب: {{reason}}\n\nافتح التطبيق لإعادة الإرسال. إذا احتجت مساعدة، رد على هذه الرسالة أو اتصل بنا وسيرشدك أحد موظفينا.`,
    ),
    whatsapp: s(
      'mngm: we could not verify your ID ({{reason}}). Reply HELP and an agent will guide you through resubmitting.',
      'mngm: لم نتمكن من التحقق من هويتك ({{reason}}). أرسل "مساعدة" وسيرشدك أحد موظفينا لإعادة الإرسال.',
    ),
    sms: s('mngm: we could not verify your ID. Open the app to see why and resubmit: {{link}}', 'mngm: لم نتمكن من التحقق من هويتك. افتح التطبيق لمعرفة السبب وإعادة الإرسال: {{link}}'),
  },
  {
    key: 'cash_in_received',
    category: 'A',
    topic: 'transactional',
    push: p('Cash received', 'EGP {{egp amount}} added to your wallet.', 'تم استلام المبلغ', 'تمت إضافة {{egp amount}} جنيه إلى محفظتك.'),
    email: e(
      'EGP {{egp amount}} added to your wallet',
      `${HI_EN}\n\nWe received EGP {{money amount}} and added it to your mngm wallet.`,
      'تمت إضافة {{egp amount}} جنيه إلى محفظتك',
      `${HI_AR}\n\nاستلمنا مبلغ {{money amount}} جنيه وأضفناه إلى محفظتك في mngm.`,
    ),
  },
  {
    key: 'cash_out_requested',
    category: 'A',
    topic: 'transactional',
    push: p('Withdrawal requested', 'EGP {{egp amount}} withdrawal is being processed.', 'تم طلب السحب', 'جارٍ تنفيذ سحب {{egp amount}} جنيه.'),
    sms: s('mngm: withdrawal of EGP {{egp amount}} requested. If this was not you, call us now.', 'mngm: تم طلب سحب {{egp amount}} جنيه. إذا لم تكن أنت، اتصل بنا فورًا.'),
    email: e(
      'Withdrawal of EGP {{egp amount}} requested',
      `${HI_EN}\n\nWe received your request to withdraw EGP {{money amount}}. We will tell you when it is sent to your bank.\n\nIf you did not make this request, contact us immediately.`,
      'تم طلب سحب {{egp amount}} جنيه',
      `${HI_AR}\n\nاستلمنا طلبك لسحب {{money amount}} جنيه، وسنبلغك عند تحويله إلى حسابك البنكي.\n\nإذا لم تقدّم هذا الطلب، تواصل معنا فورًا.`,
    ),
  },
  {
    key: 'cash_out_executed',
    category: 'A',
    topic: 'transactional',
    push: p('Withdrawal sent', 'EGP {{egp amount}} sent to your bank account.', 'تم تحويل السحب', 'تم تحويل {{egp amount}} جنيه إلى حسابك البنكي.'),
    sms: s('mngm: EGP {{egp amount}} has been sent to your bank account.', 'mngm: تم تحويل {{egp amount}} جنيه إلى حسابك البنكي.'),
    email: e(
      'EGP {{egp amount}} sent to your bank',
      `${HI_EN}\n\nYour withdrawal of EGP {{money amount}} has been sent to your bank account. Bank processing can take up to one working day.`,
      'تم تحويل {{egp amount}} جنيه إلى بنكك',
      `${HI_AR}\n\nتم تحويل سحبك بقيمة {{money amount}} جنيه إلى حسابك البنكي. قد تستغرق معالجة البنك حتى يوم عمل واحد.`,
    ),
  },
  {
    key: 'order_placed',
    category: 'A',
    topic: 'transactional',
    push: p('Order placed', 'Your {{metal metal}} order is placed. We will confirm the price.', 'تم تقديم الطلب', 'تم تقديم طلب {{metal metal}}. سنؤكد لك السعر.'),
  },
  {
    key: 'order_executed',
    category: 'A',
    topic: 'transactional',
    push: p('Done', 'You bought {{grams grams}} g of {{metal metal}} at EGP {{egp pricePerGram}}/g.', 'تم', 'اشتريت {{grams grams}} جرام {{metal metal}} بسعر {{egp pricePerGram}} جنيه للجرام.'),
    email: e(
      'Order confirmed: {{grams grams}} g of {{metal metal}}',
      `${HI_EN}\n\nYour order is complete.\n\nMetal: {{metal metal}}\nQuantity: {{grams grams}} g\nPrice: EGP {{money pricePerGram}} per gram\nTotal: EGP {{money amount}}\nOrder: {{orderId}}\n\nYour metal is physically backed and held in insured vault storage.`,
      'تأكيد الطلب: {{grams grams}} جرام {{metal metal}}',
      `${HI_AR}\n\nتم تنفيذ طلبك.\n\nالمعدن: {{metal metal}}\nالكمية: {{grams grams}} جرام\nالسعر: {{money pricePerGram}} جنيه للجرام\nالإجمالي: {{money amount}} جنيه\nرقم الطلب: {{orderId}}\n\nمعدنك مدعوم بمعدن حقيقي ومحفوظ في خزائن مؤمَّنة.`,
    ),
  },
  {
    key: 'order_failed',
    category: 'A',
    topic: 'transactional',
    push: p('Order not completed', 'Your order did not go through. Tap to see why and retry.', 'لم يكتمل الطلب', 'لم يتم تنفيذ طلبك. اضغط لمعرفة السبب وإعادة المحاولة.'),
    sms: s('mngm: your order {{orderId}} was not completed. No money was taken. Open the app to retry.', 'mngm: لم يكتمل طلبك {{orderId}} ولم يُخصم أي مبلغ. افتح التطبيق لإعادة المحاولة.'),
    email: e(
      'Your order was not completed',
      `${HI_EN}\n\nYour order {{orderId}} was not completed.\n\nReason: {{reason}}\n\nNo money was taken. You can place the order again in the app.`,
      'لم يكتمل طلبك',
      `${HI_AR}\n\nلم يكتمل طلبك رقم {{orderId}}.\n\nالسبب: {{reason}}\n\nلم يُخصم أي مبلغ، ويمكنك تقديم الطلب مرة أخرى من التطبيق.`,
    ),
  },
  {
    key: 'order_cancelled',
    category: 'A',
    topic: 'transactional',
    push: p('Order cancelled', 'Order {{orderId}} was cancelled. No money was taken.', 'تم إلغاء الطلب', 'تم إلغاء الطلب {{orderId}} ولم يُخصم أي مبلغ.'),
    sms: s('mngm: order {{orderId}} was cancelled. No money was taken.', 'mngm: تم إلغاء الطلب {{orderId}} ولم يُخصم أي مبلغ.'),
    email: e(
      'Order {{orderId}} cancelled',
      `${HI_EN}\n\nOrder {{orderId}} was cancelled. {{reason}}\n\nNo money was taken.`,
      'تم إلغاء الطلب {{orderId}}',
      `${HI_AR}\n\nتم إلغاء الطلب {{orderId}}. {{reason}}\n\nلم يُخصم أي مبلغ.`,
    ),
  },
  {
    key: 'conversion_accepted',
    category: 'A',
    topic: 'transactional',
    push: p('Physical request accepted', 'We accepted your request for {{grams grams}} g of physical {{metal metal}}.', 'تم قبول طلب الاستلام', 'قبلنا طلبك لاستلام {{grams grams}} جرام {{metal metal}}.'),
  },
  {
    key: 'conversion_ready',
    category: 'A',
    topic: 'transactional',
    push: p('Ready for delivery', 'Your physical {{metal metal}} is ready. We will schedule delivery.', 'جاهز للتسليم', 'معدنك جاهز. سنحدد موعد التسليم معك.'),
  },
  {
    key: 'conversion_dispatched',
    category: 'A',
    topic: 'transactional',
    push: p('On its way', 'Your {{metal metal}} is on its way. Courier: {{courierName}}.', 'في الطريق إليك', 'معدنك في الطريق. المندوب: {{courierName}}.'),
    sms: s('mngm: your {{metal metal}} is on its way. Courier {{courierName}}, {{courierPhone}}. Keep your ID ready.', 'mngm: معدنك في الطريق. المندوب {{courierName}}، {{courierPhone}}. جهّز بطاقة هويتك.'),
  },
  {
    key: 'conversion_delivered',
    category: 'A',
    topic: 'transactional',
    push: p('Delivered', 'Your physical {{metal metal}} was delivered.', 'تم التسليم', 'تم تسليم معدنك.'),
  },
  {
    key: 'delivery_scheduled',
    category: 'A',
    topic: 'transactional',
    sms: s('mngm: delivery booked for {{date slotAt}} at {{time slotAt}}. Courier {{courierName}}, {{courierPhone}}.', 'mngm: تم حجز التسليم يوم {{date slotAt}} الساعة {{time slotAt}}. المندوب {{courierName}}، {{courierPhone}}.'),
    push: p('Delivery booked', 'Delivery on {{date slotAt}} at {{time slotAt}}.', 'تم حجز التسليم', 'التسليم يوم {{date slotAt}} الساعة {{time slotAt}}.'),
    whatsapp: s(
      'mngm: your delivery is booked for {{date slotAt}} at {{time slotAt}}. Courier {{courierName}} will call from {{courierPhone}}. Reply here to change the time.',
      'mngm: تم حجز التسليم يوم {{date slotAt}} الساعة {{time slotAt}}. سيتصل بك المندوب {{courierName}} من {{courierPhone}}. رد هنا لتغيير الموعد.',
    ),
  },
  {
    key: 'delivery_reminder',
    category: 'A',
    topic: 'transactional',
    sms: s('mngm: your delivery arrives in about 2 hours. Courier {{courierName}}, {{courierPhone}}. Keep your ID ready.', 'mngm: يصل التسليم خلال ساعتين تقريبًا. المندوب {{courierName}}، {{courierPhone}}. جهّز بطاقة هويتك.'),
  },
  {
    key: 'upload_received',
    category: 'A',
    topic: 'transactional',
    push: p('Upload received', 'We received your {{metal metal}} for assay.', 'تم استلام المعدن', 'استلمنا {{metal metal}} الخاص بك للفحص.'),
    email: e('We received your metal', `${HI_EN}\n\nWe received your {{metal metal}} and it is now with the refinery for assay. We will tell you the result.`, 'استلمنا معدنك', `${HI_AR}\n\nاستلمنا {{metal metal}} الخاص بك وهو الآن لدى المصفاة للفحص. سنبلغك بالنتيجة.`),
  },
  {
    key: 'upload_assayed',
    category: 'A',
    topic: 'transactional',
    push: p('Assay complete', 'Assay result: {{grams grams}} g at {{purity}} purity.', 'اكتمل الفحص', 'نتيجة الفحص: {{grams grams}} جرام بعيار {{purity}}.'),
    email: e('Assay complete', `${HI_EN}\n\nThe refinery completed the assay: {{grams grams}} g of {{metal metal}} at {{purity}} purity. We will add it to your holding shortly.`, 'اكتمل الفحص', `${HI_AR}\n\nأتمت المصفاة الفحص: {{grams grams}} جرام {{metal metal}} بعيار {{purity}}. سنضيفه إلى حسابك قريبًا.`),
  },
  {
    key: 'upload_credited',
    category: 'A',
    topic: 'transactional',
    push: p('Added to your holding', '{{grams grams}} g of {{metal metal}} added to your holding.', 'أضيف إلى رصيدك', 'تمت إضافة {{grams grams}} جرام {{metal metal}} إلى رصيدك.'),
    email: e('{{grams grams}} g added to your holding', `${HI_EN}\n\n{{grams grams}} g of {{metal metal}} from your upload is now in your mngm holding.`, 'تمت إضافة {{grams grams}} جرام إلى رصيدك', `${HI_AR}\n\nأصبح {{grams grams}} جرام {{metal metal}} من المعدن الذي سلّمته ضمن رصيدك في mngm.`),
  },
  {
    key: 'gift_sent',
    category: 'A',
    topic: 'transactional',
    push: p('Gift sent', 'You sent {{grams grams}} g of {{metal metal}} to {{recipientName}}.', 'تم إرسال الهدية', 'أرسلت {{grams grams}} جرام {{metal metal}} إلى {{recipientName}}.'),
    email: e('Your gift was sent', `${HI_EN}\n\nYou sent {{grams grams}} g of {{metal metal}} to {{recipientName}}. We let them know.`, 'تم إرسال هديتك', `${HI_AR}\n\nأرسلت {{grams grams}} جرام {{metal metal}} إلى {{recipientName}}، وأبلغناه بذلك.`),
  },
  {
    key: 'gift_received',
    category: 'A',
    topic: 'transactional',
    push: p('You received a gift', '{{senderName}} sent you {{grams grams}} g of {{metal metal}}.', 'وصلتك هدية', 'أرسل لك {{senderName}} {{grams grams}} جرام {{metal metal}}.'),
    sms: s('mngm: {{senderName}} sent you {{grams grams}} g of {{metal metal}}. It is in your mngm holding.', 'mngm: أرسل لك {{senderName}} هدية {{grams grams}} جرام {{metal metal}}. أصبحت ضمن رصيدك في mngm.'),
    email: e('You received a gift of {{metal metal}}', `${HI_EN}\n\n{{senderName}} sent you {{grams grams}} g of {{metal metal}}. It is already in your mngm holding.`, 'وصلتك هدية من {{metal metal}}', `${HI_AR}\n\nأرسل لك {{senderName}} {{grams grams}} جرام {{metal metal}}، وأصبحت ضمن رصيدك في mngm.`),
  },
  {
    key: 'gift_received_invite',
    category: 'A',
    topic: 'transactional',
    sms: s('{{senderName}} sent you {{grams grams}} g of real {{metal metal}} on mngm. Claim it here: {{webLink}}/gifts', 'أرسل لك {{senderName}} هدية {{grams grams}} جرام {{metal metal}} حقيقي على mngm. استلمها من هنا: {{webLink}}/gifts'),
  },
  {
    key: 'plan_created',
    category: 'A',
    topic: 'transactional',
    push: p('Monthly plan set', 'Your plan buys {{metal metal}} for EGP {{egp amount}} each month.', 'تم إعداد خطتك الشهرية', 'ستشتري خطتك {{metal metal}} بقيمة {{egp amount}} جنيه كل شهر.'),
    email: e(
      'Your monthly plan is set',
      `${HI_EN}\n\nYour monthly plan is set: EGP {{money amount}} of {{metal metal}} on day {{dayOfMonth}} of each month.\n\nWe will remind you two days before each purchase. No debt, no interest — you own real metal, gram by gram. You can pause or stop the plan at any time.`,
      'تم إعداد خطتك الشهرية',
      `${HI_AR}\n\nتم إعداد خطتك الشهرية: {{money amount}} جنيه من {{metal metal}} في اليوم {{dayOfMonth}} من كل شهر.\n\nسنذكّرك قبل كل عملية شراء بيومين. بلا ديون وبلا فوائد — تمتلك معدنًا حقيقيًا جرامًا بعد جرام. يمكنك إيقاف الخطة أو تعديلها في أي وقت.`,
    ),
  },
  {
    key: 'plan_cancelled',
    category: 'A',
    topic: 'transactional',
    push: p('Plan stopped', 'Your monthly plan is stopped. Your holding stays yours.', 'تم إيقاف الخطة', 'تم إيقاف خطتك الشهرية. رصيدك يبقى ملكك.'),
    email: e('Your monthly plan is stopped', `${HI_EN}\n\nYour monthly plan is stopped. Everything you accumulated stays in your holding. You can start a new plan whenever you like.`, 'تم إيقاف خطتك الشهرية', `${HI_AR}\n\nتم إيقاف خطتك الشهرية. كل ما جمعته يبقى في رصيدك، ويمكنك بدء خطة جديدة متى شئت.`),
  },
  {
    key: 'plan_debit_reminder',
    category: 'A',
    topic: 'transactional',
    push: p('Plan buys in 2 days', 'Your plan buys in 2 days. Balance needed: EGP {{egp amount}}. Top up.', 'خطتك تشتري بعد يومين', 'خطتك تشتري بعد يومين. الرصيد المطلوب: {{egp amount}} جنيه.'),
    sms: s('mngm: your monthly plan buys in 2 days. Balance needed: EGP {{egp amount}}. Top up: {{link}}', 'mngm: خطتك الشهرية تشتري بعد يومين. الرصيد المطلوب: {{egp amount}} جنيه. اشحن رصيدك: {{link}}'),
  },
  {
    key: 'plan_debit_succeeded',
    category: 'A',
    topic: 'transactional',
    push: p('Plan purchase done', 'Your plan bought {{grams grams}} g. {{consecutiveMonths}} months in a row.', 'تم شراء الخطة', 'اشترت خطتك {{grams grams}} جرام. {{consecutiveMonths}} شهور متتالية.'),
    email: e('Your monthly plan bought {{grams grams}} g', `${HI_EN}\n\nThis month's plan purchase is done: {{grams grams}} g for EGP {{money amount}}. That is {{consecutiveMonths}} months in a row.`, 'اشترت خطتك {{grams grams}} جرام', `${HI_AR}\n\nتم شراء خطتك لهذا الشهر: {{grams grams}} جرام مقابل {{money amount}} جنيه. هذا هو الشهر رقم {{consecutiveMonths}} على التوالي.`),
  },
  {
    key: 'plan_debit_failed',
    category: 'A',
    topic: 'transactional',
    push: p('Plan not funded', 'Your plan could not be funded today. Add EGP {{egp amount}} to retry.', 'لم تُنفَّذ خطتك', 'تعذر تنفيذ خطتك اليوم. أضف {{egp amount}} جنيه لإعادة المحاولة.'),
    email: e(
      'Your monthly plan could not be funded',
      `${HI_EN}\n\nYour monthly plan could not be funded today.\n\nReason: {{reason}}\n\nAdd EGP {{money amount}} to your wallet and we will retry tomorrow. Your plan stays active.`,
      'تعذر تنفيذ خطتك الشهرية',
      `${HI_AR}\n\nتعذر تنفيذ خطتك الشهرية اليوم.\n\nالسبب: {{reason}}\n\nأضف {{money amount}} جنيه إلى محفظتك وسنعيد المحاولة غدًا. خطتك ما زالت مفعّلة.`,
    ),
    sms: s('mngm: your monthly plan could not be funded again. Add EGP {{egp amount}} to keep it going: {{link}}', 'mngm: تعذر تنفيذ خطتك الشهرية مرة أخرى. أضف {{egp amount}} جنيه للحفاظ عليها: {{link}}'),
  },
  {
    key: 'plan_debit_failed_followup',
    category: 'A',
    topic: 'transactional',
    push: p('Plan still waiting', 'Your plan is waiting for EGP {{egp amount}}. One tap to top up.', 'خطتك بانتظار الرصيد', 'خطتك بانتظار {{egp amount}} جنيه. اشحن رصيدك بضغطة واحدة.'),
    sms: s('mngm: your monthly plan is still waiting for EGP {{egp amount}}. Top up to keep your streak: {{link}}', 'mngm: خطتك الشهرية ما زالت بانتظار {{egp amount}} جنيه. اشحن رصيدك للحفاظ على استمراريتها: {{link}}'),
  },
  {
    key: 'security_new_device',
    category: 'A',
    topic: 'transactional',
    sms: s('mngm: new sign-in on {{device}}. If this was not you, call us now and change your password.', 'mngm: تسجيل دخول جديد من {{device}}. إذا لم تكن أنت، اتصل بنا فورًا وغيّر كلمة المرور.'),
    push: p('New sign-in', 'New sign-in on {{device}}. Not you? Tap to secure your account.', 'تسجيل دخول جديد', 'دخول جديد من {{device}}. لست أنت؟ اضغط لتأمين حسابك.'),
    email: e('New sign-in to your mngm account', `${HI_EN}\n\nYour account was accessed from a new device: {{device}}.\n\nIf this was you, no action is needed. If not, change your password and contact us immediately.`, 'تسجيل دخول جديد إلى حسابك', `${HI_AR}\n\nتم الدخول إلى حسابك من جهاز جديد: {{device}}.\n\nإذا كنت أنت فلا حاجة لأي إجراء. وإلا فغيّر كلمة المرور وتواصل معنا فورًا.`),
  },
  {
    key: 'security_password_changed',
    category: 'A',
    topic: 'transactional',
    sms: s('mngm: your password was changed. If this was not you, call us now.', 'mngm: تم تغيير كلمة المرور. إذا لم تكن أنت، اتصل بنا فورًا.'),
    push: p('Password changed', 'Your password was changed. Not you? Tap to secure your account.', 'تم تغيير كلمة المرور', 'تم تغيير كلمة المرور. لست أنت؟ اضغط لتأمين حسابك.'),
    email: e('Your mngm password was changed', `${HI_EN}\n\nYour password was changed. If you did not do this, contact us immediately.`, 'تم تغيير كلمة المرور', `${HI_AR}\n\nتم تغيير كلمة المرور الخاصة بك. إذا لم تقم بذلك، تواصل معنا فورًا.`),
  },
  {
    key: 'security_bank_changed',
    category: 'A',
    topic: 'transactional',
    sms: s('mngm: your bank details were changed. If this was not you, call us now.', 'mngm: تم تغيير بياناتك البنكية. إذا لم تكن أنت، اتصل بنا فورًا.'),
    push: p('Bank details changed', 'Your bank details were changed. Not you? Tap now.', 'تغيير البيانات البنكية', 'تم تغيير بياناتك البنكية. لست أنت؟ اضغط الآن.'),
    email: e('Your bank details were changed', `${HI_EN}\n\nThe bank account linked to your mngm wallet was changed. Withdrawals will go to the new account.\n\nIf you did not do this, contact us immediately.`, 'تم تغيير بياناتك البنكية', `${HI_AR}\n\nتم تغيير الحساب البنكي المرتبط بمحفظتك في mngm، وستُحوَّل عمليات السحب إلى الحساب الجديد.\n\nإذا لم تقم بذلك، تواصل معنا فورًا.`),
  },
  {
    key: 'monthly_statement',
    category: 'A',
    topic: 'transactional',
    email: e(
      'Your mngm statement for {{period}}',
      `${HI_EN}\n\nYour statement for {{period}} is attached.\n\nGold: {{grams gold}} g\nSilver: {{grams silver}} g\nCash: EGP {{money cash}}\n\nValuations use the price at the time the statement was produced. ${PRICE_NOTE_EN}`,
      'كشف حسابك في mngm عن {{period}}',
      `${HI_AR}\n\nمرفق كشف حسابك عن {{period}}.\n\nالذهب: {{grams gold}} جرام\nالفضة: {{grams silver}} جرام\nالنقد: {{money cash}} جنيه\n\nالتقييم بالسعر وقت إصدار الكشف. ${PRICE_NOTE_AR}`,
    ),
  },
  {
    key: 'plan_statement',
    category: 'A',
    topic: 'transactional',
    push: p('Your plan this month', 'See grams accumulated, average cost and value for {{period}}.', 'خطتك هذا الشهر', 'اطّلع على الجرامات المتراكمة ومتوسط التكلفة والقيمة عن {{period}}.'),
    inapp: p('Monthly plan statement', 'Your plan statement for {{period}} is ready: grams accumulated, average cost per gram and current value.', 'كشف الخطة الشهرية', 'كشف خطتك عن {{period}} جاهز: الجرامات المتراكمة ومتوسط تكلفة الجرام والقيمة الحالية.'),
    deepLink: '/plans',
  },
  {
    key: 'zakat_summary',
    category: 'A',
    topic: 'transactional',
    email: e(
      'Your {{year}} holdings and zakat summary',
      `${HI_EN}\n\nYour annual holdings summary for zakat and tax purposes is ready in the app. It shows your gold and silver holdings and their value on the reference date.\n\nUse the zakat calculator in the app to work out what is due.`,
      'ملخص أرصدتك والزكاة لعام {{year}}',
      `${HI_AR}\n\nملخص أرصدتك السنوي لأغراض الزكاة والضرائب متاح الآن في التطبيق، ويوضح أرصدتك من الذهب والفضة وقيمتها في التاريخ المرجعي.\n\nاستخدم حاسبة الزكاة في التطبيق لمعرفة المستحق.`,
    ),
    inapp: p('Zakat summary {{year}}', 'Your annual holdings summary is ready. Use the zakat calculator to see what is due.', 'ملخص الزكاة {{year}}', 'ملخص أرصدتك السنوي جاهز. استخدم حاسبة الزكاة لمعرفة المستحق.'),
    deepLink: '/zakat',
  },

  // ══ Category B — price and market ════════════════════════════════════════
  {
    key: 'daily_price',
    category: 'B',
    topic: 'price_daily',
    push: p('Today\'s prices', 'Gold EGP {{egp goldPrice}}/g ({{pct goldChange}}%), silver EGP {{money silverPrice}}/g.', 'أسعار اليوم', 'الذهب {{egp goldPrice}} ج/جم ({{pct goldChange}}%)، الفضة {{money silverPrice}} ج/جم.'),
    whatsapp: s(
      `mngm prices at {{time priceTime}}: gold EGP {{egp goldPrice}}/g ({{pct goldChange}}% today), silver EGP {{money silverPrice}}/g ({{pct silverChange}}%). ${PRICE_NOTE_EN}`,
      `أسعار mngm الساعة {{time priceTime}}: الذهب {{egp goldPrice}} جنيه للجرام ({{pct goldChange}}% اليوم)، الفضة {{money silverPrice}} جنيه للجرام ({{pct silverChange}}%). ${PRICE_NOTE_AR}`,
    ),
  },
  {
    key: 'price_alert',
    category: 'B',
    topic: 'price_alerts',
    push: p('Your price alert', '{{metal metal}} is at EGP {{egp price}}/g. You asked to be told at {{egp level}}.', 'تنبيه السعر', '{{metal metal}} الآن {{egp price}} ج/جم. طلبت التنبيه عند {{egp level}}.'),
    sms: s('mngm alert: {{metal metal}} is at EGP {{egp price}}/g ({{pct changePct}}%). You asked to be told at {{egp level}}.', 'تنبيه mngm: {{metal metal}} الآن {{egp price}} جنيه للجرام ({{pct changePct}}%). طلبت التنبيه عند {{egp level}}.'),
  },
  {
    key: 'volatility_alert',
    category: 'B',
    topic: 'price_alerts',
    push: p('Big move today', '{{metal metal}} moved {{pct changePct}}% today to EGP {{egp price}}/g.', 'تحرك كبير اليوم', 'تحرك {{metal metal}} بنسبة {{pct changePct}}% اليوم إلى {{egp price}} ج/جم.'),
  },
  {
    key: 'dip_alert',
    category: 'B',
    topic: 'price_alerts',
    push: p('Price below 7-day average', '{{metal metal}} is {{pct changePct}}% under its 7-day average.', 'السعر أقل من متوسط 7 أيام', '{{metal metal}} أقل من متوسط 7 أيام بنسبة {{pct changePct}}%.'),
  },

  // ══ Category F — service notices (mandatory) ═════════════════════════════
  {
    key: 'trading_paused',
    category: 'F',
    topic: 'service_notice',
    push: p('Trading paused', 'Trading is paused while we verify prices. Your holdings are safe.', 'التداول متوقف مؤقتًا', 'التداول متوقف أثناء التحقق من الأسعار. أرصدتك آمنة.'),
    email: e(
      'Trading is paused while we verify prices',
      `${HI_EN}\n\nOur price feed is being verified, so buying and selling are paused for now.\n\nWhat you can still do: view your holdings, add cash, and request withdrawals.\nWhat is paused: buy, sell, and plan purchases.\n\nYour holdings and cash are safe. We will notify you as soon as trading resumes.`,
      'التداول متوقف مؤقتًا أثناء التحقق من الأسعار',
      `${HI_AR}\n\nنتحقق حاليًا من مصدر الأسعار، لذلك أوقفنا الشراء والبيع مؤقتًا.\n\nما يمكنك فعله: عرض أرصدتك، وإضافة رصيد، وطلب السحب.\nما توقف مؤقتًا: الشراء والبيع ومشتريات الخطط.\n\nأرصدتك ونقودك آمنة، وسنبلغك فور استئناف التداول.`,
    ),
  },
  {
    key: 'price_feed_restored',
    category: 'F',
    topic: 'service_notice',
    push: p('Trading resumed', 'Prices are verified and trading has resumed.', 'استؤنف التداول', 'تم التحقق من الأسعار واستؤنف التداول.'),
  },
  {
    key: 'incident_notice',
    category: 'F',
    topic: 'service_notice',
    push: p('Service update', '{{message_en}}', 'تحديث الخدمة', '{{message_ar}}'),
    email: e('mngm service update', `${HI_EN}\n\n{{message_en}}\n\nWe will update you every hour until this is resolved.`, 'تحديث بشأن خدمة mngm', `${HI_AR}\n\n{{message_ar}}\n\nسنوافيك بالتحديثات كل ساعة حتى يتم الحل.`),
    deepLink: '/status',
  },
  {
    key: 'incident_resolved',
    category: 'F',
    topic: 'service_notice',
    push: p('Resolved', '{{message_en}}', 'تم الحل', '{{message_ar}}'),
    email: e('Resolved: mngm service update', `${HI_EN}\n\n{{message_en}}\n\nIf an order of yours was affected, we will contact you with the specific outcome for your account.`, 'تم الحل: تحديث خدمة mngm', `${HI_AR}\n\n{{message_ar}}\n\nإذا تأثر أي من طلباتك، سنتواصل معك بالنتيجة الخاصة بحسابك.`),
    deepLink: '/status',
  },
  {
    key: 'maintenance_notice',
    category: 'F',
    topic: 'service_notice',
    push: p('Planned maintenance', '{{message_en}}', 'صيانة مجدولة', '{{message_ar}}'),
    email: e('Planned maintenance', `${HI_EN}\n\n{{message_en}}`, 'صيانة مجدولة', `${HI_AR}\n\n{{message_ar}}`),
    deepLink: '/status',
  },
  {
    key: 'fee_change_notice',
    category: 'F',
    topic: 'service_notice',
    email: e(
      'A change to mngm fees from {{date effectiveDate}}',
      `${HI_EN}\n\nFrom {{date effectiveDate}}, {{changeSummary_en}}\n\nThe full fee schedule is in the app and on our website. Nothing changes before that date.`,
      'تغيير في رسوم mngm اعتبارًا من {{date effectiveDate}}',
      `${HI_AR}\n\nاعتبارًا من {{date effectiveDate}}، {{changeSummary_ar}}\n\nجدول الرسوم الكامل متاح في التطبيق وعلى موقعنا. لا يتغير شيء قبل هذا التاريخ.`,
    ),
    push: p('Fee update', 'Our fees change on {{date effectiveDate}}. Tap for details.', 'تحديث الرسوم', 'تتغير رسومنا في {{date effectiveDate}}. اضغط للتفاصيل.'),
    deepLink: '/fees',
  },
  {
    key: 'terms_notice',
    category: 'F',
    topic: 'service_notice',
    email: e('Updates to the mngm terms', `${HI_EN}\n\nWe are updating our terms, effective {{date effectiveDate}}.\n\n{{summary_en}}\n\nThe full terms are available in the app.`, 'تحديث شروط mngm', `${HI_AR}\n\nنحدّث شروطنا اعتبارًا من {{date effectiveDate}}.\n\n{{summary_ar}}\n\nالشروط الكاملة متاحة في التطبيق.`),
  },

  // ══ Category F — feedback ════════════════════════════════════════════════
  {
    key: 'csat_order',
    category: 'F',
    topic: 'feedback',
    push: p('One quick question', 'How was your last order? Tap to rate it — one question.', 'سؤال واحد سريع', 'كيف كانت تجربتك في طلبك الأخير؟ اضغط للتقييم.'),
  },
  {
    key: 'csat_contact',
    category: 'F',
    topic: 'feedback',
    sms: s('mngm: how did we do on your call today? Reply 1 (poor) to 5 (excellent).', 'mngm: كيف كانت خدمتنا في مكالمتك اليوم؟ رد برقم من 1 (ضعيف) إلى 5 (ممتاز).'),
  },
  {
    key: 'nps_quarterly',
    category: 'F',
    topic: 'feedback',
    email: e('How likely are you to recommend mngm?', `${HI_EN}\n\nOn a scale of 0 to 10, how likely are you to recommend mngm to a friend? It takes 10 seconds and tells us what to improve.`, 'ما مدى احتمال أن توصي بـ mngm؟', `${HI_AR}\n\nعلى مقياس من 0 إلى 10، ما مدى احتمال أن توصي بـ mngm لصديق؟ يستغرق 10 ثوانٍ ويساعدنا على التحسين.`),
    deepLink: '/survey/nps_quarterly',
  },
  {
    key: 'exit_survey',
    category: 'F',
    topic: 'feedback',
    email: e('Before you go — one question', `${HI_EN}\n\nWe are sorry to see you go. Could you tell us the main reason? It takes 30 seconds and helps us improve.`, 'قبل أن تغادر — سؤال واحد', `${HI_AR}\n\nيؤسفنا رحيلك. هل يمكنك إخبارنا بالسبب الرئيسي؟ يستغرق 30 ثانية ويساعدنا على التحسين.`),
    deepLink: '/survey/exit',
  },

  // ══ 7.1 Activation journey ═══════════════════════════════════════════════
  {
    key: 'act_t1',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/kyc',
    push: p('One step left', 'One step left before you can buy. Verification takes about 3 minutes.', 'خطوة واحدة متبقية', 'خطوة واحدة قبل أن تبدأ الشراء. التحقق يستغرق نحو 3 دقائق.'),
    email: e(
      'One step left before you can buy',
      `${HI_EN}\n\nYou are one step away from owning real gold on mngm.\n\nWhat you need: your national ID and your phone camera.\nHow long it takes: about 3 minutes.\n\nIf you stop half way, you can continue where you left off.`,
      'خطوة واحدة قبل أن تبدأ الشراء',
      `${HI_AR}\n\nأنت على بعد خطوة واحدة من امتلاك ذهب حقيقي على mngm.\n\nما تحتاجه: بطاقتك القومية وكاميرا هاتفك.\nالمدة: نحو 3 دقائق.\n\nإذا توقفت في المنتصف، يمكنك المتابعة من حيث توقفت.`,
    ),
  },
  {
    key: 'act_t2',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/kyc',
    sms: s('mngm: finish verifying your ID in about 3 minutes and start from 0.001 g: {{link}}', 'mngm: أكمل التحقق من هويتك في نحو 3 دقائق وابدأ من 0.001 جرام: {{link}}'),
  },
  {
    key: 'act_t3',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/about/trust',
    push: p('Why we ask for your ID', 'Your gold is real, vaulted and insured. See how we protect it.', 'لماذا نطلب هويتك', 'ذهبك حقيقي ومحفوظ في خزائن مؤمَّنة. تعرّف كيف نحميه.'),
  },
  {
    key: 'act_t5',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/kyc',
    whatsapp: s(
      'Hello {{firstName}}, this is mngm. Need a hand finishing your ID verification? Reply here and one of our team will guide you step by step.',
      'مرحبًا {{firstName}}، معك mngm. هل تحتاج مساعدة لإكمال التحقق من هويتك؟ رد هنا وسيرشدك أحد أفراد فريقنا خطوة بخطوة.',
    ),
  },
  {
    key: 'act_offer',
    category: 'D',
    topic: 'promotions',
    deepLink: '/kyc',
    push: p('A welcome bonus for you', 'Verify your ID and get bonus gold on your first purchase. Ends in 30 days.', 'مكافأة ترحيب لك', 'أكمل التحقق واحصل على ذهب إضافي مع أول شراء. ينتهي العرض خلال 30 يومًا.'),
    sms: s('mngm: verify your ID and get bonus gold on your first purchase. Offer ends in 30 days. Terms apply: {{link}}', 'mngm: أكمل التحقق من هويتك واحصل على ذهب إضافي مع أول شراء. ينتهي العرض خلال 30 يومًا. تطبق الشروط: {{link}}'),
  },
  {
    key: 'act_offer_last',
    category: 'D',
    topic: 'promotions',
    deepLink: '/kyc',
    push: p('Your bonus is still waiting', 'Your first-purchase gold bonus is still available. Verify to claim it.', 'مكافأتك ما زالت متاحة', 'مكافأة الذهب مع أول شراء ما زالت متاحة. أكمل التحقق للحصول عليها.'),
    sms: s('mngm: your first-purchase gold bonus is still available for a short time. Verify your ID to claim it: {{link}}', 'mngm: مكافأة الذهب مع أول شراء ما زالت متاحة لفترة قصيرة. أكمل التحقق للحصول عليها: {{link}}'),
  },
  {
    key: 'act_survey',
    category: 'F',
    topic: 'feedback',
    deepLink: '/survey/activation_dropoff',
    sms: s('mngm: what stopped you finishing verification? 4 options, 20 seconds: {{link}}', 'mngm: ما الذي منعك من إكمال التحقق؟ 4 خيارات و20 ثانية: {{link}}'),
    email: e(
      'What stopped you?',
      `${HI_EN}\n\nYou started with mngm but did not finish verification. Tell us why — it takes 20 seconds:\n\n1. I did not want to share my ID\n2. The process felt too long\n3. I was not sure I could trust it\n4. I am not ready to invest yet\n\nOr tell us in your own words.`,
      'ما الذي أوقفك؟',
      `${HI_AR}\n\nبدأت مع mngm لكنك لم تكمل التحقق. أخبرنا بالسبب — يستغرق 20 ثانية:\n\n1. لم أرغب في مشاركة هويتي\n2. شعرت أن الخطوات طويلة\n3. لم أكن متأكدًا من الثقة\n4. لست مستعدًا للاستثمار بعد\n\nأو أخبرنا بكلماتك.`,
    ),
  },

  // ══ 7.2 First purchase (+ new client education pack) ═════════════════════
  {
    key: 'fp_d0',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/buy',
    push: p('Start small', 'You can start with 0.001 g. Add any amount and buy at the live price.', 'ابدأ بمبلغ صغير', 'يمكنك البدء بـ 0.001 جرام. أضف أي مبلغ واشترِ بالسعر اللحظي.'),
  },
  {
    key: 'fp_d2',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/buy',
    push: p('Your first gram', 'Your first purchase can be as small as you like. See today\'s price.', 'جرامك الأول', 'يمكن أن يكون شراؤك الأول بأي مبلغ تريده. اطّلع على سعر اليوم.'),
  },
  {
    key: 'fp_d10',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/buy',
    push: p('Still deciding?', 'Questions before your first purchase? Tap for answers or to chat with us.', 'ما زلت تفكر؟', 'لديك أسئلة قبل أول شراء؟ اضغط للإجابات أو للتحدث معنا.'),
  },
  {
    key: 'edu_1',
    category: 'E',
    topic: 'education',
    deepLink: '/learn/how-mngm-works',
    email: e(
      'How mngm works: real metal, gram by gram',
      `${HI_EN}\n\nEvery gram you buy on mngm is real metal, refined by an RJC-certified refinery and held in insured vault storage.\n\nYou can buy from 0.001 g, sell back at any time, or take delivery of physical bars.\n\nNext in this series: how the price is set.`,
      'كيف تعمل mngm: معدن حقيقي جرامًا بعد جرام',
      `${HI_AR}\n\nكل جرام تشتريه على mngm هو معدن حقيقي، تكرره مصفاة معتمدة من RJC، ويُحفظ في خزائن مؤمَّنة.\n\nيمكنك الشراء بدءًا من 0.001 جرام، والبيع في أي وقت، أو استلام سبائك فعلية.\n\nفي الرسالة القادمة: كيف يتحدد السعر.`,
    ),
  },
  {
    key: 'edu_2',
    category: 'E',
    topic: 'education',
    deepLink: '/learn/pricing',
    email: e(
      'How the gold price on mngm is set',
      `${HI_EN}\n\nThe price you see follows the international gold price and the exchange rate of the pound, plus a published spread.\n\nWhat moves it: global demand, interest rates, and the EGP. ${PRICE_NOTE_EN}\n\nNext: how to sell or take delivery.`,
      'كيف يتحدد سعر الذهب على mngm',
      `${HI_AR}\n\nيتبع السعر الذي تراه السعر العالمي للذهب وسعر صرف الجنيه، مضافًا إليه هامش معلن.\n\nما يحركه: الطلب العالمي وأسعار الفائدة وسعر الجنيه. ${PRICE_NOTE_AR}\n\nفي الرسالة القادمة: كيف تبيع أو تستلم معدنك.`,
    ),
  },
  {
    key: 'edu_3',
    category: 'E',
    topic: 'education',
    deepLink: '/learn/sell-and-delivery',
    email: e(
      'Selling, buy-back and delivery',
      `${HI_EN}\n\nYour metal is yours. You can sell it back to mngm at the live price whenever you want, and the cash lands in your wallet.\n\nYou can also convert to physical bars and have them delivered.\n\nQuestions? Reply to this email.`,
      'البيع وإعادة الشراء والاستلام',
      `${HI_AR}\n\nمعدنك ملكك. يمكنك بيعه لـ mngm بالسعر اللحظي متى شئت ويصل المبلغ إلى محفظتك.\n\nويمكنك أيضًا تحويله إلى سبائك فعلية واستلامها.\n\nلديك أسئلة؟ رد على هذه الرسالة.`,
    ),
  },

  // ══ 7.2 Second purchase ══════════════════════════════════════════════════
  {
    key: 'sp_d7',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/prices/{{metal}}',
    push: p('Your first week', 'See how {{metal metal}} moved since your purchase and what drove it.', 'أسبوعك الأول', 'تعرّف كيف تحرك {{metal metal}} منذ شرائك وما الذي حركه.'),
  },
  {
    key: 'sp_d21',
    category: 'E',
    topic: 'education',
    deepLink: '/learn',
    email: e(
      'What drives the {{metal metal}} price',
      `${HI_EN}\n\nYou own {{metal metal}} on mngm. Here is what moves its price: global demand, interest rates, and the pound.\n\n${PRICE_NOTE_EN}\n\nRead the full article in the app.`,
      'ما الذي يحرك سعر {{metal metal}}',
      `${HI_AR}\n\nأنت تمتلك {{metal metal}} على mngm. إليك ما يحرك سعره: الطلب العالمي وأسعار الفائدة وسعر الجنيه.\n\n${PRICE_NOTE_AR}\n\nاقرأ المقال كاملًا في التطبيق.`,
    ),
  },
  {
    key: 'sp_d45',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/plans/new',
    push: p('Make it a habit', 'Set aside what you can each month and own gold, gram by gram.', 'اجعلها عادة', 'خصص ما تستطيع كل شهر وامتلك الذهب جرامًا بعد جرام.'),
    email: e(
      'Own gold gram by gram, every month',
      `${HI_EN}\n\nA monthly plan buys gold for you on the day you choose, with the amount you choose.\n\nNo debt, no interest. You own real gold, gram by gram, and you can pause or stop at any time.`,
      'امتلك الذهب جرامًا بعد جرام كل شهر',
      `${HI_AR}\n\nالخطة الشهرية تشتري لك الذهب في اليوم الذي تختاره وبالمبلغ الذي تحدده.\n\nبلا ديون وبلا فوائد. تمتلك ذهبًا حقيقيًا جرامًا بعد جرام، ويمكنك الإيقاف أو التعديل في أي وقت.`,
    ),
  },

  // ══ 7.3 Recurring plan cross-sell ════════════════════════════════════════
  {
    key: 'rp_x1',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/plans/new',
    push: p('Set it and forget it', 'Buy gold automatically each month. You choose the amount and day.', 'اضبطها وانسَها', 'اشترِ الذهب تلقائيًا كل شهر. أنت تختار المبلغ واليوم.'),
    email: e(
      'Set aside what you can, every month',
      `${HI_EN}\n\nYou have bought gold more than once — a monthly plan does it for you.\n\nChoose an amount and a day. We remind you two days before each purchase. No debt, no interest. Stop or change it whenever you want.`,
      'خصص ما تستطيع كل شهر',
      `${HI_AR}\n\nاشتريت الذهب أكثر من مرة — الخطة الشهرية تفعل ذلك نيابة عنك.\n\nاختر المبلغ واليوم، وسنذكّرك قبل كل شراء بيومين. بلا ديون وبلا فوائد. يمكنك الإيقاف أو التعديل متى شئت.`,
    ),
  },
  {
    key: 'rp_x2',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/plans/new',
    push: p('Gram by gram', 'A monthly plan from EGP 500. Pause or stop any time.', 'جرامًا بعد جرام', 'خطة شهرية تبدأ من 500 جنيه. أوقفها متى شئت.'),
  },

  // ══ 7.4 Former instalment-finance clients ════════════════════════════════
  {
    key: 'fi_alternatives',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/plans/new',
    push: p('A way to keep buying', 'Pay-over-time is no longer offered. A monthly plan is the way to keep going.', 'طريقة للاستمرار', 'الدفع على فترات لم يعد متاحًا. الخطة الشهرية هي طريقك للاستمرار.'),
    email: e(
      'What you can do instead',
      `${HI_EN}\n\nFollowing the FRA rules issued in September 2026, paying for gold over time is no longer available on mngm. This applies to every gold provider in Egypt.\n\nWhat you can do instead: a monthly plan. You choose an amount and a day, and it buys real gold for you each month. No debt, no interest — and you can stop it any time.`,
      'ما يمكنك فعله بدلًا من ذلك',
      `${HI_AR}\n\nتطبيقًا لقواعد الهيئة العامة للرقابة المالية الصادرة في سبتمبر 2026، لم يعد شراء الذهب بالدفع على فترات متاحًا على mngm، وينطبق ذلك على جميع مقدمي الذهب في مصر.\n\nما يمكنك فعله بدلًا من ذلك: خطة شهرية. تختار المبلغ واليوم، وتشتري لك ذهبًا حقيقيًا كل شهر. بلا ديون وبلا فوائد، ويمكنك إيقافها في أي وقت.`,
    ),
    sms: s('mngm: paying over time is no longer offered, by FRA rules. A monthly plan lets you keep buying gold, no debt: {{link}}', 'mngm: لم يعد الدفع على فترات متاحًا وفق قواعد الرقابة المالية. الخطة الشهرية تتيح لك مواصلة شراء الذهب بلا ديون: {{link}}'),
  },
  {
    key: 'fi_m1_offer',
    category: 'D',
    topic: 'promotions',
    deepLink: '/plans/new',
    push: p('Bonus gold on your plan', 'Start a monthly plan and earn bonus gold after 6 months. Terms apply.', 'ذهب إضافي مع خطتك', 'ابدأ خطة شهرية واحصل على ذهب إضافي بعد 6 أشهر. تطبق الشروط.'),
    email: e(
      'Bonus gold for keeping your plan going',
      `${HI_EN}\n\nStart a monthly plan this month and keep it running for 6 months in a row to receive bonus gold.\n\nThe bonus is credited on completion. Full terms are in the app.`,
      'ذهب إضافي عند الاستمرار في خطتك',
      `${HI_AR}\n\nابدأ خطة شهرية هذا الشهر واستمر عليها 6 أشهر متتالية لتحصل على ذهب إضافي.\n\nتضاف المكافأة عند الإتمام. الشروط الكاملة في التطبيق.`,
    ),
  },
  {
    key: 'fi_m2_education',
    category: 'E',
    topic: 'education',
    deepLink: '/learn/small-amounts',
    email: e(
      'Small amounts, real gold',
      `${HI_EN}\n\nYou do not need a large sum to own gold. On mngm you can buy from 0.001 g, and every fraction is backed by real metal in the vault.\n\nMany clients buy a little each payday. Over a year, small amounts add up to grams you own outright.`,
      'مبالغ صغيرة وذهب حقيقي',
      `${HI_AR}\n\nلا تحتاج إلى مبلغ كبير لتمتلك الذهب. على mngm يمكنك الشراء بدءًا من 0.001 جرام، وكل جزء مدعوم بمعدن حقيقي في الخزينة.\n\nكثير من عملائنا يشترون كمية صغيرة مع كل راتب، ومع مرور العام تتحول المبالغ الصغيرة إلى جرامات تملكها بالكامل.`,
    ),
  },
  {
    key: 'fi_m3',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/plans/new',
    push: p('Your plan, your pace', 'Monthly gold from EGP 500, on the day you choose.', 'خطتك بإيقاعك', 'ذهب شهري يبدأ من 500 جنيه في اليوم الذي تختاره.'),
  },

  // ══ 7.5 At-risk and win-back ═════════════════════════════════════════════
  {
    key: 'ar_d60',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/portfolio',
    push: p('Your holding today', 'Your {{grams goldGrams}} g of gold is worth EGP {{egp holdingValue}} today.', 'رصيدك اليوم', 'قيمة {{grams goldGrams}} جرام ذهب لديك اليوم {{egp holdingValue}} جنيه.'),
    email: e(
      'Your holding and this month in gold',
      `${HI_EN}\n\nYou hold {{grams goldGrams}} g of gold on mngm, worth EGP {{egp holdingValue}} at today's price.\n\nHere is what moved the market this month. ${PRICE_NOTE_EN}`,
      'رصيدك وحركة الذهب هذا الشهر',
      `${HI_AR}\n\nتمتلك {{grams goldGrams}} جرام ذهب على mngm، قيمتها {{egp holdingValue}} جنيه بسعر اليوم.\n\nإليك ما حرك السوق هذا الشهر. ${PRICE_NOTE_AR}`,
    ),
  },
  {
    key: 'ar_d75',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/prices',
    push: p('Market update', 'See what moved gold this month and today\'s price.', 'تحديث السوق', 'تعرّف على ما حرك الذهب هذا الشهر وسعر اليوم.'),
  },
  {
    key: 'ar_d90',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/buy',
    push: p('Worth a look', 'Your holding is worth EGP {{egp holdingValue}}. See today\'s price.', 'يستحق نظرة', 'قيمة رصيدك {{egp holdingValue}} جنيه. اطّلع على سعر اليوم.'),
    email: e(
      'Your holding is worth EGP {{egp holdingValue}}',
      `${HI_EN}\n\nYour mngm holding is worth EGP {{egp holdingValue}} today.\n\nWhenever you want to add to it, you can start from 0.001 g. ${PRICE_NOTE_EN}`,
      'قيمة رصيدك {{egp holdingValue}} جنيه',
      `${HI_AR}\n\nقيمة رصيدك في mngm اليوم {{egp holdingValue}} جنيه.\n\nمتى أردت الإضافة إليه، يمكنك البدء من 0.001 جرام. ${PRICE_NOTE_AR}`,
    ),
    sms: s('mngm: your holding is worth EGP {{egp holdingValue}} today. See the latest price: {{link}}', 'mngm: قيمة رصيدك اليوم {{egp holdingValue}} جنيه. اطّلع على أحدث سعر: {{link}}'),
  },
  {
    key: 'wb_d180',
    category: 'D',
    topic: 'promotions',
    deepLink: '/buy',
    email: e(
      'A welcome back offer, until {{date offerEnds}}',
      `${HI_EN}\n\nIt has been a while. Your holding is worth EGP {{egp holdingValue}} today.\n\nIf you buy again before {{date offerEnds}}, we will add bonus gold to your order. Terms apply and are in the app.`,
      'عرض عودة حتى {{date offerEnds}}',
      `${HI_AR}\n\nمر وقت منذ آخر زيارة. قيمة رصيدك اليوم {{egp holdingValue}} جنيه.\n\nإذا اشتريت مرة أخرى قبل {{date offerEnds}}، سنضيف ذهبًا إضافيًا إلى طلبك. تطبق الشروط الموضحة في التطبيق.`,
    ),
    sms: s('mngm: welcome back offer — bonus gold on your next purchase until {{date offerEnds}}. Terms apply: {{link}}', 'mngm: عرض العودة — ذهب إضافي مع شرائك القادم حتى {{date offerEnds}}. تطبق الشروط: {{link}}'),
  },
  {
    key: 'wb_d210',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/portfolio',
    email: e('Your holding, six months on', `${HI_EN}\n\nYour mngm holding is worth EGP {{egp holdingValue}} today. Here is what moved the market recently. ${PRICE_NOTE_EN}`, 'رصيدك بعد ستة أشهر', `${HI_AR}\n\nقيمة رصيدك في mngm اليوم {{egp holdingValue}} جنيه. إليك ما حرك السوق مؤخرًا. ${PRICE_NOTE_AR}`),
  },
  {
    key: 'wb_d240',
    category: 'D',
    topic: 'promotions',
    deepLink: '/buy',
    email: e('Last reminder: your welcome back offer', `${HI_EN}\n\nThis is the last reminder of your welcome back offer. After this we will only write occasionally.\n\nYou can change what you hear from us at any time in the app.`, 'تذكير أخير: عرض العودة', `${HI_AR}\n\nهذا آخر تذكير بعرض العودة، وبعده سنراسلك من حين لآخر فقط.\n\nيمكنك تغيير ما يصلك منا في أي وقت من التطبيق.`),
    sms: s('mngm: last reminder of your welcome back offer. Terms apply: {{link}}', 'mngm: تذكير أخير بعرض العودة. تطبق الشروط: {{link}}'),
  },

  // ══ Other lifecycle ══════════════════════════════════════════════════════
  {
    key: 'abandoned_1h',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/buy/{{metal}}',
    push: p('Your order is waiting', 'You started a {{metal metal}} order. Pick up where you left off.', 'طلبك بانتظارك', 'بدأت طلب {{metal metal}}. أكمل من حيث توقفت.'),
  },
  {
    key: 'abandoned_24h',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/buy/{{metal}}',
    push: p('Still interested?', 'Your {{metal metal}} order is not complete. See today\'s price.', 'ما زلت مهتمًا؟', 'طلب {{metal metal}} لم يكتمل. اطّلع على سعر اليوم.'),
    email: e('Your order is not complete', `${HI_EN}\n\nYou started a {{metal metal}} order but did not complete it. Nothing was charged.\n\nIf something got in the way, reply to this email and we will help.`, 'طلبك لم يكتمل', `${HI_AR}\n\nبدأت طلب {{metal metal}} لكنك لم تكمله، ولم يُخصم أي مبلغ.\n\nإذا واجهتك مشكلة، رد على هذه الرسالة وسنساعدك.`),
  },
  {
    key: 'milestone',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/portfolio',
    push: p('{{milestone}} g reached', 'You now own {{milestone}} g of gold or more. Well built.', 'وصلت إلى {{milestone}} جرام', 'أصبحت تمتلك {{milestone}} جرام ذهب أو أكثر.'),
    email: e(
      'You now own {{milestone}} g of gold',
      `${HI_EN}\n\nYour gold holding has passed {{milestone}} g — {{grams grams}} g in total, all physically backed and held in insured vault storage.`,
      'أصبحت تمتلك {{milestone}} جرام ذهب',
      `${HI_AR}\n\nتجاوز رصيدك من الذهب {{milestone}} جرام — {{grams grams}} جرام إجمالًا، مدعومة بمعدن حقيقي ومحفوظة في خزائن مؤمَّنة.`,
    ),
  },
  {
    key: 'anniversary',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/portfolio/year-in-review',
    email: e(
      'Your year with mngm',
      `${HI_EN}\n\n{{years}} year(s) ago today you joined mngm. Since then you have built a holding of {{grams grams}} g, worth EGP {{egp holdingValue}} today.\n\nSee your year in review in the app. ${PRICE_NOTE_EN}`,
      'عامك مع mngm',
      `${HI_AR}\n\nقبل {{years}} عام انضممت إلى mngm. ومنذ ذلك الحين كوّنت رصيدًا قدره {{grams grams}} جرام، قيمته اليوم {{egp holdingValue}} جنيه.\n\nاطّلع على حصاد عامك في التطبيق. ${PRICE_NOTE_AR}`,
    ),
    push: p('Your year with mngm', 'See your year in review: grams built and how you got there.', 'عامك مع mngm', 'اطّلع على حصاد عامك: الجرامات التي كوّنتها وكيف وصلت إليها.'),
  },
  {
    key: 'referral_invite',
    category: 'D',
    topic: 'promotions',
    deepLink: '/referral',
    push: p('Share mngm', 'Invite a friend. You both get bonus gold after their first order.', 'شارك mngm', 'ادعُ صديقًا واحصلا معًا على ذهب إضافي بعد أول طلب له.'),
  },
  {
    key: 'plan_bonus_progress',
    category: 'C',
    topic: 'lifecycle',
    deepLink: '/plans',
    inapp: p('{{months}} months in a row', '{{remaining}} more uninterrupted month(s) and your plan bonus is yours.', '{{months}} شهور متتالية', 'تبقى {{remaining}} شهر دون انقطاع لتحصل على مكافأة الخطة.'),
  },

  // ══ Campaign starter (edit in the console per campaign) ══════════════════
  {
    key: 'promo_generic',
    category: 'D',
    topic: 'promotions',
    deepLink: '/offers',
    push: p('An offer for you', 'See this week\'s offer in the app. Terms apply.', 'عرض لك', 'اطّلع على عرض هذا الأسبوع في التطبيق. تطبق الشروط.'),
    email: e('This week at mngm', `${HI_EN}\n\nSee this week's offer in the app. Terms and eligibility are published in the help centre.`, 'هذا الأسبوع في mngm', `${HI_AR}\n\nاطّلع على عرض هذا الأسبوع في التطبيق. الشروط والأهلية منشورة في مركز المساعدة.`),
  },
];
