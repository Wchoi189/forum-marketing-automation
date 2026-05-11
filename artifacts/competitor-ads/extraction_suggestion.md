## Challenging Scenario by OTT대장

```

Ppomput OTT Ad post
Title: "* 뽐 뿌 1 5 년 차 * * 유튜브 프리미엄 49,000원 최저가! (선충전후결제)"

최근 뽐뿌 글작성 기준이 완화되면서 아이디를 바꾸거나 아이디만 빌려서 글올리는 판매자와는 다릅니다.

ott대장은뽐뿌 2012년 가입, 뽐뿌에서제미나이 판매기간 1년이상입니다



1. 유튜브 프리미엄 12개월 49,000원



고객님의 계정에 충전해드리는 방식입니다.

선충전 후결제!!신청후, 충전 확인하시고 입금해주시면 됩니다.

한달단위 충전이 아닌, 1년 충전해드립니다.



2. 유튜브 프리미엄 & 제미나이 12개월 패키지 59,900원 (오피스365 1년 또는 캔바프로 1년 제공)



프리미엄은 고객님의 계정에 충전해드리는 방식


제미나이는 저희가 전달해드리는 계정을 사용하시면 됩니다.

고객님의 계정으로 사용하는 방식은 5,000원 추가됩니다. (제미나이 사용기간 6개월 추가)



패키지 런칭기념으로2번 패키지 상품 구매시, 캔바 프로 1년 또는 오피스365 1년 사은품 제공됩니다. 🌈 (한정수량. 마감시 종료)



🚨 이용 안내 및 환불 규정

• 해당 상품은 원가로 제공되기에,AS기간은 다음과 같습니다
  유튜브 프리미엄4개월!!제미나이3개월!!(충전대행이기는 하지만, 최소 4개월의 시청과 3개월의 사용은 보장해드립니다.)
  사은품 캔바는 별도의 워런티를 해드리지는 않습니다.
• 해당 상품들은 가족공유 및 다른 사람과 공유하지 않고 고객님 혼자서단독으로 사용하시는 상품입니다.

📞 1 : 1 빠른 상담 (24시간 문자 가능)

• 문자문의 : O1O-8025-4441
• 오픈카톡이 아닌 실명인증된 전화번호를 사용하니, 안심하시고 연락주시기 바랍니다
```


