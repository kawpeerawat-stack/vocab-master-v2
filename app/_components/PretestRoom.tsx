"use client";
// app/_components/PretestRoom.tsx — 📝 Pre-test ม.4 (ม.4 เท่านั้น · 13 พ.ย. 2569)
//   ส่วนที่ 1: ข้อสอบหลัก 40 ข้อ 50 นาที (8 ทักษะตามข้อสอบจริง) · ส่วนที่ 2: วัดระดับคำศัพท์ 20 ข้อ 10 นาที
//   ไม่นับคะแนนเก็บ · ไม่เฉลยรายข้อ · นักเรียนเห็นเฉพาะกลุ่มของตัวเอง · ทำได้ครั้งเดียว (ครูกดให้ทำใหม่ได้)
//   จับเวลารวมทั้งชุด (ย้อนกลับไปแก้คำตอบได้เหมือนสอบจริง) · หมดเวลา = ส่งอัตโนมัติ
//   กล้อง: ใช้กล้องชุดเดียวกับหน้าเลือกห้อง · มีอะไรบังหน้า/เห็นมือถือ = ซ่อนโจทย์ + บันทึกให้ครูเห็น (ไม่ข้ามข้อ)
//   ออกจากหน้าแอป = บันทึกจำนวนครั้งให้ครูเห็น · ผลเก็บในเครื่องก่อน แล้วส่งขึ้นระบบ (ส่งไม่ได้ = ลองใหม่เอง)
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BANK,
  MAIN_MS,
  PRE_ITEMS,
  PRE_VOCAB,
  VOCAB_MS,
  bandOf,
  decodePicks,
  encodePicks,
  fmtClock,
  gradeMain,
  gradeVocab,
  leftMs,
  loadPreLocal,
  mergePre,
  optionOrder,
  savePreLocal,
  stageOf,
  tierStartText,
  type Ctx,
  type Picks,
  type PreLocal,
  type PreRec,
} from "../lib/pretest";
import { readCloudPre, writeCloudPre } from "../lib/pretestCloud";
import { noCopyProps, useLeaveGuard } from "../lib/guard";
import { hoursNow } from "../lib/hours";
import { isIssue, issueText, serverNow, syncClock, type SyncState } from "../lib/sync";
import { CamBox, CoverShield, isCovered, SplitShield, useRoomCamera, type SharedCam } from "./CamGuard";

type View = "load" | "intro" | "main" | "vintro" | "vocab" | "done";
const LETTERS = "ABCD";
const emptyPicks = (n: number): Picks => Array.from({ length: n }, () => null);

// **ตัวหนา** + ขึ้นบรรทัดใหม่
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <span key={li} className="block">
          {line.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
            seg.startsWith("**") && seg.endsWith("**") ? (
              <b key={i} className="text-[#003399] underline decoration-2 underline-offset-4">
                {seg.slice(2, -2)}
              </b>
            ) : (
              <span key={i}>{seg}</span>
            )
          )}
        </span>
      ))}
    </>
  );
}

// ช่องว่าง (n) ______ ของข้อที่กำลังทำ → ไฮไลต์
function Blanks({ text, n }: { text: string; n: number }) {
  return (
    <>
      {text.split(/(\(\d+\) ______)/g).map((seg, i) => {
        const m = seg.match(/^\((\d+)\) ______$/);
        if (!m) return <span key={i}>{seg}</span>;
        const on = Number(m[1]) === n;
        return (
          <span key={i} className={on ? "font-black text-white bg-[#003399] rounded px-1" : "font-bold text-gray-400"} data-blank={m[1]} data-blank-on={on ? "1" : "0"}>
            ({m[1]}) ______
          </span>
        );
      })}
    </>
  );
}

