import { WordChainEntry } from "./dictionaryTypes";

/**
 * 끝말잇기 정적 사전 Part 8 — 얇은 음절 보강 및 실사용 거절어 보완.
 *
 * 배경:
 * 2026-08-20 Dev 환경 실측 결과, "김치전" -> "전"으로 넘겼을 때 아이가 낸
 * "전기", "전구", "전철", "전학" 등 초등학생 기본어가 사전에 없어 거절되는 문제가 발생했다.
 * 측정 결과 기존 사전(1,515단어) 중 이어갈 단어가 0개인 음절 110개, 1~2개인 음절 119개로
 * 케이가 특정 음절로 넘기면 아이가 단어를 낼 수 없거나 쉽게 막히는 현상이 있었다.
 *
 * 조치:
 * 1. 실측 거절어('전기', '전구', '전철', '전학' 등) 및 '전' 시작 기본어 보강
 * 2. 케이가 끝내는 빈도가 높은 얇은 음절(터, 탕, 차, 트, 관, 면, 원, 빵, 울, 락/낙, 등, 드, 위, 래/내, 철, 추 등)을 우선 보강
 * 3. 두음법칙(allowedNextInitials)을 고려하고, 끝음절 dead-end가 발생하지 않도록 상호 연결 검증
 * 4. 한국어 특성상 초등 일상 명사로 시작할 수 없는 음절(름, 섯, 늘, 폰, 킨 등)은 억지로 단어를 지어내지 않고 제외
 *
 * 규칙 준수: Part 1~7과 중복 0건, validateWordChainDictionary 통과, dead-end 0건.
 */
