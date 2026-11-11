// Kulku laundry/sauna Telegram bot — Cloudflare Worker (webhook).
// Secrets: BOT_TOKEN, WEBHOOK_SECRET, ALLOWED_CHAT_ID, and either
//   KULKU_PHONE + KULKU_PASSWORD (auto-login, recommended) or KULKU_USER + KULKU_TOKEN.
// Optional var: SITE (e.g. "Jämeräntaival 1") to skip the building picker.

const API = "https://portal.kulku.io/api/v2/";
const TZ = "Europe/Helsinki";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAYS_AHEAD = 7;
const NOOP = "_";

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("ok");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
      return new Response("forbidden", { status: 403 });
    const u = await req.json();
    try {
      await handle(u, env);
    } catch (e) {
      const chat = u.message?.chat.id ?? u.callback_query?.message.chat.id;
      if (chat) await tg(env, "sendMessage", { chat_id: chat, text: `⚠️ ${e.message}` });
    }
    return new Response("ok");
  },
};

// ---------- Telegram ----------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parse_mode: "HTML", ...body }),
  });
  return r.json();
}
const kb = (rows) => ({ inline_keyboard: rows });
const btn = (text, data) => ({ text, callback_data: data });
const chunk = (a, n) => a.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function handle(u, env) {
  const msg = u.message, cq = u.callback_query;
  const chat = msg?.chat.id ?? cq?.message.chat.id;
  if (!chat) return;
  if (String(chat) !== String(env.ALLOWED_CHAT_ID)) {
    if (msg) await tg(env, "sendMessage", { chat_id: chat, text: `Not authorised. Your chat id: ${chat}` });
    return;
  }
  if (msg) {
    const view = (msg.text || "").startsWith("/my") ? await myBookings(env) : await home(env);
    return tg(env, "sendMessage", { chat_id: chat, ...view });
  }
  const [k, ...p] = cq.data.split("|");
  if (k === NOOP) return tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: p[0] || "" });
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  const view =
    k === "home" ? await home(env) :
    k === "bld" ? await building(env, p[0]) :
    k === "sp" ? await days(env, p[0]) :
    k === "day" ? await dayView(env, p[0], p[1]) :
    k === "b" ? await book(env, p[0], p[1], +p[2]) :
    k === "my" ? await myBookings(env) :
    k === "x" ? { text: "Cancel this booking?", reply_markup: kb([[btn("Yes, cancel", `c|${p[0]}`), btn("No", "my")]]) } :
    k === "c" ? await cancel(env, p[0]) : null;
  if (view) await tg(env, "editMessageText", { chat_id: chat, message_id: cq.message.message_id, ...view });
}