function CtxBox({ c, n }: { c: Ctx; n: number }) {
  const title = c.title ? <p className="font-black text-[#003399] text-sm mb-1.5">{c.title}</p> : null;
  let body: ReactNode = null;
  if (c.kind === "dialogue") {
    body = (c.lines ?? []).map((ln, i) => {
      const [sp, tx] = Array.isArray(ln) ? ln : ["", ln];
      return (
        <p key={i} className="mb-1">
          <b className="text-gray-900">{sp}:</b> <Blanks text={tx} n={n} />
        </p>
      );
    });
  } else if (c.kind === "text") {
    body = (c.paras ?? []).map((p, i) => (
      <p key={i} className="mb-2 last:mb-0">
        <Blanks text={p} n={n} />
      </p>
    ));
  } else if (c.kind === "sign") {
    body = (
      <div className="mx-auto max-w-xs border-4 border-rose-700 rounded-lg p-3 text-center font-black text-rose-700 bg-white">
        {(c.lines ?? []).map((l, i) => (
          <p key={i} className={i === 0 ? "text-lg tracking-widest" : "text-sm"}>
            {String(l)}
          </p>
        ))}
      </div>
    );
  } else if (c.kind === "table") {
    body = (
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse bg-white">
          <thead>
            <tr>
              {(c.head ?? []).map((h) => (
                <th key={h} className="border border-gray-300 px-3 py-1 bg-[#003399]/5 text-left font-black">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(c.rows ?? []).map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className={`border border-gray-300 px-3 py-1 ${j > 0 ? "text-right tabular-nums" : ""}`}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    body = (c.lines ?? []).map((l, i) => (
      <p key={i} className="mb-1">
        {String(l)}
      </p>
    ));
  }
  return (
    <div className={`rounded-2xl border-2 p-3.5 mb-3 text-[15px] leading-relaxed text-gray-800 ${c.kind === "notice" || c.kind === "message" ? "bg-amber-50 border-amber-200" : "bg-[#003399]/[0.03] border-[#003399]/15"}`} data-ctx={c.kind}>
      {title}
      {body}
    </div>
  );
}

// โจทย์ Error detection: {0}..{3} → ส่วนที่ขีดเส้นใต้พร้อมตัวอักษร
function EdSentence({ q, parts }: { q: string; parts: string[] }) {
  return (
    <>
      {q.split(/(\{\d\})/g).map((seg, i) => {
        const m = seg.match(/^\{(\d)\}$/);
        if (!m) return <span key={i}>{seg}</span>;
        const k = Number(m[1]);
        return (
          <span key={i} className="whitespace-nowrap">
            <span className="underline decoration-2 underline-offset-4 decoration-[#003399]">{parts[k]}</span>
            <sub className="text-[10px] font-black text-[#003399] ml-0.5">{LETTERS[k]}</sub>
          </span>
        );
      })}
    </>
  );
}

const SK_INTRO: Record<string, string> = {
  QR: "ตอนที่ 1 · เลือกคำตอบที่เหมาะสมที่สุด",
  SC: "ตอนที่ 2 · เติมบทสนทนาสั้น",
  LC: "ตอนที่ 3 · บทสนทนายาว",
  TC: "ตอนที่ 4 · เติมคำในบทความ",
  ED: "ตอนที่ 5 · หาส่วนที่ผิด (เลือกส่วนที่ขีดเส้นใต้ที่ผิด)",
  RC: "ตอนที่ 6 · การอ่าน",
  PO: "ตอนที่ 7 · เรียงประโยคเป็นย่อหน้า",
  IG: "ตอนที่ 8 · อ่านตาราง",
};

export function PretestRoom({ email, onExit, shared }: { email: string; onExit: () => void; shared?: SharedCam }) {
  const [view, setView] = useState<View>("load");
  const [rec, setRec] = useState<PreRec | null>(null);
  const [picks, setPicks] = useState<Picks>(() => emptyPicks(PRE_ITEMS.length));
  const [vpicks, setVpicks] = useState<Picks>(() => emptyPicks(PRE_VOCAB.length));
  const [cur, setCur] = useState(0);
  const [grid, setGrid] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(() => serverNow());
  const [sync, setSync] = useState<SyncState>("idle");
  const [sent, setSent] = useState<PreLocal["sent"]>("none");
  const [camNote, setCamNote] = useState<string | null>(null);
  const camCount = useRef({ cv: 0, ph: 0 });
  const camOn = !!shared && !shared.fallback && shared.cam.status !== "off";

  const testing = view === "main" || view === "vocab";
  const vocabMode = view === "vocab";
  const items = vocabMode ? PRE_VOCAB : PRE_ITEMS;
  const curId = testing ? items[cur]?.id ?? null : null;

  // ออกจากหน้าแอป / แบ่งจอ: บันทึกอย่างเดียว (Pre-test ไม่ข้ามข้อ)
  const guard = useLeaveGuard(testing, curId, () => false);
  const cam = useRoomCamera(
    shared,
    (_ms, kind) => {
      if (kind === "phone") camCount.current.ph++;
      else camCount.current.cv++;
      setCamNote(kind === "phone" ? "📱 พบมือถือในกล้อง — ระบบบันทึกให้ครูเห็น" : "📷 มีอะไรบังใบหน้า — ระบบบันทึกให้ครูเห็น");
      return false;
    },
    () => undefined
  );
  const { arm: camArm } = cam;
  useEffect(() => {
    camArm(testing && camOn);
    return () => camArm(false);
  }, [camArm, testing, camOn]);

  // ── บันทึกในเครื่อง ──
  const persist = useCallback(
    (r: PreRec | null, p: Picks, vp: Picks, s: PreLocal["sent"], c?: number) => {
      savePreLocal(email, r ? { rec: r, picks: p, vpicks: vp, sent: s, cur: c } : null);
    },
    [email]
  );

  // ── ส่งขึ้นระบบ ──
  const push = useCallback(
    async (r: PreRec, stage: PreLocal["sent"], p: Picks, vp: Picks) => {
      setSync("saving");
      const res = await writeCloudPre(email, r, () => setSync("slow"));
      if (res.ok) {
        setSent(stage);
        persist(r, p, vp, stage);
        setSync("ok");
      } else setSync(res.issue);
      return res.ok;
    },
    [email, persist]
  );

  // ── เปิดห้อง: รวมผลในเครื่องกับบนระบบ ──
  useEffect(() => {
    let alive = true;
    (async () => {
      await syncClock();
      const cloud = await readCloudPre(email);
      if (!alive) return;
      const local = loadPreLocal(email);
      const m = cloud === undefined ? { rec: local?.rec ?? null, useLocal: !!local } : mergePre(local, cloud);
      if (cloud !== undefined && !m.rec && local) savePreLocal(email, null); // ครูกดให้ทำใหม่ → ล้างของเก่าในเครื่อง
      const r = m.rec;
      const p = m.useLocal && local ? local.picks : r?.a ? decodePicks(r.a, PRE_ITEMS.length) : emptyPicks(PRE_ITEMS.length);
      const vp = m.useLocal && local ? local.vpicks : r?.v ? decodePicks(r.v, PRE_VOCAB.length) : emptyPicks(PRE_VOCAB.length);
      setRec(r);
      setPicks(p);
      setVpicks(vp);
      setCur(m.useLocal && local?.cur ? local.cur : 0);
      setNow(serverNow());
      const st = stageOf(r);
      // ในเครื่องไปไกลกว่าระบบ (ส่งไม่สำเร็จครั้งก่อน) → ส่งใหม่
      const cloudStage = cloud ? stageOf(cloud) : "new";
      if (r && cloud !== undefined && st !== cloudStage) {
        persist(r, p, vp, "none");
        void push(r, st === "done" ? "vocab" : st === "vocab" ? "main" : "start", p, vp);
      } else if (r) {
        setSent(st === "done" ? "vocab" : st === "vocab" ? "main" : "start");
      }
      setView(st === "done" ? "done" : st === "vocab" ? "vintro" : "intro");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // ── นาฬิกา ──
  useEffect(() => {
    if (!testing && view !== "intro" && view !== "vintro") return;
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [testing, view]);

  const mainLeft = rec?.at0 ? leftMs(rec.at0, MAIN_MS, now) : MAIN_MS;
  const vocabLeft = rec?.vt0 ? leftMs(rec.vt0, VOCAB_MS, now) : VOCAB_MS;

  const guardRec = () => {
    const g = guard.stats(0, "log");
    return { lv: g.leaves, aw: g.awayMs, sp: g.splits, cv: camCount.current.cv, ph: camCount.current.ph, cm: camOn ? "cam" : shared?.fallback ? "camfail" : "nocam" };
  };

  // ── ส่งส่วนที่ 1 ──
  const submitMain = useCallback(
    (timeout: boolean) => {
      if (!rec || typeof rec.a === "string") return;
      const res = gradeMain(picks);
      const t = serverNow();
      const r: PreRec = { ...rec, a: encodePicks(picks), at: t, ms: Math.min(MAIN_MS, t - rec.at0), sc: res.score, ex: res.ex, bd: res.band.id, g: guardRec(), ...(timeout ? { to: 1 as const } : {}) };
      setRec(r);
      setConfirm(false);
      setGrid(false);
      setCur(0);
      persist(r, picks, vpicks, sent);
      setView("vintro");
      void push(r, "main", picks, vpicks);
      try {
        window.scrollTo({ top: 0 });
      } catch {
        /* ไม่เป็นไร */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rec, picks, vpicks, sent, persist, push]
  );
  const submitVocab = useCallback(
    (timeout: boolean) => {
      if (!rec || typeof rec.v === "string") return;
      const res = gradeVocab(vpicks);
      const r: PreRec = { ...rec, v: encodePicks(vpicks), vat: serverNow(), vs: res.score, ...(timeout ? { vto: 1 as const } : {}) };
      const g = guardRec();
      r.g = { ...(rec.g ?? {}), lv: (rec.g?.lv ?? 0) + g.lv, aw: (rec.g?.aw ?? 0) + g.aw, sp: (rec.g?.sp ?? 0) + (g.sp ?? 0), cv: g.cv, ph: g.ph };
      setRec(r);
      setConfirm(false);
      setGrid(false);
      persist(r, picks, vpicks, sent);
      setView("done");
      void push(r, "vocab", picks, vpicks);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rec, picks, vpicks, sent, persist, push]
  );

  // หมดเวลา → ส่งอัตโนมัติ (ตรวจจากนาฬิกา ไม่ใช่ระหว่างวาดหน้าจอ)
  const autoRef = useRef({ submitMain, submitVocab });
  useEffect(() => {
    autoRef.current = { submitMain, submitVocab };
  });
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const n = serverNow();
      if (rec.at0 && typeof rec.a !== "string" && leftMs(rec.at0, MAIN_MS, n) <= 0) autoRef.current.submitMain(true);
      else if (rec.vt0 && typeof rec.a === "string" && typeof rec.v !== "string" && leftMs(rec.vt0, VOCAB_MS, n) <= 0) autoRef.current.submitVocab(true);
    }, 1000);
    return () => clearInterval(t);
  }, [rec]);

  // ส่งไม่สำเร็จ → ลองใหม่ทุก 20 วินาที / เมื่อเน็ตกลับมา
  const retryRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    retryRef.current = () => {
      if (!rec) return;
      const st = stageOf(rec);
      void push(rec, st === "done" ? "vocab" : st === "vocab" ? "main" : "start", picks, vpicks);
    };
  });
  const needRetry = isIssue(sync) && sync !== "full";
  useEffect(() => {
    if (!needRetry) return;
    const tick = () => document.visibilityState === "visible" && retryRef.current();
    const t = setInterval(tick, 20000);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", tick);
    };
  }, [needRetry]);

  // ── เริ่ม/ทำต่อ ──
  function startMain() {
    if (rec?.at0) {
      setView("main");
      return;
    }
    if (!hoursNow().open) return;
    const r: PreRec = { f: BANK.form, at0: serverNow() };
    setRec(r);
    setCur(0);
    guard.reset();
    camCount.current = { cv: 0, ph: 0 };
    cam.resetCounts();
    persist(r, picks, vpicks, "none");
    setView("main");
    void push(r, "start", picks, vpicks);
  }
  function startVocab() {
    if (!rec) return;
    if (rec.vt0) {
      setView("vocab");
      return;
    }
    const r: PreRec = { ...rec, vt0: serverNow() };
    setRec(r);
    setCur(0);
    guard.reset();
    persist(r, picks, vpicks, sent);
    setView("vocab");
    void push(r, "main", picks, vpicks);
  }

  function pick(orig: number) {
    if (vocabMode) {
      const v = [...vpicks];
      v[cur] = orig;
      setVpicks(v);
      persist(rec, picks, v, sent, cur);
    } else {
      const p = [...picks];
      p[cur] = orig;
      setPicks(p);
      persist(rec, p, vpicks, sent, cur);
    }
  }
  function go(i: number) {
    setCur(Math.max(0, Math.min(items.length - 1, i)));
    setGrid(false);
    setConfirm(false);
    setCamNote(null);
    guard.clearNotice();
    persist(rec, picks, vpicks, sent, i);
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* ไม่เป็นไร */
    }
  }

  const syncLine =
    sync === "saving" || sync === "slow" ? (
      <p className="text-xs font-bold text-[#003399]" data-pre-sync="saving">
        ⏳ กำลังส่งผลขึ้นระบบ…{sync === "slow" ? " (เน็ตช้า รอสักครู่ ไม่ต้องปิดหน้า)" : ""}
      </p>
    ) : isIssue(sync) ? (
      <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800" data-pre-sync="issue">
        {issueText(sync)} · ผลเก็บไว้ในเครื่องแล้ว ระบบจะลองส่งใหม่เอง
        <button type="button" onClick={() => retryRef.current()} className="ml-2 underline">
          ส่งอีกครั้ง
        </button>
      </div>
    ) : sync === "ok" ? (
      <p className="text-xs font-bold text-emerald-700" data-pre-sync="ok">
        ✓ ส่งผลขึ้นระบบแล้ว
      </p>
    ) : null;

  const back = (
    <button type="button" onClick={onExit} className="text-sm font-bold text-[#003399] hover:underline">
      ← กลับหน้าเลือกห้อง
    </button>
  );

  // ── หน้าจอ ──
  if (view === "load") {
    return (
      <div className="mt-6 text-center text-sm font-bold text-gray-500" data-pre-view="load">
        ⏳ กำลังเปิด Pre-test…
      </div>
    );
  }

  if (view === "intro") {
    const resume = !!rec?.at0;
    const open = hoursNow().open;
    return (
      <div className="animate-fadeIn mt-2 space-y-4" data-pre-view="intro">
        {back}
        <div className="rounded-2xl border-2 border-[#003399]/15 bg-[#003399]/[0.03] p-4">
          <p className="text-2xl mb-1">📝</p>
          <h2 className="text-xl font-black text-gray-900">Pre-test ม.4</h2>
          <p className="text-sm font-bold text-[#003399]">ภาษาอังกฤษเพื่อการสอบ TGAT · A-Level · NETSAT</p>
          <ul className="mt-3 space-y-1.5 text-sm font-bold text-gray-700 list-disc pl-5">
            <li>
              <b className="text-emerald-700">ไม่นับคะแนนเก็บ</b> — ใช้ดูว่าแต่ละคนควรเริ่มเสริมเรื่องไหน ทำตามความรู้จริงของตัวเอง
            </li>
            <li>ส่วนที่ 1: 40 ข้อ {BANK.minutes} นาที · ส่วนที่ 2: คำศัพท์ 20 ข้อ {BANK.vocabMinutes} นาที</li>
            <li>ข้อสอบมีทั้งง่ายและยาก (บางข้อยากเท่าข้อสอบเข้ามหาวิทยาลัย) ตอบไม่ได้ไม่เป็นไร เดาได้ ไม่มีหักคะแนน</li>
            <li>ย้อนกลับไปแก้คำตอบได้จนกดส่ง · หมดเวลาระบบส่งให้เอง</li>
            <li>ทำได้ครั้งเดียว · เปิดกล้องไว้ อยู่ในหน้านี้จนส่ง ห้ามใช้ AI/แปลภาษา — ระบบบันทึกให้ครูเห็น</li>
          </ul>
        </div>
        {!open && !resume ? (
          <p className="rounded-xl bg-amber-50 border-2 border-amber-200 p-3 text-sm font-bold text-amber-900" data-pre-closed>
            ⏰ เริ่ม Pre-test ได้เฉพาะเวลา 06.00–16.30 น. (ทำในคาบเรียนพร้อมครู)
          </p>
        ) : (
          <button type="button" onClick={startMain} data-pre-start className="w-full py-4 rounded-2xl bg-[#003399] text-white text-lg font-black active:scale-[0.99]">
            {resume ? `ทำต่อ (เหลือ ${fmtClock(mainLeft)})` : "เริ่มทำส่วนที่ 1"}
          </button>
        )}
        {syncLine}
      </div>
    );
  }

  if (view === "vintro") {
    const resume = !!rec?.vt0;
    return (
      <div className="animate-fadeIn mt-2 space-y-4" data-pre-view="vintro">
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
          <p className="font-black text-emerald-800">✓ ส่งส่วนที่ 1 แล้ว{rec?.to ? " (หมดเวลา ระบบส่งให้)" : ""}</p>
          <p className="text-sm font-bold text-emerald-900 mt-1">เหลืออีกส่วนเดียว: วัดระดับคำศัพท์ 20 ข้อ {BANK.vocabMinutes} นาที — อ่านคำตัวหนาในประโยค แล้วเลือกความหมายภาษาไทย</p>
        </div>
        <button type="button" onClick={startVocab} data-pre-vstart className="w-full py-4 rounded-2xl bg-[#003399] text-white text-lg font-black active:scale-[0.99]">
          {resume ? `ทำต่อ (เหลือ ${fmtClock(vocabLeft)})` : "เริ่มส่วนที่ 2: คำศัพท์"}
        </button>
        {syncLine}
      </div>
    );
  }

  if (view === "done") {
    const band = rec?.a ? bandOf(gradeMain(decodePicks(rec.a, PRE_ITEMS.length)).score) : null;
    const vr = rec?.v ? gradeVocab(decodePicks(rec.v, PRE_VOCAB.length)) : null;
    const color = band?.id === "H" ? "text-emerald-800 bg-emerald-100" : band?.id === "M" ? "text-amber-800 bg-amber-100" : "text-sky-800 bg-sky-100";
    return (
      <div className="animate-fadeIn mt-2 space-y-4" data-pre-view="done">
        {back}
        <div className="rounded-2xl border-2 border-[#003399]/15 p-5 text-center bg-white">
          <p className="text-3xl mb-1">🎯</p>
          <p className="font-black text-gray-900 text-lg">ทำ Pre-test ครบแล้ว ขอบคุณค่ะ</p>
          {band && (
            <p className={`mt-3 inline-block rounded-full px-4 py-1.5 font-black ${color}`} data-pre-band={band.id}>
              {band.th} · {band.en}
            </p>
          )}
          <p className="mt-3 text-sm font-bold text-gray-600">
            {band?.id === "H"
              ? "พื้นฐานดีแล้ว ครูจะให้โจทย์ต่อยอดระดับข้อสอบจริง"
              : band?.id === "M"
                ? "พื้นฐานพอใช้ ครูจะเสริมเรื่องที่ยังพลาดบ่อยให้"
                : "ไม่เป็นไรเลย ครูจะเริ่มเสริมจากพื้นฐานทีละขั้น ทุกคนพัฒนาได้"}
          </p>
          {vr && (
            <p className="mt-3 text-sm font-black text-[#003399]" data-pre-tier={vr.start}>
              📚 {tierStartText(vr.start)}
            </p>
          )}
          <p className="mt-3 text-[11px] font-bold text-gray-400">ผลรายข้อและรายทักษะครูใช้วางแผนการสอน · ไม่นับคะแนนเก็บ</p>
        </div>
        {syncLine}
      </div>
    );
  }

  // ── ทำข้อสอบ ──
  const it = items[cur];
  const order = optionOrder(email, it.id, it.o.length, "fixed" in it ? it.fixed : false);
  const chosen = (vocabMode ? vpicks : picks)[cur];
  const done = (vocabMode ? vpicks : picks).filter((x) => x !== null).length;
  const left = vocabMode ? vocabLeft : mainLeft;
  const shield = camOn && isCovered(cam);
  const hide = shield || guard.split;
  const main = !vocabMode ? PRE_ITEMS[cur] : null;
  const ctx = main?.ctx ? BANK.ctx[main.ctx] : null;
  const newSection = main && (cur === 0 || PRE_ITEMS[cur - 1].sk !== main.sk);
  const unanswered = items.length - done;

  return (
    <div className="animate-fadeIn mt-2 pb-24" data-pre-view={view} data-pre-cur={it.id}>
      <div className="sticky top-[env(safe-area-inset-top,0px)] z-20 bg-white/95 backdrop-blur py-2 mb-2 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <span className="text-xs font-black text-gray-500">{vocabMode ? "ส่วนที่ 2 · คำศัพท์" : "ส่วนที่ 1"}</span>
          <span className={`ml-auto font-black tabular-nums text-lg ${left < 5 * 60000 ? "text-rose-600" : "text-[#003399]"}`} data-pre-clock>
            ⏱ {fmtClock(left)}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#003399] rounded-full transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <button type="button" onClick={() => setGrid((g) => !g)} data-pre-gridbtn className="text-xs font-black text-[#003399] underline tabular-nums">
            ตอบแล้ว {done}/{items.length} {grid ? "▲" : "▼"}
          </button>
        </div>
        {grid && (
          <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 mt-2" data-pre-grid>
            {items.map((x, i) => {
              const a = (vocabMode ? vpicks : picks)[i] !== null;
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => go(i)}
                  data-pre-cell={i + 1}
                  data-answered={a ? "1" : "0"}
                  className={`h-8 rounded-lg text-xs font-black tabular-nums border-2 ${i === cur ? "border-[#003399]" : "border-transparent"} ${a ? "bg-[#003399] text-white" : "bg-gray-100 text-gray-500"}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {guard.notice && (
        <div className="rounded-xl p-3 mb-3 text-sm font-bold flex items-start gap-2 bg-amber-50 text-amber-900 border-2 border-amber-200" data-pre-notice>
          <span className="flex-1">⚠️ ออกจากหน้าแอปครั้งที่ {guard.notice.n} — ระบบบันทึกให้ครูเห็น (อยู่ในหน้านี้จนส่ง)</span>
          <button onClick={guard.clearNotice} className="shrink-0 text-xs underline">
            รับทราบ
          </button>
        </div>
      )}
      {camNote && (
        <div className="rounded-xl p-3 mb-3 text-sm font-bold flex items-start gap-2 bg-amber-50 text-amber-900 border-2 border-amber-200">
          <span className="flex-1">{camNote}</span>
          <button onClick={() => setCamNote(null)} className="shrink-0 text-xs underline">
            รับทราบ
          </button>
        </div>
      )}
      {camOn && <CamBox cam={cam} floating />}
      {guard.split && <SplitShield leftMs={guard.splitLeft} />}
      {shield && <CoverShield phone={cam.phone} reason={cam.faceReason} />}

      <div hidden={hide} {...noCopyProps}>
        {newSection && main && <p className="text-xs font-black text-[#003399] bg-[#003399]/5 rounded-lg px-3 py-1.5 mb-3">{SK_INTRO[main.sk]}</p>}
        {ctx && <CtxBox c={ctx} n={main!.n} />}
        <div className="bg-gray-50 rounded-2xl p-4 mb-3">
          <p className="text-xs font-black text-gray-400 mb-1">ข้อ {cur + 1}</p>
          <div className="text-base md:text-lg font-bold text-gray-900 leading-relaxed" data-pre-q>
            {main?.sk === "ED" ? <EdSentence q={main.q} parts={main.o} /> : <Rich text={it.q} />}
          </div>
        </div>
        <div className="space-y-2 mb-4">
          {order.map((orig, slot) => {
            const on = chosen === orig;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => pick(orig)}
                data-pre-opt={slot}
                data-on={on ? "1" : "0"}
                className={`w-full text-left p-3.5 rounded-xl border-2 font-medium flex gap-3 items-start transition-all active:scale-[0.99] ${on ? "bg-[#003399]/10 border-[#003399] text-[#003399]" : "bg-white border-gray-200 hover:border-[#003399]/50"}`}
              >
                <span className={`shrink-0 w-6 h-6 rounded-full text-xs font-black flex items-center justify-center ${on ? "bg-[#003399] text-white" : "bg-[#003399]/10 text-[#003399]"}`}>{LETTERS[main?.sk === "ED" ? orig : slot]}</span>
                <span className="flex-1">{it.o[orig]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => go(cur - 1)} disabled={cur === 0} data-pre-prev className="flex-1 py-3 rounded-xl border-2 border-gray-200 font-black text-gray-600 disabled:opacity-40">
          ← ก่อนหน้า
        </button>
        {cur < items.length - 1 ? (
          <button type="button" onClick={() => go(cur + 1)} data-pre-next className="flex-1 py-3 rounded-xl bg-[#003399] text-white font-black">
            ถัดไป →
          </button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} data-pre-submit className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-black">
            ส่ง{vocabMode ? "ส่วนที่ 2" : "ส่วนที่ 1"}
          </button>
        )}
      </div>
      {cur < items.length - 1 && (
        <button type="button" onClick={() => setConfirm(true)} className="mt-3 w-full text-xs font-bold text-gray-400 underline">
          ทำเสร็จแล้ว ส่งเลย
        </button>
      )}
      {confirm && (
        <div className="mt-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4" data-pre-confirm>
          <p className="font-black text-emerald-900">ส่ง{vocabMode ? "ส่วนที่ 2" : "ส่วนที่ 1"}เลยไหม?</p>
          <p className="text-sm font-bold text-emerald-800 mt-1">
            {unanswered > 0 ? `ยังไม่ได้ตอบ ${unanswered} ข้อ (กด "ตอบแล้ว ${done}/${items.length}" ด้านบนเพื่อดูข้อที่เหลือ) · ` : "ตอบครบทุกข้อแล้ว · "}ส่งแล้วแก้ไม่ได้
          </p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => (vocabMode ? submitVocab(false) : submitMain(false))} data-pre-confirm-yes className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-black">
              ส่ง
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 font-black text-gray-600">
              ทำต่อ
            </button>
          </div>
        </div>
      )}
      {syncLine && <div className="mt-3">{syncLine}</div>}
    </div>
  );
}

