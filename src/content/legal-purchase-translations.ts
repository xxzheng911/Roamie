import { ROAMIE_CONTACT_EMAIL } from "@/constants/contact";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legal";

/** Translations of the existing September 13 policy for the localized purchase sheet. */
const enTerms = `Roamie Terms of Use

Last updated: September 13, 2026

Welcome to Roamie (the Service). By using the Service, you confirm that you have read and agree to these terms and the Privacy Policy. If you obtained the app through the Apple App Store, your license to use the app is also subject to Apple's Standard EULA. These terms additionally govern Roamie's services, accounts, and content.

1. Services and accounts
Roamie provides AI travel planning, chat and place recommendations, map exploration, saved places, itineraries, travel preferences, and related features. Provide accurate information and keep your account secure. Do not abuse, attack, or compromise the Service, or create abnormal load through automation.

2. AI and travel information
AI content may be incomplete, inaccurate, or outdated. Attractions, opening hours, prices, transport, weather, safety, and entry requirements may change. Check with official sources or providers before traveling or making a transaction. Roamie does not replace professional, safety, or emergency advice.

3. Roamie Plus auto-renewing subscriptions
Roamie Plus is an auto-renewing subscription offered through the Apple App Store. The actual price, currency, trial (if any), and billing period are shown on Apple's purchase screen. Payments are handled through your Apple account. Subscriptions renew automatically unless canceled before the current period ends in accordance with Apple's rules. You can cancel or manage renewal in your Apple account's subscription settings.
Closing the paywall, signing out, or deleting your Roamie account does not cancel your Apple subscription. After you cancel automatic renewal, Plus is generally available until the paid period ends; the actual status depends on the entitlement returned by Apple and RevenueCat. Restore Purchases restores valid App Store purchase status only.

4. Third-party services and transactions
The Service may use or link to Supabase, Apple, Google, OpenAI, Google Maps/Places, RevenueCat, Cloudflare, Klook, KKday, Trip.com, Agoda, Booking.com, or other travel services. Each third party is responsible under its own terms for its services, content, inventory, payments, refunds, booking fulfillment, and data processing. Roamie is not the seller or fulfillment provider for those physical travel transactions.

5. Affiliate links
Roamie may earn a commission when you book through certain links, at no additional cost to you. These links relate to physical travel services or third-party bookings, not Apple App Store digital content purchases. They do not change Roamie's basic safety and quality rules for recommendations.

6. Account deletion
You can request permanent deletion in the app's account settings. Associated account and user data will then be deleted or anonymized under the Privacy Policy. Deleting a Roamie account does not cancel, refund, or terminate an Apple subscription. To stop renewal, manage your subscription separately with Apple.

7. Intellectual property and acceptable use
Roamie's brand, interface, software, and original content are protected by applicable laws. Except as permitted by law, do not reproduce, distribute, reverse-engineer, bypass security measures, or use the Service to infringe others' rights without authorization.

8. Service changes, availability, and limits of liability
We may change or discontinue features for security, legal compliance, maintenance, or product improvements. To the extent permitted by law, Roamie is not responsible for losses caused by third-party service interruptions, information errors, travel delays, transaction disputes, or events beyond our control. Assess travel and transaction risks yourself.

9. Updates to these terms
We may update these terms and publish the new version in the app or on the website. We will give notice of material changes as required. Continued use after an update indicates acceptance of the updated terms.

10. Contact
Email:
${ROAMIE_CONTACT_EMAIL}`;
const enPrivacy = `Roamie Privacy Policy

Last updated: September 13, 2026

This policy explains how Roamie collects, uses, shares, retains, and protects data, and how you can manage it.

1. Data we process
Account and login data: Supabase account identifiers, login providers, necessary session information; basic information supplied by Apple or Google sign-in, such as name, email (including Apple private relay addresses), and provider identity; display names, avatars, and profile settings.
Roamie does not store Apple or Google account passwords. Login and reauthentication credentials are sent only to trusted services as needed and should not be written to general app logs.
Location and map data: With your permission, we may process precise or approximate device location, regions you enter, search areas, and related place data for nearby recommendations, maps, itineraries, and place searches. You can disable location access in system settings; some features may become limited.
User content and preferences: Chat content, search text, prompts sent to AI; saved places, saved itineraries, drafts, trip details, and collaboration data; travel preferences, quiz results, and recommendation interactions; uploaded avatars, trip covers, and other profile media. Please do not include unnecessary sensitive personal information in chats or uploads.
Subscription and transaction status: Apple handles App Store payments. RevenueCat provides products, CustomerInfo, App User IDs, entitlements, product identifiers, expiration dates, and renewal status. Roamie does not receive complete payment card details. We sync verified subscription status to Supabase to maintain Plus access.
Technical, analytics, and affiliate data: We may process app version, platform, feature events, errors, performance information, security records, and affiliate link impressions, clicks, and outbound interactions. Roamie may earn a commission on bookings through certain links at no additional cost to you. Third-party booking platforms process subsequent browsing and transactions under their own policies.

2. How we use data
We use data for login, sync, place and AI recommendations, itineraries, saved places, collaboration, Plus access, support, security and abuse prevention, debugging, performance improvements, analytics, and legal obligations. A client's claim to Plus status is not by itself sufficient for server authorization.

3. Providers and data transfers
Depending on the features you use, data may be processed by:
- Supabase: authentication, database, storage, and infrastructure
- Apple/Google: sign-in; Apple also handles App Store subscriptions and payments
- OpenAI: necessary chat, search, or planning prompts to generate AI responses
- Google Maps/Places: maps, places, photos, searches, geocoding, and routes
- RevenueCat: subscription products, CustomerInfo, and entitlement verification
- Cloudflare: Workers, network transport, security, caching, and rate limiting
- Klook, KKday, Trip.com, Agoda, Booking.com, and other travel services: searches, bookings, or transactions after you choose to open affiliate links
These services may process data in different countries or regions, with protections under their own privacy policies and applicable laws.

4. Retention and security
While your account exists, we retain account data, chats, itineraries, saved places, preferences, and media as needed to provide the Service. Some caches stay only on your device or are refreshed according to feature cycles. Security, error, transaction, or legally required records may be kept for reasonable fraud prevention, dispute resolution, compliance, and backup periods. Data is deleted or de-identified when no longer needed.
We use encrypted transport, access controls, Row Level Security, server-side authorization, and other reasonable measures. No network or storage method guarantees absolute security.

5. Account and data deletion
Signed-in users can request permanent account deletion in Settings / Account Information. After completion, user-scoped profiles, trips, saved places, chats, preferences, credits, media, and related account data are deleted, and collaboration relationships are cleaned up. Some events may be retained for aggregate analytics in de-identified form with user IDs, session IDs, and identifiable metadata removed. Short-lived, non-identifying deletion receipts may be retained temporarily for retries and security.
Deleting a Roamie account does not automatically cancel an Apple App Store subscription. To stop renewal, you must separately cancel in your Apple account's subscription settings. Deleting a RevenueCat customer record also does not cancel, refund, or terminate an Apple subscription.

6. Your choices and rights
You can update some personal information in the app, manage saved places and trips, disable system location or notification permissions, manage Apple subscriptions, and permanently delete your account. For access, correction, or other privacy requests, contact the email below. Your rights depend on applicable local law.

7. Minors
If you are below the age at which you can independently consent to digital services where you live, a parent or guardian should consent and help you use the Service. We do not knowingly collect data from minors who do not meet legal consent requirements.

8. Policy updates
We may update this policy and publish the date and content in the app or on the website. We will notify you of material changes as required.

9. Contact
Email:
${ROAMIE_CONTACT_EMAIL}`;
const jaTerms = `Roamie 利用規約

最終更新日：2026年9月13日

Roamie（以下「本サービス」）をご利用いただくことで、本規約およびプライバシーポリシーを読み、同意したものとします。Apple App Store からアプリを取得した場合、アプリの利用許諾には Apple 標準 EULA も適用されます。本規約は、Roamie が提供するサービス、アカウント、コンテンツについても定めます。

1. サービスとアカウント
Roamie は AI による旅行計画、チャットやスポットの提案、地図探索、スポットの保存、旅程、旅の好みなどの機能を提供します。正確な情報を提供し、アカウントを適切に管理してください。不正利用、攻撃、不正侵入、自動化による過剰な負荷は禁止します。

2. AI と旅行情報
AI の内容は不完全、不正確、または古い場合があります。観光施設、営業時間、価格、交通、天気、安全、入国要件は変更されることがあります。出発や取引の前に公式情報や提供者に確認してください。Roamie は専門的な助言、安全上の助言、緊急時の案内に代わるものではありません。

3. Roamie Plus の自動更新
Roamie Plus は Apple App Store を通じた自動更新サブスクリプションです。価格、通貨、トライアル（提供される場合）、請求期間は Apple の購入画面に表示されます。支払いは Apple アカウントで処理され、Apple の規定に従い現在の期間が終了する前に解約しない限り、自動更新されます。Apple アカウントのサブスクリプション管理から解約や更新の管理ができます。
購入画面を閉じること、ログアウト、Roamie アカウントの削除では、Apple のサブスクリプションは解約されません。自動更新を停止した後も、通常は支払い済みの期間が終了するまで Plus を利用できます。実際の状態は Apple と RevenueCat が返す利用権限に従います。購入の復元は、有効な App Store の購入状態を復元するためのものです。

4. 外部サービスと取引
本サービスは Supabase、Apple、Google、OpenAI、Google Maps/Places、RevenueCat、Cloudflare、Klook、KKday、Trip.com、Agoda、Booking.com などを利用し、リンクする場合があります。各社のサービス、コンテンツ、在庫、決済、返金、予約の履行、データ処理は、それぞれの規約に基づき各社が責任を負います。Roamie は、これら実際の旅行サービス取引の販売者や履行者ではありません。

5. アフィリエイトリンク
一部のリンクから予約すると、利用者の支払額に影響することなく、Roamie が紹介手数料を受け取る場合があります。これらは実際の旅行サービスや外部予約に関するもので、Apple App Store のデジタルコンテンツ購入ではありません。提案内容に関する Roamie の基本的な安全・品質基準には影響しません。

6. アカウントの削除
アプリのアカウント設定から完全削除を申請できます。完了後、関連するアカウントと利用者データはプライバシーポリシーに従い削除または匿名化されます。Roamie アカウントの削除は、Apple のサブスクリプションの解約、返金、終了にはなりません。更新を希望しない場合は Apple で別途管理してください。

7. 知的財産権と適切な利用
Roamie のブランド、画面、ソフトウェア、独自コンテンツは関連法で保護されます。法律で認められる場合を除き、無断複製、配布、リバースエンジニアリング、安全対策の回避、他者の権利を侵害する利用は禁止します。

8. 変更、提供状況、責任の制限
安全、法令遵守、保守、製品改善のために機能を変更または中止する場合があります。法律で認められる範囲で、外部サービスの停止、情報の誤り、旅行の遅延、取引上の紛争、不可抗力による損失について Roamie は責任を負いません。旅行や取引のリスクはご自身で判断してください。

9. 規約の更新
本規約を更新し、アプリやウェブサイトに掲載する場合があります。重要な変更は適用される要件に従い通知します。更新後も利用を続けた場合、新しい規約への同意とみなします。

10. お問い合わせ
Email：
${ROAMIE_CONTACT_EMAIL}`;
const jaPrivacy = `Roamie プライバシーポリシー

最終更新日：2026年9月13日

本ポリシーは、Roamie によるデータの収集、利用、共有、保存、保護と、利用者による管理方法を説明します。

1. 処理するデータ
アカウント・ログイン情報：Supabase のアカウント識別子、ログイン提供者、必要なセッション情報。Apple または Google ログインから提供される名前、メールアドレス（Apple の非公開転送アドレスを含む場合があります）、提供者側の識別情報。表示名、アバター、プロフィール設定。
Roamie は Apple や Google のパスワードを保存しません。ログインや再認証の認証情報は機能に必要な場合のみ信頼できるサービスに送信し、通常のアプリログには記録すべきではありません。
位置・地図情報：許可を得たうえで、端末の正確またはおおよその位置、入力された地域、検索範囲、関連するスポット情報を、近隣の提案、地図、旅程、スポット検索に使用する場合があります。システム設定で位置情報を無効にできますが、一部機能が制限される場合があります。
利用者のコンテンツ・好み：チャット、検索文、AI に送るプロンプト。保存したスポットや旅程、下書き、旅行の詳細、共同編集データ。旅の好み、診断結果、提案への操作。アップロードしたアバター、旅程のカバー画像、その他のプロフィール画像など。チャットやアップロードに不要な機微情報を含めないでください。
サブスクリプション・取引状態：App Store の支払いは Apple が処理します。RevenueCat は商品、CustomerInfo、App User ID、利用権限、商品識別子、有効期限、更新状態を提供します。Roamie は完全なカード情報を取得しません。Plus の利用権限を維持するため、検証済みの状態を Supabase に同期します。
技術・分析・アフィリエイト情報：アプリのバージョン、プラットフォーム、機能イベント、エラー、性能、安全に関する記録、アフィリエイトリンクの表示・クリック・外部遷移を処理する場合があります。一部のリンクから予約すると、料金に影響することなく Roamie が手数料を受け取る場合があります。その後の閲覧や取引は予約先のポリシーに従います。

2. 利用目的
ログイン、同期、スポットや AI の提案、旅程、保存、共同編集、Plus の権限、サポート、安全と不正利用防止、不具合調査、性能改善、分析、法的義務のためにデータを使用します。クライアントが申告する Plus 状態だけでは、サーバーの認可根拠になりません。

3. 提供者とデータ移転
利用する機能に応じ、次の提供者がデータを処理する場合があります。
- Supabase：認証、データベース、ストレージ、基盤
- Apple／Google：ログイン。Apple は App Store の購読と決済も処理
- OpenAI：AI 回答の生成に必要なチャット、検索、計画のプロンプト
- Google Maps／Places：地図、スポット、写真、検索、位置変換、経路
- RevenueCat：購読商品、CustomerInfo、利用権限の検証
- Cloudflare：Worker、通信、安全、キャッシュ、レート制限
- Klook、KKday、Trip.com、Agoda、Booking.com など：利用者がリンクを開いた後の検索、予約、取引
各サービスは異なる国や地域でデータを処理する場合があり、それぞれのポリシーと適用法に基づき保護します。

4. 保存と安全
アカウントの存続中、サービスに必要なアカウント情報、チャット、旅程、保存、好み、画像などを保持します。一部キャッシュは端末内のみに保存されるか、機能ごとの周期で更新されます。安全、エラー、取引、法定記録は、不正防止、紛争対応、法令、バックアップに必要な合理的期間保持し、不要になれば削除または個人を特定できない形にします。
暗号化通信、アクセス制御、Row Level Security、サーバー側の認可など合理的な対策を講じますが、通信や保存の絶対的な安全は保証できません。

5. アカウントとデータの削除
ログイン中の利用者は、アプリの「設定／アカウント情報」で完全削除を申請できます。完了後、利用者に紐づくプロフィール、旅程、保存、チャット、好み、クレジット、画像、関連アカウント情報を削除し、共同編集の関連付けを整理します。集計分析のため、一部イベントを利用者 ID、セッション ID、識別可能なメタデータを除いた形で保持する場合があります。再試行や安全のため、個人を特定しない短期の削除記録を一時的に保存する場合があります。
Roamie アカウントを削除しても Apple App Store の購読は自動解約されません。更新を止めるには Apple アカウントで別途解約してください。RevenueCat の顧客記録の削除も、Apple の購読の解約、返金、終了にはなりません。

6. 選択と権利
一部プロフィールの更新、保存や旅程の管理、システムの位置情報・通知権限の無効化、Apple 購読の管理、アカウントの完全削除ができます。開示、訂正、その他のプライバシーに関するご要望は下記メールへご連絡ください。具体的な権利は居住地の適用法によります。

7. 未成年者
居住地でデジタルサービスに単独で同意できる年齢に達していない場合、保護者の同意と支援が必要です。法的な同意要件を満たさない未成年者のデータを、承知したうえで収集することはありません。

8. 更新
本ポリシーを更新し、日付と内容をアプリやウェブサイトに掲載する場合があります。重要な変更は適用要件に従い通知します。

9. お問い合わせ
Email：
${ROAMIE_CONTACT_EMAIL}`;
const koTerms = `Roamie 이용약관

최종 업데이트: 2026년 9월 13일

Roamie(이하 서비스)를 이용하면 본 약관과 개인정보 처리방침을 읽고 동의한 것으로 봅니다. Apple App Store에서 앱을 받은 경우 앱 사용권에는 Apple 표준 EULA도 적용됩니다. 본 약관은 Roamie의 서비스, 계정, 콘텐츠에 관한 사항도 규정합니다.

1. 서비스와 계정
Roamie는 AI 여행 계획, 대화와 장소 추천, 지도 탐색, 장소 저장, 일정, 여행 취향 등의 기능을 제공합니다. 정확한 정보를 제공하고 계정을 안전하게 관리해야 합니다. 서비스 남용, 공격, 해킹 또는 자동화를 통한 비정상적인 부하 유발은 금지됩니다.

2. AI와 여행 정보
AI가 생성한 내용은 불완전하거나 부정확하거나 오래된 정보일 수 있습니다. 명소, 영업시간, 가격, 교통, 날씨, 안전, 입국 요건은 바뀔 수 있으므로 출발이나 거래 전에 공식 기관이나 제공업체에 확인하세요. Roamie는 전문적인 조언, 안전 안내 또는 긴급 지원을 대신하지 않습니다.

3. Roamie Plus 자동 갱신
Roamie Plus는 Apple App Store를 통해 제공되는 자동 갱신 구독입니다. 실제 가격, 통화, 체험 혜택(있는 경우), 결제 주기는 Apple 구매 화면에 표시됩니다. 결제는 Apple 계정으로 처리됩니다. Apple 규정에 따라 현재 기간이 끝나기 전에 취소하지 않으면 자동 갱신됩니다. Apple 계정의 구독 관리에서 갱신을 관리하거나 취소할 수 있습니다.
구매 화면을 닫거나 로그아웃하거나 Roamie 계정을 삭제해도 Apple 구독은 취소되지 않습니다. 자동 갱신을 취소하면 일반적으로 결제한 기간이 끝날 때까지 Plus를 이용할 수 있으며, 실제 상태는 Apple과 RevenueCat이 반환한 이용 권한에 따릅니다. 구매 복원은 유효한 App Store 구매 상태를 복원하는 기능입니다.

4. 외부 서비스와 거래
본 서비스는 Supabase, Apple, Google, OpenAI, Google Maps/Places, RevenueCat, Cloudflare, Klook, KKday, Trip.com, Agoda, Booking.com 등 외부 서비스를 이용하거나 연결할 수 있습니다. 각 업체의 서비스, 콘텐츠, 재고, 결제, 환불, 예약 이행, 데이터 처리는 해당 업체가 자체 약관에 따라 책임집니다. Roamie는 해당 실제 여행 거래의 판매자나 이행 주체가 아닙니다.

5. 제휴 링크
일부 링크를 통해 예약하면 이용자 가격에 영향 없이 Roamie가 수수료를 받을 수 있습니다. 제휴 링크는 실제 여행 서비스 또는 외부 예약에 관한 것으로, Apple App Store의 디지털 콘텐츠 구매가 아닙니다. 추천의 기본 안전 및 품질 기준에는 영향을 주지 않습니다.

6. 계정 삭제
앱의 계정 설정에서 영구 삭제를 요청할 수 있습니다. 완료 후 관련 계정과 이용자 데이터는 개인정보 처리방침에 따라 삭제 또는 익명화됩니다. Roamie 계정을 삭제해도 Apple 구독이 취소, 환불, 종료되지 않습니다. 갱신을 원하지 않으면 Apple에서 별도로 관리하세요.

7. 지식재산권과 올바른 이용
Roamie의 브랜드, 화면, 소프트웨어, 자체 콘텐츠는 관련 법률로 보호됩니다. 법률이 허용하는 경우를 제외하고 무단 복제, 배포, 역설계, 보안 조치 우회, 타인의 권리를 침해하는 이용은 금지됩니다.

8. 서비스 변경, 제공 여부, 책임 제한
보안, 법규 준수, 유지보수, 제품 개선을 위해 일부 기능을 변경하거나 중단할 수 있습니다. 법률이 허용하는 범위에서 외부 서비스 중단, 정보 오류, 여행 지연, 거래 분쟁, 불가항력으로 인한 손실에 대해 Roamie는 책임지지 않습니다. 여행과 거래 위험은 직접 판단해야 합니다.

9. 약관 변경
본 약관을 변경하고 앱이나 웹사이트에 게시할 수 있습니다. 중요한 변경은 적용되는 요건에 따라 알립니다. 변경 후 계속 이용하면 새 약관에 동의한 것으로 봅니다.

10. 문의
Email:
${ROAMIE_CONTACT_EMAIL}`;
const koPrivacy = `Roamie 개인정보 처리방침

최종 업데이트: 2026년 9월 13일

이 방침은 Roamie가 데이터를 수집, 이용, 공유, 보관, 보호하는 방법과 이용자가 관리할 수 있는 방법을 설명합니다.

1. 처리하는 데이터
계정 및 로그인 정보: Supabase 계정 식별자, 로그인 제공업체, 필요한 세션 정보. Apple 또는 Google 로그인이 제공하는 이름, 이메일(Apple 비공개 릴레이 주소 포함 가능), 제공업체 식별 정보. 표시 이름, 프로필 사진, 프로필 설정.
Roamie는 Apple이나 Google 계정 비밀번호를 저장하지 않습니다. 로그인 및 재인증 정보는 기능에 필요한 경우에만 신뢰할 수 있는 서비스로 전송하며 일반 앱 로그에 기록해서는 안 됩니다.
위치 및 지도 정보: 허용한 경우 정확하거나 대략적인 기기 위치, 입력 지역, 검색 범위, 관련 장소 정보를 주변 추천, 지도, 일정, 장소 검색에 사용할 수 있습니다. 시스템 설정에서 위치 권한을 끌 수 있으며 일부 기능이 제한될 수 있습니다.
이용자 콘텐츠 및 취향: 대화, 검색어, AI에 전송한 프롬프트. 저장한 장소와 일정, 초안, 여행 상세 정보, 협업 데이터. 여행 취향, 테스트 결과, 추천과의 상호작용. 업로드한 프로필 사진, 여행 표지 등 미디어. 대화나 업로드에 불필요한 민감 개인정보를 포함하지 마세요.
구독 및 거래 상태: App Store 결제는 Apple이 처리합니다. RevenueCat은 상품, CustomerInfo, App User ID, 이용 권한, 상품 식별자, 만료일, 갱신 상태를 제공합니다. Roamie는 전체 결제 카드 정보를 받지 않습니다. Plus 이용 권한 유지를 위해 검증된 구독 상태를 Supabase에 동기화합니다.
기술, 분석 및 제휴 정보: 앱 버전, 플랫폼, 기능 이벤트, 오류, 성능 정보, 보안 기록, 제휴 링크 노출·클릭·외부 이동을 처리할 수 있습니다. 일부 링크로 예약하면 가격에 영향 없이 Roamie가 수수료를 받을 수 있습니다. 이후의 탐색과 거래는 외부 예약 플랫폼의 정책에 따라 처리됩니다.

2. 이용 목적
로그인, 동기화, 장소 및 AI 추천, 일정, 저장, 협업, Plus 권한, 고객 지원, 보안과 남용 방지, 오류 수정, 성능 개선, 분석, 법적 의무를 위해 데이터를 이용합니다. 클라이언트가 주장하는 Plus 상태만으로 서버 권한을 부여하지 않습니다.

3. 서비스 제공업체와 데이터 이전
이용하는 기능에 따라 다음 업체가 데이터를 처리할 수 있습니다.
- Supabase: 인증, 데이터베이스, 저장소, 인프라
- Apple/Google: 로그인. Apple은 App Store 구독과 결제도 처리
- OpenAI: AI 답변 생성에 필요한 대화, 검색, 계획 프롬프트
- Google Maps/Places: 지도, 장소, 사진, 검색, 지오코딩, 경로
- RevenueCat: 구독 상품, CustomerInfo, 이용 권한 검증
- Cloudflare: Worker, 네트워크 전송, 보안, 캐시, 요청 속도 제한
- Klook, KKday, Trip.com, Agoda, Booking.com 등: 이용자가 제휴 링크를 연 이후의 검색, 예약, 거래
각 서비스는 다른 국가나 지역에서 데이터를 처리할 수 있으며 자체 개인정보 정책과 적용 법률에 따라 보호합니다.

4. 보관과 보안
계정이 유지되는 동안 서비스 제공에 필요한 계정 정보, 대화, 일정, 저장한 장소, 취향, 미디어를 보관합니다. 일부 캐시는 기기에만 저장되거나 기능별 주기로 갱신됩니다. 보안, 오류, 거래 또는 법정 기록은 사기 방지, 분쟁, 법규, 백업에 필요한 합리적인 기간 동안 보관할 수 있으며 불필요해지면 삭제하거나 비식별화합니다.
암호화 전송, 접근 제어, Row Level Security, 서버 권한 검증 등 합리적인 조치를 적용하지만 어떤 네트워크나 저장 방식도 절대적인 안전을 보장할 수 없습니다.

5. 계정 및 데이터 삭제
로그인한 이용자는 앱의 설정 / 계정 정보에서 영구 삭제를 요청할 수 있습니다. 완료 후 이용자 범위의 프로필, 일정, 저장한 장소, 대화, 취향, 크레딧, 미디어, 관련 계정 정보를 삭제하고 협업 관계를 정리합니다. 집계 분석을 위해 일부 이벤트는 이용자 ID, 세션 ID, 식별 가능한 메타데이터를 제거한 비식별 형태로 보관할 수 있습니다. 재시도와 보안을 위해 개인을 식별할 수 없는 단기 삭제 기록을 일시 보관할 수 있습니다.
Roamie 계정 삭제는 Apple App Store 구독을 자동으로 취소하지 않습니다. 갱신을 원하지 않으면 Apple 계정의 구독 관리에서 별도로 취소해야 합니다. RevenueCat 고객 기록을 삭제해도 Apple 구독이 취소, 환불, 종료되지 않습니다.

6. 선택과 권리
앱에서 일부 개인정보를 수정하고, 저장한 장소와 일정을 관리하고, 시스템의 위치·알림 권한을 끄고, Apple 구독을 관리하고, 계정을 영구 삭제할 수 있습니다. 열람, 정정, 기타 개인정보 요청은 아래 이메일로 문의하세요. 구체적인 권리는 거주지의 적용 법률에 따릅니다.

7. 미성년자
거주지에서 디지털 서비스 이용에 독립적으로 동의할 수 있는 나이보다 어리다면 보호자의 동의와 도움을 받아야 합니다. 법적 동의 요건을 충족하지 않는 미성년자의 데이터를 알면서 수집하지 않습니다.

8. 방침 변경
이 방침을 변경하고 날짜와 내용을 앱이나 웹사이트에 게시할 수 있습니다. 중요한 변경은 적용되는 요건에 따라 알립니다.

9. 문의
Email:
${ROAMIE_CONTACT_EMAIL}`;
export const purchaseLegalTranslations = {
  "zh-TW": { termsContent: TERMS_OF_SERVICE, privacyContent: PRIVACY_POLICY },
  en: { termsContent: enTerms, privacyContent: enPrivacy },
  ja: { termsContent: jaTerms, privacyContent: jaPrivacy },
  ko: { termsContent: koTerms, privacyContent: koPrivacy },
};