export const DICTIONARY_PART8: readonly WordChainEntry[] = [
  // ====================================================
  // 1. 실측 거절어 및 '전' 시작 기본어 보강
  // ====================================================
  // 전- (실측 거절 사례: "전기", "전구", "전철", "전학" 등)
  { word: "전기", difficulty: 1, category: "생활·사물" },
  { word: "전구", difficulty: 1, category: "생활·사물" },
  { word: "전철", difficulty: 1, category: "장소·교통" },
  { word: "전학", difficulty: 1, category: "학교생활" },
  { word: "전단지", difficulty: 2, category: "생활·사물" },
  { word: "전설", difficulty: 2, category: "생활·사물" },
  { word: "전원", difficulty: 2, category: "생활·사물" },

  // ====================================================
  // 2. 케이 빈출 끝음절 보강 (ends 많은 순)
  // ====================================================
  // 터- (ends: 15, starts: 1 ['터미널'])
  { word: "터널", difficulty: 1, category: "장소·교통" },
  { word: "터치", difficulty: 1, category: "운동·놀이" },
  { word: "터전", difficulty: 3, category: "생활·사물" },

  // 널- ('터널'/'터미널' ends 해소)
  { word: "널뛰기", difficulty: 1, category: "운동·놀이" },
  { word: "널빤지", difficulty: 2, category: "생활·사물" },

  // 탕- (ends: 13, starts: 1 ['탕수육'])
  { word: "탕후루", difficulty: 1, category: "음식" },
  { word: "탕약", difficulty: 3, category: "생활·사물" },

  // 차- (ends: 13, starts: 1 ['차'])
  { word: "차표", difficulty: 2, category: "생활·사물" },
  { word: "차선", difficulty: 2, category: "장소·교통" },
  { word: "차례상", difficulty: 2, category: "생활·사물" },

  // 트- (ends: 12, starts: 2 ['트럭', '트램펄린'])
  { word: "트로피", difficulty: 2, category: "생활·사물" },
  { word: "트리", difficulty: 1, category: "생활·사물" },

  // 관- (ends: 11, starts: 2 ['관람객', '관찰'])
  { word: "관심", difficulty: 2, category: "생활·사물" },
  { word: "관계", difficulty: 2, category: "생활·사물" },
  { word: "관중석", difficulty: 2, category: "장소·교통" },

  // 면- (ends: 10, starts: 1 ['면'])
  { word: "면봉", difficulty: 1, category: "생활·사물" },
  { word: "면도기", difficulty: 2, category: "생활·사물" },
  { word: "면발", difficulty: 1, category: "음식" },

  // 원- (ends: 10, starts: 2 ['원숭이', '원피스'])
  { word: "원반", difficulty: 1, category: "운동·놀이" },
  { word: "원인", difficulty: 2, category: "생활·사물" },
  { word: "원목", difficulty: 2, category: "생활·사물" },

  // 빵- (ends: 9, starts: 2 ['빵집', '빵'])
  { word: "빵가루", difficulty: 1, category: "음식" },
  { word: "빵가게", difficulty: 1, category: "장소·교통" },

  // 울- (ends: 8, starts: 0)
  { word: "울타리", difficulty: 1, category: "생활·사물" },
  { word: "울음", difficulty: 1, category: "신체·감각·시간" },
  { word: "울림", difficulty: 2, category: "신체·감각·시간" },

  // 락- -> 두음 낙 (ends: 8, starts: 2 ['낙타', '낙엽'])
  { word: "낙서", difficulty: 1, category: "운동·놀이" },
  { word: "낙하산", difficulty: 2, category: "생활·사물" },
  { word: "낙지", difficulty: 2, category: "음식" },

  // 등- (ends: 8, starts: 2 ['등대', '등'])
  { word: "등산", difficulty: 1, category: "운동·놀이" },
  { word: "등교", difficulty: 1, category: "학교생활" },
  { word: "등나무", difficulty: 2, category: "식물" },

  // 드- (ends: 7, starts: 0)
  { word: "드라마", difficulty: 1, category: "생활·사물" },
  { word: "드라이버", difficulty: 2, category: "도구" },
  { word: "드레스", difficulty: 1, category: "옷" },

  // 위- (ends: 7, starts: 1 ['위인전'])
  { word: "위치", difficulty: 2, category: "생활·사물" },
  { word: "위성", difficulty: 2, category: "자연·날씨" },
  { word: "위아래", difficulty: 1, category: "생활·사물" },

  // 래- -> 두음 내 (ends: 7, starts: 1 ['내일'])
  { word: "내과", difficulty: 2, category: "장소·교통" },
  { word: "내기", difficulty: 1, category: "운동·놀이" },
  { word: "내복", difficulty: 1, category: "옷" },

  // 철- (ends: 7, starts: 2 ['철쭉', '철봉'])
  { word: "철길", difficulty: 1, category: "장소·교통" },
  { word: "철사", difficulty: 2, category: "생활·사물" },
  { word: "철가면", difficulty: 2, category: "생활·사물" },

  // 추- (ends: 7, starts: 2 ['추억', '추석'])
  { word: "추위", difficulty: 1, category: "자연·날씨" },
  { word: "추리", difficulty: 2, category: "운동·놀이" },
  { word: "추장", difficulty: 2, category: "가족·사람" },

  // 통- (ends: 6, starts: 1 ['통조림'])
  { word: "통나무", difficulty: 1, category: "식물" },
  { word: "통신", difficulty: 2, category: "생활·사물" },
  { word: "통일", difficulty: 2, category: "생활·사물" },

  // 말- (ends: 6, starts: 1 ['말'])
  { word: "말벌", difficulty: 1, category: "동물" },
  { word: "말동무", difficulty: 2, category: "가족·사람" },
  { word: "말꼬리", difficulty: 1, category: "동물" },

  // 판- (ends: 6, starts: 2 ['판다', '판사'])
  { word: "판자", difficulty: 2, category: "생활·사물" },
  { word: "판소리", difficulty: 2, category: "음악" },

  // 루- -> 두음 누 (ends: 6, starts: 2 ['누나', '누룽지'])
  { word: "누에", difficulty: 2, category: "동물" },
  { word: "누렁이", difficulty: 1, category: "동물" },
  { word: "누비옷", difficulty: 2, category: "옷" },

  // 갑- (ends: 5, starts: 0)
  { word: "갑옷", difficulty: 2, category: "생활·사물" },
  { word: "갑판", difficulty: 3, category: "장소·교통" },
  { word: "갑오징어", difficulty: 2, category: "동물" },

  // 력- -> 두음 역 (ends: 5, starts: 0)
  { word: "역사", difficulty: 2, category: "학교생활" },
  { word: "역도", difficulty: 2, category: "운동·놀이" },
  { word: "역할", difficulty: 2, category: "생활·사물" },

  // 석- (ends: 5, starts: 1 ['석류'])
  { word: "석탄", difficulty: 2, category: "자연·날씨" },
  { word: "석유", difficulty: 2, category: "생활·사물" },
  { word: "석양", difficulty: 2, category: "자연·날씨" },

  // 펜- (ends: 5, starts: 1 ['펜싱'])
  { word: "펜팔", difficulty: 2, category: "생활·사물" },
  { word: "펜던트", difficulty: 2, category: "생활·사물" },

  // 박- (ends: 5, starts: 2 ['박쥐', '박물관'])
  { word: "박수", difficulty: 1, category: "생활·사물" },
  { word: "박스", difficulty: 1, category: "생활·사물" },

  // 림- -> 두음 임 (ends: 4, starts: 0)
  { word: "임금", difficulty: 1, category: "가족·사람" },
  { word: "임무", difficulty: 2, category: "생활·사물" },
  { word: "임시", difficulty: 2, category: "생활·사물" },

  // 필- (ends: 4, starts: 1 ['필통'])
  { word: "필기구", difficulty: 2, category: "학교생활" },
  { word: "필승", difficulty: 2, category: "운동·놀이" },

  // 범- (ends: 4, starts: 1 ['범고래'])
  { word: "범인", difficulty: 2, category: "가족·사람" },
  { word: "범선", difficulty: 3, category: "장소·교통" },
  { word: "범위", difficulty: 2, category: "생활·사물" },

  // 잎- (ends: 4, starts: 1 ['잎'])
  { word: "잎사귀", difficulty: 1, category: "식물" },
  { word: "잎자루", difficulty: 2, category: "식물" },

  // 빛- (ends: 4, starts: 1 ['빛'])
  { word: "빛줄기", difficulty: 2, category: "자연·날씨" },
  { word: "빛깔", difficulty: 2, category: "생활·사물" },

  // 깔- ('빛깔'/'색깔' ends 해소)
  { word: "깔때기", difficulty: 2, category: "도구" },

  // 쥐- (ends: 3, starts: 0)
  { word: "쥐꼬리", difficulty: 1, category: "동물" },
  { word: "쥐며느리", difficulty: 2, category: "동물" },
  { word: "쥐구멍", difficulty: 1, category: "동물" },

  // 멍- ('콧구멍'/'쥐구멍' ends 해소)
  { word: "멍멍이", difficulty: 1, category: "동물" },

  // 굴- (ends: 3, starts: 0)
  { word: "굴뚝", difficulty: 1, category: "생활·사물" },
  { word: "굴렁쇠", difficulty: 2, category: "운동·놀이" },
  { word: "굴비", difficulty: 2, category: "음식" },

  // 쇠- ('굴렁쇠' ends 해소 및 ends: 2 해소)
  { word: "쇠고기", difficulty: 1, category: "음식" },
  { word: "쇠구슬", difficulty: 1, category: "놀이" },
  { word: "쇠사슬", difficulty: 2, category: "도구" },

  // 극- (ends: 3, starts: 0)
  { word: "극장", difficulty: 1, category: "장소·교통" },
  { word: "극본", difficulty: 2, category: "생활·사물" },
  { word: "극지방", difficulty: 2, category: "장소·교통" },

  // 본- ('극본'/'리본' ends 해소)
  { word: "본드", difficulty: 2, category: "도구" },
  { word: "본부", difficulty: 2, category: "장소·교통" },

  // 투- (ends: 3, starts: 0)
  { word: "투구", difficulty: 2, category: "생활·사물" },
  { word: "투수", difficulty: 1, category: "운동·놀이" },
  { word: "투표", difficulty: 2, category: "생활·사물" },

  // 둑- (ends: 3, starts: 0)
  { word: "둑길", difficulty: 2, category: "장소·교통" },

  // 촌- (ends: 3, starts: 0)
  { word: "촌락", difficulty: 2, category: "장소·교통" },
  { word: "촌수", difficulty: 2, category: "가족·사람" },
  { word: "촌장", difficulty: 2, category: "가족·사람" },

  // 답- (ends: 3, starts: 0)
  { word: "답장", difficulty: 1, category: "생활·사물" },
  { word: "답안지", difficulty: 2, category: "학교생활" },
  { word: "답사", difficulty: 2, category: "생활·사물" },

  // 당- (ends: 3, starts: 1 ['당근'])
  { word: "당나귀", difficulty: 1, category: "동물" },
  { word: "당구", difficulty: 2, category: "운동·놀이" },

  // 흙- (ends: 3, starts: 1 ['흙'])
  { word: "흙장난", difficulty: 1, category: "운동·놀이" },
  { word: "흙벽돌", difficulty: 2, category: "생활·사물" },

  // 회- (ends: 3, starts: 1 ['회오리'])
  { word: "회의", difficulty: 2, category: "생활·사물" },
  { word: "회사", difficulty: 1, category: "장소·교통" },
  { word: "회원", difficulty: 2, category: "가족·사람" },

  // 채- (ends: 3, starts: 1 ['채송화'])
  { word: "채소", difficulty: 1, category: "음식" },
  { word: "채점", difficulty: 2, category: "학교생활" },

  // 죽- (ends: 3, starts: 1 ['죽'])
  { word: "죽순", difficulty: 2, category: "음식" },
  { word: "죽마고우", difficulty: 3, category: "가족·사람" },

  // 술- (ends: 3, starts: 1 ['술'])
  { word: "술래", difficulty: 1, category: "운동·놀이" },
  { word: "술잔", difficulty: 2, category: "생활·사물" },

  // 커- (ends: 3, starts: 1 ['커피'])
  { word: "커버", difficulty: 1, category: "생활·사물" },
  { word: "커트", difficulty: 2, category: "운동·놀이" },

  // 북- (ends: 3, starts: 2 ['북극', '북극곰'])
  { word: "북소리", difficulty: 1, category: "음악" },

  // 봉- (ends: 3, starts: 2 ['봉투', '봉선화'])
  { word: "봉사", difficulty: 2, category: "생활·사물" },

  // 복- (ends: 3, starts: 2 ['복숭아', '복도'])
  { word: "복주머니", difficulty: 1, category: "생활·사물" },

  // 컵- (ends: 3, starts: 2 ['컵', '컵라면'])
  { word: "컵밥", difficulty: 1, category: "음식" },

  // 업- (ends: 2, starts: 0)
  { word: "업무", difficulty: 2, category: "생활·사물" },
  { word: "업적", difficulty: 3, category: "생활·사물" },

  // 론- -> 두음 논 (ends: 2, starts: 0)
  { word: "논리", difficulty: 2, category: "생활·사물" },
  { word: "논술", difficulty: 2, category: "학교생활" },

  // 묵- (ends: 2, starts: 0)
  { word: "묵사발", difficulty: 2, category: "음식" },

  // 덕- (ends: 2, starts: 0)
  { word: "덕담", difficulty: 2, category: "생활·사물" },
  { word: "덕분", difficulty: 2, category: "생활·사물" },

  // 억- (ends: 2, starts: 0)
  { word: "억만장자", difficulty: 2, category: "가족·사람" },
  { word: "억지", difficulty: 2, category: "생활·사물" },

  // 함- (ends: 2, starts: 1 ['함박눈'])
  { word: "함수", difficulty: 2, category: "학교생활" },
  { word: "함정", difficulty: 2, category: "생활·사물" },

  // 슬- (ends: 2, starts: 1 ['슬리퍼'])
  { word: "슬라이드", difficulty: 2, category: "놀이" },

  // 벽- (ends: 2, starts: 1 ['벽'])
  { word: "벽지", difficulty: 1, category: "생활·사물" },
  { word: "벽돌", difficulty: 1, category: "생활·사물" },
  { word: "벽화", difficulty: 2, category: "생활·사물" },

  // 길- (ends: 2, starts: 1 ['길'])
  { word: "길거리", difficulty: 1, category: "장소·교통" },
  { word: "길안내", difficulty: 2, category: "생활·사물" },

  // 민- (ends: 2, starts: 1 ['민들레'])
  { word: "민속놀이", difficulty: 2, category: "운동·놀이" },
  { word: "민요", difficulty: 2, category: "음악" },

  // 칼- (ends: 2, starts: 1 ['칼'])
  { word: "칼자루", difficulty: 2, category: "도구" },
  { word: "칼집", difficulty: 1, category: "생활·사물" },

  // 깨- (ends: 2, starts: 1 ['깨'])
  { word: "깨소금", difficulty: 1, category: "음식" },
  { word: "깨죽", difficulty: 2, category: "음식" },

  // 톱- (ends: 2, starts: 1 ['톱니'])
  { word: "톱밥", difficulty: 2, category: "생활·사물" },
  { word: "톱질", difficulty: 2, category: "생활·사물" },

  // 혜- (ends: 2, starts: 1 ['혜성'])
  { word: "혜택", difficulty: 2, category: "생활·사물" },

  // 뼈- (ends: 2, starts: 1 ['뼈'])
  { word: "뼈다귀", difficulty: 1, category: "생활·사물" },
  { word: "뼈마디", difficulty: 2, category: "신체·감각·시간" },

  // 플- (ends: 2, starts: 1 ['플루트'])
  { word: "플러그", difficulty: 2, category: "도구" },

  // 귤- (ends: 2, starts: 1 ['귤'])
  { word: "귤껍질", difficulty: 1, category: "음식" },
  { word: "귤나무", difficulty: 1, category: "식물" },

  // 찰- (ends: 2, starts: 1 ['찰흙'])
  { word: "찰떡", difficulty: 1, category: "음식" },
  { word: "찰옥수수", difficulty: 2, category: "음식" },

  // 더- (ends: 2, starts: 1 ['더위'])
  { word: "더듬이", difficulty: 1, category: "동물" },
  { word: "더덕", difficulty: 2, category: "음식" },

  // 행- (ends: 2, starts: 2 ['행주', '행성'])
  { word: "행운", difficulty: 1, category: "생활·사물" },
  { word: "행사", difficulty: 1, category: "학교생활" },

  // 타- (ends: 2, starts: 2 ['타조', '타월'])
  { word: "타이어", difficulty: 1, category: "생활·사물" },
  { word: "타자", difficulty: 2, category: "운동·놀이" },

  // 살- (ends: 2, starts: 2 ['살구', '살'])
  { word: "살코기", difficulty: 1, category: "음식" },
  { word: "살얼음", difficulty: 2, category: "자연·날씨" },

  // 옷- (ends: 2, starts: 2 ['옷걸이', '옷장'])
  { word: "옷장사", difficulty: 2, category: "가족·사람" },

  // 들- (ends: 2, starts: 2 ['들꽃', '들판'])
  { word: "들국화", difficulty: 2, category: "식물" },
  { word: "들개", difficulty: 1, category: "동물" },

  // 풀- (ends: 2, starts: 2 ['풀', '풀잎'])
  { word: "풀벌레", difficulty: 1, category: "동물" },
  { word: "풀피리", difficulty: 1, category: "음악" },

  // 금- (ends: 2, starts: 2 ['금메달', '금붕어'])
  { word: "금반지", difficulty: 1, category: "생활·사물" },
  { word: "금고", difficulty: 1, category: "생활·사물" },
  { word: "금연", difficulty: 2, category: "생활·사물" },

  // ====================================================
  // 3. ends: 1 및 추가 기본어 보강
  // ====================================================
  // 습- (ends: 2, starts: 0)
  { word: "습관", difficulty: 2, category: "생활·사물" },
  { word: "습기", difficulty: 2, category: "생활·사물" },
  { word: "습지", difficulty: 2, category: "자연·날씨" },

  // 날- (ends: 1, starts: 0)
  { word: "날개", difficulty: 1, category: "동물" },
  { word: "날씨", difficulty: 1, category: "자연·날씨" },
  { word: "날짜", difficulty: 1, category: "신체·감각·시간" },

  // 몸- (ends: 1, starts: 0)
  { word: "몸무게", difficulty: 1, category: "신체·감각·시간" },
  { word: "몸통", difficulty: 1, category: "신체·감각·시간" },

  // 암- (ends: 1, starts: 0)
  { word: "암석", difficulty: 2, category: "자연·날씨" },
  { word: "암소", difficulty: 1, category: "동물" },

  // 록- -> 두음 녹 (ends: 1, starts: 0)
  { word: "녹차", difficulty: 1, category: "음식" },
  { word: "녹음기", difficulty: 2, category: "도구" },
  { word: "녹색", difficulty: 1, category: "생활·사물" },

  // 짐- (ends: 1, starts: 0)
  { word: "짐승", difficulty: 2, category: "동물" },
  { word: "짐차", difficulty: 2, category: "장소·교통" },

  // 총- (ends: 1, starts: 0)
  { word: "총알", difficulty: 2, category: "생활·사물" },
  { word: "총각김치", difficulty: 2, category: "음식" },

  // 궁- (ends: 1, starts: 0)
  { word: "궁전", difficulty: 1, category: "장소·교통" },
  { word: "궁수", difficulty: 2, category: "가족·사람" },

  // 출- (ends: 1, starts: 0)
  { word: "출구", difficulty: 1, category: "장소·교통" },
  { word: "출발", difficulty: 1, category: "장소·교통" },
  { word: "출석부", difficulty: 2, category: "학교생활" },

  // 둥- (ends: 1, starts: 0)
  { word: "둥지", difficulty: 1, category: "자연·날씨" },
  { word: "둥근달", difficulty: 1, category: "자연·날씨" },

  // 찌- (ends: 1, starts: 0)
  { word: "찌개", difficulty: 1, category: "음식" },

  // 끈- (ends: 1, starts: 0)
  { word: "끈기", difficulty: 2, category: "생활·사물" },

  // 낭- (ends: 1, starts: 0)
  { word: "낭떠러지", difficulty: 2, category: "자연·날씨" },
  { word: "낭비", difficulty: 2, category: "생활·사물" },

  // 척- (ends: 1, starts: 0)
  { word: "척추", difficulty: 2, category: "신체·감각·시간" },
  { word: "척도", difficulty: 3, category: "생활·사물" },

  // 휘- (ends: 1, starts: 0)
  { word: "휘파람", difficulty: 1, category: "음악" },

  // 걱- (ends: 1, starts: 0)
  { word: "걱정", difficulty: 1, category: "생활·사물" },

  // 몽- (ends: 1, starts: 0)
  { word: "몽당연필", difficulty: 1, category: "학교생활" },

  // 낵/넥 (ends: 1, starts: 0)
  { word: "넥타이", difficulty: 1, category: "옷" },

  // 혼- (ends: 1, starts: 0)
  { word: "혼합물", difficulty: 2, category: "학교생활" },
  { word: "혼잣말", difficulty: 2, category: "생활·사물" },

  // 격- (ends: 1, starts: 0)
  { word: "격투기", difficulty: 2, category: "운동·놀이" },
  { word: "격려", difficulty: 2, category: "생활·사물" },

  // 싱- (ends: 1, starts: 0)
  { word: "싱크대", difficulty: 1, category: "생활·사물" },

  // 컨- (ends: 1, starts: 0)
  { word: "컨테이너", difficulty: 2, category: "장소·교통" },

  // 객- (ends: 1, starts: 0)
  { word: "객차", difficulty: 2, category: "장소·교통" },
  { word: "객실", difficulty: 2, category: "장소·교통" },

  // 닥- (ends: 1, starts: 0)
  { word: "닥종이", difficulty: 2, category: "생활·사물" },

  // 랑- -> 두음 낭 (ends: 1, starts: 0)
  { word: "낭독", difficulty: 2, category: "학교생활" },
  { word: "낭만", difficulty: 3, category: "생활·사물" },

  // 랍- -> 두음 납 (ends: 1, starts: 0)
  { word: "납자루", difficulty: 2, category: "동물" },

  // 몬- (ends: 1, starts: 0)
  { word: "몬스터", difficulty: 2, category: "놀이" },

  // 디- (ends: 1, starts: 1 ['디자이너'])
  { word: "디저트", difficulty: 1, category: "음식" },
  { word: "디딤돌", difficulty: 2, category: "생활·사물" },

  // 벌- (ends: 1, starts: 1 ['벌집'])
  { word: "벌판", difficulty: 1, category: "자연·날씨" },
  { word: "벌레", difficulty: 1, category: "동물" },

  // 변- (ends: 1, starts: 1 ['변호사'])
  { word: "변기", difficulty: 1, category: "생활·사물" },
  { word: "변신", difficulty: 1, category: "운동·놀이" },

  // 네- (ends: 1, starts: 1 ['네임펜'])
  { word: "네모", difficulty: 1, category: "학교생활" },
  { word: "네잎클로버", difficulty: 1, category: "식물" },

  // 질- (ends: 1, starts: 1 ['질문'])
  { word: "질주", difficulty: 2, category: "운동·놀이" },
  { word: "질서", difficulty: 2, category: "학교생활" },

  // 빙- (ends: 1, starts: 1 ['빙하'])
  { word: "빙수", difficulty: 1, category: "음식" },
  { word: "빙판", difficulty: 2, category: "자연·날씨" },

  // 난- (ends: 1, starts: 1 ['난로'])
  { word: "난타", difficulty: 2, category: "음악" },
  { word: "난방", difficulty: 2, category: "생활·사물" },

  // 속- (ends: 1, starts: 1 ['속눈썹'])
  { word: "속담", difficulty: 2, category: "학교생활" },
  { word: "속도", difficulty: 2, category: "생활·사물" },

  // 절- (ends: 1, starts: 1 ['절벽'])
  { word: "절약", difficulty: 2, category: "생활·사물" },
  { word: "절친", difficulty: 1, category: "가족·사람" },

  // 근- (ends: 1, starts: 1 ['근육'])
  { word: "근교", difficulty: 2, category: "장소·교통" },
  { word: "근본", difficulty: 2, category: "생활·사물" },

  // 글- (ends: 1, starts: 1 ['글자'])
  { word: "글씨", difficulty: 1, category: "학교생활" },
  { word: "글짓기", difficulty: 1, category: "학교생활" },

  // 턱- (ends: 1, starts: 1 ['턱'])
  { word: "턱걸이", difficulty: 1, category: "운동·놀이" },

  // 힘- (ends: 1, starts: 1 ['힘'])
  { word: "힘자랑", difficulty: 1, category: "운동·놀이" },

  // 숲- (ends: 1, starts: 1 ['숲'])
  { word: "숲속", difficulty: 1, category: "자연·날씨" },
  { word: "숲길", difficulty: 1, category: "장소·교통" },

  // 섬- (ends: 1, starts: 1 ['섬'])
  { word: "섬나라", difficulty: 1, category: "장소·교통" },

  // 샘- (ends: 1, starts: 1 ['샘'])
  { word: "샘물", difficulty: 1, category: "자연·날씨" },

  // 꿀- (ends: 1, starts: 1 ['꿀'])
  { word: "꿀벌", difficulty: 1, category: "동물" },
  { word: "꿀떡", difficulty: 1, category: "음식" },

  // 엿- (ends: 1, starts: 1 ['엿'])
  { word: "엿가락", difficulty: 1, category: "음식" },
  { word: "엿장수", difficulty: 1, category: "가족·사람" },

  // 적- (ends: 1, starts: 1 ['적도'])
  { word: "적군", difficulty: 2, category: "가족·사람" },
  { word: "적금", difficulty: 2, category: "생활·사물" },

  // 악- (ends: 1, starts: 1 ['악어'])
  { word: "악기", difficulty: 1, category: "음악" },
  { word: "악보", difficulty: 1, category: "음악" },

  // 접- (ends: 1, starts: 1 ['접시'])
  { word: "접착제", difficulty: 2, category: "도구" },

  // 향- (ends: 1, starts: 1 ['향수'])
  { word: "향기", difficulty: 1, category: "생활·사물" },
  { word: "향나무", difficulty: 2, category: "식물" },

  // 탄- (ends: 1, starts: 1 ['탄산수'])
  { word: "탄생", difficulty: 2, category: "생활·사물" },
  { word: "탄산음료", difficulty: 1, category: "음식" },

  // 막- (ends: 1, starts: 2 ['막내', '막대사탕'])
  { word: "막대기", difficulty: 1, category: "도구" },

  // 천- (ends: 1, starts: 2 ['천둥', '천왕성'])
  { word: "천사", difficulty: 1, category: "가족·사람" },
  { word: "천막", difficulty: 2, category: "생활·사물" },

  // 솔- (ends: 1, starts: 2 ['솔방울', '솔개'])
  { word: "솔잎", difficulty: 1, category: "식물" },

  // 탁- (ends: 1, starts: 2 ['탁구', '탁구공'])
  { word: "탁상시계", difficulty: 2, category: "생활·사물" },

  // 택- (ends: 1, starts: 2 ['택시', '택배기사'])
  { word: "택배", difficulty: 1, category: "생활·사물" },

  // 항- (ends: 1, starts: 2 ['항구', '항해사'])
  { word: "항공기", difficulty: 2, category: "탈것" },
  { word: "항해", difficulty: 2, category: "운동·놀이" },

  // 옥- (ends: 1, starts: 2 ['옥수수', '옥상'])
  { word: "옥반지", difficulty: 2, category: "생활·사물" },

  // 돌- (ends: 1, starts: 2 ['돌고래', '돌'])
  { word: "돌다리", difficulty: 1, category: "장소·교통" },

  // 낮- (ends: 1, starts: 2 ['낮잠', '낮'])
  { word: "낮달", difficulty: 2, category: "자연·날씨" },

  // 월- (ends: 1, starts: 2 ['월식', '월요일'])
  { word: "월드컵", difficulty: 1, category: "운동·놀이" },

  // 숙- (ends: 1, starts: 2 ['숙제', '숙주나물'])
  { word: "숙모", difficulty: 2, category: "가족·사람" },

  // 붕- (ends: 1, starts: 2 ['붕어빵', '붕대'])
  { word: "붕어", difficulty: 1, category: "동물" },

  // ====================================================
  // 4. 연결 보강용 기본어 (예-, 중-, 곡-)
  // ====================================================
  { word: "예술", difficulty: 2, category: "생활·사물" },
  { word: "예절", difficulty: 2, category: "생활·사물" },
  { word: "예방주사", difficulty: 1, category: "생활·사물" },

  { word: "중심", difficulty: 2, category: "생활·사물" },
  { word: "중학교", difficulty: 1, category: "학교생활" },
  { word: "중력", difficulty: 2, category: "자연·날씨" },

  { word: "곡식", difficulty: 1, category: "음식" },
  { word: "곡물", difficulty: 2, category: "음식" },
  { word: "곡선", difficulty: 2, category: "생활·사물" },
];
