package kr.milestamp.phone.auto

/** 서버 답 예시 (web/src/app/api/plan·plan/course·catalog 모양, 폰 앱 plan.ts·course.ts와 같음) */
object Samples {
    const val PLAN = """
{"planId":"p1","day":"2026-10-31","reused":false,"chosen":0,"chosenBy":"폰:아빠","backBy":"sunset-30","createdAt":"",
 "sky":{"sunrise":"06:52","sunset":"17:42","sky":"CLEAR","rainFrom":null},
 "plan":{"mode":"MORNING","now":"09:10","nowMin":550,"budgetMin":400,"backByMin":1032,"options":[
  {"kind":"COURSE","label":"","firstLegMin":12,"detourMin":null,"arriveHomeMin":1009,"legs":[],
   "stops":[{"id":"chimsan","name":"침산공원","lat":35.9100,"lng":128.5900,"indoor":false,"stampable":true},
            {"id":"science","name":"국립대구과학관","lat":35.6870,"lng":128.4380,"indoor":true,"stampable":true}],
   "reasons":[{"text":"차에서 한숨 자고 도착","tone":"NAP"},{"text":"도장 2개","tone":"STAMP"}]},
  {"kind":"COURSE","label":"","firstLegMin":25,"detourMin":null,"arriveHomeMin":990,"legs":[],
   "stops":[{"id":"hwabon","name":"화본역","lat":36.1590,"lng":128.7370,"indoor":false,"stampable":true}],
   "reasons":[{"text":"해 지기 전 귀가","tone":"SUN"}]},
  {"kind":"GO_HOME","label":"","firstLegMin":0,"detourMin":null,"arriveHomeMin":560,"legs":[],"stops":[],"reasons":[]}
 ]}}"""

    const val COURSE = """
{"version":3,"course":{"id":"c1","version":3,"chosenBy":"폰:아빠","chosenAtMin":560,"nowMin":700,"arriveHomeMin":1009,"limitMin":1024,"slackMin":15,
 "stops":[{"placeId":"chimsan","status":"ARRIVED","plannedArriveMin":585,"plannedDepartMin":660,"dwellGuessMin":75},
          {"placeId":"science","status":"PLANNED","plannedArriveMin":760,"plannedDepartMin":880,"dwellGuessMin":120}],
 "legs":[]},
 "explain":{"headline":"계획대로 가고 있어요","body":"다음 곳에 12:40에 도착해요. 집에는 16:49쯤 와요."}}"""

    const val OUTCOME = """
{"kind":"Proposal","voice":"조금 더 놀면 과학관을 빼는 게 좋겠어요",
 "change":{"text":"과학관 빼면 귀가 16:10","cause":"덜 놀기","deltaHomeMin":-39,"size":"SOFT","atMin":700},
 "course":{"version":4,"arriveHomeMin":1009,"limitMin":1024,"stops":[{"placeId":"chimsan","status":"ARRIVED","plannedArriveMin":585}],"legs":[]},
 "options":[
  {"kind":"COURSE","label":"과학관 빼고 바로 집으로","firstLegMin":12,"arriveHomeMin":970,"stops":[],"reasons":[]},
  {"kind":"COURSE","label":"과학관 대신 어린이세상","firstLegMin":15,"arriveHomeMin":1000,"stops":[{"id":"kids","name":"어린이세상","lat":35.88,"lng":128.62,"stampable":true}],"reasons":[]}
 ]}"""

    const val CATALOG = """
{"version":7,"groups":[],"restaurants":[],"places":[
 {"id":"chimsan","name":"침산공원","lat":35.9100,"lng":128.5900,"radiusM":300,"indoor":false,"stampable":true,
  "points":[{"lat":35.9100,"lng":128.5900,"r":250,"name":"정문"},{"lat":35.9120,"lng":128.5930,"r":200,"name":"주차장"}],
  "stamp":{"url":"https://r2.example/stamps/chimsan.webp","bwUrl":"https://r2.example/stamps/chimsan_bw.webp","version":2}},
 {"id":"science","name":"국립대구과학관","lat":35.6870,"lng":128.4380,"radiusM":300,"indoor":true,"stampable":true,"points":[],
  "stamp":{"url":null,"bwUrl":null,"version":0}},
 {"id":"hwabon","name":"화본역","lat":36.1590,"lng":128.7370,"radiusM":300,"indoor":false,"stampable":true,"points":[],
  "stamp":{"url":null,"bwUrl":null,"version":0}}
]}"""

    /** 묶음·축제까지 든 명소 목록 (/api/catalog 모양) */
    const val CATALOG_FULL = """
{"version":8,"groups":[{"key":"season1","title":"대구·경북 시즌 1"},{"key":"town","title":"우리 동네 평일 오후"}],"restaurants":[],
 "places":[
 {"id":"chimsan","name":"침산공원","grp":"town","lat":35.9100,"lng":128.5900,"radiusM":300,"indoor":false,"stampable":true,"points":[],
  "stamp":{"url":null,"bwUrl":null,"version":0}},
 {"id":"science","name":"국립대구과학관","grp":"season1","lat":35.6870,"lng":128.4380,"radiusM":300,"indoor":true,"stampable":true,"points":[],
  "stamp":{"url":null,"bwUrl":null,"version":0}},
 {"id":"hwabon","name":"화본역","grp":"season1","lat":36.1590,"lng":128.7370,"radiusM":300,"indoor":false,"stampable":true,"points":[],
  "stamp":{"url":null,"bwUrl":null,"version":0}},
 {"id":"thearc","name":"디아크","grp":"season1","lat":35.8340,"lng":128.4630,"radiusM":300,"indoor":false,"stampable":true,"points":[],
  "stamp":{"url":null,"bwUrl":null,"version":0}}
 ],
 "festivals":[
 {"id":"fest-palgong","name":"팔공산 단풍축제","summary":null,"placeId":null,"points":[{"lat":36.0110,"lng":128.6930,"r":400,"name":"케이블카"}],
  "lat":36.0110,"lng":128.6930,"starts":"2026-10-24","ends":"2026-11-09","season":"2026 가을","stamp":{"url":null,"bwUrl":null,"version":0},"ring":"festival","status":"ongoing"}
 ]}"""
}