## 1️⃣ 추출 스키마 (JSON‑Schema 형태)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "OTT Ad Post Product Catalog",
  "type": "object",
  "properties": {
    "product_id": { "type": "string", "pattern": "^[0-9]{3,4}$", "description": "제품 구분 번호 (예: 001, 002)" },
    "title": { "type": "string", "description": "핵심 제품명 (마케팅 문구 제외)" },
    "term": { "type": "string", "description": "제공 기간 (예: 12개월, 6개월 등)" },
    "price": { "type": "string", "pattern": "^[0-9,]+원$", "description": "가격 (원 단위)" },
    "description": { "type": "string", "description": "핵심 내용 요약 – AS·보증·사용 제한 등 필수 정보만" },
    "warranty": {
      "type": "object",
      "properties": {
        "service": { "type": "string", "description": "AS·보증 서비스명" },
        "period": { "type": "string", "description": "보장 기간 (개월)" },
        "note": { "type": "string", "description": "추가 유의사항" }
    },
    "contact": {
      "type": "object",
      "properties": {
        "phone": { "type": "string", "pattern": "^01[0-9]-\\d{3,4}-\\d{4}$", "description": "문자·전화 번호" },
        "method": { "type": "string", "enum": ["SMS", "전화"], "description": "연락 방법" },
        "verification": { "type": "string", "description": "실명인증 여부 등" }
    }
  },
  "required": ["product_id", "title", "term", "price"]
}
```

> **핵심 포인트**
> * `title` 은 “*뽐뿌*”, “*선충전후결제*” 같은 마케팅 어구를 **제거**하고 **핵심 제품명**만 남긴다.
> * `term` 은 “12개월”, “6개월” 등 **제공 기간**을 추출한다.
> * `price` 은 “49,000원” 형태의 **숫자+단위**만 남긴다.
> * `description` 은 “AS 기간”, “단독 사용”, “사은품 제공 여부” 등 **필수 정보**만 요약한다.
> * `warranty`·`contact` 은 선택 필드이며, 없을 경우 `null` 로 처리한다.

---

## 2️⃣ 추출 디렉티브 (규칙 기반)

| 단계 | 목표 | 구체적인 규칙 / 정규식 |
|------|------|------------------------|
| **① 텍스트 분할** | “상품 1”, “상품 2” 등 **상품 블록**을 구분 | `^\\d+\\.` 혹은 `^\\d+번` 로 시작하는 라인 → 블록 시작 |
| **② 메타데이터 추출** | `product_id`, `title`, `term`, `price` | <br>**product_id** : 블록 번호 → `001`, `002` 등 <br>**title** : `*`·`!?`·`( )` 등 **마케팅 기호**를 제거하고 남은 핵심 단어 <br>**term** : “개월”·“개월 단위”·“12개월” 등 <br>**price** : “원” 앞에 콤마·숫자만 남김 |
| **③ 부가 정보** | AS·보증, 사은품, 제한 사항 등 | <br>**AS** : “AS기간”, “보증기간” 뒤에 나오는 숫자+개월 → `period` <br>**사은품** : “사은품”, “제공” 뒤에 “캔바”, “오피스365” 등 → `description`에 포함 <br>**사용 제한** : “가족공유 금지”, “단독 사용” → `description`에 포함 |
| **④ 연락처** | 전화번호, 문자·전화 구분 | `^\\d{3,4}-\\d{4}` (예: `O1O-8025-4441`) → `phone` <br> “문자”·“전화” 키워드 → `method` |
| **⑤ 정규화** | 불필요한 공백·줄바꿈·특수문자 제거 | `strip()`, `replace(/\s+/g, ' ')` 등 |

### 정규식 예시 (Python `re`)

```python
import re

# 1) 상품 블록 구분
blocks = re.split(r'^\d+\.\s*', raw_text, flags=re.MULTILINE)

for block in blocks:
    if not block.strip(): continue

    # 2) product_id
    pid = block[:block.find('.')].strip()   # "001", "002"

    # 3) title (마케팅 기호 제거)
    #   *뽐뿌*, *선충전후결제* 등을 제거
    title = re.sub(r'[\*\(\)\!\?]+', '', block).strip()
    #   "뽐뿌"·"선충전후결제" 등 불필요한 단어는 리스트에서 제외
    title = re.sub(r'^(뽐뿌|선충전후결제|최저가|AS기간|보증기간|사은품|한정수량|마감시 종료)', '', title).strip()

    # 4) term
    term_match = re.search(r'(\d+개월|\d+개월\s*단위)', block)
    term = term_match.group(0) if term_match else None

    # 5) price
    price_match = re.search(r'(\d{1,3}[,]?\d{3,4}원)', block)
    price = price_match.group(0) if price_match else None

    # 6) description (핵심 내용만)
    desc = re.sub(r'•?\s*', ' ', block)
    desc = re.sub(r'🚨|📞|🌈', '', desc)          # 이모티콘 제거
    desc = re.sub(r'^(AS기간|보증기간|사은품|한정수량|마감시 종료)', '', desc, flags=re.MULTILINE)
    desc = re.sub(r'고객님의 계정에 충전해드리는 방식', '', desc)
    desc = re.sub(r'제미나이는 저희가 전달해드리는 계정을 사용하시면 됩니다', '', desc)
    desc = re.sub(r'한달단위 충전이 아닌', '', desc)
    desc = re.sub(r'단독으로 사용하시는 상품입니다', '', desc)
    desc = re.sub(r'실명인증된 전화번호', '', desc)
    desc = desc.strip()

    # 7) warranty
    warranty = {}
    as_match = re.search(r'AS기간은\s*(\d+)개월', block)
    if as_match:
        warranty['period'] = f'{as_match.group(1)}개월'
    # 사은품 워런티
    if '캔바' in desc or '오피스365' in desc:
        warranty['note'] = '사은품 캔바·오피스365는 별도 워런티 없음'

    # 8) contact
    contact = {}
    phone_match = re.search(r'(\d{3,4}-\d{4})', block)
    if phone_match:
        contact['phone'] = phone_match.group(0)
        contact['method'] = 'SMS' if '문자' in block else '전화'
        contact['verification'] = '실명인증' if '실명인증' in block else None

    # 9) 결과 저장
    product = {
        "product_id": pid,
        "title": title,
        "term": term,
        "price": price,
        "description": desc,
        "warranty": warranty,
        "contact": contact
    }
    catalog.append(product)
```

> **핵심 팁**
> * **마케팅 어구** (`*`, `!`, `최저가`, `선충전후결제` 등)는 정규식 `[\*\(\)\!\?]+` 로 일괄 제거하고, 필요 시 별도 **블랙리스트**에 추가한다.
> * **가격**은 “원” 앞에 콤마가 있든 없든 `re.sub(r'[,]?', '', price)` 로 정수화 후 `int()` 로 변환하면 정렬·비교가 쉬워진다.
> * **기간**은 “개월” 외에도 “개월 단위”, “1년” 등 변형이 있을 수 있으니 `(\d+년|\d+개월)` 로 포괄적으로 잡는다.
> * **AS·보증** 문장은 “AS기간은 …개월” 혹은 “보증기간은 …개월” 형태가 대부분이므로, 해당 패턴을 먼저 잡아 `period` 를 추출하고, 나머지는 `description` 에 남긴다.

---

## 3️⃣ 전체 흐름 (Pseudo‑Code)

```
extract_catalog(raw_text):
    1. split raw_text into product blocks (by line numbers)
    2. for each block:
        a. product_id = block_number
        b. title      = clean_title(block)
        c. term       = extract_term(block)
        d. price      = extract_price(block)
        e. description = clean_description(block)
        f. warranty   = extract_warranty(description)
        g. contact    = extract_contact(block)
        h. assemble JSON according to schema
    3. return list of JSON objects
```

---

## 4️⃣ 실제 적용 예시 (결과)

```json
[
  {
    "product_id": "001",
    "title": "유튜브 프리미엄",
    "term": "12개월",
    "price": "49,000원",
    "description": "계정에 충전해드리는 방식, 선충전 후결제, 단독 사용",
    "warranty": {
      "service": "AS",
      "period": "4개월",
      "note": "제미나이·캔바 사은품은 별도 워런티 없음"
    },
    "contact": {
      "phone": "O1O-8025-4441",
      "method": "SMS",
      "verification": "실명인증"
    }
  },
  {
    "product_id": "002",
    "title": "유튜브 프리미엄 & 제미나이 패키지",
    "term": "12개월",
    "price": "59,900원",
    "description": "프리미엄·계정 충전, 제미나이 계정 제공, 사은품(캔바 프로 또는 오피스365)",
    "warranty": {
      "service": "AS",
      "period": "4개월",
      "note": "사은품 캔바는 별도 워런티 없음"
    },
    "contact": {
      "phone": "O1O-8025-4441",
      "method": "SMS",
      "verification": "실명인증"
    }
  }
]
```

---

## 5️⃣ 마무리 체크리스트

| 체크 항목 | 확인 방법 |
|----------|-----------|
| **마케팅 어구 전부 제거** | `title`, `description` 에서 `*`, `!`, `최저가`, `선충전후결제` 등 블랙리스트 적용 |
| **가격·기간 정규화** | `price` → `int(price.replace(',', ''))` , `term` → `int(term.replace('개월', ''))` |
| **필수 필드 누락 방지** | `required` 스키마에 `product_id, title, term, price` 지정 |
| **다중 상품 구분** | 블록 번호 → `product_id` 로 자동 매핑 |
| **연락처 검증** | 전화번호 형식 `01[0-9]-\d{3,4}-\d{4}` 확인 |
| **AS·보증 기간 추출** | “AS기간은 X개월”, “보증기간은 X개월” 패턴 매핑 |
| **사은품·한정 수량** | `description` 에 “사은품”, “한정수량” 포함 여부 기록 |

위 스키마와 디렉티브를 그대로 구현하거나, 필요에 따라 **필드 추가/제거**·**정규식 보강**만 하면, 다양한 뽐뿌·OTT 광고 텍스트에서도 **핵심 제품 정보만** 깔끔하게 추출할 수 있습니다. 🚀