// ---------- Kulku ----------
// Auth: if KULKU_PHONE + KULKU_PASSWORD are set, the bot logs in by itself and
// re-logs in whenever the session expires. Otherwise it uses KULKU_USER + KULKU_TOKEN.
let session = null;
async function login(env) {
  const r = await fetch(API + "login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: env.KULKU_PHONE, password: env.KULKU_PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j?.data?.authToken) throw new Error("Kulku login failed — check KULKU_PHONE / KULKU_PASSWORD.");
  session = { user: j.data.userId, token: j.data.authToken };
}
async function kulku(env, method, path, body, retried = false) {
  const auto = env.KULKU_PHONE && env.KULKU_PASSWORD;
  if (auto && !session) await login(env);
  const s = auto ? session : { user: env.KULKU_USER, token: env.KULKU_TOKEN };
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", "x-Auth-Token": s.token, "x-User-Id": s.user },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (r.status === 401 || r.status === 403) {
    if (auto && !retried) { session = null; return kulku(env, method, path, body, true); }
    throw new Error(auto ? "Kulku rejected the login." : "Kulku login expired — update the KULKU_TOKEN secret (or set KULKU_PHONE + KULKU_PASSWORD for auto-login).");
  }
  if (!r.ok) throw new Error(`Kulku ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Spaces list is big and rarely changes: cache per worker instance for 10 min.
let cache = { at: 0, spaces: null };
async function spaces(env) {
  if (!cache.spaces || Date.now() - cache.at > 600_000) {
    const raw = await kulku(env, "GET", "spaces");
    cache = { at: Date.now(), spaces: raw.map(normalize) };
  }
  return cache.spaces;
}
function normalize(s) {
  const en = s.translations?.en || {};
  const desc = en.description || s.spaceDescription || "";
  const stair = (desc.match(/staircase ([A-Z])\b/i) || s.spaceDescription?.match(/\b([A-Z])-rapu/) || [])[1];
  let name = en.name || s.spaceName;
  if (s.isContainer && stair && !/\b[A-Z]$/.test(name)) name += ` ${stair}`;
  const short = (/(\d+)$/.exec(name) || [])[1];
  const icon = { sauna: "🧖", washroom: "🧺", dryroom: "🌀" }[s.spaceIcon] || "📍";
  return {
    id: s._id, name, icon, stair, desc,
    site: (s.sites || []).find((x) => x.primary)?.name || "?",
    container: !!s.isContainer, parent: s.parentSpaceId || null,
    tag: icon + (short || ""), // e.g. 🧺1, 🌀2
    weekly: s.reservationSettings?.weekly || {},
    daysForward: s.reservationSettings?.allowedDaysForward ?? DAYS_AHEAD,
  };
}
const byId = async (env, id) => (await spaces(env)).find((s) => s.id === id);
const children = async (env, id) => (await spaces(env)).filter((s) => s.parent === id);
const where = (s) => `${s.site}${s.stair && !s.container ? ` · ${s.stair}` : ""}`;

// ---------- time helpers (Helsinki) ----------
function local(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (ymd) => DAYS[new Date(ymd + "T12:00:00Z").getUTCDay()];
const label = (ymd) => {
  const t = local(new Date()).ymd;
  if (ymd === t) return "Today";
  if (ymd === addDays(t, 1)) return "Tomorrow";
  return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

// Free slot start minutes for one bookable space on one day
async function freeSlots(env, sp, ymd) {
  const cfg = sp.weekly[weekday(ymd)];
  if (!cfg) return { slots: [], len: 0 };
  const d = await kulku(env, "GET", `space/${sp.id}?date=${ymd}`);
  const wd = weekday(ymd), taken = [];
  for (const b of d.bookings || []) {
    const s = local(new Date(b.bookingStart)), e = local(new Date(b.bookingEnd));
    if (s.ymd > ymd || e.ymd < ymd) continue;
    taken.push([s.ymd < ymd ? 0 : s.min, e.ymd > ymd ? 1440 : e.min]);
  }
  for (const r of d.recurringReservations || [])
    if (r.day === wd) taken.push([r.startAtHours * 60 + r.startAtMins, r.endAtHours * 60 + r.endAtMins]);
  const now = local(new Date()), len = cfg.slotLength, slots = [];
  for (let t = toMin(cfg.startTime); t + len <= toMin(cfg.endTime); t += len) {
    if (ymd === now.ymd && t + len <= now.min) continue;
    if (!taken.some(([a, b]) => t < b && t + len > a)) slots.push(t);
  }
  return { slots, len, usage: d.monthUsage };
}

// ---------- Views ----------
async function home(env) {
  if (env.SITE) return building(env, env.SITE);
  const sites = [...new Set((await spaces(env)).map((s) => s.site))].sort();
  const rows = chunk(sites.map((s) => btn(`🏢 ${s}`, `bld|${s}`)), 2);
  rows.push([btn("📋 My bookings", "my")]);
  return { text: "<b>Pick a building</b>", reply_markup: kb(rows) };
}

async function building(env, site) {
  const top = (await spaces(env)).filter((s) => s.site === site && !s.parent)
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows = top.map((s) => [btn(`${s.icon} ${s.name}`, `sp|${s.id}`)]);
  rows.push(env.SITE ? [btn("📋 My bookings", "my")] : [btn("⬅️ Buildings", "home"), btn("📋 My bookings", "my")]);
  return { text: `<b>🏢 ${esc(site)}</b>\nWhat do you want to book?`, reply_markup: kb(rows) };
}

// Day picker for a room (container → its machines) or a single space
async function days(env, id) {
  const sp = await byId(env, id);
  const units = sp.container ? await children(env, id) : [sp];
  const today = local(new Date()).ymd;
  const n = Math.min(DAYS_AHEAD, sp.daysForward);
  const list = Array.from({ length: n }, (_, i) => addDays(today, i));
  const counts = await Promise.all(list.map(async (ymd) =>
    (await Promise.all(units.map((u) => freeSlots(env, u, ymd)))).reduce((a, r) => a + r.slots.length, 0)));
  const rows = chunk(list.map((ymd, i) =>
    counts[i] ? btn(`${label(ymd)} · ${counts[i]} free`, `day|${id}|${ymd}`) : btn(`${label(ymd)} · full`, `${NOOP}|Fully booked`)), 2);
  rows.push([btn("⬅️ Back", `bld|${sp.site}`)]);
  const what = sp.container ? units.map((u) => `${u.tag} ${u.name}`).join("\n") : "";
  return { text: `<b>${sp.icon} ${esc(sp.name)}</b> · ${esc(sp.site)}\n${esc(what)}\n\nPick a day:`, reply_markup: kb(rows) };
}

// Grid: one row per time, one column per machine. Tap a free one to book.
async function dayView(env, id, ymd) {
  const sp = await byId(env, id);
  const units = sp.container ? await children(env, id) : [sp];
  const res = await Promise.all(units.map((u) => freeSlots(env, u, ymd)));
  const times = [...new Set(res.flatMap((r) => r.slots))].sort((a, b) => a - b);
  const len = Math.max(...res.map((r) => r.len), 0);
  const rows = [];
  if (units.length > 1) {
    rows.push([btn("Time", NOOP), ...units.map((u) => btn(u.tag, `${NOOP}|${u.name}`))]);
    for (const t of times)
      rows.push([btn(`${hm(t)}`, NOOP), ...units.map((u, i) =>
        res[i].slots.includes(t) ? btn("✅", `b|${u.id}|${ymd}|${t}`) : btn("·", `${NOOP}|Taken`))]);
  } else {
    rows.push(...chunk(times.map((t) => btn(`${hm(t)}–${hm(t + len)}`, `b|${units[0].id}|${ymd}|${t}`)), 3));
  }
  rows.push([btn("⬅️ Days", `sp|${id}`), btn("🏠 Home", "home")]);
  const legend = units.length > 1 ? `\n${units.map((u) => `${u.tag} = ${esc(u.name)}`).join("\n")}\n\nTap ✅ to book (${len} min slots):` : "\nTap a time to book:";
  return {
    text: `<b>${sp.icon} ${esc(sp.name)}</b> · ${esc(sp.site)}\n<b>${label(ymd)}</b>${times.length ? legend : "\nNo free slots."}`,
    reply_markup: kb(rows),
  };
}

async function book(env, spaceId, ymd, t) {
  const sp = await byId(env, spaceId);
  const { slots, len } = await freeSlots(env, sp, ymd);
  if (!slots.includes(t)) {
    const v = await dayView(env, sp.parent || sp.id, ymd);
    return { ...v, text: "⚠️ That slot was just taken.\n\n" + v.text };
  }
  await kulku(env, "POST", "new/space/book", {
    spaceId, bookingStart: `${ymd}T${hm(t)}:00`, bookingEnd: `${ymd}T${hm(t + len)}:00`, checkoutData: "",
  });
  return {
    text: `✅ <b>Booked</b>\n${sp.icon} ${esc(sp.name)} · ${esc(where(sp))}\n📅 ${label(ymd)} ${hm(t)}–${hm(t + len)}` +
      (sp.desc ? `\nℹ️ ${esc(sp.desc)}` : ""),
    reply_markup: kb([[btn("📋 My bookings", "my"), btn("🏠 Home", "home")]]),
  };
}

async function myBookings(env) {
  const [data, all] = await Promise.all([kulku(env, "GET", "bookings"), spaces(env)]);
  const list = (Array.isArray(data) ? data : data?.bookings || data?.data || [])
    .filter((b) => new Date(b.bookingEnd) > new Date())
    .sort((a, b) => new Date(a.bookingStart) - new Date(b.bookingStart));
  const lines = [], rows = [];
  for (const b of list) {
    const sid = b.spaceId || b.space?._id || (typeof b.space === "string" ? b.space : null);
    const sp = all.find((s) => s.id === sid);
    const s = local(new Date(b.bookingStart)), e = local(new Date(b.bookingEnd));
    const what = sp ? `${sp.icon} ${sp.name} · ${where(sp)}` : `📍 ${b.space?.spaceName || b.spaceName || "Booking"}`;
    const when = `${label(s.ymd)} ${hm(s.min)}–${hm(e.min)}`;
    lines.push(`• <b>${when}</b>\n   ${esc(what)}`);
    rows.push([btn(`❌ Cancel ${when}`, `x|${b._id}`)]);
  }
  rows.push([btn("🏠 Home", "home")]);
  return { text: list.length ? `<b>Your upcoming bookings</b>\n\n${lines.join("\n")}` : "No upcoming bookings.", reply_markup: kb(rows) };
}

async function cancel(env, id) {
  await kulku(env, "POST", `bookings/cancel/${id}`);
  const v = await myBookings(env);
  return { ...v, text: "✅ Cancelled\n\n" + v.text };
}
