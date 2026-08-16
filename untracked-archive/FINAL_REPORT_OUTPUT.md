### 1. 실제 계정 모델과 코드 근거

#### ① 현재 부모 로그인 계정 판별 방식
- **코드 근거**: [lib/auth/membershipState.ts](file:///e:/VibeCoding/K-Bestie-v3/lib/auth/membershipState.ts#L42-L103) (`resolveMembershipState`), [lib/auth/requireChildAccess.ts](file:///e:/VibeCoding/K-Bestie-v3/lib/auth/requireChildAccess.ts#L14-L35)
- **판별 방식**: `auth.users` 의 `user.id` 로 `family_members` 테이블을 조회하여 `role IN ('owner_parent', 'parent')` 이고 `deleted_at IS NULL` 인 행이 존재하고, `parents` 테이블에 완수 레코드가 존재하는 계정을 **부모 계정**으로 판정합니다.

#### ② 현재 아이 로그인 계정 판별 방식
- **코드 근거**: [app/api/child/me/route.ts](file:///e:/VibeCoding/K-Bestie-v3/app/api/child/me/route.ts#L18-L23), [lib/auth/membershipState.ts](file:///e:/VibeCoding/K-Bestie-v3/lib/auth/membershipState.ts#L94-L98)
- **판별 방식**: 아이가 ID/PW 로그인 시 `auth.users` 의 `user.id` 로 `family_members` 테이블을 조회하여 **`role = 'child'`** 이고 `deleted_at IS NULL` 인 행이 검색되는 계정을 **아이 로그인 Auth 계정**으로 판정합니다.

#### ③ 한 가족에 부모와 아이가 연결되는 키
- **코드 근거**: [lib/auth/requireChildAccess.ts](file:///e:/VibeCoding/K-Bestie-v3/lib/auth/requireChildAccess.ts#L33-L42), `families.id`, `family_members.family_id`, `child_profiles.family_id`
- **연결 방식**: 최상위 **`families.id` (가족 PK)** 가 그룹핑 핵심 키이며, 부모와 아이는 각각 `family_members`의 `family_id` 및 `child_profiles.family_id` 로 묶입니다.

#### ④ child_profiles와 아이 Auth.users 계정의 매핑 구조
- **코드 근거**: [app/api/child/me/route.ts](file:///e:/VibeCoding/K-Bestie-v3/app/api/child/me/route.ts#L18-L38), [lib/admin/aggregateExecutionStatus.ts](file:///e:/VibeCoding/K-Bestie-v3/lib/admin/aggregateExecutionStatus.ts#L70-L86)
- **매핑 방식**: `child_profiles.id` 와 아이 Auth UID는 직결되지 않으며, **`child_profiles.member_id` ➔ `family_members.id` (가족 멤버 PK) ➔ `family_members.user_id` ➔ `auth.users.id` (아이 Auth UID)** 고리로 1:1 매핑됩니다.

#### ⑤ 부모 대시보드에서 자녀 목록을 가져오는 방식
- **코드 근거**: [app/api/families/[id]/children/route.ts](file:///e:/VibeCoding/K-Bestie-v3/app/api/families/[id]/children/route.ts)
- **조회 방식**: 부모의 `family_id` 를 얻은 후, `child_profiles` 테이블에서 `family_id = familyId` 인 전체 자녀 프로필을 가져옵니다.

---

### 2. 가족별 정확한 부모/아이 매핑 전체 목록 (총 33개 가족)

#### 👨‍👩‍👧‍👦 가족 1: 테스트 가족
- **Family ID**: `53db02cc-7a52-4368-9e5a-3334a9b3710f`
- **생성자 Auth UID**: `fa834dd9-ad5e-4f98-b371-07e982d54c46` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `markanitp@gmail.com` | **부모 이름**: `홍길동` | **Auth User ID**: `fa834dd9-ad5e-4f98-b371-07e982d54c46` (Role: owner_parent)

**[아이 목록]** (3명)
  1. **아이 이름**: `박서아` | **아이 로그인 이메일**: `psa160202@kbestie.local` | **Child Profile ID**: `2f98d390-e690-452d-8cd2-8e1f9cac09f9` | **아이 Auth User ID**: `d2faab01-018d-4d1d-bc61-408d2eba42e1`
  2. **아이 이름**: `박서현` | **아이 로그인 이메일**: `psh160202@kbestie.local` | **Child Profile ID**: `cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410` | **아이 Auth User ID**: `d555861d-4b25-4dfc-8bee-0b4a93b49225`
  3. **아이 이름**: `박서둥` | **아이 로그인 이메일**: `psd160202@kbestie.local` | **Child Profile ID**: `79b4dad8-a0b5-475f-836a-564fb4a6de2a` | **아이 Auth User ID**: `e3567e56-c247-498c-a62d-b24897e4a1b8`

---

#### 👨‍👩‍👧‍👦 가족 2: 서둥이네 가족
- **Family ID**: `af2f0572-bd7c-44b2-95ea-e8da77444a18`
- **생성자 Auth UID**: `51bd779b-f42e-43ec-9ca0-dc5af45dc82c` 

**[부모 계정 목록]** (2명)
  1. **부모 이메일**: `ilcb12@hotmail.com` | **부모 이름**: `아빠` | **Auth User ID**: `51bd779b-f42e-43ec-9ca0-dc5af45dc82c` (Role: owner_parent)
  2. **부모 이메일**: `mk0904@naver.com` | **부모 이름**: `서둥맘` | **Auth User ID**: `fc6c1fb0-2147-4ad5-80cb-f4f8f95c162f` (Role: parent)

**[아이 목록]** (2명)
  1. **아이 이름**: `안서현` | **아이 로그인 이메일**: `ash160202@kbestie.local` | **Child Profile ID**: `eabe9339-e6d5-472f-8199-5c9361da286a` | **아이 Auth User ID**: `7d57032c-196a-4e28-abfb-8de07f704211`
  2. **아이 이름**: `안서아` | **아이 로그인 이메일**: `asa160202@kbestie.local` | **Child Profile ID**: `b4faf92b-5707-4362-b9c0-9b85653a91cc` | **아이 Auth User ID**: `f945bb79-c682-456d-8218-153fcaf6f3a8`

---

#### 👨‍👩‍👧‍👦 가족 3: 도도네
- **Family ID**: `1a460588-de1b-44cd-892f-feb32a808033`
- **생성자 Auth UID**: `1eaf924f-2be4-4a32-92dd-29ec8c45dfbc` 

**[부모 계정 목록]** (2명)
  1. **부모 이메일**: `jiyoungkim10@gmail.com` | **부모 이름**: `(이름 미지정)` | **Auth User ID**: `1eaf924f-2be4-4a32-92dd-29ec8c45dfbc` (Role: owner_parent)
  2. **부모 이메일**: `optsonamu19@gmail.com` | **부모 이름**: `윤성철` | **Auth User ID**: `1778f604-a515-4375-b670-33b47501695f` (Role: parent)

**[아이 목록]** (2명)
  1. **아이 이름**: `윤도건` | **아이 로그인 이메일**: `1stdodo@kbestie.local` | **Child Profile ID**: `e74a4ed1-7498-4183-9e51-5a026ecdf3ac` | **아이 Auth User ID**: `23c2de3f-f45a-4a08-9192-1faffea776f0`
  2. **아이 이름**: `윤도원` | **아이 로그인 이메일**: `2nddodo@kbestie.local` | **Child Profile ID**: `fa514f91-8a35-4f59-ab31-d32399c49dc0` | **아이 Auth User ID**: `b45e2de0-7161-45fd-8e20-86466b2de334`

---

#### 👨‍👩‍👧‍👦 가족 4: QA 부모-TestA-TestB 전용 가족(Prod)
- **Family ID**: `f6ea0977-d80a-4265-a3f3-49952e0f6d3d`
- **생성자 Auth UID**: `96d81fb1-32dd-4557-8442-e5374ab2aa5e` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `qa-parent@kbestie.local` | **부모 이름**: `(이름 미지정)` | **Auth User ID**: `96d81fb1-32dd-4557-8442-e5374ab2aa5e` (Role: owner_parent)

**[아이 목록]** (2명)
  1. **아이 이름**: `TestA` | **아이 로그인 이메일**: `testa@kbestie.local` | **Child Profile ID**: `11111111-1111-1111-1111-111111111111` | **아이 Auth User ID**: `72a6e600-2d04-49b5-bc18-1dc1797fd547`
  2. **아이 이름**: `TestB` | **아이 로그인 이메일**: `testb@kbestie.local` | **Child Profile ID**: `22222222-2222-2222-2222-222222222222` | **아이 Auth User ID**: `fda505ae-1adf-464b-8075-31f63fa5a1ee`

---

#### 👨‍👩‍👧‍👦 가족 5: 나연이네가족
- **Family ID**: `9488a2e3-7bd7-4163-b809-160f5df161b3`
- **생성자 Auth UID**: `90ecef2c-2ccf-4c1f-86f9-9a7d8eb8c6c2` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `k98816226@nate.com` | **부모 이름**: `♡` | **Auth User ID**: `90ecef2c-2ccf-4c1f-86f9-9a7d8eb8c6c2` (Role: owner_parent)

**[아이 목록]** (2명)
  1. **아이 이름**: `고보강` | **아이 로그인 이메일**: `gbk9048@kbestie.local` | **Child Profile ID**: `5f5927d0-7185-423e-b444-2ee02570e00b` | **아이 Auth User ID**: `026346e6-3246-4ea2-97fc-cf44f8fb6872`
  2. **아이 이름**: `고나연` | **아이 로그인 이메일**: `gny9048@kbestie.local` | **Child Profile ID**: `22599eb6-b7b0-47db-9bad-7785c11e40b9` | **아이 Auth User ID**: `5c56abdd-09fa-4162-8989-322f93365179`

---

#### 👨‍👩‍👧‍👦 가족 6: 려원.예원이 가족
- **Family ID**: `b21b316c-1272-4d9a-a959-906ad8d35452`
- **생성자 Auth UID**: `8501c2f6-1b93-4b9a-af9d-642aea5daee8` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `jkinim@naver.com` | **부모 이름**: `조갱` | **Auth User ID**: `8501c2f6-1b93-4b9a-af9d-642aea5daee8` (Role: owner_parent)

**[아이 목록]** (2명)
  1. **아이 이름**: `안려원` | **아이 로그인 이메일**: `jkinim@kbestie.local` | **Child Profile ID**: `69dc74f5-71bd-48e5-8818-085df57d5de3` | **아이 Auth User ID**: `fbefc8ce-4d16-4413-a75d-b1a01b70df99`
  2. **아이 이름**: `안예원` | **아이 로그인 이메일**: `jkinim1@kbestie.local` | **Child Profile ID**: `a88a37e5-6fe7-4dcc-ae0f-768a6e8bff75` | **아이 Auth User ID**: `ea1d0448-f50d-4fa8-a122-fc04b49f60e9`

---

#### 👨‍👩‍👧‍👦 가족 7: 문가네
- **Family ID**: `b3cb0a7c-0473-4af0-8f98-c2ed0918636e`
- **생성자 Auth UID**: `da3560e2-cdf2-4680-835b-e434f5045018` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `kwmoon79@naver.com` | **부모 이름**: `문경원` | **Auth User ID**: `da3560e2-cdf2-4680-835b-e434f5045018` (Role: owner_parent)

**[아이 목록]** (1명)
  1. **아이 이름**: `문주하` | **아이 로그인 이메일**: `juhamoon@kbestie.local` | **Child Profile ID**: `fc315ec1-d6bc-44ad-b200-0e0ef50bb92b` | **아이 Auth User ID**: `b8a5b75f-2222-43a5-9208-9b1813a52ab5`

---

#### 👨‍👩‍👧‍👦 가족 8: 기존검증가족
- **Family ID**: `0fa3f0c7-090f-4ce3-94fd-bb02fe36c2e1`
- **생성자 Auth UID**: `43111400-b0dd-4acf-8e4c-e8d159c54624` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055388348@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `43111400-b0dd-4acf-8e4c-e8d159c54624` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 9: 기존검증가족
- **Family ID**: `75d9f0b4-edea-4a09-b2fd-06058279a60d`
- **생성자 Auth UID**: `af2afa29-aad8-401a-b2f4-e6e4248e7081` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055414777@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `af2afa29-aad8-401a-b2f4-e6e4248e7081` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 10: 신규검증가족
- **Family ID**: `d0bde93b-10a6-4493-b0d6-0476c2502bca`
- **생성자 Auth UID**: `23876fa3-e1a1-46be-af4c-43cd6c3414ac` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `new_parent_1786055419294@kbestie.com` | **부모 이름**: `신규검증부모` | **Auth User ID**: `23876fa3-e1a1-46be-af4c-43cd6c3414ac` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 11: 복구가족
- **Family ID**: `1ac741ec-acd7-4f37-89c5-c262a7378813`
- **생성자 Auth UID**: `7e5d2bfe-4ea5-471d-b86f-a6410c547c73` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `qa-restore-1785995293471@kbestie.local` | **부모 이름**: `복구테스트보호자` | **Auth User ID**: `7e5d2bfe-4ea5-471d-b86f-a6410c547c73` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 12: 기존가족
- **Family ID**: `90a7a863-d889-4d8c-aeb0-8e6553a0a20e`
- **생성자 Auth UID**: `5c341166-658a-43fc-aa3f-10301ebd4e8b` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `qa-active-1785995338395@kbestie.local` | **부모 이름**: `기존활성보호자` | **Auth User ID**: `5c341166-658a-43fc-aa3f-10301ebd4e8b` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 13: 기존검증가족
- **Family ID**: `98435f2f-d282-4a9e-a998-aa5f13060851`
- **생성자 Auth UID**: `dd111903-2dcb-423c-a2d5-634b99cb48cf` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055429260@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `dd111903-2dcb-423c-a2d5-634b99cb48cf` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 14: 복구가족
- **Family ID**: `bd1eaa8b-2c77-489e-9c17-1c01d12f520a`
- **생성자 Auth UID**: `f119f10b-da38-450d-ae00-0baea4191503` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `qa-restore-1785995575538@kbestie.local` | **부모 이름**: `복구테스트보호자` | **Auth User ID**: `f119f10b-da38-450d-ae00-0baea4191503` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 15: 기존가족
- **Family ID**: `564c5a46-c1cb-43c3-bffb-bf38c705688c`
- **생성자 Auth UID**: `0d7ff543-2210-4e31-be25-cf08013b34dd` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `qa-active-1785995619539@kbestie.local` | **부모 이름**: `기존활성보호자` | **Auth User ID**: `0d7ff543-2210-4e31-be25-cf08013b34dd` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 16: 신규검증가족
- **Family ID**: `e7690659-bc6d-4cb7-b8d9-0b874e550647`
- **생성자 Auth UID**: `48798d97-6493-41b9-8779-32d40e004b8a` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `new_parent_1786055432823@kbestie.com` | **부모 이름**: `신규검증부모` | **Auth User ID**: `48798d97-6493-41b9-8779-32d40e004b8a` (Role: owner_parent)

**[아이 목록]** (1명)
  1. **아이 이름**: `(이름 미지정)` | **아이 로그인 이메일**: `newchild_2823@kbestie.local` | **Child Profile ID**: `(매핑 프로필 없음)` | **아이 Auth User ID**: `a78e7c8c-c84f-488b-a82b-4a8a639f74b1`

---

#### 👨‍👩‍👧‍👦 가족 17: 기존검증가족
- **Family ID**: `af9711d2-c50c-4b83-9dc1-6287f0f74761`
- **생성자 Auth UID**: `8bec483b-9def-4ecd-a87b-2c591181f8de` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055469925@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `8bec483b-9def-4ecd-a87b-2c591181f8de` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 18: 승인가족
- **Family ID**: `0b28f85e-9d19-4940-8f6b-e99c20382e8e`
- **생성자 Auth UID**: `e6d12f3f-776d-4591-a5a0-a8a17ee44f28` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `qa-approve-loop-1785998038725@kbestie.local` | **부모 이름**: `승인테스트보호자` | **Auth User ID**: `e6d12f3f-776d-4591-a5a0-a8a17ee44f28` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 19: 신규검증가족
- **Family ID**: `fccb3dc8-ddf7-44e0-9598-4c0db2458057`
- **생성자 Auth UID**: `05b7f6b3-0829-4b49-8954-caa8d3b2605e` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `new_parent_1786055476008@kbestie.com` | **부모 이름**: `신규검증부모` | **Auth User ID**: `05b7f6b3-0829-4b49-8954-caa8d3b2605e` (Role: owner_parent)

**[아이 목록]** (1명)
  1. **아이 이름**: `(이름 미지정)` | **아이 로그인 이메일**: `newchild_6008@kbestie.local` | **Child Profile ID**: `(매핑 프로필 없음)` | **아이 Auth User ID**: `46cbde14-1094-4636-aa95-bb95295725a3`

---

#### 👨‍👩‍👧‍👦 가족 20: 기존검증가족
- **Family ID**: `f12c87df-5ba6-48d7-b416-5d1b7264cb93`
- **생성자 Auth UID**: `4023b578-133d-42fe-9b29-163685399fdb` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055509785@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `4023b578-133d-42fe-9b29-163685399fdb` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 21: QA 테스트 가족
- **Family ID**: `350a0186-bab2-4583-a947-c5ae1bc9be03`
- **생성자 Auth UID**: `f8a9e1d8-9264-4353-9e42-b0245b65a470` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `dev_qa_full_1786021407493@kbestie.local` | **부모 이름**: `QA 부모` | **Auth User ID**: `f8a9e1d8-9264-4353-9e42-b0245b65a470` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 22: QA 테스트 가족
- **Family ID**: `de0edac2-a91f-4f1d-8338-7a3903d47215`
- **생성자 Auth UID**: `df571802-8cb9-4dd7-b1aa-8817a38edf88` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `dev_qa_full_1786021554000@kbestie.local` | **부모 이름**: `QA 부모` | **Auth User ID**: `df571802-8cb9-4dd7-b1aa-8817a38edf88` (Role: owner_parent)

**[아이 목록]** (1명)
  1. **아이 이름**: `(이름 미지정)` | **아이 로그인 이메일**: `child_dev_21554000@kbestie.local` | **Child Profile ID**: `(매핑 프로필 없음)` | **아이 Auth User ID**: `19134463-c59e-4dd3-821c-ff273d2474a8`

---

#### 👨‍👩‍👧‍👦 가족 23: QA 테스트 가족
- **Family ID**: `f12d7025-4c9b-4e41-bb77-2e47d68b0772`
- **생성자 Auth UID**: `36b14754-8bb5-401d-b07a-a71abc9e794b` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `dev_qa_full_1786021564828@kbestie.local` | **부모 이름**: `QA 부모` | **Auth User ID**: `36b14754-8bb5-401d-b07a-a71abc9e794b` (Role: owner_parent)

**[아이 목록]** (1명)
  1. **아이 이름**: `(이름 미지정)` | **아이 로그인 이메일**: `child_dev_21564828@kbestie.local` | **Child Profile ID**: `(매핑 프로필 없음)` | **아이 Auth User ID**: `6dd1eab3-1427-4f73-8e8a-711a2a474765`

---

#### 👨‍👩‍👧‍👦 가족 24: QA 프리뷰 가족
- **Family ID**: `fb35c962-5e7b-4864-b41e-aecd85dcb20c`
- **생성자 Auth UID**: `5c481d99-dbe7-4704-8da9-c2bbfd1f4701` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `dev_qa_new_preview_1786021983396@kbestie.local` | **부모 이름**: `QA 신규프리뷰부모` | **Auth User ID**: `5c481d99-dbe7-4704-8da9-c2bbfd1f4701` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 25: QA 테스트 가족
- **Family ID**: `d190480f-d304-45e7-b6d3-603a14f36677`
- **생성자 Auth UID**: `181e479c-c968-455f-ab4d-5fd72ed300eb` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `dev_qa_full_1786021993202@kbestie.local` | **부모 이름**: `QA 부모` | **Auth User ID**: `181e479c-c968-455f-ab4d-5fd72ed300eb` (Role: owner_parent)

**[아이 목록]** (1명)
  1. **아이 이름**: `(이름 미지정)` | **아이 로그인 이메일**: `child_dev_21993202@kbestie.local` | **Child Profile ID**: `(매핑 프로필 없음)` | **아이 Auth User ID**: `9a7a30ba-20d1-41f0-b6cd-71daba286479`

---

#### 👨‍👩‍👧‍👦 가족 26: QA 테스트 가족
- **Family ID**: `ddafdb1e-f529-4ca3-a27a-eaf952d2a571`
- **생성자 Auth UID**: `82993d8b-2349-46f9-a2c9-25de67e01f9d` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `dev_qa_full_1786022008821@kbestie.local` | **부모 이름**: `QA 부모` | **Auth User ID**: `82993d8b-2349-46f9-a2c9-25de67e01f9d` (Role: owner_parent)

**[아이 목록]** (2명)
  1. **아이 이름**: `(이름 미지정)` | **아이 로그인 이메일**: `child_dev_22008821@kbestie.local` | **Child Profile ID**: `(매핑 프로필 없음)` | **아이 Auth User ID**: `7edff2c1-cd6a-42e6-b768-d4a77ea147ac`
  2. **아이 이름**: `김민수` | **아이 로그인 이메일**: `아이 Auth 매핑 없음` | **Child Profile ID**: `3fa1ec90-fd40-4d5c-9e71-a979c7379ba4` | **아이 Auth User ID**: `(Auth UID 없음)`

---

#### 👨‍👩‍👧‍👦 가족 27: 기존가족
- **Family ID**: `314a8d64-160a-4e89-ad3a-27ac5b01e4f6`
- **생성자 Auth UID**: `5c61c934-d079-4acf-b587-14ff3d76ee24` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_test_1786055323383@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `5c61c934-d079-4acf-b587-14ff3d76ee24` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 28: 기존검증가족
- **Family ID**: `85592a35-998d-40f6-b15f-4ea09ac48fc7`
- **생성자 Auth UID**: `2a18d575-89d2-42b7-9325-6bab139c6b82` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055369280@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `2a18d575-89d2-42b7-9325-6bab139c6b82` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 29: 기존검증가족
- **Family ID**: `1cd48d21-5872-4488-b2d2-323821281f43`
- **생성자 Auth UID**: `0c87154a-ca37-4798-8014-67f731750b03` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055527698@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `0c87154a-ca37-4798-8014-67f731750b03` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 30: 기존검증가족
- **Family ID**: `98268957-e791-49b9-96c2-d431e5544bc3`
- **생성자 Auth UID**: `81c6c0d8-3b24-413b-95d1-eaeb01b7707a` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055543208@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `81c6c0d8-3b24-413b-95d1-eaeb01b7707a` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 31: 기존검증가족
- **Family ID**: `04801976-dd16-46c9-b627-0cff8e139fc1`
- **생성자 Auth UID**: `159ee645-967a-46a2-b150-9e53cc0ce9d9` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `existing_parent_1786055568471@kbestie.com` | **부모 이름**: `기존검증부모` | **Auth User ID**: `159ee645-967a-46a2-b150-9e53cc0ce9d9` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 32: 쿠키가족
- **Family ID**: `3670ef90-1562-422e-8be1-c892383ab5ba`
- **생성자 Auth UID**: `adcf8d00-5295-47a1-99ac-1e6dc6fba6c6` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `cookie_test_1786055580118@kbestie.com` | **부모 이름**: `쿠키테스트` | **Auth User ID**: `adcf8d00-5295-47a1-99ac-1e6dc6fba6c6` (Role: owner_parent)

**[아이 목록]** (0명)
- (등록된 자녀 없음)

---

#### 👨‍👩‍👧‍👦 가족 33: 길동 가족
- **Family ID**: `088d925c-f2c4-4442-aea8-b5069b2ef140`
- **생성자 Auth UID**: `47f18bbb-a7c1-459c-80ab-365ba3b50041` 

**[부모 계정 목록]** (1명)
  1. **부모 이메일**: `humease21@gmail.com` | **부모 이름**: `홍길동` | **Auth User ID**: `47f18bbb-a7c1-459c-80ab-365ba3b50041` (Role: owner_parent)

**[아이 목록]** (1명)
  1. **아이 이름**: `홍길순` | **아이 로그인 이메일**: `hks@kbestie.local` | **Child Profile ID**: `8ad6cd8f-5409-456c-a9c9-7fc593e98a9b` | **아이 Auth User ID**: `a5f16780-2585-4c77-938c-44884909ff9d`

---

### 3. 가족 미소속 계정 (가족 연동이 끊겨있거나 완료되지 않은 계정 - 총 14개)

| 번호 | 이메일 | 이름 / 정보 | Auth User ID | 판정 역할 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `jih0405@nate.com` | `김수연` | `08564be4-ba77-4fd7-a662-84b2f22dbbae` | 부모 (parents 프로필 존재, 가족 미소속) |
| 2 | `qa_p_21530648@kbestie.local` | `QA 실가입부모` | `1f53fac9-0bd4-48c2-b4c9-c6cd55ed7316` | 부모 (parents 프로필 존재, 가족 미소속) |
| 3 | `qa_p_21496024@kbestie.local` | `QA 실가입부모` | `d8e4723b-22d5-41b4-9b77-58989b45f34d` | 부모 (parents 프로필 존재, 가족 미소속) |
| 4 | `dev_qa_real_1786021477086@kbestie.local` | `QA 실가입부모` | `190b18d7-f334-46e2-8968-5a404108a7c4` | 부모 (parents 프로필 존재, 가족 미소속) |
| 5 | `dev_qa_real_parent_1786021458724@kbestie.local` | `QA 실가입부모` | `b06d6798-2974-489c-92a0-5842993ee692` | 부모 (parents 프로필 존재, 가족 미소속) |
| 6 | `dev_qa_real_parent_1786021439507@kbestie.local` | `QA 실가입부모` | `94c6b9be-c165-4122-bbb9-f2998c5a18b9` | 부모 (parents 프로필 존재, 가족 미소속) |
| 7 | `dev_qa_real_parent_1786021422727@kbestie.local` | `QA 실가입부모` | `55f8512b-1818-4768-a574-fd02345f66c6` | 부모 (parents 프로필 존재, 가족 미소속) |
| 8 | `dev_qa_full_1786021379837@kbestie.local` | `QA 부모` | `df334802-70a4-45d4-9704-ea810a0d58c5` | 부모 (parents 프로필 존재, 가족 미소속) |
| 9 | `hks1@kbestie.local` | `테스트` | `705cdf69-29c2-4a79-9bed-16a05913149e` | 부모 (parents 프로필 존재, 가족 미소속) |
| 10 | `hks2@kbestie.local` | `홍길순` | `b309919d-60fd-48df-9214-e0a56b906808` | 부모 (parents 프로필 존재, 가족 미소속) |
| 11 | `qa-ui-1785997510629@kbestie.local` | `온보딩유저` | `3086d2af-38fe-4272-af98-187b99ba524e` | 부모 (parents 프로필 존재, 가족 미소속) |
| 12 | `markytb80@gmail.com` | `Mark An` | `c7e7c43e-2c59-4bf6-81c2-6bbc521caeec` | 부모 (parents 프로필 존재, 가족 미소속) |
| 13 | `testa-prod@kbestie.local` | `테스트01` | `b6a0fc76-b463-42e7-a619-8d9192fb01a4` | 부모 (parents 프로필 존재, 가족 미소속) |
| 14 | `test_family@example.com` | `테스트02` | `33333333-3333-3333-3333-333333333333` | 부모 (parents 프로필 존재, 가족 미소속) |

---

### 4. Auth-only 계정 (parents / child_profiles 프로필 미생성 계정 - 총 1개)

| 번호 | 이메일 | Auth User ID | 생성 일시 |
| :--- | :--- | :--- | :--- |
| 1 | `qa-ui-notice-1785994291105@kbestie.local` | `ea6ec515-1e5e-43cc-baae-5075b6f52623` | 2026-08-06T05:31:31.025327Z |

---

### 5. 고유 카운트 집계 보고

- **고유 활성 가족 수 (`families` 테이블 기준)**: **33개**
- **고유 부모 계정 수 (활성 가족 소속 실제 부모 Auth 계정)**: **35개**
- **고유 아이 로그인 Auth 계정 수 (`family_members.role = 'child'`)**: **21개**
- **고유 Child Profile 수 (`child_profiles` 테이블 기준)**: **16개**
- **Supabase Auth 회원 수 (`auth.users` 전체 기준)**: **71개**
- **가족 미소속 / 온보딩 미완료 계정 수**: **14개**
- **Auth 전용 프로필 미생성 계정 수**: **1개**

---

### 6. 이전 80행 보고가 잘못된 원인 분석

1. **인증 계정 식별의 오류**: 이전 보고는 `parents` 테이블에 레코드가 존재하면 단순 일차원적으로 '부모 계정'이라 오판하였습니다.
2. **아이 로그인 Auth 계정의 parents 등록 구조**: 앱 런타임(`app/auth/callback/route.ts`)에서 로그인/생성 시 모든 Auth 계정에 대해 `parents` 테이블에 기본 upsert를 수행함에 따라, `asa160202@kbestie.local`, `ash160202@kbestie.local`, `1stdodo@kbestie.local`, `2nddodo@kbestie.local` 등의 **실제 아이 로그인 계정이 parents 테이블에도 존재한다는 이유만으로 부모로 잘못 집계**되었습니다.
3. **실제 역할(Role)의 Source of Truth 무시**: 실제 서비스 런타임에서 부모/아이를 결정하는 핵심인 **`family_members.role`** 과 **`child_profiles.member_id ➔ family_members.id` 매핑 고리**를 조인하지 않고 일차원적인 카테시안 곱 방식 조인을 수행하여, 한 명의 부모가 자녀 수만큼 중복 렌더링되면서 80행의 왜곡된 숫자가 발생하였습니다.
