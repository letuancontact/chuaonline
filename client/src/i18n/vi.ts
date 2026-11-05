// Every piece of UI copy lives here (D5). index.html pulls the boot strings in at build time via `{{vi.…}}`.

// Fixed wording (P4 principle 12): the guest button and the `login` refusal share it.
const needAccount = "Tạo tài khoản để trò chuyện cùng mọi người";

export const vi = {
  meta: {
    title: "Sân Tĩnh — ngồi yên cùng nhau",
    description: "Khuôn viên chùa 3D ngay trên trình duyệt: đi dạo trong vườn, lạy Phật, lần tràng hạt và ngồi yên cùng người khác.",
    noscript: "Sân Tĩnh cần bật JavaScript để mở khung cảnh 3D.",
  },
  /** Text on the social preview image (`npm run og -w client`). */
  og: {
    title: "Sân Tĩnh",
    tagline: "Ngồi yên cùng nhau",
    line: "Khuôn viên chùa 3D ngay trên trình duyệt. Đi dạo, lạy Phật, lần tràng hạt cùng người khác.",
    alt: "Lối đá có đèn lồng dẫn vào chánh điện về đêm, tượng Phật sáng phía trong",
  },
  boot: {
    title: "Sân Tĩnh",
    loading: "Đang mở cổng chùa",
    retry: "Vào lại",
    loadErrorTitle: "Không tải được khung cảnh",
    loadErrorBody: "Kiểm tra kết nối rồi vào lại nhé",
    noWebglTitle: "Không mở được 3D",
    noWebglBody: "Trình duyệt này không vẽ được cảnh 3D. Hãy mở lại bằng Chrome, Safari hoặc Edge bản mới.",
  },
  hall: {
    /** Signboard above the hall door (D10). */
    sign: "寂默堂",
  },
  walk: {
    stop: "Đang đi · Dừng",
  },
  hud: {
    brand: "Sân Tĩnh",
    exit: "Rời Sân Tĩnh",
    /** `{n}` = room number. */
    /** `{n}` = number, `{room}` = name (D26). */
    room: "{room}",
    roomPill: "Phòng {n} · {room}. Chọn phòng",
    offering: "Cúng dường",
    /** `{n}` = people in the room (NPCs not counted). */
    people: "{n} người đang ở đây. Xem ai đang ở đây",
    peopleConnecting: "Đang kết nối. Xem ai đang ở đây",
    peopleOffline: "Mất kết nối. Xem ai đang ở đây",
    peopleUnknown: "…",
    invite: "Mời bạn ngồi cạnh",
    inviteShort: "Mời bạn",
    soundOn: "Bật tiếng",
    soundOff: "Tắt tiếng",
    settings: "Cài đặt",
    chant: "Nghe tụng kinh",
    actions: "Việc có thể làm",
    hello: "Chắp tay",
    bow: "Thiền",
    stand: "Dừng",
    beads: "Tràng hạt",
    hintPointer: "Bấm xuống sàn hoặc WASD để đi · kéo để nhìn quanh · cuộn để phóng to/thu nhỏ",
    hintTouch: "Chạm để đi · vuốt nhìn quanh · 2 ngón phóng to",
  },
  offering: {
    title: "Cúng dường · Tâm nguyện",
    close: "Đóng",
    desc: "Khởi tâm thanh tịnh, dâng nén tâm hương lên chánh điện hoặc thả đèn hoa đăng xuống hồ sen.",
    wishLabel: "Lời nguyện ước bình an (tùy chọn)",
    wishPlaceholder: "Cầu bình an, sức khỏe và tịnh tâm…",
    incenseTitle: "Dâng hương lễ Phật",
    incenseDesc: "Thắp sáng lư hương trầm trước bàn thờ Phật trong chánh điện",
    incenseAction: "Dâng hương",
    lanternTitle: "Thả đèn hoa đăng",
    lanternDesc: "Thả đóa sen sáng trôi nhẹ trên mặt hồ sen phía đông",
    lanternAction: "Thả hoa đăng",
    bellTitle: "Thỉnh đại hồng chung",
    bellDesc: "Ngân tiếng chuông chùa trầm ấm, thức tỉnh tâm niệm",
    bellAction: "Thỉnh chuông",
    woodblockTitle: "Gõ mõ tịnh tâm",
    woodblockDesc: "Gõ nhịp mõ gỗ trầm tĩnh (hoặc bấm phím 4 khi đang ở trong chùa)",
    woodblockAction: "Gõ mõ",
    stats: "Bạn đã dâng {incense} nén hương · thả {lantern} đèn hoa đăng",
    verseTitle: "Lời kệ tĩnh tâm",
    verses: [
      "Tâm bình thế giới bình, tâm tịnh cõi đất tịnh.",
      "Mỗi bước chân an lạc, mỗi hơi thở thảnh thơi.",
      "Sen nở trong hồ tĩnh, hương lành tỏa mười phương.",
      "Buông xả muôn phiền não, lòng sáng tựa trăng rằm.",
      "Chắp tay nhìn sương sớm, thấy vạn vật hiền hòa.",
    ],
  },
  beads: {
    title: "Tràng hạt",
    back: "Quay lại",
    roundFirst: "Vòng thứ nhất",
    /** `{n}` = round number (2 and up). */
    round: "Vòng thứ {n}",
    /** `{n}` = beads this round, `{total}` = all beads ever. */
    count: "Vòng này {n} hạt · tổng {total} hạt",
    hint: "Vuốt lên xuống, phím ↑ ↓ hoặc cuộn để lần từng hạt · Esc để quay lại",
    /** `{n}` = rounds finished. */
    roundDone: "Đã lần xong {n} vòng",
  },
  rooms: {
    title: "Chọn phòng",
    close: "Đóng chọn phòng",
    desc: "Phòng nào cũng cùng một ngôi chùa, chỉ khác số người.",
    /** `{room}` = room name. */
    current: "Đang ở · {room}",
    loading: "Đang đếm số người",
    refresh: "Cập nhật số người",
    list: "Danh sách phòng",
    /** `{n}` = room number, `{count}` / `{capacity}`. */
    count: "Phòng {n} · {count} / {capacity} người",
    badgeCurrent: "Đang ở",
    badgeFull: "Đủ người",
    /** P4-D1: every card says whether the room is silent or allows chat. */
    badgeQuiet: "Tĩnh lặng",
    badgeChat: "Trò chuyện",
    /** Legend under the grid, one line per room kind (same icons as the cards). `{quiet}` = last silent room, `{first}`–`{last}` = chat rooms. */
    legendQuiet: "Phòng 1–{quiet}: ngồi yên, không trò chuyện.",
    legendChat: "Phòng {first}–{last}: trò chuyện được, cần tạo tài khoản.",
    note: "Số hiển thị là số người đang ở trong chùa lúc này.",
    error: "Không lấy được số người. Thử lại sau giây lát nhé.",
    retry: "Thử lại",
    switching: "Đang chuyển sang phòng khác…",
    failed: "Không chuyển được. Cập nhật số người rồi chọn phòng khác nhé.",
    /** `{room}` = name of the full room. */
    full: "Phòng {room} đã đủ người. Hãy chọn phòng khác.",
    /** `{room}` = the room our network (IP) already has too many people in. */
    limited: "Mạng của bạn đã có nhiều người ở phòng {room}. Hãy chọn phòng khác.",
  },
  people: {
    title: "Ai đang ở đây",
    close: "Đóng",
    /** `{room}` = room name. */
    desc: "Phòng {room} · bấm Chắp tay ở thanh dưới để chào mọi người.",
    residents: "Chú tiểu thường trú",
    alone: "Lúc này chỉ có mình bạn. Các chú tiểu thường trú vẫn ở bên.",
    offline: "Kết nối xong sẽ thấy ai đang ở đây.",
    invite: "Mời bạn ngồi cạnh",
    inviteHint: "Gửi liên kết cho bạn bè. Họ mở ra sẽ xuất hiện ngay cạnh bạn, miễn là bạn còn ở đây.",
    /** Our own row is a button; `{name}` = the name shown for us in this room. */
    renameSelf: "Đổi tên của bạn ({name})",
  },
  invite: {
    title: "Mời bạn ngồi cạnh",
    desc: "Gửi liên kết cho bạn bè. Họ mở ra sẽ xuất hiện ngay cạnh bạn, miễn là bạn còn ở đây.",
    field: "Liên kết mời",
    copy: "Chép liên kết",
    copied: "Đã chép ✓",
    manual: "Không chép tự động được. Liên kết đã được chọn sẵn, bạn chép tay giúp nhé.",
    offline: "Kết nối xong sẽ có liên kết mời.",
    close: "Đóng",
  },
  name: {
    title: "Bạn tên là gì?",
    renameTitle: "Đổi tên của bạn",
    desc: "Mọi người trong phòng sẽ thấy tên này.",
    field: "Tên của bạn",
    enter: "Vào",
    save: "Lưu",
    close: "Đóng",
  },
  exit: {
    brand: "Sân Tĩnh",
    title: "Bạn đã nghỉ ngơi đủ chưa?",
    body: ["Âm thanh và kết nối đã tắt.", "Khi muốn tĩnh lại, cứ ghé nhé."],
    stay: "Ở lại thêm",
  },
  rest: {
    title: "Đang tạm nghỉ",
    body: "Cảnh và kết nối đang tạm dừng.",
    resume: "Tiếp tục ở lại",
  },
  ceremony: {
    morning: "Khóa lễ sáng · đang nghe cùng mọi người",
    evening: "Khóa lễ tối · đang nghe cùng mọi người",
  },
  account: {
    registerTitle: "Tạo tài khoản",
    loginTitle: "Đăng nhập",
    /** `{from}`–`{to}` = the chat rooms. */
    registerDesc: "Có tài khoản là trò chuyện được cùng mọi người ở phòng {from}–{to}.",
    loginDesc: "Đăng nhập bằng tên đăng nhập và mật khẩu của bạn.",
    close: "Đóng",
    username: "Tên đăng nhập",
    usernameHint: "Chỉ để đăng nhập, người khác không thấy.",
    password: "Mật khẩu",
    displayName: "Tên nhân vật",
    displayNameHint: "Mọi người trong phòng sẽ thấy tên này.",
    register: "Tạo tài khoản",
    login: "Đăng nhập",
    sending: "Đang gửi…",
    noEmail: "Không cần email. Quên mật khẩu sẽ không lấy lại được.",
    haveAccount: "Đã có tài khoản?",
    noAccount: "Chưa có tài khoản?",
    toLogin: "Đăng nhập",
    toRegister: "Tạo tài khoản",
    /** `{min}`–`{max}` = allowed length. */
    badUsername: "Tên đăng nhập dài {min}–{max} ký tự: chữ không dấu, số, dấu - _ hoặc dấu chấm. Không dấu cách, không dùng email.",
    /** `{min}`–`{max}` = allowed length. */
    badPassword: "Mật khẩu dài {min}–{max} ký tự.",
    badDisplayName: "Hãy nhập tên nhân vật.",
    missing: "Hãy nhập tên đăng nhập và mật khẩu.",
    taken: "Tên đăng nhập đã có người dùng. Hãy chọn tên khác.",
    badCredentials: "Sai tên đăng nhập hoặc mật khẩu.",
    /** `{n}` = whole minutes to wait. */
    rateLimit: "Bạn thử nhiều lần quá. Chờ {n} phút rồi thử lại nhé.",
    /** `{n}` = whole hours to wait (register limit is per day). */
    rateLimitHours: "Bạn thử nhiều lần quá. Chờ {n} giờ rồi thử lại nhé.",
    rateLimitSoon: "Bạn thử nhiều lần quá. Chờ một lát rồi thử lại nhé.",
    badInput: "Thông tin chưa hợp lệ. Kiểm tra lại giúp mình nhé.",
    network: "Không kết nối được. Thử lại sau ít phút nhé.",
    signedIn: "Đã đăng nhập",
    signedOut: "Đã đăng xuất",
  },
  settings: {
    title: "Cài đặt",
    close: "Đóng cài đặt",
    desc: "Chỉnh ba loại âm thanh theo ý bạn",
    muted: "Âm thanh đang tắt · bấm nút loa ở góc trên bên phải để bật",
    name: "Tên của bạn",
    rename: "Đổi",
    renameLabel: "Đổi tên của bạn",
    robeColor: "Màu pháp phục",
    robeColorDesc: "Chọn màu áo của bạn trong sân chùa",
    robeColorNames: ["Lam khói", "Vàng đất", "Xanh rêu", "Nâu trầm", "Lam chiều", "Hồng đất"],
    account: "Tài khoản",
    accountGuest: "Chưa đăng nhập",
    signIn: "Đăng nhập / Đăng ký",
    signOut: "Đăng xuất",
    volume: "Âm lượng",
    /** `{n}` = 0–100. */
    percent: "{n}%",
    ambient: "Âm nền",
    ambientDesc: "Tiếng gió và chim núi",
    chant: "Tụng kinh",
    chantDesc: "Chỉ mình bạn nghe, lúc nào muốn",
    chantCeremony: "Đang khóa lễ · mọi người cùng nghe",
    chantError: "Không tải được bài tụng kinh. Bấm lại nhé.",
    listen: "Nghe",
    stop: "Dừng",
    /** `{session}` = sáng / tối, `{time}` = HH:MM, `{hours}` = the daily list. */
    nextCeremony: "Khóa lễ {session} kế tiếp {time} · mỗi ngày {hours} (giờ Việt Nam)",
    morning: "sáng",
    evening: "tối",
    /** Two session times joined. */
    hoursPair: "{a} và {b}",
    together: "Đến giờ khóa lễ, mọi người cùng nghe chung.",
    sfx: "Hiệu ứng",
    sfxDesc: "Tiếng chuông và tiếng hạt của bạn",
    background: "Phát khi đổi tab",
    backgroundOff: "Sang tab khác thì mọi âm thanh sẽ dừng",
    backgroundOn: "Sang tab khác vẫn ở lại và nghe tiếp",
    controls: "Cách điều khiển",
    controlsBody: [
      "Bấm xuống sàn, WASD hoặc phím mũi tên để đi",
      "Kéo để nhìn quanh · cuộn để phóng to/thu nhỏ",
      "1 · E · Space: thiền / dừng · 2: tràng hạt · 3: chắp tay · 4: gõ mõ",
      "Điện thoại: chạm để đi · một ngón để nhìn quanh · hai ngón để phóng to",
    ],
    author: "@alexlevn",
    authorMail: "thanhdungvn@gmail.com",
  },
  chat: {
    title: "Trò chuyện",
    /** Quiet room (P4-D1): a small note where the panel would be; opens the room picker. */
    quietTitle: "Phòng tĩnh lặng",
    /** `{first}`–`{last}` = chat rooms. */
    quietHint: "Mọi người ngồi yên ở đây. Muốn trò chuyện thì sang phòng {first}–{last}.",
    open: "Mở khung trò chuyện",
    /** Appended to `open` while unread lines wait. */
    unread: "có tin mới",
    close: "Đóng khung trò chuyện",
    log: "Tin trò chuyện trong phòng",
    empty: "Chưa có ai nói gì. Chào mọi người một câu nhé.",
    input: "Nhập tin nhắn",
    placeholder: "Nói gì đó…",
    send: "Gửi",
    /** `{n}` = whole seconds until the next line can go. */
    sendIn: "Gửi ({n})",
    /** `{n}` = characters left before the limit. */
    left: "còn {n}",
    /** `{n}` = characters over the limit. */
    over: "dư {n}",
    needAccount,
    denied: {
      login: `${needAccount} nhé`,
      "quiet-room": "Phòng này dành để ngồi yên, không trò chuyện.",
      /** `{n}` = whole seconds to wait. */
      "too-fast": "Chờ {n} giây nữa nhé",
      /** `{n}` = max characters per line. */
      "too-long": "Tin tối đa {n} ký tự",
      duplicate: "Bạn vừa gửi đúng tin này rồi",
      empty: "Hãy nhập nội dung tin",
    },
  },
  labels: {
    /** Badge on our own name tag. */
    you: "Bạn",
  },
  toast: {
    connecting: "Đang kết nối vào Sân Tĩnh",
    reconnecting: "Mất kết nối. Đang kết nối lại",
    roomFull: "Phòng này đã đủ người. Hãy chọn phòng khác.",
    tooMany: "Mạng của bạn đã có nhiều người trong phòng này. Hãy chọn phòng khác.",
    invalidFloor: "Hãy bấm vào khoảng sàn trống gần hơn",
    notConnected: "Kết nối xong mới tìm được bồ đoàn",
    noCushion: "Phòng đã hết chỗ ngồi. Bạn đứng tạm, có bồ đoàn trống thì ngồi nhé.",
    tooFarToBow: "Bồ đoàn còn xa. Bạn vào trong chánh điện rồi bấm Thiền nhé.",
    bowing: "Đang ngồi thiền · bấm Dừng để lạy rồi đứng dậy",
    helloSent: "Bạn đã chắp tay chào mọi người",
    /** `{name}` = the visitor who greeted. */
    helloFrom: "{name} chắp tay chào bạn",
    /** `{name}` = the friend who joined next to us. */
    arrivedNear: "{name} vừa đến ngồi cạnh bạn",
    inviterGone: "Người mời bạn không còn ở đây",
    chantError: "Không tải được bài tụng kinh",
    incenseOffered: "Đã dâng nén tâm hương lên chánh điện",
    lanternOffered: "Đã thả đèn hoa đăng xuống hồ sen",
    bellRung: "Tiếng đại hồng chung ngân vang tĩnh lặng",
  },
  debug: {
    fps: "fps",
    p95: "p95",
    calls: "draw",
    triangles: "tam giác",
    /** `?avatar=1` pose buttons (dev only). */
    poses: "Tư thế",
    pose: {
      idle: "Đứng",
      walk: "Đi",
      kneel: "Lạy",
      beads: "Tràng hạt",
      hello: "Chắp tay",
      sleep: "Ngủ gật",
    },
  },
} as const;
