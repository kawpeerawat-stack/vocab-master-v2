"use client";
// app/_components/DomGuard.tsx — กันหน้าขาว "NotFoundError" เมื่อเบราว์เซอร์/ส่วนเสริมแก้ข้อความในหน้าเอง (v8.6)
//   Google Translate ของ Chrome (และส่วนเสริมแปลภาษาบางตัว) ห่อข้อความด้วย <font> ทำให้ React หาโหนดเดิมไม่เจอตอนอัปเดต
//   → removeChild / insertBefore โยน NotFoundError → ทั้งหน้าพัง (หน้าขาวหรือหน้าแจ้งข้อผิดพลาด)
//   ชั้นที่ 1: layout.tsx สั่ง lang="th" + translate="no" ไม่ให้แปล · ชั้นที่ 2 (ไฟล์นี้): ถ้ายังมีอะไรแก้หน้า ให้ข้ามการลบ/แทรกที่โหนดไม่ใช่ลูกจริง แทนที่จะพัง
//   วิธีเดียวกับที่ทีม React แนะนำสำหรับกรณีนี้ (facebook/react#11538) — ทำงานครั้งเดียวต่อหน้า ไม่แตะข้อมูลนักเรียน
function patchOnce() {
  if (typeof window === "undefined" || typeof Node !== "function") return;
  const w = window as unknown as { __domGuard?: boolean };
  if (w.__domGuard) return;
  w.__domGuard = true;
  const remove = Node.prototype.removeChild;
  Node.prototype.removeChild = function (this: Node, child: Node) {
    if (child.parentNode !== this) return child;
    return remove.call(this, child);
  } as typeof Node.prototype.removeChild;
  const insert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (this: Node, node: Node, ref: Node | null) {
    if (ref && ref.parentNode !== this) return node;
    return insert.call(this, node, ref);
  } as typeof Node.prototype.insertBefore;
}
patchOnce();

export default function DomGuard() {
  return null;
}
