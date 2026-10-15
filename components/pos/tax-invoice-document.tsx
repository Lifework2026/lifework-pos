import { branchLabel } from "@/lib/tax-rules";
import { formatBaht, parseMoney } from "@/lib/format";
import { formatBangkokDateTime } from "@/lib/bangkok";
import type { OrderDetails } from "@/lib/pos-types";

const money = (value: string) => formatBaht(parseMoney(value));

/**
 * Full tax invoice (ใบกำกับภาษีเต็มรูป) on A4. Shows the seller and buyer details, the invoice number and date,
 * the goods, the VAT split and the total. Printed through usePrintDocument("a4").
 * The layout uses inline styles so it prints the same on screen and on paper.
 */
export function TaxInvoiceDocument({ order }: { order: OrderDetails }) {
  const invoice = order.taxInvoice;
  if (!invoice) return null;
  const issued = formatBangkokDateTime(new Date(invoice.issuedAt));
  const cell = { border: "1px solid #000", padding: "4px 6px", verticalAlign: "top" as const };

  return (
    <div style={{ color: "#000", background: "#fff", fontFamily: "'Noto Sans Thai', Tahoma, sans-serif", fontSize: 12 }}>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>ใบกำกับภาษี / Tax Invoice</div>
        <div style={{ fontSize: 11 }}>ต้นฉบับ / Original</div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, border: "1px solid #000", padding: 8 }}>
          <div style={{ fontWeight: 700 }}>ผู้ขาย / Seller</div>
          <div style={{ fontWeight: 600 }}>{invoice.seller.name}</div>
          <div>{branchLabel(invoice.seller.branch)}</div>
          <div>{invoice.seller.address}</div>
          <div>เลขประจำตัวผู้เสียภาษี: {invoice.seller.taxId}</div>
        </div>
        <div style={{ flex: 1, border: "1px solid #000", padding: 8 }}>
          <div style={{ fontWeight: 700 }}>ผู้ซื้อ / Buyer</div>
          <div style={{ fontWeight: 600 }}>{invoice.customer.name}</div>
          <div>{branchLabel(invoice.customer.branch)}</div>
          <div>{invoice.customer.address}</div>
          <div>เลขประจำตัวผู้เสียภาษี: {invoice.customer.taxId}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
        <tbody>
          <tr>
            <td style={cell}>เลขที่ / Invoice No.: <strong>{invoice.number}</strong></td>
            <td style={cell}>วันที่ / Date: {issued}</td>
            <td style={cell}>อ้างอิงใบเสร็จ / Receipt: {order.receiptNo}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...cell, width: 36, textAlign: "center" }}>ลำดับ</th>
            <th style={{ ...cell, textAlign: "left" }}>รายการ / Description</th>
            <th style={{ ...cell, width: 60, textAlign: "right" }}>จำนวน</th>
            <th style={{ ...cell, width: 100, textAlign: "right" }}>ราคา/หน่วย</th>
            <th style={{ ...cell, width: 110, textAlign: "right" }}>จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {order.items
            .filter((item) => item.quantity > 0)
            .map((item, index) => (
              <tr key={item.id}>
                <td style={{ ...cell, textAlign: "center" }}>{index + 1}</td>
                <td style={cell}>
                  {item.productName}
                  {item.isBag ? " (ถุง)" : ""}
                  <div style={{ fontSize: 10 }}>
                    {item.isBag ? item.sku : `${item.size} / ${item.color} · ${item.sku}`}
                  </div>
                </td>
                <td style={{ ...cell, textAlign: "right" }}>{item.quantity}</td>
                <td style={{ ...cell, textAlign: "right" }}>{money(item.unitPrice)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{money(item.netAmount)}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <tbody>
          <tr>
            <td style={{ ...cell, width: "60%" }} rowSpan={4}>
              <div>วิธีชำระ / Payment:</div>
              {order.payments.map((payment, index) => (
                <div key={`${payment.method}-${index}`}>
                  {payment.method} {money(payment.amount)}
                </div>
              ))}
            </td>
            <td style={{ ...cell, textAlign: "right" }}>มูลค่าสินค้า/บริการ (ก่อน VAT) / Value excl. VAT</td>
            <td style={{ ...cell, width: 110, textAlign: "right" }}>{formatBaht(parseMoney(invoice.valueExVat))}</td>
          </tr>
          <tr>
            <td style={{ ...cell, textAlign: "right" }}>ภาษีมูลค่าเพิ่ม {invoice.vatPercent}% / VAT {invoice.vatPercent}%</td>
            <td style={{ ...cell, textAlign: "right" }}>{formatBaht(parseMoney(invoice.vat))}</td>
          </tr>
          <tr>
            <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>จำนวนเงินรวมทั้งสิ้น / Total incl. VAT</td>
            <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{formatBaht(parseMoney(invoice.totalInclVat))}</td>
          </tr>
          {order.refundedAmount !== "0.00" ? (
            <tr>
              <td style={{ ...cell, textAlign: "right" }}>คืนเงินแล้ว / Refunded</td>
              <td style={{ ...cell, textAlign: "right" }}>{money(order.refundedAmount)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
        <div style={{ width: "45%", textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>ผู้รับสินค้า/บริการ / Received by</div>
        </div>
        <div style={{ width: "45%", textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>ผู้มีอำนาจลงนาม / Authorised signature</div>
        </div>
      </div>

      <p style={{ fontSize: 10, marginTop: 16 }}>
        ราคาสินค้าได้รวมภาษีมูลค่าเพิ่มแล้ว · หากมีการคืนสินค้าหลังออกใบกำกับภาษี ต้องออกใบลดหนี้ตามประมวลรัษฎากร
      </p>
    </div>
  );
}
